import ExpoModulesCore

/** Probe diagnostics plus the opt-in G2/G3 Demo view protocol. */
public class PaintingPencilkitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PaintingPencilkit")
    Constants(["demoBridgeVersion": 5])

    // G1 诊断导出：返回采样器当前保留的完成笔与规则说明（见 PencilkitG1Sampler）。
    AsyncFunction("getStrokesLog") { () -> [String: Any] in
      PencilkitG1Sampler.shared.strokesLog()
    }

    AsyncFunction("clearStrokesLog") { () -> Void in
      PencilkitG1Sampler.shared.clear()
    }

    View(PaintingPencilkitView.self) {
      Events("onReady", "onStroke", "onBegin", "onPreviewRetired", "onDemoStatus")

      Prop("demoHost") { (view: PaintingPencilkitView, enabled: Bool) in
        view.setDemoHost(enabled)
      }

      Prop("demoState") { (view: PaintingPencilkitView, state: String) in
        view.setDemoState(state)
      }

      Prop("pencilOnly") { (view: PaintingPencilkitView, pencilOnly: Bool) in
        view.setPencilOnly(pencilOnly)
      }

      Prop("inkColor") { (view: PaintingPencilkitView, inkColor: UIColor) in
        view.setInkColor(inkColor)
      }

      Prop("inkWidth") { (view: PaintingPencilkitView, inkWidth: Double) in
        view.setInkWidth(inkWidth)
      }

      Prop("inkOpacity") { (view: PaintingPencilkitView, opacity: Double) in
        view.setInkOpacity(opacity)
      }
    }
  }
}
