import { assertNever } from './assertNever';
import {
  DRAWING_STROKE_SCHEMA_VERSION,
  type DrawingPointV2,
  type DrawingStrokeToolV2,
  type DrawingStrokeV2,
  type DrawingValueV2,
} from './strokes';

type StrokeLike = {
  readonly id?: unknown;
  readonly tool?: unknown;
  readonly points?: unknown;
  readonly strokeColor?: unknown;
  readonly strokeWidth?: unknown;
};

type ValueLike = {
  readonly strokes?: readonly unknown[];
};

type NormalizedDrawingValue<T extends object> = Omit<T, 'schemaVersion' | 'strokes'> & DrawingValueV2;

const persistedStrokeTools: readonly DrawingStrokeToolV2[] = [
  'pen',
  'line',
  'rect',
  'ellipse',
  'polygon',
  'bezier',
];

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPersistedStrokeTool(tool: unknown): tool is DrawingStrokeToolV2 {
  return typeof tool === 'string' && persistedStrokeTools.includes(tool as DrawingStrokeToolV2);
}

function clonePoint(point: unknown): DrawingPointV2 | null {
  if (!isObject(point)) {
    return null;
  }

  const { x, y, pressure } = point;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    return null;
  }

  if (typeof pressure === 'number' && Number.isFinite(pressure)) {
    return { x, y, pressure };
  }

  return { x, y };
}

function clonePoints(points: unknown): DrawingPointV2[] {
  if (!Array.isArray(points)) {
    return [];
  }

  return points.flatMap((point) => {
    const clonedPoint = clonePoint(point);
    return clonedPoint ? [clonedPoint] : [];
  });
}

function buildStroke(stroke: StrokeLike, tool: DrawingStrokeToolV2): DrawingStrokeV2 | null {
  if (typeof stroke.id !== 'string') {
    return null;
  }

  const base = {
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    id: stroke.id,
    points: clonePoints(stroke.points),
    ...(typeof stroke.strokeColor === 'string' ? { strokeColor: stroke.strokeColor } : {}),
    ...(typeof stroke.strokeWidth === 'number' && Number.isFinite(stroke.strokeWidth)
      ? { strokeWidth: stroke.strokeWidth }
      : {}),
  };

  switch (tool) {
    case 'pen':
      return { ...base, tool };
    case 'line':
      return { ...base, tool };
    case 'rect':
      return { ...base, tool };
    case 'ellipse':
      return { ...base, tool };
    case 'polygon':
      return { ...base, tool };
    case 'bezier':
      return { ...base, tool };
    default:
      return assertNever(tool);
  }
}

export function migrateStroke(stroke: unknown): DrawingStrokeV2 | null {
  if (!isObject(stroke)) {
    return null;
  }

  const strokeLike = stroke as StrokeLike;
  if (!isPersistedStrokeTool(strokeLike.tool)) {
    return null;
  }

  return buildStroke(strokeLike, strokeLike.tool);
}

export function normalizeDrawingValue(value: null | undefined): DrawingValueV2;
export function normalizeDrawingValue<T extends ValueLike & object>(value: T): NormalizedDrawingValue<T>;
export function normalizeDrawingValue(value: ValueLike | null | undefined): DrawingValueV2 {
  const source = isObject(value) ? value : {};
  const sourceStrokes = Array.isArray(source.strokes) ? source.strokes : [];

  return {
    ...source,
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    strokes: sourceStrokes.flatMap((stroke) => {
      const migratedStroke = migrateStroke(stroke);
      return migratedStroke ? [migratedStroke] : [];
    }),
  };
}
