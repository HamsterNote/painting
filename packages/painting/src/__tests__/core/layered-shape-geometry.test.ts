/** @jest-environment node */

/**
 * Task 5.1 证据：`geometry/shape.ts`（唯一新增本测试文件）。
 *
 * 冻结 6 exports：`ShapeCommand` / `ShapePathTarget` / `DerivedShapeGeometry` /
 * `deriveShapeGeometry` / `shapeCommandsToSvgPath` / `replayShapeCommands`。
 *
 * 只覆盖 local 几何与命令派生；不声称 browser pixel，不做对象 transform。
 */

import {
  deriveShapeGeometry,
  replayShapeCommands,
  shapeCommandsToSvgPath,
  type DerivedShapeGeometry,
  type ShapeCommand,
  type ShapePathTarget,
} from '../../geometry/shape';
import {
  IDENTITY_TRANSFORM,
  type Point,
  type ShapeObject,
  type ShapeStyle,
  type ShapeType,
} from '../../model/document';

function makeStyle(overrides: Partial<ShapeStyle> = {}): ShapeStyle {
  return { color: '#000000', width: 2, opacity: 1, ...overrides };
}

function makeShape(
  shapeType: ShapeType,
  points: readonly Point[],
  style: Partial<ShapeStyle> = {}
): ShapeObject {
  return {
    kind: 'shape',
    objectId: 's1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    shapeType,
    points,
    style: makeStyle(style),
  };
}

function derive(
  shapeType: ShapeType,
  points: readonly Point[],
  style: Partial<ShapeStyle> = {}
): DerivedShapeGeometry | null {
  return deriveShapeGeometry(makeShape(shapeType, points, style));
}

type RecorderCall = readonly [string, ...number[]];
function createRecorder(): { target: ShapePathTarget; calls: RecorderCall[] } {
  const calls: RecorderCall[] = [];
  const target: ShapePathTarget = {
    moveTo: (x, y) => calls.push(['moveTo', x, y]),
    lineTo: (x, y) => calls.push(['lineTo', x, y]),
    bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) =>
      calls.push(['bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y]),
    ellipse: (x, y, rx, ry, rotation, startAngle, endAngle, anticlockwise) =>
      calls.push(['ellipse', x, y, rx, ry, rotation, startAngle, endAngle, anticlockwise ? 1 : 0]),
    closePath: () => calls.push(['closePath']),
  };
  return { target, calls };
}

function types(commands: readonly ShapeCommand[]): string[] {
  return commands.map((command) => command.type);
}

// ---------------------------------------------------------------------------
// A. line / rect
// ---------------------------------------------------------------------------

describe('layeredShapeGeometry: line / rect', () => {
  it('line canonical：2 点 → moveTo + lineTo', () => {
    const geometry = derive('line', [{ x: 1, y: 2 }, { x: 10, y: 20 }]);
    expect(geometry).not.toBeNull();
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 1, y: 2 },
      { type: 'lineTo', x: 10, y: 20 },
    ]);
    expect(geometry!.localBounds).toEqual({ minX: 1, minY: 2, maxX: 10, maxY: 20 });
  });

  it('line 退化点（相同 xy）仍有效', () => {
    const geometry = derive('line', [{ x: 5, y: 5 }, { x: 5, y: 5 }]);
    expect(geometry).not.toBeNull();
    expect(types(geometry!.commands)).toEqual(['moveTo', 'lineTo']);
  });

  it('line 点数不为 2 / 非有限 → null', () => {
    expect(derive('line', [{ x: 0, y: 0 }])).toBeNull();
    expect(derive('line', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(derive('line', [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }])).toBeNull();
  });

  it('rect canonical：moveTo + 3 lineTo + closePath', () => {
    const geometry = derive('rect', [{ x: 0, y: 0 }, { x: 10, y: 20 }]);
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 0 },
      { type: 'lineTo', x: 10, y: 20 },
      { type: 'lineTo', x: 0, y: 20 },
      { type: 'closePath' },
    ]);
  });

  it('rect reverse（second 在 first 左上）仍按角点合法派生', () => {
    const geometry = derive('rect', [{ x: 10, y: 20 }, { x: 0, y: 0 }]);
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 10, y: 20 },
      { type: 'lineTo', x: 0, y: 20 },
      { type: 'lineTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 0 },
      { type: 'closePath' },
    ]);
    expect(geometry!.localBounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
  });

  it('rect 零 area / 点数不为 2 → null 或退化有效', () => {
    const zeroArea = derive('rect', [{ x: 3, y: 3 }, { x: 3, y: 3 }]);
    expect(zeroArea).not.toBeNull();
    expect(types(zeroArea!.commands)).toEqual(['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']);
    expect(derive('rect', [{ x: 0, y: 0 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. polygon
// ---------------------------------------------------------------------------

describe('layeredShapeGeometry: polygon', () => {
  it('非原点 polygon 有效：moveTo + lineTo... + closePath', () => {
    const points = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 20 }];
    const geometry = derive('polygon', points);
    expect(geometry).not.toBeNull();
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 10, y: 10 },
      { type: 'lineTo', x: 20, y: 10 },
      { type: 'lineTo', x: 10, y: 20 },
      { type: 'closePath' },
    ]);
    expect(geometry!.localBounds).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
  });

  it('共线三点 → null（10,10 20,20 30,30）', () => {
    expect(derive('polygon', [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }])).toBeNull();
  });

  it('非共线三点有效（10,10 20,10 10,20）', () => {
    const geometry = derive('polygon', [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 20 }]);
    expect(geometry).not.toBeNull();
    expect(types(geometry!.commands)).toEqual(['moveTo', 'lineTo', 'lineTo', 'closePath']);
  });

  it('差值法共线判定：origin(10,10) dir(10,20) third(10,30) → null', () => {
    expect(derive('polygon', [{ x: 10, y: 10 }, { x: 10, y: 20 }, { x: 10, y: 30 }])).toBeNull();
  });

  it('差值法非共线：origin(10,10) dir(10,20) third(20,30) → 有效', () => {
    const geometry = derive('polygon', [{ x: 10, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 30 }]);
    expect(geometry).not.toBeNull();
    expect(types(geometry!.commands)).toEqual(['moveTo', 'lineTo', 'lineTo', 'closePath']);
  });

  it('巨坐标 cross 溢出 → reject（null）', () => {
    expect(
      derive('polygon', [{ x: 0, y: 0 }, { x: 1e308, y: 0 }, { x: 0, y: 1e154 }])
    ).toBeNull();
  });

  it('首两点重复 / 中间重复允许', () => {
    const duplicateFirst = derive('polygon', [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect(duplicateFirst).not.toBeNull();
    expect(types(duplicateFirst!.commands)).toEqual(['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']);

    const duplicateMiddle = derive('polygon', [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect(duplicateMiddle).not.toBeNull();
  });

  it('重复末点（first === last）拒绝', () => {
    expect(
      derive('polygon', [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 10, y: 20 },
        { x: 10, y: 10 },
      ])
    ).toBeNull();
  });

  it('少于 3 点 → null', () => {
    expect(derive('polygon', [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C. ellipse（含退化）
// ---------------------------------------------------------------------------

describe('layeredShapeGeometry: ellipse', () => {
  it('canonical：moveTo(cx+rx,cy) + ellipse + closePath，bounds cx±rx/cy±ry', () => {
    const geometry = derive('ellipse', [{ x: 0, y: 0 }, { x: 20, y: 10 }]);
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 20, y: 5 },
      { type: 'ellipse', cx: 10, cy: 5, rx: 10, ry: 5 },
      { type: 'closePath' },
    ]);
    expect(geometry!.localBounds).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
  });

  it('rx === 0 → 竖线退化 (cx, cy+ry)/(cx, cy-ry)', () => {
    const geometry = derive('ellipse', [{ x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 10, y: 10 },
      { type: 'lineTo', x: 10, y: 0 },
      { type: 'closePath' },
    ]);
  });

  it('ry === 0 → 横线退化', () => {
    const geometry = derive('ellipse', [{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    expect(types(geometry!.commands)).toEqual(['moveTo', 'lineTo', 'closePath']);
    expect(geometry!.commands[0]).toEqual({ type: 'moveTo', x: 20, y: 0 });
    expect(geometry!.commands[1]).toEqual({ type: 'lineTo', x: 0, y: 0 });
  });

  it('rx === 0 且 ry === 0 → 点退化', () => {
    const geometry = derive('ellipse', [{ x: 5, y: 5 }, { x: 5, y: 5 }]);
    expect(geometry!.commands).toEqual([
      { type: 'moveTo', x: 5, y: 5 },
      { type: 'lineTo', x: 5, y: 5 },
      { type: 'closePath' },
    ]);
  });

  it('角点溢出 → null', () => {
    expect(derive('ellipse', [{ x: 1e308, y: 0 }, { x: -1e308, y: 0 }])).toBeNull();
    expect(derive('ellipse', [{ x: 0, y: 0 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D. bezier（精确 AABB）
// ---------------------------------------------------------------------------

describe('layeredShapeGeometry: bezier', () => {
  it('canonical：moveTo + bezierCurveTo', () => {
    const geometry = derive('bezier', [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(geometry!.commands[0]).toEqual({ type: 'moveTo', x: 0, y: 0 });
    expect(geometry!.commands[1]).toEqual({
      type: 'bezierCurveTo',
      cp1x: 0,
      cp1y: 100,
      cp2x: 100,
      cp2y: 100,
      x: 100,
      y: 0,
    });
  });

  it('端点为 (0,0)/(100,0)、CP (0,100)/(100,100)：ymax 精确 75（非控制点 100）', () => {
    const geometry = derive('bezier', [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(geometry!.localBounds.maxY).toBeCloseTo(75, 9);
    expect(geometry!.localBounds.maxY).not.toBe(100);
    expect(geometry!.localBounds.minX).toBe(0);
    expect(geometry!.localBounds.maxX).toBe(100);
  });

  it('线性导数 a===0（0,1,3,6：a=0,b=2）仍给出精确 bounds', () => {
    const geometry = derive('bezier', [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 3 },
      { x: 6, y: 6 },
    ]);
    expect(geometry).not.toBeNull();
    expect(geometry!.localBounds).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 6 });
  });

  it('恒导数（0,1,2,3：a=0,b=0）线性有效', () => {
    const geometry = derive('bezier', [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(geometry).not.toBeNull();
    expect(geometry!.localBounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 });
  });

  it('双极值 y=(0,100,-100,0)：bounds ±100√3/6', () => {
    const amplitude = (100 * Math.sqrt(3)) / 6;
    const geometry = derive('bezier', [
      { x: 0, y: 0 },
      { x: 1, y: 100 },
      { x: 2, y: -100 },
      { x: 3, y: 0 },
    ]);
    expect(geometry).not.toBeNull();
    expect(geometry!.localBounds.minX).toBeCloseTo(0, 9);
    expect(geometry!.localBounds.maxX).toBeCloseTo(3, 9);
    expect(geometry!.localBounds.maxY).toBeCloseTo(amplitude, 9);
    expect(geometry!.localBounds.minY).toBeCloseTo(-amplitude, 9);
  });

  it('有限系数但 discriminant 溢出 y=(0,1e155,-1e155,0) → null', () => {
    expect(
      derive('bezier', [
        { x: 0, y: 0 },
        { x: 1, y: 1e155 },
        { x: 2, y: -1e155 },
        { x: 3, y: 0 },
      ])
    ).toBeNull();
  });

  it('huge finite 控制点溢出 → null（不得 silently 退回端点 bounds）', () => {
    expect(
      derive('bezier', [
        { x: 0, y: 0 },
        { x: 1e308, y: 0 },
        { x: -1e308, y: 0 },
        { x: 0, y: 0 },
      ])
    ).toBeNull();
  });

  it('点数不为 4 → null', () => {
    expect(derive('bezier', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E. style / 非法输入 / caller 隔离 / 冻结
// ---------------------------------------------------------------------------

describe('layeredShapeGeometry: style 与非法输入', () => {
  const valid = (overrides: Partial<ShapeStyle>) => derive('rect', [{ x: 0, y: 0 }, { x: 10, y: 10 }], overrides);

  it('非法 style（color/width/opacity/dash/fill）→ null', () => {
    expect(valid({ color: '' })).toBeNull();
    expect(valid({ width: 0 })).toBeNull();
    expect(valid({ width: Number.NaN })).toBeNull();
    expect(valid({ opacity: 2 })).toBeNull();
    expect(valid({ opacity: -1 })).toBeNull();
    expect(valid({ dash: [-1] })).toBeNull();
    expect(valid({ dash: [Number.POSITIVE_INFINITY] })).toBeNull();
    expect(valid({ fill: 5 as unknown as string })).toBeNull();
  });

  it('未知 shapeType / 非对象 / points 非有限 → null', () => {
    expect(
      deriveShapeGeometry({ shapeType: 'weird', points: [], style: makeStyle() } as unknown as ShapeObject)
    ).toBeNull();
    expect(deriveShapeGeometry(null as unknown as ShapeObject)).toBeNull();
    expect(derive('rect', [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }])).toBeNull();
    expect(derive('rect', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });

  it('不改 caller 且深冻结（caller 变更不影响结果）', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const shape = makeShape('rect', points, { width: 4 });
    const geometry = deriveShapeGeometry(shape)!;
    const before = JSON.stringify(geometry);

    points[0]!.x = 999;
    (shape.style as unknown as { width: number }).width = 999;

    expect(JSON.stringify(geometry)).toBe(before);
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.commands)).toBe(true);
    expect(geometry.commands.every((command) => Object.isFrozen(command))).toBe(true);
    expect(Object.isFrozen(geometry.localBounds)).toBe(true);
    expect(Object.isFrozen(geometry.visualLocalBounds)).toBe(true);
  });

  it('visualLocalBounds = localBounds 外扩 width/2', () => {
    const geometry = derive('rect', [{ x: 0, y: 0 }, { x: 10, y: 10 }], { width: 2 })!;
    expect(geometry.visualLocalBounds).toEqual({ minX: -1, minY: -1, maxX: 11, maxY: 11 });
  });

  it('visual expand 溢出 → null（line 1.7e308 + width 1e308）', () => {
    expect(derive('line', [{ x: 0, y: 0 }, { x: 1.7e308, y: 0 }], { width: 1e308 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F. SVG 与 Canvas/Path2D 回放（同一命令序列）
// ---------------------------------------------------------------------------

describe('layeredShapeGeometry: SVG 与 replay', () => {
  const svg = (shapeType: ShapeType, points: readonly Point[]) => {
    const geometry = derive(shapeType, points);
    return shapeCommandsToSvgPath(geometry!.commands);
  };

  it('line/rect/polygon/bezier 输出准确 M/L/C（无自主平滑）', () => {
    expect(svg('line', [{ x: 1, y: 2 }, { x: 10, y: 20 }])).toBe('M 1 2 L 10 20');
    expect(svg('rect', [{ x: 0, y: 0 }, { x: 10, y: 20 }])).toBe('M 0 0 L 10 0 L 10 20 L 0 20 Z');
    expect(svg('polygon', [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 20 }])).toBe(
      'M 10 10 L 20 10 L 10 20 Z'
    );
    expect(
      svg('bezier', [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }])
    ).toBe('M 0 0 C 0 100 100 100 100 0');
  });

  it('ellipse SVG：恰一个 M、两段 A sweep=1、一个 Z（不额外 M/Z）', () => {
    const path = svg('ellipse', [{ x: 0, y: 0 }, { x: 20, y: 10 }]);
    expect(path).toBe('M 20 5 A 10 5 0 1 1 0 5 A 10 5 0 1 1 20 5 Z');
    expect(path.match(/M/g) ?? []).toHaveLength(1);
    expect(path.match(/A/g) ?? []).toHaveLength(2);
    expect(path.match(/Z/g) ?? []).toHaveLength(1);
    // sweep flag = 1，与 Canvas anticlockwise=false 方向一致。
    expect(path).toContain('0 1 1');
  });

  it('line/rect/polygon/bezier replay：与 commands 一对一、无 beginPath', () => {
    const line = derive('line', [{ x: 1, y: 2 }, { x: 3, y: 4 }])!;
    const { target, calls } = createRecorder();
    replayShapeCommands(target, line.commands);
    expect(calls).toEqual([
      ['moveTo', 1, 2],
      ['lineTo', 3, 4],
    ]);
    expect(calls.some(([name]) => name === 'beginPath')).toBe(false);

    const rect = derive('rect', [{ x: 0, y: 0 }, { x: 10, y: 20 }])!;
    const rectRecorder = createRecorder();
    replayShapeCommands(rectRecorder.target, rect.commands);
    expect(rectRecorder.calls).toEqual([
      ['moveTo', 0, 0],
      ['lineTo', 10, 0],
      ['lineTo', 10, 20],
      ['lineTo', 0, 20],
      ['closePath'],
    ]);

    const polygon = derive('polygon', [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 20 }])!;
    const polygonRecorder = createRecorder();
    replayShapeCommands(polygonRecorder.target, polygon.commands);
    expect(polygonRecorder.calls).toEqual([
      ['moveTo', 10, 10],
      ['lineTo', 20, 10],
      ['lineTo', 10, 20],
      ['closePath'],
    ]);

    const bezier = derive('bezier', [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ])!;
    const bezierRecorder = createRecorder();
    replayShapeCommands(bezierRecorder.target, bezier.commands);
    expect(bezierRecorder.calls).toEqual([
      ['moveTo', 0, 0],
      ['bezierCurveTo', 0, 100, 100, 100, 100, 0],
    ]);

    for (const recorder of [rectRecorder, polygonRecorder, bezierRecorder]) {
      expect(recorder.calls.some(([name]) => name === 'beginPath')).toBe(false);
    }
  });

  it('ellipse replay：仅 ellipse(cx,cy,rx,ry,0,0,2π,false)，move/close 由周边命令负责', () => {
    const geometry = derive('ellipse', [{ x: 0, y: 0 }, { x: 20, y: 10 }])!;
    const { target, calls } = createRecorder();
    replayShapeCommands(target, geometry.commands);
    expect(calls).toEqual([
      ['moveTo', 20, 5],
      ['ellipse', 10, 5, 10, 5, 0, 0, Math.PI * 2, 0],
      ['closePath'],
    ]);
  });

  it('ShapePathTarget 与真实 CanvasRenderingContext2D / Path2D 结构兼容（仅类型）', () => {
    const fromCanvas = (ctx: CanvasRenderingContext2D): ShapePathTarget => ctx;
    const fromPath2D = (path: Path2D): ShapePathTarget => path;
    expect(typeof fromCanvas).toBe('function');
    expect(typeof fromPath2D).toBe('function');
  });
});


