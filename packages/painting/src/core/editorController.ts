import type { DrawingPointV2, DrawingStrokeV2, DrawingToolModeV2, DrawingValueV2 } from '../model/strokes';
import {
  beginEditorGesture,
  commitEditorInteractionDocument,
  commitEditorInteractionCommand,
  createEditorInteractionState,
  reduceEditorGesture,
  redoEditorInteraction,
  setEditorInteractionTool,
  setEditorSelection,
  undoEditorInteraction,
  type CreateEditorInteractionOptions,
  type EditorInteractionDiagnostic,
  type EditorInteractionResult,
  type EditorInteractionState,
} from './editorInteraction';
import {
  addEditorToolVertex,
  beginEditorToolPointer,
  cancelEditorToolSession,
  createEditorToolSession,
  finishEditorBezier,
  finishEditorPolygon,
  finishEditorToolPointer,
  moveEditorToolPointer,
  type EditorToolCreateId,
  type EditorToolSession,
  type EditorToolSessionDiagnostic,
  type EditorToolStrokeStyle,
} from './editorToolSession';
import type { EditorRuntimeDiagnostic } from './editorRuntime';
import type { DrawingFrame } from './drawingFrame';
import type { EditorDocumentCommand } from './editorDocument';
import type { NormalizedPointerInput } from './input';
import {
  queryEraserStrokeTargets,
  queryDrawingFrameEraserTargets,
  queryDrawingFrameLassoTargets,
  queryLassoStrokeTargets,
  type DrawingFrameQueryCoordinateSpace,
  type EraserTargetQueryOptions,
  type SelectionQueryDiagnostic,
} from './selectionQuery';
import type { DocumentStrokeTarget } from './selectionTransform';
import type { SelectionGestureDescriptor } from './gesture/session';

export type EditorControllerTool = DrawingToolModeV2 | 'image';

export type EditorControllerDiagnostic =
  | EditorInteractionDiagnostic
  | EditorRuntimeDiagnostic
  | EditorToolSessionDiagnostic
  | SelectionQueryDiagnostic
  | Readonly<{ type: 'active-interaction-conflict' }>
  | Readonly<{ type: 'no-active-tool-session' }>
  | Readonly<{ type: 'no-tool-candidate' }>
  | Readonly<{ type: 'no-eraser-targets' }>
  | Readonly<{ type: 'frame-document-identity-mismatch' }>;

export type EditorEraserTransient = Readonly<{
  samples: readonly DrawingPointV2[];
  radius: number;
  topmostOnly: boolean;
}>;

/**
 * 未来 UI 的单一纯 core 协调状态。
 *
 * toolSession/strokeCandidate 仅用于构造和预览；任何持久变化都必须经过 interaction/runtime
 * 的 revision-aware 离散命令。lasso/eraser transient 也仅保存 world-DIP 查询输入。
 */
export type EditorControllerState = Readonly<{
  interaction: EditorInteractionState;
  tool: EditorControllerTool;
  toolStyle: EditorToolStrokeStyle;
  createId?: EditorToolCreateId;
  toolSession?: EditorToolSession;
  strokeCandidate?: DrawingStrokeV2;
  selectionTargets: readonly DocumentStrokeTarget[];
  lassoTransient?: readonly DrawingPointV2[];
  eraserTransient?: EditorEraserTransient;
  diagnostics: readonly EditorControllerDiagnostic[];
}>;

export type CreateEditorControllerOptions = Omit<CreateEditorInteractionOptions, 'tool'> &
  Readonly<{
    tool?: EditorControllerTool;
    toolStyle?: EditorToolStrokeStyle;
    createId?: EditorToolCreateId;
  }>;

export type EditorControllerResult = Readonly<{
  state: EditorControllerState;
  diagnostics: readonly EditorControllerDiagnostic[];
}>;

function copyPoint(point: DrawingPointV2): DrawingPointV2 {
  return Object.freeze({ ...point });
}

function copyPoints(points: readonly DrawingPointV2[]): readonly DrawingPointV2[] {
  return Object.freeze(points.map(copyPoint));
}

function copyStyle(style: EditorToolStrokeStyle | undefined): EditorToolStrokeStyle {
  return Object.freeze({
    ...(style?.strokeColor === undefined ? {} : { strokeColor: style.strokeColor }),
    ...(style?.strokeWidth === undefined ? {} : { strokeWidth: style.strokeWidth }),
    ...(style?.dashArray === undefined ? {} : { dashArray: Object.freeze([...style.dashArray]) }),
    ...(style?.dashOffset === undefined ? {} : { dashOffset: style.dashOffset }),
    ...(style?.fillColor === undefined ? {} : { fillColor: style.fillColor }),
    ...(style?.fillOpacity === undefined ? {} : { fillOpacity: style.fillOpacity }),
    ...(style?.rotationRad === undefined ? {} : { rotationRad: style.rotationRad }),
  });
}

function copyTargets(targets: readonly DocumentStrokeTarget[]): readonly DocumentStrokeTarget[] {
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}

function targetsForQuery(
  targets: readonly (Readonly<{ index: number; id: string; tool: DrawingStrokeV2['tool'] }> | DocumentStrokeTargetQueryTarget)[]
): readonly DocumentStrokeTarget[] {
  return copyTargets(
    targets.map((target) => 'stroke' in target
      ? { index: target.index, expectedId: target.stroke.id, expectedTool: target.stroke.tool }
      : { index: target.index, expectedId: target.id, expectedTool: target.tool }
    )
  );
}

type DocumentStrokeTargetQueryTarget = Readonly<{ index: number; stroke: DrawingStrokeV2 }>;

function documentValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => documentValuesEqual(value, right[index]));
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(rightRecord, key) && documentValuesEqual(leftRecord[key], rightRecord[key])
  );
}

/** 只核对冻结值身份，不描述或重建 document geometry。 */
function frameMatchesDocument(frame: DrawingFrame, document: DrawingValueV2): boolean {
  return frame.prepared.entries.length === document.strokes.length && frame.prepared.entries.every((entry, index) =>
    entry.key === index && documentValuesEqual(entry.stroke, document.strokes[index])
  );
}

function createState(
  state: Omit<EditorControllerState, 'diagnostics'>,
  diagnostics: readonly EditorControllerDiagnostic[] = []
): EditorControllerState {
  return Object.freeze({ ...state, diagnostics: Object.freeze([...diagnostics]) });
}

function controllerResult(
  state: EditorControllerState,
  diagnostics: readonly EditorControllerDiagnostic[] = []
): EditorControllerResult {
  return { state: createState(state, diagnostics), diagnostics };
}

function withInteraction(
  state: EditorControllerState,
  interaction: EditorInteractionState,
  diagnostics: readonly EditorControllerDiagnostic[] = []
): EditorControllerResult {
  return controllerResult({ ...state, interaction, selectionTargets: copyTargets(interaction.selectionTargets) }, diagnostics);
}

function activeConflict(state: EditorControllerState): EditorControllerResult | null {
  return state.interaction.activeGesture
    ? controllerResult(state, [{ type: 'active-interaction-conflict' }])
    : null;
}

function toolSessionFor(state: EditorControllerState, tool = state.tool) {
  return createEditorToolSession({ tool, style: state.toolStyle, ...(state.createId ? { createId: state.createId } : {}) });
}

function setToolResult(
  state: EditorControllerState,
  tool: EditorControllerTool,
  interaction: EditorInteractionState,
  sessionResult: ReturnType<typeof createEditorToolSession>,
  diagnostics: readonly EditorControllerDiagnostic[]
): EditorControllerResult {
  return controllerResult(
    {
      ...state,
      interaction,
      tool,
      toolSession: sessionResult.session,
      strokeCandidate: undefined,
      lassoTransient: undefined,
      eraserTransient: undefined,
    },
    diagnostics
  );
}

/** 创建 controller；不会自动提交工具候选，也不会写入持久 document。 */
export function createEditorControllerState(
  document: DrawingValueV2,
  options: CreateEditorControllerOptions = {}
): EditorControllerState {
  const tool = options.tool ?? 'pen';
  const toolStyle = copyStyle(options.toolStyle);
  const interaction = createEditorInteractionState(document, {
    ...options,
    tool: tool === 'image' ? 'pen' : tool,
  });
  const sessionResult = createEditorToolSession({
    tool,
    style: toolStyle,
    ...(options.createId ? { createId: options.createId } : {}),
  });
  return createState(
    {
      interaction,
      tool,
      toolStyle,
      ...(options.createId ? { createId: options.createId } : {}),
      toolSession: sessionResult.session,
      selectionTargets: copyTargets(interaction.selectionTargets),
    },
    sessionResult.diagnostics
  );
}

/** 切换工具会清除候选与查询 transient；切换过程绝不会写 history。 */
export function setEditorControllerTool(
  state: EditorControllerState,
  tool: EditorControllerTool
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) {
    return conflict;
  }
  const interactionResult = tool === 'image'
    ? { state: state.interaction, diagnostics: [] as readonly EditorInteractionDiagnostic[] }
    : setEditorInteractionTool(state.interaction, tool);
  const sessionResult = toolSessionFor(state, tool);
  return setToolResult(
    state,
    tool,
    interactionResult.state,
    sessionResult,
    [...interactionResult.diagnostics, ...sessionResult.diagnostics]
  );
}

/** 配置 selection 的稳定目标与可选 gesture descriptor；变换提交仍由 EditorInteraction 完成。 */
export function setEditorControllerSelection(
  state: EditorControllerState,
  targets: readonly DocumentStrokeTarget[],
  descriptor?: SelectionGestureDescriptor
): EditorControllerResult {
  const interactionResult = setEditorSelection(state.interaction, targets, descriptor);
  if (interactionResult.diagnostics.length > 0) {
    return withInteraction(state, interactionResult.state, interactionResult.diagnostics);
  }
  return controllerResult(
    { ...state, interaction: interactionResult.state, selectionTargets: copyTargets(targets) },
    []
  );
}

function updateToolSession(
  state: EditorControllerState,
  toolResult: ReturnType<typeof beginEditorToolPointer>
): EditorControllerResult {
  return controllerResult(
    {
      ...state,
      toolSession: toolResult.session,
      ...(toolResult.stroke ? { strokeCandidate: toolResult.stroke } : { strokeCandidate: undefined }),
    },
    toolResult.diagnostics
  );
}

/** 连续工具的 world-DIP down；candidate 必须通过 commitEditorControllerCandidate 显式提交。 */
export function beginEditorControllerToolPointer(
  state: EditorControllerState,
  point: DrawingPointV2
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  return state.toolSession
    ? updateToolSession(state, beginEditorToolPointer(state.toolSession, point))
    : controllerResult(state, [{ type: 'no-active-tool-session' }]);
}

/** 连续工具的 world-DIP move；不会写 document/history。 */
export function moveEditorControllerToolPointer(
  state: EditorControllerState,
  point: DrawingPointV2
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  return state.toolSession
    ? updateToolSession(state, moveEditorToolPointer(state.toolSession, point))
    : controllerResult(state, [{ type: 'no-active-tool-session' }]);
}

/** 连续工具的 world-DIP up；完成后仅保留 strokeCandidate，不会自动提交。 */
export function finishEditorControllerToolPointer(
  state: EditorControllerState,
  point: DrawingPointV2
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  return state.toolSession
    ? updateToolSession(state, finishEditorToolPointer(state.toolSession, point))
    : controllerResult(state, [{ type: 'no-active-tool-session' }]);
}

/** polygon/bezier 的显式 world-DIP 顶点/控制点入口。 */
export function addEditorControllerToolVertex(
  state: EditorControllerState,
  point: DrawingPointV2
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  return state.toolSession
    ? updateToolSession(state, addEditorToolVertex(state.toolSession, point))
    : controllerResult(state, [{ type: 'no-active-tool-session' }]);
}

/** 完成 polygon，仅产生候选 stroke。 */
export function finishEditorControllerPolygon(state: EditorControllerState): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  return state.toolSession
    ? updateToolSession(state, finishEditorPolygon(state.toolSession))
    : controllerResult(state, [{ type: 'no-active-tool-session' }]);
}

/** 完成 Bézier，仅产生候选 stroke。 */
export function finishEditorControllerBezier(state: EditorControllerState): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  return state.toolSession
    ? updateToolSession(state, finishEditorBezier(state.toolSession))
    : controllerResult(state, [{ type: 'no-active-tool-session' }]);
}

/** 取消工具构造及查询 transient；取消从不提交 document/history。 */
export function cancelEditorControllerTool(state: EditorControllerState): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  if (!state.toolSession) return controllerResult(state, [{ type: 'no-active-tool-session' }]);
  const cancelled = cancelEditorToolSession(state.toolSession);
  return controllerResult(
    {
      ...state,
      toolSession: undefined,
      strokeCandidate: undefined,
      lassoTransient: undefined,
      eraserTransient: undefined,
    },
    cancelled.diagnostics
  );
}

/**
 * 将候选笔迹作为一条 revision-aware append 命令提交。expectedRevision 用于让 UI 以显式的
 * optimistic revision 检测陈旧候选；缺省为当前 runtime revision。
 */
export function commitEditorControllerCandidate(
  state: EditorControllerState,
  expectedRevision = state.interaction.runtime.documentState.revision
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  if (!state.strokeCandidate) return controllerResult(state, [{ type: 'no-tool-candidate' }]);
  const committed = commitEditorInteractionCommand(state.interaction, {
    type: 'append-stroke',
    expectedRevision,
    stroke: state.strokeCandidate,
  });
  if (committed.state === state.interaction) {
    return controllerResult(state, committed.diagnostics);
  }
  return controllerResult(
    {
      ...state,
      interaction: committed.state,
      selectionTargets: copyTargets(committed.state.selectionTargets),
      toolSession: undefined,
      strokeCandidate: undefined,
    },
    committed.diagnostics
  );
}

/**
 * controller 的唯一离散 document 写入口，供文本删除、替换、clear 等非手势 producer 使用。
 * 具体 selection 生命周期由 interaction 统一处理，避免 UI 仅隐藏失效的选框。
 */
export function commitEditorControllerDocumentCommand(
  state: EditorControllerState,
  command: EditorDocumentCommand
): EditorControllerResult {
  const committed = commitEditorInteractionCommand(state.interaction, command);
  return controllerResult(
    {
      ...state,
      interaction: committed.state,
      selectionTargets: copyTargets(committed.state.selectionTargets),
      ...(committed.state.selectionTargets.length === 0
        ? { lassoTransient: undefined, eraserTransient: undefined }
        : {}),
    },
    committed.diagnostics
  );
}

/** 将 text session 等核心 producer 的完整 snapshot 接入统一的 selection 生命周期。 */
export function commitEditorControllerDocument(
  state: EditorControllerState,
  expectedRevision: number,
  document: DrawingValueV2
): EditorControllerResult {
  const committed = commitEditorInteractionDocument(state.interaction, expectedRevision, document);
  return controllerResult(
    {
      ...state,
      interaction: committed.state,
      selectionTargets: copyTargets(committed.state.selectionTargets),
      ...(committed.state.selectionTargets.length === 0
        ? { lassoTransient: undefined, eraserTransient: undefined }
        : {}),
    },
    committed.diagnostics
  );
}

/** 仅查询 lasso 并更新稳定 selection targets；查询过程绝不写 history。 */
export function queryEditorControllerLasso(
  state: EditorControllerState,
  polygon: readonly DrawingPointV2[]
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  const query = queryLassoStrokeTargets(state.interaction.runtime.documentState.document, polygon);
  const targets = targetsForQuery(query.targets);
  const selection = setEditorSelection(state.interaction, targets, state.interaction.selectionDescriptor);
  const diagnostics = [...query.diagnostics, ...selection.diagnostics];
  return controllerResult(
    {
      ...state,
      interaction: selection.state,
      selectionTargets: selection.diagnostics.length === 0 ? targets : state.selectionTargets,
      lassoTransient: copyPoints(polygon),
      eraserTransient: undefined,
    },
    diagnostics
  );
}

/** 仅查询 eraser 轨迹并更新稳定 targets；topmostOnly 完全遵循 selectionQuery 语义。 */
export function queryEditorControllerEraser(
  state: EditorControllerState,
  samples: readonly DrawingPointV2[],
  radius: number,
  options: EraserTargetQueryOptions = {}
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  const query = queryEraserStrokeTargets(state.interaction.runtime.documentState.document, samples, radius, options);
  const targets = targetsForQuery(query.targets);
  const selection = setEditorSelection(state.interaction, targets, state.interaction.selectionDescriptor);
  const diagnostics = [...query.diagnostics, ...selection.diagnostics];
  return controllerResult(
    {
      ...state,
      interaction: selection.state,
      selectionTargets: selection.diagnostics.length === 0 ? targets : state.selectionTargets,
      lassoTransient: undefined,
      eraserTransient: Object.freeze({
        samples: copyPoints(samples),
        radius,
        topmostOnly: options.topmostOnly ?? false,
      }),
    },
    diagnostics
  );
}

/**
 * 供候选 UI 使用的 frame-only lasso 入口。frameRevision 必须是构建该 frame 时读取的 runtime
 * revision；此外 controller 会核对 prepared snapshot 与当前冻结 document 的值身份，避免同 revision
 * 的异源 frame 被误用于 selection 或后续删除。
 */
export function queryEditorControllerDrawingFrameLasso(
  state: EditorControllerState,
  frame: DrawingFrame,
  frameRevision: number,
  polygon: readonly DrawingPointV2[],
  coordinateSpace: DrawingFrameQueryCoordinateSpace = 'world'
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  const query = frameMatchesDocument(frame, state.interaction.runtime.documentState.document)
    ? queryDrawingFrameLassoTargets(frame, polygon, {
      frameRevision,
      expectedRevision: state.interaction.runtime.documentState.revision,
      coordinateSpace,
    })
    : { targets: [], diagnostics: [{ type: 'frame-document-identity-mismatch' } satisfies EditorControllerDiagnostic] };
  const targets = targetsForQuery(query.targets);
  const selection = setEditorSelection(state.interaction, targets, state.interaction.selectionDescriptor);
  const diagnostics = [...query.diagnostics, ...selection.diagnostics];
  return controllerResult(
    { ...state, interaction: selection.state, selectionTargets: selection.diagnostics.length === 0 ? targets : state.selectionTargets, lassoTransient: copyPoints(polygon), eraserTransient: undefined },
    diagnostics
  );
}

/** frame-only 连续橡皮入口；topmostOnly 与 legacy query 相同，删除仍需显式 commit。 */
export function queryEditorControllerDrawingFrameEraser(
  state: EditorControllerState,
  frame: DrawingFrame,
  frameRevision: number,
  samples: readonly DrawingPointV2[],
  radius: number,
  options: EraserTargetQueryOptions & Readonly<{ coordinateSpace?: DrawingFrameQueryCoordinateSpace }> = {}
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  const query = frameMatchesDocument(frame, state.interaction.runtime.documentState.document)
    ? queryDrawingFrameEraserTargets(frame, samples, radius, {
      frameRevision,
      expectedRevision: state.interaction.runtime.documentState.revision,
      coordinateSpace: options.coordinateSpace,
      topmostOnly: options.topmostOnly,
    })
    : { targets: [], diagnostics: [{ type: 'frame-document-identity-mismatch' } satisfies EditorControllerDiagnostic] };
  const targets = targetsForQuery(query.targets);
  const selection = setEditorSelection(state.interaction, targets, state.interaction.selectionDescriptor);
  const diagnostics = [...query.diagnostics, ...selection.diagnostics];
  return controllerResult(
    {
      ...state,
      interaction: selection.state,
      selectionTargets: selection.diagnostics.length === 0 ? targets : state.selectionTargets,
      lassoTransient: undefined,
      eraserTransient: Object.freeze({ samples: copyPoints(samples), radius, topmostOnly: options.topmostOnly ?? false }),
    },
    diagnostics
  );
}

/** 将当前 eraser query targets 删除为一条原子 runtime history 提交；空 target 不写 history。 */
export function commitEditorControllerEraser(
  state: EditorControllerState,
  expectedRevision = state.interaction.runtime.documentState.revision
): EditorControllerResult {
  const conflict = activeConflict(state);
  if (conflict) return conflict;
  if (state.selectionTargets.length === 0) return controllerResult(state, [{ type: 'no-eraser-targets' }]);
  const committed = commitEditorInteractionCommand(state.interaction, {
    type: 'remove-strokes',
    expectedRevision,
    targets: state.selectionTargets,
  });
  if (committed.state === state.interaction) return controllerResult(state, committed.diagnostics);
  return controllerResult(
    {
      ...state,
      interaction: committed.state,
      selectionTargets: copyTargets(committed.state.selectionTargets),
      eraserTransient: undefined,
      lassoTransient: undefined,
    },
    committed.diagnostics
  );
}

/** 仅代理既有 EditorInteraction 的 GestureSession 开始逻辑，不复制手势数学。 */
export function beginEditorControllerGesture(state: EditorControllerState): EditorControllerResult {
  const begun = beginEditorGesture(state.interaction);
  return withInteraction(state, begun.state, begun.diagnostics);
}

/** 仅代理既有 EditorInteraction 的 normalized pointer reducer，不复制手势数学。 */
export function reduceEditorControllerGesture(
  state: EditorControllerState,
  input: NormalizedPointerInput
): EditorControllerResult {
  const reduced: EditorInteractionResult = reduceEditorGesture(state.interaction, input);
  return withInteraction(state, reduced.state, reduced.diagnostics);
}

/** controller 层的 undo 入口；真实回退后 selection 必须一并清空。 */
export function undoEditorController(state: EditorControllerState): EditorControllerResult {
  const undone = undoEditorInteraction(state.interaction);
  return controllerResult(
    {
      ...state,
      interaction: undone.state,
      selectionTargets: copyTargets(undone.state.selectionTargets),
      ...(undone.state.selectionTargets.length === 0
        ? { lassoTransient: undefined, eraserTransient: undefined }
        : {}),
    },
    undone.diagnostics
  );
}

/** controller 层的 redo 入口；真实重放后 selection 必须一并清空。 */
export function redoEditorController(state: EditorControllerState): EditorControllerResult {
  const redone = redoEditorInteraction(state.interaction);
  return controllerResult(
    {
      ...state,
      interaction: redone.state,
      selectionTargets: copyTargets(redone.state.selectionTargets),
      ...(redone.state.selectionTargets.length === 0
        ? { lassoTransient: undefined, eraserTransient: undefined }
        : {}),
    },
    redone.diagnostics
  );
}
