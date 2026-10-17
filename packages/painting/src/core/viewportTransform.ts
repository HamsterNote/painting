import { MAX_VIEWPORT_SCALE, MIN_VIEWPORT_SCALE, type DrawingViewport } from '../viewport';
import type { Point } from '../model/document';

/** 用户可进一步收紧、但绝不能放宽全局 [0.25, 8] 缩放边界的限制。 */
export type ViewportScaleLimits = Readonly<{
  min?: number;
  max?: number;
}>;

/**
 * 一个完整的屏幕空间视口变换意图。
 *
 * `startFocal` 对应手势开始时的屏幕焦点，`currentFocal` 对应当前焦点；比例为 1 时即为
 * 平移。应用时会保持 startFocal 下的世界点位于 currentFocal，因而 pinch 焦点不会漂移。
 */
export type ViewportTransformIntent = Readonly<{
  startFocal: Point;
  currentFocal: Point;
  scaleRatio: number;
}>;

export type ResolvedViewportScaleLimits = Readonly<{
  min: number;
  max: number;
}>;

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isFiniteViewport(viewport: DrawingViewport): boolean {
  return (
    Number.isFinite(viewport.scale) &&
    Number.isFinite(viewport.tx) &&
    Number.isFinite(viewport.ty) &&
    viewport.scale > 0
  );
}

function freezePoint(point: Point): Point {
  return Object.freeze({ x: point.x, y: point.y });
}

function sameViewport(left: DrawingViewport, right: DrawingViewport): boolean {
  return left.scale === right.scale && left.tx === right.tx && left.ty === right.ty;
}

/**
 * 求全局边界与可选用户边界的交集。非有限值、倒置区间或空交集返回 null；调用者不应猜测
 * 回退值，避免无效外部配置静默改变视口。
 */
export function resolveViewportScaleLimits(
  limits: ViewportScaleLimits = {}
): ResolvedViewportScaleLimits | null {
  const userMin = limits.min ?? MIN_VIEWPORT_SCALE;
  const userMax = limits.max ?? MAX_VIEWPORT_SCALE;
  if (!Number.isFinite(userMin) || !Number.isFinite(userMax) || userMin > userMax) {
    return null;
  }
  const min = Math.max(MIN_VIEWPORT_SCALE, userMin);
  const max = Math.min(MAX_VIEWPORT_SCALE, userMax);
  return min <= max ? Object.freeze({ min, max }) : null;
}

/** 严格检查并夹紧已有 viewport；无变化时返回原对象，非法输入返回 null。 */
export function normalizeViewportTransform(
  viewport: DrawingViewport,
  limits?: ViewportScaleLimits
): DrawingViewport | null {
  const resolved = resolveViewportScaleLimits(limits);
  if (!resolved || !isFiniteViewport(viewport)) {
    return null;
  }
  const normalized = {
    scale: Math.max(resolved.min, Math.min(resolved.max, viewport.scale)),
    tx: viewport.tx,
    ty: viewport.ty,
  };
  return sameViewport(viewport, normalized) ? viewport : Object.freeze(normalized);
}

/** 创建不可变 transform intent；非有限点或非正比例返回 null。 */
export function createViewportTransformIntent(
  startFocal: Point,
  currentFocal: Point,
  scaleRatio = 1
): ViewportTransformIntent | null {
  if (
    !isFinitePoint(startFocal) ||
    !isFinitePoint(currentFocal) ||
    !Number.isFinite(scaleRatio) ||
    scaleRatio <= 0
  ) {
    return null;
  }
  return Object.freeze({
    startFocal: freezePoint(startFocal),
    currentFocal: freezePoint(currentFocal),
    scaleRatio,
  });
}

/**
 * 将完整手势 intent 应用于 `DrawingViewport`。结果 scale 会先与全局/用户限制求交再夹紧；
 * 实际夹紧后的比例用于重新计算 tx/ty，保证焦点所指向的世界点仍落在 currentFocal。
 */
export function applyViewportTransformIntent(
  viewport: DrawingViewport,
  intent: ViewportTransformIntent,
  limits?: ViewportScaleLimits
): DrawingViewport | null {
  const normalized = normalizeViewportTransform(viewport, limits);
  const resolved = resolveViewportScaleLimits(limits);
  if (
    !normalized ||
    !resolved ||
    !isFinitePoint(intent.startFocal) ||
    !isFinitePoint(intent.currentFocal) ||
    !Number.isFinite(intent.scaleRatio) ||
    intent.scaleRatio <= 0
  ) {
    return null;
  }
  const scale = Math.max(
    resolved.min,
    Math.min(resolved.max, normalized.scale * intent.scaleRatio)
  );
  const ratio = scale / normalized.scale;
  const next = {
    scale,
    tx: intent.currentFocal.x - (intent.startFocal.x - normalized.tx) * ratio,
    ty: intent.currentFocal.y - (intent.startFocal.y - normalized.ty) * ratio,
  };
  if (!isFiniteViewport(next)) {
    return null;
  }
  return sameViewport(normalized, next) ? normalized : Object.freeze(next);
}

/** 在屏幕空间平移 viewport；零增量返回已验证的原对象。 */
export function panViewport(
  viewport: DrawingViewport,
  delta: Point,
  limits?: ViewportScaleLimits
): DrawingViewport | null {
  if (!isFinitePoint(delta)) {
    return null;
  }
  const normalized = normalizeViewportTransform(viewport, limits);
  if (!normalized) {
    return null;
  }
  const next = {
    scale: normalized.scale,
    tx: normalized.tx + delta.x,
    ty: normalized.ty + delta.y,
  };
  return sameViewport(normalized, next) ? normalized : Object.freeze(next);
}

/** 在固定屏幕焦点处缩放；焦点位置在变换前后保持不变。 */
export function zoomViewportAt(
  viewport: DrawingViewport,
  focal: Point,
  scaleRatio: number,
  limits?: ViewportScaleLimits
): DrawingViewport | null {
  const intent = createViewportTransformIntent(focal, focal, scaleRatio);
  return intent ? applyViewportTransformIntent(viewport, intent, limits) : null;
}
