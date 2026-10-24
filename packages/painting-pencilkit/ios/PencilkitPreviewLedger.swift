// Temporary PKDrawing indices only. No PKStroke geometry enters the raw/document contract.
struct PencilkitPreviewLedger {
  struct Retirement {
    let keepIndices: [Int]
    let ids: [Int]
  }
  private struct ToolCycle {
    var id: Int?
    var finished = false
    var cancelled = false
  }
  private var tools: [ToolCycle] = []
  private var rawBegins: [Int] = []
  var usingTool: Bool { tools.contains { !$0.finished && !$0.cancelled } }
  var finishedIDs: [Int] = []
  var cancelledIDs = Set<Int>()
  var finishedToolIDs = Set<Int>()
  var retireIDs = Set<Int>()
  private var emptyIDs = Set<Int>()
  private var slots: [Int?] = []

  mutating func beginStroke(_ id: Int) {
    rawBegins.append(id)
    bindTools()
  }

  mutating func beginTool() {
    tools.append(ToolCycle())
    bindTools()
  }

  mutating func finishTool() {
    guard let index = tools.firstIndex(where: { !$0.finished }) else { return }
    tools[index].finished = true
    bindTools()
  }

  mutating func cancelTool(for id: Int) {
    rawBegins.removeAll { $0 == id }
    for index in tools.indices where tools[index].id == id { tools[index].cancelled = true }
    finishedToolIDs.insert(id)
  }

  private mutating func bindTools() {
    // Match begin order, never the latest raw ID at finish time. Either begin source may arrive first.
    for index in tools.indices where tools[index].id == nil && !rawBegins.isEmpty {
      tools[index].id = rawBegins.removeFirst()
    }
    for tool in tools where tool.finished || tool.cancelled {
      if let id = tool.id { finishedToolIDs.insert(id) }
    }
    tools.removeAll { $0.finished && $0.id != nil }
  }

  mutating func reconcile(strokeCount: Int) -> Retirement? {
    guard !usingTool, strokeCount >= slots.count else { return nil }
    slots.append(contentsOf: Array(repeating: nil, count: strokeCount - slots.count))
    while let id = finishedIDs.first, finishedToolIDs.contains(id) {
      if let index = slots.firstIndex(where: { $0 == nil }) { slots[index] = id }
      else if cancelledIDs.contains(id) { emptyIDs.insert(id) }
      else { break }
      finishedIDs.removeFirst()
      finishedToolIDs.remove(id)
      cancelledIDs.remove(id)
    }
    let removed = slots.compactMap { $0 }.filter { retireIDs.contains($0) }
    let empty = emptyIDs.filter { retireIDs.contains($0) }
    let ids = removed + empty
    let keep = slots.indices.filter { index in
      guard let id = slots[index] else { return true }
      return !retireIDs.contains(id)
    }
    slots = keep.map { slots[$0] }
    retireIDs.subtract(ids)
    emptyIDs.subtract(ids)
    return Retirement(keepIndices: keep, ids: ids)
  }
}
