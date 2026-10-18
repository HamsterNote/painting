/** @jest-environment node */

/**
 * Task 5.2 证据：`geometry/worldBounds.ts`（唯一新增本测试文件）。
 *
 * 冻结 2 exports：
 * - `LayeredWorldBounds { worldBounds; visualWorldBounds }`
 * - `deriveLayeredWorldBounds(object: DocumentObject, cache: FreehandGeometryCache): LayeredWorldBounds | null`
 *
 * 只用真实 model union + 真实 FreehandGeometryCache；不 mock DOM/renderer，不做像素。
 */

import { deriveLayeredWorldBounds, type LayeredWorldBounds } from '../../geometry/worldBounds';
import { FreehandGeometryCache } from '../../geometry/freehandCache';
import {
  IDENTITY_TRANSFORM,
  type AffineTransform,
  type Bounds,
  type DocumentObject,
  type FreehandObject,
  type ImageObject,
  type Point,
  type ShapeObject,
  type ShapeStyle,
  type ShapeType,
  type TextObject,
} from '../../model/document';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function apply(t: AffineTransform, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty };
}

function corners(b: Bounds): readonly Point[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

function boundsOfPoints(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function expectBoundsClose(actual: Bounds, expected: Bounds, digits = 6): void {
  expect(actual.minX).toBeCloseTo(expected.minX, digits);
  expect(actual.minY).toBeCloseTo(expected.minY, digits);
  expect(actual.maxX).toBeCloseTo(expected.maxX, digits);
  expect(actual.maxY).toBeCloseTo(expected.maxY, digits);
}

function rotation(radians: number): AffineTransform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

function makeStyle(overrides: Partial<ShapeStyle> = {}): ShapeStyle {
  return { color: '#000000', width: 2, opacity: 1, ...overrides };
}

function makeShape(
  shapeType: ShapeType,
  points: readonly Point[],
  transform: AffineTransform = IDENTITY_TRANSFORM,
  style: Partial<ShapeStyle> = {}
): ShapeObject {
  return {
    kind: 'shape',
    objectId: `shape-${shapeType}`,
    objectRevision: 1,
    transform,
    transformRevision: 1,
    shapeType,
    points,
    style: makeStyle(style),
  };
}

function makeImage(
  transform: AffineTransform,
  localBounds: Bounds = { minX: -10, minY: -5, maxX: 10, maxY: 5 }
): ImageObject {
  return {
    kind: 'image',
    objectId: 'image-1',
    objectRevision: 1,
    transform,
    transformRevision: 1,
    src: 'data:image/png;base64,AAAA',
    localBounds,
  };
}

function makeText(
  transform: AffineTransform,
  localBounds: Bounds = { minX: -10, minY: -5, maxX: 10, maxY: 5 }
): TextObject {
  return {
    kind: 'text',
    objectId: 'text-1',
    objectRevision: 1,
    transform,
    transformRevision: 1,
    content: 'hello',
    fontSize: 12,
    color: '#000000',
    localBounds,
  };
}

function makeFreehand(overrides: Partial<FreehandObject> = {}): FreehandObject {
  return {
    kind: 'freehand',
    objectId: 'freehand-1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    commitId: 'c1',
    samples: [
      { sequence: 0, x: 0, y: 0, pressure: 0.5, time: 0, phase: 'down', source: 'pen' },
      { sequence: 1, x: 10, y: 10, pressure: 0.6, time: 16, phase: 'move', source: 'pen' },
      { sequence: 2, x: 20, y: 5, pressure: 0.4, time: 32, phase: 'up', source: 'pen' },
    ],
    brushSnapshot: {
      color: '#123456',
      nominalSize: 8,
      opacity: 1,
      pressureMode: 'real',
      presetRevision: 1,
    },
    resolvedPressureMode: 'real',
    samplesRevision: 1,
    brushRevision: 1,
    ...overrides,
  };
}

function derive(
  object: DocumentObject,
  cache = new FreehandGeometryCache()
): LayeredWorldBounds | null {
  return deriveLayeredWorldBounds(object, cache);
}

// ---------------------------------------------------------------------------
// A. mixed union / 五 shape 类型
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: mixed union 与 shape 类型', () => {
  it('四种 mixed 类型（identity）均非 null', () => {
    const objects: readonly DocumentObject[] = [
      makeFreehand(),
      makeShape('rect', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
      makeImage(IDENTITY_TRANSFORM),
      makeText(IDENTITY_TRANSFORM),
    ];
    for (const object of objects) {
      expect(derive(object)).not.toBeNull();
    }
  });

  it('五种 shape 类型均非 null（含 scale/rotate）', () => {
    const t = { ...rotation(Math.PI / 4), tx: 5, ty: 7 };
    const shapes: readonly ShapeObject[] = [
      makeShape(
        'line',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        t
      ),
      makeShape(
        'rect',
        [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ],
        t
      ),
      makeShape(
        'ellipse',
        [
          { x: -10, y: -5 },
          { x: 10, y: 5 },
        ],
        t
      ),
      makeShape(
        'polygon',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        t
      ),
      makeShape(
        'bezier',
        [
          { x: 0, y: 0 },
          { x: 0, y: 100 },
          { x: 100, y: 100 },
          { x: 100, y: 0 },
        ],
        t
      ),
    ];
    for (const shape of shapes) {
      expect(derive(shape)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// B. image / text：rotated / sheared / mirrored 四角 exact
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: image/text 变换', () => {
  const local: Bounds = { minX: -10, minY: -5, maxX: 10, maxY: 5 };

  it('rotated 45°：四角 exact', () => {
    const t = rotation(Math.PI / 4);
    const expected = boundsOfPoints(corners(local).map((p) => apply(t, p)));
    expectBoundsClose(derive(makeImage(t, local))!.worldBounds, expected);
    expectBoundsClose(derive(makeText(t, local))!.worldBounds, expected);
  });

  it('sheared：四角 exact', () => {
    const t: AffineTransform = { a: 1, b: 0, c: 1, d: 1, tx: 3, ty: -2 };
    const expected = boundsOfPoints(corners(local).map((p) => apply(t, p)));
    expectBoundsClose(derive(makeImage(t, local))!.worldBounds, expected);
    expectBoundsClose(derive(makeText(t, local))!.worldBounds, expected);
  });

  it('mirrored：四角 exact', () => {
    const t: AffineTransform = { a: -1, b: 0, c: 0, d: 2, tx: 0, ty: 0 };
    const expected = boundsOfPoints(corners(local).map((p) => apply(t, p)));
    expectBoundsClose(derive(makeImage(t, local))!.worldBounds, expected);
    expectBoundsClose(derive(makeText(t, local))!.worldBounds, expected);
  });

  it('zero-area image bounds：仍返回退化为线的 bounds', () => {
    const zero: Bounds = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    const result = derive(makeImage(IDENTITY_TRANSFORM, zero))!;
    expect(result.worldBounds).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  });
});

// ---------------------------------------------------------------------------
// C. 非法 transform
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: 非法 transform', () => {
  it('非有限 / 奇异 transform → null', () => {
    expect(derive(makeImage({ a: Number.NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 }))).toBeNull();
    expect(
      derive(makeImage({ a: 1, b: 0, c: 0, d: 1, tx: Number.POSITIVE_INFINITY, ty: 0 }))
    ).toBeNull();
    expect(derive(makeImage({ a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }))).toBeNull();
  });

  it('transform overflow（巨大线性项放大坐标）→ null', () => {
    expect(
      derive(
        makeImage(
          { a: 1e308, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          { minX: -10, minY: -5, maxX: 10, maxY: 5 }
        )
      )
    ).toBeNull();
  });

  it('null / 非对象 → null', () => {
    expect(derive(null as unknown as DocumentObject)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D. bezier：旋转后真实极值（非 local box transform）
// ---------------------------------------------------------------------------

function denseBezierBounds(p0: Point, cp1: Point, cp2: Point, p3: Point, samples = 4000): Bounds {
  const points: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const mt = 1 - t;
    points.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * p3.y,
    });
  }
  return boundsOfPoints(points);
}

describe('layeredWorldBounds: bezier 旋转极值', () => {
  it('CP(0,100)(100,100) endpoints(0,0)(100,0) 旋转 45°：与 dense oracle 一致且紧致', () => {
    const local = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ] as const;
    const t = { ...rotation(Math.PI / 4), tx: 20, ty: -30 };
    const shape = makeShape('bezier', local, t);
    const result = derive(shape)!;

    const transformed = local.map((p) => apply(t, p));
    const oracle = denseBezierBounds(
      transformed[0],
      transformed[1],
      transformed[2],
      transformed[3]
    );
    expectBoundsClose(result.worldBounds, oracle, 2);
    // 紧致：worldBounds 每条边都在 oracle 的 3e-3 邻域内（非宽松 local box）。
    expect(Math.abs(result.worldBounds.maxY - oracle.maxY)).toBeLessThan(3e-3);
    expect(Math.abs(result.worldBounds.minX - oracle.minX)).toBeLessThan(3e-3);
  });

  it('identity bezier ymax 精确 75（非控制点 100）', () => {
    const shape = makeShape('bezier', [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(derive(shape)!.worldBounds.maxY).toBeCloseTo(75, 6);
  });
});

// ---------------------------------------------------------------------------
// E. ellipse 变换与退化
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: ellipse', () => {
  const local = [
    { x: -10, y: -5 },
    { x: 10, y: 5 },
  ] as const;

  it('rotate45：extent sqrt(62.5)（非 box 10.6066）', () => {
    const t = rotation(Math.PI / 4);
    const result = derive(makeShape('ellipse', local, t))!;
    const extent = Math.sqrt(62.5);
    expectBoundsClose(result.worldBounds, {
      minX: -extent,
      minY: -extent,
      maxX: extent,
      maxY: extent,
    });
  });

  it('shear：解析 extent 公式', () => {
    const t: AffineTransform = { a: 1, b: 0, c: 1, d: 1, tx: 3, ty: -2 };
    const result = derive(makeShape('ellipse', local, t))!;
    const ex = Math.sqrt((t.a * 10) ** 2 + (t.c * 5) ** 2);
    const ey = Math.sqrt((t.b * 10) ** 2 + (t.d * 5) ** 2);
    expectBoundsClose(result.worldBounds, {
      minX: t.tx - ex,
      minY: t.ty - ey,
      maxX: t.tx + ex,
      maxY: t.ty + ey,
    });
  });

  it('non-uniform scale(2,1) 与 mirror 解析', () => {
    const scale: AffineTransform = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    expectBoundsClose(derive(makeShape('ellipse', local, scale))!.worldBounds, {
      minX: -20,
      minY: -5,
      maxX: 20,
      maxY: 5,
    });
    const mirror: AffineTransform = { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    expectBoundsClose(derive(makeShape('ellipse', local, mirror))!.worldBounds, {
      minX: -10,
      minY: -5,
      maxX: 10,
      maxY: 5,
    });
  });

  it('退化竖/横/点 ellipse 世界 bounds', () => {
    const vertical = derive(
      makeShape(
        'ellipse',
        [
          { x: 0, y: -5 },
          { x: 0, y: 5 },
        ],
        IDENTITY_TRANSFORM
      )
    )!;
    expectBoundsClose(vertical.worldBounds, { minX: 0, minY: -5, maxX: 0, maxY: 5 });
    const horizontal = derive(
      makeShape(
        'ellipse',
        [
          { x: -10, y: 0 },
          { x: 10, y: 0 },
        ],
        IDENTITY_TRANSFORM
      )
    )!;
    expectBoundsClose(horizontal.worldBounds, { minX: -10, minY: 0, maxX: 10, maxY: 0 });
    const point = derive(
      makeShape(
        'ellipse',
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        IDENTITY_TRANSFORM
      )
    )!;
    expectBoundsClose(point.worldBounds, { minX: 5, minY: 5, maxX: 5, maxY: 5 });
  });
});

// ---------------------------------------------------------------------------
// F. line / polygon world bounds
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: line / polygon', () => {
  it('line：端点变换 exact', () => {
    const t = { ...rotation(Math.PI / 6), tx: 4, ty: 4 };
    const shape = makeShape(
      'line',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      t
    );
    const expected = boundsOfPoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ].map((p) => apply(t, p))
    );
    expectBoundsClose(derive(shape)!.worldBounds, expected);
  });

  it('polygon：顶点变换 exact', () => {
    const t: AffineTransform = { a: 1, b: 0, c: 0.5, d: 2, tx: 1, ty: -1 };
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const expected = boundsOfPoints(pts.map((p) => apply(t, p)));
    expectBoundsClose(derive(makeShape('polygon', pts, t))!.worldBounds, expected);
  });
});

// ---------------------------------------------------------------------------
// G. shape visual：最大奇异值 stroke half-width 包络
// ---------------------------------------------------------------------------

function maxSingular(t: AffineTransform): number {
  const e = t.a * t.a + t.b * t.b + t.c * t.c + t.d * t.d;
  const det = t.a * t.d - t.b * t.c;
  const disc = Math.sqrt(Math.max(0, e * e - 4 * det * det));
  return Math.sqrt((e + disc) / 2);
}

function expectedVisual(worldBounds: Bounds, t: AffineTransform, width: number): Bounds {
  const padding = (width / 2) * maxSingular(t);
  return {
    minX: worldBounds.minX - padding,
    minY: worldBounds.minY - padding,
    maxX: worldBounds.maxX + padding,
    maxY: worldBounds.maxY + padding,
  };
}

describe('layeredWorldBounds: visual 包络', () => {
  it('scale(2,1)：padding = width/2 * 2', () => {
    const t: AffineTransform = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const result = derive(
      makeShape(
        'rect',
        [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ],
        t,
        { width: 4 }
      )
    )!;
    expectBoundsClose(result.visualWorldBounds, expectedVisual(result.worldBounds, t, 4));
  });

  it('rotate 保持 width（σmax=1）', () => {
    const t = rotation(Math.PI / 3);
    const result = derive(
      makeShape(
        'rect',
        [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ],
        t,
        { width: 4 }
      )
    )!;
    expectBoundsClose(result.visualWorldBounds, expectedVisual(result.worldBounds, t, 4));
  });

  it('shear 用独立公式（σmax=(1+√5)/2）', () => {
    const t: AffineTransform = { a: 1, b: 0, c: 1, d: 1, tx: 0, ty: 0 };
    expect(maxSingular(t)).toBeCloseTo((1 + Math.sqrt(5)) / 2, 9);
    const result = derive(
      makeShape(
        'rect',
        [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ],
        t,
        { width: 4 }
      )
    )!;
    expectBoundsClose(result.visualWorldBounds, expectedVisual(result.worldBounds, t, 4));
  });
});

// ---------------------------------------------------------------------------
// H. freehand：真实 PF cache 一致 / caller 稳定 / transformRevision 更新
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: freehand cache', () => {
  it('worldBounds 与 cache.getPresentation(object, final) 一致', () => {
    const object = makeFreehand();
    const cache = new FreehandGeometryCache();
    const presentation = cache.getPresentation(object, 'final');
    const result = deriveLayeredWorldBounds(object, cache)!;
    expectBoundsClose(result.worldBounds, presentation.worldBounds);
  });

  it('caller 稳定：重复调用一致且 raw refs/revs 不变', () => {
    const object = makeFreehand();
    const cache = new FreehandGeometryCache();
    const samplesRef = object.samples;
    const first = deriveLayeredWorldBounds(object, cache)!;
    const second = deriveLayeredWorldBounds(object, cache)!;
    expectBoundsClose(second.worldBounds, first.worldBounds);
    expect(object.samples).toBe(samplesRef);
    expect(object.samplesRevision).toBe(1);
    expect(object.brushRevision).toBe(1);
  });

  it('transformRevision/transform 改变 → world bounds 更新（几何不失效）', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const before = deriveLayeredWorldBounds(object, cache)!;
    const moved = {
      ...object,
      transform: Object.freeze({ ...IDENTITY_TRANSFORM, tx: 100, ty: 20 }),
      transformRevision: object.transformRevision + 1,
    };
    const after = deriveLayeredWorldBounds(moved, cache)!;
    expect(after.worldBounds.minX).toBeCloseTo(before.worldBounds.minX + 100, 6);
    expect(after.worldBounds.minY).toBeCloseTo(before.worldBounds.minY + 20, 6);
    expect(moved.samples).toBe(object.samples);
  });
});

// ---------------------------------------------------------------------------
// I. overflow 与 deep freeze
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: overflow 与冻结', () => {
  it('world transform overflow → null', () => {
    const t: AffineTransform = { a: 1, b: 0, c: 0, d: 1, tx: 1e308, ty: 0 };
    expect(derive(makeImage(t, { minX: 0, minY: 0, maxX: 1.7e308, maxY: 1 }))).toBeNull();
  });

  it('结果与两个 bounds 深冻结', () => {
    const result = derive(
      makeShape('rect', [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ])
    )!;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.worldBounds)).toBe(true);
    expect(Object.isFrozen(result.visualWorldBounds)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J. 最大奇异稳定包络 / malformed / refs / oracle
// ---------------------------------------------------------------------------

describe('layeredWorldBounds: 稳定包络与补充证据', () => {
  const huge = { a: 1e100, b: 0, c: 0, d: 1e-100, tx: 0, ty: 0 } as const;
  const hugeSwap = { a: 1e-100, b: 0, c: 0, d: 1e100, tx: 0, ty: 0 } as const;

  it('合法有限 scale(1e100,1e-100) det1：比值近似、finite、padding≈1e100', () => {
    const result = derive(
      makeShape(
        'line',
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        huge,
        { width: 2 }
      )
    )!;
    expect(result).not.toBeNull();
    expect(Number.isFinite(result.worldBounds.maxX)).toBe(true);
    expect(result.worldBounds.maxX / 1e100).toBeCloseTo(1, 9);
    expect(result.worldBounds.maxY / 1e-100).toBeCloseTo(1, 9);
    // padding = (width/2) * sigma = 1 * 1e100
    expect(Number.isFinite(result.visualWorldBounds.minX)).toBe(true);
    expect(result.visualWorldBounds.minX / 1e100).toBeCloseTo(-1, 9);
  });

  it('另一轴 scale(1e-100,1e100)：比值近似、padding≈1e100', () => {
    const result = derive(
      makeShape(
        'line',
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        hugeSwap,
        { width: 2 }
      )
    )!;
    expect(result).not.toBeNull();
    expect(result.worldBounds.maxX / 1e-100).toBeCloseTo(1, 9);
    expect(result.worldBounds.maxY / 1e100).toBeCloseTo(1, 9);
    expect(Number.isFinite(result.visualWorldBounds.minY)).toBe(true);
    expect(result.visualWorldBounds.minY / 1e100).toBeCloseTo(-1, 9);
  });

  it('大但 finite 参数下 stroke padding 真溢出（width 1e308）→ null', () => {
    expect(
      derive(
        makeShape(
          'line',
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          huge,
          { width: 1e308 }
        )
      )
    ).toBeNull();
  });

  it('freehand malformed samples（NaN）→ null', () => {
    const base = makeFreehand();
    const bad = makeFreehand({
      samples: [{ ...base.samples[0], x: Number.NaN }, base.samples[1], base.samples[2]],
    });
    expect(derive(bad)).toBeNull();
  });

  it('cache.getPresentation 抛错 → null', () => {
    const cache = new FreehandGeometryCache();
    const spy = jest.spyOn(cache, 'getPresentation').mockImplementation(() => {
      throw new Error('cache boom');
    });
    expect(derive(makeFreehand(), cache)).toBeNull();
    spy.mockRestore();
  });

  it('invalid localBounds（无序/缺失）与 unknown kind → null', () => {
    expect(
      derive(makeImage(IDENTITY_TRANSFORM, { minX: 10, minY: 0, maxX: 0, maxY: 10 }))
    ).toBeNull();
    expect(derive(makeImage(IDENTITY_TRANSFORM, null as unknown as Bounds))).toBeNull();
    expect(derive({ kind: 'weird' } as unknown as DocumentObject)).toBeNull();
  });

  it('四种 kind 调用后 raw refs 与被调用文档不变、结果快照稳定', () => {
    const freehand = makeFreehand();
    const shape = makeShape('polygon', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    const image = makeImage(IDENTITY_TRANSFORM);
    const text = makeText(IDENTITY_TRANSFORM);
    const cases: readonly DocumentObject[] = [freehand, shape, image, text];

    const savedSamples = freehand.samples;
    const savedPoints = shape.points;
    const savedImageBounds = image.localBounds;
    const savedTextBounds = text.localBounds;
    const documentJson = JSON.stringify(cases);

    const first = cases.map((object) => JSON.stringify(derive(object)));
    const second = cases.map((object) => JSON.stringify(derive(object)));
    expect(second).toEqual(first);

    expect(freehand.samples).toBe(savedSamples);
    expect(shape.points).toBe(savedPoints);
    expect(image.localBounds).toBe(savedImageBounds);
    expect(text.localBounds).toBe(savedTextBounds);
    expect(JSON.stringify(cases)).toBe(documentJson);
  });

  it('freehand：cache.getGeometry(final) 调用前后同引用（geometry 未失效）', () => {
    const object = makeFreehand();
    const cache = new FreehandGeometryCache();
    const before = cache.getGeometry(object, 'final');
    derive(object, cache);
    const after = cache.getGeometry(object, 'final');
    expect(after).toBe(before);
    expect(object.samplesRevision).toBe(1);
    expect(object.transformRevision).toBe(1);
  });

  it('bezier dense oracle bounds + 代表性采样点含于 worldBounds（1e-9）', () => {
    const local = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ] as const;
    const t = { ...rotation(Math.PI / 4), tx: 20, ty: -30 };
    const result = derive(makeShape('bezier', local, t))!;
    const transformed = local.map((p) => apply(t, p));
    for (const tt of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const mt = 1 - tt;
      const p = {
        x:
          mt ** 3 * transformed[0].x +
          3 * mt * mt * tt * transformed[1].x +
          3 * mt * tt * tt * transformed[2].x +
          tt ** 3 * transformed[3].x,
        y:
          mt ** 3 * transformed[0].y +
          3 * mt * mt * tt * transformed[1].y +
          3 * mt * tt * tt * transformed[2].y +
          tt ** 3 * transformed[3].y,
      };
      expect(p.x).toBeGreaterThanOrEqual(result.worldBounds.minX - 1e-9);
      expect(p.x).toBeLessThanOrEqual(result.worldBounds.maxX + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(result.worldBounds.minY - 1e-9);
      expect(p.y).toBeLessThanOrEqual(result.worldBounds.maxY + 1e-9);
    }
  });

  it('non-unit 平移 ellipse：center/extent 解析', () => {
    const t: AffineTransform = { a: 2, b: 0, c: 0, d: 3, tx: 7, ty: -4 };
    const shape = makeShape(
      'ellipse',
      [
        { x: 90, y: 45 },
        { x: 110, y: 55 },
      ],
      t
    ); // cx=100,cy=50,rx=10,ry=5
    const result = derive(shape)!;
    expectBoundsClose(result.worldBounds, {
      minX: 2 * 100 + 7 - 2 * 10,
      minY: 3 * 50 - 4 - 3 * 5,
      maxX: 2 * 100 + 7 + 2 * 10,
      maxY: 3 * 50 - 4 + 3 * 5,
    });
  });
});
