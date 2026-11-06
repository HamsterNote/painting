"""Opt-in LLDB probes for HAM-175. See docs/implementation/polish-painting-toolbar/ios-keyboard-trace.md.

Importing registers commands only. No swizzling, event injection, focus changes,
or replacement return values. Callbacks read registers/stacks only. --details
permits an explicit ham175-focus snapshot; getters never run during key delivery. This module runs in Xcode's LLDB Python.
"""

import argparse
import datetime
import json
import re
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
    # One bounded Pinyin Escape experiment. No hot command getters or WebContent
    # attachment; compare real HID with the Debug container switch off/on.
    "escape": [
        ("application.receive", objc("UIApplication", "_handleKeyUIEvent:")),
        ("application.dispatch", objc("UIApplication", "sendEvent:")),
        ("application.action", objc("UIApplication", "sendAction:to:from:forEvent:")),
        ("keyboard.precommand", objc("UIKeyboardImpl", "handleKeyCommand:repeatOkay:beforePublicKeyCommands:")),
        ("keyboard.impl", objc("UIKeyboardImpl", "_?handleKeyEvent:(executionContext:)?")),
        ("keyboard.manager", objc("_UIKeyboardStateManager", "handleKeyEvent:(executionContext:)?")),
        ("webkit.presses", objc("WKContentView", "_tryToHandlePressesEvent:")),
        ("webkit.entry", objc("WKContentView", "(_internalHandleKeyWebEvent:|handleKeyWebEvent:)(withCompletionHandler:)?|handleKeyEntry:withCompletionHandler:")),
        ("webkit.completion", objc("WKContentView", "_didHandleKeyEvent:eventWasHandled:")),
    ],
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

# Only known BOOL boundaries, plus a runtime-verified private IME signature.
# Hot getters and optimized C++/inline functions are entry-only, verbose opt-in.
BOOL_RETURNS = {"webkit.presses"}
VERBOSE_PROBES = {"responder.commands", "webkit.requires", "webkit.keyboard-required",
                  "webkit.async", "webkit.ime", "page.focused", "page.active"}
RETURN_TTL_SECONDS = 5
MAX_RETURNS = 32

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


def expression_options():
    # Avoid recursive callbacks from getters and bound expression execution.
    options = lldb.SBExpressionOptions()
    options.SetLanguage(lldb.eLanguageTypeObjC_plus_plus)
    options.SetIgnoreBreakpoints(True)
    options.SetUnwindOnError(True)
    options.SetTryAllThreads(False)
    options.SetSuppressPersistentResult(True)
    options.SetTimeoutInMicroSeconds(250000)
    return options


def evaluate_json(frame, body):
    value = frame.EvaluateExpression(json_expression(body), expression_options())
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


def precommand_bool_abi(encoding):
    # BOOL/bool return, self, _cmd, object command, BOOL* repeat, BOOL beforePublic.
    # Do not interpret a register from a void/different private ABI as "handled".
    return bool(re.fullmatch(r"[cB]\d+@\d+:\d+@\d+\^[cB]\d+[cB]\d+", encoding))


def precommand_encoding(target):
    # Explicitly paused inventory only, before any HID. Runtime metadata reads;
    # no UIKit singleton, input method, responder or command getter is invoked.
    frame = target.GetProcess().GetSelectedThread().GetFrameAtIndex(0)
    imports = frame.EvaluateExpression("@import Foundation; @import ObjectiveC;", expression_options())
    if imports.GetError().Fail():
        raise ValueError(str(imports.GetError()))
    return evaluate_json(frame, '''
        Class ham175_trace_class = (Class)objc_getClass("UIKeyboardImpl");
        Method ham175_trace_method = ham175_trace_class ? class_getInstanceMethod(ham175_trace_class,
            sel_registerName("handleKeyCommand:repeatOkay:beforePublicKeyCommands:")) : 0;
        const char *ham175_trace_encoding = ham175_trace_method ? method_getTypeEncoding(ham175_trace_method) : 0;
        ham175_trace_record[@"encoding"] = ham175_trace_encoding ?
            (id)[NSString stringWithUTF8String:ham175_trace_encoding] : @"";
    ''')["encoding"]


def routing_arguments(probe, args, verified_returns):
    if probe == "application.action":
        # Match sender/target pointers against command-route IDs. Never execute
        # NSStringFromSelector or a UIKeyCommand getter at a delivery breakpoint.
        return {"selectorAddress": hex(args[2]), "target": hex(args[3]),
                "sender": hex(args[4]), "event": hex(args[5])}
    if probe == "keyboard.precommand" and probe in verified_returns:
        return {"keyCommand": hex(args[2]), "beforePublicKeyCommands": bool(args[4] & 0xff)}
    return {}


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
    expire_returns(frame)
    if len(s["returns"]) >= MAX_RETURNS:
        raise ValueError("32 pending returns; return not observed (see inventory)")
    stack_register, _, pop_bytes = return_abi(s["triple"])
    # The unwinder gives a code address without arm64e pointer authentication bits.
    caller = frame.GetThread().GetFrameAtIndex(1)
    if not caller.IsValid() or caller.GetPC() in (0, lldb.LLDB_INVALID_ADDRESS):
        raise ValueError("Caller PC unavailable; return is unobserved")
    expected_sp = read_register(frame, stack_register) + pop_bytes
    thread_id = frame.GetThread().GetThreadID()
    for identifier, pending in list(s["returns"].items()):
        if pending["thread"] == thread_id and pending["expectedSP"] == expected_sp:
            discard_return(identifier, "stack-slot-reused")
    bp = s["target"].BreakpointCreateByAddress(caller.GetPC())
    if not bp.IsValid() or bp.GetNumResolvedLocations() == 0:
        s["target"].BreakpointDelete(bp.GetID())
        raise ValueError("Return breakpoint did not resolve")
    s["returns"][bp.GetID()] = {"probe": probe, "callSequence": call_id,
                                "expectedSP": expected_sp, "receiver": receiver,
                                "thread": thread_id, "returnPC": caller.GetPC(),
                                "armedAt": time.monotonic()}
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


def discard_return(identifier, reason):
    pending = _session["returns"].pop(identifier)
    _session["target"].BreakpointDelete(identifier)
    _session["discardedReturns"] = _session.get("discardedReturns", 0) + 1
    write({"kind": "return-unobserved", **pending, "reason": reason})


def expire_returns(frame=None):
    now = time.monotonic()
    for identifier, pending in list(_session.get("returns", {}).items()):
        if now - pending.get("armedAt", now) > RETURN_TTL_SECONDS:
            discard_return(identifier, "expired")
        elif frame is not None and frame.GetThread().GetThreadID() == pending["thread"]:
            stack_register, _, _ = return_abi(_session["triple"])
            if read_register(frame, stack_register) > pending["expectedSP"]:
                discard_return(identifier, "stack-unwound")


def focus(debugger, command, result, internal_dict):
    if _session is None or not _session["details"]:
        result.SetError("Start with --details to allow an explicit paused snapshot")
        return
    try:
        if not re.fullmatch(r"0x[0-9a-fA-F]+", command.strip()):
            raise ValueError("Usage: ham175-focus 0xWKContentViewAddress (from hit arguments[0])")
        process = _session["target"].GetProcess()
        if process.GetState() != lldb.eStateStopped:
            raise ValueError("Pause before taking a snapshot; do not call during HID delivery")
        frame = process.GetSelectedThread().GetFrameAtIndex(0)
        data = evaluate_json(frame, focus_body(int(command.strip(), 16)))
        write({"kind": "focus-snapshot", "receiver": command.strip(), "focus": data})
        result.AppendMessage(json.dumps(data, ensure_ascii=False))
    except Exception as error:
        _session["errors"] += 1
        write({"kind": "focus-error", "error": str(error)})
        result.SetError(str(error))


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
    configured = s["owned"][bp_loc.GetBreakpoint().GetID()]
    probe = configured["probe"]
    point = frame.GetFunctionName() or ""
    entry = {"kind": "hit", "probe": probe, "point": point,
             "thread": frame.GetThread().GetThreadID(), "pc": hex(frame.GetPC())}
    if frame.IsInlined() or not re.search(configured["pattern"], point) or frame.GetPC() != configured["pc"]:
        s["errors"] += 1
        write({**entry, "kind": "entry-rejected", "error": "Not the requested physical function entry"})
        return False
    args = None
    try:
        expire_returns(frame)
        args = arguments(frame, s["triple"])
        entry["arguments"] = [hex(value) for value in args]
        entry["stack"] = [
            {"pc": hex(f.GetPC()), "function": f.GetFunctionName(),
             "module": f.GetModule().GetFileSpec().GetFilename()}
            for f in list(frame.GetThread())[:12]
        ]
    except Exception as error:
        s["errors"] += 1
        entry["error"] = str(error)
    # Completion's handled argument is available even if getter compilation fails.
    if probe == "webkit.completion" and args is not None:
        entry["handled"] = bool(args[3] & 0xff)
    if args is not None:
        entry.update(routing_arguments(probe, args, s.get("verifiedReturns", set())))
    call_id = write(entry)
    if args is not None and (probe in BOOL_RETURNS or probe in s.get("verifiedReturns", set())
                             or (probe == "application.action" and s["role"] == "escape")):
        try:
            arm_return(frame, probe, call_id, args[0])
        except Exception as error:
            s["errors"] += 1
            write({"kind": "return-unavailable", "probe": probe,
                   "callSequence": call_id, "error": str(error)})
    return False  # Observe and resume; never consume or forward the input.


def physical_entry(address, target, pattern):
    # Regex discovery includes inlined instances. Never relocate those to an
    # unrelated enclosing function and then decode its arguments/return ABI.
    function, symbol = address.GetFunction(), address.GetSymbol()
    owner = function if function.IsValid() else symbol
    name = owner.GetName() if owner.IsValid() else ""
    if not name or not re.search(pattern, name):
        return None, {"function": name, "reason": "enclosing-function-mismatch"}
    start = owner.GetStartAddress()
    if start.GetLoadAddress(target) == lldb.LLDB_INVALID_ADDRESS:
        return None, {"function": name, "reason": "unloaded-entry"}
    return start, None


def install(target, role):
    inventory = []
    for probe, pattern in PROBES[role]:
        if probe in VERBOSE_PROBES and not _session.get("verbose", False):
            inventory.append({"probe": probe, "pattern": pattern, "breakpoints": [], "coverage": "disabled"})
            continue
        # Use regex for discovery, then break at the actual symbol entry so ABI
        # argument registers have not been overwritten by a function prologue.
        discovery = target.BreakpointCreateByRegex(pattern)
        discovery.SetEnabled(False)
        addresses = {}
        rejected = []
        try:
            for location in discovery:
                start, rejection = physical_entry(location.GetAddress(), target, pattern)
                if rejection:
                    rejected.append(rejection)
                else:
                    addresses[start.GetLoadAddress(target)] = start
        finally:
            target.BreakpointDelete(discovery.GetID())
        ids = []
        return_metadata = {}
        if probe == "keyboard.precommand" and addresses:
            try:
                encoding = precommand_encoding(target)
                verified = precommand_bool_abi(encoding)
                return_metadata = {"encoding": encoding, "returnCoverage": "verified" if verified else "unavailable"}
                if verified:
                    _session.setdefault("verifiedReturns", set()).add(probe)
            except Exception as error:
                return_metadata = {"returnCoverage": "unavailable", "encodingError": str(error)}
        for start in addresses.values():
            bp = target.BreakpointCreateBySBAddress(start)
            _session["owned"][bp.GetID()] = {"probe": probe, "pattern": pattern, "pc": start.GetLoadAddress(target)}
            bp.SetScriptCallbackFunction(__name__ + ".observe")
            ids.append(bp.GetID())
        inventory.append({"probe": probe, "pattern": pattern, "breakpoints": ids,
                          "coverage": "resolved" if ids else "unavailable", "rejected": rejected,
                          **return_metadata})
    return inventory


def status(debugger, command, result, internal_dict):
    if _session is None:
        result.SetError("No active HAM-175 trace")
        return
    expire_returns()
    rows = []
    for item in _session["inventory"]:
        bps = [_session["target"].FindBreakpointByID(i) for i in item["breakpoints"]]
        rows.append({**item, "locations": sum(b.GetNumResolvedLocations() for b in bps),
                     "hits": sum(b.GetHitCount() for b in bps)})
    record = {"kind": "inventory", "probes": rows, "errors": _session["errors"],
              "pendingReturns": list(_session.get("returns", {}).values()),
              "discardedReturns": _session.get("discardedReturns", 0)}
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
    parser.add_argument("--details", action="store_true", help="Allow manual paused focus snapshots only")
    parser.add_argument("--verbose", action="store_true", help="Enable hot getter/keyCommands entry probes")
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
                    "triple": triple, "details": args.details, "verbose": args.verbose, "file": log,
                    "owned": {}, "returns": {}, "sequence": 0, "errors": 0, "inventory": []}
        write({"kind": "start", "triple": triple, "details": args.details, "verbose": args.verbose,
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
        for identifier in list(_session["returns"]):
            discard_return(identifier, "trace-stopped")
        write({"kind": "stop"})
    finally:
        cleanup()  # Only our breakpoints; leave other debugger work intact.


def __lldb_init_module(debugger, internal_dict):
    for name, function in (("start", start), ("status", status), ("mark", mark), ("focus", focus), ("stop", stop)):
        debugger.HandleCommand(f"command script add -f {__name__}.{function.__name__} ham175-{name}")
    print("HAM-175 commands registered; no probes enabled. Use ham175-start explicitly.")
