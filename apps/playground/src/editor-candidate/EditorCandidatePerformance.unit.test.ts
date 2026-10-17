/// <reference types="jest" />
/**
 * EditorCandidatePerformance 的聚焦单元测试（纯逻辑，无 DOM/React 依赖）。
 *
 * 只覆盖本次 P0 优化改动中最易回归的语义：longtask 原始条目采集与「延迟到 stop 的关联」，
 * 必须与原先在 PerformanceObserver 回调里即时扫描 pointerSamples 得到的 eventId /
 * commitEventIds 完全一致，且只使用条目被观察那一刻的样本前缀。
 */
import {
  beginEditorPerformanceMeasurementWindow,
  correlateEditorPerformanceLongTasks,
  createEditorPerformanceMeasurements,
  measurementSnapshot,
  queuePerformancePointerEmission,
  recordPerformanceCommit,
  recordPerformancePointerInput,
  resetEditorPerformanceMeasurements,
} from './EditorCandidatePerformance.web';

type Measurements = ReturnType<typeof createEditorPerformanceMeasurements>;

/** 构造并登记一次正式 emission，再通过 adapter receipt 生成 pointer sample。 */
function emitAndReceive(
  measurements: Measurements,
  eventId: string,
  sequence: number,
  phase: 'down' | 'move' | 'up'
) {
  const emission = {
    eventId,
    sequence,
    scheduledAt: 0,
    callbackAt: 0,
    backlogAtCallback: 0,
    emittedAt: 0,
    phase,
    pointerId: 7,
  } as const;
  queuePerformancePointerEmission(measurements, emission);
  const sample = recordPerformancePointerInput(measurements, 7, phase, emission);
  recordPerformanceCommit(measurements, sample);
  return sample;
}

describe('correlateEditorPerformanceLongTasks', () => {
  it('只关联条目被观察那一刻的样本前缀，排除之后新增的样本', () => {
    const measurements = createEditorPerformanceMeasurements();
    beginEditorPerformanceMeasurementWindow(measurements, 0);

    const first = emitAndReceive(measurements, 'run-event-1', 1, 'down');
    first.emittedAt = 3;
    first.nextFrameAt = 10;
    first.commitAt = 8;

    // 条目在「只有一个样本」时被观察到：固定前缀长度为 1。
    measurements.pendingLongTasks.push({
      startTime: 5,
      duration: 20,
      pointerSampleCount: measurements.pointerSamples.length,
    });

    // 该条目观察之后才到达的样本：即使其时间落在 longtask 区间内，也不得被关联。
    const second = emitAndReceive(measurements, 'run-event-2', 2, 'up');
    second.emittedAt = 6;
    second.nextFrameAt = 20;
    second.commitAt = 9;

    correlateEditorPerformanceLongTasks(measurements);

    expect(measurements.longTasks).toHaveLength(1);
    expect(measurements.longTasks[0].eventIds).toEqual(['run-event-1']);
    expect(measurements.longTasks[0].commitEventIds).toEqual(['run-event-1']);
    expect(measurements.pendingLongTasks).toHaveLength(0);

    const snapshot = measurementSnapshot(measurements) as unknown as {
      longTasks: { entries: Array<{ eventIds: string[]; commitEventIds: string[] }> };
    };
    expect(snapshot.longTasks.entries[0].eventIds).toEqual(['run-event-1']);
    expect(snapshot.longTasks.entries[0].commitEventIds).toEqual(['run-event-1']);
  });

  it('区间与 nextFrameAt / commitAt 边界过滤与回调即时扫描一致', () => {
    const measurements = createEditorPerformanceMeasurements();
    beginEditorPerformanceMeasurementWindow(measurements, 0);

    // inRange：emittedAt <= endTime 且 nextFrameAt >= startTime -> 命中
    const inRange = emitAndReceive(measurements, 'in-range', 1, 'down');
    inRange.emittedAt = 5;
    inRange.nextFrameAt = 5;
    inRange.commitAt = 25;
    // emittedAfterEnd：emittedAt 超过 endTime -> 不命中
    const emittedAfterEnd = emitAndReceive(measurements, 'emitted-after-end', 2, 'move');
    emittedAfterEnd.emittedAt = 26;
    emittedAfterEnd.nextFrameAt = 26;
    emittedAfterEnd.commitAt = 26;
    // frameBeforeStart：nextFrameAt < startTime -> 不命中
    const frameBeforeStart = emitAndReceive(measurements, 'frame-before-start', 3, 'up');
    frameBeforeStart.emittedAt = 4;
    frameBeforeStart.nextFrameAt = 4;
    frameBeforeStart.commitAt = 24;

    measurements.pendingLongTasks.push({
      startTime: 5,
      duration: 20,
      pointerSampleCount: measurements.pointerSamples.length,
    });
    correlateEditorPerformanceLongTasks(measurements);

    expect(measurements.longTasks[0].eventIds).toEqual(['in-range']);
    // commitEventIds 使用 [startTime, endTime] 闭区间：in-range 与 frame-before-start 的 commitAt
    // 均落在区间内（25 / 24），emitted-after-end 的 commitAt=26 超出。
    expect(measurements.longTasks[0].commitEventIds).toEqual(['in-range', 'frame-before-start']);
  });

  it('reset 清除原始 longtask 条目', () => {
    const measurements = createEditorPerformanceMeasurements();
    measurements.pendingLongTasks.push({ startTime: 0, duration: 1, pointerSampleCount: 0 });
    resetEditorPerformanceMeasurements(measurements);
    expect(measurements.pendingLongTasks).toHaveLength(0);
    expect(measurements.longTasks).toHaveLength(0);
  });
});
