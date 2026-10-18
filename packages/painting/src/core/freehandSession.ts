/**
 * 自由笔输入会话（Task 2.3 整笔锁定基础 + Task 4.2 / 4.3 纯会话基础）。
 *
 * 范围约束（重要）：
 * - 纯 headless 状态机：不依赖 DOM / React / Canvas / Skia / history / document 事务。
 * - **不创建文档对象、不写 history、不做几何派生**：只把 adapter 归一化的 begin/update/end/cancel
 *   批次累积成只读 candidate，交给未来 controller 用 commitId 提交。
 * - viewport 只读，不改动唯一 viewport 的任何 API；本会话冻结落笔 revision。
 *
 * 会话生命周期（四态）：
 *   collecting --end--> awaiting-commit --commit-succeeded--> committed
 *   collecting --cancel--> canceled
 * commit-failed 留在 awaiting-commit（同 candidate / 同 commitId）供 controller 重试；
 * awaiting/committed 上的 cancel 被拒绝，不会丢候选或回滚；committed 后失败反馈不能回退。
 */

import {
  copyFreehandRuler,
  type FreehandRulerSnapshot,
  resolvePressureMode,
  type AcceptedSample,
  type BrushSnapshot,
  type InputSource,
  type PressureCapability,
  type PressureMode,
  type SamplePhase,
} from '../model/document';
import type { DrawingViewport } from '../viewport';
import { normalizeViewportTransform } from './viewportTransform';

/** 单条输入样本；`pressure` 缺失时保持缺失，不在此层写回或补造。 */
export type FreehandSampleInput = Readonly<{
  sequence: number;
  x: number;
  y: number;
  pressure?: number;
  time: number;
  phase: SamplePhase;
}>;

/** adapter 归一化后的一个输入批次；同批次不可跨 source / 坐标空间 / viewport revision。 */
export type FreehandInputBatch = Readonly<{
  sessionId: string;
  pointerId: string | number;
  source: InputSource;
  batchSequence: number;
  coordinateSpace: 'screen' | 'world';
  viewportRevision: number;
  samples: readonly FreehandSampleInput[];
}>;

/** begin：落笔时记录 pointer、brush 快照、压力能力与稳定 viewport revision。 */
export type BeginFreehandSessionInput = Readonly<{
  type: 'begin';
  commitId: string;
  pressureCapability: PressureCapability;
  brush: BrushSnapshot;
  rulerSnapshot?: FreehandRulerSnapshot;
  viewportSnapshot: Readonly<{ revision: number; viewport: DrawingViewport }>;
  batch: FreehandInputBatch;
}>;

/** update：追加移动批次。 */
export type FreehandSessionUpdate = Readonly<{ type: 'update'; batch: FreehandInputBatch }>;

/** end：收尾批次，最后一帧且仅最后一帧为 up。 */
export type FreehandSessionEnd = Readonly<{ type: 'end'; batch: FreehandInputBatch }>;

/** 取消原因；取消只可用于尚未提交的 collecting。 */
type FreehandCancelReason = 'pointercancel' | 'unmount' | 'background' | 'tool-change' | 'explicit';

/** cancel：不携带样本，identity 与下一批次序号必须匹配。 */
export type FreehandSessionCancel = Readonly<{
  type: 'cancel';
  sessionId: string;
  pointerId: string | number;
  source: InputSource;
  batchSequence: number;
  reason: FreehandCancelReason;
}>;

/** 未来 controller 的提交反馈；错误 commitId 必须被拒绝。 */
export type FreehandCommitFeedback =
  | Readonly<{ type: 'commit-failed'; commitId: string }>
  | Readonly<{
      type: 'commit-succeeded';
      commitId: string;
      objectId: string;
      documentRevision: number;
    }>;

/** 会话拒绝码；仅用于本模块 Result。 */
type FreehandSessionErrorCode =
  | 'invalid-input'
  | 'identity-mismatch'
  | 'coordinate-space-mismatch'
  | 'viewport-revision-mismatch'
  | 'batch-sequence-mismatch'
  | 'sample-sequence-mismatch'
  | 'phase-mismatch'
  | 'not-collecting'
  | 'commit-id-mismatch';

/** 统一 Result：成功携带值，失败只给可测 code，不抛异常。 */
export type FreehandSessionResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: FreehandSessionErrorCode }>;

/** 整笔冻结后的提交候选；source 由 begin owner 填入，pressure 缺失保持缺失。 */
export type FreehandCandidate = Readonly<{
  commitId: string;
  sessionId: string;
  pointerId: string | number;
  source: InputSource;
  lockedViewportRevision: number;
  brushSnapshot: BrushSnapshot;
  rulerSnapshot?: FreehandRulerSnapshot;
  resolvedPressureMode: 'real' | 'simulated' | 'constant';
  samples: readonly AcceptedSample[];
}>;

/** 会话快照四态；collecting 内联展开 owner/brush/mode/viewport 与序号。 */
export type FreehandSessionSnapshot =
  | Readonly<{
      status: 'collecting';
      commitId: string;
      sessionId: string;
      pointerId: string | number;
      source: InputSource;
      brushSnapshot: BrushSnapshot;
      rulerSnapshot?: FreehandRulerSnapshot;
      resolvedPressureMode: 'real' | 'simulated' | 'constant';
      lockedViewport: DrawingViewport;
      lockedViewportRevision: number;
      coordinateSpace: 'screen' | 'world';
      samples: readonly AcceptedSample[];
      nextBatchSequence: number;
      nextSampleSequence: number;
    }>
  | Readonly<{ status: 'awaiting-commit'; candidate: FreehandCandidate }>
  | Readonly<{
      status: 'committed';
      candidate: FreehandCandidate;
      objectId: string;
      documentRevision: number;
    }>
  | Readonly<{
      status: 'canceled';
      commitId: string;
      sessionId: string;
      pointerId: string | number;
      source: InputSource;
      reason: FreehandCancelReason;
    }>;

/** 会话接口：getSnapshot 与四个命令；所有命令在失败时不改变任何 state。 */
export interface FreehandSession {
  getSnapshot(): FreehandSessionSnapshot;
  update(input: FreehandSessionUpdate): FreehandSessionResult<void>;
  end(input: FreehandSessionEnd): FreehandSessionResult<FreehandSessionSnapshot>;
  cancel(input: FreehandSessionCancel): FreehandSessionResult<FreehandSessionSnapshot>;
  applyCommitFeedback(
    feedback: FreehandCommitFeedback
  ): FreehandSessionResult<FreehandSessionSnapshot>;
}

// ---------------------------------------------------------------------------
// 运行时校验 helper（类型/反馈值运行时也校验，不信任未知 JSON）
// ---------------------------------------------------------------------------

const SOURCES: readonly InputSource[] = ['mouse', 'touch', 'pen', 'native'];
const PRESSURE_CAPABILITIES: readonly PressureCapability[] = [
  'available',
  'unavailable',
  'unknown',
];
const PRESSURE_MODES: readonly PressureMode[] = ['auto', 'real', 'simulated', 'constant'];
const SAMPLE_PHASES: readonly SamplePhase[] = ['down', 'move', 'up'];
const COORDINATE_SPACES: readonly ('screen' | 'world')[] = ['screen', 'world'];
const CANCEL_REASONS: readonly FreehandCancelReason[] = [
  'pointercancel',
  'unmount',
  'background',
  'tool-change',
  'explicit',
];

/** 非空字符串（不做 trim，空白串视为非空）。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 非负安全整数：用于所有 id/序号/revision/sequence。 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 有限数值。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** DOM pointerId is a signed identity; iPadOS can issue negative values. */
function isPointerId(value: unknown): value is string | number {
  return isNonEmptyString(value) || (typeof value === 'number' && Number.isSafeInteger(value));
}

/** viewport 结构：三个分量均为有限数。 */
function isViewportLike(value: unknown): value is DrawingViewport {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const viewport = value as Record<string, unknown>;
  return (
    isFiniteNumber(viewport.scale) && isFiniteNumber(viewport.tx) && isFiniteNumber(viewport.ty)
  );
}

function sameViewportValues(left: DrawingViewport, right: DrawingViewport): boolean {
  return left.scale === right.scale && left.tx === right.tx && left.ty === right.ty;
}

/**
 * brush 白名单拷贝 + 校验：只保留已知字段，剔除未知 dash/pressureMultiplier/PF 参数等额外字段，
 * 结果冻结。返回 null 表示输入非法。
 */
function copyValidatedBrush(value: unknown): BrushSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const brush = value as Record<string, unknown>;
  if (!isNonEmptyString(brush.color)) {
    return null;
  }
  if (!isFiniteNumber(brush.nominalSize) || brush.nominalSize <= 0) {
    return null;
  }
  if (!isFiniteNumber(brush.opacity) || brush.opacity < 0 || brush.opacity > 1) {
    return null;
  }
  if (
    typeof brush.pressureMode !== 'string' ||
    !PRESSURE_MODES.includes(brush.pressureMode as PressureMode)
  ) {
    return null;
  }
  if (!isNonNegativeSafeInteger(brush.presetRevision)) {
    return null;
  }
  return Object.freeze({
    color: brush.color,
    nominalSize: brush.nominalSize,
    opacity: brush.opacity,
    pressureMode: brush.pressureMode as PressureMode,
    presetRevision: brush.presetRevision,
  });
}

/** Result 构造 helper。 */
function ok<T>(value: T): FreehandSessionResult<T> {
  return Object.freeze({ ok: true, value });
}

function fail<T>(code: FreehandSessionErrorCode): FreehandSessionResult<T> {
  return Object.freeze({ ok: false, code });
}

/** 批次相位规则：begin 首帧 down 其余 move；update 全 move；end 末帧且仅末帧 up。 */
type PhaseRule = 'begin' | 'update' | 'end';

function phaseMatches(rule: PhaseRule, phase: SamplePhase, index: number, length: number): boolean {
  if (rule === 'update') {
    return phase === 'move';
  }
  if (rule === 'end') {
    return index === length - 1 ? phase === 'up' : phase === 'move';
  }
  return index === 0 ? phase === 'down' : phase === 'move';
}

type SampleValidation =
  | Readonly<{ ok: true; value: AcceptedSample[] }>
  | Readonly<{ ok: false; code: FreehandSessionErrorCode }>;

/**
 * 校验一个 batch 的全部样本并转换为世界坐标 AcceptedSample。
 *
 * - 序号必须从 `startSequence` 连续，保证实际接受次序；**不按相同 xy/time 去重**。
 * - screen 空间按冻结 viewport 反变换：world=(screen-tx)/scale，其余 raw 值原样保留；
 *   转换结果非有限即拒绝。world 空间原样使用。
 * - pressure 缺失保持缺失（条件构造，绝不写入 `pressure: undefined` 字段）；越界值不在此层 clamp。
 * - time 只要求有限，不强制递增；source 由 begin owner 统一填入。
 */
function validateAndConvertSamples(
  samples: unknown,
  source: InputSource,
  coordinateSpace: 'screen' | 'world',
  lockedViewport: DrawingViewport,
  startSequence: number,
  rule: PhaseRule
): SampleValidation {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { ok: false, code: 'invalid-input' };
  }
  const converted: AcceptedSample[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const raw = samples[index] as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
      return { ok: false, code: 'invalid-input' };
    }
    const phase = raw.phase;
    if (typeof phase !== 'string' || !SAMPLE_PHASES.includes(phase as SamplePhase)) {
      return { ok: false, code: 'invalid-input' };
    }
    if (!isNonNegativeSafeInteger(raw.sequence)) {
      return { ok: false, code: 'invalid-input' };
    }
    if (raw.sequence !== startSequence + index) {
      return { ok: false, code: 'sample-sequence-mismatch' };
    }
    if (!phaseMatches(rule, phase as SamplePhase, index, samples.length)) {
      return { ok: false, code: 'phase-mismatch' };
    }
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.time)) {
      return { ok: false, code: 'invalid-input' };
    }
    if (raw.pressure !== undefined && !isFiniteNumber(raw.pressure)) {
      return { ok: false, code: 'invalid-input' };
    }
    const rawX = raw.x as number;
    const rawY = raw.y as number;
    const worldX =
      coordinateSpace === 'screen' ? (rawX - lockedViewport.tx) / lockedViewport.scale : rawX;
    const worldY =
      coordinateSpace === 'screen' ? (rawY - lockedViewport.ty) / lockedViewport.scale : rawY;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      return { ok: false, code: 'invalid-input' };
    }
    const accepted: AcceptedSample =
      raw.pressure === undefined
        ? {
            sequence: raw.sequence,
            x: worldX,
            y: worldY,
            time: raw.time as number,
            phase: phase as SamplePhase,
            source,
          }
        : {
            sequence: raw.sequence,
            x: worldX,
            y: worldY,
            pressure: raw.pressure as number,
            time: raw.time as number,
            phase: phase as SamplePhase,
            source,
          };
    converted.push(accepted);
  }
  return { ok: true, value: converted };
}

/** 冻结会话锁定上下文；begin 后外部 brush/viewport 改变不影响整笔。 */
type LockedContext = Readonly<{
  rulerSnapshot?: FreehandRulerSnapshot;
  commitId: string;
  sessionId: string;
  pointerId: string | number;
  source: InputSource;
  brushSnapshot: BrushSnapshot;
  resolvedPressureMode: 'real' | 'simulated' | 'constant';
  lockedViewport: DrawingViewport;
  lockedViewportRevision: number;
  coordinateSpace: 'screen' | 'world';
}>;

/** end 时一次性冻结 candidate 及其每个 sample（深冻结副本）。 */
function freezeCandidate(
  context: LockedContext,
  samples: readonly AcceptedSample[]
): FreehandCandidate {
  return Object.freeze({
    commitId: context.commitId,
    sessionId: context.sessionId,
    pointerId: context.pointerId,
    source: context.source,
    lockedViewportRevision: context.lockedViewportRevision,
    brushSnapshot: context.brushSnapshot,
    ...(context.rulerSnapshot ? { rulerSnapshot: context.rulerSnapshot } : {}),
    resolvedPressureMode: context.resolvedPressureMode,
    samples: Object.freeze(samples.map((sample) => Object.freeze({ ...sample }))),
  });
}

/** 会话内部状态机四态。 */
type InternalState =
  | Readonly<{ status: 'collecting' }>
  | Readonly<{ status: 'awaiting-commit' }>
  | Readonly<{ status: 'committed'; objectId: string; documentRevision: number }>
  | Readonly<{ status: 'canceled'; reason: FreehandCancelReason }>;

/**
 * 用 begin 已验证的锁定上下文与首批样本创建会话。
 *
 * - 内部 mutable append buffer：整 batch 先验证再原子 append，失败不改变任何 state。
 * - getSnapshot 按需复制并冻结，不在每个 append 全量 copy；end 一次冻结 candidate。
 */
function createCollectingSession(
  context: LockedContext,
  initialSamples: readonly AcceptedSample[]
): FreehandSession {
  let state: InternalState = Object.freeze({ status: 'collecting' });
  let candidate: FreehandCandidate | undefined;
  const buffer: AcceptedSample[] = [...initialSamples];
  let nextBatchSequence = 1;
  let nextSampleSequence = initialSamples.length;

  function collectingSnapshot(): FreehandSessionSnapshot {
    const samples = Object.freeze(buffer.map((sample) => Object.freeze({ ...sample })));
    return Object.freeze({
      status: 'collecting',
      commitId: context.commitId,
      sessionId: context.sessionId,
      pointerId: context.pointerId,
      source: context.source,
      brushSnapshot: context.brushSnapshot,
      ...(context.rulerSnapshot ? { rulerSnapshot: context.rulerSnapshot } : {}),
      resolvedPressureMode: context.resolvedPressureMode,
      lockedViewport: context.lockedViewport,
      lockedViewportRevision: context.lockedViewportRevision,
      coordinateSpace: context.coordinateSpace,
      samples,
      nextBatchSequence,
      nextSampleSequence,
    });
  }

  function awaitingSnapshot(): FreehandSessionSnapshot {
    return Object.freeze({ status: 'awaiting-commit', candidate: candidate as FreehandCandidate });
  }

  function committedSnapshot(): FreehandSessionSnapshot {
    const committed = state as Readonly<{
      status: 'committed';
      objectId: string;
      documentRevision: number;
    }>;
    return Object.freeze({
      status: 'committed',
      candidate: candidate as FreehandCandidate,
      objectId: committed.objectId,
      documentRevision: committed.documentRevision,
    });
  }

  function canceledSnapshot(): FreehandSessionSnapshot {
    const canceled = state as Readonly<{ status: 'canceled'; reason: FreehandCancelReason }>;
    return Object.freeze({
      status: 'canceled',
      commitId: context.commitId,
      sessionId: context.sessionId,
      pointerId: context.pointerId,
      source: context.source,
      reason: canceled.reason,
    });
  }

  function getSnapshot(): FreehandSessionSnapshot {
    switch (state.status) {
      case 'collecting':
        return collectingSnapshot();
      case 'awaiting-commit':
        return awaitingSnapshot();
      case 'committed':
        return committedSnapshot();
      case 'canceled':
        return canceledSnapshot();
    }
  }

  /** 校验追加 batch 的 owner / 坐标空间 / viewport revision / 批次序号；返回错误码或 null。 */
  function validateBatchEnvelope(batch: unknown): FreehandSessionErrorCode | null {
    if (!batch || typeof batch !== 'object') {
      return 'invalid-input';
    }
    const value = batch as Record<string, unknown>;
    if (
      !isNonEmptyString(value.sessionId) ||
      !isPointerId(value.pointerId) ||
      !SOURCES.includes(value.source as InputSource)
    ) {
      return 'invalid-input';
    }
    if (
      typeof value.coordinateSpace !== 'string' ||
      !COORDINATE_SPACES.includes(value.coordinateSpace as 'screen' | 'world')
    ) {
      return 'invalid-input';
    }
    if (
      !isNonNegativeSafeInteger(value.viewportRevision) ||
      !isNonNegativeSafeInteger(value.batchSequence)
    ) {
      return 'invalid-input';
    }
    if (
      value.sessionId !== context.sessionId ||
      value.pointerId !== context.pointerId ||
      value.source !== context.source
    ) {
      return 'identity-mismatch';
    }
    if (value.coordinateSpace !== context.coordinateSpace) {
      return 'coordinate-space-mismatch';
    }
    if (value.viewportRevision !== context.lockedViewportRevision) {
      return 'viewport-revision-mismatch';
    }
    if (value.batchSequence !== nextBatchSequence) {
      return 'batch-sequence-mismatch';
    }
    return null;
  }

  /**
   * 校验 + 原子追加一个 update batch。
   *
   * 热路径：成功仅返回 `ok(undefined)`，**不主动生成 snapshot**，避免每次 append 复制/冻结
   * 整笔 O(n)。需要观察当前样本时由调用方显式 `getSnapshot()`（按需 copy）。
   * 未来 controller MUST NOT 每点调用 `getSnapshot`（例如 rAF 节流后才取）。
   */
  function appendBatch(batch: unknown, rule: PhaseRule): FreehandSessionResult<void> {
    const envelopeError = validateBatchEnvelope(batch);
    if (envelopeError) {
      return fail(envelopeError);
    }
    const value = batch as FreehandInputBatch;
    const validated = validateAndConvertSamples(
      value.samples,
      context.source,
      context.coordinateSpace,
      context.lockedViewport,
      nextSampleSequence,
      rule
    );
    if (!validated.ok) {
      return fail(validated.code);
    }
    // 原子 append：以上全部通过后才改变 state / 序号。
    for (const sample of validated.value) {
      buffer.push(sample);
    }
    nextBatchSequence += 1;
    nextSampleSequence += validated.value.length;
    return ok(undefined);
  }

  const session: FreehandSession = {
    getSnapshot,
    update(input) {
      if (state.status !== 'collecting') {
        return fail('not-collecting');
      }
      if (!input || typeof input !== 'object' || input.type !== 'update') {
        return fail('invalid-input');
      }
      return appendBatch(input.batch, 'update');
    },
    end(input) {
      if (state.status !== 'collecting') {
        return fail('not-collecting');
      }
      if (!input || typeof input !== 'object' || input.type !== 'end') {
        return fail('invalid-input');
      }
      const envelopeError = validateBatchEnvelope(input.batch);
      if (envelopeError) {
        return fail(envelopeError);
      }
      const value = input.batch;
      const validated = validateAndConvertSamples(
        value.samples,
        context.source,
        context.coordinateSpace,
        context.lockedViewport,
        nextSampleSequence,
        'end'
      );
      if (!validated.ok) {
        return fail(validated.code);
      }
      for (const sample of validated.value) {
        buffer.push(sample);
      }
      nextBatchSequence += 1;
      nextSampleSequence += validated.value.length;
      // end 一次性冻结 candidate 及每个 sample；随后释放 mutable buffer 减少驻留。
      candidate = freezeCandidate(context, buffer);
      buffer.length = 0;
      state = Object.freeze({ status: 'awaiting-commit' });
      return ok(awaitingSnapshot());
    },
    cancel(input) {
      if (state.status !== 'collecting') {
        // awaiting / committed / canceled 上的 cancel 被拒绝：不丢候选、不回滚。
        return fail('not-collecting');
      }
      if (!input || typeof input !== 'object' || input.type !== 'cancel') {
        return fail('invalid-input');
      }
      const value = input;
      if (
        !isNonEmptyString(value.sessionId) ||
        !isPointerId(value.pointerId) ||
        !SOURCES.includes(value.source)
      ) {
        return fail('invalid-input');
      }
      if (typeof value.reason !== 'string' || !CANCEL_REASONS.includes(value.reason)) {
        return fail('invalid-input');
      }
      if (!isNonNegativeSafeInteger(value.batchSequence)) {
        return fail('invalid-input');
      }
      if (
        value.sessionId !== context.sessionId ||
        value.pointerId !== context.pointerId ||
        value.source !== context.source
      ) {
        return fail('identity-mismatch');
      }
      if (value.batchSequence !== nextBatchSequence) {
        return fail('batch-sequence-mismatch');
      }
      state = Object.freeze({ status: 'canceled', reason: value.reason });
      // cancel 成功：丢弃未提交 mutable buffer，仅保留 canceled owner 信息。
      buffer.length = 0;
      return ok(canceledSnapshot());
    },
    applyCommitFeedback(feedback) {
      if (state.status !== 'awaiting-commit') {
        return fail('not-collecting');
      }
      if (!feedback || typeof feedback !== 'object' || !isNonEmptyString(feedback.commitId)) {
        return fail('invalid-input');
      }
      if (feedback.commitId !== (candidate as FreehandCandidate).commitId) {
        return fail('commit-id-mismatch');
      }
      if (feedback.type === 'commit-failed') {
        // 保留 awaiting 同 candidate / 同 commitId，供 controller 重试。
        return ok(awaitingSnapshot());
      }
      if (feedback.type === 'commit-succeeded') {
        if (
          !isNonEmptyString(feedback.objectId) ||
          !isNonNegativeSafeInteger(feedback.documentRevision)
        ) {
          return fail('invalid-input');
        }
        state = Object.freeze({
          status: 'committed',
          objectId: feedback.objectId,
          documentRevision: feedback.documentRevision,
        });
        return ok(committedSnapshot());
      }
      return fail('invalid-input');
    },
  };
  return session;
}

/**
 * begin 自由笔会话：验证输入、按落笔 source/capability 解析压力模式并锁定整笔、
 * 冻结 brush/viewport 快照，返回 collecting 会话。
 *
 * - auto 解析只在此调用一次 `resolvePressureMode`；不新增默认、不改现有 resolver。
 * - viewport 严格校验：必须已是规范形态（normalize 返回 null 或发生 clamp 都拒绝）。
 * - 任一步失败返回对应 code，不产生任何 state。
 */
export function beginFreehandSession(
  input: BeginFreehandSessionInput
): FreehandSessionResult<FreehandSession> {
  if (!input || typeof input !== 'object' || input.type !== 'begin') {
    return fail('invalid-input');
  }
  if (!isNonEmptyString(input.commitId)) {
    return fail('invalid-input');
  }
  if (!PRESSURE_CAPABILITIES.includes(input.pressureCapability)) {
    return fail('invalid-input');
  }

  const batch = input.batch as unknown as Record<string, unknown> | undefined;
  if (!batch || typeof batch !== 'object') {
    return fail('invalid-input');
  }
  if (
    !isNonEmptyString(batch.sessionId) ||
    !isPointerId(batch.pointerId) ||
    !SOURCES.includes(batch.source as InputSource)
  ) {
    return fail('invalid-input');
  }
  if (
    typeof batch.coordinateSpace !== 'string' ||
    !COORDINATE_SPACES.includes(batch.coordinateSpace as 'screen' | 'world')
  ) {
    return fail('invalid-input');
  }
  if (
    !isNonNegativeSafeInteger(batch.batchSequence) ||
    !isNonNegativeSafeInteger(batch.viewportRevision)
  ) {
    return fail('invalid-input');
  }

  const viewportSnapshot = input.viewportSnapshot;
  if (
    !viewportSnapshot ||
    typeof viewportSnapshot !== 'object' ||
    !isNonNegativeSafeInteger(viewportSnapshot.revision)
  ) {
    return fail('invalid-input');
  }
  const viewportInput = (viewportSnapshot as { viewport?: unknown }).viewport;
  if (!isViewportLike(viewportInput)) {
    return fail('invalid-input');
  }
  const normalizedViewport = normalizeViewportTransform(viewportInput);
  // normalize 返回 null（非法）或归一化后值与输入不同（被 clamp/改写）都拒绝：
  // 要求落笔 viewport 本身有限且已规范，不依赖 normalize 返回对象的引用 identity。
  if (!normalizedViewport || !sameViewportValues(normalizedViewport, viewportInput)) {
    return fail('invalid-input');
  }
  const lockedViewport = Object.freeze({
    scale: viewportInput.scale,
    tx: viewportInput.tx,
    ty: viewportInput.ty,
  });

  // brush 白名单拷贝 + 校验：剔除未知字段并冻结。
  const brushSnapshot = copyValidatedBrush(input.brush);
  if (!brushSnapshot) {
    return fail('invalid-input');
  }
  const rulerSnapshot =
    input.rulerSnapshot === undefined ? undefined : copyFreehandRuler(input.rulerSnapshot);
  if (rulerSnapshot === null) return fail('invalid-input');

  // begin 必须 batchSequence 0；viewportRevision 必须等于 begin 快照 revision。
  if (batch.batchSequence !== 0) {
    return fail('batch-sequence-mismatch');
  }
  if (batch.viewportRevision !== viewportSnapshot.revision) {
    return fail('viewport-revision-mismatch');
  }

  const source = batch.source as InputSource;
  const coordinateSpace = batch.coordinateSpace as 'screen' | 'world';
  const validated = validateAndConvertSamples(
    batch.samples,
    source,
    coordinateSpace,
    lockedViewport,
    0,
    'begin'
  );
  if (!validated.ok) {
    return fail(validated.code);
  }

  // 压力模式仅在此 begin 解析一次并整笔锁定。
  const resolvedPressureMode = resolvePressureMode(
    brushSnapshot.pressureMode,
    source,
    input.pressureCapability
  );

  const context: LockedContext = Object.freeze({
    ...(rulerSnapshot ? { rulerSnapshot } : {}),
    commitId: input.commitId,
    sessionId: batch.sessionId as string,
    pointerId: batch.pointerId as string | number,
    source,
    brushSnapshot,
    resolvedPressureMode,
    lockedViewport,
    lockedViewportRevision: viewportSnapshot.revision,
    coordinateSpace,
  });

  return ok(createCollectingSession(context, validated.value));
}
