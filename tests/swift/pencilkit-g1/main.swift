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

func testLongStrokeAcrossMoveEvents() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  sampler.touchesBegan([touch], in: view)
  let started = ProcessInfo.processInfo.systemUptime
  for index in 1...10_000 {
    touch.timestamp = Double(index + 1)
    sampler.touchesMoved([touch], event: UIEvent([UITouch(touch.timestamp - 0.5)]), in: view)
  }
  touch.timestamp += 1
  sampler.touchesEnded([touch], event: nil, in: view)
  let samples = verifyCompleted(sampler)
  check(samples.count == 20_002, "long stroke lost accepted main/coalesced samples")
  print("Long stroke 10000 move events: \(ProcessInfo.processInfo.systemUptime - started)s")
}

func testCallbacksCanReenterSampler() {
  let sampler = PencilkitG1Sampler()
  let view = UIView()
  let touch = UITouch(1)
  var began = 0
  var finished = 0
  sampler.onStrokeBegan = { _ in
    _ = sampler.strokesLog()
    began += 1
    // A synchronous host retirement must be able to discard this just-published session.
    if began == 1 { sampler.discardActiveSessions() }
  }
  sampler.onStrokeCompleted = { _ in
    check(sampler.strokesLog()["strokeCount"] as? Int == 1, "finish callback ran before completion")
    sampler.clear()
    finished += 1
  }
  sampler.touchesBegan([touch], in: view)
  sampler.touchesEnded([touch], event: nil, in: view)
  check(finished == 0, "discarded begin should not finish")
  sampler.touchesBegan([touch], in: view)
  touch.timestamp = 2
  sampler.touchesEnded([touch], event: nil, in: view)
  check(began == 2 && finished == 1, "callback reentry lost a lifecycle event")
}

func testContinuousStrokesAndDemoRetention() {
  for retainsCompleted in [true, false] {
    let sampler = PencilkitG1Sampler(retainsCompletedStrokes: retainsCompleted)
    let view = UIView()
    var callbacks = 0
    var firstSamples: [[String: Any]] = []
    sampler.onStrokeCompleted = { summary in
      callbacks += 1
      check(summary["id"] as? Int == callbacks, "continuous stroke IDs changed")
      let counts = summary["counts"] as! [String: Int]
      check(counts["down"] == 1 && counts["up"] == 1, "continuous stroke lost its lifecycle")
      if callbacks == 1 { firstSamples = summary["samples"] as! [[String: Any]] }
    }
    for id in 1...80 {
      let touch = UITouch(Double(id * 100))
      sampler.touchesBegan([touch], in: view)
      for _ in 0..<100 {
        touch.timestamp += 1
        sampler.touchesMoved([touch], event: UIEvent([UITouch(touch.timestamp - 0.5)]), in: view)
      }
      touch.timestamp += 1
      sampler.touchesEnded([touch], event: nil, in: view)
    }
    check(callbacks == 80, "continuous strokes were lost or duplicated")
    check(firstSamples.count == 202 && firstSamples[0]["tabs"] as? Double == 100_000,
          "a later session mutated an exported raw buffer")
    let log = sampler.strokesLog()
    check(log["strokeCount"] as? Int == (retainsCompleted ? 20 : 0), "retained raw data is not bounded")
  }
}

func testDemoPencilHitTesting() {
  let pencil = UITouch(1)
  pencil.location = CGPoint(x: 0, y: 0)
  let finger = UITouch(1)
  finger.type = .direct
  func hit(_ touch: UITouch, enabled: Bool = true, exclusions: [CGRect] = []) -> String {
    PencilkitDemoHitTesting.decision(
      point: CGPoint(x: 50, y: 50), bounds: CGRect(x: 0, y: 0, width: 100, height: 100),
      enabled: enabled, exclusions: exclusions, touch: touch
    )
  }
  check(hit(pencil) == "pencil", "Pencil policy must use the actual touch, not a UIEvent lookup")
  check(hit(finger) == "non-pencil", "fingers must reach the real WebView")
  check(hit(pencil, enabled: false) == "disabled", "disabled canvas captured input")
  check(hit(pencil, exclusions: [CGRect(x: 40, y: 40, width: 20, height: 20)]) == "control", "native canvas captured an excluded control")
  pencil.phase = .ended
  check(hit(pencil) == "non-pencil", "ended Pencil must not capture a later finger")
}

func testDemoGeometricHitTesting() {
  let canvas = PencilkitDemoCanvasView()
  let dom = UIView()
  check(!canvas.hasDrawingAncestor, "unmounted DOM must not claim a native route")
  canvas.mountDOMView(dom)
  check(canvas.hasDrawingAncestor, "recognizer owner must be a real DOM ancestor")
  for event in [nil, UIEvent([]), UIEvent([UITouch(1)])] as [UIEvent?] {
    check(canvas.hitTest(CGPoint(x: 50, y: 50), with: event) === dom, "real DOM descendant must be selected even before touch metadata exists")
    check(canvas.hitTest(CGPoint(x: 150, y: 50), with: event) == nil, "out-of-bounds hit")
  }
  dom.isUserInteractionEnabled = false
  check(canvas.hitTest(CGPoint(x: 50, y: 50), with: nil) == nil, "disabled DOM must not capture input")
  let unrelatedOwner = UIView()
  unrelatedOwner.addGestureRecognizer(canvas.drawingGestureRecognizer)
  canvas.updateDOMHost()
  check(!canvas.hasDrawingAncestor, "mounted child alone must not claim drawing recognizer ancestry")
}

func testDemoNestedDrawingOwner() {
  let canvas = PencilkitDemoCanvasView()
  let dom = UIView()
  var routingChanges = 0
  canvas.onRoutingChanged = { routingChanges += 1 }
  canvas.drawingGestureRecognizer.view = nil
  canvas.mountDOMView(dom)
  check(!canvas.hasDrawingAncestor && canvas.routingIssue == "recognizer-not-mounted", "early missing owner must remain explicit")
  // Model the real failure: PencilKit owns its recognizer on a nested drawing view.
  let drawingOwner = UIView()
  drawingOwner.frame = CGRect(x: 10, y: 20, width: 100, height: 100)
  canvas.addSubview(drawingOwner)
  drawingOwner.addGestureRecognizer(canvas.drawingGestureRecognizer)
  canvas.layoutSubviews()
  check(dom.isDescendant(of: drawingOwner), "DOM must mount under the public recognizer's actual owner")
  check(canvas.hasDrawingAncestor, "nested drawing owner must report gesture-ancestor")
  check(canvas.hitTest(CGPoint(x: 50, y: 50), with: nil) === dom, "container offset must preserve DOM coordinates")
  check(routingChanges == 1, "successful attachment must publish a new routing status")
  let laterOwner = UIView()
  canvas.addSubview(laterOwner)
  laterOwner.addGestureRecognizer(canvas.drawingGestureRecognizer)
  canvas.layoutSubviews()
  check(dom.isDescendant(of: laterOwner), "layout must reconcile delayed owner changes")
  canvas.unmountDOMView(dom)
  check(!canvas.hasDrawingAncestor && dom.superview == nil, "unmount must detach DOM and clear the route")
  check(routingChanges == 2, "unmount must publish loss of routing")
}

func testDemoPassiveTouchObserver() {
  let sampler = PencilkitG1Sampler()
  let coordinates = UIView()
  coordinates.frame = CGRect(x: 10, y: 20, width: 100, height: 100)
  let observer = PencilkitDemoTouchObserver(sampler: sampler, coordinateView: coordinates)
  observer.accepts = { $0.type == .pencil }
  let other = UIGestureRecognizer(target: nil, action: nil)
  check(!observer.canPrevent(other) && !observer.canBePrevented(by: other), "raw observer must not participate in gesture prevention")
  check(!observer.cancelsTouchesInView && !observer.delaysTouchesBegan && !observer.delaysTouchesEnded, "observer must leave real Web touches alone")
  check(observer.allowedTouchTypes == [NSNumber(value: UITouch.TouchType.pencil.rawValue)], "observer must filter Pencil")
  let pencil = UITouch(1)
  pencil.location = CGPoint(x: 50, y: 60)
  let finger = UITouch(1)
  finger.type = .direct
  observer.touchesBegan([pencil, finger], with: UIEvent([]))
  check(observer.ignoredTouches.contains(finger), "finger must not be sampled")
  let canvas = PencilkitDemoCanvasView()
  canvas.sampler = sampler
  canvas.samplesThroughResponder = false
  // A responder-chain delivery must not double-sample the ancestor observer's stroke.
  canvas.touchesBegan([pencil], with: nil)
  pencil.timestamp = 2
  observer.touchesMoved([pencil], with: UIEvent([UITouch(1.5), UITouch(2)]))
  canvas.touchesMoved([pencil], with: nil)
  observer.touchesEnded([pencil], with: UIEvent([UITouch(2)]))
  canvas.touchesEnded([pencil], with: nil)
  let samples = verifyCompleted(sampler)
  check(samples.count == 4, "observer lost coalesced/terminal or responder duplicated input")
  check(samples[0]["x"] as? Double == 40 && samples[0]["y"] as? Double == 40, "observer coordinates must be local to DOM drawing frame")
}

let tests: [(String, () -> Void)] = [
  ("Demo policy uses actual touch and preserves finger/control routing", testDemoPencilHitTesting),
  ("Demo hit testing selects real DOM before touch metadata exists", testDemoGeometricHitTesting),
  ("Demo mounts under nested/delayed public drawing recognizer owners", testDemoNestedDrawingOwner),
  ("Demo passive ancestor observer samples once in drawing-frame coordinates", testDemoPassiveTouchObserver),
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
  ("long stroke across distinct UIKit move callbacks", testLongStrokeAcrossMoveEvents),
  ("callbacks can read/cancel/clear without deadlocking", testCallbacksCanReenterSampler),
  ("continuous strokes and Probe/Demo retention stay bounded", testContinuousStrokesAndDemoRetention),
]
for (name, test) in tests {
  test()
  print("PASS: \(name)")
}
