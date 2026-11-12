import { readFile, readdir, writeFile } from 'node:fs/promises';
import { p95 } from './lasso-observability.mjs';
const directory = process.argv[2] ?? 'artifacts/research/lasso/query-probe-v2';
const groups = new Map();
const median = (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  return a.length
    ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2
    : null;
};
for (const file of await readdir(directory)) {
  const match = /^(local|dense|mixed)-(\d+)-p(\d+)-r(\d+)\.json$/.exec(file);
  if (!match) continue;
  const [, scenario, count, prefix, round] = match;
  const key = `${scenario}-${count}-p${prefix}`;
  const raw = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
  if (!groups.has(key))
    groups.set(key, { scenario, count: Number(count), prefix: Number(prefix), rows: [] });
  groups.get(key).rows.push({ ...raw, round: Number(round), raw: file });
}
const results = [];
for (const group of groups.values()) {
  const attempts = group.rows.filter((r) => r.round >= 2 && r.round <= 6);
  if (attempts.length !== 5)
    throw new Error(
      `Incomplete probe ${group.scenario}/${group.count}/${group.prefix}: ${attempts.length}`
    );
  const rows = attempts.filter((r) => !r.invalid);
  const atomic = rows.map((r) => Math.max(...r.atomic.map((a) => a.ms)));
  const longest = rows
    .flatMap((r) =>
      r.atomic.map((a) => ({ ...a, raw: r.raw, object: r.geometry[a.index] ?? null }))
    )
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10);
  results.push({
    scenario: group.scenario,
    count: group.count,
    prefix: group.prefix,
    n: rows.length,
    invalid: attempts.filter((r) => r.invalid).map((r) => ({ raw: r.raw, reason: r.invalid })),
    raw: group.rows.map((r) => r.raw),
    observedQueryMinMs: rows.length ? Math.min(...rows.map((r) => r.measuredQueryMs)) : null,
    queryMedianMs: median(rows.map((r) => r.measuredQueryMs)),
    queryP95Ms: p95(rows.map((r) => r.measuredQueryMs)),
    setupP95Ms: p95(rows.map((r) => r.setupMs)),
    maxAtomicP95Ms: p95(atomic),
    stepSumP95Ms: p95(rows.map((r) => r.workMs)),
    workWallP95Ms: p95(rows.map((r) => r.workWallMs)),
    selectionEqualP95Ms: p95(rows.map((r) => r.selectionEqualMs)),
    membershipSetP95Ms: p95(rows.map((r) => r.membershipSetMs)),
    candidates: rows[0]?.candidateCount ?? null,
    hits: rows[0]?.hits ?? null,
    referenceMembershipVisits: rows[0]?.referenceMembershipVisits ?? null,
    setMembershipVisits: rows[0]?.setMembershipVisits ?? null,
    boundaryPairUpperBound: rows[0]?.referenceBoundaryPairUpperBound ?? null,
    longestAtomic: longest,
  });
}
if (results.length !== 63) throw new Error(`Expected 63 prefix groups; found ${results.length}`);
const oracle = [];
for (const group of groups.values())
  for (const r of group.rows) if (r.oracle) oracle.push({ raw: r.raw, ...r.oracle });
if (oracle.length !== 9 || oracle.some((r) => !r.orderedMatch))
  throw new Error('Missing or mismatched complete-query oracle results');
await writeFile(
  `${directory}/probe-report.json`,
  JSON.stringify(
    {
      method:
        'Two warmup/five unprofiled measured; eighth profile/oracle excluded. Values describe standalone instrumented browser geometry work, not UI performance or a mathematical lower bound.',
      results,
      oracle,
    },
    null,
    2
  )
);
const columns = [
  'scenario',
  'count',
  'prefix',
  'n',
  'observedQueryMinMs',
  'queryMedianMs',
  'queryP95Ms',
  'setupP95Ms',
  'maxAtomicP95Ms',
  'workWallP95Ms',
  'stepSumP95Ms',
  'selectionEqualP95Ms',
  'membershipSetP95Ms',
  'candidates',
  'hits',
  'referenceMembershipVisits',
  'setMembershipVisits',
  'boundaryPairUpperBound',
];
await writeFile(
  `${directory}/probe-report.csv`,
  [columns.join(','), ...results.map((r) => columns.map((k) => r[k] ?? '').join(','))].join('\n') +
    '\n'
);
const fmt = (n) => (n === null ? '不可判' : n.toFixed(2));
const md = [
  '# 独立浏览器几何诊断',
  '',
  '以下列出完整600点与1000笔的150点前缀；全63组在JSON/CSV。最短只是实测范围，不是数学下限。',
  '',
  '| 场景/笔数/点数 | 候选/命中 | 查询 min / median / p95 ms | setup p95 | 最大原子step p95 | 等值setSelection p95 |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...results
    .filter((r) => r.prefix === 600 || (r.count === 1000 && r.prefix === 150))
    .map(
      (r) =>
        `| ${r.scenario}/${r.count}/${r.prefix} | ${r.candidates}/${r.hits} | ${fmt(r.observedQueryMinMs)} / ${fmt(r.queryMedianMs)} / ${fmt(r.queryP95Ms)} | ${fmt(r.setupP95Ms)} | ${fmt(r.maxAtomicP95Ms)} | ${fmt(r.selectionEqualP95Ms)} |`
    ),
  '',
  `完整oracle：${oracle.filter((r) => r.orderedMatch).length}/9有序结果一致。`,
  '',
];
await writeFile(`${directory}/probe-report.md`, md.join('\n'));
console.log(md.join('\n'));
