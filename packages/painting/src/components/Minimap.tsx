import { useCallback, useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import { StrokeRenderer } from '../render/StrokeRenderer';
import {
  type DrawingViewport,
  type ViewportPoint,
  clampScale,
  normalizeViewport,
  screenToCanvas,
} from '../viewport';
import type { DrawingStroke } from './DrawingSurface';

// ============================================================
// 类型定义
// ============================================================

/**
 * Minimap 配置选项。
 * 传给 DrawingSurface 的 `minimap` prop 来启用/配置小地图。
 */
export type MinimapOptions = {
  /** 是否启用 minimap，默认 true */
  enabled?: boolean;
  /** minimap 宽度（CSS 像素），默认 200 */
  width?: number;
  /** minimap 高度（CSS 像素），默认 150 */
  height?: number;
  /** minimap 在画布中的停靠位置，默认 'bottom-right' */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** 测试 ID */
  testID?: string;
};

/**
 * Minimap 组件的 props（独立使用时）。
 * 通常通过 DrawingSurface 的 `minimap` prop 间接使用，
 * 但也可以作为独立组件渲染（需要配合受控 viewport）。
 */
export type MinimapProps = {
  /** 所有笔画（用于渲染缩略图预览） */
  strokes: readonly DrawingStroke[];
  /** 当前视口状态 */
  viewport: DrawingViewport;
  /** 视口变化回调（拖动指示框/缩放时触发） */
  onViewportChange: (viewport: DrawingViewport) => void;
  /** 主画布宿主元素的尺寸（CSS 像素），用于计算指示框大小 */
  hostSize: { width: number; height: number };
  /** minimap 宽度，默认 200 */
  width?: number;
  /** minimap 高度，默认 150 */
  height?: number;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 测试 ID */
  testID?: string;
};

// ============================================================
// 常量
// ============================================================

/** 默认 minimap 宽度 */
const DEFAULT_MINIMAP_WIDTH = 200;
/** 默认 minimap 高度 */
const DEFAULT_MINIMAP_HEIGHT = 150;
/** minimap 内容与边框的间距 */
const MINIMAP_PADDING = 8;
/** 无笔画时的默认内容区域 */
const DEFAULT_CONTENT_BOUNDS = {
  minX: -200,
  minY: -150,
  maxX: 200,
  maxY: 150,
};

// ============================================================
// 几何工具函数
// ============================================================

/** 包围盒类型 */
type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * 计算所有笔画的包围盒。
 * 遍历每个 stroke 的所有点，取 min/max。
 * 对于 rect/ellipse 等形状工具，points 数组已包含定义包围盒的角点，
 * 所以简单遍历点即可获得正确的包围盒。
 */
function computeStrokesBounds(strokes: readonly DrawingStroke[]): Bounds | null {
  if (strokes.length === 0) return null;

  let result: Bounds | null = null;
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    for (const point of stroke.points) {
      if (result === null) {
        result = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
      } else {
        if (point.x < result.minX) result.minX = point.x;
        if (point.y < result.minY) result.minY = point.y;
        if (point.x > result.maxX) result.maxX = point.x;
        if (point.y > result.maxY) result.maxY = point.y;
      }
    }
  }
  return result;
}

/** 向外扩展包围盒 */
function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

/**
 * Minimap 拟合结果：描述画布坐标到 minimap 坐标的线性映射。
 * minimap_x = canvas_x * scale + offsetX
 * minimap_y = canvas_y * scale + offsetY
 */
type MinimapFit = {
  /** 画布 -> minimap 缩放比 */
  scale: number;
  /** 画布原点 (0,0) 在 minimap 中的 X 偏移 */
  offsetX: number;
  /** 画布原点 (0,0) 在 minimap 中的 Y 偏移 */
  offsetY: number;
};

/**
 * 将内容包围盒拟合到 minimap 尺寸中（等比缩放 + 居中）。
 */
function fitBounds(
  bounds: Bounds,
  minimapWidth: number,
  minimapHeight: number,
  padding: number
): MinimapFit {
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;

  const availableWidth = minimapWidth - 2 * padding;
  const availableHeight = minimapHeight - 2 * padding;

  // 避免除零：确保内容尺寸至少为 1
  const safeContentWidth = Math.max(contentWidth, 1);
  const safeContentHeight = Math.max(contentHeight, 1);

  // 取宽高比中较小的缩放比，保证内容完全可见
  const scale = Math.min(availableWidth / safeContentWidth, availableHeight / safeContentHeight);

  // 居中内容
  const scaledContentWidth = safeContentWidth * scale;
  const scaledContentHeight = safeContentHeight * scale;
  const offsetX = padding + (availableWidth - scaledContentWidth) / 2 - bounds.minX * scale;
  const offsetY = padding + (availableHeight - scaledContentHeight) / 2 - bounds.minY * scale;

  return { scale, offsetX, offsetY };
}

/** 画布坐标 -> minimap 坐标 */
function canvasToMinimap(point: ViewportPoint, fit: MinimapFit): ViewportPoint {
  return {
    x: point.x * fit.scale + fit.offsetX,
    y: point.y * fit.scale + fit.offsetY,
  };
}

/** minimap 坐标 -> 画布坐标 */
function minimapToCanvas(point: ViewportPoint, fit: MinimapFit): ViewportPoint {
  return {
    x: (point.x - fit.offsetX) / fit.scale,
    y: (point.y - fit.offsetY) / fit.scale,
  };
}

/**
 * 计算视口指示框在 minimap 坐标系中的位置和尺寸。
 * 指示框表示主画布当前可见的区域。
 */
function computeIndicatorBox(
  viewport: DrawingViewport,
  hostSize: { width: number; height: number },
  fit: MinimapFit
): { x: number; y: number; width: number; height: number } {
  // 视口左上角在画布坐标系中的位置
  const canvasTopLeft = screenToCanvas({ x: 0, y: 0 }, viewport);
  // 视口可见区域在画布坐标系中的尺寸
  const canvasWidth = hostSize.width / viewport.scale;
  const canvasHeight = hostSize.height / viewport.scale;

  // 转换到 minimap 坐标系
  const minimapTopLeft = canvasToMinimap(canvasTopLeft, fit);

  return {
    x: minimapTopLeft.x,
    y: minimapTopLeft.y,
    width: canvasWidth * fit.scale,
    height: canvasHeight * fit.scale,
  };
}

function clipIndicatorBox(
  box: { x: number; y: number; width: number; height: number },
  minimapWidth: number,
  minimapHeight: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(box.x, minimapWidth));
  const y = Math.max(0, Math.min(box.y, minimapHeight));
  const right = Math.max(x, Math.min(box.x + box.width, minimapWidth));
  const bottom = Math.max(y, Math.min(box.y + box.height, minimapHeight));

  return { x, y, width: right - x, height: bottom - y };
}

/**
 * 将客户端坐标（clientX/clientY）转换为 minimap 容器局部坐标。
 */
function clientToMinimapLocal(
  clientX: number,
  clientY: number,
  container: HTMLElement
): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

// ============================================================
// Minimap 组件
// ============================================================

/**
 * 小地图组件。
 *
 * 功能：
 * 1. 拖动指示框主体 -> 平移主视图（原生 Pointer Events）
 * 2. 点击 minimap 背景 -> 立即平移到该点
 * 3. 拖动指示框边缘/角落 -> 缩放主视图（以指示框中心为锚点）
 * 4. 指示框宽高比始终与主画布一致（锁定纵横比）
 *
 * 坐标系关系：
 * - 画布坐标 (canvas)：笔画的原始坐标
 * - 屏幕坐标 (screen)：主画布容器内的 CSS 像素位置
 * - minimap 坐标：minimap 容器内的 CSS 像素位置
 *
 * 映射公式：
 * - screen = canvas * viewport.scale + viewport.{tx,ty}
 * - minimap = canvas * fit.scale + fit.{offsetX,offsetY}
 */
export function Minimap({
  strokes,
  viewport,
  onViewportChange,
  hostSize,
  width = DEFAULT_MINIMAP_WIDTH,
  height = DEFAULT_MINIMAP_HEIGHT,
  style,
  testID,
}: MinimapProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderableStrokes = useMemo(
    () =>
      strokes
        .map((stroke) => ({
          ...stroke,
          points: stroke.points.filter(
            (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
          ),
        }))
        .filter((stroke) => stroke.points.length > 0),
    [strokes]
  );
  const resolvedViewport = useMemo(() => normalizeViewport(viewport), [viewport]);

  // ---- Refs：在指针事件回调中访问最新值（避免重建监听器）----
  const viewportRef = useRef(resolvedViewport);
  viewportRef.current = resolvedViewport;
  const hostSizeRef = useRef(hostSize);
  hostSizeRef.current = hostSize;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // ---- 计算内容包围盒 ----
  // 仅基于笔画，不包含视口可见区域，保证平移时 minimap 视图稳定
  const contentBounds = useMemo((): Bounds => {
    const strokesBounds = computeStrokesBounds(renderableStrokes);
    let bounds: Bounds = strokesBounds ?? DEFAULT_CONTENT_BOUNDS;

    // 确保最小尺寸，避免退化情况（所有点在同一位置等）
    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    if (boundsWidth < 100) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      bounds = { ...bounds, minX: cx - 50, maxX: cx + 50 };
    }
    if (boundsHeight < 100) {
      const cy = (bounds.minY + bounds.maxY) / 2;
      bounds = { ...bounds, minY: cy - 50, maxY: cy + 50 };
    }

    // 向外扩展 50px 留白
    return expandBounds(bounds, 50);
  }, [renderableStrokes]);

  // ---- 计算 minimap 拟合参数 ----
  const fit = useMemo(
    () => fitBounds(contentBounds, width, height, MINIMAP_PADDING),
    [contentBounds, width, height]
  );

  // fit ref 用于 multi-drag 回调中读取最新值
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // ---- 计算视口指示框 ----
  const indicatorBox = useMemo(
    () => computeIndicatorBox(resolvedViewport, hostSize, fit),
    [resolvedViewport, hostSize, fit]
  );
  const visibleIndicatorBox = useMemo(
    () => clipIndicatorBox(indicatorBox, width, height),
    [height, indicatorBox, width]
  );
  const visibleIndicatorBoxRef = useRef(visibleIndicatorBox);
  visibleIndicatorBoxRef.current = visibleIndicatorBox;

  // ---- 手势状态 refs ----
  type GestureMode = 'pan' | 'resize' | null;
  const gestureModeRef = useRef<GestureMode>(null);
  const gestureStartViewportRef = useRef<DrawingViewport | null>(null);
  const gestureStartIndicatorRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const gestureStartPointRef = useRef<{ x: number; y: number } | null>(null);
  // 指针 ID 用于追踪当前活跃的指针（-1 表示无活跃指针）
  const activePointerIdRef = useRef<number>(-1);

  // ---- 指针事件处理 ----
  // 使用原生 Pointer Events 而非 @system-ui-js/multi-drag Mixin，
  // 因为 minimap 只需要简单的单指针拖拽，不需要多指/旋转/惯性等复杂手势。
  // 原生事件更直接、更可靠，且避免了 Mixin 内部 Pose 状态管理的潜在问题。

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // ⚠️ 关键：在捕获阶段拦截 pointerdown 并阻止冒泡。
    // DrawingSurface 自身有 @system-ui-js/multi-drag Mixin，在其容器元素上注册了
    // 原生 pointerdown 监听器（冒泡阶段）。如果不阻止，pointerdown 会从 minimap
    // 容器冒泡到 DrawingSurface 容器，Mixin 会创建 Finger 并处理相同的指针事件，
    // 导致 minimap 拖拽时主画布也被干扰（例如意外缩放/平移/绘制）。
    //
    // 使用 onPointerDownCapture（React 捕获阶段）+ stopPropagation()：
    // - React 捕获阶段委托在根节点触发，先于原生冒泡阶段
    // - stopPropagation() 调用 nativeEvent.stopPropagation()，
    //   阻止原生事件继续传播（包括后续的冒泡阶段）
    // - DrawingSurface 的 Mixin（冒泡阶段监听器）不会收到 pointerdown，
    //   因此不会创建 Finger，后续 pointermove/pointerup 也不会被 Mixin 处理
    event.stopPropagation();

    // 仅处理左键鼠标 / 触摸 / 笔
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // 同一时间只允许一个指针
    if (activePointerIdRef.current !== -1) return;

    const container = containerRef.current;
    if (!container) return;

    activePointerIdRef.current = event.pointerId;
    // 捕获指针：确保后续 pointermove/pointerup 都发到这个元素
    container.setPointerCapture(event.pointerId);

    // 捕获手势起始状态
    gestureStartViewportRef.current = { ...viewportRef.current };
    gestureStartIndicatorRef.current = visibleIndicatorBoxRef.current;

    // 起始指针位置（minimap 局部坐标）
    const localPoint = clientToMinimapLocal(event.clientX, event.clientY, container);
    gestureStartPointRef.current = localPoint;

    // 通过事件目标判断手势类型
    const target = event.target;
    if (target instanceof Element) {
      // 点击边缘/角落手柄 -> 缩放模式
      if (target.closest('[data-minimap-edge]')) {
        gestureModeRef.current = 'resize';
        return;
      }
      // 点击指示框主体 -> 平移模式
      if (target.closest('[data-minimap-indicator]')) {
        gestureModeRef.current = 'pan';
        return;
      }
    }

    // 点击背景 -> 立即平移到点击位置，然后切换到平移模式（支持后续拖拽）
    const canvasPoint = minimapToCanvas(localPoint, fitRef.current);
    const vp = gestureStartViewportRef.current;

    const newTx = hostSizeRef.current.width / 2 - canvasPoint.x * vp.scale;
    const newTy = hostSizeRef.current.height / 2 - canvasPoint.y * vp.scale;
    const newViewport: DrawingViewport = { ...vp, tx: newTx, ty: newTy };
    onViewportChangeRef.current(newViewport);

    // 更新起始状态，使后续拖拽从新位置继续
    gestureStartViewportRef.current = newViewport;
    gestureStartIndicatorRef.current = computeIndicatorBox(
      newViewport,
      hostSizeRef.current,
      fitRef.current
    );
    gestureModeRef.current = 'pan';
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return;

    const mode = gestureModeRef.current;
    if (!mode) return;

    const container = containerRef.current;
    if (!container) return;

    const startViewport = gestureStartViewportRef.current;
    const startIndicator = gestureStartIndicatorRef.current;
    const startPoint = gestureStartPointRef.current;
    if (!startViewport || !startIndicator || !startPoint) return;

    const localPoint = clientToMinimapLocal(event.clientX, event.clientY, container);

    if (mode === 'pan') {
      // 平移模式：拖动指示框 -> 移动主视图
      // minimap 位移 -> 屏幕位移转换：screen_delta = minimap_delta * (viewport.scale / fit.scale)
      const dx = localPoint.x - startPoint.x;
      const dy = localPoint.y - startPoint.y;
      const fitScale = fitRef.current.scale;
      const screenDx = (dx * startViewport.scale) / fitScale;
      const screenDy = (dy * startViewport.scale) / fitScale;

      // 指示框向右移动 = 视图向左移动（tx 减小）
      onViewportChangeRef.current({
        ...startViewport,
        tx: startViewport.tx - screenDx,
        ty: startViewport.ty - screenDy,
      });
      return;
    }

    if (mode === 'resize') {
      // 缩放模式：拖动边缘/角落 -> 缩放主视图
      // 以指示框中心为锚点，根据手指到中心的距离比计算缩放。
      // 指示框变大 = zoom out（scale 减小），指示框变小 = zoom in（scale 增大）。
      const centerX = startIndicator.x + startIndicator.width / 2;
      const centerY = startIndicator.y + startIndicator.height / 2;

      const startDist = Math.hypot(startPoint.x - centerX, startPoint.y - centerY);
      const currentDist = Math.hypot(localPoint.x - centerX, localPoint.y - centerY);

      if (startDist < 1) return;

      const ratio = currentDist / startDist;
      const newScale = clampScale(startViewport.scale / ratio);

      // 保持指示框中心对应的画布坐标不变
      const centerCanvas = minimapToCanvas({ x: centerX, y: centerY }, fitRef.current);

      const newTx = hostSizeRef.current.width / 2 - centerCanvas.x * newScale;
      const newTy = hostSizeRef.current.height / 2 - centerCanvas.y * newScale;

      onViewportChangeRef.current({
        scale: newScale,
        tx: newTx,
        ty: newTy,
      });
      return;
    }
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return;

    const container = containerRef.current;
    if (container) {
      try {
        container.releasePointerCapture(event.pointerId);
      } catch {
        // 指针可能已被自动释放
      }
    }

    activePointerIdRef.current = -1;
    gestureModeRef.current = null;
    gestureStartViewportRef.current = null;
    gestureStartIndicatorRef.current = null;
    gestureStartPointRef.current = null;
  }, []);

  // ---- 渲染 ----

  // SVG 内容变换：将画布坐标映射到 minimap 坐标
  const contentTransform = `translate(${fit.offsetX} ${fit.offsetY}) scale(${fit.scale})`;

  // 计算笔画在 minimap 中的渲染宽度
  // 由于 SVG <g transform="scale(fit.scale)"> 会缩放 strokeWidth，
  // 需要除以 fit.scale 来补偿，使最终在 minimap 中的线宽为原始值。
  // 同时确保最小 1px（minimap 空间）以保证可见性。
  const getMinimapStrokeWidth = (stroke: DrawingStroke): number => {
    const baseWidth = stroke.strokeWidth ?? 2;
    return Math.max(baseWidth, 1) / fit.scale;
  };

  return (
    <div
      ref={containerRef}
      data-testid={testID}
      onPointerDownCapture={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        width,
        height,
        position: 'relative',
        // 所有交互元素必须限制在 minimap 内，避免透明溢出区域拦截主画布输入。
        overflow: 'hidden',
        border: '1px solid rgba(0, 0, 0, 0.15)',
        borderRadius: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        touchAction: 'none',
        ...style,
      }}
    >
      {/* 缩略图：渲染所有笔画的 SVG 预览（不接收指针事件） */}
      <svg
        width={width}
        height={height}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <title>Minimap stroke preview</title>
        <g transform={contentTransform}>
          {renderableStrokes.map((stroke) => (
            <StrokeRenderer
              key={stroke.id}
              stroke={stroke}
              fallbackColor={stroke.strokeColor ?? '#333333'}
              fallbackWidth={getMinimapStrokeWidth(stroke)}
              fallbackClosedWidth={getMinimapStrokeWidth(stroke)}
              pressureMultiplier={1}
            />
          ))}
        </g>
      </svg>

      {/* 视口指示框：表示主画布当前可见区域 */}
      <div
        data-minimap-indicator
        style={{
          position: 'absolute',
          left: visibleIndicatorBox.x,
          top: visibleIndicatorBox.y,
          width: visibleIndicatorBox.width,
          height: visibleIndicatorBox.height,
          border: '2px solid rgba(59, 130, 246, 0.8)',
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          cursor: 'move',
          boxSizing: 'border-box',
        }}
      >
        {/* 边缘拖拽手柄 - 4 条边（用于缩放） */}
        <div
          data-minimap-edge="top"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            cursor: 'ns-resize',
          }}
        />
        <div
          data-minimap-edge="bottom"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 8,
            cursor: 'ns-resize',
          }}
        />
        <div
          data-minimap-edge="left"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'ew-resize',
          }}
        />
        <div
          data-minimap-edge="right"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'ew-resize',
          }}
        />
        {/* 角落手柄 - 4 个角（用于缩放） */}
        <div
          data-minimap-edge="corner-tl"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 10,
            height: 10,
            cursor: 'nwse-resize',
          }}
        />
        <div
          data-minimap-edge="corner-tr"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 10,
            height: 10,
            cursor: 'nesw-resize',
          }}
        />
        <div
          data-minimap-edge="corner-bl"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: 10,
            height: 10,
            cursor: 'nesw-resize',
          }}
        />
        <div
          data-minimap-edge="corner-br"
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 10,
            height: 10,
            cursor: 'nwse-resize',
          }}
        />
      </div>
    </div>
  );
}
