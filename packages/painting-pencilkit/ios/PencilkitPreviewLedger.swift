// Temporary PKDrawing indices only. No PKStroke geometry enters the raw/document contract.
struct PencilkitPreviewLedger {
  struct Retirement {
    let keepIndices: [Int]
    let ids: [Int]
  }
  var usingTool = false
  var activeID: Int?
  var finishedIDs: [Int] = []
  var cancelledIDs = Set<Int>()
  var finishedToolIDs = Set<Int>()
  var retireIDs = Set<Int>()
  private var emptyIDs = Set<Int>()
  private var slots: [Int?] = []

  mutating func finishTool() {
    usingTool = false
    if let id = activeID { finishedToolIDs.insert(id) }
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
