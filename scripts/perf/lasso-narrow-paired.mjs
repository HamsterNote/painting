import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const root = process.argv[2] ?? 'artifacts/research/lasso/narrow-paired';
const sourcePath = 'packages/painting/src/core/layeredObjectQuery.ts';
const baseline = execFileSync('git', ['rev-parse', '81bff35'], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const original = execFileSync('git', ['show', `${baseline}:${sourcePath}`], { encoding: 'utf8' });
const sharedDiff = execFileSync(
  'git',
  [
    'diff',
    baseline,
    '--',
    'packages/painting/src/geometry',
    'packages/painting/src/model',
    'packages/painting/src/core/polygonBoolean.ts',
    'apps/playground/src/layered-editor/lassoPerformanceFixture.ts',
    'pnpm-lock.yaml',
  ],
  { encoding: 'utf8' }
);
if (sharedDiff.trim())
  throw new Error('Shared geometry/fixture/dependency sources differ from original baseline');
await mkdir(root, { recursive: true });
const metadata = {
  baseline,
  head,
  sharedDiff,
  queryDiff: execFileSync('git', ['diff', baseline, '--', sourcePath], { encoding: 'utf8' }),
  command: process.argv,
  node: process.version,
  cpu: os.cpus()[0].model,
  cores: os.cpus().length,
  release: os.release(),
  loadAverage: os.loadavg(),
  startedAt: new Date().toISOString(),
  bundles: {},
  method:
    'Original 81bff35 queryObjectLasso versus current createLayeredLassoQuery+step(Infinity), identical prepared document/fixture. Two isolated pages, serial alternating version order, 2 warmup/5 formal/1 diagnostic rounds. No resampling or performance-based exclusions. Diagnostic round alone enables fallback clock/events and checks every prefix against unchanged oracle; excluded from formal query p95. Query-only diagnostic, not UI SLA. Every prefix and every cell compared against original without relaxing thresholds.',
};
for (const version of ['original', 'narrow']) {
  await build({
    entryPoints: [`scripts/perf/lasso-${version === 'original' ? 'original' : 'narrow'}-probe.ts`],
    outfile: `${root}/${version}.js`,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Probe',
    minify: true,
    sourcemap: true,
    plugins:
      version === 'original'
        ? [
            {
              name: 'exact-original-query',
              setup(b) {
                b.onLoad({ filter: /[/\\]core[/\\]layeredObjectQuery\.ts$/ }, (args) => ({
                  contents: original,
                  loader: 'ts',
                  resolveDir: path.dirname(args.path),
                }));
              },
            },
          ]
        : [],
  });
  metadata.bundles[version] = createHash('sha256')
    .update(await readFile(`${root}/${version}.js`))
    .digest('hex');
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const rows = [];
try {
  metadata.browser = browser.version();
  const pages = {};
  for (const version of ['original', 'narrow']) {
    pages[version] = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await pages[version].addScriptTag({ path: `${root}/${version}.js` });
  }
  await writeFile(`${root}/environment.json`, JSON.stringify(metadata, null, 2));
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
    for (const v of ['original', 'narrow'])
      await pages[v].evaluate(
        ({ scenario, count }) => {
          window.cell = Probe.createCell(count, scenario);
        },
        { scenario, count }
      );
    for (let round = 0; round < 8; round++)
      for (const prefix of [3, 30, 150, 300, 450, 599, 600]) {
        const row = {
          scenario,
          count,
          prefix,
          round,
          warmup: round < 2,
          diagnostic: round === 7,
          versions: {},
        };
        const raw = {};
        for (const version of round % 2 ? ['narrow', 'original'] : ['original', 'narrow']) {
          raw[version] = await pages[version].evaluate(
            ({ prefix, observe }) => window.cell.run(prefix, observe),
            { prefix, observe: round === 7 }
          );
          const file = `${scenario}-${count}-p${prefix}-r${round}-${version}.json`;
          await writeFile(`${root}/${file}`, JSON.stringify(raw[version]));
          row.versions[version] = { file, queryMs: raw[version].queryMs };
        }
        if (JSON.stringify(raw.original.result) !== JSON.stringify(raw.narrow.result))
          throw new Error(`Original result mismatch ${scenario}/${count}/${prefix}/r${round}`);
        if (round === 7) {
          const oracle = await pages.narrow.evaluate(
            (prefix) => window.cell.oracle(prefix),
            prefix
          );
          if (JSON.stringify(oracle) !== JSON.stringify(raw.narrow.result))
            throw new Error('Diagnostic oracle mismatch');
          row.fallback = {
            candidateCount: raw.narrow.candidateCount,
            fallbackCandidates: raw.narrow.fallbackCandidates,
            fallbackMs: raw.narrow.fallbackMs,
            timeShare: raw.narrow.fallbackTimeShare,
          };
        }
        rows.push(row);
      }
    await writeFile(`${root}/partial-index.json`, JSON.stringify(rows, null, 2));
    console.log(JSON.stringify({ scenario, count, completedPairs: rows.length }));
  }
  const p95 = (values) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const summary = rows
    .filter((r) => r.diagnostic)
    .map((r) => {
      const measured = rows.filter(
        (m) =>
          !m.warmup &&
          !m.diagnostic &&
          m.scenario === r.scenario &&
          m.count === r.count &&
          m.prefix === r.prefix
      );
      const originalP95 = p95(measured.map((m) => m.versions.original.queryMs));
      const narrowP95 = p95(measured.map((m) => m.versions.narrow.queryMs));
      return {
        scenario: r.scenario,
        count: r.count,
        prefix: r.prefix,
        originalP95,
        narrowP95,
        deltaMs: narrowP95 - originalP95,
        noWorse: narrowP95 <= originalP95,
        ...r.fallback,
      };
    });
  await writeFile(`${root}/pairs.json`, JSON.stringify(rows, null, 2));
  await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ pairs: rows.length, summary }, null, 2));
} finally {
  await browser.close();
}
