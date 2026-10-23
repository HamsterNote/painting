import UIKit
#if canImport(UIKit.UIGestureRecognizerSubclass)
import UIKit.UIGestureRecognizerSubclass
#endif

/// Passive raw observer on the canvas ancestor. It never recognizes or prevents a gesture.
final class PencilkitDemoTouchObserver: UIGestureRecognizer {
  private let sampler: PencilkitG1Sampler
  private weak var coordinateView: UIView?
  var accepts: (UITouch) -> Bool = { _ in false }

  init(sampler: PencilkitG1Sampler, coordinateView: UIView) {
    self.sampler = sampler
    self.coordinateView = coordinateView
    super.init(target: nil, action: nil)
    allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
    requiresExclusiveTouchType = false
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let coordinateView else { state = .failed; return }
    let accepted = touches.filter { accepts($0) }
    for touch in touches where !accepted.contains(touch) { ignore(touch, for: event) }
    sampler.touchesBegan(Set(accepted), in: coordinateView)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    if let coordinateView { sampler.touchesMoved(touches, event: event, in: coordinateView) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    if let coordinateView { sampler.touchesEnded(touches, event: event, in: coordinateView) }
    state = .failed
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    if let coordinateView { sampler.touchesCancelled(touches, event: event, in: coordinateView) }
    state = .failed
  }

  override func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {
    sampler.estimatedPropertiesUpdated(touches)
  }
}
