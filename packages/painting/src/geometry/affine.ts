/**
 * 纯仿射几何 helper（Task 5.2 基础）
 *
 * 只依赖 `model/document.ts` 的 `AffineTransform` / `Point` / `Bounds` 类型契约：
 * - 屏幕空间约定：x' = a*x + c*y + tx，y' = b*x + d*y + ty。
 * - 每个函数运行时安全：非法 / 缺失 / 非有限输入一律返回 `null`，**不 throw**。
 * - 变换六分量必须有限且行列式有限非 0；正负镜像（det<0）允许；不引入任意 epsilon / clamp。
 * - 常量时间直接算术，无 DOM / PF / V2 / Skia import。
 */

import type { AffineTransform, Bounds, Point } from '../model/document';

/** 有限数值判据。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 校验变换：六分量有限且行列式有限非 0。 */
function isValidTransform(value: unknown): value is AffineTransform {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const transform = value as Record<string, unknown>;
  if (
    !isFiniteNumber(transform.a) ||
    !isFiniteNumber(transform.b) ||
    !isFiniteNumber(transform.c) ||
    !isFiniteNumber(transform.d) ||
    !isFiniteNumber(transform.tx) ||
    !isFiniteNumber(transform.ty)
  ) {
    return false;
  }
  const determinant = transform.a * transform.d - transform.b * transform.c;
  return Number.isFinite(determinant) && determinant !== 0;
}

/** 冻结新仿射对象（known fields，不改调用方）。 */
function freezeTransform(transform: AffineTransform): AffineTransform {
  return Object.freeze({
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
    tx: transform.tx,
    ty: transform.ty,
  });
}

/** 应用仿射到点；变换/点非法或结果非有限返回 `null`。 */
export function applyAffine(transform: AffineTransform, point: Point): Point | null {
  if (!isValidTransform(transform) || !point || typeof point !== 'object') {
    return null;
  }
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return null;
  }
  const x = transform.a * point.x + transform.c * point.y + transform.tx;
  const y = transform.b * point.x + transform.d * point.y + transform.ty;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return Object.freeze({ x, y });
}

/**
 * 复合仿射 `parent ∘ child`（先应用 child 再应用 parent）。
 * 任一变换非法、输出分量非有限、或输出行列式非有限非 0 时返回 `null`。
 */
export function composeAffine(
  parent: AffineTransform,
  child: AffineTransform
): AffineTransform | null {
  if (!isValidTransform(parent) || !isValidTransform(child)) {
    return null;
  }
  const a = parent.a * child.a + parent.c * child.b;
  const b = parent.b * child.a + parent.d * child.b;
  const c = parent.a * child.c + parent.c * child.d;
  const d = parent.b * child.c + parent.d * child.d;
  const tx = parent.a * child.tx + parent.c * child.ty + parent.tx;
  const ty = parent.b * child.tx + parent.d * child.ty + parent.ty;
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(ty)
  ) {
    return null;
  }
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    return null;
  }
  return freezeTransform({ a, b, c, d, tx, ty });
}

/**
 * 求逆仿射。变换非法、行列式为 0、逆分量非有限或逆行列式非有限非 0 时返回 `null`
 * （极小/极大数值导致的非有限结果也失败，不做 clamp）。
 */
export function invertAffine(transform: AffineTransform): AffineTransform | null {
  if (!isValidTransform(transform)) {
    return null;
  }
  const determinant = transform.a * transform.d - transform.b * transform.c;
  const a = transform.d / determinant;
  const b = -transform.b / determinant;
  const c = -transform.c / determinant;
  const d = transform.a / determinant;
  const tx = (transform.c * transform.ty - transform.d * transform.tx) / determinant;
  const ty = (transform.b * transform.tx - transform.a * transform.ty) / determinant;
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(tx) ||
    !Number.isFinite(ty)
  ) {
    return null;
  }
  const inverseDeterminant = a * d - b * c;
  if (!Number.isFinite(inverseDeterminant) || inverseDeterminant === 0) {
    return null;
  }
  return freezeTransform({ a, b, c, d, tx, ty });
}

/**
 * 变换 bounds 得到**保守 AABB**：变换四角后取包围盒（不是 ellipse/cubic 精确 bounds）。
 * bounds 四分量必须有限且有序（允许 zero-area）；任一变换后角点非有限返回 `null`。
 */
export function transformBounds(transform: AffineTransform, bounds: Bounds): Bounds | null {
  if (!isValidTransform(transform) || !bounds || typeof bounds !== 'object') {
    return null;
  }
  if (
    !isFiniteNumber(bounds.minX) ||
    !isFiniteNumber(bounds.minY) ||
    !isFiniteNumber(bounds.maxX) ||
    !isFiniteNumber(bounds.maxY)
  ) {
    return null;
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    return null;
  }

  const corners: readonly Point[] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    const mapped = applyAffine(transform, corner);
    if (!mapped) {
      return null;
    }
    if (mapped.x < minX) {
      minX = mapped.x;
    }
    if (mapped.y < minY) {
      minY = mapped.y;
    }
    if (mapped.x > maxX) {
      maxX = mapped.x;
    }
    if (mapped.y > maxY) {
      maxY = mapped.y;
    }
  }

  return Object.freeze({ minX, minY, maxX, maxY });
}
