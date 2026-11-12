import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { lassoMetrics } from './lasso-metrics.mjs';

const directory = process.argv[2];
const { metadata, results } = JSON.parse(await readFile(`${directory}/summary.json`, 'utf8'));
for (const row of results)
  Object.assign(
    row,
    lassoMetrics(JSON.parse(await readFile(`${directory}/${row.id}.json`, 'utf8')))
  );
await writeFile(
  `${directory}/recomputed-summary.json`,
  JSON.stringify({ metadata, results }, null, 2)
);
const comparisons = results
  .filter((r) => !r.warmup && r.count)
  .map((r) => {
    const control = results.find(
      (c) =>
        c.count === 0 &&
        c.scenario === r.scenario &&
        c.round === r.round &&
        c.id.includes(`pair${r.count}-`)
    );
    const environmentValid = control.fps >= (0.9 * 1000) / control.T;
    return {
      id: r.id,
      environmentValid,
      fpsRatio: r.fps / control.fps,
      dropIncrement: r.dropRate - control.dropRate,
      framePass: r.fps / control.fps >= 0.9 && r.dropRate - control.dropRate <= 0.05,
      previewPass: r.previewP95 !== null && r.previewP95 <= 2 * r.T && r.previewCovered >= 570,
      finalPass: r.finalMs <= 100,
      // A change notification alone cannot measure unchanged live results; report as unproven.
      liveSelectionEvidence: r.selectionP95,
      liveSelectionPass: null,
    };
  });
console.log(JSON.stringify({ metadata, comparisons }, null, 2));
await writeFile(`${directory}/comparison.json`, JSON.stringify(comparisons, null, 2));

// Symbolicate the sampling profile using the exact production source maps.
const pnpm = await readdir('node_modules/.pnpm');
const mappingPackage = pnpm.find((p) => p.startsWith('@jridgewell+trace-mapping@'));
const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor } = require(
  path.resolve(`node_modules/.pnpm/${mappingPackage}/node_modules/@jridgewell/trace-mapping`)
);
const maps = new Map();
const bundles = `${directory}/bundles`;
for (const file of await readdir(bundles))
  if (file.endsWith('.map')) {
    maps.set(
      file.slice(0, -4),
      new TraceMap(JSON.parse(await readFile(`${bundles}/${file}`, 'utf8')))
    );
  }
const profiles = [];
for (const file of await readdir(directory))
  if (file.endsWith('.cpuprofile')) {
    const profile = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map();
    for (const node of profile.nodes)
      for (const child of node.children ?? []) parents.set(child, node.id);
    const locate = (node) => {
      const frame = node.callFrame;
      const map = maps.get(frame.url.split('/').at(-1));
      const original =
        map && frame.lineNumber >= 0
          ? originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber })
          : null;
      return original?.source
        ? `${original.source}:${original.line} ${original.name ?? frame.functionName}`
        : frame.functionName;
    };
    const inclusiveSites = new Map();
    const totals = new Map(),
      inclusive = new Map();
    const sum = (map, key, value) => map.set(key, (map.get(key) ?? 0) + value);
    for (let i = 0; i < profile.samples.length; i++) {
      const sample = profile.samples[i],
        ms = profile.timeDeltas[i] / 1000;
      sum(totals, locate(nodes.get(sample)), ms);
      let ancestor = sample;
      const files = new Set();
      const sites = new Set();
      while (ancestor) {
        const site = locate(nodes.get(ancestor));
        sites.add(site);
        files.add(site.split(':')[0]);
        ancestor = parents.get(ancestor);
      }
      for (const source of files) sum(inclusive, source, ms);
      for (const site of sites) sum(inclusiveSites, site, ms);
    }
    const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 30);
    profiles.push({
      file,
      sampledMs: profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000,
      self: top(totals),
      inclusiveBySource: top(inclusive),
      inclusiveQuerySites: [...inclusiveSites]
        .filter(([site]) => site.includes('/packages/painting/'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25),
    });
  }
await writeFile(`${directory}/profiling.json`, JSON.stringify(profiles, null, 2));
console.log('Symbolicated profiles:', profiles.length);
