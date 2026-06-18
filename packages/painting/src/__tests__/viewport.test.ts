import {
  DEFAULT_DRAWING_VIEWPORT,
  canvasToScreen,
  clampScale,
  resetViewport,
  screenToCanvas,
} from '../viewport';
import type { DrawingViewport, ViewportPoint } from '../viewport';

describe('viewport', () => {
  const expectPointClose = (actual: ViewportPoint, expected: ViewportPoint, precision = 3) => {
    expect(actual.x).toBeCloseTo(expected.x, precision);
    expect(actual.y).toBeCloseTo(expected.y, precision);
  };

  const roundTripCases: Array<{
    name: string;
    viewport: DrawingViewport;
  }> = [
    { name: 'default', viewport: { scale: 1, tx: 0, ty: 0 } },
    { name: 'translated', viewport: { scale: 1, tx: 40, ty: -25 } },
    { name: 'scaled', viewport: { scale: 2.5, tx: 0, ty: 0 } },
    { name: 'translated and scaled', viewport: { scale: 3, tx: -12, ty: 99 } },
  ];

  describe('coordinate transforms', () => {
    it.each(roundTripCases)('round-trips canvas points for $name viewport', ({ viewport }) => {
      expect.hasAssertions();
      const point = { x: 123.456, y: -78.9 };
      const screenPoint = canvasToScreen(point, viewport);
      const canvasPoint = screenToCanvas(screenPoint, viewport);

      expectPointClose(canvasPoint, point);
    });

    it('converts translated and scaled coordinates with canvas-local invariant', () => {
      const viewport = { scale: 2, tx: 10, ty: -30 };

      expect(canvasToScreen({ x: 5, y: 20 }, viewport)).toEqual({
        x: 20,
        y: 10,
      });
      expect(screenToCanvas({ x: 20, y: 10 }, viewport)).toEqual({
        x: 5,
        y: 20,
      });
    });
  });

  describe('scale bounds', () => {
    it.each([
      [0, 0.25],
      [0.1, 0.25],
      [0.25, 0.25],
      [1, 1],
      [8, 8],
      [9, 8],
      [Infinity, 8],
      [-Infinity, 0.25],
      [NaN, 1],
    ])('clamps %p to %p without throwing', (input, expected) => {
      expect(() => clampScale(input)).not.toThrow();
      expect(clampScale(input)).toBe(expected);
    });

    it('keeps transform output finite for invalid scale inputs', () => {
      const invalidViewports: DrawingViewport[] = [
        { scale: 0, tx: 0, ty: 0 },
        { scale: 0.1, tx: 1, ty: 2 },
        { scale: 9, tx: 1, ty: 2 },
        { scale: Infinity, tx: 1, ty: 2 },
        { scale: NaN, tx: NaN, ty: Infinity },
      ];

      for (const viewport of invalidViewports) {
        const screenPoint = canvasToScreen({ x: 10, y: 20 }, viewport);
        const canvasPoint = screenToCanvas({ x: 10, y: 20 }, viewport);

        expect(Number.isFinite(screenPoint.x)).toBe(true);
        expect(Number.isFinite(screenPoint.y)).toBe(true);
        expect(Number.isFinite(canvasPoint.x)).toBe(true);
        expect(Number.isFinite(canvasPoint.y)).toBe(true);
      }
    });
  });

  describe('viewport reset', () => {
    it('returns the exact default viewport values', () => {
      expect(resetViewport()).toEqual({ scale: 1, tx: 0, ty: 0 });
      expect(resetViewport()).toEqual(DEFAULT_DRAWING_VIEWPORT);
      expect(resetViewport()).not.toBe(DEFAULT_DRAWING_VIEWPORT);
    });
  });
});
