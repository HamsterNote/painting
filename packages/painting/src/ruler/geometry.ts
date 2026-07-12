/**
 * Ruler 几何模块 — 纯数学，不依赖 React / DOM。
 *
 * 约定：
 * - 画布坐标系：x 向右，y 向下（与 Canvas 2D 一致）
 * - 旋转角度统一使用弧度（rotationRad），逆时针为正
 * - 本地坐标系：原点在 ruler 中心，x 沿 ruler 长轴，y 沿 ruler 短轴
 */

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 二维点，兼容 DrawingPoint 但不含 pressure */
export interface RulerPoint {
  readonly x: number;
  readonly y: number;
}

/** Ruler 变换参数：定义 ruler 在画布中的位置、朝向和尺寸 */
export interface RulerTransform {
  /** ruler 中心在画布坐标系中的位置 */
  readonly center: RulerPoint;
  /** ruler 旋转角度（弧度），逆时针为正 */
  readonly rotationRad: number;
  /** ruler 长度（沿 x 轴方向，旋转前） */
  readonly length: number;
  /** ruler 高度（沿 y 轴方向，旋转前） */
  readonly height: number;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

/** 将角度归一化到 [-π, π] 范围 */
function normalizeAngle(rad: number): number {
  // 利用 atan2(round(sin), round(cos)) 避免浮点漂移
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  return Math.atan2(s, c);
}

// ─── 坐标转换 ─────────────────────────────────────────────────────────────────

/**
 * 将画布坐标点转换为 ruler 本地坐标。
 * 本地坐标原点 = ruler 中心，x 沿 ruler 长轴正方向。
 *
 * 步骤：translate（减去 center） → rotate（绕原点旋转 -rotationRad）
 */
export function toLocalPoint(canvasPoint: RulerPoint, ruler: RulerTransform): RulerPoint {
  const dx = canvasPoint.x - ruler.center.x;
  const dy = canvasPoint.y - ruler.center.y;
  const cos = Math.cos(-ruler.rotationRad);
  const sin = Math.sin(-ruler.rotationRad);

  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

/**
 * 将 ruler 本地坐标转换回画布坐标。
 *
 * 步骤：rotate（绕原点旋转 +rotationRad） → translate（加上 center）
 */
export function toCanvasPoint(localPoint: RulerPoint, ruler: RulerTransform): RulerPoint {
  const cos = Math.cos(ruler.rotationRad);
  const sin = Math.sin(ruler.rotationRad);

  const x = localPoint.x * cos - localPoint.y * sin;
  const y = localPoint.x * sin + localPoint.y * cos;

  return {
    x: x + ruler.center.x,
    y: y + ruler.center.y,
  };
}

// ─── 判断与投影 ──────────────────────────────────────────────────────────────

/**
 * 判断画布坐标点是否在 ruler 矩形区域内。
 * 使用本地坐标判断：|localX| <= length/2 且 |localY| <= height/2。
 */
export function isInsideRuler(canvasPoint: RulerPoint, ruler: RulerTransform): boolean {
  const local = toLocalPoint(canvasPoint, ruler);
  const halfLen = ruler.length / 2;
  const halfH = ruler.height / 2;

  return Math.abs(local.x) <= halfLen && Math.abs(local.y) <= halfH;
}

function projectInsideRuler(
  canvasPoint: RulerPoint,
  ruler: RulerTransform,
  localY: number
): RulerPoint | null {
  if (!isInsideRuler(canvasPoint, ruler)) {
    return null;
  }

  const local = toLocalPoint(canvasPoint, ruler);
  const halfLen = ruler.length / 2;

  const projectedLocal: RulerPoint = {
    x: Math.max(-halfLen, Math.min(halfLen, local.x)),
    y: localY,
  };

  return toCanvasPoint(projectedLocal, ruler);
}

export function projectOntoRuler(canvasPoint: RulerPoint, ruler: RulerTransform): RulerPoint | null {
  return projectInsideRuler(canvasPoint, ruler, 0);
}

export function projectOntoRulerTickEdge(
  canvasPoint: RulerPoint,
  ruler: RulerTransform
): RulerPoint | null {
  return projectInsideRuler(canvasPoint, ruler, -ruler.height / 2);
}

// ─── 角度工具（对外暴露） ─────────────────────────────────────────────────────

/** 度转弧度 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 弧度转度 */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** 归一化角度到 [-π, π] */
export { normalizeAngle };
