// Internal contracts for retained geometry tests; never exported as a document/renderer fallback.
export type DrawingTool =
  'pen' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'bezier' | 'text' | 'eraser' | 'lasso';
export type DrawingPoint = { x: number; y: number; pressure?: number };
export type DrawingStroke = {
  id: string;
  tool: DrawingTool | 'image';
  points: DrawingPoint[];
  strokeColor?: string;
  strokeWidth?: number;
  dashArray?: number[];
  dashOffset?: number;
  fillColor?: string;
  fillOpacity?: number;
  rotationRad?: number;
  text?: string;
  fontSize?: number;
  src?: string;
  resourceId?: string;
};
export type DrawingStrokeStyle = Pick<
  DrawingStroke,
  'strokeColor' | 'strokeWidth' | 'dashArray' | 'dashOffset' | 'fillColor' | 'fillOpacity'
>;
export type DrawingValue = { strokes: DrawingStroke[] };
