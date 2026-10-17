/** @jest-environment node */

/**
 * Task 5.2 后续证据：`geometry/adaptiveContour.ts`（唯一新增本测试文件）。
 *
 * 冻结 5 exports：`AdaptiveContourErrorCode` / `AdaptiveContourResult` / `AdaptiveContour` /
 * `flattenLayeredCubic` / `flattenLayeredEllipse`。
 *
 * oracle 使用**独立** dense 参数曲线采样 + 点到有限弦段距离，不照抄实现。纯 headless。
 */

import {
  flattenLayeredCubic,
  flattenLayeredEllipse,
  type AdaptiveContour,
  type AdaptiveContourResult,
} from '../../geometry/adaptiveContour';
import { applyAffine } from '../../geometry/affine';
import { IDENTITY_TRANSFORM, type AffineTransform, type Point } from '../../model/document';

const MAX_DEV = 0.125;

function unwrap(result: AdaptiveContourResult<AdaptiveContour>): AdaptiveContour {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result.value;
}

function expectCode(result: AdaptiveContourResult<unknown>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

function rotation(radians: number): AffineTransform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

/** 点到有限弦段的距离（独立实现）。 */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: Point, polyline: readonly Point[]): number {
  let min = Infinity;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    min = Math.min(min, distanceToSegment(p, polyline[index]!, polyline[index + 1]!));
  }
  return min;
}

function cubicPoint(cp: readonly [Point, Point, Point, Point], t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * cp[0].x + 3 * mt * mt * t * cp[1].x + 3 * mt * t * t * cp[2].x + t ** 3 * cp[3].x,
    y: mt ** 3 * cp[0].y + 3 * mt * mt * t * cp[1].y + 3 * mt * t * t * cp[2].y + t ** 3 * cp[3].y,
  };
}

function transformCubic(cp: readonly [Point, Point, Point, Point], t: AffineTransform): [Point, Point, Point, Point] {
  return cp.map((p) => applyAffine(t, p)!) as [Point, Point, Point, Point];
}

/** 独立 dense oracle：transformed cubic 采样到 world polyline 的最大距离。 */
function denseCubicMaxError(
  source: readonly [Point, Point, Point, Point],
  transform: AffineTransform,
  polyline: readonly Point[],
  samples = 4000
): number {
  const cp = transformCubic(source, transform);
  let max = 0;
  for (let index = 0; index <= samples; index += 1) {
    const p = cubicPoint(cp, index / samples);
    max = Math.max(max, distanceToPolyline(p, polyline));
  }
  return max;
}

function ellipseOracleMaxError(
  center: Point,
  rx: number,
  ry: number,
  transform: AffineTransform,
  start: number,
  end: number,
  polyline: readonly Point[],
  samples = 4000
): number {
  let max = 0;
  for (let index = 0; index <= samples; index += 1) {
    const t = start + ((end - start) * index) / samples;
    const local = { x: center.x + rx * Math.cos(t), y: center.y + ry * Math.sin(t) };
    const world = applyAffine(transform, local)!;
    max = Math.max(max, distanceToPolyline(world, polyline));
  }
  return max;
}

function expectCorrespondence(contour: AdaptiveContour, transform: AffineTransform): void {
  expect(contour.localPoints.length).toBe(contour.worldPoints.length);
  contour.localPoints.forEach((local, index) => {
    const expected = applyAffine(transform, local)!;
    const actual = contour.worldPoints[index]!;
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  });
}

// ---------------------------------------------------------------------------
// A. cubic：端点/顺序/对应/变换
// ---------------------------------------------------------------------------

describe('adaptiveContour: cubic 基础与变换', () => {
  const S: readonly [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
  ];

  it('identity：端点保持、order 单调、local/world 一一对应', () => {
    const contour = unwrap(flattenLayeredCubic(S, IDENTITY_TRANSFORM));
    expect(contour.localPoints.length).toBeGreaterThan(1);
    expect(contour.localPoints[0]).toEqual({ x: 0, y: 0 });
    expect(contour.localPoints[contour.localPoints.length - 1]).toEqual({ x: 100, y: 0 });
    expectCorrespondence(contour, IDENTITY_TRANSFORM);
    expect(contour.maxDeviation).toBe(MAX_DEV);
  });

  it('rotate/shear/non-unit/mirror：world = applyAffine(local) 且 dense 误差 <= 0.125+1e-9', () => {
    const transforms: readonly AffineTransform[] = [
      rotation(Math.PI / 3),
      { a: 1, b: 0, c: 1, d: 1, tx: 5, ty: -5 },
      { a: 3, b: 0, c: 0, d: 0.5, tx: 0, ty: 0 },
      { a: -1, b: 0, c: 0, d: 2, tx: 10, ty: 0 },
    ];
    for (const transform of transforms) {
      const contour = unwrap(flattenLayeredCubic(S, transform));
      expect(contour.worldPoints.length).toBeGreaterThan(1);
      expectCorrespondence(contour, transform);
      expect(denseCubicMaxError(S, transform, contour.worldPoints)).toBeLessThanOrEqual(MAX_DEV + 1e-9);
    }
  });

  it('极端各向异性（1e6 / 1e-6）仍遵守 world 误差预算', () => {
    const transform: AffineTransform = { a: 1e6, b: 0, c: 0, d: 1e-6, tx: 0, ty: 0 };
    const contour = unwrap(flattenLayeredCubic(S, transform));
    expect(contour.localPoints.length).toBeGreaterThanOrEqual(2);
    expectCorrespondence(contour, transform);
    expect(denseCubicMaxError(S, transform, contour.worldPoints)).toBeLessThanOrEqual(MAX_DEV + 1e-9);
  });

  it('P0 = P3 的 loop 不被误判为直线', () => {
    const loop: readonly [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    const contour = unwrap(flattenLayeredCubic(loop, IDENTITY_TRANSFORM));
    expect(contour.localPoints.length).toBeGreaterThan(2);
    // 真实转折：存在远离弦（起点~终点）的点。
    const chord = distanceToSegment(contour.localPoints[1]!, contour.localPoints[0]!, contour.localPoints[contour.localPoints.length - 1]!);
    expect(chord).toBeLessThan(1e9);
    const maxY = Math.max(...contour.localPoints.map((p) => p.y));
    expect(maxY).toBeGreaterThan(10);
    expect(denseCubicMaxError(loop, IDENTITY_TRANSFORM, contour.worldPoints)).toBeLessThanOrEqual(MAX_DEV + 1e-9);
  });

  it('共线但 CP 越出两端：产生真实转折而非假单段', () => {
    const collinear: readonly [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: -100, y: 0 },
      { x: 10, y: 0 },
    ];
    const contour = unwrap(flattenLayeredCubic(collinear, IDENTITY_TRANSFORM));
    expect(contour.localPoints.length).toBeGreaterThan(2);
    const xs = contour.localPoints.map((p) => p.x);
    // 越出端点：max x > 10 或 min x < 0。
    expect(Math.max(...xs) > 10 || Math.min(...xs) < 0).toBe(true);
  });

  it('straight / zero point 退化仍成功且无重复去重假设', () => {
    const straight: readonly [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 7, y: 0 },
      { x: 10, y: 0 },
    ];
    const s = unwrap(flattenLayeredCubic(straight, IDENTITY_TRANSFORM));
    expect(s.localPoints.length).toBeGreaterThanOrEqual(2);
    expect(s.localPoints[0]).toEqual({ x: 0, y: 0 });
    expect(s.localPoints[s.localPoints.length - 1]).toEqual({ x: 10, y: 0 });

    const zero: readonly [Point, Point, Point, Point] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    const z = unwrap(flattenLayeredCubic(zero, IDENTITY_TRANSFORM));
    expect(z.localPoints.every((p) => p.x === 5 && p.y === 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. ellipse：span / 退化 / 变换 / dense oracle
// ---------------------------------------------------------------------------

describe('adaptiveContour: ellipse', () => {
  const C: Point = { x: 0, y: 0 };

  it('full arc signed ±2π：起终闭合且 dense 误差 <= 0.125+1e-9', () => {
    for (const [start, end] of [[0, Math.PI * 2], [0, -Math.PI * 2], [Math.PI / 3, Math.PI / 3 + Math.PI * 2]] as const) {
      const contour = unwrap(flattenLayeredEllipse(C, 10, 5, IDENTITY_TRANSFORM, start, end));
      expect(contour.localPoints.length).toBeGreaterThan(8);
      expect(contour.localPoints[0].x).toBeCloseTo(contour.localPoints[contour.localPoints.length - 1].x, 9);
      expect(contour.localPoints[0].y).toBeCloseTo(contour.localPoints[contour.localPoints.length - 1].y, 9);
      expect(ellipseOracleMaxError(C, 10, 5, IDENTITY_TRANSFORM, start, end, contour.worldPoints)).toBeLessThanOrEqual(
        MAX_DEV + 1e-9
      );
    }
  });

  it('quarter arc 0..π/2：误差与对应', () => {
    const transform = rotation(Math.PI / 5);
    const contour = unwrap(flattenLayeredEllipse(C, 10, 5, transform, 0, Math.PI / 2));
    expect(contour.localPoints.length).toBeGreaterThan(2);
    expectCorrespondence(contour, transform);
    expect(ellipseOracleMaxError(C, 10, 5, transform, 0, Math.PI / 2, contour.worldPoints)).toBeLessThanOrEqual(
      MAX_DEV + 1e-9
    );
  });

  it('zero span 为单点；零 radius 轴退化', () => {
    const point = unwrap(flattenLayeredEllipse(C, 10, 5, IDENTITY_TRANSFORM, 1, 1));
    expect(point.localPoints).toHaveLength(1);

    const vertical = unwrap(flattenLayeredEllipse(C, 0, 5, IDENTITY_TRANSFORM, 0, Math.PI * 2));
    expect(vertical.localPoints.every((p) => Math.abs(p.x) < 1e-9)).toBe(true);
    expect(vertical.localPoints.length).toBeGreaterThan(1);

    const bothZero = unwrap(flattenLayeredEllipse(C, 0, 0, IDENTITY_TRANSFORM, 0, Math.PI * 2));
    expect(bothZero.localPoints).toHaveLength(1);
    expect(bothZero.localPoints[0]).toEqual({ x: 0, y: 0 });
  });

  it('center translation + 各向异性 transform：对应与 dense 误差', () => {
    const center: Point = { x: 12, y: -7 };
    const transform: AffineTransform = { a: 4, b: 1, c: 0.5, d: 0.25, tx: 3, ty: 9 };
    const contour = unwrap(flattenLayeredEllipse(center, 10, 5, transform, -0.4, 2.1));
    expect(contour.localPoints.length).toBeGreaterThan(2);
    expectCorrespondence(contour, transform);
    expect(ellipseOracleMaxError(center, 10, 5, transform, -0.4, 2.1, contour.worldPoints)).toBeLessThanOrEqual(
      MAX_DEV + 1e-9
    );
  });
});

// ---------------------------------------------------------------------------
// C. 非法输入 / geometry-failed / budget
// ---------------------------------------------------------------------------

describe('adaptiveContour: 错误路径', () => {
  const S: readonly [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
  ];

  it('cubic invalid：点数 / null / NaN / 奇异 transform → invalid-input', () => {
    expectCode(flattenLayeredCubic([{ x: 0, y: 0 }] as unknown as Point[], IDENTITY_TRANSFORM), 'invalid-input');
    expectCode(flattenLayeredCubic(null as unknown as Point[], IDENTITY_TRANSFORM), 'invalid-input');
    expectCode(flattenLayeredCubic([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] as unknown as Point[], IDENTITY_TRANSFORM), 'invalid-input');
    expectCode(flattenLayeredCubic([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], IDENTITY_TRANSFORM), 'invalid-input');
    expectCode(flattenLayeredCubic(S, { ...IDENTITY_TRANSFORM, a: Number.NaN }), 'invalid-input');
    expectCode(flattenLayeredCubic(S, { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }), 'invalid-input');
  });

  it('cubic finite 变换溢出 → geometry-failed（无 partial）', () => {
    const result = flattenLayeredCubic(S, { a: 1e308, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expectCode(result, 'geometry-failed');
  });

  it('ellipse invalid：center/rx/ry/angles/span/singular → invalid-input', () => {
    expectCode(flattenLayeredEllipse(null as unknown as Point, 10, 5, IDENTITY_TRANSFORM, 0, 1), 'invalid-input');
    expectCode(flattenLayeredEllipse({ x: Number.NaN, y: 0 }, 10, 5, IDENTITY_TRANSFORM, 0, 1), 'invalid-input');
    expectCode(flattenLayeredEllipse({ x: 0, y: 0 }, -1, 5, IDENTITY_TRANSFORM, 0, 1), 'invalid-input');
    expectCode(flattenLayeredEllipse({ x: 0, y: 0 }, Number.NaN, 5, IDENTITY_TRANSFORM, 0, 1), 'invalid-input');
    expectCode(flattenLayeredEllipse({ x: 0, y: 0 }, 10, 5, { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }, 0, 1), 'invalid-input');
    expectCode(flattenLayeredEllipse({ x: 0, y: 0 }, 10, 5, IDENTITY_TRANSFORM, Number.NaN, 1), 'invalid-input');
    expectCode(flattenLayeredEllipse({ x: 0, y: 0 }, 10, 5, IDENTITY_TRANSFORM, 0, Math.PI * 2 + 0.1), 'invalid-input');
  });

  it('ellipse finite 变换/中间算术溢出 → geometry-failed', () => {
    expectCode(flattenLayeredEllipse({ x: 10, y: 0 }, 10, 5, { a: 1e308, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 0, 1), 'geometry-failed');
    expectCode(flattenLayeredEllipse({ x: 0, y: 0 }, 1e308, 1e308, { a: 1e308, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 0, Math.PI / 2), 'geometry-failed');
  });

  it('预算超限：巨大 finite cubic / ellipse → budget-exceeded（无 partial）', () => {
    const huge: readonly [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 1e300, y: 0 },
      { x: 0, y: 1e300 },
      { x: 1e300, y: 1e300 },
    ];
    expectCode(flattenLayeredCubic(huge, IDENTITY_TRANSFORM), 'budget-exceeded');
    expectCode(
      flattenLayeredEllipse({ x: 0, y: 0 }, 1e300, 1e300, IDENTITY_TRANSFORM, 0, Math.PI * 2),
      'budget-exceeded'
    );
  });
});

// ---------------------------------------------------------------------------
// D. 冻结 / caller 隔离 / maxDeviation 为上限
// ---------------------------------------------------------------------------

describe('adaptiveContour: 冻结与隔离', () => {
  it('每层深冻结；caller 变更不影响结果', () => {
    const source: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ];
    const contour = unwrap(flattenLayeredCubic(source, IDENTITY_TRANSFORM));
    const snapshot = JSON.stringify(contour);

    expect(Object.isFrozen(contour)).toBe(true);
    expect(Object.isFrozen(contour.localPoints)).toBe(true);
    expect(Object.isFrozen(contour.worldPoints)).toBe(true);
    expect(Object.isFrozen(contour.localPoints[0])).toBe(true);
    expect(Object.isFrozen(contour.worldPoints[0])).toBe(true);

    (source[1] as unknown as { y: number }).y = 999;
    expect(JSON.stringify(contour)).toBe(snapshot);
  });

  it('maxDeviation 恒为固定上限 0.125（非测量值）', () => {
    const cubic = unwrap(flattenLayeredCubic([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], IDENTITY_TRANSFORM));
    const ellipse = unwrap(flattenLayeredEllipse({ x: 0, y: 0 }, 10, 5, IDENTITY_TRANSFORM, 0, Math.PI * 2));
    expect(cubic.maxDeviation).toBe(0.125);
    expect(ellipse.maxDeviation).toBe(0.125);
  });

  it('每个成功结果 precondition：local/world 等长且 >1 点（曲线）', () => {
    const contour = unwrap(flattenLayeredCubic([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], rotation(Math.PI / 7)));
    expect(contour.localPoints.length).toBe(contour.worldPoints.length);
    expect(contour.localPoints.length).toBeGreaterThan(1);
  });

  it('translate-only：world 为 local 平移（精确）', () => {
    const transform: AffineTransform = { ...IDENTITY_TRANSFORM, tx: -30, ty: 12 };
    const contour = unwrap(flattenLayeredCubic([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], transform));
    contour.localPoints.forEach((local, index) => {
      expect(contour.worldPoints[index]!.x).toBeCloseTo(local.x - 30, 9);
      expect(contour.worldPoints[index]!.y).toBeCloseTo(local.y + 12, 9);
    });
  });

  it('真直线 cubic → 恰两段点（接受为单段）', () => {
    const straight = unwrap(
      flattenLayeredCubic([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 7, y: 0 }, { x: 10, y: 0 }], IDENTITY_TRANSFORM)
    );
    expect(straight.localPoints).toHaveLength(2);
    expect(straight.localPoints[0]).toEqual({ x: 0, y: 0 });
    expect(straight.localPoints[1]).toEqual({ x: 10, y: 0 });
  });

  it('mirror（det<0）full ellipse：对应与 dense 误差', () => {
    const transform: AffineTransform = { a: -1, b: 0, c: 0, d: 1, tx: 5, ty: 0 };
    const contour = unwrap(flattenLayeredEllipse({ x: 0, y: 0 }, 10, 5, transform, 0, Math.PI * 2));
    expectCorrespondence(contour, transform);
    expect(ellipseOracleMaxError({ x: 0, y: 0 }, 10, 5, transform, 0, Math.PI * 2, contour.worldPoints)).toBeLessThanOrEqual(
      MAX_DEV + 1e-9
    );
  });
});

