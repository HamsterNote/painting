/**
 * Ruler 模块 — 尺子矩形的纯几何逻辑与刻度生成。
 *
 * 不依赖 React / DOM / Skia，可在任意 JS 环境运行；对外经
 * `@hamster-note/painting/ruler` 公开子路径暴露，供跨端（含正式 Web 候选编辑器）
 * 使用，无需也不得私有相对导入内部模块，也不经过包根 barrel。
 *
 * 边界：这里只重新导出 `geometry.ts`（零 import 的纯数学）与 `ticks.ts` 的纯刻度
 * 计算，不引入 DOM / legacy / Skia。正式原生运行仍只是 compat-static，
 * 本入口不能作为 native 运行验证的依据。
 */

// ─── 纯几何类型 ──────────────────────────────────────────────────────────────
export type {
  InfiniteRulerLayout,
  InfiniteRulerLayoutOptions,
  RulerEdgeConstraint,
  RulerEdgeConstraintResult,
  RulerPoint,
  RulerRect,
  RulerState,
} from './geometry';

// ─── 纯几何函数 ──────────────────────────────────────────────────────────────
export {
  constrainPointToRulerEdge,
  createRulerEdgeConstraint,
  getInfiniteRulerLayout,
  isInsideRuler,
  projectPointToRulerCenterline,
  projectPointToRulerEdge,
  rotateRulerAround,
  snapRulerRotation,
} from './geometry';

// ─── 纯刻度类型与函数 ────────────────────────────────────────────────────────
export type { GenerateRulerTicksOptions, RulerTick, RulerTickKind } from './ticks';
export {
  DEFAULT_RULER_PIXELS_PER_INCH,
  generateRulerTicks,
  millimetersToPixels,
} from './ticks';