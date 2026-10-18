import { type DrawingGeometryDescriptor, type GeometryPoint } from './geometry';
import { intersectClosedRingWithRect, type PolygonBooleanMultiPolygon } from './polygonBoolean';
import type { DrawingBounds, PreparedDrawingEntry } from './preparedDocument';

/** 单帧局部坐标的闭合安全区域。所有 program/fragment 坐标必须位于此区域内。 */
export type FrameLocalClipRegion = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

export type FrameStrokeFragment = Readonly<{
  kind: 'stroke';
  points: readonly [GeometryPoint, GeometryPoint, ...GeometryPoint[]];
  closed: boolean;
  sourceSegmentIndex: number;
  sourceSegmentStart: number;
  sourceSegmentEnd: number;
  sourceDistanceStart: number;
  sourceDistanceEnd: number;
  /** pressure 是每个源段终点的固定宽度契约，裁剪点 pressure 只作审计。 */
  sourcePressures: Readonly<{ start?: number; end?: number }>;
  clip?: Readonly<{
    startT: number;
    endT: number;
    insertedPressures: Readonly<{ start?: number; end?: number }>;
  }>;
}>;

export type FrameSemanticAreaFragment = Readonly<{
  kind: 'semantic-area';
  points: readonly GeometryPoint[];
}>;
/** 资源的原始完整 local 布局。它只用于认证与映射，不能假定可直接交给 Skia。 */
export type FrameResourceLayout = Readonly<{
  center: GeometryPoint;
  halfWidth: number;
  halfHeight: number;
  rotationRad: number;
}>;
/** partial resource 的可见区域：polygon 是 render/hit 的共同权威，clipBounds 仅为有界审计裁剪区。 */
export type FrameResourceVisibleRegion = Readonly<{
  polygon: readonly GeometryPoint[];
  clipBounds: FrameLocalClipRegion;
}>;
/** 图片 source 使用归一化 [0, 1] 坐标，避免把完整巨大图片的像素或布局数传给 Skia。 */
export type FrameImageSourceWindow = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
/** 已解析文本与命中共用的局部语义区域；文本资源框本身不再自动成为命中区。 */
export type FrameTextSemanticRegion = Readonly<{ polygon: readonly GeometryPoint[] }>;

/** core 只产生纯文本/layout 请求；平台 provider 必须用真实 shaping 兑现或明确拒绝。 */
export type FrameTextRequest = Readonly<{
  revision: string;
  text: string;
  fontSize: number;
  paragraphOrigin: GeometryPoint;
  /** 原始完整 paragraph 宽度，仅用于保留原资源布局语义与认证。 */
  paragraphWidth: number;
  /** 实际允许交给平台 Paragraph.layout 的宽度，始终不大于 frame draw budget。 */
  paragraphLayoutWidth: number;
  /** 超原始宽度预算时，仅固定 LTR/start-left 布局允许通过 metrics 认证。 */
  paragraphDirection: 'auto' | 'ltr';
  paragraphAlignment: 'start';
  rotationRad: number;
  visiblePolygon: readonly GeometryPoint[];
}>;

/**
 * 平台已解析的 glyph run；位置属于 paragraph-local 坐标。typeface 是平台不透明句柄，core
 * 只能保存和转交，不能检查、调用或依赖其具体实现。
 */
export type FrameShapedGlyphRun = Readonly<{
  glyphs: Uint16Array;
  positions: Float32Array;
  /** CanvasKit 的 UTF-8 byte offsets（含 glyphCount + 1 个尾槽），绝非 JS 字符串下标。 */
  offsets?: Uint32Array;
  /** 兼容平台提供的 cluster byte 数据；同样不能被 core 当作 JS 字符串下标。 */
  clusters?: Uint32Array;
  /** 平台已验证的实际 run typeface；它可以是任意平台对象。 */
  typeface: unknown;
  /** Web provider 已在真实 Skia 上构造并验证的 opaque font handle。 */
  font: unknown;
  /** core 只消费此判别结果，绝不调用或检查平台 font/typeface 对象。 */
  fontReady: boolean;
  size: number;
  scaleX: number;
}>;

/**
 * 文本的唯一 render/hit 语义。paragraph-slice 只允许完整原宽的安全 Paragraph；shaped-runs
 * 必须来自真实 Paragraph shaping，绝不能通过截取字符串重新排版得到。
 */
export type FrameTextProgram =
  | Readonly<{ kind: 'empty-text' }>
  | Readonly<{
      kind: 'paragraph-slice';
      text: string;
      anchor: GeometryPoint;
      paintOffset: GeometryPoint;
      paragraphWidth: number;
      rotationRad: number;
      semanticRegions: readonly FrameTextSemanticRegion[];
    }>
  | Readonly<{
      kind: 'shaped-runs';
      anchor: GeometryPoint;
      rotationRad: number;
      runs: readonly FrameShapedGlyphRun[];
      semanticRegions: readonly FrameTextSemanticRegion[];
    }>;
export type FrameResourceBoxFragment = FrameSemanticAreaFragment &
  Readonly<{
    resourceBox: Readonly<{
      kind: 'resource-box';
      tool: 'text' | 'image';
      /** 永远保留资源本身的完整布局，partial 不以可见 AABB 替换它。 */
      layout: FrameResourceLayout;
      /** partial 的有限可见区域；renderer 与 hit 必须消费同一个 polygon。 */
      visible?: FrameResourceVisibleRegion;
      /**
       * 仅 image partial 使用。source 是完整图片坐标中的归一化窗口，destination 是相同内容
       * 在当前 frame 的有限局部绘制框；两者保持完整图片的 scale/rotation 映射，不会 re-fit。
       */
      imageMapping?: Readonly<{ source: FrameImageSourceWindow; destination: FrameResourceLayout }>;
      /** partial text 的待解析请求与已解析 program；二者都不以 visible polygon 的 AABB 重排。 */
      textRequest?: FrameTextRequest;
      textProgram?: FrameTextProgram;
      source: Readonly<{ text?: string; fontSize?: number; resourceId?: string; src?: string }>;
    }>;
  }>;
export type DrawingFrameFragment = FrameStrokeFragment | FrameSemanticAreaFragment;

/** 一个对象一次 fill 的后端无关复合区域，绝不按 island/hole 拆成多次 fill。 */
export type FrameFillRegion = Readonly<{
  kind: 'fill-region';
  fillRule: 'nonzero';
  polygons: readonly Readonly<{
    outer: readonly GeometryPoint[];
    holes: readonly (readonly GeometryPoint[])[];
  }>[];
}>;
export type FrameGeometryProgram = Readonly<{
  strokes: readonly FrameStrokeFragment[];
  fills: readonly FrameFillRegion[];
  /** 源曲线到本 program 折线的已认证世界 DIP 偏差；原始线段/多边形恒为 0。 */
  maxDeviation: number;
}>;

export type FrameFragmentStatus =
  'unchanged' | 'rebased' | 'clipped' | 'segmented' | 'empty' | 'pending' | 'unresolved';
export type FrameClippingDiagnostic = Readonly<{
  type: 'unresolved-clipping';
  reason:
    | 'unsafe-number'
    | 'partial-resource-box'
    | 'invalid-geometry'
    | 'clip-failed'
    | 'unrepresentable-geometry';
}>;
export type FrameClippingResult = Readonly<{
  status: FrameFragmentStatus;
  fragments: readonly DrawingFrameFragment[];
  program: FrameGeometryProgram;
  diagnostic?: FrameClippingDiagnostic;
}>;

type VisibleSegment = Readonly<{
  points: readonly [GeometryPoint, GeometryPoint];
  index: number;
  distanceStart: number;
  distanceEnd: number;
  startT: number;
  endT: number;
  sourceStartPressure?: number;
  sourceEndPressure?: number;
}>;

function frozen<T>(value: T): T {
  return Object.freeze(value);
}
function finite(value: number): boolean {
  return Number.isFinite(value);
}
function finitePoint(point: GeometryPoint): boolean {
  return finite(point.x) && finite(point.y);
}
function samePoint(first: GeometryPoint, second: GeometryPoint): boolean {
  return first.x === second.x && first.y === second.y;
}
function emptyProgram(): FrameGeometryProgram {
  return frozen({ strokes: frozen([]), fills: frozen([]), maxDeviation: 0 });
}
function unresolved(reason: FrameClippingDiagnostic['reason']): FrameClippingResult {
  return frozen({
    status: 'unresolved',
    fragments: frozen([]),
    program: emptyProgram(),
    diagnostic: frozen({ type: 'unresolved-clipping', reason }),
  });
}
function result(
  status: FrameFragmentStatus,
  fragments: readonly DrawingFrameFragment[],
  fills: readonly FrameFillRegion[] = [],
  maxDeviation = 0
): FrameClippingResult {
  const strokes = fragments.filter(
    (fragment): fragment is FrameStrokeFragment => fragment.kind === 'stroke'
  );
  return frozen({
    status,
    fragments: frozen([...fragments]),
    program: frozen({ strokes: frozen(strokes), fills: frozen([...fills]), maxDeviation }),
  });
}

function localPoint(
  point: GeometryPoint,
  origin: GeometryPoint,
  limit: number
): GeometryPoint | null {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return finite(x) && finite(y) && Math.abs(x) <= limit && Math.abs(y) <= limit
    ? frozen({ x, y })
    : null;
}
function localRing(
  points: readonly GeometryPoint[],
  origin: GeometryPoint,
  limit: number
): readonly GeometryPoint[] | null {
  const local = points.map((point) => localPoint(point, origin, limit));
  return local.some((point) => point === null) ? null : frozen(local as GeometryPoint[]);
}
function inside(point: GeometryPoint, region: FrameLocalClipRegion): boolean {
  return (
    point.x >= region.minX &&
    point.x <= region.maxX &&
    point.y >= region.minY &&
    point.y <= region.maxY
  );
}
function globalRegion(
  origin: GeometryPoint,
  region: FrameLocalClipRegion
): FrameLocalClipRegion | null {
  const output = {
    minX: origin.x + region.minX,
    minY: origin.y + region.minY,
    maxX: origin.x + region.maxX,
    maxY: origin.y + region.maxY,
  };
  return Object.values(output).every(finite) ? frozen(output) : null;
}
function overlaps(
  bounds: DrawingBounds,
  origin: GeometryPoint,
  region: FrameLocalClipRegion
): boolean {
  const clip = globalRegion(origin, region);
  return (
    clip !== null &&
    bounds.maxX >= clip.minX &&
    bounds.minX <= clip.maxX &&
    bounds.maxY >= clip.minY &&
    bounds.minY <= clip.maxY
  );
}

function intersection(
  start: GeometryPoint,
  end: GeometryPoint,
  region: FrameLocalClipRegion
): readonly [GeometryPoint, GeometryPoint, number, number] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let first = 0;
  let last = 1;
  for (const [p, q] of [
    [-dx, start.x - region.minX],
    [dx, region.maxX - start.x],
    [-dy, start.y - region.minY],
    [dy, region.maxY - start.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (!finite(ratio)) return null;
    if (p < 0) {
      if (ratio > last) return null;
      first = Math.max(first, ratio);
    } else {
      if (ratio < first) return null;
      last = Math.min(last, ratio);
    }
  }
  const clippedStart = frozen({ x: start.x + dx * first, y: start.y + dy * first });
  const clippedEnd = frozen({ x: start.x + dx * last, y: start.y + dy * last });
  return finitePoint(clippedStart) && finitePoint(clippedEnd)
    ? [clippedStart, clippedEnd, first, last]
    : null;
}

/** convex ring 快路径；复杂/自交 ring 一律经 polygonBoolean。 */
function clipPolygon(
  points: readonly GeometryPoint[],
  region: FrameLocalClipRegion
): readonly GeometryPoint[] {
  type Edge = Readonly<{
    inside: (point: GeometryPoint) => boolean;
    at: (from: GeometryPoint, to: GeometryPoint) => GeometryPoint;
  }>;
  const edges: readonly Edge[] = [
    {
      inside: (p) => p.x >= region.minX,
      at: (a, b) => ({
        x: region.minX,
        y: a.y + ((b.y - a.y) * (region.minX - a.x)) / (b.x - a.x),
      }),
    },
    {
      inside: (p) => p.x <= region.maxX,
      at: (a, b) => ({
        x: region.maxX,
        y: a.y + ((b.y - a.y) * (region.maxX - a.x)) / (b.x - a.x),
      }),
    },
    {
      inside: (p) => p.y >= region.minY,
      at: (a, b) => ({
        x: a.x + ((b.x - a.x) * (region.minY - a.y)) / (b.y - a.y),
        y: region.minY,
      }),
    },
    {
      inside: (p) => p.y <= region.maxY,
      at: (a, b) => ({
        x: a.x + ((b.x - a.x) * (region.maxY - a.y)) / (b.y - a.y),
        y: region.maxY,
      }),
    },
  ];
  let output = [...points];
  for (const edge of edges) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const previous = input[(index + input.length - 1) % input.length];
      const current = input[index];
      if (edge.inside(current) !== edge.inside(previous)) {
        const point = edge.at(previous, current);
        if (finitePoint(point)) output.push(point);
      }
      if (edge.inside(current)) output.push(current);
    }
  }
  return frozen(output.map((point) => frozen({ ...point })));
}

function interpolatedPressure(
  start: number | undefined,
  end: number | undefined,
  t: number
): number | undefined {
  return start !== undefined && end !== undefined && finite(start) && finite(end)
    ? start + (end - start) * t
    : undefined;
}
function frozenPolyline(
  points: readonly GeometryPoint[]
): readonly [GeometryPoint, GeometryPoint, ...GeometryPoint[]] | null {
  return points.length < 2
    ? null
    : frozen([
        frozen({ ...points[0] }),
        frozen({ ...points[1] }),
        ...points.slice(2).map((point) => frozen({ ...point })),
      ]);
}
function frozenStroke(
  points: readonly [GeometryPoint, GeometryPoint, ...GeometryPoint[]],
  closed: boolean,
  first: VisibleSegment,
  last: VisibleSegment
): FrameStrokeFragment {
  const clip =
    first.startT !== 0 || last.endT !== 1
      ? frozen({
          startT: first.startT,
          endT: last.endT,
          insertedPressures: frozen({
            ...(first.startT === 0
              ? {}
              : {
                  start: interpolatedPressure(
                    first.sourceStartPressure,
                    first.sourceEndPressure,
                    first.startT
                  ),
                }),
            ...(last.endT === 1
              ? {}
              : {
                  end: interpolatedPressure(
                    last.sourceStartPressure,
                    last.sourceEndPressure,
                    last.endT
                  ),
                }),
          }),
        })
      : undefined;
  return frozen({
    kind: 'stroke',
    points: frozenPolyline(points)!,
    closed,
    sourceSegmentIndex: first.index,
    sourceSegmentStart: first.index,
    sourceSegmentEnd: last.index,
    sourceDistanceStart: first.distanceStart,
    sourceDistanceEnd: last.distanceEnd,
    sourcePressures: frozen({
      ...(first.sourceStartPressure === undefined ? {} : { start: first.sourceStartPressure }),
      ...(last.sourceEndPressure === undefined ? {} : { end: last.sourceEndPressure }),
    }),
    ...(clip === undefined ? {} : { clip }),
  });
}
function runFragments(
  segments: readonly VisibleSegment[],
  pressureSensitive: boolean
): readonly FrameStrokeFragment[] {
  const fragments: FrameStrokeFragment[] = [];
  let run: VisibleSegment[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const points: [GeometryPoint, GeometryPoint, ...GeometryPoint[]] = [
      run[0].points[0],
      run[0].points[1],
    ];
    for (let index = 1; index < run.length; index += 1) points.push(run[index].points[1]);
    fragments.push(frozenStroke(points, false, run[0], run[run.length - 1]));
    run = [];
  };
  for (const segment of segments) {
    const previous = run[run.length - 1];
    const continuous =
      !pressureSensitive &&
      previous !== undefined &&
      previous.index + 1 === segment.index &&
      previous.endT === 1 &&
      segment.startT === 0 &&
      samePoint(previous.points[1], segment.points[0]);
    if (!continuous) flush();
    run.push(segment);
    if (pressureSensitive) flush();
  }
  flush();
  return frozen(fragments);
}

function localFill(
  polygons: PolygonBooleanMultiPolygon,
  origin: GeometryPoint,
  limit: number
): FrameFillRegion | null {
  const localPolygons = polygons.map((polygon) => {
    const outer = localRing(polygon.outer, origin, limit);
    const holes = polygon.holes.map((hole) => localRing(hole, origin, limit));
    return outer === null || holes.some((hole) => hole === null)
      ? null
      : frozen({ outer, holes: frozen(holes as (readonly GeometryPoint[])[]) });
  });
  return localPolygons.some((polygon) => polygon === null)
    ? null
    : frozen({
        kind: 'fill-region',
        fillRule: 'nonzero',
        polygons: frozen(localPolygons as FrameFillRegion['polygons']),
      });
}
function simpleFill(
  points: readonly GeometryPoint[],
  origin: GeometryPoint,
  limit: number
): FrameFillRegion | null {
  const local = localRing(points, origin, limit);
  return local === null || local.length < 3
    ? null
    : frozen({
        kind: 'fill-region',
        fillRule: 'nonzero',
        polygons: frozen([frozen({ outer: local, holes: frozen([]) })]),
      });
}

function pathFragments(
  points: readonly GeometryPoint[],
  closed: boolean,
  entry: PreparedDrawingEntry,
  origin: GeometryPoint,
  region: FrameLocalClipRegion,
  limit: number
): FrameClippingResult {
  if (
    points.length < 2 ||
    !points.every(finitePoint) ||
    points.some(
      (point) =>
        Math.abs(point.x) > Number.MAX_SAFE_INTEGER || Math.abs(point.y) > Number.MAX_SAFE_INTEGER
    )
  )
    return unresolved('unsafe-number');
  const clip = globalRegion(origin, region);
  if (clip === null) return unresolved('unsafe-number');
  const fullyContained = points.every((point) =>
    inside({ x: point.x - origin.x, y: point.y - origin.y }, region)
  );
  // concave 的部分交集也可能拆成多个 island，和自交一样必须转入 compound program。
  const compound =
    closed && entry.closedPath?.kind !== undefined && entry.closedPath.kind !== 'simple-convex';
  let fill: FrameFillRegion | null = null;
  if (closed) {
    if (compound) {
      // 完整简单凹环不需要 boolean；它保留单对象 nonzero fill。只有部分凹环和自交 ring
      // 才进入 polyclip，避免把每帧完整可见的普通路径交给较重的拓扑运算。
      if (fullyContained && entry.closedPath?.kind === 'simple-concave') {
        fill = simpleFill(points, origin, limit);
      } else {
        if (entry.closedPath?.canonicalizationFailed) return unresolved('clip-failed');
        const canonical =
          fullyContained && entry.closedPath?.canonicalFill
            ? { ok: true as const, polygons: entry.closedPath.canonicalFill }
            : intersectClosedRingWithRect(points, clip);
        if (!canonical.ok) return unresolved('clip-failed');
        fill = localFill(canonical.polygons, origin, limit);
      }
    } else {
      const globalArea = fullyContained ? points : clipPolygon(points, clip);
      fill = simpleFill(globalArea, origin, limit);
    }
    if (fill === null) return unresolved('unsafe-number');
  }
  const visible: VisibleSegment[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  let distance = 0;
  let clipped = false;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!finite(length)) return unresolved('unsafe-number');
    const cut = intersection(start, end, clip);
    if (cut) {
      const [globalFirst, globalLast, startT, endT] = cut;
      const first = localPoint(globalFirst, origin, limit);
      const last = localPoint(globalLast, origin, limit);
      if (first === null || last === null) return unresolved('unsafe-number');
      clipped ||= startT !== 0 || endT !== 1;
      visible.push({
        points: [first, last],
        index,
        distanceStart: distance + length * startT,
        distanceEnd: distance + length * endT,
        startT,
        endT,
        sourceStartPressure: entry.stroke.points[index]?.pressure,
        sourceEndPressure: entry.stroke.points[(index + 1) % entry.stroke.points.length]?.pressure,
      });
    } else clipped = true;
    distance += length;
  }
  // 自交没有可直接描边的闭合边界；普通 concave 的完整 source edge 仍可以描边。
  const strokes =
    fullyContained && closed && entry.closedPath?.kind !== 'complex'
      ? (() => {
          const local = localRing(points, origin, limit);
          const polyline = local === null ? null : frozenPolyline(local);
          return local === null || polyline === null || visible.length === 0
            ? []
            : [frozenStroke(polyline, true, visible[0], visible[visible.length - 1])];
        })()
      : runFragments(
          visible,
          entry.stroke.tool === 'pen' &&
            entry.stroke.points.some((point) => point.pressure !== undefined)
        );
  const fragments: DrawingFrameFragment[] = [...strokes];
  // simple fill 保留一份历史 semantic-area 投影；复合 fill 只能由 program 一次对象填充。
  if (
    fill &&
    (!compound || (fullyContained && entry.closedPath?.kind === 'simple-concave')) &&
    fill.polygons.length === 1 &&
    fill.polygons[0].holes.length === 0
  ) {
    fragments.push(frozen({ kind: 'semantic-area', points: fill.polygons[0].outer }));
  }
  if (fragments.length === 0 && fill === null) return result('empty', []);
  return result(
    clipped ? (strokes.length > 1 ? 'segmented' : 'clipped') : 'rebased',
    fragments,
    fill === null ? [] : [fill]
  );
}

function globalRectCorners(
  geometry: Extract<DrawingGeometryDescriptor, { kind: 'rect' }>
): readonly GeometryPoint[] | null {
  const cosine = Math.cos(geometry.rotationRad);
  const sine = Math.sin(geometry.rotationRad);
  if (!finite(cosine) || !finite(sine)) return null;
  const corners = [
    [-geometry.halfWidth, -geometry.halfHeight],
    [geometry.halfWidth, -geometry.halfHeight],
    [geometry.halfWidth, geometry.halfHeight],
    [-geometry.halfWidth, geometry.halfHeight],
  ] as const;
  const points = corners.map(([x, y]) => ({
    x: geometry.center.x + x * cosine - y * sine,
    y: geometry.center.y + x * sine + y * cosine,
  }));
  return points.every(finitePoint) ? points : null;
}

function unboundedLocalPoint(point: GeometryPoint, origin: GeometryPoint): GeometryPoint | null {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return finite(x) && finite(y) ? frozen({ x, y }) : null;
}

function resourceImageMapping(
  layout: FrameResourceLayout,
  visible: readonly GeometryPoint[]
): Readonly<{ source: FrameImageSourceWindow; destination: FrameResourceLayout }> | null {
  const { center, halfWidth, halfHeight, rotationRad } = layout;
  if (halfWidth <= 0 || halfHeight <= 0 || visible.length < 3) return null;
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  if (![cosine, sine].every(finite)) return null;
  const oriented = visible.map((point) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    // 把 frame local 可见 polygon 映回 resource local，再裁出可作 source/destination 的窗口。
    return { x: x * cosine + y * sine, y: -x * sine + y * cosine };
  });
  if (!oriented.every(finitePoint)) return null;
  const minX = Math.max(-halfWidth, Math.min(...oriented.map((point) => point.x)));
  const minY = Math.max(-halfHeight, Math.min(...oriented.map((point) => point.y)));
  const maxX = Math.min(halfWidth, Math.max(...oriented.map((point) => point.x)));
  const maxY = Math.min(halfHeight, Math.max(...oriented.map((point) => point.y)));
  if (![minX, minY, maxX, maxY].every(finite) || minX >= maxX || minY >= maxY) return null;
  const cropCenter = { x: minX / 2 + maxX / 2, y: minY / 2 + maxY / 2 };
  const destinationCenter = {
    x: center.x + cropCenter.x * cosine - cropCenter.y * sine,
    y: center.y + cropCenter.x * sine + cropCenter.y * cosine,
  };
  const source = {
    x: (minX + halfWidth) / (halfWidth * 2),
    y: (minY + halfHeight) / (halfHeight * 2),
    width: (maxX - minX) / (halfWidth * 2),
    height: (maxY - minY) / (halfHeight * 2),
  };
  const destination = {
    center: destinationCenter,
    halfWidth: (maxX - minX) / 2,
    halfHeight: (maxY - minY) / 2,
    rotationRad,
  };
  return Object.values(source).every((value) => finite(value) && value >= 0 && value <= 1) &&
    [
      destination.center.x,
      destination.center.y,
      destination.halfWidth,
      destination.halfHeight,
      destination.rotationRad,
    ].every(finite)
    ? frozen({
        source: frozen(source),
        destination: frozen({
          center: frozen(destination.center),
          halfWidth: destination.halfWidth,
          halfHeight: destination.halfHeight,
          rotationRad: destination.rotationRad,
        }),
      })
    : null;
}

function resourceTextRequest(
  layout: FrameResourceLayout,
  text: string | undefined,
  fontSize: number | undefined,
  visiblePolygon: readonly GeometryPoint[],
  limit: number
): FrameTextRequest | null {
  const { center, halfWidth, halfHeight, rotationRad } = layout;
  const size = fontSize ?? 24;
  if (
    ![center.x, center.y, halfWidth, halfHeight, rotationRad, size].every(finite) ||
    halfWidth <= 0 ||
    halfHeight <= 0 ||
    size <= 0
  )
    return null;
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  if (![cosine, sine].every(finite)) return null;
  // Paragraph 的内容从原资源左上角开始。先得到旋转后的实际起点，只有它可安全表示时才可
  // 交给 Skia；不能以 clipBounds 的左边替换这个内容坐标。
  const paragraphOrigin = {
    x: center.x - halfWidth * cosine + halfHeight * sine,
    y: center.y - halfWidth * sine - halfHeight * cosine,
  };
  const layoutWidth = halfWidth * 2;
  if (
    !finite(layoutWidth) ||
    layoutWidth <= 0 ||
    !finitePoint(paragraphOrigin) ||
    visiblePolygon.length < 3
  )
    return null;
  // revision 包含所有影响 shaping/layout 的单样式输入；provider 不会把 text 截段后另行 layout。
  const paragraphLayoutWidth = Math.min(layoutWidth, limit);
  const paragraphDirection = layoutWidth > limit ? 'ltr' : 'auto';
  if (!finite(paragraphLayoutWidth) || paragraphLayoutWidth <= 0) return null;
  return frozen({
    revision: `${text ?? ''}\u0000${size}\u0000${layoutWidth}\u0000${paragraphLayoutWidth}\u0000${paragraphDirection}\u0000start\u0000${rotationRad}`,
    text: text ?? '',
    fontSize: size,
    paragraphOrigin: frozen(paragraphOrigin),
    paragraphWidth: layoutWidth,
    paragraphLayoutWidth,
    paragraphDirection,
    paragraphAlignment: 'start',
    rotationRad,
    visiblePolygon: frozen(visiblePolygon.map((point) => frozen({ ...point }))),
  });
}

function safeParagraphProgram(request: FrameTextRequest, limit: number): FrameTextProgram | null {
  if (request.text.length === 0) return frozen({ kind: 'empty-text' });
  if (
    !finite(request.paragraphWidth) ||
    request.paragraphWidth <= 0 ||
    request.paragraphWidth > limit ||
    !finite(request.paragraphLayoutWidth) ||
    request.paragraphLayoutWidth !== request.paragraphWidth ||
    request.paragraphLayoutWidth > limit ||
    !finitePoint(request.paragraphOrigin) ||
    Math.abs(request.paragraphOrigin.x) > limit ||
    Math.abs(request.paragraphOrigin.y) > limit
  )
    return null;
  return frozen({
    kind: 'paragraph-slice',
    text: request.text,
    anchor: request.paragraphOrigin,
    paintOffset: frozen({ x: 0, y: 0 }),
    paragraphWidth: request.paragraphWidth,
    rotationRad: request.rotationRad,
    semanticRegions: frozen([frozen({ polygon: request.visiblePolygon })]),
  });
}

function resourceBoxFragment(
  entry: PreparedDrawingEntry,
  origin: GeometryPoint,
  region: FrameLocalClipRegion,
  limit: number
): FrameClippingResult {
  const geometry = entry.geometry;
  if (geometry.kind !== 'rect' || (entry.stroke.tool !== 'text' && entry.stroke.tool !== 'image'))
    return unresolved('invalid-geometry');
  const corners = globalRectCorners(geometry);
  const clip = globalRegion(origin, region);
  const center = unboundedLocalPoint(geometry.center, origin);
  if (corners === null || clip === null) return unresolved('unsafe-number');
  const fullyContained = corners.every((point) =>
    inside({ x: point.x - origin.x, y: point.y - origin.y }, region)
  );
  const local = localRing(fullyContained ? corners : clipPolygon(corners, clip), origin, limit);
  if (local === null) return unresolved('unsafe-number');
  if (local.length < 3) return result('empty', []);
  if (center === null) return unresolved('unsafe-number');
  const layout = frozen({
    center,
    halfWidth: geometry.halfWidth,
    halfHeight: geometry.halfHeight,
    rotationRad: geometry.rotationRad,
  });
  const visible = fullyContained
    ? undefined
    : frozen({ polygon: local, clipBounds: frozen({ ...region }) });
  // 图片可把可见 polygon 映到完整资源中的归一化 source 窗口和有限 destination；text 则生成
  // 保留原布局语义的有限 Paragraph 输入，绝不把 clipBounds 作为新的排版宽度。
  const mappedImage =
    entry.stroke.tool === 'image' && visible
      ? resourceImageMapping(layout, visible.polygon)
      : undefined;
  if (entry.stroke.tool === 'image' && visible && mappedImage === null)
    return unresolved('unrepresentable-geometry');
  const imageMapping = mappedImage ?? undefined;
  const textPolygon = visible?.polygon ?? local;
  const mappedText =
    entry.stroke.tool === 'text'
      ? resourceTextRequest(layout, entry.stroke.text, entry.stroke.fontSize, textPolygon, limit)
      : undefined;
  if (entry.stroke.tool === 'text' && mappedText === null)
    return unresolved('unrepresentable-geometry');
  const textRequest = mappedText ?? undefined;
  // 完整且有限的资源无需等 Web shaping；其实际 Paragraph 与同一 semantic program 一起进入 frame。
  const textProgram =
    textRequest && (textRequest.text.length === 0 || !visible)
      ? (safeParagraphProgram(textRequest, limit) ?? undefined)
      : undefined;
  const fragment: FrameResourceBoxFragment = frozen({
    kind: 'semantic-area',
    points: local,
    resourceBox: frozen({
      kind: 'resource-box',
      tool: entry.stroke.tool,
      layout,
      ...(visible === undefined ? {} : { visible }),
      ...(imageMapping === undefined ? {} : { imageMapping }),
      ...(textRequest === undefined ? {} : { textRequest }),
      ...(textProgram === undefined ? {} : { textProgram }),
      source: frozen(
        entry.stroke.tool === 'text'
          ? { text: entry.stroke.text, fontSize: entry.stroke.fontSize }
          : {
              src: entry.stroke.src,
              ...(entry.stroke.resourceId === undefined
                ? {}
                : { resourceId: entry.stroke.resourceId }),
            }
      ),
    }),
  });
  // resource polygon 只是 clip/input 审计数据，不能自动加入通用 geometry hit/fill program。
  return result(fullyContained ? 'rebased' : 'clipped', [fragment]);
}

type CubicControls = readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint];
type CubicLeaf = Readonly<{
  controls: CubicControls;
  flatness: number;
  potentiallyVisible: boolean;
}>;

function midpoint(first: number, second: number): number | null {
  const value = first / 2 + second / 2;
  return finite(value) ? value : null;
}
function cubicDistanceToChord(
  point: GeometryPoint,
  start: GeometryPoint,
  end: GeometryPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!finite(lengthSquared)) return Infinity;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}
function cubicFlatness(controls: CubicControls): number {
  return Math.max(
    cubicDistanceToChord(controls[1], controls[0], controls[3]),
    cubicDistanceToChord(controls[2], controls[0], controls[3])
  );
}
function splitCubic(controls: CubicControls): readonly [CubicControls, CubicControls] | null {
  const first = {
    x: midpoint(controls[0].x, controls[1].x),
    y: midpoint(controls[0].y, controls[1].y),
  };
  const second = {
    x: midpoint(controls[1].x, controls[2].x),
    y: midpoint(controls[1].y, controls[2].y),
  };
  const third = {
    x: midpoint(controls[2].x, controls[3].x),
    y: midpoint(controls[2].y, controls[3].y),
  };
  if (![first.x, first.y, second.x, second.y, third.x, third.y].every((value) => value !== null))
    return null;
  const left = { x: midpoint(first.x!, second.x!), y: midpoint(first.y!, second.y!) };
  const right = { x: midpoint(second.x!, third.x!), y: midpoint(second.y!, third.y!) };
  if (![left.x, left.y, right.x, right.y].every((value) => value !== null)) return null;
  const middle = { x: midpoint(left.x!, right.x!), y: midpoint(left.y!, right.y!) };
  if (middle.x === null || middle.y === null) return null;
  return [
    [
      controls[0],
      frozen({ x: first.x!, y: first.y! }),
      frozen({ x: left.x!, y: left.y! }),
      frozen({ x: middle.x, y: middle.y }),
    ],
    [
      frozen({ x: middle.x, y: middle.y }),
      frozen({ x: right.x!, y: right.y! }),
      frozen({ x: third.x!, y: third.y! }),
      controls[3],
    ],
  ];
}
function cubicHullMayIntersect(controls: CubicControls, region: FrameLocalClipRegion): boolean {
  let minX = controls[0].x;
  let minY = controls[0].y;
  let maxX = controls[0].x;
  let maxY = controls[0].y;
  for (const point of controls.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return (
    [minX, minY, maxX, maxY].every(finite) &&
    maxX >= region.minX &&
    minX <= region.maxX &&
    maxY >= region.minY &&
    minY <= region.maxY
  );
}

/**
 * partial cubic 不先生成整条 65k contour。控制点 hull 是曲线的保守 AABB，因此与扩张 clip
 * 不相交的 branch 可安全跳过；保留下来的 leaf 均以实际 flatness 认证。
 */
function partialCubicFragments(
  entry: PreparedDrawingEntry,
  origin: GeometryPoint,
  region: FrameLocalClipRegion,
  limit: number,
  maxDeviation: number
): FrameClippingResult {
  if (entry.geometry.kind !== 'cubic-bezier') return unresolved('invalid-geometry');
  const clip = globalRegion(origin, region);
  if (clip === null) return unresolved('unsafe-number');
  const expanded = frozen({
    minX: clip.minX - maxDeviation,
    minY: clip.minY - maxDeviation,
    maxX: clip.maxX + maxDeviation,
    maxY: clip.maxY + maxDeviation,
  });
  if (!Object.values(expanded).every(finite)) return unresolved('unsafe-number');
  const controls = entry.geometry.points;
  if (!controls.every(finitePoint)) return unresolved('invalid-geometry');
  const leaves: CubicLeaf[] = [];
  const pending: CubicLeaf[] = [
    frozen({ controls, flatness: cubicFlatness(controls), potentiallyVisible: true }),
  ];
  while (pending.length > 0) {
    const piece = pending.pop()!;
    const potentiallyVisible = cubicHullMayIntersect(piece.controls, expanded);
    if (!potentiallyVisible) {
      leaves.push(frozen({ ...piece, potentiallyVisible: false }));
      continue;
    }
    if (!finite(piece.flatness)) return unresolved('invalid-geometry');
    if (piece.flatness <= maxDeviation) {
      leaves.push(piece);
      continue;
    }
    const split = splitCubic(piece.controls);
    if (split === null) return unresolved('invalid-geometry');
    const leftFlatness = cubicFlatness(split[0]);
    const rightFlatness = cubicFlatness(split[1]);
    pending.push(
      frozen({ controls: split[1], flatness: rightFlatness, potentiallyVisible: true }),
      frozen({ controls: split[0], flatness: leftFlatness, potentiallyVisible: true })
    );
  }
  const visible: VisibleSegment[] = [];
  let distance = 0;
  let clipped = false;
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    const start = leaf.controls[0];
    const end = leaf.controls[3];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!finite(length)) return unresolved('invalid-geometry');
    if (leaf.potentiallyVisible) {
      // leaf flatness 已认证；用误差扩张区裁弦，不会漏掉“原曲线进 frame 但弦刚好在边外”的
      // 可见 branch。visual clip guard 会吸收这最多 maxDeviation 的局部外扩。
      const cut = intersection(start, end, expanded);
      if (cut !== null) {
        const first = localPoint(cut[0], origin, limit);
        const last = localPoint(cut[1], origin, limit);
        if (first === null || last === null) return unresolved('unsafe-number');
        visible.push(
          frozen({
            points: [first, last],
            index,
            distanceStart: distance + length * cut[2],
            distanceEnd: distance + length * cut[3],
            startT: cut[2],
            endT: cut[3],
          })
        );
        clipped ||= cut[2] !== 0 || cut[3] !== 1;
      } else clipped = true;
    } else clipped = true;
    distance += length;
  }
  const strokes = runFragments(visible, false);
  const actualMaxDeviation = leaves.reduce(
    (maximum, leaf) => (leaf.potentiallyVisible ? Math.max(maximum, leaf.flatness) : maximum),
    0
  );
  return strokes.length === 0
    ? result('empty', [], [], actualMaxDeviation)
    : result(
        clipped ? (strokes.length > 1 ? 'segmented' : 'clipped') : 'rebased',
        strokes,
        [],
        actualMaxDeviation
      );
}

type EllipseGeometry = Extract<DrawingGeometryDescriptor, { kind: 'ellipse' }>;
type EllipseArc = Readonly<{ start: number; end: number }>;

function ellipsePoint(geometry: EllipseGeometry, angle: number): GeometryPoint | null {
  const cosine = Math.cos(geometry.rotationRad);
  const sine = Math.sin(geometry.rotationRad);
  const localX = geometry.radiusX * Math.cos(angle);
  const localY = geometry.radiusY * Math.sin(angle);
  const point = {
    x: geometry.center.x + localX * cosine - localY * sine,
    y: geometry.center.y + localX * sine + localY * cosine,
  };
  return finitePoint(point) ? frozen(point) : null;
}

function ellipseArcBounds(geometry: EllipseGeometry, arc: EllipseArc): FrameLocalClipRegion | null {
  const cosine = Math.cos(geometry.rotationRad);
  const sine = Math.sin(geometry.rotationRad);
  const candidates = [arc.start, arc.end];
  const extrema = [
    Math.atan2(-geometry.radiusY * sine, geometry.radiusX * cosine),
    Math.atan2(geometry.radiusY * cosine, geometry.radiusX * sine),
  ];
  for (const angle of extrema) {
    for (const candidate of [angle, angle + Math.PI, angle + Math.PI * 2]) {
      if (candidate > arc.start && candidate < arc.end) candidates.push(candidate);
    }
  }
  const points = candidates.map((angle) => ellipsePoint(geometry, angle));
  if (points.some((point) => point === null)) return null;
  const resolved = points as GeometryPoint[];
  const bounds = {
    minX: Math.min(...resolved.map((point) => point.x)),
    minY: Math.min(...resolved.map((point) => point.y)),
    maxX: Math.max(...resolved.map((point) => point.x)),
    maxY: Math.max(...resolved.map((point) => point.y)),
  };
  return Object.values(bounds).every(finite) ? frozen(bounds) : null;
}

function ellipseContains(geometry: EllipseGeometry, point: GeometryPoint): boolean {
  const cosine = Math.cos(geometry.rotationRad);
  const sine = Math.sin(geometry.rotationRad);
  const x = point.x - geometry.center.x;
  const y = point.y - geometry.center.y;
  const localX = x * cosine + y * sine;
  const localY = -x * sine + y * cosine;
  const value =
    (localX * localX) / (geometry.radiusX * geometry.radiusX) +
    (localY * localY) / (geometry.radiusY * geometry.radiusY);
  return finite(value) && value <= 1;
}

function rectangleCorners(region: FrameLocalClipRegion): readonly GeometryPoint[] {
  return frozen([
    frozen({ x: region.minX, y: region.minY }),
    frozen({ x: region.maxX, y: region.minY }),
    frozen({ x: region.maxX, y: region.maxY }),
    frozen({ x: region.minX, y: region.maxY }),
  ]);
}

function convexRing(points: readonly GeometryPoint[]): readonly GeometryPoint[] {
  const unique: GeometryPoint[] = [];
  for (const point of points) {
    if (!unique.some((candidate) => samePoint(candidate, point))) unique.push(point);
  }
  const center = unique.reduce(
    (sum, point) => ({ x: sum.x + point.x / unique.length, y: sum.y + point.y / unique.length }),
    { x: 0, y: 0 }
  );
  return frozen(
    unique
      .sort(
        (left, right) =>
          Math.atan2(left.y - center.y, left.x - center.x) -
          Math.atan2(right.y - center.y, right.x - center.x)
      )
      .map((point) => frozen({ ...point }))
  );
}

/**
 * 以 sagitta 的解析上界决定椭圆折线数。这里故意不复用公开 contour 的 65,536 API cap：
 * frame 输出会先裁剪到局部安全区，且每个输出点仍经过完整 f32 输入预算。若 program 本身
 * 无法以 JavaScript 有界数组表达，则如实给出明确诊断，而非把已认证的有限几何误报为 cap。
 */
function partialEllipseFragments(
  entry: PreparedDrawingEntry,
  origin: GeometryPoint,
  region: FrameLocalClipRegion,
  limit: number,
  maxDeviation: number
): FrameClippingResult {
  if (entry.geometry.kind !== 'ellipse') return unresolved('invalid-geometry');
  const geometry = entry.geometry;
  if (
    ![
      geometry.center.x,
      geometry.center.y,
      geometry.radiusX,
      geometry.radiusY,
      geometry.rotationRad,
    ].every(finite) ||
    geometry.radiusX <= 0 ||
    geometry.radiusY <= 0
  ) {
    return unresolved('invalid-geometry');
  }
  const clip = globalRegion(origin, region);
  if (clip === null) return unresolved('unsafe-number');
  // 视口完全位于椭圆内部时边界与 frame 无交集。直接输出安全 clip fill，不生成完整椭圆
  // contour；这既保留同 program 的 nonzero hit，又避免为画面外边界耗尽预算。
  if (rectangleCorners(clip).every((point) => ellipseContains(geometry, point))) {
    const fill = simpleFill(rectangleCorners(clip), origin, limit);
    return fill === null
      ? unresolved('unsafe-number')
      : result(
          'clipped',
          [frozen({ kind: 'semantic-area', points: fill.polygons[0].outer })],
          [fill]
        );
  }
  // 对叶子弦使用误差扩张的 clip，保证真实曲线进入 frame 时不会被其近似弦漏掉。
  const expanded = frozen({
    minX: clip.minX - maxDeviation,
    minY: clip.minY - maxDeviation,
    maxX: clip.maxX + maxDeviation,
    maxY: clip.maxY + maxDeviation,
  });
  if (!Object.values(expanded).every(finite)) return unresolved('unsafe-number');
  const pending: EllipseArc[] = [frozen({ start: 0, end: Math.PI * 2 })];
  const visible: VisibleSegment[] = [];
  const fillPoints: GeometryPoint[] = rectangleCorners(expanded).filter((point) =>
    ellipseContains(geometry, point)
  );
  let actualMaxDeviation = 0;
  let distance = 0;
  let index = 0;
  while (pending.length > 0) {
    const arc = pending.pop()!;
    const bounds = ellipseArcBounds(geometry, arc);
    if (bounds === null) return unresolved('unsafe-number');
    if (
      bounds.maxX < expanded.minX ||
      bounds.minX > expanded.maxX ||
      bounds.maxY < expanded.minY ||
      bounds.minY > expanded.maxY
    )
      continue;
    const halfAngle = (arc.end - arc.start) / 2;
    // 椭圆是半径不超过 max(radiusX,radiusY) 的单位圆线性像；该 sagitta 上界经线性映射后仍成立。
    const deviation = Math.max(geometry.radiusX, geometry.radiusY) * (1 - Math.cos(halfAngle));
    if (!finite(deviation)) return unresolved('unrepresentable-geometry');
    if (deviation > maxDeviation) {
      const middle = midpoint(arc.start, arc.end);
      if (middle === null || middle === arc.start || middle === arc.end)
        return unresolved('unrepresentable-geometry');
      pending.push(
        frozen({ start: middle, end: arc.end }),
        frozen({ start: arc.start, end: middle })
      );
      continue;
    }
    const start = ellipsePoint(geometry, arc.start);
    const end = ellipsePoint(geometry, arc.end);
    if (start === null || end === null) return unresolved('unsafe-number');
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!finite(length)) return unresolved('unsafe-number');
    const cut = intersection(start, end, expanded);
    if (cut !== null) {
      const first = localPoint(cut[0], origin, limit);
      const last = localPoint(cut[1], origin, limit);
      if (first === null || last === null) return unresolved('unsafe-number');
      visible.push(
        frozen({
          points: [first, last],
          index,
          distanceStart: distance + length * cut[2],
          distanceEnd: distance + length * cut[3],
          startT: cut[2],
          endT: cut[3],
        })
      );
      fillPoints.push(cut[0], cut[1]);
      actualMaxDeviation = Math.max(actualMaxDeviation, deviation);
      index += 1;
    }
    distance += length;
  }
  const ring = convexRing(fillPoints);
  const fill = ring.length < 3 ? null : simpleFill(ring, origin, limit);
  const strokes = runFragments(visible, false);
  if (fill === null && strokes.length === 0) return result('empty', [], [], actualMaxDeviation);
  const fragments: DrawingFrameFragment[] = [...strokes];
  if (fill && fill.polygons.length === 1 && fill.polygons[0].holes.length === 0)
    fragments.push(frozen({ kind: 'semantic-area', points: fill.polygons[0].outer }));
  return result(
    strokes.length > 1 ? 'segmented' : 'clipped',
    fragments,
    fill === null ? [] : [fill],
    actualMaxDeviation
  );
}

/** 仅从 immutable prepared 几何生成 transient frame program；不会回写 document/effects。 */
export function clipPreparedDrawingEntry(
  entry: PreparedDrawingEntry,
  origin: GeometryPoint,
  region: FrameLocalClipRegion,
  limit: number,
  maxDeviation = 0.25
): FrameClippingResult {
  if (!overlaps(entry.bounds, origin, region)) return result('empty', []);
  if (!finite(maxDeviation) || maxDeviation <= 0 || maxDeviation > 0.5)
    return unresolved('invalid-geometry');
  const geometry = entry.geometry;
  if (geometry.kind === 'path')
    return pathFragments(geometry.points, geometry.closed, entry, origin, region, limit);
  if (geometry.kind === 'rect')
    return entry.stroke.tool === 'text' || entry.stroke.tool === 'image'
      ? resourceBoxFragment(entry, origin, region, limit)
      : (() => {
          const corners = globalRectCorners(geometry);
          return corners === null
            ? unresolved('unsafe-number')
            : pathFragments(corners, true, entry, origin, region, limit);
        })();
  return geometry.kind === 'cubic-bezier'
    ? partialCubicFragments(entry, origin, region, limit, maxDeviation)
    : partialEllipseFragments(entry, origin, region, limit, maxDeviation);
}
