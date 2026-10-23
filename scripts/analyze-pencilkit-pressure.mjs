import { readFileSync } from 'node:fs';

const log = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(log.strokes)) throw new Error('Expected a Probe strokes log');
const samples = log.strokes.flatMap((stroke) => stroke.samples);
const contact = samples.filter((sample) => sample.phase === 'down' || sample.phase === 'move');
const forceValues = [...new Set(contact.map((sample) => sample.f))].sort((a, b) => a - b);
const pressures = [...new Set(contact.map((sample) => sample.p).filter((p) => p !== null))].sort(
  (a, b) => a - b
);
const before = samples.filter((sample) => Number.isFinite(sample.fBeforePencilkit));
console.log(
  JSON.stringify(
    {
      strokeCount: log.strokes.length,
      sampleCount: samples.length,
      contactSampleCount: contact.length,
      contactForceValues: forceValues,
      contactNormalizedPressureValues: pressures,
      maximumPossibleForceValues: [...new Set(contact.map((sample) => sample.mf))],
      estimatedFlags: [...new Set(contact.map((sample) => sample.est))],
      beforePencilkitSampleCount: before.length,
      forceChangedDuringPencilkit: before.length
        ? before.filter(
            (sample) =>
              sample.fBeforePencilkit !== sample.f || sample.mfBeforePencilkit !== sample.mf
          ).length
        : null,
      result:
        pressures.length > 1
          ? 'contact-pressure-variation-observed'
          : 'no-contact-pressure-variation',
      hardwarePressureSupport: 'not-established-by-maximumPossibleForce',
      note: 'Terminal up/cancel zeros are excluded from contact variation. Pre/post comparison diagnoses super-call mutation only; it does not prove hardware capability.',
    },
    null,
    2
  )
);
