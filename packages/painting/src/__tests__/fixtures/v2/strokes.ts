import { DRAWING_STROKE_SCHEMA_VERSION } from '../../../model/strokes';

export const v2PenStroke = Object.freeze({
  schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
  id: 'v1-pen-1',
  tool: 'pen',
  points: Object.freeze([
    Object.freeze({ x: 10, y: 20, pressure: 0.5 }),
    Object.freeze({ x: 30, y: 40, pressure: 0.7 }),
  ]),
  strokeColor: '#111111',
  strokeWidth: 3,
});

export const v2LineStroke = Object.freeze({
  schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
  id: 'v1-line-1',
  tool: 'line',
  points: Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 100, y: 50 }),
  ]),
  strokeColor: '#222222',
  strokeWidth: 4,
});

export const v2RectStroke = Object.freeze({
  schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
  id: 'v1-rect-1',
  tool: 'rect',
  points: Object.freeze([
    Object.freeze({ x: 5, y: 6 }),
    Object.freeze({ x: 55, y: 66 }),
  ]),
  strokeColor: '#333333',
  strokeWidth: 5,
});

export const v2DrawingValue = Object.freeze({
  schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
  strokes: Object.freeze([v2PenStroke, v2LineStroke, v2RectStroke]),
  selectedId: 'v1-line-1',
});
