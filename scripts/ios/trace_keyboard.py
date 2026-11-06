"""Opt-in LLDB probes for HAM-175. See docs/implementation/polish-painting-toolbar/ios-keyboard-trace.md.

Importing registers commands only. No swizzling, event injection, focus changes,
or replacement return values. --details uses read-only ObjC getters; without it
callbacks only read registers/stacks. This module runs in Xcode's LLDB Python.
"""

import argparse
import datetime
import json
from pathlib import Path
import shlex
import time

import lldb


def objc(classes, selectors):
    # WebKit implements many selectors in ObjC categories.
    return r"^-\[(" + classes + r")(\([^]]+\))? (" + selectors + r")\]$"


# Names are discovery patterns, not a promise that Apple's shipped build exposes
# them. Inventory and a positive control are mandatory before interpreting absence.
PROBES = {
    "app": [
        ("application.receive", objc("UIApplication", "_handleKeyUIEvent:")),
        ("application.dispatch", objc("UIApplication", "sendEvent:")),
        ("application.action", objc("UIApplication", "sendAction:to:from:forEvent:")),
        ("responder.presses", objc("UIWindow|UIResponder|WKContentView", "presses(Began|Ended|Changed|Cancelled):withEvent:")),
        ("responder.commands", r"^-\[[^]]+ (_?keyCommands)\]$"),
        ("webkit.presses", objc("WKContentView", "_tryToHandlePressesEvent:")),
        ("webkit.requires", objc("WKContentView", "requiresKeyEvents")),
        ("webkit.entry", objc("WKContentView", "(_internalHandleKeyWebEvent:|handleKeyWebEvent:)(withCompletionHandler:)?|handleKeyEntry:withCompletionHandler:")),
        ("webkit.ime", objc("WKContentView", "_deferKeyEventToInputMethodEditing:")),
        ("webkit.completion", objc("WKContentView", "_didHandleKeyEvent:eventWasHandled:")),
        ("proxy.enqueue", r"^WebKit::WebPageProxy::handleKeyboardEvent\("),
        ("proxy.send", r"^WebKit::WebPageProxy::sendKeyEvent\("),
        ("proxy.completion", r"^WebKit::WebPageProxy::keyEventHandlingCompleted\("),
    ],
    "webcontent": [
        ("webprocess.receive", r"^WebKit::WebPage::keyEvent\("),
        ("webprocess.frame", r"^WebKit::WebFrame::handleKeyEvent\("),
        ("webcore.key", r"^WebCore::EventHandler::keyEvent\("),
        ("webcore.dispatch", r"^WebCore::EventDispatcher::dispatchEvent\("),
    ],
}

_session = None


def registers_for(triple):
    arch = triple.split("-")[0]
    if arch in ("arm64", "arm64e", "aarch64"):
        return ["x0", "x1", "x2", "x3", "x4", "x5"]
    if arch == "x86_64":
        return ["rdi", "rsi", "rdx", "rcx", "r8", "r9"]
    raise ValueError("Unsupported architecture: " + triple)


def arguments(frame, triple):
    values = []
    for name in registers_for(triple):
        value = frame.FindRegister(name)
        if not value.IsValid() or value.GetError().Fail():
            raise ValueError("Unreadable argument register: " + name)
        values.append(value.GetValueAsUnsigned())
    return values


def write(entry):
    s = _session
    s["sequence"] += 1
    record = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "monotonic_ns": time.monotonic_ns(),
        "sequence": s["sequence"],
        "role": s["role"],
        "pid": s["pid"],
        **entry,
    }
    s["file"].write(json.dumps(record, ensure_ascii=False) + "\n")
    s["file"].flush()


def evaluate_json(frame, body):
    # Avoid recursive callbacks from getters and bound expression execution.
    options = lldb.SBExpressionOptions()
    options.SetLanguage(lldb.eLanguageTypeObjC_plus_plus)
    options.SetIgnoreBreakpoints(True)
    options.SetUnwindOnError(True)
    options.SetTryAllThreads(False)
    options.SetSuppressPersistentResult(True)
    options.SetTimeoutInMicroSeconds(250000)
    expression = '''(id)({ NSMutableDictionary *d = [NSMutableDictionary dictionary];
    %s
    [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:d options:0 error:0]
        encoding:4]; })''' % body
    value = frame.EvaluateExpression(expression, options)
    if value.GetError().Fail():
        raise ValueError(str(value.GetError()))
    return json.loads(value.GetObjectDescription())


def details(frame, point, args):
    # All argument decoding below is ObjC ABI only. C++ registers stay opaque:
    # Ref<T>, frame IDs and event layouts vary with the shipped WebKit version.
    if not point.startswith("-["):
        return {}
    body = f'id receiver = (id){args[0]}; d[@"class"] = NSStringFromClass([receiver class]);'
    if "sendAction:to:from:forEvent:" in point:
        body += f'''
        d[@"action"] = NSStringFromSelector((SEL){args[2]});
        id target = (id){args[3]}, sender = (id){args[4]};
        if (target) d[@"targetClass"] = NSStringFromClass([target class]);
        if (sender) d[@"senderClass"] = NSStringFromClass([sender class]);
        if ([sender isKindOfClass:[UIKeyCommand class]]) {{
            d[@"input"] = [sender input] ?: @"";
            d[@"modifiers"] = @((unsigned long)[sender modifierFlags]);
        }}'''
    elif "withEvent:" in point or any(x in point for x in ("sendEvent:", "_handleKeyUIEvent:", "_tryToHandlePressesEvent:")):
        event = args[3] if "withEvent:" in point else args[2]
        body += f'''
        id event = (id){event};
        d[@"event"] = [NSString stringWithFormat:@"%p", event];
        d[@"eventType"] = @((long)[event type]);
        d[@"eventTimestamp"] = @((double)[event timestamp]);
        if ([event respondsToSelector:@selector(_hidEvent)])
            d[@"hasHIDEvent"] = @((void *)[event _hidEvent] != 0);
        NSMutableArray *presses = [NSMutableArray array];
        if ([event respondsToSelector:@selector(allPresses)]) {{
            for (id press in (id)[event allPresses]) {{
                id key = (id)[press key];
                NSMutableDictionary *p = [NSMutableDictionary dictionary];
                p[@"press"] = [NSString stringWithFormat:@"%p", press];
                p[@"phase"] = @((long)[press phase]);
                if (key) {{
                    p[@"hidKeyCode"] = @((long)[key keyCode]);
                    p[@"modifiers"] = @((unsigned long)[key modifierFlags]);
                }}
                [presses addObject:p];
            }}
        }}
        d[@"presses"] = presses;'''
    elif "KeyWebEvent:" in point or "_didHandleKeyEvent:" in point or "_deferKeyEvent" in point:
        body += f'''
        id event = (id){args[2]};
        d[@"webEvent"] = [NSString stringWithFormat:@"%p", event];
        if ([event respondsToSelector:@selector(keyCode)]) d[@"webKeyCode"] = @((long)[event keyCode]);
        if ([event respondsToSelector:@selector(timestamp)]) d[@"eventTimestamp"] = @((double)[event timestamp]);
        '''
        if "eventWasHandled:" in point:
            body += f'd[@"handled"] = @((BOOL){args[3]});'
    if "WKContentView" in point:
        body += '''
        d[@"firstResponder"] = @((BOOL)[receiver isFirstResponder]);
        NSMutableArray *chain = [NSMutableArray array];
        for (id v = receiver; v && [chain count] < 24; v = (id)[v superview])
            [chain addObject:[NSString stringWithFormat:@"%@: %p", NSStringFromClass([v class]), v]];
        d[@"ancestors"] = chain;'''
    return evaluate_json(frame, body)


def observe(frame, bp_loc, internal_dict):
    s = _session
    if s is None:
        return False
    actual_pid = frame.GetThread().GetProcess().GetProcessID()
    if actual_pid != s["pid"]:
        write({"kind": "process-changed", "actualPid": actual_pid,
               "error": "Process changed; stop and start a new trace file"})
        s["errors"] += 1
        for identifier in s["owned"]:
            s["target"].FindBreakpointByID(identifier).SetEnabled(False)
        return False
    probe = s["owned"][bp_loc.GetBreakpoint().GetID()]
    point = frame.GetFunctionName() or ""
    entry = {"kind": "hit", "probe": probe, "point": point,
             "thread": frame.GetThread().GetThreadID(), "pc": hex(frame.GetPC())}
    try:
        args = arguments(frame, s["triple"])
        entry["arguments"] = [hex(value) for value in args]
        entry["stack"] = [
            {"pc": hex(f.GetPC()), "function": f.GetFunctionName(),
             "module": f.GetModule().GetFileSpec().GetFilename()}
            for f in list(frame.GetThread())[:12]
        ]
        if s["details"]:
            entry["details"] = details(frame, point, args)
    except Exception as error:
        s["errors"] += 1
        entry["error"] = str(error)
    write(entry)
    return False  # Observe and resume; never consume or forward the input.


def install(target, role):
    inventory = []
    for probe, pattern in PROBES[role]:
        # Use regex for discovery, then break at the actual symbol entry so ABI
        # argument registers have not been overwritten by a function prologue.
        discovery = target.BreakpointCreateByRegex(pattern)
        discovery.SetEnabled(False)
        addresses = {}
        try:
            for location in discovery:
                address = location.GetAddress()
                function, symbol = address.GetFunction(), address.GetSymbol()
                start = function.GetStartAddress() if function.IsValid() else symbol.GetStartAddress()
                load = start.GetLoadAddress(target)
                if load != lldb.LLDB_INVALID_ADDRESS:
                    addresses[load] = start
        finally:
            target.BreakpointDelete(discovery.GetID())
        ids = []
        for start in addresses.values():
            bp = target.BreakpointCreateBySBAddress(start)
            _session["owned"][bp.GetID()] = probe
            bp.SetScriptCallbackFunction(__name__ + ".observe")
            ids.append(bp.GetID())
        inventory.append({"probe": probe, "pattern": pattern, "breakpoints": ids,
                          "coverage": "resolved" if ids else "unavailable"})
    return inventory


def status(debugger, command, result, internal_dict):
    if _session is None:
        result.SetError("No active HAM-175 trace")
        return
    rows = []
    for item in _session["inventory"]:
        bps = [_session["target"].FindBreakpointByID(i) for i in item["breakpoints"]]
        rows.append({**item, "locations": sum(b.GetNumResolvedLocations() for b in bps),
                     "hits": sum(b.GetHitCount() for b in bps)})
    record = {"kind": "inventory", "probes": rows, "errors": _session["errors"]}
    write(record)
    result.AppendMessage(json.dumps(record, ensure_ascii=False, indent=2))


def cleanup():
    global _session
    if _session is not None:
        for identifier in _session["owned"]:
            _session["target"].BreakpointDelete(identifier)
        _session["file"].close()
        _session = None


def start(debugger, command, result, internal_dict):
    global _session
    if _session is not None:
        result.SetError("Trace already active; ham175-stop before starting another")
        return
    parser = argparse.ArgumentParser(prog="ham175-start")
    parser.add_argument("--role", choices=PROBES, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--details", action="store_true")
    try:
        args = parser.parse_args(shlex.split(command))
        target = debugger.GetSelectedTarget()
        process = target.GetProcess()
        if not process.IsValid() or process.GetState() != lldb.eStateStopped:
            raise ValueError("Attach and pause the selected process after the WebView has loaded")
        triple = target.GetTriple()
        registers_for(triple)
        # Exclusive creation prevents silently mixing two builds/runs in one log.
        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        log = output.open("x", encoding="utf-8")
        _session = {"target": target, "role": args.role, "pid": process.GetProcessID(),
                    "triple": triple, "details": args.details, "file": log,
                    "owned": {}, "sequence": 0, "errors": 0, "inventory": []}
        write({"kind": "start", "triple": triple, "details": args.details,
               "lldb": debugger.GetVersionString(), "executable": str(target.GetExecutable())})
        _session["inventory"] = install(target, args.role)
        status(debugger, "", result, internal_dict)
        result.AppendMessage("Continue the process. Unavailable probes are NOT evidence of a dropped event.")
    except SystemExit as error:
        if error.code:
            result.SetError("Invalid trace options; use ham175-start --help")
        return
    except Exception as error:
        cleanup()
        result.SetError(str(error))


def mark(debugger, command, result, internal_dict):
    if _session is None:
        result.SetError("No active HAM-175 trace")
        return
    write({"kind": "mark", "label": command.strip()})


def stop(debugger, command, result, internal_dict):
    if _session is None:
        result.SetError("No active HAM-175 trace")
        return
    try:
        status(debugger, "", result, internal_dict)
        write({"kind": "stop"})
    finally:
        cleanup()  # Only our breakpoints; leave other debugger work intact.


def __lldb_init_module(debugger, internal_dict):
    for name, function in (("start", start), ("status", status), ("mark", mark), ("stop", stop)):
        debugger.HandleCommand(f"command script add -f {__name__}.{function.__name__} ham175-{name}")
    print("HAM-175 commands registered; no probes enabled. Use ham175-start explicitly.")
