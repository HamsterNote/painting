#!/usr/bin/env node

/**
 * Phase 10 Web-only production 性能合同 runner 的“独立 correctness oracle”。
 *
 * 设计约束（来自 BLOCK 审查）：
 * 1. 纯 Node ESM，不 import 页面 / 应用 / core 代码，也不复用页面同一算法。
 * 2. 只消费 runner 采集到的快照与 `inputRun.correctnessContext`；页面回传的字段仅作为“实际值”，
 *    独立期望值由本模块按公开规格重算，绝不做“页面期望 vs 页面实际”的对照。
 * 3. 任一所需要字段缺失 → correctness.passed=false（`missing:` / `unverifiable:`），
 *    绝不 fallback 到旧的 `prerequisites && rebase`。
 * 4. 前缀 100k 证明使用严格 canonical（仅 own keys + 显式白名单、拒绝未知键）全字段 SHA-256 digest；
 *    前两点 FNV 只能作为 `prefixCoordinateSignal`（`proof:false`）辅助信号，不能充当 prefix proof。
 *    post-run 的 `checksum` 覆盖整个 100001 笔文档，必须独立重算后单独比较，绝不与 100k 前缀信号混用。
 * 5. points 独立公式包含 pressure（down/move=0.5、up=0），并遵守 core 按 x/y 去重
 *    “保留先前点（含其 pressure）”的语义。
 * 6. rebase probe 使用由页面探针代码/历史 artifact 验证过的精确数字 key 与 id，
 *    并独立校验 frameOrigin(origin==global) 与 hit.point==0 两个不变量。
 *
 * 待接页面字段（当前 getSnapshot / runHighRatePenInput 尚未提供，缺失即 fail closed）：
 * - inputRun.correctnessContext：run-start 冻结上下文（runId / times / clean revision/history /
 *   prefixDigest / prefixCoordinateSignal / penInput / ruler / session / capturedAt）
 * - correctnessSnapshot.runId / capturedAt：post-run 身份与捕获时刻
 * - correctnessSnapshot.document：post-run prefixDigest / prefixCoordinateSignal / checksum /
 *   undoDepth / redoDepth / lastStroke
 * - correctnessSnapshot.frame.revision：frame 必须与 document revision 一致
 * - correctnessSnapshot.session：post-run controller tool session 状态
 */
import { createHash } from 'node:crypto';

/** 公开的确定性 workload 规格；与页面 EDITOR_PERFORMANCE_WORKLOAD 同构但独立定义。 */
export const EDITOR_PERFORMANCE_WORKLOAD_SPEC = Object.freeze({
  version: 1,
  seed: 0x5eed_cafe,
  strokeCount: 100_000,
  description: '确定性 V2 pen workload；含正负 1_000_000_000 ± .125 附近坐标及有限可见对象。',
});

/**
 * 真实页面“前两点 FNV 摘要”的溯源常量。
 * 取自历史 artifact
 * `openspec/.../phase-10/editor-production-performance.json` 的 readinessSnapshot
 * （document/workload.checksum 均为 `fnv1a-294ac97d`）。仅用于单测自校验独立重算一致。
 */
export const WORKLOAD_COORDINATE_SIGNAL_PROVENANCE = 'fnv1a-294ac97d';

/**
 * 全字段稳定 canonical 前缀 digest 的 schema 标识；页面实现必须使用完全相同的表示。
 * v2 起强制「仅 own keys + 显式白名单、拒绝未知键」的严格编码（含可选的 point.pressure 语义）。
 */
export const WORKLOAD_PREFIX_DIGEST_SCHEMA =
  'phase-10-editor-performance-workload-prefix/v2-strict-own-keys';
export const WORKLOAD_PREFIX_DIGEST_ALGORITHM = 'SHA-256';

/**
 * 独立重算的 100k 全字段 SHA-256 前缀 digest golden 字面量。
 * 它锁定 workload 生成器、严格 canonical 编码与 hash 算法三者不变；任何一处漂移都会使单测失败。
 */
export const WORKLOAD_PREFIX_GOLDEN_DIGEST =
  '766520c6a26a2b3386b0fdb3679700cdefd3a29c5669b7aaa48fa851b0ff85b1';

/**
 * 严格 canonical 编码的字段白名单。只有这些 own keys 才被接受；出现未知键即抛错，
 * 防止“页面/文档多出未知字段但仍产生相同 digest”的伪装通过。
 */
export const WORKLOAD_PREFIX_DOCUMENT_KEYS = Object.freeze(['schemaVersion', 'strokes']);
export const WORKLOAD_PREFIX_STROKE_KEYS = Object.freeze([
  'id',
  'tool',
  'schemaVersion',
  'strokeColor',
  'strokeWidth',
  'points',
]);
/** point 的 x/y 必填；pressure 可选（存在时进入 digest，不存在时省略）。 */
export const WORKLOAD_PREFIX_POINT_REQUIRED_KEYS = Object.freeze(['x', 'y']);
export const WORKLOAD_PREFIX_POINT_OPTIONAL_KEYS = Object.freeze(['pressure']);

/**
 * 页面端实现同格式的精确承诺（必须逐字一致）：
 *   1. canonical = JSON.stringify({ schemaVersion, strokes })
 *   2. strokes[i] = [id, tool, schemaVersion, strokeColor, strokeWidth, points]
 *   3. points[j] = [x, y]（workload 点无 pressure；若存在则 [x, y, pressure]）
 *   4. digest = 小写 hex SHA-256(UTF-8(canonical))
 *   5. 对象仅允许白名单 own keys；出现任何未知键必须拒绝（抛错），不得静默忽略。
 */
export const WORKLOAD_PREFIX_DIGEST_CANONICAL_SPEC = Object.freeze([
  'canonical = JSON.stringify({ schemaVersion, strokes })',
  'strokes[i] = [id, tool, schemaVersion, strokeColor, strokeWidth, points]',
  'points[j] = [x, y] or [x, y, pressure]',
  'digest = lowercase hex SHA-256(UTF-8(canonical))',
  '对 stroke/point/document 仅接受显式白名单 own keys；出现未知键即抛出错误（reject unexpected）',
]);

/** perf route 初始化时写入 controller 的 toolStyle（源码：createEditorControllerState 调用）。 */
export const EXPECTED_EDITOR_PEN_STYLE = Object.freeze({
  strokeColor: '#172033',
  strokeWidth: 3,
});

/** 源码中 `nextStrokeId` 自增生成的第一笔候选 id。 */
export const EXPECTED_FIRST_CANDIDATE_STROKE_ID = 'candidate-stroke-1';

export const CANDIDATE_STROKE_ID_PATTERN = /^candidate-stroke-\d+$/;

/** runHighRatePenInput 合成事件 pressure：down/move=0.5、up=0（源码 onDeadline）。 */
export const PEN_INPUT_PRESSURE = Object.freeze({ down: 0.5, move: 0.5, up: 0 });

/** 尺子初始状态（源码：EditorCandidateSurface.web.tsx 的 INITIAL_RULER_STATE / RULER_HEIGHT）。 */
export const INITIAL_EDITOR_RULER_RECT = Object.freeze({
  center: Object.freeze({ x: 360, y: 230 }),
  rotationRad: 0,
  height: 42,
  length: 0,
});

/** run-start 冻结上下文的 schemaVersion（新增 runId/times/ruler/clean history 后升为 2）。 */
export const CORRECTNESS_CONTEXT_SCHEMA_VERSION = 2;

/**
 * correctness 仍待页面接线的字段清单。此处作为单一事实来源，动态推导出
 * `CORRECTNESS_PENDING_PAGE_FIELDS`，避免硬编码清单与真实校验逻辑漂移。
 */
export function requiredCorrectnessFields() {
  return [
    'inputRun.correctnessContext',
    'inputRun.correctnessContext.schemaVersion',
    'inputRun.correctnessContext.runId',
    'inputRun.correctnessContext.capturedAt',
    'inputRun.correctnessContext.times',
    'inputRun.correctnessContext.times.firstScheduledAt',
    'inputRun.correctnessContext.times.scheduleWindowEndsAt',
    'inputRun.correctnessContext.document',
    'inputRun.correctnessContext.document.strokeCount',
    'inputRun.correctnessContext.document.revision',
    'inputRun.correctnessContext.document.undoDepth',
    'inputRun.correctnessContext.document.redoDepth',
    'inputRun.correctnessContext.document.prefixDigest',
    'inputRun.correctnessContext.document.prefixCoordinateSignal',
    'inputRun.correctnessContext.penInput',
    'inputRun.correctnessContext.penInput.hostClientWidth',
    'inputRun.correctnessContext.penInput.hostClientHeight',
    'inputRun.correctnessContext.penInput.viewport',
    'inputRun.correctnessContext.ruler',
    'inputRun.correctnessContext.session',
    'inputRun.correctnessContext.session.hasCandidate',
    'correctnessSnapshot',
    'correctnessSnapshot.runId',
    'correctnessSnapshot.capturedAt',
    'correctnessSnapshot.document',
    'correctnessSnapshot.document.strokeCount',
    'correctnessSnapshot.document.revision',
    'correctnessSnapshot.document.undoDepth',
    'correctnessSnapshot.document.redoDepth',
    'correctnessSnapshot.document.prefixDigest',
    'correctnessSnapshot.document.prefixCoordinateSignal',
    'correctnessSnapshot.document.checksum',
    'correctnessSnapshot.document.lastStroke',
    'correctnessSnapshot.frame',
    'correctnessSnapshot.frame.revision',
    'correctnessSnapshot.session',
    'correctnessSnapshot.session.hasCandidate',
  ];
}

/** correctness 待接字段的冻结清单（由 requiredCorrectnessFields() 动态派生）。 */
export const CORRECTNESS_PENDING_PAGE_FIELDS = Object.freeze(requiredCorrectnessFields());

// ─────────────────────────────────────────────────────────────────────────────
// 独立 workload 重算（不 import 页面实现）
// ─────────────────────────────────────────────────────────────────────────────

const WORKLOAD_BOUNDARY_POINTS = Object.freeze([
  Object.freeze({ x: 1_000_000_000.125, y: 1_000_000_000.125 }),
  Object.freeze({ x: 999_999_999.875, y: 999_999_999.875 }),
  Object.freeze({ x: -999_999_999.875, y: -999_999_999.875 }),
  Object.freeze({ x: -1_000_000_000.125, y: -1_000_000_000.125 }),
]);

function nextRandom(state) {
  state.value = (Math.imul(state.value, 1_664_525) + 1_013_904_223) >>> 0;
  return state.value / 0x1_0000_0000;
}

function workloadPoint(index, random) {
  if (index % 256 === 0) {
    return {
      x: 48 + (index % 1_408),
      y: 48 + (Math.floor(index / 256) % 804),
    };
  }
  const quadrant = index % 4;
  const signX = quadrant === 0 || quadrant === 1 ? 1 : -1;
  const signY = quadrant === 0 || quadrant === 2 ? 1 : -1;
  return {
    x: signX * 1_000_000_000 + (nextRandom(random) - 0.5) * 1_600,
    y: signY * 1_000_000_000 + (nextRandom(random) - 0.5) * 1_600,
  };
}

/**
 * 按公开规格独立重算完整 100k workload 文档（页面的精确字段）：
 *   { schemaVersion: 2, strokes: [{ schemaVersion:2, id, tool:'pen', points:[{x,y},{x,y}],
 *     strokeColor:'#172033', strokeWidth:1.5 }] }
 * 只用于前缀 digest 与边界命中期望，不写入任何 artifact。
 */
export function createWorkloadDocument(spec = EDITOR_PERFORMANCE_WORKLOAD_SPEC) {
  const random = { value: spec.seed >>> 0 };
  const strokes = new Array(spec.strokeCount);
  for (let index = 0; index < strokes.length; index += 1) {
    const first = WORKLOAD_BOUNDARY_POINTS[index] ?? workloadPoint(index, random);
    strokes[index] = {
      schemaVersion: 2,
      id: `performance-stroke-${index}`,
      tool: 'pen',
      points: [
        { x: first.x, y: first.y },
        {
          x: first.x + 0.25 + nextRandom(random) * 2,
          y: first.y + 0.25 + nextRandom(random) * 2,
        },
      ],
      strokeColor: '#172033',
      strokeWidth: 1.5,
    };
  }
  return { schemaVersion: 2, strokes };
}

// ─────────────────────────────────────────────────────────────────────────────
// 严格 canonical 编码（仅 own keys + 显式白名单，拒绝未知键）
// ─────────────────────────────────────────────────────────────────────────────

function ownEnumerableKeys(object) {
  return Object.keys(object);
}

/**
 * 断言对象的 own enumerable keys 恰好落在 allowed（必填）与 optional（可选）内。
 * 出现未知键、缺少必填键、或对象非普通对象时抛错——绝不静默忽略未知字段。
 */
function assertStrictOwnKeys(object, { required, optional = [], label }) {
  if (object === null || typeof object !== 'object' || Array.isArray(object)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = ownEnumerableKeys(object);
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} has unexpected own key "${key}" (reject unexpected)`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
      throw new TypeError(`${label} is missing required own key "${key}"`);
    }
  }
}

/**
 * 严格编码单个 point：仅接受 x/y/pressure own keys。pressure 语义可选：
 * 存在则输出 [x, y, pressure]；不存在则输出 [x, y]。未知键抛错。
 */
export function canonicalizeWorkloadPoint(point, label = 'point') {
  assertStrictOwnKeys(point, {
    required: WORKLOAD_PREFIX_POINT_REQUIRED_KEYS,
    optional: WORKLOAD_PREFIX_POINT_OPTIONAL_KEYS,
    label,
  });
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} x/y must be finite`);
  }
  if (Object.prototype.hasOwnProperty.call(point, 'pressure')) {
    if (!Number.isFinite(point.pressure)) {
      throw new TypeError(`${label} pressure must be finite when present`);
    }
    return [point.x, point.y, point.pressure];
  }
  return [point.x, point.y];
}

/** 严格编码单个 stroke：仅接受 6 个白名单 own keys，points 逐点严格编码。 */
export function canonicalizeWorkloadStroke(stroke, label = 'stroke') {
  assertStrictOwnKeys(stroke, {
    required: WORKLOAD_PREFIX_STROKE_KEYS,
    label,
  });
  if (typeof stroke.id !== 'string' || stroke.id.length === 0) {
    throw new TypeError(`${label} id must be a non-empty string`);
  }
  if (typeof stroke.tool !== 'string') {
    throw new TypeError(`${label} tool must be a string`);
  }
  if (!Number.isFinite(stroke.schemaVersion)) {
    throw new TypeError(`${label} schemaVersion must be finite`);
  }
  if (typeof stroke.strokeColor !== 'string') {
    throw new TypeError(`${label} strokeColor must be a string`);
  }
  if (!Number.isFinite(stroke.strokeWidth)) {
    throw new TypeError(`${label} strokeWidth must be finite`);
  }
  if (!Array.isArray(stroke.points)) {
    throw new TypeError(`${label} points must be an array`);
  }
  return [
    stroke.id,
    stroke.tool,
    stroke.schemaVersion,
    stroke.strokeColor,
    stroke.strokeWidth,
    stroke.points.map((point, index) =>
      canonicalizeWorkloadPoint(point, `${label}.points[${index}]`)
    ),
  ];
}

/**
 * 严格 canonical 表示。页面端必须以完全相同的结构实现后做 SHA-256，
 * 才能与 Node 重算的 prefixDigest 对照。字段顺序固定，points 无 pressure 时用 [x,y]。
 * 顶层 / stroke / point 任一层出现未知 own key 都会抛错。
 */
export function canonicalizeWorkloadDocument(document, label = 'document') {
  assertStrictOwnKeys(document, {
    required: WORKLOAD_PREFIX_DOCUMENT_KEYS,
    label,
  });
  if (!Number.isFinite(document.schemaVersion)) {
    throw new TypeError(`${label} schemaVersion must be finite`);
  }
  if (!Array.isArray(document.strokes)) {
    throw new TypeError(`${label} strokes must be an array`);
  }
  return {
    schemaVersion: document.schemaVersion,
    strokes: document.strokes.map((stroke, index) =>
      canonicalizeWorkloadStroke(stroke, `${label}.strokes[${index}]`)
    ),
  };
}

/** 兼容旧名：canonical 表示（严格编码）。 */
export function canonicalWorkloadPrefixRepresentation(document) {
  return canonicalizeWorkloadDocument(document);
}

const prefixDigestCache = new Map();

/** 独立重算的真实 100k 全字段严格 SHA-256 前缀 digest（带缓存）。 */
export function computeWorkloadPrefixDigest(spec = EDITOR_PERFORMANCE_WORKLOAD_SPEC) {
  const cacheKey = `${spec.version}:${spec.seed >>> 0}:${spec.strokeCount}`;
  const cached = prefixDigestCache.get(cacheKey);
  if (cached) return cached;
  const document = createWorkloadDocument(spec);
  const canonical = JSON.stringify(canonicalizeWorkloadDocument(document));
  const digest = createHash('sha256').update(canonical).digest('hex');
  const value = Object.freeze({
    algorithm: WORKLOAD_PREFIX_DIGEST_ALGORITHM,
    schema: WORKLOAD_PREFIX_DIGEST_SCHEMA,
    strokeCount: spec.strokeCount,
    digest,
  });
  prefixDigestCache.set(cacheKey, value);
  return value;
}

/**
 * 对“实际文档”做严格 canonical 编码后计算 SHA-256。
 * 未知 own keys 会抛错，因此这是严格的 actual prefix 编码入口。
 */
export function computeActualPrefixDigest(document) {
  const canonical = JSON.stringify(canonicalizeWorkloadDocument(document));
  return createHash('sha256').update(canonical).digest('hex');
}

/** 严格比较 prefixDigest 的四个字段（algorithm/schema/strokeCount/digest）。 */
export function prefixDigestMatches(actual, expected) {
  return (
    actual !== null &&
    typeof actual === 'object' &&
    actual.algorithm === expected.algorithm &&
    actual.schema === expected.schema &&
    actual.strokeCount === expected.strokeCount &&
    actual.digest === expected.digest
  );
}

/**
 * 与页面 `checksumPerformanceDocument` 同格式的 FNV-1a 数值摘要，但只接收一段 stroke 序列：
 *   add(strokes.length); for each stroke: add(points[0].x/y ?? 0), add(points[1].x/y ?? 0)
 * 抽出为公共实现，供“100k 前缀信号”和“100001 全文摘要”分别独立重算。
 */
function fnv1aOverStrokes(strokes) {
  let hash = 0x811c9dc5;
  const add = (value) => {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  add(strokes.length);
  for (const stroke of strokes) {
    add(stroke.points[0]?.x ?? 0);
    add(stroke.points[0]?.y ?? 0);
    add(stroke.points[1]?.x ?? 0);
    add(stroke.points[1]?.y ?? 0);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * 仅 100k 前缀的前两点 FNV 数值摘要。这是 prefixCoordinateSignal，不是 prefix proof。
 * 注意：绝不能拿它与页面覆盖整个 100001 笔文档的 `checksum` 比较。
 */
const prefixCoordinateSignalCache = new Map();

export function independentWorkloadPrefixCoordinateSignal(spec = EDITOR_PERFORMANCE_WORKLOAD_SPEC) {
  const cacheKey = `${spec.version}:${spec.seed >>> 0}:${spec.strokeCount}`;
  const cached = prefixCoordinateSignalCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const value = fnv1aOverStrokes(createWorkloadDocument(spec).strokes);
  prefixCoordinateSignalCache.set(cacheKey, value);
  return value;
}

/** 兼容旧名（等价于 prefix 信号）。 */
export function independentWorkloadCoordinateSignal(spec = EDITOR_PERFORMANCE_WORKLOAD_SPEC) {
  return independentWorkloadPrefixCoordinateSignal(spec);
}

/**
 * 独立重算 post-run 整个 100001 笔文档的 FNV 摘要（含追加的最后一笔）。
 * appendedPoints 是独立推导出的最后一笔 world 点序列；与页面 `checksum` 对照。
 */
export function independentWorkloadWholeDocumentChecksum(
  appendedPoints,
  spec = EDITOR_PERFORMANCE_WORKLOAD_SPEC
) {
  if (!Array.isArray(appendedPoints)) {
    throw new TypeError('appendedPoints must be an array');
  }
  const strokes = [...createWorkloadDocument(spec).strokes, { points: appendedPoints }];
  return fnv1aOverStrokes(strokes);
}

// ─────────────────────────────────────────────────────────────────────────────
// 独立输入方程重算（screen → ruler 约束 → world → pressure 去重）
// ─────────────────────────────────────────────────────────────────────────────

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, received ${String(value)}`);
  }
}

function assertFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number, received ${String(value)}`);
  }
}

/**
 * runHighRatePenInput 在 onDeadline 中生成的 host-local screen 输入方程。
 * clientX = bounds.left + host.clientLeft + x，normalize 再减同一 rect.left/clientLeft，
 * 因此 adapter 收到的 screen 坐标恰好等于此处的 x/y。
 */
export function derivePenInputScreenPoints({ eventCount, hostClientWidth, hostClientHeight }) {
  assertPositiveInteger(eventCount, 'eventCount');
  assertFinitePositive(hostClientWidth, 'hostClientWidth');
  assertFinitePositive(hostClientHeight, 'hostClientHeight');
  const xModulus = Math.max(1, Math.floor(Math.min(640, hostClientWidth - 160)));
  const yModulus = Math.max(1, Math.floor(Math.min(360, hostClientHeight - 160)));
  const points = new Array(eventCount);
  for (let index = 0; index < eventCount; index += 1) {
    points[index] = {
      x: 120 + ((index * 7) % xModulus),
      y: 120 + ((index * 5) % yModulus),
    };
  }
  return points;
}

/** 复刻 ruler/geometry 的尺边约束（纯数学），与页面同语义但不 import。 */
export function createRulerEdgeConstraint(start, ruler) {
  const rotationRad = ruler.rotationRad ?? 0;
  const localY =
    -(start.x - ruler.center.x) * Math.sin(rotationRad) +
    (start.y - ruler.center.y) * Math.cos(rotationRad);
  return { ruler, edgeNormal: localY >= 0 ? 1 : -1, phase: 'approaching' };
}

function projectPointToRulerEdge(point, constraint) {
  const { ruler, edgeNormal } = constraint;
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const localX = dx * cosine + dy * sine;
  const edgeY = edgeNormal * (ruler.height / 2);
  return {
    x: ruler.center.x + localX * cosine - edgeY * sine,
    y: ruler.center.y + localX * sine + edgeY * cosine,
  };
}

export function constrainPointToRulerEdge(point, constraint) {
  const { ruler, edgeNormal } = constraint;
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const localY = -dx * sine + dy * cosine;
  const halfHeight = ruler.height / 2;

  if (constraint.phase === 'approaching') {
    const distanceTowardRuler = edgeNormal * localY;
    if (distanceTowardRuler >= halfHeight) {
      return { point, constraint };
    }
    if (distanceTowardRuler < -halfHeight) {
      return { point, constraint: createRulerEdgeConstraint(point, ruler) };
    }
  } else if (Math.abs(localY) > halfHeight) {
    return { point, constraint: createRulerEdgeConstraint(point, ruler) };
  }

  return {
    point: projectPointToRulerEdge(point, constraint),
    constraint:
      constraint.phase === 'constrained' ? constraint : { ...constraint, phase: 'constrained' },
  };
}

/** 独立复刻 screen → world（绝对全局 DIP）的普通视口逆变换。 */
export function screenToWorldPoint(point, viewport) {
  assertFinitePositive(viewport.scale, 'viewport.scale');
  if (!Number.isFinite(viewport.tx) || !Number.isFinite(viewport.ty)) {
    throw new RangeError('viewport.tx/ty must be finite');
  }
  return {
    x: (point.x - viewport.tx) / viewport.scale,
    y: (point.y - viewport.ty) / viewport.scale,
  };
}

/**
 * 独立推导 runHighRatePenInput 提交的那一笔 world 点序列（含 pressure）。
 *
 * 语义链：onDeadline screen 方程 → down 只初始化 ruler 约束、move/up 才施加
 * constrainPointToRulerEdge → worldPoint = screenToCanvas → pen 的 appendUniquePoint
 * 只按 x/y 去重且“保留先前点（含其 pressure）”。
 * pressure：down/move=0.5、up=0。
 */
export function deriveExpectedPenStrokePoints({
  eventCount,
  hostClientWidth,
  hostClientHeight,
  viewport,
  ruler = INITIAL_EDITOR_RULER_RECT,
}) {
  const screenPoints = derivePenInputScreenPoints({
    eventCount,
    hostClientWidth,
    hostClientHeight,
  });
  const points = [];
  let constraint = createRulerEdgeConstraint(screenPoints[0], ruler);
  for (let index = 0; index < screenPoints.length; index += 1) {
    let constrained = screenPoints[index];
    if (index > 0) {
      const result = constrainPointToRulerEdge(screenPoints[index], constraint);
      constrained = result.point;
      constraint = result.constraint;
    }
    const world = screenToWorldPoint(constrained, viewport);
    const pressure =
      index === screenPoints.length - 1 ? PEN_INPUT_PRESSURE.up : PEN_INPUT_PRESSURE.move;
    const candidate = { x: world.x, y: world.y, pressure };
    const previous = points[points.length - 1];
    // 与 core appendUniquePoint 一致：仅按 x/y 去重，重复时保留先前点（含先前 pressure）。
    if (!previous || previous.x !== candidate.x || previous.y !== candidate.y) {
      points.push(candidate);
    }
  }
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// rebase probe：独立命中期望 + 加强校验
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 页面 runRebaseProbe 的独立命中期望。
 *
 * 探针把 viewport 平移到边界点上，因此 screen 中心 ↔ 该边界 global 点；
 * hitTestDrawingFrame 返回的 hit.point 是 frame-local 坐标，且 frameOrigin 必须独立等于
 * 该边界 global 点（origin==global），hit.point 必须为 (0,0)（probe 点即 frame 原点）。
 *
 * 精确数字 key/id 取自页面探针代码（EditorCandidateSurface.web.tsx runRebaseProbe：
 * 对正/负边界点分别以 scale 0.25/1/8 取 canvas 中心命中）与历史 artifact
 * `openspec/.../phase-10/editor-production-performance.json`（每个 context 一致）：
 *   positive @0.25 -> 55264 / @1 -> 1 / @8 -> 1
 *   negative @0.25 -> 98879 / @1 -> 3 / @8 -> 3
 * 未来 Surface 还需在 hit 中回传 stroke id（`performance-stroke-<key>`）。
 */
export function expectedRebaseProbes() {
  return [
    { label: 'positive', scale: 0.25, point: { ...WORKLOAD_BOUNDARY_POINTS[0] }, key: 55264 },
    { label: 'positive', scale: 1, point: { ...WORKLOAD_BOUNDARY_POINTS[0] }, key: 1 },
    { label: 'positive', scale: 8, point: { ...WORKLOAD_BOUNDARY_POINTS[0] }, key: 1 },
    { label: 'negative', scale: 0.25, point: { ...WORKLOAD_BOUNDARY_POINTS[3] }, key: 98879 },
    { label: 'negative', scale: 1, point: { ...WORKLOAD_BOUNDARY_POINTS[3] }, key: 3 },
    { label: 'negative', scale: 8, point: { ...WORKLOAD_BOUNDARY_POINTS[3] }, key: 3 },
  ].map((entry) => ({ ...entry, id: `performance-stroke-${entry.key}` }));
}

const REBASE_HIT_TOLERANCE = 1e-3;
// 固定绝对容差：在 ±1e9 量级下不放宽到相对容差，避免掩盖真实的原点漂移。
const REBASE_ORIGIN_ABSOLUTE_TOLERANCE = 1e-6;

function withinOriginTolerance(actual, expected) {
  return Math.abs(actual - expected) <= REBASE_ORIGIN_ABSOLUTE_TOLERANCE;
}

/**
 * 加强的 rebase probe 校验：
 * - probe.version 必须等于 workload version；
 * - 记录必须按正/负 × 0.25/1/8 的固定顺序精确出现 6 条；
 * - status/finite/frameOrigin(origin==global)/hit(key 数字精确、id 精确、tool=pen、point==(0,0))；
 * - visible/renderable>=1、unresolved=0。
 * 期望完全由 runner 独立推导，不信任页面 hit 的自洽声明。
 */
export function validateRebaseProbe(probe, expectations = expectedRebaseProbes()) {
  const failures = [];
  if (probe?.version !== EDITOR_PERFORMANCE_WORKLOAD_SPEC.version) {
    failures.push(
      `rebase probe version is ${String(probe?.version)}:expected-${EDITOR_PERFORMANCE_WORKLOAD_SPEC.version}`
    );
  }
  const records = Array.isArray(probe?.probes) ? probe.probes : [];
  if (records.length !== expectations.length) {
    failures.push(`expected ${expectations.length} rebase records, received ${records.length}`);
  }
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    const mapKey = `${expectation.label}:${expectation.scale}`;
    const record = records[index];
    if (!record) {
      failures.push(`missing rebase record ${mapKey}`);
      continue;
    }
    if (record.label !== expectation.label || record.scale !== expectation.scale) {
      failures.push(
        `rebase record order mismatch at index ${index}: received ${String(record.label)}:${String(record.scale)}:expected-${mapKey}`
      );
      continue;
    }
    if (record.status !== 'frame-ready') {
      failures.push(`${mapKey} status is ${String(record.status)}`);
      continue;
    }
    if (record.finite !== true) failures.push(`${mapKey} did not record finite frame state`);
    const frameOrigin = record.frameOrigin;
    if (!frameOrigin || !Number.isFinite(frameOrigin.x) || !Number.isFinite(frameOrigin.y)) {
      failures.push(`${mapKey} has non-finite frame origin`);
    } else {
      // 独立不变量 1：frameOrigin 必须等于 probe 边界 global 点（origin==global）。
      if (
        !withinOriginTolerance(frameOrigin.x, expectation.point.x) ||
        !withinOriginTolerance(frameOrigin.y, expectation.point.y)
      ) {
        failures.push(
          `${mapKey} frameOrigin ${frameOrigin.x},${frameOrigin.y} != expected ${expectation.point.x},${expectation.point.y}`
        );
      }
    }
    const hit = record.hit;
    if (!hit || typeof hit !== 'object') {
      failures.push(`${mapKey} has no hit probe result`);
    } else {
      if (hit.key !== expectation.key) {
        failures.push(`${mapKey} hit key ${String(hit.key)}:expected-${expectation.key}`);
      }
      if (hit.id !== expectation.id) {
        failures.push(`${mapKey} hit id ${String(hit.id)}:expected-${expectation.id}`);
      } else if (typeof hit.key === 'number' && hit.id !== `performance-stroke-${hit.key}`) {
        failures.push(`${mapKey} hit id ${String(hit.id)} does not match numeric key ${hit.key}`);
      }
      if (hit.tool !== 'pen') failures.push(`${mapKey} hit tool is ${String(hit.tool)}`);
      // 独立不变量 2：hit.point 必须是 frame 原点 (0,0)。
      if (
        !hit.point ||
        !Number.isFinite(hit.point.x) ||
        !Number.isFinite(hit.point.y) ||
        hit.point.x !== 0 ||
        hit.point.y !== 0
      ) {
        failures.push(`${mapKey} hit point ${JSON.stringify(hit.point)}:expected-0,0`);
      }
    }
    if (!Number.isInteger(record.visible) || record.visible < 1) {
      failures.push(`${mapKey} visible is not a positive integer`);
    }
    if (!Number.isInteger(record.renderable) || record.renderable < 1) {
      failures.push(`${mapKey} renderable is not a positive integer`);
    } else if (Number.isInteger(record.visible) && record.renderable > record.visible) {
      failures.push(`${mapKey} renderable ${record.renderable} exceeds visible ${record.visible}`);
    }
    if (record.unresolved !== 0) {
      failures.push(`${mapKey} unresolved is ${String(record.unresolved)}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// correctness 判定
// ─────────────────────────────────────────────────────────────────────────────

function comparePointArrays(actual, expected, epsilon) {
  if (actual.length !== expected.length) {
    return `point-count:${actual.length}:expected-${expected.length}`;
  }
  const mismatches = [];
  for (let index = 0; index < expected.length; index += 1) {
    const a = actual[index];
    const e = expected[index];
    if (!a || typeof a !== 'object' || !Number.isFinite(a.x) || !Number.isFinite(a.y)) {
      mismatches.push(`point-${index}:non-finite`);
    } else if (
      Math.abs(a.x - e.x) > epsilon ||
      Math.abs(a.y - e.y) > epsilon ||
      a.pressure !== e.pressure
    ) {
      mismatches.push(
        `point-${index}:${a.x},${a.y},p=${String(a.pressure)}:expected-${e.x},${e.y},p=${e.pressure}`
      );
    }
    if (mismatches.length >= 3) break;
  }
  return mismatches.length > 0 ? mismatches.join('|') : null;
}

function isFinitePoint(point) {
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function isFiniteViewport(viewport) {
  return (
    viewport !== null &&
    typeof viewport === 'object' &&
    Number.isFinite(viewport.scale) &&
    viewport.scale > 0 &&
    Number.isFinite(viewport.tx) &&
    Number.isFinite(viewport.ty)
  );
}

function rulerMatchesInitial(ruler) {
  return (
    ruler !== null &&
    typeof ruler === 'object' &&
    isFinitePoint(ruler.center) &&
    withinOriginTolerance(ruler.center.x, INITIAL_EDITOR_RULER_RECT.center.x) &&
    withinOriginTolerance(ruler.center.y, INITIAL_EDITOR_RULER_RECT.center.y) &&
    Number.isFinite(ruler.rotationRad) &&
    withinOriginTolerance(ruler.rotationRad, INITIAL_EDITOR_RULER_RECT.rotationRad) &&
    Number.isFinite(ruler.height) &&
    withinOriginTolerance(ruler.height, INITIAL_EDITOR_RULER_RECT.height) &&
    Number.isFinite(ruler.length) &&
    withinOriginTolerance(ruler.length, INITIAL_EDITOR_RULER_RECT.length)
  );
}

/**
 * 对 post-run document 做独立、fail-closed 的 correctness 校验。
 *
 * @param {object} params
 * @param {object|null} params.inputRun runHighRatePenInput 结果（提供 run-start 冻结的 correctnessContext）
 * @param {object|null} params.correctnessSnapshot run 后、测量窗口停止后采集的快照
 * @param {object} params.input { eventsPerSecond, durationMs, eventCount? }
 * @param {object} [params.workloadSpec]
 */
export function validateCorrectness({
  inputRun,
  correctnessSnapshot,
  input,
  workloadSpec = EDITOR_PERFORMANCE_WORKLOAD_SPEC,
} = {}) {
  const failures = [];
  const missingFields = [];
  const unverifiedChecks = [];
  const checks = {};
  const fail = (reason) => failures.push(reason);
  const missing = (field, reason) => {
    missingFields.push(field);
    fail(reason ?? `missing:${field}`);
  };
  const expectedPrefixDigest = computeWorkloadPrefixDigest(workloadSpec);
  const expectedPrefixCoordinateSignal = independentWorkloadPrefixCoordinateSignal(workloadSpec);
  const expectedStrokeCount = workloadSpec.strokeCount + 1;
  const expectedScheduleWindowMs =
    Number.isInteger(input?.durationMs) && input.durationMs > 0 ? input.durationMs : null;
  const eventCount =
    Number.isInteger(input?.eventCount) && input.eventCount > 0
      ? input.eventCount
      : Number.isInteger(input?.eventsPerSecond) && Number.isInteger(input?.durationMs)
        ? (input.eventsPerSecond * input.durationMs) / 1_000
        : null;

  checks.prefixDigest = {
    expected: expectedPrefixDigest,
    context: null,
    post: null,
    passed: false,
  };
  checks.prefixCoordinateSignal = {
    expected: expectedPrefixCoordinateSignal,
    context: null,
    post: null,
    proof: false,
    passed: false,
  };
  checks.wholeDocumentChecksum = {
    expected: null,
    actual: null,
    proof: false,
    passed: false,
  };

  const contextPenInput = inputRun?.correctnessContext?.penInput;
  const eventCountReady = Number.isInteger(eventCount) && eventCount > 0;
  const geometryReady =
    Number.isFinite(contextPenInput?.hostClientWidth) &&
    Number.isFinite(contextPenInput?.hostClientHeight) &&
    isFiniteViewport(contextPenInput?.viewport);

  // ── run-start 冻结上下文 ──
  const context = inputRun?.correctnessContext;
  let contextDocument = null;
  if (!context || typeof context !== 'object') {
    missing('inputRun.correctnessContext');
  } else {
    if (context.schemaVersion !== CORRECTNESS_CONTEXT_SCHEMA_VERSION) {
      fail(
        `correctness-context-schema:${String(context.schemaVersion)}:expected-${CORRECTNESS_CONTEXT_SCHEMA_VERSION}`
      );
    }
    if (typeof context.runId !== 'string' || context.runId.length === 0) {
      missing('inputRun.correctnessContext.runId');
    }
    if (!Number.isFinite(context.capturedAt)) {
      missing('inputRun.correctnessContext.capturedAt');
    } else {
      const firstScheduledAt = inputRun?.actual?.firstScheduledAt;
      if (!Number.isFinite(firstScheduledAt)) {
        missing(
          'inputRun.actual.firstScheduledAt',
          'unverifiable:context-time-order:missing-firstScheduledAt'
        );
      } else if (context.capturedAt > firstScheduledAt) {
        fail(`context-time-order:${context.capturedAt}:after-firstScheduledAt-${firstScheduledAt}`);
      }
    }

    // run-start 冻结的 schedule times；必须与实际 run 的调度窗口一致。
    const contextTimes = context.times;
    if (!contextTimes || typeof contextTimes !== 'object') {
      missing('inputRun.correctnessContext.times');
    } else {
      if (!Number.isFinite(contextTimes.firstScheduledAt)) {
        missing('inputRun.correctnessContext.times.firstScheduledAt');
      } else if (
        Number.isFinite(inputRun?.actual?.firstScheduledAt) &&
        contextTimes.firstScheduledAt !== inputRun.actual.firstScheduledAt
      ) {
        fail(
          `context-times-firstScheduledAt:${contextTimes.firstScheduledAt}:actual-${inputRun.actual.firstScheduledAt}`
        );
      }
      if (!Number.isFinite(contextTimes.scheduleWindowEndsAt)) {
        missing('inputRun.correctnessContext.times.scheduleWindowEndsAt');
      } else if (
        Number.isFinite(inputRun?.actual?.scheduleWindowEndsAt) &&
        contextTimes.scheduleWindowEndsAt !== inputRun.actual.scheduleWindowEndsAt
      ) {
        fail(
          `context-times-scheduleWindowEndsAt:${contextTimes.scheduleWindowEndsAt}:actual-${inputRun.actual.scheduleWindowEndsAt}`
        );
      }
      // 窗口跨度必须严格等于请求 durationMs，拒绝被放大的（如 20s）同步窗口。
      if (
        expectedScheduleWindowMs !== null &&
        Number.isFinite(contextTimes.firstScheduledAt) &&
        Number.isFinite(contextTimes.scheduleWindowEndsAt)
      ) {
        const span = contextTimes.scheduleWindowEndsAt - contextTimes.firstScheduledAt;
        if (span !== expectedScheduleWindowMs) {
          fail(`context-times-window:${span}:expected-${expectedScheduleWindowMs}`);
        }
      }
    }

    contextDocument = context.document;
    if (!contextDocument || typeof contextDocument !== 'object') {
      missing('inputRun.correctnessContext.document');
    } else {
      if (contextDocument.strokeCount !== workloadSpec.strokeCount) {
        fail(
          `context-stroke-count:${String(contextDocument.strokeCount)}:expected-${workloadSpec.strokeCount}`
        );
      }
      // run-start 必须是精确 clean 状态：revision=0、undoDepth=0、redoDepth=0。
      if (contextDocument.revision === undefined) {
        missing('inputRun.correctnessContext.document.revision');
      } else if (contextDocument.revision !== 0) {
        fail(`context-revision:${String(contextDocument.revision)}:expected-clean-0`);
      }
      if (contextDocument.undoDepth === undefined) {
        missing('inputRun.correctnessContext.document.undoDepth');
      } else if (contextDocument.undoDepth !== 0) {
        fail(`context-undo-depth:${String(contextDocument.undoDepth)}:expected-clean-0`);
      }
      if (contextDocument.redoDepth === undefined) {
        missing('inputRun.correctnessContext.document.redoDepth');
      } else if (contextDocument.redoDepth !== 0) {
        fail(`context-redo-depth:${String(contextDocument.redoDepth)}:expected-clean-0`);
      }
      checks.prefixDigest.context = contextDocument.prefixDigest ?? null;
      if (!contextDocument.prefixDigest) {
        missing('inputRun.correctnessContext.document.prefixDigest');
      } else if (!prefixDigestMatches(contextDocument.prefixDigest, expectedPrefixDigest)) {
        fail('context-prefix-digest-mismatch');
      }
      checks.prefixCoordinateSignal.context = contextDocument.prefixCoordinateSignal ?? null;
      if (typeof contextDocument.prefixCoordinateSignal !== 'string') {
        missing('inputRun.correctnessContext.document.prefixCoordinateSignal');
      } else if (contextDocument.prefixCoordinateSignal !== expectedPrefixCoordinateSignal) {
        fail(
          `context-prefix-coordinate-signal:${contextDocument.prefixCoordinateSignal}:expected-${expectedPrefixCoordinateSignal}`
        );
      }
    }

    if (!contextPenInput || typeof contextPenInput !== 'object') {
      missing('inputRun.correctnessContext.penInput');
    } else {
      if (!Number.isFinite(contextPenInput.hostClientWidth)) {
        missing('inputRun.correctnessContext.penInput.hostClientWidth');
      }
      if (!Number.isFinite(contextPenInput.hostClientHeight)) {
        missing('inputRun.correctnessContext.penInput.hostClientHeight');
      }
      if (!isFiniteViewport(contextPenInput.viewport)) {
        missing('inputRun.correctnessContext.penInput.viewport');
      }
    }

    // run-start 尺子状态；必须与独立推导所用的 INITIAL 状态一致，否则推导的 points 无效。
    const contextRuler = context.ruler;
    if (!contextRuler || typeof contextRuler !== 'object') {
      missing('inputRun.correctnessContext.ruler');
    } else if (!rulerMatchesInitial(contextRuler)) {
      fail(
        `context-ruler-mismatch:${JSON.stringify(contextRuler)}:expected-initial-${JSON.stringify(INITIAL_EDITOR_RULER_RECT)}`
      );
    }

    const contextSession = context.session;
    if (!contextSession || typeof contextSession !== 'object') {
      missing('inputRun.correctnessContext.session');
    } else {
      const contextSessionFailures = [];
      if (contextSession.tool !== 'pen') {
        contextSessionFailures.push(`tool-${String(contextSession.tool)}`);
      }
      // run-start 必须是真正的 idle：拒绝 finished / 残余 candidate。
      if (contextSession.status !== 'idle') {
        contextSessionFailures.push(`status-${String(contextSession.status)}`);
      }
      if (contextSession.pointCount !== 0) {
        contextSessionFailures.push(`pointCount-${String(contextSession.pointCount)}`);
      }
      if (contextSession.hasCandidate !== false) {
        contextSessionFailures.push(`hasCandidate-${String(contextSession.hasCandidate)}`);
      }
      if (contextSessionFailures.length > 0) {
        fail(
          `context-session:${contextSessionFailures.join(',')}:expected-idle-pen-0-no-candidate`
        );
      }
    }
  }

  // 实际调度窗口跨度必须严格等于请求 durationMs（拒绝被放大的同步窗口）。
  {
    const actualFirst = inputRun?.actual?.firstScheduledAt;
    const actualEnd = inputRun?.actual?.scheduleWindowEndsAt;
    if (
      expectedScheduleWindowMs !== null &&
      Number.isFinite(actualFirst) &&
      Number.isFinite(actualEnd) &&
      actualEnd - actualFirst !== expectedScheduleWindowMs
    ) {
      fail(
        `actual-schedule-window:${actualEnd - actualFirst}:expected-${expectedScheduleWindowMs}`
      );
    }
  }

  // 独立推导追加的最后一笔点序列（供 lastStroke 与 whole-document checksum 共用）。
  let expectedPoints = null;
  if (geometryReady && eventCountReady) {
    expectedPoints = deriveExpectedPenStrokePoints({
      eventCount,
      hostClientWidth: contextPenInput.hostClientWidth,
      hostClientHeight: contextPenInput.hostClientHeight,
      viewport: contextPenInput.viewport,
      ruler: INITIAL_EDITOR_RULER_RECT,
    });
  }

  // ── post-run 身份与捕获时刻 ──
  if (!correctnessSnapshot || typeof correctnessSnapshot !== 'object') {
    missing('correctnessSnapshot', 'missing:correctnessSnapshot');
  } else {
    if (typeof correctnessSnapshot.runId !== 'string' || correctnessSnapshot.runId.length === 0) {
      missing('correctnessSnapshot.runId');
    } else if (typeof context?.runId === 'string' && correctnessSnapshot.runId !== context.runId) {
      fail(`post-run-id:${correctnessSnapshot.runId}:expected-context-${context.runId}`);
    }
    if (!Number.isFinite(correctnessSnapshot.capturedAt)) {
      missing('correctnessSnapshot.capturedAt');
    } else {
      const settlementCompletedAt = inputRun?.actual?.settlementCompletedAt;
      if (!Number.isFinite(settlementCompletedAt)) {
        missing(
          'inputRun.actual.settlementCompletedAt',
          'unverifiable:post-capturedAt-after-settlement:missing-settlementCompletedAt'
        );
      } else if (correctnessSnapshot.capturedAt < settlementCompletedAt) {
        fail(
          `post-capturedAt:${correctnessSnapshot.capturedAt}:before-settlement-${settlementCompletedAt}`
        );
      }
    }
  }

  // ── post-run document ──
  const document = correctnessSnapshot?.document;
  if (correctnessSnapshot && typeof correctnessSnapshot === 'object') {
    if (!document || typeof document !== 'object') {
      missing('correctnessSnapshot.document', 'missing:correctnessSnapshot.document');
    } else {
      if (document.strokeCount === undefined) {
        missing('correctnessSnapshot.document.strokeCount');
      } else if (document.strokeCount !== expectedStrokeCount) {
        fail(`post-stroke-count:${String(document.strokeCount)}:expected-${expectedStrokeCount}`);
      }

      if (document.revision === undefined) {
        missing('correctnessSnapshot.document.revision');
      } else if (document.revision !== 1) {
        fail(`post-revision:${String(document.revision)}:expected-1`);
      }

      if (document.undoDepth === undefined) {
        missing('correctnessSnapshot.document.undoDepth');
      } else if (document.undoDepth !== 1) {
        fail(`post-undo-depth:${String(document.undoDepth)}:expected-1`);
      }

      if (document.redoDepth === undefined) {
        missing('correctnessSnapshot.document.redoDepth');
      } else if (document.redoDepth !== 0) {
        fail(`post-redo-depth:${String(document.redoDepth)}:expected-0`);
      }

      // ── prefix digest：前后完整 digest 对比，必须等于 Node 独立重算 ──
      checks.prefixDigest.post = document.prefixDigest ?? null;
      if (!document.prefixDigest) {
        missing('correctnessSnapshot.document.prefixDigest');
      } else if (!prefixDigestMatches(document.prefixDigest, expectedPrefixDigest)) {
        fail('post-prefix-digest-mismatch');
      } else if (
        contextDocument?.prefixDigest &&
        !prefixDigestMatches(document.prefixDigest, contextDocument.prefixDigest)
      ) {
        fail('post-prefix-digest-differs-from-context');
      } else {
        checks.prefixDigest.passed = true;
      }

      // ── prefixCoordinateSignal：100k 前缀弱信号，与 whole-document checksum 分离 ──
      checks.prefixCoordinateSignal.post = document.prefixCoordinateSignal ?? null;
      if (typeof document.prefixCoordinateSignal !== 'string') {
        missing('correctnessSnapshot.document.prefixCoordinateSignal');
      } else if (document.prefixCoordinateSignal !== expectedPrefixCoordinateSignal) {
        fail(
          `post-prefix-coordinate-signal:${document.prefixCoordinateSignal}:expected-${expectedPrefixCoordinateSignal}`
        );
      } else {
        checks.prefixCoordinateSignal.passed = true;
      }

      // ── whole-document checksum：独立重算整个 100001 笔文档（仅弱信号，proof=false） ──
      checks.wholeDocumentChecksum.actual = document.checksum ?? null;
      if (document.checksum === undefined || document.checksum === null) {
        missing('correctnessSnapshot.document.checksum');
      } else if (!expectedPoints) {
        unverifiedChecks.push('document.checksum');
        fail('unverifiable:document.checksum:missing-derived-last-stroke');
      } else {
        const expectedWhole = independentWorkloadWholeDocumentChecksum(
          expectedPoints,
          workloadSpec
        );
        checks.wholeDocumentChecksum.expected = expectedWhole;
        if (document.checksum !== expectedWhole) {
          fail(`whole-document-checksum:${document.checksum}:expected-${expectedWhole}`);
        } else {
          checks.wholeDocumentChecksum.passed = true;
        }
      }

      // ── lastStroke（精确 V2 own keys：schemaVersion/id/tool/points/strokeColor/strokeWidth） ──
      const lastStroke = document.lastStroke;
      if (!lastStroke || typeof lastStroke !== 'object') {
        missing('correctnessSnapshot.document.lastStroke');
      } else {
        // 严格形状：只允许 V2 白名单 own keys，拒绝未知字段。
        try {
          assertStrictOwnKeys(lastStroke, {
            required: ['schemaVersion', 'id', 'tool', 'points', 'strokeColor', 'strokeWidth'],
            label: 'lastStroke',
          });
        } catch (error) {
          fail(`last-stroke-keys:${error instanceof Error ? error.message : String(error)}`);
        }
        if (lastStroke.schemaVersion !== 2) {
          fail(`last-stroke-schemaVersion:${String(lastStroke.schemaVersion)}:expected-2`);
        }
        if (lastStroke.tool !== 'pen') {
          fail(`last-stroke-tool:${String(lastStroke.tool)}:expected-pen`);
        }
        if (typeof lastStroke.id !== 'string' || !CANDIDATE_STROKE_ID_PATTERN.test(lastStroke.id)) {
          fail(`last-stroke-id:${String(lastStroke.id)}:expected-candidate-stroke-pattern`);
        } else if (lastStroke.id !== EXPECTED_FIRST_CANDIDATE_STROKE_ID) {
          fail(`last-stroke-id:${lastStroke.id}:expected-${EXPECTED_FIRST_CANDIDATE_STROKE_ID}`);
        }
        if (lastStroke.strokeColor !== EXPECTED_EDITOR_PEN_STYLE.strokeColor) {
          fail(
            `last-stroke-color:${String(lastStroke.strokeColor)}:expected-${EXPECTED_EDITOR_PEN_STYLE.strokeColor}`
          );
        }
        if (lastStroke.strokeWidth !== EXPECTED_EDITOR_PEN_STYLE.strokeWidth) {
          fail(
            `last-stroke-width:${String(lastStroke.strokeWidth)}:expected-${EXPECTED_EDITOR_PEN_STYLE.strokeWidth}`
          );
        }

        checks.lastStrokePoints = { verified: false, expectedCount: null, actualCount: null };
        if (!Array.isArray(lastStroke.points)) {
          missing('correctnessSnapshot.document.lastStroke.points');
        } else {
          checks.lastStrokePoints.actualCount = lastStroke.points.length;
          // 每个 point 必须是精确 x/y/pressure own keys（拒绝未知/缺失键与非有限值）。
          for (let index = 0; index < lastStroke.points.length; index += 1) {
            const point = lastStroke.points[index];
            try {
              assertStrictOwnKeys(point, {
                required: ['x', 'y', 'pressure'],
                label: `lastStroke.points[${index}]`,
              });
            } catch (error) {
              fail(
                `last-stroke-point-keys:${error instanceof Error ? error.message : String(error)}`
              );
            }
            if (
              !point ||
              typeof point !== 'object' ||
              !Number.isFinite(point.x) ||
              !Number.isFinite(point.y) ||
              !Number.isFinite(point.pressure)
            ) {
              fail(`last-stroke-point-${index}:non-finite`);
            }
          }
          if (!expectedPoints) {
            unverifiedChecks.push('lastStroke.points');
            fail(
              `unverifiable:lastStroke.points:${
                geometryReady ? 'missing-eventCount' : 'missing-context-penInput'
              }`
            );
          } else {
            checks.lastStrokePoints.expectedCount = expectedPoints.length;
            const mismatch = comparePointArrays(lastStroke.points, expectedPoints, 1e-9);
            if (mismatch === null) {
              checks.lastStrokePoints.verified = true;
            } else {
              fail(`last-stroke-points:${mismatch}`);
            }
          }
        }
      }
    }
  }

  // ── post-run frame 强制性 schema（含 frame revision 必须匹配 document revision） ──
  const frame = correctnessSnapshot?.frame;
  checks.frame = { passed: false };
  if (!frame || typeof frame !== 'object') {
    missing('correctnessSnapshot.frame');
  } else {
    const frameFailures = [];
    if (frame.ready !== true) frameFailures.push('frame.ready-is-not-true');
    if (!isFinitePoint(frame.origin)) frameFailures.push('frame.origin-not-finite');
    const bounds = frame.visibleWorldBounds;
    if (
      !bounds ||
      !Number.isFinite(bounds.minX) ||
      !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.maxY) ||
      !(bounds.minX < bounds.maxX) ||
      !(bounds.minY < bounds.maxY)
    ) {
      frameFailures.push('frame.visibleWorldBounds-invalid');
    }
    if (!Number.isInteger(frame.visible) || frame.visible < 1) {
      frameFailures.push('frame.visible-not-positive-integer');
    }
    if (!Number.isInteger(frame.renderable) || frame.renderable < 1) {
      frameFailures.push('frame.renderable-not-positive-integer');
    } else if (Number.isInteger(frame.visible) && frame.renderable > frame.visible) {
      frameFailures.push(`frame.renderable-${frame.renderable}:exceeds-visible-${frame.visible}`);
    }
    if (frame.unresolved !== 0) frameFailures.push('frame.unresolved-nonzero');
    // frame revision 必须与 document revision 一致，证明 frame 来自已结算文档。
    if (!Number.isInteger(frame.revision)) {
      missing('correctnessSnapshot.frame.revision');
      frameFailures.push('frame.revision-missing');
    } else if (Number.isInteger(document?.revision) && frame.revision !== document.revision) {
      frameFailures.push(`frame.revision-${frame.revision}:expected-document-${document.revision}`);
    }
    if (frameFailures.length > 0) {
      fail(`post-frame:${frameFailures.join(',')}`);
    } else {
      checks.frame.passed = true;
    }
  }

  // ── post-run controller session 强制性 schema ──
  const session = correctnessSnapshot?.session;
  checks.session = { passed: false };
  if (!session || typeof session !== 'object') {
    missing('correctnessSnapshot.session');
  } else {
    const sessionFailures = [];
    if (session.tool !== 'pen') sessionFailures.push(`tool-${String(session.tool)}`);
    // post-run 也必须是 idle：拒绝 finished / 残余 candidate。
    if (session.status !== 'idle') {
      sessionFailures.push(`status-${String(session.status)}`);
    }
    if (session.pointCount !== 0) sessionFailures.push(`pointCount-${String(session.pointCount)}`);
    if (session.hasCandidate !== false) {
      sessionFailures.push(`hasCandidate-${String(session.hasCandidate)}`);
    }
    if (sessionFailures.length > 0) {
      fail(`post-session:${sessionFailures.join(',')}`);
    } else {
      checks.session.passed = true;
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    missingFields,
    unverifiedChecks,
    checks,
    requiredFields: requiredCorrectnessFields(),
    expected: {
      prefixDigest: expectedPrefixDigest,
      prefixCoordinateSignal: expectedPrefixCoordinateSignal,
      wholeDocumentChecksum: checks.wholeDocumentChecksum.expected,
      prefixStrokeCount: workloadSpec.strokeCount,
      postStrokeCount: expectedStrokeCount,
      revision: 1,
      undoDepth: 1,
      redoDepth: 0,
      eventCount,
      penStyle: { ...EXPECTED_EDITOR_PEN_STYLE },
      candidateStrokeId: EXPECTED_FIRST_CANDIDATE_STROKE_ID,
      penInputPressure: { ...PEN_INPUT_PRESSURE },
      ruler: { ...INITIAL_EDITOR_RULER_RECT },
      scheduleWindowMs: expectedScheduleWindowMs,
    },
    pendingPageFields: [...missingFields],
    limitations: [
      'correctnessContext 必须是 run-start 冻结值（runId/times/clean revision=0/undo=0/redo=0/ruler/idle session）；禁止用 post-run 页面当前值代替基线/revision/history/geometry。',
      'post-run runId 必须与 run-start 一致，capturedAt 必须在 settlement 之后；frame.revision 必须等于 document.revision，且 renderable<=visible。',
      'scheduleWindowEndsAt 必须严格等于 firstScheduledAt + input.durationMs（同时校验 context 与 actual），拒绝被放大的 20s 同步窗口。',
      'run-start 与 post-run session 都必须是 idle pen、pointCount=0、hasCandidate=false；拒绝 finished/残余 candidate。',
      'lastStroke 必须是精确 V2 形状（own keys 仅 schemaVersion/id/tool/points/strokeColor/strokeWidth，schemaVersion=2，每点仅 x/y/pressure），拒绝未知/缺失键。',
      'points 独立公式假设：run 期间 host 尺寸与 viewport 稳定、尺子保持 INITIAL_RULER_STATE、pen 按 x/y 去重且保留先前点 pressure。',
      'prefixDigest 需要页面以相同严格 canonical（仅白名单 own keys、拒绝未知键）表示实现 SHA-256；前两点 FNV 仅 prefixCoordinateSignal（proof=false），不能充当 prefix proof。',
      'post-run 的 checksum 覆盖整个 100001 笔文档，由独立重算的 whole-document checksum 单独比较，绝不与 100k 前缀信号混用（proof=false）。',
      'post-run frame/session 为强制 schema；页面尚未提供时 runner fail closed（NO-GO）。',
      '本 oracle 验证文档正确性，不构成产品性能或跨平台 SLA。',
    ],
  };
}
