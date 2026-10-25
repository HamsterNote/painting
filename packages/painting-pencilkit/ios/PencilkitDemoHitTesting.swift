import UIKit

enum PencilkitDemoHitTesting {
  static func decision(point: CGPoint, bounds: CGRect, enabled: Bool, exclusions: [CGRect], touch: UITouch) -> String {
    guard enabled else { return "disabled" }
    guard bounds.contains(point) else { return "outside-canvas" }
    guard !exclusions.contains(where: { $0.contains(point) }) else { return "control" }
    return touch.type == .pencil && touch.phase != .ended && touch.phase != .cancelled
      ? "pencil" : "non-pencil"
  }
}
