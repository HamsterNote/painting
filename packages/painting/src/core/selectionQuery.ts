import {
  describeDrawingGeometryContour,
  describeDrawingStrokeGeometry,
  getDrawingGeometryBounds,
  hitTestDrawingGeometry,
  type DrawingGeometryContour,
  type GeometryBounds,
  type GeometryPoint,
} from './geometry';
import type { DrawingFrameFragment, FrameResourceBoxFragment } from './frameClipping';
import {
  canonicalizeClosedRing,
  classifyClosedRing,
  hitTestNonzeroRings,
  type PolygonBooleanPolygon,
} from './polygonBoolean';
import type { DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';

/** 以文档索引而非 ID 定位目标，因此重复 ID 不会产生歧义。 */
export type DocumentStrokeTarget = Readonly<{
  index: number;
  stroke: DrawingStrokeV2;
}>;

/** 查询不会修改文档；无法安全解释的输入只以诊断报告并跳过。 */
export type SelectionQueryDiagnostic =
  | Readonly<{ type: 'invalid-lasso-polygon' }>
  | Readonly<{ type: 'invalid-eraser-samples' }>
  | Readonly<{ type: 'invalid-eraser-radius' }>
  | Readonly<{ type: 'unsupported-stroke-tool'; index: number }>
  | Readonly<{ type: 'unsupported-stroke-geometry'; index: number }>
  | Readonly<{ type: 'contour-capped'; index: number }>
  | Readonly<{ type: 'invalid-frame-query-revision' }>
  | Readonly<{ type: 'frame-revision-mismatch'; frameRevision: number; expectedRevision: number }>
  | Readonly<{ type: 'invalid-frame-query-coordinate-space' }>;

export type DocumentStrokeTargetQuery = Readonly<{
  targets: readonly DocumentStrokeTarget[];
  diagnostics: readonly SelectionQueryDiagnostic[];
}>;

export type EraserTargetQueryOptions = Readonly<{
  /** true 时只返回最后一个命中的文档条目；缺省返回全部命中条目。 */
  topmostOnly?: boolean;
}>;

/** frame 查询只返回稳定文档定位信息，不将 prepared 的原始 stroke 重新暴露为几何输入。 */
export type DrawingFrameTarget = Readonly<{
  index: number;
  id: string;
  tool: DrawingStrokeV2['tool'];
}>;

export type DrawingFrameTargetQuery = Readonly<{
  targets: readonly DrawingFrameTarget[];
  diagnostics: readonly SelectionQueryDiagnostic[];
}>;

export type DrawingFrameQueryCoordinateSpace = 'world' | 'screen';

/**
 * frame 由 renderer 在某个 document revision 产出。调用者必须同时提供该 revision 与当前要
 * 消费的 revision；不相同的 frame 永远只产生空目标。坐标会一次映射到 frame local DIP，之后
 * 查询只读取 renderable entry 的 program/semantic region。
 */
export type DrawingFrameTargetQueryOptions = Readonly<{
  frameRevision: number;
  expectedRevision: number;
  coordinateSpace?: DrawingFrameQueryCoordinateSpace;
}>;

/**
 * 查询所需的 DrawingFrame 最小只读投影。故意不导入 drawingFrame，避免 selectionQuery 反向带入
 * viewport 实现；完整 `DrawingFrame` 在结构上满足此接口，且查询不会读取其余任何字段。
 */
export type DrawingFrameRenderableQueryInput = Readonly<{
  frameOrigin: GeometryPoint;
  localToScreen: Readonly<{ a: number; b: number; c: number; d: number; tx: number; ty: number }>;
  renderableEntries: readonly DrawingFrameRenderableQueryEntry[];
}>;

type DrawingFrameRenderableQueryEntry = Readonly<{
  source: Readonly<{ key: number; stroke: DrawingStrokeV2 }>;
  status: 'unchanged' | 'rebased' | 'clipped' | 'segmented' | 'empty' | 'pending' | 'unresolved';
  fragments: readonly DrawingFrameFragment[];
  program: Readonly<{
    strokes: readonly Readonly<{ points: readonly GeometryPoint[]; closed: boolean }>[];
    fills: readonly Readonly<{
      polygons: readonly Readonly<{
        outer: readonly GeometryPoint[];
        holes: readonly (readonly GeometryPoint[])[];
      }>[];
    }>[];
  }>;
}>;

type CanonicalLasso = Readonly<{
  polygons: readonly PolygonBooleanPolygon[];
  bounds: GeometryBounds;
}>;

const supportedStrokeTools: readonly DrawingStrokeV2['tool'][] = [
  'pen',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
  'text',
  'image',
];

function isFinitePoint(point: GeometryPoint | undefined): point is GeometryPoint {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isSupportedStrokeTool(tool: unknown): tool is DrawingStrokeV2['tool'] {
  return supportedStrokeTools.includes(tool as DrawingStrokeV2['tool']);
}

function hasUsableDocument(document: DrawingValueV2): boolean {
  return Array.isArray(document?.strokes);
}

function boundsForPoints(points: readonly GeometryPoint[]): GeometryBounds | null {
  if (points.length === 0 || !points.every(isFinitePoint)) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  return [minX, minY, maxX, maxY, width, height].every(Number.isFinite)
    ? { minX, minY, maxX, maxY, width, height }
    : null;
}

function boundsOverlap(first: GeometryBounds, second: GeometryBounds, padding = 0): boolean {
  return (
    first.minX <= second.maxX + padding &&
    first.maxX + padding >= second.minX &&
    first.minY <= second.maxY + padding &&
    first.maxY + padding >= second.minY
  );
}

function orientation(first: GeometryPoint, second: GeometryPoint, third: GeometryPoint): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function pointOnSegment(
  first: GeometryPoint,
  point: GeometryPoint,
  second: GeometryPoint
): boolean {
  return (
    point.x >= Math.min(first.x, second.x) &&
    point.x <= Math.max(first.x, second.x) &&
    point.y >= Math.min(first.y, second.y) &&
    point.y <= Math.max(first.y, second.y)
  );
}

/** 仅用于轮廓与套索边界的保守接触判断，布尔区域的规范化仍委托 polygonBoolean。 */
function segmentsIntersect(
  first: GeometryPoint,
  second: GeometryPoint,
  third: GeometryPoint,
  fourth: GeometryPoint
): boolean {
  const firstThird = orientation(first, second, third);
  const firstFourth = orientation(first, second, fourth);
  const thirdFirst = orientation(third, fourth, first);
  const thirdSecond = orientation(third, fourth, second);
  if (firstThird === 0 && pointOnSegment(first, third, second)) return true;
  if (firstFourth === 0 && pointOnSegment(first, fourth, second)) return true;
  if (thirdFirst === 0 && pointOnSegment(third, first, fourth)) return true;
  if (thirdSecond === 0 && pointOnSegment(third, second, fourth)) return true;
  return firstThird > 0 !== firstFourth > 0 && thirdFirst > 0 !== thirdSecond > 0;
}

function distanceSquaredToSegment(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint
): number {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const lengthSquared = x * x + y * y;
  if (!Number.isFinite(lengthSquared)) return Infinity;
  if (lengthSquared === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * x + (point.y - start.y) * y) / lengthSquared)
  );
  return (point.x - (start.x + x * progress)) ** 2 + (point.y - (start.y + y * progress)) ** 2;
}

function segmentsDistanceSquared(
  first: GeometryPoint,
  second: GeometryPoint,
  third: GeometryPoint,
  fourth: GeometryPoint
): number {
  if (segmentsIntersect(first, second, third, fourth)) return 0;
  return Math.min(
    distanceSquaredToSegment(first, third, fourth),
    distanceSquaredToSegment(second, third, fourth),
    distanceSquaredToSegment(third, first, second),
    distanceSquaredToSegment(fourth, first, second)
  );
}

function pointsInContour(
  contour: DrawingGeometryContour
): readonly [GeometryPoint, GeometryPoint][] {
  const segmentCount = contour.closed ? contour.points.length : contour.points.length - 1;
  const segments: [GeometryPoint, GeometryPoint][] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    segments.push([contour.points[index], contour.points[(index + 1) % contour.points.length]]);
  }
  return segments;
}

function canonicalLasso(points: readonly GeometryPoint[]): CanonicalLasso | null {
  if (points.length < 3 || !points.every(isFinitePoint) || classifyClosedRing(points) === null)
    return null;
  const canonical = canonicalizeClosedRing(points);
  if (!canonical.ok || canonical.polygons.length === 0) return null;
  const allPoints = canonical.polygons
    .flatMap((polygon) => [polygon.outer, ...polygon.holes])
    .flat();
  const bounds = boundsForPoints(allPoints);
  return bounds === null ? null : { polygons: canonical.polygons, bounds };
}

function lassoContainsPoint(lasso: CanonicalLasso, point: GeometryPoint): boolean {
  return lasso.polygons.some(
    (polygon) =>
      hitTestNonzeroRings([polygon.outer], point, 0) &&
      !polygon.holes.some((hole) => hitTestNonzeroRings([hole], point, 0))
  );
}

function contourIntersectsLasso(contour: DrawingGeometryContour, lasso: CanonicalLasso): boolean {
  const contourSegments = pointsInContour(contour);
  return lasso.polygons.some((polygon) => {
    const lassoRings = [polygon.outer, ...polygon.holes];
    return lassoRings.some((ring) => {
      for (let index = 0; index < ring.length; index += 1) {
        const lassoStart = ring[index];
        const lassoEnd = ring[(index + 1) % ring.length];
        if (
          contourSegments.some(([start, end]) =>
            segmentsIntersect(start, end, lassoStart, lassoEnd)
          )
        )
          return true;
      }
      return false;
    });
  });
}

function contourMatchesLasso(
  contour: DrawingGeometryContour,
  descriptor: NonNullable<ReturnType<typeof describeDrawingStrokeGeometry>>,
  lasso: CanonicalLasso
): boolean {
  if (contour.points.some((point) => lassoContainsPoint(lasso, point))) return true;
  if (contourIntersectsLasso(contour, lasso)) return true;

  // 闭合对象可能完整包住 lasso，边界与 lasso 都不会相交；此时以 lasso 外环点探测对象填充。
  return (
    contour.closed &&
    lasso.polygons.some((polygon) =>
      polygon.outer.some((point) => hitTestDrawingGeometry(descriptor, point, 0))
    )
  );
}

/**
 * 查询与 world-DIP lasso 接触、被其包住或完整包住它的 V2 文档对象。
 *
 * 简单与复杂 lasso 都先由 polygonBoolean 规范化；如果某个曲线轮廓达到资源上限，返回其
 * bounds 相交的保守候选并报告 contour-capped，避免在选择阶段无声漏选。
 */
export function queryLassoStrokeTargets(
  document: DrawingValueV2,
  lassoPolygon: readonly GeometryPoint[]
): DocumentStrokeTargetQuery {
  const lasso = canonicalLasso(lassoPolygon);
  if (lasso === null || !hasUsableDocument(document)) {
    return { targets: [], diagnostics: [{ type: 'invalid-lasso-polygon' }] };
  }

  const diagnostics: SelectionQueryDiagnostic[] = [];
  const targets: DocumentStrokeTarget[] = [];
  document.strokes.forEach((stroke, index) => {
    if (!isSupportedStrokeTool(stroke.tool)) {
      diagnostics.push({ type: 'unsupported-stroke-tool', index });
      return;
    }
    const descriptor = describeDrawingStrokeGeometry(stroke);
    const bounds = descriptor === null ? null : getDrawingGeometryBounds(descriptor);
    if (descriptor === null || bounds === null) {
      diagnostics.push({ type: 'unsupported-stroke-geometry', index });
      return;
    }
    if (!boundsOverlap(bounds, lasso.bounds)) return;

    const contour = describeDrawingGeometryContour(descriptor);
    if (contour === null) {
      diagnostics.push({ type: 'unsupported-stroke-geometry', index });
      return;
    }
    if (contour.capped) {
      diagnostics.push({ type: 'contour-capped', index });
      targets.push({ index, stroke });
      return;
    }
    if (contourMatchesLasso(contour, descriptor, lasso)) targets.push({ index, stroke });
  });
  return { targets, diagnostics };
}

function trackSegments(
  samples: readonly GeometryPoint[]
): readonly [GeometryPoint, GeometryPoint][] {
  if (samples.length === 1) return [[samples[0], samples[0]]];
  const segments: [GeometryPoint, GeometryPoint][] = [];
  for (let index = 1; index < samples.length; index += 1)
    segments.push([samples[index - 1], samples[index]]);
  return segments;
}

function contourMatchesEraser(
  contour: DrawingGeometryContour,
  descriptor: NonNullable<ReturnType<typeof describeDrawingStrokeGeometry>>,
  samples: readonly GeometryPoint[],
  radius: number
): boolean {
  // 闭合填充的内部属于对象几何，端点落入内部时无需依赖轮廓距离。
  if (contour.closed && samples.some((sample) => hitTestDrawingGeometry(descriptor, sample, 0)))
    return true;
  const radiusSquared = radius * radius;
  return trackSegments(samples).some(([eraserStart, eraserEnd]) =>
    pointsInContour(contour).some(
      ([strokeStart, strokeEnd]) =>
        segmentsDistanceSquared(eraserStart, eraserEnd, strokeStart, strokeEnd) <= radiusSquared
    )
  );
}

function isFrameResourceBoxFragment(
  fragment: DrawingFrameFragment
): fragment is FrameResourceBoxFragment {
  return fragment.kind === 'semantic-area' && 'resourceBox' in fragment;
}

function isInteractiveFrameEntry(entry: DrawingFrameRenderableQueryEntry): boolean {
  // renderableEntries 理论上已排除这些状态；再次显式收窄是查询 API 的安全边界。
  return (
    entry.status === 'unchanged' ||
    entry.status === 'rebased' ||
    entry.status === 'clipped' ||
    entry.status === 'segmented'
  );
}

function frameTarget(entry: DrawingFrameRenderableQueryEntry): DrawingFrameTarget {
  return Object.freeze({
    index: entry.source.key,
    id: entry.source.stroke.id,
    tool: entry.source.stroke.tool,
  });
}

function validFrameRevision(
  options: DrawingFrameTargetQueryOptions
): SelectionQueryDiagnostic | null {
  if (
    !Number.isSafeInteger(options.frameRevision) ||
    options.frameRevision < 0 ||
    !Number.isSafeInteger(options.expectedRevision) ||
    options.expectedRevision < 0
  ) {
    return { type: 'invalid-frame-query-revision' };
  }
  return options.frameRevision === options.expectedRevision
    ? null
    : {
        type: 'frame-revision-mismatch',
        frameRevision: options.frameRevision,
        expectedRevision: options.expectedRevision,
      };
}

function localFramePoints(
  frame: DrawingFrameRenderableQueryInput,
  points: readonly GeometryPoint[],
  coordinateSpace: DrawingFrameQueryCoordinateSpace
): readonly GeometryPoint[] | null {
  if (!points.every(isFinitePoint)) return null;
  if (coordinateSpace === 'world') {
    const local = points.map((point) => ({
      x: point.x - frame.frameOrigin.x,
      y: point.y - frame.frameOrigin.y,
    }));
    return local.every(isFinitePoint) ? local : null;
  }
  if (coordinateSpace !== 'screen') return null;
  const affine = frame.localToScreen;
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const local = points.map((point) => {
    const x = point.x - affine.tx;
    const y = point.y - affine.ty;
    return {
      x: (affine.d * x - affine.c * y) / determinant,
      y: (-affine.b * x + affine.a * y) / determinant,
    };
  });
  return local.every(isFinitePoint) ? local : null;
}

function localFrameRadius(
  frame: DrawingFrameRenderableQueryInput,
  radius: number,
  coordinateSpace: DrawingFrameQueryCoordinateSpace
): number | null {
  if (!Number.isFinite(radius) || radius < 0) return null;
  if (coordinateSpace === 'world') return radius;
  if (coordinateSpace !== 'screen') return null;
  // Drawing viewport 是等比缩放；以 localToScreen 的线性模长映射 screen-DIP 半径。
  const scale = Math.hypot(frame.localToScreen.a, frame.localToScreen.b);
  const localRadius = radius / scale;
  return Number.isFinite(localRadius) && localRadius >= 0 ? localRadius : null;
}

function polygonContainsPoint(
  polygon: Readonly<{
    outer: readonly GeometryPoint[];
    holes: readonly (readonly GeometryPoint[])[];
  }>,
  point: GeometryPoint
): boolean {
  return (
    hitTestNonzeroRings([polygon.outer], point, 0) &&
    !polygon.holes.some((hole) => hitTestNonzeroRings([hole], point, 0))
  );
}

function polygonSegments(
  points: readonly GeometryPoint[]
): readonly [GeometryPoint, GeometryPoint][] {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0], points[0]]];
  return points.map(
    (point, index) => [point, points[(index + 1) % points.length]] as [GeometryPoint, GeometryPoint]
  );
}

function pathMatchesFrameLasso(
  points: readonly GeometryPoint[],
  closed: boolean,
  lasso: CanonicalLasso
): boolean {
  if (points.some((point) => lassoContainsPoint(lasso, point))) return true;
  const segmentPoints = closed ? points : points.length === 1 ? points : points.slice(0, -1);
  const segments = closed
    ? polygonSegments(points)
    : segmentPoints.map(
        (point, index) => [point, points[index + 1]] as [GeometryPoint, GeometryPoint]
      );
  return lasso.polygons.some((polygon) => {
    const rings = [polygon.outer, ...polygon.holes];
    return rings.some((ring) =>
      polygonSegments(ring).some(([start, end]) =>
        segments.some(([pathStart, pathEnd]) => segmentsIntersect(pathStart, pathEnd, start, end))
      )
    );
  });
}

function polygonMatchesFrameLasso(
  polygon: Readonly<{
    outer: readonly GeometryPoint[];
    holes: readonly (readonly GeometryPoint[])[];
  }>,
  lasso: CanonicalLasso
): boolean {
  if (polygon.outer.some((point) => lassoContainsPoint(lasso, point))) return true;
  if (
    pathMatchesFrameLasso(polygon.outer, true, lasso) ||
    polygon.holes.some((hole) => pathMatchesFrameLasso(hole, true, lasso))
  )
    return true;
  return lasso.polygons.some((lassoPolygon) =>
    lassoPolygon.outer.some((point) => polygonContainsPoint(polygon, point))
  );
}

function frameEntryMatchesLasso(
  entry: DrawingFrameRenderableQueryEntry,
  lasso: CanonicalLasso
): boolean {
  if (
    entry.program.strokes.some((stroke) =>
      pathMatchesFrameLasso(stroke.points, stroke.closed, lasso)
    )
  )
    return true;
  if (
    entry.program.fills.some((fill) =>
      fill.polygons.some((polygon) => polygonMatchesFrameLasso(polygon, lasso))
    )
  )
    return true;
  return entry.fragments.some((fragment) => {
    if (!isFrameResourceBoxFragment(fragment)) return false;
    if (fragment.resourceBox.tool === 'image')
      return polygonMatchesFrameLasso({ outer: fragment.points, holes: [] }, lasso);
    const program = fragment.resourceBox.textProgram;
    return (
      program !== undefined &&
      program.kind !== 'empty-text' &&
      program.semanticRegions.some((region) =>
        polygonMatchesFrameLasso({ outer: region.polygon, holes: [] }, lasso)
      )
    );
  });
}

function pathMatchesFrameEraser(
  points: readonly GeometryPoint[],
  closed: boolean,
  samples: readonly GeometryPoint[],
  radius: number
): boolean {
  const pathSegments = closed
    ? polygonSegments(points)
    : points.length === 1
      ? [[points[0], points[0]] as [GeometryPoint, GeometryPoint]]
      : points
          .slice(0, -1)
          .map((point, index) => [point, points[index + 1]] as [GeometryPoint, GeometryPoint]);
  const radiusSquared = radius * radius;
  return trackSegments(samples).some(([eraserStart, eraserEnd]) =>
    pathSegments.some(
      ([pathStart, pathEnd]) =>
        segmentsDistanceSquared(eraserStart, eraserEnd, pathStart, pathEnd) <= radiusSquared
    )
  );
}

function polygonMatchesFrameEraser(
  polygon: Readonly<{
    outer: readonly GeometryPoint[];
    holes: readonly (readonly GeometryPoint[])[];
  }>,
  samples: readonly GeometryPoint[],
  radius: number
): boolean {
  if (samples.some((sample) => polygonContainsPoint(polygon, sample))) return true;
  return (
    pathMatchesFrameEraser(polygon.outer, true, samples, radius) ||
    polygon.holes.some((hole) => pathMatchesFrameEraser(hole, true, samples, radius))
  );
}

function frameEntryMatchesEraser(
  entry: DrawingFrameRenderableQueryEntry,
  samples: readonly GeometryPoint[],
  radius: number
): boolean {
  if (
    entry.program.strokes.some((stroke) =>
      pathMatchesFrameEraser(stroke.points, stroke.closed, samples, radius)
    )
  )
    return true;
  if (
    entry.program.fills.some((fill) =>
      fill.polygons.some((polygon) => polygonMatchesFrameEraser(polygon, samples, radius))
    )
  )
    return true;
  return entry.fragments.some((fragment) => {
    if (!isFrameResourceBoxFragment(fragment)) return false;
    if (fragment.resourceBox.tool === 'image')
      return polygonMatchesFrameEraser({ outer: fragment.points, holes: [] }, samples, radius);
    const program = fragment.resourceBox.textProgram;
    return (
      program !== undefined &&
      program.kind !== 'empty-text' &&
      program.semanticRegions.some((region) =>
        polygonMatchesFrameEraser({ outer: region.polygon, holes: [] }, samples, radius)
      )
    );
  });
}

/** 仅使用本帧 renderable geometry program 与资源/文字语义区域查询套索目标。 */
export function queryDrawingFrameLassoTargets(
  frame: DrawingFrameRenderableQueryInput,
  polygon: readonly GeometryPoint[],
  options: DrawingFrameTargetQueryOptions
): DrawingFrameTargetQuery {
  const revisionDiagnostic = validFrameRevision(options);
  if (revisionDiagnostic) return { targets: [], diagnostics: [revisionDiagnostic] };
  const coordinateSpace = options.coordinateSpace ?? 'world';
  const localPolygon = localFramePoints(frame, polygon, coordinateSpace);
  if (localPolygon === null) {
    return {
      targets: [],
      diagnostics: [
        {
          type:
            coordinateSpace === 'world' || coordinateSpace === 'screen'
              ? 'invalid-lasso-polygon'
              : 'invalid-frame-query-coordinate-space',
        },
      ],
    };
  }
  const lasso = canonicalLasso(localPolygon);
  if (!lasso) return { targets: [], diagnostics: [{ type: 'invalid-lasso-polygon' }] };
  const targets = frame.renderableEntries
    .filter(isInteractiveFrameEntry)
    .filter((entry) => frameEntryMatchesLasso(entry, lasso))
    .map(frameTarget)
    .sort((first, second) => first.index - second.index);
  return { targets: Object.freeze(targets), diagnostics: [] };
}

/** 仅使用本帧 renderable geometry program 与资源/文字语义区域查询连续橡皮轨迹。 */
export function queryDrawingFrameEraserTargets(
  frame: DrawingFrameRenderableQueryInput,
  samples: readonly GeometryPoint[],
  radius: number,
  options: DrawingFrameTargetQueryOptions & EraserTargetQueryOptions
): DrawingFrameTargetQuery {
  const revisionDiagnostic = validFrameRevision(options);
  if (revisionDiagnostic) return { targets: [], diagnostics: [revisionDiagnostic] };
  const coordinateSpace = options.coordinateSpace ?? 'world';
  const localSamples = localFramePoints(frame, samples, coordinateSpace);
  if (localSamples === null || localSamples.length === 0) {
    return {
      targets: [],
      diagnostics: [
        {
          type:
            coordinateSpace === 'world' || coordinateSpace === 'screen'
              ? 'invalid-eraser-samples'
              : 'invalid-frame-query-coordinate-space',
        },
      ],
    };
  }
  const localRadius = localFrameRadius(frame, radius, coordinateSpace);
  if (localRadius === null) {
    return {
      targets: [],
      diagnostics: [
        {
          type:
            coordinateSpace === 'world' || coordinateSpace === 'screen'
              ? 'invalid-eraser-radius'
              : 'invalid-frame-query-coordinate-space',
        },
      ],
    };
  }
  const targets = frame.renderableEntries
    .filter(isInteractiveFrameEntry)
    .filter((entry) => frameEntryMatchesEraser(entry, localSamples, localRadius))
    .map(frameTarget)
    .sort((first, second) => first.index - second.index);
  return options.topmostOnly && targets.length > 0
    ? { targets: Object.freeze([targets[targets.length - 1]]), diagnostics: [] }
    : { targets: Object.freeze(targets), diagnostics: [] };
}

/**
 * 查询被 world-DIP 半径橡皮轨迹扫到的 V2 文档对象。轨迹按连续线段而非孤立采样点判定；
 * topmostOnly 为 true 时仅保留最后一个命中的文档条目，否则所有目标均按文档索引升序返回。
 */
export function queryEraserStrokeTargets(
  document: DrawingValueV2,
  samples: readonly GeometryPoint[],
  radius: number,
  options: EraserTargetQueryOptions = {}
): DocumentStrokeTargetQuery {
  if (!hasUsableDocument(document) || samples.length === 0 || !samples.every(isFinitePoint)) {
    return { targets: [], diagnostics: [{ type: 'invalid-eraser-samples' }] };
  }
  if (!Number.isFinite(radius) || radius < 0) {
    return { targets: [], diagnostics: [{ type: 'invalid-eraser-radius' }] };
  }

  const diagnostics: SelectionQueryDiagnostic[] = [];
  const targets: DocumentStrokeTarget[] = [];
  const eraserBounds = boundsForPoints(samples)!;
  document.strokes.forEach((stroke, index) => {
    if (!isSupportedStrokeTool(stroke.tool)) {
      diagnostics.push({ type: 'unsupported-stroke-tool', index });
      return;
    }
    const descriptor = describeDrawingStrokeGeometry(stroke);
    const bounds = descriptor === null ? null : getDrawingGeometryBounds(descriptor);
    if (descriptor === null || bounds === null) {
      diagnostics.push({ type: 'unsupported-stroke-geometry', index });
      return;
    }
    if (!boundsOverlap(bounds, eraserBounds, radius)) return;

    const contour = describeDrawingGeometryContour(descriptor);
    if (contour === null) {
      diagnostics.push({ type: 'unsupported-stroke-geometry', index });
      return;
    }
    if (contour.capped) {
      diagnostics.push({ type: 'contour-capped', index });
      targets.push({ index, stroke });
      return;
    }
    if (contourMatchesEraser(contour, descriptor, samples, radius)) targets.push({ index, stroke });
  });

  return options.topmostOnly && targets.length > 0
    ? { targets: [targets[targets.length - 1]], diagnostics }
    : { targets, diagnostics };
}
