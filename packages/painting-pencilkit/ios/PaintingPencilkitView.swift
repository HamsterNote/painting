import ExpoModulesCore
import PencilKit
import UIKit

/**
 * PaintingPencilkitView —— HAM-66 tasks 2.1 最小 PKCanvasView 封装。
 *
 * 配置对应 design.md D2-A / D4 的固定决策（本期不再可配）：
 *   - 透明背景、位于上层时可叠加在 DOM 之上；
 *   - drawingPolicy 默认 .pencilOnly（仅 Apple Pencil 绘制，手指不落墨）；
 *   - 关闭 PKCanvasView 自身滚动/缩放（UIScrollView 行为）与尺子；
 *   - 不挂载 PKToolPicker（不提供原生工具选择器）；
 *   - 工具固定为可映射的 pen 预览（PKInkingTool），颜色/宽度来自 prop。
 *
 * 明确不做（后续门槛增量的范围）：
 *   - 不采集 coalesced touches（G1/tasks 2.2）；
 *   - 不做 Pencil 与手指在 RN/DOM/WKWebView 组合中的分流（G2/tasks 2.3）；
 *   - 不做 raw→PF 交接与 undo 路由（G3/tasks 2.4、3.x/4.x）。
 */
final class PaintingPencilkitView: ExpoView {
  private let canvasView = PKCanvasView()

  private var pencilOnly = true
  private var inkColor: UIColor = .systemBlue
  private var inkWidth: CGFloat = 4

  /// 供 Module 的 Events("onReady") 绑定；只在上屏后派发一次。
  let onReady = EventDispatcher()
  private var didDispatchReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    configureCanvas()
  }

  @available(*, unavailable)
  required init?(coder _: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvasView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, !didDispatchReady else { return }
    didDispatchReady = true
    dispatchReady()
  }

  // MARK: - Props

  func setPencilOnly(_ pencilOnly: Bool) {
    self.pencilOnly = pencilOnly
    applyDrawingPolicy()
  }

  func setInkColor(_ inkColor: UIColor) {
    self.inkColor = inkColor
    applyTool()
  }

  func setInkWidth(_ inkWidth: Double) {
    self.inkWidth = CGFloat(max(inkWidth, 0.1))
    applyTool()
  }

  // MARK: - Configuration

  private func configureCanvas() {
    canvasView.backgroundColor = .clear
    canvasView.isOpaque = false

    // 关闭自身滚动/缩放：viewport 由上层（Web/controller）拥有，见 design D4。
    canvasView.isScrollEnabled = false
    canvasView.minimumZoomScale = 1
    canvasView.maximumZoomScale = 1
    canvasView.bouncesZoom = false

    canvasView.isRulerActive = false
    // 故意不挂载 PKToolPicker：design D4 non-goal「不提供原生工具选择器」。

    applyDrawingPolicy()
    applyTool()

    addSubview(canvasView)
  }

  private func applyDrawingPolicy() {
    canvasView.drawingPolicy = pencilOnly ? .pencilOnly : .anyInput
  }

  private func applyTool() {
    canvasView.tool = PKInkingTool(.pen, color: inkColor, width: inkWidth)
  }

  // MARK: - Ready event

  private func dispatchReady() {
    onReady([
      "moduleVersion": "0.1.0",
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "deviceModel": UIDevice.current.model,
      "drawingPolicy": pencilOnly ? "pencilOnly" : "anyInput",
      "toolPickerAttached": false,
      "scrollingEnabled": canvasView.isScrollEnabled,
    ])
  }
}
