import ExpoModulesCore

/**
 * PaintingPencilkitModule —— HAM-66 tasks 2.1 的最小 Expo Module。
 *
 * 只声明一个原生 View（PKCanvasView 封装）与 probe 所需的三个 prop
 * 和一个 onReady 事件；不包含 G1 采样器、G2 分流宿主或 G3 交接逻辑，
 * 这些是后续门槛增量的范围（见 design.md D1/G1–G3）。
 */
public class PaintingPencilkitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PaintingPencilkit")

    // G1 诊断导出：返回采样器当前保留的完成笔与规则说明（见 PencilkitG1Sampler）。
    AsyncFunction("getStrokesLog") { () -> [String: Any] in
      PencilkitG1Sampler.shared.strokesLog()
    }

    AsyncFunction("clearStrokesLog") { () -> Void in
      PencilkitG1Sampler.shared.clear()
    }

    View(PaintingPencilkitView.self) {
      Events("onReady", "onStroke")

      Prop("pencilOnly") { (view: PaintingPencilkitView, pencilOnly: Bool) in
        view.setPencilOnly(pencilOnly)
      }

      Prop("inkColor") { (view: PaintingPencilkitView, inkColor: UIColor) in
        view.setInkColor(inkColor)
      }

      Prop("inkWidth") { (view: PaintingPencilkitView, inkWidth: Double) in
        view.setInkWidth(inkWidth)
      }
    }
  }
}
