/**
 * 阶段 2.2 补充：稀疏 hash-grid 边界行为样例（非计时、合成）
 *
 * 目的：用一个极小的确定性文档，验证「未来 core 的候选空间索引」需要支持的
 * 逻辑等价性，而不是提出产品实现，也不做性能测量：
 *   1) 稀疏 Map 网格（cellKey = `x,y`）对跨 cell 的 bbox 注册为候选；
 *      查询时对 Map bucket 候选去重 + 精确 AABB 相交，并按文档 `order` 排序；
 *   2) `MAX_CELLS_PER_OBJECT` 超限的 huge bbox 进入 `overflow` bucket，
 *      查询同时检查相关 Map bucket 与 overflow，避免把 huge bbox 无界复制进大量 cell；
 *   3) 负坐标、远正坐标、远负坐标、huge bbox 在确定性 queries 下，
 *      linear / grid 的 ID 集合、order 序列、`ids.join(',')` checksum 完全一致，否则 throw；
 *   4) 普通对象 update（先注销旧 cell/overflow 注册，再新注册）与 remove 后重新校验。
 *
 * 明确边界（详见 README.md 与输出 JSON 的 method/limitations）：
 *   - 这是非计时、合成样例，验证逻辑等价，不是产品实现、性能 benchmark，
 *     也不构成 CanvasKit / Web GPU / native 证据。
 *   - 不导入任何产品模块或依赖。
 *
 * 导出：runHashGridEdgeCases()
 */

// 每个对象最多注册进多少个 cell；超过则进入 overflow bucket，避免无界复制。
export const MAX_CELLS_PER_OBJECT = 64;

// 稀疏网格的 cell 边长（世界坐标单位）。
const CELL_SIZE = 256;

// ---------------------------------------------------------------------------
// 基础几何与文档结构
// ---------------------------------------------------------------------------

/** AABB 相交（半开，边界相接不算相交，与 run.mjs 的性能实验语义一致）。 */
function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 用 Math.floor 正确处理负坐标，返回 bbox 覆盖的整数 cell 范围与数量。 */
function cellRange(bbox, cellSize) {
  const c0 = Math.floor(bbox.x / cellSize);
  const c1 = Math.floor((bbox.x + bbox.w) / cellSize);
  const r0 = Math.floor(bbox.y / cellSize);
  const r1 = Math.floor((bbox.y + bbox.h) / cellSize);
  return { c0, c1, r0, r1, cellCount: (c1 - c0 + 1) * (r1 - r0 + 1) };
}

/** 稀疏网格的 cell key 规范形式：`x,y`（整数 cell 坐标）。 */
function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

/**
 * 文档：id -> 对象（`{ id, order, bbox }`）的 Map。
 * `order` 稳定且唯一，用于查询结果排序。
 */
function createDocument(objects) {
  const byId = new Map();
  for (const obj of objects) {
    byId.set(obj.id, { id: obj.id, order: obj.order, bbox: { ...obj.bbox } });
  }
  return { byId };
}

/** 线性查询：遍历全部对象做精确 AABB 相交，再按 order 升序返回 ID。 */
function linearQuery(doc, rect) {
  const ids = [];
  for (const obj of doc.byId.values()) {
    if (intersects(obj.bbox, rect)) ids.push(obj.id);
  }
  ids.sort((a, b) => doc.byId.get(a).order - doc.byId.get(b).order);
  return ids;
}

// ---------------------------------------------------------------------------
// 稀疏 hash-grid
// ---------------------------------------------------------------------------

/** 网格：`cells` 为 Map<cellKey, id[]>；`overflow` 为超限 huge bbox 的 id 集合。 */
function createGrid() {
  return { cellSize: CELL_SIZE, cells: new Map(), overflow: new Set() };
}

/**
 * 注册对象到网格：
 *   - 覆盖 cell 数 <= MAX_CELLS_PER_OBJECT：登记进每个 cell 的 bucket；
 *   - 超限：只登记进 overflow（避免把 huge bbox 复制进成千上万个 cell）。
 */
function registerObject(grid, obj) {
  const { c0, c1, r0, r1, cellCount } = cellRange(obj.bbox, grid.cellSize);
  if (cellCount > MAX_CELLS_PER_OBJECT) {
    grid.overflow.add(obj.id);
    return { overflow: true, cellCount };
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const key = cellKey(c, r);
      let bucket = grid.cells.get(key);
      if (!bucket) {
        bucket = [];
        grid.cells.set(key, bucket);
      }
      bucket.push(obj.id);
    }
  }
  return { overflow: false, cellCount };
}

/** 从网格注销对象：先按旧 bbox 移除 cell 登记 / overflow 登记。 */
function unregisterObject(grid, obj) {
  if (grid.overflow.has(obj.id)) {
    grid.overflow.delete(obj.id);
    return;
  }
  const { c0, c1, r0, r1 } = cellRange(obj.bbox, grid.cellSize);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const key = cellKey(c, r);
      const bucket = grid.cells.get(key);
      if (!bucket) continue;
      const idx = bucket.indexOf(obj.id);
      if (idx >= 0) bucket.splice(idx, 1);
      if (bucket.length === 0) grid.cells.delete(key);
    }
  }
}

/**
 * 网格查询：
 *   1) 遍历查询 rect 覆盖的 Map buckets，收集候选并去重；
 *   2) 无条件检查 overflow bucket（huge bbox 的候选），同样去重；
 *   3) 对候选做精确 AABB 相交，按 order 升序返回 ID。
 */
function gridQuery(doc, grid, rect) {
  const seen = new Set();
  const ids = [];
  const { c0, c1, r0, r1 } = cellRange(rect, grid.cellSize);

  const consider = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const obj = doc.byId.get(id);
    if (!obj) return; // 已 remove 的残留登记防御（本样例中应不存在）
    if (intersects(obj.bbox, rect)) ids.push(id);
  };

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = grid.cells.get(cellKey(c, r));
      if (!bucket) continue;
      for (const id of bucket) consider(id);
    }
  }
  for (const id of grid.overflow) consider(id);

  ids.sort((a, b) => doc.byId.get(a).order - doc.byId.get(b).order);
  return ids;
}

// ---------------------------------------------------------------------------
// 校验工具
// ---------------------------------------------------------------------------

/** 去重 ID 集合相等（与顺序无关）。 */
function idSetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  for (const id of a) if (!set.has(id)) return false;
  return true;
}

/** 序列逐元素相等（此处两侧都已按 order 升序）。 */
function sequencesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 稳定 sequence checksum：`ids.join(',')`。 */
function idsChecksum(ids) {
  return ids.join(',');
}

/**
 * 对一个阶段的文档/网格执行确定性 query bank 校验：
 * 比较 linear / grid 的 ID 集合、order 序列与 checksum，任一差异立即 throw。
 */
function validateStage(doc, grid, queryBank, label) {
  let idSetMatch = true;
  let documentOrderMatch = true;
  let checksumMatch = true;
  for (let q = 0; q < queryBank.length; q++) {
    const rect = queryBank[q];
    const linearIds = linearQuery(doc, rect);
    const gridIds = gridQuery(doc, grid, rect);
    const setOk = idSetsEqual(linearIds, gridIds);
    const orderOk = sequencesEqual(linearIds, gridIds);
    const checksumOk = idsChecksum(linearIds) === idsChecksum(gridIds);
    if (!setOk || !orderOk || !checksumOk) {
      throw new Error(
        `[hash-grid ${label}] query#${q} linear/grid 不一致：` +
          `rect=${JSON.stringify(rect)} ` +
          `linear=[${idsChecksum(linearIds)}] grid=[${idsChecksum(gridIds)}] ` +
          `idSetMatch=${setOk} documentOrderMatch=${orderOk} checksumMatch=${checksumOk}`,
      );
    }
    idSetMatch = idSetMatch && setOk;
    documentOrderMatch = documentOrderMatch && orderOk;
    checksumMatch = checksumMatch && checksumOk;
  }
  return { queryCount: queryBank.length, idSetMatch, documentOrderMatch, checksumMatch };
}

// ---------------------------------------------------------------------------
// 样例数据
// ---------------------------------------------------------------------------

// 初始对象：覆盖负坐标、远正、远负、huge（overflow）与两个普通对象（用于 update/remove）。
const INITIAL_OBJECTS = [
  { id: 0, order: 0, bbox: { x: 0, y: 0, w: 100, h: 80 } }, // 原点附近普通对象
  { id: 1, order: 1, bbox: { x: -600, y: -400, w: 200, h: 150 } }, // 负坐标
  { id: 2, order: 2, bbox: { x: 1e7, y: 1e7, w: 300, h: 300 } }, // 远正坐标
  { id: 3, order: 3, bbox: { x: -1e7, y: -1e7, w: 300, h: 300 } }, // 远负坐标
  { id: 4, order: 4, bbox: { x: -5e6, y: -5e6, w: 1e7, h: 1e7 } }, // huge -> overflow
  { id: 5, order: 5, bbox: { x: 500, y: 500, w: 120, h: 120 } }, // 普通对象，之后 update
  { id: 6, order: 6, bbox: { x: -200, y: 600, w: 90, h: 90 } }, // 普通对象，之后 remove
];

// update 目标：把 id=5 移到新位置（仍为普通对象）。
const UPDATE_TARGET_ID = 5;
const UPDATE_NEW_BBOX = { x: 900, y: 900, w: 60, h: 60 };

// remove 目标：移除 id=6。
const REMOVE_TARGET_ID = 6;

// huge 对象 id（用于断言 overflow 至少包含它）。
const HUGE_ID = 4;

// 确定性 query bank：分别覆盖负坐标、远正、远负、huge 内部、update/remove 区域与全域。
const QUERY_BANK = [
  { x: -100, y: -100, w: 400, h: 400 }, // 原点附近
  { x: -700, y: -500, w: 300, h: 300 }, // 负坐标区域
  { x: 1e7 - 100, y: 1e7 - 100, w: 600, h: 600 }, // 远正区域
  { x: -1e7 - 100, y: -1e7 - 100, w: 600, h: 600 }, // 远负区域
  { x: -2e6, y: -2e6, w: 500, h: 500 }, // huge 内部（只应由 overflow 命中 huge）
  { x: 450, y: 450, w: 250, h: 250 }, // update 目标原区域
  { x: 850, y: 850, w: 250, h: 250 }, // update 目标新区域
  { x: -300, y: 550, w: 250, h: 250 }, // remove 目标区域
  { x: -700, y: -600, w: 2000, h: 2000 }, // 中尺寸窗口：覆盖原点附近/负坐标/update/remove 区域
];

/** 构建初始文档 + 网格，并返回注册统计以断言 overflow 生效。 */
function buildInitial() {
  const doc = createDocument(INITIAL_OBJECTS);
  const grid = createGrid();
  const registrations = new Map();
  for (const obj of doc.byId.values()) {
    registrations.set(obj.id, registerObject(grid, obj));
  }
  return { doc, grid, registrations };
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/**
 * 运行稀疏 hash-grid 边界样例。
 * 成功时返回 JSON 安全对象，所有布尔字段均为 true；任一校验失败直接 throw。
 */
export function runHashGridEdgeCases() {
  const { doc, grid, registrations } = buildInitial();

  // --- 初始阶段 ---
  const initial = validateStage(doc, grid, QUERY_BANK, 'initial');

  // 断言 huge 确实走了 overflow，普通对象没有。
  const hugeReg = registrations.get(HUGE_ID);
  if (!hugeReg || !hugeReg.overflow) {
    throw new Error('[hash-grid initial] huge bbox 未进入 overflow bucket');
  }
  for (const [id, reg] of registrations) {
    if (id !== HUGE_ID && reg.overflow) {
      throw new Error(`[hash-grid initial] 非 huge 对象 id=${id} 意外进入 overflow`);
    }
  }

  const overflowObjectIds = [...grid.overflow].sort((a, b) => a - b);
  if (!overflowObjectIds.includes(HUGE_ID)) {
    throw new Error('[hash-grid initial] overflow 未包含 huge ID');
  }

  // --- update：先注销旧 cell/overflow 注册，再写入新 bbox 并重新注册 ---
  const updateObj = doc.byId.get(UPDATE_TARGET_ID);
  if (!updateObj) throw new Error('[hash-grid update] 找不到 update 目标对象');
  unregisterObject(grid, updateObj); // 按旧 bbox 注销
  updateObj.bbox = { ...UPDATE_NEW_BBOX };
  registerObject(grid, updateObj); // 按新 bbox 注册
  const afterUpdate = validateStage(doc, grid, QUERY_BANK, 'afterUpdate');

  // --- remove：注销后从文档删除并重新校验 ---
  const removeObj = doc.byId.get(REMOVE_TARGET_ID);
  if (!removeObj) throw new Error('[hash-grid remove] 找不到 remove 目标对象');
  unregisterObject(grid, removeObj);
  doc.byId.delete(REMOVE_TARGET_ID);
  const afterRemove = validateStage(doc, grid, QUERY_BANK, 'afterRemove');

  // 允许三种校验结果的“全 true”聚合断言。
  const allTrue =
    initial.idSetMatch &&
    initial.documentOrderMatch &&
    initial.checksumMatch &&
    afterUpdate.idSetMatch &&
    afterUpdate.documentOrderMatch &&
    afterUpdate.checksumMatch &&
    afterRemove.idSetMatch &&
    afterRemove.documentOrderMatch &&
    afterRemove.checksumMatch;
  if (!allTrue) {
    throw new Error('[hash-grid] 存在未通过的校验（不应发生，validateStage 已 throw）');
  }

  return {
    cellSize: grid.cellSize,
    maxCellsPerObject: MAX_CELLS_PER_OBJECT,
    initial,
    afterUpdate,
    afterRemove,
    overflow: {
      used: overflowObjectIds.length > 0,
      objectIds: overflowObjectIds,
    },
  };
}
