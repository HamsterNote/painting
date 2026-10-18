/** @jest-environment node */

/**
 * Task 2.3 测试 lane 证据：自由笔输入会话（`core/freehandSession.ts`）。
 *
 * 范围声明（重要）：
 * - 只新增测试，不修改任何生产模块；生产 API 由 writer 并行推进。
 * - 热路径 `update` 成功只返回 `ok(undefined)`，**不读取 update.value 作为 snapshot**；
 *   需要观察样本时显式调用 `session.getSnapshot()`。
 * - 所有 Result 断言只检查 `ok` / `code`；失败不得抛异常、不得改变 state。
 */

import {
  beginFreehandSession,
  type BeginFreehandSessionInput,
  type FreehandCandidate,
  type FreehandInputBatch,
  type FreehandSampleInput,
  type FreehandSession,
  type FreehandSessionCancel,
  type FreehandSessionEnd,
  type FreehandSessionUpdate,
} from '../../core/freehandSession';
import type { BrushSnapshot, SamplePhase } from '../../model/document';

// ---------------------------------------------------------------------------
// fixture builders
// ---------------------------------------------------------------------------

/** 规范（已归一化）viewport，落在 [0.25, 8] 内，tx/ty 有限。 */
const CANONICAL_VIEWPORT = Object.freeze({ scale: 2, tx: 10, ty: -5 });

/** 单条输入样本；`pressure` 可省略（省略即真实缺字段）。 */
function makeSample(
  sequence: number,
  phase: SamplePhase,
  overrides: Partial<FreehandSampleInput> = {}
): FreehandSampleInput {
  return {
    sequence,
    x: sequence * 4,
    y: sequence * 3,
    pressure: 0.5,
    time: sequence * 16,
    phase,
    ...overrides,
  };
}

/** 输入批次；默认 begin 批次（batchSequence 0，2 条 down/move）。 */
function makeBatch(overrides: Partial<FreehandInputBatch> = {}): FreehandInputBatch {
  return {
    sessionId: 'sess-1',
    pointerId: 7,
    source: 'pen',
    batchSequence: 0,
    coordinateSpace: 'screen',
    viewportRevision: 1,
    samples: [makeSample(0, 'down'), makeSample(1, 'move')],
    ...overrides,
  };
}

/** 可被外部持有的普通 brush 对象（非冻结），用于验证快照隔离。 */
function makeBrush(overrides: Record<string, unknown> = {}): BrushSnapshot {
  return {
    color: '#abc',
    nominalSize: 8,
    opacity: 0.9,
    pressureMode: 'real',
    presetRevision: 1,
    ...overrides,
  } as BrushSnapshot;
}

/** begin 输入；默认规范 viewport、commit-1、pen、available。 */
function makeBegin(overrides: Partial<BeginFreehandSessionInput> = {}): BeginFreehandSessionInput {
  return {
    type: 'begin',
    commitId: 'commit-1',
    pressureCapability: 'available',
    brush: makeBrush(),
    viewportSnapshot: { revision: 1, viewport: CANONICAL_VIEWPORT },
    batch: makeBatch(),
    ...overrides,
  };
}

/** 开启一个 collecting 会话；begin 失败直接抛，便于测试定位。 */
function startSession(overrides: Partial<BeginFreehandSessionInput> = {}): FreehandSession {
  const result = beginFreehandSession(makeBegin(overrides));
  if (!result.ok) {
    throw new Error(`begin failed with code ${result.code}`);
  }
  return result.value;
}

/** 走完 begin + end，返回 awaiting-commit 会话与候选。 */
function endStroke(): { session: FreehandSession; candidate: FreehandCandidate } {
  const session = startSession();
  const end = session.end({
    type: 'end',
    batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'up')] }),
  });
  if (!end.ok || end.value.status !== 'awaiting-commit') {
    throw new Error('end did not produce awaiting-commit');
  }
  return { session, candidate: end.value.candidate };
}

/** collecting 快照断言辅助。 */
function collecting(session: FreehandSession) {
  const snapshot = session.getSnapshot();
  if (snapshot.status !== 'collecting') {
    throw new Error(`expected collecting, got ${snapshot.status}`);
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// A. 压力模式解析（begin 锁定）
// ---------------------------------------------------------------------------

describe('freehandSession: 压力模式解析', () => {
  it('auto + pen + available/unknown 恒 0.5 → real，样本压力原样保留', () => {
    for (const capability of ['available', 'unknown'] as const) {
      const session = startSession({
        pressureCapability: capability,
        brush: makeBrush({ pressureMode: 'auto' }),
      });
      const snapshot = collecting(session);
      expect(snapshot.resolvedPressureMode).toBe('real');
      expect(snapshot.samples.map((s) => s.pressure)).toEqual([0.5, 0.5]);
    }
  });

  it('auto + pen + unavailable → simulated', () => {
    const session = startSession({
      pressureCapability: 'unavailable',
      brush: makeBrush({ pressureMode: 'auto' }),
    });
    expect(collecting(session).resolvedPressureMode).toBe('simulated');
  });

  it('auto + mouse 即使正压力仍 → simulated', () => {
    const session = startSession({
      brush: makeBrush({ pressureMode: 'auto' }),
      batch: makeBatch({ source: 'mouse', samples: [makeSample(0, 'down', { pressure: 0.9 })] }),
    });
    expect(collecting(session).resolvedPressureMode).toBe('simulated');
  });

  it('auto + touch 即使正压力仍 → simulated', () => {
    const session = startSession({
      brush: makeBrush({ pressureMode: 'auto' }),
      batch: makeBatch({ source: 'touch', samples: [makeSample(0, 'down', { pressure: 0.8 })] }),
    });
    expect(collecting(session).resolvedPressureMode).toBe('simulated');
  });

  it('auto + native available → real；unavailable/unknown → simulated', () => {
    const cases: ReadonlyArray<readonly [string, 'real' | 'simulated']> = [
      ['available', 'real'],
      ['unavailable', 'simulated'],
      ['unknown', 'simulated'],
    ];
    for (const [capability, expected] of cases) {
      const session = startSession({
        pressureCapability: capability as 'available' | 'unavailable' | 'unknown',
        brush: makeBrush({ pressureMode: 'auto' }),
        batch: makeBatch({ source: 'native', samples: [makeSample(0, 'down')] }),
      });
      expect(collecting(session).resolvedPressureMode).toBe(expected);
    }
  });

  it('显式 real/simulated/constant 原样锁定并进入 candidate', () => {
    for (const mode of ['real', 'simulated', 'constant'] as const) {
      const session = startSession({
        brush: makeBrush({ pressureMode: mode }),
        pressureCapability: 'unavailable',
      });
      const end = session.end({
        type: 'end',
        batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'up')] }),
      });
      if (!end.ok || end.value.status !== 'awaiting-commit') {
        throw new Error(`expected awaiting-commit for ${mode}`);
      }
      expect(end.value.candidate.resolvedPressureMode).toBe(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// B. brush 快照、白名单与外部隔离
// ---------------------------------------------------------------------------

describe('freehandSession: brush 快照', () => {
  it('未知 dash/pressureMultiplier/PF 字段被剔除且 brush 冻结', () => {
    const session = startSession({
      brush: {
        color: '#123456',
        nominalSize: 6,
        opacity: 0.5,
        pressureMode: 'real',
        presetRevision: 2,
        dash: [1, 2],
        pressureMultiplier: 3,
        thinning: 0.9,
        smoothing: 0.1,
        streamline: 0.2,
        __pf: true,
      } as unknown as BrushSnapshot,
    });
    const snapshot = collecting(session);
    expect(Object.keys(snapshot.brushSnapshot).sort()).toEqual([
      'color',
      'nominalSize',
      'opacity',
      'presetRevision',
      'pressureMode',
    ]);
    const raw = snapshot.brushSnapshot as Record<string, unknown>;
    expect(raw.dash).toBeUndefined();
    expect(raw.pressureMultiplier).toBeUndefined();
    expect(raw.thinning).toBeUndefined();
    expect(raw.streamline).toBeUndefined();
    expect(Object.isFrozen(snapshot.brushSnapshot)).toBe(true);
  });

  it('begin 后外部 brush 对象变化不影响本笔（仅下一笔）', () => {
    // 外部持有可变副本；begin 会做白名单拷贝并冻结。
    const brush: { -readonly [K in keyof BrushSnapshot]: BrushSnapshot[K] } = { ...makeBrush() };
    const session = startSession({ brush });
    const first = collecting(session);

    brush.nominalSize = 999;
    brush.color = '#000000';

    const second = collecting(session);
    expect(first.brushSnapshot.nominalSize).toBe(8);
    expect(second.brushSnapshot.nominalSize).toBe(8);
    expect(second.brushSnapshot.color).toBe('#abc');
    expect(second.brushSnapshot).toBe(first.brushSnapshot);
  });

  it('非法 brush（nominalSize<=0 / opacity 越界 / 未知 mode）→ invalid-input', () => {
    const badBrushes: readonly BrushSnapshot[] = [
      makeBrush({ nominalSize: 0 }),
      makeBrush({ opacity: 2 }),
      makeBrush({ pressureMode: 'weird' }),
    ];
    for (const brush of badBrushes) {
      const result = beginFreehandSession(makeBegin({ brush }));
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Test precondition failed: !result.ok');
      }
      {
        expect(result.code).toBe('invalid-input');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// C. owner / source / pointer / 坐标空间 / viewport revision mismatch
// ---------------------------------------------------------------------------

describe('freehandSession: envelope identity 校验', () => {
  it.each([NaN, Infinity, -Infinity, 0.5, Number.MIN_SAFE_INTEGER - 1])(
    'rejects non-integer or unsafe pointer identity %s',
    (pointerId) => {
      expect(beginFreehandSession(makeBegin({ batch: makeBatch({ pointerId }) }))).toEqual({
        ok: false,
        code: 'invalid-input',
      });
    }
  );
  it.each(
    [-765894345, -765894343, -2147483648].flatMap((pointerId) =>
      (['pen', 'touch'] as const).map((source) => ({ pointerId, source }))
    )
  )(
    '$source signed pointer $pointerId preserves identity through update/end/cancel',
    ({ pointerId, source }) => {
      const batch = (overrides: Partial<FreehandInputBatch> = {}) =>
        makeBatch({ pointerId, source, ...overrides });
      const session = startSession({ batch: batch() });
      expect(
        session.update({
          type: 'update',
          batch: batch({
            pointerId: -pointerId,
            batchSequence: 1,
            samples: [makeSample(2, 'move')],
          }),
        })
      ).toEqual({ ok: false, code: 'identity-mismatch' });
      expect(
        session.update({
          type: 'update',
          batch: batch({ batchSequence: 1, samples: [makeSample(2, 'move')] }),
        }).ok
      ).toBe(true);
      const ended = session.end({
        type: 'end',
        batch: batch({ batchSequence: 2, samples: [makeSample(3, 'up')] }),
      });
      expect(ended.ok).toBe(true);
      expect(session.getSnapshot()).toMatchObject({
        status: 'awaiting-commit',
        candidate: { pointerId },
      });
      const cancelled = startSession({ batch: batch() });
      expect(
        cancelled.cancel({
          type: 'cancel',
          sessionId: 'sess-1',
          pointerId,
          source,
          batchSequence: 1,
          reason: 'pointercancel',
        }).ok
      ).toBe(true);
      expect(cancelled.getSnapshot()).toMatchObject({ status: 'canceled', pointerId });
    }
  );

  it('update owner/session/pointer/source mismatch → identity-mismatch，state 不变', () => {
    const session = startSession();
    const before = session.getSnapshot();
    const mismatches: readonly Partial<FreehandInputBatch>[] = [
      { batchSequence: 1, sessionId: 'other', samples: [makeSample(2, 'move')] },
      { batchSequence: 1, pointerId: 999, samples: [makeSample(2, 'move')] },
      { batchSequence: 1, source: 'touch', samples: [makeSample(2, 'move')] },
    ];
    for (const overrides of mismatches) {
      const result = session.update({ type: 'update', batch: makeBatch(overrides) });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Test precondition failed: !result.ok');
      }
      {
        expect(result.code).toBe('identity-mismatch');
      }
    }
    expect(session.getSnapshot()).toEqual(before);
  });

  it('end owner mismatch → identity-mismatch，不进入 awaiting', () => {
    const session = startSession();
    const result = session.end({
      type: 'end',
      batch: makeBatch({ batchSequence: 1, pointerId: 999, samples: [makeSample(2, 'up')] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Test precondition failed: !result.ok');
    }
    {
      expect(result.code).toBe('identity-mismatch');
    }
    expect(session.getSnapshot().status).toBe('collecting');
  });

  it('coordinateSpace 切换 / stale viewportRevision → 拒绝', () => {
    const session = startSession();

    const switched = session.update({
      type: 'update',
      batch: makeBatch({
        batchSequence: 1,
        coordinateSpace: 'world',
        samples: [makeSample(2, 'move')],
      }),
    });
    expect(switched.ok).toBe(false);
    if (switched.ok) {
      throw new Error('Test precondition failed: !switched.ok');
    }
    {
      expect(switched.code).toBe('coordinate-space-mismatch');
    }

    const stale = session.update({
      type: 'update',
      batch: makeBatch({ batchSequence: 1, viewportRevision: 2, samples: [makeSample(2, 'move')] }),
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) {
      throw new Error('Test precondition failed: !stale.ok');
    }
    {
      expect(stale.code).toBe('viewport-revision-mismatch');
    }
  });

  it('begin 非 begin 批次序号 / viewport revision 不匹配 → 拒绝', () => {
    const badSeq = beginFreehandSession(makeBegin({ batch: makeBatch({ batchSequence: 1 }) }));
    expect(badSeq.ok).toBe(false);
    if (badSeq.ok) {
      throw new Error('Test precondition failed: !badSeq.ok');
    }
    {
      expect(badSeq.code).toBe('batch-sequence-mismatch');
    }

    const badRevision = beginFreehandSession(
      makeBegin({ batch: makeBatch({ viewportRevision: 9 }) })
    );
    expect(badRevision.ok).toBe(false);
    if (badRevision.ok) {
      throw new Error('Test precondition failed: !badRevision.ok');
    }
    {
      expect(badRevision.code).toBe('viewport-revision-mismatch');
    }
  });
});

// ---------------------------------------------------------------------------
// D. batch / sample 序号与原子性
// ---------------------------------------------------------------------------

describe('freehandSession: 批次与样本序号原子性', () => {
  it('batchSequence 重复/gap/stale → batch-sequence-mismatch，整批不追加', () => {
    const session = startSession();
    const before = session.getSnapshot();
    for (const sequence of [0, 2, 5]) {
      const result = session.update({
        type: 'update',
        batch: makeBatch({ batchSequence: sequence, samples: [makeSample(2, 'move')] }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Test precondition failed: !result.ok');
      }
      {
        expect(result.code).toBe('batch-sequence-mismatch');
      }
    }
    expect(session.getSnapshot()).toEqual(before);
  });

  it('sample sequence gap/重复 → sample-sequence-mismatch，整批原子拒绝', () => {
    const session = startSession();
    for (const samples of [[makeSample(3, 'move')], [makeSample(1, 'move')]]) {
      const result = session.update({
        type: 'update',
        batch: makeBatch({ batchSequence: 1, samples }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Test precondition failed: !result.ok');
      }
      {
        expect(result.code).toBe('sample-sequence-mismatch');
      }
    }
    expect(collecting(session).nextSampleSequence).toBe(2);
  });

  it('后段样本 invalid → 整 batch 原子拒绝，可 retry 同 batchSequence', () => {
    const session = startSession();
    const badBatch = makeBatch({
      batchSequence: 1,
      samples: [makeSample(2, 'move'), { ...makeSample(3, 'move'), x: Number.NaN }],
    });
    const rejected = session.update({ type: 'update', batch: badBatch });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      throw new Error('Test precondition failed: !rejected.ok');
    }
    {
      expect(rejected.code).toBe('invalid-input');
    }
    // 原子：未部分追加，序号可重试。
    expect(collecting(session).nextBatchSequence).toBe(1);
    expect(collecting(session).samples.length).toBe(2);

    const retry = session.update({
      type: 'update',
      batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'move')] }),
    });
    expect(retry.ok).toBe(true);
    expect(collecting(session).samples.length).toBe(3);
  });

  it('update/end 相位规则不符 → phase-mismatch', () => {
    const session = startSession();

    const updateDown = session.update({
      type: 'update',
      batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'down')] }),
    });
    expect(updateDown.ok).toBe(false);
    if (updateDown.ok) {
      throw new Error('Test precondition failed: !updateDown.ok');
    }
    {
      expect(updateDown.code).toBe('phase-mismatch');
    }

    const endUpTwice = session.end({
      type: 'end',
      batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'up'), makeSample(3, 'up')] }),
    });
    expect(endUpTwice.ok).toBe(false);
    if (endUpTwice.ok) {
      throw new Error('Test precondition failed: !endUpTwice.ok');
    }
    {
      expect(endUpTwice.code).toBe('phase-mismatch');
    }
  });
});

// ---------------------------------------------------------------------------
// E. 样本保真与拒绝
// ---------------------------------------------------------------------------

describe('freehandSession: 样本保真', () => {
  it('同 xy/time 不去重；zero/up=0/越界 pressure 原样；缺 pressure 不补字段', () => {
    const session = startSession({
      batch: makeBatch({
        samples: [
          { sequence: 0, x: 5, y: 5, pressure: 1.5, time: 100, phase: 'down' },
          { sequence: 1, x: 5, y: 5, pressure: 0, time: 100, phase: 'move' },
        ],
      }),
    });

    const update = session.update({
      type: 'update',
      batch: makeBatch({
        batchSequence: 1,
        samples: [
          { sequence: 2, x: 5, y: 5, time: 100, phase: 'move' }, // 缺 pressure
          { sequence: 3, x: 9, y: 9, pressure: 0, time: 140, phase: 'move' },
        ],
      }),
    });
    expect(update.ok).toBe(true);

    const end = session.end({
      type: 'end',
      batch: makeBatch({
        batchSequence: 2,
        samples: [{ sequence: 4, x: 9, y: 9, pressure: 0, time: 180, phase: 'up' }],
      }),
    });
    if (!end.ok || end.value.status !== 'awaiting-commit') {
      throw new Error('expected awaiting-commit');
    }
    const samples = end.value.candidate.samples;
    expect(samples.map((s) => s.pressure)).toEqual([1.5, 0, undefined, 0, 0]);
    expect(Object.prototype.hasOwnProperty.call(samples[2], 'pressure')).toBe(false);
    // 相同 xy/time 全部保留，未按距离/时间去重（screen 已反变换到 world）。
    const duplicateCount = samples.filter(
      (s) => s.x === samples[0].x && s.y === samples[0].y && s.time === 100
    ).length;
    expect(duplicateCount).toBe(3);
  });

  it('非有限坐标/time → invalid-input', () => {
    const cases: readonly FreehandSampleInput[] = [
      { ...makeSample(1, 'move'), x: Number.POSITIVE_INFINITY },
      { ...makeSample(1, 'move'), y: Number.NaN },
      { ...makeSample(1, 'move'), time: Number.NaN },
      { ...makeSample(1, 'move'), pressure: Number.POSITIVE_INFINITY },
    ];
    for (const bad of cases) {
      const result = beginFreehandSession(
        makeBegin({ batch: makeBatch({ samples: [makeSample(0, 'down'), bad] }) })
      );
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Test precondition failed: !result.ok');
      }
      {
        expect(result.code).toBe('invalid-input');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// F. 坐标空间与 viewport 冻结
// ---------------------------------------------------------------------------

describe('freehandSession: 坐标空间与 viewport', () => {
  it('screen + 非单位 viewport 反变换到 world；外部 viewport 变更不影响锁定转换', () => {
    const viewport = { scale: 2, tx: 10, ty: -5 }; // 普通对象，规范值
    const session = startSession({
      viewportSnapshot: { revision: 1, viewport },
      batch: makeBatch({
        samples: [{ sequence: 0, x: 10, y: -5, pressure: 0.5, time: 0, phase: 'down' }],
      }),
    });

    // begin 后外部原地修改 viewport。
    viewport.scale = 100;
    viewport.tx = 999;
    viewport.ty = 999;

    const snapshot = collecting(session);
    expect(snapshot.samples[0].x).toBeCloseTo(0, 10); // (10 - 10) / 2
    expect(snapshot.samples[0].y).toBeCloseTo(0, 10); // (-5 - -5) / 2
    expect(snapshot.lockedViewport).toEqual({ scale: 2, tx: 10, ty: -5 });
    expect(Object.isFrozen(snapshot.lockedViewport)).toBe(true);
  });

  it('world 空间坐标原样使用', () => {
    const session = startSession({
      batch: makeBatch({
        coordinateSpace: 'world',
        samples: [{ sequence: 0, x: 123.5, y: -77.25, pressure: 0.4, time: 5, phase: 'down' }],
      }),
    });
    const snapshot = collecting(session);
    expect(snapshot.samples[0].x).toBe(123.5);
    expect(snapshot.samples[0].y).toBe(-77.25);
  });

  it('screen 反变换溢出（极大有限 x / 小 scale）→ invalid-input', () => {
    const result = beginFreehandSession(
      makeBegin({
        viewportSnapshot: { revision: 1, viewport: { scale: 0.25, tx: 0, ty: 0 } },
        batch: makeBatch({
          samples: [
            { sequence: 0, x: Number.MAX_VALUE, y: 0, pressure: 0.5, time: 0, phase: 'down' },
          ],
        }),
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Test precondition failed: !result.ok');
    }
    {
      expect(result.code).toBe('invalid-input');
    }
  });
});

// ---------------------------------------------------------------------------
// G. cancel
// ---------------------------------------------------------------------------

describe('freehandSession: cancel', () => {
  it('四种 cancel 原因均进入 canceled 并保留 owner', () => {
    for (const reason of ['pointercancel', 'unmount', 'background', 'tool-change'] as const) {
      const session = startSession();
      const result = session.cancel({
        type: 'cancel',
        sessionId: 'sess-1',
        pointerId: 7,
        source: 'pen',
        batchSequence: 1,
        reason,
      });
      expect(result.ok).toBe(true);
      if (!(result.ok && result.value.status === 'canceled')) {
        throw new Error(
          "Test precondition failed: result.ok && result.value.status === 'canceled'"
        );
      }
      {
        expect(result.value.reason).toBe(reason);
        expect(result.value.sessionId).toBe('sess-1');
        expect(result.value.source).toBe('pen');
      }
    }
  });

  it('cancel 后 update/end 拒绝 not-collecting，late end 不回退', () => {
    const session = startSession();
    const canceled = session.cancel({
      type: 'cancel',
      sessionId: 'sess-1',
      pointerId: 7,
      source: 'pen',
      batchSequence: 1,
      reason: 'explicit',
    });
    expect(canceled.ok).toBe(true);

    const lateEnd = session.end({
      type: 'end',
      batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'up')] }),
    });
    expect(lateEnd.ok).toBe(false);
    if (lateEnd.ok) {
      throw new Error('Test precondition failed: !lateEnd.ok');
    }
    {
      expect(lateEnd.code).toBe('not-collecting');
    }

    const lateUpdate = session.update({
      type: 'update',
      batch: makeBatch({ batchSequence: 1, samples: [makeSample(2, 'move')] }),
    });
    expect(lateUpdate.ok).toBe(false);
    expect(session.getSnapshot().status).toBe('canceled');
  });

  it('cancel identity / batchSequence mismatch → 拒绝且 state 不变', () => {
    const session = startSession();

    const wrongIdentity = session.cancel({
      type: 'cancel',
      sessionId: 'other',
      pointerId: 7,
      source: 'pen',
      batchSequence: 1,
      reason: 'explicit',
    });
    expect(wrongIdentity.ok).toBe(false);
    if (wrongIdentity.ok) {
      throw new Error('Test precondition failed: !wrongIdentity.ok');
    }
    {
      expect(wrongIdentity.code).toBe('identity-mismatch');
    }

    const staleSequence = session.cancel({
      type: 'cancel',
      sessionId: 'sess-1',
      pointerId: 7,
      source: 'pen',
      batchSequence: 5,
      reason: 'explicit',
    });
    expect(staleSequence.ok).toBe(false);
    if (staleSequence.ok) {
      throw new Error('Test precondition failed: !staleSequence.ok');
    }
    {
      expect(staleSequence.code).toBe('batch-sequence-mismatch');
    }

    expect(session.getSnapshot().status).toBe('collecting');
  });
});

// ---------------------------------------------------------------------------
// H. commit 反馈生命周期
// ---------------------------------------------------------------------------

describe('freehandSession: commit 反馈', () => {
  it('awaiting 上 cancel 被拒绝并保留同一 candidate', () => {
    const { session, candidate } = endStroke();
    const result = session.cancel({
      type: 'cancel',
      sessionId: 'sess-1',
      pointerId: 7,
      source: 'pen',
      batchSequence: 2,
      reason: 'explicit',
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Test precondition failed: !result.ok');
    }
    {
      expect(result.code).toBe('not-collecting');
    }
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('awaiting-commit');
    if (!(snapshot.status === 'awaiting-commit')) {
      throw new Error("Test precondition failed: snapshot.status === 'awaiting-commit'");
    }
    {
      expect(snapshot.candidate).toBe(candidate);
    }
  });

  it('commit-failed 保留同 candidate/commitId，可再次提交成功', () => {
    const { session, candidate } = endStroke();

    const failed = session.applyCommitFeedback({ type: 'commit-failed', commitId: 'commit-1' });
    expect(failed.ok).toBe(true);
    if (!(failed.ok && failed.value.status === 'awaiting-commit')) {
      throw new Error(
        "Test precondition failed: failed.ok && failed.value.status === 'awaiting-commit'"
      );
    }
    {
      expect(failed.value.candidate).toBe(candidate);
      expect(failed.value.candidate.commitId).toBe('commit-1');
    }

    const success = session.applyCommitFeedback({
      type: 'commit-succeeded',
      commitId: 'commit-1',
      objectId: 'obj-9',
      documentRevision: 3,
    });
    expect(success.ok).toBe(true);
    if (!(success.ok && success.value.status === 'committed')) {
      throw new Error(
        "Test precondition failed: success.ok && success.value.status === 'committed'"
      );
    }
    {
      expect(success.value.objectId).toBe('obj-9');
      expect(success.value.documentRevision).toBe(3);
    }
  });

  it('错误 commitId → commit-id-mismatch，状态不变', () => {
    const { session } = endStroke();
    const result = session.applyCommitFeedback({ type: 'commit-failed', commitId: 'other' });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Test precondition failed: !result.ok');
    }
    {
      expect(result.code).toBe('commit-id-mismatch');
    }
    expect(session.getSnapshot().status).toBe('awaiting-commit');
  });

  it('success 后 late cancel / failed feedback 被拒绝且不回退', () => {
    const { session } = endStroke();
    const success = session.applyCommitFeedback({
      type: 'commit-succeeded',
      commitId: 'commit-1',
      objectId: 'obj-9',
      documentRevision: 3,
    });
    expect(success.ok).toBe(true);

    const lateCancel = session.cancel({
      type: 'cancel',
      sessionId: 'sess-1',
      pointerId: 7,
      source: 'pen',
      batchSequence: 2,
      reason: 'explicit',
    });
    expect(lateCancel.ok).toBe(false);
    if (lateCancel.ok) {
      throw new Error('Test precondition failed: !lateCancel.ok');
    }
    {
      expect(lateCancel.code).toBe('not-collecting');
    }

    const lateFailed = session.applyCommitFeedback({ type: 'commit-failed', commitId: 'commit-1' });
    expect(lateFailed.ok).toBe(false);
    if (lateFailed.ok) {
      throw new Error('Test precondition failed: !lateFailed.ok');
    }
    {
      expect(lateFailed.code).toBe('not-collecting');
    }

    expect(session.getSnapshot().status).toBe('committed');
  });

  it('未知 feedback type / 非法 objectId 反馈 → invalid-input', () => {
    const { session } = endStroke();

    const unknownType = session.applyCommitFeedback({
      type: 'weird',
      commitId: 'commit-1',
    } as unknown as Parameters<FreehandSession['applyCommitFeedback']>[0]);
    expect(unknownType.ok).toBe(false);
    if (unknownType.ok) {
      throw new Error('Test precondition failed: !unknownType.ok');
    }
    {
      expect(unknownType.code).toBe('invalid-input');
    }

    const badObjectId = session.applyCommitFeedback({
      type: 'commit-succeeded',
      commitId: 'commit-1',
      objectId: '',
      documentRevision: 1,
    });
    expect(badObjectId.ok).toBe(false);
    if (badObjectId.ok) {
      throw new Error('Test precondition failed: !badObjectId.ok');
    }
    {
      expect(badObjectId.code).toBe('invalid-input');
    }
    expect(session.getSnapshot().status).toBe('awaiting-commit');
  });
});

// ---------------------------------------------------------------------------
// I. 运行时 type/null guard（不信任 unknown JSON）
// ---------------------------------------------------------------------------

describe('freehandSession: 运行时 guard', () => {
  it('update/end/cancel null 或错误 type → invalid-input，不抛异常', () => {
    const session = startSession();

    const nullUpdate = session.update(null as unknown as FreehandSessionUpdate);
    expect(nullUpdate.ok).toBe(false);
    if (nullUpdate.ok) {
      throw new Error('Test precondition failed: !nullUpdate.ok');
    }
    {
      expect(nullUpdate.code).toBe('invalid-input');
    }

    const wrongUpdateType = session.update({
      type: 'end',
      batch: makeBatch({ batchSequence: 1 }),
    } as unknown as FreehandSessionUpdate);
    expect(wrongUpdateType.ok).toBe(false);
    if (wrongUpdateType.ok) {
      throw new Error('Test precondition failed: !wrongUpdateType.ok');
    }
    {
      expect(wrongUpdateType.code).toBe('invalid-input');
    }

    const nullEnd = session.end(undefined as unknown as FreehandSessionEnd);
    expect(nullEnd.ok).toBe(false);
    if (nullEnd.ok) {
      throw new Error('Test precondition failed: !nullEnd.ok');
    }
    {
      expect(nullEnd.code).toBe('invalid-input');
    }

    const nullCancel = session.cancel(null as unknown as FreehandSessionCancel);
    expect(nullCancel.ok).toBe(false);
    if (nullCancel.ok) {
      throw new Error('Test precondition failed: !nullCancel.ok');
    }
    {
      expect(nullCancel.code).toBe('invalid-input');
    }

    expect(session.getSnapshot().status).toBe('collecting');
  });

  it('begin null / 错误 type / 非规范 viewport → invalid-input', () => {
    expect(beginFreehandSession(null as unknown as BeginFreehandSessionInput).ok).toBe(false);
    expect(
      beginFreehandSession({ type: 'update' } as unknown as BeginFreehandSessionInput).ok
    ).toBe(false);

    const outOfRangeViewport = beginFreehandSession(
      makeBegin({ viewportSnapshot: { revision: 1, viewport: { scale: 100, tx: 0, ty: 0 } } })
    );
    expect(outOfRangeViewport.ok).toBe(false);
    if (outOfRangeViewport.ok) {
      throw new Error('Test precondition failed: !outOfRangeViewport.ok');
    }
    {
      expect(outOfRangeViewport.code).toBe('invalid-input');
    }
  });

  it('update/end batch 为 null → invalid-input', () => {
    const session = startSession();

    const nullBatchUpdate = session.update({
      type: 'update',
      batch: null,
    } as unknown as FreehandSessionUpdate);
    expect(nullBatchUpdate.ok).toBe(false);
    if (nullBatchUpdate.ok) {
      throw new Error('Test precondition failed: !nullBatchUpdate.ok');
    }
    {
      expect(nullBatchUpdate.code).toBe('invalid-input');
    }

    const nullBatchEnd = session.end({
      type: 'end',
      batch: undefined,
    } as unknown as FreehandSessionEnd);
    expect(nullBatchEnd.ok).toBe(false);
    if (nullBatchEnd.ok) {
      throw new Error('Test precondition failed: !nullBatchEnd.ok');
    }
    {
      expect(nullBatchEnd.code).toBe('invalid-input');
    }

    expect(session.getSnapshot().status).toBe('collecting');
  });
});

// ---------------------------------------------------------------------------
// J. 快照稳定性、冻结与 update 热路径
// ---------------------------------------------------------------------------

describe('freehandSession: 快照稳定性', () => {
  it('update 成功 value undefined；显式 getSnapshot 反映追加且旧快照稳定', () => {
    const session = startSession();
    const before = collecting(session);

    const result = session.update({
      type: 'update',
      batch: makeBatch({
        batchSequence: 1,
        samples: [makeSample(2, 'move'), makeSample(3, 'move')],
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Test precondition failed: result.ok');
    }
    {
      expect(result.value).toBeUndefined();
    }

    const after = collecting(session);
    expect(after.samples.length).toBe(4);
    expect(after.nextBatchSequence).toBe(2);
    expect(after.nextSampleSequence).toBe(4);

    // 旧快照不被后续追加修改，且已冻结。
    expect(before.samples.length).toBe(2);
    expect(before.nextBatchSequence).toBe(1);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.samples)).toBe(true);
    expect(Object.isFrozen(after.samples[3])).toBe(true);
  });

  it('end candidate 与样本深冻结；committed 快照冻结', () => {
    const { session, candidate } = endStroke();
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.samples)).toBe(true);
    expect(candidate.samples.every((sample) => Object.isFrozen(sample))).toBe(true);
    expect(Object.isFrozen(candidate.brushSnapshot)).toBe(true);

    const success = session.applyCommitFeedback({
      type: 'commit-succeeded',
      commitId: 'commit-1',
      objectId: 'obj-9',
      documentRevision: 3,
    });
    expect(success.ok).toBe(true);
    if (!success.ok) {
      throw new Error('Test precondition failed: success.ok');
    }
    {
      expect(Object.isFrozen(success.value)).toBe(true);
    }
    // 已提交快照的 candidate 仍为同一冻结候选。
    const snapshot = session.getSnapshot();
    if (!(snapshot.status === 'committed')) {
      throw new Error("Test precondition failed: snapshot.status === 'committed'");
    }
    {
      expect(snapshot.candidate).toBe(candidate);
    }
  });
});
