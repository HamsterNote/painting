import UIKit

/// Preserve PencilKit decisions, with explicit precedence over descendant Web gestures.
final class PencilkitDemoDrawingDelegate: NSObject, UIGestureRecognizerDelegate {
  weak var original: UIGestureRecognizerDelegate?
  weak var hostedDOMView: UIView?
  var accepts: (UITouch) -> Bool = { _ in false }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    accepts(touch) && (original?.gestureRecognizer?(recognizer, shouldReceive: touch) ?? true)
  }

  func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    original?.gestureRecognizerShouldBegin?(recognizer) ?? true
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    original?.gestureRecognizer?(recognizer, shouldRecognizeSimultaneouslyWith: other) ?? false
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRequireFailureOf other: UIGestureRecognizer) -> Bool {
    // Never install both directions of the same failure dependency.
    if isWebGesture(other) { return false }
    return original?.gestureRecognizer?(recognizer, shouldRequireFailureOf: other) ?? false
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    // Descendant Web recognizers wait for the Pencil-only recognizer. For fingers,
    // controls and other tools it rejects immediately, preserving the genuine Web stream.
    if isWebGesture(other) { return true }
    return original?.gestureRecognizer?(recognizer, shouldBeRequiredToFailBy: other) ?? false
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive press: UIPress) -> Bool {
    original?.gestureRecognizer?(recognizer, shouldReceive: press) ?? true
  }

  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
    original?.gestureRecognizer?(recognizer, shouldReceive: event) ?? true
  }

  private func isWebGesture(_ recognizer: UIGestureRecognizer) -> Bool {
    guard let hostedDOMView, let view = recognizer.view else { return false }
    return view.isDescendant(of: hostedDOMView)
  }
}
