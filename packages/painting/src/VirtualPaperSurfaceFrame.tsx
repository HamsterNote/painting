import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { DrawingSurfaceVirtualPaperOptions } from './virtualPaperOptions';
import {
  DEFAULT_DRAWING_VIEWPORT,
  normalizeViewport,
  type DrawingViewport,
} from './viewport';

/**
 * VirtualPaperSurfaceFrame —— 内部的纯展示（display-only）视口渲染框。
 *
 * 本组件承载内部 virtual-paper 的展示层：
 * 只负责按当前视口渲染两级 DOM 与单次精确 CSS transform，
 * 不创建任何 wheel/pointer/gesture 监听器、不持有状态、不触发回调。
 *
 * 可观测 DOM 契约（与 external VirtualPaper 的 Transform 渲染模式保持一致，
 * 现有 DrawingSurface 测试与宿主代码依赖这些选择器，不得更改）：
 * - wrapper：`data-testid="virtual-paper-wrapper"`、class `virtual-paper-wrapper`，
 *   `position: relative; overflow: hidden; width/height: 100%`；
 * - container：`data-testid="virtual-paper-container"`、class `virtual-paper-container`，
 *   `position: absolute; transform-origin: 0 0; touch-action: none; user-select: none`，
 *   transform 恰好为 `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`。
 */
export type VirtualPaperSurfaceFrameProps = {
  readonly enabled: boolean;
  /**
   * @deprecated 纯展示 Frame 不消费交互配置；输入由 DrawingSurface 的 controller 管理。
   */
  readonly options?: DrawingSurfaceVirtualPaperOptions;
  /** 当前绘制视口；非有限值会安全回退，绝不生成无效 CSS。 */
  readonly viewport: DrawingViewport;
  /**
   * @deprecated 纯展示 Frame 不监听手势，永远不会调用该回调。
   */
  readonly onViewportChange?: (viewport: DrawingViewport) => void;
  /** 附加到 container 的样式（尺寸/溢出等）；不允许覆盖 transform 与 transform-origin。 */
  readonly containerStyle?: CSSProperties;
  readonly children: ReactNode;
};

export function VirtualPaperSurfaceFrame({
  enabled,
  viewport,
  containerStyle,
  children,
}: VirtualPaperSurfaceFrameProps): ReactElement {
  // 未启用虚拟纸模式时保持原有直传行为：不包裹任何视口容器，
  // 视觉结构与非虚拟纸模式完全一致。
  if (!enabled) {
    return <>{children}</>;
  }

  // 非有限值安全回退（含 NaN、±Infinity，以及运行时 JS 调用方可能传入的
  // undefined / null / 字符串等）：先逐字段守卫为有限数，再交给
  // normalizeViewport 收敛缩放到 [MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE]。
  // 因此下面拼出的 transform 字符串一定是合法 CSS，
   // 并收敛缩放到内部绘制支持的范围。
  const guardedViewport: DrawingViewport = {
    scale: Number.isFinite(viewport.scale) ? viewport.scale : DEFAULT_DRAWING_VIEWPORT.scale,
    tx: Number.isFinite(viewport.tx) ? viewport.tx : DEFAULT_DRAWING_VIEWPORT.tx,
    ty: Number.isFinite(viewport.ty) ? viewport.ty : DEFAULT_DRAWING_VIEWPORT.ty,
  };
  const { scale, tx, ty } = normalizeViewport(guardedViewport);
  const transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;

  return (
    <div
      data-testid="virtual-paper-wrapper"
      className="virtual-paper-wrapper"
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
      }}
    >
      <div
        data-testid="virtual-paper-container"
        className="virtual-paper-container"
        style={{
          position: 'absolute',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          ...containerStyle,
          // transform 与 transform-origin 固定在展开之后，
          // 保证 containerStyle 无法破坏单次精确 transform 契约。
          transform,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
}
