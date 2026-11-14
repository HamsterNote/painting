import test from 'node:test';
import assert from 'node:assert/strict';
import { settleLassoPages } from './lasso-settle.mjs';

function fixture(validities) {
  const records = [];
  let frames = false,
    samples = 0;
  const pages = [
    {
      bringToFront: async () => {},
      evaluate: async () => {
        frames = true;
      },
    },
  ];
  return {
    records,
    pages,
    record: async (record) => {
      records.push(record);
    },
    sample: async () => {
      assert.equal(frames, true);
      const attempt = samples++;
      return { valid: validities[attempt] ?? false, windowMs: 3000 };
    },
  };
}

test('first frames precede samples; intermittent valid windows do not accumulate', async () => {
  const f = fixture([false, true, false, true, true]);
  assert.equal(await settleLassoPages(f.pages, f.record, { sample: f.sample }), true);
  assert.deepEqual(
    f.records.map((r) => r.consecutive),
    [0, 1, 0, 1, 2]
  );
});

test('no recovery stops after ten windows and records null after with an abort reason', async () => {
  const f = fixture([]);
  assert.equal(await settleLassoPages(f.pages, f.record, { sample: f.sample }), false);
  assert.equal(f.records.filter((r) => r.stage === 'settle').length, 10);
  assert.equal(f.records.at(-1).after, null);
  assert.match(f.records.at(-1).abortReason, /no-two-consecutive/);
});
