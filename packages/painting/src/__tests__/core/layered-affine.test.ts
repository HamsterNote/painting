/** @jest-environment node */

/**
 * `geometry/affine.ts` 纯仿射 helper 回归（Task 5.2 基础）。
 *
 * 只验证常量时间、无副作用的仿射数学与安全 null 语义；不涉及渲染/像素/任务集成。
 */

import { applyAffine, composeAffine, invertAffine, transformBounds } from '../../geometry/affine';
import type { AffineTransform, Bounds, Point } from '../../model/document';

const IDENTITY: AffineTransform = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

function expectPointClose(actual: Point | null, expected: Point): void {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 10);
  expect(actual!.y).toBeCloseTo(expected.y, 10);
}

describe('applyAffine', () => {
  it('identity 原样返回点', () => {
    expect(applyAffine(IDENTITY, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it('非单位缩放 + 平移', () => {
    const t: AffineTransform = { a: 2, b: 0, c: 0, d: 3, tx: 5, ty: -4 };
    expect(applyAffine(t, { x: 10, y: 10 })).toEqual({ x: 25, y: 26 });
  });

  it('旋转 90°', () => {
    const t: AffineTransform = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 };
    expectPointClose(applyAffine(t, { x: 1, y: 0 }), { x: 0, y: 1 });
  });

  it('镜像（负 det）允许', () => {
    const t: AffineTransform = { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    expect(applyAffine(t, { x: 3, y: 4 })).toEqual({ x: -3, y: 4 });
  });

  it('shear', () => {
    const t: AffineTransform = { a: 1, b: 2, c: 0, d: 1, tx: 0, ty: 0 };
    expect(applyAffine(t, { x: 1, y: 1 })).toEqual({ x: 1, y: 3 });
  });

  it('world 溢出返回 null', () => {
    const t: AffineTransform = { a: Number.MAX_VALUE, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    expect(applyAffine(t, { x: Number.MAX_VALUE, y: 0 })).toBeNull();
  });
});

describe('composeAffine', () => {
  const translate: AffineTransform = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0 };
  const scale: AffineTransform = { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 };

  it('compose 等于两次 apply（parent∘child 顺序）', () => {
    const composed = composeAffine(translate, scale);
    expect(composed).not.toBeNull();
    const point: Point = { x: 1, y: 1 };
    expectPointClose(
      applyAffine(composed!, point),
      applyAffine(translate, applyAffine(scale, point)!)!
    );
  });

  it('compose 不可交换', () => {
    const a = composeAffine(translate, scale)!;
    const b = composeAffine(scale, translate)!;
    expect(applyAffine(a, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
    expect(applyAffine(b, { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });

  it('输出行列式非有限 / 分量溢出返回 null', () => {
    const huge: AffineTransform = { a: 1e200, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const huge2: AffineTransform = { a: 1e200, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    expect(composeAffine(huge, huge2)).toBeNull();
  });
});

describe('invertAffine', () => {
  it('roundtrip 接近原点（非精确 float）', () => {
    const t: AffineTransform = { a: 2, b: 1, c: -1, d: 3, tx: 7, ty: -5 };
    const inverse = invertAffine(t);
    expect(inverse).not.toBeNull();
    const point: Point = { x: 4.5, y: -2.25 };
    const mapped = applyAffine(t, point)!;
    expectPointClose(applyAffine(inverse!, mapped), point);
  });

  it('奇异（det=0）返回 null', () => {
    expect(invertAffine({ a: 1, b: 2, c: 2, d: 4, tx: 0, ty: 0 })).toBeNull();
  });

  it('极小 det 导致逆非有限返回 null', () => {
    const t: AffineTransform = { a: Number.MIN_VALUE, b: 0, c: 0, d: 2, tx: 0, ty: 0 };
    expect(invertAffine(t)).toBeNull();
  });
});

describe('transformBounds', () => {
  it('轴对齐缩放 + 平移', () => {
    const t: AffineTransform = { a: 2, b: 0, c: 0, d: 2, tx: 5, ty: -4 };
    expect(transformBounds(t, { minX: 0, minY: 0, maxX: 10, maxY: 20 })).toEqual({
      minX: 5,
      minY: -4,
      maxX: 25,
      maxY: 36,
    });
  });

  it('旋转 90° 得到保守 AABB（四角）', () => {
    const t: AffineTransform = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 };
    const result = transformBounds(t, { minX: 0, minY: 0, maxX: 10, maxY: 20 });
    expect(result).toEqual({ minX: -20, minY: 0, maxX: 0, maxY: 10 });
  });

  it('zero-area bounds 允许', () => {
    expect(transformBounds(IDENTITY, { minX: 5, minY: 5, maxX: 5, maxY: 5 })).toEqual({
      minX: 5,
      minY: 5,
      maxX: 5,
      maxY: 5,
    });
  });

  it('非有序 bounds 返回 null', () => {
    expect(transformBounds(IDENTITY, { minX: 10, minY: 0, maxX: 0, maxY: 5 })).toBeNull();
  });
});

describe('运行时安全 / 不变性', () => {
  it('非法 / 缺失输入一律 null，不 throw', () => {
    const badTransform = null as unknown as AffineTransform;
    const missing = {} as AffineTransform;
    const nonFinite: AffineTransform = { a: NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const badBounds = null as unknown as Bounds;

    expect(() => applyAffine(badTransform, { x: 0, y: 0 })).not.toThrow();
    expect(applyAffine(badTransform, { x: 0, y: 0 })).toBeNull();
    expect(applyAffine(missing, { x: 0, y: 0 })).toBeNull();
    expect(applyAffine(nonFinite, { x: 0, y: 0 })).toBeNull();
    expect(applyAffine(IDENTITY, null as unknown as Point)).toBeNull();
    expect(applyAffine(IDENTITY, { x: NaN, y: 0 })).toBeNull();

    expect(composeAffine(badTransform, IDENTITY)).toBeNull();
    expect(composeAffine(IDENTITY, nonFinite)).toBeNull();
    expect(invertAffine(badTransform)).toBeNull();
    expect(invertAffine(missing)).toBeNull();
    expect(transformBounds(badTransform, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBeNull();
    expect(transformBounds(IDENTITY, badBounds)).toBeNull();
  });

  it('不修改调用方输入，输出冻结', () => {
    const transform: AffineTransform = Object.freeze({ a: 2, b: 1, c: 0, d: 3, tx: 1, ty: 2 });
    const point: Point = Object.freeze({ x: 3, y: 4 });
    const bounds: Bounds = Object.freeze({ minX: 0, minY: 0, maxX: 5, maxY: 6 });
    const beforeTransform = JSON.stringify(transform);
    const beforePoint = JSON.stringify(point);
    const beforeBounds = JSON.stringify(bounds);

    const applied = applyAffine(transform, point)!;
    const composed = composeAffine(transform, IDENTITY)!;
    const inverted = invertAffine(transform)!;
    const transformedBounds = transformBounds(transform, bounds)!;

    expect(Object.isFrozen(applied)).toBe(true);
    expect(Object.isFrozen(composed)).toBe(true);
    expect(Object.isFrozen(inverted)).toBe(true);
    expect(Object.isFrozen(transformedBounds)).toBe(true);

    expect(JSON.stringify(transform)).toBe(beforeTransform);
    expect(JSON.stringify(point)).toBe(beforePoint);
    expect(JSON.stringify(bounds)).toBe(beforeBounds);
  });
});
