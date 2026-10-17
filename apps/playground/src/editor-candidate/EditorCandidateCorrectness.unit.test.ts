/// <reference types="jest" />
/**
 * EditorCandidateCorrectness 的聚焦单元测试（纯逻辑，无 DOM/React）。
 *
 * 覆盖四类最易漂移的契约：
 *  1. 页面生成的 100k 实际文档严格 canonical 前缀 SHA-256 必须命中 oracle golden 字面量；
 *  2. 未知 own keys / 非有限值 / 笔数不足必须 fail closed；
 *  3. 100k 前缀 FNV 弱信号（历史 fnv1a-294ac97d）与整份文档 checksum 严格分离；
 *  4. session / ruler 投影在真实 controller 形状上确定，未知形状抛错。
 */
import type { DrawingPointV2, DrawingStrokeV2, DrawingValueV2 } from '@hamster-note/painting/core';
import { createEditorPerformanceWorkload, checksumPerformanceDocument } from './EditorCandidatePerformance.web';
import {
  computeEditorCorrectnessPrefixCoordinateSignal,
  computeEditorCorrectnessPrefixDigest,
  computeEditorCorrectnessWholeDocumentChecksum,
  canonicalizeEditorCorrectnessPoint,
  canonicalizeEditorCorrectnessStroke,
  editorCorrectnessPrefixDigestMatches,
  projectEditorCorrectnessRuler,
  projectEditorCorrectnessSession,
  serializeEditorCorrectnessPrefixDocument,
  EDITOR_CORRECTNESS_INITIAL_RULER,
  EDITOR_CORRECTNESS_PREFIX_COORDINATE_SIGNAL_PROVENANCE,
  EDITOR_CORRECTNESS_PREFIX_DIGEST_SCHEMA,
  EDITOR_CORRECTNESS_RULER_HEIGHT,
} from './EditorCandidateCorrectness.web';

/** oracle 独立重算的 100k 全字段 golden digest；任何生成/编码/算法漂移都会使它失配。 */
const WORKLOAD_PREFIX_GOLDEN_DIGEST =
  '766520c6a26a2b3386b0fdb3679700cdefd3a29c5669b7aaa48fa851b0ff85b1';

/** 页面生成的真实 100k workload（只用一次，测试内不重建 seeded 算法）。 */
const workload = createEditorPerformanceWorkload();

const baselineDigestPromise = computeEditorCorrectnessPrefixDigest(workload);

/** 以真实 workload 为基础，替换第一笔后返回新的 document 对象（浅拷贝，不深克隆 100k）。 */
function withMutatedFirstStroke(mutate: (stroke: DrawingStrokeV2) => DrawingStrokeV2): DrawingValueV2 {
  const strokes = workload.strokes.slice();
  strokes[0] = mutate(strokes[0]);
  return { schemaVersion: workload.schemaVersion, strokes };
}

/** 追加一笔“候选”笔迹，构成 100001 笔的实际 post-run 文档。 */
function withAppendedCandidateStroke(): DrawingValueV2 {
  const candidate: DrawingStrokeV2 = {
    schemaVersion: 2,
    id: 'candidate-stroke-1',
    tool: 'pen',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    strokeColor: '#172033',
    strokeWidth: 3,
  };
  return { schemaVersion: 2, strokes: [...workload.strokes, candidate] };
}

describe('strict canonical prefix encoding', () => {
  it('point 的 x/y 必填，pressure 可选且进入 canonical', () => {
    expect(canonicalizeEditorCorrectnessPoint({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(canonicalizeEditorCorrectnessPoint({ x: 1, y: 2, pressure: 0.5 })).toEqual([1, 2, 0.5]);
  });

  it('stroke tuple 顺序固定为 id/tool/schemaVersion/strokeColor/strokeWidth/points', () => {
    expect(canonicalizeEditorCorrectnessStroke(workload.strokes[0])).toEqual([
      workload.strokes[0].id,
      'pen',
      2,
      '#172033',
      1.5,
      [
        [workload.strokes[0].points[0].x, workload.strokes[0].points[0].y],
        [workload.strokes[0].points[1].x, workload.strokes[0].points[1].y],
      ],
    ]);
  });

  it('document 出现未知 own key 时拒绝', () => {
    const malformed = { schemaVersion: 2, strokes: workload.strokes, extra: true };
    expect(() =>
      serializeEditorCorrectnessPrefixDocument(malformed as unknown as DrawingValueV2)
    ).toThrow(/unexpected own key "extra"/);
  });

  it('stroke 出现未知 own key 时拒绝', () => {
    const malformed = {
      ...workload.strokes[0],
      extra: 1,
    };
    expect(() => canonicalizeEditorCorrectnessStroke(malformed)).toThrow(
      /unexpected own key "extra"/
    );
  });

  it('point 出现未知 own key 时拒绝', () => {
    expect(() => canonicalizeEditorCorrectnessPoint({ x: 0, y: 0, z: 1 })).toThrow(
      /unexpected own key "z"/
    );
  });

  it('缺失 point.pressure 之外的未知键或非有限值都拒绝', () => {
    expect(() => canonicalizeEditorCorrectnessPoint({ x: 0, y: 0, pressure: Number.NaN })).toThrow(
      /pressure must be a finite number/
    );
    expect(() => canonicalizeEditorCorrectnessPoint({ x: Number.POSITIVE_INFINITY, y: 0 })).toThrow(
      /x must be a finite number/
    );
  });

  it('实际笔数少于前缀长度时拒绝', () => {
    const shortDocument: DrawingValueV2 = {
      schemaVersion: 2,
      strokes: workload.strokes.slice(0, 99_999),
    };
    expect(() => serializeEditorCorrectnessPrefixDocument(shortDocument)).toThrow(/requires 100000/);
  });
});

describe('page-generated 100k prefix SHA-256', () => {
  it('命中 oracle golden digest 且字段同构', async () => {
    await expect(baselineDigestPromise).resolves.toEqual({
      algorithm: 'SHA-256',
      schema: EDITOR_CORRECTNESS_PREFIX_DIGEST_SCHEMA,
      strokeCount: 100_000,
      digest: WORKLOAD_PREFIX_GOLDEN_DIGEST,
    });
  });

  it('prefixDigestMatches 严格核对四个字段', async () => {
    const digest = await baselineDigestPromise;
    expect(editorCorrectnessPrefixDigestMatches(digest, digest)).toBe(true);
    expect(
      editorCorrectnessPrefixDigestMatches({ ...digest, digest: 'deadbeef' }, digest)
    ).toBe(false);
    expect(editorCorrectnessPrefixDigestMatches(null, digest)).toBe(false);
  });

  it('追加第 100001 笔不改变 100k 前缀 digest', async () => {
    const appended = withAppendedCandidateStroke();
    const digest = await computeEditorCorrectnessPrefixDigest(appended);
    expect(digest.strokeCount).toBe(100_000);
    expect(digest.digest).toBe(WORKLOAD_PREFIX_GOLDEN_DIGEST);
  });

  it('style / point / schemaVersion 漂移都会改变 digest', async () => {
    const widened = await computeEditorCorrectnessPrefixDigest(
      withMutatedFirstStroke((stroke) => ({ ...stroke, strokeWidth: 2 }))
    );
    expect(widened.digest).not.toBe(WORKLOAD_PREFIX_GOLDEN_DIGEST);

    const recolored = await computeEditorCorrectnessPrefixDigest(
      withMutatedFirstStroke((stroke) => ({ ...stroke, strokeColor: '#000000' }))
    );
    expect(recolored.digest).not.toBe(WORKLOAD_PREFIX_GOLDEN_DIGEST);

    const retagged = await computeEditorCorrectnessPrefixDigest(
      withMutatedFirstStroke((stroke) => ({ ...stroke, schemaVersion: 3 as 2 }))
    );
    expect(retagged.digest).not.toBe(WORKLOAD_PREFIX_GOLDEN_DIGEST);

    const moved = await computeEditorCorrectnessPrefixDigest(
      withMutatedFirstStroke((stroke) => ({
        ...stroke,
        points: [{ ...stroke.points[0], x: stroke.points[0].x + 1 }, stroke.points[1]],
      }))
    );
    expect(moved.digest).not.toBe(WORKLOAD_PREFIX_GOLDEN_DIGEST);
  });

  it('给 point 增加 pressure 会改变 digest（无 pressure 是 golden 形状）', async () => {
    const strokes = workload.strokes.slice();
    strokes[0] = {
      ...strokes[0],
      points: strokes[0].points.map(
        (point): DrawingPointV2 => ({ ...point, pressure: 0.5 })
      ),
    };
    const digest = await computeEditorCorrectnessPrefixDigest({ schemaVersion: 2, strokes });
    expect(digest.digest).not.toBe(WORKLOAD_PREFIX_GOLDEN_DIGEST);
  });
});

describe('FNV weak signals (prefix vs whole document)', () => {
  it('100k 前缀信号命中历史溯源常量 fnv1a-294ac97d', () => {
    expect(computeEditorCorrectnessPrefixCoordinateSignal(workload)).toBe(
      EDITOR_CORRECTNESS_PREFIX_COORDINATE_SIGNAL_PROVENANCE
    );
  });

  it('整份文档 checksum 与既有 checksumPerformanceDocument 逐字一致', () => {
    expect(computeEditorCorrectnessWholeDocumentChecksum(workload)).toBe(
      checksumPerformanceDocument(workload)
    );
  });

  it('前缀信号与整份文档 checksum 严格分离：只有整份 checksum 受最后一笔影响', () => {
    const appended = withAppendedCandidateStroke();
    const prefixSignal = computeEditorCorrectnessPrefixCoordinateSignal(appended);
    const wholeChecksum = computeEditorCorrectnessWholeDocumentChecksum(appended);
    expect(prefixSignal).toBe(EDITOR_CORRECTNESS_PREFIX_COORDINATE_SIGNAL_PROVENANCE);
    expect(wholeChecksum).not.toBe(prefixSignal);
    // 追加最后一笔后整份 checksum 必须相对 clean workload 改变。
    expect(wholeChecksum).not.toBe(computeEditorCorrectnessWholeDocumentChecksum(workload));
  });
});

describe('projectEditorCorrectnessSession', () => {
  it('idle pen 且无候选时投影为空会话', () => {
    expect(
      projectEditorCorrectnessSession({
        tool: 'pen',
        toolSession: { kind: 'continuous', tool: 'pen', status: 'idle', points: [] },
        strokeCandidate: undefined,
        interaction: { activeGesture: undefined },
      })
    ).toEqual({
      tool: 'pen',
      status: 'idle',
      pointCount: 0,
      hasCandidate: false,
      gestureActive: false,
    });
  });

  it('active 会话统计点数且不误报候选', () => {
    expect(
      projectEditorCorrectnessSession({
        tool: 'pen',
        toolSession: {
          kind: 'continuous',
          tool: 'pen',
          status: 'active',
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
        interaction: {},
      })
    ).toEqual({
      tool: 'pen',
      status: 'active',
      pointCount: 2,
      hasCandidate: false,
      gestureActive: false,
    });
  });

  it('finished 会话存在 strokeCandidate 时 hasCandidate=true', () => {
    const projection = projectEditorCorrectnessSession({
      tool: 'pen',
      toolSession: {
        kind: 'continuous',
        tool: 'pen',
        status: 'finished',
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
      strokeCandidate: { schemaVersion: 2, tool: 'pen', points: [] },
      interaction: {},
    });
    expect(projection.hasCandidate).toBe(true);
    expect(projection.status).toBe('finished');
    expect(projection.pointCount).toBe(2);
  });

  it('toolSession 缺失但干净时视为 idle；缺失却带候选或 activeGesture 时 fail closed', () => {
    expect(projectEditorCorrectnessSession({ tool: 'pen', interaction: {} })).toEqual({
      tool: 'pen',
      status: 'idle',
      pointCount: 0,
      hasCandidate: false,
      gestureActive: false,
    });
    expect(() =>
      projectEditorCorrectnessSession({
        tool: 'pen',
        strokeCandidate: { schemaVersion: 2, tool: 'pen', points: [] },
        interaction: {},
      })
    ).toThrow(/strokeCandidate without toolSession/);
    expect(() =>
      projectEditorCorrectnessSession({
        tool: 'pen',
        interaction: { activeGesture: { id: 'gesture-1' } },
      })
    ).toThrow(/activeGesture without toolSession/);
  });

  it('区分 activeGesture 与候选：idle 会话 + 活动手势只报告 gestureActive', () => {
    expect(
      projectEditorCorrectnessSession({
        tool: 'pen',
        toolSession: { kind: 'continuous', tool: 'pen', status: 'idle', points: [] },
        interaction: { activeGesture: { id: 'gesture-1' } },
      })
    ).toEqual({
      tool: 'pen',
      status: 'idle',
      pointCount: 0,
      hasCandidate: false,
      gestureActive: true,
    });
  });

  it('未知 status / 候选与状态不一致 / 非对象 controller 均抛错', () => {
    expect(() =>
      projectEditorCorrectnessSession({
        tool: 'pen',
        toolSession: { tool: 'pen', status: 'bogus', points: [] },
      })
    ).toThrow(/status is not recognized/);
    expect(() =>
      projectEditorCorrectnessSession({
        tool: 'pen',
        toolSession: { tool: 'pen', status: 'active', points: [{ x: 0, y: 0 }] },
        strokeCandidate: { schemaVersion: 2, tool: 'pen', points: [] },
      })
    ).toThrow(/strokeCandidate while toolSession.status is active/);
    expect(() => projectEditorCorrectnessSession(null)).toThrow(/plain object/);
  });
});

describe('projectEditorCorrectnessRuler', () => {
  it('默认投影为 oracle 的 INITIAL_EDITOR_RULER_RECT', () => {
    expect(projectEditorCorrectnessRuler()).toEqual(EDITOR_CORRECTNESS_INITIAL_RULER);
    expect(projectEditorCorrectnessRuler().height).toBe(EDITOR_CORRECTNESS_RULER_HEIGHT);
  });

  it('从实际 center/rotationRad 投影，length 恒为 0', () => {
    expect(
      projectEditorCorrectnessRuler({ center: { x: 10, y: 20 }, rotationRad: 0.5 })
    ).toEqual({ center: { x: 10, y: 20 }, rotationRad: 0.5, height: 42, length: 0 });
  });

  it('非有限值或非正高度 fail closed', () => {
    expect(() =>
      projectEditorCorrectnessRuler({ center: { x: Number.NaN, y: 0 }, rotationRad: 0 })
    ).toThrow(/center\.x must be a finite number/);
    expect(() => projectEditorCorrectnessRuler(EDITOR_CORRECTNESS_INITIAL_RULER, 0)).toThrow(
      /height must be a finite positive number/
    );
  });
});
