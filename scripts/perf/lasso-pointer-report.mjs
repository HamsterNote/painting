import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
// Already present through Babel; this diagnostic does not add a product dependency.
const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor } = require(
  require.resolve('@jridgewell/trace-mapping', {
    paths: [require.resolve('@babel/core', { paths: [require.resolve('babel-jest')] })],
  })
);
const root = process.argv[2];
const maps = new Map();
for (const name of await readdir(`${root}/site/_expo/static/js/web`)) {
  if (name.endsWith('.map'))
    maps.set(
      name.slice(0, -4),
      new TraceMap(JSON.parse(await readFile(`${root}/site/_expo/static/js/web/${name}`, 'utf8')))
    );
}
const quantile = (values, q) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? null;
const reports = [];
for (const file of (await readdir(root)).filter((f) => f.endsWith('.cpuprofile')).sort()) {
  const id = file.slice(0, -11);
  const raw = JSON.parse(await readFile(`${root}/${id}.json`, 'utf8'));
  const trace = JSON.parse(await readFile(`${root}/${id}.trace.json`, 'utf8')).traceEvents;
  const profile = JSON.parse(await readFile(`${root}/${file}`, 'utf8'));
  const down = trace.find((e) => e.name === 'pointer:pointerdown');
  // The adapter may handle pointerup on an ancestor before the surface listener.
  // Browser event.timeStamp is the input boundary; surface callback time includes final work.
  const start = raw.events.find((e) => e.type === 'pointerdown').stamp;
  const stop = raw.events.find((e) => e.type === 'pointerup').stamp;
  const origin = down.ts - down.args.data.startTime * 1000;
  const startUs = origin + start * 1000,
    stopUs = origin + stop * 1000;
  const main = trace.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain');
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const n of nodes.values()) {
    for (const child of n.children ?? []) nodes.get(child).parent = n.id;
    const cf = n.callFrame;
    const map = maps.get(cf.url.split('/').at(-1));
    n.original = map
      ? originalPositionFor(map, { line: cf.lineNumber + 1, column: cf.columnNumber })
      : {};
  }
  const sources = {},
    groups = {};
  let time = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const duration = profile.timeDeltas[i];
    time += duration;
    if (time < startUs || time >= stopUs) continue;
    let n = nodes.get(profile.samples[i]);
    const leaf = n.original.source ?? n.callFrame.functionName;
    sources[leaf] = (sources[leaf] ?? 0) + duration / 1000;
    let group = 'other JS/native/idle';
    const ancestry = [];
    while (n) {
      ancestry.push(n.original.source ?? n.callFrame.functionName);
      n = nodes.get(n.parent);
    }
    if (
      ancestry.some((s) =>
        /layeredObjectQuery|polygonBoolean|polyclip|robust-predicates|freehandCache/.test(s)
      )
    )
      group = 'geometry/query';
    else if (ancestry.some((s) => /react-dom|scheduler\/cjs/.test(s))) group = 'React';
    else if (
      ancestry.some((s) => /semanticWebAdapter|webGesture|layeredToolSession|responder/i.test(s))
    )
      group = 'gesture/session';
    groups[group] = (groups[group] ?? 0) + duration / 1000;
  }
  const timeline = {};
  for (const name of [
    'RunTask',
    'EventDispatch',
    'FunctionCall',
    'Paint',
    'PrePaint',
    'Layout',
    'UpdateLayoutTree',
    'Layerize',
    'Commit',
    'RasterTask',
  ]) {
    const spans = trace
      .filter(
        (e) =>
          e.name === name &&
          e.ph === 'X' &&
          e.dur &&
          (name === 'RasterTask' || (e.pid === main.pid && e.tid === main.tid))
      )
      .map((e) => [Math.max(startUs, e.ts), Math.min(stopUs, e.ts + e.dur)])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let end = 0,
      total = 0;
    for (const [a, b] of spans) {
      total += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
    timeline[name] = { ms: total / 1000, count: spans.length };
  }
  const frames = raw.frames.filter((t) => t >= start && t <= stop);
  const intervals = frames.slice(1).map((t, i) => t - frames[i]);
  const finalStart = raw.marks.find((m) => m.event === 'query-start' && m.final);
  const finalEnd = raw.marks.find((m) => m.event === 'selection-submit' && m.final);
  reports.push({
    id,
    validGesture:
      raw.marks.some((m) => m.event === 'selection-submit' && m.final) &&
      !raw.marks.some((m) => m.event === 'cancel'),
    cancelled: raw.marks.some((m) => m.event === 'cancel'),
    dragMs: stop - start,
    fps: ((frames.length - 1) * 1000) / (frames.at(-1) - frames[0]),
    frameP95: quantile(intervals, 0.95),
    frameMax: Math.max(...intervals),
    delivered: raw.events.length,
    trusted: raw.events.every((e) => e.trusted),
    queryCount: raw.marks.filter((m) => m.event === 'query-start' && !m.final).length,
    finalQueryMs: finalStart && finalEnd ? finalEnd.time - finalStart.time : null,
    liveSubmissions: raw.marks.filter((m) => m.event === 'selection-submit' && !m.final).length,
    releaseToSubmitMs: finalEnd ? finalEnd.time - stop : null,
    selected: raw.selected.length,
    renders: raw.renders,
    timeline,
    cpuSamplesMs: groups,
    topSelfSourcesMs: Object.entries(sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16),
  });
}
await writeFile(`${root}/report.json`, JSON.stringify(reports, null, 2));
for (const r of reports) console.log(JSON.stringify(r));
