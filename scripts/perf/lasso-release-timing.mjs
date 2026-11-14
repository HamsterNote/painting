// HAM-247 criterion 2: logical selection commit, including an empty result.
// Paint/DOM and query completion are different boundaries, kept as diagnostics.
export const releaseThresholdMs = (count) => ([0, 100, 500].includes(count) ? 150 : null);

export function lassoReleaseTiming(raw) {
  const ups = raw.events.filter((e) => e.type === 'pointerup');
  const inputs = raw.marks.filter((m) => m.event === 'input');
  const input = inputs.at(-1);
  const up = ups[0];
  const result = {
    pointerupTimestamp: up?.stamp ?? null,
    pointerupObservedAt: up?.time ?? null,
    session: input?.session ?? null,
    version: input?.version ?? null,
    pointCount: input?.pointCount ?? null,
    queryStartedAt: null,
    queryCompletedAt: null,
    submissionCompletedAt: null,
    releaseToSubmitMs: null,
    releaseToQueryStartMs: null,
    queryMs: null,
    completionToSubmitMs: null,
    ok: false,
  };
  if (
    ups.length !== 1 ||
    !Number.isFinite(up.stamp) ||
    !input ||
    !Number.isFinite(input.time) ||
    !['session', 'version', 'pointCount'].every((k) => Number.isSafeInteger(input[k])) ||
    new Set(inputs.map((m) => m.session)).size !== 1
  )
    return { ...result, reason: 'missing-or-ambiguous-release-identity' };
  // pointerup can append the last sample in the adapter. Use the last accepted
  // input identity, never the prefix seen by an earlier capture listener.
  const matches = (m) =>
    m.final &&
    m.session === input.session &&
    m.version === input.version &&
    m.pointCount === input.pointCount;
  const unique = (event) => {
    const found = raw.marks.filter((m) => m.event === event && matches(m));
    return found.length === 1 ? found[0] : null;
  };
  const start = unique('query-start'),
    end = unique('query-complete'),
    submit = unique('selection-submit');
  if (
    !start ||
    !end?.ok ||
    !submit?.ok ||
    ![start.time, end.time, submit.time].every(Number.isFinite) ||
    start.time < Math.max(up.stamp, input.time) ||
    end.time < start.time ||
    submit.time < end.time ||
    raw.marks.some((m) => m.event === 'cancel' && m.session === input.session)
  )
    return { ...result, reason: 'missing-or-invalid-final-commit' };
  return {
    ...result,
    ok: true,
    queryStartedAt: start.time,
    queryCompletedAt: end.time,
    submissionCompletedAt: submit.time,
    releaseToSubmitMs: submit.time - up.stamp,
    releaseToQueryStartMs: start.time - up.stamp,
    queryMs: end.time - start.time,
    completionToSubmitMs: submit.time - end.time,
  };
}

const p95 = (values) => {
  const value = values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  return Number.isFinite(value) ? value : null;
};

export function summarizeReleaseTiming(rows, { scenarios, counts, repeats }) {
  const eligible = (row) =>
    row?.cold &&
    row.rate === 6 &&
    !row.skipWarmup &&
    row.valid &&
    row.releaseTiming?.ok &&
    Number.isFinite(row.releaseTiming.releaseToSubmitMs);
  const sample = (scenario, count, repeat) => {
    const found = rows.filter(
      (r) => r.scenario === scenario && r.count === count && r.repeat === repeat && r.cold
    );
    return found.length === 1 && eligible(found[0]) ? found[0] : null;
  };
  const groups = scenarios.flatMap((scenario) =>
    counts.map((count) => {
      const samples = Array.from({ length: repeats }, (_, repeat) =>
        sample(scenario, count, repeat)
      );
      const completed = samples.filter(Boolean).length;
      const latency = p95(samples.map((r) => r?.releaseTiming.releaseToSubmitMs ?? Infinity));
      const thresholdMs = releaseThresholdMs(count);
      return {
        scenario,
        count,
        expectedColdSamples: repeats,
        completedColdSamples: completed,
        missingOrInvalid: repeats - completed,
        p95Ms: latency,
        thresholdMs,
        pass:
          thresholdMs === null
            ? null
            : completed === repeats && latency !== null && latency <= thresholdMs,
      };
    })
  );
  const increments = scenarios.flatMap((scenario) =>
    Array.from({ length: repeats }, (_, repeat) => {
      const a = sample(scenario, 500, repeat),
        b = sample(scenario, 1000, repeat);
      if (!a || !b) return { scenario, repeat, available: false };
      const delta = (key) => b.releaseTiming[key] - a.releaseTiming[key];
      return {
        scenario,
        repeat,
        available: true,
        releaseToSubmitDeltaMs: delta('releaseToSubmitMs'),
        releaseToQueryStartDeltaMs: delta('releaseToQueryStartMs'),
        queryDeltaMs: delta('queryMs'),
        completionToSubmitDeltaMs: delta('completionToSubmitMs'),
        // Phase durations sit inside query time; fallback is inside exact, not additive.
        phaseDeltaMs: Object.fromEntries(
          ['prepare', 'canonicalize', 'candidates', 'exact', 'fallback'].map((phase) => [
            phase,
            (b.phases[phase]?.ms ?? 0) - (a.phases[phase]?.ms ?? 0),
          ])
        ),
        exactCountDelta: (b.phases.exact?.count ?? 0) - (a.phases.exact?.count ?? 0),
      };
    })
  );
  return {
    metric:
      'pointerup event timestamp -> matching final selection-submit after setSelection returns',
    rate: 6,
    coldOnly: true,
    groups,
    thousandVsFiveHundred: increments,
  };
}
