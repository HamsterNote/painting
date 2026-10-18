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
import type {
  AffineTransform,
  Bounds,
  DocumentObject,
  EditorDocument,
  FreehandObject,
  Point,
} from '../model/document';
import { readLayeredDocument } from '../model/documentReader';
import { applyAffine } from '../geometry/affine';
import { flattenLayeredCubic, flattenLayeredEllipse } from '../geometry/adaptiveContour';
import { deriveShapeGeometry } from '../geometry/shape';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';
import type { FreehandGeometryCache } from '../geometry/freehandCache';
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
  let polygon: readonly Point[];
  try {
    polygon = cache.getPresentation(object as FreehandObject, 'final').transformedPolygon;
  } catch {
    return err('geometry-failed');
  }
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return err('geometry-failed');
  }
  const ring = freezeRing(polygon);
  if (!ring) {
    return err('geometry-failed');
  }
  const worldBounds = deriveLayeredWorldBounds(object, cache);
  if (!worldBounds) {
    return err('geometry-failed');
  }
  return ok(entryFrom(object, order, 0, [freezePiece([ring])], worldBounds.visualWorldBounds));
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
  const document_ = read.value;
  const entries: PreparedEntry[] = [];
  for (let order = 0; order < document_.objects.length; order += 1) {
    const object = document_.objects[order]!;
    let built: LayeredObjectQueryResult<PreparedEntry>;
    switch (object.kind) {
      case 'freehand':
        built = buildFreehandEntry(object, order, cache);
        break;
      case 'shape':
        built = buildShapeEntry(object, order, cache);
        break;
      case 'image':
      case 'text':
        built = buildBoundsQuadEntry(object, order, cache);
        break;
      default:
        return err('invalid-document');
    }
    if (!built.ok) {
      return err(built.error.code);
    }
    entries.push(built.value);
  }
  return ok(
    Object.freeze({
      documentRevision: document_.documentRevision,
      entries: Object.freeze(entries),
    })
  );
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

function multiBounds(multi: PolygonBooleanMultiPolygon): Bounds | null {
  return pointsBounds(allRings(multi).flatMap((ring) => ring as Point[]));
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
