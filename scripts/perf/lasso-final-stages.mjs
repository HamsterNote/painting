import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
const output = process.argv[2] ?? 'artifacts/research/lasso-final-query/baseline-stages';
const sampleHeap = process.env.LASSO_SAMPLE_HEAP === '1';
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['scripts/perf/lasso-final-stages.ts'],
  outfile: `${output}/probe.js`,
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'Stages',
});
const browser = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--no-sandbox'] });
try {
  const rows = [];
  for (const scenario of ['local', 'dense'])
    for (const count of [500, 1000]) {
      const page = await browser.newPage();
      await page.addScriptTag({ path: `${output}/probe.js` });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await cdp.send('Performance.enable');
      await page.evaluate(
        ({ count, scenario, rendered }) => {
          window.cell = Stages.cell(count, scenario, rendered);
        },
        { count, scenario, rendered: process.env.LASSO_RENDERED === '1' }
      );
      for (let round = 0; round < 3; round++) {
        const id = `${scenario}-${count}-r${round}`;
        const traceEvents = [];
        const collect = ({ value }) => traceEvents.push(...value);
        cdp.on('Tracing.dataCollected', collect);
        if (sampleHeap)
          await cdp.send('HeapProfiler.startSampling', {
            samplingInterval: 32768,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
          });
        await cdp.send('Tracing.start', {
          categories:
            'devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc,disabled-by-default-devtools.timeline',
          transferMode: 'ReportEvents',
        });
        const raw = await page.evaluate(() => window.cell.run());
        const profile = sampleHeap ? (await cdp.send('HeapProfiler.stopSampling')).profile : null;
        const completed = once(cdp, 'Tracing.tracingComplete');
        await cdp.send('Tracing.end');
        await completed;
        cdp.off('Tracing.dataCollected', collect);
        await writeFile(`${output}/${id}.json`, JSON.stringify(raw));
        await writeFile(`${output}/${id}.trace.json`, JSON.stringify({ traceEvents }));
        await writeFile(`${output}/${id}.heap.json`, JSON.stringify(profile));
        const allocated = (n) => n.selfSize + n.children.reduce((a, c) => a + allocated(c), 0);
        const start = traceEvents.find((e) => e.name === 'stages:start');
        const end = traceEvents.find((e) => e.name === 'stages:end');
        const gc = traceEvents.filter(
          (e) =>
            e.ph === 'X' &&
            ['MinorGC', 'MajorGC'].includes(e.name) &&
            e.pid === start.pid &&
            e.tid === start.tid &&
            e.ts < end.ts &&
            e.ts + e.dur > start.ts
        );
        const gcMs = gc.reduce(
          (s, e) => s + (Math.min(end.ts, e.ts + e.dur) - Math.max(start.ts, e.ts)) / 1000,
          0
        );
        const row = {
          id,
          cold: raw.cold,
          rendered: raw.rendered,
          prepare: raw.prepareMs,
          canonicalize: raw.phases.canonicalize,
          candidateMs: raw.phases.candidates,
          exact: raw.exactMs,
          total: raw.totalMs,
          candidateCount: raw.candidateCount,
          fallbackCount: raw.fallbacks.length,
          fallbackMs: raw.fallbacks.reduce((s, f) => s + f.ms, 0),
          gcMs,
          gcPercent: (gcMs / raw.totalMs) * 100,
          sampledAllocatedBytes: profile ? allocated(profile.head) : null,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
      await page.close();
    }
  await writeFile(`${output}/summary.json`, JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
}
