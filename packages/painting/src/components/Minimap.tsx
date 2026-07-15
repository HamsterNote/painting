import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { StrokeRenderer } from '../render/StrokeRenderer';
import { type DrawingViewport, normalizeViewport } from '../viewport';
import type { DrawingStroke, DrawingValue } from './DrawingSurface';

/**
 * Minimap 内容的包围盒（canvas 坐标空间）。
 * 当没有笔画时为 null。
 */
type ContentBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * 主画布容器的尺寸（CSS 像素），用于计算视口指示框。
 */
type ContainerSize = {
  width: number;
  height: number;
};

/**
 * 从所有笔画点中计算内容包围盒。
 * 遍历每条 stroke 的每个点，取 min/max。
 *
 * @param strokes - 笔画数组
 * @returns 包围盒，若没有有效点则返回 null
 */
function computeContentBBox(strokes: readonly DrawingStroke[]): ContentBBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoint = false;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue;
      }
      hasPoint = true;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  if (!hasPoint) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * 计算将内容包围盒适配到 minimap 尺寸所需的缩放和偏移。
 *
 * @param bbox - 内容包围盒（canvas 空间）
 * @param minimapWidth - minimap SVG 宽度
 * @param minimapHeight - minimap SVG 高度
 * @param padding - 内边距（像素）
 * @returns { scale, tx, ty } 用于 SVG transform
 */
function computeFitTransform(
  bbox: ContentBBox,
  minimapWidth: number,
  minimapHeight: number,
  padding: number,
): { scale: number; tx: number; ty: number } {
  const contentWidth = bbox.maxX - bbox.minX;
  const contentHeight = bbox.maxY - bbox.minY;

  // 可用绘制区域
  const availWidth = Math.max(minimapWidth - 2 * padding, 1);
  const availHeight = Math.max(minimapHeight - 2 * padding, 1);

  // 防止除以 0：若内容宽/高为 0，使用另一方向的 scale 或 1
  const scaleX = contentWidth > 0 ? availWidth / contentWidth : Infinity;
  const scaleY = contentHeight > 0 ? availHeight / contentHeight : Infinity;
  const scale = Math.min(scaleX, scaleY);

  // 若内容为 0 宽/高，退化为有限值
  const safeScale = Number.isFinite(scale) ? scale : 1;

  // 居中偏移：将内容的左上角映射到 padding + 居中余量 的位置
  const renderedWidth = contentWidth * safeScale;
  const renderedHeight = contentHeight * safeScale;
  const tx = padding + (availWidth - renderedWidth) / 2 - bbox.minX * safeScale;
  const ty = padding + (availHeight - renderedHeight) / 2 - bbox.minY * safeScale;

  return { scale: safeScale, tx, ty };
}

/**
 * 将 canvas 坐标点转换为 minimap SVG 坐标。
 *
 * @param canvasX - canvas 空间 X
 * @param canvasY - canvas 空间 Y
 * @param fit - 适配变换（scale + tx/ty）
 * @returns minimap SVG 坐标
 */
function canvasToMinimap(
  canvasX: number,
  canvasY: number,
  fit: { scale: number; tx: number; ty: number },
): { x: number; y: number } {
  return {
    x: canvasX * fit.scale + fit.tx,
    y: canvasY * fit.scale + fit.ty,
  };
}

/**
 * 将 minimap SVG 坐标转换为 canvas 坐标（click-to-pan 反向映射）。
 *
 * @param minimapX - minimap SVG X
 * @param minimapY - minimap SVG Y
 * @param fit - 适配变换
 * @returns canvas 空间坐标
 */
function minimapToCanvas(
  minimapX: number,
  minimapY: number,
  fit: { scale: number; tx: number; ty: number },
): { x: number; y: number } {
  const safeScale = fit.scale !== 0 ? fit.scale : 1;
  return {
    x: (minimapX - fit.tx) / safeScale,
    y: (minimapY - fit.ty) / safeScale,
  };
}

/**
 * Minimap 组件的 Props。
 *
 * Minimap 是一个独立于主画布的缩略图组件，用于展示所有笔画的全局视图，
 * 并可选地显示当前视口在画布中的位置（视口指示框）。
 *
 * - 独立渲染：不依赖 DrawingSurface 的 DOM，仅通过 `value` 获取笔画数据。
 * - 视口指示：传入 `viewport` + `containerSize` 即可绘制视口框。
 * - 点击平移：传入 `onViewportChange` 后，点击 minimap 可将主画布视口居中到对应位置。
 */
export type MinimapProps = {
  /** 笔画数据（必须），与 DrawingSurface 的 value 共享同一数据源 */
  value: DrawingValue;
  /** 当前主画布的视口状态，用于绘制视口指示框 */
  viewport?: DrawingViewport;
  /** 主画布容器的尺寸（CSS 像素），与 viewport 配合计算可见区域 */
  containerSize?: ContainerSize;
  /** 点击 minimap 时回调，参数为新的视口（保持原 scale，仅平移） */
  onViewportChange?: (viewport: DrawingViewport) => void;

  /** minimap SVG 宽度（像素），默认 180 */
  width?: number;
  /** minimap SVG 高度（像素），默认 120 */
  height?: number;
  /** 内容内边距（像素），默认 12 */
  padding?: number;

  /** minimap 背景色，默认透明 */
  background?: string;
  /** 视口指示框边框颜色，默认 '#2563eb' */
  viewportStroke?: string;
  /** 视口指示框边框宽度，默认 1.5 */
  viewportStrokeWidth?: number;
  /** 视口指示框填充色，默认 'rgba(37, 99, 235, 0.08)' */
  viewportFill?: string;
  /** 视口指示框圆角，默认 2 */
  viewportRx?: number;

  /** StrokeRenderer 的回退描边颜色，默认 '#333' */
  fallbackStrokeColor?: string;
  /** StrokeRenderer 的回退描边宽度，默认 1 */
  fallbackStrokeWidth?: number;

  /** 自定义外层 div 的 className */
  className?: string;
  /** 自定义外层 div 的 style */
  style?: CSSProperties;
  /** data-testid，默认 'minimap' */
  testId?: string;
};

/**
 * Minimap 缩略图组件。
 *
 * 独立于主画布渲染，通过 SVG 展示所有笔画的缩略全貌，
 * 并可显示当前视口位置、支持点击平移。
 *
 * @example
 * ```tsx
 * <Minimap
 *   value={value}
 *   viewport={viewport}
 *   containerSize={{ width: 800, height: 600 }}
 *   onViewportChange={setViewport}
 * />
 * ```
 */
export function Minimap({
  value,
  viewport,
  containerSize,
  onViewportChange,
  width = 180,
  height = 120,
  padding = 12,
  background = 'transparent',
  viewportStroke = '#2563eb',
  viewportStrokeWidth = 1.5,
  viewportFill = 'rgba(37, 99, 235, 0.08)',
  viewportRx = 2,
  fallbackStrokeColor = '#333',
  fallbackStrokeWidth = 1,
  className,
  style,
  testId = 'minimap',
}: MinimapProps): React.ReactNode {
  // 边界计算与实际渲染必须使用同一份有效点集，否则一个非法点会让整条 SVG path 失效。
  const renderableStrokes = useMemo(
    () =>
      value.strokes
        .map((stroke) => ({
          ...stroke,
          points: stroke.points.filter(
            (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
          ),
        }))
        .filter((stroke) => stroke.points.length > 0),
    [value.strokes],
  );
  const resolvedViewport = useMemo(
    () => (viewport ? normalizeViewport(viewport) : undefined),
    [viewport],
  );

  // 1. 计算内容包围盒
  const bbox = useMemo(() => computeContentBBox(renderableStrokes), [renderableStrokes]);

  // 2. 计算适配变换（将内容居中缩放到 minimap 区域）
  const fit = useMemo(() => {
    if (!bbox) {
      return { scale: 1, tx: 0, ty: 0 };
    }
    return computeFitTransform(bbox, width, height, padding);
  }, [bbox, width, height, padding]);

  // 3. 计算视口指示框（若提供了 viewport + containerSize）
  const viewportRect = useMemo(() => {
    if (!resolvedViewport || !containerSize || !bbox) {
      return null;
    }

    const scale = resolvedViewport.scale;

    // 主画布中可见的 canvas 空间范围
    const visMinX = -resolvedViewport.tx / scale;
    const visMinY = -resolvedViewport.ty / scale;
    const visMaxX = (containerSize.width - resolvedViewport.tx) / scale;
    const visMaxY = (containerSize.height - resolvedViewport.ty) / scale;

    // 转换到 minimap SVG 坐标
    const topLeft = canvasToMinimap(visMinX, visMinY, fit);
    const bottomRight = canvasToMinimap(visMaxX, visMaxY, fit);

    const rectX = Math.min(topLeft.x, bottomRight.x);
    const rectY = Math.min(topLeft.y, bottomRight.y);
    const rectW = Math.abs(bottomRight.x - topLeft.x);
    const rectH = Math.abs(bottomRight.y - topLeft.y);

    return { x: rectX, y: rectY, width: rectW, height: rectH };
  }, [resolvedViewport, containerSize, bbox, fit]);

  // 4. 点击平移：将 minimap 点击位置映射为 canvas 坐标，再居中视口
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (
        !onViewportChange ||
        !resolvedViewport ||
        !containerSize ||
        !bbox ||
        event.button !== 0 ||
        !event.isPrimary
      ) {
        return;
      }

      const svg = svgRef.current;
      if (!svg) {
        return;
      }

      // 获取点击位置相对于 SVG 的坐标（使用 SVG 的用户坐标系）
      const rect = svg.getBoundingClientRect();
      // rect.width/height 在无 CSS 缩放时等于 SVG 的 width/height 属性；
      // 在测试环境（jsdom）中可能为 0，此时回退到 props 值
      const rectWidth = rect.width > 0 ? rect.width : width;
      const rectHeight = rect.height > 0 ? rect.height : height;
      const scaleX = width / rectWidth;
      const scaleY = height / rectHeight;
      const minimapX = (event.clientX - rect.left) * scaleX;
      const minimapY = (event.clientY - rect.top) * scaleY;

      // minimap 坐标 -> canvas 坐标
      const canvasPoint = minimapToCanvas(minimapX, minimapY, fit);

      // 居中视口到该 canvas 点：保持 scale 不变，调整 tx/ty
      const newViewport: DrawingViewport = {
        scale: resolvedViewport.scale,
        tx: containerSize.width / 2 - canvasPoint.x * resolvedViewport.scale,
        ty: containerSize.height / 2 - canvasPoint.y * resolvedViewport.scale,
      };

      onViewportChange(newViewport);
    },
    [onViewportChange, resolvedViewport, containerSize, bbox, fit, width, height],
  );

  // 阻止默认的 drag 行为，避免拖拽时选中文字
  const handleDragStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
  }, []);

  // 外层容器样式
  const containerStyle: CSSProperties = {
    display: 'inline-block',
    position: 'relative',
    ...style,
  };

  return (
    <div className={className} style={containerStyle} data-testid={testId}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', background, cursor: onViewportChange ? 'pointer' : 'default' }}
        onPointerDown={handlePointerDown}
        onDragStart={handleDragStart}
        data-testid="minimap-svg"
      >
        <title>Minimap</title>
        {/* 笔画层：使用适配变换缩放渲染所有 stroke */}
        {bbox && (
          <g transform={`translate(${fit.tx} ${fit.ty}) scale(${fit.scale})`}>
            {renderableStrokes.map((stroke) => (
              <StrokeRenderer
                key={stroke.id}
                stroke={stroke}
                fallbackColor={fallbackStrokeColor}
                fallbackWidth={fallbackStrokeWidth}
              />
            ))}
          </g>
        )}

        {/* 视口指示框：展示主画布当前可见区域在画布中的位置 */}
        {viewportRect && (
          <rect
            x={viewportRect.x}
            y={viewportRect.y}
            width={viewportRect.width}
            height={viewportRect.height}
            fill={viewportFill}
            stroke={viewportStroke}
            strokeWidth={viewportStrokeWidth}
            rx={viewportRx}
            ry={viewportRx}
            data-testid="minimap-viewport-rect"
          />
        )}

        {/* 无内容时的占位提示 */}
        {!bbox && (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#999"
            fontSize={11}
            data-testid="minimap-empty-text"
          >
            暂无内容
          </text>
        )}
      </svg>
    </div>
  );
}
