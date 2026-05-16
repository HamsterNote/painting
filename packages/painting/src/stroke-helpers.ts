import type { DrawingPoint, DrawingStroke, DrawingTool, DrawingValue } from './components/DrawingSurface';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createStroke(tool: DrawingTool, strokeColor?: string, strokeWidth?: number): DrawingStroke {
  return {
    id: generateId(),
    tool,
    points: [],
    strokeColor,
    strokeWidth,
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

// Types for adaptive smoothing
export type DrawingStrokeSmoothingOptions = {
  enabled?: boolean;
  strength?: number;
  density?: number;
  velocityThreshold?: number;
  minSegmentLength?: number;
  maxSegmentLength?: number;
  maxInterpolatedPoints?: number;
};

export type TimedDrawingPoint = DrawingPoint & {
  timestamp?: number;
};

const DEFAULT_SMOOTHING_OPTIONS: Required<DrawingStrokeSmoothingOptions> = {
  enabled: true,
  strength: 0.5,
  density: 1,
  velocityThreshold: 0.5,
  minSegmentLength: 5,
  maxSegmentLength: 100,
  maxInterpolatedPoints: 10,
};

export function resolveStrokeSmoothingOptions(
  input?: boolean | DrawingStrokeSmoothingOptions
): Required<DrawingStrokeSmoothingOptions> {
  if (input === false) {
    return { ...DEFAULT_SMOOTHING_OPTIONS, enabled: false };
  }
  if (input === true || input === undefined) {
    return DEFAULT_SMOOTHING_OPTIONS;
  }
  return { ...DEFAULT_SMOOTHING_OPTIONS, ...input };
}

export function getPointVelocity(previous: TimedDrawingPoint, current: TimedDrawingPoint): number {
  if (!previous.timestamp || !current.timestamp) {
    return 0;
  }
  const dt = current.timestamp - previous.timestamp;
  if (dt <= 0) {
    return 0;
  }
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance / dt;
}

export function getAdaptiveInterpolationCount(
  previous: TimedDrawingPoint,
  current: TimedDrawingPoint,
  options?: DrawingStrokeSmoothingOptions
): number {
  const opts = resolveStrokeSmoothingOptions(options);
  if (!opts.enabled) return 0;

  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < opts.minSegmentLength) return 0;

  const velocity = getPointVelocity(previous, current);
  if (velocity < opts.velocityThreshold) return 0;

  const distanceFactor = Math.min(distance / opts.maxSegmentLength, 1);
  const velocityFactor = Math.min(velocity / (opts.velocityThreshold * 4), 1);
  const rawCount = Math.round((distanceFactor + velocityFactor) * opts.density * 3);

  return Math.min(rawCount, opts.maxInterpolatedPoints);
}

export function interpolateCatmullRomPoint(
  p0: DrawingPoint,
  p1: DrawingPoint,
  p2: DrawingPoint,
  p3: DrawingPoint,
  t: number,
  strength: number = 0.5
): DrawingPoint {
  const t2 = t * t;
  const t3 = t2 * t;

  const curveX = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );
  const curveY = 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );

  const linearX = p1.x + (p2.x - p1.x) * t;
  const linearY = p1.y + (p2.y - p1.y) * t;
  const x = linearX + (curveX - linearX) * strength;
  const y = linearY + (curveY - linearY) * strength;

  return { x, y };
}

export function createVelocityAdaptivePoints(
  rawPoints: TimedDrawingPoint[],
  options?: DrawingStrokeSmoothingOptions
): DrawingPoint[] {
  const opts = resolveStrokeSmoothingOptions(options);
  if (!opts.enabled || rawPoints.length < 2) {
    return rawPoints.map((p) => ({ ...p }));
  }

  const result: DrawingPoint[] = [];
  result.push({ ...rawPoints[0] });

  for (let i = 1; i < rawPoints.length; i++) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i];
    const count = getAdaptiveInterpolationCount(prev, curr, opts);

    if (count > 0) {
      const p0 = rawPoints[Math.max(0, i - 2)];
      const p1 = prev;
      const p2 = curr;
      const p3 = rawPoints[Math.min(rawPoints.length - 1, i + 1)];

      for (let j = 1; j <= count; j++) {
        const t = j / (count + 1);
        const interpolated = interpolateCatmullRomPoint(p0, p1, p2, p3, t, opts.strength);
        if (prev.pressure !== undefined || curr.pressure !== undefined) {
          const prevPressure = prev.pressure ?? 1;
          const currPressure = curr.pressure ?? 1;
          const pressure = prevPressure + (currPressure - prevPressure) * t;
          result.push({ ...interpolated, pressure });
        } else {
          result.push(interpolated);
        }
      }
    }

    result.push({ ...curr });
  }

  return result;
}

export function pointsToSvgPath(points: DrawingPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const cp1x = prev.x + (curr.x - prev.x) / 3;
    const cp1y = prev.y + (curr.y - prev.y) / 3;
    const cp2x = curr.x - (next.x - prev.x) / 6;
    const cp2y = curr.y - (next.y - prev.y) / 6;

    path += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${curr.x} ${curr.y}`;
  }

  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  const cp1x = secondLast.x + (last.x - secondLast.x) / 3;
  const cp1y = secondLast.y + (last.y - secondLast.y) / 3;
  path += ` C ${cp1x} ${cp1y} ${last.x} ${last.y} ${last.x} ${last.y}`;

  return path;
}
