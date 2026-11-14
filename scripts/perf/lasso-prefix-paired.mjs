// HAM-247: compare two frozen revisions, never the working tree against a SHA.
// Keep HAM-245's nine cells, seven prefixes and 2 warmup + 5 formal + 1 diagnostic rounds.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sampleHost, versionOrder } from './lasso-host-gate.mjs';

const [output, base, candidate, mode] = process.argv.slice(2);
if (mode !== undefined && mode !== '--verify-only') throw Error('Unknown mode');
const verificationOnly = mode === '--verify-only';
if (!output || !base || !candidate)
  throw Error(
    'Usage: node scripts/perf/lasso-prefix-paired.mjs OUTPUT BASE_SHA CANDIDATE_SHA [--verify-only]'
  );
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const revisions = { A: git('rev-parse', base).trim(), B: git('rev-parse', candidate).trim() };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cells = [
  ['local', 0],
  ['local', 100],
  ['local', 500],
  ['local', 1000],
  ['dense', 100],
  ['dense', 500],
  ['dense', 1000],
  ['mixed', 500],
  ['mixed', 1000],
];
const prefixes = [3, 30, 150, 300, 450, 599, 600];
const probePath = 'scripts/perf/lasso-narrow-probe.ts';
// Same harness for both versions, explicitly recorded and hashed.
const probe = await readFile(probePath, 'utf8');
const runner = await readFile(new URL(import.meta.url), 'utf8');
assert.equal(git('diff', revisions.A, revisions.B, '--', 'pnpm-lock.yaml').trim(), '');
assert.equal(git('diff', revisions.A, '--', 'pnpm-lock.yaml').trim(), '');
await mkdir(output, { recursive: true });
const metadata = {
  revisions,
  verificationOnly,
  command: process.argv,
  node: process.version,
  cpu: os.cpus()[0].model,
  availableCores: os.availableParallelism(),
  release: os.release(),
  startedAt: new Date().toISOString(),
  probeHash: hash(probe),
  runnerHash: hash(runner),
  bundles: {},
  method: verificationOnly
    ? 'Functional verification only; one diagnostic round and operation counts against the oracle. All latency p95 and fallback-share verdicts are null. Host load recorded but not used to reject correctness checks; no performance acceptance claim.'
    : 'Query-only headless Chromium, no CPU throttle; same prepared fixture; adjacent AB/BA; 2 warmup + 5 formal + 1 diagnostic. Formal p95 is nearest rank (max of 5). Diagnostic oracle and operation counts excluded from timing. Every round bracketed by load<=cores/2 and idle>=50% checks; invalid whole rounds retained, not counted. No UI/device acceptance claim.',
};
await writeFile(`${output}/environment.json`, JSON.stringify(metadata, null, 2), { flag: 'wx' });
await writeFile(`${output}/probe.ts`, probe);
await writeFile(`${output}/runner.mjs`, runner);
const attempts = [],
  pairs = [];
const save = async () => {
  await writeFile(`${output}/attempts.json`, JSON.stringify(attempts, null, 2));
  await writeFile(`${output}/pairs.json`, JSON.stringify(pairs, null, 2));
};
let eligible = false;
for (let attempt = 0; attempt < 3; attempt++) {
  const host = await sampleHost();
  attempts.push({ stage: 'preflight', attempt, host });
  await save();
  if (host.valid || verificationOnly) {
    eligible = true;
    break;
  }
  console.log(JSON.stringify({ stage: 'preflight', attempt, host }));
  if (attempt < 2) await delay(30000);
}
if (!eligible) {
  process.exitCode = 2;
} else {
  for (const label of ['A', 'B'])
    for (const mode of ['plain', 'ops']) {
      const sources = {};
      const name = `${label}-${mode}`;
      await build({
        stdin: {
          contents: probe,
          resolveDir: path.resolve('scripts/perf'),
          loader: 'ts',
          sourcefile: 'probe.ts',
        },
        outfile: `${output}/${name}.js`,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'Probe',
        minify: true,
        sourcemap: true,
        plugins: [
          {
            name: 'frozen-revision',
            setup(builder) {
              builder.onLoad({ filter: /\.(ts|tsx)$/ }, ({ path: file }) => {
                const relative = path.relative(process.cwd(), file);
                if (
                  !relative.startsWith('packages/painting/src/') &&
                  !relative.startsWith('apps/playground/src/')
                )
                  return;
                let source = git('show', `${revisions[label]}:${relative}`);
                sources[relative] = hash(source);
                if (mode === 'ops' && relative.endsWith('/core/layeredObjectQuery.ts')) {
                  const replace = (needle, replacement) => {
                    assert(source.includes(needle), `Missing operation-count anchor ${needle}`);
                    source = source.replace(needle, replacement);
                  };
                  replace(
                    'function multiBounds(multi: PolygonBooleanMultiPolygon): Bounds | null {',
                    'function multiBounds(multi: PolygonBooleanMultiPolygon): Bounds | null { globalThis.__ham247Ops.boundsCalls++;'
                  );
                  replace(
                    'const cached = multiBoundsCache.get(multi);\n  if (cached) return cached;',
                    'const cached = multiBoundsCache.get(multi);\n  if (cached) return cached;\n globalThis.__ham247Ops.boundsVertices += multi.reduce((n,p) => n+p.outer.length+p.holes.reduce((n,h)=>n+h.length,0),0);'
                  );
                  replace(
                    'function fastPointInMulti(point: Point, multi: PolygonBooleanMultiPolygon) {',
                    'function fastPointInMulti(point: Point, multi: PolygonBooleanMultiPolygon) { globalThis.__ham247Ops.pointCalls++;'
                  );
                }
                return { contents: source, loader: file.endsWith('.tsx') ? 'tsx' : 'ts' };
              });
            },
          },
        ],
      });
      metadata.bundles[name] = { sha256: hash(await readFile(`${output}/${name}.js`)), sources };
    }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  metadata.browser = browser.version();
  await writeFile(`${output}/environment.json`, JSON.stringify(metadata, null, 2));
  try {
    const pages = {};
    for (const label of ['A', 'B']) {
      pages[label] = await browser.newPage();
      await pages[label].addScriptTag({ path: `${output}/${label}-plain.js` });
    }
    let complete = true;
    matrix: for (const [scenario, count] of cells) {
      for (const label of ['A', 'B'])
        await pages[label].evaluate(
          ({ scenario, count }) => {
            window.cell = Probe.createCell(count, scenario);
          },
          { scenario, count }
        );
      for (const round of verificationOnly ? [7] : [0, 1, 2, 3, 4, 5, 6, 7]) {
        let accepted = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const id = `${scenario}-${count}-r${round}-a${attempt}`;
          const before = await sampleHost();
          const rows = [];
          if (before.valid || verificationOnly)
            for (const prefix of prefixes) {
              const versions = {};
              for (const label of versionOrder(round + attempt)) {
                const startedAt = Date.now();
                const raw = await pages[label].evaluate(
                  ({ prefix, observe }) => window.cell.run(prefix, observe),
                  { prefix, observe: round === 7 }
                );
                const endedAt = Date.now();
                const file = `${id}-p${prefix}-${label}.json`;
                await writeFile(`${output}/${file}`, JSON.stringify(raw));
                versions[label] = {
                  file,
                  queryMs: raw.queryMs,
                  startedAt,
                  endedAt,
                  result: raw.result,
                };
              }
              assert.deepEqual(versions.A.result, versions.B.result, `${id}/p${prefix}`);
              const [first, last] = versionOrder(round + attempt).map((label) => versions[label]);
              assert(last.startedAt >= first.endedAt && last.startedAt - first.endedAt <= 30000);
              rows.push({ scenario, count, prefix, round, attempt, versions });
            }
          const after = before.valid || verificationOnly ? await sampleHost() : before;
          const timingValid = !verificationOnly && before.valid && after.valid;
          accepted = verificationOnly || timingValid;
          attempts.push({ id, before, after, accepted, timingValid });
          if (accepted) pairs.push(...rows);
          await save();
          if (accepted) break;
          console.log(JSON.stringify({ id, invalid: true, before, after }));
          if (attempt < 2) await delay(30000);
        }
        if (!accepted) {
          complete = false;
          break matrix;
        }
      }
      console.log(JSON.stringify({ scenario, count, completedPairs: pairs.length }));
    }
    if (!complete) process.exitCode = 2;
    else {
      // Expensive oracle/operation analysis runs AFTER every formal measurement.
      const summary = [];
      const opsPages = {};
      for (const label of ['A', 'B']) {
        opsPages[label] = await browser.newPage();
        await opsPages[label].evaluate(() => {
          window.__ham247Ops = { boundsCalls: 0, boundsVertices: 0, pointCalls: 0 };
        });
        await opsPages[label].addScriptTag({ path: `${output}/${label}-ops.js` });
      }
      for (const [scenario, count] of cells) {
        for (const label of ['A', 'B'])
          await opsPages[label].evaluate(
            ({ scenario, count }) => {
              window.cell = Probe.createCell(count, scenario);
            },
            { scenario, count }
          );
        for (const prefix of prefixes) {
          const group = pairs.filter(
            (p) => p.scenario === scenario && p.count === count && p.prefix === prefix
          );
          const formal = group.filter((p) => p.round >= 2 && p.round <= 6);
          assert.equal(formal.length, verificationOnly ? 0 : 5);
          const row = { scenario, count, prefix, versions: {} };
          for (const label of ['A', 'B']) {
            // Reproduce the same cache history as the formal prefix sequence.
            const ops = await opsPages[label].evaluate((prefix) => {
              window.cell.run(prefix);
              window.__ham247Ops = { boundsCalls: 0, boundsVertices: 0, pointCalls: 0 };
              const raw = window.cell.run(prefix);
              return { ...window.__ham247Ops, result: raw.result };
            }, prefix);
            const oracle = await opsPages[label].evaluate(
              (prefix) => window.cell.oracle(prefix),
              prefix
            );
            assert.deepEqual(ops.result, oracle, `oracle ${scenario}/${count}/p${prefix}/${label}`);
            const diagnostic = JSON.parse(
              await readFile(
                `${output}/${group.find((p) => p.round === 7).versions[label].file}`,
                'utf8'
              )
            );
            assert.deepEqual(diagnostic.result, oracle);
            const fallbackByObject = {};
            for (const f of diagnostic.fallbacks)
              fallbackByObject[f.objectId] = (fallbackByObject[f.objectId] ?? 0) + f.ms;
            row.versions[label] = {
              p95: verificationOnly
                ? null
                : Math.max(...formal.map((p) => p.versions[label].queryMs)),
              ops,
              candidateCount: diagnostic.candidateCount,
              fallbackByObject,
              diagnosticMs: diagnostic.queryMs,
              fallbackExceeded: verificationOnly
                ? null
                : Object.entries(fallbackByObject).filter(
                    ([, ms]) => ms > diagnostic.queryMs * 0.2
                  ),
            };
          }
          summary.push(row);
          console.log(
            JSON.stringify({
              scenario,
              count,
              prefix,
              verificationOnly,
              versions: Object.fromEntries(
                Object.entries(row.versions).map(([label, value]) => [
                  label,
                  { ...value, ops: { ...value.ops, result: undefined } },
                ])
              ),
            })
          );
        }
      }
      await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
      const lines = [
        verificationOnly
          ? 'Functional verification only: latency and fallback-share acceptance are NOT measured.'
          : '',
        '| 场景/笔数 | 前缀 | A p95 ms | B p95 ms | B−A ms |',
        '| --- | ---: | ---: | ---: | ---: |',
      ];
      for (const r of summary)
        lines.push(
          `| ${r.scenario}/${r.count} | ${r.prefix} | ${r.versions.A.p95?.toFixed(2) ?? 'unmeasured'} | ${r.versions.B.p95?.toFixed(2) ?? 'unmeasured'} | ${verificationOnly ? 'unmeasured' : (r.versions.B.p95 - r.versions.A.p95).toFixed(2)} |`
        );
      await writeFile(`${output}/prefixes.md`, lines.join('\n') + '\n');
    }
  } finally {
    await browser.close();
  }
}
