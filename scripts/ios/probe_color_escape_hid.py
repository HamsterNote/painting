"""Mac-only single-key regression, using the existing HAM-175 observer unchanged.

Prepare the actual native input method and focused color field first. This script
does not select a language, set DOM focus, call the bridge or install an observer.
The raw log collector must already be running. See ios-keyboard-trace.md.
"""

import argparse
import importlib
import json
from pathlib import Path
import re
import sys
import time

from check_color_escape import check, read_native


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", type=Path, required=True, help="existing Mac harness with drive/state/inspector_adapter")
    parser.add_argument("--udid", required=True, help="must match the existing harness; never edits its target")
    parser.add_argument("--prefix", required=True, help="unique case name; refuses to overwrite captures")
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--expect", choices=["pinyin", "composing", "english"], required=True)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("Requires macOS + idb + the actual iOS app; Chromium is not a substitute")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.prefix):
        parser.error("prefix must be a simple, unique case name")
    root = args.harness.resolve()
    if list(root.glob(args.prefix + "*")):
        parser.error("case prefix already exists; check existing results instead of sending another key")
    if not args.native.is_file():
        parser.error("start the raw native log collector first")
    sys.path.insert(0, str(root))
    importlib.import_module("inspector_adapter")  # Existing transport, not an observer.
    drive = importlib.import_module("drive")
    state = importlib.import_module("state")
    if drive.udid != args.udid or drive.base.resolve() != root:
        parser.error("harness target/output does not match this run")
    if not drive.ev("Boolean(window.__ham175 && window.__paintingToolbarKeyboard)"):
        parser.error("original observer and product bridge must already be loaded")
    before = state.snapshot(args.prefix + "-before")
    bridge = before["bridge"]
    if (before["active"].get("label") != "颜色" or before["active"].get("type") != "text"
            or not before["active"].get("panel") or not before["hasFocus"]
            or before["visibility"] != "visible"):
        parser.error("prepare the focused color field before running; no key sent")
    composing = args.expect == "composing"
    if (bridge["composingConnected"] != composing
            or bool(bridge["scope"]) == composing
            or bridge["scope"] != bridge["acknowledgedScope"]):
        parser.error("DOM composition/scope precondition is not ready; no key sent")
    drive.capture(args.prefix + "-before")
    # USB HID Usage 0x29 = Escape. The original drive logs the command and status.
    drive.run(["idb", "ui", "key", "--udid", args.udid, "--duration", "0.1", "41"])
    time.sleep(.6)
    after = state.snapshot(args.prefix + "-after")
    observation = drive.capture(args.prefix + "-after")["observation"]["events"]
    result = check(before, after, observation, read_native(args.native), args.expect)
    (root / (args.prefix + "-check.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["behaviorPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
