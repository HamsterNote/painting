#!/usr/bin/env node
/**
 * 阶段 2.2：大坐标与性能 spike（纯 Node，零新增依赖）
 *
 * 目的：采集两类数据：
 *   1) 精度：大世界坐标量级下的 float32 最小可分辨步长；
 *      以及 double 参考实现与 float32 affine 映射（正变换 / 逆变换 / round-trip）
 *      在常见 scale 与极端 scale、大平移下的误差与有限性。
 *   2) 性能：确定性矩形对象文档（1k / 10k / 100k）下，
 *      「线性 visible-bounds 查询」与「候选 uniform grid 查询」的耗时分布（p50/p95/max）
 *      与命中数、网格候选数。
 *
 * 重要边界（详见 README.md 与输出 JSON 的 method/limitations 字段）：
 *   - 本脚本是独立实验，不导入 packages/painting/src/viewport.ts 或任何产品模块、
 *     React / DOM / Skia / DrawingSurface。affine 公式为内联复刻，与当前纯 viewport 同构，
 *     但不是产品运行时。
 *   - Node 端数学不是 CanvasKit GPU 路径，性能只反映 JS/CPU 相对趋势；
 *     理论 float32 精度不足以直接断言渲染失效。
 *   - 网格索引仅为「候选决策对照」，不代表产品已实现空间索引。
 *   - 本脚本不设定任何最终性能阈值，也不作 CanvasKit / native 结论。
 *
 * 运行：node spikes/coordinate-performance/run.mjs
 * 输出：artifacts/research/coordinate-performance/
 *        coordinate-performance-measurements.json（稳定覆盖）
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { runHashGridEdgeCases } from './hash-grid-edge-cases.mjs';

// 本脚本所在目录（用于定位仓库根与输出路径）
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const OUTPUT_PATH = resolve(
  REPO_ROOT,
  'artifacts/research/coordinate-performance/coordinate-performance-measurements.json'
);

// ---------------------------------------------------------------------------
// 一、affine 数学（内联复刻 packages/painting/src/viewport.ts 的语义，同构而非产品运行时）
// ---------------------------------------------------------------------------

const MIN_VIEWPORT_SCALE = 0.25;
const MAX_VIEWPORT_SCALE = 8;

/** 与 viewport.ts 相同的 scale 夹取语义（仅用于产品同构路径） */
function clampScale(scale) {
  if (Number.isNaN(scale)) return 1;
  return Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, scale));
}

function safeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * canvasToScreen 同构实现。
 * clamp=true 时复刻 viewport.ts 的 normalizeViewport 夹取；
 * clamp=false 时使用原始 scale，仅用于考察超出产品范围的极端 scale 的 f32 数学行为。
 */
function canvasToScreen(point, viewport, clamp = true) {
  const scale = clamp ? clampScale(viewport.scale) : safeNumber(viewport.scale, 1);
  const tx = safeNumber(viewport.tx, 0);
  const ty = safeNumber(viewport.ty, 0);
  const x = safeNumber(point.x, 0);
  const y = safeNumber(point.y, 0);
  return { x: x * scale + tx, y: y * scale + ty };
}

/** screenToCanvas 同构实现。 */
function screenToCanvas(point, viewport, clamp = true) {
  const scale = clamp ? clampScale(viewport.scale) : safeNumber(viewport.scale, 1);
  const tx = safeNumber(viewport.tx, 0);
  const ty = safeNumber(viewport.ty, 0);
  const x = safeNumber(point.x, 0);
  const y = safeNumber(point.y, 0);
  return { x: (x - tx) / scale, y: (y - ty) / scale };
}

// ---------------------------------------------------------------------------
// 二、float32 工具
// ---------------------------------------------------------------------------

/** 返回 value 在 float32 方向上的下一个可表示值（按 IEEE-754 位模式加一）。 */
function nextUpFloat32(value) {
  if (Number.isNaN(value)) return NaN;
  if (value === Infinity) return Infinity;
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, value, false);
  let bits = dv.getUint32(0, false);
  bits = value >= 0 ? (bits + 1) >>> 0 : (bits - 1) >>> 0;
  dv.setUint32(0, bits, false);
  return dv.getFloat32(0, false);
}

/**
 * 用 Math.fround 确定 value 的 float32 表示，再取相邻 float32 值之差，
 * 作为该量级下 float32 的最小可分辨步长（ulp）。
 */
function minResolvableStep(value) {
  const base = Math.fround(value);
  if (!Number.isFinite(base)) return Infinity;
  const next = nextUpFloat32(base);
  return next - base;
}

/**
 * 返回 value 在 float64（IEEE-754 double）方向上的下一个可表示值。
 * 用 8-byte DataView 直接读写 IEEE-754 位模式：
 *   - NaN 原样返回；
 *   - +Infinity 返回 +Infinity，-Infinity 返回 -Number.MAX_VALUE；
 *   - +0 / -0 均返回最小正次正规数 Number.MIN_VALUE（符合 IEEE nextUp(±0)）；
 *   - 正有限数位模式 +1，负有限数位模式 -1（向 +∞ 方向移动）。
 */
function nextUpFloat64(value) {
  if (Number.isNaN(value)) return NaN;
  if (value === Infinity) return Infinity;
  if (value === -Infinity) return -Number.MAX_VALUE;
  if (value === 0) return Number.MIN_VALUE;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, value, false);
  const bits = dv.getBigUint64(0, false);
  dv.setBigUint64(0, value > 0 ? bits + 1n : bits - 1n, false);
  return dv.getFloat64(0, false);
}

/**
 * 基于 nextUpFloat64 计算 double ULP：取 value 与相邻 double 之差，
 * 作为该量级下 float64 的最小可分辨步长。
 */
function minResolvableStepFloat64(value) {
  if (!Number.isFinite(value)) return Infinity;
  const next = nextUpFloat64(value);
  return next - value;
}

// 供 JSON 序列化：把 Infinity / NaN 转成字符串，避免 stringify 变成 null
function jnum(v) {
  if (Number.isFinite(v)) return v;
  if (Number.isNaN(v)) return 'NaN';
  return v > 0 ? 'Infinity' : '-Infinity';
}

/** 最近邻百分位（先排序的数组 + 分位点）。方法写入 JSON，避免歧义。 */
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// 三、原始输入（全部写入 JSON，保证可复现）
// ---------------------------------------------------------------------------

const WORLD_MAGNITUDES = [1e3, 1e6, 1e7, 1e8, 1e9, 2 ** 24, 2 ** 53];

// 用于考察「大基座 + 小偏移」下偏移是否被 float32 吞掉
const OFFSET_PROBES = [1, 0.5, 0.1, 0.01];

// scale：0.25 / 1 / 8 为产品 viewport 支持范围；1e-6 / 1e6 为刻意越界的极端值
const AFFINE_SCALES = [0.25, 1, 8, 1e-6, 1e6];
// 平移量级：覆盖大平移
const AFFINE_TRANSLATIONS = [0, 1e3, 1e6, 1e9];

// affine 精度考察用的确定性世界坐标点集（同时覆盖大数量级与接近 0 的值）
const AFFINE_POINTS = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.1 },
  { x: 1, y: 1 },
  { x: 1e3, y: 1e3 },
  { x: 1e6, y: 1e6 },
  { x: 2 ** 24, y: 2 ** 24 },
  { x: 1e9, y: 1e9 },
  { x: 2 ** 53, y: 2 ** 53 },
  { x: -1e9, y: -1e9 },
];

// 性能场景：确定性矩形文档
const PERF_OBJECT_COUNTS = [1000, 10000, 100000];
const PERF_WORLD_SIZE = 4096;
const PERF_MIN_OBJ_SIZE = 8;
const PERF_MAX_OBJ_SIZE = 48;
const PERF_CELL_SIZE = 256;
const PERF_SEED = 0x5eed1234;
const PERF_WARMUP_ROUNDS = 5;
const PERF_MEASURED_ROUNDS = 30;
const PERF_QUERY_GRID = 4; // 4x4 = 16 个查询窗口，确定性平铺
const PERF_QUERY_W = 800;
const PERF_QUERY_H = 600;

// ---------------------------------------------------------------------------
// 四、精度实验
// ---------------------------------------------------------------------------

function runMinStepTable() {
  return WORLD_MAGNITUDES.map((magnitude) => {
    const f32 = Math.fround(magnitude);
    const step = minResolvableStep(magnitude);
    // 用 Math.fround 验证步长前后行为，确认步长定义
    const stepped = Math.fround(magnitude + step);
    const halfStepped = Math.fround(magnitude + step / 2);
    // 大基座 + 小偏移：偏移能否在 float32 中分辨
    const offsetResolution = OFFSET_PROBES.map((offset) => {
      const resolved = Math.fround(magnitude + offset) - Math.fround(magnitude);
      return { offset, resolvedDelta: jnum(resolved), lost: resolved === 0 };
    });
    return {
      magnitude,
      magnitudeAsPow2: Number.isInteger(Math.log2(magnitude)) ? Math.log2(magnitude) : null,
      float32Value: jnum(f32),
      float32MinStep: jnum(step),
      float32RelativeStep: jnum(step / magnitude),
      representableInFloat32: Number.isFinite(f32),
      roundAbsError: jnum(f32 - magnitude),
      roundRelError: jnum((f32 - magnitude) / magnitude),
      froundStepChanged: stepped !== f32,
      froundHalfStepChanged: halfStepped !== f32,
      offsetResolution,
    };
  });
}

/**
 * 采集 double 参考 affine 与 float32 affine 的误差。
 * float32 路径：对输入、scale、tx、中间乘积与加法分别做 Math.fround，
 * 模拟「全链路 float32」映射；这是理论模拟，不代表 CanvasKit 的真实实现。
 */
function runAffineTable() {
  const rows = [];
  for (const scale of AFFINE_SCALES) {
    const withinProductRange = scale >= MIN_VIEWPORT_SCALE && scale <= MAX_VIEWPORT_SCALE;
    for (const translation of AFFINE_TRANSLATIONS) {
      const viewport = { scale, tx: translation, ty: translation };
      const clamped = canvasToScreen({ x: 0, y: 0 }, viewport, true);
      const rawScale = safeNumber(scale, 1);

      let maxFwdAbsErr = 0;
      let maxFwdRelErr = 0;
      let maxInvAbsErr = 0;
      let maxRtAbsErr = 0;
      let maxF32RtAbsErr = 0;
      let anyNonFinite = false;

      for (const p of AFFINE_POINTS) {
        const fwdDouble = canvasToScreen(p, viewport, false);
        const xf = Math.fround(p.x);
        const yf = Math.fround(p.y);
        const sf = Math.fround(rawScale);
        const tf = Math.fround(translation);
        const fwdF32 = {
          x: Math.fround(Math.fround(xf * sf) + tf),
          y: Math.fround(Math.fround(yf * sf) + tf),
        };
        if (!Number.isFinite(fwdF32.x) || !Number.isFinite(fwdF32.y)) anyNonFinite = true;
        maxFwdAbsErr = Math.max(
          maxFwdAbsErr,
          Math.abs(fwdF32.x - fwdDouble.x),
          Math.abs(fwdF32.y - fwdDouble.y)
        );
        const denomX = Math.abs(fwdDouble.x) > 0 ? Math.abs(fwdDouble.x) : 1;
        const denomY = Math.abs(fwdDouble.y) > 0 ? Math.abs(fwdDouble.y) : 1;
        maxFwdRelErr = Math.max(
          maxFwdRelErr,
          Math.abs(fwdF32.x - fwdDouble.x) / denomX,
          Math.abs(fwdF32.y - fwdDouble.y) / denomY
        );

        // double round-trip：canvas -> screen -> canvas
        const backDouble = screenToCanvas(fwdDouble, viewport, false);
        maxRtAbsErr = Math.max(
          maxRtAbsErr,
          Math.abs(backDouble.x - p.x),
          Math.abs(backDouble.y - p.y)
        );

        // f32 逆变换误差（以 double 正变换结果为屏幕输入）
        const invF32 = {
          x: Math.fround(Math.fround(Math.fround(fwdDouble.x) - tf) / sf),
          y: Math.fround(Math.fround(Math.fround(fwdDouble.y) - tf) / sf),
        };
        if (!Number.isFinite(invF32.x) || !Number.isFinite(invF32.y)) anyNonFinite = true;
        maxInvAbsErr = Math.max(maxInvAbsErr, Math.abs(invF32.x - p.x), Math.abs(invF32.y - p.y));

        // f32 round-trip：f32 正变换 -> f32 逆变换
        const f32back = {
          x: Math.fround(Math.fround(fwdF32.x - tf) / sf),
          y: Math.fround(Math.fround(fwdF32.y - tf) / sf),
        };
        maxF32RtAbsErr = Math.max(
          maxF32RtAbsErr,
          Math.abs(f32back.x - p.x),
          Math.abs(f32back.y - p.y)
        );
      }

      rows.push({
        scale,
        translation,
        withinProductScaleRange: withinProductRange,
        effectiveClampedScale: clampScale(scale),
        clampedOriginToScreen: { x: clamped.x, y: clamped.y },
        maxForwardAbsError: jnum(maxFwdAbsErr),
        maxForwardRelError: jnum(maxFwdRelErr),
        maxInverseAbsError: jnum(maxInvAbsErr),
        maxDoubleRoundTripAbsError: jnum(maxRtAbsErr),
        maxFloat32RoundTripAbsError: jnum(maxF32RtAbsErr),
        anyNonFinite,
      });
    }
  }
  return rows;
}

/**
 * float64 最小可分辨步长表：对每个世界坐标量级，用 nextUpFloat64 取 double ULP。
 * 每项至少含 magnitude、float64MinStep、finite（isFinite 判断）。
 */
function runFloat64MinStepTable() {
  return WORLD_MAGNITUDES.map((magnitude) => ({
    magnitude,
    float64MinStep: jnum(minResolvableStepFloat64(magnitude)),
    finite: Number.isFinite(magnitude) && Number.isFinite(minResolvableStepFloat64(magnitude)),
  }));
}

/**
 * cameraOriginRebase：f64-to-f32 输入预算示例。
 * 固定 global=(1000000000.125, -1000000000.125)、origin=(1000000000, -1000000000)、scale=1。
 * 先做 JS number（f64）减法得到 local，再用 Math.fround 模拟 f32 local affine 得到 screen，
 * 记录逐轴误差与有限性。本实验只说明「重基后的 f32 输入是否可表示」，
 * 不代表 CanvasKit / native 的真实实现或视觉结论。
 */
function runCameraOriginRebase() {
  const global = { x: 1000000000.125, y: -1000000000.125 };
  const origin = { x: 1000000000, y: -1000000000 };
  const scale = 1;

  // 1) JS number（f64）减法得 local，保留 global 中相对于 origin 的小偏移
  const local = { x: global.x - origin.x, y: global.y - origin.y };

  // 2) 用 Math.fround 模拟 f32 local affine：local、scale 分别 fround，平移为 0
  const scaleF32 = Math.fround(scale);
  const screen = {
    x: Math.fround(Math.fround(local.x) * scaleF32 + 0),
    y: Math.fround(Math.fround(local.y) * scaleF32 + 0),
  };

  // double 参考：local 经同一 affine（scale=1、平移 0）的精确结果
  const screenDouble = { x: local.x * scale, y: local.y * scale };

  const perAxisError = {
    x: jnum(screen.x - screenDouble.x),
    y: jnum(screen.y - screenDouble.y),
  };
  const allFinite = [global.x, global.y, local.x, local.y, screen.x, screen.y].every(
    Number.isFinite
  );

  return {
    global: { x: jnum(global.x), y: jnum(global.y) },
    origin: { x: jnum(origin.x), y: jnum(origin.y) },
    scale,
    local: { x: jnum(local.x), y: jnum(local.y) },
    screen: { x: jnum(screen.x), y: jnum(screen.y) },
    screenDouble: { x: jnum(screenDouble.x), y: jnum(screenDouble.y) },
    perAxisError,
    allFinite,
  };
}

/** 确定性 PRNG（mulberry32），保证每次运行生成相同文档。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性生成矩形对象文档：位置平铺于世界范围，宽高在 [MIN, MAX) 内。 */
function generateDocument(count) {
  const rnd = mulberry32(PERF_SEED + count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const ws = new Float64Array(count);
  const hs = new Float64Array(count);
  const span = PERF_MAX_OBJ_SIZE - PERF_MIN_OBJ_SIZE;
  const usable = PERF_WORLD_SIZE - PERF_MAX_OBJ_SIZE;
  for (let i = 0; i < count; i++) {
    const w = PERF_MIN_OBJ_SIZE + rnd() * span;
    const h = PERF_MIN_OBJ_SIZE + rnd() * span;
    xs[i] = rnd() * usable;
    ys[i] = rnd() * usable;
    ws[i] = w;
    hs[i] = h;
  }
  return { count, xs, ys, ws, hs };
}

function intersects(doc, i, rect) {
  const x = doc.xs[i];
  const y = doc.ys[i];
  return (
    x < rect.x + rect.w && x + doc.ws[i] > rect.x && y < rect.y + rect.h && y + doc.hs[i] > rect.y
  );
}

/** 线性 visible-bounds 查询：遍历全部对象做 AABB 相交测试。 */
function linearQuery(doc, rect) {
  let hits = 0;
  for (let i = 0; i < doc.count; i++) if (intersects(doc, i, rect)) hits++;
  return hits;
}

/** 构建均匀网格索引（仅作为候选决策对照）。 */
function buildGrid(doc) {
  const cols = Math.ceil(PERF_WORLD_SIZE / PERF_CELL_SIZE);
  const rows = Math.ceil(PERF_WORLD_SIZE / PERF_CELL_SIZE);
  const buckets = new Array(cols * rows);
  for (let k = 0; k < buckets.length; k++) buckets[k] = [];

  const clampCell = (c) => Math.max(0, Math.min(cols - 1, c));
  const clampRow = (r) => Math.max(0, Math.min(rows - 1, r));

  for (let i = 0; i < doc.count; i++) {
    const c0 = clampCell(Math.floor(doc.xs[i] / PERF_CELL_SIZE));
    const c1 = clampCell(Math.floor((doc.xs[i] + doc.ws[i]) / PERF_CELL_SIZE));
    const r0 = clampRow(Math.floor(doc.ys[i] / PERF_CELL_SIZE));
    const r1 = clampRow(Math.floor((doc.ys[i] + doc.hs[i]) / PERF_CELL_SIZE));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(i);
    }
  }
  return { cols, rows, buckets, seen: new Int32Array(doc.count), epoch: 0 };
}

/** 候选 uniform grid 查询：先取覆盖单元格内候选，去重后再做精确相交。 */
function gridQuery(doc, grid, rect) {
  const { cols, rows, buckets, seen } = grid;
  const epoch = ++grid.epoch;
  const clampCell = (c) => Math.max(0, Math.min(cols - 1, c));
  const clampRow = (r) => Math.max(0, Math.min(rows - 1, r));
  const c0 = clampCell(Math.floor(rect.x / PERF_CELL_SIZE));
  const c1 = clampCell(Math.floor((rect.x + rect.w) / PERF_CELL_SIZE));
  const r0 = clampRow(Math.floor(rect.y / PERF_CELL_SIZE));
  const r1 = clampRow(Math.floor((rect.y + rect.h) / PERF_CELL_SIZE));

  let candidates = 0;
  let hits = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = buckets[r * cols + c];
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        if (seen[i] === epoch) continue;
        seen[i] = epoch;
        candidates++;
        if (intersects(doc, i, rect)) hits++;
      }
    }
  }
  return { candidates, hits };
}

// 以下三个为「不计时正确性校验」专用：返回完整命中 ID 数组，
// 与计时热路径（只累计 count/candidates）分离，避免热路径引入数组分配。

/** 线性查询完整命中 ID（按文档 index 升序，天然无重复）。 */
function linearQueryIds(doc, rect) {
  const ids = [];
  for (let i = 0; i < doc.count; i++) if (intersects(doc, i, rect)) ids.push(i);
  return ids;
}

/** 网格查询完整命中 ID：候选去重后精确相交，再按 index 升序恢复文档顺序。 */
function gridQueryIds(doc, grid, rect) {
  const { cols, rows, buckets, seen } = grid;
  const epoch = ++grid.epoch;
  const clampCell = (c) => Math.max(0, Math.min(cols - 1, c));
  const clampRow = (r) => Math.max(0, Math.min(rows - 1, r));
  const c0 = clampCell(Math.floor(rect.x / PERF_CELL_SIZE));
  const c1 = clampCell(Math.floor((rect.x + rect.w) / PERF_CELL_SIZE));
  const r0 = clampRow(Math.floor(rect.y / PERF_CELL_SIZE));
  const r1 = clampRow(Math.floor((rect.y + rect.h) / PERF_CELL_SIZE));

  const ids = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = buckets[r * cols + c];
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k];
        if (seen[i] === epoch) continue;
        seen[i] = epoch;
        if (intersects(doc, i, rect)) ids.push(i);
      }
    }
  }
  ids.sort((a, b) => a - b);
  return ids;
}

/** 升序 ID 序列逐元素相等。 */
function idsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

/** 去重 ID 集合相等（与顺序无关）。 */
function idSetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  for (const id of a) if (!set.has(id)) return false;
  return true;
}

/** 稳定 sequence checksum：以逗号 join 的 index 序列字符串。 */
function idsChecksum(ids) {
  return ids.join(',');
}

/**
 * 不计时的索引正确性校验：对 query bank 内每个 rect，
 * 分别收集 linear 与 grid 的完整命中 ID，比较去重集合、文档顺序序列与 checksum。
 * 任何差异立即 throw，避免把错误索引当作有效性能对照。
 */
function runGridCorrectness(doc, grid, bank) {
  let idSetMatch = true;
  let documentOrderMatch = true;
  let checksumMatch = true;
  for (const rect of bank) {
    const linearIds = linearQueryIds(doc, rect);
    const gridIds = gridQueryIds(doc, grid, rect);
    const setOk = idSetsEqual(linearIds, gridIds);
    const orderOk = idsEqual(linearIds, gridIds);
    const checksumOk = idsChecksum(linearIds) === idsChecksum(gridIds);
    if (!setOk || !orderOk || !checksumOk) {
      throw new Error(
        `grid/linear 命中不一致：rect=${JSON.stringify(rect)} ` +
          `idSetMatch=${setOk} documentOrderMatch=${orderOk} checksumMatch=${checksumOk}`
      );
    }
    idSetMatch = idSetMatch && setOk;
    documentOrderMatch = documentOrderMatch && orderOk;
    checksumMatch = checksumMatch && checksumOk;
  }
  return { idSetMatch, documentOrderMatch, checksumMatch, queryCount: bank.length };
}

/** 确定性查询窗口集合：4x4 平铺，覆盖世界范围。 */
function buildQueryBank() {
  const bank = [];
  for (let gy = 0; gy < PERF_QUERY_GRID; gy++) {
    for (let gx = 0; gx < PERF_QUERY_GRID; gx++) {
      bank.push({
        x: ((gx + 0.5) / PERF_QUERY_GRID) * PERF_WORLD_SIZE - PERF_QUERY_W / 2,
        y: ((gy + 0.5) / PERF_QUERY_GRID) * PERF_WORLD_SIZE - PERF_QUERY_H / 2,
        w: PERF_QUERY_W,
        h: PERF_QUERY_H,
      });
    }
  }
  return bank;
}

function summarizeDurations(durationsMs) {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    rounds: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0],
    meanMs: sum / sorted.length,
  };
}

/**
 * 对一个文档分别测量线性查询与网格候选查询。
 * 每个文档先生成文档与网格，再做 warmup 与 measured 轮；每轮遍历整个查询窗口集合。
 */
function runPerfScenario(count) {
  const doc = generateDocument(count);
  const bank = buildQueryBank();

  // 网格构建耗时（一次性）
  const buildStart = process.hrtime.bigint();
  const grid = buildGrid(doc);
  const buildEnd = process.hrtime.bigint();
  const buildMs = Number(buildEnd - buildStart) / 1e6;

  const measure = (kind, rounds) => {
    const durations = [];
    let hits = 0;
    let candidates = 0;
    for (let r = 0; r < rounds; r++) {
      let roundHits = 0;
      let roundCandidates = 0;
      const start = process.hrtime.bigint();
      for (const rect of bank) {
        if (kind === 'linear') {
          roundHits += linearQuery(doc, rect);
        } else {
          const res = gridQuery(doc, grid, rect);
          roundHits += res.hits;
          roundCandidates += res.candidates;
        }
      }
      const end = process.hrtime.bigint();
      durations.push(Number(end - start) / 1e6);
      hits = roundHits;
      candidates = roundCandidates;
    }
    return { durations, hits, candidates };
  };

  // 预热（两种查询都预热，避免 JIT 冷启动偏差）
  measure('linear', PERF_WARMUP_ROUNDS);
  measure('grid', PERF_WARMUP_ROUNDS);

  const linear = measure('linear', PERF_MEASURED_ROUNDS);
  const gridResult = measure('grid', PERF_MEASURED_ROUNDS);

  const linearStats = summarizeDurations(linear.durations);
  const gridStats = summarizeDurations(gridResult.durations);

  // 不计时正确性校验放在所有计时轮之后：ID 数组分配与 JIT 不会影响上面的耗时测量。
  const correctness = runGridCorrectness(doc, grid, bank);

  return {
    objectCount: count,
    worldSize: PERF_WORLD_SIZE,
    cellSize: PERF_CELL_SIZE,
    gridCols: grid.cols,
    gridRows: grid.rows,
    queryBankSize: bank.length,
    queryWindow: { w: PERF_QUERY_W, h: PERF_QUERY_H },
    rounds: { warmup: PERF_WARMUP_ROUNDS, measured: PERF_MEASURED_ROUNDS },
    gridBuildMs: buildMs,
    correctness,
    linear: {
      p50Ms: linearStats.p50Ms,
      p95Ms: linearStats.p95Ms,
      maxMs: linearStats.maxMs,
      minMs: linearStats.minMs,
      meanMs: linearStats.meanMs,
      hitsPerRound: linear.hits,
      candidatesPerRound: null,
    },
    candidateGrid: {
      p50Ms: gridStats.p50Ms,
      p95Ms: gridStats.p95Ms,
      maxMs: gridStats.maxMs,
      minMs: gridStats.minMs,
      meanMs: gridStats.meanMs,
      hitsPerRound: gridResult.hits,
      candidatesPerRound: gridResult.candidates,
      avgCandidatesPerQuery: gridResult.candidates / bank.length,
    },
    hitsMatchBetweenQueries: linear.hits === gridResult.hits,
  };
}

// ---------------------------------------------------------------------------
// 六、环境信息与主流程
// ---------------------------------------------------------------------------

function collectEnvironment() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus.length > 0 ? cpus[0].model : null,
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    hostname: os.hostname(),
    timingSource: 'process.hrtime.bigint()（单调纳秒时钟，转换为毫秒）',
    note: 'Node/CPU 环境信息仅用于标注测量条件，不构成跨机可比性保证。',
  };
}

function buildDocument() {
  return {
    spike: 'phase-2.2-coordinate-performance',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: 'node spikes/coordinate-performance/run.mjs',
    method: {
      isolation:
        '独立 spike：不导入 packages/painting、React、DOM、Skia、DrawingSurface 或任何产品依赖。',
      affineIsomorphism:
        'affine 公式为对 packages/painting/src/viewport.ts 中 canvasToScreen/screenToCanvas 与 normalizeViewport(scale 夹取) 的内联复刻，与其同构；但本脚本不是产品运行时，不消费产品代码。',
      float32MinStep:
        '先以 Math.fround 取 float32 表示，再用 IEEE-754 相邻位模式（DataView nextUp）之差作为该量级最小可分辨步长；并用 Math.fround 验证 step 会改变值、step/2 不会。',
      float64MinStep:
        '用 8-byte DataView 按 IEEE-754 位模式实现 nextUpFloat64（正确处理 NaN、±Infinity、±0、正负有限数），再取 value 与相邻 double 之差作为 float64 最小可分辨步长（double ULP）。',
      cameraOriginRebase:
        '固定 global=(1000000000.125, -1000000000.125)、origin=(1000000000, -1000000000)、scale=1；先做 JS number（f64）减法得 local，再用 Math.fround 模拟 f32 local affine 得 screen，比较 double 参考并记录逐轴误差与有限性。这是 f64-to-f32 输入预算示例，非 CanvasKit / native / 视觉结论；重基不能恢复在接近 2^53 已丢失的 JS number 精度。',
      float32Affine:
        '对输入坐标、scale、平移及每步中间结果分别做 Math.fround，模拟全链路 float32 affine；double 参考使用纯 JS number 公式。',
      extremeScales:
        'scale 1e-6 / 1e6 超出产品 viewport 支持范围 [0.25, 8]；对该极端值使用未夹取的原始 scale，仅用于考察 f32 数学，不代表产品会接受该 scale。',
      performance:
        '确定性 mulberry32 生成矩形文档；每档对象数先用同样方法预热若干轮，再做 30 轮测量；每轮遍历 4x4=16 个确定性查询窗口。耗时用 process.hrtime.bigint()。',
      gridRole:
        'uniform grid 仅为「候选决策对照」，用于比较可见区域查询的候选规模与耗时趋势，不代表产品已实现或选定该空间索引。',
      gridCorrectness:
        '不计时校验：对 4x4=16 个固定 query rect，分别收集 linear 与 grid（候选去重后精确相交）的完整命中 index ID，比较去重集合、按升序恢复的文档顺序序列与逗号 join 的 checksum；任一差异 throw。该 validation 只证明此固定生成文档与该 16-query bank 上两种查询一致，非实际产品 / CanvasKit / native 性能或行为结论。',
      percentiles: '最近邻百分位：对 30 个样本升序后取 floor(p*(n-1)) 的下标。',
      hashGridEdgeCases:
        '非计时、合成样例（spikes/coordinate-performance/hash-grid-edge-cases.mjs）：用小型确定性文档验证未来 core 候选索引需要支持的逻辑等价——稀疏 Map 网格（cellKey=`x,y`）跨 cell 注册候选、候选去重 + 精确相交 + 按 order 排序；MAX_CELLS_PER_OBJECT 超限的 huge bbox 进入 overflow，查询同时检查相关 Map bucket 与 overflow 以避免无界复制；负坐标/远正/远负/huge bbox 的确定性 queries 下 linear/grid 的 ID 集合、order 序列、ids.join(",") checksum 一致，另含 update（先注销旧 cell/overflow 再注册）与 remove 后重新校验。任一差异 throw。这是逻辑等价验证，不是产品实现、性能 benchmark，也不是 CanvasKit/Web GPU/native 证据。',
    },
    limitations: [
      'Node 端纯 JS 数学与计时不是 CanvasKit / Skia GPU 渲染路径，性能数值不能外推为端上渲染性能。',
      '理论 float32 精度只描述坐标可分辨性，不能据此断言某场景一定发生渲染失效；真实失效还取决于渲染管线、变换层级与绘制实现。',
      'affine 精度为全链路 float32 的保守模拟，CanvasKit 真实实现可能使用 double 或不同中间精度，结论需以实际实现为准。',
      'uniform grid 结果是候选决策对照，不代表产品空间索引已实现或已决策。',
      'grid correctness 校验只覆盖本脚本固定生成的文档与 4x4=16 固定 query bank，不能推广为实际产品 / CanvasKit / native 的性能或行为结论。',
      '本 spike 不设定任何最终性能阈值，也不作 CanvasKit / native / 默认渲染器的结论。',
      'cameraOriginRebase 是 f64-to-f32 输入预算示例（重基后 local 的 f32 输入可表示性），非 CanvasKit / native / 视觉结论。',
      '重基不能恢复在接近 2^53 已丢失的 JS number 精度：若 global 本身在 f64 层面已无法分辨某偏移，先减 origin 也无法找回。',
      '单机单次运行，未做多机、多进程、GC 隔离或多版本 Node 对照，时序数据存在噪声。',
      'hashGridEdgeCases 是非计时、合成的逻辑等价样例，仅验证未来 core 候选索引需要支持负 key / overflow / update / remove 的行为等价；它不是产品实现、性能 benchmark，也不构成 CanvasKit / Web GPU / native 证据。',
      'hashGridEdgeCases 的 correctness 只覆盖其内置的固定小型文档与固定 query bank（9 条），不能推广为实际产品行为或性能结论。',
    ],
    environment: collectEnvironment(),
    inputs: {
      precision: {
        worldMagnitudes: WORLD_MAGNITUDES,
        offsetProbes: OFFSET_PROBES,
        affineScales: AFFINE_SCALES,
        affineTranslations: AFFINE_TRANSLATIONS,
        affinePoints: AFFINE_POINTS,
      },
      performance: {
        objectCounts: PERF_OBJECT_COUNTS,
        worldSize: PERF_WORLD_SIZE,
        objectSizeRange: [PERF_MIN_OBJ_SIZE, PERF_MAX_OBJ_SIZE],
        cellSize: PERF_CELL_SIZE,
        seed: PERF_SEED,
        warmupRounds: PERF_WARMUP_ROUNDS,
        measuredRounds: PERF_MEASURED_ROUNDS,
        queryGrid: PERF_QUERY_GRID,
        queryWindow: { w: PERF_QUERY_W, h: PERF_QUERY_H },
      },
    },
    precision: {
      float32MinStep: runMinStepTable(),
      float64MinStep: runFloat64MinStepTable(),
      cameraOriginRebase: runCameraOriginRebase(),
      affine: runAffineTable(),
    },
    performance: PERF_OBJECT_COUNTS.map((count) => runPerfScenario(count)),
    // 非计时：稀疏 hash-grid 边界行为（负 key / overflow / update / remove）逻辑等价样例
    hashGridEdgeCases: runHashGridEdgeCases(),
  };
}

function main() {
  const result = buildDocument();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
  // 控制台仅打印摘要，便于人工确认（不参与计时）
  const perfSummary = result.performance
    .map(
      (p) =>
        `  n=${p.objectCount}: linear p50=${p.linear.p50Ms.toFixed(3)}ms p95=${p.linear.p95Ms.toFixed(
          3
        )}ms max=${p.linear.maxMs.toFixed(3)}ms | grid p50=${p.candidateGrid.p50Ms.toFixed(
          3
        )}ms p95=${p.candidateGrid.p95Ms.toFixed(3)}ms max=${p.candidateGrid.maxMs.toFixed(
          3
        )}ms | hits=${p.linear.hitsPerRound} candidates=${p.candidateGrid.candidatesPerRound} match=${p.hitsMatchBetweenQueries}`
    )
    .join('\n');
  process.stdout.write(`[coordinate-performance spike] 已写入 ${OUTPUT_PATH}\n${perfSummary}\n`);
}

main();
