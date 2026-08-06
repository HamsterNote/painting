import type { DrawingPoint, DrawingStroke, DrawingValue } from '../components/DrawingSurface';
import type { DrawingStrokeV2 } from '../model/strokes';
import {
  addStroke,
  clearStrokes,
  pick,
  pickImageStrokeAtPoint,
  pickRenderedStrokeIntersectingPolyline,
  pickRenderedStrokeIntersectingSegment,
  pickStrokeIntersectingPolyline,
  pickStrokeIntersectingSegment,
  removeStroke,
  removeStrokes,
  resolveSnapPoint,
  selectStrokesIntersectingLasso,
  updateStroke,
  updateStrokes,
} from '../utils';

describe('utils', () => {
  const createMockStroke = (id: string, tool: DrawingStroke['tool'] = 'pen', points: DrawingPoint[] = []): DrawingStroke => ({
    id,
    tool,
    points,
  });

  const createMockValue = (strokes: DrawingStroke[] = []): DrawingValue => ({
    strokes,
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

    it('does not mutate the original value', () => {
      const value: DrawingValue = { strokes: [] };
      const stroke = createMockStroke('1');
      addStroke(value, stroke);
      expect(value.strokes).toEqual([]);
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

    it('does not mutate the original value', () => {
      const stroke = createMockStroke('1');
      const value: DrawingValue = { strokes: [stroke] };
      clearStrokes(value);
      expect(value.strokes).toEqual([stroke]);
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

  describe('pickRenderedStrokeIntersectingSegment', () => {
    const renderedOptions = {
      eraserRadius: 2,
      openFallbackWidth: 1,
      closedFallbackWidth: 1,
      pressureMultiplier: 2,
    };

    const expectSegmentBoundary = (stroke: DrawingStrokeV2, y: number, expectedId: string | null) => {
      const result = pickRenderedStrokeIntersectingSegment(
        { x: 0, y },
        { x: 30, y },
        [stroke],
        renderedOptions,
      );

      expect(result?.id ?? null).toBe(expectedId);
    };

    const expectPointSweep = (stroke: DrawingStrokeV2, point: DrawingPoint, expectedId: string | null) => {
      const result = pickRenderedStrokeIntersectingSegment(point, point, [stroke], renderedOptions);

      expect(result?.id ?? null).toBe(expectedId);
    };

    it('uses rendered pen width at exact, inside, outside, and required example distances', () => {
      expect.hasAssertions();

      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'wide-pen',
        tool: 'pen',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        strokeWidth: 10,
      };

      expectSegmentBoundary(stroke, 7, 'wide-pen');
      expectSegmentBoundary(stroke, 6.99, 'wide-pen');
      expectSegmentBoundary(stroke, 7.01, null);
      expectSegmentBoundary(stroke, 6, 'wide-pen');
      expectSegmentBoundary(stroke, 8, null);
    });

    it('uses pressure-adjusted pen segment width at exact, inside, and outside distances', () => {
      expect.hasAssertions();

      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'pressure-pen',
        tool: 'pen',
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 30, y: 0, pressure: 0.5 },
        ],
        strokeWidth: 10,
      };

      expectSegmentBoundary(stroke, 7, 'pressure-pen');
      expectSegmentBoundary(stroke, 6.99, 'pressure-pen');
      expectSegmentBoundary(stroke, 7.01, null);
      expectSegmentBoundary(stroke, 6, 'pressure-pen');
      expectSegmentBoundary(stroke, 8, null);
    });

    it('uses rendered line width at exact, inside, and outside distances', () => {
      expect.hasAssertions();

      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'wide-line',
        tool: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        strokeWidth: 10,
      };

      expectSegmentBoundary(stroke, 7, 'wide-line');
      expectSegmentBoundary(stroke, 6.99, 'wide-line');
      expectSegmentBoundary(stroke, 7.01, null);
    });

    it('uses rendered rect outline width and keeps filled interior hittable', () => {
      expect.hasAssertions();

      const outlineRect: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'outline-rect',
        tool: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
        strokeWidth: 10,
      };
      const fillRect: DrawingStrokeV2 = {
        ...outlineRect,
        id: 'fill-rect-rendered',
        strokeWidth: 0,
        fillColor: '#ff0000',
      };

      expectSegmentBoundary(outlineRect, -7, 'outline-rect');
      expectSegmentBoundary(outlineRect, -6.99, 'outline-rect');
      expectSegmentBoundary(outlineRect, -7.01, null);
      expectPointSweep(outlineRect, { x: 10, y: 10 }, null);
      expectPointSweep(fillRect, { x: 10, y: 10 }, 'fill-rect-rendered');
    });

    it('uses rendered ellipse outline width and keeps filled interior hittable', () => {
      expect.hasAssertions();

      const outlineEllipse: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'outline-ellipse',
        tool: 'ellipse',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
        strokeWidth: 10,
      };
      const fillEllipse: DrawingStrokeV2 = {
        ...outlineEllipse,
        id: 'fill-ellipse-rendered',
        strokeWidth: 0,
        fillColor: '#00ff00',
      };

      expectSegmentBoundary(outlineEllipse, -7, 'outline-ellipse');
      expectSegmentBoundary(outlineEllipse, -6.99, 'outline-ellipse');
      expectSegmentBoundary(outlineEllipse, -7.01, null);
      expectPointSweep(outlineEllipse, { x: 10, y: 10 }, null);
      expectPointSweep(fillEllipse, { x: 10, y: 10 }, 'fill-ellipse-rendered');
    });

    it('uses rendered polygon outline width and keeps filled interior hittable', () => {
      expect.hasAssertions();

      const outlinePolygon: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'outline-polygon',
        tool: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        strokeWidth: 10,
      };
      const fillPolygon: DrawingStrokeV2 = {
        ...outlinePolygon,
        id: 'fill-polygon-rendered',
        strokeWidth: 0,
        fillColor: '#0000ff',
      };

      expectSegmentBoundary(outlinePolygon, -7, 'outline-polygon');
      expectSegmentBoundary(outlinePolygon, -6.99, 'outline-polygon');
      expectSegmentBoundary(outlinePolygon, -7.01, null);
      expectPointSweep(outlinePolygon, { x: 10, y: 10 }, null);
      expectPointSweep(fillPolygon, { x: 10, y: 10 }, 'fill-polygon-rendered');
    });

    it('uses rendered bezier width with existing 24-segment sampling', () => {
      expect.hasAssertions();

      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'wide-bezier',
        tool: 'bezier',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 },
        ],
        strokeWidth: 10,
      };

      expectSegmentBoundary(stroke, 7, 'wide-bezier');
      expectSegmentBoundary(stroke, 6.99, 'wide-bezier');
      expectSegmentBoundary(stroke, 7.01, null);
    });
  });

  describe('pickRenderedStrokeIntersectingPolyline', () => {
    it('sweeps every eraser polyline segment with rendered stroke width thresholds', () => {
      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: 'polyline-target',
        tool: 'line',
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
        strokeWidth: 10,
      };
      const options = {
        eraserRadius: 2,
        openFallbackWidth: 1,
        closedFallbackWidth: 1,
        pressureMultiplier: 2,
      };

      const exactResult = pickRenderedStrokeIntersectingPolyline(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 13 },
        ],
        [stroke],
        options,
      );
      const insideResult = pickRenderedStrokeIntersectingPolyline(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 13.01 },
        ],
        [stroke],
        options,
      );
      const outsideResult = pickRenderedStrokeIntersectingPolyline(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 12.99 },
        ],
        [stroke],
        options,
      );

      expect(exactResult?.id).toBe('polyline-target');
      expect(insideResult?.id).toBe('polyline-target');
      expect(outsideResult).toBeNull();
    });
  });

/* eslint-disable jest/expect-expect */
  describe('resolveSnapPoint', () => {
    const snapOptions = { enabled: true, endpoints: true, lines: true, radius: 5 };

    const expectSnap = (
      point: DrawingPoint,
      strokes: readonly DrawingStroke[],
      expected: { canvas: DrawingPoint; kind: 'endpoint' | 'line'; strokeId?: string } | null,
      options = snapOptions,
      viewportScale?: number,
    ) => {
      const result = resolveSnapPoint(point, strokes, options, viewportScale);

      expect(result).toEqual(expected);
    };

    it('Given disabled snap options When resolving near a target Then returns null', () => {
      const stroke = createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);

      expectSnap({ x: 1, y: 0 }, [stroke], null, { enabled: false, endpoints: true, lines: true, radius: 5 });
    });

    it('Given no radius When resolving near an endpoint Then uses the default canvas radius', () => {
      const stroke = createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);

      expectSnap({ x: 7.5, y: 0 }, [stroke], { canvas: { x: 0, y: 0 }, kind: 'endpoint', strokeId: 'pen' }, { enabled: true, endpoints: true, lines: false });
    });

    it('Given invalid radius When resolving near an endpoint Then falls back to radius eight', () => {
      const stroke = createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);

      expectSnap({ x: 7.5, y: 0 }, [stroke], { canvas: { x: 0, y: 0 }, kind: 'endpoint', strokeId: 'pen' }, { enabled: true, endpoints: true, lines: false, radius: Number.NaN });
    });

    it('Given zero radius When resolving near an endpoint Then falls back to radius eight', () => {
      const stroke = createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);

      expectSnap({ x: 7.5, y: 0 }, [stroke], { canvas: { x: 0, y: 0 }, kind: 'endpoint', strokeId: 'pen' }, { enabled: true, endpoints: true, lines: false, radius: 0 });
    });

    it('Given negative radius When resolving near an endpoint Then falls back to radius eight', () => {
      const stroke = createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);

      expectSnap({ x: 7.5, y: 0 }, [stroke], { canvas: { x: 0, y: 0 }, kind: 'endpoint', strokeId: 'pen' }, { enabled: true, endpoints: true, lines: false, radius: -1 });
    });

    it('Given viewport scale When resolving Then converts CSS radius to canvas units', () => {
      const stroke = createMockStroke('line', 'line', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);

      expectSnap({ x: 10, y: 2.5 }, [stroke], { canvas: { x: 10, y: 0 }, kind: 'line', strokeId: 'line' }, { enabled: true, endpoints: false, lines: true, radius: 5 }, 2);
      expectSnap({ x: 10, y: 2.51 }, [stroke], null, { enabled: true, endpoints: false, lines: true, radius: 5 }, 2);
    });

    it('Given boundary distances When resolving Then includes equal radius and excludes greater radius', () => {
      const stroke = createMockStroke('line', 'line', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);

      expectSnap({ x: 10, y: 4.99 }, [stroke], { canvas: { x: 10, y: 0 }, kind: 'line', strokeId: 'line' });
      expectSnap({ x: 10, y: 5 }, [stroke], { canvas: { x: 10, y: 0 }, kind: 'line', strokeId: 'line' });
      expectSnap({ x: 10, y: 5.01 }, [stroke], null);
    });

    it('Given committed strokes for every tool When resolving endpoints Then extracts only required endpoint targets', () => {
      const strokes = [
        createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]),
        createMockStroke('line', 'line', [{ x: 20, y: 0 }, { x: 30, y: 0 }]),
        createMockStroke('rect', 'rect', [{ x: 40, y: 0 }, { x: 50, y: 10 }]),
        createMockStroke('ellipse', 'ellipse', [{ x: 60, y: 0 }, { x: 80, y: 20 }]),
        createMockStroke('polygon', 'polygon', [{ x: 90, y: 0 }, { x: 100, y: 0 }, { x: 95, y: 10 }]),
        createMockStroke('bezier', 'bezier', [{ x: 110, y: 0 }, { x: 120, y: 50 }, { x: 130, y: 50 }, { x: 140, y: 0 }]),
      ];

      expectSnap({ x: 10, y: 0 }, strokes, { canvas: { x: 10, y: 0 }, kind: 'endpoint', strokeId: 'pen' }, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 30, y: 0 }, strokes, { canvas: { x: 30, y: 0 }, kind: 'endpoint', strokeId: 'line' }, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 50, y: 10 }, strokes, { canvas: { x: 50, y: 10 }, kind: 'endpoint', strokeId: 'rect' }, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 70, y: 10 }, strokes, { canvas: { x: 70, y: 10 }, kind: 'endpoint', strokeId: 'ellipse' }, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 95, y: 10 }, strokes, { canvas: { x: 95, y: 10 }, kind: 'endpoint', strokeId: 'polygon' }, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 140, y: 0 }, strokes, { canvas: { x: 140, y: 0 }, kind: 'endpoint', strokeId: 'bezier' }, { enabled: true, endpoints: true, lines: false, radius: 1 });
    });

    it('Given non-endpoint samples When resolving endpoints Then rejects pen middle ellipse bbox corner and bezier controls', () => {
      const strokes = [
        createMockStroke('pen', 'pen', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]),
        createMockStroke('ellipse', 'ellipse', [{ x: 20, y: 0 }, { x: 40, y: 20 }]),
        createMockStroke('bezier', 'bezier', [{ x: 50, y: 0 }, { x: 60, y: 30 }, { x: 70, y: 30 }, { x: 80, y: 0 }]),
      ];

      expectSnap({ x: 5, y: 0 }, strokes, null, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 20, y: 0 }, strokes, null, { enabled: true, endpoints: true, lines: false, radius: 1 });
      expectSnap({ x: 60, y: 30 }, strokes, null, { enabled: true, endpoints: true, lines: false, radius: 1 });
    });

    it('Given committed strokes for every tool When resolving line targets Then projects to required geometry', () => {
      const cases: Array<{ stroke: DrawingStroke; point: DrawingPoint; expected: DrawingPoint }> = [
        { stroke: createMockStroke('pen-line', 'pen', [{ x: 0, y: 0 }, { x: 10, y: 0 }]), point: { x: 5, y: 2 }, expected: { x: 5, y: 0 } },
        { stroke: createMockStroke('line-line', 'line', [{ x: 20, y: 0 }, { x: 30, y: 0 }]), point: { x: 25, y: 2 }, expected: { x: 25, y: 0 } },
        { stroke: createMockStroke('rect-line', 'rect', [{ x: 40, y: 0 }, { x: 50, y: 10 }]), point: { x: 45, y: -2 }, expected: { x: 45, y: 0 } },
        { stroke: createMockStroke('ellipse-line', 'ellipse', [{ x: 60, y: 0 }, { x: 80, y: 20 }]), point: { x: 80, y: 10 }, expected: { x: 80, y: 10 } },
        { stroke: createMockStroke('polygon-line', 'polygon', [{ x: 90, y: 0 }, { x: 100, y: 0 }, { x: 95, y: 10 }]), point: { x: 95, y: -2 }, expected: { x: 95, y: 0 } },
        { stroke: createMockStroke('bezier-line', 'bezier', [{ x: 110, y: 0 }, { x: 120, y: 0 }, { x: 130, y: 0 }, { x: 140, y: 0 }]), point: { x: 125, y: 2 }, expected: { x: 125, y: 0 } },
      ];

      for (const { stroke, point, expected } of cases) {
        expectSnap(point, [stroke], { canvas: expected, kind: 'line', strokeId: stroke.id }, { enabled: true, endpoints: false, lines: true, radius: 5 });
      }
    });

    it('Given endpoint and line candidates When line projection is closer Then endpoint bucket still wins', () => {
      const endpointStroke = createMockStroke('endpoint', 'pen', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);
      const lineStroke = createMockStroke('line', 'line', [{ x: -10, y: 3 }, { x: 20, y: 3 }]);

      expectSnap({ x: 1, y: 2.9 }, [endpointStroke, lineStroke], { canvas: { x: 0, y: 0 }, kind: 'endpoint', strokeId: 'endpoint' }, { enabled: true, endpoints: true, lines: true, radius: 5 });
    });

    it('Given equal-distance candidates When resolving Then preserves stroke order and target extraction order', () => {
      const strokeA = createMockStroke('a', 'line', [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
      const strokeB = createMockStroke('b', 'line', [{ x: 0, y: 10 }, { x: 10, y: 10 }]);
      const rect = createMockStroke('rect', 'rect', [{ x: 20, y: 0 }, { x: 30, y: 10 }]);

      expectSnap({ x: 5, y: 5 }, [strokeA, strokeB], { canvas: { x: 5, y: 0 }, kind: 'line', strokeId: 'a' }, { enabled: true, endpoints: false, lines: true, radius: 5 });
      expectSnap({ x: 25, y: 5 }, [rect], { canvas: { x: 25, y: 0 }, kind: 'line', strokeId: 'rect' }, { enabled: true, endpoints: false, lines: true, radius: 5 });
    });
  });

  describe('selectStrokesIntersectingLasso', () => {
    it('selects a horizontal pen when a vertical lasso covers its middle', () => {
      const stroke = createMockStroke('pen-cross', 'pen', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);
      const lasso = [
        { x: 45, y: -10 },
        { x: 55, y: -10 },
        { x: 55, y: 10 },
        { x: 45, y: 10 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['pen-cross']);
    });

    it('does not select a pen completely outside the lasso', () => {
      const stroke = createMockStroke('pen-outside', 'pen', [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ]);
      const lasso = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual([]);
    });

    it('selects a wide pen whose segment is within half stroke width of a lasso edge', () => {
      const stroke: DrawingStroke = {
        ...createMockStroke('wide-pen', 'pen', [
          { x: 0, y: 14 },
          { x: 10, y: 14 },
        ]),
        strokeWidth: 10,
      };
      const lasso = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['wide-pen']);
    });

    it('selects a line crossing the lasso', () => {
      const stroke = createMockStroke('line-cross', 'line', [
        { x: -10, y: 5 },
        { x: 30, y: 5 },
      ]);
      const lasso = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['line-cross']);
    });

    it('selects a rect partially inside the lasso', () => {
      const stroke = createMockStroke('rect-partial', 'rect', [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ]);
      const lasso = [
        { x: 15, y: 15 },
        { x: 25, y: 15 },
        { x: 25, y: 25 },
        { x: 15, y: 25 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['rect-partial']);
    });

    it('selects a filled rect when the lasso is completely inside it', () => {
      const stroke: DrawingStroke = {
        ...createMockStroke('rect-filled', 'rect', [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]),
        fillColor: '#ff0000',
      };
      const lasso = [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['rect-filled']);
    });

    it('Given an image When the lasso is completely inside it Then selects the image', () => {
      const stroke: DrawingStroke = {
        ...createMockStroke('image-filled', 'image', [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]),
        src: 'data:image/png;base64,example',
      };
      const lasso = [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['image-filled']);
    });

    it('selects an ellipse whose edge intersects the lasso', () => {
      const stroke = createMockStroke('ellipse-edge', 'ellipse', [
        { x: 50, y: 50 },
        { x: 70, y: 60 },
      ]);
      const lasso = [
        { x: 68, y: 45 },
        { x: 72, y: 45 },
        { x: 72, y: 55 },
        { x: 68, y: 55 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['ellipse-edge']);
    });

    it('uses first and last ellipse points as bounding-box corners for lasso selection', () => {
      const stroke = createMockStroke('ellipse-bbox-edge', 'ellipse', [
        { x: 0, y: 10 },
        { x: 20, y: 30 },
      ]);
      const lasso = [
        { x: 18, y: 18 },
        { x: 22, y: 18 },
        { x: 22, y: 22 },
        { x: 18, y: 22 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['ellipse-bbox-edge']);
    });

    it('does not use the first ellipse point as a center for lasso selection', () => {
      const stroke = createMockStroke('ellipse-wrong-center-region', 'ellipse', [
        { x: 0, y: 10 },
        { x: 20, y: 30 },
      ]);
      const lasso = [
        { x: -18, y: 8 },
        { x: -12, y: 8 },
        { x: -12, y: 12 },
        { x: -18, y: 12 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual([]);
    });

    it('selects a filled ellipse when a lasso vertex is inside it', () => {
      const stroke: DrawingStroke = {
        ...createMockStroke('ellipse-filled', 'ellipse', [
          { x: 50, y: 50 },
          { x: 80, y: 70 },
        ]),
        fillColor: '#00ff00',
      };
      const lasso = [
        { x: 45, y: 45 },
        { x: 55, y: 45 },
        { x: 55, y: 55 },
        { x: 45, y: 55 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['ellipse-filled']);
    });

    it('does not select an unfilled closed shape when the lasso is only inside its empty interior', () => {
      const stroke = createMockStroke('rect-outline-only', 'rect', [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]);
      const lasso = [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual([]);
    });

    it('selects a thick closed outline when the lasso overlaps only the rendered stroke width', () => {
      const stroke: DrawingStroke = {
        ...createMockStroke('wide-rect-outline', 'rect', [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ]),
        strokeWidth: 20,
      };
      const lasso = [
        { x: 5, y: -9 },
        { x: 15, y: -9 },
        { x: 15, y: -7 },
        { x: 5, y: -7 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['wide-rect-outline']);
    });

    it('selects a polygon with one corner inside the lasso', () => {
      const stroke = createMockStroke('polygon-corner', 'polygon', [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 25, y: 40 },
      ]);
      const lasso = [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['polygon-corner']);
    });

    it('selects a bezier curve crossing the lasso', () => {
      const stroke = createMockStroke('bezier-cross', 'bezier', [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 100 },
      ]);
      const lasso = [
        { x: 49, y: 45 },
        { x: 51, y: 45 },
        { x: 51, y: 55 },
        { x: 49, y: 55 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual(['bezier-cross']);
    });

    it('returns an empty array for an invalid lasso with fewer than three distinct points', () => {
      const stroke = createMockStroke('pen', 'pen', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]);
      const lasso = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ];

      const result = selectStrokesIntersectingLasso([stroke], lasso);

      expect(result).toEqual([]);
    });

    it('returns an empty array for empty strokes', () => {
      const lasso = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ];

      const result = selectStrokesIntersectingLasso([], lasso);

      expect(result).toEqual([]);
    });

    it('returns only matching ids for mixed strokes', () => {
      const hitPen = createMockStroke('hit-pen', 'pen', [
        { x: -10, y: 10 },
        { x: 30, y: 10 },
      ]);
      const missPen = createMockStroke('miss-pen', 'pen', [
        { x: 100, y: 100 },
        { x: 120, y: 100 },
      ]);
      const hitRect = createMockStroke('hit-rect', 'rect', [
        { x: 5, y: 5 },
        { x: 15, y: 15 },
      ]);
      const lasso = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ];

      const result = selectStrokesIntersectingLasso([hitPen, missPen, hitRect], lasso);

      expect(result).toEqual(['hit-pen', 'hit-rect']);
    });
  });

  describe('pickImageStrokeAtPoint', () => {
    it('Given a rotated image When clicking its rendered content Then selects the image', () => {
      const stroke: DrawingStroke = {
        id: 'rotated-image',
        tool: 'image',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        rotationRad: Math.PI / 2,
        src: 'data:image/png;base64,example',
      };

      const result = pickImageStrokeAtPoint({ x: 50, y: 60 }, [stroke]);

      expect(result?.id).toBe('rotated-image');
    });
  });

  describe('removeStrokes', () => {
    it('removes multiple stroke ids', () => {
      const stroke1 = createMockStroke('1');
      const stroke2 = createMockStroke('2');
      const stroke3 = createMockStroke('3');
      const value = createMockValue([stroke1, stroke2, stroke3]);

      const result = removeStrokes(value, ['1', '3']);

      expect(result.strokes).toEqual([stroke2]);
    });

    it('ignores missing stroke ids', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);

      const result = removeStrokes(value, ['missing']);

      expect(result.strokes).toEqual([stroke]);
    });

    it('keeps an equivalent value for an empty id array', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);

      const result = removeStrokes(value, []);

      expect(result).toEqual(value);
      expect(result).not.toBe(value);
    });
  });

  describe('updateStrokes', () => {
    it('updates multiple strokes by id', () => {
      const stroke1 = createMockStroke('1', 'pen', [{ x: 0, y: 0 }]);
      const stroke2 = createMockStroke('2', 'pen', [{ x: 10, y: 10 }]);
      const value = createMockValue([stroke1, stroke2]);
      const updated1 = createMockStroke('1', 'pen', [{ x: 1, y: 1 }]);
      const updated2 = createMockStroke('2', 'pen', [{ x: 20, y: 20 }]);

      const result = updateStrokes(value, [updated1, updated2]);

      expect(result.strokes).toEqual([updated1, updated2]);
    });

    it('ignores updates for missing stroke ids', () => {
      const stroke = createMockStroke('1', 'pen', [{ x: 0, y: 0 }]);
      const value = createMockValue([stroke]);
      const missing = createMockStroke('missing', 'pen', [{ x: 10, y: 10 }]);

      const result = updateStrokes(value, [missing]);

      expect(result.strokes).toEqual([stroke]);
    });

    it('keeps an equivalent value for an empty updates array', () => {
      const stroke = createMockStroke('1');
      const value = createMockValue([stroke]);

      const result = updateStrokes(value, []);

      expect(result).toEqual(value);
      expect(result).not.toBe(value);
    });
  });
  /* eslint-enable jest/expect-expect */
});
