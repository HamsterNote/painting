/**
 * schemaVersion 3 分层编辑器文档的只读 reader 与 JSON 序列化/反序列化。
 *
 * 职责边界：
 * - 只依赖 model/document.ts 的冻结类型与常量；不 import PF / DOM / Skia / V2 / controller。
 * - 只做白名单深拷贝：仅复制契约内的持久字段，剥除预测点、插值、outline、strokePoints、
 *   cache、session、dashPen、pressureMultiplier 等未知/派生字段。
 * - 只接受 schemaVersion 3；不提供 schema migration、旧 schema fallback、磁盘 IO 或导出。
 * - 输入对象永不被改写；拷贝结果递归冻结。
 * - 失败以 Result 返回（不抛业务异常），路径指向首个非法字段。
 *
 * 注意：documentRevision 只是文档单调修订号，reader 不据此推断“undo 可回退到底”，
 * 也不向 controller 暗示任何历史可逆性；它仅做非负安全整数校验后原样保存。
 */

import {
  copyFreehandRuler,
  LAYERED_SCHEMA_VERSION,
  type AcceptedSample,
  type AffineTransform,
  type Bounds,
  type BrushSnapshot,
  type DocumentObject,
  type EditorDocument,
  type FreehandObject,
  type ImageObject,
  type InputSource,
  type Point,
  type PressureMode,
  type ResolvedPressureMode,
  type SamplePhase,
  type ShapeObject,
  type ShapeStyle,
  type ShapeType,
  type TextObject,
} from './document';

/** reader 失败原因：JSON 文本本身非法，或结构不符合 schema3 契约。 */
export type DocumentReadError = Readonly<{
  code: 'invalid-json' | 'invalid-document';
  /** 首个非法位置的路径，例如 `$.objects[0].transform.a`。 */
  path: string;
}>;

/** reader 结果：成功携带冻结文档，失败携带错误原因。 */
export type DocumentReadResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: DocumentReadError }>;

/** 枚举白名单表；与 model/document.ts 的联合类型保持一致。 */
const SHAPE_TYPES: readonly ShapeType[] = ['line', 'rect', 'ellipse', 'polygon', 'bezier'];
const INPUT_SOURCES: readonly InputSource[] = ['mouse', 'touch', 'pen', 'native'];
const SAMPLE_PHASES: readonly SamplePhase[] = ['down', 'move', 'up'];
const PRESSURE_MODES: readonly PressureMode[] = ['auto', 'real', 'simulated', 'constant'];
const RESOLVED_PRESSURE_MODES: readonly ResolvedPressureMode[] = ['real', 'simulated', 'constant'];

/** 内部校验失败信号；只在本模块边界被捕获并转成 Result。 */
class DocumentReadFailure extends Error {
  readonly path: string;
  constructor(path: string) {
    super(path);
    this.path = path;
  }
}

/** 记录非法路径并中止当前读取。 */
function fail(path: string): never {
  throw new DocumentReadFailure(path);
}

/** 普通对象（排除 null 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path);
  return value;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path);
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path);
  return value;
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path);
  return value;
}

function readNonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(path);
  return value;
}

function readPositiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(path);
  return value;
}

function readUnitInterval(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(path);
  return value;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail(path);
  return value as T;
}

/** 递归冻结白名单拷贝结果，确保 reader 输出不可变。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** 白名单拷贝有限点。 */
function readPoint(value: unknown, path: string): Point {
  const record = readRecord(value, path);
  return {
    x: readFiniteNumber(record.x, `${path}.x`),
    y: readFiniteNumber(record.y, `${path}.y`),
  };
}

/** 白名单拷贝 bounds；要求各分量有限且有序，允许零面积（min === max）。 */
function readBounds(value: unknown, path: string): Bounds {
  const record = readRecord(value, path);
  const minX = readFiniteNumber(record.minX, `${path}.minX`);
  const minY = readFiniteNumber(record.minY, `${path}.minY`);
  const maxX = readFiniteNumber(record.maxX, `${path}.maxX`);
  const maxY = readFiniteNumber(record.maxY, `${path}.maxY`);
  if (minX > maxX || minY > maxY) fail(path);
  return { minX, minY, maxX, maxY };
}

/** 白名单拷贝仿射；要求六分量有限且矩阵行列式有限非零（可逆、非奇异）。 */
function readTransform(value: unknown, path: string): AffineTransform {
  const record = readRecord(value, path);
  const a = readFiniteNumber(record.a, `${path}.a`);
  const b = readFiniteNumber(record.b, `${path}.b`);
  const c = readFiniteNumber(record.c, `${path}.c`);
  const d = readFiniteNumber(record.d, `${path}.d`);
  const tx = readFiniteNumber(record.tx, `${path}.tx`);
  const ty = readFiniteNumber(record.ty, `${path}.ty`);
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) fail(path);
  return { a, b, c, d, tx, ty };
}

/** 白名单拷贝 brush 五字段；pressureMode 为落笔 requested 枚举（可含 auto）。 */
function readBrush(value: unknown, path: string): BrushSnapshot {
  const record = readRecord(value, path);
  return {
    color: readNonEmptyString(record.color, `${path}.color`),
    nominalSize: readPositiveNumber(record.nominalSize, `${path}.nominalSize`),
    opacity: readUnitInterval(record.opacity, `${path}.opacity`),
    pressureMode: readEnum(record.pressureMode, PRESSURE_MODES, `${path}.pressureMode`),
    presetRevision: readNonNegativeSafeInteger(record.presetRevision, `${path}.presetRevision`),
  };
}

/** 白名单拷贝 shape 样式；dash/fill 可选，按有无保真。 */
function readShapeStyle(value: unknown, path: string): ShapeStyle {
  const record = readRecord(value, path);
  const style: {
    color: string;
    width: number;
    opacity: number;
    dash?: readonly number[];
    fill?: string;
  } = {
    color: readNonEmptyString(record.color, `${path}.color`),
    width: readPositiveNumber(record.width, `${path}.width`),
    opacity: readUnitInterval(record.opacity, `${path}.opacity`),
  };
  // dash 可选：存在即要求数组且逐项有限非负（允许 0），缺失则保持缺失。
  if (record.dash !== undefined) {
    const rawDash = readArray(record.dash, `${path}.dash`);
    style.dash = rawDash.map((entry, index) => {
      const dashValue = readFiniteNumber(entry, `${path}.dash[${index}]`);
      if (dashValue < 0) fail(`${path}.dash[${index}]`);
      return dashValue;
    });
  }
  // fill 可选：存在即字符串（允许空串），缺失则保持缺失。
  if (record.fill !== undefined) {
    style.fill = readString(record.fill, `${path}.fill`);
  }
  return style;
}

/**
 * 白名单拷贝单个 raw sample。
 * - pressure 可选：缺失保持缺失；合法 0 与有限越界值一律按原值保存，不做 clamp。
 * - 不以 time 排序、不重采样、不因点相同而拒绝。
 */
function readSample(value: unknown, path: string): AcceptedSample {
  const record = readRecord(value, path);
  const sample: {
    sequence: number;
    x: number;
    y: number;
    pressure?: number;
    time: number;
    phase: SamplePhase;
    source: InputSource;
  } = {
    sequence: readNonNegativeSafeInteger(record.sequence, `${path}.sequence`),
    x: readFiniteNumber(record.x, `${path}.x`),
    y: readFiniteNumber(record.y, `${path}.y`),
    time: readFiniteNumber(record.time, `${path}.time`),
    phase: readEnum(record.phase, SAMPLE_PHASES, `${path}.phase`),
    source: readEnum(record.source, INPUT_SOURCES, `${path}.source`),
  };
  if (record.pressure !== undefined) {
    sample.pressure = readFiniteNumber(record.pressure, `${path}.pressure`);
  }
  return sample;
}

/** 白名单拷贝 freehand 对象；校验完整笔序列、单一 source 与 revision。 */
function readFreehandObject(record: Record<string, unknown>, path: string): FreehandObject {
  const rulerSnapshot =
    record.rulerSnapshot === undefined ? undefined : copyFreehandRuler(record.rulerSnapshot);
  if (rulerSnapshot === null) fail(`${path}.rulerSnapshot`);
  const objectId = readNonEmptyString(record.objectId, `${path}.objectId`);
  const objectRevision = readNonNegativeSafeInteger(
    record.objectRevision,
    `${path}.objectRevision`
  );
  const transform = readTransform(record.transform, `${path}.transform`);
  const transformRevision = readNonNegativeSafeInteger(
    record.transformRevision,
    `${path}.transformRevision`
  );
  const commitId = readNonEmptyString(record.commitId, `${path}.commitId`);
  const brushSnapshot = readBrush(record.brushSnapshot, `${path}.brushSnapshot`);
  const resolvedPressureMode = readEnum(
    record.resolvedPressureMode,
    RESOLVED_PRESSURE_MODES,
    `${path}.resolvedPressureMode`
  );
  // 显式 requested（非 auto）必须与已锁定的 resolved 相同；auto 已有 resolved 不重新推断。
  if (
    brushSnapshot.pressureMode !== 'auto' &&
    brushSnapshot.pressureMode !== resolvedPressureMode
  ) {
    fail(`${path}.resolvedPressureMode`);
  }

  const rawSamples = readArray(record.samples, `${path}.samples`);
  if (rawSamples.length < 2) fail(`${path}.samples`);
  const samples: AcceptedSample[] = [];
  for (let index = 0; index < rawSamples.length; index += 1) {
    const sample = readSample(rawSamples[index], `${path}.samples[${index}]`);
    // sequence 从 0 连续（0,1,2,…），同时即严格递增。
    if (sample.sequence !== index) fail(`${path}.samples[${index}].sequence`);
    samples.push(sample);
  }
  // 整笔 source 一致，拒绝 mixed source 混入。
  const strokeSource = samples[0]!.source;
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index]!.source !== strokeSource) fail(`${path}.samples[${index}].source`);
  }
  // 完成序列：首帧 down、末帧 up、中间全 move。
  if (samples[0]!.phase !== 'down') fail(`${path}.samples[0].phase`);
  if (samples[samples.length - 1]!.phase !== 'up') {
    fail(`${path}.samples[${samples.length - 1}].phase`);
  }
  for (let index = 1; index < samples.length - 1; index += 1) {
    if (samples[index]!.phase !== 'move') fail(`${path}.samples[${index}].phase`);
  }

  return {
    kind: 'freehand',
    objectId,
    objectRevision,
    transform,
    transformRevision,
    commitId,
    samples,
    brushSnapshot,
    ...(rulerSnapshot ? { rulerSnapshot } : {}),
    resolvedPressureMode,
    samplesRevision: readNonNegativeSafeInteger(record.samplesRevision, `${path}.samplesRevision`),
    brushRevision: readNonNegativeSafeInteger(record.brushRevision, `${path}.brushRevision`),
  };
}

/** 白名单拷贝 shape 对象；暂不约束 points 数量下限，只要求逐点有限。 */
function readShapeObject(record: Record<string, unknown>, path: string): ShapeObject {
  const objectId = readNonEmptyString(record.objectId, `${path}.objectId`);
  const objectRevision = readNonNegativeSafeInteger(
    record.objectRevision,
    `${path}.objectRevision`
  );
  const transform = readTransform(record.transform, `${path}.transform`);
  const transformRevision = readNonNegativeSafeInteger(
    record.transformRevision,
    `${path}.transformRevision`
  );
  const shapeType = readEnum(record.shapeType, SHAPE_TYPES, `${path}.shapeType`);
  const rawPoints = readArray(record.points, `${path}.points`);
  const points: Point[] = rawPoints.map((entry, index) =>
    readPoint(entry, `${path}.points[${index}]`)
  );
  const style = readShapeStyle(record.style, `${path}.style`);
  return {
    kind: 'shape',
    objectId,
    objectRevision,
    transform,
    transformRevision,
    shapeType,
    points,
    style,
  };
}

/** 白名单拷贝 image 对象；resourceId 可选但存在时必须非空，按有无保真。 */
function readImageObject(record: Record<string, unknown>, path: string): ImageObject {
  const objectId = readNonEmptyString(record.objectId, `${path}.objectId`);
  const objectRevision = readNonNegativeSafeInteger(
    record.objectRevision,
    `${path}.objectRevision`
  );
  const transform = readTransform(record.transform, `${path}.transform`);
  const transformRevision = readNonNegativeSafeInteger(
    record.transformRevision,
    `${path}.transformRevision`
  );
  const src = readNonEmptyString(record.src, `${path}.src`);
  const localBounds = readBounds(record.localBounds, `${path}.localBounds`);
  const image: {
    kind: 'image';
    objectId: string;
    objectRevision: number;
    transform: AffineTransform;
    transformRevision: number;
    src: string;
    resourceId?: string;
    localBounds: Bounds;
  } = {
    kind: 'image',
    objectId,
    objectRevision,
    transform,
    transformRevision,
    src,
    localBounds,
  };
  if (record.resourceId !== undefined) {
    image.resourceId = readNonEmptyString(record.resourceId, `${path}.resourceId`);
  }
  return image;
}

/** 白名单拷贝 text 对象；content 允许空串，fontSize 必须为正。 */
function readTextObject(record: Record<string, unknown>, path: string): TextObject {
  const objectId = readNonEmptyString(record.objectId, `${path}.objectId`);
  const objectRevision = readNonNegativeSafeInteger(
    record.objectRevision,
    `${path}.objectRevision`
  );
  const transform = readTransform(record.transform, `${path}.transform`);
  const transformRevision = readNonNegativeSafeInteger(
    record.transformRevision,
    `${path}.transformRevision`
  );
  const content = readString(record.content, `${path}.content`);
  const fontSize = readPositiveNumber(record.fontSize, `${path}.fontSize`);
  const color = readNonEmptyString(record.color, `${path}.color`);
  const localBounds = readBounds(record.localBounds, `${path}.localBounds`);
  return {
    kind: 'text',
    objectId,
    objectRevision,
    transform,
    transformRevision,
    content,
    fontSize,
    color,
    localBounds,
  };
}

/** 按 kind 分派白名单拷贝；未知 kind 视为非法。 */
function readDocumentObject(value: unknown, path: string): DocumentObject {
  const record = readRecord(value, path);
  switch (record.kind) {
    case 'freehand':
      return readFreehandObject(record, path);
    case 'shape':
      return readShapeObject(record, path);
    case 'image':
      return readImageObject(record, path);
    case 'text':
      return readTextObject(record, path);
    default:
      return fail(`${path}.kind`);
  }
}

/** 读取并校验 schema3 文档：唯一 objectId、freehand 唯一 commitId、保持对象顺序。 */
function readDocument(value: unknown): EditorDocument {
  const record = readRecord(value, '$');
  // 只接受 schemaVersion 3，不做旧 schema fallback。
  if (record.schemaVersion !== LAYERED_SCHEMA_VERSION) fail('$.schemaVersion');
  const documentRevision = readNonNegativeSafeInteger(
    record.documentRevision,
    '$.documentRevision'
  );
  const rawObjects = readArray(record.objects, '$.objects');
  const seenObjectIds = new Set<string>();
  const seenCommitIds = new Set<string>();
  const objects: DocumentObject[] = [];
  for (let index = 0; index < rawObjects.length; index += 1) {
    const path = `$.objects[${index}]`;
    const object = readDocumentObject(rawObjects[index], path);
    if (seenObjectIds.has(object.objectId)) fail(`${path}.objectId`);
    seenObjectIds.add(object.objectId);
    if (object.kind === 'freehand') {
      if (seenCommitIds.has(object.commitId)) fail(`${path}.commitId`);
      seenCommitIds.add(object.commitId);
    }
    objects.push(object);
  }
  return { schemaVersion: LAYERED_SCHEMA_VERSION, documentRevision, objects };
}

/** 成功 Result 构造 helper。 */
function ok<T>(value: T): DocumentReadResult<T> {
  return Object.freeze({ ok: true as const, value });
}

/** 失败 Result 构造 helper。 */
function err(code: DocumentReadError['code'], path: string): DocumentReadResult<never> {
  return Object.freeze({ ok: false as const, error: Object.freeze({ code, path }) });
}

/**
 * 从内存值读取 schema3 文档。
 * 成功返回白名单深拷贝并递归冻结的文档；失败返回首个非法路径，不抛业务异常。
 */
export function readLayeredDocument(value: unknown): DocumentReadResult<EditorDocument> {
  try {
    return ok(deepFreeze(readDocument(value)));
  } catch (error) {
    if (error instanceof DocumentReadFailure) {
      return err('invalid-document', error.path);
    }
    throw error;
  }
}

/**
 * 从 JSON 文本解析 schema3 文档。
 * 非字符串或 JSON.parse 失败返回 invalid-json（不抛出）；结构非法返回 invalid-document。
 */
export function parseLayeredDocument(json: string): DocumentReadResult<EditorDocument> {
  if (typeof json !== 'string') return err('invalid-json', '$');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return err('invalid-json', '$');
  }
  return readLayeredDocument(parsed);
}

/**
 * 序列化任意值为 schema3 文档 JSON。
 * 先经 read 白名单拷贝校验（剥除 extras），再对冻结副本 JSON.stringify；
 * 绝不直接序列化 caller 原值。失败返回对应 Result。
 */
export function serializeLayeredDocument(value: unknown): DocumentReadResult<string> {
  const read = readLayeredDocument(value);
  if (!read.ok) return read;
  try {
    return ok(JSON.stringify(read.value));
  } catch {
    return err('invalid-document', '$');
  }
}
