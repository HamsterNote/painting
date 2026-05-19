import {
  appendPoint,
  createDrawingValue,
  createStroke,
  createVelocityAdaptivePoints,
  getAdaptiveInterpolationCount,
  getPointVelocity,
  interpolateCatmullRomPoint,
  isValidStroke,
  pointsToPolyline,
  pointsToSvgPath,
  sampleFixedTimeGrid,
} from '../stroke-helpers';

describe('stroke-helpers', () => {
  describe('createStroke', () => {
    it('creates stroke with generated id', () => {
      const stroke = createStroke('pen');
      expect(stroke.id).toBeTruthy();
      expect(typeof stroke.id).toBe('string');
      expect(stroke.id.length).toBeGreaterThan(0);
    });

    it('creates stroke with pen tool', () => {
      const stroke = createStroke('pen');
      expect(stroke.tool).toBe('pen');
    });

    it('creates stroke with empty points', () => {
      const stroke = createStroke('pen');
      expect(stroke.points).toEqual([]);
    });

    it('creates stroke with line tool and empty points', () => {
      const stroke = createStroke('line');
      expect(stroke.tool).toBe('line');
      expect(stroke.points).toEqual([]);
    });

    it('creates stroke with rect tool and empty points', () => {
      const stroke = createStroke('rect');
      expect(stroke.tool).toBe('rect');
      expect(stroke.points).toEqual([]);
    });
  });

  describe('appendPoint', () => {
    it('appends point to stroke', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      expect(stroke2.points).toEqual([{ x: 10, y: 20 }]);
    });

    it('returns new stroke object (immutable)', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      expect(stroke).not.toBe(stroke2);
    });

    it('dedupes consecutive identical points', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      const stroke3 = appendPoint(stroke2, { x: 10, y: 20 });
      expect(stroke3.points).toEqual([{ x: 10, y: 20 }]);
    });

    it('allows non-consecutive duplicate points', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      const stroke3 = appendPoint(stroke2, { x: 30, y: 40 });
      const stroke4 = appendPoint(stroke3, { x: 10, y: 20 });
      expect(stroke4.points).toEqual([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 10, y: 20 },
      ]);
    });
  });

  describe('isValidStroke', () => {
    it('returns false for stroke with < 2 points', () => {
      const stroke = createStroke('pen');
      expect(isValidStroke(stroke)).toBe(false);
    });

    it('returns false for stroke with single point', () => {
      const stroke = appendPoint(createStroke('pen'), { x: 10, y: 20 });
      expect(isValidStroke(stroke)).toBe(false);
    });

    it('returns false for stroke with 2 identical points', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      const stroke3 = appendPoint(stroke2, { x: 10, y: 20 });
      expect(isValidStroke(stroke3)).toBe(false);
    });

    it('returns true for stroke with 2 distinct points', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      const stroke3 = appendPoint(stroke2, { x: 30, y: 40 });
      expect(isValidStroke(stroke3)).toBe(true);
    });
  });

  describe('pointsToPolyline', () => {
    it('converts points to SVG polyline format', () => {
      const polyline = pointsToPolyline([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ]);
      expect(polyline).toBe('10,20 30,40 50,60');
    });

    it('handles single point', () => {
      const polyline = pointsToPolyline([{ x: 10, y: 20 }]);
      expect(polyline).toBe('10,20');
    });

    it('handles empty array', () => {
      const polyline = pointsToPolyline([]);
      expect(polyline).toBe('');
    });
  });

  describe('createDrawingValue', () => {
    it('creates DrawingValue from strokes', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      const stroke3 = appendPoint(stroke2, { x: 30, y: 40 });
      const value = createDrawingValue([stroke, stroke3]);
      expect(value.strokes).toHaveLength(2);
    });
  });

  describe('integration: create stroke, append 3 distinct points, serialize', () => {
    it('creates stroke with 3 distinct points and serializes to SVG polyline', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 0, y: 0 });
      const stroke3 = appendPoint(stroke2, { x: 50, y: 50 });
      const stroke4 = appendPoint(stroke3, { x: 100, y: 100 });

      expect(stroke4.points).toHaveLength(3);
      expect(isValidStroke(stroke4)).toBe(true);

      const polyline = pointsToPolyline(stroke4.points);
      expect(polyline).toBe('0,0 50,50 100,100');
    });
  });

  describe('tap/no-move handling', () => {
    it('rejects single point stroke', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      expect(isValidStroke(stroke2)).toBe(false);
    });

    it('rejects repeated same point', () => {
      const stroke = createStroke('pen');
      const stroke2 = appendPoint(stroke, { x: 10, y: 20 });
      const stroke3 = appendPoint(stroke2, { x: 10, y: 20 });
      const stroke4 = appendPoint(stroke3, { x: 10, y: 20 });
      expect(isValidStroke(stroke4)).toBe(false);
    });
  });

  describe('getPointVelocity', () => {
    it('calculates velocity between two points with timestamps', () => {
      const p1 = { x: 0, y: 0, timestamp: 1000 };
      const p2 = { x: 100, y: 0, timestamp: 1100 };
      expect(getPointVelocity(p1, p2)).toBeCloseTo(1.0);
    });

    it('returns 0 when timestamps are missing', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      expect(getPointVelocity(p1, p2)).toBe(0);
    });

    it('returns 0 when time difference is 0', () => {
      const p1 = { x: 0, y: 0, timestamp: 1000 };
      const p2 = { x: 100, y: 0, timestamp: 1000 };
      expect(getPointVelocity(p1, p2)).toBe(0);
    });
  });

  describe('getAdaptiveInterpolationCount', () => {
    it('returns more points for higher velocity', () => {
      const p1 = { x: 0, y: 0, timestamp: 1000 };
      const p2 = { x: 200, y: 0, timestamp: 1100 };
      const p3 = { x: 10, y: 0, timestamp: 1000 };
      const p4 = { x: 20, y: 0, timestamp: 1100 };

      const fastCount = getAdaptiveInterpolationCount(p1, p2);
      const slowCount = getAdaptiveInterpolationCount(p3, p4);
      expect(fastCount).toBeGreaterThan(slowCount);
    });

    it('returns 0 for very short segments', () => {
      const p1 = { x: 0, y: 0, timestamp: 1000 };
      const p2 = { x: 1, y: 0, timestamp: 1100 };
      expect(getAdaptiveInterpolationCount(p1, p2)).toBe(0);
    });
  });

  describe('interpolateCatmullRomPoint', () => {
    it('returns point on curve at t=0.5', () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 100, y: 0 };
      const p2 = { x: 200, y: 0 };
      const p3 = { x: 300, y: 0 };
      const result = interpolateCatmullRomPoint(p0, p1, p2, p3, 0.5);
      expect(result.x).toBeCloseTo(150);
      expect(result.y).toBeCloseTo(0);
    });

    it('returns p1 at t=0', () => {
      const p0 = { x: 0, y: 50 };
      const p1 = { x: 100, y: 100 };
      const p2 = { x: 200, y: 50 };
      const p3 = { x: 300, y: 100 };
      const result = interpolateCatmullRomPoint(p0, p1, p2, p3, 0);
      expect(result.x).toBeCloseTo(100);
      expect(result.y).toBeCloseTo(100);
    });

    it('returns p2 at t=1', () => {
      const p0 = { x: 0, y: 50 };
      const p1 = { x: 100, y: 100 };
      const p2 = { x: 200, y: 50 };
      const p3 = { x: 300, y: 100 };
      const result = interpolateCatmullRomPoint(p0, p1, p2, p3, 1);
      expect(result.x).toBeCloseTo(200);
      expect(result.y).toBeCloseTo(50);
    });
  });

  describe('pointsToSvgPath', () => {
    it('generates M command for single point', () => {
      const path = pointsToSvgPath([{ x: 10, y: 20 }]);
      expect(path).toBe('M 10 20');
    });

    it('generates M + L for two points', () => {
      const path = pointsToSvgPath([{ x: 10, y: 20 }, { x: 30, y: 40 }]);
      expect(path).toBe('M 10 20 L 30 40');
    });

    it('generates cubic bezier for 3+ points', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
        { x: 150, y: 50 },
      ];
      const path = pointsToSvgPath(points);
      expect(path).toMatch(/^M 0 0 C /);
      expect(path).toContain('C');
    });
  });

  describe('createVelocityAdaptivePoints', () => {
    it('returns original points when timestamps missing', () => {
      const raw = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ];
      const result = createVelocityAdaptivePoints(raw);
      expect(result).toEqual(raw);
    });

    it('adds interpolated points for fast movement', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 1000 },
        { x: 200, y: 0, timestamp: 1100 },
        { x: 400, y: 0, timestamp: 1200 },
      ];
      const result = createVelocityAdaptivePoints(raw);
      expect(result.length).toBeGreaterThan(raw.length);
    });

    it('preserves first and last points with timestamps', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 1000 },
        { x: 200, y: 0, timestamp: 1100 },
        { x: 400, y: 0, timestamp: 1200 },
      ];
      const result = createVelocityAdaptivePoints(raw);
      expect(result[0]).toEqual({ x: 0, y: 0, timestamp: 1000 });
      expect(result[result.length - 1]).toEqual({ x: 400, y: 0, timestamp: 1200 });
    });

    it('preserves pressure when smoothing disabled', () => {
      const raw = [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 0, pressure: 0.8 },
      ];
      const result = createVelocityAdaptivePoints(raw, { enabled: false });
      expect(result).toEqual(raw);
    });

    it('preserves pressure in first and last points when smoothing enabled', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 1000, pressure: 0.3 },
        { x: 200, y: 0, timestamp: 1100, pressure: 0.9 },
        { x: 400, y: 0, timestamp: 1200, pressure: 0.5 },
      ];
      const result = createVelocityAdaptivePoints(raw);
      expect(result[0].pressure).toBe(0.3);
      expect(result[result.length - 1].pressure).toBe(0.5);
    });

    it('interpolates pressure for generated points when endpoints have pressure', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 1000, pressure: 0.4 },
        { x: 200, y: 0, timestamp: 1100, pressure: 0.8 },
      ];
      const result = createVelocityAdaptivePoints(raw);
      const generatedPoints = result.slice(1, result.length - 1);
      expect(generatedPoints.length).toBeGreaterThan(0);
      generatedPoints.forEach((p) => {
        expect(p.pressure).toBeDefined();
        expect(p.pressure).toBeGreaterThan(0.4);
        expect(p.pressure).toBeLessThan(0.8);
      });
    });

    it('omits pressure when input has no pressure', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 1000 },
        { x: 200, y: 0, timestamp: 1100 },
        { x: 400, y: 0, timestamp: 1200 },
      ];
      const result = createVelocityAdaptivePoints(raw);
      result.forEach((p) => {
        expect(p.pressure).toBeUndefined();
      });
    });
  });

  describe('sampleFixedTimeGrid', () => {
    it('returns empty array for empty input', () => {
      expect(sampleFixedTimeGrid([], 8.333, false)).toEqual([]);
    });

    it('returns all points when no timestamps present', () => {
      const raw = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }];
      const result = sampleFixedTimeGrid(raw, 8.333, false);
      expect(result).toEqual(raw);
    });

    it('keeps first point and samples at fixed intervals', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 0 },
        { x: 10, y: 10, timestamp: 10 },
        { x: 20, y: 20, timestamp: 20 },
        { x: 30, y: 30, timestamp: 30 },
      ];
      const result = sampleFixedTimeGrid(raw, 8.333, false);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]).toEqual({ x: 0, y: 0, timestamp: 0 });
      // Should have interpolated points around 8.333, 16.666, 25
    });

    it('interpolates x/y linearly between raw points', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 0 },
        { x: 100, y: 100, timestamp: 100 },
      ];
      const result = sampleFixedTimeGrid(raw, 25, false);
      // Target times: 0, 25, 50, 75
      expect(result).toHaveLength(4);
      expect(result[1]).toEqual({ x: 25, y: 25, timestamp: 25 });
      expect(result[2]).toEqual({ x: 50, y: 50, timestamp: 50 });
      expect(result[3]).toEqual({ x: 75, y: 75, timestamp: 75 });
    });

    it('interpolates pressure when available', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 0, pressure: 0.2 },
        { x: 100, y: 100, timestamp: 100, pressure: 0.8 },
      ];
      const result = sampleFixedTimeGrid(raw, 50, false);
      expect(result).toHaveLength(2);
      expect(result[1].pressure).toBeCloseTo(0.5);
    });

    it('flushes last raw point when flushLast is true', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 0 },
        { x: 100, y: 0, timestamp: 100 },
      ];
      const noFlush = sampleFixedTimeGrid(raw, 30, false);
      const flush = sampleFixedTimeGrid(raw, 30, true);
      expect(flush.length).toBeGreaterThanOrEqual(noFlush.length);
      const last = flush[flush.length - 1];
      expect(last.x).toBe(100);
      expect(last.y).toBe(0);
    });

    it('avoids duplicating last point when it already matches target', () => {
      const raw = [
        { x: 0, y: 0, timestamp: 0 },
        { x: 30, y: 30, timestamp: 30 },
      ];
      const result = sampleFixedTimeGrid(raw, 30, true);
      // Should have first point at 0 and last at 30, but not duplicate
      expect(result.filter((p) => p.timestamp === 30)).toHaveLength(1);
    });

    it('produces consistent output across different refresh rates', () => {
      // Simulate same 100ms path at different rAF frequencies
      const path60Hz = Array.from({ length: 7 }, (_, i) => ({
        x: i * 10,
        y: i * 10,
        timestamp: i * 16.667,
      }));
      const path120Hz = Array.from({ length: 13 }, (_, i) => ({
        x: i * 5,
        y: i * 5,
        timestamp: i * 8.333,
      }));
      const path144Hz = Array.from({ length: 15 }, (_, i) => ({
        x: i * 4.286,
        y: i * 4.286,
        timestamp: i * 6.944,
      }));

      const sample60 = sampleFixedTimeGrid(path60Hz, 8.333, true);
      const sample120 = sampleFixedTimeGrid(path120Hz, 8.333, true);
      const sample144 = sampleFixedTimeGrid(path144Hz, 8.333, true);

      expect(sample60.length).toBeCloseTo(sample120.length, -1);
      expect(sample120.length).toBeCloseTo(sample144.length, -1);

      // Key coordinates should be similar
      expect(sample60[0]).toEqual({ x: 0, y: 0, timestamp: 0 });
      expect(sample120[0]).toEqual({ x: 0, y: 0, timestamp: 0 });
      expect(sample144[0]).toEqual({ x: 0, y: 0, timestamp: 0 });
    });
  });
});
