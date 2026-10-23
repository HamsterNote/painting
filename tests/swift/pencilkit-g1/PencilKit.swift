import UIKit

open class PKCanvasView: UIView {
  public let drawingGestureRecognizer = UIGestureRecognizer(target: nil, action: nil)
  public override init() {
    super.init()
    addGestureRecognizer(drawingGestureRecognizer)
  }
  public var forceAfterSuper: Double?
  open override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let forceAfterSuper {
      for touch in touches { touch.force = forceAfterSuper }
    }
  }
}
