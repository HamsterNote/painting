/// <reference types="jest" />
/**
 * performance-only synthetic input scheduler 的聚焦单测（纯 helper + 受控 fake timer）。
 *
 * 覆盖本次最小可审计修复：
 *  - 1200 个绝对 120Hz deadline，且 startAt 由 armingStartedAt + 100ms prearm lead 得到；
 *  - 初始/重排 setTimeout delay 向上取整；早醒重排只重排同一 event、不产生额外 event 且计数准确；
 *  - settlement/unmount（shouldContinue=false）后不再重排或派发；
 *  - arming 未记录或晚于 startAt 视为超窗 INVALID。
 *
 * Surface 模块会导入 react-native 与 Skia，故 mock 掉非纯依赖，只验证纯排程核心。
 */
jest.mock('react-native', () => {
  const React = require('react');
  const component = (name: string) => {
    const Mock = ({ children }: { children?: unknown }) =>
      React.createElement(name, null, children);
    Mock.displayName = `RNMock(${name})`;
    return Mock;
  };
  return {
    Pressable: component('rn-pressable'),
    Text: component('rn-text'),
    View: component('rn-view'),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

jest.mock(
  '@shopify/react-native-skia',
  () => ({
    Skia: {
      Color: (value: string) => value,
      Path: { Make: () => ({ moveTo() {}, lineTo() {}, close() {}, setFillType() {} }) },
      ParagraphBuilder: {
        Make: () => ({ pushStyle() {}, addText() {}, build: () => ({ layout() {} }) }),
      },
      Image: { MakeImageFromEncoded: () => null },
      Data: { fromBase64: () => ({}) },
    },
  }),
  { virtual: true }
);

jest.mock('@hamster-note/painting/skia', () => ({ WebShapedRunProvider: class {} }));

import {
  buildPerformanceDeadlines,
  classifySchedulerWakeup,
  isArmingOverrun,
  nextSchedulerDelayMs,
  PERF_SCHEDULER_PREARM_LEAD_MS,
  schedulePerformanceDeadlines,
  type PerformanceDeadline,
  type PerformanceDeadlineSchedulerCounters,
} from './EditorCandidateSurface.web';

type FakeTimer = { at: number; handler: () => void };

/** 受控 fake timer 队列：按最早 `at` 弹出，模拟浏览器 timer 顺序。 */
function popEarliest(timers: FakeTimer[]): FakeTimer {
  let earliestIndex = 0;
  for (let index = 1; index < timers.length; index += 1) {
    if (timers[index].at < timers[earliestIndex].at) earliestIndex = index;
  }
  return timers.splice(earliestIndex, 1)[0];
}

function emptyCounters(): PerformanceDeadlineSchedulerCounters {
  return { timerAttemptCount: 0, earlyRetryCount: 0 };
}

describe('buildPerformanceDeadlines / prearm lead', () => {
  it('places startAt after armingStartedAt and builds 1200 absolute 120Hz deadlines', () => {
    const armingStartedAt = 1_234.5;
    const startAt = armingStartedAt + PERF_SCHEDULER_PREARM_LEAD_MS;
    const deadlines = buildPerformanceDeadlines(startAt, 1200, 120);

    expect(PERF_SCHEDULER_PREARM_LEAD_MS).toBe(100);
    // prearm 严格先于 start：arming 不在正式窗口内。
    expect(startAt).toBeGreaterThan(armingStartedAt);
    expect(deadlines).toHaveLength(1200);
    expect(deadlines[0]).toEqual({ index: 0, scheduledAt: startAt });
    expect(deadlines[1199].index).toBe(1199);
    expect(deadlines[1199].scheduledAt).toBeCloseTo(startAt + 1199 * (1_000 / 120), 9);
    expect(deadlines[1199].scheduledAt - deadlines[0].scheduledAt).toBeCloseTo(
      1199 * (1_000 / 120),
      9
    );
    for (let index = 1; index < deadlines.length; index += 1) {
      expect(deadlines[index].scheduledAt).toBeGreaterThan(deadlines[index - 1].scheduledAt);
    }
  });
});

describe('nextSchedulerDelayMs / classifySchedulerWakeup', () => {
  it('ceil-delays and never returns a negative delay', () => {
    expect(nextSchedulerDelayMs(0, 0.2)).toBe(1);
    expect(nextSchedulerDelayMs(0, 5)).toBe(5);
    expect(nextSchedulerDelayMs(0, 5.0000001)).toBe(6);
    expect(nextSchedulerDelayMs(10, 5)).toBe(0);
    expect(nextSchedulerDelayMs(10, 10)).toBe(0);
  });

  it('only dispatches when callbackAt >= scheduledAt', () => {
    expect(classifySchedulerWakeup(99.9, 100)).toBe('reschedule-early');
    expect(classifySchedulerWakeup(100, 100)).toBe('dispatch');
    expect(classifySchedulerWakeup(100.001, 100)).toBe('dispatch');
  });

  it('treats missing or late arming as overrun', () => {
    expect(isArmingOverrun(null, 100)).toBe(true);
    expect(isArmingOverrun(100.001, 100)).toBe(true);
    expect(isArmingOverrun(100, 100)).toBe(false);
    expect(isArmingOverrun(99.999, 100)).toBe(false);
  });
});

describe('schedulePerformanceDeadlines (controlled fake timers)', () => {
  it('reschedules the same deadline on early wake without creating extra events', () => {
    const counters = emptyCounters();
    let now = 1_000;
    const timers: FakeTimer[] = [];
    const dispatched: number[] = [];
    schedulePerformanceDeadlines(counters, {
      deadlines: [
        { index: 0, scheduledAt: 1_100 },
        { index: 1, scheduledAt: 1_200 },
      ] as readonly PerformanceDeadline[],
      now: () => now,
      setTimeout: (handler, delayMs) => {
        timers.push({ at: now + delayMs, handler });
      },
      shouldContinue: () => true,
      onDeadline: (deadline) => {
        dispatched.push(deadline.index);
      },
    });

    // 初始 2 个 event 各注册一次。
    expect(counters.timerAttemptCount).toBe(2);

    // event 0 第一次唤醒提前 0.4ms：只重排、不派发。
    const firstWake = popEarliest(timers);
    now = firstWake.at - 0.4;
    firstWake.handler();
    expect(dispatched).toEqual([]);
    expect(counters.earlyRetryCount).toBe(1);
    expect(counters.timerAttemptCount).toBe(3);

    // 重排后按 ceil 落在 deadline 之后，派发 event 0 恰好一次。
    const retried = popEarliest(timers);
    expect(retried.at).toBeGreaterThanOrEqual(1_100);
    now = retried.at;
    retried.handler();
    expect(dispatched).toEqual([0]);

    // event 1 正常到点，仍只派发一次。
    const secondWake = popEarliest(timers);
    now = secondWake.at;
    secondWake.handler();
    expect(dispatched).toEqual([0, 1]);
    expect(counters.timerAttemptCount).toBe(3);
    expect(counters.earlyRetryCount).toBe(1);
  });

  it('dispatches all 1200 prearmed deadlines exactly once when timers fire on time', () => {
    const counters = emptyCounters();
    let now = 0;
    const timers: FakeTimer[] = [];
    const order: number[] = [];
    const startAt = PERF_SCHEDULER_PREARM_LEAD_MS;
    const deadlines = buildPerformanceDeadlines(startAt, 1200, 120);

    const allRegisteredAt = schedulePerformanceDeadlines(counters, {
      deadlines,
      now: () => now,
      setTimeout: (handler, delayMs) => {
        timers.push({ at: now + delayMs, handler });
      },
      shouldContinue: () => true,
      onDeadline: (deadline) => {
        order.push(deadline.index);
      },
    });

    // 全部 1200 个 deadline 在窗口开始前注册完毕。
    expect(counters.timerAttemptCount).toBe(1200);
    expect(allRegisteredAt).toBeLessThanOrEqual(startAt);

    let guard = 0;
    while (timers.length > 0 && guard < 2_000) {
      const timer = popEarliest(timers);
      now = timer.at;
      timer.handler();
      guard += 1;
    }

    expect(order).toHaveLength(1200);
    expect(order[0]).toBe(0);
    expect(order[1199]).toBe(1199);
    expect(new Set(order).size).toBe(1200);
    expect(counters.earlyRetryCount).toBe(0);
    expect(counters.timerAttemptCount).toBe(1200);
  });

  it('stops rescheduling and dispatch after settlement/unmount', () => {
    const counters = emptyCounters();
    let alive = true;
    const timers: FakeTimer[] = [];
    const dispatched: number[] = [];
    schedulePerformanceDeadlines(counters, {
      deadlines: [{ index: 0, scheduledAt: 10 }] as readonly PerformanceDeadline[],
      now: () => 0,
      setTimeout: (handler, delayMs) => {
        timers.push({ at: delayMs, handler });
      },
      shouldContinue: () => alive,
      onDeadline: (deadline) => {
        dispatched.push(deadline.index);
      },
    });

    alive = false;
    popEarliest(timers).handler();
    expect(dispatched).toEqual([]);
    // 早醒 guard 也不会在停止后追加新的 timer。
    expect(timers).toHaveLength(0);
    expect(counters.timerAttemptCount).toBe(1);
    expect(counters.earlyRetryCount).toBe(0);
  });
});
