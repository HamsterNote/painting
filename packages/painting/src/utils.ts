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
