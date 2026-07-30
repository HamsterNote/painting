/**
 * Ruler 几何模块 — 纯数学，不依赖 React / DOM。
 *
 * 约定：
 * - 输入点与尺子必须位于同一坐标系；当前尺子使用宿主局部 CSS 像素
 * - 尺子按无限长条处理；`length` 只控制屏幕上用于覆盖视口的渲染长度
 */

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 二维点，兼容 DrawingPoint 但不含 pressure */
export interface RulerPoint {
  readonly x: number;
  readonly y: number;
}

export interface RulerRect {
  /** ruler 中心位置；单位与命中点一致 */
  readonly center: RulerPoint;
  readonly length: number;
  /** ruler 高度（沿 y 轴方向，旋转前） */
  readonly height: number;
  /** 顺时针旋转弧度；省略时保持向后兼容并按 0 处理 */
  readonly rotationRad?: number;
}

export type RulerState = {
  readonly center: RulerPoint;
  readonly rotationRad: number;
};

export type InfiniteRulerLayout = {
  readonly visualCenter: RulerPoint;
  readonly renderLength: number;
  readonly tickOriginX: number;
};

export type InfiniteRulerLayoutOptions = {
  readonly logicalCenter: RulerPoint;
  readonly rotationRad: number;
  readonly height: number;
  readonly viewport: { readonly width: number; readonly height: number };
};

const RULER_ROTATION_SNAP_RAD = Math.PI / 4;

export function snapRulerRotation(rotationRad: number): number {
  return Math.round(rotationRad / RULER_ROTATION_SNAP_RAD) * RULER_ROTATION_SNAP_RAD;
}

/**
 * 判断同坐标系中的点是否在 ruler 矩形区域内。
 */
export function isInsideRuler(point: RulerPoint, ruler: RulerRect): boolean {
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const localY = -dx * sine + dy * cosine;

  return Math.abs(localY) <= ruler.height / 2;
}

export function getInfiniteRulerLayout(options: InfiniteRulerLayoutOptions): InfiniteRulerLayout {
  const viewportCenter = {
    x: options.viewport.width / 2,
    y: options.viewport.height / 2,
  };
  const axis = {
    x: Math.cos(options.rotationRad),
    y: Math.sin(options.rotationRad),
  };
  const centerToViewport = {
    x: viewportCenter.x - options.logicalCenter.x,
    y: viewportCenter.y - options.logicalCenter.y,
  };
  const projection = centerToViewport.x * axis.x + centerToViewport.y * axis.y;
  const visualCenter = {
    x: options.logicalCenter.x + projection * axis.x,
    y: options.logicalCenter.y + projection * axis.y,
  };
  const diagonal = Math.hypot(options.viewport.width, options.viewport.height);

  return {
    visualCenter,
    renderLength: Math.max(diagonal * 2 + options.height * 2, options.height),
    tickOriginX: -projection,
  };
}

export function rotateRulerAround(
  ruler: RulerState,
  pivot: RulerPoint,
  deltaRad: number
): RulerState {
  const cosine = Math.cos(deltaRad);
  const sine = Math.sin(deltaRad);
  const offsetX = ruler.center.x - pivot.x;
  const offsetY = ruler.center.y - pivot.y;

  return {
    center: {
      x: pivot.x + offsetX * cosine - offsetY * sine,
      y: pivot.y + offsetX * sine + offsetY * cosine,
    },
    rotationRad: ruler.rotationRad + deltaRad,
  };
}
