import type { DrawingPoint, DrawingStroke, DrawingValue } from '../components/DrawingSurface';
import type { DrawingStrokeV2 } from '../model/strokes';
import { addStroke, clearStrokes, pick, pickStrokeIntersectingPolyline, pickStrokeIntersectingSegment, removeStroke, updateStroke } from '../utils';

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

  // ========== pickStrokeIntersectingSegment 测试 ==========

  describe('pickStrokeIntersectingSegment', () => {
    // 线段穿过笔画路径但端点不在半径范围内时仍应命中
    // 验证采样策略能在端点不靠近笔画的情况下检测到交叉
    it('命中：线段穿过笔画路径，但两个端点都不在半径范围内', () => {
      const penStroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'vertical-pen',
        tool: 'pen',
        points: [
          { x: 10, y: 0 },
          { x: 10, y: 20 },
        ],
        strokeColor: '#000000',
      };

      // 水平线段从 (0,10) 到 (20,10)，在 (10,10) 处穿过竖直笔画
      const result = pickStrokeIntersectingSegment(
        { x: 0, y: 10 },
        { x: 20, y: 10 },
        [penStroke],
        3,
      );

      expect(result?.id).toBe('vertical-pen');
    });

    // 宽半径命中、窄半径未命中：同一几何形状，不同半径
    // 验证半径阈值确实影响命中/未命中的判定
    it('宽半径命中而窄半径未命中：相同几何形状不同半径', () => {
      const lineStroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'h-line',
        tool: 'line',
        points: [
          { x: 0, y: 10 },
          { x: 20, y: 10 },
        ],
        strokeColor: '#000000',
      };

      // 线段与笔画平行，最近距离为 5
      const start = { x: 0, y: 5 };
      const end = { x: 20, y: 5 };

      // 半径 3 < 5：未命中
      const narrowResult = pickStrokeIntersectingSegment(start, end, [lineStroke], 3);
      expect(narrowResult).toBeNull();

      // 半径 6 > 5：命中
      const wideResult = pickStrokeIntersectingSegment(start, end, [lineStroke], 6);
      expect(wideResult?.id).toBe('h-line');
    });

    // 仅填充的矩形（无描边颜色）：穿过内部的线段应命中
    // 验证填充短路逻辑在 sweep 辅助函数中正确复用
    it('命中：线段穿过仅填充矩形的内部', () => {
      const fillRect: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'fill-rect',
        tool: 'rect',
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 30 },
        ],
        strokeWidth: 0,
        fillColor: '#ff0000',
      };

      // 竖直线段穿过矩形内部
      const result = pickStrokeIntersectingSegment(
        { x: 20, y: 0 },
        { x: 20, y: 40 },
        [fillRect],
        1,
      );

      expect(result?.id).toBe('fill-rect');
    });

    // 仅填充的椭圆：穿过内部的线段应命中
    it('命中：线段穿过仅填充椭圆的内部', () => {
      const fillEllipse: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'fill-ellipse',
        tool: 'ellipse',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
        strokeWidth: 0,
        fillColor: '#00ff00',
      };

      // 竖直线段穿过椭圆中心
      const result = pickStrokeIntersectingSegment(
        { x: 10, y: -5 },
        { x: 10, y: 25 },
        [fillEllipse],
        1,
      );

      expect(result?.id).toBe('fill-ellipse');
    });

    // 仅填充的多边形：穿过内部的线段应命中
    it('命中：线段穿过仅填充多边形的内部', () => {
      const fillPolygon: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'fill-polygon',
        tool: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        strokeWidth: 0,
        fillColor: '#0000ff',
      };

      // 竖直线段穿过正方形多边形内部
      const result = pickStrokeIntersectingSegment(
        { x: 10, y: -5 },
        { x: 10, y: 25 },
        [fillPolygon],
        1,
      );

      expect(result?.id).toBe('fill-polygon');
    });

    // 贝塞尔曲线：线段经过曲线弧长中段应命中
    // 使用对称 S 形曲线，中点 B(0.5) = (50, 50)
    it('命中：线段经过贝塞尔曲线弧长中段', () => {
      const bezierStroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'bezier-stroke',
        tool: 'bezier',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 100 },
          { x: 100, y: 100 },
        ],
        strokeColor: '#000000',
      };

      // 水平线段经过曲线中点 (50, 50)
      const result = pickStrokeIntersectingSegment(
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        [bezierStroke],
        5,
      );

      expect(result?.id).toBe('bezier-stroke');
    });

    // 空笔画数组应返回 null
    it('返回 null：空笔画数组', () => {
      const result = pickStrokeIntersectingSegment(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        [],
        5,
      );

      expect(result).toBeNull();
    });

    // 半径为 0 时仅精确路径上的采样点才能命中
    it('半径为 0：仅精确命中路径时返回笔画', () => {
      const penStroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'pen-at-origin',
        tool: 'pen',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 20 },
        ],
        strokeColor: '#000000',
      };

      // 线段端点 (0,5) 恰好在笔画上，半径为 0 应命中
      const hitResult = pickStrokeIntersectingSegment(
        { x: 0, y: 5 },
        { x: 20, y: 5 },
        [penStroke],
        0,
      );
      expect(hitResult?.id).toBe('pen-at-origin');

      // 线段偏移 0.1，半径为 0 应未命中
      const missResult = pickStrokeIntersectingSegment(
        { x: 0.1, y: 5 },
        { x: 20.1, y: 5 },
        [penStroke],
        0,
      );
      expect(missResult).toBeNull();
    });

    // 确定性平局：同一采样点到两个笔画距离相同时，索引靠前的笔画胜出
    // 验证 stroke index tie-break 与 pick() 的“更早笔画胜出”契约一致
    it('确定性平局：两个笔画距离相同时，索引靠前的胜出', () => {
      const strokeA: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'stroke-A',
        tool: 'pen',
        points: [{ x: 5, y: 15 }],
        strokeColor: '#000000',
      };
      const strokeB: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'stroke-B',
        tool: 'pen',
        points: [{ x: 15, y: 15 }],
        strokeColor: '#000000',
      };

      // 线段从 (0,0) 到 (20,0)，采样点 (5,0) 和 (15,0) 分别距离两个笔画为 15
      const result = pickStrokeIntersectingSegment(
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        [strokeA, strokeB],
        16,
      );

      expect(result?.id).toBe('stroke-A');
    });

    // 后序笔画 B 更早被采样命中，但前序笔画 A 在稍后的采样点有完全相同距离；应按 stroke index 决定。
    it('确定性平局：后序笔画先被采样时仍返回索引靠前的笔画', () => {
      const strokeA: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'stroke-A',
        tool: 'pen',
        points: [{ x: 12, y: 3 }],
        strokeColor: '#000000',
      };
      const strokeB: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'stroke-B',
        tool: 'pen',
        points: [{ x: 4, y: 3 }],
        strokeColor: '#000000',
      };

      // radius=8 -> pickStep=2，样本点包含 x=4 和 x=12；两笔画最近距离都精确为 3。
      const result = pickStrokeIntersectingSegment(
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        [strokeA, strokeB],
        8,
      );

      expect(result?.id).toBe('stroke-A');
    });
  });

  // ========== pickStrokeIntersectingPolyline 测试 ==========

  describe('pickStrokeIntersectingPolyline', () => {
    // 空折线应返回 null
    it('返回 null：空折线', () => {
      const penStroke = createMockStroke('1', 'pen', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);

      const result = pickStrokeIntersectingPolyline([], [penStroke], 5);

      expect(result).toBeNull();
    });

    // 单点折线应委托给 pick 函数并尊重半径
    // 验证单点输入与 pick 在相同输入下返回相同结果
    it('单点折线委托给 pick：结果与 pick 函数一致', () => {
      const stroke = createMockStroke('1', 'pen', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);

      const point = { x: 5, y: 5 };
      const radius = 20;

      const polyResult = pickStrokeIntersectingPolyline([point], [stroke], radius);
      const pickResult = pick(point, [stroke], radius);

      // 两者都应返回同一笔画
      expect(polyResult?.id).toBe(pickResult?.id);
      expect(polyResult?.id).toBe('1');
    });

    // 多段折线：第一段未命中、第二段命中 → 返回目标笔画
    // 验证辅助函数在所有连续点对之间共享最佳结果，不会因第一段未命中而提前退出
    it('多段折线：第一段未命中、第二段命中时返回目标笔画', () => {
      const targetStroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'target',
        tool: 'line',
        points: [
          { x: 30, y: 20 },
          { x: 50, y: 20 },
        ],
        strokeColor: '#000000',
      };

      // 第一段从 (0,0) 到 (10,0)：远离目标笔画
      // 第二段从 (10,0) 到 (40,0)：穿过 x=30~40 区域，在 (40,0) 处距离目标为 20
      // 半径 25 > 20，第二段应命中
      const result = pickStrokeIntersectingPolyline(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 40, y: 0 },
        ],
        [targetStroke],
        25,
      );

      expect(result?.id).toBe('target');
    });

    // 跨折线段的同距离平局：第一段先采样到 B，第二段后采样到 A，仍必须选择更早 index 的 A。
    it('确定性平局：跨折线段时后序笔画先被采样仍返回索引靠前的笔画', () => {
      const strokeA: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'stroke-A',
        tool: 'pen',
        points: [{ x: 12, y: 3 }],
        strokeColor: '#000000',
      };
      const strokeB: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'stroke-B',
        tool: 'pen',
        points: [{ x: 4, y: 3 }],
        strokeColor: '#000000',
      };

      // radius=8 -> pickStep=2；第一段包含 x=4，第二段包含 x=12，最近距离都精确为 3。
      const result = pickStrokeIntersectingPolyline(
        [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 20, y: 0 },
        ],
        [strokeA, strokeB],
        8,
      );

      expect(result?.id).toBe('stroke-A');
    });
  });
});
