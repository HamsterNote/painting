import type { DrawingPoint, DrawingStroke, DrawingTool, DrawingValue } from './components/DrawingSurface';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createStroke(tool: DrawingTool): DrawingStroke {
  return {
    id: generateId(),
    tool,
    points: [],
  };
}

export function appendPoint(stroke: DrawingStroke, point: DrawingPoint): DrawingStroke {
  const points = stroke.points;

  if (points.length > 0) {
    const lastPoint = points[points.length - 1];
    if (lastPoint.x === point.x && lastPoint.y === point.y) {
      return stroke;
    }
  }

  return {
    ...stroke,
    points: [...points, point],
  };
}

export function isValidStroke(stroke: DrawingStroke): boolean {
  const points = stroke.points;
  if (points.length < 2) {
    return false;
  }

  const first = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].x !== first.x || points[i].y !== first.y) {
      return true;
    }
  }

  return false;
}

export function pointsToPolyline(points: DrawingPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

export function createDrawingValue(strokes: DrawingStroke[]): DrawingValue {
  return { strokes };
}