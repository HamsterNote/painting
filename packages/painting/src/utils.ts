import type { DrawingPoint, DrawingStroke, DrawingValue } from './components/DrawingSurface';
import type { DrawingStrokeV2 } from './model/strokes';

type PickableStroke = DrawingStroke | DrawingStrokeV2;

export type RenderedStrokeHitTestOptions = {
  eraserRadius: number;
  openFallbackWidth: number;
  closedFallbackWidth: number;
  pressureMultiplier: number;
};

export type LassoSelectionOptions = {
  ellipseSegments?: number;
  bezierSegments?: number;
};

type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type SelectionBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type StrokeSelectionGeometry = {
  samples: DrawingPoint[];
  segments: Array<readonly [DrawingPoint, DrawingPoint]>;
  closedShapePoints: DrawingPoint[] | null;
  bbox: BoundingBox | null;
};

const RENDERED_HIT_EPSILON = 1e-9;
export const SELECTION_BOX_PADDING = 8;

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

function distanceSqPointToRectOutline(point: DrawingPoint, first: DrawingPoint, last: DrawingPoint): number {
  if (!pointInRect(point, first, last)) {
    return distanceSqPointToRect(point, first, last);
  }

  const minX = Math.min(first.x, last.x);
  const maxX = Math.max(first.x, last.x);
  const minY = Math.min(first.y, last.y);
  const maxY = Math.max(first.y, last.y);
  const nearestSideDistance = Math.min(
    point.x - minX,
    maxX - point.x,
    point.y - minY,
    maxY - point.y,
  );

  return nearestSideDistance * nearestSideDistance;
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

function uniquePointCount(points: readonly DrawingPoint[]): number {
  const keys = new Set<string>();
  for (const point of points) {
    keys.add(`${point.x}:${point.y}`);
  }
  return keys.size;
}

function boundingBoxForPoints(points: readonly DrawingPoint[]): BoundingBox | null {
  if (points.length === 0) {
    return null;
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function expandBoundingBox(bbox: BoundingBox | null, amount: number): BoundingBox | null {
  if (bbox === null) {
    return null;
  }

  return {
    minX: bbox.minX - amount,
    minY: bbox.minY - amount,
    maxX: bbox.maxX + amount,
    maxY: bbox.maxY + amount,
  };
}

function isValidBoundingBox(bbox: BoundingBox): boolean {
  return (
    Number.isFinite(bbox.minX) &&
    Number.isFinite(bbox.minY) &&
    Number.isFinite(bbox.maxX) &&
    Number.isFinite(bbox.maxY) &&
    bbox.minX <= bbox.maxX &&
    bbox.minY <= bbox.maxY
  );
}

function unionBoundingBoxes(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function boundingBoxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function rectCornerPoints(first: DrawingPoint, last: DrawingPoint): DrawingPoint[] {
  const minX = Math.min(first.x, last.x);
  const maxX = Math.max(first.x, last.x);
  const minY = Math.min(first.y, last.y);
  const maxY = Math.max(first.y, last.y);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function sampleEllipseFromBoundingBox(first: DrawingPoint, last: DrawingPoint, segments: number): DrawingPoint[] {
  const centerX = (first.x + last.x) / 2;
  const centerY = (first.y + last.y) / 2;
  const rx = Math.abs(last.x - first.x) / 2;
  const ry = Math.abs(last.y - first.y) / 2;
  const safeSegments = Math.max(4, Math.floor(segments));
  const samples: DrawingPoint[] = new Array(safeSegments);

  for (let i = 0; i < safeSegments; i++) {
    const angle = (Math.PI * 2 * i) / safeSegments;
    samples[i] = {
      x: centerX + rx * Math.cos(angle),
      y: centerY + ry * Math.sin(angle),
    };
  }

  return samples;
}

function closedSegments(points: readonly DrawingPoint[]): Array<readonly [DrawingPoint, DrawingPoint]> {
  const segments: Array<readonly [DrawingPoint, DrawingPoint]> = [];
  if (points.length < 2) {
    return segments;
  }

  for (let i = 0; i < points.length; i++) {
    segments.push([points[i], points[(i + 1) % points.length]]);
  }

  return segments;
}

function openSegments(points: readonly DrawingPoint[]): Array<readonly [DrawingPoint, DrawingPoint]> {
  const segments: Array<readonly [DrawingPoint, DrawingPoint]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i], points[i + 1]]);
  }
  return segments;
}

function orientation(a: DrawingPoint, b: DrawingPoint, c: DrawingPoint): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) <= RENDERED_HIT_EPSILON) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function pointOnSegment(point: DrawingPoint, a: DrawingPoint, b: DrawingPoint): boolean {
  return (
    Math.min(a.x, b.x) - RENDERED_HIT_EPSILON <= point.x &&
    point.x <= Math.max(a.x, b.x) + RENDERED_HIT_EPSILON &&
    Math.min(a.y, b.y) - RENDERED_HIT_EPSILON <= point.y &&
    point.y <= Math.max(a.y, b.y) + RENDERED_HIT_EPSILON &&
    orientation(a, b, point) === 0
  );
}

function segmentsIntersect(a1: DrawingPoint, a2: DrawingPoint, b1: DrawingPoint, b2: DrawingPoint): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  return (
    (o1 === 0 && pointOnSegment(b1, a1, a2)) ||
    (o2 === 0 && pointOnSegment(b2, a1, a2)) ||
    (o3 === 0 && pointOnSegment(a1, b1, b2)) ||
    (o4 === 0 && pointOnSegment(a2, b1, b2))
  );
}

function distanceSqSegmentToSegment(a1: DrawingPoint, a2: DrawingPoint, b1: DrawingPoint, b2: DrawingPoint): number {
  if (segmentsIntersect(a1, a2, b1, b2)) {
    return 0;
  }

  return Math.min(
    distanceSqPointToSegment(a1, b1, b2),
    distanceSqPointToSegment(a2, b1, b2),
    distanceSqPointToSegment(b1, a1, a2),
    distanceSqPointToSegment(b2, a1, a2),
  );
}

function buildStrokeSelectionGeometry(stroke: PickableStroke, options: Required<LassoSelectionOptions>): StrokeSelectionGeometry {
  const { points, tool } = stroke;

  if (points.length === 0) {
    return { samples: [], segments: [], closedShapePoints: null, bbox: null };
  }

  if (tool === 'rect' && points.length >= 2) {
    const corners = rectCornerPoints(points[0], points[points.length - 1]);
    return {
      samples: corners,
      segments: closedSegments(corners),
      closedShapePoints: corners,
      bbox: boundingBoxForPoints(corners),
    };
  }

  if (tool === 'ellipse' && points.length >= 2) {
    const samples = sampleEllipseFromBoundingBox(points[0], points[points.length - 1], options.ellipseSegments);
    return {
      samples,
      segments: closedSegments(samples),
      closedShapePoints: samples,
      bbox: boundingBoxForPoints(samples),
    };
  }

  if (tool === 'polygon') {
    return {
      samples: [...points],
      segments: closedSegments(points),
      closedShapePoints: points.length >= 3 ? [...points] : null,
      bbox: boundingBoxForPoints(points),
    };
  }

  if (tool === 'bezier' && points.length === 4) {
    const samples = sampleCubicBezierPolyline(points[0], points[1], points[2], points[3], options.bezierSegments);
    return {
      samples,
      segments: openSegments(samples),
      closedShapePoints: null,
      bbox: boundingBoxForPoints(samples),
    };
  }

  const samples = tool === 'line' && points.length >= 2 ? points.slice(0, 2) : [...points];
  return {
    samples,
    segments: openSegments(samples),
    closedShapePoints: null,
    bbox: boundingBoxForPoints(samples),
  };
}

function lassoPointInsideClosedStroke(point: DrawingPoint, stroke: DrawingStroke, closedShapePoints: DrawingPoint[]): boolean {
  if (stroke.points.length < 2) {
    return false;
  }

  if (stroke.tool === 'rect') {
    return pointInRect(point, stroke.points[0], stroke.points[stroke.points.length - 1]);
  }

  if (stroke.tool === 'ellipse') {
    return pointInEllipse(point, stroke.points[0], stroke.points[stroke.points.length - 1]);
  }

  if (stroke.tool === 'polygon') {
    return pointInPolygon(point, closedShapePoints);
  }

  return false;
}

function hasRenderedFill(stroke: PickableStroke): boolean {
  return stroke.fillColor !== undefined && stroke.fillColor !== 'none';
}

function isClosedStrokeTool(tool: PickableStroke['tool'] | string): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'polygon';
}

function normalizePointPressure(pressure: number | undefined): number {
  if (pressure === 0) {
    return 0;
  }

  return typeof pressure === 'number' && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1 ? pressure : 1;
}

function normalizePressureMultiplier(pressureMultiplier: number): number {
  return typeof pressureMultiplier === 'number' && Number.isFinite(pressureMultiplier) && pressureMultiplier > 0
    ? pressureMultiplier
    : 1;
}

function hasPressureData(stroke: PickableStroke): boolean {
  return stroke.tool === 'pen' && stroke.points.some((point) => point.pressure !== undefined);
}

function resolveRenderedStrokeWidth(stroke: PickableStroke, options: RenderedStrokeHitTestOptions): number {
  const fallbackWidth = isClosedStrokeTool(stroke.tool) ? options.closedFallbackWidth : options.openFallbackWidth;
  const resolvedWidth = stroke.strokeWidth ?? fallbackWidth;
  return Number.isFinite(resolvedWidth) ? Math.max(0, resolvedWidth) : 0;
}

function targetHalfWidthForStroke(stroke: PickableStroke, options: RenderedStrokeHitTestOptions): number {
  return resolveRenderedStrokeWidth(stroke, options) / 2;
}

function targetHalfWidthForPressureSegment(
  stroke: PickableStroke,
  a: DrawingPoint,
  b: DrawingPoint,
  options: RenderedStrokeHitTestOptions,
): number {
  const baseWidth = resolveRenderedStrokeWidth(stroke, options);
  const pressure = Math.max(normalizePointPressure(a.pressure), normalizePointPressure(b.pressure));
  const segmentWidth = baseWidth * pressure * normalizePressureMultiplier(options.pressureMultiplier);
  return Math.max(0, segmentWidth) / 2;
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

function renderedOutlineDistanceSqPointToStroke(point: DrawingPoint, stroke: PickableStroke): number {
  const { points, tool } = stroke;

  if (points.length === 0) {
    return Infinity;
  }

  if (hasRenderedFill(stroke) && pointInClosedShape(point, stroke)) {
    return 0;
  }

  if (tool === 'rect' && points.length >= 2) {
    return distanceSqPointToRectOutline(point, points[0], points[points.length - 1]);
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

function renderedDistanceToPressurePen(point: DrawingPoint, stroke: PickableStroke, options: RenderedStrokeHitTestOptions): number {
  const { points } = stroke;

  if (points.length === 0) {
    return Infinity;
  }

  if (points.length === 1) {
    const dx = point.x - points[0].x;
    const dy = point.y - points[0].y;
    const pointWidth = resolveRenderedStrokeWidth(stroke, options) * normalizePointPressure(points[0].pressure) * normalizePressureMultiplier(options.pressureMultiplier);
    return Math.hypot(dx, dy) - Math.max(0, pointWidth) / 2;
  }

  let minDistance = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const centerDistance = Math.sqrt(distanceSqPointToSegment(point, points[i], points[i + 1]));
    const targetHalfWidth = targetHalfWidthForPressureSegment(stroke, points[i], points[i + 1], options);
    const renderedDistance = centerDistance - targetHalfWidth;
    if (renderedDistance < minDistance) {
      minDistance = renderedDistance;
    }
  }

  return minDistance;
}

function renderedDistanceToStroke(point: DrawingPoint, stroke: PickableStroke, options: RenderedStrokeHitTestOptions): number {
  if (hasPressureData(stroke)) {
    return renderedDistanceToPressurePen(point, stroke, options);
  }

  if (hasRenderedFill(stroke) && pointInClosedShape(point, stroke)) {
    return 0;
  }

  return Math.sqrt(renderedOutlineDistanceSqPointToStroke(point, stroke)) - targetHalfWidthForStroke(stroke, options);
}

function safeEraserRadius(eraserRadius: number): number {
  return typeof eraserRadius === 'number' && Number.isFinite(eraserRadius) ? Math.max(0, eraserRadius) : 0;
}

function pickRenderedStrokeAtPoint<TStroke extends PickableStroke>(
  point: DrawingPoint,
  strokes: TStroke[],
  options: RenderedStrokeHitTestOptions,
  currentBest: { stroke: TStroke | null; distance: number; strokeIndex: number },
): { stroke: TStroke | null; distance: number; strokeIndex: number } {
  let best = currentBest;

  for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
    const stroke = strokes[strokeIndex];
    const distance = renderedDistanceToStroke(point, stroke, options);
    if (
      distance < best.distance - RENDERED_HIT_EPSILON ||
      (Math.abs(distance - best.distance) <= RENDERED_HIT_EPSILON && strokeIndex < best.strokeIndex)
    ) {
      best = { stroke, distance, strokeIndex };
    }
  }

  return best;
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

export function removeStrokes(value: DrawingValue, strokeIds: readonly string[]): DrawingValue {
  const idsToRemove = new Set(strokeIds);

  return {
    ...value,
    strokes: value.strokes.filter((stroke) => !idsToRemove.has(stroke.id)),
  };
}

export function updateStroke(value: DrawingValue, stroke: DrawingStroke): DrawingValue {
  return {
    ...value,
    strokes: value.strokes.map((s) => (s.id === stroke.id ? stroke : s)),
  };
}

export function updateStrokes(value: DrawingValue, strokes: readonly DrawingStroke[]): DrawingValue {
  const replacementById = new Map(strokes.map((stroke) => [stroke.id, stroke]));

  return {
    ...value,
    strokes: value.strokes.map((stroke) => replacementById.get(stroke.id) ?? stroke),
  };
}

/**
 * 计算当前选中 strokes 的画布坐标选区框。
 *
 * 复用套索命中的 geometry 采样规则，确保 rect/ellipse/polygon/bezier 的边界
 * 与渲染和套索选择使用同一套几何语义。每条 stroke 先按自身 strokeWidth/2
 * 外扩，再把所有有效选中 stroke 合并并追加固定选区 padding。
 */
export function computeSelectionBox(
  strokes: readonly (DrawingStroke | DrawingStrokeV2)[],
  selectedIds: readonly string[],
  options: LassoSelectionOptions = {},
): SelectionBox | null {
  if (strokes.length === 0 || selectedIds.length === 0) {
    return null;
  }

  const resolvedOptions: Required<LassoSelectionOptions> = {
    ellipseSegments: options.ellipseSegments ?? 48,
    bezierSegments: options.bezierSegments ?? 48,
  };
  const selectedIdSet = new Set(selectedIds);
  let unionBBox: BoundingBox | null = null;

  for (const stroke of strokes) {
    if (!selectedIdSet.has(stroke.id)) {
      continue;
    }

    const geometry = buildStrokeSelectionGeometry(stroke, resolvedOptions);
    if (geometry.bbox === null || !isValidBoundingBox(geometry.bbox)) {
      continue;
    }

    // 每条 stroke 用自己的宽度半径外扩，不能退回到当前激活工具宽度。
    const strokeHalfWidth = Math.max(0, stroke.strokeWidth ?? 0) / 2;
    const strokeBBox = expandBoundingBox(geometry.bbox, strokeHalfWidth);

    if (strokeBBox === null || !isValidBoundingBox(strokeBBox)) {
      continue;
    }

    unionBBox = unionBBox === null ? strokeBBox : unionBoundingBoxes(unionBBox, strokeBBox);
  }

  const paddedBBox = expandBoundingBox(unionBBox, SELECTION_BOX_PADDING);
  if (paddedBBox === null || !isValidBoundingBox(paddedBBox)) {
    return null;
  }

  return paddedBBox;
}

export function selectStrokesIntersectingLasso(
  strokes: readonly DrawingStroke[],
  lassoPoints: readonly DrawingPoint[],
  options: LassoSelectionOptions = {},
): string[] {
  // 套索必须至少包含 3 个不同坐标点，否则无法构成有效多边形。
  if (strokes.length === 0 || uniquePointCount(lassoPoints) < 3) {
    return [];
  }

  const resolvedOptions: Required<LassoSelectionOptions> = {
    ellipseSegments: options.ellipseSegments ?? 48,
    bezierSegments: options.bezierSegments ?? 48,
  };
  const lassoPolygon = [...lassoPoints];
  const lassoBBox = boundingBoxForPoints(lassoPolygon);

  if (lassoBBox === null) {
    return [];
  }

  const lassoSegments = closedSegments(lassoPolygon);
  const selectedIds: string[] = [];

  for (const stroke of strokes) {
    const geometry = buildStrokeSelectionGeometry(stroke, resolvedOptions);
    if (geometry.bbox === null) {
      continue;
    }

    // 粗描边（包含 rect/ellipse/polygon 的轮廓）可能只因 strokeWidth 与套索边“擦到”而命中，
    // bbox 需要按半宽外扩避免误剔除。
    const strokeHalfWidth = Math.max(0, stroke.strokeWidth ?? 0) / 2;
    const strokeBBox = expandBoundingBox(geometry.bbox, strokeHalfWidth);

    if (strokeBBox === null || !boundingBoxesOverlap(lassoBBox, strokeBBox)) {
      continue;
    }

    // 条件 A：笔画采样点 / 顶点落在套索多边形内部。
    if (geometry.samples.some((point) => pointInPolygon(point, lassoPolygon))) {
      selectedIds.push(stroke.id);
      continue;
    }

    // 条件 B：套索顶点落在有填充的闭合图形内部，覆盖“套索完全在填充形状里”的情况。
    // 空心图形的内部不可视，不能因内部套索而被误选。
    if (
      geometry.closedShapePoints !== null &&
      hasRenderedFill(stroke) &&
      lassoPolygon.some((point) => lassoPointInsideClosedStroke(point, stroke, geometry.closedShapePoints ?? []))
    ) {
      selectedIds.push(stroke.id);
      continue;
    }

    let intersects = false;
    for (const [strokeStart, strokeEnd] of geometry.segments) {
      for (const [lassoStart, lassoEnd] of lassoSegments) {
        // 条件 C：笔画线段与套索边直接相交。
        if (segmentsIntersect(strokeStart, strokeEnd, lassoStart, lassoEnd)) {
          intersects = true;
          break;
        }

        // 条件 D：所有可见描边按 strokeWidth 半径与套索边做距离命中。
        if (
          strokeHalfWidth > 0 &&
          distanceSqSegmentToSegment(strokeStart, strokeEnd, lassoStart, lassoEnd) < strokeHalfWidth * strokeHalfWidth
        ) {
          intersects = true;
          break;
        }
      }

      if (intersects) {
        break;
      }
    }

    if (intersects) {
      selectedIds.push(stroke.id);
    }
  }

  return selectedIds;
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

/**
 * Returns the first/closest stroke intersected by an eraser sweep while accounting
 * for the target's rendered stroke width. `targetHalfWidth` means half of the
 * width actually painted for the target stroke: non-pressure strokes use
 * `max(0, stroke.strokeWidth ?? fallbackWidth) / 2`; pressure pen segments use
 * `baseWidth * max(normalizePointPressure(a), normalizePointPressure(b)) *
 * pressureMultiplier / 2`. A hit occurs when the centerline/outline distance is
 * `<= eraserRadius + targetHalfWidth`; filled rect/ellipse/polygon interiors
 * keep distance 0 so fill-aware erasing is preserved.
 */
export function pickRenderedStrokeIntersectingSegment<TStroke extends PickableStroke>(
  start: DrawingPoint,
  end: DrawingPoint,
  strokes: TStroke[],
  options: RenderedStrokeHitTestOptions,
): TStroke | null {
  if (strokes.length === 0) {
    return null;
  }

  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
  const eraserRadius = safeEraserRadius(options.eraserRadius);
  const pickStep = Math.max(0.5, eraserRadius / 4);
  const sampleCount = Math.max(1, Math.ceil(segmentLength / pickStep));
  let best = {
    stroke: null as TStroke | null,
    distance: Infinity,
    strokeIndex: Number.POSITIVE_INFINITY,
  };

  for (let i = 0; i <= sampleCount; i++) {
    const t = sampleCount === 0 ? 0 : i / sampleCount;
    const sample = {
      x: start.x + t * (end.x - start.x),
      y: start.y + t * (end.y - start.y),
    };

    best = pickRenderedStrokeAtPoint(sample, strokes, options, best);
  }

  return best.distance <= eraserRadius + RENDERED_HIT_EPSILON ? best.stroke : null;
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

/**
 * Sweeps an eraser polyline using rendered-width-aware thresholds. For each
 * sampled eraser point, `targetHalfWidth` is added to `eraserRadius`; for
 * pressure pen segments, `targetHalfWidth` is recalculated per target segment
 * from the rendered formula `baseWidth * max(segment endpoint pressure) *
 * pressureMultiplier / 2`. Filled closed-shape interiors remain distance 0;
 * unfilled closed shapes use outline distance plus their rendered half-width.
 */
export function pickRenderedStrokeIntersectingPolyline<TStroke extends PickableStroke>(
  points: DrawingPoint[],
  strokes: TStroke[],
  options: RenderedStrokeHitTestOptions,
): TStroke | null {
  if (points.length === 0 || strokes.length === 0) {
    return null;
  }

  const eraserRadius = safeEraserRadius(options.eraserRadius);

  if (points.length === 1) {
    const best = pickRenderedStrokeAtPoint(points[0], strokes, options, {
      stroke: null as TStroke | null,
      distance: Infinity,
      strokeIndex: Number.POSITIVE_INFINITY,
    });
    return best.distance <= eraserRadius + RENDERED_HIT_EPSILON ? best.stroke : null;
  }

  const pickStep = Math.max(0.5, eraserRadius / 4);
  let best = {
    stroke: null as TStroke | null,
    distance: Infinity,
    strokeIndex: Number.POSITIVE_INFINITY,
  };

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

      best = pickRenderedStrokeAtPoint(sample, strokes, options, best);
    }
  }

  return best.distance <= eraserRadius + RENDERED_HIT_EPSILON ? best.stroke : null;
}
