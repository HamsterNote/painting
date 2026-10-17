import type { ComponentProps } from 'react';
import type { Canvas, SkImage, SkTypefaceFontProvider } from '@shopify/react-native-skia';
import type { DrawingFrame } from '../core/drawingFrame';
import type { DrawingPointV2 } from '../model/strokes';
import type { DrawingValueV2 } from '../model/strokes';
import type { DrawingViewport } from '../viewport';

/** 所有公开 Skia 坐标均是 DIP；渲染器不读取或换算设备像素比。 */
export type SkiaPoint = Readonly<{
  x: number;
  y: number;
}>;

export type SkiaStrokeStyle = Readonly<{
  color: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity: number;
  /** 文档笔迹的虚线长度和相位处于 world DIP，会随世界 Group 一起缩放。 */
  dashArray?: readonly number[];
  dashOffset: number;
}>;

export type SkiaOverlayStyle = Readonly<{
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  /** overlay 的线宽始终是 screen DIP，不受 viewport 缩放影响。 */
  strokeWidth?: number;
  /** overlay 的虚线长度和相位始终是 screen DIP。 */
  dashArray?: readonly number[];
  dashOffset?: number;
}>;

type SkiaOverlayBase = Readonly<{
  id: string;
  space: 'world' | 'screen';
  style?: SkiaOverlayStyle;
}>;

export type SkiaLineOverlay = SkiaOverlayBase & Readonly<{
  kind: 'line';
  from: SkiaPoint;
  to: SkiaPoint;
}>;

export type SkiaPolylineOverlay = SkiaOverlayBase & Readonly<{
  kind: 'polyline';
  points: readonly SkiaPoint[];
  closed?: boolean;
}>;

export type SkiaCircleOverlay = SkiaOverlayBase & Readonly<{
  kind: 'circle';
  center: SkiaPoint;
  /** 半径始终是 screen DIP；world 圆只投影圆心，不缩放 marker。 */
  radius: number;
}>;

export type SkiaRectOverlay = SkiaOverlayBase & Readonly<{
  kind: 'rect';
  origin: SkiaPoint;
  width: number;
  height: number;
}>;

export type SkiaTextOverlay = SkiaOverlayBase & Readonly<{
  kind: 'text';
  origin: SkiaPoint;
  text: string;
  fontSize: number;
  /** 文字只使用 color；fill 与 dash 仅适用于可填充/描边的几何 overlay。 */
}>;

/**
 * 可测试的屏幕标注契约。world 原语只投影锚点/顶点；所有视觉样式保留屏幕 DIP。
 */
export type SkiaOverlay =
  | SkiaLineOverlay
  | SkiaPolylineOverlay
  | SkiaCircleOverlay
  | SkiaRectOverlay
  | SkiaTextOverlay;

/**
 * 资源均由调用方同步注入。此渲染器不持有加载状态、不缓存也不执行权限或重试逻辑。
 */
export type SkiaDrawingResources = Readonly<{
  /** Paragraph 使用的已注册字体提供者；不接受系统 font manager 或按需字体匹配。 */
  fontManager?: SkTypefaceFontProvider;
  fontFamily?: string;
  /** 已就绪图片的稳定引用；resourceId 命中优先，src 仅作为兼容回退。 */
  resolveImage?: (reference: SkiaImageReference) => SkImage | null;
  /** 旧的 src-only 同步查询入口；resolveImage 未命中时才使用。 */
  getImage?: (src: string) => SkImage | null;
}>;

/** Skia adapter 消费的同步 ready 资源引用；不承载加载、权限或 I/O 状态。 */
export type SkiaImageReference = Readonly<{
  resourceId?: string;
  src: string;
}>;

type SkiaDrawingCanvasCommonProps = Readonly<{
  overlays?: readonly SkiaOverlay[];
  /** Canvas 原生 props；其布局尺寸以及其中涉及的坐标必须传入 DIP。 */
  canvasProps?: Omit<ComponentProps<typeof Canvas>, 'children'>;
}>;

/**
 * 阶段 5 兼容入口。仅当调用方尚未拥有 core 的 DrawingFrame 时使用；渲染器会在此分支
 * 描述整份 document 并构造 viewport affine。
 */
type SkiaLegacyDrawingCanvasInput = Readonly<{
  document: DrawingValueV2;
  viewport: DrawingViewport;
  frame?: never;
}>;

/**
 * 阶段 6 入口。frame 已包含剔除、重基后的局部几何和唯一 local-to-screen affine，
 * 因而不能再混入 document 或 viewport，避免重新描述 geometry 或二次变换。
 */
type SkiaFrameDrawingCanvasInput = Readonly<{
  frame: DrawingFrame;
  document?: never;
  viewport?: never;
}>;

/**
 * 绘制输入是互斥的：优先使用 frame；仅为阶段 5 调用方保留 document + viewport 回退。
 */
export type SkiaDrawingCanvasProps = SkiaDrawingResources & SkiaDrawingCanvasCommonProps & (
  | SkiaLegacyDrawingCanvasInput
  | SkiaFrameDrawingCanvasInput
);

export type SkiaGeometryPoint = DrawingPointV2;
