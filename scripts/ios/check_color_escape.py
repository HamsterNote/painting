"""Check one real HID color Escape against unchanged Mac observer artifacts.

This is an additional diagnostic, never a replacement for matrix.py/isTrusted.
It reads route-*-before/after-state.json, route-*-after.json and unified log NDJSON.
No simulator control, event injection, observer installation or artifact rewriting.
"""

import argparse
import datetime
import json
from pathlib import Path
import re


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def read_native(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        if not line.startswith("{"):
            continue  # log stream's human-readable preamble
        row = json.loads(line)
        message = row.get("eventMessage", "")
        data = None
        if "[HAM175 command-route] " in message:
            kind = "route"
            data = json.loads(message.split("[HAM175 command-route] ", 1)[1])
        elif "[HAM175 keyboard] payload=" in message:
            kind = "delivery"
            data, _ = json.JSONDecoder().raw_decode(message.split("payload=", 1)[1])
            data["accepted"] = "accepted=Optional(1) error=nil" in message
        elif "[HAM175 color-route] " in message:
            kind = "gate"
            match = re.search(r"scope=(\S*) language=(\S+) marked=(.*?) escapeBridge=(true|false)", message)
            if not match:
                raise ValueError("Unrecognized color-route record")
            scope, language, marked, enabled = match.groups()
            data = {"scope": scope, "language": language,
                    "marked": {"Optional(true)": True, "Optional(false)": False}.get(marked),
                    "escapeBridge": enabled == "true"}
        if data is not None:
            rows.append({"at": timestamp(row["timestamp"]), "kind": kind, "data": data})
    return sorted(rows, key=lambda row: row["at"])


def check(before, after, events, native, expected):
    start, end = timestamp(before["at"]), timestamp(after["at"])
    if end <= start:
        raise ValueError("Reversed/empty observation window")
    state = before["bridge"]
    scope = state["scope"]
    interval = [r for r in native if start <= r["at"] <= end]
    route = [r["data"] for r in interval if r["kind"] == "route"]
    dom = [e for e in events if start <= timestamp(e["at"]) <= end]
    keys = [e for e in dom if e["type"] == "keydown" and e.get("key") == "Escape"]
    deliveries = [r["data"] for r in interval
                  if r["kind"] == "delivery" and r["data"].get("key") == "Escape"]
    gates = [r["data"] for r in native if r["kind"] == "gate"
             and r["data"]["scope"] == scope and r["at"] <= end]
    gate = gates[-1] if gates else {}
    phases = [r["stage"] for r in route]
    precondition = (before["active"].get("label") == "颜色"
                    and before["active"].get("type") == "text"
                    and before["active"].get("panel") is not None
                    and before["visibility"] == "visible" and before["hasFocus"])
    closed = (after["active"].get("label") == "设置"
              and not any(c.get("panel") for c in after["controls"]))
    if expected == "composing":
        precondition = precondition and state["composingConnected"] and not scope and not state["acknowledgedScope"]
        passed = (precondition and not deliveries and not keys
                  and any(e["type"] == "compositionend" and e["isTrusted"] for e in dom)
                  and after["active"].get("label") == "颜色" and not closed
                  and not after["bridge"]["composingConnected"]
                  and bool(after["bridge"]["scope"])
                  and after["bridge"]["scope"] == after["bridge"]["acknowledgedScope"])
        boundary = "composition-cancelled-with-DOM-scope-disabled" if passed else "composition-failed"
    else:
        precondition = (precondition and bool(scope) and scope == state["acknowledgedScope"]
                        and state["tabOnly"] and state["acknowledgedTabOnly"] and not state["composingConnected"])
        if expected == "pinyin":
            precondition = (precondition and gate.get("language", "").startswith("zh")
                            and gate.get("marked") is False and gate.get("escapeBridge") is True)
            bridged = (len(deliveries) == 1 and len(keys) == 1
                       and deliveries[0].get("scope") == scope and deliveries[0].get("colorEscape") is True
                       and deliveries[0].get("inputLanguage", "").startswith("zh")
                       and deliveries[0].get("markedText") == "false"
                       and deliveries[0].get("accepted") is True and keys[0]["isTrusted"] is False)
            trusted = not deliveries and len(keys) == 1 and keys[0]["isTrusted"] is True
            passed = precondition and closed and (bridged or trusted)
            boundary = ("trusted-WebKit" if trusted else "bridged-behavior-only") if passed else "gate-open-no-delivery"
            if not passed and deliveries:
                boundary = "delivery-or-DOM-behavior-failed"
            elif not passed and "action-enter" in phases:
                boundary = "action-entered-no-delivery"
        else:
            precondition = precondition and gate.get("language", "").startswith("en") and gate.get("escapeBridge") is False
            passed = precondition and not deliveries and len(keys) == 1 and keys[0]["isTrusted"] is True and closed
            boundary = "trusted-WebKit" if passed else "english-control-failed"
    if not precondition:
        boundary = "invalid-precondition"
    overflow = any(r["kind"] == "route" and r["data"]["stage"] == "overflow" and r["at"] <= end for r in native)
    return {"behaviorPass": bool(passed), "boundary": boundary,
            "precondition": bool(precondition), "gate": gate,
            "nativeDeliveries": len(deliveries), "DOMKeys": len(keys),
            "isTrusted": [e["isTrusted"] for e in keys], "routeStages": phases,
            "route": route, "traceOverflow": overflow,
            "note": "Absence of route stages is not proof that UIKit skipped them; trace must be enabled and complete."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--prefix", required=True, help="e.g. route-default-pinyin-idle")
    parser.add_argument("--native", type=Path, required=True, help="raw log stream NDJSON, not a filtered summary")
    parser.add_argument("--expect", choices=["pinyin", "composing", "english"], required=True)
    args = parser.parse_args()
    read = lambda suffix: json.loads((args.evidence / (args.prefix + suffix + ".json")).read_text())
    result = check(read("-before-state"), read("-after-state"),
                   read("-after")["observation"]["events"], read_native(args.native), args.expect)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["behaviorPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
