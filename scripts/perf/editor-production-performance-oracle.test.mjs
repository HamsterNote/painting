#!/usr/bin/env node

/**
 * `editor-production-performance-oracle.mjs` 的纯 Node 单测。
 *
 * 运行：node --test scripts/perf/editor-production-performance-oracle.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANDIDATE_STROKE_ID_PATTERN,
  CORRECTNESS_CONTEXT_SCHEMA_VERSION,
  CORRECTNESS_PENDING_PAGE_FIELDS,
  EDITOR_PERFORMANCE_WORKLOAD_SPEC,
  EXPECTED_EDITOR_PEN_STYLE,
  INITIAL_EDITOR_RULER_RECT,
  PEN_INPUT_PRESSURE,
  WORKLOAD_COORDINATE_SIGNAL_PROVENANCE,
  WORKLOAD_PREFIX_DIGEST_ALGORITHM,
  WORKLOAD_PREFIX_DIGEST_SCHEMA,
  WORKLOAD_PREFIX_GOLDEN_DIGEST,
  canonicalizeWorkloadDocument,
  canonicalizeWorkloadPoint,
  canonicalizeWorkloadStroke,
  computeActualPrefixDigest,
  computeWorkloadPrefixDigest,
  deriveExpectedPenStrokePoints,
  derivePenInputScreenPoints,
  expectedRebaseProbes,
  independentWorkloadPrefixCoordinateSignal,
  independentWorkloadWholeDocumentChecksum,
  requiredCorrectnessFields,
  validateCorrectness,
  validateRebaseProbe,
} from './editor-production-performance-oracle.mjs';

const HOST_CLIENT_WIDTH = 1272;
const HOST_CLIENT_HEIGHT = 541;
const VIEWPORT = Object.freeze({ scale: 1, tx: 0, ty: 0 });
const EVENT_COUNT = 1200;
const INPUT = Object.freeze({ eventsPerSecond: 120, durationMs: 10_000, eventCount: EVENT_COUNT });
const PREFIX_DIGEST = computeWorkloadPrefixDigest(EDITOR_PERFORMANCE_WORKLOAD_SPEC);
const PREFIX_SIGNAL = independentWorkloadPrefixCoordinateSignal(EDITOR_PERFORMANCE_WORKLOAD_SPEC);
const RUN_ID = 'perf-run-0001';
const FIRST_SCHEDULED_AT = 5000;
const SCHEDULE_WINDOW_ENDS_AT = 15_000;
const SETTLEMENT_COMPLETED_AT = 16_000;

function buildPoints() {
  return deriveExpectedPenStrokePoints({
    eventCount: EVENT_COUNT,
    hostClientWidth: HOST_CLIENT_WIDTH,
    hostClientHeight: HOST_CLIENT_HEIGHT,
    viewport: VIEWPORT,
  });
}

function buildValidFixtures() {
  const points = buildPoints();
  const inputRun = {
    status: 'completed',
    actual: {
      firstScheduledAt: FIRST_SCHEDULED_AT,
      lastScheduledAt: FIRST_SCHEDULED_AT + ((EVENT_COUNT - 1) * 1000) / 120,
      scheduleWindowEndsAt: SCHEDULE_WINDOW_ENDS_AT,
      settlementCompletedAt: SETTLEMENT_COMPLETED_AT,
    },
    correctnessContext: {
      schemaVersion: CORRECTNESS_CONTEXT_SCHEMA_VERSION,
      runId: RUN_ID,
      capturedAt: 4000,
      times: {
        firstScheduledAt: FIRST_SCHEDULED_AT,
        scheduleWindowEndsAt: SCHEDULE_WINDOW_ENDS_AT,
      },
      document: {
        strokeCount: EDITOR_PERFORMANCE_WORKLOAD_SPEC.strokeCount,
        revision: 0,
        undoDepth: 0,
        redoDepth: 0,
        prefixDigest: PREFIX_DIGEST,
        prefixCoordinateSignal: PREFIX_SIGNAL,
      },
      penInput: {
        hostClientWidth: HOST_CLIENT_WIDTH,
        hostClientHeight: HOST_CLIENT_HEIGHT,
        viewport: VIEWPORT,
      },
      ruler: { ...INITIAL_EDITOR_RULER_RECT, center: { ...INITIAL_EDITOR_RULER_RECT.center } },
      session: { tool: 'pen', status: 'idle', pointCount: 0, hasCandidate: false },
    },
  };
  const correctnessSnapshot = {
    runId: RUN_ID,
    capturedAt: SETTLEMENT_COMPLETED_AT + 1000,
    document: {
      strokeCount: EDITOR_PERFORMANCE_WORKLOAD_SPEC.strokeCount + 1,
      revision: 1,
      undoDepth: 1,
      redoDepth: 0,
      prefixDigest: PREFIX_DIGEST,
      prefixCoordinateSignal: PREFIX_SIGNAL,
      checksum: independentWorkloadWholeDocumentChecksum(points),
      lastStroke: {
        schemaVersion: 2,
        id: 'candidate-stroke-1',
        tool: 'pen',
        strokeColor: EXPECTED_EDITOR_PEN_STYLE.strokeColor,
        strokeWidth: EXPECTED_EDITOR_PEN_STYLE.strokeWidth,
        points,
      },
    },
    frame: {
      ready: true,
      origin: { x: 636, y: 270.5 },
      visibleWorldBounds: { minX: -1, minY: -1, maxX: 1273, maxY: 542 },
      visible: 355,
      renderable: 355,
      unresolved: 0,
      revision: 1,
    },
    session: { tool: 'pen', status: 'idle', pointCount: 0, hasCandidate: false },
  };
  return { inputRun, correctnessSnapshot };
}

// ── 严格 canonical 编码 / golden digest ──

test('独立重算的 100k 前缀 digest 与冻结 golden 字面量一致', () => {
  assert.equal(WORKLOAD_PREFIX_GOLDEN_DIGEST, PREFIX_DIGEST.digest);
  assert.match(PREFIX_DIGEST.digest, /^[0-9a-f]{64}$/);
  assert.equal(PREFIX_DIGEST.algorithm, WORKLOAD_PREFIX_DIGEST_ALGORITHM);
  assert.equal(PREFIX_DIGEST.schema, WORKLOAD_PREFIX_DIGEST_SCHEMA);
  assert.equal(PREFIX_DIGEST.strokeCount, 100_000);
  assert.deepEqual(computeWorkloadPrefixDigest(), PREFIX_DIGEST);
  assert.ok(requiredCorrectnessFields().length > 0);
  assert.deepEqual(CORRECTNESS_PENDING_PAGE_FIELDS, requiredCorrectnessFields());
});

test('严格 canonical：未知 stroke/point/document own keys 一律拒绝（reject unexpected）', () => {
  const document = {
    schemaVersion: 2,
    strokes: [
      {
        id: 's',
        tool: 'pen',
        schemaVersion: 2,
        strokeColor: '#000',
        strokeWidth: 1,
        points: [{ x: 1, y: 2 }],
      },
    ],
  };
  // 基线：合法文档可以严格编码。
  assert.equal(typeof computeActualPrefixDigest(document), 'string');

  // 未知 point key
  assert.throws(
    () => canonicalizeWorkloadPoint({ x: 1, y: 2, secret: 3 }, 'p'),
    /unexpected own key "secret"/
  );
  // 未知 stroke key
  assert.throws(
    () => canonicalizeWorkloadStroke({ ...document.strokes[0], extra: true }, 's'),
    /unexpected own key "extra"/
  );
  // 未知 document key
  assert.throws(
    () => canonicalizeWorkloadDocument({ ...document, unexpected: 1 }, 'd'),
    /unexpected own key "unexpected"/
  );
  // 缺必填 key
  assert.throws(
    () =>
      canonicalizeWorkloadStroke(
        { id: 's', tool: 'pen', schemaVersion: 2, strokeColor: '#000', strokeWidth: 1 },
        's'
      ),
    /missing required own key "points"/
  );
  // 通过严格 actual 入口编码含未知键的文档也必须抛错
  assert.throws(() => computeActualPrefixDigest({ ...document, unexpected: 1 }), /unexpected/);
  // 非有限坐标
  assert.throws(
    () => canonicalizeWorkloadPoint({ x: Number.NaN, y: 2 }, 'p'),
    /x\/y must be finite/
  );
});

test('严格 canonical：point.pressure 可选语义进入 digest，且未知键与非法 pressure 被拒绝', () => {
  const noPressure = computeActualPrefixDigest({
    schemaVersion: 2,
    strokes: [
      {
        id: 's',
        tool: 'pen',
        schemaVersion: 2,
        strokeColor: '#000',
        strokeWidth: 1,
        points: [{ x: 1, y: 2 }],
      },
    ],
  });
  const withPressure = computeActualPrefixDigest({
    schemaVersion: 2,
    strokes: [
      {
        id: 's',
        tool: 'pen',
        schemaVersion: 2,
        strokeColor: '#000',
        strokeWidth: 1,
        points: [{ x: 1, y: 2, pressure: 0.5 }],
      },
    ],
  });
  assert.notEqual(noPressure, withPressure, 'pressure 存在与否必须影响 digest');
  assert.throws(
    () => canonicalizeWorkloadPoint({ x: 1, y: 2, pressure: Number.NaN }, 'p'),
    /pressure must be finite/
  );
});

test('digest 变异：任一已知 workload 字段或坐标被改动都会改变严格 digest', () => {
  const stroke = {
    id: 'performance-stroke-0',
    tool: 'pen',
    schemaVersion: 2,
    strokeColor: '#172033',
    strokeWidth: 1.5,
    points: [{ x: 1, y: 2 }],
  };
  const base = computeActualPrefixDigest({ schemaVersion: 2, strokes: [stroke] });
  const mutate = (patch) =>
    computeActualPrefixDigest({
      schemaVersion: 2,
      strokes: [{ ...stroke, ...patch }],
    });
  for (const [label, patch] of [
    ['id', { id: 'performance-stroke-1' }],
    ['tool', { tool: 'line' }],
    ['strokeColor', { strokeColor: '#000000' }],
    ['strokeWidth', { strokeWidth: 2.5 }],
    ['point.x', { points: [{ x: 1.000001, y: 2 }] }],
    [
      'point-count',
      {
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    ],
  ]) {
    assert.notEqual(base, mutate(patch), `${label} 变更必须改变 digest`);
  }
  assert.equal(computeWorkloadPrefixDigest().digest, PREFIX_DIGEST.digest);
});

test('独立重算的前两点 coordinate signal 与真实页面 artifact 一致，且与 whole-document checksum 分离', () => {
  assert.equal(independentWorkloadPrefixCoordinateSignal(), WORKLOAD_COORDINATE_SIGNAL_PROVENANCE);
  const points = buildPoints();
  const whole = independentWorkloadWholeDocumentChecksum(points);
  assert.notEqual(whole, PREFIX_SIGNAL, '100001 全文档 checksum 不得等于 100k 前缀信号');
  // 修改追加点会改变 whole-document checksum（独立重算覆盖整份文档）。
  const mutatedPoints = points.map((point, index) =>
    index === 0 ? { ...point, x: point.x + 1 } : point
  );
  assert.notEqual(independentWorkloadWholeDocumentChecksum(mutatedPoints), whole);
});

// ── 输入方程 ──

test('手写 golden：screen 方程 + ruler 约束 + pressure 去重', () => {
  const points = buildPoints();
  assert.equal(points.length, EVENT_COUNT);
  const golden = [
    [0, 120, 120, 0.5],
    [1, 127, 125, 0.5],
    [2, 134, 130, 0.5],
    [17, 239, 205, 0.5],
    // 第一个被尺边投影的点：y 210 → 209
    [18, 246, 209, 0.5],
    [19, 253, 209, 0.5],
    [26, 302, 209, 0.5],
    // 越过尺边后重置，点保持不变
    [27, 309, 255, 0.5],
    [28, 316, 260, 0.5],
  ];
  for (const [index, x, y, pressure] of golden) {
    assert.deepEqual(points[index], { x, y, pressure }, `golden point ${index}`);
  }
  assert.equal(points[points.length - 1].pressure, PEN_INPUT_PRESSURE.up);
  assert.ok(points.slice(0, -1).every((point) => point.pressure === PEN_INPUT_PRESSURE.move));
  const screenPoints = derivePenInputScreenPoints({
    eventCount: EVENT_COUNT,
    hostClientWidth: HOST_CLIENT_WIDTH,
    hostClientHeight: HOST_CLIENT_HEIGHT,
  });
  assert.deepEqual(screenPoints[0], { x: 120, y: 120 });
  assert.deepEqual(screenPoints[18], { x: 246, y: 210 });
});

test('pressure 重复点：按 x/y 去重且保留先前点（含其 pressure）', () => {
  // host 尺寸 <=160 时 xModulus=yModulus=1，所有 screen 点都落在 (120,120)。
  const points = deriveExpectedPenStrokePoints({
    eventCount: 4,
    hostClientWidth: 100,
    hostClientHeight: 100,
    viewport: VIEWPORT,
  });
  assert.equal(points.length, 1, '相同 x/y 的重复点必须被去重');
  // 第一个点（move）的 pressure 0.5 必须被保留，而不是被最后的 up=0 覆盖。
  assert.equal(points[0].pressure, PEN_INPUT_PRESSURE.move);

  // 若页面错误地把重复点连同后续 pressure 一起提交，点序列比对必须 fail closed。
  const { inputRun, correctnessSnapshot } = buildValidFixtures();
  const duplicated = [...correctnessSnapshot.document.lastStroke.points];
  duplicated.splice(5, 0, { ...duplicated[4] });
  correctnessSnapshot.document.lastStroke.points = duplicated;
  const result = validateCorrectness({ inputRun, correctnessSnapshot, input: INPUT });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((entry) => entry.startsWith('last-stroke-points:')));
});

// ── correctness ──

test('PASS：完整 run-start context + post-run 快照通过全部 correctness 校验', () => {
  const { inputRun, correctnessSnapshot } = buildValidFixtures();
  const result = validateCorrectness({ inputRun, correctnessSnapshot, input: INPUT });
  assert.equal(result.passed, true, JSON.stringify(result.failures));
  assert.deepEqual(result.failures, []);
  assert.equal(result.checks.prefixDigest.passed, true);
  assert.equal(result.checks.prefixCoordinateSignal.proof, false);
  assert.equal(result.checks.prefixCoordinateSignal.passed, true);
  assert.equal(result.checks.wholeDocumentChecksum.passed, true);
  assert.equal(result.checks.lastStrokePoints.verified, true);
  assert.equal(result.checks.frame.passed, true);
  assert.equal(result.checks.session.passed, true);
  assert.deepEqual(result.requiredFields, requiredCorrectnessFields());
});

test('pressure 变异：down/move 非 0.5 或 up 非 0 时 fail closed', () => {
  const mutateMove = buildValidFixtures();
  mutateMove.correctnessSnapshot.document.lastStroke.points =
    mutateMove.correctnessSnapshot.document.lastStroke.points.map((point, index) =>
      index === 5 ? { ...point, pressure: 0.2 } : point
    );
  const moveResult = validateCorrectness({ ...mutateMove, input: INPUT });
  assert.equal(moveResult.passed, false);
  assert.ok(moveResult.failures.some((entry) => entry.startsWith('last-stroke-points:')));

  const mutateUp = buildValidFixtures();
  const points = mutateUp.correctnessSnapshot.document.lastStroke.points;
  points[points.length - 1] = { ...points[points.length - 1], pressure: 0.5 };
  const upResult = validateCorrectness({ ...mutateUp, input: INPUT });
  assert.equal(upResult.passed, false);
  assert.ok(upResult.failures.some((entry) => entry.startsWith('last-stroke-points:')));
});

test('禁止以 post-run 页面当前值代替 run-start context', () => {
  const { inputRun, correctnessSnapshot } = buildValidFixtures();
  // post-run 快照里放一份错误 penInput/geometry；oracle 必须只用 context，故仍应 PASS。
  correctnessSnapshot.document.penInput = {
    hostClientWidth: 1,
    hostClientHeight: 1,
    viewport: { scale: 99, tx: 1, ty: 1 },
  };
  const result = validateCorrectness({ inputRun, correctnessSnapshot, input: INPUT });
  assert.equal(result.passed, true, JSON.stringify(result.failures));
});

test('缺字段：动态 mandatory 清单中的关键字段缺失均 fail closed', () => {
  const noContext = buildValidFixtures();
  delete noContext.inputRun.correctnessContext;
  const noContextResult = validateCorrectness({ ...noContext, input: INPUT });
  assert.equal(noContextResult.passed, false);
  assert.ok(noContextResult.missingFields.includes('inputRun.correctnessContext'));

  for (const [label, mutate] of [
    ['runId', (f) => delete f.correctnessSnapshot.runId],
    ['capturedAt', (f) => delete f.correctnessSnapshot.capturedAt],
    ['session', (f) => delete f.correctnessSnapshot.session],
    ['frame', (f) => delete f.correctnessSnapshot.frame],
    ['frame.revision', (f) => delete f.correctnessSnapshot.frame.revision],
    ['undoDepth', (f) => delete f.correctnessSnapshot.document.undoDepth],
    ['redoDepth', (f) => delete f.correctnessSnapshot.document.redoDepth],
    ['prefixDigest', (f) => delete f.correctnessSnapshot.document.prefixDigest],
    ['prefixCoordinateSignal', (f) => delete f.correctnessSnapshot.document.prefixCoordinateSignal],
    ['checksum', (f) => delete f.correctnessSnapshot.document.checksum],
    ['lastStroke', (f) => delete f.correctnessSnapshot.document.lastStroke],
    ['ruler', (f) => delete f.inputRun.correctnessContext.ruler],
    ['times', (f) => delete f.inputRun.correctnessContext.times],
    ['context.runId', (f) => delete f.inputRun.correctnessContext.runId],
  ]) {
    const fixtures = buildValidFixtures();
    mutate(fixtures);
    const result = validateCorrectness({ ...fixtures, input: INPUT });
    assert.equal(result.passed, false, `${label} should fail closed`);
    assert.ok(
      result.missingFields.some((field) => field.toLowerCase().includes(label.toLowerCase())),
      `${label} missing field should be reported (got ${JSON.stringify(result.missingFields)})`
    );
  }
});

test('错误计数/时序：strokeCount、revision、history、capturedAt、times 不符合时 fail closed', () => {
  const staleCount = buildValidFixtures();
  staleCount.correctnessSnapshot.document.strokeCount =
    EDITOR_PERFORMANCE_WORKLOAD_SPEC.strokeCount;
  assert.ok(
    validateCorrectness({ ...staleCount, input: INPUT }).failures.some((e) =>
      e.startsWith('post-stroke-count:')
    )
  );

  const staleRevision = buildValidFixtures();
  staleRevision.correctnessSnapshot.document.revision = 7;
  assert.ok(
    validateCorrectness({ ...staleRevision, input: INPUT }).failures.some((e) =>
      e.startsWith('post-revision:')
    )
  );

  const badHistory = buildValidFixtures();
  badHistory.correctnessSnapshot.document.undoDepth = 0;
  badHistory.correctnessSnapshot.document.redoDepth = 1;
  const historyResult = validateCorrectness({ ...badHistory, input: INPUT });
  assert.ok(historyResult.failures.some((e) => e.startsWith('post-undo-depth:')));
  assert.ok(historyResult.failures.some((e) => e.startsWith('post-redo-depth:')));

  const timeOrder = buildValidFixtures();
  timeOrder.inputRun.correctnessContext.capturedAt = 6000;
  assert.ok(
    validateCorrectness({ ...timeOrder, input: INPUT }).failures.some((e) =>
      e.startsWith('context-time-order:')
    )
  );

  const dirtyContextHistory = buildValidFixtures();
  dirtyContextHistory.inputRun.correctnessContext.document.undoDepth = 3;
  assert.ok(
    validateCorrectness({ ...dirtyContextHistory, input: INPUT }).failures.some((e) =>
      e.startsWith('context-undo-depth:')
    )
  );

  const badTimes = buildValidFixtures();
  badTimes.inputRun.correctnessContext.times.scheduleWindowEndsAt = 1;
  assert.ok(
    validateCorrectness({ ...badTimes, input: INPUT }).failures.some((e) =>
      e.startsWith('context-times-scheduleWindowEndsAt:')
    )
  );

  const lateCapture = buildValidFixtures();
  lateCapture.correctnessSnapshot.capturedAt = SETTLEMENT_COMPLETED_AT - 1;
  assert.ok(
    validateCorrectness({ ...lateCapture, input: INPUT }).failures.some((e) =>
      e.startsWith('post-capturedAt:')
    )
  );

  const wrongRunId = buildValidFixtures();
  wrongRunId.correctnessSnapshot.runId = 'other-run';
  assert.ok(
    validateCorrectness({ ...wrongRunId, input: INPUT }).failures.some((e) =>
      e.startsWith('post-run-id:')
    )
  );

  const badFrameRevision = buildValidFixtures();
  badFrameRevision.correctnessSnapshot.frame.revision = 99;
  assert.ok(
    validateCorrectness({ ...badFrameRevision, input: INPUT }).failures.some((e) =>
      e.includes('frame.revision-99')
    )
  );
});

test('digest/coordinateSignal/checksum 分离：任一被篡改都 fail closed，绝不用错位信号冒充 proof', () => {
  const mismatch = buildValidFixtures();
  mismatch.correctnessSnapshot.document.prefixDigest = { ...PREFIX_DIGEST, digest: 'f'.repeat(64) };
  assert.ok(
    validateCorrectness({ ...mismatch, input: INPUT }).failures.includes(
      'post-prefix-digest-mismatch'
    )
  );

  const contextMismatch = buildValidFixtures();
  contextMismatch.inputRun.correctnessContext.document.prefixDigest = {
    ...PREFIX_DIGEST,
    digest: 'a'.repeat(64),
  };
  assert.ok(
    validateCorrectness({ ...contextMismatch, input: INPUT }).failures.includes(
      'context-prefix-digest-mismatch'
    )
  );

  const signalMismatch = buildValidFixtures();
  signalMismatch.correctnessSnapshot.document.prefixCoordinateSignal = 'fnv1a-deadbeef';
  assert.ok(
    validateCorrectness({ ...signalMismatch, input: INPUT }).failures.some((e) =>
      e.startsWith('post-prefix-coordinate-signal:')
    )
  );

  // 关键：把 100k 前缀信号塞进 whole-document checksum 必须失败（两者语义不同）。
  const wrongWhole = buildValidFixtures();
  wrongWhole.correctnessSnapshot.document.checksum = PREFIX_SIGNAL;
  assert.ok(
    validateCorrectness({ ...wrongWhole, input: INPUT }).failures.some((e) =>
      e.startsWith('whole-document-checksum:')
    )
  );

  // 篡改 whole-document checksum 同样 fail closed。
  const mutatedWhole = buildValidFixtures();
  mutatedWhole.correctnessSnapshot.document.checksum = 'fnv1a-00000000';
  assert.ok(
    validateCorrectness({ ...mutatedWhole, input: INPUT }).failures.some((e) =>
      e.startsWith('whole-document-checksum:')
    )
  );
});

test('post frame 强制 schema：unresolved/renderable/visible/origin/revision 不合规时 fail closed', () => {
  const cases = [
    (f) => (f.correctnessSnapshot.frame.unresolved = 2),
    (f) => (f.correctnessSnapshot.frame.renderable = 0),
    (f) => (f.correctnessSnapshot.frame.origin = { x: Number.NaN, y: 0 }),
    (f) => delete f.correctnessSnapshot.frame.revision,
  ];
  for (const mutate of cases) {
    const fixtures = buildValidFixtures();
    mutate(fixtures);
    assert.ok(
      validateCorrectness({ ...fixtures, input: INPUT }).failures.some((e) =>
        e.startsWith('post-frame:')
      )
    );
  }
});

test('禁止 fallback：correctness 独立于 prerequisites / rebase', () => {
  const invalidButOtherwiseOk = buildValidFixtures();
  invalidButOtherwiseOk.correctnessSnapshot.document.lastStroke.tool = 'line';
  const invalidResult = validateCorrectness({ ...invalidButOtherwiseOk, input: INPUT });
  assert.equal(invalidResult.passed, false);
  assert.ok(invalidResult.failures.some((e) => e.startsWith('last-stroke-tool:')));

  const valid = buildValidFixtures();
  assert.equal(validateCorrectness({ ...valid, input: INPUT }).passed, true);

  assert.ok(CANDIDATE_STROKE_ID_PATTERN.test('candidate-stroke-1'));
  assert.equal(CANDIDATE_STROKE_ID_PATTERN.test('performance-stroke-0'), false);
});

// ── rebase probe ──

function buildRebaseProbe(mutate) {
  const probes = expectedRebaseProbes().map((expectation) => ({
    label: expectation.label,
    scale: expectation.scale,
    status: 'frame-ready',
    finite: true,
    hit: {
      key: expectation.key,
      id: expectation.id,
      tool: 'pen',
      point: { x: 0, y: 0 },
    },
    frameOrigin: { ...expectation.point },
    visible: 1,
    renderable: 1,
    unresolved: 0,
  }));
  const probe = { version: EDITOR_PERFORMANCE_WORKLOAD_SPEC.version, probes };
  if (mutate) mutate(probe);
  return probe;
}

test('rebase probe：精确 key/id、origin==global、hit.point==0 全部通过', () => {
  const result = validateRebaseProbe(buildRebaseProbe());
  assert.equal(result.passed, true, JSON.stringify(result.failures));
});

test('rebase probe：key/id/origin/hit.point/order/version/边界 不合规时 fail closed', () => {
  const badKey = buildRebaseProbe((probe) => {
    probe.probes[2].hit.key = 999;
    probe.probes[2].hit.id = 'performance-stroke-999';
  });
  assert.ok(validateRebaseProbe(badKey).failures.some((e) => e.includes('hit key')));

  const badId = buildRebaseProbe((probe) => {
    probe.probes[0].hit.id = 'performance-stroke-1';
  });
  assert.ok(validateRebaseProbe(badId).failures.some((e) => e.includes('hit id')));

  const badOrigin = buildRebaseProbe((probe) => {
    probe.probes[1].frameOrigin = { x: 0, y: 0 };
  });
  assert.ok(validateRebaseProbe(badOrigin).failures.some((e) => e.includes('frameOrigin')));

  const badPoint = buildRebaseProbe((probe) => {
    probe.probes[3].hit.point = { x: 0.5, y: 0 };
  });
  assert.ok(validateRebaseProbe(badPoint).failures.some((e) => e.includes('hit point')));

  const badOrder = buildRebaseProbe((probe) => {
    probe.probes.reverse();
  });
  assert.ok(validateRebaseProbe(badOrder).failures.some((e) => e.includes('order mismatch')));

  const badVersion = buildRebaseProbe((probe) => {
    probe.version = 2;
  });
  assert.ok(validateRebaseProbe(badVersion).failures.some((e) => e.includes('version')));

  const noHit = buildRebaseProbe((probe) => {
    probe.probes[1].hit = null;
  });
  assert.ok(validateRebaseProbe(noHit).failures.some((e) => e.includes('no hit probe result')));

  const badUnresolved = buildRebaseProbe((probe) => {
    probe.probes[3].unresolved = 1;
  });
  assert.ok(validateRebaseProbe(badUnresolved).failures.some((e) => e.includes('unresolved')));

  const badCount = { version: 1, probes: buildRebaseProbe().probes.slice(0, 5) };
  assert.ok(validateRebaseProbe(badCount).failures.some((e) => e.includes('rebase records')));
});

test('rebase probe：±1e9 原点的 +0.5 漂移必须被固定绝对容差拒绝（不因量级放宽）', () => {
  const drift = buildRebaseProbe((probe) => {
    probe.probes[0].frameOrigin.x += 0.5;
  });
  assert.ok(validateRebaseProbe(drift).failures.some((e) => e.includes('frameOrigin')));

  const driftTiny = buildRebaseProbe((probe) => {
    probe.probes[4].frameOrigin.y += 2e-6; // 超过 1e-6 固定绝对容差
  });
  assert.ok(validateRebaseProbe(driftTiny).failures.some((e) => e.includes('frameOrigin')));

  const withinTolerance = buildRebaseProbe((probe) => {
    probe.probes[2].frameOrigin.x += 1e-7; // <= 1e-6，允许
  });
  assert.equal(validateRebaseProbe(withinTolerance).passed, true);
});

test('rebase probe：renderable>visible 必须 fail closed', () => {
  const bad = buildRebaseProbe((probe) => {
    probe.probes[0].visible = 3;
    probe.probes[0].renderable = 4;
  });
  assert.ok(validateRebaseProbe(bad).failures.some((e) => e.includes('exceeds visible')));
});

test('run-start/post session 必须是 idle pen、0 点、hasCandidate=false（拒绝 finished/残余）', () => {
  const finishedContext = buildValidFixtures();
  finishedContext.inputRun.correctnessContext.session.status = 'finished';
  assert.ok(
    validateCorrectness({ ...finishedContext, input: INPUT }).failures.some((e) =>
      e.startsWith('context-session:')
    )
  );

  const residualContext = buildValidFixtures();
  residualContext.inputRun.correctnessContext.session.hasCandidate = true;
  assert.ok(
    validateCorrectness({ ...residualContext, input: INPUT }).failures.some((e) =>
      e.startsWith('context-session:')
    )
  );

  const residualPost = buildValidFixtures();
  residualPost.correctnessSnapshot.session.hasCandidate = true;
  assert.ok(
    validateCorrectness({ ...residualPost, input: INPUT }).failures.some((e) =>
      e.startsWith('post-session:')
    )
  );

  const finishedPost = buildValidFixtures();
  finishedPost.correctnessSnapshot.session.status = 'finished';
  assert.ok(
    validateCorrectness({ ...finishedPost, input: INPUT }).failures.some((e) =>
      e.startsWith('post-session:')
    )
  );
});

test('调度窗口跨度必须严格等于 durationMs：拒绝 20s 放大窗口（context 与 actual）', () => {
  const both = buildValidFixtures();
  both.inputRun.correctnessContext.times.scheduleWindowEndsAt =
    both.inputRun.correctnessContext.times.firstScheduledAt + 20_000;
  both.inputRun.actual.scheduleWindowEndsAt = both.inputRun.actual.firstScheduledAt + 20_000;
  const result = validateCorrectness({ ...both, input: INPUT });
  assert.ok(result.failures.some((e) => e.startsWith('context-times-window:')));
  assert.ok(result.failures.some((e) => e.startsWith('actual-schedule-window:')));
});

test('lastStroke 必须是精确 V2 形状：未知键/缺 schemaVersion/错 schemaVersion/点键不合规都 fail closed', () => {
  const unknownStrokeKey = buildValidFixtures();
  unknownStrokeKey.correctnessSnapshot.document.lastStroke.extra = 1;
  assert.ok(
    validateCorrectness({ ...unknownStrokeKey, input: INPUT }).failures.some((e) =>
      e.startsWith('last-stroke-keys:')
    )
  );

  const missingSchema = buildValidFixtures();
  delete missingSchema.correctnessSnapshot.document.lastStroke.schemaVersion;
  assert.ok(
    validateCorrectness({ ...missingSchema, input: INPUT }).failures.some((e) =>
      e.startsWith('last-stroke-schemaVersion:')
    )
  );

  const wrongSchema = buildValidFixtures();
  wrongSchema.correctnessSnapshot.document.lastStroke.schemaVersion = 1;
  assert.ok(
    validateCorrectness({ ...wrongSchema, input: INPUT }).failures.some((e) =>
      e.startsWith('last-stroke-schemaVersion:')
    )
  );

  const pointUnknownKey = buildValidFixtures();
  pointUnknownKey.correctnessSnapshot.document.lastStroke.points =
    pointUnknownKey.correctnessSnapshot.document.lastStroke.points.map((point, index) =>
      index === 3 ? { ...point, extra: 1 } : point
    );
  assert.ok(
    validateCorrectness({ ...pointUnknownKey, input: INPUT }).failures.some((e) =>
      e.startsWith('last-stroke-point-keys:')
    )
  );

  const pointMissingPressure = buildValidFixtures();
  pointMissingPressure.correctnessSnapshot.document.lastStroke.points =
    pointMissingPressure.correctnessSnapshot.document.lastStroke.points.map((point, index) =>
      index === 3 ? { x: point.x, y: point.y } : point
    );
  const missingPressureResult = validateCorrectness({ ...pointMissingPressure, input: INPUT });
  assert.ok(
    missingPressureResult.failures.some((e) => e.startsWith('last-stroke-point-keys:')) ||
      missingPressureResult.failures.some((e) => e.startsWith('last-stroke-point-'))
  );
});

test('run-start revision 非 0 必须 fail closed（clean 精确 0）', () => {
  const dirty = buildValidFixtures();
  dirty.inputRun.correctnessContext.document.revision = 5;
  assert.ok(
    validateCorrectness({ ...dirty, input: INPUT }).failures.some((e) =>
      e.startsWith('context-revision:')
    )
  );
});
