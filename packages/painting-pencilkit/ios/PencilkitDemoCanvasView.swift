import PencilKit
import UIKit

/// The real DOM host is a descendant, so the canvas recognizers see its real touches.
/// Hit testing is geometric only; touch-type policy runs later in shouldReceive(UITouch).
final class PencilkitDemoCanvasView: PencilkitSamplingCanvasView {
  weak var hostedDOMView: UIView?

  var hasDrawingAncestor: Bool {
    guard let child = hostedDOMView, let owner = drawingGestureRecognizer.view else { return false }
    return child.isDescendant(of: owner)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard let hostedDOMView else { return super.hitTest(point, with: event) }
    guard !isHidden, isUserInteractionEnabled, alpha >= 0.01, bounds.contains(point) else { return nil }
    return hostedDOMView.hitTest(convert(point, to: hostedDOMView), with: event)
  }
}
