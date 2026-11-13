/**
 * 分层对象几何查询（Task 5.2–5.4 后续基础）
 *
 * 只读 prepared + 世界坐标 point/sweep/lasso 查询。不是 docstore / cache framework：
 * `prepareLayeredObjectQuery` 用共享 `readLayeredDocument` 做完整 schema3 白名单校验，
 * 再把每个对象的**真实**几何（PF final 轮廓、image/text 精确四边形、shape 中心线粗描边并集）
 * 编译为世界多边形 pieces，供查询逐个命中。
 *
 * 依赖仅：`model/document`、`model/documentReader`、共享 geometry
 * (affine/adaptiveContour/shape/worldBounds/freehandCache)、pure `./polygonBoolean` 与现有
 * `polyclip-ts`（union/intersection/difference）。无 DOM / V2 runtime / Skia / 新依赖。
 *
 * 语义要点：
 * - nonzero filled；PF 用 `cache.getPresentation(...,'final').transformedPolygon`，无中心线 fallback。
 * - shape 用未 dash 的连续中心线 + local 半宽圆帽/圆连接；**绝不**用 σmax 圆盘放大半径。
 * - shape 统一 errorMargin=.25（中心线 .125 + 帽 .125），contains 额外 .25 clearance；
 *   image/text/PF margin=0 精确 polygon。
 * - 失败原子且不 partial；数值溢出/环布尔异常 → geometry-failed，绝不降级为空/假阴性。
 */

import { difference, intersection } from 'polyclip-ts';
import { orient2d } from 'robust-predicates';
import type {
  AffineTransform,
  Bounds,
  DocumentObject,
  EditorDocument,
  FreehandObject,
  Point,
} from '../model/document';
import { readLayeredDocument } from '../model/documentReader';
import type { LayeredEditorController } from './layeredEditorController';
import { applyAffine } from '../geometry/affine';
import { flattenLayeredCubic, flattenLayeredEllipse } from '../geometry/adaptiveContour';
import { deriveShapeGeometry } from '../geometry/shape';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';
import type { FreehandGeometryCache, FreehandPresentation } from '../geometry/freehandCache';
import {
  canonicalizeClosedRing,
  hitTestNonzeroRings,
  type PolygonBooleanMultiPolygon,
  type PolygonBooleanPolygon,
  type PolygonRing,
} from './polygonBoolean';

/** 查询错误码。 */
export type LayeredObjectQueryErrorCode =
  'invalid-input' | 'invalid-document' | 'geometry-failed' | 'budget-exceeded';

/** 统一 Result；value/error 只读。 */
export type LayeredObjectQueryResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: LayeredObjectQueryErrorCode }> }>;

/** 命中记录（升序 order）；不携带遮挡信息。 */
export type LayeredObjectQueryHit = Readonly<{
  objectId: string;
  objectRevision: number;
  transformRevision: number;
  kind: DocumentObject['kind'];
  order: number;
}>;

/** 预处理后的只读查询快照；不含 document/history，不可变。 */
export type PreparedLayeredObjectQuery = Readonly<{
  documentRevision: number;
  entries: readonly PreparedEntry[];
}>;

/** 单个 occupied piece：一组世界多边形（stroke 矩形/圆盘或 fill 区域）。 */
type PreparedPiece = Readonly<{
  polygons: PolygonBooleanMultiPolygon;
}>;

/** 单个对象的预处理条目（私有派生类型）。 */
type PreparedEntry = Readonly<{
  objectId: string;
  objectRevision: number;
  transformRevision: number;
  kind: DocumentObject['kind'];
  order: number;
  /** 命中误差 margin：shape=.25，其它=0。 */
  margin: number;
  pieces: readonly PreparedPiece[];
  broadphase: Bounds;
}>;

/** 每对象所有 pieces 的总顶点预算。 */
const MAX_TOTAL_VERTICES = 65536;
const SHAPE_ERROR_MARGIN = 0.25;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ok<T>(value: T): LayeredObjectQueryResult<T> {
  return Object.freeze({ ok: true, value });
}

function err<T>(code: LayeredObjectQueryErrorCode): LayeredObjectQueryResult<T> {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) });
}

// ---------------------------------------------------------------------------
// 世界多边形与 polyclip 互操作
// ---------------------------------------------------------------------------

function ringToCoords(ring: PolygonRing): [number, number][] {
  return ring.map((point) => [point.x, point.y]);
}

function polygonToCoords(polygon: PolygonBooleanPolygon): [number, number][][] {
  return [ringToCoords(polygon.outer), ...polygon.holes.map(ringToCoords)];
}

function multiToGeom(multi: PolygonBooleanMultiPolygon): [number, number][][][] {
  return multi.map(polygonToCoords);
}

/** polyclip 输出转内部 multiPolygon；ring 非法/空返回 null。 */
function fromPolyclip(
  result: readonly (readonly (readonly (readonly [number, number])[])[])[]
): PolygonBooleanMultiPolygon | null {
  const polygons: PolygonBooleanPolygon[] = [];
  for (const polygon of result) {
    if (polygon.length === 0) {
      return null;
    }
    const rings: PolygonRing[] = [];
    for (const rawRing of polygon) {
      const points: Point[] = [];
      for (const [x, y] of rawRing) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }
        points.push(Object.freeze({ x, y }));
      }
      if (points.length < 3) {
        return null;
      }
      rings.push(Object.freeze(points));
    }
    polygons.push(Object.freeze({ outer: rings[0]!, holes: Object.freeze(rings.slice(1)) }));
  }
  return Object.freeze(polygons);
}

function isMultiEmpty(multi: PolygonBooleanMultiPolygon): boolean {
  return multi.length === 0;
}

function allRings(multi: PolygonBooleanMultiPolygon): readonly PolygonRing[] {
  const rings: PolygonRing[] = [];
  for (const polygon of multi) {
    rings.push(polygon.outer);
    for (const hole of polygon.holes) {
      rings.push(hole);
    }
  }
  return rings;
}

/** 点到有限 segment 的距离；hypot/归一化避免可避免溢出；非有限返回 null。 */
function pointSegmentDistance(point: Point, a: Point, b: Point): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) {
    return null;
  }
  if (length === 0) {
    const distance = Math.hypot(point.x - a.x, point.y - a.y);
    return Number.isFinite(distance) ? distance : null;
  }
  const ux = dx / length;
  const uy = dy / length;
  let t = (point.x - a.x) * ux + (point.y - a.y) * uy;
  if (!Number.isFinite(t)) {
    return null;
  }
  if (t < 0) {
    t = 0;
  } else if (t > length) {
    t = length;
  }
  const projectedX = a.x + t * ux;
  const projectedY = a.y + t * uy;
  if (!Number.isFinite(projectedX) || !Number.isFinite(projectedY)) {
    return null;
  }
  const distance = Math.hypot(point.x - projectedX, point.y - projectedY);
  return Number.isFinite(distance) ? distance : null;
}

/** 环边界（闭合）到点的最小距离；非有限返回 null。 */
function pointRingDistance(point: Point, ring: PolygonRing): number | null {
  if (ring.length === 0) {
    return null;
  }
  if (ring.length === 1) {
    const distance = Math.hypot(point.x - ring[0]!.x, point.y - ring[0]!.y);
    return Number.isFinite(distance) ? distance : null;
  }
  let best = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    const distance = pointSegmentDistance(point, a, b);
    if (distance === null) {
      return null;
    }
    if (distance < best) {
      best = distance;
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** 点到多边形的所有边界（outer+holes）最小距离。 */
function pointMultiDistance(point: Point, multi: PolygonBooleanMultiPolygon): number | null {
  let best = Infinity;
  for (const ring of allRings(multi)) {
    const distance = pointRingDistance(point, ring);
    if (distance === null) {
      return null;
    }
    if (distance < best) {
      best = distance;
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** 两 segment 是否相交（含端点接触）；非有限返回 null。 */
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean | null {
  const orient = (p: Point, q: Point, r: Point): number | null => {
    const value = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return Number.isFinite(value) ? value : null;
  };
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 === null || o2 === null || o3 === null || o4 === null) {
    return null;
  }
  return o1 * o2 <= 0 && o3 * o4 <= 0;
}

/** 两 segment 最小距离；相交为 0；非有限返回 null。 */
function segmentSegmentDistance(a: Point, b: Point, c: Point, d: Point): number | null {
  const cross = segmentsIntersect(a, b, c, d);
  if (cross === null) {
    return null;
  }
  if (cross) {
    return 0;
  }
  let best = Infinity;
  for (const [point, s, e] of [
    [a, c, d],
    [b, c, d],
    [c, a, b],
    [d, a, b],
  ] as const) {
    const distance = pointSegmentDistance(point, s as Point, e as Point);
    if (distance === null) {
      return null;
    }
    if (distance < best) {
      best = distance;
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** 两环边界最小距离（>=3 点按闭合段；1/2 点按退化点/线）。 */
function ringRingDistance(first: PolygonRing, second: PolygonRing): number | null {
  if (first.length === 0 || second.length === 0) {
    return null;
  }
  const firstSegments = ringSegments(first);
  const secondSegments = ringSegments(second);
  let best = Infinity;
  for (const [a, b] of firstSegments) {
    for (const [c, d] of secondSegments) {
      const distance = segmentSegmentDistance(a, b, c, d);
      if (distance === null) {
        return null;
      }
      if (distance < best) {
        best = distance;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** 环的段集合：闭合（含 wrap）；len1 空；len2 单段。 */
function ringSegments(ring: PolygonRing): ReadonlyArray<readonly [Point, Point]> {
  const segments: Array<readonly [Point, Point]> = [];
  if (ring.length < 2) {
    return segments;
  }
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    segments.push([a, b]);
  }
  return segments;
}

/** 两 multiPolygon 边界最小距离。 */
function multiMultiDistance(
  first: PolygonBooleanMultiPolygon,
  second: PolygonBooleanMultiPolygon
): number | null {
  const firstRings = allRings(first);
  const secondRings = allRings(second);
  let best = Infinity;
  for (const a of firstRings) {
    for (const b of secondRings) {
      const distance = ringRingDistance(a, b);
      if (distance === null) {
        return null;
      }
      if (distance < best) {
        best = distance;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** nonzero 点内测试（对全部 outer+holes 累积绕数）。 */
function pointInMulti(point: Point, multi: PolygonBooleanMultiPolygon): boolean {
  return hitTestNonzeroRings(allRings(multi), point, 0);
}

function expandBounds(bounds: Bounds, padding: number): Bounds | null {
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const maxX = bounds.maxX + padding;
  const maxY = bounds.maxY + padding;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function boundsContainPoint(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

function pointsBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

/** piece 采样点：所有环的顶点 + 相邻段中点（用于 contains 边界/hole/退化线判定）。 */
function pieceSamplePoints(piece: PreparedPiece): readonly Point[] {
  const samples: Point[] = [];
  for (const ring of allRings(piece.polygons)) {
    for (const point of ring) {
      samples.push(point);
    }
    if (ring.length >= 2) {
      for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index]!;
        const b = ring[(index + 1) % ring.length]!;
        const midX = a.x / 2 + b.x / 2;
        const midY = a.y / 2 + b.y / 2;
        if (Number.isFinite(midX) && Number.isFinite(midY)) {
          samples.push(Object.freeze({ x: midX, y: midY }));
        }
      }
    }
  }
  return samples;
}

/** piece 所有环的顶点总数（预算用）。 */
function countPieceVertices(pieces: readonly PreparedPiece[]): number {
  let total = 0;
  for (const piece of pieces) {
    for (const ring of allRings(piece.polygons)) {
      total += ring.length;
    }
  }
  return total;
}

/** 冻结 piece 的 polygons（caller 数据不可变）。 */
function freezePiece(
  ringsInput: readonly PolygonRing[],
  holesOf?: readonly (readonly PolygonRing[])[]
): PreparedPiece {
  const polygons: PolygonBooleanPolygon[] = ringsInput.map((outer, index) =>
    Object.freeze({ outer, holes: Object.freeze((holesOf?.[index] ?? []).slice()) })
  );
  return Object.freeze({ polygons: Object.freeze(polygons) });
}

// ---------------------------------------------------------------------------
// piece 命中判定（返回 true/false，或 null 表示 geometry-failed）
// ---------------------------------------------------------------------------

type PieceHit = boolean | null;

function pieceIsDegenerate(piece: PreparedPiece): boolean {
  const rings = allRings(piece.polygons);
  return rings.length === 0 || rings.every((ring) => ring.length < 3);
}

/** path 相邻段。 */
function pathSegments(path: readonly Point[]): ReadonlyArray<readonly [Point, Point]> {
  const segments: Array<readonly [Point, Point]> = [];
  for (let index = 0; index + 1 < path.length; index += 1) {
    segments.push([path[index]!, path[index + 1]!]);
  }
  return segments;
}

/** path（点 + 段）到 piece 边界的最小距离。 */
function pathMultiDistance(
  path: readonly Point[],
  multi: PolygonBooleanMultiPolygon
): number | null {
  let best = Infinity;
  for (const point of path) {
    const distance = pointMultiDistance(point, multi);
    if (distance === null) {
      return null;
    }
    if (distance < best) {
      best = distance;
    }
  }
  for (const [a, b] of pathSegments(path)) {
    for (const ring of allRings(multi)) {
      for (const [c, d] of ringSegments(ring)) {
        const distance = segmentSegmentDistance(a, b, c, d);
        if (distance === null) {
          return null;
        }
        if (distance < best) {
          best = distance;
        }
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** 点命中：region nonzero 内，或到所有边界距离 <= tolerance+margin。 */
function pointPieceHit(
  piece: PreparedPiece,
  point: Point,
  tolerance: number,
  margin: number
): PieceHit {
  if (pointInMulti(point, piece.polygons)) {
    return true;
  }
  const distance = pointMultiDistance(point, piece.polygons);
  if (distance === null) {
    return null;
  }
  return distance <= tolerance + margin;
}

/** 扫掠命中：端点/段与 region 相交，或到边界距离 <= radius+margin。 */
function sweepPieceHit(
  piece: PreparedPiece,
  path: readonly Point[],
  radius: number,
  margin: number
): PieceHit {
  for (const point of path) {
    if (pointInMulti(point, piece.polygons)) {
      return true;
    }
  }
  for (const [a, b] of pathSegments(path)) {
    for (const ring of allRings(piece.polygons)) {
      for (const [c, d] of ringSegments(ring)) {
        const intersects = segmentsIntersect(a, b, c, d);
        if (intersects === null) {
          return null;
        }
        if (intersects) {
          return true;
        }
      }
    }
  }
  const distance = pathMultiDistance(path, piece.polygons);
  if (distance === null) {
    return null;
  }
  return distance <= radius + margin;
}

/** lasso intersects：polyclip 区域相交非空，或边界接触/最近距离 <= margin，或任一包含。 */
function pieceIntersectsLasso(
  piece: PreparedPiece,
  lasso: PolygonBooleanMultiPolygon,
  margin: number
): PieceHit {
  if (!pieceIsDegenerate(piece)) {
    try {
      const result = fromPolyclip(intersection(multiToGeom(piece.polygons), multiToGeom(lasso)));
      if (!result) {
        return null;
      }
      if (!isMultiEmpty(result)) {
        return true;
      }
    } catch {
      return null;
    }
  }
  for (const sample of pieceSamplePoints(piece)) {
    if (pointInMulti(sample, lasso)) {
      return true;
    }
  }
  for (const ring of allRings(lasso)) {
    for (const point of ring) {
      if (pointInMulti(point, piece.polygons)) {
        return true;
      }
    }
  }
  const distance = multiMultiDistance(piece.polygons, lasso);
  if (distance === null) {
    return null;
  }
  return distance <= margin;
}

/**
 * lasso contains piece：
 * - 非退化 piece 用 `difference(piece, lasso)` 为空证明完全包含（含 lasso hole 穿出检测）。
 * - 全部采样点（顶点 + 段中点，覆盖退化线）在 lasso 内。
 * - shape 额外要求边界距 lasso 边界 >= clearance（保守）。
 */
function pieceContainedInLasso(
  piece: PreparedPiece,
  lasso: PolygonBooleanMultiPolygon,
  clearance: number
): PieceHit {
  if (!pieceIsDegenerate(piece)) {
    try {
      const leftover = fromPolyclip(difference(multiToGeom(piece.polygons), multiToGeom(lasso)));
      if (!leftover) {
        return null;
      }
      if (!isMultiEmpty(leftover)) {
        return false;
      }
    } catch {
      return null;
    }
  }
  for (const sample of pieceSamplePoints(piece)) {
    if (!pointInMulti(sample, lasso)) {
      return false;
    }
  }
  if (clearance > 0) {
    const distance = multiMultiDistance(piece.polygons, lasso);
    if (distance === null) {
      return null;
    }
    if (distance < clearance) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// prepare：schema3 校验 + 每对象真实几何编译
// ---------------------------------------------------------------------------

const ADAPTIVE_CODES: readonly string[] = ['invalid-input', 'geometry-failed', 'budget-exceeded'];

function mapAdaptiveCode(code: string): LayeredObjectQueryErrorCode {
  return ADAPTIVE_CODES.includes(code) ? (code as LayeredObjectQueryErrorCode) : 'geometry-failed';
}

/** 冻结世界环；相邻重复末点去掉形成闭合环。 */
function freezeRing(points: readonly Point[]): PolygonRing | null {
  const frozen: Point[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    frozen.push(Object.freeze({ x: point.x, y: point.y }));
  }
  if (frozen.length > 1) {
    const first = frozen[0]!;
    const last = frozen[frozen.length - 1]!;
    if (first.x === last.x && first.y === last.y) {
      frozen.pop();
    }
  }
  return Object.freeze(frozen);
}

function transformRing(ring: readonly Point[], transform: AffineTransform): PolygonRing | null {
  const mapped: Point[] = [];
  for (const point of ring) {
    const world = applyAffine(transform, point);
    if (!world) {
      return null;
    }
    mapped.push(world);
  }
  return freezeRing(mapped);
}

type EllipseCorners = Readonly<{ cx: number; cy: number; rx: number; ry: number }>;

function ellipseFromCorners(points: readonly Point[]): EllipseCorners | null {
  if (points.length !== 2) {
    return null;
  }
  const [first, second] = points as readonly [Point, Point];
  const cx = first.x / 2 + second.x / 2;
  const cy = first.y / 2 + second.y / 2;
  const rx = Math.abs(second.x - first.x) / 2;
  const ry = Math.abs(second.y - first.y) / 2;
  if (![cx, cy, rx, ry].every(Number.isFinite)) {
    return null;
  }
  return Object.freeze({ cx, cy, rx, ry });
}

/** local segment 的 local 半宽矩形（zero len 返回 null）→ 变换 world 四边形。 */
function localSegmentRect(
  first: Point,
  second: Point,
  halfWidth: number,
  transform: AffineTransform
): PolygonRing | null {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) {
    return null;
  }
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;
  const localRing: Point[] = [
    { x: first.x + nx, y: first.y + ny },
    { x: first.x - nx, y: first.y - ny },
    { x: second.x - nx, y: second.y - ny },
    { x: second.x + nx, y: second.y + ny },
  ];
  return transformRing(localRing, transform);
}

function centerlineSegments(
  localPoints: readonly Point[],
  closed: boolean
): ReadonlyArray<readonly [Point, Point]> {
  const segments: Array<readonly [Point, Point]> = [];
  for (let index = 0; index + 1 < localPoints.length; index += 1) {
    segments.push([localPoints[index]!, localPoints[index + 1]!]);
  }
  if (closed && localPoints.length >= 2) {
    segments.push([localPoints[localPoints.length - 1]!, localPoints[0]!]);
  }
  return segments;
}

/** world 顶点 local 圆盘（flattenLayeredEllipse vertex,r,r）→ world 环。 */
function vertexDisc(
  vertex: Point,
  halfWidth: number,
  transform: AffineTransform
): PolygonRing | null {
  const flat = flattenLayeredEllipse(vertex, halfWidth, halfWidth, transform, 0, Math.PI * 2);
  if (!flat.ok) {
    return null;
  }
  return freezeRing(flat.value.worldPoints);
}

function entryFrom(
  object: DocumentObject,
  order: number,
  margin: number,
  pieces: readonly PreparedPiece[],
  broadphase: Bounds
): PreparedEntry {
  return Object.freeze({
    objectId: object.objectId,
    objectRevision: object.objectRevision,
    transformRevision: object.transformRevision,
    kind: object.kind,
    order,
    margin,
    pieces: Object.freeze(pieces),
    broadphase,
  });
}

/** image/text：localBounds 四角 world 精确四边形。 */
function buildBoundsQuadEntry(
  object: DocumentObject,
  order: number,
  cache: FreehandGeometryCache
): LayeredObjectQueryResult<PreparedEntry> {
  const bounds = (object as { localBounds: Bounds }).localBounds;
  const localRing: Point[] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
  const ring = transformRing(localRing, object.transform);
  if (!ring) {
    return err('geometry-failed');
  }
  const worldBounds = deriveLayeredWorldBounds(object, cache);
  if (!worldBounds) {
    return err('geometry-failed');
  }
  return ok(entryFrom(object, order, 0, [freezePiece([ring])], worldBounds.visualWorldBounds));
}

/** freehand：PF final 实际 transformedPolygon（无中心线 fallback）。 */
function buildFreehandEntry(
  object: DocumentObject,
  order: number,
  cache: FreehandGeometryCache
): LayeredObjectQueryResult<PreparedEntry> {
  let presentation: FreehandPresentation;
  try {
    presentation = cache.getPresentation(object as FreehandObject, 'final');
  } catch {
    return err('geometry-failed');
  }
  const polygon = presentation.transformedPolygon;
  const bounds = presentation.worldBounds;
  if (
    !Array.isArray(polygon) ||
    !polygon.length ||
    !bounds ||
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
  )
    return err('geometry-failed');
  // The cache owns deeply frozen world points. Borrow them instead of copying
  // tens of thousands of immutable vertices on the first release. A custom
  // mutable cache still takes the defensive copy path used by the public API.
  let ring: PolygonRing | null;
  if (Object.isFrozen(polygon) && polygon.every((p) => Object.isFrozen(p) && isFinitePoint(p))) {
    const first = polygon[0]!,
      last = polygon[polygon.length - 1]!;
    ring =
      polygon.length > 1 && first.x === last.x && first.y === last.y
        ? Object.freeze(polygon.slice(0, -1))
        : polygon;
  } else ring = freezeRing(polygon);
  if (!ring) return err('geometry-failed');
  return ok(entryFrom(object, order, 0, [freezePiece([ring])], Object.freeze({ ...bounds })));
}

/** shape：中心线粗描边 pieces（矩形 + 顶点圆盘）+ 可选 fill region。 */
function buildShapeEntry(
  object: DocumentObject,
  order: number,
  cache: FreehandGeometryCache
): LayeredObjectQueryResult<PreparedEntry> {
  const shape = object as Extract<DocumentObject, { kind: 'shape' }>;
  if (!deriveShapeGeometry(shape)) {
    return err('geometry-failed');
  }
  const halfWidth = shape.style.width / 2;
  const transform = shape.transform;

  let localPoints: readonly Point[];
  let closed: boolean;
  if (shape.shapeType === 'bezier') {
    const flat = flattenLayeredCubic(shape.points, transform);
    if (!flat.ok) {
      return err(mapAdaptiveCode(flat.error.code));
    }
    localPoints = flat.value.localPoints;
    closed = false;
  } else if (shape.shapeType === 'ellipse') {
    const corners = ellipseFromCorners(shape.points);
    if (!corners) {
      return err('geometry-failed');
    }
    const flat = flattenLayeredEllipse(
      { x: corners.cx, y: corners.cy },
      corners.rx,
      corners.ry,
      transform,
      0,
      Math.PI * 2
    );
    if (!flat.ok) {
      return err(mapAdaptiveCode(flat.error.code));
    }
    localPoints = flat.value.localPoints;
    closed = true;
  } else if (shape.shapeType === 'line') {
    if (shape.points.length !== 2) {
      return err('geometry-failed');
    }
    localPoints = shape.points;
    closed = false;
  } else if (shape.shapeType === 'rect') {
    if (shape.points.length !== 2) {
      return err('geometry-failed');
    }
    const [first, second] = shape.points as readonly [Point, Point];
    localPoints = Object.freeze([
      Object.freeze({ x: first.x, y: first.y }),
      Object.freeze({ x: second.x, y: first.y }),
      Object.freeze({ x: second.x, y: second.y }),
      Object.freeze({ x: first.x, y: second.y }),
    ]);
    closed = true;
  } else {
    if (shape.points.length < 3) {
      return err('geometry-failed');
    }
    localPoints = shape.points;
    closed = true;
  }

  const pieces: PreparedPiece[] = [];
  for (const [first, second] of centerlineSegments(localPoints, closed)) {
    const ring = localSegmentRect(first, second, halfWidth, transform);
    if (ring === null) {
      continue; // 零长度段忽略。
    }
    pieces.push(freezePiece([ring]));
  }
  for (const vertex of localPoints) {
    const disc = vertexDisc(vertex, halfWidth, transform);
    if (!disc) {
      return err('geometry-failed');
    }
    pieces.push(freezePiece([disc]));
  }

  // fill：仅 rect/ellipse/polygon 且 style.fill !== undefined，来自同一中心线闭合环 nonzero。
  const fillable =
    shape.shapeType === 'rect' || shape.shapeType === 'ellipse' || shape.shapeType === 'polygon';
  if (fillable && shape.style.fill !== undefined) {
    const worldRing = transformRing(localPoints, transform);
    if (!worldRing) {
      return err('geometry-failed');
    }
    const canonical = canonicalizeClosedRing(worldRing);
    if (!canonical.ok) {
      return err('geometry-failed');
    }
    pieces.push(Object.freeze({ polygons: canonical.polygons }));
  }

  if (countPieceVertices(pieces) > MAX_TOTAL_VERTICES) {
    return err('budget-exceeded');
  }

  const worldBounds = deriveLayeredWorldBounds(object, cache);
  if (!worldBounds) {
    return err('geometry-failed');
  }
  return ok(entryFrom(object, order, SHAPE_ERROR_MARGIN, pieces, worldBounds.visualWorldBounds));
}

/**
 * 预处理：完整 schema3 校验 + 逐对象原子编译几何。
 * 任一对象非法 → invalid-document；几何/缓存失败 → geometry-failed；预算 → budget-exceeded。
 */
export function prepareLayeredObjectQuery(
  document: EditorDocument,
  cache: FreehandGeometryCache
): LayeredObjectQueryResult<PreparedLayeredObjectQuery> {
  if (!isRecord(document)) {
    return err('invalid-input');
  }
  if (!cache || typeof (cache as { getPresentation?: unknown }).getPresentation !== 'function') {
    return err('invalid-input');
  }
  const read = readLayeredDocument(document);
  if (!read.ok) {
    return err('invalid-document');
  }
  return compileObjectQuery(read.value, cache).step(() => 0, Infinity)!;
}

/** Internal: controller snapshots are already validated, owned and deeply frozen.
 * Keep their sample identities so rendering and queries share the same geometry.
 * The public raw-document API above still validates and copies untrusted input.
 */
export function createControllerObjectQuery(
  controller: LayeredEditorController,
  cache: FreehandGeometryCache
) {
  return compileObjectQuery(controller.getSnapshot('document'), cache);
}

function compileObjectQuery(document: EditorDocument, cache: FreehandGeometryCache) {
  const entries: PreparedEntry[] = [];
  let order = 0;
  let result: LayeredObjectQueryResult<PreparedLayeredObjectQuery> | null = null;
  return {
    step(
      now: () => number,
      budgetMs = 4
    ): LayeredObjectQueryResult<PreparedLayeredObjectQuery> | null {
      if (result) return result;
      const start = now();
      do {
        if (order === document.objects.length) {
          return (result = ok(
            Object.freeze({
              documentRevision: document.documentRevision,
              entries: Object.freeze(entries),
            })
          ));
        }
        const object = document.objects[order]!;
        const built =
          object.kind === 'freehand'
            ? buildFreehandEntry(object, order, cache)
            : object.kind === 'shape'
              ? buildShapeEntry(object, order, cache)
              : buildBoundsQuadEntry(object, order, cache);
        if (!built.ok) return (result = err(built.error.code));
        entries.push(built.value);
        order++;
      } while (now() - start < budgetMs);
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// 查询：point / sweep / lasso
// ---------------------------------------------------------------------------

function isPreparedQuery(value: unknown): value is PreparedLayeredObjectQuery {
  if (!isRecord(value)) {
    return false;
  }
  return Number.isFinite(value.documentRevision) && Array.isArray(value.entries);
}

function makeHit(entry: PreparedEntry): LayeredObjectQueryHit {
  return Object.freeze({
    objectId: entry.objectId,
    objectRevision: entry.objectRevision,
    transformRevision: entry.transformRevision,
    kind: entry.kind,
    order: entry.order,
  });
}

const multiBoundsCache = new WeakMap<PolygonBooleanMultiPolygon, Bounds>();
function multiBounds(multi: PolygonBooleanMultiPolygon): Bounds | null {
  const cached = multiBoundsCache.get(multi);
  if (cached) return cached;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of allRings(multi))
    for (const p of ring) {
      if (!isFinitePoint(p)) return null;
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  if (!Number.isFinite(bounds.minX)) return null;
  multiBoundsCache.set(multi, bounds);
  return bounds;
}

/** 是否全部点共线（用差值 cross；非有限按非共线处理避免误拒）。 */
function isCollinearRing(ring: PolygonRing): boolean {
  const origin = ring[0]!;
  let direction: Point | undefined;
  for (let index = 1; index < ring.length; index += 1) {
    const candidate = ring[index]!;
    if (candidate.x !== origin.x || candidate.y !== origin.y) {
      direction = candidate;
      break;
    }
  }
  if (!direction) {
    return true;
  }
  const dx = direction.x - origin.x;
  const dy = direction.y - origin.y;
  for (const point of ring) {
    const cross = dx * (point.y - origin.y) - dy * (point.x - origin.x);
    if (!Number.isFinite(cross)) {
      return false;
    }
    if (cross !== 0) {
      return false;
    }
  }
  return true;
}

/** 点命中：region 内或到边界距离 <= tolerance+margin。 */
export function queryObjectPoint(
  prepared: PreparedLayeredObjectQuery,
  worldPoint: Point,
  tolerance: number
): LayeredObjectQueryResult<readonly LayeredObjectQueryHit[]> {
  if (!isPreparedQuery(prepared)) {
    return err('invalid-input');
  }
  if (!isFinitePoint(worldPoint)) {
    return err('invalid-input');
  }
  if (!isFiniteNumber(tolerance) || tolerance < 0) {
    return err('invalid-input');
  }
  const hits: LayeredObjectQueryHit[] = [];
  for (const entry of prepared.entries) {
    const expanded = expandBounds(entry.broadphase, tolerance + entry.margin);
    if (!expanded) {
      return err('geometry-failed');
    }
    if (!boundsContainPoint(expanded, worldPoint)) {
      continue;
    }
    for (const piece of entry.pieces) {
      const hit = pointPieceHit(piece, worldPoint, tolerance, entry.margin);
      if (hit === null) {
        return err('geometry-failed');
      }
      if (hit) {
        hits.push(makeHit(entry));
        break;
      }
    }
  }
  return ok(Object.freeze(hits));
}

/** 扫掠命中：path 点/段与 region 相交，或到边界距离 <= radius+margin。 */
export function queryObjectSweep(
  prepared: PreparedLayeredObjectQuery,
  fullWorldPath: readonly Point[],
  radius: number
): LayeredObjectQueryResult<readonly LayeredObjectQueryHit[]> {
  if (!isPreparedQuery(prepared)) {
    return err('invalid-input');
  }
  if (!Array.isArray(fullWorldPath) || fullWorldPath.length < 1) {
    return err('invalid-input');
  }
  for (const point of fullWorldPath) {
    if (!isFinitePoint(point)) {
      return err('invalid-input');
    }
  }
  if (!isFiniteNumber(radius) || radius < 0) {
    return err('invalid-input');
  }
  const pathBounds = pointsBounds(fullWorldPath);
  if (!pathBounds) {
    return err('geometry-failed');
  }
  const hits: LayeredObjectQueryHit[] = [];
  for (const entry of prepared.entries) {
    const entryBounds = expandBounds(entry.broadphase, radius + entry.margin);
    const sweptPathBounds = expandBounds(pathBounds, radius + entry.margin);
    if (!entryBounds || !sweptPathBounds) {
      return err('geometry-failed');
    }
    if (!boundsOverlap(entryBounds, sweptPathBounds)) {
      continue;
    }
    for (const piece of entry.pieces) {
      const hit = sweepPieceHit(piece, fullWorldPath, radius, entry.margin);
      if (hit === null) {
        return err('geometry-failed');
      }
      if (hit) {
        hits.push(makeHit(entry));
        break;
      }
    }
  }
  return ok(Object.freeze(hits));
}

/**
 * lasso 查询。mode 非法 → invalid-input（不静默返回空）。
 * - intersects：polyclip 区域相交非空 / 边界接触 / 距离 <= margin / 任一包含。
 * - contains：`difference(piece,lasso)` 为空 + 采样点在内 + shape 额外 .25 clearance。
 */
export function queryObjectLasso(
  prepared: PreparedLayeredObjectQuery,
  worldPolygon: readonly Point[],
  mode: 'intersects' | 'contains'
): LayeredObjectQueryResult<readonly LayeredObjectQueryHit[]> {
  if (!isPreparedQuery(prepared)) {
    return err('invalid-input');
  }
  if (mode !== 'intersects' && mode !== 'contains') {
    return err('invalid-input');
  }
  if (!Array.isArray(worldPolygon) || worldPolygon.length < 3) {
    return err('invalid-input');
  }
  for (const point of worldPolygon) {
    if (!isFinitePoint(point)) {
      return err('invalid-input');
    }
  }
  const ring = freezeRing(worldPolygon);
  if (!ring || ring.length < 3 || isCollinearRing(ring)) {
    return err('invalid-input');
  }
  const canonical = canonicalizeClosedRing(ring);
  if (!canonical.ok) {
    return err('geometry-failed');
  }
  const lasso = canonical.polygons;
  const lassoBounds = multiBounds(lasso);
  if (!lassoBounds) {
    return err('geometry-failed');
  }

  const hits: LayeredObjectQueryHit[] = [];
  for (const entry of prepared.entries) {
    const expanded = expandBounds(entry.broadphase, entry.margin);
    if (!expanded) {
      return err('geometry-failed');
    }
    if (!boundsOverlap(expanded, lassoBounds)) {
      continue;
    }
    let matched: boolean;
    if (mode === 'contains') {
      matched = true;
      for (const piece of entry.pieces) {
        const contained = pieceContainedInLasso(piece, lasso, entry.margin);
        if (contained === null) {
          return err('geometry-failed');
        }
        if (!contained) {
          matched = false;
          break;
        }
      }
    } else {
      matched = false;
      for (const piece of entry.pieces) {
        const intersects = pieceIntersectsLasso(piece, lasso, entry.margin);
        if (intersects === null) {
          return err('geometry-failed');
        }
        if (intersects) {
          matched = true;
          break;
        }
      }
    }
    if (matched) {
      hits.push(makeHit(entry));
    }
  }
  return ok(Object.freeze(hits));
}

// The synchronous query above remains the reference implementation. These helpers
// share its exact pieces, margins and fallback predicates, with bounded live work.
type LassoBoundsNode = {
  bounds: Bounds;
  entries?: readonly PreparedEntry[];
  left?: LassoBoundsNode;
  right?: LassoBoundsNode;
};
const lassoIndexes = new WeakMap<PreparedLayeredObjectQuery, LassoBoundsNode>();
function buildLassoIndex(entries: readonly PreparedEntry[]): LassoBoundsNode {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const entry of entries) {
    bounds.minX = Math.min(bounds.minX, entry.broadphase.minX - entry.margin);
    bounds.minY = Math.min(bounds.minY, entry.broadphase.minY - entry.margin);
    bounds.maxX = Math.max(bounds.maxX, entry.broadphase.maxX + entry.margin);
    bounds.maxY = Math.max(bounds.maxY, entry.broadphase.maxY + entry.margin);
  }
  if (entries.length <= 16) return { bounds, entries };
  const axis = bounds.maxX - bounds.minX > bounds.maxY - bounds.minY ? 'minX' : 'minY';
  const sorted = [...entries].sort((a, b) => a.broadphase[axis] - b.broadphase[axis]);
  const middle = Math.floor(sorted.length / 2);
  return {
    bounds,
    left: buildLassoIndex(sorted.slice(0, middle)),
    right: buildLassoIndex(sorted.slice(middle)),
  };
}
function lassoCandidates(prepared: PreparedLayeredObjectQuery, bounds: Bounds) {
  if (!prepared.entries.length) return [];
  let root = lassoIndexes.get(prepared);
  if (!root) {
    root = buildLassoIndex(prepared.entries);
    lassoIndexes.set(prepared, root);
  }
  const candidates: PreparedEntry[] = [];
  const visit = (node: LassoBoundsNode) => {
    if (!boundsOverlap(node.bounds, bounds)) return;
    if (node.entries) {
      for (const entry of node.entries) {
        const expanded = expandBounds(entry.broadphase, entry.margin);
        if (!expanded || boundsOverlap(expanded, bounds)) candidates.push(entry);
      }
    } else {
      visit(node.left!);
      visit(node.right!);
    }
  };
  visit(root);
  return candidates.sort((a, b) => a.order - b.order);
}

// Canonicalization of self-touching/overlapping input can produce touching
// components and holes whose boolean interpretation differs from winding over
// all rings (seed 245, trajectory 9180). Bounds remain a conservative filter;
// line separation alone cannot exclude the reference boolean's interior hit.
const referenceCanonicalLassos = new WeakSet<PolygonBooleanMultiPolygon>();

// A proven simple ring already is a nonzero polygon. Complex/touching rings
// still use the original boolean canonicalizer; no trajectory simplification.
function canonicalLasso(ring: PolygonRing): ReturnType<typeof canonicalizeClosedRing> {
  const edges = ring
    .map((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      return {
        a,
        b,
        i,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      };
    })
    .sort((a, b) => a.minX - b.minX);
  let active: typeof edges = [];
  for (const edge of edges) {
    active = active.filter((other) => other.maxX >= edge.minX);
    const { a, b, i } = edge;
    for (const other of active) {
      const { a: c, b: d, i: j } = other;
      if (
        Math.abs(i - j) === 1 ||
        Math.abs(i - j) === ring.length - 1 ||
        edge.maxY < other.minY ||
        other.maxY < edge.minY
      )
        continue;
      const o1 = orient2d(a.x, a.y, b.x, b.y, c.x, c.y),
        o2 = orient2d(a.x, a.y, b.x, b.y, d.x, d.y);
      const o3 = orient2d(c.x, c.y, d.x, d.y, a.x, a.y),
        o4 = orient2d(c.x, c.y, d.x, d.y, b.x, b.y);
      if (
        ![o1, o2, o3, o4].every(Number.isFinite) ||
        ((o1 === 0 || o2 === 0 || o1 > 0 !== o2 > 0) && (o3 === 0 || o4 === 0 || o3 > 0 !== o4 > 0))
      ) {
        const canonical = canonicalizeClosedRing(ring);
        if (canonical.ok) referenceCanonicalLassos.add(canonical.polygons);
        return canonical;
      }
    }
    active.push(edge);
  }
  return { ok: true, polygons: [{ outer: ring, holes: [] }] };
}

// Outward rounding encloses the error of each basic operation, including
// subnormals. Non-finite arithmetic cannot certify separation. These intervals
// deliberately retain uncertain floating boundary cases for the old boolean.
type Interval = readonly [number, number];
function outward(value: number): Interval {
  if (!Number.isFinite(value)) return [-Infinity, Infinity];
  const error = Math.max(Number.MIN_VALUE, Math.abs(value) * Number.EPSILON);
  return [value - error, value + error];
}
function subtractInterval(a: Interval, b: Interval): Interval {
  return [outward(a[0] - b[1])[0], outward(a[1] - b[0])[1]];
}
function multiplyInterval(a: Interval, b: Interval): Interval {
  const products = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  if (!products.every(Number.isFinite)) return [-Infinity, Infinity];
  return [outward(Math.min(...products))[0], outward(Math.max(...products))[1]];
}
function lineMissesExpandedEdgeBox(
  c: Point,
  d: Point,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  margin: number
): boolean {
  const x = [outward(minX - margin)[0], outward(maxX + margin)[1]];
  const y = [outward(minY - margin)[0], outward(maxY + margin)[1]];
  const dx = subtractInterval([d.x, d.x], [c.x, c.x]);
  const dy = subtractInterval([d.y, d.y], [c.y, c.y]);
  let positive = true;
  let negative = true;
  for (const px of x)
    for (const py of y) {
      const side = subtractInterval(
        multiplyInterval(dx, subtractInterval([py, py], [c.y, c.y])),
        multiplyInterval(dy, subtractInterval([px, px], [c.x, c.x]))
      );
      positive &&= side[0] > 0;
      negative &&= side[1] < 0;
    }
  // A linear function has its extrema at box corners. Strictly same-side
  // corners prove even the infinite line misses the expanded edge box.
  return positive || negative;
}

// Preserve the reference segment predicate (including its degenerate behavior)
// before bounds rejection. A negative distance result with overlapping edge
// bounds still needs the reference boolean check for floating boundary cases.
function withinLassoMargin(
  piece: PreparedPiece,
  lasso: PolygonBooleanMultiPolygon,
  margin: number
): PieceHit | 'overlapping-bounds' {
  let overlappingBounds = false;
  const allowLineProof = !referenceCanonicalLassos.has(lasso);
  // Each object's actual edges are indexed once and reused across lassos.
  // A lasso line can reject an entire object-edge subtree with one old-predicate
  // interval check; keep ambiguous/collinear leaves for the original predicate.
  const root = lassoEdgeIndex(piece.polygons);
  if (!root) return null;
  const stack: EdgeNode[] = [];
  for (const ring of allRings(lasso)) {
    if (ring.length < 2) return null;
    for (let j = 0; j < ring.length; j++) {
      const c = ring[j]!,
        d = ring[(j + 1) % ring.length]!;
      const ex = d.x - c.x,
        ey = d.y - c.y;
      const cx = Math.min(c.x, d.x),
        cy = Math.min(c.y, d.y),
        exx = Math.max(c.x, d.x),
        eyy = Math.max(c.y, d.y);
      const pruneSafe =
        Math.max(
          Math.abs(c.x),
          Math.abs(c.y),
          Math.abs(d.x),
          Math.abs(d.y),
          Math.abs(root.bounds.minX),
          Math.abs(root.bounds.minY),
          Math.abs(root.bounds.maxX),
          Math.abs(root.bounds.maxY)
        ) <= 1e150;
      stack.push(root);
      while (stack.length) {
        const node = stack.pop()!,
          box = node.bounds;
        const disjoint =
          cx > box.maxX + margin ||
          box.minX > exx + margin ||
          cy > box.maxY + margin ||
          box.minY > eyy + margin;
        // This bounds the old o3*o4 expression, including product underflow.
        if (disjoint && pruneSafe && sameSideBox(c, d, box)) continue;
        if (!node.edges) {
          stack.push(node.right!, node.left!);
          continue;
        }
        for (const { a, b, minX, minY, maxX, maxY } of node.edges) {
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const o1 = dx * (c.y - a.y) - dy * (c.x - a.x),
            o2 = dx * (d.y - a.y) - dy * (d.x - a.x);
          const o3 = ex * (a.y - c.y) - ey * (a.x - c.x),
            o4 = ex * (b.y - c.y) - ey * (b.x - c.x);
          if (
            !Number.isFinite(o1) ||
            !Number.isFinite(o2) ||
            !Number.isFinite(o3) ||
            !Number.isFinite(o4)
          )
            return null;
          if (o1 * o2 <= 0 && o3 * o4 <= 0) return true;
          if (
            minX > exx + margin ||
            cx > maxX + margin ||
            minY > eyy + margin ||
            cy > maxY + margin
          )
            continue;
          const distance = segmentSegmentDistance(a, b, c, d);
          if (distance === null) return null;
          if (distance <= margin) return true;
          if (
            !overlappingBounds &&
            (!allowLineProof ||
              (!lineMissesExpandedEdgeBox(c, d, minX, minY, maxX, maxY, margin) &&
                !lineMissesExpandedEdgeBox(a, b, cx, cy, exx, eyy, margin)))
          )
            overlappingBounds = true;
        }
      }
    }
  }
  return overlappingBounds ? 'overlapping-bounds' : false;
}

type LassoEdge = { a: Point; b: Point; minY: number; maxY: number; minX: number; maxX: number };
type EdgeNode = { bounds: Bounds; edges?: LassoEdge[]; left?: EdgeNode; right?: EdgeNode };
const edgeIndexes = new WeakMap<PolygonBooleanMultiPolygon, EdgeNode>();
function lassoEdgeIndex(multi: PolygonBooleanMultiPolygon): EdgeNode | null {
  const old = edgeIndexes.get(multi);
  if (old) return old;
  const edges: LassoEdge[] = [];
  for (const ring of allRings(multi))
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      edges.push({
        a,
        b,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      });
    }
  if (!edges.length) return null;
  const build = (edges: LassoEdge[]): EdgeNode => {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const e of edges) {
      bounds.minX = Math.min(bounds.minX, e.minX);
      bounds.minY = Math.min(bounds.minY, e.minY);
      bounds.maxX = Math.max(bounds.maxX, e.maxX);
      bounds.maxY = Math.max(bounds.maxY, e.maxY);
    }
    if (edges.length <= 4) return { bounds, edges };
    const axis = bounds.maxX - bounds.minX > bounds.maxY - bounds.minY ? 'minX' : 'minY';
    edges.sort((a, b) => a[axis] - b[axis]);
    const mid = edges.length >> 1;
    return { bounds, left: build(edges.slice(0, mid)), right: build(edges.slice(mid)) };
  };
  const root = build(edges);
  edgeIndexes.set(multi, root);
  return root;
}

// Interval evaluation of the *old floating expression*, not a new orientation
// predicate. Each rounded operation is monotone, so endpoint evaluations bound
// all endpoints in this node. Also exclude product underflow and infinities.
function sameSideBox(a: Point, b: Point, box: Bounds): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const lowY = box.minY - a.y,
    highY = box.maxY - a.y,
    lowX = box.minX - a.x,
    highX = box.maxX - a.x;
  const p = dx * (dx >= 0 ? lowY : highY),
    q = dx * (dx >= 0 ? highY : lowY);
  const r = dy * (dy >= 0 ? lowX : highX),
    s = dy * (dy >= 0 ? highX : lowX);
  const low = p - s,
    high = q - r;
  return (
    Number.isFinite(low) &&
    Number.isFinite(high) &&
    ((low > 0 && low * low > 0) || (high < 0 && high * high > 0))
  );
}

type PointTest = { bounds: Bounds; rows: readonly (readonly LassoEdge[])[]; height: number };
const pointTests = new WeakMap<PolygonBooleanMultiPolygon, PointTest>();
function fastPointInMulti(point: Point, multi: PolygonBooleanMultiPolygon) {
  const bounds = multiBounds(multi);
  if (
    !bounds ||
    point.x < bounds.minX ||
    point.x > bounds.maxX ||
    point.y < bounds.minY ||
    point.y > bounds.maxY
  )
    return false;
  let test = pointTests.get(multi);
  if (!test) {
    const height = (bounds.maxY - bounds.minY) / 64;
    const rows: LassoEdge[][] = Array.from({ length: 64 }, () => []);
    for (const ring of allRings(multi))
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        const edge = {
          a,
          b,
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y),
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
        };
        const first = height > 0 ? Math.min(63, Math.floor((edge.minY - bounds.minY) / height)) : 0;
        const last = height > 0 ? Math.min(63, Math.floor((edge.maxY - bounds.minY) / height)) : 0;
        for (let row = first; row <= last; row++) rows[row]!.push(edge);
      }
    test = { bounds, rows, height };
    pointTests.set(multi, test);
  }
  const { rows, height } = test;
  const edges = rows[height > 0 ? Math.min(63, Math.floor((point.y - bounds.minY) / height)) : 0]!;
  let winding = 0;
  for (const { a, b, minY, maxY, minX, maxX } of edges) {
    if (point.y < minY || point.y > maxY) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      lengthSquared = dx * dx + dy * dy;
    if (!Number.isFinite(lengthSquared) || lengthSquared === 0) continue;
    if (point.x >= minX && point.x <= maxX) {
      const progress = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)
      );
      const x = point.x - (a.x + dx * progress),
        y = point.y - (a.y + dy * progress);
      if (x * x + y * y <= 0) return true;
    }
    const side = orient2d(a.x, a.y, b.x, b.y, point.x, point.y);
    if (a.y <= point.y) {
      if (b.y > point.y && side > 0) winding++;
    } else if (b.y <= point.y && side < 0) winding--;
  }
  return winding !== 0;
}

function fastPieceIntersectsLasso(
  piece: PreparedPiece,
  lasso: PolygonBooleanMultiPolygon,
  margin: number,
  fallback?: (reason: 'overlapping-bounds' | 'indeterminate') => PieceHit
): PieceHit {
  // Positive containment/contact checks avoid constructing an intersection.
  // A negative fast result with overlapping edge bounds is not conclusive:
  // boolean clipping can retain a
  // boundary intersection lost by the point/distance predicates after floating
  // point canonicalization. Keep the unchanged reference as the fallback.
  for (const ring of allRings(piece.polygons))
    if (ring.length && fastPointInMulti(ring[0]!, lasso)) return true;
  for (const ring of allRings(piece.polygons)) {
    for (const point of ring) if (fastPointInMulti(point, lasso)) return true;
    if (ring.length >= 2)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        const x = a.x / 2 + b.x / 2,
          y = a.y / 2 + b.y / 2;
        if (Number.isFinite(x) && Number.isFinite(y) && fastPointInMulti({ x, y }, lasso))
          return true;
      }
  }
  for (const ring of allRings(lasso))
    for (const point of ring) if (fastPointInMulti(point, piece.polygons)) return true;
  const contact = withinLassoMargin(piece, lasso, margin);
  if (contact === true || contact === false) return contact;
  return fallback
    ? fallback(contact === null ? 'indeterminate' : 'overlapping-bounds')
    : pieceIntersectsLasso(piece, lasso, margin);
}

export type LayeredLassoQueryWork = {
  readonly candidateCount: number;
  readonly processedCount: number;
  step(
    now: () => number,
    budgetMs?: number
  ): LayeredObjectQueryResult<readonly LayeredObjectQueryHit[]> | null;
};
/** Internal incremental intersects query; callers own scheduling and session identity. */
export function createLayeredLassoQuery(
  prepared: PreparedLayeredObjectQuery,
  path: readonly Point[],
  // Internal diagnostic runs only. Normal queries do not read a timing clock.
  diagnostics?: {
    now: () => number;
    onPhase?: (phase: 'canonicalize' | 'candidates', elapsedMs: number) => void;
    onObject?: (objectId: string, elapsedMs: number) => void;
    onFallback?: (
      objectId: string,
      elapsedMs: number,
      reason: 'overlapping-bounds' | 'indeterminate'
    ) => void;
  }
): LayeredObjectQueryResult<LayeredLassoQueryWork> {
  if (
    !isPreparedQuery(prepared) ||
    !Array.isArray(path) ||
    path.length < 3 ||
    path.some((p) => !isFinitePoint(p))
  )
    return err('invalid-input');
  const ring = freezeRing(
    path.filter((p, i) => i === 0 || p.x !== path[i - 1]!.x || p.y !== path[i - 1]!.y)
  );
  if (!ring || ring.length < 3 || isCollinearRing(ring)) return err('invalid-input');
  const canonicalStart = diagnostics?.now();
  const canonical = canonicalLasso(ring);
  if (canonicalStart !== undefined)
    diagnostics?.onPhase?.('canonicalize', diagnostics.now() - canonicalStart);
  if (!canonical.ok) return err('geometry-failed');
  const bounds = multiBounds(canonical.polygons);
  if (!bounds) return err('geometry-failed');
  const candidatesStart = diagnostics?.now();
  const entries = lassoCandidates(prepared, bounds),
    hits: LayeredObjectQueryHit[] = [];
  if (candidatesStart !== undefined)
    diagnostics?.onPhase?.('candidates', diagnostics.now() - candidatesStart);
  let index = 0,
    result: LayeredObjectQueryResult<readonly LayeredObjectQueryHit[]> | null = null;
  return ok({
    candidateCount: entries.length,
    get processedCount() {
      return index;
    },
    step(now, budgetMs = 4) {
      if (result) return result;
      const start = now();
      do {
        if (index === entries.length) return (result = ok(Object.freeze(hits)));
        const entry = entries[index++]!;
        const objectStart = diagnostics?.now();
        for (const piece of entry.pieces) {
          const matched = fastPieceIntersectsLasso(
            piece,
            canonical.polygons,
            entry.margin,
            diagnostics
              ? (reason) => {
                  const start = diagnostics.now();
                  const result = pieceIntersectsLasso(piece, canonical.polygons, entry.margin);
                  diagnostics.onFallback?.(entry.objectId, diagnostics.now() - start, reason);
                  return result;
                }
              : undefined
          );
          if (matched === null) return (result = err('geometry-failed'));
          if (matched) {
            hits.push(makeHit(entry));
            break;
          }
        }
        if (objectStart !== undefined)
          diagnostics?.onObject?.(entry.objectId, diagnostics.now() - objectStart);
      } while (now() - start < budgetMs);
      return index === entries.length ? (result = ok(Object.freeze(hits))) : null;
    },
  });
}

let warmup: LayeredLassoQueryWork | undefined;
let warmupEntries: PreparedEntry[] | undefined;
let warmed = false;
/** Internal: one small synthetic workload per JS realm; never selects real objects. */
export function warmLayeredLasso(now: () => number, budgetMs: number): boolean {
  if (warmed) return true;
  const start = now();
  if (!warmup) {
    const entries = (warmupEntries ??= []);
    while (entries.length < 64) {
      const i = entries.length;
      const x = (i % 8) * 3,
        y = Math.floor(i / 8) * 3;
      // More than one BVH leaf exercises the traversal used by ink outlines.
      // Four-point rectangles warmed only the leaf predicate.
      const ring = freezeRing(
        Array.from({ length: 16 }, (_, j) => ({
          x: x + 0.7 * Math.cos(((j + 0.2) * Math.PI) / 8),
          y: y + 0.7 * Math.sin(((j + 0.2) * Math.PI) / 8),
        }))
      )!;
      const piece = freezePiece([ring]);
      entries.push({
        objectId: `warm-${i}`,
        objectRevision: 1,
        transformRevision: 1,
        kind: 'freehand',
        order: i,
        margin: 0,
        pieces: [piece],
        broadphase: multiBounds(piece.polygons)!,
      });
      if (now() - start >= budgetMs) return false;
    }
    const path = Array.from({ length: 128 }, (_, i) => ({
      x: 10 + 8 * Math.cos((i * Math.PI) / 64),
      y: 10 + 8 * Math.sin((i * Math.PI) / 64),
    }));
    const query = createLayeredLassoQuery({ documentRevision: 0, entries }, path);
    if (!query.ok) return (warmed = true);
    warmup = query.value;
    warmupEntries = undefined;
  }
  const remaining = budgetMs - (now() - start);
  if (remaining <= 0) return false;
  if (warmup.step(now, remaining)) {
    warmed = true;
    warmup = undefined;
  }
  return warmed;
}

/** Finish document-only broadphase construction during idle, independent of a real path. */
export function primeLayeredLassoIndex(prepared: PreparedLayeredObjectQuery): void {
  if (prepared.entries.length && !lassoIndexes.has(prepared))
    lassoIndexes.set(prepared, buildLassoIndex(prepared.entries));
}
