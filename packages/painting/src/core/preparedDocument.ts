import type { DrawingGeometryDescriptor, GeometryPoint } from './geometry';
import { describeDrawingStrokeGeometry } from './geometry';
import {
  canonicalizeClosedRing,
  classifyClosedRing,
  type ClosedRingKind,
  type PolygonBooleanMultiPolygon,
} from './polygonBoolean';
import type { DrawingPointV2, DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';

/** 世界 DIP 的保守轴对齐包围盒，采用半开区间供空间索引精确过滤。 */
export type DrawingBounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

export type PreparedDrawingDiagnostic = Readonly<{
  type: 'invalid-geometry' | 'invalid-bounds';
  index: number;
}>;

/**
 * 已准备的条目只由 document 下标标识。stroke.id 可以重复，不能用作索引键。
 * `stroke` 是冻结的值副本，调用方之后修改原 document 不会改变该快照。
 */
export type PreparedDrawingEntry = Readonly<{
  key: number;
  order: number;
  stroke: DrawingStrokeV2;
  geometry: DrawingGeometryDescriptor;
  bounds: DrawingBounds;
  /** 闭合 path 的拓扑仅在 prepared 阶段分析，避免 frame 重复进行 O(n²) 自交检测。 */
  closedPath?: Readonly<{
    kind: ClosedRingKind;
    /** complex ring 的 nonzero canonical islands/holes；失败要留给 frame 报 clip-failed。 */
    canonicalFill?: PolygonBooleanMultiPolygon;
    canonicalizationFailed?: true;
  }>;
}>;

export type PreparedDrawingDocument = Readonly<{
  revision: number;
  /**
   * 已准备的源 document stroke 总数（含几何无效、未进入 entries 的条目）。
   * append 从这个计数推导下一条 stroke 的正确 document 下标；key/order 始终等于该下标，
   * 因此重复 id 也天然合法，绝不能用 entries.length 代替。
   */
  strokeCount: number;
  entries: readonly PreparedDrawingEntry[];
  diagnostics: readonly PreparedDrawingDiagnostic[];
}>;

let nextPreparedRevision = 1;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function freezePoint(point: DrawingPointV2): DrawingPointV2 {
  return Object.freeze({ ...point });
}

function copyStroke(stroke: DrawingStrokeV2): DrawingStrokeV2 {
  // 输入 document 是外部持久化数据；快照不能保留其可变 points/dashArray 引用。
  return Object.freeze({
    ...stroke,
    points: Object.freeze(stroke.points.map(freezePoint)) as DrawingPointV2[],
    ...(stroke.dashArray ? { dashArray: Object.freeze([...stroke.dashArray]) as number[] } : {}),
  }) as DrawingStrokeV2;
}

function freezeGeometryPoint(point: GeometryPoint): GeometryPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeGeometry(geometry: DrawingGeometryDescriptor): DrawingGeometryDescriptor {
  if (geometry.kind === 'path') {
    return Object.freeze({
      ...geometry,
      points: Object.freeze(geometry.points.map(freezeGeometryPoint)),
    });
  }
  if (geometry.kind === 'cubic-bezier') {
    return Object.freeze({
      ...geometry,
      points: Object.freeze(geometry.points.map(freezeGeometryPoint)) as unknown as readonly [
        GeometryPoint,
        GeometryPoint,
        GeometryPoint,
        GeometryPoint,
      ],
    });
  }
  return Object.freeze({ ...geometry, center: freezeGeometryPoint(geometry.center) });
}

function expand(bounds: DrawingBounds, amount: number): DrawingBounds | null {
  const minX = bounds.minX - amount;
  const minY = bounds.minY - amount;
  let maxX = bounds.maxX + amount;
  let maxY = bounds.maxY + amount;
  if (maxX === minX) maxX += Math.max(Math.abs(maxX) * Number.EPSILON, Number.MIN_VALUE);
  if (maxY === minY) maxY += Math.max(Math.abs(maxY) * Number.EPSILON, Number.MIN_VALUE);
  return [minX, minY, maxX, maxY].every(isFiniteNumber) && minX < maxX && minY < maxY
    ? Object.freeze({ minX, minY, maxX, maxY })
    : null;
}

function boundsForPoints(
  points: readonly { readonly x: number; readonly y: number }[]
): DrawingBounds | null {
  if (points.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // 不使用 Math.min(...points) 等展开形式，长自由笔迹不会耗尽调用栈或参数上限。
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return null;
    }
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

/** 从已生成的 descriptor 得到语义 hull；绝不再次描述原始 stroke。 */
export function getPreparedGeometryBounds(
  geometry: DrawingGeometryDescriptor
): DrawingBounds | null {
  if (geometry.kind === 'path' || geometry.kind === 'cubic-bezier') {
    // 三次曲线的控制点 hull 包含完整曲线，故为保守 bounds。
    return boundsForPoints(geometry.points);
  }

  const cosine = Math.cos(geometry.rotationRad);
  const sine = Math.sin(geometry.rotationRad);
  if (!isFiniteNumber(cosine) || !isFiniteNumber(sine)) {
    return null;
  }

  if (geometry.kind === 'ellipse') {
    const horizontal = Math.sqrt(
      geometry.radiusX * geometry.radiusX * cosine * cosine +
        geometry.radiusY * geometry.radiusY * sine * sine
    );
    const vertical = Math.sqrt(
      geometry.radiusX * geometry.radiusX * sine * sine +
        geometry.radiusY * geometry.radiusY * cosine * cosine
    );
    return boundsForPoints([
      { x: geometry.center.x - horizontal, y: geometry.center.y - vertical },
      { x: geometry.center.x + horizontal, y: geometry.center.y + vertical },
    ]);
  }

  const points = [] as Array<{ x: number; y: number }>;
  const localCorners = [
    [-geometry.halfWidth, -geometry.halfHeight],
    [geometry.halfWidth, -geometry.halfHeight],
    [geometry.halfWidth, geometry.halfHeight],
    [-geometry.halfWidth, geometry.halfHeight],
  ] as const;
  for (const [x, y] of localCorners) {
    points.push({
      x: geometry.center.x + x * cosine - y * sine,
      y: geometry.center.y + x * sine + y * cosine,
    });
  }
  return boundsForPoints(points);
}

function maximumHalfWidth(stroke: DrawingStrokeV2): number {
  // 渲染器的默认描边宽度为 2 DIP。pressure 的合法范围上界为 1，因此基宽本身是安全上界。
  const width = stroke.strokeWidth === undefined ? 2 : stroke.strokeWidth;
  return isFiniteNumber(width) && width >= 0 ? width / 2 : 1;
}

/**
 * 单条 stroke 的准备结果：要么产出一个 entry，要么产出一条带正确 document 下标的诊断。
 * 这是 prepareDrawingDocument 与 appendPreparedDrawingStroke 共享的唯一入口，保证两者语义完全一致。
 */
function prepareEntry(
  source: DrawingStrokeV2,
  index: number
): Readonly<{ entry: PreparedDrawingEntry }> | Readonly<{ diagnostic: PreparedDrawingDiagnostic }> {
  const geometry = describeDrawingStrokeGeometry(source);
  if (geometry === null) {
    return { diagnostic: Object.freeze({ type: 'invalid-geometry', index }) };
  }

  const semanticBounds = getPreparedGeometryBounds(geometry);
  const bounds = semanticBounds === null ? null : expand(semanticBounds, maximumHalfWidth(source));
  if (bounds === null) {
    return { diagnostic: Object.freeze({ type: 'invalid-bounds', index }) };
  }

  const closedPath =
    geometry.kind === 'path' && geometry.closed
      ? (() => {
          const kind = classifyClosedRing(geometry.points);
          if (kind === null) return undefined;
          if (kind === 'simple-convex') return Object.freeze({ kind });
          const canonical = canonicalizeClosedRing(geometry.points);
          return canonical.ok
            ? Object.freeze({ kind, canonicalFill: canonical.polygons })
            : Object.freeze({ kind, canonicalizationFailed: true as const });
        })()
      : undefined;

  return {
    entry: Object.freeze({
      key: index,
      order: index,
      stroke: copyStroke(source),
      geometry: freezeGeometry(geometry),
      bounds,
      ...(closedPath === undefined ? {} : { closedPath }),
    }),
  };
}

/**
 * 一次性准备 document。每一条 stroke 恰好调用一次 describeDrawingStrokeGeometry；
 * geometry 为 null 的条目不会进入 entries，但其 document 下标仍会记录在诊断中。
 */
export function prepareDrawingDocument(document: DrawingValueV2): PreparedDrawingDocument {
  const entries: PreparedDrawingEntry[] = [];
  const diagnostics: PreparedDrawingDiagnostic[] = [];

  for (let index = 0; index < document.strokes.length; index += 1) {
    const prepared = prepareEntry(document.strokes[index], index);
    if ('entry' in prepared) entries.push(prepared.entry);
    else diagnostics.push(prepared.diagnostic);
  }

  return Object.freeze({
    revision: nextPreparedRevision++,
    strokeCount: document.strokes.length,
    entries: Object.freeze(entries),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * append-only 增量准备：只处理新追加的一条 stroke，复用 previous 中既有的 frozen entry 引用。
 *
 * 不变量：
 * - previous 绝不被修改；返回的是带新 revision 的全新冻结 snapshot，旧 snapshot/index/frame 继续有效。
 * - 新条目 key/order 等于 previous.strokeCount（正确 document 下标），几何无效时只追加诊断、
 *   复用 previous.entries 引用，但 strokeCount 仍前进，保证后续下标正确。
 * - 输入 stroke 会被 copyStroke 深拷贝并冻结，调用方之后修改原 document 不会回写。
 */
export function appendPreparedDrawingStroke(
  previous: PreparedDrawingDocument,
  stroke: DrawingStrokeV2
): PreparedDrawingDocument {
  const documentIndex = previous.strokeCount;
  const prepared = prepareEntry(stroke, documentIndex);
  const entries =
    'entry' in prepared
      ? (Object.freeze([...previous.entries, prepared.entry]) as readonly PreparedDrawingEntry[])
      : previous.entries;
  const diagnostics =
    'diagnostic' in prepared
      ? (Object.freeze([
          ...previous.diagnostics,
          prepared.diagnostic,
        ]) as readonly PreparedDrawingDiagnostic[])
      : previous.diagnostics;
  return Object.freeze({
    revision: nextPreparedRevision++,
    strokeCount: documentIndex + 1,
    entries,
    diagnostics,
  });
}

/** 与阶段设计术语一致的别名，保持主 API 语义为“准备 document”。 */
export const createPreparedDrawingDocument = prepareDrawingDocument;
