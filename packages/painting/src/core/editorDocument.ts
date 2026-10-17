import type { DrawingPointV2, DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';
import {
  transformSelection,
  type DocumentStrokeReplacement,
  type DocumentStrokeTarget,
  type SelectionTransformDiagnostic,
} from './selectionTransform';
import type { SelectionGestureIntent } from './gesture/session';

export type { DocumentStrokeReplacement, DocumentStrokeTarget } from './selectionTransform';

/** 编辑器运行期的文档版本；revision 不属于持久化 DrawingValueV2 schema。 */
export type EditorDocumentState = Readonly<{
  document: DrawingValueV2;
  revision: number;
}>;

export type EditorDocumentCommand =
  | Readonly<{ type: 'append-stroke'; expectedRevision: number; stroke: DrawingStrokeV2 }>
  | Readonly<{
      type: 'replace-strokes';
      expectedRevision: number;
      replacements: readonly DocumentStrokeReplacement[];
    }>
  | Readonly<{
      type: 'remove-strokes';
      expectedRevision: number;
      targets: readonly DocumentStrokeTarget[];
    }>
  | Readonly<{ type: 'clear-strokes'; expectedRevision: number }>
  | Readonly<{
      type: 'apply-selection-transform';
      expectedRevision: number;
      targets: readonly DocumentStrokeTarget[];
      intent: SelectionGestureIntent;
    }>;

export type EditorDocumentDiagnostic =
  | Readonly<{ type: 'revision-mismatch'; expectedRevision: number; actualRevision: number }>
  | Readonly<{ type: 'document-target-mismatch'; target: DocumentStrokeTarget }>
  | Readonly<{ type: 'duplicate-document-target'; index: number }>
  | SelectionTransformDiagnostic;

export type ApplyEditorDocumentCommandResult = Readonly<{
  state: EditorDocumentState;
  diagnostics: readonly EditorDocumentDiagnostic[];
}>;

/**
 * 未提交 selection 的唯一物化文档快照。它沿用正式命令的 revision、target 与重复目标规则，
 * 但不会写入 revision 或 history；renderer 应直接读取 `document`，不能自行应用 replacement。
 */
export type EditorDocumentPreview = Readonly<{
  document: DrawingValueV2;
  diagnostics: readonly EditorDocumentDiagnostic[];
}>;

function targetMatches(stroke: DrawingStrokeV2 | undefined, target: DocumentStrokeTarget): boolean {
  return (
    stroke !== undefined &&
    Number.isInteger(target.index) &&
    target.index >= 0 &&
    stroke.id === target.expectedId &&
    (target.expectedTool === undefined || stroke.tool === target.expectedTool)
  );
}

function copyPoint(point: DrawingPointV2): DrawingPointV2 {
  return { ...point };
}

function copyStroke(stroke: DrawingStrokeV2): DrawingStrokeV2 {
  // 成功写入的外部 stroke 深复制可变数组，避免未来调用方改动输入而回写 editor state。
  return {
    ...stroke,
    points: stroke.points.map(copyPoint),
    ...(stroke.dashArray ? { dashArray: [...stroke.dashArray] } : {}),
  } as DrawingStrokeV2;
}

function freezeStroke(stroke: DrawingStrokeV2): DrawingStrokeV2 {
  return Object.freeze({
    ...stroke,
    points: Object.freeze(
      stroke.points.map((point) => Object.freeze(copyPoint(point)))
    ) as DrawingPointV2[],
    ...(stroke.dashArray ? { dashArray: Object.freeze([...stroke.dashArray]) as number[] } : {}),
  }) as DrawingStrokeV2;
}

function freezeDocument(document: DrawingValueV2): DrawingValueV2 {
  return Object.freeze({
    ...document,
    strokes: Object.freeze(document.strokes.map(freezeStroke)) as DrawingStrokeV2[],
  }) as DrawingValueV2;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        valuesEqual(leftRecord[key], rightRecord[key])
    )
  );
}

function validateTargets(
  document: DrawingValueV2,
  targets: readonly DocumentStrokeTarget[]
): EditorDocumentDiagnostic | null {
  const seenIndexes = new Set<number>();
  for (const target of targets) {
    if (seenIndexes.has(target.index)) {
      return { type: 'duplicate-document-target', index: target.index };
    }
    seenIndexes.add(target.index);
    if (!targetMatches(document.strokes[target.index], target)) {
      return { type: 'document-target-mismatch', target };
    }
  }
  return null;
}

function committedState(state: EditorDocumentState, document: DrawingValueV2): EditorDocumentState {
  return { document, revision: state.revision + 1 };
}

function noChange(
  state: EditorDocumentState,
  diagnostics: readonly EditorDocumentDiagnostic[] = []
): ApplyEditorDocumentCommandResult {
  return { state, diagnostics };
}

function applyReplacements(
  state: EditorDocumentState,
  replacements: readonly DocumentStrokeReplacement[]
): ApplyEditorDocumentCommandResult {
  if (replacements.length === 0) {
    return noChange(state);
  }
  const targetDiagnostic = validateTargets(
    state.document,
    replacements.map(({ target }) => target)
  );
  if (targetDiagnostic) {
    return noChange(state, [targetDiagnostic]);
  }
  if (
    replacements.every(({ target, stroke }) =>
      valuesEqual(state.document.strokes[target.index], stroke)
    )
  ) {
    return noChange(state);
  }

  const strokes = [...state.document.strokes];
  for (const replacement of replacements) {
    strokes[replacement.target.index] = copyStroke(replacement.stroke);
  }
  return { state: committedState(state, { ...state.document, strokes }), diagnostics: [] };
}

/** 创建非持久编辑器状态，不复制 document，也不改变外部文档。 */
export function createEditorDocumentState(
  document: DrawingValueV2,
  revision = 0
): EditorDocumentState {
  return { document, revision };
}

/**
 * 原子执行单个 revision-aware 编辑命令。
 *
 * revision 或任一 target 不匹配时直接返回原 state 引用；成功命令仅在 document 真正变更时
 * 增加 revision。history、手势预览和持久化由上层负责。
 */
export function applyEditorDocumentCommand(
  state: EditorDocumentState,
  command: EditorDocumentCommand
): ApplyEditorDocumentCommandResult {
  if (command.expectedRevision !== state.revision) {
    return noChange(state, [
      {
        type: 'revision-mismatch',
        expectedRevision: command.expectedRevision,
        actualRevision: state.revision,
      },
    ]);
  }

  if (command.type === 'append-stroke') {
    const document: DrawingValueV2 = {
      ...state.document,
      strokes: [...state.document.strokes, copyStroke(command.stroke)],
    };
    return { state: committedState(state, document), diagnostics: [] };
  }

  if (command.type === 'replace-strokes') {
    return applyReplacements(state, command.replacements);
  }

  if (command.type === 'remove-strokes') {
    if (command.targets.length === 0) {
      return noChange(state);
    }
    const targetDiagnostic = validateTargets(state.document, command.targets);
    if (targetDiagnostic) {
      return noChange(state, [targetDiagnostic]);
    }
    const removedIndexes = new Set(command.targets.map(({ index }) => index));
    const strokes = state.document.strokes.filter((_, index) => !removedIndexes.has(index));
    return { state: committedState(state, { ...state.document, strokes }), diagnostics: [] };
  }

  if (command.type === 'clear-strokes') {
    return state.document.strokes.length === 0
      ? noChange(state)
      : { state: committedState(state, { ...state.document, strokes: [] }), diagnostics: [] };
  }

  const transformed = transformSelection(state.document, command.targets, command.intent);
  if (transformed.diagnostics.length > 0) {
    return noChange(state, transformed.diagnostics);
  }
  return applyReplacements(state, transformed.replacements);
}

/**
 * 在不提交的前提下物化一条 revision-aware 命令的结果。
 *
 * 此函数刻意复用 `applyEditorDocumentCommand`，以保证 preview 与最终提交对 stale revision、
 * duplicate target、replacement copy 及 no-op 的判断完全相同。任何拒绝或 no-op 都不产生 preview。
 */
export function materializeEditorDocumentPreview(
  state: EditorDocumentState,
  command: EditorDocumentCommand
): EditorDocumentPreview | null {
  const applied = applyEditorDocumentCommand(state, command);
  return applied.state.revision === state.revision + 1
    ? Object.freeze({
        document: freezeDocument(applied.state.document),
        diagnostics: Object.freeze([...applied.diagnostics]),
      })
    : null;
}
