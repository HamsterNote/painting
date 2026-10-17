/**
 * 分层编辑器控制器（Task 3.1 / 4.4）。
 *
 * 实现范围：
 * - 公开类型契约 + 私有 typed schema3 document adopter / copy helpers。
 * - 私有 document/history/commit kernel：registry/tombstone、exact canonical 提交、
 *   revision 单调 undo/redo、presentation identity 查询。
 * - 导出的 `createLayeredEditorController`：组合 kernel 与 session/settings/selection/viewport
 *   及 channel 订阅，作为 headless 单一真源。
 *
 * 边界（design.md 决策 1 / 5 / 6）：
 * - 不依赖 DOM / React / Canvas / SVG / Skia / 旧 controller / reader / protocol。
 * - 只预留 `LayeredPresentationIdentity`，不实现 ACK / handoff / native / 像素渲染。
 * - 2.2 持久 reader 未完成：本模块只接受已是 typed schema3 的内存文档，不做 JSON reader/migration。
 */

import {
  copyFreehandRuler,
  type FreehandRulerSnapshot,
  IDENTITY_TRANSFORM,
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
} from '../model/document';
import { MAX_VIEWPORT_SCALE, MIN_VIEWPORT_SCALE, type DrawingViewport } from '../viewport';
import {
  beginFreehandSession,
  type BeginFreehandSessionInput,
  type FreehandCandidate,
  type FreehandCommitFeedback,
  type FreehandSession,
  type FreehandSessionCancel,
  type FreehandSessionEnd,
  type FreehandSessionResult,
  type FreehandSessionSnapshot,
  type FreehandSessionUpdate,
} from './freehandSession';
import { applyViewportTransformIntent, type ViewportTransformIntent } from './viewportTransform';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import {
  SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS,
  type DrawingSurfaceVirtualPaperInteraction,
} from '../virtualPaperOptions';

/** 活动工具：自由笔、形状、图片、文字与交互工具（选择/套索/橡皮/平移）。 */
export type LayeredEditorTool =
  | 'freehand'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'bezier'
  | 'image'
  | 'text'
  | 'selection'
  | 'lasso'
  | 'eraser'
  | 'pan';

/** 工具设置：自由笔使用不可变 brush 快照，形状使用独立样式（dash 只属于形状）。 */
export type LayeredEditorSettings = Readonly<{
  freehand: BrushSnapshot;
  shape: ShapeStyle;
}>;

/** 唯一 viewport 的单调 revision 快照。 */
export type LayeredViewportSnapshot = Readonly<{
  revision: number;
  viewport: DrawingViewport;
}>;

/**
 * viewport 命令：结构先校验，`expectedRevision` 不匹配按 stale 拒绝。
 * `replace` 直接给出目标 viewport；`transform` 应用一个手势 intent。
 */
export type LayeredViewportCommand =
  | Readonly<{ type: 'replace'; expectedRevision: number; viewport: DrawingViewport }>
  | Readonly<{ type: 'transform'; expectedRevision: number; intent: ViewportTransformIntent }>;

/**
 * begin 输入：由 controller 覆写 brush 与 viewportSnapshot（唯一权威），
 * 调用方只提供 commitId / 压力能力 / 输入批次。
 */
export type LayeredBeginInput = Omit<BeginFreehandSessionInput, 'brush' | 'viewportSnapshot'>;

/** 呈现身份四字段；非保存数据，用于未来 presentation handoff（本期不实现 ACK）。 */
export type LayeredPresentationIdentity = Readonly<{
  objectId: string;
  commitId: string;
  documentRevision: number;
  geometryRevision: string;
}>;

/** 提交回执：created 或 duplicate；`presentationIdentity` 仅在对象存在于当前文档时非 null。 */
export type LayeredCommitReceipt = Readonly<{
  status: 'created' | 'duplicate';
  objectId: string;
  commitId: string;
  documentRevision: number;
  presentInDocument: boolean;
  presentationIdentity: LayeredPresentationIdentity | null;
}>;

/** 控制器拒绝码；覆盖输入、文档、会话、提交、viewport、selection、history 与不变量。 */
export type LayeredEditorErrorCode =
  | 'invalid-input'
  | 'invalid-document'
  | 'active-session-conflict'
  | 'no-active-session'
  | 'tool-not-freehand'
  | 'commit-id-in-flight'
  | 'pending-commit-not-found'
  | 'pending-commit-out-of-order'
  | 'commit-id-conflict'
  | 'object-id-conflict'
  | 'object-id-allocation-failed'
  | 'final-geometry-failed'
  | 'stale-viewport-revision'
  | 'selection-target-missing'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'revision-exhausted'
  | 'session-rejected'
  | 'internal-invariant';

/** 会话层错误码（从 session Result 推导），随 `session-rejected` 一起返回。 */
export type LayeredSessionErrorCode = Extract<
  FreehandSessionResult<unknown>,
  { ok: false }
>['code'];

/** 统一 Result：成功携带值，失败给可测 code；会话失败另带 sessionCode。 */
export type LayeredEditorResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: LayeredEditorErrorCode; sessionCode?: LayeredSessionErrorCode }>;
    }>;

/** 订阅频道；除 interaction 外均按 state 返回稳定引用，适合 useSyncExternalStore。 */
export type LayeredEditorChannel =
  | 'document'
  | 'history'
  | 'tools'
  | 'selection'
  | 'viewport'
  | 'preview'
  | 'interaction'
  | 'navigation';

export type LayeredNavigationSnapshot = Readonly<{
  paper: boolean;
  minimap: boolean;
  ruler: Readonly<{ visible: boolean; center: Point; rotationRad: number; height: number }>;
  rotationFeedback: Readonly<{ point: Point; rotationRad: number }> | null;
  zoomFeedback: Readonly<{ point: Point; scale: number; token: number }> | null;
  virtualPaper: Readonly<{
    enabled: boolean;
    initialPlacement: 'top-left' | 'center';
    minScale: number;
    maxScale: number;
    enabledInteractions: readonly DrawingSurfaceVirtualPaperInteraction[];
  }>;
}>;

/** history 频道快照。 */
export type LayeredHistorySnapshot = Readonly<{
  canUndo: boolean;
  canRedo: boolean;
}>;

/** tools 频道快照：活动工具与设置。 */
export type LayeredToolsSnapshot = Readonly<{
  activeTool: LayeredEditorTool;
  settings: LayeredEditorSettings;
}>;

/** selection 频道快照：文档内存在的对象 id（只读）。 */
export type LayeredSelectionSnapshot = readonly string[];

export type LayeredPreviewSnapshot = Readonly<{
  objects: readonly DocumentObject[];
  hiddenIds: readonly string[];
  path: readonly Point[];
}>;
const EMPTY_PREVIEW: LayeredPreviewSnapshot = Object.freeze({
  objects: Object.freeze([]),
  hiddenIds: Object.freeze([]),
  path: Object.freeze([]),
});

/**
 * interaction 频道快照：当前 collecting 会话快照与等待提交的候选。
 * 该频道按需构造（下一 UI 阶段再验证缓存策略），不承诺稳定引用。
 */
export type LayeredInteractionSnapshot = Readonly<{
  activeFreehand?: FreehandSessionSnapshot;
  pendingCandidates: readonly FreehandCandidate[];
}>;

/** 频道 → 快照类型映射，供泛型 `getSnapshot` 精确返回。 */
export type LayeredEditorSnapshotMap = Readonly<{
  document: EditorDocument;
  history: LayeredHistorySnapshot;
  tools: LayeredToolsSnapshot;
  selection: LayeredSelectionSnapshot;
  viewport: LayeredViewportSnapshot;
  preview: LayeredPreviewSnapshot;
  navigation: LayeredNavigationSnapshot;
  interaction: LayeredInteractionSnapshot;
}>;

/** updateViewport 结果：是否实际应用；未应用时给出原因。 */
export type LayeredViewportUpdateResult = Readonly<{
  applied: boolean;
  reason?: 'active-freehand' | 'unchanged';
}>;

/**
 * 控制器公开接口。
 *
 * - `getSnapshot` 按频道泛型返回；除 interaction 外为稳定引用。
 * - `subscribe` 返回取消订阅函数；订阅者抛错被隔离，不影响已完成事务。
 * - 会话命令（begin/update/end/cancel）返回 Result；update 成功为 `Result<void>`，
 *   不主动复制快照（热路径），需要观察由调用方显式 `getSnapshot('interaction')`。
 * - `commitFreehand` 使用 commitId 幂等；`undo/redo` 返回新文档。
 * - `getPresentationIdentity` 只查当前文档：无对象时成功返回 null；final 几何准备失败时
 *   返回 `final-geometry-failed`（几何派生可能 throw，不能吞掉）。
 */
export interface LayeredEditorController {
  getSnapshot<C extends LayeredEditorChannel>(channel: C): LayeredEditorSnapshotMap[C];
  subscribe(channel: LayeredEditorChannel, listener: () => void): () => void;
  setTool(tool: LayeredEditorTool): LayeredEditorResult<void>;
  setFreehandSettings(settings: BrushSnapshot): LayeredEditorResult<void>;
  setShapeSettings(settings: ShapeStyle): LayeredEditorResult<void>;
  setSelection(ids: readonly string[]): LayeredEditorResult<void>;
  setPreview(preview: LayeredPreviewSnapshot | null): LayeredEditorResult<void>;
  setNavigation(patch: Partial<LayeredNavigationSnapshot>): LayeredEditorResult<void>;
  updateViewport(command: LayeredViewportCommand): LayeredEditorResult<LayeredViewportUpdateResult>;
  beginFreehand(input: LayeredBeginInput): LayeredEditorResult<void>;
  updateFreehand(input: FreehandSessionUpdate): LayeredEditorResult<void>;
  endFreehand(input: FreehandSessionEnd): LayeredEditorResult<FreehandCandidate>;
  cancelFreehand(input: FreehandSessionCancel): LayeredEditorResult<void>;
  commitFreehand(commitId: string): LayeredEditorResult<LayeredCommitReceipt>;
  editObjects(edit: LayeredObjectEdit): LayeredEditorResult<EditorDocument>;
  undo(): LayeredEditorResult<EditorDocument>;
  redo(): LayeredEditorResult<EditorDocument>;
  getPresentationIdentity(
    commitId: string
  ): LayeredEditorResult<LayeredPresentationIdentity | null>;
}

/** One reversible object edit. Freehand creation remains exclusive to raw commit. */
export type LayeredObjectEdit = Readonly<{
  expectedDocumentRevision: number;
  upsert?: readonly DocumentObject[];
  removeIds?: readonly string[];
}>;

/**
 * factory 选项：初始文档、viewport 快照、活动工具、设置、可选 selection、
 * 提交时分配 objectId 的注入函数，以及可选几何缓存。
 */
export type LayeredEditorControllerOptions = Readonly<{
  document: EditorDocument;
  viewport: LayeredViewportSnapshot;
  activeTool: LayeredEditorTool;
  settings: LayeredEditorSettings;
  selection?: readonly string[];
  allocateObjectId: (commitId: string) => string;
  geometryCache?: FreehandGeometryCache;
}>;

// ---------------------------------------------------------------------------
// 私有 typed schema3 document adopter 与 copy helpers（非公共 reader/serializer）
//
// 仅接受“已是 typed schema3 的内存文档”，白名单拷贝已知字段并深冻结，不 JSON.parse、
// 不做 schema migration、不传播未知外部字段（PF 缓存 / 预测点 / outline / dash 混入等）。
// 这些 helper 仅供私有 kernel/组合使用，不导出。
// ---------------------------------------------------------------------------

const EDITOR_TOOLS: readonly LayeredEditorTool[] = [
  'freehand',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
  'image',
  'text',
  'selection',
  'lasso',
  'eraser',
  'pan',
];
const SHAPE_TYPES: readonly ShapeType[] = ['line', 'rect', 'ellipse', 'polygon', 'bezier'];
const INPUT_SOURCES: readonly InputSource[] = ['mouse', 'touch', 'pen', 'native'];
const SAMPLE_PHASES: readonly SamplePhase[] = ['down', 'move', 'up'];
const PRESSURE_MODES: readonly PressureMode[] = ['auto', 'real', 'simulated', 'constant'];
const RESOLVED_PRESSURE_MODES: readonly ResolvedPressureMode[] = ['real', 'simulated', 'constant'];

/** 非空字符串。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 有限数值。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 非负安全整数（revision / sequence）。 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 白名单拷贝并冻结仿射；要求各分量有限且矩阵非奇异。 */
function copyTransform(value: unknown): AffineTransform | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const transform = value as Record<string, unknown>;
  const fields: readonly ('a' | 'b' | 'c' | 'd' | 'tx' | 'ty')[] = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  for (const field of fields) {
    if (!isFiniteNumber(transform[field])) {
      return null;
    }
  }
  const a = transform.a as number;
  const b = transform.b as number;
  const c = transform.c as number;
  const d = transform.d as number;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    return null;
  }
  return Object.freeze({ a, b, c, d, tx: transform.tx as number, ty: transform.ty as number });
}

/** 白名单拷贝并冻结合法有序 bounds（min <= max）。 */
function copyBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const bounds = value as Record<string, unknown>;
  if (
    !isFiniteNumber(bounds.minX) ||
    !isFiniteNumber(bounds.minY) ||
    !isFiniteNumber(bounds.maxX) ||
    !isFiniteNumber(bounds.maxY)
  ) {
    return null;
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    return null;
  }
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

/** 白名单拷贝并冻结有限点。 */
function copyPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const point = value as Record<string, unknown>;
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return null;
  }
  return Object.freeze({ x: point.x, y: point.y });
}

/** 白名单拷贝并冻结 brush 五字段；校验 nominalSize/opacity/presetRevision/color/mode。 */
function copyBrush(value: unknown): BrushSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const brush = value as Record<string, unknown>;
  if (!isNonEmptyString(brush.color)) {
    return null;
  }
  if (!isFiniteNumber(brush.nominalSize) || brush.nominalSize <= 0) {
    return null;
  }
  if (!isFiniteNumber(brush.opacity) || brush.opacity < 0 || brush.opacity > 1) {
    return null;
  }
  if (
    typeof brush.pressureMode !== 'string' ||
    !PRESSURE_MODES.includes(brush.pressureMode as PressureMode)
  ) {
    return null;
  }
  if (!isNonNegativeSafeInteger(brush.presetRevision)) {
    return null;
  }
  return Object.freeze({
    color: brush.color,
    nominalSize: brush.nominalSize,
    opacity: brush.opacity,
    pressureMode: brush.pressureMode as PressureMode,
    presetRevision: brush.presetRevision,
  });
}

/** 白名单拷贝并冻结 shape 样式；dash 可选且逐项有限，fill 可选。 */
function copyShapeStyle(value: unknown): ShapeStyle | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const style = value as Record<string, unknown>;
  if (!isNonEmptyString(style.color)) {
    return null;
  }
  if (!isFiniteNumber(style.width) || style.width <= 0) {
    return null;
  }
  if (!isFiniteNumber(style.opacity) || style.opacity < 0 || style.opacity > 1) {
    return null;
  }
  let dash: readonly number[] | undefined;
  if (style.dash !== undefined) {
    if (
      !Array.isArray(style.dash) ||
      !style.dash.every((entry) => isFiniteNumber(entry) && entry >= 0)
    ) {
      return null;
    }
    dash = Object.freeze((style.dash as number[]).slice());
  }
  let fill: string | undefined;
  if (style.fill !== undefined) {
    if (typeof style.fill !== 'string') {
      return null;
    }
    fill = style.fill;
  }
  const result: {
    color: string;
    width: number;
    opacity: number;
    dash?: readonly number[];
    fill?: string;
  } = {
    color: style.color,
    width: style.width,
    opacity: style.opacity,
  };
  if (dash !== undefined) {
    result.dash = dash;
  }
  if (fill !== undefined) {
    result.fill = fill;
  }
  return Object.freeze(result);
}

/** 白名单拷贝并冻结 viewport；要求有限、scale>0 且已落在全局 [MIN, MAX] 规范范围内。 */
function copyViewport(value: unknown): DrawingViewport | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const viewport = value as Record<string, unknown>;
  if (
    !isFiniteNumber(viewport.scale) ||
    !isFiniteNumber(viewport.tx) ||
    !isFiniteNumber(viewport.ty)
  ) {
    return null;
  }
  if (
    viewport.scale <= 0 ||
    viewport.scale < MIN_VIEWPORT_SCALE ||
    viewport.scale > MAX_VIEWPORT_SCALE
  ) {
    return null;
  }
  return Object.freeze({ scale: viewport.scale, tx: viewport.tx, ty: viewport.ty });
}

/** 白名单拷贝并冻结单个 raw sample；pressure 缺失保持缺失，有限越界原值保留。 */
function copySample(value: unknown): AcceptedSample | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const sample = value as Record<string, unknown>;
  if (!isNonNegativeSafeInteger(sample.sequence)) {
    return null;
  }
  if (!isFiniteNumber(sample.x) || !isFiniteNumber(sample.y) || !isFiniteNumber(sample.time)) {
    return null;
  }
  if (typeof sample.phase !== 'string' || !SAMPLE_PHASES.includes(sample.phase as SamplePhase)) {
    return null;
  }
  if (typeof sample.source !== 'string' || !INPUT_SOURCES.includes(sample.source as InputSource)) {
    return null;
  }
  if (sample.pressure !== undefined && !isFiniteNumber(sample.pressure)) {
    return null;
  }
  const phase = sample.phase as SamplePhase;
  const source = sample.source as InputSource;
  return Object.freeze(
    sample.pressure === undefined
      ? { sequence: sample.sequence, x: sample.x, y: sample.y, time: sample.time, phase, source }
      : {
          sequence: sample.sequence,
          x: sample.x,
          y: sample.y,
          pressure: sample.pressure,
          time: sample.time,
          phase,
          source,
        }
  );
}

/** 白名单拷贝并冻结 freehand 对象；sequence 必须从 0 连续。 */
function copyFreehandObject(value: Record<string, unknown>): FreehandObject | null {
  const rulerSnapshot =
    value.rulerSnapshot === undefined ? undefined : copyFreehandRuler(value.rulerSnapshot);
  if (rulerSnapshot === null) return null;
  if (!isNonEmptyString(value.objectId)) {
    return null;
  }
  if (
    !isNonNegativeSafeInteger(value.objectRevision) ||
    !isNonNegativeSafeInteger(value.transformRevision) ||
    !isNonNegativeSafeInteger(value.samplesRevision) ||
    !isNonNegativeSafeInteger(value.brushRevision)
  ) {
    return null;
  }
  const transform = copyTransform(value.transform);
  if (!transform) {
    return null;
  }
  if (!isNonEmptyString(value.commitId)) {
    return null;
  }
  const brushSnapshot = copyBrush(value.brushSnapshot);
  if (!brushSnapshot) {
    return null;
  }
  if (
    typeof value.resolvedPressureMode !== 'string' ||
    !RESOLVED_PRESSURE_MODES.includes(value.resolvedPressureMode as ResolvedPressureMode)
  ) {
    return null;
  }
  if (!Array.isArray(value.samples) || value.samples.length < 2) {
    return null;
  }
  const samples: AcceptedSample[] = [];
  for (let index = 0; index < value.samples.length; index += 1) {
    const sample = copySample(value.samples[index]);
    if (!sample || sample.sequence !== index) {
      return null;
    }
    samples.push(sample);
  }
  // 整笔 source 一致：拒绝 mixed source 混入 registry。
  const strokeSource = samples[0]!.source;
  for (const sample of samples) {
    if (sample.source !== strokeSource) {
      return null;
    }
  }
  // 完成序列：首帧 down、末帧 up、中间全 move；单点文档至少 down/up 2 条 raw。
  if (samples[0]!.phase !== 'down' || samples[samples.length - 1]!.phase !== 'up') {
    return null;
  }
  for (let index = 1; index < samples.length - 1; index += 1) {
    if (samples[index]!.phase !== 'move') {
      return null;
    }
  }
  return Object.freeze({
    kind: 'freehand',
    objectId: value.objectId,
    objectRevision: value.objectRevision,
    transform,
    transformRevision: value.transformRevision,
    commitId: value.commitId,
    samples: Object.freeze(samples),
    brushSnapshot,
    ...(rulerSnapshot ? { rulerSnapshot } : {}),
    resolvedPressureMode: value.resolvedPressureMode as ResolvedPressureMode,
    samplesRevision: value.samplesRevision,
    brushRevision: value.brushRevision,
  });
}

/** 白名单拷贝并冻结 shape 对象。 */
function copyShapeObject(value: Record<string, unknown>): ShapeObject | null {
  if (!isNonEmptyString(value.objectId)) {
    return null;
  }
  if (
    !isNonNegativeSafeInteger(value.objectRevision) ||
    !isNonNegativeSafeInteger(value.transformRevision)
  ) {
    return null;
  }
  const transform = copyTransform(value.transform);
  if (!transform) {
    return null;
  }
  if (typeof value.shapeType !== 'string' || !SHAPE_TYPES.includes(value.shapeType as ShapeType)) {
    return null;
  }
  if (!Array.isArray(value.points)) {
    return null;
  }
  const points: Point[] = [];
  for (const entry of value.points) {
    const point = copyPoint(entry);
    if (!point) {
      return null;
    }
    points.push(point);
  }
  const style = copyShapeStyle(value.style);
  if (!style) {
    return null;
  }
  return Object.freeze({
    kind: 'shape',
    objectId: value.objectId,
    objectRevision: value.objectRevision,
    transform,
    transformRevision: value.transformRevision,
    shapeType: value.shapeType as ShapeType,
    points: Object.freeze(points),
    style,
  });
}

/** 白名单拷贝并冻结 image 对象。 */
function copyImageObject(value: Record<string, unknown>): ImageObject | null {
  if (!isNonEmptyString(value.objectId)) {
    return null;
  }
  if (
    !isNonNegativeSafeInteger(value.objectRevision) ||
    !isNonNegativeSafeInteger(value.transformRevision)
  ) {
    return null;
  }
  const transform = copyTransform(value.transform);
  if (!transform) {
    return null;
  }
  if (!isNonEmptyString(value.src)) {
    return null;
  }
  const localBounds = copyBounds(value.localBounds);
  if (!localBounds) {
    return null;
  }
  const base: {
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
    objectId: value.objectId,
    objectRevision: value.objectRevision,
    transform,
    transformRevision: value.transformRevision,
    src: value.src,
    localBounds,
  };
  if (value.resourceId !== undefined) {
    if (!isNonEmptyString(value.resourceId)) {
      return null;
    }
    base.resourceId = value.resourceId;
  }
  return Object.freeze(base);
}

/** 白名单拷贝并冻结 text 对象。 */
function copyTextObject(value: Record<string, unknown>): TextObject | null {
  if (!isNonEmptyString(value.objectId)) {
    return null;
  }
  if (
    !isNonNegativeSafeInteger(value.objectRevision) ||
    !isNonNegativeSafeInteger(value.transformRevision)
  ) {
    return null;
  }
  const transform = copyTransform(value.transform);
  if (!transform) {
    return null;
  }
  if (typeof value.content !== 'string') {
    return null;
  }
  if (!isFiniteNumber(value.fontSize) || value.fontSize <= 0) {
    return null;
  }
  if (!isNonEmptyString(value.color)) {
    return null;
  }
  const localBounds = copyBounds(value.localBounds);
  if (!localBounds) {
    return null;
  }
  return Object.freeze({
    kind: 'text',
    objectId: value.objectId,
    objectRevision: value.objectRevision,
    transform,
    transformRevision: value.transformRevision,
    content: value.content,
    fontSize: value.fontSize,
    color: value.color,
    localBounds,
  });
}

/** 按 kind 分派白名单拷贝；未知 kind 返回 null。 */
function copyDocumentObject(value: unknown): DocumentObject | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'freehand':
      return copyFreehandObject(record);
    case 'shape':
      return copyShapeObject(record);
    case 'image':
      return copyImageObject(record);
    case 'text':
      return copyTextObject(record);
    default:
      return null;
  }
}

/**
 * 私有 typed schema3 document adopter：
 * 校验 schemaVersion=3、documentRevision、objectId 唯一、freehand commitId 唯一，
 * 逐对象白名单拷贝深冻结并**保持 mixed order**。任一非法返回 null。
 */
function adoptDocument(document: EditorDocument): EditorDocument | null {
  if (!document || typeof document !== 'object') {
    return null;
  }
  const raw = document as Record<string, unknown>;
  if (raw.schemaVersion !== LAYERED_SCHEMA_VERSION) {
    return null;
  }
  if (!isNonNegativeSafeInteger(raw.documentRevision)) {
    return null;
  }
  if (!Array.isArray(raw.objects)) {
    return null;
  }
  const seenObjectIds = new Set<string>();
  const seenCommitIds = new Set<string>();
  const objects: DocumentObject[] = [];
  for (const entry of raw.objects) {
    const copied = copyDocumentObject(entry);
    if (!copied) {
      return null;
    }
    if (seenObjectIds.has(copied.objectId)) {
      return null;
    }
    seenObjectIds.add(copied.objectId);
    if (copied.kind === 'freehand') {
      if (seenCommitIds.has(copied.commitId)) {
        return null;
      }
      seenCommitIds.add(copied.commitId);
    }
    objects.push(copied);
  }
  return Object.freeze({
    schemaVersion: LAYERED_SCHEMA_VERSION,
    documentRevision: raw.documentRevision,
    objects: Object.freeze(objects),
  });
}

/** 成功 Result 构造 helper（供 kernel 与 composition 使用）。 */
function okResult<T>(value: T): LayeredEditorResult<T> {
  return Object.freeze({ ok: true, value });
}

/** 失败 Result 构造 helper；会话失败附带 sessionCode。 */
function errResult<T>(
  code: LayeredEditorErrorCode,
  sessionCode?: LayeredSessionErrorCode
): LayeredEditorResult<T> {
  return Object.freeze({
    ok: false,
    error: Object.freeze(sessionCode === undefined ? { code } : { code, sessionCode }),
  });
}

/** canonical payload 输入：resolved mode + brush 五字段 + raw samples（不含 transport）。 */
type CanonicalPayloadInput = Readonly<{
  rulerSnapshot?: FreehandRulerSnapshot;
  resolvedPressureMode: ResolvedPressureMode;
  brushSnapshot: BrushSnapshot;
  samples: readonly AcceptedSample[];
}>;

/**
 * 构造精确 canonical payload：用 `JSON.stringify` 嵌套 tuple，不手拼分隔符。
 * 结构为 `[resolvedMode, [brush 五字段], samples.map([sequence,x,y,
 * pressure ? ['present',p] : ['missing'], time, phase, source])]`。
 * **不比较** sessionId/pointerId/viewportRevision 等 transport 信息。
 */
function buildCanonicalPayload(input: CanonicalPayloadInput): string {
  const brush = input.brushSnapshot;
  return JSON.stringify([
    input.resolvedPressureMode,
    [brush.color, brush.nominalSize, brush.opacity, brush.pressureMode, brush.presetRevision],
    input.rulerSnapshot
      ? [
          input.rulerSnapshot.center.x,
          input.rulerSnapshot.center.y,
          input.rulerSnapshot.height,
          input.rulerSnapshot.rotationRad,
        ]
      : null,
    input.samples.map((sample) => [
      sample.sequence,
      sample.x,
      sample.y,
      sample.pressure === undefined ? ['missing'] : ['present', sample.pressure],
      sample.time,
      sample.phase,
      sample.source,
    ]),
  ]);
}

/** payload 对比 helper：判断两个候选/对象是否产生同一 canonical 字符串。 */
function hasSameCanonicalPayload(
  left: CanonicalPayloadInput,
  right: CanonicalPayloadInput
): boolean {
  return buildCanonicalPayload(left) === buildCanonicalPayload(right);
}

// ---------------------------------------------------------------------------
// 私有 document/history/commit kernel（不导出；不通知任何频道、不接触 subscriber/session）。
//
// kernel 只接受已 adopt 的冻结 document，且**不通知任何频道、不接触 subscriber/session**。
// 几何只经 cache 派生，绝不进入 document/history。
// ---------------------------------------------------------------------------

/** 一次提交的 history entry：before/after 对象序列，不保存旧 document revision。 */
type DocumentHistoryEntry = Readonly<{
  beforeObjects: readonly DocumentObject[];
  afterObjects: readonly DocumentObject[];
}>;

/** 私有 kernel 接口；不导出。 */
interface DocumentKernel {
  getDocument(): EditorDocument;
  getHistory(): LayeredHistorySnapshot;
  commitCandidate(candidate: FreehandCandidate): LayeredEditorResult<LayeredCommitReceipt>;
  editObjects(edit: LayeredObjectEdit): LayeredEditorResult<EditorDocument>;
  getExistingReceipt(commitId: string): LayeredEditorResult<LayeredCommitReceipt>;
  undo(): LayeredEditorResult<EditorDocument>;
  redo(): LayeredEditorResult<EditorDocument>;
  getPresentationIdentity(
    commitId: string
  ): LayeredEditorResult<LayeredPresentationIdentity | null>;
}

/** 由 candidate 冻结新 freehand 对象：四 revision 固定 1、identity transform、raw/brush 沿用冻结快照。 */
function freezeFreehandObject(candidate: FreehandCandidate, objectId: string): FreehandObject {
  return Object.freeze({
    kind: 'freehand',
    objectId,
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    commitId: candidate.commitId,
    samples: candidate.samples,
    brushSnapshot: candidate.brushSnapshot,
    ...(candidate.rulerSnapshot ? { rulerSnapshot: candidate.rulerSnapshot } : {}),
    resolvedPressureMode: candidate.resolvedPressureMode,
    samplesRevision: 1,
    brushRevision: 1,
  });
}

/**
 * 创建私有 document/history/commit kernel。
 *
 * - registry 与 allocatedIds 在 kernel 存活期保留（tombstone 不释放）。
 * - 所有预期失败都不改变 document/history/registry；成功提交一次切换、单个 history entry。
 */
function createDocumentKernel(
  adoptedDocument: EditorDocument,
  allocateObjectId: (commitId: string) => string,
  geometryCache: FreehandGeometryCache
): DocumentKernel {
  let document = adoptedDocument;
  const registry = new Map<string, Readonly<{ objectId: string; canonical: string }>>();
  const allocatedIds = new Set<string>();
  const undoStack: DocumentHistoryEntry[] = [];
  const redoStack: DocumentHistoryEntry[] = [];
  let historySnapshot: LayeredHistorySnapshot = Object.freeze({ canUndo: false, canRedo: false });

  // 初始文档 freehand 播种 registry，并记录全部已用 objectId（lifetime 不释放）。
  for (const object of adoptedDocument.objects) {
    allocatedIds.add(object.objectId);
    if (object.kind === 'freehand') {
      registry.set(object.commitId, {
        objectId: object.objectId,
        canonical: buildCanonicalPayload(object),
      });
    }
  }

  /** history 快照仅在 canUndo/canRedo 实际变化时换引用。 */
  function refreshHistory(): void {
    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;
    if (historySnapshot.canUndo !== canUndo || historySnapshot.canRedo !== canRedo) {
      historySnapshot = Object.freeze({ canUndo, canRedo });
    }
  }

  /**
   * best-effort 清理被删除对象的 cache slot（按当前 document）。派生 cleanup 失败只吞掉，
   * **绝不**把已完成事务变成 failed Result；调用发生在 runExclusive 内以避免 callback 重入。
   * 不新增 cache 所有权：只使用注入/默认实例。
   */
  function syncCacheBestEffort(): void {
    try {
      geometryCache.syncDocument(document);
    } catch {
      // 派生 cleanup 失败不影响文档/history/registry 的完成结果。
    }
  }

  /** 下一个 document revision；达到 MAX_SAFE_INTEGER 返回 null（调用方原子拒绝）。 */
  function bumpRevision(): number | null {
    if (document.documentRevision >= Number.MAX_SAFE_INTEGER) {
      return null;
    }
    return document.documentRevision + 1;
  }

  function findFreehand(objectId: string): FreehandObject | undefined {
    for (const object of document.objects) {
      if (object.kind === 'freehand' && object.objectId === objectId) {
        return object;
      }
    }
    return undefined;
  }

  /** final 几何 revision（仅经 cache 派生）。任何派生异常返回 null（供上层转 final-geometry-failed）。 */
  function finalGeometryRevision(object: FreehandObject): string | null {
    try {
      return geometryCache.getGeometry(object, 'final').geometryRevision;
    } catch {
      return null;
    }
  }

  /** 组装 receipt：presentInDocument 取决于当前文档；present 时几何失败返回 final-geometry-failed。 */
  function receiptFor(
    commitId: string,
    objectId: string,
    status: 'created' | 'duplicate'
  ): LayeredEditorResult<LayeredCommitReceipt> {
    const object = findFreehand(objectId);
    if (!object) {
      return okResult(
        Object.freeze({
          status,
          objectId,
          commitId,
          documentRevision: document.documentRevision,
          presentInDocument: false,
          presentationIdentity: null,
        })
      );
    }
    const geometryRevision = finalGeometryRevision(object);
    if (geometryRevision === null) {
      return errResult('final-geometry-failed');
    }
    return okResult(
      Object.freeze({
        status,
        objectId,
        commitId,
        documentRevision: document.documentRevision,
        presentInDocument: true,
        presentationIdentity: Object.freeze({
          objectId,
          commitId,
          documentRevision: document.documentRevision,
          geometryRevision,
        }),
      })
    );
  }

  /**
   * 提交一个 pending candidate：
   * - registry 已存在同 commitId：payload 同 → duplicate（不改 rev/history/redo）；不同 → conflict。
   * - 首次：先查 revision（不触发 allocator 副作用）→ allocator → id 校验 → 冻结对象 →
   *   准备 final 几何 → 一次切换 document + 单个 history entry + registry/allocatedIds。
   * 任一步失败都返回 Result 且不改变 document/history/registry。
   */
  function commitCandidate(
    candidate: FreehandCandidate
  ): LayeredEditorResult<LayeredCommitReceipt> {
    if (!candidate || typeof candidate !== 'object' || !isNonEmptyString(candidate.commitId)) {
      return errResult('invalid-input');
    }
    const existing = registry.get(candidate.commitId);
    if (existing) {
      const canonical = buildCanonicalPayload(candidate);
      if (canonical !== existing.canonical) {
        return errResult('commit-id-conflict');
      }
      return receiptFor(candidate.commitId, existing.objectId, 'duplicate');
    }

    const newRevision = bumpRevision();
    if (newRevision === null) {
      return errResult('revision-exhausted');
    }
    const canonical = buildCanonicalPayload(candidate);
    let objectId: string;
    try {
      objectId = allocateObjectId(candidate.commitId);
    } catch {
      return errResult('object-id-allocation-failed');
    }
    if (!isNonEmptyString(objectId)) {
      return errResult('object-id-allocation-failed');
    }
    if (allocatedIds.has(objectId)) {
      return errResult('object-id-conflict');
    }

    const object = freezeFreehandObject(candidate, objectId);
    // 先准备 final 几何（只经 cache；可能副作用于 cache，但不 persist）。失败不改变 kernel。
    const geometryRevision = finalGeometryRevision(object);
    if (geometryRevision === null) {
      // 准备失败：清理本次为未提交新对象创建的临时 slot（当前 document 不含它），
      // 但保留真实当前文档对象的 slot。best-effort，不改 failure 结果。
      syncCacheBestEffort();
      return errResult('final-geometry-failed');
    }
    // 关键：在 mutation **之前**用已备好的 geometryRevision 冻结 created receipt + identity，
    // 这样 mutation 之后绝不会再调 cache 派生（避免第二次 throw 造成“已提交却返回 failed”）。
    const createdReceipt: LayeredCommitReceipt = Object.freeze({
      status: 'created',
      objectId,
      commitId: candidate.commitId,
      documentRevision: newRevision,
      presentInDocument: true,
      presentationIdentity: Object.freeze({
        objectId,
        commitId: candidate.commitId,
        documentRevision: newRevision,
        geometryRevision,
      }),
    });

    const beforeObjects = document.objects;
    const afterObjects = Object.freeze([...beforeObjects, object]);
    document = Object.freeze({
      schemaVersion: LAYERED_SCHEMA_VERSION,
      documentRevision: newRevision,
      objects: afterObjects,
    });
    undoStack.push(Object.freeze({ beforeObjects, afterObjects }));
    redoStack.length = 0;
    registry.set(candidate.commitId, { objectId, canonical });
    allocatedIds.add(objectId);
    refreshHistory();
    // 成功切换后 best-effort 清理：document 已含 new object，其 slot 不会被误删。
    syncCacheBestEffort();
    return okResult(createdReceipt);
  }

  /** 查询既有 commit（无 pending candidate 时使用）；未知 commitId 返回 pending-commit-not-found。 */
  function getExistingReceipt(commitId: string): LayeredEditorResult<LayeredCommitReceipt> {
    if (!isNonEmptyString(commitId)) {
      return errResult('invalid-input');
    }
    const existing = registry.get(commitId);
    if (!existing) {
      return errResult('pending-commit-not-found');
    }
    return receiptFor(commitId, existing.objectId, 'duplicate');
  }

  /** undo：revision 单调 +1，恢复 beforeObjects；tombstone 不释放、redo 保留。 */
  function undo(): LayeredEditorResult<EditorDocument> {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) {
      return errResult('nothing-to-undo');
    }
    const newRevision = bumpRevision();
    if (newRevision === null) {
      return errResult('revision-exhausted');
    }
    undoStack.pop();
    redoStack.push(entry);
    document = Object.freeze({
      schemaVersion: LAYERED_SCHEMA_VERSION,
      documentRevision: newRevision,
      objects: entry.beforeObjects,
    });
    refreshHistory();
    syncCacheBestEffort();
    return okResult(document);
  }

  /** redo：revision 单调 +1，恢复 afterObjects。 */
  function redo(): LayeredEditorResult<EditorDocument> {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) {
      return errResult('nothing-to-redo');
    }
    const newRevision = bumpRevision();
    if (newRevision === null) {
      return errResult('revision-exhausted');
    }
    redoStack.pop();
    undoStack.push(entry);
    document = Object.freeze({
      schemaVersion: LAYERED_SCHEMA_VERSION,
      documentRevision: newRevision,
      objects: entry.afterObjects,
    });
    refreshHistory();
    syncCacheBestEffort();
    return okResult(document);
  }

  /** 查当前文档是否有该 commitId 的对象；无则 null，几何准备失败则 final-geometry-failed。 */
  function getPresentationIdentity(
    commitId: string
  ): LayeredEditorResult<LayeredPresentationIdentity | null> {
    if (!isNonEmptyString(commitId)) {
      return errResult('invalid-input');
    }
    const existing = registry.get(commitId);
    if (!existing) {
      return okResult(null);
    }
    const object = findFreehand(existing.objectId);
    if (!object) {
      return okResult(null);
    }
    const geometryRevision = finalGeometryRevision(object);
    if (geometryRevision === null) {
      return errResult('final-geometry-failed');
    }
    return okResult(
      Object.freeze({
        objectId: existing.objectId,
        commitId,
        documentRevision: document.documentRevision,
        geometryRevision,
      })
    );
  }

  function editObjects(edit: LayeredObjectEdit): LayeredEditorResult<EditorDocument> {
    if (
      !edit ||
      typeof edit !== 'object' ||
      edit.expectedDocumentRevision !== document.documentRevision ||
      (edit.upsert !== undefined && !Array.isArray(edit.upsert)) ||
      (edit.removeIds !== undefined &&
        (!Array.isArray(edit.removeIds) || edit.removeIds.some((id) => !isNonEmptyString(id))))
    )
      return errResult('invalid-input');
    const revision = bumpRevision();
    if (revision === null) return errResult('revision-exhausted');
    const remove = new Set(edit.removeIds ?? []);
    const updates = new Map<string, DocumentObject>();
    for (const id of remove) {
      if (!document.objects.some((object) => object.objectId === id))
        return errResult('invalid-input');
    }
    for (const input of edit.upsert ?? []) {
      const copy = copyDocumentObject(input);
      if (!copy || updates.has(copy.objectId) || remove.has(copy.objectId))
        return errResult('invalid-input');
      const old = document.objects.find((object) => object.objectId === copy.objectId);
      if (!old && (allocatedIds.has(copy.objectId) || copy.kind === 'freehand'))
        return errResult('object-id-conflict');
      if (old && (old.kind !== copy.kind || copy.objectRevision <= old.objectRevision))
        return errResult('invalid-input');
      if (
        old &&
        !sameTransform(old.transform, copy.transform) &&
        copy.transformRevision <= old.transformRevision
      ) {
        return errResult('invalid-input');
      }
      if (copy.kind === 'freehand') {
        if (
          !old ||
          old.kind !== 'freehand' ||
          copy.commitId !== old.commitId ||
          !hasSameCanonicalPayload(copy, old)
        )
          return errResult('commit-id-conflict');
        // Transform edits retain accepted input identity and the local outline cache.
        updates.set(
          copy.objectId,
          Object.freeze({
            ...old,
            transform: copy.transform,
            transformRevision: copy.transformRevision,
            objectRevision: copy.objectRevision,
          })
        );
      } else updates.set(copy.objectId, copy);
    }
    if (!remove.size && !updates.size) return okResult(document);
    const beforeObjects = document.objects;
    const after = beforeObjects
      .filter((object) => !remove.has(object.objectId))
      .map((object) => {
        const replacement = updates.get(object.objectId);
        updates.delete(object.objectId);
        return replacement ?? object;
      });
    for (const object of updates.values()) after.push(object);
    const afterObjects = Object.freeze(after);
    document = Object.freeze({
      schemaVersion: LAYERED_SCHEMA_VERSION,
      documentRevision: revision,
      objects: afterObjects,
    });
    undoStack.push(Object.freeze({ beforeObjects, afterObjects }));
    redoStack.length = 0;
    for (const object of after) allocatedIds.add(object.objectId);
    refreshHistory();
    syncCacheBestEffort();
    return okResult(document);
  }

  return {
    getDocument: () => document,
    getHistory: () => historySnapshot,
    commitCandidate,
    editObjects,
    getExistingReceipt,
    undo,
    redo,
    getPresentationIdentity,
  };
}

// ---------------------------------------------------------------------------
// 公开 factory 与完整组合（kernel + session/settings/selection/viewport + channels）
// ---------------------------------------------------------------------------

/** mutation 返回值：Result 加需要在解锁后按顺序发出的频道。 */
type MutationOutcome<T> = Readonly<{
  result: LayeredEditorResult<T>;
  notifications: readonly LayeredEditorChannel[];
}>;

/** pending 提交条目：保留已 end 的 awaiting session 以便提交成功后回反馈。 */
type PendingEntry = Readonly<{
  session: FreehandSession;
  candidate: FreehandCandidate;
}>;

function sameViewport(left: DrawingViewport, right: DrawingViewport): boolean {
  return left.scale === right.scale && left.tx === right.tx && left.ty === right.ty;
}

function sameTransform(left: AffineTransform, right: AffineTransform): boolean {
  return (
    left.a === right.a &&
    left.b === right.b &&
    left.c === right.c &&
    left.d === right.d &&
    left.tx === right.tx &&
    left.ty === right.ty
  );
}

function sameBrush(left: BrushSnapshot, right: BrushSnapshot): boolean {
  return (
    left.color === right.color &&
    left.nominalSize === right.nominalSize &&
    left.opacity === right.opacity &&
    left.pressureMode === right.pressureMode &&
    left.presetRevision === right.presetRevision
  );
}

function sameDash(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function sameShapeStyle(left: ShapeStyle, right: ShapeStyle): boolean {
  return (
    left.color === right.color &&
    left.width === right.width &&
    left.opacity === right.opacity &&
    left.fill === right.fill &&
    sameDash(left.dash, right.dash)
  );
}

function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function isTool(value: unknown): value is LayeredEditorTool {
  return typeof value === 'string' && (EDITOR_TOOLS as readonly string[]).includes(value);
}

function isFinitePointLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function isFiniteIntent(value: unknown): value is ViewportTransformIntent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const intent = value as Record<string, unknown>;
  return (
    isFinitePointLike(intent.startFocal) &&
    isFinitePointLike(intent.currentFocal) &&
    isFiniteNumber(intent.scaleRatio) &&
    (intent.scaleRatio as number) > 0
  );
}

/** 私有控制器实现；只经 factory 创建。 */
class LayeredEditorControllerImpl implements LayeredEditorController {
  private readonly kernel: DocumentKernel;
  private activeTool: LayeredEditorTool;
  private freehandSettings: BrushSnapshot;
  private shapeSettings: ShapeStyle;
  private selection: readonly string[];
  private viewportSnapshot: LayeredViewportSnapshot;
  private toolsSnapshot: LayeredToolsSnapshot;
  private preview: LayeredPreviewSnapshot = EMPTY_PREVIEW;
  private navigation: LayeredNavigationSnapshot = Object.freeze({
    paper: false,
    minimap: false,
    rotationFeedback: null,
    zoomFeedback: null,
    virtualPaper: Object.freeze({
      enabled: true,
      initialPlacement: 'top-left',
      minScale: MIN_VIEWPORT_SCALE,
      maxScale: MAX_VIEWPORT_SCALE,
      enabledInteractions: Object.freeze([
        ...SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS,
        'touchTwoFingerPan',
      ] as const),
    }),
    ruler: Object.freeze({
      visible: false,
      center: Object.freeze({ x: 320, y: 240 }),
      rotationRad: 0,
      height: 80,
    }),
  });
  private activeSession: FreehandSession | undefined;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly subscribers = new Map<LayeredEditorChannel, Set<() => void>>();
  private locked = false;

  constructor(params: {
    kernel: DocumentKernel;
    activeTool: LayeredEditorTool;
    freehandSettings: BrushSnapshot;
    shapeSettings: ShapeStyle;
    selection: readonly string[];
    viewportSnapshot: LayeredViewportSnapshot;
  }) {
    this.kernel = params.kernel;
    this.activeTool = params.activeTool;
    this.freehandSettings = params.freehandSettings;
    this.shapeSettings = params.shapeSettings;
    this.selection = params.selection;
    this.viewportSnapshot = params.viewportSnapshot;
    this.toolsSnapshot = this.buildToolsSnapshot();
  }

  private buildToolsSnapshot(): LayeredToolsSnapshot {
    return Object.freeze({
      activeTool: this.activeTool,
      settings: Object.freeze({
        freehand: this.freehandSettings,
        shape: this.shapeSettings,
      }),
    });
  }

  getSnapshot<C extends LayeredEditorChannel>(channel: C): LayeredEditorSnapshotMap[C] {
    switch (channel) {
      case 'document':
        return this.kernel.getDocument() as LayeredEditorSnapshotMap[C];
      case 'history':
        return this.kernel.getHistory() as LayeredEditorSnapshotMap[C];
      case 'tools':
        return this.toolsSnapshot as LayeredEditorSnapshotMap[C];
      case 'selection':
        return this.selection as LayeredEditorSnapshotMap[C];
      case 'viewport':
        return this.viewportSnapshot as LayeredEditorSnapshotMap[C];
      case 'preview':
        return this.preview as LayeredEditorSnapshotMap[C];
      case 'navigation':
        return this.navigation as LayeredEditorSnapshotMap[C];
      default:
        return this.buildInteractionSnapshot() as LayeredEditorSnapshotMap[C];
    }
  }

  /** interaction 按需构造：active session 快照 + 冻结 pending candidates（不每点 copy）。 */
  private buildInteractionSnapshot(): LayeredInteractionSnapshot {
    const pendingCandidates = Object.freeze(
      [...this.pending.values()].map((entry) => entry.candidate)
    );
    if (!this.activeSession) {
      return Object.freeze({ pendingCandidates });
    }
    return Object.freeze({
      activeFreehand: this.activeSession.getSnapshot(),
      pendingCandidates,
    });
  }

  subscribe(channel: LayeredEditorChannel, listener: () => void): () => void {
    let set = this.subscribers.get(channel);
    if (!set) {
      set = new Set();
      this.subscribers.set(channel, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  setNavigation(patch: Partial<LayeredNavigationSnapshot>): LayeredEditorResult<void> {
    if (this.locked || !patch || typeof patch !== 'object') return errResult('invalid-input');
    const next = { ...this.navigation, ...patch };
    const config = next.virtualPaper;
    const interactions = [
      'mouseWheelZoom',
      'mouseDragPan',
      'trackpadScrollPan',
      'mouseWheelCtrlZoom',
      'touchSingleFingerPan',
      'touchTwoFingerPan',
      'touchTwoFingerZoom',
      'penPan',
    ];
    if (
      !config ||
      typeof config.enabled !== 'boolean' ||
      !['top-left', 'center'].includes(config.initialPlacement) ||
      !Number.isFinite(config.minScale) ||
      !Number.isFinite(config.maxScale) ||
      config.minScale < MIN_VIEWPORT_SCALE ||
      config.maxScale > MAX_VIEWPORT_SCALE ||
      config.minScale > config.maxScale ||
      !Array.isArray(config.enabledInteractions) ||
      config.enabledInteractions.some((interaction) => !interactions.includes(interaction))
    )
      return errResult('invalid-input');
    const feedback = next.rotationFeedback;
    const zoomFeedback = next.zoomFeedback;
    if (
      zoomFeedback !== null &&
      (!isFinitePointLike(zoomFeedback?.point) ||
        !Number.isFinite(zoomFeedback?.scale) ||
        zoomFeedback.scale <= 0 ||
        !Number.isSafeInteger(zoomFeedback?.token))
    )
      return errResult('invalid-input');
    if (
      feedback !== null &&
      (!isFinitePointLike(feedback?.point) || !Number.isFinite(feedback?.rotationRad))
    )
      return errResult('invalid-input');
    const ruler = copyFreehandRuler(next.ruler);
    if (
      !ruler ||
      typeof next.ruler.visible !== 'boolean' ||
      typeof next.paper !== 'boolean' ||
      typeof next.minimap !== 'boolean'
    )
      return errResult('invalid-input');
    if (this.activeSession && Object.keys(patch).some((key) => key !== 'zoomFeedback'))
      return errResult('active-session-conflict');
    this.navigation = Object.freeze({
      paper: next.paper,
      minimap: next.minimap,
      ruler: Object.freeze({ ...ruler, visible: next.ruler.visible }),
      virtualPaper: Object.freeze({
        ...config,
        enabledInteractions: Object.freeze([...config.enabledInteractions]),
      }),
      rotationFeedback: feedback
        ? Object.freeze({
            point: Object.freeze({ ...feedback.point }),
            rotationRad: feedback.rotationRad,
          })
        : null,
      zoomFeedback: zoomFeedback
        ? Object.freeze({ ...zoomFeedback, point: Object.freeze({ ...zoomFeedback.point }) })
        : null,
    });
    this.emit(['navigation']);
    return okResult(undefined);
  }

  setPreview(preview: LayeredPreviewSnapshot | null): LayeredEditorResult<void> {
    if (this.locked) return errResult('internal-invariant');
    if (preview === null) this.preview = EMPTY_PREVIEW;
    else {
      if (
        !preview ||
        typeof preview !== 'object' ||
        !Array.isArray(preview.objects) ||
        !Array.isArray(preview.path) ||
        !Array.isArray(preview.hiddenIds)
      )
        return errResult('invalid-input');
      const objects = preview.objects.map(copyDocumentObject);
      if (
        objects.some((object) => !object) ||
        preview.path.some((point) => !copyPoint(point)) ||
        preview.hiddenIds.some((id) => !this.documentHasObject(id))
      )
        return errResult('invalid-input');
      this.preview = Object.freeze({
        objects: Object.freeze(objects as DocumentObject[]),
        hiddenIds: Object.freeze([...preview.hiddenIds]),
        path: Object.freeze(preview.path.map((point) => Object.freeze({ x: point.x, y: point.y }))),
      });
    }
    this.emit(['preview']);
    return okResult(undefined);
  }

  /** 顺序发出频道通知；listener 抛错被隔离，不影响已完成事务。 */
  private emit(channels: readonly LayeredEditorChannel[]): void {
    if (channels.includes('document') && this.preview !== EMPTY_PREVIEW) {
      this.preview = EMPTY_PREVIEW;
      channels = [...channels, 'preview'];
    }
    for (const channel of channels) {
      const set = this.subscribers.get(channel);
      if (!set) {
        continue;
      }
      for (const listener of [...set]) {
        try {
          listener();
        } catch {
          // 隔离订阅者异常：结算已完成，不能因 listener 抛错回报 failed。
        }
      }
    }
  }

  /**
   * mutation 互斥：allocator / 几何准备期间若被重入（例如外部 callback 触发 undo/commit），
   * 返回 internal-invariant 而不是破坏原子计划；通知在解锁后由 `emit` 完成。
   */
  private runExclusive<T>(fn: () => MutationOutcome<T>): MutationOutcome<T> {
    if (this.locked) {
      return { result: errResult('internal-invariant'), notifications: [] };
    }
    this.locked = true;
    try {
      return fn();
    } finally {
      this.locked = false;
    }
  }

  /** 过滤 selection 中已不存在的对象；实际变化返回 true。 */
  private reconcileSelection(): boolean {
    const existing = new Set(this.kernel.getDocument().objects.map((object) => object.objectId));
    if (this.selection.every((objectId) => existing.has(objectId))) {
      return false;
    }
    this.selection = Object.freeze(this.selection.filter((objectId) => existing.has(objectId)));
    return true;
  }

  private documentHasObject(objectId: string): boolean {
    return this.kernel.getDocument().objects.some((object) => object.objectId === objectId);
  }

  beginFreehand(input: LayeredBeginInput): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.beginInternal(input));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private beginInternal(input: LayeredBeginInput): MutationOutcome<void> {
    if (this.activeSession) {
      return { result: errResult('active-session-conflict'), notifications: [] };
    }
    if (this.activeTool !== 'freehand') {
      return { result: errResult('tool-not-freehand'), notifications: [] };
    }
    if (
      !input ||
      typeof input !== 'object' ||
      input.type !== 'begin' ||
      !isNonEmptyString(input.commitId)
    ) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    // registry 已 committed 的 id 允许 begin（供 duplicate/conflict 测试）；仅 pending 视为 in-flight。
    if (this.pending.has(input.commitId)) {
      return { result: errResult('commit-id-in-flight'), notifications: [] };
    }
    // 自有 brush + viewport 覆写 caller 输入（controller 是唯一权威）。
    const full: BeginFreehandSessionInput = {
      type: 'begin',
      commitId: input.commitId,
      pressureCapability: input.pressureCapability,
      brush: this.freehandSettings,
      ...(this.navigation.ruler.visible
        ? {
            rulerSnapshot: {
              center: {
                x:
                  (this.navigation.ruler.center.x - this.viewportSnapshot.viewport.tx) /
                  this.viewportSnapshot.viewport.scale,
                y:
                  (this.navigation.ruler.center.y - this.viewportSnapshot.viewport.ty) /
                  this.viewportSnapshot.viewport.scale,
              },
              height: this.navigation.ruler.height / this.viewportSnapshot.viewport.scale,
              rotationRad: this.navigation.ruler.rotationRad,
            },
          }
        : {}),
      viewportSnapshot: this.viewportSnapshot,
      batch: input.batch,
    };
    const result = beginFreehandSession(full);
    if (!result.ok) {
      return { result: errResult('session-rejected', result.code), notifications: [] };
    }
    this.activeSession = result.value;
    return { result: okResult(undefined), notifications: ['interaction'] };
  }

  updateFreehand(input: FreehandSessionUpdate): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.updateInternal(input));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  /** 热路径：只调用 session.update 并通知 interaction，不主动 getSnapshot 复制。 */
  private updateInternal(input: FreehandSessionUpdate): MutationOutcome<void> {
    if (!this.activeSession) {
      return { result: errResult('no-active-session'), notifications: [] };
    }
    const result = this.activeSession.update(input);
    if (!result.ok) {
      return { result: errResult('session-rejected', result.code), notifications: [] };
    }
    return { result: okResult(undefined), notifications: ['interaction'] };
  }

  endFreehand(input: FreehandSessionEnd): LayeredEditorResult<FreehandCandidate> {
    const outcome = this.runExclusive(() => this.endInternal(input));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private endInternal(input: FreehandSessionEnd): MutationOutcome<FreehandCandidate> {
    const session = this.activeSession;
    if (!session) {
      return { result: errResult('no-active-session'), notifications: [] };
    }
    const result = session.end(input);
    if (!result.ok) {
      return { result: errResult('session-rejected', result.code), notifications: [] };
    }
    // end 成功返回 awaiting-commit 快照；从快照取出已冻结 candidate 存入 pending。
    const snapshot = result.value;
    if (snapshot.status !== 'awaiting-commit') {
      return { result: errResult('internal-invariant'), notifications: [] };
    }
    const candidate = snapshot.candidate;
    this.pending.set(candidate.commitId, Object.freeze({ session, candidate }));
    this.activeSession = undefined;
    return { result: okResult(candidate), notifications: ['interaction'] };
  }

  cancelFreehand(input: FreehandSessionCancel): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.cancelInternal(input));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private cancelInternal(input: FreehandSessionCancel): MutationOutcome<void> {
    const session = this.activeSession;
    if (!session) {
      return { result: errResult('no-active-session'), notifications: [] };
    }
    const result = session.cancel(input);
    if (!result.ok) {
      return { result: errResult('session-rejected', result.code), notifications: [] };
    }
    this.activeSession = undefined;
    return { result: okResult(undefined), notifications: ['interaction'] };
  }

  setTool(tool: LayeredEditorTool): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.setToolInternal(tool));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private setToolInternal(tool: LayeredEditorTool): MutationOutcome<void> {
    if (!isTool(tool)) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    if (tool === this.activeTool) {
      return { result: okResult(undefined), notifications: [] };
    }
    const notifications: LayeredEditorChannel[] = [];
    const session = this.activeSession;
    if (session) {
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'collecting') {
        // 工具切换只取消未提交 collecting；pending candidate 不丢。
        const cancelled = session.cancel({
          type: 'cancel',
          sessionId: snapshot.sessionId,
          pointerId: snapshot.pointerId,
          source: snapshot.source,
          batchSequence: snapshot.nextBatchSequence,
          reason: 'tool-change',
        });
        if (!cancelled.ok) {
          return { result: errResult('internal-invariant'), notifications: [] };
        }
        this.activeSession = undefined;
        notifications.push('interaction');
      }
    }
    this.activeTool = tool;
    if (this.preview !== EMPTY_PREVIEW) {
      this.preview = EMPTY_PREVIEW;
      notifications.push('preview');
    }
    this.toolsSnapshot = this.buildToolsSnapshot();
    notifications.push('tools');
    return { result: okResult(undefined), notifications };
  }

  setFreehandSettings(settings: BrushSnapshot): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.setFreehandSettingsInternal(settings));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private setFreehandSettingsInternal(settings: BrushSnapshot): MutationOutcome<void> {
    const copy = copyBrush(settings);
    if (!copy) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    // 值相同可 no-op；不同设置只影响下一笔，只通知 tools。
    if (sameBrush(copy, this.freehandSettings)) {
      return { result: okResult(undefined), notifications: [] };
    }
    this.freehandSettings = copy;
    this.toolsSnapshot = this.buildToolsSnapshot();
    return { result: okResult(undefined), notifications: ['tools'] };
  }

  setShapeSettings(settings: ShapeStyle): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.setShapeSettingsInternal(settings));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private setShapeSettingsInternal(settings: ShapeStyle): MutationOutcome<void> {
    const copy = copyShapeStyle(settings);
    if (!copy) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    if (sameShapeStyle(copy, this.shapeSettings)) {
      return { result: okResult(undefined), notifications: [] };
    }
    this.shapeSettings = copy;
    this.toolsSnapshot = this.buildToolsSnapshot();
    return { result: okResult(undefined), notifications: ['tools'] };
  }

  setSelection(ids: readonly string[]): LayeredEditorResult<void> {
    const outcome = this.runExclusive(() => this.setSelectionInternal(ids));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private setSelectionInternal(ids: readonly string[]): MutationOutcome<void> {
    if (!Array.isArray(ids)) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    const next: string[] = [];
    const seen = new Set<string>();
    for (const objectId of ids) {
      if (!isNonEmptyString(objectId)) {
        return { result: errResult('invalid-input'), notifications: [] };
      }
      if (seen.has(objectId)) {
        continue;
      }
      if (!this.documentHasObject(objectId)) {
        return { result: errResult('selection-target-missing'), notifications: [] };
      }
      seen.add(objectId);
      next.push(objectId);
    }
    const frozen = Object.freeze(next);
    if (sameSelection(frozen, this.selection)) {
      return { result: okResult(undefined), notifications: [] };
    }
    this.selection = frozen;
    return { result: okResult(undefined), notifications: ['selection'] };
  }

  updateViewport(
    command: LayeredViewportCommand
  ): LayeredEditorResult<LayeredViewportUpdateResult> {
    const outcome = this.runExclusive(() => this.updateViewportInternal(command));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private updateViewportInternal(
    command: LayeredViewportCommand
  ): MutationOutcome<LayeredViewportUpdateResult> {
    if (!command || typeof command !== 'object') {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    if (command.type !== 'replace' && command.type !== 'transform') {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    if (!isNonNegativeSafeInteger(command.expectedRevision)) {
      return { result: errResult('invalid-input'), notifications: [] };
    }

    // 先做 payload 校验（不 clamp、不 throw），再判 stale / collecting。
    const isReplace = command.type === 'replace';
    let replaceTarget: DrawingViewport | null = null;
    if (isReplace) {
      // replace 要求 finite 且已在 [MIN,MAX] 范围内；缺失/null/NaN/scale 100 一律 invalid-input。
      replaceTarget = copyViewport(command.viewport);
      if (!replaceTarget) {
        return { result: errResult('invalid-input'), notifications: [] };
      }
    } else if (!isFiniteIntent(command.intent)) {
      return { result: errResult('invalid-input'), notifications: [] };
    }

    if (command.expectedRevision !== this.viewportSnapshot.revision) {
      return { result: errResult('stale-viewport-revision'), notifications: [] };
    }
    // collecting 期间冻结 viewport：有效命令成功但 ignored，不排队、不通知。
    if (this.activeSession) {
      return {
        result: okResult(Object.freeze({ applied: false, reason: 'active-freehand' as const })),
        notifications: [],
      };
    }

    // 非 collecting：replace 用已校验的严格 viewport；transform 正常委托并允许边界 clamp/overflow→null。
    const next: DrawingViewport | null = isReplace
      ? (replaceTarget as DrawingViewport)
      : applyViewportTransformIntent(this.viewportSnapshot.viewport, command.intent);
    if (!next) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    if (sameViewport(next, this.viewportSnapshot.viewport)) {
      return {
        result: okResult(Object.freeze({ applied: false, reason: 'unchanged' as const })),
        notifications: [],
      };
    }
    if (this.viewportSnapshot.revision >= Number.MAX_SAFE_INTEGER) {
      return { result: errResult('revision-exhausted'), notifications: [] };
    }
    this.viewportSnapshot = Object.freeze({
      revision: this.viewportSnapshot.revision + 1,
      viewport: Object.freeze({ scale: next.scale, tx: next.tx, ty: next.ty }),
    });
    return { result: okResult(Object.freeze({ applied: true })), notifications: ['viewport'] };
  }

  commitFreehand(commitId: string): LayeredEditorResult<LayeredCommitReceipt> {
    const outcome = this.runExclusive(() => this.commitInternal(commitId));
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private commitInternal(commitId: string): MutationOutcome<LayeredCommitReceipt> {
    if (!isNonEmptyString(commitId)) {
      return { result: errResult('invalid-input'), notifications: [] };
    }
    const entry = this.pending.get(commitId);
    if (!entry) {
      // 无 pending：直接查 registry 的既有 receipt（不通知 doc/history，不受队列顺序限制）。
      return { result: this.kernel.getExistingReceipt(commitId), notifications: [] };
    }
    // 顺序门：仅 Map 首项（最早 pending）允许提交；后项明确 reject 且保留候选。
    // head 提交失败也不得越过它提交后面的候选。
    const firstPendingCommitId = this.pending.keys().next().value;
    if (firstPendingCommitId !== commitId) {
      return { result: errResult('pending-commit-out-of-order'), notifications: [] };
    }
    // 预检查 session 仍为 awaiting，避免提交成功后反馈失败留下不可回滚的半提交。
    // 注：private Session 反馈失败路径当前不可达；future 若可注入需先硬化该不变量。
    if (entry.session.getSnapshot().status !== 'awaiting-commit') {
      return { result: errResult('internal-invariant'), notifications: [] };
    }
    const receipt = this.kernel.commitCandidate(entry.candidate);
    if (!receipt.ok) {
      // 失败：不移除候选、不反馈、不通知。
      return { result: receipt, notifications: [] };
    }
    const feedback: FreehandCommitFeedback = {
      type: 'commit-succeeded',
      commitId,
      objectId: receipt.value.objectId,
      documentRevision: receipt.value.documentRevision,
    };
    const feedbackResult = entry.session.applyCommitFeedback(feedback);
    if (!feedbackResult.ok) {
      // kernel 已提交不可回滚；如实返回内部不变量错误（半提交仅内部可见）。
      return { result: errResult('internal-invariant'), notifications: [] };
    }
    this.pending.delete(commitId);
    const notifications: LayeredEditorChannel[] = [];
    if (receipt.value.status === 'created') {
      notifications.push('document', 'history');
      if (this.reconcileSelection()) {
        notifications.push('selection');
      }
    }
    notifications.push('interaction');
    return { result: receipt, notifications };
  }

  undo(): LayeredEditorResult<EditorDocument> {
    const outcome = this.runExclusive(() => this.undoInternal());
    this.emit(outcome.notifications);
    return outcome.result;
  }

  editObjects(edit: LayeredObjectEdit): LayeredEditorResult<EditorDocument> {
    const outcome = this.runExclusive<EditorDocument>(() => {
      if (this.activeSession)
        return { result: errResult('active-session-conflict'), notifications: [] };
      const result = this.kernel.editObjects(edit);
      if (!result.ok) return { result, notifications: [] };
      const notifications: LayeredEditorChannel[] = ['document', 'history'];
      if (this.reconcileSelection()) notifications.push('selection');
      return { result, notifications };
    });
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private undoInternal(): MutationOutcome<EditorDocument> {
    const result = this.kernel.undo();
    if (!result.ok) {
      return { result, notifications: [] };
    }
    const notifications: LayeredEditorChannel[] = ['document', 'history'];
    if (this.reconcileSelection()) {
      notifications.push('selection');
    }
    return { result, notifications };
  }

  redo(): LayeredEditorResult<EditorDocument> {
    const outcome = this.runExclusive(() => this.redoInternal());
    this.emit(outcome.notifications);
    return outcome.result;
  }

  private redoInternal(): MutationOutcome<EditorDocument> {
    const result = this.kernel.redo();
    if (!result.ok) {
      return { result, notifications: [] };
    }
    const notifications: LayeredEditorChannel[] = ['document', 'history'];
    if (this.reconcileSelection()) {
      notifications.push('selection');
    }
    return { result, notifications };
  }

  /** 四字段 identity 查询（docrev 供 future 4.5 队列重建）；本期无 ACK。 */
  /**
   * 在 mutation 互斥下仅执行 kernel query，不 emit。
   * 防止 cache.getGeometry callback 重入 undo/commit，使返回的 token.docrev 指向已删除对象。
   */
  getPresentationIdentity(
    commitId: string
  ): LayeredEditorResult<LayeredPresentationIdentity | null> {
    return this.runExclusive(() => ({
      result: this.kernel.getPresentationIdentity(commitId),
      notifications: [],
    })).result;
  }
}

/**
 * 创建分层编辑器控制器。
 *
 * 校验 options、adopt typed schema3 文档、冻结 brush/shape/viewport/selection、创建私有 kernel
 * 与缓存，随后组合为 controller。默认新建 `FreehandGeometryCache`。
 */
export function createLayeredEditorController(
  options: LayeredEditorControllerOptions
): LayeredEditorResult<LayeredEditorController> {
  if (!options || typeof options !== 'object') {
    return errResult('invalid-input');
  }
  const adopted = adoptDocument(options.document);
  if (!adopted) {
    return errResult('invalid-document');
  }
  if (!isTool(options.activeTool)) {
    return errResult('invalid-input');
  }
  const freehandSettings = copyBrush(options.settings?.freehand);
  if (!freehandSettings) {
    return errResult('invalid-input');
  }
  const shapeSettings = copyShapeStyle(options.settings?.shape);
  if (!shapeSettings) {
    return errResult('invalid-input');
  }
  const viewportSnapshotRaw = options.viewport;
  if (
    !viewportSnapshotRaw ||
    typeof viewportSnapshotRaw !== 'object' ||
    !isNonNegativeSafeInteger(viewportSnapshotRaw.revision)
  ) {
    return errResult('invalid-input');
  }
  const viewport = copyViewport(viewportSnapshotRaw.viewport);
  if (!viewport) {
    return errResult('invalid-input');
  }
  if (typeof options.allocateObjectId !== 'function') {
    return errResult('invalid-input');
  }
  // selection：唯一且必须存在于 adopted 文档。
  const selection: string[] = [];
  const seen = new Set<string>();
  if (options.selection !== undefined) {
    if (!Array.isArray(options.selection)) {
      return errResult('invalid-input');
    }
    const existingIds = new Set(adopted.objects.map((object) => object.objectId));
    for (const objectId of options.selection) {
      if (!isNonEmptyString(objectId)) {
        return errResult('invalid-input');
      }
      if (seen.has(objectId)) {
        continue;
      }
      if (!existingIds.has(objectId)) {
        return errResult('selection-target-missing');
      }
      seen.add(objectId);
      selection.push(objectId);
    }
  }

  const geometryCache = options.geometryCache ?? new FreehandGeometryCache();
  const kernel = createDocumentKernel(adopted, options.allocateObjectId, geometryCache);

  return okResult(
    new LayeredEditorControllerImpl({
      kernel,
      activeTool: options.activeTool,
      freehandSettings,
      shapeSettings,
      selection: Object.freeze(selection),
      viewportSnapshot: Object.freeze({
        revision: viewportSnapshotRaw.revision,
        viewport,
      }),
    })
  );
}
