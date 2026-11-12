import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { lassoObservability } from './lasso-observability.mjs';
const input = process.argv[2] ?? 'artifacts/research/lasso/optimized-chromium';
const output = process.argv[3] ?? 'artifacts/research/lasso/tails-v2';
await mkdir(output, { recursive: true });
const rows = JSON.parse(await readFile(`${input}/recomputed-summary.json`, 'utf8')).results;
const tails = [];
for (const row of rows.filter((r) => !r.warmup && r.count)) {
  const raw = JSON.parse(await readFile(`${input}/${row.id}.json`, 'utf8'));
  tails.push({
    id: row.id,
    scenario: row.scenario,
    count: row.count,
    round: row.round,
    sourcePreviewP95: row.sourcePreviewP95,
    deliveredPreviewP95: row.previewP95,
    inputLatenessP95: row.inputLatenessP95,
    rawIndex: `HAM-245-optimized.zip/optimized-chromium/${row.id}.json`,
    ...lassoObservability(raw),
  });
}
tails.sort((a, b) => b.final.totalMs - a.final.totalMs);
await writeFile(`${output}/old-tail-timings.json`, JSON.stringify(tails, null, 2));
for (const tail of tails) await copyFile(`${input}/${tail.id}.json`, `${output}/${tail.id}.json`);
const profiles = JSON.parse(await readFile(`${input}/profiling.json`, 'utf8'));
const dense = profiles.find((p) => p.file === 'dense-1000-pair1000-r6.cpuprofile');
for (const filename of ['dense-1000-pair1000-r6.cpuprofile', 'dense-1000-pair1000-r6.trace.json'])
  await copyFile(`${input}/${filename}`, `${output}/${filename}`);
await copyFile(`${input}/recomputed-summary.json`, `${output}/old-recomputed-summary.json`);
await writeFile(
  `${output}/dense-1000-old-symbolicated-profile.json`,
  JSON.stringify(dense, null, 2)
);
console.log('Historical samples: timing envelopes only; no pass/fail or improvement verdict.');
for (const r of tails.slice(0, 10))
  console.log(JSON.stringify({ id: r.id, raw: r.rawIndex, ...r.final }));
