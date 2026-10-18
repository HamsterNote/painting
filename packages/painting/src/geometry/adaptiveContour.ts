/**
 * 自适应轮廓扁平化（Task 5.2 后续基础）
 *
 * 把 cubic / ellipse 的 local 参数曲线按世界空间误差预算切成折线，输出**平行的**
 * `localPoints` 与 `worldPoints`（同一索引对应同一点）及固定 `maxDeviation` 上界。
 *
 * - 只依赖 `model/document.ts` 类型与共享 `geometry/affine.ts`（applyAffine）；
 *   无 DOM / V2 / PF / polygonBoolean / store / cache。
 * - 固定内部目标 MAX_WORLD_DEVIATION = 0.125 DIP（为中心线 + 帽误差合计 <= 0.25 预留预算），
 *   无 public options；最多 65536 段、最大 depth 32。
 * - 非法输入 invalid-input；finite 输入但变换/中间算术非有限 geometry-failed；
 *   深度/段数耗尽 budget-exceeded。整体失败绝不 partial。
 * - `maxDeviation` 返回固定上限，不宣称真正测得误差。
 */

import type { AffineTransform, Point } from '../model/document';
import { applyAffine } from './affine';

/** 扁平化错误码。 */
export type AdaptiveContourErrorCode = 'invalid-input' | 'geometry-failed' | 'budget-exceeded';

/** 统一 Result；value/error 只读。 */
export type AdaptiveContourResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: AdaptiveContourErrorCode }> }>;

/** 自适应轮廓：平行 local/world 点序列与固定误差上界。 */
export type AdaptiveContour = Readonly<{
  localPoints: readonly Point[];
  worldPoints: readonly Point[];
  maxDeviation: number;
}>;

/** 世界空间目标最大偏差（DIP）。 */
const MAX_WORLD_DEVIATION = 0.125;

/** 单个对象预算：最多段数与最大细分深度。 */
const MAX_SEGMENTS = 65536;
const MAX_DEPTH = 32;

const TWO_PI = Math.PI * 2;

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

/** transform 六分量有限且行列式有限非 0。 */
function isValidTransform(value: unknown): value is AffineTransform {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const transform = value as Record<string, unknown>;
  if (
    !isFiniteNumber(transform.a) ||
    !isFiniteNumber(transform.b) ||
    !isFiniteNumber(transform.c) ||
    !isFiniteNumber(transform.d) ||
    !isFiniteNumber(transform.tx) ||
    !isFiniteNumber(transform.ty)
  ) {
    return false;
  }
  const determinant = transform.a * transform.d - transform.b * transform.c;
  return Number.isFinite(determinant) && determinant !== 0;
}

function ok<T>(value: T): AdaptiveContourResult<T> {
  return Object.freeze({ ok: true, value });
}

function err<T>(code: AdaptiveContourErrorCode): AdaptiveContourResult<T> {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) });
}

/** 安全中点：a/2 + b/2，避免 a+b 溢出。 */
function midpoint(a: number, b: number): number {
  return a / 2 + b / 2;
}

function midpointPoint(a: Point, b: Point): Point {
  return { x: midpoint(a.x, b.x), y: midpoint(a.y, b.y) };
}

/** 点是否有限。 */
function pointIsFinite(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

type FlattenStatus = 'ok' | 'geometry' | 'budget';

/** 供 cubic/ellipse 共享的可变输出累积器（成功后统一冻结）。 */
type Accumulator = {
  local: Point[];
  world: Point[];
  segments: number;
};

function appendPoint(accumulator: Accumulator, local: Point, world: Point): FlattenStatus {
  if (!pointIsFinite(local) || !pointIsFinite(world)) {
    return 'geometry';
  }
  if (accumulator.segments >= MAX_SEGMENTS) {
    return 'budget';
  }
  accumulator.local.push(Object.freeze({ x: local.x, y: local.y }));
  accumulator.world.push(Object.freeze({ x: world.x, y: world.y }));
  accumulator.segments += 1;
  return 'ok';
}

function finalize(accumulator: Accumulator): AdaptiveContourResult<AdaptiveContour> {
  return ok(
    Object.freeze({
      localPoints: Object.freeze(accumulator.local),
      worldPoints: Object.freeze(accumulator.world),
      maxDeviation: MAX_WORLD_DEVIATION,
    })
  );
}

/**
 * 点到**有限弦段**（非无限直线）的距离；用 hypot/归一化避免可避免的平方溢出。
 * 非有限运算返回 null（geometry-failed）。P0=P3（零长段）退化为到端点距离。
 */
function distanceToSegment(point: Point, a: Point, b: Point): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
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

type CubicTuple = readonly [Point, Point, Point, Point];

/** 两个 world 控制点到 world 弦段的距离都 <= 目标才接受。 */
function isCubicFlat(world: CubicTuple): boolean | null {
  const d1 = distanceToSegment(world[1], world[0], world[3]);
  const d2 = distanceToSegment(world[2], world[0], world[3]);
  if (d1 === null || d2 === null) {
    return null;
  }
  return d1 <= MAX_WORLD_DEVIATION && d2 <= MAX_WORLD_DEVIATION;
}

/** 同步 de Casteljau 分割 local/world；任一中间点非有限返回 null。 */
function splitCubic(
  local: CubicTuple,
  world: CubicTuple
): Readonly<{
  leftLocal: CubicTuple;
  leftWorld: CubicTuple;
  rightLocal: CubicTuple;
  rightWorld: CubicTuple;
}> | null {
  const lp01 = midpointPoint(local[0], local[1]);
  const lp12 = midpointPoint(local[1], local[2]);
  const lp23 = midpointPoint(local[2], local[3]);
  const lp012 = midpointPoint(lp01, lp12);
  const lp123 = midpointPoint(lp12, lp23);
  const lp0123 = midpointPoint(lp012, lp123);
  const wp01 = midpointPoint(world[0], world[1]);
  const wp12 = midpointPoint(world[1], world[2]);
  const wp23 = midpointPoint(world[2], world[3]);
  const wp012 = midpointPoint(wp01, wp12);
  const wp123 = midpointPoint(wp12, wp23);
  const wp0123 = midpointPoint(wp012, wp123);
  const all = [lp01, lp12, lp23, lp012, lp123, lp0123, wp01, wp12, wp23, wp012, wp123, wp0123];
  if (!all.every(pointIsFinite)) {
    return null;
  }
  return {
    leftLocal: [local[0], lp01, lp012, lp0123],
    leftWorld: [world[0], wp01, wp012, wp0123],
    rightLocal: [lp0123, lp123, lp23, local[3]],
    rightWorld: [wp0123, wp123, wp23, world[3]],
  };
}

function flattenCubicSegment(
  local: CubicTuple,
  world: CubicTuple,
  depth: number,
  accumulator: Accumulator
): FlattenStatus {
  const flat = isCubicFlat(world);
  if (flat === null) {
    return 'geometry';
  }
  if (flat) {
    // 接受：按顺序 append 段终点（起点由上一层/初始点提供，不按 xy 去重）。
    return appendPoint(accumulator, local[3], world[3]);
  }
  if (depth >= MAX_DEPTH) {
    return 'budget';
  }
  const split = splitCubic(local, world);
  if (!split) {
    return 'geometry';
  }
  const left = flattenCubicSegment(split.leftLocal, split.leftWorld, depth + 1, accumulator);
  if (left !== 'ok') {
    return left;
  }
  return flattenCubicSegment(split.rightLocal, split.rightWorld, depth + 1, accumulator);
}

/**
 * 扁平化带 transform 的 cubic：四 local 控制点 `[P0, C1, C2, P3]`。
 *
 * 世界 de Casteljau 递归细分并同步 local 分割；对 **world 弦段** 距离 <= 0.125 才接受
 * （P0=P3 / 共线但 CP 越出端点不会假直线）。
 */
export function flattenLayeredCubic(
  points: readonly Point[],
  transform: AffineTransform
): AdaptiveContourResult<AdaptiveContour> {
  if (!Array.isArray(points) || points.length !== 4) {
    return err('invalid-input');
  }
  for (const point of points) {
    if (!isFinitePoint(point)) {
      return err('invalid-input');
    }
  }
  if (!isValidTransform(transform)) {
    return err('invalid-input');
  }
  const p0 = points[0]!;
  const p1 = points[1]!;
  const p2 = points[2]!;
  const p3 = points[3]!;
  const local: CubicTuple = [p0, p1, p2, p3];
  const w0 = applyAffine(transform, p0);
  const w1 = applyAffine(transform, p1);
  const w2 = applyAffine(transform, p2);
  const w3 = applyAffine(transform, p3);
  if (!w0 || !w1 || !w2 || !w3) {
    return err('geometry-failed');
  }
  const world: CubicTuple = [w0, w1, w2, w3];
  if (!pointIsFinite(local[0]) || !pointIsFinite(world[0])) {
    return err('geometry-failed');
  }
  const accumulator: Accumulator = { local: [], world: [], segments: 0 };
  accumulator.local.push(Object.freeze({ x: local[0].x, y: local[0].y }));
  accumulator.world.push(Object.freeze({ x: world[0].x, y: world[0].y }));
  const status = flattenCubicSegment(local, world, 0, accumulator);
  if (status === 'budget') {
    return err('budget-exceeded');
  }
  if (status === 'geometry') {
    return err('geometry-failed');
  }
  return finalize(accumulator);
}

/** 参数 t 处的 ellipse local 点；非有限返回 null。 */
function ellipseLocalPoint(center: Point, rx: number, ry: number, t: number): Point | null {
  const x = center.x + rx * Math.cos(t);
  const y = center.y + ry * Math.sin(t);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

/**
 * 单个参数区间 [t0,t1] 的椭圆扁平化。
 * 用世界二阶导上界做**理论**线性插值误差保证：err <= B * h² / 8（h=|t1-t0|），
 * 不用 midpoint sagitta 近似（偏心/shear 下会假保证）。
 */
function flattenEllipseInterval(
  accumulator: Accumulator,
  center: Point,
  rx: number,
  ry: number,
  transform: AffineTransform,
  boundB: number,
  t0: number,
  t1: number,
  depth: number
): FlattenStatus {
  const h = Math.abs(t1 - t0);
  const bound = (boundB * h * h) / 8;
  if (!Number.isFinite(bound)) {
    return 'geometry';
  }
  if (bound <= MAX_WORLD_DEVIATION) {
    const local = ellipseLocalPoint(center, rx, ry, t1);
    if (!local) {
      return 'geometry';
    }
    const world = applyAffine(transform, local);
    if (!world) {
      return 'geometry';
    }
    return appendPoint(accumulator, local, world);
  }
  if (depth >= MAX_DEPTH || accumulator.segments >= MAX_SEGMENTS) {
    return 'budget';
  }
  const mid = midpoint(t0, t1);
  const left = flattenEllipseInterval(
    accumulator,
    center,
    rx,
    ry,
    transform,
    boundB,
    t0,
    mid,
    depth + 1
  );
  if (left !== 'ok') {
    return left;
  }
  return flattenEllipseInterval(accumulator, center, rx, ry, transform, boundB, mid, t1, depth + 1);
}

/**
 * 扁平化带 transform 的椭圆弧。
 *
 * - `rx/ry >= 0` 允许退化；signed span `|endAngle-startAngle| <= 2π`，零 span 合法为单点。
 * - 世界点由 local 点经 `applyAffine` 得到，保持 local/world 一一对应。
 * - full arc 先分四象限确保起终相同不误判；signed span 顺序与 Canvas 一致。
 */
export function flattenLayeredEllipse(
  center: Point,
  rx: number,
  ry: number,
  transform: AffineTransform,
  startAngle: number,
  endAngle: number
): AdaptiveContourResult<AdaptiveContour> {
  if (!isFinitePoint(center)) {
    return err('invalid-input');
  }
  if (!isFiniteNumber(rx) || !isFiniteNumber(ry) || rx < 0 || ry < 0) {
    return err('invalid-input');
  }
  if (!isValidTransform(transform)) {
    return err('invalid-input');
  }
  if (!isFiniteNumber(startAngle) || !isFiniteNumber(endAngle)) {
    return err('invalid-input');
  }
  const span = endAngle - startAngle;
  if (!Number.isFinite(span) || Math.abs(span) > TWO_PI) {
    return err('invalid-input');
  }

  const accumulator: Accumulator = { local: [], world: [], segments: 0 };
  const startLocal = ellipseLocalPoint(center, rx, ry, startAngle);
  if (!startLocal) {
    return err('geometry-failed');
  }
  const startWorld = applyAffine(transform, startLocal);
  if (!startWorld || !pointIsFinite(startLocal) || !pointIsFinite(startWorld)) {
    return err('geometry-failed');
  }
  accumulator.local.push(Object.freeze({ x: startLocal.x, y: startLocal.y }));
  accumulator.world.push(Object.freeze({ x: startWorld.x, y: startWorld.y }));

  if (span === 0) {
    return finalize(accumulator); // 零 span：单点。
  }

  // 世界 r'' 上界：B = |col1|*rx + |col2|*ry = hypot(a*rx,b*rx) + hypot(c*ry,d*ry)。
  const boundB =
    Math.hypot(transform.a * rx, transform.b * rx) + Math.hypot(transform.c * ry, transform.d * ry);
  if (!Number.isFinite(boundB)) {
    return err('geometry-failed');
  }
  if (boundB === 0) {
    return finalize(accumulator); // 零 radii：退化为 center 单点。
  }

  let boundaries: number[];
  if (Math.abs(span) === TWO_PI) {
    const quarter = span / 4;
    boundaries = [
      startAngle,
      startAngle + quarter,
      startAngle + 2 * quarter,
      startAngle + 3 * quarter,
      endAngle,
    ];
  } else {
    boundaries = [startAngle, endAngle];
  }

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const status = flattenEllipseInterval(
      accumulator,
      center,
      rx,
      ry,
      transform,
      boundB,
      boundaries[index]!,
      boundaries[index + 1]!,
      0
    );
    if (status === 'budget') {
      return err('budget-exceeded');
    }
    if (status === 'geometry') {
      return err('geometry-failed');
    }
  }
  return finalize(accumulator);
}
