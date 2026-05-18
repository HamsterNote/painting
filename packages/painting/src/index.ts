export type {
	DrawingInputMethod,
	DrawingPoint,
	DrawingStroke,
	DrawingSurfaceProps,
	DrawingTool,
	DrawingValue,
} from "./components/DrawingSurface";
export { DrawingSurface } from "./components/DrawingSurface";
export type { UseCanvasOptions, UseCanvasReturn } from "./hooks/useCanvas";
export { useCanvas } from "./hooks/useCanvas";
export type { DrawingStrokeSmoothingOptions } from "./stroke-helpers";
export {
	addStroke,
	clearStrokes,
	pick,
	removeStroke,
	updateStroke,
} from "./utils";
