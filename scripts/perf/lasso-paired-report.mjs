import { readFile, writeFile } from 'node:fs/promises';
import { lassoObservability, p95 } from './lasso-observability.mjs';

const directory = process.argv[2] ?? 'artifacts/research/lasso/paired-v2';
const { metadata, pairs } = JSON.parse(await readFile(`${directory}/pairs.json`, 'utf8'));
if (pairs.length !== 49) throw new Error(`Incomplete fixed matrix: ${pairs.length}/49 pairs`);
const cells = [];
const observations = [];
const index = [];
const csv = [
  [
    'scenario',
    'count',
    'round',
    'warmup',
    'retainedForBoth',
    'rejectedBy',
    'version',
    'raw',
    'controlFPS',
    'controlT',
    'drawingFPS',
    'drawingDrop',
    'previewP95',
    'finalMs',
    'submissionGapP95',
    'submissionIntervalP95',
    'maximumSubmissionGap',
    'changedSelectionCount',
    'submissionCount',
  ],
];
for (const pair of pairs) {
  for (const name of ['baseline', 'optimized']) {
    const { control, drawing } = pair.variants[name];
    const raw = JSON.parse(await readFile(`${directory}/${drawing.raw}`, 'utf8'));
    const rawControl = JSON.parse(await readFile(`${directory}/${control.raw}`, 'utf8'));
    const controlIdleFPS =
      ((rawControl.idle.length - 1) * 1000) / (rawControl.idle.at(-1) - rawControl.idle[0]);
    const observation = lassoObservability(raw);
    observations.push({
      scenario: pair.scenario,
      count: pair.count,
      round: pair.round,
      warmup: pair.warmup,
      retainedForBoth: pair.retained,
      version: name,
      raw: drawing.raw,
      controlIdleFPS,
      controlDrawingFPS: control.fps,
      ...observation,
    });
    index.push({
      pair: `${pair.scenario}-${pair.count}-r${pair.round}`,
      version: name,
      control: control.raw,
      drawing: drawing.raw,
      retained: pair.retained,
      rejectedBy: pair.rejectedBy,
    });
    csv.push([
      pair.scenario,
      pair.count,
      pair.round,
      pair.warmup,
      pair.retained,
      pair.rejectedBy.join('+'),
      name,
      drawing.raw,
      control.fps,
      control.T,
      drawing.fps,
      drawing.dropRate,
      drawing.previewP95,
      drawing.finalMs,
      observation.submissionGapP95,
      observation.submissionIntervalP95,
      observation.maximumSubmissionGap,
      observation.changedSelectionCount,
      observation.submissionCount,
    ]);
  }
}
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2
    : null;
};
for (const [scenario, count] of [
  ['local', 100],
  ['local', 500],
  ['local', 1000],
  ['dense', 100],
  ['dense', 500],
  ['dense', 1000],
  ['mixed', 500],
]) {
  const attempted = pairs.filter((p) => p.scenario === scenario && p.count === count && !p.warmup);
  if (attempted.length !== 5) throw new Error(`Missing formal rounds: ${scenario}/${count}`);
  const retained = attempted.filter((p) => p.retained);
  const cell = {
    scenario,
    count,
    attemptedEach: attempted.length,
    retainedEach: retained.length,
    completeFivePairedControls: retained.length === 5,
    rejected: attempted
      .filter((p) => !p.retained)
      .map((p) => ({ round: p.round, rejectedBy: p.rejectedBy })),
    variants: {},
  };
  for (const name of ['baseline', 'optimized']) {
    const rows = retained.map((p) => p.variants[name]);
    const obs = observations.filter(
      (o) =>
        o.scenario === scenario &&
        o.count === count &&
        o.version === name &&
        !o.warmup &&
        o.retainedForBoth
    );
    cell.variants[name] = {
      n: rows.length,
      fpsMedian: rows.length === 5 ? median(rows.map((r) => r.drawing.fps)) : null,
      fpsRatioToOwnControlMedian:
        rows.length === 5 ? median(rows.map((r) => r.drawing.fps / r.control.fps)) : null,
      dropIncrementMedian:
        rows.length === 5 ? median(rows.map((r) => r.drawing.dropRate - r.control.dropRate)) : null,
      previewP95AcrossRoundP95:
        rows.length !== 5 || rows.some((r) => r.drawing.previewP95 === null)
          ? null
          : p95(rows.map((r) => r.drawing.previewP95)),
      finalP95: rows.length === 5 ? p95(rows.map((r) => r.drawing.finalMs)) : null,
      submissionGapP95AcrossRoundP95: p95(obs.map((o) => o.submissionGapP95)),
      maximumSubmissionGap: obs.length ? Math.max(...obs.map((o) => o.maximumSubmissionGap)) : null,
    };
  }
  cell.matchedFPSRatioMedian = median(
    retained.map((p) =>
      p.variants.baseline.drawing.fps > 0
        ? p.variants.optimized.drawing.fps / p.variants.baseline.drawing.fps
        : null
    )
  );
  cell.verdict =
    retained.length === 5
      ? 'Five common controls available; numerical comparison only. Overall acceptance withheld until query-observability alternative is confirmed.'
      : 'INCONCLUSIVE: fewer than five common valid control pairs. No improvement ratio or pass/fail conclusion from residual samples.';
  if (retained.length !== 5 || retained.some((p) => p.variants.baseline.drawing.fps <= 0))
    cell.matchedFPSRatioMedian = null;
  cells.push(cell);
}
await writeFile(`${directory}/paired-report.json`, JSON.stringify({ metadata, cells }, null, 2));
await writeFile(`${directory}/observability.json`, JSON.stringify(observations, null, 2));
await writeFile(`${directory}/raw-index.json`, JSON.stringify(index, null, 2));
await writeFile(
  `${directory}/rounds.csv`,
  csv.map((row) => row.map((x) => JSON.stringify(x ?? null)).join(',')).join('\n') + '\n'
);
const fmt = (n) => (n === null ? '不可判' : n.toFixed(2));
const markdown = [
  '# HAM-245 对称复测结果',
  '',
  '所有剔除均作用于整对，未补采、未分别选择两版好样本。五轮正式测量必须保留五对空控制，才提供该场景改善比值。下列数值不能直接替代尚未确认的实时选区判据。',
  '',
  '| 场景/笔数 | 尝试数/版 | 共同保留数/版 | FPS中位数 原版/优化 | 最终p95 ms 原版/优化 | 改善倍数（仅完整5对） |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...cells.map(
    (c) =>
      `| ${c.scenario}/${c.count} | ${c.attemptedEach} | ${c.retainedEach} | ${fmt(c.variants.baseline.fpsMedian)} / ${fmt(c.variants.optimized.fpsMedian)} | ${fmt(c.variants.baseline.finalP95)} / ${fmt(c.variants.optimized.finalP95)} | ${fmt(c.matchedFPSRatioMedian)} |`
  ),
  '',
  '原始索引：`raw-index.json`；逐轮值/剔除理由：`pairs.json` 与 `rounds.csv`；实际结果提交调用（包括等值选区）及通知间隔：`observability.json`。每个原始记录同目录保存 stdout.log、stderr.log、environment.json 和 summary.json。',
  '',
];
await writeFile(`${directory}/paired-report.md`, markdown.join('\n'));
console.log(markdown.join('\n'));
console.log(
  'Common retained pairs, BOTH versions:',
  cells.reduce((n, c) => n + c.retainedEach, 0)
);
console.log('Complete cells:', cells.filter((c) => c.completeFivePairedControls).length, '/7');
