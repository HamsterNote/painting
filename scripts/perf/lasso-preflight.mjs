import { setTimeout as delay } from 'node:timers/promises';
import { sampleHost } from './lasso-host-gate.mjs';

// Shared startup policy only. The host predicate and in-run checks are unchanged.
export async function waitForLassoHost(
  record,
  { sample = sampleHost, sleep = delay, now = () => performance.now() } = {}
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const started = now();
    const host = await sample();
    await record({ stage: 'preflight', attempt, host });
    if (host.valid) return true;
    if (attempt < 19) await sleep(Math.max(0, 60000 - (now() - started)));
  }
  return false;
}
