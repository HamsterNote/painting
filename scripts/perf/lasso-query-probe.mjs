import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

const output = process.argv[2] ?? 'artifacts/research/lasso/query-probe-v2';
const productSha = process.env.LASSO_PROBE_SHA ?? '8f6162249c15119e1234857f3db5fd37915e2809';
const sourceDiff = execFileSync(
  'git',
  [
    'diff',
    productSha,
    '--',
    'packages/painting/src/core',
    'packages/painting/src/geometry',
    'packages/painting/src/model',
    'packages/painting/src/layered/createEditor.ts',
    'packages/painting/src/layered/inputModePreference.ts',
    'apps/playground/src/layered-editor/lassoPerformanceFixture.ts',
  ],
  { encoding: 'utf8' }
);
if (sourceDiff.trim())
  throw new Error('Probe product source differs from the frozen optimized revision');
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['scripts/perf/lasso-query-probe.ts'],
  outfile: `${output}/probe.js`,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'LassoProbe',
  minify: true,
  sourcemap: true,
});
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  await page.addScriptTag({ path: `${output}/probe.js` });
  const observedClockTickMs = await page.evaluate(() => {
    let previous = performance.now(),
      minimum = Infinity;
    for (let i = 0; i < 20000; i++) {
      const now = performance.now();
      if (now > previous) minimum = Math.min(minimum, now - previous);
      previous = now;
    }
    return Number.isFinite(minimum) ? minimum : null;
  });
  const metadata = {
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    productSha,
    sourceDiff,
    startedAt: new Date().toISOString(),
    loadAverage: os.loadavg(),
    observedClockTickMs,
    browser: browser.version(),
    node: process.version,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    release: os.release(),
    bundleHash: createHash('sha256')
      .update(await readFile(`${output}/probe.js`))
      .digest('hex'),
    command: process.argv,
    method:
      'Separate minified browser harness. Two warmup/five measured rounds per prefix, then an eighth profile/oracle round excluded from timing statistics. Atomic step budget zero, no yielding. Setup and summed step wall durations reported separately; excludes rendering. Observed minimum is not an architectural impossibility proof or physical CPU lower bound. Never runs concurrently with paired UI FPS collection.',
  };
  await writeFile(`${output}/environment.json`, JSON.stringify(metadata, null, 2));
  for (const [scenario, count] of [
    ['local', 0],
    ['local', 100],
    ['local', 500],
    ['local', 1000],
    ['dense', 100],
    ['dense', 500],
    ['dense', 1000],
    ['mixed', 500],
    ['mixed', 1000],
  ]) {
    await page.evaluate(
      ({ scenario, count }) => {
        window.probeCell = LassoProbe.createProbeCell(count, scenario);
      },
      { scenario, count }
    );
    for (let round = 0; round < 8; round++) {
      let cdp;
      const traceEvents = [];
      if (round === 7) {
        cdp = await page.context().newCDPSession(page);
        cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,v8.execute,blink.user_timing',
          transferMode: 'ReportEvents',
        });
      }
      for (const prefix of [3, 30, 150, 300, 450, 599, 600]) {
        const id = `${scenario}-${count}-p${prefix}-r${round}`;
        const raw = await page.evaluate(
          ({ prefix, round }) => window.probeCell.run(prefix, round),
          { prefix, round }
        );
        await writeFile(`${output}/${id}.json`, JSON.stringify(raw));
        console.log(
          JSON.stringify({
            id,
            setupMs: raw.setupMs,
            workMs: raw.workMs,
            measuredQueryMs: raw.measuredQueryMs,
            maxAtomicMs: Math.max(...(raw.atomic?.map((row) => row.ms) ?? [0])),
            candidates: raw.candidateCount,
            hits: raw.hits,
            selectionEqualMs: raw.selectionEqualMs,
            oracle: raw.oracle,
          })
        );
      }
      if (cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        await done;
        await writeFile(`${output}/${scenario}-${count}.cpuprofile`, JSON.stringify(profile));
        await writeFile(
          `${output}/${scenario}-${count}.trace.json`,
          JSON.stringify({ traceEvents })
        );
        await cdp.detach();
      }
    }
  }
} finally {
  await browser.close();
}
