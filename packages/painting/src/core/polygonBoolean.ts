/// <reference path="../types/robust-predicates.d.ts" />

import { intersection, union } from 'polyclip-ts';
import { orient2d } from 'robust-predicates';
import type { GeometryPoint } from './geometry';

export type PolygonRing = readonly GeometryPoint[];
export type PolygonBooleanPolygon = Readonly<{
  outer: PolygonRing;
  holes: readonly PolygonRing[];
}>;
export type PolygonBooleanMultiPolygon = readonly PolygonBooleanPolygon[];

export type ClosedRingKind = 'simple-convex' | 'simple-concave' | 'complex';

function finitePoint(point: GeometryPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(first: GeometryPoint, second: GeometryPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function frozenRing(points: readonly GeometryPoint[]): PolygonRing | null {
  const normalized =
    points.length > 1 && samePoint(points[0], points[points.length - 1])
      ? points.slice(0, -1)
      : points;
  if (normalized.length < 3 || !normalized.every(finitePoint)) return null;
  return Object.freeze(normalized.map((point) => Object.freeze({ x: point.x, y: point.y })));
}

function orient(first: GeometryPoint, second: GeometryPoint, third: GeometryPoint): number {
  return orient2d(first.x, first.y, second.x, second.y, third.x, third.y);
}

function onSegment(first: GeometryPoint, point: GeometryPoint, second: GeometryPoint): boolean {
  return (
    point.x >= Math.min(first.x, second.x) &&
    point.x <= Math.max(first.x, second.x) &&
    point.y >= Math.min(first.y, second.y) &&
    point.y <= Math.max(first.y, second.y)
  );
}

function segmentsIntersect(
  first: GeometryPoint,
  second: GeometryPoint,
  third: GeometryPoint,
  fourth: GeometryPoint
): boolean {
  const abThird = orient(first, second, third);
  const abFourth = orient(first, second, fourth);
  const cdFirst = orient(third, fourth, first);
  const cdSecond = orient(third, fourth, second);
  if (abThird === 0 && onSegment(first, third, second)) return true;
  if (abFourth === 0 && onSegment(first, fourth, second)) return true;
  if (cdFirst === 0 && onSegment(third, first, fourth)) return true;
  if (cdSecond === 0 && onSegment(third, second, fourth)) return true;
  return abThird > 0 !== abFourth > 0 && cdFirst > 0 !== cdSecond > 0;
}

/** 在 prepared 阶段调用一次；frame 不再为每帧裁剪重复 O(n²) 自交检查。 */
export function classifyClosedRing(points: readonly GeometryPoint[]): ClosedRingKind | null {
  const ring = frozenRing(points);
  if (ring === null) return null;
  let direction = 0;
  let selfIntersecting = false;
  let hasOpposingTurn = false;
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    for (let other = index + 1; other < ring.length; other += 1) {
      const otherNext = (other + 1) % ring.length;
      if (index === other || next === other || otherNext === index) continue;
      if (segmentsIntersect(ring[index], ring[next], ring[other], ring[otherNext]))
        selfIntersecting = true;
    }
    const turn = orient(ring[index], ring[next], ring[(index + 2) % ring.length]);
    if (turn !== 0) {
      const nextDirection = Math.sign(turn);
      if (direction !== 0 && direction !== nextDirection) hasOpposingTurn = true;
      direction = nextDirection;
    }
  }
  if (selfIntersecting) return 'complex';
  return direction === 0 ? null : hasOpposingTurn ? 'simple-concave' : 'simple-convex';
}

/**
 * canonical fill rule 始终是 nonzero。先测试边界，随后以 robust orient2d 累积绕数，避免
 * even-odd 在反向绕行或自交轮廓上改变语义。
 */
export function hitTestNonzeroRings(
  rings: readonly PolygonRing[],
  point: GeometryPoint,
  tolerance: number
): boolean {
  if (!finitePoint(point) || !Number.isFinite(tolerance) || tolerance < 0) return false;
  const toleranceSquared = tolerance * tolerance;
  if (!Number.isFinite(toleranceSquared)) return false;
  let winding = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const first = ring[index];
      const second = ring[(index + 1) % ring.length];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const lengthSquared = dx * dx + dy * dy;
      if (!Number.isFinite(lengthSquared) || lengthSquared === 0) continue;
      const progress = Math.max(
        0,
        Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared)
      );
      const distanceX = point.x - (first.x + dx * progress);
      const distanceY = point.y - (first.y + dy * progress);
      if (distanceX * distanceX + distanceY * distanceY <= toleranceSquared) return true;
      const side = orient(first, second, point);
      if (first.y <= point.y) {
        if (second.y > point.y && side > 0) winding += 1;
      } else if (second.y <= point.y && side < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

function asPolyclipRing(ring: PolygonRing): [number, number][] {
  return ring.map((point) => [point.x, point.y]);
}

function resultToMultiPolygon(
  result: readonly (readonly (readonly [number, number][])[])[]
): PolygonBooleanMultiPolygon | null {
  const polygons: PolygonBooleanPolygon[] = [];
  for (const polygon of result) {
    const rings = polygon.map((ring) => frozenRing(ring.map(([x, y]) => ({ x, y }))));
    if (rings.some((ring) => ring === null) || rings.length === 0) return null;
    polygons.push(
      Object.freeze({ outer: rings[0]!, holes: Object.freeze(rings.slice(1) as PolygonRing[]) })
    );
  }
  return Object.freeze(polygons);
}

export type PolygonBooleanResult =
  Readonly<{ ok: true; polygons: PolygonBooleanMultiPolygon }> | Readonly<{ ok: false }>;

/** polyclip 异常绝不降级为空区域；调用方必须将失败诊断为 clip-failed。 */
export function canonicalizeClosedRing(ring: PolygonRing): PolygonBooleanResult {
  const normalized = frozenRing(ring);
  if (normalized === null) return Object.freeze({ ok: false });
  try {
    const polygons = resultToMultiPolygon(union([[asPolyclipRing(normalized)]]));
    return polygons === null ? Object.freeze({ ok: false }) : Object.freeze({ ok: true, polygons });
  } catch {
    return Object.freeze({ ok: false });
  }
}

export function intersectClosedRingWithRect(
  ring: PolygonRing,
  region: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>
): PolygonBooleanResult {
  const normalized = frozenRing(ring);
  if (
    normalized === null ||
    ![region.minX, region.minY, region.maxX, region.maxY].every(Number.isFinite) ||
    region.minX > region.maxX ||
    region.minY > region.maxY
  ) {
    return Object.freeze({ ok: false });
  }
  const rectangle: [number, number][] = [
    [region.minX, region.minY],
    [region.maxX, region.minY],
    [region.maxX, region.maxY],
    [region.minX, region.maxY],
  ];
  try {
    const polygons = resultToMultiPolygon(
      intersection([[asPolyclipRing(normalized)]], [[rectangle]])
    );
    return polygons === null ? Object.freeze({ ok: false }) : Object.freeze({ ok: true, polygons });
  } catch {
    return Object.freeze({ ok: false });
  }
}
