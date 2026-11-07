"""Host-side checks for trace integrity. These do not execute LLDB or UIKit."""

import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location("trace_keyboard", Path(__file__).with_name("trace_keyboard.py"))
trace = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"lldb": types.SimpleNamespace(LLDB_INVALID_ADDRESS=2**64 - 1)}):
    spec.loader.exec_module(trace)


class KeyboardTraceTests(unittest.TestCase):
    def tearDown(self):
        trace.cleanup()

    def test_decodes_both_simulator_abis_and_rejects_unknown_arch(self):
        for triple, names in (("arm64-apple-ios", ["x0", "x1", "x2", "x3", "x4", "x5"]),
                              ("x86_64-apple-ios", ["rdi", "rsi", "rdx", "rcx", "r8", "r9"])):
            frame = Mock()
            values = {}
            for i, name in enumerate(names):
                value = Mock()
                value.IsValid.return_value = True
                value.GetError.return_value.Fail.return_value = False
                value.GetValueAsUnsigned.return_value = 10 + i
                values[name] = value
            frame.FindRegister.side_effect = values.__getitem__
            self.assertEqual(trace.arguments(frame, triple), list(range(10, 16)))
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            trace.arguments(Mock(), "riscv64-unknown-linux")

    def test_missing_register_is_error_not_null_event(self):
        frame = Mock()
        frame.FindRegister.return_value.IsValid.return_value = False
        with self.assertRaisesRegex(ValueError, "Unreadable"):
            trace.arguments(frame, "arm64-apple-ios")

    def test_objc_categories_and_inherited_press_methods_are_included(self):
        probes = dict(trace.PROBES["app"])
        for point in ("-[WKContentView pressesBegan:withEvent:]",
                      "-[WKContentView(WKInteraction) pressesEnded:withEvent:]",
                      "-[UIResponder pressesBegan:withEvent:]"):
            self.assertRegex(point, probes["responder.presses"])
        self.assertRegex("-[WKContentView(WKInteraction) handleKeyWebEvent:withCompletionHandler:]", probes["webkit.entry"])
        self.assertRegex("-[WKContentView(BETextInput) handleKeyEntry:withCompletionHandler:]", probes["webkit.entry"])
        self.assertRegex("-[OtherResponder keyCommands]", probes["responder.commands"])
        self.assertIsNone(re.search(probes["proxy.send"], "WTF::Wrapper<WebKit::WebPageProxy::sendKeyEvent()>::call()"))

    def test_escape_inventory_separates_ime_precommand_dispatch_and_wk_consumption(self):
        probes = dict(trace.PROBES["escape"])
        self.assertRegex("-[UIKeyboardImpl handleKeyCommand:repeatOkay:beforePublicKeyCommands:]", probes["keyboard.precommand"])
        self.assertRegex("-[UIApplication sendAction:to:from:forEvent:]", probes["application.action"])
        self.assertRegex("-[WKContentView(WKInteraction) _tryToHandlePressesEvent:]", probes["webkit.presses"])
        self.assertNotIn("responder.commands", probes)
        self.assertNotIn("page.active", probes)

    def test_private_ime_abi_must_match_before_interpreting_consumption(self):
        for encoding in ("B36@0:8@16^B24B32", "c36@0:8@16^c24c32"):
            self.assertTrue(trace.precommand_bool_abi(encoding))
        for encoding in ("", "v36@0:8@16^B24B32", "B32@0:8@16@24", "@36@0:8@16^B24B32"):
            self.assertFalse(trace.precommand_bool_abi(encoding))
        args = [10, 20, 30, 40, 0x101, 60]
        self.assertEqual(trace.routing_arguments("keyboard.precommand", args, set()), {})
        self.assertEqual(trace.routing_arguments("keyboard.precommand", args, {"keyboard.precommand"}),
                         {"keyCommand": "0x1e", "beforePublicKeyCommands": True})

    def test_dispatch_identity_uses_sender_target_and_event_not_query_counts(self):
        args = [10, 20, 30, 40, 50, 60]
        self.assertEqual(trace.routing_arguments("application.action", args, set()),
                         {"selectorAddress": "0x1e", "target": "0x28", "sender": "0x32", "event": "0x3c"})

    def test_void_private_method_stays_entry_only_even_when_symbol_resolves(self):
        target, discovery, location, start = Mock(), Mock(), Mock(), Mock()
        point = "-[UIKeyboardImpl handleKeyCommand:repeatOkay:beforePublicKeyCommands:]"
        address = location.GetAddress.return_value
        address.GetFunction.return_value.IsValid.return_value = True
        address.GetFunction.return_value.GetName.return_value = point
        address.GetFunction.return_value.GetStartAddress.return_value = start
        start.GetLoadAddress.return_value = 4096
        discovery.__iter__ = Mock(side_effect=lambda: iter([location]))
        target.BreakpointCreateByRegex.return_value = discovery
        target.BreakpointCreateBySBAddress.return_value.GetID.return_value = 10
        trace._session = {"target": target, "owned": {}, "file": io.StringIO()}
        probe = [("keyboard.precommand", re.escape(point))]
        with patch.dict(trace.PROBES, {"abi-test": probe}), \
                patch.object(trace, "precommand_encoding", return_value="v36@0:8@16^B24B32"):
            rows = trace.install(target, "abi-test")
        self.assertEqual(rows[0]["coverage"], "resolved")
        self.assertEqual(rows[0]["returnCoverage"], "unavailable")
        self.assertNotIn("keyboard.precommand", trace._session.get("verifiedReturns", set()))

    def test_unresolved_symbols_are_unavailable_not_zero_hit_success(self):
        target = Mock()
        discovery = Mock()
        discovery.__iter__ = Mock(return_value=iter([]))
        target.BreakpointCreateByRegex.return_value = discovery
        trace._session = {"target": target, "owned": {}, "file": io.StringIO()}
        rows = trace.install(target, "webcontent")
        self.assertTrue(all(r["coverage"] == "unavailable" for r in rows))
        self.assertTrue(all(r["breakpoints"] == [] for r in rows))
        target.BreakpointCreateBySBAddress.assert_not_called()
        self.assertEqual(target.BreakpointDelete.call_count, len(rows))

    def test_breaks_at_function_entry_not_after_prologue(self):
        target, discovery, location, start = Mock(), Mock(), Mock(), Mock()
        address = location.GetAddress.return_value
        address.GetFunction.return_value.IsValid.return_value = True
        address.GetFunction.return_value.GetName.return_value = "pattern"
        address.GetFunction.return_value.GetStartAddress.return_value = start
        start.GetLoadAddress.return_value = 4096
        discovery.__iter__ = Mock(return_value=iter([location, location]))
        target.BreakpointCreateByRegex.return_value = discovery
        target.BreakpointCreateBySBAddress.return_value.GetID.return_value = 10
        trace._session = {"target": target, "owned": {}, "file": io.StringIO()}
        with patch.dict(trace.PROBES, {"entry-test": [("probe", "pattern")]}):
            rows = trace.install(target, "entry-test")
        target.BreakpointCreateBySBAddress.assert_called_once_with(start)
        self.assertEqual(rows[0]["coverage"], "resolved")
        self.assertEqual(trace._session["owned"], {10: {"probe": "probe", "pattern": "pattern", "pc": 4096}})

    def test_cleanup_deletes_only_owned_breakpoints(self):
        target, log = Mock(), io.StringIO()
        trace._session = {"target": target, "owned": {4: "app", 9: "proxy"}, "file": log}
        trace.cleanup()
        self.assertEqual([c.args[0] for c in target.BreakpointDelete.call_args_list], [4, 9])
        target.DeleteAllBreakpoints.assert_not_called()
        self.assertTrue(log.closed)
        self.assertIsNone(trace._session)

    def test_details_does_not_run_getters_inside_keyboard_delivery(self):
        target, log = Mock(), io.StringIO()
        trace._session = {"target": target, "owned": {1: {"probe": "webkit.entry", "pattern": "WKContentView", "pc": 4096}}, "file": log,
                          "details": True, "triple": "arm64-apple-ios", "errors": 0,
                          "sequence": 0, "pid": 123, "role": "app"}
        frame, location = Mock(), Mock()
        location.GetBreakpoint.return_value.GetID.return_value = 1
        frame.GetFunctionName.return_value = "-[WKContentView handleKeyWebEvent:]"
        frame.GetPC.return_value = 4096
        frame.IsInlined.return_value = False
        thread = Mock()
        thread.GetThreadID.return_value = 12
        thread.GetProcess.return_value.GetProcessID.return_value = 123
        thread.__iter__ = Mock(return_value=iter([]))
        frame.GetThread.return_value = thread
        with patch.object(trace, "arguments", return_value=[1, 2, 3, 4, 5, 6]), \
                patch.object(trace, "evaluate_json", side_effect=AssertionError("getter during key")) as evaluate:
            self.assertFalse(trace.observe(frame, location, {}))
        entry = json.loads(log.getvalue())
        self.assertEqual(entry["kind"], "hit")
        evaluate.assert_not_called()
        self.assertNotIn("error", entry)
        self.assertEqual(entry["pid"], 123)
        self.assertEqual(trace._session["errors"], 0)
        self.assertNotIn("details", entry)

    def test_restarted_process_cannot_silently_reuse_old_identity(self):
        target, log = Mock(), io.StringIO()
        trace._session = {"target": target, "owned": {1: "application.dispatch"}, "file": log,
                          "errors": 0, "sequence": 0, "pid": 123, "role": "app"}
        frame = Mock()
        frame.GetThread.return_value.GetProcess.return_value.GetProcessID.return_value = 456
        self.assertFalse(trace.observe(frame, Mock(), {}))
        entry = json.loads(log.getvalue())
        self.assertEqual(entry["kind"], "process-changed")
        self.assertEqual(entry["actualPid"], 456)
        target.FindBreakpointByID.return_value.SetEnabled.assert_called_once_with(False)

    def test_getter_expression_avoids_reported_apple_symbol_and_return_type_errors(self):
        points = ["-[UIApplication sendEvent:]", "-[UIApplication sendAction:to:from:forEvent:]",
                  "-[WKContentView _tryToHandlePressesEvent:]",
                  "-[WKContentView _didHandleKeyEvent:eventWasHandled:]"]
        bodies = [trace.detail_body(p, [1, 2, 3, 4, 5, 6]) for p in points]
        bodies.append(trace.focus_body(1))
        for body in bodies:
            expression = trace.json_expression(body)
            self.assertNotRegex(expression, r"\b(?:d|key|event|receiver|sender|target|press|chain)\s*=")
            self.assertNotRegex(expression, r"if\s*\(\s*\[.*respondsToSelector:")
            self.assertNotRegex(expression, r"NSStringFromClass\(\[")
            self.assertIn("ham175_trace_record", expression)

    def return_session(self, triple="arm64-apple-ios"):
        target, log, frame, location = Mock(), io.StringIO(), Mock(), Mock()
        trace._session = {"target": target, "file": log, "returns": {}, "owned": {},
                          "details": False, "triple": triple, "errors": 0,
                          "sequence": 0, "pid": 123, "role": "app"}
        thread = frame.GetThread.return_value
        thread.GetThreadID.return_value = 12
        thread.GetProcess.return_value.GetProcessID.return_value = 123
        thread.GetFrameAtIndex.return_value.IsValid.return_value = True
        thread.GetFrameAtIndex.return_value.GetPC.return_value = 8192
        target.BreakpointCreateByAddress.return_value.GetID.return_value = 20
        target.BreakpointCreateByAddress.return_value.GetNumResolvedLocations.return_value = 1
        location.GetBreakpoint.return_value.GetID.return_value = 20
        return target, log, frame, location

    def test_return_uses_unwound_caller_pc_and_x86_ret_stack_adjustment(self):
        for triple, expected_sp in [("arm64e-apple-ios", 4096), ("x86_64-apple-ios", 4104)]:
            target, _, frame, _ = self.return_session(triple)
            with patch.object(trace, "read_register", return_value=4096):
                trace.arm_return(frame, "webkit.presses", 7, 99)
            target.BreakpointCreateByAddress.assert_called_once_with(8192)
            self.assertEqual(trace._session["returns"][20]["expectedSP"], expected_sp)
            target.BreakpointCreateByAddress.return_value.SetThreadID.assert_called_once_with(12)
            trace.cleanup()

    def test_recursive_or_other_thread_return_does_not_consume_outer_call(self):
        target, log, frame, location = self.return_session()
        trace._session["returns"][20] = {"probe": "webkit.presses", "callSequence": 7,
                                         "expectedSP": 4096, "receiver": 99, "thread": 12}
        with patch.object(trace, "read_register", return_value=4000):
            self.assertFalse(trace.observe_return(frame, location, {}))
        frame.GetThread.return_value.GetThreadID.return_value = 13
        with patch.object(trace, "read_register", return_value=4096):
            self.assertFalse(trace.observe_return(frame, location, {}))
        self.assertIn(20, trace._session["returns"])
        self.assertEqual(log.getvalue(), "")
        target.BreakpointDelete.assert_not_called()

    def test_boolean_return_preserves_call_identity_and_only_uses_low_byte(self):
        for raw, expected in [(0x100, False), (0x101, True)]:
            target, log, frame, location = self.return_session()
            trace._session["returns"][20] = {"probe": "webkit.presses", "callSequence": 7,
                                             "expectedSP": 4096, "receiver": 99, "thread": 12}
            with patch.object(trace, "read_register", side_effect=[4096, raw]):
                self.assertFalse(trace.observe_return(frame, location, {}))
            event = json.loads(log.getvalue())
            self.assertIs(event["value"], expected)
            self.assertEqual(event["callSequence"], 7)
            self.assertEqual(trace._session["returns"], {})
            target.BreakpointDelete.assert_called_once_with(20)
            trace.cleanup()

    def test_unreadable_return_is_an_error_not_a_false_return(self):
        _, log, frame, location = self.return_session()
        trace._session["returns"][20] = {"probe": "webkit.presses", "callSequence": 7,
                                         "expectedSP": 4096, "receiver": 99, "thread": 12}
        with patch.object(trace, "read_register", side_effect=[4096, ValueError("no result register")]):
            self.assertFalse(trace.observe_return(frame, location, {}))
        event = json.loads(log.getvalue())
        self.assertNotIn("value", event)
        self.assertIn("error", event)

    def test_cleanup_includes_pending_return_breakpoints(self):
        target, _, _, _ = self.return_session()
        trace._session["owned"] = {1: "application.dispatch"}
        trace._session["returns"] = {20: {"probe": "webkit.presses"}}
        trace.cleanup()
        self.assertEqual([c.args[0] for c in target.BreakpointDelete.call_args_list], [1, 20])


    def test_inline_discovery_never_moves_a_probe_to_an_unrelated_caller(self):
        address, target = Mock(), Mock()
        function = address.GetFunction.return_value
        function.IsValid.return_value = True
        for name in ("WebKit::WebPageProxy::updateActivityState()",
                     "WebKit::PageClientImpl::setCursor()",
                     "WebKit::WebPageProxy::updateBackingStoreDiscardableState()"):
            function.GetName.return_value = name
            start, rejection = trace.physical_entry(address, target, r"^WebKit::PageClientImpl::isViewFocused")
            self.assertIsNone(start)
            self.assertEqual(rejection["reason"], "enclosing-function-mismatch")
        function.GetStartAddress.assert_not_called()

    def test_wrong_entry_hit_is_rejected_before_reading_registers(self):
        _, log, frame, location = self.return_session()
        trace._session["owned"][20] = {"probe": "page.active", "pattern": "isViewWindowActive", "pc": 4096}
        frame.GetFunctionName.return_value = "WebKit::WebPageProxy::updateActivityState()"
        frame.GetPC.return_value = 4096
        frame.IsInlined.return_value = False
        with patch.object(trace, "arguments") as arguments:
            trace.observe(frame, location, {})
        arguments.assert_not_called()
        self.assertEqual(json.loads(log.getvalue())["kind"], "entry-rejected")
        self.assertEqual(trace._session["returns"], {})

    def test_stale_and_unwound_returns_are_logged_as_unobserved_and_removed(self):
        target, log, frame, _ = self.return_session()
        trace._session["returns"][20] = {"probe": "webkit.presses", "callSequence": 1,
            "thread": 12, "expectedSP": 4096, "armedAt": 0}
        with patch.object(trace.time, "monotonic", return_value=10):
            trace.expire_returns()
        self.assertEqual(json.loads(log.getvalue())["reason"], "expired")
        self.assertEqual(trace._session["discardedReturns"], 1)
        self.assertEqual(trace._session["returns"], {})
        target.BreakpointDelete.assert_called_once_with(20)
        log.seek(0)
        log.truncate()
        trace._session["returns"][21] = {"probe": "webkit.presses", "callSequence": 2,
            "thread": 12, "expectedSP": 4096}
        with patch.object(trace, "read_register", return_value=4104):
            trace.expire_returns(frame)
        self.assertEqual(json.loads(log.getvalue())["reason"], "stack-unwound")
        self.assertEqual(trace._session["returns"], {})

    def test_reused_stack_slot_does_not_accumulate_return_breakpoints(self):
        target, log, frame, _ = self.return_session()
        trace._session["returns"][19] = {"probe": "webkit.presses", "callSequence": 1,
            "thread": 12, "expectedSP": 4096}
        with patch.object(trace, "read_register", return_value=4096):
            trace.arm_return(frame, "webkit.presses", 2, 99)
        self.assertEqual(list(trace._session["returns"]), [20])
        self.assertEqual(json.loads(log.getvalue())["reason"], "stack-slot-reused")
        target.BreakpointDelete.assert_called_once_with(19)


if __name__ == "__main__":
    unittest.main()
