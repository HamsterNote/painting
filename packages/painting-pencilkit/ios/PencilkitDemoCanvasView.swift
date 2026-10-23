import PencilKit
import UIKit

/// The real DOM host is a descendant, so the canvas recognizers see its real touches.
/// Hit testing is geometric only; touch-type policy runs later in shouldReceive(UITouch).
final class PencilkitDemoCanvasView: PencilkitSamplingCanvasView {
  private let domContainer = UIView()
  private(set) weak var hostedDOMView: UIView?
  var onRoutingChanged: (() -> Void)?
  private var lastConnected = false

  func mountDOMView(_ child: UIView) {
    hostedDOMView = child
    domContainer.addSubview(child)
    updateDOMHost()
  }

  func unmountDOMView(_ child: UIView) {
    child.removeFromSuperview()
    if hostedDOMView === child {
      hostedDOMView = nil
      domContainer.removeFromSuperview()
      reportRouting()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateDOMHost()
  }

  func updateDOMHost() {
    guard hostedDOMView != nil else { return }
    // PencilKit may attach its public recognizer to a descendant, not the PKCanvasView itself.
    // Keep the recognizer in place and mount below its actual owner, without inspecting private views.
    let owner = drawingGestureRecognizer.view
    let destination = owner.flatMap { $0.isDescendant(of: self) ? $0 : nil } ?? self
    guard !destination.isDescendant(of: domContainer) else { return }
    if domContainer.superview !== destination { destination.insertSubview(domContainer, at: 0) }
    domContainer.frame = convert(bounds, to: destination)
    reportRouting()
  }

  private func reportRouting() {
    let connected = hasDrawingAncestor
    if connected != lastConnected {
      lastConnected = connected
      onRoutingChanged?()
    }
  }

  var hasDrawingAncestor: Bool {
    routingIssue == "none"
  }

  var routingIssue: String {
    guard let child = hostedDOMView else { return "dom-not-mounted" }
    guard let owner = drawingGestureRecognizer.view else { return "recognizer-not-mounted" }
    guard owner.isDescendant(of: self) else { return "recognizer-outside-canvas" }
    return child.isDescendant(of: owner) ? "none" : "dom-outside-recognizer"
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard let hostedDOMView else { return super.hitTest(point, with: event) }
    guard !isHidden, isUserInteractionEnabled, alpha >= 0.01, bounds.contains(point) else { return nil }
    return hostedDOMView.hitTest(convert(point, to: hostedDOMView), with: event)
  }
}
