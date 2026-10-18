import type { DrawingPointV2, DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';
import { hitTestNonzeroRings } from './polygonBoolean';

/** 仅用于缺失或退化文字框的世界 DIP 保守回退尺寸。 */
export const TEXT_GEOMETRY_FALLBACK_WIDTH = 160;
/** 文字没有有效高度时，以默认字号的一行高度保持可选中性。 */
export const TEXT_GEOMETRY_FALLBACK_HEIGHT = 28.8;
/** 图片模型没有持久化固有尺寸时使用的世界 DIP 保守回退尺寸。 */
export const IMAGE_GEOMETRY_FALLBACK_WIDTH = 160;
export const IMAGE_GEOMETRY_FALLBACK_HEIGHT = 120;

/** 世界 DIP 坐标点；geometry 不认识相机、设备像素或渲染器坐标。 */
export type GeometryPoint = Readonly<{
  x: number;
  y: number;
}>;

/** 轴对齐且闭合的世界 DIP 包围框。 */
export type GeometryBounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}>;

/**
 * 可审计的 V2 笔迹几何描述。bounds 与 hit 均只从这个描述派生，避免两个入口随时间
 * 演化出不同的工具语义。
 */
export type DrawingGeometryDescriptor =
  | Readonly<{
      kind: 'path';
      points: readonly GeometryPoint[];
      closed: boolean;
    }>
  | Readonly<{
      kind: 'cubic-bezier';
      points: readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint];
    }>
  | Readonly<{
      kind: 'rect';
      center: GeometryPoint;
      halfWidth: number;
      halfHeight: number;
      rotationRad: number;
    }>
  | Readonly<{
      kind: 'ellipse';
      center: GeometryPoint;
      radiusX: number;
      radiusY: number;
      rotationRad: number;
    }>;

/**
 * 默认轮廓的源曲线到输出折线最大偏差（世界 DIP）。这个固定世界单位使渲染和命中
 * 无须了解设备像素或视口缩放；调用方若需要屏幕恒定的误差，应先自行换算为世界 DIP。
 */
export const DEFAULT_DRAWING_CONTOUR_MAX_DEVIATION = 0.25;

/**
 * 单个参数曲线生成的折线段硬上限。path 本身已是用户提供的折线，不会复制或重采样。
 */
export const MAX_DRAWING_CONTOUR_SEGMENTS = 65_536;

export type DrawingGeometryContourOptions = Readonly<{
  /** 要求的源曲线到折线最大偏差，缺省为 DEFAULT_DRAWING_CONTOUR_MAX_DEVIATION。 */
  maxDeviation?: number;
  /** 段上限，闭合轮廓至少需要 4，且不能超过 MAX_DRAWING_CONTOUR_SEGMENTS。 */
  maxSegments?: number;
}>;

/**
 * renderer 与 hit 共享的可绘制折线。
 *
 * maxDeviation 是保守的“原始参数曲线 -> 此折线”距离上界：cubic 使用控制点到叶子弦的
 * 凸包上界，ellipse 使用每段的精确 sagitta。它不是双向 Hausdorff 距离。capped 为 true
 * 时上限先于 requestedMaxDeviation 达到，maxDeviation 仍是实际输出的明确保守上界。
 */
export type DrawingGeometryContour = Readonly<{
  points: readonly GeometryPoint[];
  closed: boolean;
  maxDeviation: number;
  requestedMaxDeviation: number;
  isWithinRequestedMaxDeviation: boolean;
  capped: boolean;
}>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(point: DrawingPointV2 | undefined): point is DrawingPointV2 {
  return point !== undefined && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function copyPoint(point: DrawingPointV2): GeometryPoint {
  return { x: point.x, y: point.y };
}

function pointsAreFinite(points: readonly DrawingPointV2[]): boolean {
  return points.every(isFinitePoint);
}

function samePoint(a: GeometryPoint, b: GeometryPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function hasNonCollinearPoint(points: readonly GeometryPoint[]): boolean {
  const first = points[0];
  const second = points.find((point) => !samePoint(point, first));
  if (!second) {
    return false;
  }

  return points.some(
    (point) =>
      (second.x - first.x) * (point.y - first.y) !== (second.y - first.y) * (point.x - first.x)
  );
}

function resolvedRotation(rotationRad: number | undefined): number | null {
  if (rotationRad === undefined) {
    return 0;
  }
  return isFiniteNumber(rotationRad) ? rotationRad : null;
}

function midpoint(a: number, b: number): number | null {
  // 分半后相加避免两个同号的大有限数在中间加法中溢出。
  const value = a / 2 + b / 2;
  return isFiniteNumber(value) ? value : null;
}

function descriptorForBox(
  kind: 'rect' | 'ellipse',
  start: GeometryPoint,
  end: GeometryPoint,
  rotationRad: number,
  fallbackSize: readonly [number, number] | null
): DrawingGeometryDescriptor | null {
  let width = Math.abs(end.x - start.x);
  let height = Math.abs(end.y - start.y);
  const centerX = midpoint(start.x, end.x);
  const centerY = midpoint(start.y, end.y);
  if (centerX === null || centerY === null || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    if (fallbackSize === null) {
      return null;
    }
    [width, height] = fallbackSize;
  }

  const horizontal = width / 2;
  const vertical = height / 2;
  if (
    !isFiniteNumber(horizontal) ||
    !isFiniteNumber(vertical) ||
    horizontal <= 0 ||
    vertical <= 0
  ) {
    return null;
  }

  return kind === 'rect'
    ? {
        kind,
        center: { x: centerX, y: centerY },
        halfWidth: horizontal,
        halfHeight: vertical,
        rotationRad,
      }
    : {
        kind,
        center: { x: centerX, y: centerY },
        radiusX: horizontal,
        radiusY: vertical,
        rotationRad,
      };
}

function fallbackBoxAnchor(points: readonly DrawingPointV2[]): GeometryPoint | null {
  // 空 text/image 没有锚点时固定落在世界原点，保证跨端和跨调用次序的稳定性。
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  return isFinitePoint(points[0]) ? copyPoint(points[0]) : null;
}

function descriptorForFallbackBox(
  kind: 'rect',
  points: readonly DrawingPointV2[],
  rotationRad: number,
  size: readonly [number, number]
): DrawingGeometryDescriptor | null {
  const anchor = fallbackBoxAnchor(points);
  if (anchor === null) {
    return null;
  }
  const end = { x: anchor.x + size[0], y: anchor.y + size[1] };
  return isFinitePoint(end) ? descriptorForBox(kind, anchor, end, rotationRad, null) : null;
}

/**
 * 建立单条 V2 stroke 的唯一 geometry descriptor。
 *
 * pen、line、polygon 与 bezier 保留其路径/控制点语义；矩形类工具以首末点组成的框为
 * 基础并绕框中心旋转。text/image 缺点或没有正尺寸时分别采用上方导出的稳定回退框。
 */
export function describeDrawingStrokeGeometry(
  stroke: DrawingStrokeV2
): DrawingGeometryDescriptor | null {
  const { points } = stroke;
  if (!pointsAreFinite(points)) {
    return null;
  }

  if (stroke.tool === 'pen') {
    const path = points.map(copyPoint);
    return path.length >= 2 && path.some((point) => !samePoint(point, path[0]))
      ? { kind: 'path', points: path, closed: false }
      : null;
  }

  if (stroke.tool === 'line') {
    const first = points[0];
    const last = points[points.length - 1];
    return first && last && !samePoint(first, last)
      ? { kind: 'path', points: [copyPoint(first), copyPoint(last)], closed: false }
      : null;
  }

  if (stroke.tool === 'polygon') {
    const path = points.map(copyPoint);
    return path.length >= 3 && hasNonCollinearPoint(path)
      ? { kind: 'path', points: path, closed: true }
      : null;
  }

  if (stroke.tool === 'bezier') {
    if (points.length !== 4) {
      return null;
    }
    const controls = points.map(copyPoint) as [
      GeometryPoint,
      GeometryPoint,
      GeometryPoint,
      GeometryPoint,
    ];
    return samePoint(controls[0], controls[3]) && !hasNonCollinearPoint(controls)
      ? null
      : { kind: 'cubic-bezier', points: controls };
  }

  const rotationRad = resolvedRotation(stroke.rotationRad);
  if (rotationRad === null) {
    return null;
  }

  if (stroke.tool === 'rect' || stroke.tool === 'ellipse') {
    const first = points[0];
    const last = points[points.length - 1];
    return first && last
      ? descriptorForBox(stroke.tool, copyPoint(first), copyPoint(last), rotationRad, null)
      : null;
  }

  const fallbackSize =
    stroke.tool === 'text'
      ? ([TEXT_GEOMETRY_FALLBACK_WIDTH, TEXT_GEOMETRY_FALLBACK_HEIGHT] as const)
      : ([IMAGE_GEOMETRY_FALLBACK_WIDTH, IMAGE_GEOMETRY_FALLBACK_HEIGHT] as const);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return descriptorForFallbackBox('rect', points, rotationRad, fallbackSize);
  }

  // 回退框从首点向右下展开；这样单点、重合首末点及空点三种输入均有可预测锚点。
  if (first.x === last.x || first.y === last.y) {
    return descriptorForFallbackBox('rect', points, rotationRad, fallbackSize);
  }
  return descriptorForBox('rect', copyPoint(first), copyPoint(last), rotationRad, null);
}

function rotate(
  point: GeometryPoint,
  center: GeometryPoint,
  rotationRad: number
): GeometryPoint | null {
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  const x = center.x + point.x * cosine - point.y * sine;
  const y = center.y + point.x * sine + point.y * cosine;
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : null;
}

function boundsForPoints(points: readonly GeometryPoint[]): GeometryBounds | null {
  if (
    points.length === 0 ||
    !points.every((point) => isFiniteNumber(point.x) && isFiniteNumber(point.y))
  ) {
    return null;
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  return [minX, minY, maxX, maxY, width, height].every(isFiniteNumber)
    ? { minX, minY, maxX, maxY, width, height }
    : null;
}

/** 从 descriptor 获取保守轴对齐 bounds；不接受原始 stroke，保证来源唯一。 */
export function getDrawingGeometryBounds(
  descriptor: DrawingGeometryDescriptor
): GeometryBounds | null {
  if (descriptor.kind === 'path' || descriptor.kind === 'cubic-bezier') {
    return boundsForPoints(descriptor.points);
  }

  if (descriptor.kind === 'rect') {
    const corners = [
      { x: -descriptor.halfWidth, y: -descriptor.halfHeight },
      { x: descriptor.halfWidth, y: -descriptor.halfHeight },
      { x: descriptor.halfWidth, y: descriptor.halfHeight },
      { x: -descriptor.halfWidth, y: descriptor.halfHeight },
    ]
      .map((point) => rotate(point, descriptor.center, descriptor.rotationRad))
      .filter((point): point is GeometryPoint => point !== null);
    return corners.length === 4 ? boundsForPoints(corners) : null;
  }

  const cosine = Math.cos(descriptor.rotationRad);
  const sine = Math.sin(descriptor.rotationRad);
  const horizontal = Math.sqrt(
    descriptor.radiusX * descriptor.radiusX * cosine * cosine +
      descriptor.radiusY * descriptor.radiusY * sine * sine
  );
  const vertical = Math.sqrt(
    descriptor.radiusX * descriptor.radiusX * sine * sine +
      descriptor.radiusY * descriptor.radiusY * cosine * cosine
  );
  return boundsForPoints([
    { x: descriptor.center.x - horizontal, y: descriptor.center.y - vertical },
    { x: descriptor.center.x + horizontal, y: descriptor.center.y + vertical },
  ]);
}

/** 由 V2 stroke 的唯一 descriptor 派生其保守世界 DIP bounds。 */
export function getDrawingStrokeBounds(stroke: DrawingStrokeV2): GeometryBounds | null {
  const descriptor = describeDrawingStrokeGeometry(stroke);
  return descriptor === null ? null : getDrawingGeometryBounds(descriptor);
}

function distanceSquaredToSegment(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!isFiniteNumber(lengthSquared) || lengthSquared <= 0) {
    return Infinity;
  }
  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  const distanceX = point.x - (start.x + dx * progress);
  const distanceY = point.y - (start.y + dy * progress);
  const result = distanceX * distanceX + distanceY * distanceY;
  return isFiniteNumber(result) ? result : Infinity;
}

function distanceToChord(point: GeometryPoint, start: GeometryPoint, end: GeometryPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!isFiniteNumber(lengthSquared)) {
    return Infinity;
  }
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  const distance = Math.hypot(
    point.x - (start.x + dx * progress),
    point.y - (start.y + dy * progress)
  );
  return isFiniteNumber(distance) ? distance : Infinity;
}

function cubicFlatness(
  points: readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint]
): number {
  // Bézier 曲线在四个控制点的凸包内；到线段的距离是凸函数，故两个内控制点到叶子弦
  // 的最大距离是整段曲线到该弦的保守上界，也适用于首末点重合的退化弦。
  return Math.max(
    distanceToChord(points[1], points[0], points[3]),
    distanceToChord(points[2], points[0], points[3])
  );
}

function splitCubic(
  points: readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint]
):
  | readonly [
      readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint],
      readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint],
    ]
  | null {
  const firstX = midpoint(points[0].x, points[1].x);
  const firstY = midpoint(points[0].y, points[1].y);
  const secondX = midpoint(points[1].x, points[2].x);
  const secondY = midpoint(points[1].y, points[2].y);
  const thirdX = midpoint(points[2].x, points[3].x);
  const thirdY = midpoint(points[2].y, points[3].y);
  if (
    firstX === null ||
    firstY === null ||
    secondX === null ||
    secondY === null ||
    thirdX === null ||
    thirdY === null
  ) {
    return null;
  }
  const firstControl = { x: firstX, y: firstY };
  const thirdControl = { x: thirdX, y: thirdY };
  const leftX = midpoint(firstX, secondX);
  const leftY = midpoint(firstY, secondY);
  const rightX = midpoint(secondX, thirdX);
  const rightY = midpoint(secondY, thirdY);
  if (leftX === null || leftY === null || rightX === null || rightY === null) {
    return null;
  }
  const leftMiddle = { x: leftX, y: leftY };
  const rightMiddle = { x: rightX, y: rightY };
  const middleX = midpoint(leftX, rightX);
  const middleY = midpoint(leftY, rightY);
  if (middleX === null || middleY === null) {
    return null;
  }
  const middle = { x: middleX, y: middleY };
  return [
    [points[0], firstControl, leftMiddle, middle],
    [middle, rightMiddle, thirdControl, points[3]],
  ];
}

type CubicContourPiece = Readonly<{
  points: readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint];
  flatness: number;
}>;

function appendCubicContour(
  controls: readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint],
  requestedMaxDeviation: number,
  maxSegments: number
): DrawingGeometryContour | null {
  const initialFlatness = cubicFlatness(controls);
  if (!isFiniteNumber(initialFlatness)) {
    return null;
  }
  const points: GeometryPoint[] = [controls[0]];
  const pending: CubicContourPiece[] = [{ points: controls, flatness: initialFlatness }];
  let actualMaxDeviation = 0;
  let capped = false;

  // 显式 LIFO 栈避免递归深度依赖；每次分裂把左段后压，因而输出仍按 t 递增排列。
  while (pending.length > 0) {
    const piece = pending.pop()!;
    if (
      piece.flatness <= requestedMaxDeviation ||
      points.length - 1 + pending.length + 1 >= maxSegments
    ) {
      capped ||= piece.flatness > requestedMaxDeviation;
      actualMaxDeviation = Math.max(actualMaxDeviation, piece.flatness);
      points.push(piece.points[3]);
      continue;
    }
    const split = splitCubic(piece.points);
    if (split === null) {
      return null;
    }
    const leftFlatness = cubicFlatness(split[0]);
    const rightFlatness = cubicFlatness(split[1]);
    if (!isFiniteNumber(leftFlatness) || !isFiniteNumber(rightFlatness)) {
      return null;
    }
    pending.push(
      { points: split[1], flatness: rightFlatness },
      { points: split[0], flatness: leftFlatness }
    );
  }
  return {
    points,
    closed: false,
    maxDeviation: actualMaxDeviation,
    requestedMaxDeviation,
    isWithinRequestedMaxDeviation: !capped,
    capped,
  };
}

function ellipsePoint(
  center: GeometryPoint,
  radiusX: number,
  radiusY: number,
  rotationRad: number,
  angle: number
): GeometryPoint | null {
  return rotate(
    { x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle) },
    center,
    rotationRad
  );
}

function ellipseSegmentCount(radius: number, maxDeviation: number): number {
  if (radius <= maxDeviation) {
    return 4;
  }
  const maxAngle = 2 * Math.acos(Math.max(-1, 1 - maxDeviation / radius));
  return Math.max(4, Math.ceil((2 * Math.PI) / maxAngle));
}

/**
 * 从 descriptor 建立 renderer 与 hit 共用的有限轮廓。cubic 是自适应 de Casteljau
 * 分裂；ellipse 按最大半径的 sagitta 选择段数，因此旋转和长短轴都不会降低误差保证。
 *
 * cap 仅保护直接调用 API 的资源上限；frame 会以局部分支裁剪和更高安全预算完成普通可见
 * 曲线，不能因这里的历史 1024 限制丢弃可见对象。
 */
export function describeDrawingGeometryContour(
  descriptor: DrawingGeometryDescriptor,
  options: DrawingGeometryContourOptions = {}
): DrawingGeometryContour | null {
  const requestedMaxDeviation = options.maxDeviation ?? DEFAULT_DRAWING_CONTOUR_MAX_DEVIATION;
  const maxSegments = options.maxSegments ?? MAX_DRAWING_CONTOUR_SEGMENTS;
  if (
    !isFiniteNumber(requestedMaxDeviation) ||
    requestedMaxDeviation <= 0 ||
    !Number.isInteger(maxSegments) ||
    maxSegments < 4 ||
    maxSegments > MAX_DRAWING_CONTOUR_SEGMENTS
  ) {
    return null;
  }
  if (descriptor.kind === 'path') {
    if (
      descriptor.points.length < 2 ||
      !descriptor.points.every((point) => isFiniteNumber(point.x) && isFiniteNumber(point.y))
    ) {
      return null;
    }
    return {
      points: descriptor.points,
      closed: descriptor.closed,
      maxDeviation: 0,
      requestedMaxDeviation,
      isWithinRequestedMaxDeviation: true,
      capped: false,
    };
  }
  if (descriptor.kind === 'cubic-bezier') {
    if (!descriptor.points.every((point) => isFiniteNumber(point.x) && isFiniteNumber(point.y))) {
      return null;
    }
    return appendCubicContour(descriptor.points, requestedMaxDeviation, maxSegments);
  }
  if (descriptor.kind === 'rect') {
    if (
      !isFiniteNumber(descriptor.center.x) ||
      !isFiniteNumber(descriptor.center.y) ||
      !isFiniteNumber(descriptor.halfWidth) ||
      !isFiniteNumber(descriptor.halfHeight) ||
      !isFiniteNumber(descriptor.rotationRad) ||
      descriptor.halfWidth <= 0 ||
      descriptor.halfHeight <= 0
    ) {
      return null;
    }
    const corners = [
      { x: -descriptor.halfWidth, y: -descriptor.halfHeight },
      { x: descriptor.halfWidth, y: -descriptor.halfHeight },
      { x: descriptor.halfWidth, y: descriptor.halfHeight },
      { x: -descriptor.halfWidth, y: descriptor.halfHeight },
    ].map((point) => rotate(point, descriptor.center, descriptor.rotationRad));
    return corners.every((point): point is GeometryPoint => point !== null)
      ? {
          points: corners,
          closed: true,
          maxDeviation: 0,
          requestedMaxDeviation,
          isWithinRequestedMaxDeviation: true,
          capped: false,
        }
      : null;
  }

  const radius = Math.max(descriptor.radiusX, descriptor.radiusY);
  if (
    !isFiniteNumber(descriptor.center.x) ||
    !isFiniteNumber(descriptor.center.y) ||
    !isFiniteNumber(descriptor.radiusX) ||
    !isFiniteNumber(descriptor.radiusY) ||
    !isFiniteNumber(descriptor.rotationRad) ||
    !isFiniteNumber(radius) ||
    descriptor.radiusX <= 0 ||
    descriptor.radiusY <= 0 ||
    radius <= 0
  ) {
    return null;
  }
  const requiredSegments = ellipseSegmentCount(radius, requestedMaxDeviation);
  const segmentCount = Math.min(requiredSegments, maxSegments);
  if (segmentCount < 4) {
    return null;
  }
  const actualMaxDeviation = radius * (1 - Math.cos(Math.PI / segmentCount));
  const points: GeometryPoint[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const point = ellipsePoint(
      descriptor.center,
      descriptor.radiusX,
      descriptor.radiusY,
      descriptor.rotationRad,
      (2 * Math.PI * index) / segmentCount
    );
    if (point === null) {
      return null;
    }
    points.push(point);
  }
  return {
    points,
    closed: true,
    maxDeviation: actualMaxDeviation,
    requestedMaxDeviation,
    isWithinRequestedMaxDeviation: segmentCount === requiredSegments,
    capped: segmentCount !== requiredSegments,
  };
}

/**
 * 使用公开共享轮廓命中世界 DIP 点。tolerance 是轮廓边界的额外世界 DIP 外扩距离；
 * closed 轮廓的内部恒命中。轮廓近似误差由 describeDrawingGeometryContour 明确返回，
 * 因此 caller 可审计“命中折线”和后续 renderer 应绘制的同一几何。
 */
export function hitTestDrawingGeometry(
  descriptor: DrawingGeometryDescriptor,
  point: GeometryPoint,
  tolerance: number
): boolean {
  if (
    !isFiniteNumber(point.x) ||
    !isFiniteNumber(point.y) ||
    !isFiniteNumber(tolerance) ||
    tolerance < 0
  ) {
    return false;
  }
  const toleranceSquared = tolerance * tolerance;
  if (!isFiniteNumber(toleranceSquared)) {
    return false;
  }

  const contour = describeDrawingGeometryContour(descriptor);
  if (contour === null || contour.points.length < 2) {
    return false;
  }

  const segmentCount = contour.closed ? contour.points.length : contour.points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    if (
      distanceSquaredToSegment(
        point,
        contour.points[index],
        contour.points[(index + 1) % contour.points.length]
      ) <= toleranceSquared
    ) {
      return true;
    }
  }
  return contour.closed ? hitTestNonzeroRings([contour.points], point, 0) : false;
}

/** 由 V2 stroke 的唯一 descriptor 命中世界 DIP 点。 */
export function hitTestDrawingStroke(
  stroke: DrawingStrokeV2,
  point: GeometryPoint,
  tolerance: number
): boolean {
  const descriptor = describeDrawingStrokeGeometry(stroke);
  return descriptor !== null && hitTestDrawingGeometry(descriptor, point, tolerance);
}

/** 文档命中结果保留索引，方便调用方在重复 ID 的有序文档中无歧义定位条目。 */
export type DrawingDocumentHit = Readonly<{
  stroke: DrawingStrokeV2;
  index: number;
}>;

/** 按 document 顺序倒序检查，因此最后命中的笔迹是视觉上的 topmost。 */
export function hitTestDrawingDocument(
  document: DrawingValueV2,
  point: GeometryPoint,
  tolerance: number
): DrawingDocumentHit | null {
  for (let index = document.strokes.length - 1; index >= 0; index -= 1) {
    const stroke = document.strokes[index];
    if (hitTestDrawingStroke(stroke, point, tolerance)) {
      return { stroke, index };
    }
  }
  return null;
}
