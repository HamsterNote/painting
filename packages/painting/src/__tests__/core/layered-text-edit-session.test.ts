/** @jest-environment node */

/**
 * Task 5.5 证据：`core/layeredTextEditSession.ts`（唯一新增本测试文件）。
 *
 * 10 exports：`LayeredTextEditDraft` / `LayeredTextEditDraftUpdate` / `LayeredTextEditTarget` /
 * `LayeredTextEditCandidate` / `LayeredTextEditFeedback` / `LayeredTextEditSnapshot` /
 * `LayeredTextEditErrorCode` / `LayeredTextEditResult` / `LayeredTextEditSession` /
 * `beginLayeredTextEditSession`。
 *
 * 纯内存状态机：无 document/history/DOM/focus/真实 IME；所有方法返回 Result，不 throw。
 */

import {
  beginLayeredTextEditSession,
  type LayeredTextEditDraft,
  type LayeredTextEditFeedback,
  type LayeredTextEditResult,
  type LayeredTextEditSession,
  type LayeredTextEditTarget,
} from '../../core/layeredTextEditSession';
import { IDENTITY_TRANSFORM, type AffineTransform, type Bounds } from '../../model/document';

function unwrap<T>(result: LayeredTextEditResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}`);
  }
  return result.value;
}

function draft(overrides: Partial<LayeredTextEditDraft> = {}): LayeredTextEditDraft {
  return {
    content: 'hello',
    fontSize: 12,
    color: '#000000',
    localBounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    ...overrides,
  };
}

function newTarget(overrides: Partial<{ expectedDocumentRevision: number; transform: AffineTransform }> = {}): LayeredTextEditTarget {
  return {
    kind: 'new',
    expectedDocumentRevision: overrides.expectedDocumentRevision ?? 0,
    transform: overrides.transform ?? IDENTITY_TRANSFORM,
  };
}

function existingTarget(
  overrides: Partial<{ expectedDocumentRevision: number; objectId: string; expectedObjectRevision: number }> = {}
): LayeredTextEditTarget {
  return {
    kind: 'existing',
    expectedDocumentRevision: overrides.expectedDocumentRevision ?? 3,
    objectId: overrides.objectId ?? 'text-1',
    expectedObjectRevision: overrides.expectedObjectRevision ?? 1,
  };
}

function begin(target: LayeredTextEditTarget, initial: LayeredTextEditDraft = draft()): LayeredTextEditSession {
  return unwrap(beginLayeredTextEditSession(target, initial));
}

function expectCode(result: LayeredTextEditResult<unknown>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// A. begin / updateDraft 基础
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: begin / draft', () => {
  it('new + 非空 content → requestCommit 得 create 候选', () => {
    const session = begin(newTarget({ expectedDocumentRevision: 2 }));
    expect(unwrap(session.requestCommit())).toBeUndefined();
    const candidate = unwrap(session.getCandidate());
    expect(candidate.kind).toBe('create');
    if (candidate.kind === 'create') {
      expect(candidate.draft.content).toBe('hello');
      expect(candidate.target.expectedDocumentRevision).toBe(2);
    }
  });

  it('new + 空 content → noop 候选', () => {
    const session = begin(newTarget(), draft({ content: '' }));
    unwrap(session.requestCommit());
    expect(unwrap(session.getCandidate()).kind).toBe('noop');
  });

  it('existing + 非空 content → update 候选', () => {
    const session = begin(existingTarget(), draft());
    unwrap(session.requestCommit());
    const candidate = unwrap(session.getCandidate());
    expect(candidate.kind).toBe('update');
  });

  it('existing + 空 content → delete 候选', () => {
    const session = begin(existingTarget(), draft({ content: '' }));
    unwrap(session.requestCommit());
    expect(unwrap(session.getCandidate()).kind).toBe('delete');
  });

  it('updateDraft content/fontSize/color/localBounds 生效', () => {
    const session = begin(newTarget());
    unwrap(
      session.updateDraft({
        content: '标题',
        fontSize: 24,
        color: '#ff0000',
        localBounds: { minX: -1, minY: -2, maxX: 30, maxY: 40 },
      })
    );
    const snapshot = session.getSnapshot();
    expect(snapshot.draft.content).toBe('标题');
    expect(snapshot.draft.fontSize).toBe(24);
    expect(snapshot.draft.color).toBe('#ff0000');
    expect(snapshot.draft.localBounds).toEqual({ minX: -1, minY: -2, maxX: 30, maxY: 40 });
  });

  it('content 不做 trim / 规范化（空串与空格串区别）', () => {
    const space = begin(newTarget(), draft({ content: '   ' }));
    unwrap(space.requestCommit());
    // 空格串非空 → create（noop 仅 content === ''）。
    expect(unwrap(space.getCandidate()).kind).toBe('create');

    const empty = begin(newTarget(), draft({ content: '' }));
    unwrap(empty.requestCommit());
    expect(unwrap(empty.getCandidate()).kind).toBe('noop');
  });
});

// ---------------------------------------------------------------------------
// B. begin 非法输入
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: begin 非法', () => {
  it('bad target（未知 kind / objectId 空 / revision 非法）→ invalid-input', () => {
    expectCode(beginLayeredTextEditSession({ kind: 'weird' } as unknown as LayeredTextEditTarget, draft()), 'invalid-input');
    expectCode(beginLayeredTextEditSession(existingTarget({ objectId: '' }), draft()), 'invalid-input');
    expectCode(beginLayeredTextEditSession(existingTarget({ expectedObjectRevision: -1 }), draft()), 'invalid-input');
    expectCode(beginLayeredTextEditSession(newTarget({ expectedDocumentRevision: 1.5 }), draft()), 'invalid-input');
  });

  it('bad transform（NaN / 奇异）→ invalid-input', () => {
    expectCode(
      beginLayeredTextEditSession(newTarget({ transform: { ...IDENTITY_TRANSFORM, a: Number.NaN } }), draft()),
      'invalid-input'
    );
    expectCode(
      beginLayeredTextEditSession(newTarget({ transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 } }), draft()),
      'invalid-input'
    );
  });

  it('bad draft（fontSize<=0 / color 空 / bounds 无序）→ invalid-input', () => {
    expectCode(beginLayeredTextEditSession(newTarget(), draft({ fontSize: 0 })), 'invalid-input');
    expectCode(beginLayeredTextEditSession(newTarget(), draft({ color: '' })), 'invalid-input');
    expectCode(
      beginLayeredTextEditSession(newTarget(), draft({ localBounds: { minX: 5, minY: 0, maxX: 0, maxY: 5 } })),
      'invalid-input'
    );
  });

  it('runtime undefined / 非对象 → invalid-input（不 throw）', () => {
    expectCode(beginLayeredTextEditSession(undefined as unknown as LayeredTextEditTarget, draft()), 'invalid-input');
    expectCode(beginLayeredTextEditSession(newTarget(), undefined as unknown as LayeredTextEditDraft), 'invalid-input');
  });
});

// ---------------------------------------------------------------------------
// C. 深冻结 / 白名单 / caller 隔离
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: 冻结与隔离', () => {
  it('target/draft/snapshot 深冻结；未知字段剔除', () => {
    const session = begin(
      { ...newTarget(), extraTarget: 1 } as unknown as LayeredTextEditTarget,
      { ...draft(), extraDraft: 2 } as unknown as LayeredTextEditDraft
    );
    const snapshot = session.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.target)).toBe(true);
    expect(Object.isFrozen(snapshot.draft)).toBe(true);
    expect(Object.isFrozen(snapshot.draft.localBounds)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snapshot.draft, 'extraDraft')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(snapshot.target, 'extraTarget')).toBe(false);
  });

  it('caller mutation 不影响会话', () => {
    const initial = draft();
    const session = begin(newTarget(), initial);
    const snapshot = session.getSnapshot();
    (initial.localBounds as unknown as { maxX: number }).maxX = 999;
    (initial as { content: string }).content = 'changed';
    expect(snapshot.draft.content).toBe('hello');
    expect(snapshot.draft.localBounds.maxX).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// D. composition
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: composition', () => {
  it('composing 期间 requestCommit 挂起：candidate-not-ready，直到 end final', () => {
    const session = begin(newTarget());
    unwrap(session.startComposition());
    unwrap(session.requestCommit());
    const pending = session.getSnapshot();
    expect(pending.status).toBe('editing');
    expect(pending.isComposing).toBe(true);
    expect(pending.commitRequested).toBe(true);
    expectCode(session.getCandidate(), 'candidate-not-ready');

    // 重复 request 不产生候选。
    unwrap(session.requestCommit());
    expect(session.getSnapshot().candidate).toBeNull();

    unwrap(session.endComposition({ content: '你好🙂' }));
    const done = session.getSnapshot();
    expect(done.status).toBe('awaiting-commit');
    expect(done.isComposing).toBe(false);
    const candidate = unwrap(session.getCandidate());
    expect(candidate.kind).toBe('create');
    if (candidate.kind === 'create') {
      expect(candidate.draft.content).toBe('你好🙂');
    }
  });

  it('startComposition 重复幂等成功（已在 composing）', () => {
    const session = begin(newTarget());
    unwrap(session.startComposition());
    unwrap(session.startComposition());
    expect(session.getSnapshot().isComposing).toBe(true);
    // 幂等不改变状态机。
    expect(session.getSnapshot().status).toBe('editing');
  });

  it('endComposition 真缺 content / 非法字段原子拒绝，保 composing/draft/pending', () => {
    const session = begin(newTarget());
    unwrap(session.startComposition());
    unwrap(session.requestCommit());

    expectCode(session.endComposition({} as unknown as { content: string }), 'invalid-input');
    expectCode(session.endComposition({ content: 'x', fontSize: -1 }), 'invalid-input');

    const snapshot = session.getSnapshot();
    expect(snapshot.isComposing).toBe(true);
    expect(snapshot.commitRequested).toBe(true);
    expect(snapshot.draft.content).toBe('hello');
    expect(snapshot.candidate).toBeNull();
  });

  it('endComposition 无 composing → composition-inactive；无 pending 结束回 editing', () => {
    const session = begin(newTarget());
    expectCode(session.endComposition({ content: 'x' }), 'composition-inactive');

    unwrap(session.startComposition());
    unwrap(session.endComposition({ content: 'abc' }));
    const after = session.getSnapshot();
    expect(after.status).toBe('editing');
    expect(after.isComposing).toBe(false);
    expect(after.candidate).toBeNull();
    expect(after.draft.content).toBe('abc');

    // 之后仍可 request。
    unwrap(session.requestCommit());
    expect(unwrap(session.getCandidate()).kind).toBe('create');
  });

  it('cancel 清理 composing 与 pending 标志', () => {
    const session = begin(newTarget());
    unwrap(session.startComposition());
    unwrap(session.requestCommit());
    unwrap(session.cancel());
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('canceled');
    expect(snapshot.isComposing).toBe(false);
    expect(snapshot.commitRequested).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. awaiting-commit
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: awaiting', () => {
  function awaitingSession(): LayeredTextEditSession {
    const session = begin(existingTarget());
    unwrap(session.requestCommit());
    return session;
  }

  it('awaiting 中 updateDraft / startComposition 被拒，候选稳定', () => {
    const session = awaitingSession();
    const before = unwrap(session.getCandidate());
    expectCode(session.updateDraft({ content: 'x' }), 'session-finalized');
    expectCode(session.startComposition(), 'session-finalized');
    expect(unwrap(session.getCandidate())).toBe(before);
    expect(unwrap(session.getCandidate())).toBe(before);
  });

  it('awaiting 中重复 requestCommit 幂等成功', () => {
    const session = awaitingSession();
    expect(unwrap(session.requestCommit())).toBeUndefined();
    expect(session.getSnapshot().status).toBe('awaiting-commit');
  });
});

// ---------------------------------------------------------------------------
// F. failed feedback 保留候选 / retry / stale
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: failed 与 retry', () => {
  it('四种 failure reason 保候选/target，可 retry', () => {
    for (const reason of ['stale-target', 'allocation-failed', 'revision-exhausted', 'internal'] as const) {
      const session = begin(existingTarget());
      unwrap(session.requestCommit());
      const candidate = unwrap(session.getCandidate());
      const target = session.getSnapshot().target;
      unwrap(session.applyCommitFeedback({ type: 'commit-failed', reason }));
      expect(session.getSnapshot().status).toBe('awaiting-commit');
      expect(unwrap(session.getCandidate())).toBe(candidate);
      expect(session.getSnapshot().target).toBe(target);
    }
  });

  it('stale 失败后不换 ID/revs', () => {
    const session = begin(existingTarget({ objectId: 'text-9', expectedObjectRevision: 4, expectedDocumentRevision: 7 }));
    unwrap(session.requestCommit());
    unwrap(session.applyCommitFeedback({ type: 'commit-failed', reason: 'stale-target' }));
    const snapshot = session.getSnapshot();
    expect(snapshot.target.kind).toBe('existing');
    if (snapshot.target.kind === 'existing') {
      expect(snapshot.target.objectId).toBe('text-9');
      expect(snapshot.target.expectedObjectRevision).toBe(4);
      expect(snapshot.target.expectedDocumentRevision).toBe(7);
    }
  });
});

// ---------------------------------------------------------------------------
// G. success receipt 严格匹配
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: success matching', () => {
  const succeed = (docrev: number, objectId: string | null, objectRevision: number | null): LayeredTextEditFeedback => ({
    type: 'commit-succeeded',
    documentRevision: docrev,
    objectId,
    objectRevision,
  });

  it('noop：docrev 相等且 id/rev 均 null 接受；其余拒绝', () => {
    const okSession = begin(newTarget({ expectedDocumentRevision: 0 }), draft({ content: '' }));
    unwrap(okSession.requestCommit());
    unwrap(okSession.applyCommitFeedback(succeed(0, null, null)));
    expect(okSession.getSnapshot().status).toBe('committed');

    const bad = begin(newTarget({ expectedDocumentRevision: 0 }), draft({ content: '' }));
    unwrap(bad.requestCommit());
    expectCode(bad.applyCommitFeedback(succeed(1, null, null)), 'feedback-mismatch');
    expect(bad.getSnapshot().status).toBe('awaiting-commit');
  });

  it('create：docrev 严格 +1、objectRevision 1 接受；docrev 相等拒绝', () => {
    const session = begin(newTarget({ expectedDocumentRevision: 2 }));
    unwrap(session.requestCommit());
    unwrap(session.applyCommitFeedback(succeed(3, 'obj-1', 1)));
    expect(session.getSnapshot().status).toBe('committed');

    const equal = begin(newTarget({ expectedDocumentRevision: 2 }));
    unwrap(equal.requestCommit());
    expectCode(equal.applyCommitFeedback(succeed(2, 'obj-1', 1)), 'feedback-mismatch');
  });

  it('update：objectId 匹配、objectRevision = expected+1 接受', () => {
    const session = begin(existingTarget({ expectedDocumentRevision: 3, objectId: 'text-1', expectedObjectRevision: 1 }));
    unwrap(session.requestCommit());
    unwrap(session.applyCommitFeedback(succeed(4, 'text-1', 2)));
    expect(session.getSnapshot().status).toBe('committed');
  });

  it('update/delete wrong id / rev 拒绝且 state 不改', () => {
    const wrongId = begin(existingTarget({ objectId: 'text-1' }));
    unwrap(wrongId.requestCommit());
    expectCode(wrongId.applyCommitFeedback(succeed(4, 'text-2', 2)), 'feedback-mismatch');
    expect(wrongId.getSnapshot().status).toBe('awaiting-commit');

    const updateNullRev = begin(existingTarget());
    unwrap(updateNullRev.requestCommit());
    expectCode(updateNullRev.applyCommitFeedback(succeed(4, 'text-1', null)), 'feedback-mismatch');

    const del = begin(existingTarget(), draft({ content: '' }));
    unwrap(del.requestCommit());
    unwrap(del.applyCommitFeedback(succeed(4, 'text-1', null)));
    expect(del.getSnapshot().status).toBe('committed');

    const delWrongRev = begin(existingTarget(), draft({ content: '' }));
    unwrap(delWrongRev.requestCommit());
    expectCode(delWrongRev.applyCommitFeedback(succeed(4, 'text-1', 2)), 'feedback-mismatch');
  });
});

// ---------------------------------------------------------------------------
// H. 终态
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: 终态', () => {
  const success: LayeredTextEditFeedback = {
    type: 'commit-succeeded',
    documentRevision: 4,
    objectId: 'text-1',
    objectRevision: 2,
  };

  function committedSession(): LayeredTextEditSession {
    const session = begin(existingTarget());
    unwrap(session.requestCommit());
    unwrap(session.applyCommitFeedback(success));
    return session;
  }

  it('committed 重复同 receipt 幂等；不同 receipt 拒绝', () => {
    const session = committedSession();
    unwrap(session.applyCommitFeedback(success));
    expectCode(
      session.applyCommitFeedback({ type: 'commit-succeeded', documentRevision: 5, objectId: 'text-1', objectRevision: 3 }),
      'session-finalized'
    );
  });

  it('committed 后 late failed 不回退；cancel 不回滚', () => {
    const session = committedSession();
    expectCode(session.applyCommitFeedback({ type: 'commit-failed', reason: 'internal' }), 'session-finalized');
    expectCode(session.cancel(), 'session-finalized');
    expect(session.getSnapshot().status).toBe('committed');
  });

  it('cancel 幂等；late endComposition / success 拒绝', () => {
    const editing = begin(newTarget());
    unwrap(editing.cancel());
    unwrap(editing.cancel());
    expectCode(editing.endComposition({ content: 'x' }), 'session-finalized');
    expectCode(editing.applyCommitFeedback(success), 'session-finalized');
    expectCode(editing.getCandidate(), 'candidate-not-ready');

    const awaiting = begin(newTarget());
    unwrap(awaiting.requestCommit());
    unwrap(awaiting.cancel());
    unwrap(awaiting.cancel());
    expectCode(awaiting.applyCommitFeedback(success), 'session-finalized');
    expectCode(awaiting.getCandidate(), 'candidate-not-ready');
  });
});

// ---------------------------------------------------------------------------
// I. MAX_SAFE_INTEGER
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: MAX_SAFE_INTEGER', () => {
  it('create 目标 docrev=MAX_SAFE 无合法成功 receipt', () => {
    const session = begin(newTarget({ expectedDocumentRevision: Number.MAX_SAFE_INTEGER }));
    unwrap(session.requestCommit());
    expectCode(
      session.applyCommitFeedback({
        type: 'commit-succeeded',
        documentRevision: Number.MAX_SAFE_INTEGER,
        objectId: 'obj-1',
        objectRevision: 1,
      }),
      'feedback-mismatch'
    );
    expect(session.getSnapshot().status).toBe('awaiting-commit');
  });

  it('unsafe feedback（docrev/objectRevision MAX_SAFE+1）→ invalid-input', () => {
    const session = begin(newTarget());
    unwrap(session.requestCommit());
    expectCode(
      session.applyCommitFeedback({
        type: 'commit-succeeded',
        documentRevision: Number.MAX_SAFE_INTEGER + 1,
        objectId: 'obj-1',
        objectRevision: 1,
      }),
      'invalid-input'
    );
    expectCode(
      session.applyCommitFeedback({
        type: 'commit-succeeded',
        documentRevision: 1,
        objectId: 'obj-1',
        objectRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
      'invalid-input'
    );
    expect(session.getSnapshot().status).toBe('awaiting-commit');
  });
});

// ---------------------------------------------------------------------------
// J. 边界精修（next-safe revision / success 排错表 / noop target / draft 原子 / final 真缺）
// ---------------------------------------------------------------------------

describe('layeredTextEditSession: 边界精修', () => {
  const suc = (documentRevision: number, objectId: string | null, objectRevision: number | null): LayeredTextEditFeedback => ({
    type: 'commit-succeeded',
    documentRevision,
    objectId,
    objectRevision,
  });

  const expectMismatchPreserving = (session: LayeredTextEditSession, feedback: LayeredTextEditFeedback): void => {
    const candidate = unwrap(session.getCandidate());
    expectCode(session.applyCommitFeedback(feedback), 'feedback-mismatch');
    expect(session.getSnapshot().status).toBe('awaiting-commit');
    expect(unwrap(session.getCandidate())).toBe(candidate);
  };

  it('MAX_SAFE expectedObjectRevision：update 候选，objrev null / MAX_SAFE 均 mismatch 保候选', () => {
    const session = begin(
      existingTarget({ expectedDocumentRevision: 3, expectedObjectRevision: Number.MAX_SAFE_INTEGER })
    );
    unwrap(session.requestCommit());
    expect(unwrap(session.getCandidate()).kind).toBe('update');

    expectMismatchPreserving(session, suc(4, 'text-1', null));
    expectMismatchPreserving(session, suc(4, 'text-1', Number.MAX_SAFE_INTEGER));
  });

  it('success 排错表：create objrev 0/2 与 docrev 4 错；update rev 0/1/3 与 doc 5 错', () => {
    for (const [doc, rev] of [[3, 0], [3, 2], [4, 1]] as const) {
      const session = begin(newTarget({ expectedDocumentRevision: 2 }));
      unwrap(session.requestCommit());
      expectMismatchPreserving(session, suc(doc, 'obj-1', rev));
    }
    for (const [doc, rev] of [[4, 0], [4, 1], [4, 3], [5, 2]] as const) {
      const session = begin(existingTarget({ expectedDocumentRevision: 3, expectedObjectRevision: 1 }));
      unwrap(session.requestCommit());
      expectMismatchPreserving(session, suc(doc, 'text-1', rev));
    }
  });

  it('noop 候选含深冻结 target（expectedDocumentRevision/transform）', () => {
    const transform: AffineTransform = { ...IDENTITY_TRANSFORM };
    const session = begin(newTarget({ expectedDocumentRevision: 5, transform }), draft({ content: '' }));
    unwrap(session.requestCommit());
    const candidate = unwrap(session.getCandidate());
    expect(candidate.kind).toBe('noop');
    expect(candidate.target).toBe(session.getSnapshot().target);
    expect(Object.isFrozen(candidate.target)).toBe(true);
    if (candidate.target.kind === 'new') {
      expect(candidate.target.expectedDocumentRevision).toBe(5);
      expect(Object.isFrozen(candidate.target.transform)).toBe(true);
    }
    (transform as { a: number }).a = 99;
    if (candidate.target.kind === 'new') {
      expect(candidate.target.transform.a).toBe(1);
    }
  });

  it('updateDraft 混合非法原子拒绝；显式 known undefined 拒绝；unknown 字段剔除', () => {
    const session = begin(newTarget());
    const before = session.getSnapshot().draft;
    expectCode(session.updateDraft({ content: 'bad', fontSize: -1 }), 'invalid-input');
    expect(session.getSnapshot().draft).toBe(before);
    expectCode(session.updateDraft({ content: undefined } as unknown as { content: string }), 'invalid-input');
    expect(session.getSnapshot().draft).toBe(before);

    unwrap(session.updateDraft({ unknownField: 1 } as unknown as { content: string }));
    expect(Object.prototype.hasOwnProperty.call(session.getSnapshot().draft, 'unknownField')).toBe(false);
  });

  it('endComposition 真缺 content（{}）原子拒绝后 valid retry；候选嵌套 target/draft/bounds 冻结', () => {
    const transform: AffineTransform = { ...IDENTITY_TRANSFORM };
    const session = begin(newTarget({ transform }));
    unwrap(session.startComposition());
    unwrap(session.requestCommit());

    expectCode(session.endComposition({} as unknown as { content: string }), 'invalid-input');
    expect(session.getSnapshot().isComposing).toBe(true);
    expect(session.getSnapshot().draft.content).toBe('hello');

    unwrap(session.endComposition({ content: '你好🙂' }));
    const candidate = unwrap(session.getCandidate());
    expect(candidate.kind).toBe('create');
    if (candidate.kind === 'create') {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.target)).toBe(true);
      expect(Object.isFrozen(candidate.draft)).toBe(true);
      expect(Object.isFrozen(candidate.draft.localBounds)).toBe(true);
      expect(candidate.draft.content).toBe('你好🙂');
    }
    // external new transform mutation 不影响候选/target。
    (transform as { a: number }).a = 42;
    if (candidate.kind === 'create' && candidate.target.kind === 'new') {
      expect(candidate.target.transform.a).toBe(1);
    }
  });
});
