export type ViewportPoint = {
  x: number;
  y: number;
};

/**
 * 持久化的笔迹点使用 absolute global world DIP（绝对全局世界 DIP）坐标，
 * 以 f64 存储，不绑定任何画布局部原点。视口变换仅用于显示与输入坐标换算。
 */
export type DrawingViewport = {
  scale: number;
  tx: number;
  ty: number;
};

/**
 * 2D 仿射变换，采用屏幕空间约定：
 *   screenX = a * x + c * y + tx
 *   screenY = b * x + d * y + ty
 * 普通视口（无旋转/斜切）满足 a = d = scale、b = c = 0。
 */
export type Affine2D = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}>;

/**
 * Skia Matrix3 的行主序布局（readonly 9 元组）：
 *   [a, c, tx, b, d, ty, 0, 0, 1]
 * 此模块不 import Skia，仅返回纯数值数组供调用方交给 Skia。
 */
export type SkiaMatrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type VirtualPaperLikeTransform = {
  x: number;
  y: number;
  scale: number;
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

/**
 * 将外部视口值收敛到 DrawingSurface 支持的有限平移与缩放范围。
 * 公开组件在消费调用方传入的 viewport 前应统一走此边界。
 */
export function normalizeViewport(viewport: DrawingViewport): DrawingViewport {
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

export function virtualPaperTransformToViewport(
  transform: VirtualPaperLikeTransform
): DrawingViewport {
  return normalizeViewport({
    scale: transform.scale,
    tx: transform.x,
    ty: transform.y,
  });
}

export function viewportToVirtualPaperTransform(
  viewport: DrawingViewport
): VirtualPaperLikeTransform {
  const normalized = normalizeViewport(viewport);

  return {
    x: normalized.tx,
    y: normalized.ty,
    scale: normalized.scale,
  };
}

/**
 * 由普通 `DrawingViewport`（仅缩放 + 平移）构建唯一的 world→screen 仿射。
 * 输入先经 `normalizeViewport` 收敛，确保输出各分量有限且 scale 落在
 * [MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE] 内。
 */
export function createViewportAffine(viewport: DrawingViewport): Affine2D {
  const normalized = normalizeViewport(viewport);

  return {
    a: normalized.scale,
    b: 0,
    c: 0,
    d: normalized.scale,
    tx: normalized.tx,
    ty: normalized.ty,
  };
}

/**
 * 用完整仿射变换映射一个点。坐标分量按 legacy 语义做有限性兜底（非有限视为 0），
 * 以保持与既有 helper 的边界行为一致。
 */
export function mapViewportAffinePoint(point: ViewportPoint, affine: Affine2D): ViewportPoint {
  const x = safeNumber(point.x, 0);
  const y = safeNumber(point.y, 0);

  return {
    x: affine.a * x + affine.c * y + affine.tx,
    y: affine.b * x + affine.d * y + affine.ty,
  };
}

function isFiniteAffine(affine: Affine2D): boolean {
  return (
    Number.isFinite(affine.a) &&
    Number.isFinite(affine.b) &&
    Number.isFinite(affine.c) &&
    Number.isFinite(affine.d) &&
    Number.isFinite(affine.tx) &&
    Number.isFinite(affine.ty)
  );
}

/**
 * 求仿射的逆。任意分量非有限、行列式为零或非有限时明确返回 null（不可逆），
 * 调用方不得猜测回退值。
 */
export function invertViewportAffine(affine: Affine2D): Affine2D | null {
  if (!isFiniteAffine(affine)) {
    return null;
  }

  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (determinant === 0 || !Number.isFinite(determinant)) {
    return null;
  }

  return {
    a: affine.d / determinant,
    b: -affine.b / determinant,
    c: -affine.c / determinant,
    d: affine.a / determinant,
    tx: (affine.c * affine.ty - affine.d * affine.tx) / determinant,
    ty: (affine.b * affine.tx - affine.a * affine.ty) / determinant,
  };
}

/**
 * 复合两个仿射：先应用 `inner`，再应用 `outer`，即返回 `outer ∘ inner`。
 * 结果满足 `map(compose(outer, inner), p) === map(outer, map(inner, p))`。
 */
export function composeViewportAffine(outer: Affine2D, inner: Affine2D): Affine2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

/** 将仿射转换为 Skia Matrix3 行主序布局 `[a, c, tx, b, d, ty, 0, 0, 1]`。 */
export function toSkiaMatrix3(affine: Affine2D): SkiaMatrix3 {
  return [affine.a, affine.c, affine.tx, affine.b, affine.d, affine.ty, 0, 0, 1];
}

/**
 * 世界（绝对全局 DIP）→ 屏幕。保留既有 API 与行为，内部委托 `createViewportAffine`
 * 与 `mapViewportAffinePoint`，不再手写公式。
 */
export function canvasToScreen(point: ViewportPoint, viewport: DrawingViewport): ViewportPoint {
  return mapViewportAffinePoint(point, createViewportAffine(viewport));
}

/**
 * 屏幕 → 世界（绝对全局 DIP）。保留既有 API 与行为，内部委托 `createViewportAffine`、
 * `invertViewportAffine` 与 `mapViewportAffinePoint`。viewport 经 normalize 后 scale 恒为正，
 * 因此逆必然存在；若仍不可逆则回退到恒等映射以保持返回有限值。
 */
export function screenToCanvas(point: ViewportPoint, viewport: DrawingViewport): ViewportPoint {
  const inverse = invertViewportAffine(createViewportAffine(viewport));
  const affine = inverse ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

  return mapViewportAffinePoint(point, affine);
}
