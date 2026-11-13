export function pairedLassoResult({ scenario, count, round, samples }) {
  const variants = {};
  const rejectedBy = [];
  for (const name of ['baseline', 'optimized']) {
    const control = samples[name].find((row) => row.count === 0);
    const drawing = samples[name].find((row) => row.count === count);
    if (!control || !drawing) throw new Error(`Missing control/drawing: ${name}`);
    const valid =
      Number.isFinite(control.fps) &&
      Number.isFinite(control.T) &&
      control.T > 0 &&
      control.fps >= (0.9 * 1000) / control.T;
    if (!valid) rejectedBy.push(name);
    variants[name] = {
      control,
      drawing,
      controlValid: valid,
      controlThreshold: (0.9 * 1000) / control.T,
    };
  }
  return {
    scenario,
    count,
    round,
    warmup: round < 2,
    retained: rejectedBy.length === 0,
    rejectedBy,
    variants,
  };
}
