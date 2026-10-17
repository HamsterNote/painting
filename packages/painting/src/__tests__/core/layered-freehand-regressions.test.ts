/** @jest-environment node */

/**
 * Task 2.4 / 2.5 回归证据：两个独立 oracle 发现的 P0 bug remediation。
 *
 * 范围声明（重要）：
 * - 纯几何、headless 测试：只读 `model/document.ts`、`geometry/freehand.ts`、
 *   `geometry/closedPath.ts`，不依赖 DOM/Canvas/Skia/RN 运行时。
 * - 只补证既有几何声称的 fixture，**不宣称**任何内容/像素渲染已验证：本期尚无 render
 *   实现，nonzero 填充由未来渲染端负责。因此不勾选 tasks.md 2.4/2.5（集成 claim 仍未证）。
 * - 不在测试内做 `Path2D` 运行时 mock（node/jsdom 都无真实实现，会让形状兼容变成假证据）。
 *   真实 DOM `Path2D` 的 assignability 由 validation 阶段的独立 `tsc`（lib: DOM）probe 确认，
 *   见 docs/implementation/layered-perfect-freehand-surface/geometry-remediation.md。
 */

import {
  deriveFreehandGeometry,
  derivePressureSamples,
  FREEHAND_ALGORITHM_REVISION,
  type DerivedFreehandGeometry,
} from '../../geometry/freehand';
import {
  commandsToSvgPath,
  polygonToClosedPathCommands,
  replayClosedPath,
  type ClosedPathCommand,
  type ClosedPathTarget,
} from '../../geometry/closedPath';
import {
  IDENTITY_TRANSFORM,
  type AcceptedSample,
  type BrushSnapshot,
  type FreehandObject,
  type Point,
  type ResolvedPressureMode,
  type SamplePhase,
} from '../../model/document';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** 构造单条 accepted raw 样本；pressure 传 undefined 表示“缺失”。 */
function sample(
  sequence: number,
  phase: SamplePhase,
  pressure: number | undefined,
  x = sequence * 5,
  y = sequence * 3,
  time = sequence * 10
): AcceptedSample {
  return { sequence, x, y, pressure, time, phase, source: 'pen' };
}

/** 构造笔刷快照。 */
function makeBrush(overrides: Partial<BrushSnapshot> = {}): BrushSnapshot {
  return {
    color: '#111111',
    nominalSize: 12,
    opacity: 1,
    pressureMode: 'real',
    presetRevision: 1,
    ...overrides,
  };
}

/** 构造自由笔对象；默认 real 模式。 */
function makeFreehand(
  samples: readonly AcceptedSample[],
  mode: ResolvedPressureMode = 'real',
  overrides: Partial<FreehandObject> = {}
): FreehandObject {
  return {
    kind: 'freehand',
    objectId: 'obj-regression',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    commitId: 'commit-regression',
    samples,
    brushSnapshot: makeBrush(),
    resolvedPressureMode: mode,
    samplesRevision: 1,
    brushRevision: 1,
    ...overrides,
  };
}

/** 提取派生压力序列的数值数组。 */
function derivedPressures(object: FreehandObject): number[] {
  return derivePressureSamples(object).map((entry) => entry.pressure);
}

/** 断言派生几何有限、非空，且命令为单一闭合轮廓（moveTo 开头、closePath 收尾）。 */
function expectClosedFiniteGeometry(geometry: DerivedFreehandGeometry): void {
  expect(geometry.polygon.length).toBeGreaterThan(0);
  for (const point of geometry.polygon) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  }
  expect(geometry.commands.length).toBeGreaterThanOrEqual(2);
  expect(geometry.commands[0]!.kind).toBe('moveTo');
  expect(geometry.commands[geometry.commands.length - 1]!.kind).toBe('closePath');
  // 只有根 moveTo：其余为 lineTo 或结尾 closePath。
  const moveTos = geometry.commands.filter((command) => command.kind === 'moveTo');
  expect(moveTos).toHaveLength(1);
}

// ---------------------------------------------------------------------------
// 修复 1（P0）：contact pressure 仅 down/move 更新，且包含合法 0
// ---------------------------------------------------------------------------

describe('P0 fix: derivePressureSamples 接触压力语义', () => {
  it('down0.7 → move0 → up0 得到 0.7,0,0', () => {
    const object = makeFreehand([
      sample(0, 'down', 0.7),
      sample(1, 'move', 0),
      sample(2, 'up', 0),
    ]);
    expect(derivedPressures(object)).toEqual([0.7, 0, 0]);
  });

  it('down0 → up0 得到 0,0（合法 0 作为接触压力）', () => {
    const object = makeFreehand([sample(0, 'down', 0), sample(1, 'up', 0)]);
    expect(derivedPressures(object)).toEqual([0, 0]);
  });

  it('仅 up0 → 0.5（无 prior 接触压力）', () => {
    const object = makeFreehand([sample(0, 'up', 0)]);
    expect(derivedPressures(object)).toEqual([0.5]);
  });

  it('up 正值原样输出，但不作为接触压力供后续 up0 复用', () => {
    const object = makeFreehand([
      sample(0, 'down', 0.3),
      sample(1, 'up', 0.9), // 非零 up：原样输出，但不更新 contact
      sample(2, 'up', 0), // 仍读 down 的 0.3
    ]);
    expect(derivedPressures(object)).toEqual([0.3, 0.9, 0.3]);
  });

  it('missing 压力 → 0.5；越界压力 clamp 到 [0,1] 且不写回 raw', () => {
    const missing = makeFreehand([
      sample(0, 'down', undefined),
      sample(1, 'move', undefined),
      sample(2, 'up', 0),
    ]);
    expect(derivedPressures(missing)).toEqual([0.5, 0.5, 0.5]);

    const clamped = makeFreehand([
      sample(0, 'down', 1.5),
      sample(1, 'move', -0.25),
      sample(2, 'up', 0),
    ]);
    expect(derivedPressures(clamped)).toEqual([1, 0, 0]);
    // raw 原值保留，未被 clamp 写回。
    expect(clamped.samples.map((s) => s.pressure)).toEqual([1.5, -0.25, 0]);
  });

  it('派生结果与 raw 均冻结，且 raw 不被修改', () => {
    const samples = Object.freeze([
      Object.freeze(sample(0, 'down', 0.4)),
      Object.freeze(sample(1, 'move', 0.8)),
      Object.freeze(sample(2, 'up', 0)),
    ]);
    const object = makeFreehand(samples);
    const before = JSON.stringify(object);

    const derived = derivePressureSamples(object);

    expect(Object.isFrozen(derived)).toBe(true);
    for (const entry of derived) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(JSON.stringify(object)).toBe(before);
    // 派生元素是新对象，不与 raw 共享引用。
    for (const entry of derived) {
      expect(samples).not.toContain(entry);
    }
  });
});

// ---------------------------------------------------------------------------
// 修复 2（P0）：ClosedPathTarget 只要求 moveTo/lineTo/closePath（无 beginPath）
// ---------------------------------------------------------------------------

type RecorderCall =
  | Readonly<{ kind: 'moveTo'; x: number; y: number }>
  | Readonly<{ kind: 'lineTo'; x: number; y: number }>
  | Readonly<{ kind: 'closePath' }>;

/**
 * 构造一个**没有 beginPath** 的 target：这正是 Path2D 的形状。
 * 若 replay 仍调用 `target.beginPath()`，运行时会立刻抛错，测试即失败。
 */
function createRecorder(): { target: ClosedPathTarget; calls: RecorderCall[] } {
  const calls: RecorderCall[] = [];
  const target: ClosedPathTarget = {
    moveTo(x: number, y: number) {
      calls.push({ kind: 'moveTo', x, y });
    },
    lineTo(x: number, y: number) {
      calls.push({ kind: 'lineTo', x, y });
    },
    closePath() {
      calls.push({ kind: 'closePath' });
    },
  };
  return { target, calls };
}

describe('P0 fix: ClosedPathTarget 无 beginPath（Path2D 形状）', () => {
  const triangle: readonly Point[] = [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ];

  it('polygon → 单一闭合 M/L/Z 命令', () => {
    const commands = polygonToClosedPathCommands(triangle);
    expect(commands).toEqual([
      { kind: 'moveTo', x: 1, y: 2 },
      { kind: 'lineTo', x: 3, y: 4 },
      { kind: 'lineTo', x: 5, y: 6 },
      { kind: 'closePath' },
    ]);
  });

  it('空 polygon → 空命令；单点 polygon → moveTo + closePath', () => {
    expect(polygonToClosedPathCommands([])).toEqual([]);
    expect(polygonToClosedPathCommands([{ x: 7, y: 8 }])).toEqual([
      { kind: 'moveTo', x: 7, y: 8 },
      { kind: 'closePath' },
    ]);
  });

  it('recorder 无 beginPath，replayClosedPath 不会调用它且回放与命令一致', () => {
    const { target, calls } = createRecorder();
    expect('beginPath' in target).toBe(false);

    const commands = polygonToClosedPathCommands(triangle);
    expect(() => replayClosedPath(target, commands)).not.toThrow();
    expect(calls).toEqual(commands);
  });

  it('SVG d 与 Canvas recorder 共用同一命令序列', () => {
    const commands = polygonToClosedPathCommands(triangle);
    expect(commandsToSvgPath(commands)).toBe('M 1 2 L 3 4 L 5 6 Z');

    const { target, calls } = createRecorder();
    replayClosedPath(target, commands);
    // 回放调用序列与命令序列逐一相等（Canvas 与 SVG 不会各自拟合）。
    expect(calls).toEqual([...commands]);
  });

  it('非有限顶点被拒绝（只校验，不改变 path 格式）', () => {
    expect(() => polygonToClosedPathCommands([{ x: Number.NaN, y: 0 }])).toThrow(TypeError);
    expect(() => polygonToClosedPathCommands([{ x: 0, y: Infinity }])).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 补证既有几何 fixture（单点/短笔/零位移、active/final、模式无关性、精确一致）
// ---------------------------------------------------------------------------

describe('freehand 派生几何 fixture 补证', () => {
  it('单点 / 短笔 / 零位移：polygon 有限且命令为闭合 M..Z', () => {
    const singlePoint = makeFreehand([sample(0, 'down', 0.5, 20, 30)]);
    const shortStroke = makeFreehand([
      sample(0, 'down', 0.4, 0, 0),
      sample(1, 'up', 0, 12, 9),
    ]);
    const zeroDisplacement = makeFreehand([
      sample(0, 'down', 0.6, 5, 5),
      sample(1, 'move', 0.6, 5, 5),
      sample(2, 'up', 0, 5, 5),
    ]);

    for (const state of ['active', 'final'] as const) {
      expectClosedFiniteGeometry(deriveFreehandGeometry(singlePoint, state));
      expectClosedFiniteGeometry(deriveFreehandGeometry(shortStroke, state));
      expectClosedFiniteGeometry(deriveFreehandGeometry(zeroDisplacement, state));
    }
  });

  it('active 与 final 均派生且 revision 区分 state', () => {
    const object = makeFreehand([
      sample(0, 'down', 0.4),
      sample(1, 'move', 0.6),
      sample(2, 'up', 0),
    ]);

    const active = deriveFreehandGeometry(object, 'active');
    const final = deriveFreehandGeometry(object, 'final');

    expectClosedFiniteGeometry(active);
    expectClosedFiniteGeometry(final);
    expect(active.geometryRevision).toContain(':active');
    expect(final.geometryRevision).toContain(':final');
    expect(FREEHAND_ALGORITHM_REVISION).toBe('pf@1.2.3:preset1');
    expect(active.geometryRevision).toContain(FREEHAND_ALGORITHM_REVISION);
  });

  it('simulated / constant：raw 压力与 time 变化不改变 outline（time 不传 PF）', () => {
    for (const mode of ['simulated', 'constant'] as const) {
      const base = makeFreehand(
        [sample(0, 'down', 0.1, 0, 0, 5), sample(1, 'move', 0.9, 30, 20, 15)],
        mode
      );
      const changed = makeFreehand(
        // 相同坐标，不同 raw 压力与 time。
        [sample(0, 'down', 0.95, 0, 0, 900), sample(1, 'move', 0.02, 30, 20, 950)],
        mode
      );

      const a = deriveFreehandGeometry(base, 'final');
      const b = deriveFreehandGeometry(changed, 'final');
      expect(b.polygon).toEqual(a.polygon);
      expect(commandsToSvgPath(b.commands)).toBe(commandsToSvgPath(a.commands));
    }
  });

  it('同 final 重复派生：commands 精确一致，SVG 与 recorder 回放一致', () => {
    const object = makeFreehand([
      sample(0, 'down', 0.5),
      sample(1, 'move', 0.7),
      sample(2, 'move', 0.4),
      sample(3, 'up', 0),
    ]);

    const first = deriveFreehandGeometry(object, 'final');
    const second = deriveFreehandGeometry(object, 'final');

    const expected: readonly ClosedPathCommand[] = first.commands;
    expect(second.commands).toEqual(expected);
    expect(second.polygon).toEqual(first.polygon);

    const svg = commandsToSvgPath(expected);
    expect(commandsToSvgPath(second.commands)).toBe(svg);

    const { target, calls } = createRecorder();
    replayClosedPath(target, expected);
    expect(calls).toEqual([...expected]);
    expect('beginPath' in target).toBe(false);
  });
});
