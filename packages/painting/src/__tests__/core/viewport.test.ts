/** @jest-environment node */

// 只从 canonical core 入口导入，验证 viewport 数学确实通过 @hamster-note/painting/core 公开。
import {
  DEFAULT_DRAWING_VIEWPORT,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  canvasToScreen,
  clampScale,
  normalizeViewport,
  screenToCanvas,
} from '../../core/internal';
import type { DrawingViewport, ViewportPoint } from '../../core/internal';

describe('core/viewport', () => {
  const expectPointClose = (actual: ViewportPoint, expected: ViewportPoint, precision = 3) => {
    expect(actual.x).toBeCloseTo(expected.x, precision);
    expect(actual.y).toBeCloseTo(expected.y, precision);
  };

  const roundTripCases: Array<{ name: string; viewport: DrawingViewport }> = [
    { name: 'default', viewport: { scale: 1, tx: 0, ty: 0 } },
    { name: 'translated', viewport: { scale: 1, tx: 40, ty: -25 } },
    { name: 'scaled', viewport: { scale: 2.5, tx: 0, ty: 0 } },
    { name: 'translated and scaled', viewport: { scale: 3, tx: -12, ty: 99 } },
  ];

  describe('scale clamping', () => {
    it.each([
      [0, MIN_VIEWPORT_SCALE],
      [0.1, MIN_VIEWPORT_SCALE],
      [MIN_VIEWPORT_SCALE, MIN_VIEWPORT_SCALE],
      [1, 1],
      [MAX_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE],
      [MAX_VIEWPORT_SCALE + 1, MAX_VIEWPORT_SCALE],
      [Infinity, MAX_VIEWPORT_SCALE],
      [-Infinity, MIN_VIEWPORT_SCALE],
      [NaN, DEFAULT_DRAWING_VIEWPORT.scale],
    ])('clamps %p to %p without throwing', (input, expected) => {
      expect(() => clampScale(input)).not.toThrow();
      expect(clampScale(input)).toBe(expected);
    });

    it('normalizes scale and non-finite translations to finite default values', () => {
      expect(normalizeViewport({ scale: 99, tx: NaN, ty: Infinity })).toEqual({
        scale: MAX_VIEWPORT_SCALE,
        tx: DEFAULT_DRAWING_VIEWPORT.tx,
        ty: DEFAULT_DRAWING_VIEWPORT.ty,
      });
    });
  });

  describe('forward and inverse transforms', () => {
    it('maps canvas to screen with scale then translation', () => {
      const viewport = { scale: 2, tx: 10, ty: -30 };

      expect(canvasToScreen({ x: 5, y: 20 }, viewport)).toEqual({ x: 20, y: 10 });
    });

    it('maps screen back to canvas as the exact inverse', () => {
      const viewport = { scale: 2, tx: 10, ty: -30 };

      expect(screenToCanvas({ x: 20, y: 10 }, viewport)).toEqual({ x: 5, y: 20 });
    });
  });

  describe('round-trip', () => {
    it.each(roundTripCases)('round-trips canvas points for $name viewport', ({ viewport }) => {
      const point = { x: 123.456, y: -78.9 };
      const canvasPoint = screenToCanvas(canvasToScreen(point, viewport), viewport);

      expectPointClose(canvasPoint, point);
    });

    it.each(roundTripCases)('round-trips screen points for $name viewport', ({ viewport }) => {
      const point = { x: 300, y: 150 };
      const screenPoint = canvasToScreen(screenToCanvas(point, viewport), viewport);

      expectPointClose(screenPoint, point);
    });
  });
});
