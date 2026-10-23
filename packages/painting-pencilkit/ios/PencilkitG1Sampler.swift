import PencilKit
import UIKit

/**
 * PencilkitG1Sampler —— HAM-66 tasks 2.2 / design G1 的 raw 采样器。
 *
 * 采样规则（与 design.md D1/G1 一一对应，rules 字段会随日志导出作为证据）：
 *   - 只用公开 UIKit 接口：PKCanvasView 子类重写 touchesBegan/Moved/Ended/
 *     Cancelled 并先调 super，不抢占 PencilKit 手势；coalesced 取自 UIEvent。
 *   - 主/coalesced 采样重叠按同一 touch 流内 UIKit timestamp 去重；真实
 *     up/cancel 是独立生命周期边界，即使 timestamp 相同也保留，不按坐标去重。
 *     不合并、不预测、不按时间重排，seq 即接收次序。
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
 * overflow 并停止 move 记录，预留末个槽位给真实 up/cancel；最多保留最近 20 笔。
 */
final class PencilkitG1Sampler {
  static let shared = PencilkitG1Sampler()

  /// 单笔样本上限（诊断截断，置 overflow 标志，不静默丢弃事实）
  private let maxSamplesPerStroke = 50_000
  /// 保留的完成笔上限
  private let maxCompletedStrokes = 20

  /// 单笔完成回调（主线程触发），由持有 onStroke EventDispatcher 的 view 设置
  var onStrokeCompleted: (([String: Any]) -> Void)?
  var onStrokeBegan: (([String: Any]) -> Void)?

  struct ForceSnapshot {
    let force: Double
    let maximum: Double
  }
  private var beforePencilkit: [TimeInterval: ForceSnapshot] = [:]

  func captureBeforePencilkit(_ touches: Set<UITouch>, event: UIEvent?) {
    lock.lock()
    defer { lock.unlock() }
    beforePencilkit.removeAll(keepingCapacity: true)
    for touch in touches where touch.type == .pencil {
      for extra in event?.coalescedTouches(for: touch) ?? [] {
        beforePencilkit[extra.timestamp] = ForceSnapshot(force: extra.force, maximum: extra.maximumPossibleForce)
      }
      beforePencilkit[touch.timestamp] = ForceSnapshot(force: touch.force, maximum: touch.maximumPossibleForce)
    }
  }

  private let lock = NSLock()
  private var nextSessionId = 1
  private var activeSessions: [ObjectIdentifier: Session] = [:]
  private var completedStrokes: [[String: Any]] = []
  private var ignoredNonPencilTouches = 0

  private struct Session {
    let id: Int
    let startTimestamp: TimeInterval
    var lastTimestamp: TimeInterval = -1
    var recordedTimestamps: Set<TimeInterval> = []
    var samples: [[String: Any]] = []
    var seq = 0
    var downCount = 0
    var upCount = 0
    var mainCount = 0
    var coalescedCount = 0
    var pressureCapability: Bool?
    var pressureMin = Double.greatestFiniteMagnitude
    var pressureMax = -Double.greatestFiniteMagnitude
    var estimatedFlagsUnion: Int = 0
    var expectingFlagsUnion: Int = 0
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
      onStrokeBegan?(["id": session.id, "sample": session.samples[0]])
    }
    countIgnored(touches)
  }

  func touchesMoved(_ touches: Set<UITouch>, event: UIEvent?, in view: UIView) {
    lock.lock()
    defer { lock.unlock() }
    for touch in touches where touch.type == .pencil {
      guard var session = activeSessions[ObjectIdentifier(touch)] else { continue }
      // 主事件先记，coalesced 中已接收过的时间戳视为同一实际样本跳过。
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
      "pressureCapabilityBasis": "maximumPossibleForce > 0 permits normalization; it does not verify Pencil hardware pressure support",
      "ignoredNonPencilTouches": ignoredNonPencilTouches,
      "rules": [
        "采样: PKCanvasView 子类 touches* 重写并先调 super，公开 UIKit 接口，不抢占 PK 手势",
        "去重: 同一 touch 流内主/coalesced 相同 UIKit timestamp 跳过；真实 up/cancel 边界独立保留；不按坐标去重、不重排",
        "时间: 统一 UIKit monotonic timestamp 毫秒；t 为相对首样本，tabs 为绝对；不混用 JS Date.now",
        "压力: capability = maximumPossibleForce > 0；p = f/mf 不 clamp；能力缺失时 p 为 null",
        "估计: 样本保留 estimatedProperties/expectingUpdates 原值；迟到更新只计 lateEstimateEvents，不改写样本",
        "限额: 单笔最多 50000 样本（预留末个槽位给真实 up/cancel，超出 overflow=true）；保留最近 20 笔",
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

  // Demo protocol cancellation discards an unaccepted session; it is not a synthetic raw up.
  func discardActiveSessions() {
    lock.lock()
    defer { lock.unlock() }
    activeSessions.removeAll()
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
        // 结束事件与其 coalesced 副本共用 timestamp 时，只接收真实 main/up。
        for extra in coalesced where extra.timestamp != touch.timestamp {
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
      // 回调在主线程同步触发（触摸回调本就在主线程），view 侧只做事件派发。
      // 回调由 view 在挂载时设置，未设置时仅记录不派发。
      if let callback = onStrokeCompleted {
        callback(summary)
      }
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
    let isTerminal = phase == "up" || phase == "cancel"
    // 生命周期结束不能被相同 timestamp 的已收 move/down 吞掉。
    if !isTerminal && session.recordedTimestamps.contains(touch.timestamp) { return }
    if session.overflow && !isTerminal { return }
    let sampleLimit = isTerminal ? maxSamplesPerStroke : maxSamplesPerStroke - 1
    if session.samples.count >= sampleLimit {
      session.overflow = true
      return
    }
    session.lastTimestamp = touch.timestamp
    session.recordedTimestamps.insert(touch.timestamp)

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

    var sample: [String: Any] = [
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
    ]
    if let before = beforePencilkit[touch.timestamp] {
      sample["fBeforePencilkit"] = before.force
      sample["mfBeforePencilkit"] = before.maximum
    }
    session.samples.append(sample)
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
  var sampler = PencilkitG1Sampler.shared
  override var undoManager: UndoManager? {
    sampler === PencilkitG1Sampler.shared ? super.undoManager : nil
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    sampler.captureBeforePencilkit(touches, event: event)
    super.touchesBegan(touches, with: event)
    sampler.touchesBegan(touches, in: self)
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    sampler.captureBeforePencilkit(touches, event: event)
    super.touchesMoved(touches, with: event)
    sampler.touchesMoved(touches, event: event, in: self)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    sampler.captureBeforePencilkit(touches, event: event)
    super.touchesEnded(touches, with: event)
    sampler.touchesEnded(touches, event: event, in: self)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    sampler.captureBeforePencilkit(touches, event: event)
    super.touchesCancelled(touches, with: event)
    sampler.touchesCancelled(touches, event: event, in: self)
  }

  override func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {
    super.touchesEstimatedPropertiesUpdated(touches)
    sampler.estimatedPropertiesUpdated(touches)
  }
}
