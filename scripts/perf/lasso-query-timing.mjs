const percentile = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.ceil(sorted.length * 0.95) - 1];
  return Number.isFinite(value) ? value : null;
};

export function lassoQueryTiming(raw) {
  const marks = raw.queryMarks ?? [];
  if (!marks.some((m) => m.event === 'input')) throw new Error('Missing lasso input perf marks');
  const live = marks.filter(
    (m) => m.event === 'query-complete' && m.ok && !m.final && m.time < raw.up.start
  );
  const queries = marks
    .filter((m) => m.event === 'query-complete')
    .map((end) => {
      const start = marks.find(
        (m) =>
          m.event === 'query-start' &&
          m.session === end.session &&
          m.version === end.version &&
          m.final === end.final &&
          m.time <= end.time
      );
      if (!start || start.pointCount !== end.pointCount)
        throw new Error('Unmatched query perf marks');
      const submit = marks.find(
        (m) =>
          m.event === 'selection-submit' &&
          m.session === end.session &&
          m.version === end.version &&
          m.final === end.final &&
          m.time >= end.time
      );
      return {
        ...end,
        start: start.time,
        duration: end.time - start.time,
        submitTime: submit?.time ?? null,
        submitMs: submit ? submit.time - end.time : null,
      };
    });
  const samples = [{ ...raw.down, due: raw.down.start }, ...raw.inputs];
  if (new Set(marks.filter((m) => m.event === 'input').map((m) => m.session)).size !== 1)
    throw new Error('Timing record must contain one lasso gesture');
  for (const input of samples) {
    const prefix = (input.batchLast ?? input.index) + 2;
    if (
      !marks.some(
        (m) =>
          m.event === 'input' &&
          m.pointCount === prefix &&
          m.time >= input.start &&
          (input.end === undefined || m.time <= input.end)
      )
    )
      throw new Error(`Input ${input.index} does not match the accepted query prefix`);
  }
  const perInput = samples.map((input) => {
    // A query's captured prefix, NOT the current input index when it completes.
    const end = live.find((m) => m.pointCount >= input.index + 2 && m.time >= input.start);
    const submit =
      end &&
      marks.find(
        (m) =>
          m.event === 'selection-submit' &&
          !m.final &&
          m.session === end.session &&
          m.version === end.version &&
          m.pointCount === end.pointCount &&
          m.time >= end.time &&
          m.time < raw.up.start
      );
    const opportunity =
      submit &&
      marks.find(
        (m) =>
          m.event === 'selection-opportunity' &&
          m.session === submit.session &&
          m.version === submit.version &&
          m.pointCount === submit.pointCount &&
          m.submittedAt === submit.time &&
          m.time >= submit.time &&
          m.time < raw.up.start
      );
    return {
      index: input.index,
      inputTime: input.start,
      due: input.due,
      queryVersion: end?.version ?? null,
      queryPointCount: end?.pointCount ?? null,
      queryCompleteTime: end?.time ?? null,
      selectionTime: submit?.time ?? null,
      opportunityTime: opportunity?.time ?? null,
      completeMs: end ? end.time - input.start : null,
      selectionMs: submit ? submit.time - input.start : null,
      opportunityMs: opportunity ? opportunity.time - input.start : null,
    };
  });
  const liveQueries = queries.filter((q) => !q.final && q.ok && q.time < raw.up.start);
  return {
    observable: true,
    method:
      'All source inputs mapped to first successful live query containing their captured prefix. Completion is exact marked query end; selection is marked setSelection return, including equal results. Queued rAF is a presentation opportunity proxy only. Missing live results/opportunities remain Infinity in p95; final-up results never fill live gaps.',
    inputs: samples.length,
    completedInputs: perInput.filter((s) => s.completeMs !== null).length,
    selectedInputs: perInput.filter((s) => s.selectionMs !== null).length,
    opportunityInputs: perInput.filter((s) => s.opportunityMs !== null).length,
    inputToQueryP95: percentile(perInput.map((s) => s.completeMs ?? Infinity)),
    inputToSelectionP95: percentile(perInput.map((s) => s.selectionMs ?? Infinity)),
    inputToOpportunityP95: percentile(perInput.map((s) => s.opportunityMs ?? Infinity)),
    sourceToQueryP95: percentile(
      perInput.map((s) => (s.queryCompleteTime !== null ? s.queryCompleteTime - s.due : Infinity))
    ),
    sourceToSelectionP95: percentile(
      perInput.map((s) => (s.selectionTime !== null ? s.selectionTime - s.due : Infinity))
    ),
    sourceToOpportunityP95: percentile(
      perInput.map((s) => (s.opportunityTime !== null ? s.opportunityTime - s.due : Infinity))
    ),
    liveQueryWallP95: percentile(liveQueries.map((q) => q.duration)),
    completionToSubmissionP95: percentile(liveQueries.map((q) => q.submitMs ?? Infinity)),
    perInput,
    queries,
  };
}
