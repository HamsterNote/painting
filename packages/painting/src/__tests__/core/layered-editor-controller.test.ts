/** @jest-environment node */

/**
 * Task 3.1 / 4.4 集成测试：`core/layeredEditorController.ts`。
 *
 * 行为契约（真实 controller → session → PF 派生 → commit 集成）：
 * - 真实 session/PF cache 组合，不 mock 控制器骨架；`update` 热路径不主动复制快照。
 * - commitId 幂等 / payload 冲突 / 失败保 candidate 可 retry / undo-branch tombstone 不释放。
 * - 频道快照按冻结类型读取；所有命令经 Result 解包，`getPresentationIdentity` 不读裸 identity。
 * - 本文件独立于 doc/tasks；断言以实际运行行为为准。
 */

import * as sessionModule from '../../core/freehandSession';
import { type FreehandCandidate, type FreehandSampleInput } from '../../core/freehandSession';
import {
  createLayeredEditorController,
  type LayeredBeginInput,
  type LayeredCommitReceipt,
  type LayeredEditorController,
  type LayeredEditorControllerOptions,
  type LayeredEditorResult,
} from '../../core/layeredEditorController';
import {
  IDENTITY_TRANSFORM,
  type BrushSnapshot,
  type DocumentObject,
  type EditorDocument,
  type FreehandObject,
  type ImageObject,
  type ShapeObject,
  type ShapeStyle,
  type TextObject,
} from '../../model/document';
import type { DrawingViewport } from '../../viewport';

/** 冻结契约的 Result 别名。 */
type AnyResult<T> = LayeredEditorResult<T>;

/** 解包 Result；失败抛出便于定位。 */
function unwrap<T>(result: AnyResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const VIEWPORT: DrawingViewport = { scale: 2, tx: 10, ty: -5 };

function makeBrush(overrides: Partial<BrushSnapshot> = {}): BrushSnapshot {
  return {
    color: '#123456',
    nominalSize: 8,
    opacity: 1,
    pressureMode: 'real',
    presetRevision: 1,
    ...overrides,
  };
}

function makeShapeStyle(overrides: Partial<ShapeStyle> = {}): ShapeStyle {
  return { color: '#000000', width: 2, opacity: 1, dash: [4, 2], ...overrides };
}

function makeSamples(): FreehandObject['samples'] {
  // 已冻结完整 committed raw：down → move → up。
  return [
    { sequence: 0, x: 0, y: 0, pressure: 0.5, time: 0, phase: 'down', source: 'pen' },
    { sequence: 1, x: 4, y: 3, pressure: 0.6, time: 16, phase: 'move', source: 'pen' },
    { sequence: 2, x: 8, y: 6, pressure: 0.4, time: 32, phase: 'up', source: 'pen' },
  ];
}

function makeFreehand(overrides: Partial<FreehandObject> = {}): FreehandObject {
  return {
    kind: 'freehand',
    objectId: 'seed-1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    commitId: 'seed-commit',
    samples: makeSamples(),
    brushSnapshot: makeBrush(),
    resolvedPressureMode: 'real',
    samplesRevision: 1,
    brushRevision: 1,
    ...overrides,
  };
}

function makeDocument(objects: readonly DocumentObject[] = []): EditorDocument {
  return { schemaVersion: 3, documentRevision: 1, objects };
}

function baseOptions(
  overrides: Partial<LayeredEditorControllerOptions> = {}
): LayeredEditorControllerOptions {
  return {
    document: makeDocument(),
    viewport: { revision: 1, viewport: VIEWPORT },
    activeTool: 'freehand',
    settings: { freehand: makeBrush(), shape: makeShapeStyle() },
    allocateObjectId: (commitId: string) => `obj-${commitId}`,
    ...overrides,
  };
}

function tryCreate(overrides: Partial<LayeredEditorControllerOptions> = {}) {
  return createLayeredEditorController(
    baseOptions(overrides)
  ) as AnyResult<LayeredEditorController>;
}

function createController(
  overrides: Partial<LayeredEditorControllerOptions> = {}
): LayeredEditorController {
  return unwrap(tryCreate(overrides));
}

function sampleInput(
  sequence: number,
  phase: 'down' | 'move' | 'up',
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

function beginInput(
  commitId: string,
  samples: readonly FreehandSampleInput[] = [sampleInput(0, 'down'), sampleInput(1, 'move')]
): LayeredBeginInput {
  return {
    type: 'begin',
    commitId,
    pressureCapability: 'available',
    batch: {
      sessionId: `sess-${commitId}`,
      pointerId: 1,
      source: 'pen',
      batchSequence: 0,
      coordinateSpace: 'world',
      viewportRevision: 1,
      samples,
    },
  };
}

function batchLike(
  begin: LayeredBeginInput,
  batchSequence: number,
  samples: readonly FreehandSampleInput[]
) {
  return { ...begin.batch, batchSequence, samples };
}

/** 走完 begin → update → end，返回 candidate。 */
function drawStroke(
  controller: LayeredEditorController,
  commitId: string,
  options: { update?: boolean } = {}
): FreehandCandidate {
  const begin = beginInput(commitId);
  unwrap(controller.beginFreehand(begin) as AnyResult<void>);
  if (options.update !== false) {
    unwrap(
      controller.updateFreehand({
        type: 'update',
        batch: batchLike(begin, 1, [sampleInput(2, 'move')]),
      }) as AnyResult<void>
    );
  }
  const endBatch = batchLike(begin, options.update === false ? 1 : 2, [
    sampleInput(options.update === false ? 2 : 3, 'up'),
  ]);
  return unwrap(
    controller.endFreehand({ type: 'end', batch: endBatch }) as AnyResult<FreehandCandidate>
  );
}

/** 当前文档中 freehand 对象的 commitId 顺序。 */
function commitIds(controller: LayeredEditorController): readonly string[] {
  return controller
    .getSnapshot('document')
    .objects.filter((object): object is FreehandObject => object.kind === 'freehand')
    .map((object) => object.commitId);
}

/** 订阅计数读取器。 */
function track(
  controller: LayeredEditorController,
  channel: Parameters<LayeredEditorController['subscribe']>[0]
): () => number {
  let count = 0;
  controller.subscribe(channel, () => {
    count += 1;
  });
  return () => count;
}

// ---------------------------------------------------------------------------
// A. factory / document 拷贝冻结 / 基础校验
// ---------------------------------------------------------------------------

describe('layeredEditorController: factory 与 document', () => {
  it('创建成功；document channel 深拷贝冻结，外部原 document 变异隔离', () => {
    const original = makeDocument([makeFreehand()]);
    const controller = createController({ document: original });

    const snapshot = controller.getSnapshot('document');
    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.objects).toHaveLength(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).not.toBe(original);

    (original as unknown as { objects: readonly DocumentObject[] }).objects = [];
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('非法 schemaVersion / 重复 objectId → invalid-document', () => {
    const badSchema = tryCreate({
      document: { ...makeDocument(), schemaVersion: 2 } as unknown as EditorDocument,
    });
    expect(badSchema.ok).toBe(false);
    if (badSchema.ok) {
      throw new Error('Test precondition failed: !badSchema.ok');
    }
    {
      expect(badSchema.error.code).toBe('invalid-document');
    }

    const dup = tryCreate({
      document: makeDocument([
        makeFreehand({ objectId: 'dup' }),
        makeFreehand({ objectId: 'dup' }),
      ]),
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) {
      throw new Error('Test precondition failed: !dup.ok');
    }
    {
      expect(dup.error.code).toBe('invalid-document');
    }
  });

  it('非法 viewport（revision 非法 / scale 越界 / 非有限）→ 拒绝', () => {
    for (const viewport of [
      { revision: -1, viewport: VIEWPORT },
      { revision: 1, viewport: { scale: 0, tx: 0, ty: 0 } },
      { revision: 1, viewport: { scale: 100, tx: 0, ty: 0 } },
      { revision: 1, viewport: { scale: 1, tx: Number.NaN, ty: 0 } },
    ]) {
      const result = tryCreate({ viewport });
      expect(result.ok).toBe(false);
    }
  });

  it('order 保留，新 freehand commit 后追加尾部', () => {
    const controller = createController({
      document: makeDocument([
        makeFreehand({ objectId: 'a', commitId: 'commit-a' }),
        makeFreehand({ objectId: 'b', commitId: 'commit-b' }),
      ]),
    });
    drawStroke(controller, 'c1');
    unwrap(controller.commitFreehand('c1') as AnyResult<LayeredCommitReceipt>);

    expect(controller.getSnapshot('document').objects.map((object) => object.objectId)).toEqual([
      'a',
      'b',
      'obj-c1',
    ]);
  });

  it('初始 freehand 播种 registry：同 payload 提交为 duplicate，不新增 undo', () => {
    const controller = createController({ document: makeDocument([makeFreehand()]) });
    const before = controller.getSnapshot('document').documentRevision;

    const receipt = unwrap(
      controller.commitFreehand('seed-commit') as AnyResult<LayeredCommitReceipt>
    );
    expect(receipt.status).toBe('duplicate');
    expect(controller.getSnapshot('document').documentRevision).toBe(before);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. 完整笔迹 → commit
// ---------------------------------------------------------------------------

describe('layeredEditorController: 笔迹与提交', () => {
  it('begin/update/end/commit：receipt created，objectId 来自 allocator，revision+1，四 identity 字段', () => {
    const controller = createController();
    const candidate = drawStroke(controller, 'c1');
    expect(candidate.commitId).toBe('c1');

    const receipt = unwrap(controller.commitFreehand('c1') as AnyResult<LayeredCommitReceipt>);
    expect(receipt.status).toBe('created');
    expect(receipt.objectId).toBe('obj-c1');
    expect(receipt.commitId).toBe('c1');
    expect(receipt.presentInDocument).toBe(true);
    expect(receipt.presentationIdentity).not.toBeNull();
    if (!receipt.presentationIdentity) {
      throw new Error('Test precondition failed: receipt.presentationIdentity');
    }
    {
      expect(Object.keys(receipt.presentationIdentity).sort()).toEqual([
        'commitId',
        'documentRevision',
        'geometryRevision',
        'objectId',
      ]);
      expect(receipt.presentationIdentity.objectId).toBe('obj-c1');
      expect(receipt.presentationIdentity.commitId).toBe('c1');
      expect(receipt.presentationIdentity.documentRevision).toBe(receipt.documentRevision);
      expect(typeof receipt.presentationIdentity.geometryRevision).toBe('string');
    }

    const document = controller.getSnapshot('document');
    expect(document.objects.find((object) => object.objectId === 'obj-c1')?.kind).toBe('freehand');
    expect(document.documentRevision).toBe(receipt.documentRevision);
  });

  it('end candidate 保留 raw（up=0 / 缺 pressure），commit 后对象冻结且派生不入 document', () => {
    const controller = createController();
    const begin = beginInput('c-raw', [
      { sequence: 0, x: 5, y: 5, pressure: 0.7, time: 0, phase: 'down' },
      { sequence: 1, x: 9, y: 9, time: 10, phase: 'move' }, // 缺 pressure
    ]);
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    const candidate = unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(begin, 1, [
          { sequence: 2, x: 9, y: 9, pressure: 0, time: 20, phase: 'up' },
        ]),
      }) as AnyResult<FreehandCandidate>
    );
    expect(candidate.samples.map((sample) => sample.pressure)).toEqual([0.7, undefined, 0]);
    expect(Object.prototype.hasOwnProperty.call(candidate.samples[1], 'pressure')).toBe(false);

    unwrap(controller.commitFreehand('c-raw') as AnyResult<LayeredCommitReceipt>);
    const committed = controller
      .getSnapshot('document')
      .objects.find((object) => object.objectId === 'obj-c-raw');
    if (!(committed?.kind === 'freehand')) {
      throw new Error("Test precondition failed: committed?.kind === 'freehand'");
    }
    {
      expect(committed.samples.map((sample) => sample.pressure)).toEqual([0.7, undefined, 0]);
      expect(Object.isFrozen(committed)).toBe(true);
      expect(Object.isFrozen(committed.samples)).toBe(true);
    }
    const json = JSON.stringify(controller.getSnapshot('document'));
    expect(json).not.toContain('polygon');
    expect(json).not.toContain('commands');
    expect(json).not.toContain('geometryRevision');
  });

  it('四 revision 初始为 1；getPresentationIdentity 与 receipt 一致', () => {
    const controller = createController();
    drawStroke(controller, 'c-rev');
    const receipt = unwrap(controller.commitFreehand('c-rev') as AnyResult<LayeredCommitReceipt>);
    const committed = controller
      .getSnapshot('document')
      .objects.find((object) => object.objectId === 'obj-c-rev');
    if (!(committed?.kind === 'freehand')) {
      throw new Error("Test precondition failed: committed?.kind === 'freehand'");
    }
    {
      expect(committed.objectRevision).toBe(1);
      expect(committed.samplesRevision).toBe(1);
      expect(committed.brushRevision).toBe(1);
      expect(committed.transformRevision).toBe(1);
    }
    const identity = unwrap(controller.getPresentationIdentity('c-rev'));
    expect(identity).not.toBeNull();
    expect(identity?.objectId).toBe('obj-c-rev');
    expect(identity?.geometryRevision).toBe(receipt.presentationIdentity?.geometryRevision);
  });

  it('end 的 candidate 不进入 document/history；未 commit 时 identity 为 null', () => {
    const controller = createController();
    const before = controller.getSnapshot('document');
    drawStroke(controller, 'c-pending');

    expect(controller.getSnapshot('document')).toEqual(before);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    expect(unwrap(controller.getPresentationIdentity('c-pending'))).toBeNull();
  });

  it('同 commitId 同 payload（不同 session/pointer）→ duplicate，不增对象/revision/通知', () => {
    const controller = createController();
    const historyNotify = track(controller, 'history');
    const documentNotify = track(controller, 'document');

    drawStroke(controller, 'dup');
    const first = unwrap(controller.commitFreehand('dup') as AnyResult<LayeredCommitReceipt>);
    expect(first.status).toBe('created');
    const revisionAfterFirst = controller.getSnapshot('document').documentRevision;
    const historyAfterFirst = historyNotify();
    expect(documentNotify()).toBe(1); // 仅 created 提交通知一次

    const begin = beginInput('dup');
    const differentOwner = {
      ...begin,
      batch: { ...begin.batch, sessionId: 'sess-other', pointerId: 99 },
    };
    unwrap(controller.beginFreehand(differentOwner) as AnyResult<void>);
    // 复制首次 payload（相同 samples/phase），仅 owner 不同。
    unwrap(
      controller.updateFreehand({
        type: 'update',
        batch: { ...differentOwner.batch, batchSequence: 1, samples: [sampleInput(2, 'move')] },
      }) as AnyResult<void>
    );
    unwrap(
      controller.endFreehand({
        type: 'end',
        batch: { ...differentOwner.batch, batchSequence: 2, samples: [sampleInput(3, 'up')] },
      }) as AnyResult<FreehandCandidate>
    );

    const second = unwrap(controller.commitFreehand('dup') as AnyResult<LayeredCommitReceipt>);
    expect(second.status).toBe('duplicate');
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    expect(controller.getSnapshot('document').documentRevision).toBe(revisionAfterFirst);
    expect(historyNotify()).toBe(historyAfterFirst);
    expect(documentNotify()).toBe(1); // duplicate 不再通知 document
  });
});

// ---------------------------------------------------------------------------
// C. 设置隔离
// ---------------------------------------------------------------------------

describe('layeredEditorController: 设置隔离', () => {
  it('收集期间改 brush：本笔用旧快照，下笔用新设置', () => {
    const controller = createController();
    const begin = beginInput('b1');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);

    unwrap(
      controller.setFreehandSettings(
        makeBrush({ color: '#ffffff', nominalSize: 20 })
      ) as AnyResult<void>
    );

    const candidate = unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(begin, 1, [
          { sequence: 2, x: 9, y: 9, pressure: 0, time: 32, phase: 'up' },
        ]),
      }) as AnyResult<FreehandCandidate>
    );
    expect(candidate.brushSnapshot.color).toBe('#123456');
    expect(candidate.brushSnapshot.nominalSize).toBe(8);

    const nextBegin = beginInput('b2');
    unwrap(controller.beginFreehand(nextBegin) as AnyResult<void>);
    const nextCandidate = unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(nextBegin, 1, [
          { sequence: 2, x: 9, y: 9, pressure: 0, time: 32, phase: 'up' },
        ]),
      }) as AnyResult<FreehandCandidate>
    );
    expect(nextCandidate.brushSnapshot.color).toBe('#ffffff');
    expect(nextCandidate.brushSnapshot.nominalSize).toBe(20);
  });

  it('shape dash 与 freehand 设置相互独立', () => {
    const controller = createController();
    unwrap(
      controller.setShapeSettings(makeShapeStyle({ dash: [1, 1], width: 5 })) as AnyResult<void>
    );
    unwrap(controller.setFreehandSettings(makeBrush({ nominalSize: 3 })) as AnyResult<void>);

    const tools = controller.getSnapshot('tools');
    expect(tools.settings.freehand.nominalSize).toBe(3);
    expect(tools.settings.shape.dash).toEqual([1, 1]);
    expect(Object.prototype.hasOwnProperty.call(tools.settings.freehand, 'dash')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. update 热路径与 interaction
// ---------------------------------------------------------------------------

describe('layeredEditorController: update 热路径', () => {
  it('update 只触发 interaction 通知，不改 document/history，也不主动取 session 快照', () => {
    let getSnapshotCalls = 0;
    const real = jest.requireActual<typeof sessionModule>('../../core/freehandSession');
    // 先捕获真实 factory，避免 mock 与 requireActual 同对象造成递归。
    const originalBegin = real.beginFreehandSession;
    const spy = jest.spyOn(sessionModule, 'beginFreehandSession').mockImplementation((input) => {
      const result = originalBegin(input as never);
      if (!result.ok) {
        return result;
      }
      const session = result.value;
      const originalGetSnapshot = session.getSnapshot.bind(session);
      const wrapped = Object.assign(Object.create(Object.getPrototypeOf(session)), session, {
        getSnapshot: () => {
          getSnapshotCalls += 1;
          return originalGetSnapshot();
        },
      });
      return { ok: true, value: wrapped } as never;
    });

    try {
      const controller = createController();
      const interactionNotify = track(controller, 'interaction');
      const documentNotify = track(controller, 'document');
      const historyNotify = track(controller, 'history');

      const begin = beginInput('spy');
      unwrap(controller.beginFreehand(begin) as AnyResult<void>);
      getSnapshotCalls = 0;
      const revisionBefore = controller.getSnapshot('document').documentRevision;

      unwrap(
        controller.updateFreehand({
          type: 'update',
          batch: batchLike(begin, 1, [sampleInput(2, 'move')]),
        }) as AnyResult<void>
      );

      expect(spy).toHaveBeenCalled();
      expect(interactionNotify()).toBeGreaterThan(0);
      expect(documentNotify()).toBe(0);
      expect(historyNotify()).toBe(0);
      expect(controller.getSnapshot('document').documentRevision).toBe(revisionBefore);
      expect(getSnapshotCalls).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('per-point update 不改 document/history；collecting 时 interaction.activeFreehand 存在', () => {
    const controller = createController();
    const begin = beginInput('int');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    const revisionBefore = controller.getSnapshot('document').documentRevision;

    unwrap(
      controller.updateFreehand({
        type: 'update',
        batch: batchLike(begin, 1, [sampleInput(2, 'move')]),
      }) as AnyResult<void>
    );
    unwrap(
      controller.updateFreehand({
        type: 'update',
        batch: batchLike(begin, 2, [sampleInput(3, 'move')]),
      }) as AnyResult<void>
    );

    expect(controller.getSnapshot('document').documentRevision).toBe(revisionBefore);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    const interaction = controller.getSnapshot('interaction');
    expect(interaction.activeFreehand).toBeDefined();
    expect(interaction.pendingCandidates).toHaveLength(0);
  });

  it('gap batch 透传 session-rejected，修正后 retry，candidate 仅含有效样本', () => {
    const controller = createController();
    const begin = beginInput('seq');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);

    const gap = controller.updateFreehand({
      type: 'update',
      batch: batchLike(begin, 5, [sampleInput(2, 'move')]),
    }) as AnyResult<void>;
    expect(gap.ok).toBe(false);
    if (gap.ok) {
      throw new Error('Test precondition failed: !gap.ok');
    }
    {
      expect(gap.error.code).toBe('session-rejected');
      expect(gap.error.sessionCode).toBe('batch-sequence-mismatch');
    }

    unwrap(
      controller.updateFreehand({
        type: 'update',
        batch: batchLike(begin, 1, [sampleInput(2, 'move')]),
      }) as AnyResult<void>
    );
    const candidate = unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(begin, 2, [sampleInput(3, 'up')]),
      }) as AnyResult<FreehandCandidate>
    );
    expect(candidate.samples.map((sample) => sample.sequence)).toEqual([0, 1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// E. 生命周期：工具切换 / cancel / 迟到 end
// ---------------------------------------------------------------------------

describe('layeredEditorController: 生命周期', () => {
  it('工具切换取消 collecting，不产生 document/undo；迟到 end 被拒绝', () => {
    const controller = createController();
    const begin = beginInput('tc');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    const revisionBefore = controller.getSnapshot('document').documentRevision;

    unwrap(controller.setTool('line') as AnyResult<void>);
    expect(controller.getSnapshot('tools').activeTool).toBe('line');

    const lateEnd = controller.endFreehand({
      type: 'end',
      batch: batchLike(begin, 1, [sampleInput(2, 'up')]),
    }) as AnyResult<FreehandCandidate>;
    expect(lateEnd.ok).toBe(false);

    expect(controller.getSnapshot('document').documentRevision).toBe(revisionBefore);
    expect(controller.getSnapshot('history').canUndo).toBe(false);

    const commit = controller.commitFreehand('tc') as AnyResult<LayeredCommitReceipt>;
    expect(commit.ok).toBe(false);
    if (commit.ok) {
      throw new Error('Test precondition failed: !commit.ok');
    }
    {
      expect(commit.error.code).toBe('pending-commit-not-found');
    }
  });

  it('同 tool 不取消 collecting', () => {
    const controller = createController();
    const begin = beginInput('same');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    unwrap(controller.setTool('freehand') as AnyResult<void>);

    const candidate = unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(begin, 1, [sampleInput(2, 'up')]),
      }) as AnyResult<FreehandCandidate>
    );
    expect(candidate.commitId).toBe('same');
  });

  it('awaiting 阶段工具切换不丢 pending，仍可 commit', () => {
    const controller = createController();
    drawStroke(controller, 'pend');
    unwrap(controller.setTool('line') as AnyResult<void>);

    const receipt = unwrap(controller.commitFreehand('pend') as AnyResult<LayeredCommitReceipt>);
    expect(receipt.status).toBe('created');
    expect(receipt.presentInDocument).toBe(true);
  });

  it('cancelFreehand 丢弃未提交样本，不产生 document/history', () => {
    const controller = createController();
    const begin = beginInput('cx');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    unwrap(
      controller.cancelFreehand({
        type: 'cancel',
        sessionId: begin.batch.sessionId,
        pointerId: begin.batch.pointerId,
        source: begin.batch.source,
        batchSequence: 1,
        reason: 'pointercancel',
      }) as AnyResult<void>
    );

    const commit = controller.commitFreehand('cx') as AnyResult<LayeredCommitReceipt>;
    expect(commit.ok).toBe(false);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. viewport
// ---------------------------------------------------------------------------

describe('layeredEditorController: viewport', () => {
  it('collecting 期间丢弃 viewport 且不补跳；结束后重新发送才生效', () => {
    const controller = createController();
    const viewportNotify = track(controller, 'viewport');
    const begin = beginInput('vp');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    const revisionDuring = controller.getSnapshot('viewport').revision;

    const dropped = unwrap(
      controller.updateViewport({
        type: 'replace',
        expectedRevision: revisionDuring,
        viewport: { scale: 3, tx: 0, ty: 0 },
      }) as AnyResult<{ applied: boolean; reason?: string }>
    );
    expect(dropped.applied).toBe(false);
    expect(dropped.reason).toBe('active-freehand');
    expect(controller.getSnapshot('viewport').revision).toBe(revisionDuring);

    unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(begin, 1, [sampleInput(2, 'up')]),
      }) as AnyResult<FreehandCandidate>
    );
    expect(controller.getSnapshot('viewport').revision).toBe(revisionDuring);

    const applied = unwrap(
      controller.updateViewport({
        type: 'replace',
        expectedRevision: revisionDuring,
        viewport: { scale: 3, tx: 0, ty: 0 },
      }) as AnyResult<{ applied: boolean }>
    );
    expect(applied.applied).toBe(true);
    expect(controller.getSnapshot('viewport').revision).toBe(revisionDuring + 1);
    expect(viewportNotify()).toBeGreaterThan(0);
  });

  it('stale expectedRevision 被拒绝；transform 应用后 revision 前进', () => {
    const controller = createController();
    const current = controller.getSnapshot('viewport').revision;

    const stale = controller.updateViewport({
      type: 'replace',
      expectedRevision: current + 5,
      viewport: { scale: 2, tx: 1, ty: 1 },
    }) as AnyResult<unknown>;
    expect(stale.ok).toBe(false);
    if (stale.ok) {
      throw new Error('Test precondition failed: !stale.ok');
    }
    {
      expect(stale.error.code).toBe('stale-viewport-revision');
    }
    expect(controller.getSnapshot('viewport').revision).toBe(current);

    const transformed = unwrap(
      controller.updateViewport({
        type: 'transform',
        expectedRevision: current,
        intent: { startFocal: { x: 0, y: 0 }, currentFocal: { x: 10, y: 10 }, scaleRatio: 2 },
      }) as AnyResult<{ applied: boolean }>
    );
    expect(transformed.applied).toBe(true);
    expect(controller.getSnapshot('viewport').revision).toBe(current + 1);
  });

  it('viewport 变更只通知 viewport channel，不改 document', () => {
    const controller = createController();
    const documentNotify = track(controller, 'document');
    const revision = controller.getSnapshot('viewport').revision;

    unwrap(
      controller.updateViewport({
        type: 'replace',
        expectedRevision: revision,
        viewport: { scale: 4, tx: 2, ty: 2 },
      }) as AnyResult<{ applied: boolean }>
    );
    expect(documentNotify()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// G. selection / history / undo-redo
// ---------------------------------------------------------------------------

describe('layeredEditorController: selection 与 history', () => {
  it('setSelection 去重；缺失目标拒绝；selection 不产生 history；undo 过滤', () => {
    const controller = createController({
      document: makeDocument([makeFreehand({ objectId: 'a' })]),
    });
    const historyNotify = track(controller, 'history');

    unwrap(controller.setSelection(['a', 'a']) as AnyResult<void>);
    expect([...controller.getSnapshot('selection')].sort()).toEqual(['a']);
    expect(historyNotify()).toBe(0);

    const missing = controller.setSelection(['a', 'missing']) as AnyResult<void>;
    expect(missing.ok).toBe(false);
    if (missing.ok) {
      throw new Error('Test precondition failed: !missing.ok');
    }
    {
      expect(missing.error.code).toBe('selection-target-missing');
    }
    expect([...controller.getSnapshot('selection')]).toEqual(['a']);

    drawStroke(controller, 'sel');
    unwrap(controller.commitFreehand('sel') as AnyResult<LayeredCommitReceipt>);
    unwrap(controller.setSelection(['a', 'obj-sel']) as AnyResult<void>);
    expect(historyNotify()).toBe(1); // 仅 commit 触发一次

    unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect([...controller.getSnapshot('selection')]).toEqual(['a']);
  });

  it('两 commit 独立 history 顺序；undo/redo revision 单调', () => {
    const controller = createController();
    drawStroke(controller, 'h1');
    unwrap(controller.commitFreehand('h1') as AnyResult<LayeredCommitReceipt>);
    drawStroke(controller, 'h2');
    const receipt2 = unwrap(controller.commitFreehand('h2') as AnyResult<LayeredCommitReceipt>);

    expect(commitIds(controller)).toEqual(['h1', 'h2']);
    // revision 从 1 起，每次成功 commit/undo/redo 精确 +1。
    expect(receipt2.documentRevision).toBe(3);

    const undo1 = unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(undo1.objects).toHaveLength(1);
    expect(undo1.documentRevision).toBe(4);
    const undo2 = unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(undo2.objects).toHaveLength(0);
    expect(undo2.documentRevision).toBe(5);

    const redo1 = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redo1.objects).toHaveLength(1);
    expect(redo1.documentRevision).toBe(6);
    const redo2 = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redo2.objects).toHaveLength(2);
    expect(redo2.documentRevision).toBe(7);
  });

  it('空 undo/redo → nothing-to-undo / nothing-to-redo，且不通知 document/history', () => {
    const controller = createController();
    const documentNotify = track(controller, 'document');
    const historyNotify = track(controller, 'history');
    const revision = controller.getSnapshot('document').documentRevision;

    const undo = controller.undo() as AnyResult<EditorDocument>;
    expect(undo.ok).toBe(false);
    if (undo.ok) {
      throw new Error('Test precondition failed: !undo.ok');
    }
    {
      expect(undo.error.code).toBe('nothing-to-undo');
    }
    const redo = controller.redo() as AnyResult<EditorDocument>;
    expect(redo.ok).toBe(false);
    if (redo.ok) {
      throw new Error('Test precondition failed: !redo.ok');
    }
    {
      expect(redo.error.code).toBe('nothing-to-redo');
    }

    expect(documentNotify()).toBe(0);
    expect(historyNotify()).toBe(0);
    expect(controller.getSnapshot('document').documentRevision).toBe(revision);
  });

  it('undo 后 branch 丢弃 redo；旧 tombstone 不释放，重复同 payload 仍 duplicate', () => {
    const controller = createController();
    drawStroke(controller, 'b1');
    unwrap(controller.commitFreehand('b1') as AnyResult<LayeredCommitReceipt>);
    drawStroke(controller, 'b2');
    unwrap(controller.commitFreehand('b2') as AnyResult<LayeredCommitReceipt>);

    unwrap(controller.undo() as AnyResult<EditorDocument>);
    drawStroke(controller, 'b3');
    unwrap(controller.commitFreehand('b3') as AnyResult<LayeredCommitReceipt>);
    expect(commitIds(controller)).toEqual(['b1', 'b3']);

    drawStroke(controller, 'b2');
    const duplicate = unwrap(controller.commitFreehand('b2') as AnyResult<LayeredCommitReceipt>);
    expect(duplicate.status).toBe('duplicate');
    expect(commitIds(controller)).toEqual(['b1', 'b3']);
  });

  it('commit 后重复 undo 不清空 redo', () => {
    const controller = createController();
    drawStroke(controller, 'r1');
    unwrap(controller.commitFreehand('r1') as AnyResult<LayeredCommitReceipt>);
    unwrap(controller.undo() as AnyResult<EditorDocument>);
    const extra = controller.undo() as AnyResult<EditorDocument>;
    expect(extra.ok).toBe(false);

    const redo = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redo.objects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H. commit 失败恢复与原子性
// ---------------------------------------------------------------------------

describe('layeredEditorController: 提交失败恢复', () => {
  it('allocator 首次重复 id → 提交失败保 candidate；retry created 且仅 1 undo', () => {
    let calls = 0;
    const controller = createController({
      document: makeDocument([makeFreehand({ objectId: 'seed-1' })]),
      allocateObjectId: () => (calls++ === 0 ? 'seed-1' : 'obj-fresh'),
    });
    drawStroke(controller, 'alloc');

    const first = controller.commitFreehand('alloc') as AnyResult<LayeredCommitReceipt>;
    expect(first.ok).toBe(false);
    if (first.ok) {
      throw new Error('Test precondition failed: !first.ok');
    }
    {
      expect(['object-id-conflict', 'object-id-allocation-failed']).toContain(first.error.code);
    }
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    expect(controller.getSnapshot('history').canUndo).toBe(false);

    const retry = unwrap(controller.commitFreehand('alloc') as AnyResult<LayeredCommitReceipt>);
    expect(retry.status).toBe('created');
    expect(retry.objectId).toBe('obj-fresh');
    expect(controller.getSnapshot('document').objects).toHaveLength(2);

    unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('geometryCache 故障 → final-geometry-failed；retry created 且仅 1 undo', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const realCache = new FreehandGeometryCache();
    let calls = 0;
    const faulty = Object.create(realCache);
    faulty.getGeometry = (...args: unknown[]) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('cache boom');
      }
      return realCache.getGeometry(...(args as [never, never]));
    };

    const controller = createController({ geometryCache: faulty });
    const begin = beginInput('cache');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);

    const endBatch = () => ({
      type: 'end' as const,
      batch: batchLike(begin, 1, [sampleInput(2, 'up')]),
    });
    const end = controller.endFreehand(endBatch()) as AnyResult<FreehandCandidate>;
    let failureCode: string | undefined;
    if (!end.ok) {
      failureCode = end.error.code;
    } else {
      const commit = controller.commitFreehand('cache') as AnyResult<LayeredCommitReceipt>;
      if (!commit.ok) {
        failureCode = commit.error.code;
      }
    }
    expect(failureCode).toBe('final-geometry-failed');
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);

    // retry：保持同 candidate，重新 commit（若 end 曾失败则重新 end）。
    let receipt: LayeredCommitReceipt;
    if (end.ok) {
      receipt = unwrap(controller.commitFreehand('cache') as AnyResult<LayeredCommitReceipt>);
    } else {
      unwrap(
        controller.endFreehand({
          type: 'end',
          batch: batchLike(begin, 1, [sampleInput(2, 'up')]),
        }) as AnyResult<FreehandCandidate>
      );
      receipt = unwrap(controller.commitFreehand('cache') as AnyResult<LayeredCommitReceipt>);
    }
    expect(receipt.status).toBe('created');
    expect(controller.getSnapshot('document').objects).toHaveLength(1);

    unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('同 commitId 不同 payload → commit-id-conflict，保 candidate 不改文档/revision', () => {
    const controller = createController();
    drawStroke(controller, 'conf');
    unwrap(controller.commitFreehand('conf') as AnyResult<LayeredCommitReceipt>);
    const revisionBefore = controller.getSnapshot('document').documentRevision;

    const different = beginInput('conf', [
      { sequence: 0, x: 100, y: 100, pressure: 0.1, time: 0, phase: 'down' },
      { sequence: 1, x: 104, y: 103, pressure: 0.2, time: 16, phase: 'move' },
    ]);
    unwrap(controller.beginFreehand(different) as AnyResult<void>);
    unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(different, 1, [
          { sequence: 2, x: 104, y: 103, pressure: 0, time: 32, phase: 'up' },
        ]),
      }) as AnyResult<FreehandCandidate>
    );

    const conflict = controller.commitFreehand('conf') as AnyResult<LayeredCommitReceipt>;
    expect(conflict.ok).toBe(false);
    if (conflict.ok) {
      throw new Error('Test precondition failed: !conflict.ok');
    }
    {
      expect(conflict.error.code).toBe('commit-id-conflict');
    }
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    expect(controller.getSnapshot('document').documentRevision).toBe(revisionBefore);
  });

  it('documentRevision = MAX_SAFE_INTEGER → revision-exhausted 原子拒绝', () => {
    const controller = createController({
      document: { schemaVersion: 3, documentRevision: Number.MAX_SAFE_INTEGER, objects: [] },
    });
    drawStroke(controller, 'max');

    const result = controller.commitFreehand('max') as AnyResult<LayeredCommitReceipt>;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Test precondition failed: !result.ok');
    }
    {
      expect(result.error.code).toBe('revision-exhausted');
    }
    expect(controller.getSnapshot('document').documentRevision).toBe(Number.MAX_SAFE_INTEGER);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('subscriber 抛错被隔离，不阻断 controller 与其他订阅', () => {
    const controller = createController();
    let good = 0;
    controller.subscribe('document', () => {
      throw new Error('subscriber boom');
    });
    controller.subscribe('document', () => {
      good += 1;
    });

    expect(() => {
      drawStroke(controller, 'sub');
      unwrap(controller.commitFreehand('sub') as AnyResult<LayeredCommitReceipt>);
    }).not.toThrow();
    expect(good).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// I. 有界独立回归（cache / reentrancy / tombstone / mixed adopt / 失败重试）
// ---------------------------------------------------------------------------

function makeShapeObject(overrides: Record<string, unknown> = {}): ShapeObject {
  return {
    kind: 'shape',
    objectId: 'shape-1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    shapeType: 'rect',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    style: { color: '#000000', width: 1, opacity: 1 },
    ...overrides,
  } as unknown as ShapeObject;
}

function makeImageObject(overrides: Record<string, unknown> = {}): ImageObject {
  return {
    kind: 'image',
    objectId: 'image-1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    src: 'data:image/png;base64,aaaa',
    localBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    ...overrides,
  } as unknown as ImageObject;
}

function makeTextObject(overrides: Record<string, unknown> = {}): TextObject {
  return {
    kind: 'text',
    objectId: 'text-1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    content: 'hello',
    fontSize: 12,
    color: '#000000',
    localBounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    ...overrides,
  } as unknown as TextObject;
}

describe('layeredEditorController: 有界回归', () => {
  it('cache getGeometry 首次正常、后续 throw：commit created 且仅派生一次，undo 一次', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const realCache = new FreehandGeometryCache();
    let calls = 0;
    const flaky = Object.create(realCache);
    flaky.getGeometry = (...args: unknown[]) => {
      calls += 1;
      if (calls >= 2) {
        throw new Error('flake');
      }
      return realCache.getGeometry(...(args as [never, never]));
    };

    const controller = createController({ geometryCache: flaky });
    drawStroke(controller, 'once');
    const receipt = unwrap(controller.commitFreehand('once') as AnyResult<LayeredCommitReceipt>);

    expect(receipt.status).toBe('created');
    expect(receipt.presentationIdentity).not.toBeNull();
    // commit 内只派生一次，回执复用同一结果，不再次派生。
    expect(calls).toBe(1);
    expect(controller.getSnapshot('document').objects).toHaveLength(1);

    unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
  });

  it('allocator 回调内 reentrant undo/commit 不破坏外层 commit 原子性', () => {
    let controller!: LayeredEditorController;
    const outcomes: string[] = [];
    const allocator = (): string => {
      try {
        const undo = controller.undo() as AnyResult<EditorDocument>;
        outcomes.push(`undo:${undo.ok}`);
      } catch {
        outcomes.push('undo:throw');
      }
      try {
        const commit = controller.commitFreehand('ghost') as AnyResult<LayeredCommitReceipt>;
        outcomes.push(`commit:${commit.ok}`);
      } catch {
        outcomes.push('commit:throw');
      }
      return 'obj-reentrant';
    };

    controller = createController({ allocateObjectId: allocator });
    drawStroke(controller, 're');
    const receipt = unwrap(controller.commitFreehand('re') as AnyResult<LayeredCommitReceipt>);

    expect(receipt.status).toBe('created');
    expect(receipt.objectId).toBe('obj-reentrant');
    // reentrant 命令应被拒（无历史/无 pending），不改变外层结果。
    expect(outcomes).toEqual(['undo:false', 'commit:false']);
    const document = controller.getSnapshot('document');
    expect(document.objects.filter((object) => object.objectId === 'obj-reentrant')).toHaveLength(
      1
    );
    expect(document.documentRevision).toBe(2); // 初始 1 + 外层一次 commit
  });

  it('commit→undo→同 payload duplicate：rev 不变/absent identity=null/redo 仍可恢复新 rev', () => {
    const controller = createController();
    drawStroke(controller, 'ud1');
    const receipt = unwrap(controller.commitFreehand('ud1') as AnyResult<LayeredCommitReceipt>);
    const revisionAfterCreate = receipt.documentRevision;
    expect(revisionAfterCreate).toBe(2);

    unwrap(controller.undo() as AnyResult<EditorDocument>);
    const revisionAfterUndo = controller.getSnapshot('document').documentRevision;
    expect(revisionAfterUndo).toBe(revisionAfterCreate + 1);

    drawStroke(controller, 'ud1');
    const duplicate = unwrap(controller.commitFreehand('ud1') as AnyResult<LayeredCommitReceipt>);
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.presentInDocument).toBe(false);
    expect(duplicate.presentationIdentity).toBeNull();
    expect(controller.getSnapshot('document').documentRevision).toBe(revisionAfterUndo);
    expect(controller.getSnapshot('history').canRedo).toBe(true);

    const redone = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redone.objects).toHaveLength(1);
    expect(redone.documentRevision).toBe(revisionAfterUndo + 1);
  });

  it('mixed 四类 adopt 保序、deep freeze、未知字段剔除', () => {
    const freehandWithNoise = {
      ...makeFreehand({ objectId: 'f', commitId: 'cf' }),
      privateInterpolation: [1, 2, 3],
      outline: [[0, 0]],
    } as unknown as DocumentObject;
    const shapeWithSkia = makeShapeObject({ objectId: 's', skiaDescriptor: { kind: 'skia' } });
    const image = makeImageObject({ objectId: 'i' });
    const text = makeTextObject({ objectId: 't' });

    const controller = createController({
      document: makeDocument([freehandWithNoise, shapeWithSkia, image, text]),
    });
    const document = controller.getSnapshot('document');
    expect(document.objects.map((object) => object.kind)).toEqual([
      'freehand',
      'shape',
      'image',
      'text',
    ]);
    expect(Object.isFrozen(document)).toBe(true);
    expect(document.objects.every((object) => Object.isFrozen(object))).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(document.objects[0], 'privateInterpolation')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(document.objects[1], 'skiaDescriptor')).toBe(false);
  });

  it('undo-branch tombstone 不释放：已用 objectId 被拒，换新 id 成功且集合无重复', () => {
    const ids = ['obj-x', 'obj-x', 'obj-y'];
    let cursor = 0;
    const controller = createController({
      allocateObjectId: () => ids[Math.min(cursor++, ids.length - 1)]!,
    });
    drawStroke(controller, 'x1');
    unwrap(controller.commitFreehand('x1') as AnyResult<LayeredCommitReceipt>);
    unwrap(controller.undo() as AnyResult<EditorDocument>);

    drawStroke(controller, 'x2');
    const reused = controller.commitFreehand('x2') as AnyResult<LayeredCommitReceipt>;
    expect(reused.ok).toBe(false);
    if (reused.ok) {
      throw new Error('Test precondition failed: !reused.ok');
    }
    {
      expect(reused.error.code).toBe('object-id-conflict');
    }

    const retry = unwrap(controller.commitFreehand('x2') as AnyResult<LayeredCommitReceipt>);
    expect(retry.objectId).toBe('obj-y');
    const objectIds = controller.getSnapshot('document').objects.map((object) => object.objectId);
    expect(objectIds).toEqual(['obj-y']);
    expect(new Set(objectIds).size).toBe(objectIds.length);
  });

  it('allocator 失败后 pendingCandidates 保持同一 candidate 引用，可 retry', () => {
    let firstCall = true;
    const controller = createController({
      document: makeDocument([makeFreehand({ objectId: 'seed-1' })]),
      allocateObjectId: () => {
        if (firstCall) {
          firstCall = false;
          return 'seed-1'; // 与既有 objectId 冲突
        }
        return 'obj-new';
      },
    });

    const candidate = drawStroke(controller, 'keep');
    const failed = controller.commitFreehand('keep') as AnyResult<LayeredCommitReceipt>;
    expect(failed.ok).toBe(false);

    const pending = controller.getSnapshot('interaction').pendingCandidates;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toBe(candidate);

    const retry = unwrap(controller.commitFreehand('keep') as AnyResult<LayeredCommitReceipt>);
    expect(retry.status).toBe('created');
  });
});

// ---------------------------------------------------------------------------
// J. oracle 4 material fix 支持（viewport 校验 / cache 重入与清理 / pending 顺序 / 嵌套冻结）
// ---------------------------------------------------------------------------

describe('layeredEditorController: oracle material-fix 支持', () => {
  it('collecting 期间 malformed viewport 命令 → invalid-input，且不改 revision/state', () => {
    const controller = createController();
    const begin = beginInput('vpbad');
    unwrap(controller.beginFreehand(begin) as AnyResult<void>);
    const revisionBefore = controller.getSnapshot('viewport').revision;

    const malformed: readonly unknown[] = [
      { type: 'replace', expectedRevision: revisionBefore },
      {
        type: 'replace',
        expectedRevision: revisionBefore,
        viewport: { scale: Number.NaN, tx: 0, ty: 0 },
      },
      { type: 'replace', expectedRevision: revisionBefore, viewport: { scale: 100, tx: 0, ty: 0 } },
      {
        type: 'transform',
        expectedRevision: revisionBefore,
        intent: {
          startFocal: { x: 0, y: 0 },
          currentFocal: { x: 0, y: 0 },
          scaleRatio: Number.NaN,
        },
      },
    ];

    for (const command of malformed) {
      const result = controller.updateViewport(command as never) as AnyResult<unknown>;
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Test precondition failed: !result.ok');
      }
      {
        expect(result.error.code).toBe('invalid-input');
      }
      expect(controller.getSnapshot('viewport').revision).toBe(revisionBefore);
    }

    // 合法命令在 collecting 仍按 active-freehand 丢弃（既有行为保持）。
    const valid = unwrap(
      controller.updateViewport({
        type: 'replace',
        expectedRevision: revisionBefore,
        viewport: { scale: 3, tx: 0, ty: 0 },
      }) as AnyResult<{ applied: boolean; reason?: string }>
    );
    expect(valid.applied).toBe(false);
    expect(valid.reason).toBe('active-freehand');
    expect(controller.getSnapshot('viewport').revision).toBe(revisionBefore);
  });

  it('非 collecting：missing viewport 不 throw、scale 越界不 clamp，均 invalid-input', () => {
    const controller = createController();
    const revisionBefore = controller.getSnapshot('viewport').revision;

    let missingResult: AnyResult<unknown> | undefined;
    expect(() => {
      missingResult = controller.updateViewport({
        type: 'replace',
        expectedRevision: revisionBefore,
      } as never) as AnyResult<unknown>;
    }).not.toThrow();
    expect(missingResult?.ok).toBe(false);
    if (!(missingResult && !missingResult.ok)) {
      throw new Error('Test precondition failed: missingResult && !missingResult.ok');
    }
    {
      expect(missingResult.error.code).toBe('invalid-input');
    }

    const scaled = controller.updateViewport({
      type: 'replace',
      expectedRevision: revisionBefore,
      viewport: { scale: 100, tx: 0, ty: 0 },
    }) as AnyResult<unknown>;
    expect(scaled.ok).toBe(false);
    if (scaled.ok) {
      throw new Error('Test precondition failed: !scaled.ok');
    }
    {
      expect(scaled.error.code).toBe('invalid-input');
    }
    expect(controller.getSnapshot('viewport').revision).toBe(revisionBefore);
    expect(controller.getSnapshot('viewport').viewport.scale).toBe(2);
  });

  it('cache.getGeometry 回调重入（commit 与 identity 两条路径）均被 internal-invariant 拒绝', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const realCache = new FreehandGeometryCache();
    let controller!: LayeredEditorController;
    const reentry: string[] = [];
    let trigger = false;
    const hostile = Object.create(realCache);
    hostile.getGeometry = (...args: unknown[]) => {
      if (trigger) {
        const undo = controller.undo() as AnyResult<EditorDocument>;
        reentry.push(undo.ok ? 'ok' : undo.error.code);
        const commit = controller.commitFreehand('ghost') as AnyResult<LayeredCommitReceipt>;
        reentry.push(commit.ok ? 'ok' : commit.error.code);
      }
      return realCache.getGeometry(...(args as [never, never]));
    };

    controller = createController({ geometryCache: hostile });
    drawStroke(controller, 'hostile');
    // commit 路径先 normal：trigger=false，无重入。
    const receipt = unwrap(controller.commitFreehand('hostile') as AnyResult<LayeredCommitReceipt>);
    expect(receipt.status).toBe('created');
    expect(reentry).toEqual([]);

    // identity 查询路径：开启 trigger，真实 cache callback 尝试重入 undo/commit。
    const revisionBefore = controller.getSnapshot('document').documentRevision;
    const objectBefore = controller.getSnapshot('document').objects[0];
    trigger = true;
    const identity = unwrap(controller.getPresentationIdentity('hostile'));
    expect(reentry).toEqual(['internal-invariant', 'internal-invariant']);
    expect(identity).not.toBeNull();
    expect(identity?.documentRevision).toBe(controller.getSnapshot('document').documentRevision);
    // 文档未被重入 mutation 改动：同一对象引用、同一 docrev。
    expect(controller.getSnapshot('document').documentRevision).toBe(revisionBefore);
    expect(controller.getSnapshot('document').objects[0]).toBe(objectBefore);
  });

  it('两个 pending：后项 commit 越序被拒；head allocator 失败不越序；顺序 retry 成功', () => {
    let allocatorShouldFail = false;
    const controller = createController({
      allocateObjectId: (commitId: string) => {
        if (allocatorShouldFail) {
          throw new Error('alloc fail');
        }
        return `obj-${commitId}`;
      },
    });
    drawStroke(controller, 'first');
    drawStroke(controller, 'second');
    expect(controller.getSnapshot('interaction').pendingCandidates).toHaveLength(2);

    const outOfOrder = controller.commitFreehand('second') as AnyResult<LayeredCommitReceipt>;
    expect(outOfOrder.ok).toBe(false);
    if (outOfOrder.ok) {
      throw new Error('Test precondition failed: !outOfOrder.ok');
    }
    {
      expect(outOfOrder.error.code).toBe('pending-commit-out-of-order');
    }
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
    // 越序拒绝保留两个候选。
    expect(controller.getSnapshot('interaction').pendingCandidates).toHaveLength(2);

    allocatorShouldFail = true;
    const headFail = controller.commitFreehand('first') as AnyResult<LayeredCommitReceipt>;
    expect(headFail.ok).toBe(false);
    if (headFail.ok) {
      throw new Error('Test precondition failed: !headFail.ok');
    }
    {
      expect(headFail.error.code).toBe('object-id-allocation-failed');
    }
    const stillBlocked = controller.commitFreehand('second') as AnyResult<LayeredCommitReceipt>;
    expect(stillBlocked.ok).toBe(false);
    if (stillBlocked.ok) {
      throw new Error('Test precondition failed: !stillBlocked.ok');
    }
    {
      expect(stillBlocked.error.code).toBe('pending-commit-out-of-order');
    }

    allocatorShouldFail = false;
    const first = unwrap(controller.commitFreehand('first') as AnyResult<LayeredCommitReceipt>);
    expect(first.status).toBe('created');
    const second = unwrap(controller.commitFreehand('second') as AnyResult<LayeredCommitReceipt>);
    expect(second.status).toBe('created');
    expect(commitIds(controller)).toEqual(['first', 'second']);
  });

  it('真实 cache slot 生命周期：commit 1 / undo 0 / redo 重派生 / branch 旧 id 清除', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const cache = new FreehandGeometryCache();
    const syncSpy = jest.spyOn(cache, 'syncDocument');
    const controller = createController({ geometryCache: cache });
    // 测试专用读取私有 slot map（不改生产、无 debug hooks）。
    const slots = () => (cache as unknown as { objects: Map<string, unknown> }).objects;

    drawStroke(controller, 'slotA');
    const first = unwrap(controller.commitFreehand('slotA') as AnyResult<LayeredCommitReceipt>);
    expect(first.status).toBe('created');
    expect(slots().size).toBe(1);
    expect(slots().has(first.objectId)).toBe(true);
    expect(syncSpy).toHaveBeenCalled();

    // undo：对象移除，slot 清理为 0。
    unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(slots().size).toBe(0);
    expect(unwrap(controller.getPresentationIdentity('slotA'))).toBeNull();

    // redo：恢复对象；getPresentationIdentity 触发真实重派生并重建 slot。
    const redone = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redone.objects.some((object) => object.objectId === first.objectId)).toBe(true);
    const identityRedo = unwrap(controller.getPresentationIdentity('slotA'));
    expect(identityRedo?.objectId).toBe(first.objectId);
    expect(slots().has(first.objectId)).toBe(true);

    // branch：undo 后新 commit，旧 id 不残留。
    unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(slots().size).toBe(0);
    drawStroke(controller, 'slotB');
    const second = unwrap(controller.commitFreehand('slotB') as AnyResult<LayeredCommitReceipt>);
    expect(second.status).toBe('created');
    expect(slots().size).toBe(1);
    expect(slots().has(second.objectId)).toBe(true);
    expect(slots().has(first.objectId)).toBe(false);
  });

  it('prepare-then-throw：失败清理临时 slot、保同一 candidate，retry created', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const real = new FreehandGeometryCache();
    const slots = () => (real as unknown as { objects: Map<string, unknown> }).objects;
    let armed = true;
    const flaky = Object.create(real);
    flaky.getGeometry = (...args: unknown[]) => {
      if (armed) {
        armed = false;
        // 真实派生先建立 slot，再抛错模拟“prepare 后失败”。
        real.getGeometry(...(args as [never, never]));
        throw new Error('prepare then throw');
      }
      return real.getGeometry(...(args as [never, never]));
    };

    const controller = createController({ geometryCache: flaky });
    const candidate = drawStroke(controller, 'prep');
    const failed = controller.commitFreehand('prep') as AnyResult<LayeredCommitReceipt>;
    expect(failed.ok).toBe(false);
    if (failed.ok) {
      throw new Error('Test precondition failed: !failed.ok');
    }
    {
      expect(failed.error.code).toBe('final-geometry-failed');
    }
    // 失败原子 + 临时 slot 清理。
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    expect(controller.getSnapshot('document').documentRevision).toBe(1);
    expect(slots().size).toBe(0);

    const pending = controller.getSnapshot('interaction').pendingCandidates;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toBe(candidate);

    const retry = unwrap(controller.commitFreehand('prep') as AnyResult<LayeredCommitReceipt>);
    expect(retry.status).toBe('created');
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    expect(slots().has(retry.objectId)).toBe(true);
  });

  it('cache syncDocument 抛错不阻断 commit/undo/redo（docrev 精确 +1）', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const cache = new FreehandGeometryCache();
    jest.spyOn(cache, 'syncDocument').mockImplementation(() => {
      throw new Error('sync boom');
    });
    const controller = createController({ geometryCache: cache });

    drawStroke(controller, 'syncfail');
    const created = unwrap(
      controller.commitFreehand('syncfail') as AnyResult<LayeredCommitReceipt>
    );
    expect(created.status).toBe('created');
    expect(created.documentRevision).toBe(2);

    const undo = unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(undo.documentRevision).toBe(3);
    const redo = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redo.documentRevision).toBe(4);
  });

  it('cache getGeometry 只派生一次；sync 清理不二次 derive（第二次调用抛错也不触发）', () => {
    const { FreehandGeometryCache } = jest.requireActual('../../geometry/freehandCache');
    const real = new FreehandGeometryCache();
    let calls = 0;
    const flaky = Object.create(real);
    flaky.getGeometry = (...args: unknown[]) => {
      calls += 1;
      if (calls >= 2) {
        throw new Error('second boom');
      }
      return real.getGeometry(...(args as [never, never]));
    };

    const controller = createController({ geometryCache: flaky });
    drawStroke(controller, 'atomic');

    const receipt = unwrap(controller.commitFreehand('atomic') as AnyResult<LayeredCommitReceipt>);
    expect(receipt.status).toBe('created');
    expect(receipt.presentationIdentity).not.toBeNull();
    // commit 与回执复用同一次派生；sync cleanup / undo / redo 不再次 derive。
    expect(calls).toBe(1);
    expect(controller.getSnapshot('document').objects).toHaveLength(1);

    const undo = unwrap(controller.undo() as AnyResult<EditorDocument>);
    expect(undo.documentRevision).toBe(3);
    const redo = unwrap(controller.redo() as AnyResult<EditorDocument>);
    expect(redo.documentRevision).toBe(4);
    expect(calls).toBe(1);
  });

  it('同 commitId：pressure 缺失 vs pressure=0 属不同 payload → commit-id-conflict', () => {
    const controller = createController();

    const beginMissing = beginInput('p', [
      { sequence: 0, x: 0, y: 0, pressure: 0.5, time: 0, phase: 'down' },
      { sequence: 1, x: 4, y: 3, time: 16, phase: 'move' }, // 缺 pressure
    ]);
    unwrap(controller.beginFreehand(beginMissing) as AnyResult<void>);
    unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(beginMissing, 1, [
          { sequence: 2, x: 8, y: 6, pressure: 0, time: 32, phase: 'up' },
        ]),
      }) as AnyResult<FreehandCandidate>
    );
    const created = unwrap(controller.commitFreehand('p') as AnyResult<LayeredCommitReceipt>);
    expect(created.status).toBe('created');

    const beginZero = beginInput('p', [
      { sequence: 0, x: 0, y: 0, pressure: 0.5, time: 0, phase: 'down' },
      { sequence: 1, x: 4, y: 3, pressure: 0, time: 16, phase: 'move' }, // pressure=0
    ]);
    unwrap(controller.beginFreehand(beginZero) as AnyResult<void>);
    unwrap(
      controller.endFreehand({
        type: 'end',
        batch: batchLike(beginZero, 1, [
          { sequence: 2, x: 8, y: 6, pressure: 0, time: 32, phase: 'up' },
        ]),
      }) as AnyResult<FreehandCandidate>
    );
    const conflict = controller.commitFreehand('p') as AnyResult<LayeredCommitReceipt>;
    expect(conflict.ok).toBe(false);
    if (conflict.ok) {
      throw new Error('Test precondition failed: !conflict.ok');
    }
    {
      expect(conflict.error.code).toBe('commit-id-conflict');
    }
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
  });

  it('mixed 嵌套原始对象 mutation 隔离且深冻结（samples/brush/transform/points/dash/bounds）', () => {
    const samples = [
      {
        sequence: 0,
        x: 0,
        y: 0,
        pressure: 0.5,
        time: 0,
        phase: 'down' as const,
        source: 'pen' as const,
      },
      {
        sequence: 1,
        x: 4,
        y: 3,
        pressure: 0.6,
        time: 16,
        phase: 'up' as const,
        source: 'pen' as const,
      },
    ];
    const transform = { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 5 };
    const freehandInput = {
      kind: 'freehand',
      objectId: 'f',
      objectRevision: 1,
      transform,
      transformRevision: 1,
      commitId: 'cf',
      samples,
      brushSnapshot: {
        color: '#111111',
        nominalSize: 4,
        opacity: 1,
        pressureMode: 'real',
        presetRevision: 1,
      },
      resolvedPressureMode: 'real',
      samplesRevision: 1,
      brushRevision: 1,
    };
    const shapePoints = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const dash = [4, 2];
    const shapeInput = {
      kind: 'shape',
      objectId: 's',
      objectRevision: 1,
      transform: { ...transform },
      transformRevision: 1,
      shapeType: 'rect',
      points: shapePoints,
      style: { color: '#222222', width: 2, opacity: 1, dash },
    };
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const imageInput = {
      kind: 'image',
      objectId: 'i',
      objectRevision: 1,
      transform: { ...transform },
      transformRevision: 1,
      src: 'data:image/png;base64,aaaa',
      localBounds: bounds,
    };
    const textBounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const textInput = {
      kind: 'text',
      objectId: 't',
      objectRevision: 1,
      transform: { ...transform },
      transformRevision: 1,
      content: 'hello',
      fontSize: 12,
      color: '#333333',
      localBounds: textBounds,
    };

    const controller = createController({
      document: makeDocument([
        freehandInput,
        shapeInput,
        imageInput,
        textInput,
      ] as unknown as DocumentObject[]),
    });
    const document = controller.getSnapshot('document');

    // 外部变异原始输入对象（含 nested sample pressure 与 brush）。
    transform.a = 99;
    samples[0]!.x = 999;
    samples[0]!.pressure = 0.9;
    freehandInput.brushSnapshot.opacity = 0.1;
    shapePoints[0]!.x = 888;
    dash[0] = 77;
    bounds.maxX = 999;
    textBounds.maxY = 999;

    const freehand = document.objects[0];
    const shape = document.objects[1];
    const image = document.objects[2];
    const text = document.objects[3];
    expect(freehand?.kind === 'freehand' && freehand.transform.a).toBe(1);
    expect(freehand?.kind === 'freehand' && freehand.samples[0]?.x).toBe(0);
    expect(freehand?.kind === 'freehand' && freehand.samples[0]?.pressure).toBe(0.5);
    expect(freehand?.kind === 'freehand' && freehand.brushSnapshot.opacity).toBe(1);
    expect(shape?.kind === 'shape' && shape.points[0]?.x).toBe(1);
    expect(shape?.kind === 'shape' && shape.style.dash?.[0]).toBe(4);
    expect(image?.kind === 'image' && image.localBounds.maxX).toBe(10);
    expect(text?.kind === 'text' && text.localBounds.maxY).toBe(20);

    expect(document.objects.every((object) => Object.isFrozen(object))).toBe(true);
    if (!(freehand?.kind === 'freehand')) {
      throw new Error("Test precondition failed: freehand?.kind === 'freehand'");
    }
    {
      expect(Object.isFrozen(freehand.samples)).toBe(true);
      expect(Object.isFrozen(freehand.samples[0])).toBe(true);
      expect(Object.isFrozen(freehand.brushSnapshot)).toBe(true);
      expect(Object.isFrozen(freehand.transform)).toBe(true);
    }
    if (!(shape?.kind === 'shape')) {
      throw new Error("Test precondition failed: shape?.kind === 'shape'");
    }
    {
      expect(Object.isFrozen(shape.points)).toBe(true);
      expect(Object.isFrozen(shape.points[0])).toBe(true);
      expect(Object.isFrozen(shape.style.dash)).toBe(true);
    }
    if (!(image?.kind === 'image')) {
      throw new Error("Test precondition failed: image?.kind === 'image'");
    }
    {
      expect(Object.isFrozen(image.localBounds)).toBe(true);
    }
    if (!(text?.kind === 'text')) {
      throw new Error("Test precondition failed: text?.kind === 'text'");
    }
    {
      expect(Object.isFrozen(text.localBounds)).toBe(true);
    }
  });

  it('getPresentationIdentity 为 query：不通知任何频道、不改 revision', () => {
    const controller = createController();
    drawStroke(controller, 'q');
    unwrap(controller.commitFreehand('q') as AnyResult<LayeredCommitReceipt>);

    const documentNotify = track(controller, 'document');
    const historyNotify = track(controller, 'history');
    const viewportNotify = track(controller, 'viewport');
    const revisionBefore = controller.getSnapshot('document').documentRevision;

    const identity = unwrap(controller.getPresentationIdentity('q'));
    expect(identity).not.toBeNull();

    expect(documentNotify()).toBe(0);
    expect(historyNotify()).toBe(0);
    expect(viewportNotify()).toBe(0);
    expect(controller.getSnapshot('document').documentRevision).toBe(revisionBefore);
  });
});
