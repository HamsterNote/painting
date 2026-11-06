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
        self.assertEqual(trace._session["owned"], {10: "probe"})

    def test_cleanup_deletes_only_owned_breakpoints(self):
        target, log = Mock(), io.StringIO()
        trace._session = {"target": target, "owned": {4: "app", 9: "proxy"}, "file": log}
        trace.cleanup()
        self.assertEqual([c.args[0] for c in target.BreakpointDelete.call_args_list], [4, 9])
        target.DeleteAllBreakpoints.assert_not_called()
        self.assertTrue(log.closed)
        self.assertIsNone(trace._session)

    def test_expression_error_is_recorded_without_claiming_missing_event(self):
        target, log = Mock(), io.StringIO()
        trace._session = {"target": target, "owned": {1: "webkit.entry"}, "file": log,
                          "details": True, "triple": "arm64-apple-ios", "errors": 0,
                          "sequence": 0, "pid": 123, "role": "app"}
        frame, location = Mock(), Mock()
        location.GetBreakpoint.return_value.GetID.return_value = 1
        frame.GetFunctionName.return_value = "-[WKContentView handleKeyWebEvent:]"
        frame.GetPC.return_value = 4096
        thread = Mock()
        thread.GetThreadID.return_value = 12
        thread.GetProcess.return_value.GetProcessID.return_value = 123
        thread.__iter__ = Mock(return_value=iter([]))
        frame.GetThread.return_value = thread
        with patch.object(trace, "arguments", return_value=[1, 2, 3, 4, 5, 6]), \
                patch.object(trace, "details", side_effect=ValueError("getter unavailable")):
            self.assertFalse(trace.observe(frame, location, {}))
        entry = json.loads(log.getvalue())
        self.assertEqual(entry["kind"], "hit")
        self.assertEqual(entry["error"], "getter unavailable")
        self.assertEqual(entry["pid"], 123)
        self.assertEqual(trace._session["errors"], 1)
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


if __name__ == "__main__":
    unittest.main()
