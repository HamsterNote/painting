import UIKit

enum PencilkitDemoHitTesting {
  static func decision(point: CGPoint, bounds: CGRect, enabled: Bool, exclusions: [CGRect], event: UIEvent?) -> String {
    guard enabled else { return "disabled" }
    guard bounds.contains(point) else { return "outside-canvas" }
    guard !exclusions.contains(where: { $0.contains(point) }) else { return "control" }
    guard let touches = event?.allTouches, !touches.isEmpty else { return "no-touch-metadata" }
    // Hit testing can precede the location update in UITouch. A 1pt location match
    // is not a UIKit contract. Pencil presence also keeps simultaneous palms off the WebView.
    return touches.contains(where: { $0.type == .pencil && $0.phase != .ended && $0.phase != .cancelled })
      ? "pencil" : "non-pencil"
  }
}
