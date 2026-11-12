import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.argv[2] ?? 'artifacts/research/lasso/narrow-paired';
const read = async (name) => JSON.parse(await readFile(`${root}/${name}`, 'utf8'));
const summary = await read('summary.json'),
  pairs = await read('pairs.json'),
  env = await read('environment.json');
assert.equal(summary.length, 63);
assert.equal(pairs.length, 504);
assert.equal(env.sharedDiff, '');
const provenance = [];
for (const [version, sha] of [
  ['original', env.baseline],
  ['narrow', env.head],
]) {
  const map = await read(`${version}.js.map`);
  const index = map.sources.findIndex((s) =>
    s.endsWith('packages/painting/src/core/layeredObjectQuery.ts')
  );
  assert(index >= 0);
  const expected = execFileSync(
    'git',
    ['show', `${sha}:packages/painting/src/core/layeredObjectQuery.ts`],
    { encoding: 'utf8' }
  );
  assert.equal(map.sourcesContent[index], expected);
  assert.equal(
    createHash('sha256')
      .update(await readFile(`${root}/${version}.js`))
      .digest('hex'),
    env.bundles[version]
  );
  provenance.push({ version, sha, mapSourceMatches: true, bundleHashMatches: true });
}

// Cause analysis over the saved diagnostic geometry only, outside all timings.
// The fixture is an ellipse arc plus its moving closing chord. Count which
// segment boxes overlap fallback objects; do not use this analysis as a predicate.
function explain(raw) {
  const selected = new Set(raw.result.ok ? raw.result.value.map((h) => h.objectId) : []);
  const objects = [];
  for (const object of raw.fallbackObjects) {
    let closingPairs = 0,
      arcPairs = 0;
    for (const piece of object.polygons)
      for (const polygon of piece)
        for (const ring of [polygon.outer, ...polygon.holes])
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i],
              b = ring[(i + 1) % ring.length],
              m = object.margin;
            const minX = Math.min(a.x, b.x) - m,
              maxX = Math.max(a.x, b.x) + m,
              minY = Math.min(a.y, b.y) - m,
              maxY = Math.max(a.y, b.y) + m;
            for (let j = 0; j < raw.path.length; j++) {
              const c = raw.path[j],
                d = raw.path[(j + 1) % raw.path.length];
              if (
                minX > Math.max(c.x, d.x) ||
                Math.min(c.x, d.x) > maxX ||
                minY > Math.max(c.y, d.y) ||
                Math.min(c.y, d.y) > maxY
              )
                continue;
              if (j === raw.path.length - 1) closingPairs++;
              else arcPairs++;
            }
          }
    objects.push({
      objectId: object.objectId,
      kind: object.kind,
      selected: selected.has(object.objectId),
      closingPairs,
      arcPairs,
    });
  }
  return {
    objects,
    closingOnly: objects.filter((o) => o.closingPairs > 0 && o.arcPairs === 0).length,
    arcOnly: objects.filter((o) => o.arcPairs > 0 && o.closingPairs === 0).length,
    both: objects.filter((o) => o.closingPairs > 0 && o.arcPairs > 0).length,
    unclassified: objects.filter((o) => o.closingPairs === 0 && o.arcPairs === 0).length,
    finallyUnselected: objects.filter((o) => !o.selected).length,
  };
}
const rows = [];
for (const s of summary) {
  const diagnostic = pairs.find(
    (p) => p.diagnostic && p.scenario === s.scenario && p.count === s.count && p.prefix === s.prefix
  );
  const raw = await read(diagnostic.versions.narrow.file);
  assert(s.fallbackCandidates <= s.candidateCount);
  assert.equal(s.fallbackCandidates, new Set(raw.fallbacks.map((f) => f.objectId)).size);
  assert(Math.abs(s.fallbackMs - raw.fallbacks.reduce((sum, f) => sum + f.ms, 0)) < 0.001);
  rows.push({
    ...s,
    fallbackRate: s.candidateCount ? s.fallbackCandidates / s.candidateCount : 0,
    geometry: explain(raw),
    diagnosticFile: diagnostic.versions.narrow.file,
  });
}
let matches = 0;
for (const p of pairs) {
  const [a, b] = await Promise.all([read(p.versions.original.file), read(p.versions.narrow.file)]);
  assert.deepEqual(a.result, b.result);
  matches++;
}
const cells = [];
for (const s of rows.filter((r) => r.prefix === 600)) {
  const group = rows.filter((r) => r.scenario === s.scenario && r.count === s.count);
  const oldMax = group.reduce((a, b) => (a.originalP95 > b.originalP95 ? a : b));
  const newMax = group.reduce((a, b) => (a.narrowP95 > b.narrowP95 ? a : b));
  cells.push({
    scenario: s.scenario,
    count: s.count,
    originalWorstPrefix: oldMax.prefix,
    originalWorstP95: oldMax.originalP95,
    narrowWorstPrefix: newMax.prefix,
    narrowWorstP95: newMax.narrowP95,
    noWorseAllPrefixes: group.every((r) => r.noWorse),
    slowerPrefixes: group
      .filter((r) => !r.noWorse)
      .map((r) => ({
        prefix: r.prefix,
        originalP95: r.originalP95,
        narrowP95: r.narrowP95,
        deltaMs: r.deltaMs,
        geometry: r.geometry,
      })),
  });
}
const fmt = (n) => n.toFixed(2),
  percent = (n) => (100 * n).toFixed(2) + '%';
const text = [
  '# 段级预筛：原版对照与回退诊断',
  '',
  `原版 ${env.baseline}；修复版 ${env.head}。正式轮每前缀5次p95（最近秩，5个样本时为最大值），诊断轮不进入p95。逐前缀用原始时间戳比较，不加容差，不以场景平均掩盖较慢前缀。`,
  '',
  '## 9场景',
  '',
  '| 场景/规模 | 原版最坏前缀p95 ms | 修复最坏前缀p95 ms | 所有前缀均不差于原版 | 较慢前缀 |',
  '| --- | ---: | ---: | --- | --- |',
];
for (const c of cells)
  text.push(
    `| ${c.scenario}/${c.count} | ${fmt(c.originalWorstP95)} (p${c.originalWorstPrefix}) | ${fmt(c.narrowWorstP95)} (p${c.narrowWorstPrefix}) | ${c.noWorseAllPrefixes ? '是' : '否'} | ${c.slowerPrefixes.map((r) => r.prefix).join(', ') || '无'} |`
  );
text.push(
  '',
  '## 全部63组',
  '',
  '| 场景/规模/前缀 | 原版p95 | 修复p95 | 差值ms | 候选数 | 回退候选 | 触发率 | 回退ms / 查询占比（诊断轮） | 闭合边独有/弧段独有/两者/未归属对象 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
);
for (const r of rows)
  text.push(
    `| ${r.scenario}/${r.count}/${r.prefix} | ${fmt(r.originalP95)} | ${fmt(r.narrowP95)} | ${r.deltaMs.toFixed(3)} | ${r.candidateCount} | ${r.fallbackCandidates} | ${percent(r.fallbackRate)} | ${fmt(r.fallbackMs)} / ${percent(r.timeShare)} | ${r.geometry.closingOnly}/${r.geometry.arcOnly}/${r.geometry.both}/${r.geometry.unclassified} |`
  );
text.push(
  '',
  '回退计时为独立插桩轮的旧谓词墙钟耗时，包含其分配/GC/被抢占时间，不是CPU采样占比；计时钩子只在该轮启用，原始clock精度限制仍适用。诊断原始JSON保留每次回退的对象ID、kind、顶点数、耗时、原因及实际prepared多边形。几何归因按原输入弧段/闭合边的bounds作离线分析，仅解释这些椭圆fixture，不替代产品谓词或一般自交路径的正确性证明。',
  '',
  `完整结果新旧逐轮有序一致 ${matches}/504；独立诊断每前缀另与旧oracle核对。源文/maps和bundle哈希匹配提交。`
);
const report = { environment: env, provenance, orderedMatches: matches, cells, rows };
await writeFile(`${root}/trigger-analysis.json`, JSON.stringify(report, null, 2));
await writeFile(
  `${root}/source-integrity.json`,
  JSON.stringify({ provenance, orderedMatches: matches }, null, 2)
);
await writeFile(`${root}/report.md`, text.join('\n') + '\n');
const headers = [
  'scenario',
  'count',
  'prefix',
  'originalP95',
  'narrowP95',
  'deltaMs',
  'noWorse',
  'candidateCount',
  'fallbackCandidates',
  'fallbackRate',
  'fallbackMs',
  'timeShare',
];
await writeFile(
  `${root}/trigger-summary.csv`,
  headers.join(',') + '\n' + rows.map((r) => headers.map((k) => r[k]).join(',')).join('\n') + '\n'
);
console.log(
  JSON.stringify(
    {
      provenance,
      orderedMatches: matches,
      cells,
      nonzeroFallbacks: rows
        .filter((r) => r.fallbackCandidates > 0)
        .map(
          ({
            scenario,
            count,
            prefix,
            candidateCount,
            fallbackCandidates,
            fallbackRate,
            timeShare,
            geometry,
          }) => ({
            scenario,
            count,
            prefix,
            candidateCount,
            fallbackCandidates,
            fallbackRate,
            timeShare,
            geometry,
          })
        ),
    },
    null,
    2
  )
);
