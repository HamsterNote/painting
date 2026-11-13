import { readFile, writeFile } from 'node:fs/promises';
import { lassoObservability, p95 } from './lasso-observability.mjs';
import { lassoQueryTiming } from './lasso-query-timing.mjs';

const root = process.argv[2] ?? 'artifacts/research/lasso/membership-paired-v3';
const { metadata, pairs } = JSON.parse(await readFile(`${root}/pairs.json`, 'utf8'));
if (pairs.length !== 49) throw new Error(`Incomplete matrix ${pairs.length}/49`);
const rows = [],
  index = [],
  causalExamples = [];
for (const pair of pairs)
  for (const version of ['baseline', 'optimized']) {
    const { control, drawing } = pair.variants[version];
    const raw = JSON.parse(await readFile(`${root}/${drawing.raw}`, 'utf8'));
    const timing = lassoQueryTiming(raw);
    await writeFile(
      `${root}/${drawing.raw.replace('.json', '.query-timing.json')}`,
      JSON.stringify(timing)
    );
    for (const query of timing.queries.filter((q) => q.ok && !q.final)) {
      const latest = raw.inputs.filter((i) => i.start < query.time).at(-1);
      if (latest && latest.index > query.pointCount - 2) {
        causalExamples.push({
          raw: drawing.raw,
          version,
          round: pair.round,
          queryVersion: query.version,
          capturedInputPrefix: query.pointCount - 2,
          queryStart: query.start,
          queryComplete: query.time,
          latestDeliveredInputAtCompletion: latest.index,
          newerInputActualMatch: timing.perInput.find((i) => i.index === latest.index),
        });
        break;
      }
    }
    const {
      inputToQueryCompletion: _oldProxy,
      proposedAlternative: _rejectedAlternative,
      ...cadence
    } = lassoObservability(raw);
    const { perInput: _perInput, queries: _queries, ...timingSummary } = timing;
    const selectionCallP95 = p95(
      raw.methods
        .filter((m) => m.name === 'setSelection' && m.start < raw.up.start)
        .map((m) => m.duration)
    );
    const row = {
      scenario: pair.scenario,
      count: pair.count,
      round: pair.round,
      warmup: pair.warmup,
      version,
      commonControlValid: pair.retained,
      rejectedBy: pair.rejectedBy,
      coverage: pair.retained ? '共同有效（场景另需完整五对）' : '未覆盖',
      raw: drawing.raw,
      timing: drawing.raw.replace('.json', '.query-timing.json'),
      T: drawing.T,
      controlFPS: control.fps,
      fps: drawing.fps,
      fpsRatio: drawing.fps / control.fps,
      dropIncrementPP: 100 * (drawing.dropRate - control.dropRate),
      previewP95: drawing.previewP95,
      sourcePreviewP95: drawing.sourcePreviewP95,
      finalMs: drawing.finalMs,
      ...timingSummary,
      selectionCallP95,
      ...cadence,
    };
    rows.push(row);
    index.push({
      scenario: pair.scenario,
      count: pair.count,
      round: pair.round,
      version,
      control: control.raw,
      drawing: drawing.raw,
      timing: row.timing,
      commonControlValid: pair.retained,
      rejectedBy: pair.rejectedBy,
    });
  }
const cells = [];
for (const [scenario, count] of [
  ['local', 100],
  ['local', 500],
  ['local', 1000],
  ['dense', 100],
  ['dense', 500],
  ['dense', 1000],
  ['mixed', 500],
]) {
  const attempts = pairs.filter((p) => !p.warmup && p.scenario === scenario && p.count === count);
  if (attempts.length !== 5) throw new Error('Missing formal pairs');
  const retained = attempts.filter((p) => p.retained).length;
  const variants = {};
  for (const version of ['baseline', 'optimized']) {
    const samples = rows.filter(
      (r) =>
        !r.warmup &&
        r.scenario === scenario &&
        r.count === count &&
        r.version === version &&
        r.commonControlValid
    );
    const keys = [
      'inputToQueryP95',
      'actualInputToSelectionP95',
      'actualInputToOpportunityP95',
      'inputToSelectionP95',
      'inputToOpportunityP95',
      'sourceToOpportunityP95',
      'liveQueryWallP95',
      'selectionCallP95',
      'submissionGapP95',
      'maximumSubmissionGap',
      'finalMs',
    ];
    variants[version] = {
      n: samples.length,
      worstRound: Object.fromEntries(
        keys.map((k) => [
          k,
          retained === 5 && samples.every((r) => r[k] !== null)
            ? Math.max(...samples.map((r) => r[k]))
            : null,
        ])
      ),
      individualRounds: samples.map((r) => ({
        round: r.round,
        raw: r.raw,
        ...Object.fromEntries(keys.map((k) => [k, r[k]])),
      })),
    };
  }
  cells.push({
    scenario,
    count,
    attemptedEach: 5,
    retainedEach: retained,
    coverage: retained === 5 ? '本轮成员检查前后对照已覆盖' : '未覆盖',
    // This comparison is v2+marks versus v2+marks+membership fix, NOT the original v1 baseline.
    originalV1Baseline: scenario === 'local' && count === 100 ? 'v2历史记录有完整五对' : '未覆盖',
    variants,
  });
}
const columns = [
  'scenario',
  'count',
  'round',
  'warmup',
  'version',
  'commonControlValid',
  'raw',
  'T',
  'fps',
  'fpsRatio',
  'dropIncrementPP',
  'previewP95',
  'finalMs',
  'inputs',
  'selectedInputs',
  'opportunityInputs',
  'inputToQueryP95',
  'actualInputToQueryP95',
  'actualInputToSelectionP95',
  'actualInputToOpportunityP95',
  'actualSourceToOpportunityP95',
  'inputToSelectionP95',
  'inputToOpportunityP95',
  'sourceToOpportunityP95',
  'liveQueryWallP95',
  'selectionCallP95',
  'submissionGapP95',
  'maximumSubmissionGap',
];
await writeFile(
  `${root}/rounds.csv`,
  [
    columns.join(','),
    ...rows.map((r) => columns.map((k) => JSON.stringify(r[k] ?? null)).join(',')),
  ].join('\n') + '\n'
);
await writeFile(`${root}/raw-index.json`, JSON.stringify(index, null, 2));
await writeFile(`${root}/query-causality-examples.json`, JSON.stringify(causalExamples, null, 2));
await writeFile(
  `${root}/membership-report.json`,
  JSON.stringify({ metadata, cells, rows }, null, 2)
);
const fmt = (n) => (n === null ? '∞/无有限p95' : n.toFixed(2));
const md = [
  '# 成员检查单项优化：实际查询时序',
  '',
  'baseline=已有套索优化+相同测试埋点；optimized=仅新增线性成员检查。不是原始v1对照。场景不足五对共同有效控制一律未覆盖，不算失败或通过。表中为五个正式轮次各自p95的最大值；逐轮分子分母和所有指标见CSV/JSON。',
  '',
  '| 场景/笔数 | 共同保留/版 | 原始v1基线 | 全程实际提交p95 前/后 ms | 全程实际机会p95 前/后 ms | 实时截止提交p95 前/后 ms | 实时截止机会p95 前/后 ms | 查询墙钟p95 前/后 ms |',
  '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ...cells.map((c) => {
    const pair = (k) =>
      c.retainedEach === 5
        ? `${fmt(c.variants.baseline.worstRound[k])} / ${fmt(c.variants.optimized.worstRound[k])}`
        : '未覆盖';
    return `| ${c.scenario}/${c.count} | ${c.retainedEach}/5 | ${c.originalV1Baseline} | ${pair('actualInputToSelectionP95')} | ${pair('actualInputToOpportunityP95')} | ${pair('inputToSelectionP95')} | ${pair('inputToOpportunityP95')} | ${pair('liveQueryWallP95')} |`;
  }),
  '',
  '全程实际值包含最终提交并保留其final阶段标签；实时截止值仅统计up前反馈，缺失输入以Infinity留在分母，不能将截止前未完成误说为实际永不完成。最终结果不补实时指标。输入匹配固化query pointCount/version，源计划/投递/接受/start/complete/submit/呈现机会可重算。真实硬件需用sample.timeStamp另测；rAF不是物理paint。gap/silence仅补充，不替换100ms判据。',
  '',
];
await writeFile(`${root}/membership-report.md`, md.join('\n'));
console.log(md.join('\n'));
console.log(
  JSON.stringify({
    rawRecords: pairs.length * 4,
    matchedFormalEach: pairs.filter((p) => !p.warmup && p.retained).length,
    fullCells: cells.filter((c) => c.retainedEach === 5).length,
  })
);
