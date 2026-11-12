import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const directory = process.argv[2] ?? 'artifacts/research/lasso/query-probe-v2';
const prefixes = process.argv[3] === 'all' ? [3, 30, 150, 300, 450, 599, 600] : [600];
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
  // Chrome can omit a frame URL after optimizing a function; scriptId is still
  // the same injected bundle. Never map an unrelated evaluation script.
  const mappedScripts = new Set(
    profile.nodes
      .filter((node) => node.callFrame.url.split('/').at(-1) === 'probe.js')
      .map((node) => node.callFrame.scriptId)
  );
  let clock = profile.startTime;
  const samples = profile.samples
    .map((node, i) => {
      clock += profile.timeDeltas[i];
      return { timestamp: clock, node };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  const locate = (node) => {
    const frame = node.callFrame;
    const original =
      mappedScripts.has(frame.scriptId) && frame.lineNumber >= 0
        ? originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber })
        : null;
    return original?.source
      ? `${original.source}:${original.line} ${original.name ?? frame.functionName}`
      : frame.functionName;
  };
  for (const prefix of prefixes)
    for (const phase of ['setup', 'work']) {
      const tag = `${id}-p${prefix}-r7:${phase}`;
      const begin = trace.traceEvents.find((e) => e.name === `${tag}-start`);
      const end = trace.traceEvents.find((e) => e.name === `${tag}-end`);
      if (!begin || !end) throw new Error(`Missing trace markers ${tag}`);
      const self = new Map();
      let timestamp = profile.startTime;
      let sampledMs = 0;
      for (const sample of samples) {
        const next = sample.timestamp;
        const overlap = Math.max(0, Math.min(next, end.ts) - Math.max(timestamp, begin.ts)) / 1000;
        if (overlap) {
          const site = locate(nodes.get(sample.node));
          self.set(site, (self.get(site) ?? 0) + overlap);
          sampledMs += overlap;
        }
        timestamp = next;
      }
      if (sampledMs > (end.ts - begin.ts) / 1000 + 0.001)
        throw new Error(`Overlapping CPU intervals in ${tag}`);
      results.push({
        rawProfile: file,
        rawTrace: `${id}.trace.json`,
        phase,
        prefix,
        traceWindowMs: (end.ts - begin.ts) / 1000,
        sampledMs,
        negativeTimeDeltaCount: profile.timeDeltas.filter((delta) => delta < 0).length,
        self: [...self].sort((a, b) => b[1] - a[1]).slice(0, 20),
      });
    }
}
if (results.length !== 18 * prefixes.length)
  throw new Error(`Incomplete phase windows: ${results.length}`);
const report = {
  method:
    'Diagnostic round r7 only, specified query prefix setup/work marker windows. Resolve anonymous URL frames by the scriptId of the known probe.js bundle. Reconstruct absolute sample timestamps and sort them because V8 profiles contain negative time deltas. Nonoverlapping sample intervals apportioned to windows; attribution near window boundaries is approximate at sampling resolution. Oracle and selection outside markers excluded. Profile overhead means these are not formal timing statistics.',
  results,
};
await writeFile(
  `${directory}/profile-phases${prefixes.length > 1 ? '-all' : ''}.json`,
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
