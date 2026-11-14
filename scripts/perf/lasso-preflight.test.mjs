import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForLassoHost } from './lasso-preflight.mjs';
import { cpuRows, hostVerdict } from './lasso-host-gate.mjs';

const before = cpuRows('cpu0 0 0 0 0 0 0 0 0');
const after = cpuRows('cpu0 10 0 10 80 0 0 0 0');
const host = (load) => hostVerdict(before, after, [load, 0, 0], [load, 0, 0], 6);
function clock(loads) {
  let time = 0;
  const starts = [],
    sleeps = [],
    records = [];
  return {
    starts,
    sleeps,
    records,
    get elapsed() {
      return time;
    },
    record: async (record) => {
      await Promise.resolve(); // Recording must finish before waiting/rechecking.
      records.push(record);
      time += 25;
    },
    dependencies: {
      now: () => time,
      sample: async () => {
        starts.push(time);
        time += 500;
        return host(loads[starts.length - 1] ?? loads.at(-1));
      },
      sleep: async (ms) => {
        assert.equal(records.length, starts.length);
        sleeps.push(ms);
        time += ms;
      },
    },
  };
}

test('short sample: persist all 20 rejections, wait 19 times, then stop without measuring', async (t) => {
  const fake = clock([4]);
  const eligible = await waitForLassoHost(fake.record, fake.dependencies);
  assert.equal(eligible, false);
  assert.deepEqual(
    fake.starts,
    Array.from({ length: 20 }, (_, i) => i * 60000)
  );
  assert.deepEqual(fake.sleeps, Array(19).fill(59475));
  assert.equal(fake.records.length, 20);
  assert(fake.records.every((r, i) => r.attempt === i && !r.host.valid && r.host.loadLimit === 3));
  t.diagnostic(
    JSON.stringify({
      mode: 'virtual clock, synthetic load=4/idle=80%, no browser or performance query',
      checks: fake.starts.length,
      checkStartMs: fake.starts,
      waitCalls: fake.sleeps.length,
      requestedWaitMs: fake.sleeps,
      virtualElapsedMs: fake.elapsed,
      eligible,
    })
  );
});

test('recovery exits on the first eligible check, without an extra wait', async () => {
  const fake = clock([4, 4, 3]);
  assert.equal(await waitForLassoHost(fake.record, fake.dependencies), true);
  assert.deepEqual(fake.starts, [0, 60000, 120000]);
  assert.equal(fake.records.length, 3);
  assert.equal(fake.sleeps.length, 2);
});

test('an immediately eligible host does not sleep', async () => {
  const fake = clock([3]);
  assert.equal(await waitForLassoHost(fake.record, fake.dependencies), true);
  assert.equal(fake.records.length, 1);
  assert.equal(fake.sleeps.length, 0);
});

test('sample or recording errors propagate instead of allowing measurement', async () => {
  for (const failure of ['sample', 'record']) {
    const fake = clock([4]);
    const fail = async () => {
      throw Error(failure);
    };
    if (failure === 'sample') fake.dependencies.sample = fail;
    await assert.rejects(
      waitForLassoHost(failure === 'record' ? fail : fake.record, fake.dependencies),
      { message: failure }
    );
    assert.equal(fake.sleeps.length, 0);
  }
});
