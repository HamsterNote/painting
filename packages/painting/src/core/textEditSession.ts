import { DRAWING_STROKE_SCHEMA_VERSION, type DrawingPointV2, type DrawingValueV2 } from '../model/strokes';

/** 文本编辑期间可替换的草稿字段；字符串不做 trim、规范化或测量修正。 */
export type TextEditDraft = Readonly<{
  text: string;
  measuredHeight?: number;
  points?: readonly DrawingPointV2[];
  strokeColor?: string;
  strokeWidth?: number;
  dashArray?: readonly number[];
  dashOffset?: number;
  fillColor?: string;
  fillOpacity?: number;
  rotationRad?: number;
  fontSize?: number;
}>;

/** 编辑既有文本时锁定的有序目标，避免重复 ID 被错误命中。 */
export type ExistingTextEditTarget = Readonly<{
  index: number;
  expectedStrokeId: string;
  expectedTool: 'text';
}>;

/** 创建新文本笔迹所需的稳定 ID 与基础几何。 */
export type NewTextEditTarget = Readonly<{
  id: string;
  points: readonly DrawingPointV2[];
  fontSize: number;
}>;

export type TextEditSession = Readonly<{
  target: ExistingTextEditTarget | NewTextEditTarget;
  mode: 'existing' | 'new';
  draft: TextEditDraft;
  isComposing: boolean;
  commitRequested: boolean;
  status: 'editing' | 'committed' | 'cancelled';
}>;

export type TextEditSessionDiagnostic = Readonly<{
  type: 'commit-not-requested' | 'composition-active' | 'stale-target' | 'session-finalized';
}>;

/** 文本提交结果。草稿与 composing 转换不会产生此类 document 写入。 */
export type CommitTextEditSessionResult = Readonly<{
  document: DrawingValueV2;
  session: TextEditSession;
  diagnostics: readonly TextEditSessionDiagnostic[];
}>;

const NO_DIAGNOSTICS: readonly TextEditSessionDiagnostic[] = Object.freeze([]);

function copyPoints(points: readonly DrawingPointV2[]): DrawingPointV2[] {
  return points.map((point) => ({ ...point }));
}

function toEditableDraft(draft: TextEditDraft): TextEditDraft {
  return {
    text: draft.text,
    ...(draft.measuredHeight === undefined ? {} : { measuredHeight: draft.measuredHeight }),
    ...(draft.points === undefined ? {} : { points: copyPoints(draft.points) }),
    ...(draft.strokeColor === undefined ? {} : { strokeColor: draft.strokeColor }),
    ...(draft.strokeWidth === undefined ? {} : { strokeWidth: draft.strokeWidth }),
    ...(draft.dashArray === undefined ? {} : { dashArray: [...draft.dashArray] }),
    ...(draft.dashOffset === undefined ? {} : { dashOffset: draft.dashOffset }),
    ...(draft.fillColor === undefined ? {} : { fillColor: draft.fillColor }),
    ...(draft.fillOpacity === undefined ? {} : { fillOpacity: draft.fillOpacity }),
    ...(draft.rotationRad === undefined ? {} : { rotationRad: draft.rotationRad }),
    ...(draft.fontSize === undefined ? {} : { fontSize: draft.fontSize }),
  };
}

function withStatus(session: TextEditSession, status: TextEditSession['status']): TextEditSession {
  return { ...session, status };
}

/** 从新笔迹目标开始纯文本编辑会话。 */
export function beginNewTextEditSession(target: NewTextEditTarget, draft: TextEditDraft): TextEditSession {
  return {
    target: { id: target.id, points: copyPoints(target.points), fontSize: target.fontSize },
    mode: 'new',
    draft: toEditableDraft(draft),
    isComposing: false,
    commitRequested: false,
    status: 'editing',
  };
}

/** 从显式 index/ID/tool 三元组开始既有文本编辑会话。 */
export function beginExistingTextEditSession(
  target: ExistingTextEditTarget,
  draft: TextEditDraft
): TextEditSession {
  return {
    target: { ...target },
    mode: 'existing',
    draft: toEditableDraft(draft),
    isComposing: false,
    commitRequested: false,
    status: 'editing',
  };
}

/** 替换草稿的给定字段。已结束会话不可重新打开。 */
export function updateTextEditDraft(
  session: TextEditSession,
  update: Partial<TextEditDraft>
): TextEditSession {
  if (session.status !== 'editing') {
    return session;
  }

  // 外部未类型化调用即使传入 text: undefined，也不能破坏 session 的 string 不变量。
  return {
    ...session,
    draft: toEditableDraft({ ...session.draft, ...update, text: update.text ?? session.draft.text }),
  };
}

/** 标记输入法 composition 开始；它不会写入 document。 */
export function startTextEditComposition(session: TextEditSession): TextEditSession {
  return session.status === 'editing' && !session.isComposing ? { ...session, isComposing: true } : session;
}

/** 标记 composition 结束。已挂起的提交现在可由 commit 消费。 */
export function endTextEditComposition(session: TextEditSession): TextEditSession {
  return session.status === 'editing' && session.isComposing ? { ...session, isComposing: false } : session;
}

/** 请求一次提交；composition 期间仅挂起请求，绝不写入 document。 */
export function requestTextEditCommit(session: TextEditSession): TextEditSession {
  return session.status === 'editing' && !session.commitRequested
    ? { ...session, commitRequested: true }
    : session;
}

/** 取消会话。它不接触 document，且已结束会话保持幂等。 */
export function cancelTextEditSession(session: TextEditSession): TextEditSession {
  return session.status === 'editing' ? withStatus(session, 'cancelled') : session;
}

function finalResult(
  document: DrawingValueV2,
  session: TextEditSession,
  type: TextEditSessionDiagnostic['type']
): CommitTextEditSessionResult {
  return { document, session, diagnostics: [{ type }] };
}

/**
 * 消费已请求且不在 composition 中的提交。
 *
 * 成功或空草稿都会结束会话，因而同一 session 最多造成一次写入。既有目标必须同时匹配
 * index、ID 与 tool；任一不匹配均返回 stale diagnostic 并严格保留 document 引用。
 */
export function commitTextEditSession(
  document: DrawingValueV2,
  session: TextEditSession
): CommitTextEditSessionResult {
  if (session.status !== 'editing') {
    return finalResult(document, session, 'session-finalized');
  }
  if (!session.commitRequested) {
    return finalResult(document, session, 'commit-not-requested');
  }
  if (session.isComposing) {
    return finalResult(document, session, 'composition-active');
  }

  const completed = withStatus(session, 'committed');
  if (session.mode === 'new') {
    if (session.draft.text.length === 0) {
      return { document, session: completed, diagnostics: NO_DIAGNOSTICS };
    }

    const target = session.target as NewTextEditTarget;
    const stroke = {
      schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
      id: target.id,
      tool: 'text' as const,
      points: copyPoints(session.draft.points ?? target.points),
      text: session.draft.text,
      fontSize: session.draft.fontSize ?? target.fontSize,
      ...(session.draft.strokeColor === undefined ? {} : { strokeColor: session.draft.strokeColor }),
      ...(session.draft.strokeWidth === undefined ? {} : { strokeWidth: session.draft.strokeWidth }),
      ...(session.draft.dashArray === undefined ? {} : { dashArray: [...session.draft.dashArray] }),
      ...(session.draft.dashOffset === undefined ? {} : { dashOffset: session.draft.dashOffset }),
      ...(session.draft.fillColor === undefined ? {} : { fillColor: session.draft.fillColor }),
      ...(session.draft.fillOpacity === undefined ? {} : { fillOpacity: session.draft.fillOpacity }),
      ...(session.draft.rotationRad === undefined ? {} : { rotationRad: session.draft.rotationRad }),
    };
    return {
      document: { schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes: [...document.strokes, stroke] },
      session: completed,
      diagnostics: NO_DIAGNOSTICS,
    };
  }

  const target = session.target as ExistingTextEditTarget;
  const current = document.strokes[target.index];
  if (current?.id !== target.expectedStrokeId || current?.tool !== target.expectedTool) {
    // stale 也消费此次请求，避免调用方在同一会话上重放并写入已变化的 document。
    return finalResult(document, completed, 'stale-target');
  }
  if (session.draft.text.length === 0) {
    return {
      document: {
        schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
        strokes: [...document.strokes.slice(0, target.index), ...document.strokes.slice(target.index + 1)],
      },
      session: completed,
      diagnostics: NO_DIAGNOSTICS,
    };
  }

  const replacement = {
    ...current,
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    text: session.draft.text,
    ...(session.draft.points === undefined ? {} : { points: copyPoints(session.draft.points) }),
    ...(session.draft.strokeColor === undefined ? {} : { strokeColor: session.draft.strokeColor }),
    ...(session.draft.strokeWidth === undefined ? {} : { strokeWidth: session.draft.strokeWidth }),
    ...(session.draft.dashArray === undefined ? {} : { dashArray: [...session.draft.dashArray] }),
    ...(session.draft.dashOffset === undefined ? {} : { dashOffset: session.draft.dashOffset }),
    ...(session.draft.fillColor === undefined ? {} : { fillColor: session.draft.fillColor }),
    ...(session.draft.fillOpacity === undefined ? {} : { fillOpacity: session.draft.fillOpacity }),
    ...(session.draft.rotationRad === undefined ? {} : { rotationRad: session.draft.rotationRad }),
    ...(session.draft.fontSize === undefined ? {} : { fontSize: session.draft.fontSize }),
  };
  const strokes = [...document.strokes];
  strokes[target.index] = replacement;
  return {
    document: { schemaVersion: DRAWING_STROKE_SCHEMA_VERSION, strokes },
    session: completed,
    diagnostics: NO_DIAGNOSTICS,
  };
}
