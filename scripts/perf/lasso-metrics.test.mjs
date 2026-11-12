import assert from 'node:assert/strict';
import test from 'node:test';
import { lassoMetrics } from './lasso-metrics.mjs';

function recording() {
  return {
    idle: [0, 10, 20, 30],
    start: 0,
    drawingEnd: 100,
    actualFrames: [10, 20, 30],
    frames: [10, 20, 30, 110],
    down: { index: 0, start: 0, end: 1 },
    up: { start: 100, end: 105 },
    finalOpportunity: 120,
    inputs: [{ index: 1, due: 5, start: 10 }],
    preview: [{ opportunity: 20, domPoints: '0,0 0,0 1,1' }],
    selection: [],
    scans: [],
  };
}

test('includes the final blocked interval in FPS and missing frames', () => {
  const result = lassoMetrics(recording());
  assert.equal(result.duration, 100);
  assert.equal(result.fps, 20);
  assert.equal(result.missing, 6);
  assert.equal(result.dropRate, 0.75);
});

test('old recordings exclude the single post-up callback and recompute identically', () => {
  const raw = recording();
  const expected = lassoMetrics(raw);
  delete raw.actualFrames;
  assert.deepEqual(lassoMetrics(raw), expected);
});

test('a closing coordinate matching the first point still presents the full prefix', () => {
  const raw = recording();
  raw.inputs.push({ index: 2, due: 10, start: 15 });
  raw.preview[0].domPoints = '0,0 0,0 1,1 0,0';
  const result = lassoMetrics(raw);
  assert.equal(result.previewCovered, 3);
  assert.equal(result.previewP95, 20);
  assert.equal(result.sourcePreviewP95, 20);
});

test('unpresented input fails p95 instead of disappearing from the sample', () => {
  const raw = recording();
  raw.inputs.push({ index: 2, due: 10, start: 15 });
  const result = lassoMetrics(raw);
  assert.equal(result.previewCovered, 2);
  assert.equal(result.previewP95, null);
  assert.equal(result.selectionP95, null);
});
