/**
 * Ruler 模块 — 尺子叠加层的纯几何与刻度逻辑。
 *
 * 不依赖 React / DOM，可在任意 JS 环境运行。
 */

// 几何类型与函数
export type { RulerPoint, RulerTransform } from './geometry';
export {
  toLocalPoint,
  toCanvasPoint,
  isInsideRuler,
  projectOntoRuler,
  degToRad,
  radToDeg,
  normalizeAngle,
} from './geometry';

// 刻度类型与函数
export type { RulerTick, RulerTickOptions, TickKind } from './ticks';
export { generateTicks, DEFAULT_TICK_OPTIONS } from './ticks';
