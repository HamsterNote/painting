package expo.modules.paintingandroidink

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaintingAndroidInkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaintingAndroidInk")
    Constants("probeVersion" to 1)

    View(PaintingAndroidInkView::class) {
      Events("onReady", "onStrokeFinished", "onRetired", "onCancelled")

      Prop("retireId") { view: PaintingAndroidInkView, id: Int ->
        view.retire(id)
      }
    }
  }
}
