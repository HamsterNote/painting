import type { DrawingPointV2, DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';
import {
  applyEditorDocumentCommand,
  createEditorDocumentState,
  type EditorDocumentCommand,
  type EditorDocumentDiagnostic,
  type EditorDocumentState,
} from './editorDocument';
import type { DocumentStrokeTarget } from './selectionTransform';
import type { SelectionGestureIntent } from './gesture/session';

/** 运行时只保存已提交的不可变文档 snapshot；栈尾是下一次 undo/redo 的目标。 */
export type EditorHistoryState = Readonly<{
  undoStack: readonly EditorDocumentState[];
  redoStack: readonly EditorDocumentState[];
}>;

/** 非持久编辑运行时。revision 仅位于 documentState，绝不会写入 DrawingValueV2。 */
export type EditorRuntimeState = EditorHistoryState &
  Readonly<{
    documentState: EditorDocumentState;
  }>;

export type EditorRuntimeDiagnostic =
  | EditorDocumentDiagnostic
  | Readonly<{ type: 'cannot-undo' }>
  | Readonly<{ type: 'cannot-redo' }>
  | Readonly<{ type: 'invalid-editor-command' }>
  | Readonly<{ type: 'invalid-editor-document' }>
  | Readonly<{ type: 'editor-document-noop' }>;

export type EditorRuntimeResult = Readonly<{
  state: EditorRuntimeState;
  diagnostics: readonly EditorRuntimeDiagnostic[];
}>;

export type CreateEditorRuntimeOptions = Readonly<{
  /** 为恢复已有运行时而提供；缺省 revision 为 0。 */
  revision?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPointLike(value: unknown): boolean {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isTargetLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.index === 'number' &&
    typeof value.expectedId === 'string' &&
    (value.expectedTool === undefined || typeof value.expectedTool === 'string')
  );
}

function isStrokeLike(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.points);
}

function isDrawingDocumentLike(value: unknown): value is DrawingValueV2 {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    Array.isArray(value.strokes) &&
    value.strokes.every(isStrokeLike)
  );
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

function isSelectionIntentLike(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'move') {
    return isPointLike(value.delta);
  }
  if (value.kind === 'rotate') {
    return isPointLike(value.pivot) && typeof value.deltaRad === 'number';
  }
  if (value.kind === 'uniform-scale') {
    return isPointLike(value.anchor) && typeof value.scale === 'number';
  }
  return (
    value.kind === 'resize' &&
    isPointLike(value.anchor) &&
    isRecord(value.axis) &&
    isRecord(value.scale) &&
    typeof value.scale.x === 'number' &&
    typeof value.scale.y === 'number'
  );
}

function isEditorDocumentCommand(value: unknown): value is EditorDocumentCommand {
  const expectedRevision = isRecord(value) ? value.expectedRevision : undefined;
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return false;
  }
  if (value.type === 'append-stroke') {
    return isStrokeLike(value.stroke);
  }
  if (value.type === 'replace-strokes') {
    return (
      Array.isArray(value.replacements) &&
      value.replacements.every(
        (replacement) =>
          isRecord(replacement) &&
          isTargetLike(replacement.target) &&
          isStrokeLike(replacement.stroke)
      )
    );
  }
  if (value.type === 'remove-strokes') {
    return Array.isArray(value.targets) && value.targets.every(isTargetLike);
  }
  if (value.type === 'clear-strokes') {
    return true;
  }
  return (
    value.type === 'apply-selection-transform' &&
    Array.isArray(value.targets) &&
    value.targets.every(isTargetLike) &&
    isSelectionIntentLike(value.intent)
  );
}

function copyPoint(point: DrawingPointV2): DrawingPointV2 {
  return Object.freeze({ ...point });
}

function copyStroke(stroke: DrawingStrokeV2): DrawingStrokeV2 {
  const copy = {
    ...stroke,
    points: Object.freeze(stroke.points.map(copyPoint)),
    ...(stroke.dashArray ? { dashArray: Object.freeze([...stroke.dashArray]) } : {}),
  } as DrawingStrokeV2;
  return Object.freeze(copy);
}

function createSnapshot(document: DrawingValueV2, revision: number): EditorDocumentState {
  const snapshot = Object.freeze({
    ...document,
    strokes: Object.freeze(document.strokes.map(copyStroke)),
  }) as unknown as DrawingValueV2;
  return Object.freeze(createEditorDocumentState(snapshot, revision));
}

/**
 * append 快路径的结构共享：复用 prior snapshot 中既有的冻结 stroke 引用，
 * 只对 command 结果里新追加的那一条做复制 + 冻结。
 *
 * commandDocument 由 applyEditorDocumentCommand 生成，其 append 分支已对 command.stroke
 * 做过深拷贝（copyStroke），因此这里不会读取外部可变的 command 引用；追加结果必然使
 * revision 恰好 +1，调用方已校验。
 *
 * 适用范围限制：本快路径只覆盖 `applyEditorRuntimeCommand` 的离散 `append-stroke` 命令
 * （见 editorInteraction.ts 的普通命令入口）。正式 pen pointerup / 手势 document-commit
 * 走的是 `commitEditorRuntimeDocument`（editorInteraction.ts 约 452 行），它仍保持整体
 * 深拷贝+冻结，不使用本路径。因此本函数不是终端落笔性能修复，仅优化命令式 append 通道。
 */
function createAppendSnapshot(
  previous: EditorDocumentState,
  commandDocument: DrawingValueV2,
  revision: number
): EditorDocumentState {
  const appended = commandDocument.strokes[commandDocument.strokes.length - 1];
  const strokes = Object.freeze([
    ...previous.document.strokes,
    copyStroke(appended),
  ]) as DrawingStrokeV2[];
  const document = Object.freeze({ ...commandDocument, strokes }) as unknown as DrawingValueV2;
  return Object.freeze(createEditorDocumentState(document, revision));
}

function createRuntimeState(
  documentState: EditorDocumentState,
  undoStack: readonly EditorDocumentState[],
  redoStack: readonly EditorDocumentState[]
): EditorRuntimeState {
  return Object.freeze({
    documentState,
    undoStack: Object.freeze([...undoStack]),
    redoStack: Object.freeze([...redoStack]),
  });
}

function noChange(
  state: EditorRuntimeState,
  diagnostics: readonly EditorRuntimeDiagnostic[] = []
): EditorRuntimeResult {
  return { state, diagnostics };
}

/** 创建纯 runtime；输入 document 会被复制为冻结 snapshot，防止后续外部数组修改泄露。 */
export function createEditorRuntimeState(
  document: DrawingValueV2,
  options: CreateEditorRuntimeOptions = {}
): EditorRuntimeState {
  const revision = options.revision ?? 0;
  const safeRevision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  return createRuntimeState(createSnapshot(document, safeRevision), [], []);
}

/**
 * 运行一条离散 document 命令。仅 document revision 恰好递增时记录一个 undo snapshot，
 * 并在该真实提交时清空 redo 分支；所有诊断都原样交给调用方而不抛出异常。
 */
export function applyEditorRuntimeCommand(
  state: EditorRuntimeState,
  command: EditorDocumentCommand
): EditorRuntimeResult {
  if (!isEditorDocumentCommand(command)) {
    return noChange(state, [{ type: 'invalid-editor-command' }]);
  }
  const commandResult = applyEditorDocumentCommand(state.documentState, command);
  if (commandResult.state.revision !== state.documentState.revision + 1) {
    return noChange(state, commandResult.diagnostics);
  }
  // append 走结构共享快路径；其余命令维持原有的整体深拷贝语义。
  // 注意：仅覆盖命令式 append-stroke 通道；pen pointerup 的 commitEditorRuntimeDocument
  // 仍是整体深拷贝（见下方 commitEditorRuntimeDocument），故本条不改变终端落笔性能契约。
  const nextDocumentState =
    command.type === 'append-stroke'
      ? createAppendSnapshot(
          state.documentState,
          commandResult.state.document,
          commandResult.state.revision
        )
      : createSnapshot(commandResult.state.document, commandResult.state.revision);
  return {
    state: createRuntimeState(nextDocumentState, [...state.undoStack, state.documentState], []),
    diagnostics: commandResult.diagnostics,
  };
}

/**
 * 将完整 document 作为一条离散、revision-checked 的 history 提交。
 *
 * 它只用于受信任的纯 core producer（例如 GestureSession 的 document-commit effect）；
 * 未匹配 revision 或结构无变化都不会覆盖当前 snapshot 或改变 history。
 *
 * 该路径是正式 pen pointerup 的落笔提交入口；它刻意保持对完整 document 的深拷贝+冻结
 * （createSnapshot），不做 append 前缀结构共享，因此性能特征与本文件命令式 append 快路径无关。
 */
export function commitEditorRuntimeDocument(
  state: EditorRuntimeState,
  expectedRevision: number,
  document: DrawingValueV2
): EditorRuntimeResult {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !isDrawingDocumentLike(document)
  ) {
    return noChange(state, [{ type: 'invalid-editor-document' }]);
  }
  if (expectedRevision !== state.documentState.revision) {
    return noChange(state, [
      {
        type: 'revision-mismatch',
        expectedRevision,
        actualRevision: state.documentState.revision,
      },
    ]);
  }
  if (valuesEqual(state.documentState.document, document)) {
    return noChange(state, [{ type: 'editor-document-noop' }]);
  }
  const nextDocumentState = createSnapshot(document, expectedRevision + 1);
  return {
    state: createRuntimeState(nextDocumentState, [...state.undoStack, state.documentState], []),
    diagnostics: [],
  };
}

/** 将一个 selection intent 包装为单条原子 document 命令，因此它只会生成一个 history 单元。 */
export function commitSelectionIntent(
  state: EditorRuntimeState,
  targets: readonly DocumentStrokeTarget[],
  intent: SelectionGestureIntent
): EditorRuntimeResult {
  return applyEditorRuntimeCommand(state, {
    type: 'apply-selection-transform',
    expectedRevision: state.documentState.revision,
    targets,
    intent,
  });
}

/** 回到最近一次真实离散提交；空 undo 栈只返回明确诊断。 */
export function undoEditorRuntime(state: EditorRuntimeState): EditorRuntimeResult {
  const previous = state.undoStack[state.undoStack.length - 1];
  if (!previous) {
    return noChange(state, [{ type: 'cannot-undo' }]);
  }
  return {
    state: createRuntimeState(previous, state.undoStack.slice(0, -1), [
      ...state.redoStack,
      state.documentState,
    ]),
    diagnostics: [],
  };
}

/** 重放最近被撤销的一条离散提交；空 redo 栈只返回明确诊断。 */
export function redoEditorRuntime(state: EditorRuntimeState): EditorRuntimeResult {
  const next = state.redoStack[state.redoStack.length - 1];
  if (!next) {
    return noChange(state, [{ type: 'cannot-redo' }]);
  }
  return {
    state: createRuntimeState(
      next,
      [...state.undoStack, state.documentState],
      state.redoStack.slice(0, -1)
    ),
    diagnostics: [],
  };
}
