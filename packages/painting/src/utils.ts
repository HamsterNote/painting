import type { DrawingPoint, DrawingStroke, DrawingValue } from './components/DrawingSurface';

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

function distanceSqPointToStroke(point: DrawingPoint, stroke: DrawingStroke): number {
  const { points, tool } = stroke;

  if (points.length === 0) {
    return Infinity;
  }

  if (tool === 'rect' && points.length >= 2) {
    return distanceSqPointToRect(point, points[0], points[points.length - 1]);
  }

  if (tool === 'line' && points.length >= 2) {
    return distanceSqPointToSegment(point, points[0], points[points.length - 1]);
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
 * - line: minimum distance to the segment between first and last point
 * - rect: distance to axis-aligned bounding rectangle (0 when inside)
 */
export function pick(point: DrawingPoint, strokes: DrawingStroke[]): DrawingStroke | null {
  if (strokes.length === 0) {
    return null;
  }

  let bestStroke: DrawingStroke = strokes[0];
  let bestDistSq: number = distanceSqPointToStroke(point, strokes[0]);

  for (let i = 1; i < strokes.length; i++) {
    const d = distanceSqPointToStroke(point, strokes[i]);
    if (d < bestDistSq) {
      bestDistSq = d;
      bestStroke = strokes[i];
    }
  }

  return bestStroke;
}
