/** @jest-environment node */

import {
  IMAGE_GEOMETRY_FALLBACK_HEIGHT,
  IMAGE_GEOMETRY_FALLBACK_WIDTH,
  TEXT_GEOMETRY_FALLBACK_HEIGHT,
  TEXT_GEOMETRY_FALLBACK_WIDTH,
  DEFAULT_DRAWING_CONTOUR_MAX_DEVIATION,
  MAX_DRAWING_CONTOUR_SEGMENTS,
  describeDrawingStrokeGeometry,
  describeDrawingGeometryContour,
  getDrawingGeometryBounds,
  getDrawingStrokeBounds,
  hitTestDrawingDocument,
  hitTestDrawingGeometry,
  hitTestDrawingStroke,
} from '../../core/geometry';
import type { DrawingStrokeV2 } from '../../model/strokes';

type Point = { x: number; y: number };

function cubicPoint(points: readonly [Point, Point, Point, Point], t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * points[0].x +
      3 * inverse ** 2 * t * points[1].x +
      3 * inverse * t ** 2 * points[2].x +
      t ** 3 * points[3].x,
    y:
      inverse ** 3 * points[0].y +
      3 * inverse ** 2 * t * points[1].y +
      3 * inverse * t ** 2 * points[2].y +
      t ** 3 * points[3].y,
  };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
        );
  return Math.hypot(point.x - (start.x + dx * progress), point.y - (start.y + dy * progress));
}

function distanceToContour(point: Point, contour: readonly Point[]): number {
  return Math.min(
    ...contour
      .slice(0, -1)
      .map((start, index) => distanceToSegment(point, start, contour[index + 1]))
  );
}

function translateDescriptor(
  descriptor: NonNullable<ReturnType<typeof describeDrawingStrokeGeometry>>,
  offset: Point
) {
  const point = (value: Point): Point => ({ x: value.x - offset.x, y: value.y - offset.y });
  if (descriptor.kind === 'path') return { ...descriptor, points: descriptor.points.map(point) };
  if (descriptor.kind === 'cubic-bezier')
    return { ...descriptor, points: descriptor.points.map(point) as [Point, Point, Point, Point] };
  return { ...descriptor, center: point(descriptor.center) };
}

function stroke<T extends DrawingStrokeV2['tool']>(
  tool: T,
  points: Array<{ x: number; y: number }>
): Extract<DrawingStrokeV2, { tool: T }> {
  return { schemaVersion: 2, id: tool, tool, points } as Extract<DrawingStrokeV2, { tool: T }>;
}

describe('core/geometry', () => {
  it.each([
    [
      'pen',
      stroke('pen', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      { x: 5, y: 0 },
    ],
    [
      'line',
      stroke('line', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      { x: 5, y: 0 },
    ],
    [
      'rect',
      stroke('rect', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
      { x: 5, y: 5 },
    ],
    [
      'ellipse',
      stroke('ellipse', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
      { x: 5, y: 5 },
    ],
    [
      'polygon',
      stroke('polygon', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ]),
      { x: 5, y: 3 },
    ],
    [
      'bezier',
      stroke('bezier', [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 7, y: 0 },
        { x: 10, y: 0 },
      ]),
      { x: 5, y: 0 },
    ],
    [
      'text',
      {
        ...stroke('text', [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
        text: 'x',
        fontSize: 12,
      },
      { x: 5, y: 5 },
    ],
    [
      'image',
      {
        ...stroke('image', [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
        src: 'image',
      },
      { x: 5, y: 5 },
    ],
  ])('describes, bounds, and hits %s with one geometry source', (_tool, value, point) => {
    const descriptor = describeDrawingStrokeGeometry(value);
    expect(descriptor).not.toBeNull();
    expect(getDrawingStrokeBounds(value)).toEqual(getDrawingGeometryBounds(descriptor!));
    expect(hitTestDrawingStroke(value, point, 0)).toBe(
      hitTestDrawingGeometry(descriptor!, point, 0)
    );
    expect(hitTestDrawingStroke(value, point, 0)).toBe(true);
  });

  it('includes rect, ellipse, text, and image rotation in conservative bounds', () => {
    const values: DrawingStrokeV2[] = [
      {
        ...stroke('rect', [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ]),
        rotationRad: Math.PI / 2,
      },
      {
        ...stroke('ellipse', [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ]),
        rotationRad: Math.PI / 2,
      },
      {
        ...stroke('text', [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ]),
        text: 'x',
        fontSize: 12,
        rotationRad: Math.PI / 2,
      },
      {
        ...stroke('image', [
          { x: 0, y: 0 },
          { x: 20, y: 10 },
        ]),
        src: 'image',
        rotationRad: Math.PI / 2,
      },
    ];

    values.forEach((value) => {
      const bounds = getDrawingStrokeBounds(value);
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeCloseTo(10);
      expect(bounds!.height).toBeCloseTo(20);
    });
  });

  it('uses stable conservative text/image fallbacks for missing and non-positive boxes', () => {
    const emptyText = { ...stroke('text', []), text: '', fontSize: 12 };
    const flatImage = {
      ...stroke('image', [
        { x: 20, y: 30 },
        { x: 20, y: 30 },
      ]),
      src: 'image',
    };

    expect(getDrawingStrokeBounds(emptyText)).toMatchObject({
      minX: 0,
      minY: 0,
      width: TEXT_GEOMETRY_FALLBACK_WIDTH,
      height: TEXT_GEOMETRY_FALLBACK_HEIGHT,
    });
    expect(getDrawingStrokeBounds(flatImage)).toMatchObject({
      minX: 20,
      minY: 30,
      width: IMAGE_GEOMETRY_FALLBACK_WIDTH,
      height: IMAGE_GEOMETRY_FALLBACK_HEIGHT,
    });
    expect(hitTestDrawingStroke(emptyText, { x: 1, y: 1 }, 0)).toBe(true);
  });

  it('returns the last document hit as topmost', () => {
    const bottom = {
      ...stroke('rect', [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ]),
      id: 'bottom',
    };
    const top = {
      ...stroke('ellipse', [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ]),
      id: 'top',
    };
    expect(
      hitTestDrawingDocument({ schemaVersion: 2, strokes: [bottom, top] }, { x: 10, y: 10 }, 0)
    ).toEqual({ stroke: top, index: 1 });
  });

  it('treats empty, non-finite, and degenerate path inputs as null/miss without NaN bounds', () => {
    const invalid = [
      stroke('pen', []),
      stroke('line', [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
      stroke('polygon', [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
      stroke('bezier', [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
      stroke('rect', [
        { x: Number.NaN, y: 0 },
        { x: 10, y: 10 },
      ]),
      stroke('ellipse', [
        { x: 0, y: 0 },
        { x: Infinity, y: 10 },
      ]),
    ];

    invalid.forEach((value) => {
      expect(getDrawingStrokeBounds(value)).toBeNull();
      expect(hitTestDrawingStroke(value, { x: 0, y: 0 }, 2)).toBe(false);
    });
  });

  it('derives an adaptive high-curvature cubic contour within its published error', () => {
    const controls: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 0, y: 120 },
      { x: 120, y: -120 },
      { x: 120, y: 0 },
    ];
    const descriptor = { kind: 'cubic-bezier' as const, points: controls };
    const contour = describeDrawingGeometryContour(descriptor);

    expect(contour).toMatchObject({
      closed: false,
      capped: false,
      isWithinRequestedMaxDeviation: true,
      requestedMaxDeviation: DEFAULT_DRAWING_CONTOUR_MAX_DEVIATION,
    });
    expect(contour!.points.length).toBeGreaterThan(17);
    for (let step = 0; step <= 1_000; step += 1) {
      expect(
        distanceToContour(cubicPoint(controls, step / 1_000), contour!.points)
      ).toBeLessThanOrEqual(contour!.maxDeviation + 1e-8);
    }
  });

  it('uses a bounded rotated ellipse contour for both fill and boundary tolerance', () => {
    const descriptor = {
      kind: 'ellipse' as const,
      center: { x: 10, y: -5 },
      radiusX: 0.6,
      radiusY: 0.15,
      rotationRad: Math.PI / 4,
    };
    const contour = describeDrawingGeometryContour(descriptor);

    expect(contour).toMatchObject({
      closed: true,
      capped: false,
      isWithinRequestedMaxDeviation: true,
    });
    expect(contour!.maxDeviation).toBeLessThanOrEqual(DEFAULT_DRAWING_CONTOUR_MAX_DEVIATION);
    expect(hitTestDrawingGeometry(descriptor, descriptor.center, 0)).toBe(true);
    // 沿旋转后的长轴离开轮廓 0.2 DIP，避免把世界 X 方向误当作椭圆法线。
    const outsideAlongMajorAxis = { x: 10 + 0.8 / Math.sqrt(2), y: -5 + 0.8 / Math.sqrt(2) };
    expect(hitTestDrawingGeometry(descriptor, outsideAlongMajorAxis, 0)).toBe(false);
    expect(hitTestDrawingGeometry(descriptor, outsideAlongMajorAxis, 0.4)).toBe(true);
  });

  it('retains closed path fill semantics through the shared contour', () => {
    const descriptor = {
      kind: 'path' as const,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 4, y: 10 },
      ],
    };
    expect(describeDrawingGeometryContour(descriptor)).toMatchObject({
      closed: true,
      maxDeviation: 0,
    });
    expect(hitTestDrawingGeometry(descriptor, { x: 4, y: 3 }, 0)).toBe(true);
    expect(hitTestDrawingGeometry(descriptor, { x: 11, y: 9 }, 0)).toBe(false);
  });

  it('uses canonical nonzero rather than even-odd for repeatedly wound closed paths', () => {
    const descriptor = {
      kind: 'path' as const,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    expect(hitTestDrawingGeometry(descriptor, { x: 5, y: 5 }, 0)).toBe(true);
  });

  it('makes cap degradation explicit while keeping contour memory bounded', () => {
    const descriptor = {
      kind: 'cubic-bezier' as const,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 10_000 },
        { x: 10_000, y: -10_000 },
        { x: 10_000, y: 0 },
      ] as [Point, Point, Point, Point],
    };
    const contour = describeDrawingGeometryContour(descriptor, {
      maxDeviation: 1e-9,
      maxSegments: 4,
    });

    expect(contour).toMatchObject({
      capped: true,
      isWithinRequestedMaxDeviation: false,
      requestedMaxDeviation: 1e-9,
    });
    expect(contour!.points.length).toBeLessThanOrEqual(5);
    expect(contour!.maxDeviation).toBeGreaterThan(1e-9);
  });

  it('rejects invalid contour requests and malformed public descriptors', () => {
    const path = {
      kind: 'path' as const,
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    expect(describeDrawingGeometryContour(path, { maxDeviation: 0 })).toBeNull();
    expect(describeDrawingGeometryContour(path, { maxSegments: 3 })).toBeNull();
    expect(
      describeDrawingGeometryContour(path, { maxSegments: MAX_DRAWING_CONTOUR_SEGMENTS + 1 })
    ).toBeNull();
    expect(
      describeDrawingGeometryContour({
        kind: 'ellipse',
        center: { x: 0, y: 0 },
        radiusX: -1,
        radiusY: 1,
        rotationRad: 0,
      })
    ).toBeNull();
    expect(
      describeDrawingGeometryContour({
        kind: 'cubic-bezier',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: Number.NaN, y: 1 },
          { x: 2, y: 2 },
        ],
      })
    ).toBeNull();
  });

  it.each([0.25, 1, 8])('keeps world tolerance derived from screen DIP at scale %s', (scale) => {
    const descriptor = {
      kind: 'path' as const,
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    const screenTolerance = 6;
    const worldTolerance = screenTolerance / scale;
    expect(
      hitTestDrawingGeometry(descriptor, { x: 50, y: worldTolerance - 0.001 }, worldTolerance)
    ).toBe(true);
    expect(
      hitTestDrawingGeometry(descriptor, { x: 50, y: worldTolerance + 0.001 }, worldTolerance)
    ).toBe(false);
  });

  it('keeps shared-contour hits invariant when a frame rebases world coordinates', () => {
    const original = describeDrawingStrokeGeometry(
      stroke('ellipse', [
        { x: 100_000, y: -50_000 },
        { x: 100_080, y: -49_960 },
      ])
    );
    const origin = { x: 100_000, y: -50_000 };
    const local = translateDescriptor(original!, origin);
    const worldPoint = { x: 100_040, y: -49_980 };
    const localPoint = { x: 40, y: 20 };

    expect(hitTestDrawingGeometry(original!, worldPoint, 2)).toBe(true);
    expect(hitTestDrawingGeometry(local, localPoint, 2)).toBe(true);
    expect(describeDrawingGeometryContour(original!)!.points.length).toBe(
      describeDrawingGeometryContour(local)!.points.length
    );
  });
});
