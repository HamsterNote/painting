import test from 'node:test';
import assert from 'node:assert/strict';
import { lassoQueryTiming } from './lasso-query-timing.mjs';
const mark = (event, time, version, pointCount, extra = {}) => ({
  event,
  time,
  version,
  pointCount,
  session: 1,
  final: false,
  ...extra,
});
const fixture = () => ({
  down: { index: 0, start: 0 },
  inputs: [
    { index: 1, start: 1, due: 1 },
    { index: 2, start: 7, due: 5 },
  ],
  up: { start: 50 },
  queryMarks: [
    mark('input', 0, 0, 2),
    mark('input', 1, 1, 3),
    mark('query-start', 2, 1, 3),
    mark('input', 7, 2, 4),
    mark('query-complete', 10, 1, 3, { ok: true }),
    mark('selection-submit', 11, 1, 3),
    mark('selection-opportunity', 12, 1, 3, { submittedAt: 11 }),
    mark('query-start', 15, 2, 4),
    mark('query-complete', 30, 2, 4, { ok: true }),
    mark('selection-submit', 32, 2, 4),
    mark('selection-opportunity', 35, 2, 4, { submittedAt: 32 }),
  ],
});
test('new input cannot borrow completion of an older in-flight path', () => {
  const r = lassoQueryTiming(fixture());
  assert.equal(r.perInput[2].queryVersion, 2);
  assert.equal(r.perInput[2].completeMs, 23);
  assert.equal(r.inputToSelectionP95, 25);
  assert.equal(r.inputToOpportunityP95, 28);
  assert.equal(r.sourceToOpportunityP95, 30);
  assert.equal(r.liveQueryWallP95, 15);
});
test('missing live feedback stays in the percentile denominator; final up cannot fill it', () => {
  const raw = fixture();
  raw.queryMarks = raw.queryMarks.map((m) => (m.version === 2 ? { ...m, final: true } : m));
  const r = lassoQueryTiming(raw);
  assert.equal(r.inputs, 3);
  assert.equal(r.selectedInputs, 2);
  assert.equal(r.inputToQueryP95, null);
  assert.equal(r.inputToSelectionP95, null);
});
test('a query completing after up is not counted as live', () => {
  const raw = fixture();
  raw.up.start = 20;
  assert.equal(lassoQueryTiming(raw).selectedInputs, 2);
});
test('equal selection results are measured without a notification', () => {
  const r = lassoQueryTiming(fixture());
  assert.equal(r.selectedInputs, 3);
  assert.equal(r.completionToSubmissionP95, 2);
});
test('absent and unmatched marks cannot silently produce valid timing evidence', () => {
  assert.throws(() => lassoQueryTiming({ ...fixture(), queryMarks: [] }));
  const raw = fixture();
  raw.queryMarks = raw.queryMarks.filter((m) => m.event !== 'query-start');
  assert.throws(() => lassoQueryTiming(raw));
});
