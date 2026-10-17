import {
  describeDrawingGeometryContour,
  type DrawingGeometryContour,
  describeDrawingStrokeGeometry,
  type DrawingGeometryDescriptor,
} from '../core/geometry';
import type { DrawingFrameEntry } from '../core/drawingFrame';
import {
  createLegacyDrawBudget,
  isDrawDash,
  isDrawDashInput,
  isDrawNumber,
  isDrawPoint,
  isDrawResourceBox,
  isDrawStyle,
  type FrameDrawBudget,
} from '../core/frameBudget';
import type {
  FrameFillRegion,
  FrameImageSourceWindow,
  FrameResourceBoxFragment,
  FrameResourceLayout,
  FrameTextProgram,
  FrameStrokeFragment,
} from '../core/frameClipping';
import type { DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';
import type { SkImage } from '@shopify/react-native-skia';
import {
  createViewportAffine,
  mapViewportAffinePoint,
  type Affine2D,
  type DrawingViewport,
} from '../viewport';
import type {
  SkiaImageReference,
  SkiaOverlay,
  SkiaOverlayStyle,
  SkiaPoint,
  SkiaStrokeStyle,
} from './types';

const DEFAULT_STROKE_COLOR = '#202124';
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_TEXT_FONT_SIZE = 24;

export type SkiaPathDescriptor = Readonly<{
  kind: 'path';
  id: string;
  points: readonly SkiaPathPoint[];
  closed: boolean;
  /** 仅 V2 pen 且原始输入包含 pressure 时按段渲染。 */
  pressureSensitive: boolean;
  style: SkiaStrokeStyle;
}>;

export type SkiaPathPoint = SkiaPoint &
  Readonly<{
    pressure?: number;
  }>;

export type SkiaCubicDescriptor = Readonly<{
  kind: 'cubic-bezier';
  id: string;
  points: readonly [SkiaPoint, SkiaPoint, SkiaPoint, SkiaPoint];
  /** renderer/hit 共享的默认 DIP 误差轮廓，禁止在 Skia 层重新展开 cubic。 */
  contour: DrawingGeometryContour;
  style: SkiaStrokeStyle;
}>;

export type SkiaRectDescriptor = Readonly<{
  kind: 'rect';
  id: string;
  center: SkiaPoint;
  halfWidth: number;
  halfHeight: number;
  rotationRad: number;
  style: SkiaStrokeStyle;
}>;

export type SkiaEllipseDescriptor = Readonly<{
  kind: 'ellipse';
  id: string;
  center: SkiaPoint;
  radiusX: number;
  radiusY: number;
  rotationRad: number;
  /** renderer/hit 共享的默认 DIP 误差轮廓，禁止在 Skia 层固定分段逼近 ellipse。 */
  contour: DrawingGeometryContour;
  style: SkiaStrokeStyle;
}>;

export type SkiaTextDescriptor = Readonly<{
  kind: 'text';
  id: string;
  text: string;
  rect: SkiaRectDescriptor;
  fontSize: number;
  style: SkiaStrokeStyle;
}>;

export type SkiaImageDescriptor = Readonly<{
  kind: 'image';
  id: string;
  resourceId?: string;
  src: string;
  rect: SkiaRectDescriptor;
  image: SkImage | null;
  style: SkiaStrokeStyle;
}>;

/** V2 世界几何的可审计描述，按 document.strokes 的原始顺序生成。 */
export type SkiaStrokeDescriptor =
  | SkiaPathDescriptor
  | SkiaCubicDescriptor
  | SkiaRectDescriptor
  | SkiaEllipseDescriptor
  | SkiaTextDescriptor
  | SkiaImageDescriptor;

/**
 * 绘制 key 来自 prepared entry 的 document index，而非可重复的 stroke.id。
 * `descriptor` 仍保留 id 作为内容属性，不能用于 React key 或排序。
 */
export type SkiaPreparedDescriptor = Readonly<{
  key: number;
  order: number;
  descriptor: SkiaStrokeDescriptor;
}>;

/**
 * frame fragment 有意不复用 `SkiaStrokeDescriptor`：它携带 source segment 和 dash 连续性
 * 元数据，且 semantic area 的填充语义不能被误作普通闭合路径描边。
 */
export type SkiaFrameStrokeFragmentDescriptor = Readonly<{
  kind: 'frame-stroke-fragment';
  id: string;
  /** core 提供的完整连续可见 run；绝不可在 adapter 截断为首尾两点。 */
  points: readonly SkiaPoint[];
  /** run 自身的闭合语义；仅此 run 闭合，不能跨 fragment 拼接。 */
  closed: boolean;
  sourceSegmentIndex: number;
  sourceSegmentStart: number;
  sourceSegmentEnd: number;
  sourceDistanceStart: number;
  sourceDistanceEnd: number;
  sourcePressures: Readonly<{ start?: number; end?: number }>;
  /** 已按 sourceDistanceStart 对齐并规范化到一个 dash 周期内的 Skia phase。 */
  dashPhase?: number;
  style: SkiaStrokeStyle;
}>;

/**
 * 一个 core fill-region 对应一次后端 fill。polygons 中的所有 outer/hole 必须保留在同一
 * SkPath，避免拆岛重复叠加 fillOpacity 或在洞边出现 AA 接缝。
 */
export type SkiaFrameFillRegionDescriptor = Readonly<{
  kind: 'frame-fill-region';
  id: string;
  fillRule: 'nonzero';
  polygons: FrameFillRegion['polygons'];
  style: SkiaStrokeStyle;
}>;

type SkiaFrameResourceBox = Readonly<{
  /** 原始完整 local 布局；text 只以这个宽度 layout，禁止按可见 window 重排。 */
  layout: FrameResourceLayout;
  /** render/hit 共同的有限 partial polygon；不是 virtual AABB。 */
  visiblePolygon?: readonly SkiaPoint[];
  /** image partial 的 source/destination 映射；source 归一化，不含巨大资源数。 */
  imageMapping?: Readonly<{ source: FrameImageSourceWindow; destination: FrameResourceLayout }>;
  /** 已解析的文本程序是 partial text 唯一绘制/命中来源；不允许回读 raw source 重排。 */
  textProgram?: FrameTextProgram;
}>;

/** 完整资源框直接携带的 text 内容，不从 raw stroke 或 geometry 回建。 */
export type SkiaFrameTextDescriptor = Readonly<{
  kind: 'frame-text';
  id: string;
  resourceBox: SkiaFrameResourceBox;
  text: string;
  fontSize: number;
  style: SkiaStrokeStyle;
}>;

/** 完整资源框直接携带的 image 内容，不从 raw stroke 或 geometry 回建。 */
export type SkiaFrameImageDescriptor = Readonly<{
  kind: 'frame-image';
  id: string;
  resourceBox: SkiaFrameResourceBox;
  resourceId?: string;
  src: string;
  image: SkImage | null;
  style: SkiaStrokeStyle;
}>;

export type SkiaFrameFragmentDescriptor =
  | SkiaFrameStrokeFragmentDescriptor
  | SkiaFrameFillRegionDescriptor
  | SkiaFrameTextDescriptor
  | SkiaFrameImageDescriptor;

export type SkiaPreparedFrameDescriptor = Readonly<{
  /** key/order 仍来自 prepared entry；fragmentIndex 只在同一 entry 内稳定区分 React key。 */
  key: number;
  order: number;
  fragmentIndex: number;
  descriptor: SkiaFrameFragmentDescriptor;
}>;

export type ScreenOverlayDescriptor =
  | Readonly<{ kind: 'line'; id: string; from: SkiaPoint; to: SkiaPoint; style: SkiaOverlayStyle }>
  | Readonly<{
      kind: 'polyline';
      id: string;
      points: readonly SkiaPoint[];
      closed: boolean;
      style: SkiaOverlayStyle;
    }>
  | Readonly<{
      kind: 'circle';
      id: string;
      center: SkiaPoint;
      radius: number;
      style: SkiaOverlayStyle;
    }>
  | Readonly<{
      kind: 'rect';
      id: string;
      origin: SkiaPoint;
      width: number;
      height: number;
      style: SkiaOverlayStyle;
    }>
  | Readonly<{
      kind: 'text';
      id: string;
      origin: SkiaPoint;
      text: string;
      fontSize: number;
      style: SkiaOverlayStyle;
    }>;

function nonNegativeFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeDashArray(
  dashArray: readonly number[] | undefined,
  budget: FrameDrawBudget
): readonly number[] | undefined {
  if (
    !dashArray ||
    dashArray.length === 0 ||
    !dashArray.every((value) => isDrawNumber(value, budget) && value >= 0) ||
    !dashArray.some((value) => value > 0)
  ) {
    return undefined;
  }

  // Skia DashPathEffect 的 intervals 交替表示 on/off；奇数项按重复语义补齐。
  const intervals = dashArray.length % 2 === 0 ? [...dashArray] : [...dashArray, ...dashArray];
  return isDrawDash(intervals, 0, budget)
    ? intervals
    : undefined;
}

function resolveStyle(stroke: DrawingStrokeV2, allowsFill: boolean, budget: FrameDrawBudget): SkiaStrokeStyle | null {
  // 对持久化的超大/非有限 style 不做隐式 clamp；frame 与 legacy 都必须在描述阶段隔离。
  if (
    (stroke.strokeWidth !== undefined && (!isDrawNumber(stroke.strokeWidth, budget) || stroke.strokeWidth < 0)) ||
    (stroke.fillOpacity !== undefined && (!isDrawNumber(stroke.fillOpacity, budget) || stroke.fillOpacity < 0 || stroke.fillOpacity > 1)) ||
    (stroke.dashOffset !== undefined && !isDrawNumber(stroke.dashOffset, budget))
  ) return null;
  const fillOpacity = finite(stroke.fillOpacity, 1);
  const style = {
    color: stroke.strokeColor ?? DEFAULT_STROKE_COLOR,
    // 显式 0 是无描边，不回退成默认宽度。
    strokeWidth: nonNegativeFinite(stroke.strokeWidth, DEFAULT_STROKE_WIDTH),
    fillColor: allowsFill && stroke.fillColor !== 'none' ? stroke.fillColor : undefined,
    fillOpacity: Math.max(0, Math.min(1, fillOpacity)),
    dashArray: normalizeDashArray(stroke.dashArray, budget),
    dashOffset: finite(stroke.dashOffset, 0),
  };
  return isDrawStyle(style, budget) ? style : null;
}

function imageReference(src: string, resourceId: string | undefined): SkiaImageReference {
  return { src, ...(resourceId === undefined ? {} : { resourceId }) };
}

/** ready resolver 优先消费稳定 ID；旧 src-only resolver 仅在未命中时兼容兜底。 */
function resolveReadyImage(
  reference: SkiaImageReference,
  getImage: ((src: string) => SkImage | null) | undefined,
  resolveImage: ((reference: SkiaImageReference) => SkImage | null) | undefined
): SkImage | null {
  return resolveImage?.(reference) ?? getImage?.(reference.src) ?? null;
}

function rectFromGeometry(
  id: string,
  geometry: Extract<DrawingGeometryDescriptor, { kind: 'rect' }>,
  style: SkiaStrokeStyle
): SkiaRectDescriptor {
  return {
    kind: 'rect',
    id,
    center: geometry.center,
    halfWidth: geometry.halfWidth,
    halfHeight: geometry.halfHeight,
    rotationRad: geometry.rotationRad,
    style,
  };
}

/**
 * 将一个 V2 笔迹转换为 Skia 所需的真实路径/形状描述。这里始终复用 core 的 descriptor，
 * 尤其不会将 bezier 或 pen 的 bounds 误作可绘制路径。
 */
function describeSkiaStrokeGeometry(
  stroke: DrawingStrokeV2,
  geometry: DrawingGeometryDescriptor,
  getImage?: (src: string) => SkImage | null,
  resolveImage?: (reference: SkiaImageReference) => SkImage | null,
  budget: FrameDrawBudget = createLegacyDrawBudget()
): SkiaStrokeDescriptor | null {
  const allowsFill =
    geometry.kind === 'rect' ||
    geometry.kind === 'ellipse' ||
    (geometry.kind === 'path' && geometry.closed);
  const style = resolveStyle(stroke, allowsFill, budget);
  if (style === null) return null;
  if (geometry.kind === 'path') {
    const points =
      stroke.tool === 'pen'
        ? // 坐标只采纳 core 几何；pressure 仅按同索引附加原始笔迹的样式元数据。
          geometry.points.map((point, index) => ({
            ...point,
            pressure: stroke.points[index]?.pressure,
          }))
        : geometry.points;
    if (!geometry.points.every((point) => isDrawPoint(point, budget))) return null;
    return {
      kind: 'path',
      id: stroke.id,
      points,
      closed: geometry.closed,
      pressureSensitive:
        stroke.tool === 'pen' && stroke.points.some((point) => point.pressure !== undefined),
      style,
    };
  }
  if (geometry.kind === 'cubic-bezier') {
    const contour = describeDrawingGeometryContour(geometry);
    // cap 后的轮廓可能超过命中路径所要求的默认误差；宁可不绘制，也不能伪称严格同构。
    if (contour === null || contour.capped || !contour.isWithinRequestedMaxDeviation || !geometry.points.every((point) => isDrawPoint(point, budget)) || !contour.points.every((point) => isDrawPoint(point, budget))) {
      return null;
    }
    return { kind: 'cubic-bezier', id: stroke.id, points: geometry.points, contour, style };
  }
  if (geometry.kind === 'ellipse') {
    const contour = describeDrawingGeometryContour(geometry);
    // 同 cubic：仅消费满足默认 0.25 DIP/1024 cap 契约的共享轮廓。
    if (contour === null || contour.capped || !contour.isWithinRequestedMaxDeviation || !isDrawPoint(geometry.center, budget) || ![geometry.radiusX, geometry.radiusY, geometry.rotationRad].every((value) => isDrawNumber(value, budget)) || !contour.points.every((point) => isDrawPoint(point, budget))) {
      return null;
    }
    return {
      kind: 'ellipse',
      id: stroke.id,
      center: geometry.center,
      radiusX: geometry.radiusX,
      radiusY: geometry.radiusY,
      rotationRad: geometry.rotationRad,
      contour,
      style,
    };
  }

  const rect = rectFromGeometry(stroke.id, geometry, style);
  if (!isDrawPoint(rect.center, budget) || ![rect.halfWidth, rect.halfHeight, rect.rotationRad].every((value) => isDrawNumber(value, budget)) || rect.halfWidth < 0 || rect.halfHeight < 0 || ![rect.center.x - rect.halfWidth, rect.center.x + rect.halfWidth, rect.center.y - rect.halfHeight, rect.center.y + rect.halfHeight].every((value) => isDrawNumber(value, budget))) return null;
  if (stroke.tool === 'text') {
    return {
      kind: 'text',
      id: stroke.id,
      text: stroke.text,
      rect,
      fontSize: positiveFinite(stroke.fontSize, DEFAULT_TEXT_FONT_SIZE),
      style,
    };
  }
  if (stroke.tool === 'image') {
    return {
      kind: 'image',
      id: stroke.id,
      ...(stroke.resourceId === undefined ? {} : { resourceId: stroke.resourceId }),
      src: stroke.src,
      rect,
      // 两个 resolver 都是已就绪资源的同步查询；没有资源时明确选择几何回退。
      image: resolveReadyImage(imageReference(stroke.src, stroke.resourceId), getImage, resolveImage),
      style,
    };
  }
  return rect;
}

/** 阶段 5 兼容路径：仅此入口从原始笔迹描述 core geometry。 */
export function describeSkiaStroke(
  stroke: DrawingStrokeV2,
  getImage?: (src: string) => SkImage | null,
  resolveImage?: (reference: SkiaImageReference) => SkImage | null
): SkiaStrokeDescriptor | null {
  const geometry = describeDrawingStrokeGeometry(stroke);
  const budget = createLegacyDrawBudget();
  if (!isDrawDashInput(stroke.dashArray, stroke.dashOffset ?? 0, budget)) return null;
  if (stroke.tool === 'text' && (stroke.fontSize !== undefined && (!isDrawNumber(stroke.fontSize, budget) || stroke.fontSize <= 0))) return null;
  return geometry === null ? null : describeSkiaStrokeGeometry(stroke, geometry, getImage, resolveImage, budget);
}

export function describeSkiaDocument(
  document: DrawingValueV2,
  getImage?: (src: string) => SkImage | null,
  resolveImage?: (reference: SkiaImageReference) => SkImage | null
): readonly SkiaStrokeDescriptor[] {
  return document.strokes
    .map((stroke) => describeSkiaStroke(stroke, getImage, resolveImage))
    .filter((descriptor): descriptor is SkiaStrokeDescriptor => descriptor !== null);
}

function finitePoint(point: SkiaPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedDashPhase(
  dashArray: readonly number[],
  dashOffset: number,
  sourceDistanceStart: number
): number | null {
  const period = dashArray.reduce((total, value) => total + value, 0);
  if (
    !Number.isFinite(period) ||
    period <= 0 ||
    !Number.isFinite(dashOffset) ||
    !Number.isFinite(sourceDistanceStart)
  )
    return null;
  const normalize = (value: number) => {
    const remainder = value % period;
    return remainder < 0 ? remainder + period : remainder;
  };
  // Skia 的 phase 从当前 path 起点开始计数；片段起点位于 sourceDistanceStart，故把
  // 文档 offset 与该距离相加。分开取模可避免很大的有限距离相加后溢出为 Infinity，
  // 合并后再取模可把两段 [0,period) 的和重新落回 [0,period)。
  //
  // 这是一条声明式的浮点相位契约：两个输入分别取模，避免大有限数相加溢出，再将和
  // 取模回到周期内。它不假设 native JSI 的实现细节，也不承诺跨后端像素连续。
  return normalize(normalize(dashOffset) + normalize(sourceDistanceStart));
}

function describeFrameStrokeFragment(
  entry: DrawingFrameEntry,
  fragment: FrameStrokeFragment,
  budget: FrameDrawBudget
): SkiaFrameStrokeFragmentDescriptor | null {
  if (
    fragment.points.length < 2 ||
    !fragment.points.every(finitePoint) ||
    !Number.isInteger(fragment.sourceSegmentIndex) ||
    fragment.sourceSegmentIndex < 0 ||
    !Number.isFinite(fragment.sourceDistanceStart) ||
    !Number.isFinite(fragment.sourceDistanceEnd) ||
    fragment.sourceDistanceStart < 0 ||
    fragment.sourceDistanceEnd < fragment.sourceDistanceStart
  )
    return null;

  if (!isDrawDashInput(entry.source.stroke.dashArray, entry.source.stroke.dashOffset ?? 0, budget)) return null;
  const style = resolveStyle(entry.source.stroke, false, budget);
  if (style === null || !fragment.points.every((point) => isDrawPoint(point, budget))) return null;
  const dashPhase = style.dashArray
    ? normalizedDashPhase(style.dashArray, style.dashOffset, fragment.sourceDistanceStart)
    : undefined;
  // 未能计算连续 dash 相位时不绘制该 fragment，避免把局部 path 伪装成完整笔划。
  if (dashPhase === null || (dashPhase !== undefined && !isDrawNumber(dashPhase, budget))) return null;
  return {
    kind: 'frame-stroke-fragment',
    id: entry.source.stroke.id,
    points: fragment.points,
    closed: fragment.closed,
    sourceSegmentIndex: fragment.sourceSegmentIndex,
    sourceSegmentStart: fragment.sourceSegmentStart,
    sourceSegmentEnd: fragment.sourceSegmentEnd,
    sourceDistanceStart: fragment.sourceDistanceStart,
    sourceDistanceEnd: fragment.sourceDistanceEnd,
    sourcePressures: fragment.sourcePressures,
    ...(dashPhase === undefined ? {} : { dashPhase }),
    style,
  };
}

function describeFrameResourceBoxFragment(
  entry: DrawingFrameEntry,
  fragment: FrameResourceBoxFragment,
  getImage?: (src: string) => SkImage | null,
  resolveImage?: (reference: SkiaImageReference) => SkImage | null,
  budget: FrameDrawBudget = createLegacyDrawBudget()
): SkiaFrameTextDescriptor | SkiaFrameImageDescriptor | null {
  const { resourceBox } = fragment;
  // 样式来自 prepared source；几何、资源元数据和内容严格来自完整 resourceBox fragment。
  const style = resolveStyle(entry.source.stroke, false, budget);
  if (style === null || !isDrawResourceBox(fragment, budget)) return null;
  const box = {
    layout: resourceBox.layout,
    ...(resourceBox.visible === undefined ? {} : { visiblePolygon: resourceBox.visible.polygon }),
      ...(resourceBox.imageMapping === undefined ? {} : { imageMapping: resourceBox.imageMapping }),
      ...(resourceBox.textProgram === undefined ? {} : { textProgram: resourceBox.textProgram }),
  };
  if (resourceBox.tool === 'text') {
    // partial request 若尚未由 provider 注入 program，不能把原始资源框或 raw text 降级绘制。
    if (resourceBox.textRequest !== undefined && resourceBox.textProgram === undefined) return null;
    const fontSize = positiveFinite(resourceBox.source.fontSize, DEFAULT_TEXT_FONT_SIZE);
    if (!isDrawNumber(fontSize, budget)) return null;
    return {
      kind: 'frame-text',
      id: entry.source.stroke.id,
      resourceBox: box,
      text: resourceBox.source.text ?? '',
      fontSize,
      style,
    };
  }

  const src = resourceBox.source.src ?? '';
  return {
    kind: 'frame-image',
    id: entry.source.stroke.id,
    resourceBox: box,
    ...(resourceBox.source.resourceId === undefined
      ? {}
      : { resourceId: resourceBox.source.resourceId }),
    src,
    image: resolveReadyImage(
      imageReference(src, resourceBox.source.resourceId),
      getImage,
      resolveImage
    ),
    style,
  };
}

function describeFrameFillRegion(
  entry: DrawingFrameEntry,
  fill: FrameFillRegion,
  budget: FrameDrawBudget
): SkiaFrameFillRegionDescriptor | null {
  if (
    fill.kind !== 'fill-region' ||
    fill.fillRule !== 'nonzero' ||
    fill.polygons.length === 0 ||
    !fill.polygons.every(
      (polygon) =>
        polygon.outer.length >= 3 &&
        polygon.outer.every(finitePoint) &&
        polygon.holes.every((hole) => hole.length >= 3 && hole.every(finitePoint))
    )
  ) {
    return null;
  }
  const style = resolveStyle(entry.source.stroke, true, budget);
  if (style === null || !fill.polygons.every((polygon) => polygon.outer.every((point) => isDrawPoint(point, budget)) && polygon.holes.every((hole) => hole.every((point) => isDrawPoint(point, budget))))) return null;
  return {
    kind: 'frame-fill-region',
    id: entry.source.stroke.id,
    fillRule: fill.fillRule,
    polygons: fill.polygons,
    style,
  };
}

function isFrameResourceBoxFragment(
  fragment: DrawingFrameEntry['fragments'][number]
): fragment is FrameResourceBoxFragment {
  return 'resourceBox' in fragment;
}

/**
 * 阶段 6 frame 路径只消费 core 已落地的 program，绝不读取 entry.geometry、
 * canonicalLocalGeometry 或 raw stroke points。普通几何的 stroke/fill 均来自 program；
 * text/image 是资源契约，仍只消费 resourceBox fragment（含其 local clip）。
 */
export function describeSkiaFrameEntries(
  entries: readonly DrawingFrameEntry[],
  getImage?: (src: string) => SkImage | null,
  resolveImage?: (reference: SkiaImageReference) => SkImage | null,
  budget: FrameDrawBudget = createLegacyDrawBudget()
): readonly SkiaPreparedFrameDescriptor[] {
  const descriptors: SkiaPreparedFrameDescriptor[] = [];
  for (const entry of entries) {
    // renderableEntries 应已排除这些状态；这里仍防御性隔离被未类型化调用方伪造的 entry。
    if (entry.status === 'empty' || entry.status === 'unresolved') continue;
    const isResource = entry.source.stroke.tool === 'text' || entry.source.stroke.tool === 'image';
    const programDescriptors: readonly (SkiaFrameStrokeFragmentDescriptor | SkiaFrameFillRegionDescriptor | null)[] = isResource
      ? []
      : [
          ...entry.program.fills.map((fill) => describeFrameFillRegion(entry, fill, budget)),
          ...entry.program.strokes.map((fragment) => describeFrameStrokeFragment(entry, fragment, budget)),
        ];
    programDescriptors.forEach((descriptor, fragmentIndex) => {
      if (descriptor !== null) {
        descriptors.push({
          key: entry.source.key,
          order: entry.source.order,
          fragmentIndex,
          descriptor,
        });
      }
    });
    if (isResource) {
      entry.fragments.forEach((fragment, fragmentIndex) => {
        // text/image 只能由完整 resourceBox 表达；禁止把伪造或 partial 的语义区域降级为
        // 普通填充，避免出现可见却不对应资源内容的 ghost 命中框。
        const descriptor = isFrameResourceBoxFragment(fragment)
          ? describeFrameResourceBoxFragment(entry, fragment, getImage, resolveImage, budget)
          : null;
        if (descriptor !== null) {
          descriptors.push({
            key: entry.source.key,
            order: entry.source.order,
            fragmentIndex,
            descriptor,
          });
        }
      });
    }
  }
  return descriptors;
}

function overlayStyle(style: SkiaOverlayStyle | undefined, budget: FrameDrawBudget): SkiaOverlayStyle | null {
  if (
    (style?.strokeWidth !== undefined && (!isDrawNumber(style.strokeWidth, budget) || style.strokeWidth < 0)) ||
    (style?.fillOpacity !== undefined && (!isDrawNumber(style.fillOpacity, budget) || style.fillOpacity < 0 || style.fillOpacity > 1)) ||
    (style?.dashOffset !== undefined && !isDrawNumber(style.dashOffset, budget))
  ) return null;
  const resolved = {
    color: style?.color ?? '#2878FF',
    fillColor: style?.fillColor !== 'none' ? style?.fillColor : undefined,
    fillOpacity: finite(style?.fillOpacity, 1),
    strokeWidth: nonNegativeFinite(style?.strokeWidth, 1.5),
    dashArray: normalizeDashArray(style?.dashArray, budget),
    dashOffset: finite(style?.dashOffset, 0),
  };
  return isDrawStyle(resolved, budget) ? resolved : null;
}

function safeOverlayDescriptor(descriptor: ScreenOverlayDescriptor, budget: FrameDrawBudget): boolean {
  if (!isDrawStyle({
    strokeWidth: descriptor.style.strokeWidth ?? 1.5,
    fillOpacity: descriptor.style.fillOpacity ?? 1,
    dashArray: descriptor.style.dashArray,
    dashOffset: descriptor.style.dashOffset ?? 0,
  }, budget)) return false;
  if (descriptor.kind === 'line') return isDrawPoint(descriptor.from, budget) && isDrawPoint(descriptor.to, budget);
  if (descriptor.kind === 'polyline') return descriptor.points.length > 0 && descriptor.points.every((point) => isDrawPoint(point, budget));
  if (descriptor.kind === 'circle') return isDrawPoint(descriptor.center, budget) && isDrawNumber(descriptor.radius, budget) && descriptor.radius >= 0 && [
    descriptor.center.x - descriptor.radius, descriptor.center.x + descriptor.radius,
    descriptor.center.y - descriptor.radius, descriptor.center.y + descriptor.radius,
  ].every((value) => isDrawNumber(value, budget));
  if (descriptor.kind === 'rect') return isDrawPoint(descriptor.origin, budget) && isDrawNumber(descriptor.width, budget) && isDrawNumber(descriptor.height, budget) && isDrawNumber(descriptor.origin.x + descriptor.width, budget) && isDrawNumber(descriptor.origin.y + descriptor.height, budget);
  const layoutWidth = Math.max(descriptor.fontSize, descriptor.text.length * descriptor.fontSize * 0.6);
  return isDrawPoint(descriptor.origin, budget) && isDrawNumber(descriptor.fontSize, budget) && descriptor.fontSize >= 0 &&
    isDrawNumber(layoutWidth, budget) && isDrawNumber(descriptor.origin.x + layoutWidth, budget) &&
    isDrawNumber(descriptor.origin.y - descriptor.fontSize, budget);
}

function projectPoint(
  point: SkiaPoint,
  overlay: SkiaOverlay,
  viewport: DrawingViewport
): SkiaPoint {
  return overlay.space === 'world'
    ? mapViewportAffinePoint(point, createViewportAffine(viewport))
    : { x: point.x, y: point.y };
}

function projectFramePoint(
  point: SkiaPoint,
  overlay: SkiaOverlay,
  localToScreen: Affine2D
): SkiaPoint {
  return overlay.space === 'world'
    ? mapViewportAffinePoint(point, localToScreen)
    : { x: point.x, y: point.y };
}

/**
 * 世界 overlay 不进入世界 Group：其锚点/顶点在这里手工投影为屏幕坐标，线宽、marker、
 * dash 不乘 scale。screen overlay 直接保留输入，因而 viewport 变化不会影响它。
 */
export function describeScreenOverlays(
  overlays: readonly SkiaOverlay[],
  viewport: DrawingViewport
): readonly ScreenOverlayDescriptor[] {
  const budget = createLegacyDrawBudget();
  return overlays.map((overlay): ScreenOverlayDescriptor | null => {
    const style = overlayStyle(overlay.style, budget);
    if (style === null) return null;
    if (overlay.kind === 'line') {
      return {
        kind: 'line',
        id: overlay.id,
        from: projectPoint(overlay.from, overlay, viewport),
        to: projectPoint(overlay.to, overlay, viewport),
        style,
      };
    }
    if (overlay.kind === 'polyline') {
      return {
        kind: 'polyline',
        id: overlay.id,
        points: overlay.points.map((point) => projectPoint(point, overlay, viewport)),
        closed: overlay.closed ?? false,
        style,
      };
    }
    if (overlay.kind === 'circle') {
      return {
        kind: 'circle',
        id: overlay.id,
        center: projectPoint(overlay.center, overlay, viewport),
        radius: nonNegativeFinite(overlay.radius, 1),
        style,
      };
    }
    if (overlay.kind === 'rect') {
      if (overlay.space === 'screen') {
        return {
          kind: 'rect',
          id: overlay.id,
          origin: overlay.origin,
          width: overlay.width,
          height: overlay.height,
          style,
        };
      }
      const { origin, width, height } = overlay;
      // world 矩形的四个顶点均须投影，不能只缩放 x/y 后遗忘其余顶点。
      return {
        kind: 'polyline',
        id: overlay.id,
        points: [
          projectPoint(origin, overlay, viewport),
          projectPoint({ x: origin.x + width, y: origin.y }, overlay, viewport),
          projectPoint({ x: origin.x + width, y: origin.y + height }, overlay, viewport),
          projectPoint({ x: origin.x, y: origin.y + height }, overlay, viewport),
        ],
        closed: true,
        style,
      };
    }
    return {
      kind: 'text',
      id: overlay.id,
      origin: projectPoint(overlay.origin, overlay, viewport),
      text: overlay.text,
      fontSize: nonNegativeFinite(overlay.fontSize, DEFAULT_TEXT_FONT_SIZE),
      style,
    };
  }).filter((descriptor): descriptor is ScreenOverlayDescriptor => descriptor !== null && safeOverlayDescriptor(descriptor, budget));
}

/**
 * frame 的 world overlay 输入与 frame geometry 同为 local 坐标：只投影锚点/顶点一次；
 * screen overlay 则保持 identity screen DIP。这里不构造 viewport，也不触碰 frameOrigin。
 */
export function describeFrameScreenOverlays(
  overlays: readonly SkiaOverlay[],
  localToScreen: Affine2D,
  budget: FrameDrawBudget = createLegacyDrawBudget()
): readonly ScreenOverlayDescriptor[] {
  const project = (point: SkiaPoint, overlay: SkiaOverlay) =>
    projectFramePoint(point, overlay, localToScreen);
  return overlays.map((overlay): ScreenOverlayDescriptor | null => {
    const style = overlayStyle(overlay.style, budget);
    if (style === null) return null;
    if (overlay.kind === 'line') {
      return {
        kind: 'line',
        id: overlay.id,
        from: project(overlay.from, overlay),
        to: project(overlay.to, overlay),
        style,
      };
    }
    if (overlay.kind === 'polyline') {
      return {
        kind: 'polyline',
        id: overlay.id,
        points: overlay.points.map((point) => project(point, overlay)),
        closed: overlay.closed ?? false,
        style,
      };
    }
    if (overlay.kind === 'circle') {
      return {
        kind: 'circle',
        id: overlay.id,
        center: project(overlay.center, overlay),
        radius: nonNegativeFinite(overlay.radius, 1),
        style,
      };
    }
    if (overlay.kind === 'rect') {
      if (overlay.space === 'screen') {
        return {
          kind: 'rect',
          id: overlay.id,
          origin: overlay.origin,
          width: overlay.width,
          height: overlay.height,
          style,
        };
      }
      const { origin, width, height } = overlay;
      return {
        kind: 'polyline',
        id: overlay.id,
        points: [
          project(origin, overlay),
          project({ x: origin.x + width, y: origin.y }, overlay),
          project({ x: origin.x + width, y: origin.y + height }, overlay),
          project({ x: origin.x, y: origin.y + height }, overlay),
        ],
        closed: true,
        style,
      };
    }
    return {
      kind: 'text',
      id: overlay.id,
      origin: project(overlay.origin, overlay),
      text: overlay.text,
      fontSize: nonNegativeFinite(overlay.fontSize, DEFAULT_TEXT_FONT_SIZE),
      style,
    };
  }).filter((descriptor): descriptor is ScreenOverlayDescriptor => descriptor !== null && safeOverlayDescriptor(descriptor, budget));
}
