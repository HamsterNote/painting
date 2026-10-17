import { describeDrawingGeometryContour, type DrawingGeometryDescriptor, type GeometryPoint } from './geometry';
import { hitTestNonzeroRings } from './polygonBoolean';
import {
  clipPreparedDrawingEntry,
  type DrawingFrameFragment,
  type FrameGeometryProgram,
  type FrameClippingDiagnostic,
  type FrameFragmentStatus,
  type FrameLocalClipRegion,
  type FrameResourceBoxFragment,
  type FrameTextProgram,
  type FrameTextRequest,
} from './frameClipping';
import {
  createFrameDrawBudget,
  isDrawDashInput,
  isDrawNumber,
  isDrawResourceBox,
  isFrameProgramWithinBudget,
  type FrameDrawBudget,
} from './frameBudget';
import type { DrawingBounds, PreparedDrawingDocument, PreparedDrawingEntry } from './preparedDocument';
import { appendPreparedDrawingStroke } from './preparedDocument';
import {
  SparseSpatialIndex,
  appendSpatialQueryIndex,
  type AppendSpatialQueryIndexOptions,
  type SparseSpatialIndexOptions,
  type SpatialQueryIndex,
} from './spatialIndex';
import type { DrawingStrokeV2 } from '../model/strokes';
import { createViewportAffine, invertViewportAffine, mapViewportAffinePoint, type Affine2D, type DrawingViewport } from '../viewport';

export const DEFAULT_CULL_GUARD_SCREEN_DIP = 1;
export const DEFAULT_MAX_LOCAL_COORDINATE = 1_000_000;

export type DrawingFrameDiagnostic = Readonly<{
  type: 'invalid-input' | 'prepared-index-mismatch' | 'non-finite-transform' | 'requires-clipping' | 'unresolved-clipping' | 'draw-budget-exceeded';
  field?: string;
  entryKey?: number;
  reason?: FrameClippingDiagnostic['reason'];
}>;

export type PreparedDrawingSpatialIndex = Readonly<{
  prepared: PreparedDrawingDocument;
  preparedRevision: number;
  /** 只读查询索引；可能是全量 sparse 或 append-only 组合索引，frame/hit 只调用 query/queryPoint。 */
  index: SpatialQueryIndex<PreparedDrawingEntry>;
}>;

export type DrawingFrameEntry = Readonly<{
  source: PreparedDrawingEntry;
  /**
   * 仅供审计和尚未迁移的旧适配器读取的完整 local descriptor，不可作为渲染或命中输入。
   * 对超出局部预算的 canonical geometry，此字段为 null，防止创建完整巨大 local geometry。
   */
  canonicalLocalGeometry: DrawingGeometryDescriptor | null;
  /**
   * @deprecated 仅为阶段 5 Skia adapter 的编译兼容保留，始终是安全局部 geometry 的单片段
   * 投影，不能表达 segmented/semantic 完整语义；新 renderer 必须只消费 `fragments`。
   */
  geometry: DrawingGeometryDescriptor;
  status: FrameFragmentStatus;
  fragments: readonly DrawingFrameFragment[];
  /** render 与 hit 共用的对象级 geometry program；复杂 fill 不能回退为多个 area fragment。 */
  program: FrameGeometryProgram;
  diagnostic?: FrameClippingDiagnostic;
}>;

export type DrawingFrame = Readonly<{
  prepared: PreparedDrawingDocument;
  spatialIndex: PreparedDrawingSpatialIndex;
  globalToScreen: Affine2D;
  localToScreen: Affine2D;
  frameOrigin: GeometryPoint;
  visibleWorldBounds: DrawingBounds;
  localClipRegion: FrameLocalClipRegion;
  /** 索引召回的完整可见候选，含 empty/unresolved，供审计。 */
  visibleEntries: readonly DrawingFrameEntry[];
  /** 只包含至少一个可安全消费 fragment 的条目；render 与 hit 必须使用本集合。 */
  renderableEntries: readonly DrawingFrameEntry[];
  /**
   * 兼容字段：表示本帧曾需要几何裁剪（成功或未解决均可），不表示失败，也不等价于
   * `hasUnresolvedClipping`。新调用方应分别读取 status 与 hasUnresolvedClipping。
   */
  requiresClipping: boolean;
  /** 未能在本轮安全表达的裁剪条目；它们绝不进入 renderable/hit。 */
  hasUnresolvedClipping: boolean;
  unresolvedClippingKeys: readonly number[];
  /** @deprecated 保留为历史审计名；其值为需要 fragment 裁剪或无法裁剪的 entry key。 */
  unsafeEntryKeys: readonly number[];
  maxLocalCoordinate: number;
  /** frame 与 Skia adapter 共用的最终数值输入预算。 */
  drawBudget: FrameDrawBudget;
  diagnostics: readonly DrawingFrameDiagnostic[];
}>;

export type CreateDrawingFrameOptions = Readonly<{
  prepared: PreparedDrawingDocument;
  spatialIndex: PreparedDrawingSpatialIndex;
  viewport: DrawingViewport;
  layoutSize: Readonly<{ width: number; height: number }>;
  cullGuardScreenDip?: number;
  maxLocalCoordinate?: number;
  /** 平台层可同步注入已缓存的纯文本 program；未准备的 partial text 明确保持不可渲染。 */
  resolveTextProgram?: (request: FrameTextRequest) => FrameTextProgram | null;
}>;

export type DrawingFrameHit = Readonly<{ entry: DrawingFrameEntry; point: GeometryPoint }>;
export type CreateDrawingFrameResult = Readonly<{ ok: true; frame: DrawingFrame }> | Readonly<{ ok: false; diagnostics: readonly DrawingFrameDiagnostic[] }>;

function finite(value: number): boolean { return Number.isFinite(value); }
function finitePoint(point: GeometryPoint): boolean { return finite(point.x) && finite(point.y); }
function strictViewport(viewport: DrawingViewport): boolean { return finite(viewport.scale) && viewport.scale > 0 && finite(viewport.tx) && finite(viewport.ty); }
function strictAffine(affine: Affine2D): boolean { return [affine.a, affine.b, affine.c, affine.d, affine.tx, affine.ty].every(finite); }

function boundsFromCorners(corners: readonly GeometryPoint[]): DrawingBounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of corners) {
    if (!finitePoint(point)) return null;
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return [minX, minY, maxX, maxY].every(finite) ? Object.freeze({ minX, minY, maxX, maxY }) : null;
}

function midpoint(min: number, max: number): number { return min / 2 + max / 2; }

function translateAuditGeometry(geometry: DrawingGeometryDescriptor, origin: GeometryPoint, limit: number): DrawingGeometryDescriptor | null {
  const point = (value: GeometryPoint): GeometryPoint | null => {
    const x = value.x - origin.x;
    const y = value.y - origin.y;
    return finite(x) && finite(y) && Math.abs(x) <= limit && Math.abs(y) <= limit ? Object.freeze({ x, y }) : null;
  };
  if (geometry.kind === 'path' || geometry.kind === 'cubic-bezier') {
    const points = geometry.points.map(point);
    if (points.some((value) => value === null)) return null;
    return geometry.kind === 'path'
      ? Object.freeze({ ...geometry, points: Object.freeze(points as GeometryPoint[]) })
      : Object.freeze({ ...geometry, points: Object.freeze(points as GeometryPoint[]) as unknown as readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint] });
  }
  const center = point(geometry.center);
  return center === null ? null : Object.freeze({ ...geometry, center });
}

function safeCompatibilityGeometry(
  canonicalLocalGeometry: DrawingGeometryDescriptor | null,
  fragments: readonly DrawingFrameFragment[],
  fallback: DrawingGeometryDescriptor
): DrawingGeometryDescriptor {
  if (canonicalLocalGeometry) return canonicalLocalGeometry;
  const fragment = fragments[0];
  if (!fragment) return fallback;
  return Object.freeze({
    kind: 'path',
    points: Object.freeze(fragment.points.map((point) => Object.freeze({ ...point }))),
    closed: fragment.kind === 'semantic-area',
  });
}

function pointQueryUpperBound(value: number): number { return value + Math.max(Math.abs(value) * Number.EPSILON, Number.MIN_VALUE); }
function failure(diagnostics: readonly DrawingFrameDiagnostic[]): CreateDrawingFrameResult { return Object.freeze({ ok: false, diagnostics: Object.freeze([...diagnostics]) }); }

function localRegionFromScreen(
  screenCorners: readonly GeometryPoint[],
  inverse: Affine2D,
  origin: GeometryPoint,
  limit: number
): FrameLocalClipRegion | null {
  const locals = screenCorners.map((screen) => {
    const global = mapViewportAffinePoint(screen, inverse);
    return { x: global.x - origin.x, y: global.y - origin.y };
  });
  if (!locals.every(finitePoint)) return null;
  const bounds = boundsFromCorners(locals);
  if (!bounds) return null;
  const minX = Math.max(-limit, bounds.minX);
  const minY = Math.max(-limit, bounds.minY);
  const maxX = Math.min(limit, bounds.maxX);
  const maxY = Math.min(limit, bounds.maxY);
  return [minX, minY, maxX, maxY].every(finite) && minX <= maxX && minY <= maxY ? Object.freeze({ minX, minY, maxX, maxY }) : null;
}

function normalizedPressure(pressure: number | undefined): number {
  return typeof pressure === 'number' && finite(pressure) && pressure >= 0 && pressure <= 1 ? pressure : 1;
}

function distanceSquaredToSegment(point: GeometryPoint, start: GeometryPoint, end: GeometryPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  const distanceX = point.x - (start.x + dx * t);
  const distanceY = point.y - (start.y + dy * t);
  return distanceX * distanceX + distanceY * distanceY;
}

function hitFragments(entry: DrawingFrameEntry, point: GeometryPoint, tolerance: number): boolean {
  for (const fragment of entry.fragments) {
    if (!isResourceBoxFragment(fragment)) continue;
    // image 是完整像素资源；其裁后 polygon 仍是唯一 render/hit 区域。文字绝不走此通用框命中。
    if (fragment.resourceBox.tool === 'image') {
      if (hitTestNonzeroRings([fragment.points], point, tolerance)) return true;
      continue;
    }
    const program = fragment.resourceBox.textProgram;
    if (!program || program.kind === 'empty-text') continue;
    if (program.semanticRegions.some((region) => hitTestNonzeroRings([region.polygon], point, tolerance))) return true;
  }
  for (const fragment of entry.program.strokes) {
    {
      // 使用 fragment 保存的源端 pressure，而非 clip 交点 pressure，保持渲染宽度语义。
      const width = Math.max(0, entry.source.stroke.strokeWidth ?? 2);
      const pressure = entry.source.stroke.tool === 'pen'
        ? normalizedPressure(fragment.sourcePressures.end)
        : 1;
      const radius = tolerance + width * pressure / 2;
      const squared = radius * radius;
      if (!finite(squared)) return false;
      for (let index = 0; index < fragment.points.length - 1; index += 1) {
        const start = fragment.points[index];
        const end = fragment.points[index + 1];
        if (distanceSquaredToSegment(point, start, end) <= squared) return true;
      }
      if (fragment.closed && fragment.points.length > 2) {
        const start = fragment.points[fragment.points.length - 1];
        const end = fragment.points[0];
        if (distanceSquaredToSegment(point, start, end) <= squared) return true;
      }
      continue;
    }
  }
  for (const fill of entry.program.fills) {
    const rings = fill.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]);
    if (hitTestNonzeroRings(rings, point, tolerance)) return true;
  }
  return false;
}

function contourDeviation(entry: PreparedDrawingEntry): number {
  const contour = entry.geometry.kind === 'path' || entry.geometry.kind === 'rect'
    ? null
    : describeDrawingGeometryContour(entry.geometry);
  return contour && !contour.capped && contour.isWithinRequestedMaxDeviation && finite(contour.maxDeviation)
    ? Math.max(0, contour.maxDeviation)
    : 0;
}

function isResourceBoxFragment(fragment: DrawingFrameFragment): fragment is FrameResourceBoxFragment {
  return fragment.kind === 'semantic-area' && 'resourceBox' in fragment;
}

/** program 是 render/hit 的唯一权威；复合 fill 可不投影为 legacy fragment。 */
function hasRenderableProgram(entry: DrawingFrameEntry): boolean {
  return entry.status !== 'unresolved' && (
    entry.program.strokes.length > 0 ||
    entry.program.fills.length > 0 ||
    entry.fragments.some((fragment) => {
      if (!isResourceBoxFragment(fragment)) return false;
      if (fragment.resourceBox.tool === 'image') return true;
      const program = fragment.resourceBox.textProgram;
      // 有 textRequest 表示 partial/超大 text；它必须先由平台 provider 兑现，不能走完整框回退。
      return fragment.resourceBox.textRequest === undefined
        ? true
        : program !== undefined && program.kind !== 'empty-text';
    })
  );
}

function withResolvedTextProgram(
  fragment: DrawingFrameFragment,
  resolveTextProgram: ((request: FrameTextRequest) => FrameTextProgram | null) | undefined
): DrawingFrameFragment {
  if (!isResourceBoxFragment(fragment) || fragment.resourceBox.tool !== 'text' || !fragment.resourceBox.textRequest || !resolveTextProgram) return fragment;
  const program = resolveTextProgram(fragment.resourceBox.textRequest);
  return program === null ? fragment : Object.freeze({ ...fragment, resourceBox: Object.freeze({ ...fragment.resourceBox, textProgram: program }) });
}

/**
 * entry bounds 仅负责索引召回。实际中心线裁剪还必须扩到已绘制的视觉区域：以屏幕 DIP
 * 计算外扩，再通过 inverse affine 映射为 local 坐标，避免 .25/1/8 scale 下的漏召回。
 */
function visualClipRegion(
  base: FrameLocalClipRegion,
  entry: PreparedDrawingEntry,
  globalToScreen: Affine2D,
  inverse: Affine2D,
  limit: number,
  guardScreenDip: number
): FrameLocalClipRegion | null {
  const strokeWidth = entry.stroke.strokeWidth === undefined ? 2 : entry.stroke.strokeWidth;
  if (!finite(strokeWidth) || strokeWidth < 0) return null;
  const worldOutset = strokeWidth / 2 + contourDeviation(entry);
  // 必须使用 createViewportAffine 已归一化后的线性部分，不能读取未归一化的持久 viewport.scale。
  const screenPerWorld = Math.max(
    Math.abs(globalToScreen.a) + Math.abs(globalToScreen.c),
    Math.abs(globalToScreen.b) + Math.abs(globalToScreen.d)
  );
  const screenOutset = worldOutset * screenPerWorld + guardScreenDip;
  if (!finite(screenOutset) || screenOutset < 0) return null;
  // inverse 的线性部分把一个 screen square 映射为 local AABB；取绝对行和不漏旋转/剪切。
  const xOutset = (Math.abs(inverse.a) + Math.abs(inverse.c)) * screenOutset;
  const yOutset = (Math.abs(inverse.b) + Math.abs(inverse.d)) * screenOutset;
  if (!finite(xOutset) || !finite(yOutset)) return null;
  const minX = Math.max(-limit, base.minX - xOutset);
  const minY = Math.max(-limit, base.minY - yOutset);
  const maxX = Math.min(limit, base.maxX + xOutset);
  const maxY = Math.min(limit, base.maxY + yOutset);
  return minX <= maxX && minY <= maxY && [minX, minY, maxX, maxY].every(finite)
    ? Object.freeze({ minX, minY, maxX, maxY })
    : null;
}

/** 片段输出前的完整数值预算：不依赖 renderer 的隐式 clamp 或无穷矩阵容忍。 */
/** frame 不会用 descriptor 的 fallback/clamp 纠正持久样式，非法值直接隔离。 */
function sourceStyleWithinBudget(entry: PreparedDrawingEntry, budget: FrameDrawBudget): boolean {
  const stroke = entry.stroke;
  const strokeWidth = stroke.strokeWidth ?? 2;
  const fillOpacity = stroke.fillOpacity ?? 1;
  if (!isDrawNumber(strokeWidth, budget) || strokeWidth < 0 || !isDrawNumber(fillOpacity, budget) || fillOpacity < 0 || fillOpacity > 1) return false;
  if (!isDrawDashInput(stroke.dashArray, stroke.dashOffset ?? 0, budget)) return false;
  if (stroke.tool === 'text') {
    const fontSize = stroke.fontSize ?? 24;
    if (!isDrawNumber(fontSize, budget) || fontSize <= 0) return false;
  }
  return true;
}

/** 最后一道 core gate：program、resource 实参和从 source 形成的 Skia style 同时入预算。 */
function fragmentsWithinBudget(program: FrameGeometryProgram, fragments: readonly DrawingFrameFragment[], entry: PreparedDrawingEntry, budget: FrameDrawBudget): boolean {
  return sourceStyleWithinBudget(entry, budget) &&
    isFrameProgramWithinBudget(program, budget) &&
    fragments.every((fragment) =>
      fragment.points.every((point) => isDrawNumber(point.x, budget) && isDrawNumber(point.y, budget)) &&
      (!isResourceBoxFragment(fragment) || isDrawResourceBox(fragment, budget))
    );
}

export function createPreparedDrawingSpatialIndex(prepared: PreparedDrawingDocument, options?: SparseSpatialIndexOptions): PreparedDrawingSpatialIndex {
  const index = new SparseSpatialIndex<PreparedDrawingEntry>(options);
  for (const entry of prepared.entries) index.upsert(entry.key, entry, entry.bounds, entry.order);
  return Object.freeze({ prepared, preparedRevision: prepared.revision, index });
}

/**
 * append-only 增量准备 + 索引：把一条新 stroke 追加到既有 prepared/index 快照。
 *
 * 不变量：
 * - 返回全新冻结的 PreparedDrawingSpatialIndex，previous（及其 index、既有 frame）保持不变。
 * - preparedRevision 与 prepared.revision 同步，满足 tryCreateDrawingFrame 的 identity/revision 校验。
 * - 几何无效的 stroke 只追加诊断：prepared revision 前进但索引复用 previous.index，frame 仍可正常构建。
 * - 索引用不可变组合实现追加；链深超过 maxDeltaDepth 时内部全量重建压平，语义不变。
 */
export function appendPreparedDrawingEntry(
  previous: PreparedDrawingSpatialIndex,
  stroke: DrawingStrokeV2,
  options?: AppendSpatialQueryIndexOptions
): PreparedDrawingSpatialIndex {
  const prepared = appendPreparedDrawingStroke(previous.prepared, stroke);
  const appendedIndex = prepared.strokeCount - 1;
  const lastEntry = prepared.entries[prepared.entries.length - 1];
  // 仅当确实新增了 entry（key 等于新 document 下标）时才推进索引；invalid geometry 复用旧索引。
  const appendedEntry = lastEntry !== undefined && lastEntry.key === appendedIndex ? lastEntry : undefined;
  const index = appendedEntry === undefined
    ? previous.index
    : appendSpatialQueryIndex(
        previous.index,
        appendedEntry.key,
        appendedEntry,
        appendedEntry.bounds,
        appendedEntry.order,
        options
      );
  return Object.freeze({ prepared, preparedRevision: prepared.revision, index });
}

/** 严格 frame 构建：只从 indexed canonical global geometry 生成单帧 transient fragments。 */
export function tryCreateDrawingFrame(options: CreateDrawingFrameOptions): CreateDrawingFrameResult {
  const { prepared, spatialIndex, viewport, layoutSize } = options;
  const guard = options.cullGuardScreenDip ?? DEFAULT_CULL_GUARD_SCREEN_DIP;
  const maxLocalCoordinate = options.maxLocalCoordinate ?? DEFAULT_MAX_LOCAL_COORDINATE;
  const diagnostics: DrawingFrameDiagnostic[] = [];
  if (spatialIndex.prepared !== prepared || spatialIndex.preparedRevision !== prepared.revision) return failure([Object.freeze({ type: 'prepared-index-mismatch' })]);
  if (!strictViewport(viewport)) diagnostics.push(Object.freeze({ type: 'invalid-input', field: 'viewport' }));
  if (!finite(layoutSize.width) || layoutSize.width <= 0 || !finite(layoutSize.height) || layoutSize.height <= 0) diagnostics.push(Object.freeze({ type: 'invalid-input', field: 'layoutSize' }));
  if (!finite(guard) || guard < 0) diagnostics.push(Object.freeze({ type: 'invalid-input', field: 'cullGuardScreenDip' }));
  if (!finite(maxLocalCoordinate) || maxLocalCoordinate <= 0 || maxLocalCoordinate > DEFAULT_MAX_LOCAL_COORDINATE) diagnostics.push(Object.freeze({ type: 'invalid-input', field: 'maxLocalCoordinate' }));
  if (diagnostics.length > 0) return failure(diagnostics);

  const globalToScreen = createViewportAffine(viewport);
  const inverse = invertViewportAffine(globalToScreen);
  if (!strictAffine(globalToScreen) || !inverse || !strictAffine(inverse)) return failure([Object.freeze({ type: 'non-finite-transform' })]);
  const screenCorners: GeometryPoint[] = [
    { x: -guard, y: -guard }, { x: layoutSize.width + guard, y: -guard },
    { x: layoutSize.width + guard, y: layoutSize.height + guard }, { x: -guard, y: layoutSize.height + guard },
  ];
  const worldCorners = screenCorners.map((point) => mapViewportAffinePoint(point, inverse));
  const visibleWorldBounds = boundsFromCorners(worldCorners);
  if (!visibleWorldBounds) return failure([Object.freeze({ type: 'non-finite-transform' })]);
  const frameOrigin = Object.freeze({ x: midpoint(visibleWorldBounds.minX, visibleWorldBounds.maxX), y: midpoint(visibleWorldBounds.minY, visibleWorldBounds.maxY) });
  if (!finitePoint(frameOrigin)) return failure([Object.freeze({ type: 'non-finite-transform' })]);
  const localToScreen = Object.freeze({
    ...globalToScreen,
    tx: globalToScreen.a * frameOrigin.x + globalToScreen.c * frameOrigin.y + globalToScreen.tx,
    ty: globalToScreen.b * frameOrigin.x + globalToScreen.d * frameOrigin.y + globalToScreen.ty,
  });
  const drawBudget = createFrameDrawBudget(maxLocalCoordinate, localToScreen);
  if (!strictAffine(localToScreen) || !drawBudget) return failure([Object.freeze({ type: 'non-finite-transform' })]);
  const localClipRegion = localRegionFromScreen(screenCorners, inverse, frameOrigin, maxLocalCoordinate);
  if (!localClipRegion) return failure([Object.freeze({ type: 'non-finite-transform' })]);

  const visibleEntries: DrawingFrameEntry[] = [];
  const renderableEntries: DrawingFrameEntry[] = [];
  const unsafeEntryKeys: number[] = [];
  const unresolvedClippingKeys: number[] = [];
  for (const match of spatialIndex.index.query(visibleWorldBounds)) {
    // text/image 的实际内容由 resource clip 精确裁去，不能沿用 stroke 的 visual outset
    // 而让完整 resource box 在当前 frame local clip 之外仍可见/可命中。
    const entryClipRegion = match.value.stroke.tool === 'text' || match.value.stroke.tool === 'image'
      ? localClipRegion
      : visualClipRegion(localClipRegion, match.value, globalToScreen, inverse, maxLocalCoordinate, guard);
    const contourScreenScale = Math.hypot(globalToScreen.a, globalToScreen.b, globalToScreen.c, globalToScreen.d);
    const contourMaxDeviation = contourScreenScale > 0 && finite(contourScreenScale)
      ? Math.min(0.5, 0.25 / contourScreenScale)
      : Number.NaN;
    const rawClipped = entryClipRegion === null
      ? Object.freeze({ status: 'unresolved' as const, fragments: Object.freeze([]), program: Object.freeze({ strokes: Object.freeze([]), fills: Object.freeze([]), maxDeviation: 0 }), diagnostic: Object.freeze({ type: 'unresolved-clipping' as const, reason: 'unsafe-number' as const }) })
      : clipPreparedDrawingEntry(match.value, frameOrigin, entryClipRegion, maxLocalCoordinate, contourMaxDeviation);
    const resolvedFragments = rawClipped.fragments.map((fragment) => withResolvedTextProgram(fragment, options.resolveTextProgram));
    const resolvedClipped = resolvedFragments === rawClipped.fragments
      ? rawClipped
      : Object.freeze({ ...rawClipped, fragments: Object.freeze(resolvedFragments) });
    const pendingText = resolvedClipped.fragments.some((fragment) =>
      isResourceBoxFragment(fragment) && fragment.resourceBox.tool === 'text' &&
      fragment.resourceBox.visible !== undefined && fragment.resourceBox.textRequest !== undefined && fragment.resourceBox.textProgram === undefined
    );
    const clipped = pendingText
      ? Object.freeze({ ...resolvedClipped, status: 'pending' as const })
      : fragmentsWithinBudget(resolvedClipped.program, resolvedClipped.fragments, match.value, drawBudget)
        ? resolvedClipped
        : Object.freeze({ status: 'unresolved' as const, fragments: Object.freeze([]), program: Object.freeze({ strokes: Object.freeze([]), fills: Object.freeze([]), maxDeviation: 0 }), diagnostic: Object.freeze({ type: 'unresolved-clipping' as const, reason: 'unsafe-number' as const }) });
    const canonicalLocalGeometry = translateAuditGeometry(match.value.geometry, frameOrigin, maxLocalCoordinate);
    const entry = Object.freeze({
      source: match.value, canonicalLocalGeometry,
      geometry: safeCompatibilityGeometry(canonicalLocalGeometry, clipped.fragments, match.value.geometry),
      status: clipped.status, fragments: clipped.fragments, program: clipped.program,
      ...(clipped.diagnostic ? { diagnostic: clipped.diagnostic } : {}),
    });
    visibleEntries.push(entry);
    if (clipped.status !== 'unchanged' && clipped.status !== 'rebased' && clipped.status !== 'empty') unsafeEntryKeys.push(match.value.key);
    if (clipped.status === 'unresolved') {
      unresolvedClippingKeys.push(match.value.key);
      diagnostics.push(Object.freeze({ type: 'unresolved-clipping', entryKey: match.value.key, reason: clipped.diagnostic?.reason }));
    }
    if (hasRenderableProgram(entry)) renderableEntries.push(entry);
  }
  const requiresClipping = unsafeEntryKeys.length > 0;
  return Object.freeze({ ok: true, frame: Object.freeze({
    prepared, spatialIndex, globalToScreen: Object.freeze({ ...globalToScreen }), localToScreen, frameOrigin, visibleWorldBounds, localClipRegion,
    visibleEntries: Object.freeze(visibleEntries), renderableEntries: Object.freeze(renderableEntries), requiresClipping,
    hasUnresolvedClipping: unresolvedClippingKeys.length > 0, unresolvedClippingKeys: Object.freeze(unresolvedClippingKeys), unsafeEntryKeys: Object.freeze(unsafeEntryKeys),
    maxLocalCoordinate, drawBudget, diagnostics: Object.freeze(diagnostics),
  }) });
}

export function createDrawingFrame(options: CreateDrawingFrameOptions): DrawingFrame | null {
  const result = tryCreateDrawingFrame(options);
  return result.ok ? result.frame : null;
}

/** 同一份 frame fragments 是唯一命中来源；canonical geometry 绝不可在这里 fallback 重建。 */
export function hitTestDrawingFrame(frame: DrawingFrame, screenPoint: GeometryPoint, toleranceScreenDip = 0): DrawingFrameHit | null {
  if (!finitePoint(screenPoint) || !finite(toleranceScreenDip) || toleranceScreenDip < 0) return null;
  const inverse = invertViewportAffine(frame.localToScreen);
  if (!inverse) return null;
  const localPoint = mapViewportAffinePoint(screenPoint, inverse);
  if (!finitePoint(localPoint) || Math.abs(localPoint.x) > frame.maxLocalCoordinate || Math.abs(localPoint.y) > frame.maxLocalCoordinate) return null;
  const tolerance = toleranceScreenDip / frame.globalToScreen.a;
  if (!finite(tolerance) || tolerance < 0) return null;
  // 按已有 spatial index 的逆序（topmost）过滤，再仅使用同一 entry 的安全 fragments 判定。
  const globalPoint = { x: localPoint.x + frame.frameOrigin.x, y: localPoint.y + frame.frameOrigin.y };
  if (!finitePoint(globalPoint)) return null;
  const candidates = tolerance === 0 ? frame.spatialIndex.index.queryPoint(globalPoint) : frame.spatialIndex.index.query({
    minX: globalPoint.x - tolerance, minY: globalPoint.y - tolerance,
    maxX: pointQueryUpperBound(globalPoint.x + tolerance), maxY: pointQueryUpperBound(globalPoint.y + tolerance),
  });
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const entry = frame.renderableEntries.find(({ source }) => source.key === candidates[index].value.key);
    if (entry && hitFragments(entry, localPoint, tolerance)) return Object.freeze({ entry, point: Object.freeze(localPoint) });
  }
  return null;
}
