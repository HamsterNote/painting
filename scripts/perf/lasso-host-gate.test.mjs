import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuRows, hostVerdict, queryTraceMetrics, versionOrder } from './lasso-host-gate.mjs';
import { pairVerdict } from './lasso-clean-pair.mjs';
const before = cpuRows('cpu0 0 0 0 0 0 0 0 0 0 0');
const after = cpuRows('cpu0 10 0 10 80 0 0 0 0 500 500');
test('load over 3 rejects a six-core round even with 80% idle; guest ticks are not double-counted', () => {
  assert.equal(after[0].total, 100);
  assert.equal(hostVerdict(before, after, [3, 8, 9], [3, 8, 9], 6).valid, true);
  assert.equal(hostVerdict(before, after, [3.01, 0, 0], [2, 0, 0], 6).valid, false);
});

test('a contaminated side, stale comparison or mismatched hit set invalidates the whole pair', () => {
  const a = {
    label: 'A',
    before: { valid: true },
    after: { valid: true },
    cold: true,
    queryThreadCpuMs: 1,
    selected: ['x'],
    startedAt: 0,
    endedAt: 10,
  };
  const b = { ...a, label: 'B', startedAt: 11, endedAt: 20 };
  assert.equal(pairVerdict([a, b]), true);
  assert.equal(pairVerdict([a, { ...b, before: { valid: false } }]), false);
  assert.equal(pairVerdict([a, { ...b, startedAt: 60000 }]), false);
  assert.equal(pairVerdict([a, { ...b, selected: [] }]), false);
  assert.equal(pairVerdict([a, { ...b, queryThreadCpuMs: undefined }]), false);
  assert.equal(pairVerdict([a]), false);
});
test('idle and counter failures reject misleading samples', () => {
  const busy = cpuRows('cpu0 70 0 10 20 0 0 0 0');
  assert.equal(hostVerdict(before, busy, [1, 0, 0], [1, 0, 0], 6).valid, false);
  assert.throws(() => hostVerdict(after, before, [1, 0, 0], [1, 0, 0], 6));
  assert.throws(() => hostVerdict(before, before, [1, 0, 0], [1, 0, 0], 6));
  assert.throws(() => hostVerdict(before, after, [], [], 6));
});
test('AB/BA pairing alternates, and CPU uses thread ticks regardless of wall scheduling', () => {
  assert.deepEqual(
    [versionOrder(0), versionOrder(1)],
    [
      ['A', 'B'],
      ['B', 'A'],
    ]
  );
  const events = [
    { name: 'kernel:start', pid: 1, tid: 2, ts: 0, tts: 1000 },
    { name: 'kernel:end', pid: 1, tid: 2, ts: 100000, tts: 3000 },
    { name: 'MinorGC', pid: 1, tid: 2, ph: 'X', ts: 1000, dur: 100 },
    { name: 'MajorGC', pid: 1, tid: 3, ph: 'X', ts: 1000, dur: 100 },
  ];
  assert.equal(queryTraceMetrics(events).queryThreadCpuMs, 2);
  assert.equal(queryTraceMetrics(events).minorGCCount, 1);
  assert.equal(queryTraceMetrics(events).majorGCCount, 0);
  events[1].ts *= 20;
  assert.equal(queryTraceMetrics(events).queryThreadCpuMs, 2);
  assert.throws(() => queryTraceMetrics([events[0], { ...events[1], tid: 3 }]));
  delete events[1].tts;
  assert.throws(() => queryTraceMetrics(events));
});
