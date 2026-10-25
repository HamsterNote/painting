// Compiled with the real iOS Simulator SDK and production view, never the PencilKit fixture.
import PencilKit
import UIKit

@MainActor
func checkAppleDelegateContract(_ view: PaintingPencilkitView, canvas: PKCanvasView) {
  let sdkSelector = #selector(PKCanvasViewDelegate.canvasViewDidEndUsingTool(_:))
  let viewSelector = #selector(PaintingPencilkitView.canvasViewDidEndUsingTool(_:))
  precondition(sdkSelector == viewSelector)
  let delegate: PKCanvasViewDelegate = view
  precondition(delegate.responds(to: sdkSelector))
  delegate.canvasViewDidEndUsingTool?(canvas)
}
