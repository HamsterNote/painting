/**
 * Ruler 几何模块 — 纯数学，不依赖 React / DOM。
 *
 * 约定：
 * - 画布坐标系：x 向右，y 向下（与 Canvas 2D 一致）
 * - 首期尺子保持水平，只需要轴对齐矩形命中
 */

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 二维点，兼容 DrawingPoint 但不含 pressure */
export interface RulerPoint {
  readonly x: number;
  readonly y: number;
}

export interface RulerRect {
  /** ruler 中心在画布坐标系中的位置 */
  readonly center: RulerPoint;
  readonly length: number;
  /** ruler 高度（沿 y 轴方向，旋转前） */
  readonly height: number;
}

/**
 * 判断画布坐标点是否在 ruler 矩形区域内。
 */
export function isInsideRuler(canvasPoint: RulerPoint, ruler: RulerRect): boolean {
  const dx = canvasPoint.x - ruler.center.x;
  const dy = canvasPoint.y - ruler.center.y;
  const halfLen = ruler.length / 2;
  const halfH = ruler.height / 2;

  return Math.abs(dx) <= halfLen && Math.abs(dy) <= halfH;
}
