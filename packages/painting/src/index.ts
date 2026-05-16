export type {
	DrawingPoint,
	DrawingStroke,
	DrawingSurfaceProps,
	DrawingTool,
	DrawingValue,
} from "./components/DrawingSurface";
export { DrawingSurface } from "./components/DrawingSurface";
export type { DrawingStrokeSmoothingOptions } from "./stroke-helpers";
export {
  addStroke,
  clearStrokes,
  pick,
  removeStroke,
  updateStroke,
} from "./utils";
