export type ViewportPoint = {
  x: number;
  y: number;
};

/**
 * Persisted stroke points are canvas-local. This transform only affects display and input coordinate conversion.
 */
export type DrawingViewport = {
  scale: number;
  tx: number;
  ty: number;
};

export const MIN_VIEWPORT_SCALE = 0.25;
export const MAX_VIEWPORT_SCALE = 8;

export const DEFAULT_DRAWING_VIEWPORT: DrawingViewport = {
  scale: 1,
  tx: 0,
  ty: 0,
};

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeViewport(viewport: DrawingViewport): DrawingViewport {
  return {
    scale: clampScale(viewport.scale),
    tx: safeNumber(viewport.tx, DEFAULT_DRAWING_VIEWPORT.tx),
    ty: safeNumber(viewport.ty, DEFAULT_DRAWING_VIEWPORT.ty),
  };
}

export function clampScale(scale: number): number {
  if (Number.isNaN(scale)) {
    return DEFAULT_DRAWING_VIEWPORT.scale;
  }

  return Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, scale));
}

export function resetViewport(): DrawingViewport {
  return { ...DEFAULT_DRAWING_VIEWPORT };
}

export function canvasToScreen(
  point: ViewportPoint,
  viewport: DrawingViewport,
): ViewportPoint {
  const normalized = normalizeViewport(viewport);
  const x = safeNumber(point.x, 0);
  const y = safeNumber(point.y, 0);

  return {
    x: x * normalized.scale + normalized.tx,
    y: y * normalized.scale + normalized.ty,
  };
}

export function screenToCanvas(
  point: ViewportPoint,
  viewport: DrawingViewport,
): ViewportPoint {
  const normalized = normalizeViewport(viewport);
  const x = safeNumber(point.x, 0);
  const y = safeNumber(point.y, 0);

  return {
    x: (x - normalized.tx) / normalized.scale,
    y: (y - normalized.ty) / normalized.scale,
  };
}

export function zoomViewportAroundScreenPoint(
  viewport: DrawingViewport,
  screenMidpoint: ViewportPoint,
  requestedScale: number,
): DrawingViewport {
  const normalized = normalizeViewport(viewport);
  const nextScale = clampScale(requestedScale);
  const midpoint = {
    x: safeNumber(screenMidpoint.x, 0),
    y: safeNumber(screenMidpoint.y, 0),
  };
  const canvasMidpoint = screenToCanvas(midpoint, normalized);

  return {
    scale: nextScale,
    tx: midpoint.x - canvasMidpoint.x * nextScale,
    ty: midpoint.y - canvasMidpoint.y * nextScale,
  };
}
