import UIKit

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else { fatalError(message) }
}

func verifyCompleted(_ sampler: PencilkitG1Sampler, phase: String = "up") -> [[String: Any]] {
  let log = sampler.strokesLog()
  let strokes = log["strokes"] as! [[String: Any]]
  check(strokes.count == 1, "expected exactly one completed stroke")
  let stroke = strokes[0]
  let counts = stroke["counts"] as! [String: Int]
  let samples = stroke["samples"] as! [[String: Any]]
  check(counts["down"] == 1 && counts["up"] == 1, "down/up must each be exactly one")
  check(counts["total"] == samples.count, "sample count mismatch")
  check(counts["main"]! + counts["coalesced"]! == samples.count, "kind count mismatch")
  check(samples.first?["phase"] as? String == "down", "first sample must be down")
  check(samples.last?["phase"] as? String == phase, "missing terminal phase")
  check(samples.last?["kind"] as? String == "main", "terminal must come from main touch")
  check(stroke["cancelled"] as? Bool == (phase == "cancel"), "cancelled flag mismatch")
  for (seq, sample) in samples.enumerated() {
    check(sample["seq"] as? Int == seq, "sequence is not contiguous")
  }
  return samples
}

func testTerminalCoalescedOverlap() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  var callbacks = 0
  sampler.onStrokeCompleted = { _ in callbacks += 1 }
  sampler.touchesBegan([touch], in: view)
  touch.timestamp = 2
  let terminalCopy = UITouch(2)
  terminalCopy.force = 99
  sampler.touchesEnded([touch], event: UIEvent([UITouch(1.5), terminalCopy]), in: view)
  sampler.touchesEnded([touch], event: UIEvent([UITouch(2)]), in: view)
  let samples = verifyCompleted(sampler)
  check(samples.count == 3, "terminal coalesced copy should not add another sample")
  check(samples.map { $0["tabs"] as! Double } == [1000, 1500, 2000], "timestamps changed")
  check(samples.last?["p"] as? Double == 0, "terminal must use real main values")
  check(callbacks == 1, "duplicate finish must not dispatch twice")
}

func testTerminalWithPreviouslyAcceptedTimestamp() {
  for cancelled in [false, true] {
    let sampler = PencilkitG1Sampler()
    let view = UIView()
    let touch = UITouch(1)
    sampler.touchesBegan([touch], in: view)
    touch.timestamp = 2
    touch.force = 0.75
    sampler.touchesMoved([touch], event: UIEvent([UITouch(1.5), UITouch(2)]), in: view)
    touch.force = 0 // Real terminal pressure must not be copied from an earlier move.
    if cancelled {
      sampler.touchesCancelled([touch], event: UIEvent([UITouch(2)]), in: view)
    } else {
      sampler.touchesEnded([touch], event: UIEvent([UITouch(2)]), in: view)
    }
    let samples = verifyCompleted(sampler, phase: cancelled ? "cancel" : "up")
    check(samples.count == 4, "main/coalesced overlap was not deduplicated")
    check(samples.last?["p"] as? Double == 0, "real terminal zero pressure was lost")
    check(samples[1]["p"] as? Double == 0.75, "accepted move was modified")
  }
}

func testTapAndMissingCoalesced() {
  for endTimestamp in [1.0, 2.0] {
    let sampler = PencilkitG1Sampler()
    let view = UIView()
    let touch = UITouch(1)
    sampler.touchesBegan([touch], in: view)
    touch.timestamp = endTimestamp
    sampler.touchesEnded([touch], event: nil, in: view)
    let samples = verifyCompleted(sampler)
    check(samples.count == 2, "tap must keep real down and up, even at the same timestamp")
  }
}

func testOverlappingCoalescedBatches() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  sampler.touchesBegan([touch], in: view)
  touch.timestamp = 3
  sampler.touchesMoved([touch], event: UIEvent([UITouch(2), UITouch(3)]), in: view)
  touch.timestamp = 4
  sampler.touchesMoved([touch], event: UIEvent([UITouch(2), UITouch(3), UITouch(4)]), in: view)
  touch.timestamp = 5
  sampler.touchesEnded([touch], event: UIEvent([UITouch(4), UITouch(4.5), UITouch(5)]), in: view)
  let samples = verifyCompleted(sampler)
  let timestamps = samples.map { $0["tabs"] as! Double }
  check(Set(timestamps).count == samples.count, "main/coalesced samples are duplicated")
  check(timestamps == [1000, 3000, 2000, 4000, 4500, 5000], "accepted order was changed")
}

func testOverflowReservesTerminalSlot() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  sampler.touchesBegan([touch], in: view)
  touch.timestamp = 2
  sampler.touchesMoved(
    [touch], event: UIEvent((3...50_002).map { UITouch(Double($0)) }), in: view
  )
  touch.timestamp = 50_003
  sampler.touchesEnded([touch], event: nil, in: view)
  let samples = verifyCompleted(sampler)
  check(samples.count == 50_000, "sample cap changed or terminal slot was lost")
  let stroke = (sampler.strokesLog()["strokes"] as! [[String: Any]])[0]
  check(stroke["overflow"] as? Bool == true, "overflow must remain explicit")
}

func testRawPressureAndEstimatedUpdates() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  touch.force = 2
  touch.estimatedProperties = TouchProperties(rawValue: 3)
  touch.estimatedPropertiesExpectingUpdates = TouchProperties(rawValue: 4)
  sampler.touchesBegan([touch], in: view)
  sampler.estimatedPropertiesUpdated([touch])
  touch.force = 0
  sampler.estimatedPropertiesUpdated([touch])
  touch.timestamp = 2
  sampler.touchesEnded([touch], event: nil, in: view)
  let samples = verifyCompleted(sampler)
  check(samples[0]["p"] as? Double == 2, "pressure was clamped or rewritten by late update")
  check(samples[0]["est"] as? Int == 3, "estimated flags changed")
  check(samples[0]["estUpd"] as? Int == 4, "expecting-update flags changed")
  let stroke = (sampler.strokesLog()["strokes"] as! [[String: Any]])[0]
  let estimated = stroke["estimated"] as! [String: Int]
  check(estimated["lateEstimateEvents"] == 2, "late estimates must remain count-only")
}

func testPressureBeforeAndAfterPencilkit() {
  let canvas = PencilkitSamplingCanvasView()
  let sampler = PencilkitG1Sampler()
  canvas.sampler = sampler
  let touch = UITouch(1)
  touch.maximumPossibleForce = 8
  touch.force = 2
  canvas.touchesBegan([touch], with: nil)
  touch.timestamp = 2
  touch.force = 4
  canvas.forceAfterSuper = 1
  canvas.touchesMoved([touch], with: nil)
  touch.timestamp = 3
  touch.force = 0
  canvas.touchesEnded([touch], with: nil)
  let samples = verifyCompleted(sampler)
  check(samples[1]["fBeforePencilkit"] as? Double == 4, "pre-super snapshot must not retain a mutable UITouch")
  check(samples[1]["f"] as? Double == 1, "diagnostics must not change accepted force")
  check(samples[1]["p"] as? Double == 0.125, "normalization semantics changed")
  check(samples[2]["fBeforePencilkit"] as? Double == 0, "terminal pre-super zero lost")
  check(PencilkitG1Sampler.shared.strokesLog()["strokeCount"] as? Int == 0, "demo must not write the Probe sampler")
}

func testIdentityScopedPreviewRetirement() {
  var ledger = PencilkitPreviewLedger()
  ledger.activeID = 1
  ledger.usingTool = true
  ledger.finishedIDs = [1]
  ledger.retireIDs = [1]
  check(ledger.reconcile(strokeCount: 1) == nil, "must not mutate an active PKDrawing")
  ledger.finishTool()
  let first = ledger.reconcile(strokeCount: 1)!
  check(first.ids == [1] && first.keepIndices.isEmpty, "retirement did not match finished ID")
  ledger.activeID = 2
  ledger.finishTool() // Native tool-finish can precede the raw-end callback.
  check(ledger.reconcile(strokeCount: 1)!.ids.isEmpty, "tool-finish alone must not retire")
  ledger.finishedIDs = [2]
  _ = ledger.reconcile(strokeCount: 1)
  ledger.activeID = 3
  ledger.finishTool()
  ledger.finishedIDs = [3]
  _ = ledger.reconcile(strokeCount: 2)
  ledger.retireIDs = [2]
  let second = ledger.reconcile(strokeCount: 2)!
  check(second.ids == [2] && second.keepIndices == [1], "old ACK cleared a subsequent stroke")
  check(ledger.reconcile(strokeCount: 1)!.ids.isEmpty, "duplicate retirement ACK")
}

func testCancelledEmptyPreviewCannotConsumeNextStroke() {
  var ledger = PencilkitPreviewLedger()
  ledger.activeID = 1
  ledger.finishTool()
  ledger.finishedIDs = [1]
  ledger.cancelledIDs = [1]
  check(ledger.reconcile(strokeCount: 0)!.ids.isEmpty, "cancellation is not a retirement request")
  ledger.retireIDs = [1]
  check(ledger.reconcile(strokeCount: 0)!.ids == [1], "empty cancelled preview was not acknowledged")
  ledger.activeID = 2
  ledger.finishTool()
  ledger.finishedIDs = [2]
  _ = ledger.reconcile(strokeCount: 1)
  ledger.retireIDs = [2]
  check(ledger.reconcile(strokeCount: 1)!.ids == [2], "cancelled ID consumed the next preview")
}

func testProtocolCancellationDoesNotFabricateRawEnd() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  sampler.touchesBegan([touch], in: view)
  sampler.discardActiveSessions()
  touch.timestamp = 2
  sampler.touchesEnded([touch], event: nil, in: view)
  check(sampler.strokesLog()["strokeCount"] as? Int == 0, "protocol cancellation synthesized a raw stroke")
  sampler.touchesBegan([touch], in: view)
  touch.timestamp = 3
  sampler.touchesEnded([touch], event: nil, in: view)
  _ = verifyCompleted(sampler)
}

let tests: [(String, () -> Void)] = [
  ("terminal coalesced overlap and repeated finish", testTerminalCoalescedOverlap),
  ("up/cancel sharing a previously accepted timestamp", testTerminalWithPreviouslyAcceptedTimestamp),
  ("tap with equal/distinct timestamps and no coalesced event", testTapAndMissingCoalesced),
  ("overlapping coalesced batches preserve identity and order", testOverlappingCoalescedBatches),
  ("overflow retains exactly one real terminal sample", testOverflowReservesTerminalSlot),
  ("raw pressure and count-only estimated updates are unchanged", testRawPressureAndEstimatedUpdates),
  ("pre/post PencilKit force snapshots and per-view isolation", testPressureBeforeAndAfterPencilkit),
  ("identity-scoped preview retirement and tool/end ordering", testIdentityScopedPreviewRetirement),
  ("empty cancellation does not consume the next preview", testCancelledEmptyPreviewCannotConsumeNextStroke),
  ("protocol cancellation never synthesizes a raw end", testProtocolCancellationDoesNotFabricateRawEnd),
]
for (name, test) in tests {
  test()
  print("PASS: \(name)")
}
