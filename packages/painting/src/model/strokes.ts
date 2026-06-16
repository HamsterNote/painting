export const DRAWING_STROKE_SCHEMA_VERSION = 2 as const;

export type DrawingPointV2 = {
  x: number;
  y: number;
  pressure?: number;
};

export type DrawingStrokeToolV2 = 'pen' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'bezier';
/** 所有可用的工具模式，包含不产生存储 stroke 的工具（eraser、lasso） */
export type DrawingToolModeV2 = DrawingStrokeToolV2 | 'eraser' | 'lasso';

type DrawingStrokeBaseV2<Tool extends DrawingStrokeToolV2> = {
  schemaVersion: typeof DRAWING_STROKE_SCHEMA_VERSION;
  id: string;
  tool: Tool;
  points: DrawingPointV2[];
  strokeColor?: string;
  strokeWidth?: number;
  dashArray?: number[];
  dashOffset?: number;
  fillColor?: string;
  fillOpacity?: number;
};

export type PenStrokeV2 = DrawingStrokeBaseV2<'pen'>;
export type LineStrokeV2 = DrawingStrokeBaseV2<'line'>;
export type RectStrokeV2 = DrawingStrokeBaseV2<'rect'>;
export type EllipseStrokeV2 = DrawingStrokeBaseV2<'ellipse'>;
export type PolygonStrokeV2 = DrawingStrokeBaseV2<'polygon'>;
export type BezierStrokeV2 = DrawingStrokeBaseV2<'bezier'>;

export type DrawingStrokeV2 =
  | PenStrokeV2
  | LineStrokeV2
  | RectStrokeV2
  | EllipseStrokeV2
  | PolygonStrokeV2
  | BezierStrokeV2;

export type DrawingValueV2 = {
  schemaVersion: typeof DRAWING_STROKE_SCHEMA_VERSION;
  strokes: DrawingStrokeV2[];
};
