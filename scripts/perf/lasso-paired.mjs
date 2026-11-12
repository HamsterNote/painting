import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { lassoMetrics } from './lasso-metrics.mjs';
import { pairedLassoResult } from './lasso-paired-result.mjs';

const output = process.argv[2] ?? 'artifacts/research/lasso/paired-v2';
const builds = [
  {
    name: 'baseline',
    root: 'apps/playground/dist',
    sha: '81bff35d05f6e353e2d35601aa395667fb89d046',
  },
  {
    name: 'optimized',
    root: 'artifacts/research/lasso/optimized-export',
    sha: '8f6162249c15119e1234857f3db5fd37915e2809',
  },
];
await mkdir(output, { recursive: true });
for (const build of builds) {
  await cp(`${build.root}/_expo/static/js/web`, `${output}/bundles/${build.name}`, {
    recursive: true,
  });
  build.bundleHashes = {};
  for (const file of await readdir(`${output}/bundles/${build.name}`))
    build.bundleHashes[file] = createHash('sha256')
      .update(await readFile(`${output}/bundles/${build.name}/${file}`))
      .digest('hex');
}
const metadata = {
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diff: execFileSync('git', ['diff'], { encoding: 'utf8' }),
  node: process.version,
  cpu: os.cpus()[0].model,
  cores: os.cpus().length,
  platform: os.platform(),
  release: os.release(),
  builds,
  command: process.argv,
  protocol:
    'Seven fixed rounds/cell: first two warmup, five measured. Alternate version order each round and empty/populated order together. No resampling. Accept a pair only if BOTH drawn-empty FPS >= 0.9*1000/T. Reject both when either fails; retain every raw record. Fewer than five retained pairs means no cell-level acceptance conclusion. Profiling disabled identically for both versions.',
};
await writeFile(`${output}/environment.json`, JSON.stringify(metadata, null, 2));
const pairs = [];
const cells = [
  ['local', 100],
  ['local', 500],
  ['local', 1000],
  ['dense', 100],
  ['dense', 500],
  ['dense', 1000],
  ['mixed', 500],
];
for (const [scenario, count] of cells) {
  for (let round = 0; round < 7; round++) {
    const samples = {};
    const order = round % 2 ? [...builds].reverse() : builds;
    for (const build of order) {
      const folder = `${output}/${scenario}-${count}-r${round}/${build.name}`;
      await mkdir(folder, { recursive: true });
      const log = openSync(`${folder}/stdout.log`, 'w');
      const err = openSync(`${folder}/stderr.log`, 'w');
      console.log('START', scenario, count, round, build.name);
      const child = spawn(process.execPath, ['scripts/perf/lasso-production.mjs', build.name], {
        env: {
          ...process.env,
          LASSO_OUTPUT: folder,
          LASSO_EXPORT_ROOT: build.root,
          LASSO_PRODUCT_SHA: build.sha,
          LASSO_COPY_BUNDLES: '0',
          LASSO_PROFILE: '0',
          LASSO_SCENARIOS: scenario,
          LASSO_COUNTS: String(count),
          LASSO_ROUNDS: '1',
          LASSO_ROUND_OFFSET: String(round),
        },
        stdio: ['ignore', log, err],
      });
      let code;
      try {
        [code] = await once(child, 'exit');
      } finally {
        closeSync(log);
        closeSync(err);
      }
      if (code !== 0) throw new Error(`${folder}: child exit ${code}; see stderr.log`);
      const summary = JSON.parse(await readFile(`${folder}/summary.json`, 'utf8'));
      for (const row of summary.results) {
        const raw = JSON.parse(await readFile(`${folder}/${row.id}.json`, 'utf8'));
        Object.assign(row, lassoMetrics(raw));
        if (raw.inputs.length !== 599 || !raw.unchangedDocument)
          throw new Error(`Invalid fixture: ${folder}/${row.id}`);
        row.raw = `${scenario}-${count}-r${round}/${build.name}/${row.id}.json`;
      }
      samples[build.name] = summary.results;
    }
    const pair = pairedLassoResult({ scenario, count, round, samples });
    pairs.push(pair);
    await writeFile(`${output}/pairs.json`, JSON.stringify({ metadata, pairs }, null, 2));
    console.log(JSON.stringify(pair));
  }
}
