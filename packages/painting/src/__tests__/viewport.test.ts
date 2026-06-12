import {
  DEFAULT_DRAWING_VIEWPORT,
  canvasToScreen,
  clampScale,
  resetViewport,
  screenToCanvas,
  zoomViewportAroundScreenPoint,
  type DrawingViewport,
  type ViewportPoint,
} from '../viewport';

describe('viewport', () => {
  const expectPointClose = (
    actual: ViewportPoint,
    expected: ViewportPoint,
    precision = 3,
  ) => {
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

  describe('pinch midpoint zoom', () => {
    it('keeps the pinch midpoint stable in screen space', () => {
      const viewport = { scale: 2, tx: -40, ty: 25 };
      const midpoint = { x: 150, y: 90 };
      const canvasMidpoint = screenToCanvas(midpoint, viewport);
      const nextViewport = zoomViewportAroundScreenPoint(viewport, midpoint, 4);
      const nextScreenMidpoint = canvasToScreen(canvasMidpoint, nextViewport);

      expect(Math.abs(nextScreenMidpoint.x - midpoint.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(nextScreenMidpoint.y - midpoint.y)).toBeLessThanOrEqual(0.5);
    });

    it('clamps requested pinch scale while preserving midpoint stability', () => {
      const viewport = { scale: 1, tx: 20, ty: -10 };
      const midpoint = { x: 80, y: 120 };
      const canvasMidpoint = screenToCanvas(midpoint, viewport);
      const nextViewport = zoomViewportAroundScreenPoint(viewport, midpoint, 99);
      const nextScreenMidpoint = canvasToScreen(canvasMidpoint, nextViewport);

      expect(nextViewport.scale).toBe(8);
      expectPointClose(nextScreenMidpoint, midpoint, 0);
    });
  });

  describe('zoomViewportAroundScreenPoint regression tuples', () => {
    it('default viewport midpoint {100,80} scale 2', () => {
      expect(
        zoomViewportAroundScreenPoint({ scale: 1, tx: 0, ty: 0 }, { x: 100, y: 80 }, 2),
      ).toEqual({ scale: 2, tx: -100, ty: -80 });
    });

    it('translated viewport midpoint {80,120} scale 4', () => {
      expect(
        zoomViewportAroundScreenPoint({ scale: 1, tx: 20, ty: -10 }, { x: 80, y: 120 }, 4),
      ).toEqual({ scale: 4, tx: -160, ty: -400 });
    });

    it('scaled viewport midpoint {150,90} scale 4', () => {
      expect(
        zoomViewportAroundScreenPoint({ scale: 2, tx: -40, ty: 25 }, { x: 150, y: 90 }, 4),
      ).toEqual({ scale: 4, tx: -230, ty: -40 });
    });

    it('min clamp viewport midpoint {50,50} scale 0.1', () => {
      expect(
        zoomViewportAroundScreenPoint({ scale: 1, tx: 0, ty: 0 }, { x: 50, y: 50 }, 0.1),
      ).toEqual({ scale: 0.25, tx: 37.5, ty: 37.5 });
    });

    it('max clamp viewport midpoint {30,70} scale 99', () => {
      expect(
        zoomViewportAroundScreenPoint({ scale: 1, tx: 10, ty: 10 }, { x: 30, y: 70 }, 99),
      ).toEqual({ scale: 8, tx: -130, ty: -410 });
    });

    it('invalid viewport NaN/Infinity midpoint {10,20} scale 2', () => {
      expect(
        zoomViewportAroundScreenPoint(
          { scale: Number.NaN, tx: Number.NaN, ty: Infinity },
          { x: 10, y: 20 },
          2,
        ),
      ).toEqual({ scale: 2, tx: -10, ty: -20 });
    });
  });
});
