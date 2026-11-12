import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const directory = process.argv[2] ?? 'artifacts/research/lasso/paired-v2';
const { metadata, pairs } = JSON.parse(await readFile(`${directory}/pairs.json`, 'utf8'));
assert.equal(pairs.length, 49);
assert.equal(new Set(pairs.map((p) => `${p.scenario}-${p.count}-${p.round}`)).size, 49);
let rawCount = 0;
const mismatches = [];
for (const pair of pairs) {
  const final = {};
  for (const version of ['baseline', 'optimized']) {
    for (const role of ['control', 'drawing']) {
      const row = pair.variants[version][role];
      const raw = JSON.parse(await readFile(`${directory}/${row.raw}`, 'utf8'));
      const count = role === 'control' ? 0 : pair.count;
      assert.equal(raw.inputs.length, 599, row.raw);
      for (let i = 0; i < 599; i++) {
        assert.equal(raw.inputs[i].index, i + 1, row.raw);
        assert.ok(
          Math.abs(raw.inputs[i].due - raw.start - ((i + 1) * 5000) / 599) < 0.00001,
          row.raw
        );
      }
      assert.equal(raw.down.index, 0, row.raw);
      assert.equal(raw.up.index, 599, row.raw);
      assert.equal(raw.objectCount, count + (count && pair.scenario === 'mixed' ? 50 : 0), row.raw);
      assert.equal(raw.sampleCounts.length, count, row.raw);
      assert.ok(
        raw.sampleCounts.every((n) => n === 64),
        row.raw
      );
      assert.equal(raw.unchangedDocument, true, row.raw);
      assert.equal(raw.actualFrames.length, raw.frames.length, row.raw);
      if (role === 'drawing') final[version] = raw.selected;
      rawCount++;
    }
  }
  if (JSON.stringify(final.baseline) !== JSON.stringify(final.optimized))
    mismatches.push({ scenario: pair.scenario, count: pair.count, round: pair.round, final });
}
const hashes = [];
for (const build of metadata.builds) {
  for (const [filename, expected] of Object.entries(build.bundleHashes)) {
    for (const path of [
      `${directory}/bundles/${build.name}/${filename}`,
      `${build.root}/_expo/static/js/web/${filename}`,
    ]) {
      const actual = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      assert.equal(actual, expected, path);
    }
  }
  hashes.push({
    version: build.name,
    files: Object.keys(build.bundleHashes).length,
    unchanged: true,
  });
}
assert.equal(rawCount, 196);
const integrity = {
  rawCount,
  sourceSamplesPerRaw: 600,
  strokeSamples: 64,
  pairs: 49,
  formalPairs: pairs.filter((p) => !p.warmup).length,
  retainedForEachVersion: pairs.filter((p) => !p.warmup && p.retained).length,
  selectionMismatches: mismatches,
  hashes,
};
await writeFile(`${directory}/integrity.json`, JSON.stringify(integrity, null, 2));
console.log(JSON.stringify(integrity, null, 2));
assert.equal(
  mismatches.length,
  0,
  'Final selection differs between frozen versions; inspect integrity.json'
);
