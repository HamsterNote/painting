import type { DrawingStrokeV2, DrawingValueV2 } from '@hamster-note/painting/core';
import { checksumPerformanceDocument } from './EditorCandidatePerformance.web';

/**
 * EditorCandidate 的 Web-only、纯函数的 correctness 投影工具。
 *
 * 职责（与 `scripts/perf/editor-production-performance-oracle.mjs` 严格对齐，但绝不 import 该 oracle，
 * 也不重建 seeded workload 来伪造“实际值”）：
 *  1. 对 **实际** V2 文档的前 100000 笔做严格 canonical（仅 own keys + 显式白名单、拒绝未知键）
 *     并计算 SHA-256 前缀 digest；用于与 Node 端独立重算对照。
 *  2. 单独给出 100k 前缀 FNV 弱信号与整份文档 FNV checksum（与既有
 *     `checksumPerformanceDocument` 完全同格式），二者绝不混用。
 *  3. 从真实 controller 形状投影 tool session / ruler，未知形状 fail closed。
 *
 * 约束：本模块不生成 workload，只消费调用方传入的真实 document / controller。
 */

/** 前缀 digest 覆盖的 stroke 数量：只取实际文档的前 100000 笔。 */
export const EDITOR_CORRECTNESS_PREFIX_STROKE_COUNT = 100_000;

/** 严格 canonical 前缀 digest 的 schema 标识（必须与 oracle 逐字一致）。 */
export const EDITOR_CORRECTNESS_PREFIX_DIGEST_SCHEMA =
  'phase-10-editor-performance-workload-prefix/v2-strict-own-keys' as const;

export const EDITOR_CORRECTNESS_PREFIX_DIGEST_ALGORITHM = 'SHA-256' as const;

/** document 仅允许 schemaVersion / strokes 两个 own keys。 */
export const EDITOR_CORRECTNESS_DOCUMENT_KEYS = Object.freeze(['schemaVersion', 'strokes'] as const);

/** stroke 仅允许这 6 个 own keys。 */
export const EDITOR_CORRECTNESS_STROKE_KEYS = Object.freeze([
  'id',
  'tool',
  'schemaVersion',
  'strokeColor',
  'strokeWidth',
  'points',
] as const);

/** point 的 x/y 必填；pressure 可选（存在即进入 digest，不存在则省略）。 */
export const EDITOR_CORRECTNESS_POINT_REQUIRED_KEYS = Object.freeze(['x', 'y'] as const);
export const EDITOR_CORRECTNESS_POINT_OPTIONAL_KEYS = Object.freeze(['pressure'] as const);

/**
 * 100k 前缀前两点 FNV 摘要的历史溯源常量。
 * 取自历史 artifact 的 readinessSnapshot，仅作为 `prefixCoordinateSignal`（proof=false）弱信号，
 * 绝不能充当 prefix proof，也不得与整份文档 checksum 混用。
 */
export const EDITOR_CORRECTNESS_PREFIX_COORDINATE_SIGNAL_PROVENANCE = 'fnv1a-294ac97d';

/** 尺子高度：与 EditorCandidateSurface 的 RULER_HEIGHT 一致。 */
export const EDITOR_CORRECTNESS_RULER_HEIGHT = 42;

/** run-start 尺子基准；oracle 的 INITIAL_EDITOR_RULER_RECT。 */
export const EDITOR_CORRECTNESS_INITIAL_RULER = Object.freeze({
  center: Object.freeze({ x: 360, y: 230 }),
  rotationRad: 0,
  height: EDITOR_CORRECTNESS_RULER_HEIGHT,
  length: 0,
});

export type EditorCorrectnessPrefixDigest = Readonly<{
  algorithm: typeof EDITOR_CORRECTNESS_PREFIX_DIGEST_ALGORITHM;
  schema: typeof EDITOR_CORRECTNESS_PREFIX_DIGEST_SCHEMA;
  strokeCount: number;
  digest: string;
}>;

export type EditorCorrectnessSessionStatus = 'idle' | 'active' | 'finished' | 'cancelled';

/**
 * 纯 session 投影：与 oracle 消费的 `session.tool/status/pointCount/hasCandidate` 对齐，
 * 并额外暴露 `gestureActive` 以便宿主 fail-closed 诊断（oracle 会忽略该额外字段）。
 */
export type EditorCorrectnessSessionProjection = Readonly<{
  tool: string;
  status: EditorCorrectnessSessionStatus;
  pointCount: number;
  hasCandidate: boolean;
  gestureActive: boolean;
}>;

export type EditorCorrectnessRulerProjection = Readonly<{
  center: Readonly<{ x: number; y: number }>;
  rotationRad: number;
  height: number;
  length: number;
}>;

const EDITOR_CORRECTNESS_SESSION_STATUSES = Object.freeze([
  'idle',
  'active',
  'finished',
  'cancelled',
] as const);

// ─────────────────────────────────────────────────────────────────────────────
// 形状校验（fail closed）
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, received ${String(value)}`);
  }
  return value;
}

/**
 * 断言对象的 own enumerable keys 恰好落在 allowed（必填）与 optional（可选）内。
 * 出现未知键、缺少必填键或非普通对象时抛错——绝不静默忽略未知字段。
 */
function assertStrictOwnKeys(
  value: unknown,
  options: Readonly<{ required: readonly string[]; optional?: readonly string[]; label: string }>
): asserts value is Record<string, unknown> {
  const { required, optional = [], label } = options;
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} has unexpected own key "${key}" (reject unexpected)`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label} is missing required own key "${key}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 严格 canonical（仅白名单 own keys，拒绝未知键）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 严格 canonical 编码单个 point：仅接受 x/y/pressure own keys。
 * pressure 存在则输出 `[x, y, pressure]`，不存在则输出 `[x, y]`；未知键抛错。
 */
export function canonicalizeEditorCorrectnessPoint(
  point: unknown,
  label = 'point'
): readonly number[] {
  assertStrictOwnKeys(point, {
    required: EDITOR_CORRECTNESS_POINT_REQUIRED_KEYS,
    optional: EDITOR_CORRECTNESS_POINT_OPTIONAL_KEYS,
    label,
  });
  const x = assertFiniteNumber(point.x, `${label}.x`);
  const y = assertFiniteNumber(point.y, `${label}.y`);
  if (Object.prototype.hasOwnProperty.call(point, 'pressure')) {
    const pressure = assertFiniteNumber(point.pressure, `${label}.pressure`);
    return [x, y, pressure];
  }
  return [x, y];
}

/**
 * 严格 canonical 编码单个 stroke：仅接受 6 个白名单 own keys，points 逐点严格编码。
 * 输出顺序固定为 `[id, tool, schemaVersion, strokeColor, strokeWidth, points]`，与 oracle 一致。
 */
export function canonicalizeEditorCorrectnessStroke(
  stroke: unknown,
  label = 'stroke'
): readonly [
  string,
  string,
  number,
  string,
  number,
  readonly (readonly number[])[],
] {
  assertStrictOwnKeys(stroke, { required: EDITOR_CORRECTNESS_STROKE_KEYS, label });
  const id = stroke.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`${label} id must be a non-empty string`);
  }
  const tool = stroke.tool;
  if (typeof tool !== 'string') {
    throw new TypeError(`${label} tool must be a string`);
  }
  const schemaVersion = assertFiniteNumber(stroke.schemaVersion, `${label}.schemaVersion`);
  const strokeColor = stroke.strokeColor;
  if (typeof strokeColor !== 'string') {
    throw new TypeError(`${label} strokeColor must be a string`);
  }
  const strokeWidth = assertFiniteNumber(stroke.strokeWidth, `${label}.strokeWidth`);
  const points = stroke.points;
  if (!Array.isArray(points)) {
    throw new TypeError(`${label} points must be an array`);
  }
  return [
    id,
    tool,
    schemaVersion,
    strokeColor,
    strokeWidth,
    points.map((point, index) =>
      canonicalizeEditorCorrectnessPoint(point, `${label}.points[${index}]`)
    ),
  ];
}

/**
 * 严格 canonical 前缀表示：只消费实际文档的前 `strokeCount` 笔。
 * document 仅允许 schemaVersion/strokes own keys；要求实际笔数不少于 `strokeCount`（fail closed）。
 */
export function canonicalizeEditorCorrectnessPrefixDocument(
  document: unknown,
  strokeCount: number = EDITOR_CORRECTNESS_PREFIX_STROKE_COUNT
): Readonly<{ schemaVersion: number; strokes: readonly (readonly unknown[])[] }> {
  const count = assertPositiveInteger(strokeCount, 'strokeCount');
  assertStrictOwnKeys(document, { required: EDITOR_CORRECTNESS_DOCUMENT_KEYS, label: 'document' });
  const schemaVersion = assertFiniteNumber(document.schemaVersion, 'document.schemaVersion');
  const strokes = document.strokes;
  if (!Array.isArray(strokes)) {
    throw new TypeError('document.strokes must be an array');
  }
  if (strokes.length < count) {
    throw new RangeError(
      `document.strokes has ${strokes.length} entries but prefix requires ${count}`
    );
  }
  const prefixed = new Array<readonly unknown[]>(count);
  for (let index = 0; index < count; index += 1) {
    prefixed[index] = canonicalizeEditorCorrectnessStroke(
      strokes[index],
      `document.strokes[${index}]`
    );
  }
  return { schemaVersion, strokes: prefixed };
}

/** 严格 canonical 前缀的 UTF-8 JSON 序列化；字段顺序固定，供 SHA-256 输入。 */
export function serializeEditorCorrectnessPrefixDocument(
  document: unknown,
  strokeCount: number = EDITOR_CORRECTNESS_PREFIX_STROKE_COUNT
): string {
  return JSON.stringify(canonicalizeEditorCorrectnessPrefixDocument(document, strokeCount));
}

// ─────────────────────────────────────────────────────────────────────────────
// 前缀 SHA-256 digest（WebCrypto，小写 hex）
// ─────────────────────────────────────────────────────────────────────────────

async function sha256LowercaseHex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) {
    throw new Error('crypto.subtle is unavailable; strict prefix digest requires WebCrypto');
  }
  const buffer = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  const view = new Uint8Array(buffer);
  let hex = '';
  for (const byte of view) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * 按 document 身份 + 前缀长度缓存前缀 digest 的 Promise。
 * 编辑器文档是不可变对象，避免在每个 render 重复对 100k 笔做 SHA-256。
 */
const prefixDigestCache = new WeakMap<object, Map<number, Promise<EditorCorrectnessPrefixDigest>>>();

/**
 * 对 **实际** 文档的前 100000 笔做严格 canonical SHA-256，返回与 oracle 同构的 digest 描述。
 * 未知 own keys / 非有限值 / 笔数不足一律 fail closed（抛错）。
 * 不重建 seeded workload；digest 完全来自传入的真实文档。
 */
export function computeEditorCorrectnessPrefixDigest(
  document: unknown,
  strokeCount: number = EDITOR_CORRECTNESS_PREFIX_STROKE_COUNT
): Promise<EditorCorrectnessPrefixDigest> {
  const count = assertPositiveInteger(strokeCount, 'strokeCount');
  if (!isPlainObject(document)) {
    throw new TypeError('document must be a plain object');
  }
  let byCount = prefixDigestCache.get(document);
  if (!byCount) {
    byCount = new Map();
    prefixDigestCache.set(document, byCount);
  }
  const cached = byCount.get(count);
  if (cached) return cached;
  const pending = (async () => {
    const canonical = serializeEditorCorrectnessPrefixDocument(document, count);
    const digest = await sha256LowercaseHex(canonical);
    return Object.freeze({
      algorithm: EDITOR_CORRECTNESS_PREFIX_DIGEST_ALGORITHM,
      schema: EDITOR_CORRECTNESS_PREFIX_DIGEST_SCHEMA,
      strokeCount: count,
      digest,
    });
  })();
  byCount.set(count, pending);
  return pending;
}

/** 严格比较 prefixDigest 的四个字段（algorithm/schema/strokeCount/digest）。 */
export function editorCorrectnessPrefixDigestMatches(
  actual: unknown,
  expected: EditorCorrectnessPrefixDigest
): boolean {
  if (!isPlainObject(actual)) return false;
  return (
    actual.algorithm === expected.algorithm &&
    actual.schema === expected.schema &&
    actual.strokeCount === expected.strokeCount &&
    actual.digest === expected.digest
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FNV 弱信号：100k 前缀 与 整份文档（绝不混用）
// ─────────────────────────────────────────────────────────────────────────────

function fnv1aAdd(hash: number, value: number): number {
  const text = String(value);
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, 0x01000193);
  }
  return next;
}

/** 与 `checksumPerformanceDocument` 完全同格式，但只消费前 `count` 笔，且不复制数组。 */
function fnv1aOverStrokes(strokes: readonly DrawingStrokeV2[], count: number): string {
  let hash = 0x811c9dc5;
  hash = fnv1aAdd(hash, count);
  for (let index = 0; index < count; index += 1) {
    const stroke = strokes[index];
    hash = fnv1aAdd(hash, stroke.points[0]?.x ?? 0);
    hash = fnv1aAdd(hash, stroke.points[0]?.y ?? 0);
    hash = fnv1aAdd(hash, stroke.points[1]?.x ?? 0);
    hash = fnv1aAdd(hash, stroke.points[1]?.y ?? 0);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function assertDocumentStrokes(document: unknown, strokeCount: number): readonly DrawingStrokeV2[] {
  if (!isPlainObject(document)) {
    throw new TypeError('document must be a plain object');
  }
  const strokes = document.strokes;
  if (!Array.isArray(strokes)) {
    throw new TypeError('document.strokes must be an array');
  }
  if (strokes.length < strokeCount) {
    throw new RangeError(
      `document.strokes has ${strokes.length} entries but prefix requires ${strokeCount}`
    );
  }
  return strokes as readonly DrawingValueV2['strokes'][number][];
}

const prefixCoordinateSignalCache = new WeakMap<object, Map<number, string>>();

/**
 * 仅前 100k 笔的前两点 FNV 数值摘要（`prefixCoordinateSignal`，proof=false）。
 * 与整份文档 checksum 严格分离；不得互相比较。
 */
export function computeEditorCorrectnessPrefixCoordinateSignal(
  document: unknown,
  strokeCount: number = EDITOR_CORRECTNESS_PREFIX_STROKE_COUNT
): string {
  const count = assertPositiveInteger(strokeCount, 'strokeCount');
  if (!isPlainObject(document)) {
    throw new TypeError('document must be a plain object');
  }
  let byCount = prefixCoordinateSignalCache.get(document);
  if (!byCount) {
    byCount = new Map();
    prefixCoordinateSignalCache.set(document, byCount);
  }
  const cached = byCount.get(count);
  if (cached !== undefined) return cached;
  const signal = fnv1aOverStrokes(assertDocumentStrokes(document, count), count);
  byCount.set(count, signal);
  return signal;
}

const wholeDocumentChecksumCache = new WeakMap<object, string>();

/**
 * 整份文档（含追加的最后一笔）的 FNV checksum，与既有 `checksumPerformanceDocument`
 * 逐字同格式；按 document 身份缓存，避免每个 render 重复全量扫描。
 */
export function computeEditorCorrectnessWholeDocumentChecksum(document: unknown): string {
  if (!isPlainObject(document)) {
    throw new TypeError('document must be a plain object');
  }
  const cached = wholeDocumentChecksumCache.get(document);
  if (cached !== undefined) return cached;
  const checksum = checksumPerformanceDocument(document as unknown as DrawingValueV2);
  wholeDocumentChecksumCache.set(document, checksum);
  return checksum;
}

// ─────────────────────────────────────────────────────────────────────────────
// controller 投影（纯函数，未知形状 fail closed）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从真实 `EditorControllerState` 投影 tool session。
 *
 * - `toolSession` 存在：校验 status/points，pointCount 取 points.length。
 * - `toolSession` 缺失：仅在无候选、无 activeGesture 时投影为 idle pen（fail closed 否则）。
 * - `hasCandidate` 只由 `controller.strokeCandidate` 是否存在决定，与 activeGesture 区分。
 * - 候选存在与 finished 状态不一致时 fail closed。
 */
export function projectEditorCorrectnessSession(controller: unknown): EditorCorrectnessSessionProjection {
  if (!isPlainObject(controller)) {
    throw new TypeError('controller must be a plain object');
  }
  const tool = controller.tool;
  if (typeof tool !== 'string' || tool.length === 0) {
    throw new TypeError('controller.tool must be a non-empty string');
  }

  let gestureActive = false;
  const interaction = controller.interaction;
  if (interaction !== undefined && interaction !== null) {
    if (!isPlainObject(interaction)) {
      throw new TypeError('controller.interaction must be a plain object when present');
    }
    gestureActive = interaction.activeGesture !== undefined && interaction.activeGesture !== null;
  }

  const hasCandidate = controller.strokeCandidate !== undefined && controller.strokeCandidate !== null;
  const session = controller.toolSession;

  if (session === undefined || session === null) {
    // 缺失会话只有在确实“干净”（无候选、无活动手势）时才可解释为 idle pen。
    if (hasCandidate) {
      throw new TypeError('controller has strokeCandidate without toolSession (fail closed)');
    }
    if (gestureActive) {
      throw new TypeError('controller has activeGesture without toolSession (fail closed)');
    }
    return Object.freeze({
      tool,
      status: 'idle' as const,
      pointCount: 0,
      hasCandidate: false,
      gestureActive: false,
    });
  }

  if (!isPlainObject(session)) {
    throw new TypeError('controller.toolSession must be a plain object');
  }
  const sessionTool = session.tool;
  if (typeof sessionTool !== 'string' || sessionTool.length === 0) {
    throw new TypeError('controller.toolSession.tool must be a non-empty string');
  }
  const status = session.status;
  if (
    typeof status !== 'string' ||
    !(EDITOR_CORRECTNESS_SESSION_STATUSES as readonly string[]).includes(status)
  ) {
    throw new TypeError(`controller.toolSession.status is not recognized: ${String(status)}`);
  }
  const points = session.points;
  if (!Array.isArray(points)) {
    throw new TypeError('controller.toolSession.points must be an array');
  }
  let pointCount = 0;
  for (const point of points) {
    if (!isPlainObject(point)) {
      throw new TypeError('controller.toolSession.points contains a non-object point');
    }
    assertFiniteNumber(point.x, 'controller.toolSession.points[].x');
    assertFiniteNumber(point.y, 'controller.toolSession.points[].y');
    pointCount += 1;
  }
  if (hasCandidate && status !== 'finished') {
    throw new TypeError(
      `controller has strokeCandidate while toolSession.status is ${status} (fail closed)`
    );
  }

  return Object.freeze({
    tool: sessionTool,
    status: status as EditorCorrectnessSessionStatus,
    pointCount,
    hasCandidate,
    gestureActive,
  });
}

/**
 * 从真实尺子状态投影 oracle 的 ruler 形状。
 * 实际态只保存 center/rotationRad；height 取 RULER_HEIGHT，length 恒为 0（应用未追踪长度）。
 */
export function projectEditorCorrectnessRuler(
  state: unknown = EDITOR_CORRECTNESS_INITIAL_RULER,
  height: unknown = EDITOR_CORRECTNESS_RULER_HEIGHT
): EditorCorrectnessRulerProjection {
  if (!isPlainObject(state)) {
    throw new TypeError('ruler state must be a plain object');
  }
  const center = state.center;
  if (!isPlainObject(center)) {
    throw new TypeError('ruler state.center must be a plain object');
  }
  const x = assertFiniteNumber(center.x, 'ruler.center.x');
  const y = assertFiniteNumber(center.y, 'ruler.center.y');
  const rotationRad = assertFiniteNumber(state.rotationRad, 'ruler.rotationRad');
  const resolvedHeight = assertFiniteNumber(height, 'ruler.height');
  if (resolvedHeight <= 0) {
    throw new RangeError('ruler.height must be a finite positive number');
  }
  return Object.freeze({
    center: Object.freeze({ x, y }),
    rotationRad,
    height: resolvedHeight,
    length: 0,
  });
}
