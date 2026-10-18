/**
 * 自由笔几何派生（Task 2.4）。
 *
 * 设计约束（design.md 决策 3 / spec freehand-geometry-pressure）：
 * - 本模块是纯几何：只依赖冻结的 `model/document.ts` 契约与 `perfect-freehand`；
 *   不依赖 controller、DOM、Canvas、Skia 或 legacy。
 * - PF 生成的内部合成点、轮廓点只属于派生几何，**绝不写回 object**；本模块不修改入参。
 * - real 使用真实压力；simulated 与 constant 的派生压力固定 0.5，避免 mouse/pen 原值影响
 *   PF 模拟 seed / 宽度；模式在 begin 锁定，不由 `p > 0` 或变化率推断。
 * - release 收尾：up 阶段压力 0 使用之前最后有效接触压力，普通 down/move 的 0 保留。
 * - 本轮不做几何缓存（2.6 后续）；revision 仅用于未来失效，不作为持久事实。
 */

import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { constrainPointToRulerEdge, createRulerEdgeConstraint } from '../ruler/geometry';

import type {
  AcceptedSample,
  BrushSnapshot,
  Bounds,
  FreehandObject,
  Point,
  ResolvedPressureMode,
} from '../model/document';
import { polygonToClosedPathCommands, type ClosedPathCommand } from './closedPath';

/**
 * 几何算法 + preset revision。
 * 包含精确 PF 版本，避免库更新后缓存/数据未失效。
 */
export const FREEHAND_ALGORITHM_REVISION = 'pf@1.2.3:preset1' as const;

/** active / final 两种派生状态；final 采用结束收尾。 */
export type FreehandGeometryState = 'active' | 'final';

/** 派生几何输出；全部只读且已冻结。 */
export type DerivedFreehandGeometry = Readonly<{
  polygon: readonly Point[];
  commands: readonly ClosedPathCommand[];
  localBounds: Bounds;
  geometryRevision: string;
}>;

/** PF 显式派生输入：坐标 + 数值压力（缺失/越界已在本模块归一化）。 */
export type PressureSample = Readonly<{ x: number; y: number; pressure: number }>;

/** 中性压力：raw 缺失压力时使用，原始字段保持缺失不写回。 */
const NEUTRAL_PRESSURE = 0.5 as const;

/** 空几何的退化 bounds；reader 层另行拒绝空 samples 持久化。 */
const EMPTY_BOUNDS: Bounds = Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

/** 恒等 easing，显式覆盖库默认值。 */
function identity(value: number): number {
  return value;
}

/** 断言有限数值，避免 NaN/Infinity 进入 PF 产生运行时 NaN 几何。 */
function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number, received ${String(value)}`);
  }
}

/** 把有限越界压力 clamp 到 [0,1]；不写回 raw。 */
function clampPressure(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/** 校验 brush snapshot 的有限输入。 */
function validateBrush(brush: BrushSnapshot): void {
  assertFinite(brush.nominalSize, 'brushSnapshot.nominalSize');
  assertFinite(brush.opacity, 'brushSnapshot.opacity');
}

/** 校验单条原始样本的有限性；压力存在时也必须有限。 */
function validateSample(sample: AcceptedSample): void {
  assertFinite(sample.x, 'sample.x');
  assertFinite(sample.y, 'sample.y');
  assertFinite(sample.time, 'sample.time');
  if (sample.pressure !== undefined) {
    assertFinite(sample.pressure, 'sample.pressure');
  }
}

/**
 * real 模式的派生压力序列：
 * - raw 缺失 → 中性 0.5；
 * - 有限越界 → clamp 到 [0,1]（不写回 raw）；
 * - up 且压力 0 → 使用之前最后一次 down/move 接触压力收尾，无 prior 时用 0.5；
 * - 普通 down/move 的压力（含合法的 0）保留并更新接触压力；
 * - up 上的非零压力原样输出，但 **不作为接触压力** 供后续 up0 复用。
 *
 * 接触压力的更新规则是修 bug 的关键：
 * 只有落笔/移动（down/move）才更新，且合法的 0 也算一次接触；
 * 抬笔（up）无论压力取值都不更新。因此 `down0 → up0` 得到 `0,0`，
 * 而 `down0.7 → move0 → up0` 得到 `0.7,0,0`。
 */
function deriveRealPressureSamples(samples: readonly AcceptedSample[]): readonly PressureSample[] {
  const derived: PressureSample[] = [];
  // 最近一次 down/move 的派生接触压力（含合法 0）；仅由接触样本更新。
  let lastContactPressure: number | undefined;

  for (const sample of samples) {
    validateSample(sample);
    const isContact = sample.phase === 'down' || sample.phase === 'move';
    const isRelease = sample.phase === 'up' && sample.pressure === 0;
    const basePressure =
      sample.pressure === undefined ? NEUTRAL_PRESSURE : clampPressure(sample.pressure);
    const pressure = isRelease ? (lastContactPressure ?? NEUTRAL_PRESSURE) : basePressure;

    derived.push(Object.freeze({ x: sample.x, y: sample.y, pressure }));

    // 仅 down/move 更新接触压力（含合法 0）；up 不更新。
    if (isContact) {
      lastContactPressure = basePressure;
    }
  }

  return Object.freeze(derived);
}

/**
 * 只读派生 PF 输入（显式 xy + 数值 pressure）。
 *
 * - real：真实压力 + release 收尾规则。
 * - simulated / constant：全部固定 0.5，与输入压力无关。
 *
 * 原始 `object.samples` 不被修改；越界/缺失只在派生视图归一化。
 */
export function derivePressureSamples(object: FreehandObject): readonly PressureSample[] {
  const mode: ResolvedPressureMode = object.resolvedPressureMode;

  if (mode === 'simulated' || mode === 'constant') {
    // 固定中性压力：simulated 的距离模拟不受 mouse/pen 原值影响，constant 无压力效应。
    const samples = object.samples;
    const derived = samples.map((sample) => {
      validateSample(sample);
      return Object.freeze({ x: sample.x, y: sample.y, pressure: NEUTRAL_PRESSURE });
    });
    return Object.freeze(derived);
  }

  return deriveRealPressureSamples(object.samples);
}

/** 由 polygon 顶点计算局部包围盒；空 polygon 返回退化 bounds。 */
function computeLocalBounds(polygon: readonly Point[]): Bounds {
  if (polygon.length === 0) {
    return EMPTY_BOUNDS;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    if (point.x < minX) {
      minX = point.x;
    }
    if (point.y < minY) {
      minY = point.y;
    }
    if (point.x > maxX) {
      maxX = point.x;
    }
    if (point.y > maxY) {
      maxY = point.y;
    }
  }

  return Object.freeze({ minX, minY, maxX, maxY });
}

/** 组装显式 PF options；不依赖库默认值。 */
function buildStrokeOptions(
  mode: ResolvedPressureMode,
  state: FreehandGeometryState,
  size: number
): StrokeOptions {
  const isConstant = mode === 'constant';
  return {
    size,
    // constant 不因压力改变宽度；real/simulated 使用 0.5 内部 thinning preset。
    thinning: isConstant ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    easing: identity,
    // real 使用真实压力，simulated 由 PF 按距离模拟，constant 显式关闭模拟。
    simulatePressure: mode === 'simulated',
    start: { cap: true, taper: 0, easing: identity },
    end: { cap: true, taper: 0, easing: identity },
    // active 未完成，final 采用结束收尾。
    last: state === 'final',
  } as const;
}

/** 组装几何 revision；包含 sample/brush/preset/algorithm + state，**不含 transform**。 */
function buildGeometryRevision(
  mode: ResolvedPressureMode,
  state: FreehandGeometryState,
  object: FreehandObject
): string {
  const { samplesRevision, brushRevision } = object;
  const presetRevision = object.brushSnapshot.presetRevision;
  const ruler = object.rulerSnapshot;
  const constraint = ruler
    ? JSON.stringify([ruler.center.x, ruler.center.y, ruler.height, ruler.rotationRad])
    : '';
  return `${FREEHAND_ALGORITHM_REVISION}:s${samplesRevision}:b${brushRevision}:p${presetRevision}:m${mode}:${state}:r${constraint}`;
}

/**
 * 派生自由笔几何（active 或 final）。
 *
 * - 只读：不修改 object / samples / brush，不写入插值、预测点或 PF 内部点。
 * - 空 samples 或 size<=0 → 空 polygon/commands + 退化 bounds。
 * - 返回对象深冻结；每点/每条命令冻结以便安全比较与缓存。
 */
export function deriveFreehandGeometry(
  object: FreehandObject,
  state: FreehandGeometryState
): DerivedFreehandGeometry {
  validateBrush(object.brushSnapshot);

  const revision = buildGeometryRevision(object.resolvedPressureMode, state, object);

  // size<=0 或空输入：PF 约定返回空轮廓。
  if (object.samples.length === 0 || object.brushSnapshot.nominalSize <= 0) {
    return Object.freeze({
      polygon: Object.freeze([] as Point[]),
      commands: polygonToClosedPathCommands([]),
      localBounds: EMPTY_BOUNDS,
      geometryRevision: revision,
    });
  }

  let pressureSamples = derivePressureSamples(object);
  if (object.rulerSnapshot && pressureSamples.length) {
    const ruler = { ...object.rulerSnapshot, length: 1 };
    let constraint = createRulerEdgeConstraint(pressureSamples[0]!, ruler);
    pressureSamples = pressureSamples.map((sample) => {
      const result = constrainPointToRulerEdge(sample, constraint);
      constraint = result.constraint;
      return { ...sample, ...result.point };
    });
  }
  const options = buildStrokeOptions(
    object.resolvedPressureMode,
    state,
    object.brushSnapshot.nominalSize
  );

  const rawPolygon = getStroke(
    pressureSamples.map((sample) => ({
      x: sample.x,
      y: sample.y,
      pressure: sample.pressure,
    })),
    options
  );

  const polygon: readonly Point[] = Object.freeze(
    rawPolygon.map(([x, y]) => Object.freeze({ x, y }))
  );
  const commands = polygonToClosedPathCommands(polygon);
  const localBounds = computeLocalBounds(polygon);

  return Object.freeze({
    polygon,
    commands,
    localBounds,
    geometryRevision: revision,
  });
}
