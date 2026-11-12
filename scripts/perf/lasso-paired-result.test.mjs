import assert from 'node:assert/strict';
import test from 'node:test';
import { pairedLassoResult } from './lasso-paired-result.mjs';
const sample = (fps) => [
  { count: 0, fps, T: 1000 / 60 },
  { count: 100, fps: 50, T: 1000 / 60 },
];
const pair = (a, b) =>
  pairedLassoResult({
    scenario: 'local',
    count: 100,
    round: 2,
    samples: { baseline: sample(a), optimized: sample(b) },
  });
test('rejects the entire pair when either control fails, regardless of version', () => {
  for (const [a, b, reason] of [
    [53, 60, 'baseline'],
    [60, 53, 'optimized'],
  ]) {
    const r = pair(a, b);
    assert.equal(r.retained, false);
    assert.deepEqual(r.rejectedBy, [reason]);
    assert.equal(Object.keys(r.variants).length, 2);
  }
});
test('uses exactly the same threshold for both and retains valid pairs', () => {
  const r = pair(60, 59);
  assert.equal(r.retained, true);
  assert.equal(r.variants.baseline.controlThreshold, r.variants.optimized.controlThreshold);
});
test('retains raw invalid measurements instead of replacing or resampling them', () => {
  const r = pair(20, 30);
  assert.deepEqual(r.rejectedBy, ['baseline', 'optimized']);
  assert.equal(r.variants.baseline.control.fps, 20);
  assert.equal(r.variants.optimized.control.fps, 30);
});
test('nonfinite or absent controls cannot enter the retained cohort', () => {
  assert.equal(pair(NaN, 60).retained, false);
  assert.throws(() =>
    pairedLassoResult({
      scenario: 'local',
      count: 100,
      round: 2,
      samples: { baseline: [], optimized: sample(60) },
    })
  );
});

test('never excludes a pair because the populated drawing itself is slow', () => {
  const baseline = sample(60);
  baseline[1].fps = 0;
  const result = pairedLassoResult({
    scenario: 'local',
    count: 100,
    round: 2,
    samples: { baseline, optimized: sample(60) },
  });
  assert.equal(result.retained, true);
  assert.equal(result.variants.baseline.drawing.fps, 0);
});
