import type { DrawingPoint, DrawingStroke, DrawingValue } from './components/DrawingSurface';
import type { DrawingStrokeV2 } from './model/strokes';

type PickableStroke = DrawingStroke | DrawingStrokeV2;

function distanceSqPointToSegment(point: DrawingPoint, a: DrawingPoint, b: DrawingPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dx === 0 && dy === 0) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return px * px + py * py;
  }

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const px = point.x - projX;
  const py = point.y - projY;

  return px * px + py * py;
}

function distanceSqPointToPolyline(point: DrawingPoint, points: DrawingPoint[]): number {
  if (points.length === 0) {
    return Infinity;
  }

  if (points.length === 1) {
    const dx = point.x - points[0].x;
    const dy = point.y - points[0].y;
    return dx * dx + dy * dy;
  }

  let min = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceSqPointToSegment(point, points[i], points[i + 1]);
    if (d < min) {
      min = d;
    }
  }

  return min;
}

function distanceSqPointToRect(point: DrawingPoint, first: DrawingPoint, last: DrawingPoint): number {
  const minX = Math.min(first.x, last.x);
  const maxX = Math.max(first.x, last.x);
  const minY = Math.min(first.y, last.y);
  const maxY = Math.max(first.y, last.y);

  const closestX = Math.max(minX, Math.min(point.x, maxX));
  const closestY = Math.max(minY, Math.min(point.y, maxY));

  const dx = point.x - closestX;
  const dy = point.y - closestY;

  return dx * dx + dy * dy;
}

function pointInRect(point: DrawingPoint, first: DrawingPoint, last: DrawingPoint): boolean {
  const minX = Math.min(first.x, last.x);
  const maxX = Math.max(first.x, last.x);
  const minY = Math.min(first.y, last.y);
  const maxY = Math.max(first.y, last.y);

  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function distanceSqPointToEllipse(point: DrawingPoint, first: DrawingPoint, last: DrawingPoint): number {
  const centerX = (first.x + last.x) / 2;
  const centerY = (first.y + last.y) / 2;
  const rx = Math.abs(last.x - first.x) / 2;
  const ry = Math.abs(last.y - first.y) / 2;

  if (rx === 0 || ry === 0) {
    return distanceSqPointToSegment(point, first, last);
  }

  const normalizedX = (point.x - centerX) / rx;
  const normalizedY = (point.y - centerY) / ry;
  const angle = Math.atan2(normalizedY, normalizedX);
  const closestX = centerX + rx * Math.cos(angle);
  const closestY = centerY + ry * Math.sin(angle);
  const dx = point.x - closestX;
  const dy = point.y - closestY;

  return dx * dx + dy * dy;
}

function pointInEllipse(point: DrawingPoint, first: DrawingPoint, last: DrawingPoint): boolean {
  const centerX = (first.x + last.x) / 2;
  const centerY = (first.y + last.y) / 2;
  const rx = Math.abs(last.x - first.x) / 2;
  const ry = Math.abs(last.y - first.y) / 2;

  if (rx === 0 || ry === 0) {
    return false;
  }

  const normalizedX = (point.x - centerX) / rx;
  const normalizedY = (point.y - centerY) / ry;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function distanceSqPointToPolygon(point: DrawingPoint, points: DrawingPoint[]): number {
  if (points.length < 2) {
    return distanceSqPointToPolyline(point, points);
  }

  let min = distanceSqPointToPolyline(point, points);
  const closingDistance = distanceSqPointToSegment(point, points[points.length - 1], points[0]);
  if (closingDistance < min) {
    min = closingDistance;
  }

  return min;
}

// Hit-test segment count for cubic Bezier sampling. 24 segments give visually
// indistinguishable polyline approximation for typical stroke widths while keeping
// the per-pick cost predictable.
const BEZIER_HIT_TEST_SEGMENTS = 24;

function sampleCubicBezierPolyline(
  start: DrawingPoint,
  control1: DrawingPoint,
  control2: DrawingPoint,
  end: DrawingPoint,
  segments: number,
): DrawingPoint[] {
  const samples: DrawingPoint[] = new Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const oneMinusT = 1 - t;
    const b0 = oneMinusT * oneMinusT * oneMinusT;
    const b1 = 3 * oneMinusT * oneMinusT * t;
    const b2 = 3 * oneMinusT * t * t;
    const b3 = t * t * t;
    samples[i] = {
      x: b0 * start.x + b1 * control1.x + b2 * control2.x + b3 * end.x,
      y: b0 * start.y + b1 * control1.y + b2 * control2.y + b3 * end.y,
    };
  }
  return samples;
}

function distanceSqPointToBezier(point: DrawingPoint, points: DrawingPoint[]): number {
  if (points.length !== 4) {
    return distanceSqPointToPolyline(point, points);
  }
  const samples = sampleCubicBezierPolyline(
    points[0],
    points[1],
    points[2],
    points[3],
    BEZIER_HIT_TEST_SEGMENTS,
  );
  return distanceSqPointToPolyline(point, samples);
}

function pointInPolygon(point: DrawingPoint, points: DrawingPoint[]): boolean {
  if (points.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function hasRenderedFill(stroke: PickableStroke): boolean {
  return stroke.fillColor !== undefined && stroke.fillColor !== 'none';
}

function pointInClosedShape(point: DrawingPoint, stroke: PickableStroke): boolean {
  const { points, tool } = stroke;

  if (points.length < 2) {
    return false;
  }

  if (tool === 'rect') {
    return pointInRect(point, points[0], points[points.length - 1]);
  }

  if (tool === 'ellipse') {
    return pointInEllipse(point, points[0], points[points.length - 1]);
  }

  if (tool === 'polygon') {
    return pointInPolygon(point, points);
  }

  return false;
}

function distanceSqPointToStroke(point: DrawingPoint, stroke: PickableStroke): number {
  const { points, tool } = stroke;

  if (points.length === 0) {
    return Infinity;
  }

  if (tool === 'rect' && points.length >= 2) {
    return distanceSqPointToRect(point, points[0], points[points.length - 1]);
  }

  if (hasRenderedFill(stroke) && pointInClosedShape(point, stroke)) {
    return 0;
  }

  if (tool === 'ellipse' && points.length >= 2) {
    return distanceSqPointToEllipse(point, points[0], points[points.length - 1]);
  }

  if (tool === 'polygon' && points.length >= 2) {
    return distanceSqPointToPolygon(point, points);
  }

  if (tool === 'line' && points.length >= 2) {
    return distanceSqPointToPolyline(point, points);
  }

  if (tool === 'bezier') {
    return distanceSqPointToBezier(point, points);
  }

  return distanceSqPointToPolyline(point, points);
}

export function addStroke(value: DrawingValue, stroke: DrawingStroke): DrawingValue {
  return {
    ...value,
    strokes: [...value.strokes, stroke],
  };
}

export function removeStroke(value: DrawingValue, strokeId: string): DrawingValue {
  return {
    ...value,
    strokes: value.strokes.filter((s) => s.id !== strokeId),
  };
}

export function updateStroke(value: DrawingValue, stroke: DrawingStroke): DrawingValue {
  return {
    ...value,
    strokes: value.strokes.map((s) => (s.id === stroke.id ? stroke : s)),
  };
}

export function clearStrokes(value: DrawingValue): DrawingValue {
  return {
    ...value,
    strokes: [],
  };
}

/**
 * Returns the stroke closest to `point`, or `null` when `strokes` is empty.
 *
 * Distance semantics per tool:
 * - pen: minimum distance to polyline segments
 * - line: minimum distance to open line segments
 * - rect: distance to axis-aligned bounding rectangle (0 when inside)
 *
 * @param maxDistance - Optional maximum distance threshold. If the closest stroke
 *   is farther than this distance, returns `null`. Used for object eraser radius.
 */
export function pick<TStroke extends PickableStroke>(point: DrawingPoint, strokes: TStroke[], maxDistance?: number): TStroke | null {
  if (strokes.length === 0) {
    return null;
  }

  let bestStroke: TStroke = strokes[0];
  let bestDistSq: number = distanceSqPointToStroke(point, strokes[0]);

  for (let i = 1; i < strokes.length; i++) {
    const d = distanceSqPointToStroke(point, strokes[i]);
    if (d < bestDistSq) {
      bestDistSq = d;
      bestStroke = strokes[i];
    }
  }

  // If maxDistance is specified, check if the closest stroke is within range
  if (maxDistance !== undefined) {
    const maxDistSq = maxDistance * maxDistance;
    if (bestDistSq > maxDistSq) {
      return null;
    }
  }

  return bestStroke;
}

/**
 * Samples along the eraser sweep so hit testing can reuse `distanceSqPointToStroke`,
 * including per-tool dispatch, fill short-circuiting, and Bezier sampling, without
 * duplicating that logic for each tool. `pickStep = max(0.5, radius / 4)` keeps
 * samples at most about a quarter radius apart so intersecting objects cannot slip
 * between samples. Equal-distance hits prefer the earlier stroke index across the
 * whole sweep, matching `pick()` even when that stroke is sampled later.
 */
export function pickStrokeIntersectingSegment<TStroke extends PickableStroke>(
  start: DrawingPoint,
  end: DrawingPoint,
  strokes: TStroke[],
  radius: number,
): TStroke | null {
  if (strokes.length === 0) {
    return null;
  }

  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
  const safeRadius = Math.max(0, radius);
  const pickStep = Math.max(0.5, safeRadius / 4);
  const sampleCount = Math.max(1, Math.ceil(segmentLength / pickStep));

  let bestStroke: TStroke | null = null;
  let bestDistSq = Infinity;
  let bestStrokeIndex = Number.POSITIVE_INFINITY;

  for (let i = 0; i <= sampleCount; i++) {
    const t = sampleCount === 0 ? 0 : i / sampleCount;
    const sample = {
      x: start.x + t * (end.x - start.x),
      y: start.y + t * (end.y - start.y),
    };

    for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
      const stroke = strokes[strokeIndex];
      const d = distanceSqPointToStroke(sample, stroke);
      if (d < bestDistSq || (d === bestDistSq && strokeIndex < bestStrokeIndex)) {
        bestDistSq = d;
        bestStrokeIndex = strokeIndex;
        bestStroke = stroke;
      }
    }
  }

  return bestDistSq <= safeRadius * safeRadius ? bestStroke : null;
}

export function pickStrokeIntersectingPolyline<TStroke extends PickableStroke>(
  points: DrawingPoint[],
  strokes: TStroke[],
  radius: number,
): TStroke | null {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return pick(points[0], strokes, radius);
  }

  const safeRadius = Math.max(0, radius);
  const pickStep = Math.max(0.5, safeRadius / 4);
  let bestStroke: TStroke | null = null;
  let bestDistSq = Infinity;
  let bestStrokeIndex = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    const sampleCount = Math.max(1, Math.ceil(segmentLength / pickStep));

    for (let j = 0; j <= sampleCount; j++) {
      const t = sampleCount === 0 ? 0 : j / sampleCount;
      const sample = {
        x: start.x + t * (end.x - start.x),
        y: start.y + t * (end.y - start.y),
      };

      for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
        const stroke = strokes[strokeIndex];
        const d = distanceSqPointToStroke(sample, stroke);
        if (d < bestDistSq || (d === bestDistSq && strokeIndex < bestStrokeIndex)) {
          bestDistSq = d;
          bestStrokeIndex = strokeIndex;
          bestStroke = stroke;
        }
      }
    }
  }

  return bestDistSq <= safeRadius * safeRadius ? bestStroke : null;
}
