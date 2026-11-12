import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const root = process.argv[2] ?? 'artifacts/research/lasso/compatibility-paired';
const baseline = 'a0170dec8ef815de06b68c0130e52d9801037249';
const sourcePath = 'packages/painting/src/core/layeredObjectQuery.ts';
const oldSource = execFileSync('git', ['show', `${baseline}:${sourcePath}`], { encoding: 'utf8' });
await mkdir(root, { recursive: true });
const metadata = {
  baseline,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diff: execFileSync(
    'git',
    [
      'diff',
      baseline,
      '--',
      'packages/painting/src/core',
      'packages/painting/src/geometry',
      'packages/painting/src/model',
    ],
    { encoding: 'utf8' }
  ),
  command: process.argv,
  startedAt: new Date().toISOString(),
  node: process.version,
  cpu: os.cpus()[0].model,
  cores: os.cpus().length,
  release: os.release(),
  loadAverage: os.loadavg(),
  method:
    'Same current diagnostic harness/fixture; baseline query module read exactly from a0170de, all other modules shared. Two isolated pages in one Chromium, serial alternating version order, eight rounds (two warmup/five formal/one oracle diagnostic), no performance-based exclusions. Prepared-state continuous query timings, not UI/frame/input SLA. Additional two compatibility cases use 100 repetitions/round; report per-query averages separately from per-query p95.',
  bundles: {},
};
for (const version of ['before', 'after']) {
  await build({
    entryPoints: ['scripts/perf/lasso-compatibility-probe.ts'],
    outfile: `${root}/${version}.js`,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'CompatibilityProbe',
    minify: true,
    sourcemap: true,
    plugins:
      version === 'before'
        ? [
            {
              name: 'frozen-query-module',
              setup(builder) {
                builder.onLoad({ filter: /[/\\]core[/\\]layeredObjectQuery\.ts$/ }, (args) => ({
                  contents: oldSource,
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
  for (const version of ['before', 'after']) {
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
    for (const version of ['before', 'after'])
      await pages[version].evaluate(
        ({ scenario, count }) => {
          window.cell = CompatibilityProbe.createProbeCell(count, scenario);
        },
        { scenario, count }
      );
    for (let round = 0; round < 8; round++)
      for (const prefix of [3, 30, 150, 300, 450, 599, 600]) {
        const pair = {
          scenario,
          count,
          prefix,
          round,
          warmup: round < 2,
          diagnostic: round === 7,
          versions: {},
        };
        for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
          const raw = await pages[version].evaluate(
            ({ prefix, round }) => window.cell.run(prefix, round),
            { prefix, round }
          );
          const file = `${scenario}-${count}-p${prefix}-r${round}-${version}.json`;
          await writeFile(`${root}/${file}`, JSON.stringify(raw));
          pair.versions[version] = {
            file,
            invalid: raw.invalid,
            setupMs: raw.setupMs,
            queryMs: raw.measuredQueryMs,
            workMs: raw.workWallMs,
            hits: raw.hits,
          };
        }
        rows.push(pair);
      }
    console.log(JSON.stringify({ scenario, count, completedPairs: rows.length }));
  }
  const compatibility = [];
  for (const collinear of [false, true]) {
    for (const version of ['before', 'after'])
      await pages[version].evaluate((collinear) => {
        window.compatibility = CompatibilityProbe.createCompatibilityCell(collinear);
      }, collinear);
    for (let round = 0; round < 7; round++)
      for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
        const result = await pages[version].evaluate(() => window.compatibility.run(100));
        if (version === 'after' && JSON.stringify(result.result) !== JSON.stringify(result.oracle))
          throw new Error('Compatibility benchmark differs from unchanged oracle');
        compatibility.push({ collinear, round, version, warmup: round < 2, ...result });
      }
  }
  const p95 = (values) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const summary = [];
  for (const cell of rows.filter((r) => r.round === 2)) {
    const matched = rows.filter(
      (r) =>
        !r.warmup &&
        !r.diagnostic &&
        r.scenario === cell.scenario &&
        r.count === cell.count &&
        r.prefix === cell.prefix
    );
    const stats = { scenario: cell.scenario, count: cell.count, prefix: cell.prefix };
    for (const version of ['before', 'after'])
      stats[version] = {
        queryP95Ms: p95(matched.map((r) => r.versions[version].queryMs)),
        workP95Ms: p95(matched.map((r) => r.versions[version].workMs)),
        hits: matched.map((r) => r.versions[version].hits),
      };
    stats.deltaMs = stats.after.queryP95Ms - stats.before.queryP95Ms;
    summary.push(stats);
  }
  await writeFile(`${root}/pairs.json`, JSON.stringify({ rows, compatibility }, null, 2));
  await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ pairs: rows.length, summary, compatibility }, null, 2));
} finally {
  await browser.close();
}
