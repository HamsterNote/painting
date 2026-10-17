import type { DrawingStrokeV2, DrawingValueV2 } from '@hamster-note/painting/core';

export const EDITOR_PERFORMANCE_WORKLOAD = Object.freeze({
  version: 1,
  seed: 0x5eed_cafe,
  strokeCount: 100_000,
  description: '确定性 V2 pen workload；含正负 1_000_000_000 ± .125 附近坐标及有限可见对象。',
});

export type PerformancePointerSample = Readonly<{
  eventId: string | null;
  sequence: number | null;
  scheduledAt: number | null;
  callbackAt: number | null;
  backlogAtCallback: number | null;
  emittedAt: number;
  receivedAt: number | null;
  phase: 'down' | 'move' | 'up' | 'cancel';
  pointerId: number | string;
  nextFrameAt: number | null;
  nextFrameLatencyMs: number | null;
  commitAt: number | null;
  commitLatencyMs: number | null;
  invalidReason: string | null;
}>;

type MutablePerformancePointerSample = {
  eventId: string | null;
  sequence: number | null;
  scheduledAt: number | null;
  callbackAt: number | null;
  backlogAtCallback: number | null;
  emittedAt: number;
  receivedAt: number | null;
  phase: 'down' | 'move' | 'up' | 'cancel';
  pointerId: number | string;
  nextFrameAt: number | null;
  nextFrameLatencyMs: number | null;
  commitAt: number | null;
  commitLatencyMs: number | null;
  invalidReason: string | null;
};

export type PerformancePointerEmission = Readonly<{
  eventId: string;
  sequence: number;
  /** The absolute open-loop deadline established before any event is dispatched. */
  scheduledAt: number;
  /** Timer callback entry time. It exposes scheduler backlog without changing dispatch load. */
  callbackAt: number;
  /** Number of earlier absolute deadlines still pending at this callback. */
  backlogAtCallback: number;
  emittedAt: number;
  phase: PerformancePointerSample['phase'];
  pointerId: number | string;
}>;

export type PerformanceLongTaskSample = Readonly<{
  startTime: number;
  duration: number;
  eventIds: readonly string[];
  commitEventIds: readonly string[];
}>;

/**
 * 窗口内采集到的原始 longtask 条目；此时不与 pointerSamples 关联，避免在 observer 回调里
 * 反复扫描不断增长的样本集合。`pointerSampleCount` 固定该条目被观察到那一刻的样本前缀，
 * 令延迟到 stop 的关联仍保持与回调当时完全一致的 eventId / commitEventIds 语义与窗口范围。
 */
type PendingLongTask = Readonly<{
  startTime: number;
  duration: number;
  pointerSampleCount: number;
}>;

export type PerformanceMeasurementWindow = Readonly<{
  startedAt: number | null;
  stoppedAt: number | null;
}>;

export type EditorPerformanceMeasurements = {
  pointerSamples: MutablePerformancePointerSample[];
  pendingFrameSamples: MutablePerformancePointerSample[];
  rafIntervalsMs: number[];
  lastRafAt: number | null;
  longTasks: PerformanceLongTaskSample[];
  pendingLongTasks: PendingLongTask[];
  rafStatus: 'active' | 'stopped';
  longTaskStatus: 'pending' | 'supported' | 'unsupported';
  nextFrameRequest: number | null;
  pendingPointerEmissions: PerformancePointerEmission[];
  lastReceiptSequenceByPointer: Map<number | string, number>;
  measurementWindow: { startedAt: number | null; stoppedAt: number | null };
};

export interface HamsterEditorPerformanceApi {
  getSnapshot: () => Record<string, unknown>;
  resetMeasurements: () => void;
  runHighRatePenInput: (
    options: Readonly<{ eventsPerSecond: number; durationMs: number }>
  ) => Promise<Record<string, unknown>>;
  runRebaseProbe: () => Record<string, unknown>;
}

declare global {
  interface Window {
    __hamsterEditorPerf?: HamsterEditorPerformanceApi;
  }
}

function nextRandom(state: { value: number }): number {
  state.value = (Math.imul(state.value, 1_664_525) + 1_013_904_223) >>> 0;
  return state.value / 0x1_0000_0000;
}

function workloadPoint(
  index: number,
  random: { value: number }
): Readonly<{ x: number; y: number }> {
  // 每 256 条保留一条局部有限对象，确保当前 1440x900 视区存在可见、可命中的正式条目。
  if (index % 256 === 0) {
    return {
      x: 48 + (index % 1_408),
      y: 48 + (Math.floor(index / 256) % 804),
    };
  }
  const quadrant = index % 4;
  const signX = quadrant === 0 || quadrant === 1 ? 1 : -1;
  const signY = quadrant === 0 || quadrant === 2 ? 1 : -1;
  return {
    x: signX * 1_000_000_000 + (nextRandom(random) - 0.5) * 1_600,
    y: signY * 1_000_000_000 + (nextRandom(random) - 0.5) * 1_600,
  };
}

/**
 * 只服务 production Web 合同的可测原始数据，非 native 接口；只在 perf route 的 lazy state
 * initializer 中调用，普通 route 永不构造此文档。
 */
export function createEditorPerformanceWorkload(): DrawingValueV2 {
  const random = { value: EDITOR_PERFORMANCE_WORKLOAD.seed };
  const strokes: DrawingStrokeV2[] = new Array(EDITOR_PERFORMANCE_WORKLOAD.strokeCount);
  const boundaryPoints = [
    { x: 1_000_000_000.125, y: 1_000_000_000.125 },
    { x: 999_999_999.875, y: 999_999_999.875 },
    { x: -999_999_999.875, y: -999_999_999.875 },
    { x: -1_000_000_000.125, y: -1_000_000_000.125 },
  ] as const;
  for (let index = 0; index < strokes.length; index += 1) {
    const first = boundaryPoints[index] ?? workloadPoint(index, random);
    strokes[index] = {
      schemaVersion: 2,
      id: `performance-stroke-${index}`,
      tool: 'pen',
      points: [
        first,
        {
          x: first.x + 0.25 + nextRandom(random) * 2,
          y: first.y + 0.25 + nextRandom(random) * 2,
        },
      ],
      strokeColor: '#172033',
      strokeWidth: 1.5,
    };
  }
  return { schemaVersion: 2, strokes };
}

/** FNV-1a 的数值摘要用于 runner 对照确定性 workload，不是安全散列。 */
export function checksumPerformanceDocument(document: DrawingValueV2): string {
  let hash = 0x811c9dc5;
  const add = (value: number) => {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  add(document.strokes.length);
  for (const stroke of document.strokes) {
    add(stroke.points[0]?.x ?? 0);
    add(stroke.points[0]?.y ?? 0);
    add(stroke.points[1]?.x ?? 0);
    add(stroke.points[1]?.y ?? 0);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function readEditorPerformanceMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('perf') === '1';
}

export function createEditorPerformanceMeasurements(): EditorPerformanceMeasurements {
  return {
    pointerSamples: [],
    pendingFrameSamples: [],
    rafIntervalsMs: [],
    lastRafAt: null,
    longTasks: [],
    pendingLongTasks: [],
    rafStatus: 'stopped',
    longTaskStatus: 'pending',
    nextFrameRequest: null,
    pendingPointerEmissions: [],
    lastReceiptSequenceByPointer: new Map(),
    measurementWindow: { startedAt: null, stoppedAt: null },
  };
}

function serializableSample(sample: MutablePerformancePointerSample): PerformancePointerSample {
  return {
    eventId: sample.eventId,
    sequence: sample.sequence,
    scheduledAt: sample.scheduledAt,
    callbackAt: sample.callbackAt,
    backlogAtCallback: sample.backlogAtCallback,
    emittedAt: sample.emittedAt,
    receivedAt: sample.receivedAt,
    phase: sample.phase,
    pointerId: sample.pointerId,
    nextFrameAt: sample.nextFrameAt,
    nextFrameLatencyMs: sample.nextFrameLatencyMs,
    commitAt: sample.commitAt,
    commitLatencyMs: sample.commitLatencyMs,
    invalidReason: sample.invalidReason,
  };
}

export function measurementSnapshot(
  measurements: EditorPerformanceMeasurements
): Record<string, unknown> {
  return {
    pointerSamples: measurements.pointerSamples.map(serializableSample),
    window: { ...measurements.measurementWindow },
    raf: {
      status: measurements.rafStatus,
      intervalsMs: [...measurements.rafIntervalsMs],
    },
    longTasks: {
      status: measurements.longTaskStatus,
      entries: measurements.longTasks.map((entry) => ({
        startTime: entry.startTime,
        duration: entry.duration,
        eventIds: [...entry.eventIds],
        commitEventIds: [...entry.commitEventIds],
      })),
    },
  };
}

export function resetEditorPerformanceMeasurements(
  measurements: EditorPerformanceMeasurements
): void {
  measurements.pointerSamples.length = 0;
  measurements.pendingFrameSamples.length = 0;
  measurements.rafIntervalsMs.length = 0;
  measurements.lastRafAt = null;
  measurements.longTasks.length = 0;
  measurements.pendingLongTasks.length = 0;
  measurements.pendingPointerEmissions.length = 0;
  measurements.lastReceiptSequenceByPointer.clear();
  measurements.measurementWindow.startedAt = null;
  measurements.measurementWindow.stoppedAt = null;
}

/** Starts the formal window at the exact timestamp recorded immediately before dispatch one. */
export function beginEditorPerformanceMeasurementWindow(
  measurements: EditorPerformanceMeasurements,
  startedAt: number
): void {
  if (measurements.measurementWindow.startedAt !== null) return;
  measurements.measurementWindow.startedAt = startedAt;
  measurements.measurementWindow.stoppedAt = null;
  measurements.lastRafAt = null;
}

function invalidateSample(sample: MutablePerformancePointerSample, reason: string): void {
  if (sample.invalidReason === null) sample.invalidReason = reason;
}

/**
 * rAF 仅反映主线程回调节奏而非 GPU 帧；PointerEvent 合成也不等于硬件输入。longtask 只在
 * 浏览器实现该 observer 时记录。采样是命令式 ref 写入，不触发 React state 或人为补齐缺失数据。
 */
export function startEditorPerformanceSampling(
  measurements: EditorPerformanceMeasurements
): () => void {
  let cancelled = false;
  let observer: PerformanceObserver | null = null;
  measurements.rafStatus = 'active';
  const sampleFrame = (now: number) => {
    if (cancelled) return;
    if (measurements.measurementWindow.startedAt === null) {
      measurements.nextFrameRequest = window.requestAnimationFrame(sampleFrame);
      return;
    }
    if (measurements.lastRafAt !== null)
      measurements.rafIntervalsMs.push(now - measurements.lastRafAt);
    measurements.lastRafAt = now;
    if (measurements.pendingFrameSamples.length > 0) {
      const remaining: MutablePerformancePointerSample[] = [];
      for (const sample of measurements.pendingFrameSamples) {
        // rAF's timestamp denotes the start of its frame. A callback later in that same frame can
        // receive a pointer event, so this callback cannot be that receipt's "next" frame.
        if (sample.receivedAt === null || now < sample.receivedAt) {
          remaining.push(sample);
          continue;
        }
        sample.nextFrameAt = now;
        sample.nextFrameLatencyMs = now - sample.emittedAt;
        if (sample.receivedAt < sample.emittedAt) {
          invalidateSample(sample, 'receipt-before-emission-clock-order');
        } else if (now < sample.emittedAt) {
          invalidateSample(sample, 'next-frame-before-emission-clock-order');
        }
      }
      measurements.pendingFrameSamples = remaining;
    }
    measurements.nextFrameRequest = window.requestAnimationFrame(sampleFrame);
  };
  measurements.nextFrameRequest = window.requestAnimationFrame(sampleFrame);
  if (typeof PerformanceObserver === 'undefined') {
    measurements.longTaskStatus = 'unsupported';
  } else {
    try {
      observer = new PerformanceObserver((entries) => {
        const windowStartedAt = measurements.measurementWindow.startedAt;
        for (const entry of entries.getEntries()) {
          // Buffered entries before formal dispatch are outside the contract window.
          if (windowStartedAt === null || entry.startTime < windowStartedAt) continue;
          // 先只记录原始条目与当时的样本前缀长度，避免在回调里扫描 pointerSamples。
          measurements.pendingLongTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            pointerSampleCount: measurements.pointerSamples.length,
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      measurements.longTaskStatus = 'supported';
    } catch {
      measurements.longTaskStatus = 'unsupported';
      observer?.disconnect();
      observer = null;
    }
  }
  return () => {
    cancelled = true;
    measurements.rafStatus = 'stopped';
    if (measurements.nextFrameRequest !== null)
      window.cancelAnimationFrame(measurements.nextFrameRequest);
    measurements.nextFrameRequest = null;
    observer?.disconnect();
    // 延迟到 stop 才把原始 longtask 与样本关联：此时样本集合已稳定，且用条目记录的
    // pointerSampleCount 前缀保证与回调当时扫描的结果完全一致。
    correlateEditorPerformanceLongTasks(measurements);
    measurements.measurementWindow.stoppedAt = performance.now();
  };
}

/** Records the formal synthetic event immediately before its host dispatch. */
export function queuePerformancePointerEmission(
  measurements: EditorPerformanceMeasurements,
  emission: PerformancePointerEmission
): void {
  measurements.pendingPointerEmissions.push(emission);
}

export function recordPerformancePointerInput(
  measurements: EditorPerformanceMeasurements,
  pointerId: number | string,
  phase: PerformancePointerSample['phase'],
  receiptEmission: PerformancePointerEmission | null
): MutablePerformancePointerSample {
  const receivedAt = performance.now();
  const emissionIndex = receiptEmission
    ? measurements.pendingPointerEmissions.findIndex(
        (candidate) => candidate.eventId === receiptEmission.eventId
      )
    : -1;
  const emission = emissionIndex === -1 ? null : receiptEmission;
  if (emission !== null) measurements.pendingPointerEmissions.splice(emissionIndex, 1);
  const expectedSequence = (measurements.lastReceiptSequenceByPointer.get(pointerId) ?? 0) + 1;
  const linkageFailure =
    receiptEmission === null
      ? 'receipt-without-emission-identity'
      : emission === null
        ? 'receipt-emission-not-pending'
        : receiptEmission.pointerId !== pointerId
          ? 'receipt-pointer-mismatch'
          : receiptEmission.phase !== phase
            ? `receipt-phase-mismatch:expected-${receiptEmission.phase}:received-${phase}`
            : receiptEmission.sequence !== expectedSequence
              ? `receipt-sequence-mismatch:expected-${expectedSequence}:received-${receiptEmission.sequence}`
              : null;
  const sample: MutablePerformancePointerSample = {
    // A capture listener reads this immutable identity from the exact dispatched event. The
    // adapter receipt may use it only when pointer, phase, and pending sequence all agree.
    eventId: receiptEmission?.eventId ?? null,
    sequence: receiptEmission?.sequence ?? null,
    scheduledAt: receiptEmission?.scheduledAt ?? null,
    callbackAt: receiptEmission?.callbackAt ?? null,
    backlogAtCallback: receiptEmission?.backlogAtCallback ?? null,
    emittedAt: receiptEmission?.emittedAt ?? receivedAt,
    receivedAt,
    phase,
    pointerId,
    nextFrameAt: null,
    nextFrameLatencyMs: null,
    commitAt: null,
    commitLatencyMs: null,
    invalidReason:
      linkageFailure ??
      (receiptEmission !== null && receivedAt < receiptEmission.emittedAt
        ? 'receipt-before-emission-clock-order'
        : null),
  };
  measurements.pointerSamples.push(sample);
  if (linkageFailure === null && receiptEmission !== null) {
    measurements.lastReceiptSequenceByPointer.set(pointerId, receiptEmission.sequence);
  }
  if (sample.invalidReason === null) measurements.pendingFrameSamples.push(sample);
  return sample;
}

/** Converts dispatches that never reached the adapter into auditable invalid samples. */
export function finalizePerformancePointerEmissions(
  measurements: EditorPerformanceMeasurements
): void {
  for (const emission of measurements.pendingPointerEmissions.splice(0)) {
    measurements.pointerSamples.push({
      eventId: emission.eventId,
      sequence: emission.sequence,
      scheduledAt: emission.scheduledAt,
      callbackAt: emission.callbackAt,
      backlogAtCallback: emission.backlogAtCallback,
      emittedAt: emission.emittedAt,
      receivedAt: null,
      phase: emission.phase,
      pointerId: emission.pointerId,
      nextFrameAt: null,
      nextFrameLatencyMs: null,
      commitAt: null,
      commitLatencyMs: null,
      invalidReason: 'emission-without-adapter-receipt',
    });
  }
}

/**
 * 把窗口内采集的原始 longtask 条目与 pointerSamples 关联，生成对外暴露的 longtask 汇总。
 * 每条目只用被观察当时记录的 `pointerSampleCount` 前缀参与过滤，因此与原先在 observer
 * 回调里即时扫描得到的 eventIds / commitEventIds 完全一致，同时把回调侧工作降为 O(1)。
 */
export function correlateEditorPerformanceLongTasks(
  measurements: EditorPerformanceMeasurements
): void {
  if (measurements.pendingLongTasks.length === 0) return;
  for (const entry of measurements.pendingLongTasks) {
    const endTime = entry.startTime + entry.duration;
    const samples = measurements.pointerSamples.slice(0, entry.pointerSampleCount);
    measurements.longTasks.push({
      startTime: entry.startTime,
      duration: entry.duration,
      eventIds: samples
        .filter(
          (sample) =>
            sample.eventId !== null &&
            sample.emittedAt <= endTime &&
            (sample.nextFrameAt === null || sample.nextFrameAt >= entry.startTime)
        )
        .map((sample) => sample.eventId as string),
      commitEventIds: samples
        .filter(
          (sample) =>
            sample.eventId !== null &&
            sample.commitAt !== null &&
            sample.commitAt >= entry.startTime &&
            sample.commitAt <= endTime
        )
        .map((sample) => sample.eventId as string),
    });
  }
  measurements.pendingLongTasks.length = 0;
}

/**
 * Converts every unsettled formal event into auditable invalid data before the sampler stops.
 * This is deliberately not a repair path: a missing receipt, commit, or later frame fails the
 * workload prerequisite and remains visible in the sole raw measurement collection.
 */
export function finalizeEditorPerformanceMeasurementWindow(
  measurements: EditorPerformanceMeasurements
): void {
  finalizePerformancePointerEmissions(measurements);
  for (const sample of measurements.pointerSamples) {
    if (sample.receivedAt === null) invalidateSample(sample, 'emission-without-adapter-receipt');
    if (sample.commitAt === null) invalidateSample(sample, 'receipt-without-react-commit');
    if (sample.nextFrameAt === null) invalidateSample(sample, 'receipt-without-next-frame');
  }
}

export function recordPerformanceCommit(
  measurements: EditorPerformanceMeasurements,
  sample: MutablePerformancePointerSample | null
): void {
  if (!sample || sample.commitAt !== null) return;
  sample.commitAt = performance.now();
  sample.commitLatencyMs = sample.commitAt - sample.emittedAt;
  if (sample.receivedAt === null) {
    invalidateSample(sample, 'commit-without-adapter-receipt');
  } else if (sample.commitAt < sample.receivedAt || sample.receivedAt < sample.emittedAt) {
    invalidateSample(sample, 'commit-clock-order-violation');
  }
}
