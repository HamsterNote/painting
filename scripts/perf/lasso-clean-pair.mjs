import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { sampleHost, versionOrder, queryTraceMetrics } from './lasso-host-gate.mjs';

const revisions = { A: '3ac6e585', B: 'c23d4ca' };
const queryPath = 'packages/painting/src/core/layeredObjectQuery.ts';
function injectCounters(source) {
  const start = source.indexOf('function withinLassoMargin(');
  const end = source.indexOf('type LassoEdge =', start);
  if (start < 0 || end < 0) throw Error('Missing edge instrumentation boundary');
  let body = source.slice(start, end);
  const anchor = 'const o1 = dx *';
  if (body.split(anchor).length !== 2) throw Error('Ambiguous segment pair counter');
  body = body.replace(anchor, 'probeCounters.fastSegmentPairs++;\n' + anchor);
  source = source.slice(0, start) + body + source.slice(end);
  const fallback = /function pieceIntersectsLasso\([\s\S]*?\): PieceHit \{/;
  const reference = 'for (const [c, d] of secondSegments) {';
  if (!fallback.test(source) || source.split(reference).length !== 2)
    throw Error('Missing reference counter');
  return source
    .replace(fallback, (s) => s + '\nprobeCounters.referenceFallbacks++;')
    .replace(reference, reference + '\nprobeCounters.referenceDistancePairs++;');
}

export async function buildProbes(output) {
  await mkdir(output, { recursive: true });
  const probes = {};
  for (const [label, revision] of Object.entries(revisions)) {
    const sha = execFileSync('git', ['rev-parse', `${revision}^{commit}`], {
      encoding: 'utf8',
    }).trim();
    probes[label] = { sha };
    // CPU/allocation bundles have no per-operation instrumentation.
    for (const instrumented of [false, true]) {
      const outfile = resolve(output, `${label}-${instrumented ? 'ops' : 'plain'}.js`);
      await build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'ts',
          contents: `
          import {lassoFixture,lassoTrajectory} from './apps/playground/src/layered-editor/lassoPerformanceFixture';
          import {FreehandGeometryCache} from './packages/painting/src/geometry/freehandCache';
          import {prepareLayeredObjectQuery,createLayeredLassoQuery,resetProbeCounters,readProbeCounters} from './${queryPath}';
          export function cell(count,scenario) {
            const document=lassoFixture(count,scenario), path=lassoTrajectory(scenario);
            const prepared=prepareLayeredObjectQuery(document,new FreehandGeometryCache());
            if(!prepared.ok)throw Error(prepared.error.code);
            let round=0;
            return {run(){
              resetProbeCounters();
              performance.mark('kernel:start');
              const query=createLayeredLassoQuery(prepared.value,path);
              if(!query.ok)throw Error(query.error.code);
              const result=query.value.step(()=>0,Infinity);
              performance.mark('kernel:end');
              if(!result?.ok)throw Error('query failed');
              return {cold:round++===0,candidates:query.value.candidateCount,
                processed:query.value.processedCount,selected:result.value.map(h=>h.objectId),
                operations:readProbeCounters()};
            }};
          }
        `,
        },
        outfile,
        bundle: true,
        minify: true,
        sourcemap: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'Kernel',
        plugins: [
          {
            name: 'pinned-product-source',
            setup(builder) {
              builder.onLoad(
                {
                  filter:
                    /(?:packages\/painting\/src\/.*|apps\/playground\/src\/layered-editor\/lassoPerformanceFixture)\.tsx?$/,
                },
                ({ path }) => {
                  const repoPath = relative(process.cwd(), path);
                  let contents = execFileSync('git', ['show', `${sha}:${repoPath}`], {
                    encoding: 'utf8',
                  });
                  if (repoPath === queryPath) {
                    if (instrumented) contents = injectCounters(contents);
                    contents += `
                const probeCounters={fastSegmentPairs:0,referenceDistancePairs:0,referenceFallbacks:0};
                export function resetProbeCounters(){for(const k of Object.keys(probeCounters))probeCounters[k]=0;}
                export function readProbeCounters(){return ${instrumented ? '{...probeCounters}' : 'null'};}
              `;
                  }
                  return { contents, loader: path.endsWith('.tsx') ? 'tsx' : 'ts' };
                }
              );
            },
          },
        ],
      });
      probes[label][instrumented ? 'ops' : 'plain'] = outfile;
    }
  }
  await writeFile(
    `${output}/sources.json`,
    JSON.stringify(
      {
        probes,
        node: process.version,
        dependencyDiff: execFileSync(
          'git',
          [
            'diff',
            revisions.A,
            revisions.B,
            '--',
            'pnpm-lock.yaml',
            'packages/painting/package.json',
          ],
          { encoding: 'utf8' }
        ),
      },
      null,
      2
    )
  );
  return probes;
}

export async function openProbe(browser, probe, mode, count, scenario) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.addScriptTag({ path: probe[mode === 'ops' ? 'ops' : 'plain'] });
    await page.evaluate(
      ({ count, scenario }) => {
        window.cell = Kernel.cell(count, scenario);
      },
      { count, scenario }
    );
    return { context, page, cdp };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function querySample(probe, mode) {
  const { cdp, page } = probe;
  const traceEvents = [];
  const collect = ({ value }) => traceEvents.push(...value);
  cdp.on('Tracing.dataCollected', collect);
  try {
    if (mode === 'allocation')
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: 32768,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    await cdp.send('Tracing.start', {
      categories: 'blink.user_timing,v8,disabled-by-default-v8.gc',
      transferMode: 'ReportEvents',
    });
    const startedAt = Date.now();
    const result = await page.evaluate(() => window.cell.run());
    const endedAt = Date.now();
    const complete = once(cdp, 'Tracing.tracingComplete');
    await cdp.send('Tracing.end');
    await complete;
    const metrics = queryTraceMetrics(traceEvents);
    const profile =
      mode === 'allocation' ? (await cdp.send('HeapProfiler.stopSampling')).profile : null;
    const sum = (node) => node.selfSize + node.children.reduce((s, n) => s + sum(n), 0);
    return {
      startedAt,
      endedAt,
      ...result,
      // Only the plain pass supplies primary CPU numbers. Counter and heap passes alter costs.
      ...metrics,
      primaryCpu: mode === 'cpu',
      sampledEstimatedAllocatedBytes: profile ? sum(profile.head) : null,
      traceEvents,
      profile,
    };
  } finally {
    cdp.off('Tracing.dataCollected', collect);
  }
}

export function pairVerdict(samples) {
  if (samples.length !== 2 || samples[0].label === samples[1].label) return false;
  if (samples.some((s) => !s.before.valid || !s.after.valid)) return false;
  if (
    samples.some(
      (s) =>
        !Number.isFinite(s.queryThreadCpuMs) ||
        s.queryThreadCpuMs < 0 ||
        !Array.isArray(s.selected) ||
        !Number.isFinite(s.startedAt) ||
        !Number.isFinite(s.endedAt) ||
        s.endedAt < s.startedAt ||
        typeof s.cold !== 'boolean'
    )
  )
    return false;
  if (samples[1].startedAt < samples[0].endedAt) return false;
  if (samples[1].startedAt - samples[0].endedAt > 30000) return false;
  return (
    samples[0].cold === samples[1].cold &&
    JSON.stringify(samples[0].selected) === JSON.stringify(samples[1].selected)
  );
}

export async function runCleanPairs(output) {
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/run.json`, JSON.stringify({ startedAt: new Date().toISOString() }), {
    flag: 'wx',
  });
  const attempts = [],
    accepted = [];
  const maxAttempts = Number(process.env.LASSO_MAX_ATTEMPTS ?? 3);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)
    throw Error('max attempts must be 1..10');
  let browser, xserver, probes;
  const save = () =>
    writeFile(
      `${output}/pairs.json`,
      JSON.stringify(
        {
          protocol:
            'A=3ac6e585 B=c23d4ca; adjacent AB/BA, both sides pre/post load<=cores/2 and idle>=50%; max adjacent gap 30s. Cold means first kernel query on prepared geometry, not first UI gesture. CPU/ops/heap are separate passes. All attempts retained.',
          primary: 'plain query end.tts-start.tts; same renderer thread; no wall-clock fallback',
          revisions,
          attempts,
          accepted,
        },
        null,
        2
      )
    );
  try {
    // Bounded retries: do not launch browsers or compile probes while the host is already invalid.
    let eligible = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const host = await sampleHost();
      attempts.push({ stage: 'preflight', attempt, host });
      await save();
      if (host.valid) {
        eligible = true;
        break;
      }
      console.log(JSON.stringify({ invalid: host, attempt }));
      if (attempt + 1 < maxAttempts) await delay(30000);
    }
    if (!eligible) return false;
    probes = await buildProbes(`${output}/bundles`);
    const display = process.env.DISPLAY ?? ':249';
    if (!process.env.DISPLAY) {
      const xroot = resolve('artifacts/research/lasso-release/x11/root');
      xserver = spawn(
        `${xroot}/usr/bin/Xvfb`,
        [display, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-ac'],
        {
          env: { ...process.env, LD_LIBRARY_PATH: `${xroot}/usr/lib/x86_64-linux-gnu` },
          stdio: 'ignore',
        }
      );
      await delay(500);
      if (xserver.exitCode !== null) throw Error('Xvfb failed');
    }
    browser = await chromium.launch({
      headless: false,
      env: { ...process.env, DISPLAY: display },
      args: ['--no-sandbox'],
    });
    await writeFile(
      `${output}/browser.json`,
      JSON.stringify({ version: browser.version(), headed: true, throttle: 6 })
    );
    for (const scenario of ['local', 'dense'])
      for (const count of [500, 1000])
        for (const mode of ['cpu', 'ops', 'allocation'])
          for (let round = 0; round < 3; round++) {
            let retained = false;
            for (let retry = 0; retry < maxAttempts && !retained; retry++) {
              const id = `${scenario}-${count}-${mode}-r${round}-a${retry}`;
              const host = await sampleHost();
              if (!host.valid) {
                attempts.push({ id, valid: false, host });
                await save();
              } else {
                const pages = {};
                try {
                  for (const label of versionOrder(round))
                    pages[label] = await openProbe(browser, probes[label], mode, count, scenario);
                  const temperatures = [];
                  for (let temperature = 0; temperature < 2; temperature++) {
                    const samples = [];
                    for (const label of versionOrder(round + temperature)) {
                      await pages[label].page.bringToFront();
                      const before = await sampleHost();
                      if (!before.valid) {
                        samples.push({ label, before, after: before });
                        break;
                      }
                      const result = await querySample(pages[label], mode);
                      const after = await sampleHost();
                      const { traceEvents, profile, ...metrics } = result;
                      const name = `${id}-${temperature}-${label}`;
                      await writeFile(
                        `${output}/${name}.trace.json`,
                        JSON.stringify({ traceEvents })
                      );
                      if (profile)
                        await writeFile(`${output}/${name}.heap.json`, JSON.stringify(profile));
                      samples.push({ label, before, after, ...metrics });
                      if (!after.valid) break;
                    }
                    const valid = pairVerdict(samples);
                    temperatures.push({
                      temperature: temperature ? 'hot' : 'cold',
                      valid,
                      samples,
                    });
                    if (!valid) break;
                  }
                  retained = temperatures.length === 2 && temperatures.every((t) => t.valid);
                  const record = {
                    id,
                    mode,
                    scenario,
                    count,
                    round,
                    retry,
                    valid: retained,
                    temperatures,
                  };
                  attempts.push(record);
                  if (retained) accepted.push(record);
                  await save();
                } finally {
                  for (const p of Object.values(pages)) await p.context.close();
                }
              }
              if (!retained && retry + 1 < maxAttempts) await delay(30000);
            }
            if (!retained) return false; // No partial matrix or cherry-picked single side is a comparison.
          }
    return true;
  } finally {
    await browser?.close();
    if (xserver && xserver.exitCode === null) {
      xserver.kill('SIGTERM');
      await once(xserver, 'exit');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const success = await runCleanPairs(
    process.argv[2] ?? 'artifacts/research/lasso-measurement/paired'
  );
  if (!success) process.exitCode = 2;
}
