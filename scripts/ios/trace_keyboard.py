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
        ("webkit.keyboard-required", objc("WKContentView", "_requiresKeyboardWhenFirstResponder")),
        ("webkit.async", objc("WKContentView", "shouldUseAsyncInteractions")),
        ("webkit.delegate-change", objc("WKContentView", "set(InputDelegate|AsyncInputDelegate):")),
        ("keyboard.manager", objc("_UIKeyboardStateManager", "handleKeyEvent:(executionContext:)?")),
        ("keyboard.delegate", objc("UIKBInputDelegateManager", "handleKeyWebEvent:withCompletionHandler:")),
        ("webkit.entry", objc("WKContentView", "(_internalHandleKeyWebEvent:|handleKeyWebEvent:)(withCompletionHandler:)?|handleKeyEntry:withCompletionHandler:")),
        ("webkit.ime", objc("WKContentView", "_deferKeyEventToInputMethodEditing:")),
        ("webkit.completion", objc("WKContentView", "_didHandleKeyEvent:eventWasHandled:")),
        ("proxy.enqueue", r"^WebKit::WebPageProxy::handleKeyboardEvent\("),
        ("proxy.send", r"^WebKit::WebPageProxy::sendKeyEvent\("),
        ("proxy.completion", r"^WebKit::WebPageProxy::keyEventHandlingCompleted\("),
        ("page.focused", r"^WebKit::PageClientImpl::isViewFocused\("),
        ("page.active", r"^WebKit::PageClientImpl::isViewWindowActive\("),
    ],
    "webcontent": [
        ("webprocess.receive", r"^WebKit::WebPage::keyEvent\("),
        ("webprocess.frame", r"^WebKit::WebFrame::handleKeyEvent\("),
        ("webcore.key", r"^WebCore::EventHandler::keyEvent\("),
        ("webcore.dispatch", r"^WebCore::EventDispatcher::dispatchEvent\("),
    ],
}

# All these functions return BOOL/bool. Entry alone does not prove consumption,
# enqueue success, or focus. Read the real ABI return register at the caller PC.
BOOL_RETURNS = {"webkit.presses", "webkit.requires", "webkit.keyboard-required",
                "webkit.async", "webkit.ime", "proxy.enqueue", "page.focused", "page.active"}
DETAIL_PROBES = {"application.receive", "application.dispatch", "application.action",
                 "webkit.presses", "webkit.entry", "webkit.completion"}

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
    return s["sequence"]


def json_expression(body):
    # Avoid names such as d/key/event which collide with stripped Apple debug
    # symbols. Cast dynamic ObjC getter results even after @import UIKit: Apple
    # LLDB can lack method declarations for an id receiver (HAM-175 bb06548).
    return '''(id)({
    NSMutableDictionary *ham175_trace_record = (NSMutableDictionary *)[NSMutableDictionary dictionary];
    %s
    (id)[(NSString *)[NSString alloc] initWithData:
        (NSData *)[NSJSONSerialization dataWithJSONObject:ham175_trace_record options:0 error:0]
        encoding:4]; })''' % body


def evaluate_json(frame, body):
    # Avoid recursive callbacks from getters and bound expression execution.
    options = lldb.SBExpressionOptions()
    options.SetLanguage(lldb.eLanguageTypeObjC_plus_plus)
    options.SetIgnoreBreakpoints(True)
    options.SetUnwindOnError(True)
    options.SetTryAllThreads(False)
    options.SetSuppressPersistentResult(True)
    options.SetTimeoutInMicroSeconds(250000)
    value = frame.EvaluateExpression(json_expression(body), options)
    if value.GetError().Fail():
        raise ValueError(str(value.GetError()))
    return json.loads(value.GetObjectDescription())


def detail_body(point, args):
    # All argument decoding below is ObjC ABI only. C++ registers stay opaque:
    # Ref<T>, frame IDs and event layouts vary with the shipped WebKit version.
    if not point.startswith("-["):
        return ""
    body = f'''id ham175_trace_receiver = (id){args[0]};
    ham175_trace_record[@"class"] = NSStringFromClass((Class)[ham175_trace_receiver class]);'''
    if "sendAction:to:from:forEvent:" in point:
        body += f'''
        ham175_trace_record[@"action"] = NSStringFromSelector((SEL){args[2]});
        id ham175_trace_target = (id){args[3]}, ham175_trace_sender = (id){args[4]};
        if (ham175_trace_target) ham175_trace_record[@"targetClass"] = NSStringFromClass((Class)[ham175_trace_target class]);
        if (ham175_trace_sender) ham175_trace_record[@"senderClass"] = NSStringFromClass((Class)[ham175_trace_sender class]);
        if ((BOOL)[ham175_trace_sender isKindOfClass:(Class)[UIKeyCommand class]]) {{
            ham175_trace_record[@"input"] = (id)[ham175_trace_sender input] ?: @"";
            ham175_trace_record[@"modifiers"] = @((unsigned long)[ham175_trace_sender modifierFlags]);
        }}'''
    elif "withEvent:" in point or any(x in point for x in ("sendEvent:", "_handleKeyUIEvent:", "_tryToHandlePressesEvent:")):
        event = args[3] if "withEvent:" in point else args[2]
        body += f'''
        id ham175_trace_event = (id){event};
        ham175_trace_record[@"event"] = (id)[NSString stringWithFormat:@"%p", ham175_trace_event];
        ham175_trace_record[@"eventType"] = @((long)[ham175_trace_event type]);
        ham175_trace_record[@"eventTimestamp"] = @((double)[ham175_trace_event timestamp]);
        if ((BOOL)[ham175_trace_event respondsToSelector:@selector(_hidEvent)])
            ham175_trace_record[@"hasHIDEvent"] = @((void *)[ham175_trace_event _hidEvent] != 0);
        NSMutableArray *ham175_trace_presses = (NSMutableArray *)[NSMutableArray array];
        if ((BOOL)[ham175_trace_event respondsToSelector:@selector(allPresses)]) {{
            for (id ham175_trace_press in (id)[ham175_trace_event allPresses]) {{
                id ham175_trace_key = (id)[ham175_trace_press key];
                NSMutableDictionary *ham175_trace_pressRecord = (NSMutableDictionary *)[NSMutableDictionary dictionary];
                ham175_trace_pressRecord[@"press"] = (id)[NSString stringWithFormat:@"%p", ham175_trace_press];
                ham175_trace_pressRecord[@"phase"] = @((long)[ham175_trace_press phase]);
                if (ham175_trace_key) {{
                    ham175_trace_pressRecord[@"hidKeyCode"] = @((long)[ham175_trace_key keyCode]);
                    ham175_trace_pressRecord[@"modifiers"] = @((unsigned long)[ham175_trace_key modifierFlags]);
                }}
                (void)[ham175_trace_presses addObject:ham175_trace_pressRecord];
            }}
        }}
        ham175_trace_record[@"presses"] = ham175_trace_presses;'''
    elif "KeyWebEvent:" in point or "_didHandleKeyEvent:" in point or "_deferKeyEvent" in point:
        body += f'''
        id ham175_trace_event = (id){args[2]};
        ham175_trace_record[@"webEvent"] = (id)[NSString stringWithFormat:@"%p", ham175_trace_event];
        if ((BOOL)[ham175_trace_event respondsToSelector:@selector(keyCode)]) ham175_trace_record[@"webKeyCode"] = @((long)[ham175_trace_event keyCode]);
        if ((BOOL)[ham175_trace_event respondsToSelector:@selector(timestamp)]) ham175_trace_record[@"eventTimestamp"] = @((double)[ham175_trace_event timestamp]);
        '''
        if "eventWasHandled:" in point:
            body += f'ham175_trace_record[@"handled"] = @((BOOL){args[3] & 0xff});'
    if "WKContentView" in point:
        body += '''
        ham175_trace_record[@"firstResponder"] = @((BOOL)[ham175_trace_receiver isFirstResponder]);
        NSMutableArray *ham175_trace_chain = (NSMutableArray *)[NSMutableArray array];
        for (id ham175_trace_view = ham175_trace_receiver;
             ham175_trace_view && (unsigned long)[ham175_trace_chain count] < 24;
             ham175_trace_view = (id)[ham175_trace_view superview])
            (void)[ham175_trace_chain addObject:(id)[NSString stringWithFormat:@"%@: %p",
                NSStringFromClass((Class)[ham175_trace_view class]), ham175_trace_view]];
        ham175_trace_record[@"ancestors"] = ham175_trace_chain;'''
    return body


def focus_body(receiver):
    body = f'''id ham175_trace_receiver = (id){receiver};
    id ham175_trace_window = (id)[ham175_trace_receiver window];
    ham175_trace_record[@"keyWindow"] = @((BOOL)[ham175_trace_window isKeyWindow]);
    id ham175_trace_scene = (id)[ham175_trace_window windowScene];
    if (ham175_trace_scene) ham175_trace_record[@"sceneActivationState"] = @((long)[ham175_trace_scene activationState]);
    id ham175_trace_system = (id)[UIFocusSystem focusSystemForEnvironment:ham175_trace_receiver];
    id ham175_trace_item = (id)[ham175_trace_system focusedItem];
    ham175_trace_record[@"focusedItem"] = (id)[NSString stringWithFormat:@"%p", ham175_trace_item];
    if (ham175_trace_item) ham175_trace_record[@"focusedItemClass"] = NSStringFromClass((Class)[ham175_trace_item class]);'''
    # Read delegates already held by WKContentView. Calling a keyboard singleton
    # accessor here could initialize the very input machinery we are diagnosing.
    for selector in ("inputDelegate", "asyncInputDelegate"):
        body += f'''
        ham175_trace_record[@"{selector}Available"] = @((BOOL)[ham175_trace_receiver respondsToSelector:@selector({selector})]);
        if ((BOOL)[ham175_trace_receiver respondsToSelector:@selector({selector})]) {{
            id ham175_trace_{selector} = (id)[ham175_trace_receiver {selector}];
            ham175_trace_record[@"{selector}"] = (id)[NSString stringWithFormat:@"%p", ham175_trace_{selector}];
            if (ham175_trace_{selector}) ham175_trace_record[@"{selector}Class"] = NSStringFromClass((Class)[ham175_trace_{selector} class]);
        }}'''
    for selector in ("requiresKeyEvents", "_requiresKeyboardWhenFirstResponder",
                     "shouldUseAsyncInteractions", "_hasFocusedElement"):
        body += f'''
        if ((BOOL)[ham175_trace_receiver respondsToSelector:@selector({selector})])
            ham175_trace_record[@"{selector}"] = @((BOOL)[ham175_trace_receiver {selector}]);'''
    return body


def details(frame, point, args):
    body = detail_body(point, args)
    return evaluate_json(frame, body) if body else {}


def read_register(frame, name):
    value = frame.FindRegister(name)
    if not value.IsValid() or value.GetError().Fail():
        raise ValueError("Unreadable register: " + name)
    return value.GetValueAsUnsigned()


def return_abi(triple):
    registers_for(triple)  # Reject unknown ABI, never guess a zero/false value.
    return ("rsp", "rax", 8) if triple.startswith("x86_64-") else ("sp", "x0", 0)


def arm_return(frame, probe, call_id, receiver):
    s = _session
    if len(s["returns"]) >= 128:
        raise ValueError("128 pending returns; stop/start trace and inspect unmatched calls")
    stack_register, _, pop_bytes = return_abi(s["triple"])
    # The unwinder gives a code address without arm64e pointer authentication bits.
    caller = frame.GetThread().GetFrameAtIndex(1)
    if not caller.IsValid() or caller.GetPC() in (0, lldb.LLDB_INVALID_ADDRESS):
        raise ValueError("Caller PC unavailable; return is unobserved")
    expected_sp = read_register(frame, stack_register) + pop_bytes
    bp = s["target"].BreakpointCreateByAddress(caller.GetPC())
    if not bp.IsValid() or bp.GetNumResolvedLocations() == 0:
        s["target"].BreakpointDelete(bp.GetID())
        raise ValueError("Return breakpoint did not resolve")
    s["returns"][bp.GetID()] = {"probe": probe, "callSequence": call_id,
                                "expectedSP": expected_sp, "receiver": receiver,
                                "thread": frame.GetThread().GetThreadID()}
    bp.SetThreadID(frame.GetThread().GetThreadID())
    bp.SetScriptCallbackFunction(__name__ + ".observe_return")


def same_process(frame):
    s = _session
    actual_pid = frame.GetThread().GetProcess().GetProcessID()
    if actual_pid == s["pid"]:
        return True
    write({"kind": "process-changed", "actualPid": actual_pid,
           "error": "Process changed; stop and start a new trace file"})
    s["errors"] += 1
    for identifier in [*s["owned"], *s.get("returns", {})]:
        s["target"].FindBreakpointByID(identifier).SetEnabled(False)
    return False


def capture_focus(frame, entry, receiver):
    # Isolate optional focus getters so they cannot erase event metadata.
    try:
        entry["focus"] = evaluate_json(frame, focus_body(receiver))
    except Exception as error:
        entry["focusError"] = str(error)
        _session["errors"] += 1


def observe_return(frame, bp_loc, internal_dict):
    s = _session
    if s is None or not same_process(frame):
        return False
    identifier = bp_loc.GetBreakpoint().GetID()
    pending = s["returns"].get(identifier)
    if pending is None:
        return False
    entry = {"kind": "return", "probe": pending["probe"],
             "callSequence": pending["callSequence"], "thread": pending["thread"]}
    try:
        stack_register, result_register, _ = return_abi(s["triple"])
        if (frame.GetThread().GetThreadID() != pending["thread"] or
                read_register(frame, stack_register) != pending["expectedSP"]):
            return False  # Recursive/same-call-site hits must not consume this probe.
        raw = read_register(frame, result_register)
        entry["rawReturn"] = hex(raw)
        entry["value"] = bool(raw & 0xff)  # BOOL/bool occupies the low byte.
        if s["details"] and pending["probe"] == "webkit.presses":
            capture_focus(frame, entry, pending["receiver"])
    except Exception as error:
        entry["error"] = str(error)
        s["errors"] += 1
    write(entry)
    s["target"].BreakpointDelete(identifier)
    del s["returns"][identifier]
    return False


def observe(frame, bp_loc, internal_dict):
    s = _session
    if s is None or not same_process(frame):
        return False
    probe = s["owned"][bp_loc.GetBreakpoint().GetID()]
    point = frame.GetFunctionName() or ""
    entry = {"kind": "hit", "probe": probe, "point": point,
             "thread": frame.GetThread().GetThreadID(), "pc": hex(frame.GetPC())}
    args = None
    try:
        args = arguments(frame, s["triple"])
        entry["arguments"] = [hex(value) for value in args]
        entry["stack"] = [
            {"pc": hex(f.GetPC()), "function": f.GetFunctionName(),
             "module": f.GetModule().GetFileSpec().GetFilename()}
            for f in list(frame.GetThread())[:12]
        ]
        # keyCommands is queried hundreds of times per key; keep those probes
        # register/stack-only so metadata getters do not dominate input timing.
        if s["details"] and probe in DETAIL_PROBES:
            entry["details"] = details(frame, point, args)
    except Exception as error:
        s["errors"] += 1
        entry["error"] = str(error)
    if s["details"] and probe == "webkit.presses" and args is not None:
        capture_focus(frame, entry, args[0])
    # Completion's handled argument is available even if getter compilation fails.
    if probe == "webkit.completion" and args is not None:
        entry["handled"] = bool(args[3] & 0xff)
    call_id = write(entry)
    if probe in BOOL_RETURNS and args is not None:
        try:
            arm_return(frame, probe, call_id, args[0])
        except Exception as error:
            s["errors"] += 1
            write({"kind": "return-unavailable", "probe": probe,
                   "callSequence": call_id, "error": str(error)})
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
    record = {"kind": "inventory", "probes": rows, "errors": _session["errors"],
              "pendingReturns": list(_session.get("returns", {}).values())}
    write(record)
    result.AppendMessage(json.dumps(record, ensure_ascii=False, indent=2))


def cleanup():
    global _session
    if _session is not None:
        for identifier in [*_session["owned"], *_session.get("returns", {})]:
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
                    "owned": {}, "returns": {}, "sequence": 0, "errors": 0, "inventory": []}
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
