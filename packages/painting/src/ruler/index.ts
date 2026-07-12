/**
 * Ruler 模块 — 尺子叠加层的纯几何与刻度逻辑。
 *
 * 不依赖 React / DOM，可在任意 JS 环境运行。
 */

// 几何类型与函数
export type { RulerPoint, RulerTransform } from './geometry';
export {
  degToRad,
  isInsideRuler,
  normalizeAngle,
  projectOntoRuler,
  projectOntoRulerTickEdge,
  radToDeg,
  toCanvasPoint,
  toLocalPoint,
} from './geometry';

// 刻度类型与函数
export type { RulerTick, RulerTickOptions, TickKind } from './ticks';
export { DEFAULT_TICK_OPTIONS, generateTicks } from './ticks';
