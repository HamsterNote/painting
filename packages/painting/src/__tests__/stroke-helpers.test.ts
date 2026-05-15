import { createStroke, appendPoint, isValidStroke, pointsToPolyline, createDrawingValue } from '../stroke-helpers';

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
});