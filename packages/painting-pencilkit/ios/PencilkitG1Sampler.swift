import PencilKit
import UIKit

/**
 * PencilkitG1Sampler —— HAM-66 tasks 2.2 / design G1 的 raw 采样器。
 *
 * 采样规则（与 design.md D1/G1 一一对应，rules 字段会随日志导出作为证据）：
 *   - 只用公开 UIKit 接口：PKCanvasView 子类重写 touchesBegan/Moved/Ended/
 *     Cancelled 并先调 super，不抢占 PencilKit 手势；coalesced 取自 UIEvent。
 *   - 去重按事件身份（同一 touch 流内相同 UIKit timestamp 视为同一实际样本），
 *     不按坐标去重；不合并、不预测、不按时间重排，seq 即接收次序。
 *   - 时间基准统一为 UIKit monotonic timestamp（毫秒），不混用 JS Date.now。
 *   - pressure capability 由 maximumPossibleForce > 0 判定；pressure =
 *     force / maximumPossibleForce，不 clamp；capability 缺失时 pressure
 *     保持缺失（null），不以压力是否变化判断能力。
 *   - estimated updates：样本记录 estimatedProperties / expectingUpdates
 *     原始标志；touchesEstimatedPropertiesUpdated 只计数，不改写已收样本
 *     （提交后不允许迟到估计值悄悄改写 raw，以接受时为准）。
 *   - tap 来自真实 down/up；仅采集 .pencil 触摸，其他类型计数后忽略。
 *
 * 工程限额（诊断用，与 design 初值同量级）：单笔最多 50,000 样本，超出置
 * overflow 并停止该笔记录；最多保留最近 20 笔完成笔供导出。
 */
final class PencilkitG1Sampler {
  static let shared = PencilkitG1Sampler()

  /// 单笔样本上限（诊断截断，置 overflow 标志，不静默丢弃事实）
  private let maxSamplesPerStroke = 50_000
  /// 保留的完成笔上限
  private let maxCompletedStrokes = 20

  /// 单笔完成回调（主线程触发），由持有 onStroke EventDispatcher 的 view 设置
  var onStrokeCompleted: (([String: Any]) -> Void)?

  private let lock = NSLock()
  private var nextSessionId = 1
  private var activeSessions: [ObjectIdentifier: Session] = [:]
  private var completedStrokes: [[String: Any]] = []
  private var ignoredNonPencilTouches = 0

  private struct Session {
    let id: Int
    let startTimestamp: TimeInterval
    var lastTimestamp: TimeInterval = -1
    var samples: [[String: Any]] = []
    var seq = 0
    var downCount = 0
    var upCount = 0
    var mainCount = 0
    var coalescedCount = 0
    var pressureCapability: Bool?
    var pressureMin = Double.greatestFiniteMagnitude
    var pressureMax = -Double.greatestFiniteMagnitude
    var estimatedFlagsUnion: UInt = 0
    var expectingFlagsUnion: UInt = 0
    var lateEstimateEvents = 0
    var overflow = false
    var cancelled = false
    var boundsWidth = 0.0
    var boundsHeight = 0.0
  }

  // MARK: - Touch entry points（主线程，由 canvas 子类在 super 之后调用）

  func touchesBegan(_ touches: Set<UITouch>, in view: UIView) {
    lock.lock()
    defer { lock.unlock() }
    for touch in touches where touch.type == .pencil {
      var session = Session(
        id: nextSessionId,
        startTimestamp: touch.timestamp,
        boundsWidth: Double(view.bounds.width),
        boundsHeight: Double(view.bounds.height)
      )
      nextSessionId += 1
      record(&session, touch: touch, phase: "down", kind: "main", in: view)
      activeSessions[ObjectIdentifier(touch)] = session
    }
    countIgnored(touches)
  }

  func touchesMoved(_ touches: Set<UITouch>, event: UIEvent?, in view: UIView) {
    lock.lock()
    defer { lock.unlock() }
    for touch in touches where touch.type == .pencil {
      guard var session = activeSessions[ObjectIdentifier(touch)] else { continue }
      // 主事件先记，coalesced 中时间戳等于已收末样本的视为同一实际样本跳过。
      record(&session, touch: touch, phase: "move", kind: "main", in: view)
      if let coalesced = event?.coalescedTouches(for: touch) {
        for extra in coalesced {
          record(&session, touch: extra, phase: "move", kind: "coalesced", in: view)
        }
      }
      activeSessions[ObjectIdentifier(touch)] = session
    }
    countIgnored(touches)
  }

  func touchesEnded(_ touches: Set<UITouch>, event: UIEvent?, in view: UIView) {
    finish(touches, event: event, phase: "up", cancelled: false, in: view)
  }

  func touchesCancelled(_ touches: Set<UITouch>, event: UIEvent?, in view: UIView) {
    finish(touches, event: event, phase: "cancel", cancelled: true, in: view)
  }

  /// 迟到的估计属性更新：只计数，绝不改写已收样本。
  func estimatedPropertiesUpdated(_ touches: Set<UITouch>) {
    lock.lock()
    defer { lock.unlock() }
    for touch in touches {
      guard var session = activeSessions[ObjectIdentifier(touch)] else { continue }
      session.lateEstimateEvents += 1
      activeSessions[ObjectIdentifier(touch)] = session
    }
  }

  // MARK: - Export

  func strokesLog() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "moduleVersion": "0.1.0",
      "gate": "G1",
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "deviceModel": UIDevice.current.model,
      "capturedAtUptimeMs": ProcessInfo.processInfo.systemUptime * 1000,
      "ignoredNonPencilTouches": ignoredNonPencilTouches,
      "rules": [
        "采样: PKCanvasView 子类 touches* 重写并先调 super，公开 UIKit 接口，不抢占 PK 手势",
        "去重: 同一 touch 流内相同 UIKit timestamp 视为同一实际样本跳过；不按坐标去重、不重排",
        "时间: 统一 UIKit monotonic timestamp 毫秒；t 为相对首样本，tabs 为绝对；不混用 JS Date.now",
        "压力: capability = maximumPossibleForce > 0；p = f/mf 不 clamp；能力缺失时 p 为 null",
        "估计: 样本保留 estimatedProperties/expectingUpdates 原值；迟到更新只计 lateEstimateEvents，不改写样本",
        "限额: 单笔最多 50000 样本（超出 overflow=true）；保留最近 20 笔",
      ],
      "strokeCount": completedStrokes.count,
      "strokes": completedStrokes,
    ]
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    activeSessions.removeAll()
    completedStrokes.removeAll()
    ignoredNonPencilTouches = 0
  }

  // MARK: - Internal

  private func countIgnored(_ touches: Set<UITouch>) {
    for touch in touches where touch.type != .pencil {
      ignoredNonPencilTouches += 1
    }
  }

  private func finish(
    _ touches: Set<UITouch>,
    event: UIEvent?,
    phase: String,
    cancelled: Bool,
    in view: UIView
  ) {
    lock.lock()
    defer { lock.unlock() }
    for touch in touches where touch.type == .pencil {
      let key = ObjectIdentifier(touch)
      guard var session = activeSessions[key] else { continue }
      if let coalesced = event?.coalescedTouches(for: touch) {
        for extra in coalesced {
          record(&session, touch: extra, phase: "move", kind: "coalesced", in: view)
        }
      }
      record(&session, touch: touch, phase: phase, kind: "main", in: view)
      session.cancelled = cancelled
      activeSessions.removeValue(forKey: key)

      let summary = strokeDictionary(session)
      completedStrokes.append(summary)
      if completedStrokes.count > maxCompletedStrokes {
        completedStrokes.removeFirst(completedStrokes.count - maxCompletedStrokes)
      }
      let callback = onStrokeCompleted
      // 回调在主线程同步触发（触摸回调本就在主线程），view 侧只做事件派发。
      callback(summary)
    }
    countIgnored(touches)
  }

  private func record(
    _ session: inout Session,
    touch: UITouch,
    phase: String,
    kind: String,
    in view: UIView
  ) {
    // 事件身份去重：与已收末样本同 timestamp 即同一实际样本，跳过。
    if touch.timestamp == session.lastTimestamp { return }
    if session.overflow { return }
    if session.samples.count >= maxSamplesPerStroke {
      session.overflow = true
      return
    }
    session.lastTimestamp = touch.timestamp

    let maxForce = touch.maximumPossibleForce
    let capability = maxForce > 0
    let pressure: Double? = capability ? touch.force / maxForce : nil
    let location = touch.preciseLocation(in: view)

    if session.pressureCapability == nil { session.pressureCapability = capability }
    if let pressure {
      session.pressureMin = min(session.pressureMin, pressure)
      session.pressureMax = max(session.pressureMax, pressure)
    }

    session.estimatedFlagsUnion |= touch.estimatedProperties.rawValue
    session.expectingFlagsUnion |= touch.estimatedPropertiesExpectingUpdates.rawValue

    switch phase {
    case "down": session.downCount += 1
    case "up", "cancel": session.upCount += 1
    default: break
    }
    if kind == "main" { session.mainCount += 1 } else { session.coalescedCount += 1 }

    session.samples.append([
      "seq": session.seq,
      "kind": kind,
      "phase": phase,
      "t": (touch.timestamp - session.startTimestamp) * 1000,
      "tabs": touch.timestamp * 1000,
      "x": Double(location.x),
      "y": Double(location.y),
      "f": touch.force,
      "mf": maxForce,
      "p": pressure as Any,
      "est": touch.estimatedProperties.rawValue,
      "estUpd": touch.estimatedPropertiesExpectingUpdates.rawValue,
    ])
    session.seq += 1
  }

  private func strokeDictionary(_ session: Session) -> [String: Any] {
    let durationMs = session.lastTimestamp >= session.startTimestamp
      ? (session.lastTimestamp - session.startTimestamp) * 1000
      : 0
    var pressure: [String: Any] = ["capability": session.pressureCapability as Any]
    if session.pressureCapability == true, session.pressureMax >= session.pressureMin {
      pressure["min"] = session.pressureMin
      pressure["max"] = session.pressureMax
    }
    return [
      "id": session.id,
      "touchType": "pencil",
      "durationMs": durationMs,
      "bounds": ["w": session.boundsWidth, "h": session.boundsHeight],
      "counts": [
        "down": session.downCount,
        "up": session.upCount,
        "main": session.mainCount,
        "coalesced": session.coalescedCount,
        "total": session.samples.count,
      ],
      "pressure": pressure,
      "estimated": [
        "flagsUnion": session.estimatedFlagsUnion,
        "expectingUnion": session.expectingFlagsUnion,
        "lateEstimateEvents": session.lateEstimateEvents,
      ],
      "overflow": session.overflow,
      "cancelled": session.cancelled,
      "samples": session.samples,
    ]
  }
}

/**
 * PencilkitSamplingCanvasView —— 旁路采样版 PKCanvasView。
 * 所有重写先调 super，PencilKit 绘制行为不变；采样不影响手势与命中。
 */
final class PencilkitSamplingCanvasView: PKCanvasView {
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesBegan(touches, with: event)
    PencilkitG1Sampler.shared.touchesBegan(touches, in: self)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesMoved(touches, with: event)
    PencilkitG1Sampler.shared.touchesMoved(touches, event: event, in: self)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesEnded(touches, with: event)
    PencilkitG1Sampler.shared.touchesEnded(touches, event: event, in: self)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesCancelled(touches, with: event)
    PencilkitG1Sampler.shared.touchesCancelled(touches, event: event, in: self)
  }

  override func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {
    super.touchesEstimatedPropertiesUpdated(touches)
    PencilkitG1Sampler.shared.estimatedPropertiesUpdated(touches)
  }
}
