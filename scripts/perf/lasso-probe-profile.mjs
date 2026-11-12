import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const directory = process.argv[2] ?? 'artifacts/research/lasso/query-probe-v2';
const pnpm = await readdir('node_modules/.pnpm');
const mappingPackage = pnpm.find((p) => p.startsWith('@jridgewell+trace-mapping@'));
const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor } = require(
  path.resolve(`node_modules/.pnpm/${mappingPackage}/node_modules/@jridgewell/trace-mapping`)
);
const map = new TraceMap(JSON.parse(await readFile(`${directory}/probe.js.map`, 'utf8')));
const results = [];
for (const file of await readdir(directory)) {
  if (!file.endsWith('.cpuprofile')) continue;
  const id = file.slice(0, -11);
  const profile = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
  const trace = JSON.parse(await readFile(`${directory}/${id}.trace.json`, 'utf8'));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const locate = (node) => {
    const frame = node.callFrame;
    const original =
      frame.url && frame.lineNumber >= 0
        ? originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber })
        : null;
    return original?.source
      ? `${original.source}:${original.line} ${original.name ?? frame.functionName}`
      : frame.functionName;
  };
  for (const phase of ['setup', 'work']) {
    const tag = `${id}-p600-r7:${phase}`;
    const begin = trace.traceEvents.find((e) => e.name === `${tag}-start`);
    const end = trace.traceEvents.find((e) => e.name === `${tag}-end`);
    if (!begin || !end) throw new Error(`Missing trace markers ${tag}`);
    const self = new Map();
    let timestamp = profile.startTime;
    let sampledMs = 0;
    for (let i = 0; i < profile.samples.length; i++) {
      const next = timestamp + profile.timeDeltas[i];
      const overlap = Math.max(0, Math.min(next, end.ts) - Math.max(timestamp, begin.ts)) / 1000;
      if (overlap) {
        const site = locate(nodes.get(profile.samples[i]));
        self.set(site, (self.get(site) ?? 0) + overlap);
        sampledMs += overlap;
      }
      timestamp = next;
    }
    results.push({
      rawProfile: file,
      rawTrace: `${id}.trace.json`,
      phase,
      traceWindowMs: (end.ts - begin.ts) / 1000,
      sampledMs,
      self: [...self].sort((a, b) => b[1] - a[1]).slice(0, 20),
    });
  }
}
if (results.length !== 18) throw new Error(`Expected 18 phase windows, got ${results.length}`);
const report = {
  method:
    'Diagnostic round r7 only, p600 query setup/work marker windows. CPU sample interval overlap apportioned to windows; sampling is approximate. Oracle and selection outside markers excluded. Profile overhead means these are not formal timing statistics.',
  results,
};
await writeFile(`${directory}/profile-phases.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
