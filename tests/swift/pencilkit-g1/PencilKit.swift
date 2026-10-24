import UIKit

// Required on the host so a misspelled optional SDK callback fails compilation.
// The Darwin runner separately checks the production view against the real Apple SDK.
public protocol PKCanvasViewDelegate: AnyObject {
  func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView)
  func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView)
  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView)
}

public struct PKStroke {
  public let id: Int
  public init(_ id: Int) { self.id = id }
}

public struct PKDrawing {
  public var strokes: [PKStroke]
  public init(strokes: [PKStroke] = []) { self.strokes = strokes }
}

public class PKTool {}
public final class PKInkingTool: PKTool {
  public enum InkType { case pen }
  public let width: CGFloat
  public init(_ type: InkType, color: UIColor, width: CGFloat) { self.width = width }
}

open class PKCanvasView: UIView {
  public enum DrawingPolicy { case pencilOnly, anyInput }
  public var drawingPolicy: DrawingPolicy = .pencilOnly
  public weak var delegate: PKCanvasViewDelegate?
  public var drawing = PKDrawing()
  public private(set) var toolAssignments = 0
  public var tool: PKTool = PKInkingTool(.pen, color: .systemBlue, width: 4) {
    didSet { toolAssignments += 1 }
  }
  public var isScrollEnabled = true
  public var minimumZoomScale: CGFloat = 1
  public var maximumZoomScale: CGFloat = 1
  public var bouncesZoom = true
  public var isRulerActive = false
  public var delaysContentTouches = true
  public var canCancelContentTouches = true
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
