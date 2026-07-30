/**
 * Ruler 模块 — 首期尺子矩形的纯几何逻辑。
 *
 * 不依赖 React / DOM，可在任意 JS 环境运行。
 */

// 几何类型与函数
export type { RulerPoint, RulerRect } from './geometry';
export { isInsideRuler } from './geometry';
export type { GenerateRulerTicksOptions, RulerTick, RulerTickKind } from './ticks';
export { DEFAULT_RULER_PIXELS_PER_INCH, generateRulerTicks, millimetersToPixels } from './ticks';
