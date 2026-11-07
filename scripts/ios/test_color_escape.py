"""Offline evidence checks, NOT a UIKit/Chinese keyboard execution test."""

import copy
import json
from pathlib import Path
import tempfile
import unittest

from check_color_escape import check, read_native, timestamp


class ColorEscapeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads((Path(__file__).parent / "fixtures/color-escape-96625b6.json").read_text())["cases"]
        self.case = self.cases[0]

    def result(self, case=None):
        c = case or self.case
        return check(c["before"], c["after"], c["events"], c["native"], c["expected"])

    def test_real_pinyin_gate_open_without_action_or_dom_is_failure(self):
        result = self.result()
        self.assertTrue(result["precondition"])
        self.assertFalse(result["behaviorPass"])
        self.assertEqual(result["boundary"], "gate-open-no-delivery")
        self.assertEqual(result["nativeDeliveries"], 0)
        self.assertEqual(result["DOMKeys"], 0)

    def test_query_validation_and_resolved_target_are_not_delivery(self):
        at = timestamp(self.case["before"]["at"]) + .1
        for stage in ("commands", "validate", "target"):
            self.case["native"].append({"at": at, "kind": "route", "data": {"stage": stage, "allowed": True}})
        result = self.result()
        self.assertFalse(result["behaviorPass"])
        self.assertEqual(result["boundary"], "gate-open-no-delivery")

    def test_action_entry_with_guard_rejection_is_a_different_failure(self):
        self.case["native"].append({"at": timestamp(self.case["before"]["at"]) + .1,
                                    "kind": "route", "data": {"stage": "action-enter"}})
        self.assertEqual(self.result()["boundary"], "action-entered-no-delivery")

    def test_english_cannot_substitute_for_pinyin(self):
        self.case["native"][-1]["data"]["language"] = "en-US"
        self.assertEqual(self.result()["boundary"], "invalid-precondition")

    def test_real_composition_disables_dom_scope_before_the_key(self):
        result = self.result(self.cases[1])
        self.assertTrue(result["behaviorPass"])
        self.assertEqual(result["boundary"], "composition-cancelled-with-DOM-scope-disabled")
        # This success says nothing about the Swift marked-text gate.
        self.assertEqual(result["gate"], {})

    def test_reopening_or_untrusted_event_alone_does_not_pass(self):
        self.case["after"]["active"] = {"label": "设置"}
        self.case["after"]["controls"] = []
        self.assertFalse(self.result()["behaviorPass"])
        self.case["events"].append({"at": self.case["after"]["at"], "type": "keydown",
                                    "key": "Escape", "isTrusted": False})
        self.assertFalse(self.result()["behaviorPass"])

    def test_one_real_bridge_delivery_is_behavior_only_and_duplicates_fail(self):
        c = self.case
        c["after"]["active"] = {"label": "设置"}
        c["after"]["controls"] = []
        c["events"] = [{"at": c["after"]["at"], "type": "keydown", "key": "Escape", "isTrusted": False}]
        c["native"].append({"at": timestamp(c["after"]["at"]), "kind": "delivery", "data": {
            "scope": c["before"]["bridge"]["scope"], "key": "Escape", "colorEscape": True,
            "inputLanguage": "zh-Hans", "markedText": "false", "accepted": True}})
        self.assertTrue(self.result()["behaviorPass"])
        self.assertEqual(self.result()["boundary"], "bridged-behavior-only")
        c["events"].append(copy.deepcopy(c["events"][0]))
        self.assertFalse(self.result()["behaviorPass"])

    def test_raw_native_parser_keeps_stages_and_reports_overflow(self):
        row = {"timestamp": self.case["before"]["at"], "eventMessage":
               '[HAM175 command-route] {"stage":"overflow","traceSequence":4097}'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "native.jsonl"
            path.write_text("Filtering logs\n" + json.dumps(row) + "\n")
            self.case["native"] += read_native(path)
        self.assertTrue(self.result()["traceOverflow"])
        self.assertFalse(self.result()["behaviorPass"])


if __name__ == "__main__":
    unittest.main()
