#!/usr/bin/env node

/**
 * `editor-production-baseline-gate.mjs` 的纯 Node 单测。
 *
 * 运行：node --test scripts/perf/editor-production-baseline-gate.test.mjs
 *
 * 覆盖审查 P0-6/7 的重点：紧凑 JSON 伪造 metrics/correctness、缺少被引用的
 * 完整 artifact、round 数/通过态错误、绝对阈值被篡改、环境指纹不匹配、
 * harness 源码漂移、产品源码树变更（same-code vs allow-drift）以及候选对比。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASELINE_ARTIFACT_KIND,
  BASELINE_SCHEMA_VERSION,
  CANDIDATE_ARTIFACT_SPIKE,
  CANDIDATE_SCHEMA_VERSION,
  PRODUCT_TREE_ELIGIBILITY,
  compareCandidateToBaseline,
  compareEnvironmentFingerprints,
  computeHarnessIdentityDigest,
  computeSha256Hex,
  stableStringify,
  validateArchivedCandidateArtifact,
  validateFrozenBaseline,
} from './editor-production-baseline-gate.mjs';

const CONTRACTS = Object.freeze({
  eventToNextFrameP95Ms: 50,
  commitP95Ms: 50,
  rafIntervalP95Ms: 33.4,
  maximumLongTaskMs: 100,
});
const DEVICE_SCALE_FACTORS = [1, 2];
const CONTEXTS_PER_SCALE = 5;
const FINGERPRINT = Object.freeze({
  platform: 'linux',
  arch: 'x64',
  cpuModel: 'Test CPU',
  cpuCount: 8,
  nodeMajor: 20,
  chromiumMajor: 120,
});

function makeRound(deviceScaleFactor, index, { contractPassed = true, checks } = {}) {
  return {
    contextIndex: index + 1,
    deviceScaleFactor,
    failure: null,
    contract: {
      passed: contractPassed,
      checks: checks ?? {
        prerequisites: { passed: true },
        rebase: { passed: true },
        correctness: { passed: true },
        workload: { passed: true },
        eventToNextFrameP95: { passed: true, actualMs: 10, thresholdMs: 50 },
        commitP95: { passed: true, actualMs: 10, thresholdMs: 50 },
        rafIntervalP95: { passed: true, actualMs: 10, thresholdMs: 33.4 },
        longTask: { passed: true, maxMs: null, thresholdMs: 100 },
      },
    },
    correctness: { passed: true },
    metrics: {},
  };
}

function makeSummary(overrides = {}) {
  return {
    contexts: CONTEXTS_PER_SCALE,
    completedContexts: CONTEXTS_PER_SCALE,
    eventToNextFrame: { p95Ms: 20 },
    commit: { p95Ms: 20 },
    rafInterval: { p95Ms: 16 },
    longTask: { maxMs: 40 },
    validity: { status: 'VALID' },
    aggregateContract: { passed: true },
    passed: true,
    ...overrides,
  };
}

function makeArchive(overrides = {}) {
  const results = {
    1: {
      rounds: Array.from({ length: CONTEXTS_PER_SCALE }, (_, i) => makeRound(1, i)),
      summary: makeSummary(),
    },
    2: {
      rounds: Array.from({ length: CONTEXTS_PER_SCALE }, (_, i) => makeRound(2, i)),
      summary: makeSummary(),
    },
  };
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    spike: CANDIDATE_ARTIFACT_SPIKE,
    contracts: CONTRACTS,
    environment: {
      fingerprint: FINGERPRINT,
      sourceTreeSha256: 'tree-base',
      sourceIdentity: makeManifest(),
    },
    results,
    ...overrides,
  };
}

function makeManifest(overrides = {}) {
  return {
    schemaVersion: 3,
    requiredFiles: [
      { path: 'scripts/perf/editor-production-performance.mjs', sha256: 'runner-hash' },
      { path: 'scripts/perf/editor-production-baseline-gate.mjs', sha256: 'gate-hash' },
      { path: 'package.json', sha256: 'pkg-hash' },
    ],
    ...overrides,
  };
}

function makeBaseline(archive, overrides = {}) {
  const manifest = archive.environment.sourceIdentity;
  return {
    artifactKind: BASELINE_ARTIFACT_KIND,
    schemaVersion: BASELINE_SCHEMA_VERSION,
    frozenAt: '2026-09-29T00:00:00.000Z',
    contracts: CONTRACTS,
    environment: { fingerprint: FINGERPRINT },
    sourceIdentity: {
      harnessSha256: computeHarnessIdentityDigest(manifest),
      sourceTreeSha256: archive.environment.sourceTreeSha256,
    },
    comparisonEligibility: { productTree: PRODUCT_TREE_ELIGIBILITY.SAME_CODE },
    archivedCandidate: {
      path: 'archive/valid.json',
      sha256: 'archive-hash',
      spike: CANDIDATE_ARTIFACT_SPIKE,
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
    },
    ...overrides,
  };
}

function buildValidPair() {
  const archive = makeArchive();
  const baseline = makeBaseline(archive);
  return { archive, baseline };
}

function validate({
  archive,
  baseline,
  currentFingerprint = FINGERPRINT,
  currentSourceIdentity = archive?.environment?.sourceIdentity ?? makeManifest(),
  currentSourceTreeSha256 = archive?.environment?.sourceTreeSha256 ?? 'tree-base',
  contracts = CONTRACTS,
} = {}) {
  return validateFrozenBaseline({
    baseline,
    archivedArtifact: archive,
    contracts,
    currentFingerprint,
    currentSourceIdentity,
    currentSourceTreeSha256,
    deviceScaleFactors: DEVICE_SCALE_FACTORS,
    contextsPerScale: CONTEXTS_PER_SCALE,
  });
}

function assertBlocked(result, fragment) {
  assert.equal(
    result.available,
    false,
    `expected unavailable; blockers=${result.blockers.join(' | ')}`
  );
  assert.ok(
    result.blockers.some((blocker) => blocker.includes(fragment)),
    `expected a blocker containing "${fragment}", got: ${result.blockers.join(' | ')}`
  );
}

test('computeSha256Hex is deterministic', () => {
  assert.equal(computeSha256Hex('abc'), computeSha256Hex(Buffer.from('abc')));
  assert.match(computeSha256Hex('abc'), /^[a-f0-9]{64}$/);
});

test('stableStringify ignores object key order', () => {
  assert.equal(
    stableStringify({ a: 1, b: { c: 2, d: 3 } }),
    stableStringify({ b: { d: 3, c: 2 }, a: 1 })
  );
});

test('valid frozen baseline referencing a fully passing archived candidate is available', () => {
  const { archive, baseline } = buildValidPair();
  const result = validate({ archive, baseline });
  assert.equal(result.available, true, result.blockers.join(' | '));
  assert.equal(result.evaluation.archivedRoundCount, 10);
  assert.deepEqual(result.metrics['1'], {
    eventToNextFrameP95Ms: 20,
    commitP95Ms: 20,
    rafIntervalP95Ms: 16,
    longTaskMaxMs: 40,
  });
});

test('compact baseline self-reported metrics/correctness are ignored in favour of the archive', () => {
  const { archive } = buildValidPair();
  // 经典伪造：手工写 correctness:true 与 1000ms 的宽松 metrics。
  const forged = makeBaseline(archive, {
    correctness: { passed: true },
    metrics: {
      1: {
        eventToNextFrameP95Ms: 1000,
        commitP95Ms: 1000,
        rafIntervalP95Ms: 1000,
        longTaskMaxMs: 1000,
      },
      2: {
        eventToNextFrameP95Ms: 1000,
        commitP95Ms: 1000,
        rafIntervalP95Ms: 1000,
        longTaskMaxMs: 1000,
      },
    },
  });
  const result = validate({ archive, baseline: forged });
  assert.equal(result.available, true, result.blockers.join(' | '));
  // 结论 metrics 必须来自 archive，而不是 compact JSON 里的 1000ms。
  assert.equal(result.metrics['1'].eventToNextFrameP95Ms, 20);
});

test('baseline missing its archived candidate reference fails closed', () => {
  const baseline = {
    artifactKind: BASELINE_ARTIFACT_KIND,
    schemaVersion: BASELINE_SCHEMA_VERSION,
    frozenAt: '2026-09-29T00:00:00.000Z',
    contracts: CONTRACTS,
    environment: { fingerprint: FINGERPRINT },
    sourceIdentity: { harnessSha256: 'x', sourceTreeSha256: 'tree-base' },
    comparisonEligibility: { productTree: PRODUCT_TREE_ELIGIBILITY.SAME_CODE },
    correctness: { passed: true },
    metrics: { 1: { eventToNextFrameP95Ms: 1000 } },
  };
  const result = validate({ archive: null, baseline });
  assertBlocked(result, 'archived candidate artifact is not an object');
});

test('legacy v1 self-contained baseline schema is rejected', () => {
  const { archive, baseline } = buildValidPair();
  const legacy = { ...baseline, schemaVersion: 1 };
  const result = validate({ archive, baseline: legacy });
  assertBlocked(result, 'baseline schemaVersion is 1');
});

test('archived candidate with a tampered aggregate metric above the absolute threshold is rejected', () => {
  const archive = makeArchive();
  archive.results['1'].summary = makeSummary({ eventToNextFrame: { p95Ms: 999 } });
  const baseline = makeBaseline(archive);
  const result = validate({ archive, baseline });
  assertBlocked(result, 'exceeds absolute threshold 50');
});

test('archived candidate round tampering: workload/rebase/correctness/contract are all enforced', () => {
  const cases = [
    {
      mutate: (round) => (round.contract.checks.workload.passed = false),
      fragment: 'workload did not pass',
    },
    {
      mutate: (round) => (round.contract.checks.rebase.passed = false),
      fragment: 'rebase did not pass',
    },
    {
      mutate: (round) => (round.contract.checks.correctness.passed = false),
      fragment: 'correctness check did not pass',
    },
    {
      mutate: (round) => (round.correctness.passed = false),
      fragment: 'correctness oracle did not pass',
    },
    { mutate: (round) => (round.contract.passed = false), fragment: 'contract.passed is not true' },
    { mutate: (round) => (round.failure = { message: 'boom' }), fragment: 'failure is set' },
  ];
  for (const { mutate, fragment } of cases) {
    const archive = makeArchive();
    mutate(archive.results['2'].rounds[3]);
    const baseline = makeBaseline(archive);
    const result = validate({ archive, baseline });
    assertBlocked(result, fragment);
  }
});

test('archived candidate with a wrong round count is rejected', () => {
  const archive = makeArchive();
  archive.results['1'].rounds = archive.results['1'].rounds.slice(0, 3);
  const baseline = makeBaseline(archive);
  const result = validate({ archive, baseline });
  assertBlocked(result, 'rounds has 3 entries (expected 5)');
  assertBlocked(result, 'has 8 rounds (expected 10)');
});

test('archived candidate with a failing aggregate contract is rejected', () => {
  const archive = makeArchive();
  archive.results['2'].summary = makeSummary({
    aggregateContract: { passed: false },
    passed: false,
  });
  const baseline = makeBaseline(archive);
  const result = validate({ archive, baseline });
  assertBlocked(result, 'summary.passed is not true');
  assertBlocked(result, 'aggregateContract.passed is not true');
});

test('archived candidate with a round count mismatch on the round itself is rejected', () => {
  const archive = makeArchive();
  archive.results['1'].rounds[0].deviceScaleFactor = 2;
  const baseline = makeBaseline(archive);
  const result = validate({ archive, baseline });
  assertBlocked(result, 'deviceScaleFactor does not match 1');
});

test('baseline environment fingerprint drift is rejected', () => {
  const { archive, baseline } = buildValidPair();
  const result = validate({
    archive,
    baseline,
    currentFingerprint: { ...FINGERPRINT, cpuModel: 'Other CPU' },
  });
  assertBlocked(result, 'baseline environment drift');
  assertBlocked(result, 'archived candidate environment drift');
});

test('archived candidate environment fingerprint drift is rejected', () => {
  const archive = makeArchive();
  archive.environment.fingerprint = { ...FINGERPRINT, chromiumMajor: 121 };
  const baseline = makeBaseline(archive);
  // current 保持 archive 的环境，只有 baseline 记录的是 120；因此 baseline/archive 不匹配。
  const result = validate({
    archive,
    baseline,
    currentFingerprint: archive.environment.fingerprint,
    currentSourceIdentity: archive.environment.sourceIdentity,
  });
  assertBlocked(result, 'baseline/archived fingerprint mismatch');
});

test('harness source drift (changed tracked source file hash) is rejected', () => {
  const { archive, baseline } = buildValidPair();
  const driftedManifest = makeManifest();
  driftedManifest.requiredFiles = driftedManifest.requiredFiles.map((entry) =>
    entry.path === 'scripts/perf/editor-production-performance.mjs'
      ? { ...entry, sha256: 'runner-hash-CHANGED' }
      : entry
  );
  const result = validate({
    archive,
    baseline,
    currentSourceIdentity: driftedManifest,
  });
  assertBlocked(result, 'baseline harness identity differs from current harness identity');
});

test('product source tree change under same-code eligibility is rejected', () => {
  const { archive, baseline } = buildValidPair();
  const result = validate({
    archive,
    baseline,
    currentSourceTreeSha256: 'tree-CHANGED',
  });
  assertBlocked(result, 'baseline product source tree differs from current product source tree');
});

test('product source tree change under explicit allow-drift eligibility is permitted but recorded', () => {
  const { archive } = buildValidPair();
  const baseline = makeBaseline(archive, {
    comparisonEligibility: { productTree: PRODUCT_TREE_ELIGIBILITY.ALLOW_DRIFT },
  });
  const result = validate({
    archive,
    baseline,
    currentSourceTreeSha256: 'tree-CHANGED',
  });
  assert.equal(result.available, true, result.blockers.join(' | '));
  assert.equal(result.evaluation.productTreeEligibility, PRODUCT_TREE_ELIGIBILITY.ALLOW_DRIFT);
  assert.equal(result.evaluation.currentSourceTreeSha256, 'tree-CHANGED');
  assert.equal(result.evaluation.baselineSourceTreeSha256, 'tree-base');
});

test('missing product tree eligibility fails closed instead of silently comparing only untracked aggregate', () => {
  const { archive } = buildValidPair();
  const baseline = makeBaseline(archive, { comparisonEligibility: {} });
  const result = validate({ archive, baseline });
  assertBlocked(result, 'comparisonEligibility.productTree must be explicitly');
});

test('missing baseline source tree hash is rejected', () => {
  const { archive } = buildValidPair();
  const baseline = makeBaseline(archive, {
    sourceIdentity: {
      harnessSha256: computeHarnessIdentityDigest(archive.environment.sourceIdentity),
      sourceTreeSha256: undefined,
    },
  });
  const result = validate({ archive, baseline });
  assertBlocked(result, 'baseline sourceIdentity.sourceTreeSha256 is missing');
});

test('archived candidate archived under a different contracts set is rejected', () => {
  const archive = makeArchive({ contracts: { ...CONTRACTS, eventToNextFrameP95Ms: 999 } });
  const baseline = makeBaseline(archive);
  const result = validate({ archive, baseline });
  assertBlocked(result, 'archived candidate contracts do not match current frozen contracts');
});

test('compareEnvironmentFingerprints reports every mismatch', () => {
  const mismatches = compareEnvironmentFingerprints(FINGERPRINT, {
    ...FINGERPRINT,
    platform: 'win32',
    cpuCount: 16,
  });
  assert.equal(mismatches.length, 2);
});

test('compareCandidateToBaseline passes within budget and flags degradation', () => {
  const baseline = {
    available: true,
    metrics: {
      1: { eventToNextFrameP95Ms: 20, commitP95Ms: 20, rafIntervalP95Ms: 16, longTaskMaxMs: 40 },
      2: { eventToNextFrameP95Ms: 20, commitP95Ms: 20, rafIntervalP95Ms: 16, longTaskMaxMs: 40 },
    },
    blockers: [],
  };
  const within = compareCandidateToBaseline({
    candidateByScale: {
      1: {
        summary: {
          eventToNextFrame: { p95Ms: 22 },
          commit: { p95Ms: 22 },
          rafInterval: { p95Ms: 17 },
          longTask: { maxMs: 40 },
        },
      },
      2: {
        summary: {
          eventToNextFrame: { p95Ms: 22 },
          commit: { p95Ms: 22 },
          rafInterval: { p95Ms: 17 },
          longTask: { maxMs: 40 },
        },
      },
    },
    baseline,
    degradationRatio: 0.2,
    deviceScaleFactors: DEVICE_SCALE_FACTORS,
  });
  assert.equal(within.available, true);
  assert.equal(within.withinBudget, true);

  const degraded = compareCandidateToBaseline({
    candidateByScale: {
      1: {
        summary: {
          eventToNextFrame: { p95Ms: 40 },
          commit: { p95Ms: 20 },
          rafInterval: { p95Ms: 16 },
          longTask: { maxMs: 40 },
        },
      },
      2: {
        summary: {
          eventToNextFrame: { p95Ms: 20 },
          commit: { p95Ms: 20 },
          rafInterval: { p95Ms: 16 },
          longTask: { maxMs: 40 },
        },
      },
    },
    baseline,
    degradationRatio: 0.2,
    deviceScaleFactors: DEVICE_SCALE_FACTORS,
  });
  assert.equal(degraded.withinBudget, false);
  assert.equal(degraded.degradations.length, 1);
  assert.equal(degraded.degradations[0].metric, 'eventToNextFrameP95Ms');
});

test('compareCandidateToBaseline fails closed for the unavailable/forged baseline', () => {
  const result = compareCandidateToBaseline({
    candidateByScale: {},
    baseline: { available: false, metrics: {}, blockers: ['frozen baseline is not an object'] },
    degradationRatio: 0.2,
    deviceScaleFactors: DEVICE_SCALE_FACTORS,
  });
  assert.equal(result.available, false);
  assert.equal(result.withinBudget, false);
});

test('archived candidate absolute round thresholds are independently recomputed', () => {
  const archive = makeArchive();
  // contract 声称 passed=true，但 actual 超过阈值；独立复核必须抓出来。
  archive.results['1'].rounds[0].contract.checks.rafIntervalP95 = {
    passed: true,
    actualMs: 99,
    thresholdMs: 33.4,
  };
  const baseline = makeBaseline(archive);
  const result = validate({ archive, baseline });
  assertBlocked(result, 'checks.rafIntervalP95 actual 99 exceeds threshold 33.4');
});

test('validateArchivedCandidateArtifact exposes the aggregate metrics it verified', () => {
  const archive = makeArchive();
  const validation = validateArchivedCandidateArtifact({
    artifact: archive,
    contracts: CONTRACTS,
    deviceScaleFactors: DEVICE_SCALE_FACTORS,
    contextsPerScale: CONTEXTS_PER_SCALE,
  });
  assert.equal(validation.valid, true, validation.blockers.join(' | '));
  assert.equal(validation.roundCount, 10);
  assert.equal(validation.metrics['2'].rafIntervalP95Ms, 16);
});
