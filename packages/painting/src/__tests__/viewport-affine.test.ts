import {
  canvasToScreen,
  composeViewportAffine,
  createViewportAffine,
  invertViewportAffine,
  mapViewportAffinePoint,
  screenToCanvas,
  toSkiaMatrix3,
} from '../viewport';
import type { Affine2D, DrawingViewport, ViewportPoint } from '../viewport';

describe('viewport affine', () => {
  const expectPointClose = (actual: ViewportPoint, expected: ViewportPoint, precision = 6) => {
    expect(actual.x).toBeCloseTo(expected.x, precision);
    expect(actual.y).toBeCloseTo(expected.y, precision);
  };

  const roundTripCases: Array<{ name: string; viewport: DrawingViewport }> = [
    { name: 'default', viewport: { scale: 1, tx: 0, ty: 0 } },
    { name: 'translated', viewport: { scale: 1, tx: 40, ty: -25 } },
    { name: 'scaled', viewport: { scale: 2.5, tx: 0, ty: 0 } },
    { name: 'translated and scaled', viewport: { scale: 3, tx: -12, ty: 99 } },
  ];

  describe('createViewportAffine', () => {
    it.each(roundTripCases)('builds scale/translate affine for $name viewport', ({ viewport }) => {
      const affine = createViewportAffine(viewport);

      expect(affine).toEqual({
        a: viewport.scale,
        b: 0,
        c: 0,
        d: viewport.scale,
        tx: viewport.tx,
        ty: viewport.ty,
      });
    });

    it('normalizes invalid viewport values to finite affine components', () => {
      const invalidViewports: DrawingViewport[] = [
        { scale: 0, tx: 0, ty: 0 },
        { scale: NaN, tx: NaN, ty: Infinity },
        { scale: 99, tx: 1, ty: 2 },
      ];

      for (const viewport of invalidViewports) {
        const affine = createViewportAffine(viewport);

        for (const value of Object.values(affine)) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }

      expect(createViewportAffine({ scale: NaN, tx: NaN, ty: Infinity })).toEqual({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: 0,
        ty: 0,
      });
    });
  });

  describe('forward/inverse roundtrip', () => {
    it.each(roundTripCases)('round-trips points through affine inverse for $name', ({ viewport }) => {
      const affine = createViewportAffine(viewport);
      const inverse = invertViewportAffine(affine);
      const point = { x: 123.456, y: -78.9 };

      expect(inverse).not.toBeNull();
      const screenPoint = mapViewportAffinePoint(point, affine);
      const back = mapViewportAffinePoint(screenPoint, inverse as Affine2D);

      expectPointClose(back, point);
    });

    it('maps with the exact forward convention screenX=a*x+c*y+tx', () => {
      const affine: Affine2D = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: -30 };

      expect(mapViewportAffinePoint({ x: 5, y: 20 }, affine)).toEqual({ x: 20, y: 10 });
    });
  });

  describe('composition', () => {
    it('applies inner first then outer', () => {
      const inner = createViewportAffine({ scale: 2, tx: 10, ty: -30 });
      const outer = createViewportAffine({ scale: 3, tx: 100, ty: 50 });
      const point = { x: 7.5, y: -4 };

      const composed = composeViewportAffine(outer, inner);
      const actual = mapViewportAffinePoint(point, composed);
      const expected = mapViewportAffinePoint(mapViewportAffinePoint(point, inner), outer);

      expectPointClose(actual, expected);
    });

    it('is associative and keeps identity neutral', () => {
      const identity: Affine2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
      const first = createViewportAffine({ scale: 2, tx: 3, ty: 4 });
      const second = createViewportAffine({ scale: 0.5, tx: -1, ty: 8 });
      const third = createViewportAffine({ scale: 3, tx: 7, ty: -2 });
      const point = { x: 12.5, y: -3.25 };

      expect(composeViewportAffine(identity, first)).toEqual(first);
      expect(composeViewportAffine(first, identity)).toEqual(first);

      // 以实际点映射验证 third ∘ (second ∘ first) = (third ∘ second) ∘ first，
      // 避免仅比较同一表达式而产生恒真断言。
      const left = mapViewportAffinePoint(
        point,
        composeViewportAffine(third, composeViewportAffine(second, first))
      );
      const right = mapViewportAffinePoint(
        point,
        composeViewportAffine(composeViewportAffine(third, second), first)
      );
      expectPointClose(left, right);
    });
  });

  describe('toSkiaMatrix3', () => {
    it('lays out a viewport affine in row-major order', () => {
      const affine = createViewportAffine({ scale: 2, tx: 10, ty: -30 });

      expect(toSkiaMatrix3(affine)).toEqual([2, 0, 10, 0, 2, -30, 0, 0, 1]);
    });

    it('preserves rotation/skew terms for a general affine', () => {
      const affine: Affine2D = { a: 1, b: 2, c: 3, d: 4, tx: 5, ty: 6 };

      expect(toSkiaMatrix3(affine)).toEqual([1, 3, 5, 2, 4, 6, 0, 0, 1]);
    });

    it('returns exactly nine finite numbers', () => {
      const matrix = toSkiaMatrix3(createViewportAffine({ scale: 1, tx: 0, ty: 0 }));

      expect(matrix).toHaveLength(9);
      expect(matrix.every((value) => Number.isFinite(value))).toBe(true);
    });
  });

  describe('legacy helper equivalence', () => {
    const samples: ViewportPoint[] = [
      { x: 0, y: 0 },
      { x: 123.456, y: -78.9 },
      { x: -1.5, y: 2.25 },
    ];

    it.each(roundTripCases)('matches canvasToScreen for $name', ({ viewport }) => {
      const affine = createViewportAffine(viewport);

      for (const point of samples) {
        expect(canvasToScreen(point, viewport)).toEqual(mapViewportAffinePoint(point, affine));
      }
    });

    it.each(roundTripCases)('matches screenToCanvas for $name', ({ viewport }) => {
      const inverse = invertViewportAffine(createViewportAffine(viewport));

      for (const point of samples) {
        expectPointClose(
          screenToCanvas(point, viewport),
          mapViewportAffinePoint(point, inverse as Affine2D)
        );
      }
    });

    it('still maps non-finite point components to the translation fallback', () => {
      const viewport = { scale: 2, tx: 10, ty: -30 };

      expect(canvasToScreen({ x: NaN, y: Infinity }, viewport)).toEqual({ x: 10, y: -30 });
    });
  });

  describe('invalid inverse', () => {
    it('returns null for a singular affine', () => {
      const singular: Affine2D = { a: 1, b: 2, c: 2, d: 4, tx: 0, ty: 0 };

      expect(invertViewportAffine(singular)).toBeNull();
    });

    it('returns null when any component is non-finite', () => {
      const nonFinite: Affine2D = { a: NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

      expect(invertViewportAffine(nonFinite)).toBeNull();
    });
  });
});
