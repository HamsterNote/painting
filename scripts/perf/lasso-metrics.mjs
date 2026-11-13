export function lassoMetrics(raw) {
  const percentile = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const value = sorted[Math.floor(sorted.length * 0.95)];
    return Number.isFinite(value) ? value : null;
  };
  const idle = raw.idle
    .slice(1)
    .map((t, i) => t - raw.idle[i])
    .sort((a, b) => a - b);
  const T = idle[Math.floor(idle.length / 2)];
  // Early runner versions always appended exactly one queued callback after up.
  // Retain those raw files, but exclude that callback. New files also record
  // actual callback times and stop sampling before up. Use rAF timestamps for
  // BOTH versions so callback-clock jitter cannot change the comparison. Include both boundary gaps so
  // the last blocked move cannot disappear from the observation duration.
  const frames = raw.actualFrames ? raw.frames : raw.frames.slice(0, -1);
  const boundaries = [
    raw.start,
    ...frames.map((t) => Math.max(raw.start, Math.min(raw.drawingEnd, t))),
    raw.drawingEnd,
  ];
  const observed = Math.max(0, frames.length - 1),
    duration = raw.drawingEnd - raw.start;
  const missing = boundaries
    .slice(1)
    .reduce((sum, t, i) => sum + Math.max(0, Math.round((t - boundaries[i]) / T) - 1), 0);
  const publications = raw.preview
    .filter((p) => p.domPoints)
    .map((p) => ({
      ...p,
      // The closing point can share coordinates with point 0. DOM path length
      // identifies the accepted sample prefix without that coordinate ambiguity.
      index: Math.min(599, Math.max(0, p.domPoints.trim().split(/\s+/).length - 2)),
    }));
  const samples = [{ ...raw.down, due: raw.down.start }, ...raw.inputs];
  const delays = samples.map((input) => {
    const shown = publications.find((p) => p.index >= input.index && p.opportunity >= input.start);
    return { input, shown };
  });
  return {
    T,
    observed,
    duration,
    missing,
    fps: (observed * 1000) / duration,
    dropRate: missing / (observed + missing),
    previewP95: percentile(
      delays.map(({ input, shown }) => (shown ? shown.opportunity - input.start : Infinity))
    ),
    sourcePreviewP95: percentile(
      delays.map(({ input, shown }) => (shown ? shown.opportunity - input.due : Infinity))
    ),
    previewCovered: delays.filter((d) => d.shown).length,
    inputLatenessP95: percentile(raw.inputs.map((i) => i.start - i.due)),
    selectionP95: percentile(
      raw.selection.map((s) => {
        const input = raw.inputs.find((i) => i.index === s.index);
        return input ? s.opportunity - input.start : Infinity;
      })
    ),
    beginMs: raw.down.end - raw.down.start,
    endMs: raw.up.end - raw.up.start,
    finalMs: raw.finalOpportunity - raw.up.start,
    renders: raw.renders,
    scanCount: raw.scans.length,
    unchangedDocument: raw.unchangedDocument,
  };
}
