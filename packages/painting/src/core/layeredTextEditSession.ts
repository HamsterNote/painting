/**
 * 纯文本编辑会话状态机（layered text edit session）。
 *
 * 职责边界：唯一 owner 是会话本身，不持有 document / history / DOM / V2 / Skia；只 import
 * model/document.ts 的 Bounds / AffineTransform 类型并自行白名单校验；不做 controller 创建
 * 对象、allocator、DOM focus 或真实 IME。所有方法返回 Result，预期错误绝不 throw，失败不产生
 * 任何 mutation；输入永不被改写，begin/draft/target/candidate/snapshot 均深拷贝并冻结；
 * content 不做 trim / 规范化。
 *
 * 提交反馈约定：noop 与 delete 不产生新 objectId/revision 需求——noop 回执 id/rev 均为 null，
 * delete 回执携带既有 id 但 objectRevision 为 null；create/update 遵循单事务 +1 修订约定。
 */

import type { AffineTransform, Bounds } from '../model/document';

/** 会话内可替换的完整文字草稿；四个字段必填。 */
export type LayeredTextEditDraft = Readonly<{
  content: string;
  fontSize: number;
  color: string;
  localBounds: Bounds;
}>;

/** 草稿增量更新；只允许出现已定义的 known 字段。 */
export type LayeredTextEditDraftUpdate = Partial<LayeredTextEditDraft>;

/** 新建文字对象目标：锁定期望文档修订与初值变换。 */
type NewTarget = Readonly<{
  kind: 'new';
  expectedDocumentRevision: number;
  transform: AffineTransform;
}>;

/** 编辑既有文字对象目标：锁定期望文档修订与对象身份/修订。 */
type ExistingTarget = Readonly<{
  kind: 'existing';
  expectedDocumentRevision: number;
  objectId: string;
  expectedObjectRevision: number;
}>;

/** 文字编辑目标联合。 */
export type LayeredTextEditTarget = NewTarget | ExistingTarget;

/** 冻结候选：noop / create / update / delete；每个候选都携带其目标，便于 controller 校验文档修订。 */
export type LayeredTextEditCandidate =
  | Readonly<{ kind: 'noop'; target: NewTarget }>
  | Readonly<{ kind: 'create'; target: NewTarget; draft: LayeredTextEditDraft }>
  | Readonly<{ kind: 'update'; target: ExistingTarget; draft: LayeredTextEditDraft }>
  | Readonly<{ kind: 'delete'; target: ExistingTarget }>;

/** 提交失败原因。 */
type CommitFailureReason = 'stale-target' | 'allocation-failed' | 'revision-exhausted' | 'internal';

/** 会话提交反馈：失败原因或成功回执。 */
export type LayeredTextEditFeedback =
  | Readonly<{ type: 'commit-failed'; reason: CommitFailureReason }>
  | Readonly<{
      type: 'commit-succeeded';
      documentRevision: number;
      objectId: string | null;
      objectRevision: number | null;
    }>;

/** 会话只读快照。 */
export type LayeredTextEditSnapshot = Readonly<{
  status: 'editing' | 'awaiting-commit' | 'committed' | 'canceled';
  target: LayeredTextEditTarget;
  draft: LayeredTextEditDraft;
  isComposing: boolean;
  commitRequested: boolean;
  candidate: LayeredTextEditCandidate | null;
}>;

/** 会话预期错误码。 */
export type LayeredTextEditErrorCode =
  | 'invalid-input'
  | 'session-finalized'
  | 'composition-inactive'
  | 'candidate-not-ready'
  | 'feedback-mismatch';

/** 会话结果：成功携带值，失败携带错误码。 */
export type LayeredTextEditResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: LayeredTextEditErrorCode }> }>;

/** 文本编辑会话接口；实现由 beginLayeredTextEditSession 返回。 */
export interface LayeredTextEditSession {
  getSnapshot(): LayeredTextEditSnapshot;
  updateDraft(update: LayeredTextEditDraftUpdate): LayeredTextEditResult<void>;
  startComposition(): LayeredTextEditResult<void>;
  endComposition(
    finalUpdate: LayeredTextEditDraftUpdate & { content: string }
  ): LayeredTextEditResult<void>;
  requestCommit(): LayeredTextEditResult<void>;
  getCandidate(): LayeredTextEditResult<LayeredTextEditCandidate>;
  cancel(): LayeredTextEditResult<void>;
  applyCommitFeedback(feedback: LayeredTextEditFeedback): LayeredTextEditResult<void>;
}

/** 内部输入非法信号；仅在公开边界被转成 invalid-input Result。 */
class InvalidInputError extends Error {}

/** 抛出内部非法输入信号。 */
function invalid(): never {
  throw new InvalidInputError();
}

/** 普通对象（排除 null 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 自有属性判断，区分“缺失”与“显式 undefined”。 */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
function readString(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}
function readNonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) invalid();
  return value;
}
function readFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}
function readPositiveNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid();
  return value;
}
function readNonNegativeSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

/** 校验并冻结 bounds；四分量有限且有序（允许 zero-area）。 */
function readBounds(value: unknown): Bounds {
  if (!isRecord(value)) invalid();
  const minX = readFiniteNumber(value.minX);
  const minY = readFiniteNumber(value.minY);
  const maxX = readFiniteNumber(value.maxX);
  const maxY = readFiniteNumber(value.maxY);
  if (minX > maxX || minY > maxY) invalid();
  return Object.freeze({ minX, minY, maxX, maxY });
}

/** 校验并冻结仿射；六分量有限且行列式有限非 0。 */
function readTransform(value: unknown): AffineTransform {
  if (!isRecord(value)) invalid();
  const a = readFiniteNumber(value.a);
  const b = readFiniteNumber(value.b);
  const c = readFiniteNumber(value.c);
  const d = readFiniteNumber(value.d);
  const tx = readFiniteNumber(value.tx);
  const ty = readFiniteNumber(value.ty);
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) invalid();
  return Object.freeze({ a, b, c, d, tx, ty });
}

/** 校验并冻结完整草稿；content 不 trim。 */
function readDraft(value: unknown): LayeredTextEditDraft {
  if (!isRecord(value)) invalid();
  return Object.freeze({
    content: readString(value.content),
    fontSize: readPositiveNumber(value.fontSize),
    color: readNonEmptyString(value.color),
    localBounds: readBounds(value.localBounds),
  });
}

/** 校验并冻结目标。 */
function readTarget(value: unknown): LayeredTextEditTarget {
  if (!isRecord(value)) invalid();
  const expectedDocumentRevision = readNonNegativeSafeInteger(value.expectedDocumentRevision);
  if (value.kind === 'new') {
    return Object.freeze({
      kind: 'new',
      expectedDocumentRevision,
      transform: readTransform(value.transform),
    });
  }
  if (value.kind === 'existing') {
    return Object.freeze({
      kind: 'existing',
      expectedDocumentRevision,
      objectId: readNonEmptyString(value.objectId),
      expectedObjectRevision: readNonNegativeSafeInteger(value.expectedObjectRevision),
    });
  }
  return invalid();
}

/**
 * 校验增量更新：只收集已出现的 known 字段；显式 undefined 的 known 字段视为非法。
 * 返回仅含出现字段的冻结 patch。
 */
/** 可写的草稿 patch 内部形状；只收集出现的 known 字段。 */
type MutableDraftPatch = {
  content?: string;
  fontSize?: number;
  color?: string;
  localBounds?: Bounds;
};

function readDraftUpdate(value: unknown): Partial<LayeredTextEditDraft> {
  if (!isRecord(value)) invalid();
  const patch: MutableDraftPatch = {};
  if (hasOwn(value, 'content')) patch.content = readString(value.content);
  if (hasOwn(value, 'fontSize')) patch.fontSize = readPositiveNumber(value.fontSize);
  if (hasOwn(value, 'color')) patch.color = readNonEmptyString(value.color);
  if (hasOwn(value, 'localBounds')) patch.localBounds = readBounds(value.localBounds);
  return Object.freeze(patch);
}

/** 合并基础草稿与已验证 patch，返回新的冻结草稿。 */
function mergeDraft(
  base: LayeredTextEditDraft,
  patch: Partial<LayeredTextEditDraft>
): LayeredTextEditDraft {
  return Object.freeze({
    content: patch.content ?? base.content,
    fontSize: patch.fontSize ?? base.fontSize,
    color: patch.color ?? base.color,
    localBounds: patch.localBounds ?? base.localBounds,
  });
}

/** 可空非空字符串：null 原样，否则必须是非空字符串。 */
function readNullableNonEmptyString(value: unknown): string | null {
  return value === null ? null : readNonEmptyString(value);
}

/** 可空非负安全整数：null 原样，否则必须是 safe integer。 */
function readNullableSafeInteger(value: unknown): number | null {
  return value === null ? null : readNonNegativeSafeInteger(value);
}

/** 提交失败原因白名单。 */
const FAILURE_REASONS: readonly CommitFailureReason[] = [
  'stale-target',
  'allocation-failed',
  'revision-exhausted',
  'internal',
];

/** 校验反馈外形并冻结；不校验与候选的匹配性。 */
function readFeedbackShape(value: unknown): LayeredTextEditFeedback {
  if (!isRecord(value)) invalid();
  if (value.type === 'commit-failed') {
    const reason = value.reason;
    if (typeof reason !== 'string' || !FAILURE_REASONS.includes(reason as CommitFailureReason)) {
      invalid();
    }
    return Object.freeze({ type: 'commit-failed', reason: reason as CommitFailureReason });
  }
  if (value.type === 'commit-succeeded') {
    return Object.freeze({
      type: 'commit-succeeded',
      documentRevision: readNonNegativeSafeInteger(value.documentRevision),
      objectId: readNullableNonEmptyString(value.objectId),
      objectRevision: readNullableSafeInteger(value.objectRevision),
    });
  }
  return invalid();
}

/** 单事务约定：目标修订 +1 必须是安全整数；MAX_SAFE_INTEGER 无合法后继，返回 null（绝不 clamp）。 */
function nextSafeRevision(current: number): number | null {
  return current < Number.MAX_SAFE_INTEGER ? current + 1 : null;
}

/**
 * 校验成功回执是否与候选匹配（单事务约定）：
 * - noop：文档修订等于期望值，id/rev 均为 null；
 * - mutation：文档修订必须恰为 expectedDocumentRevision + 1，且不得溢出安全整数；
 * - create：id 非空且 objectRevision 恰为 1；
 * - update：id 与目标一致且 objectRevision 恰为 expectedObjectRevision + 1；
 * - delete：id 与目标一致且 objectRevision 为 null。
 * 溢出 MAX_SAFE_INTEGER 时无合法成功回执，只能失败（feedback-mismatch），不做 clamp。
 * 失败反馈始终视为匹配，便于 retry。
 */
function feedbackMatchesCandidate(
  feedback: LayeredTextEditFeedback,
  candidate: LayeredTextEditCandidate
): boolean {
  if (feedback.type === 'commit-failed') return true;
  const target = candidate.target;
  if (candidate.kind === 'noop') {
    return (
      feedback.documentRevision === target.expectedDocumentRevision &&
      feedback.objectId === null &&
      feedback.objectRevision === null
    );
  }
  if (feedback.documentRevision !== nextSafeRevision(target.expectedDocumentRevision)) return false;
  if (candidate.kind === 'create') {
    return feedback.objectId !== null && feedback.objectRevision === 1;
  }
  const existing = candidate.target;
  if (feedback.objectId !== existing.objectId) return false;
  if (candidate.kind === 'update') {
    const next = nextSafeRevision(existing.expectedObjectRevision);
    // next 为 null 表示 MAX_SAFE_INTEGER 无合法后继，不能把 objectRevision:null 误判为成功。
    return next !== null && feedback.objectRevision === next;
  }
  return feedback.objectRevision === null;
}

/** 判断两次成功回执是否完全一致（用于重复 success 幂等判定）。 */
function sameSucceededReceipt(a: LayeredTextEditFeedback, b: LayeredTextEditFeedback): boolean {
  if (a.type !== 'commit-succeeded' || b.type !== 'commit-succeeded') return false;
  return (
    a.documentRevision === b.documentRevision &&
    a.objectId === b.objectId &&
    a.objectRevision === b.objectRevision
  );
}

/** 成功 Result 构造 helper。 */
function ok<T>(value: T): LayeredTextEditResult<T> {
  return Object.freeze({ ok: true as const, value });
}

/** 失败 Result 构造 helper。 */
function err(code: LayeredTextEditErrorCode): LayeredTextEditResult<never> {
  return Object.freeze({ ok: false as const, error: Object.freeze({ code }) });
}

/** 空成功 Result。 */
function okVoid(): LayeredTextEditResult<void> {
  return ok(undefined);
}

/** 把内部非法输入信号转为 invalid-input；其他异常继续抛出。 */
function asInvalidInput(error: unknown): LayeredTextEditResult<never> {
  if (error instanceof InvalidInputError) return err('invalid-input');
  throw error;
}

/** 会话状态别名。 */
type SessionStatus = LayeredTextEditSnapshot['status'];

/** 依据目标与草稿推导候选：new 的内容为空 → noop，否则 create；existing 的内容为空 → delete，否则 update。 */
function computeCandidate(
  target: LayeredTextEditTarget,
  draft: LayeredTextEditDraft
): LayeredTextEditCandidate {
  if (target.kind === 'new') {
    return draft.content === ''
      ? Object.freeze({ kind: 'noop' as const, target })
      : Object.freeze({ kind: 'create' as const, target, draft });
  }
  return draft.content === ''
    ? Object.freeze({ kind: 'delete' as const, target })
    : Object.freeze({ kind: 'update' as const, target, draft });
}

/** 组装纯内存会话；target/draft 调用前已完成深拷贝冻结。 */
function createSession(
  target: LayeredTextEditTarget,
  initialDraft: LayeredTextEditDraft
): LayeredTextEditSession {
  let status: SessionStatus = 'editing';
  let draft = initialDraft;
  let isComposing = false;
  let commitRequested = false;
  let candidate: LayeredTextEditCandidate | null = null;
  let receipt: LayeredTextEditFeedback | null = null;

  function getSnapshot(): LayeredTextEditSnapshot {
    return Object.freeze({ status, target, draft, isComposing, commitRequested, candidate });
  }

  function updateDraft(update: LayeredTextEditDraftUpdate): LayeredTextEditResult<void> {
    if (status !== 'editing') return err('session-finalized');
    let merged: LayeredTextEditDraft;
    try {
      merged = mergeDraft(draft, readDraftUpdate(update));
    } catch (error) {
      return asInvalidInput(error);
    }
    draft = merged;
    return okVoid();
  }

  function startComposition(): LayeredTextEditResult<void> {
    if (status !== 'editing') return err('session-finalized');
    // 重复 startComposition 幂等成功（composition 已在进行中）。
    if (isComposing) return okVoid();
    isComposing = true;
    return okVoid();
  }

  function endComposition(
    finalUpdate: LayeredTextEditDraftUpdate & { content: string }
  ): LayeredTextEditResult<void> {
    if (status !== 'editing') return err('session-finalized');
    if (!isComposing) return err('composition-inactive');
    let merged: LayeredTextEditDraft;
    try {
      // 运行时守卫：final 必须携带已定义的 content，且整包先校验再落状态。
      if (!isRecord(finalUpdate) || !hasOwn(finalUpdate, 'content')) invalid();
      const patch = readDraftUpdate(finalUpdate);
      if (typeof patch.content !== 'string') invalid();
      merged = mergeDraft(draft, patch);
    } catch (error) {
      return asInvalidInput(error);
    }
    // 全部校验通过后才原子应用；invalid final 时 isComposing/draft 保持不变。
    draft = merged;
    isComposing = false;
    if (commitRequested) {
      candidate = computeCandidate(target, draft);
      status = 'awaiting-commit';
    }
    return okVoid();
  }

  function requestCommit(): LayeredTextEditResult<void> {
    if (status === 'awaiting-commit') return okVoid();
    if (status !== 'editing') return err('session-finalized');
    commitRequested = true;
    // composing 期间仅挂起；非 composing 立即冻结候选，但不提前 committed。
    if (!isComposing) {
      candidate = computeCandidate(target, draft);
      status = 'awaiting-commit';
    }
    return okVoid();
  }

  function getCandidate(): LayeredTextEditResult<LayeredTextEditCandidate> {
    if (!candidate) return err('candidate-not-ready');
    return ok(candidate);
  }

  function cancel(): LayeredTextEditResult<void> {
    if (status === 'canceled') return okVoid();
    if (status !== 'editing' && status !== 'awaiting-commit') return err('session-finalized');
    candidate = null;
    commitRequested = false;
    // 取消同时清理 composition / preview 标志，但 committed 仍不可回滚。
    isComposing = false;
    status = 'canceled';
    return okVoid();
  }

  function applyCommitFeedback(feedback: LayeredTextEditFeedback): LayeredTextEditResult<void> {
    let shape: LayeredTextEditFeedback;
    try {
      shape = readFeedbackShape(feedback);
    } catch (error) {
      return asInvalidInput(error);
    }
    if (status === 'committed') {
      // 重复 success 同 receipt 幂等成功；其余一律明确 session-finalized，不回退。
      if (receipt && shape.type === 'commit-succeeded' && sameSucceededReceipt(shape, receipt)) {
        return okVoid();
      }
      return err('session-finalized');
    }
    if (status === 'canceled') return err('session-finalized');
    if (status === 'editing') return err('candidate-not-ready');
    const active = candidate;
    if (!active) return err('candidate-not-ready');
    // stale / 不匹配回执不改 target、不清候选，可安全 retry。
    if (!feedbackMatchesCandidate(shape, active)) return err('feedback-mismatch');
    if (shape.type === 'commit-succeeded') {
      // 成功才进入 committed；失败回执保持同候选与 awaiting-commit。
      receipt = shape;
      status = 'committed';
    }
    return okVoid();
  }

  return Object.freeze({
    getSnapshot,
    updateDraft,
    startComposition,
    endComposition,
    requestCommit,
    getCandidate,
    cancel,
    applyCommitFeedback,
  });
}

/** 开始纯文字编辑会话；target/draft 非法时返回 invalid-input Result（不 throw、不创建会话）。 */
export function beginLayeredTextEditSession(
  target: LayeredTextEditTarget,
  draft: LayeredTextEditDraft
): LayeredTextEditResult<LayeredTextEditSession> {
  try {
    return ok(createSession(readTarget(target), readDraft(draft)));
  } catch (error) {
    return asInvalidInput(error);
  }
}
