import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export function cpuRows(text) {
  return text
    .split('\n')
    .filter((line) => /^cpu\d+\s/.test(line))
    .map((line) => {
      const [id, ...values] = line.trim().split(/\s+/);
      const ticks = values.slice(0, 8).map(Number); // guest time is already in user/nice
      return {
        id,
        total: ticks.reduce((a, b) => a + b, 0),
        idle: ticks[3],
        iowait: ticks[4],
        steal: ticks[7],
      };
    });
}

export function hostVerdict(before, after, loadBefore, loadAfter, cores) {
  if (!Number.isInteger(cores) || cores < 1 || before.length !== after.length || !before.length)
    throw new Error('CPU topology unavailable or changed');
  let total = 0,
    idle = 0,
    iowait = 0,
    steal = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i].id !== after[i].id) throw new Error('CPU identity changed');
    for (const key of ['total', 'idle', 'iowait', 'steal'])
      if (
        !Number.isFinite(before[i][key]) ||
        !Number.isFinite(after[i][key]) ||
        after[i][key] < before[i][key]
      )
        throw new Error('Invalid CPU tick sample');
    total += after[i].total - before[i].total;
    idle += after[i].idle - before[i].idle;
    iowait += after[i].iowait - before[i].iowait;
    steal += after[i].steal - before[i].steal;
  }
  if (
    total <= 0 ||
    loadBefore.length !== 3 ||
    loadAfter.length !== 3 ||
    ![...loadBefore, ...loadAfter].every(Number.isFinite)
  )
    throw new Error('Missing host measurements');
  const idlePercent = (100 * idle) / total;
  const loadLimit = cores / 2;
  const reasons = [];
  if (Math.max(loadBefore[0], loadAfter[0]) > loadLimit) reasons.push('load-over-half-cores');
  if (idlePercent < 50) reasons.push('idle-cpu-below-50-percent');
  return {
    valid: !reasons.length,
    reasons,
    cores,
    loadLimit,
    loadBefore,
    loadAfter,
    idlePercent,
    iowaitPercent: (100 * iowait) / total,
    stealPercent: (100 * steal) / total,
  };
}

export async function sampleHost(windowMs = 3000) {
  const status = await readFile('/proc/self/status', 'utf8');
  const allowed = new Set(
    status
      .match(/^Cpus_allowed_list:\s*(.+)$/m)[1]
      .split(',')
      .flatMap((s) => {
        const [a, b = a] = s.split('-').map(Number);
        return Array.from({ length: b - a + 1 }, (_, i) => `cpu${a + i}`);
      })
  );
  const read = async () =>
    cpuRows(await readFile('/proc/stat', 'utf8')).filter((r) => allowed.has(r.id));
  const before = await read(),
    loadBefore = os.loadavg();
  const startedAt = new Date().toISOString();
  await delay(windowMs);
  const after = await read();
  return {
    startedAt,
    endedAt: new Date().toISOString(),
    windowMs,
    ...hostVerdict(
      before,
      after,
      loadBefore,
      os.loadavg(),
      Math.min(before.length, os.availableParallelism())
    ),
  };
}

// A round requires two distinct, nonoverlapping >=3s measurements. An aborted
// round has after=null and cannot borrow its pre-sample as a post-sample.
export function roundHostValid(before, after) {
  if (!before?.valid || !after?.valid || before === after) return false;
  return (
    [before, after].every(
      (h) => h.windowMs >= 3000 && Date.parse(h.endedAt) - Date.parse(h.startedAt) >= 3000
    ) && Date.parse(after.startedAt) >= Date.parse(before.endedAt)
  );
}

export const versionOrder = (round) => (round % 2 ? ['B', 'A'] : ['A', 'B']);

export function queryTraceMetrics(events) {
  const starts = events.filter((e) => e.name === 'kernel:start');
  const ends = events.filter((e) => e.name === 'kernel:end');
  if (starts.length !== 1 || ends.length !== 1) throw new Error('Ambiguous query boundaries');
  const [start] = starts,
    [end] = ends;
  if (
    start.pid !== end.pid ||
    start.tid !== end.tid ||
    !Number.isFinite(start.tts) ||
    !Number.isFinite(end.tts) ||
    !Number.isFinite(start.ts) ||
    !Number.isFinite(end.ts) ||
    end.ts < start.ts ||
    end.tts < start.tts
  )
    throw new Error('Query thread CPU clock unavailable; wall time is not a substitute');
  const gc = events.filter(
    (e) =>
      e.ph === 'X' &&
      ['MinorGC', 'MajorGC'].includes(e.name) &&
      e.pid === start.pid &&
      e.tid === start.tid &&
      e.ts < end.ts &&
      e.ts + e.dur > start.ts
  );
  return {
    queryThreadCpuMs: (end.tts - start.tts) / 1000,
    queryWallMs: (end.ts - start.ts) / 1000,
    minorGCCount: gc.filter((e) => e.name === 'MinorGC').length,
    majorGCCount: gc.filter((e) => e.name === 'MajorGC').length,
  };
}
