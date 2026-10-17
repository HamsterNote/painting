/**
 * 世界坐标 bounds 派生（Task 5.2 基础）
 *
 * 纯派生：把 `DocumentObject` 的 local 几何经对象 transform 映射到世界坐标，产出
 * `worldBounds`（精确几何 AABB）与 `visualWorldBounds`（含描边宽度的保守包络）。
 * - 无新 cache / docstore，不修改 caller；不依赖 V2 / DOM / Skia。
 * - 复用共享 `geometry/affine.ts`、`geometry/shape.ts`、`geometry/freehandCache.ts`。
 * - 非 query、非完整 5.2：仅提供 broadphase 世界 bounds。
 */

import type {
  AffineTransform,
  Bounds,
  DocumentObject,
  FreehandObject,
  ImageObject,
  Point,
  ShapeObject,
  TextObject,
} from '../model/document';
import { applyAffine, transformBounds } from './affine';
import { deriveShapeGeometry, type ShapeCommand } from './shape';
import type { FreehandGeometryCache } from './freehandCache';

/** 世界坐标 bounds 结果：精确几何 bounds 与保守视觉 bounds。 */
export type LayeredWorldBounds = Readonly<{
  worldBounds: Bounds;
  visualWorldBounds: Bounds;
}>;

const KNOWN_KINDS: readonly string[] = ['freehand', 'shape', 'image', 'text'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** transform 六分量有限且行列式有限非 0。 */
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

function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}

/** 校验并冻结 local bounds；四分量有限有序（允许 zero-area）。 */
function readFiniteBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const bounds = value as Record<string, unknown>;
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
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

function minMaxBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) {
      minX = point.x;
    }
    if (point.y < minY) {
      minY = point.y;
    }
    if (point.x > maxX) {
      maxX = point.x;
    }
    if (point.y > maxY) {
      maxY = point.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

/** 对命令中的 moveTo/lineTo 点逐一 applyAffine 后取 AABB（line/rect/poly/退化 ellipse）。 */
function commandPointBounds(
  commands: readonly ShapeCommand[],
  transform: AffineTransform
): Bounds | null {
  const mapped: Point[] = [];
  for (const command of commands) {
    if (command.type !== 'moveTo' && command.type !== 'lineTo') {
      continue;
    }
    const point = applyAffine(transform, { x: command.x, y: command.y });
    if (!point) {
      return null;
    }
    mapped.push(point);
  }
  return minMaxBounds(mapped);
}

/**
 * 2x2 线性部分 [[a,c],[b,d]] 的最大奇异值（闭式解，非 Frobenius 上界）。
 *
 * 先按 `m = max(|a|,|b|,|c|,|d|)` 归一化四项，再算 p=a'²+b'², q=c'²+d'², r=a'c'+b'd'，
 * σ'² = (p+q)/2 + hypot((p-q)/2, r)，最后 σ = σ' * m。缩放假避免 a² 级中间溢出
 * （如 scale(1e100,1e-100) 的 det=1 合法 transform）。
 * 归一化后 σ' 与最终 σ 仍可能非有限（不可表示的 derived），此时返回 null。
 * 本函数不承诺防止所有 underflow；只保证不因可避免的中间溢出误判。
 */
function maxSingularValue(transform: AffineTransform): number | null {
  const { a, b, c, d } = transform;
  const m = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!(m > 0) || !Number.isFinite(m)) {
    return null;
  }
  const an = a / m;
  const bn = b / m;
  const cn = c / m;
  const dn = d / m;
  const p = an * an + bn * bn;
  const q = cn * cn + dn * dn;
  const r = an * cn + bn * dn;
  const half = (p + q) / 2;
  const disc = Math.hypot((p - q) / 2, r);
  if (!Number.isFinite(half) || !Number.isFinite(disc)) {
    return null;
  }
  const sigmaSquared = half + disc;
  if (!Number.isFinite(sigmaSquared) || sigmaSquared < 0) {
    return null;
  }
  const sigmaNormalized = Math.sqrt(sigmaSquared);
  if (!Number.isFinite(sigmaNormalized)) {
    return null;
  }
  const sigma = sigmaNormalized * m;
  return Number.isFinite(sigma) ? sigma : null;
}

/** 保守外扩；非有限返回 null。 */
function expandBounds(bounds: Bounds, padding: number): Bounds | null {
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const maxX = bounds.maxX + padding;
  const maxY = bounds.maxY + padding;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function freezeResult(worldBounds: Bounds, visualWorldBounds: Bounds): LayeredWorldBounds {
  return Object.freeze({ worldBounds, visualWorldBounds });
}

/** 非退化椭圆（共享 commands 含 ellipse）的解析世界 AABB。 */
function ellipseAnalyticWorldBounds(
  command: Extract<ShapeCommand, { type: 'ellipse' }>,
  transform: AffineTransform
): Bounds | null {
  const center = applyAffine(transform, { x: command.cx, y: command.cy });
  if (!center) {
    return null;
  }
  // 线性部分振幅：X 幅度 hypot(a*rx, c*ry)，Y 幅度 hypot(b*rx, d*ry)。
  const extentX = Math.hypot(transform.a * command.rx, transform.c * command.ry);
  const extentY = Math.hypot(transform.b * command.rx, transform.d * command.ry);
  if (!Number.isFinite(extentX) || !Number.isFinite(extentY)) {
    return null;
  }
  const bounds: Bounds = {
    minX: center.x - extentX,
    minY: center.y - extentY,
    maxX: center.x + extentX,
    maxY: center.y + extentY,
  };
  return isFiniteBounds(bounds) ? Object.freeze(bounds) : null;
}

/**
 * shape 世界几何 bounds：
 * - bezier：变换四控制点后用共享 `deriveShapeGeometry` 取真正 cubic localBounds
 *   （不把 local AABB 四角冒充 exact，也不重复 roots 算法）。
 * - 非退化 ellipse：解析极值（见上）。
 * - line/rect/polygon 及退化 ellipse：对命令 moveTo/lineTo 点逐一 applyAffine 后 min/max。
 */
function shapeWorldBounds(shape: ShapeObject, transform: AffineTransform): Bounds | null {
  const geometry = deriveShapeGeometry(shape);
  if (!geometry) {
    return null;
  }
  if (shape.shapeType === 'bezier') {
    const mapped: Point[] = [];
    for (const point of shape.points) {
      const world = applyAffine(transform, point);
      if (!world) {
        return null;
      }
      mapped.push(world);
    }
    const worldGeometry = deriveShapeGeometry({ ...shape, points: mapped });
    return worldGeometry ? worldGeometry.localBounds : null;
  }
  if (shape.shapeType === 'ellipse') {
    const ellipseCommand = geometry.commands.find((command) => command.type === 'ellipse');
    if (ellipseCommand && ellipseCommand.type === 'ellipse') {
      return ellipseAnalyticWorldBounds(ellipseCommand, transform);
    }
  }
  return commandPointBounds(geometry.commands, transform);
}

/**
 * 派生对象的世界坐标 bounds。
 *
 * - 运行时校验已知 kind、finite nonsingular transform；不支持/非法/溢出返回 null。
 * - freehand 复用 `cache.getPresentation(...,'final')` 的实际 transformedPolygon worldBounds；
 *   geometry 与 visual 同为 filled bounds（轮廓已含宽度）。
 * - image/text 用 localBounds 四角精确变换，视觉同几何。
 * - shape 几何 bounds 精确；visual 在几何外按 `halfWidth * 最大奇异值` 保守外扩
 *   （round join/cap 包络，仅 broadphase，不宣称 dash 细判）。
 * - 输出深冻结，不修改 caller。
 */
export function deriveLayeredWorldBounds(
  object: DocumentObject,
  freehandCache: FreehandGeometryCache
): LayeredWorldBounds | null {
  if (!object || typeof object !== 'object') {
    return null;
  }
  const record = object as unknown as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !KNOWN_KINDS.includes(record.kind)) {
    return null;
  }
  const kind = record.kind;
  if (!isValidTransform(record.transform)) {
    return null;
  }
  const transform = record.transform as AffineTransform;

  switch (kind) {
    case 'freehand': {
      try {
        const presentation = freehandCache.getPresentation(object as FreehandObject, 'final');
        const worldBounds = presentation.worldBounds;
        if (!isFiniteBounds(worldBounds)) {
          return null;
        }
        return freezeResult(worldBounds, worldBounds);
      } catch {
        return null; // 几何/呈现派生异常（奇异/溢出）安全吞掉。
      }
    }
    case 'image':
    case 'text': {
      const localBounds = readFiniteBounds((object as ImageObject | TextObject).localBounds);
      if (!localBounds) {
        return null;
      }
      const worldBounds = transformBounds(transform, localBounds);
      if (!worldBounds) {
        return null;
      }
      return freezeResult(worldBounds, worldBounds);
    }
    case 'shape': {
      const shape = object as ShapeObject;
      const geometryBounds = shapeWorldBounds(shape, transform);
      if (!geometryBounds) {
        return null;
      }
      const halfWidth = shape.style.width / 2;
      const sigma = maxSingularValue(transform);
      if (sigma === null) {
        return null;
      }
      const padding = halfWidth * sigma;
      if (!Number.isFinite(padding)) {
        return null;
      }
      const visualWorldBounds = expandBounds(geometryBounds, padding);
      if (!visualWorldBounds) {
        return null;
      }
      return freezeResult(geometryBounds, visualWorldBounds);
    }
  }
  return null;
}
