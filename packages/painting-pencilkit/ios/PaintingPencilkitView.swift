import ExpoModulesCore
import PencilKit
import UIKit

/**
 * PencilKit canvas shared by the G1 Probe and opt-in G2/G3 Demo host.
 *
 * 配置对应 design.md D2-A / D4 的固定决策（本期不再可配）：
 *   - 透明背景、位于上层时可叠加在 DOM 之上；
 *   - drawingPolicy 默认 .pencilOnly（仅 Apple Pencil 绘制，手指不落墨）；
 *   - 关闭 PKCanvasView 自身滚动/缩放（UIScrollView 行为）与尺子；
 *   - 不挂载 PKToolPicker（不提供原生工具选择器）；
 *   - 工具固定为可映射的 pen 预览（PKInkingTool），颜色/宽度来自 prop。
 *
 * Demo mode owns an isolated raw sampler and disposable, identity-scoped previews.
 * Finger hit testing and presentation still require G2/G3 device verification.
 */
final class PaintingPencilkitView: ExpoView, PKCanvasViewDelegate {
  private let canvasView = PencilkitSamplingCanvasView()
  private let demoSampler = PencilkitG1Sampler()
  private var demoState: DemoState?
  private var contexts: [Int: String] = [:]
  private var previews = PencilkitPreviewLedger()
  private var updatingDrawing = false
  private var collectingID: Int?
  private var lastHit = "none"
  private var lastDemoStatus = ""

  private struct DemoState: Decodable {
    let contextKey: String
    let enabled: Bool
    let retireIDs: [Int]
    let exclusions: [Exclusion]
  }
  private struct Exclusion: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var rect: CGRect {
      CGRect(x: x, y: y, width: width, height: height)
    }
  }

  private var pencilOnly = true
  private var inkColor: UIColor = .systemBlue
  private var inkWidth: CGFloat = 4
  private var inkOpacity: CGFloat = 1

  /// 供 Module 的 Events("onReady") 绑定；只在上屏后派发一次。
  let onReady = EventDispatcher()
  private var didDispatchReady = false

  /// 供 Module 的 Events("onStroke") 绑定；每笔完成（up/cancel）派发摘要。
  let onStroke = EventDispatcher()
  let onBegin = EventDispatcher()
  let onPreviewRetired = EventDispatcher()
  let onDemoStatus = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    configureCanvas()
    // Probe exports remain isolated from each Demo view's transient sampling state.
    PencilkitG1Sampler.shared.onStrokeCompleted = { [weak self] summary in
      self?.onStroke(summary)
    }
    demoSampler.onStrokeBegan = { [weak self] begin in
      guard let self, let id = begin["id"] as? Int, let state = self.demoState else { return }
      self.contexts[id] = state.contextKey
      self.previews.activeID = id
      self.collectingID = id
      var payload = begin
      payload["contextKey"] = state.contextKey
      self.onBegin(payload)
    }
    demoSampler.onStrokeCompleted = { [weak self] summary in
      guard let self, let id = summary["id"] as? Int else { return }
      var payload = summary
      payload["contextKey"] = self.contexts[id] ?? ""
      self.collectingID = nil
      self.previews.finishedIDs.append(id)
      if summary["cancelled"] as? Bool == true { self.previews.cancelledIDs.insert(id) }
      self.onStroke(payload)
      self.reconcilePreviews()
    }
  }

  @available(*, unavailable)
  required init?(coder _: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvasView.frame = bounds
    publishDemoStatus()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, !didDispatchReady else { return }
    didDispatchReady = true
    dispatchReady()
    publishDemoStatus()
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

  func setInkOpacity(_ opacity: Double) {
    inkOpacity = CGFloat(min(1, max(0, opacity)))
    applyTool()
  }

  func setDemoState(_ json: String) {
    guard let data = json.data(using: .utf8),
          let state = try? JSONDecoder().decode(DemoState.self, from: data) else { return }
    demoState = state
    canvasView.sampler = demoSampler
    previews.retireIDs.formUnion(state.retireIDs.filter { contexts[$0] != nil })
    if let id = collectingID, state.retireIDs.contains(id) {
      collectingID = nil
      demoSampler.discardActiveSessions()
      // Cancel only the temporary PK gesture. No raw stroke or history transaction is synthesized.
      canvasView.drawingGestureRecognizer.isEnabled = false
      canvasView.drawingGestureRecognizer.isEnabled = true
      previews.finishedIDs.append(id)
      previews.cancelledIDs.insert(id)
      previews.finishTool()
    }
    reconcilePreviews()
    publishDemoStatus()
  }

  // Finger-only events fall through to the real WKWebView; pencilOnly alone cannot do this.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if let state = demoState {
      lastHit = PencilkitDemoHitTesting.decision(
        point: point, bounds: bounds, enabled: state.enabled,
        exclusions: state.exclusions.map { $0.rect }, event: event
      )
      publishDemoStatus()
      guard lastHit == "pencil" else { return nil }
    }
    return super.hitTest(point, with: event)
  }

  override var undoManager: UndoManager? { demoState == nil ? super.undoManager : nil }

  func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) { previews.usingTool = true }

  func canvasViewDidFinishUsingTool(_ canvasView: PKCanvasView) {
    previews.finishTool()
    reconcilePreviews()
    applyTool()
  }

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    if !updatingDrawing { reconcilePreviews() }
  }

  private func reconcilePreviews() {
    guard demoState != nil, !updatingDrawing else { return }
    let strokes = canvasView.drawing.strokes
    guard let retirement = previews.reconcile(strokeCount: strokes.count) else { return }
    if retirement.keepIndices.count != strokes.count {
      updatingDrawing = true
      canvasView.drawing = PKDrawing(strokes: retirement.keepIndices.map { strokes[$0] })
      updatingDrawing = false
    }
    for id in retirement.ids {
      if let context = contexts.removeValue(forKey: id) {
        onPreviewRetired(["id": id, "contextKey": context])
      }
    }
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
    canvasView.delegate = self
    // 故意不挂载 PKToolPicker：design D4 non-goal「不提供原生工具选择器」。

    applyDrawingPolicy()
    applyTool()

    addSubview(canvasView)
  }

  private func applyDrawingPolicy() {
    canvasView.drawingPolicy = pencilOnly ? .pencilOnly : .anyInput
  }

  private func applyTool() {
    guard !previews.usingTool else { return }
    canvasView.tool = PKInkingTool(.pen, color: inkColor.withAlphaComponent(inkOpacity), width: inkWidth)
  }

  // MARK: - Ready event

  private func publishDemoStatus() {
    guard window != nil, let state = demoState else { return }
    let signature = "\(state.contextKey):\(state.enabled):\(bounds.width):\(bounds.height):\(lastHit)"
    guard signature != lastDemoStatus else { return }
    lastDemoStatus = signature
    onDemoStatus([
      "contextKey": state.contextKey,
      "enabled": state.enabled,
      "width": bounds.width,
      "height": bounds.height,
      "lastHit": lastHit,
    ])
  }

  private func dispatchReady() {
    onReady([
      "moduleVersion": "0.1.0",
      "demoBridgeVersion": 2,
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "deviceModel": UIDevice.current.model,
      "drawingPolicy": pencilOnly ? "pencilOnly" : "anyInput",
      "toolPickerAttached": false,
      "scrollingEnabled": canvasView.isScrollEnabled,
    ])
  }
}
