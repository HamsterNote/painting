// Observe startup noise before changing the measurement policy. No query is timed.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sampleHost } from './lasso-host-gate.mjs';

const output = process.argv[2];
const bundles = process.argv[3];
if (!output || !bundles) throw Error('Usage: lasso-host-noise.mjs OUTPUT FROZEN_BUNDLES');
await mkdir(output, { recursive: true });
const started = performance.now();
const events = [];
const samples = [];
const metadata = {
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  rate: 6,
  launchAfterMs: 5000,
  sampleCount: 30,
  sampleWindowMs: 1000,
  closeAfterMs: 20000,
  clockTicksPerSecond: Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' })),
  queryCount: 0,
  bundles: {},
};
const mark = (event) => events.push({ event, elapsedMs: performance.now() - started });
const save = () =>
  writeFile(`${output}/noise.json`, JSON.stringify({ ...metadata, events, samples }, null, 2));
// Read only descendants of this diagnostic process, never unrelated host processes.
const childTicks = async (parent = process.pid, result = {}) => {
  const children = await readFile(`/proc/${parent}/task/${parent}/children`, 'utf8').catch(
    () => ''
  );
  for (const pid of children.trim().split(/\s+/).filter(Boolean)) {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
    if (!stat) continue;
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    result[pid] = Number(fields[11]) + Number(fields[12]);
    await childTicks(pid, result);
  }
  return result;
};
for (const label of ['A', 'B'])
  metadata.bundles[label] = createHash('sha256')
    .update(await readFile(`${bundles}/${label}-plain.js`))
    .digest('hex');
await writeFile(`${output}/run.json`, JSON.stringify(metadata, null, 2), { flag: 'wx' });
await writeFile(`${output}/runner.mjs`, await readFile(new URL(import.meta.url)));
let browser;
try {
  const results = await Promise.allSettled([
    (async () => {
      for (let second = 0; second < 30; second++) {
        const startMs = performance.now() - started;
        const ticksBefore = await childTicks();
        const host = await sampleHost(1000);
        const ticksAfter = await childTicks();
        const record = {
          second,
          startMs,
          endMs: performance.now() - started,
          host,
          ticksBefore,
          ticksAfter,
          // Exited processes cannot be read; their final partial interval is a lower bound.
          ownedCpuTicks: Object.entries(ticksAfter).reduce(
            (sum, [pid, ticks]) => sum + Math.max(0, ticks - (ticksBefore[pid] ?? 0)),
            0
          ),
        };
        samples.push(record);
        console.log(JSON.stringify(record));
        await save();
      }
    })(),
    (async () => {
      await delay(5000);
      mark('launch-start');
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      metadata.browser = browser.version();
      mark('launch-resolved');
      for (const label of ['A', 'B']) {
        const page = await browser.newPage();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        await page.addScriptTag({ path: `${bundles}/${label}-plain.js` });
        await page.evaluate(() => {
          window.cell = Probe.createCell(0, 'local');
        });
        await page.bringToFront();
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        );
        mark(`${label}-first-frames`);
      }
      mark('pages-ready');
      await delay(Math.max(0, 20000 - (performance.now() - started)));
      mark('close-start');
      await browser.close();
      mark('close-complete');
    })(),
  ]);
  metadata.errors = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason));
  await save();
  if (metadata.errors.length) throw Error(metadata.errors.join('; '));
} finally {
  await browser?.close();
}
