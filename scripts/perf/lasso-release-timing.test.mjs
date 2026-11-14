import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lassoReleaseTiming,
  releaseThresholdMs,
  summarizeReleaseTiming,
} from './lasso-release-timing.mjs';

const mark = (event, time, extra = {}) => ({
  event,
  time,
  session: 7,
  version: 601,
  pointCount: 602,
  final: event !== 'input',
  ok: true,
  ...extra,
});
const fixture = () => ({
  events: [{ type: 'pointerup', stamp: 100, time: 107 }],
  selected: [],
  selectionDOM: null,
  marks: [
    mark('input', 90, { version: 600, pointCount: 601 }),
    mark('input', 108), // Last sample appended by the pointerup handler itself.
    mark('query-start', 110),
    mark('query-complete', 120),
    mark('selection-submit', 140),
  ],
});

test('empty selection completes at setSelection return; use event timestamp, not listener/query/Paint time', () => {
  const timing = lassoReleaseTiming(fixture());
  assert.equal(timing.ok, true);
  assert.deepEqual(
    [
      timing.pointerupTimestamp,
      timing.pointerupObservedAt,
      timing.session,
      timing.version,
      timing.pointCount,
      timing.submissionCompletedAt,
    ],
    [100, 107, 7, 601, 602, 140]
  );
  assert.equal(timing.releaseToSubmitMs, 40);
  assert.equal(timing.releaseToQueryStartMs + timing.queryMs + timing.completionToSubmitMs, 40);
});

test('a stale prefix/session/point count cannot supply final submission', () => {
  for (const extra of [{ version: 600 }, { session: 6 }, { pointCount: 601 }, { final: false }]) {
    const raw = fixture();
    raw.marks.at(-1) && Object.assign(raw.marks.at(-1), extra);
    assert.equal(lassoReleaseTiming(raw).ok, false);
    assert.equal(lassoReleaseTiming(raw).releaseToSubmitMs, null);
  }
});

test('missing, failed, cancelled, duplicated and out-of-order commits are not successful measurements', () => {
  const variants = [
    (r) => r.marks.pop(),
    (r) => {
      r.marks[3].ok = false;
    },
    (r) => {
      r.marks[4].ok = false;
    },
    (r) => r.marks.push(mark('cancel', 130)),
    (r) => r.marks.push(mark('selection-submit', 141)),
    (r) => {
      r.marks[4].time = 119;
    },
    (r) => {
      r.marks[2].time = 99;
    },
    (r) => {
      r.events = [];
    },
    (r) => r.events.push({ ...r.events[0] }),
    (r) => {
      r.events[0].stamp = NaN;
    },
  ];
  for (const change of variants) {
    const raw = fixture();
    change(raw);
    assert.equal(lassoReleaseTiming(raw).ok, false);
  }
});

const config = { scenarios: ['local'], counts: [0, 100, 500, 1000], repeats: 5 };
const row = (count, repeat, ms, extra = {}) => ({
  scenario: 'local',
  count,
  repeat,
  cold: true,
  rate: 6,
  skipWarmup: false,
  valid: true,
  releaseTiming: {
    ok: true,
    releaseToSubmitMs: ms,
    releaseToQueryStartMs: 10,
    queryMs: ms - 15,
    completionToSubmitMs: 5,
  },
  phases: { prepare: { ms: 1 }, exact: { ms: 2, count } },
  ...extra,
});
const rows = () =>
  config.counts.flatMap((count) => Array.from({ length: 5 }, (_, i) => row(count, i, 146 + i)));

test('cold p95 covers 0/100/500 at 150ms; 1000 has readings without a threshold', () => {
  const raw = rows();
  raw.find((r) => r.count === 1000).releaseTiming.releaseToSubmitMs = 900;
  const summary = summarizeReleaseTiming(raw, config);
  for (const g of summary.groups.slice(0, 3)) {
    assert.equal(g.completedColdSamples, 5);
    assert.equal(g.p95Ms, 150);
    assert.equal(g.pass, true);
  }
  assert.equal(summary.groups[3].p95Ms, 900);
  assert.equal(summary.groups[3].thresholdMs, null);
  assert.equal(summary.groups[3].pass, null);
  assert.equal(releaseThresholdMs(1000), null);
  raw.find((r) => r.count === 500).releaseTiming.releaseToSubmitMs = 150.01;
  assert.equal(summarizeReleaseTiming(raw, config).groups[2].pass, false);
});

test('warm repeats cannot hide a missing cold first result or lower its p95', () => {
  const raw = rows().filter((r) => !(r.count === 500 && r.repeat === 4));
  raw.push(row(500, 4, 1, { cold: false }));
  const group = summarizeReleaseTiming(raw, config).groups[2];
  assert.equal(group.completedColdSamples, 4);
  assert.equal(group.missingOrInvalid, 1);
  assert.equal(group.p95Ms, null);
  assert.equal(group.pass, false);
});

test('invalid host, wrong throttle, disabled warmup, absent submit, duplicate cold rows stay invalid', () => {
  for (const change of [
    { valid: false },
    { rate: 1 },
    { skipWarmup: true },
    { releaseTiming: { ok: false, releaseToSubmitMs: null } },
  ]) {
    const raw = rows();
    Object.assign(raw[0], change);
    assert.equal(summarizeReleaseTiming(raw, config).groups[0].pass, false);
  }
  const raw = rows();
  raw.push({ ...raw[0] });
  assert.equal(summarizeReleaseTiming(raw, config).groups[0].pass, false);
});

test('1000-minus-500 attribution pairs the same cold repeat; subintervals sum to latency delta', () => {
  const raw = [
    row(500, 0, 100),
    row(1000, 0, 180, {
      releaseTiming: {
        ok: true,
        releaseToSubmitMs: 180,
        releaseToQueryStartMs: 30,
        queryMs: 140,
        completionToSubmitMs: 10,
      },
      phases: { prepare: { ms: 11 }, exact: { ms: 22, count: 1000 }, fallback: { ms: 3 } },
    }),
  ];
  const delta = summarizeReleaseTiming(raw, { ...config, repeats: 1 }).thousandVsFiveHundred[0];
  assert.equal(delta.releaseToSubmitDeltaMs, 80);
  assert.equal(
    delta.releaseToQueryStartDeltaMs + delta.queryDeltaMs + delta.completionToSubmitDeltaMs,
    80
  );
  assert.deepEqual(delta.phaseDeltaMs, {
    prepare: 10,
    canonicalize: 0,
    candidates: 0,
    exact: 20,
    fallback: 3,
  });
  assert.equal(delta.exactCountDelta, 500);
  assert.equal(
    summarizeReleaseTiming(raw.slice(1), { ...config, repeats: 1 }).thousandVsFiveHundred[0]
      .available,
    false
  );
});
