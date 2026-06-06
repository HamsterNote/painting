import type { DrawingPoint, DrawingStroke, DrawingValue } from '../components/DrawingSurface';
import type { DrawingStrokeV2 } from '../model/strokes';
import { addStroke, clearStrokes, pick, removeStroke, updateStroke } from '../utils';

describe('utils', () => {
  const createMockStroke = (id: string, tool: DrawingStroke['tool'] = 'pen', points: DrawingPoint[] = []): DrawingStroke => ({
    id,
    tool,
    points,
  });

  const createMockValue = (strokes: DrawingStroke[] = []): DrawingValue => ({
    strokes,
    selectedId: null,
  });

  describe('addStroke', () => {
    it('adds a stroke to the strokes array', () => {
      const value = createMockValue([]);
      const stroke = createMockStroke('1');
      const result = addStroke(value, stroke);
      expect(result.strokes).toHaveLength(1);
      expect(result.strokes[0]).toBe(stroke);
    });

    it('appends stroke to existing strokes', () => {
      const stroke1 = createMockStroke('1');
      const stroke2 = createMockStroke('2');
      const value = createMockValue([stroke1]);
      const result = addStroke(value, stroke2);
      expect(result.strokes).toHaveLength(2);
      expect(result.strokes[0]).toBe(stroke1);
      expect(result.strokes[1]).toBe(stroke2);
    });

    it('returns new object (immutable)', () => {
      const value = createMockValue([]);
      const stroke = createMockStroke('1');
      const result = addStroke(value, stroke);
      expect(result).not.toBe(value);
    });

    it('preserves other value properties', () => {
      const value: DrawingValue = { strokes: [], selectedId: 'test' };
      const stroke = createMockStroke('1');
      const result = addStroke(value, stroke);
      expect(result.selectedId).toBe('test');
    });
  });

  describe('removeStroke', () => {
    it('removes a stroke by id', () => {
      const stroke1 = createMockStroke('1');
      const stroke2 = createMockStroke('2');
      const value = createMockValue([stroke1, stroke2]);
      const result = removeStroke(value, '1');
      expect(result.strokes).toHaveLength(1);
      expect(result.strokes[0].id).toBe('2');
    });

    it('returns empty strokes array when last stroke removed', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);
      const result = removeStroke(value, '1');
      expect(result.strokes).toHaveLength(0);
    });

    it('does nothing when stroke id does not exist', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);
      const result = removeStroke(value, 'nonexistent');
      expect(result.strokes).toHaveLength(1);
    });

    it('returns new object (immutable)', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);
      const result = removeStroke(value, '1');
      expect(result).not.toBe(value);
    });
  });

  describe('updateStroke', () => {
    it('updates a stroke by id', () => {
      const stroke1 = createMockStroke('1', 'pen', [{ x: 0, y: 0 }]);
      const stroke2 = createMockStroke('2', 'pen', [{ x: 10, y: 10 }]);
      const updatedStroke = createMockStroke('1', 'pen', [{ x: 5, y: 5 }]);
      const value = createMockValue([stroke1, stroke2]);
      const result = updateStroke(value, updatedStroke);
      expect(result.strokes).toHaveLength(2);
      expect(result.strokes[0].points).toEqual([{ x: 5, y: 5 }]);
      expect(result.strokes[1]).toBe(stroke2);
    });

    it('does nothing when stroke id does not exist', () => {
      const stroke = createMockStroke('1', 'pen', [{ x: 0, y: 0 }]);
      const value = createMockValue([stroke]);
      const updatedStroke = createMockStroke('nonexistent', 'pen', [{ x: 5, y: 5 }]);
      const result = updateStroke(value, updatedStroke);
      expect(result.strokes).toHaveLength(1);
      expect(result.strokes[0].points).toEqual([{ x: 0, y: 0 }]);
    });

    it('returns new object (immutable)', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);
      const updatedStroke = createMockStroke('1', 'rect');
      const result = updateStroke(value, updatedStroke);
      expect(result).not.toBe(value);
    });

    it('can change stroke tool type', () => {
      const stroke = createMockStroke('1', 'pen');
      const value = createMockValue([stroke]);
      const updatedStroke = createMockStroke('1', 'line');
      const result = updateStroke(value, updatedStroke);
      expect(result.strokes[0].tool).toBe('line');
    });
  });

  describe('clearStrokes', () => {
    it('removes all strokes', () => {
      const stroke1 = createMockStroke('1');
      const stroke2 = createMockStroke('2');
      const value = createMockValue([stroke1, stroke2]);
      const result = clearStrokes(value);
      expect(result.strokes).toHaveLength(0);
    });

    it('works on empty strokes array', () => {
      const value = createMockValue([]);
      const result = clearStrokes(value);
      expect(result.strokes).toHaveLength(0);
    });

    it('returns new object (immutable)', () => {
      const value = createMockValue([createMockStroke('1')]);
      const result = clearStrokes(value);
      expect(result).not.toBe(value);
    });

    it('preserves other value properties', () => {
      const value: DrawingValue = { strokes: [createMockStroke('1')], selectedId: 'test' };
      const result = clearStrokes(value);
      expect(result.selectedId).toBe('test');
    });
  });

  describe('pick', () => {
    it('returns null for empty strokes array', () => {
      const result = pick({ x: 0, y: 0 }, []);
      expect(result).toBeNull();
    });

    it('returns the closest stroke to a point', () => {
      const stroke1 = createMockStroke('1', 'pen', [{ x: 0, y: 0 }]);
      const stroke2 = createMockStroke('2', 'pen', [{ x: 100, y: 100 }]);
      const result = pick({ x: 5, y: 5 }, [stroke1, stroke2]);
      expect(result?.id).toBe('1');
    });

    it('returns the stroke when only one exists', () => {
      const stroke = createMockStroke('1', 'pen', [{ x: 50, y: 50 }]);
      const result = pick({ x: 0, y: 0 }, [stroke]);
      expect(result?.id).toBe('1');
    });

    it('returns closest stroke for pen tool', () => {
      const stroke1 = createMockStroke('1', 'pen', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
      const stroke2 = createMockStroke('2', 'pen', [{ x: 100, y: 100 }, { x: 110, y: 100 }]);
      const result = pick({ x: 5, y: 5 }, [stroke1, stroke2]);
      expect(result?.id).toBe('1');
    });

    it('returns closest stroke for line tool', () => {
      const stroke1 = createMockStroke('1', 'line', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
      const stroke2 = createMockStroke('2', 'line', [{ x: 100, y: 100 }, { x: 110, y: 100 }]);
      const result = pick({ x: 5, y: 5 }, [stroke1, stroke2]);
      expect(result?.id).toBe('1');
    });

    it('returns v2 line stroke by checking every segment', () => {
      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'multi-segment-line',
        tool: 'line',
        points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
      };

      const result = pick({ x: 22, y: 10 }, [stroke], 3);

      expect(result?.id).toBe('multi-segment-line');
    });

    it('returns closest stroke for rect tool', () => {
      const stroke1 = createMockStroke('1', 'rect', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
      const stroke2 = createMockStroke('2', 'rect', [{ x: 100, y: 100 }, { x: 110, y: 110 }]);
      const result = pick({ x: 5, y: 5 }, [stroke1, stroke2]);
      expect(result?.id).toBe('1');
    });

    it('returns stroke inside rect for rect tool', () => {
      const stroke = createMockStroke('1', 'rect', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
      const result = pick({ x: 5, y: 5 }, [stroke]);
      expect(result?.id).toBe('1');
    });

    it('picks fill-only rect by interior point even with a small eraser radius', () => {
      const stroke: DrawingStroke = {
        id: 'fill-only-rect',
        tool: 'rect',
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        strokeWidth: 0,
        fillColor: '#ff0000',
      };

      const result = pick({ x: 5, y: 5 }, [stroke], 1);

      expect(result?.id).toBe('fill-only-rect');
    });

    it('picks v2 fill-only polygon by interior point', () => {
      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'fill-only-polygon',
        tool: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
        strokeWidth: 0,
        fillColor: '#ff0000',
      };

      const result = pick({ x: 5, y: 5 }, [stroke], 1);

      expect(result?.id).toBe('fill-only-polygon');
    });

    it('picks v2 bezier curve via 24-segment polyline sampling', () => {
      // Symmetric S-curve: start (0,0), cp1 (50,0), cp2 (50,100), end (100,100).
      // Midpoint B(0.5) = (50, 50). A click at (50, 50) must hit even with a small eraser radius.
      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'bezier-stroke',
        tool: 'bezier',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 100 },
          { x: 100, y: 100 },
        ],
      };

      const result = pick({ x: 50, y: 50 }, [stroke], 2);

      expect(result?.id).toBe('bezier-stroke');
    });

    it('bezier hit-test rejects points far outside the curve', () => {
      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'bezier-stroke',
        tool: 'bezier',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 100 },
          { x: 100, y: 100 },
        ],
      };

      const result = pick({ x: 500, y: 500 }, [stroke], 5);

      expect(result).toBeNull();
    });

    it('handles stroke with empty points', () => {
      const stroke1 = createMockStroke('1', 'pen', []);
      const stroke2 = createMockStroke('2', 'pen', [{ x: 100, y: 100 }]);
      const result = pick({ x: 0, y: 0 }, [stroke1, stroke2]);
      expect(result?.id).toBe('2');
    });

    it('picks closest when multiple strokes at same distance', () => {
      const stroke1 = createMockStroke('1', 'pen', [{ x: 0, y: 10 }]);
      const stroke2 = createMockStroke('2', 'pen', [{ x: 10, y: 0 }]);
      const result = pick({ x: 0, y: 0 }, [stroke1, stroke2]);
      expect(result?.id).toBe('1');
    });
  });
});
