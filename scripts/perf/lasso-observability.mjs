export function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}
export function lassoObservability(raw) {
  const successfulSubmissions = raw.methods.filter(
    (m) => m.name === 'setSelection' && m.start < raw.up.start
  );
  const changed = raw.selection.filter((s) => s.published < raw.up.start);
  const start = raw.inputs.find((i) => i.index >= 2)?.start ?? raw.start;
  const timestamps = successfulSubmissions.map((m) => m.start).filter((t) => t >= start);
  const gaps = [start, ...timestamps, raw.up.start]
    .slice(1)
    .map((t, i) => t - [start, ...timestamps, raw.up.start][i]);
  const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
  const changes = changed.slice(1).map((s, i) => s.published - changed[i].published);
  const finalSubmission = raw.methods.find(
    (m) => m.name === 'setSelection' && m.start >= raw.up.start
  );
  const samples = [...(raw.down ? [raw.down] : []), ...raw.inputs];
  const publications = raw.preview ?? [];
  const published = samples
    .map((input) => {
      const next = publications.find(
        (p) => p.index >= input.index && p.published >= input.start && p.published < raw.up.start
      );
      return next
        ? {
            publishWait: next.published - input.start,
            nextRAFWait: next.opportunity - next.published,
          }
        : null;
    })
    .filter(Boolean);
  return {
    inputToQueryCompletion: {
      observable: false,
      reason:
        'No captured query path version/start event. The current input index at setSelection can belong to a newer path than the query; never map it back as query latency.',
    },
    submissionCount: timestamps.length,
    submissionIntervalP95: p95(intervals),
    submissionGapP95: p95(gaps),
    maximumSubmissionGap: gaps.length ? Math.max(...gaps) : null,
    firstSubmissionWait: timestamps.length ? timestamps[0] - start : null,
    lastSubmissionToUp: timestamps.length ? raw.up.start - timestamps.at(-1) : raw.up.start - start,
    changedSelectionCount: changed.length,
    changedSelectionIntervalP95: p95(changes),
    publicationTiming: {
      observedSamples: published.length,
      inputSamples: samples.length,
      inputToPublicationP95ObservedOnly: p95(published.map((p) => p.publishWait)),
      publicationToNextRAFP95ObservedOnly: p95(published.map((p) => p.nextRAFWait)),
      note: 'Diagnostic phase decomposition on observed publications only, NOT a replacement SLA metric. Missing samples remain in the original all-input preview p95. The next-rAF proxy adds a frame opportunity after the frame-throttled publication; physical paint is not observed.',
    },
    proposedAlternative: {
      metric:
        'successful result submission gap p95, including unchanged selections and first/last quiet intervals during continuous input',
      thresholdMs: 100,
      accepted: false,
      thresholdExceeded: p95(gaps) > 100,
      noLiveFeedback: timestamps.length === 0,
      notEquivalentToInputLatency: true,
    },
    final: {
      dispatchMs: raw.up.end - raw.up.start,
      upToSetSelectionMs: finalSubmission ? finalSubmission.start - raw.up.start : null,
      setSelectionMs: finalSubmission?.duration ?? null,
      postDispatchToPresentationMs: raw.finalOpportunity - raw.up.end,
      totalMs: raw.finalOpportunity - raw.up.start,
    },
  };
}
