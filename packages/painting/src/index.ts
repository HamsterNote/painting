export type {
	DrawingEraserCommitMode,
	DrawingEraserTrajectoryOptions,
	DrawingGesture,
	DrawingInputMethod,
	DrawingPoint,
	DrawingSelectionChange,
	DrawingStroke,
	DrawingSurfaceHandle,
	DrawingSurfaceProps,
	DrawingTool,
	DrawingValue,
} from "./components/DrawingSurface";
export { DrawingSurface } from "./components/DrawingSurface";
export type { UseCanvasOptions, UseCanvasReturn } from "./hooks/useCanvas";
export { useCanvas } from "./hooks/useCanvas";
export { assertNever } from "./model/assertNever";
export { migrateStroke, normalizeDrawingValue } from "./model/strokeMigration";
export type {
  BezierStrokeV2,
  DrawingPointV2,
  DrawingStrokeToolV2,
  DrawingStrokeV2,
  DrawingToolModeV2,
  DrawingValueV2,
  EllipseStrokeV2,
  LineStrokeV2,
  PenStrokeV2,
  PolygonStrokeV2,
  RectStrokeV2,
} from "./model/strokes";
export { DRAWING_STROKE_SCHEMA_VERSION } from "./model/strokes";
export { StrokeRenderer } from "./render/StrokeRenderer";
export type { RenderableStroke, StrokeRendererProps } from "./render/StrokeRenderer";
export { resolveStrokeStyle } from "./render/resolveStrokeStyle";
export type {
  ResolvedStrokeStyle,
  ResolveStrokeStyleOptions,
  StrokeStyleFields,
} from "./render/resolveStrokeStyle";
export type { DrawingStrokeSmoothingOptions } from "./stroke-helpers";
export {
	addStroke,
	clearStrokes,
	pick,
	removeStroke,
	removeStrokes,
	selectStrokesIntersectingLasso,
	updateStroke,
	updateStrokes,
} from "./utils";
export type { LassoSelectionOptions } from "./utils";
export type { DrawingViewport, ViewportPoint } from "./viewport";
export {
  DEFAULT_DRAWING_VIEWPORT,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  canvasToScreen,
  clampScale,
  resetViewport,
  screenToCanvas,
  zoomViewportAroundScreenPoint,
} from "./viewport";
