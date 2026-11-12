import assert from 'node:assert/strict';
import test from 'node:test';
import { lassoObservability, p95 } from './lasso-observability.mjs';
const raw = {
  start: 0,
  inputs: [{ index: 2, start: 10 }],
  methods: [
    { name: 'setSelection', start: 20, duration: 1 },
    { name: 'setSelection', start: 40, duration: 1 },
    { name: 'setSelection', start: 110, duration: 5 },
  ],
  selection: [{ published: 20 }],
  up: { start: 100, end: 120 },
  finalOpportunity: 140,
};
test('includes successful submissions even when equal selections suppress notifications', () => {
  const r = lassoObservability(raw);
  assert.equal(r.submissionCount, 2);
  assert.equal(r.changedSelectionCount, 1);
  assert.equal(r.submissionIntervalP95, 20);
  assert.equal(r.maximumSubmissionGap, 60);
  assert.equal(r.inputToQueryCompletion.observable, false);
});
test('separates final dispatch, selection call and presentation wait', () => {
  const r = lassoObservability(raw);
  assert.deepEqual(r.final, {
    dispatchMs: 20,
    upToSetSelectionMs: 10,
    setSelectionMs: 5,
    postDispatchToPresentationMs: 20,
    totalMs: 40,
  });
});
test('absence of feedback cannot become an empty passing latency population', () => {
  const r = lassoObservability({ ...raw, methods: [] });
  assert.equal(r.proposedAlternative.noLiveFeedback, true);
  assert.equal(r.maximumSubmissionGap, 90);
  assert.equal(r.submissionIntervalP95, null);
  assert.equal(r.proposedAlternative.accepted, false);
});
test('nearest-rank p95 includes the actual tail for five rounds', () => {
  assert.equal(p95([1, 2, 3, 4, 100]), 100);
  assert.equal(p95([]), null);
});

test('keeps publication wait and the subsequent rAF opportunity separate', () => {
  const r = lassoObservability({
    ...raw,
    preview: [{ index: 2, published: 20, opportunity: 36 }],
  });
  assert.equal(r.publicationTiming.inputToPublicationP95ObservedOnly, 10);
  assert.equal(r.publicationTiming.publicationToNextRAFP95ObservedOnly, 16);
  assert.equal(r.publicationTiming.observedSamples, 1);
});
