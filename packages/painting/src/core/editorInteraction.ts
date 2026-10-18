import { DEFAULT_DRAWING_VIEWPORT, type DrawingViewport } from '../viewport';
import {
  createGestureSession,
  reduceGestureSession,
  type CreateGestureSessionOptions,
  type GestureRulerState,
  type GestureSession,
  type GestureSessionTool,
  type GestureTransientState,
  type SelectionGestureDescriptor,
  type SelectionGestureIntent,
} from './gesture/session';
import type { NormalizedPointerInput } from './input';
import {
  commitEditorRuntimeDocument,
  commitSelectionIntent,
  createEditorRuntimeState,
  applyEditorRuntimeCommand,
  redoEditorRuntime,
  undoEditorRuntime,
  type EditorRuntimeDiagnostic,
  type EditorRuntimeState,
} from './editorRuntime';
import { materializeEditorDocumentPreview, type EditorDocumentCommand } from './editorDocument';
import { transformSelection, type DocumentStrokeTarget } from './selectionTransform';
import { applyViewportTransformIntent, normalizeViewportTransform } from './viewportTransform';
import type { DrawingValueV2 } from '../model/strokes';

export type EditorInteractionDiagnostic =
  | EditorRuntimeDiagnostic
  | Readonly<{ type: 'gesture-already-active' }>
  | Readonly<{ type: 'no-active-gesture' }>
  | Readonly<{ type: 'active-gesture-conflict' }>
  | Readonly<{ type: 'stale-gesture-revision'; expectedRevision: number; actualRevision: number }>
  | Readonly<{ type: 'no-selection-targets' }>
  | Readonly<{ type: 'invalid-interaction-viewport' }>;

export type ActiveEditorGesture = Readonly<{
  session: GestureSession;
  beginRevision: number;
  beginViewport: DrawingViewport;
}>;

/** 仅供候选界面渲染的 world-DIP replacement 集；它从不写 document 或 history。 */
export type EditorSelectionPreview = Readonly<{
  intent: SelectionGestureIntent;
  /** 唯一可渲染的冻结预览快照；UI 必须直接读取它而不是自行回放 replacement。 */
  document: DrawingValueV2;
}>;

/** 交互层只协调纯 session、history 与 viewport；它不持有平台事件或 renderer 对象。 */
export type EditorInteractionState = Readonly<{
  runtime: EditorRuntimeState;
  viewport: DrawingViewport;
  tool: GestureSessionTool;
  selectionTargets: readonly DocumentStrokeTarget[];
  selectionDescriptor?: SelectionGestureDescriptor;
  ruler?: Readonly<{ state: GestureRulerState; pivot?: Readonly<{ x: number; y: number }> }>;
  interactionPolicy?: CreateGestureSessionOptions['interactionPolicy'];
  activeGesture?: ActiveEditorGesture;
  transient: GestureTransientState;
  selectionPreview?: EditorSelectionPreview;
  diagnostics: readonly EditorInteractionDiagnostic[];
}>;

export type CreateEditorInteractionOptions = Readonly<{
  viewport?: DrawingViewport;
  tool?: GestureSessionTool;
  selectionTargets?: readonly DocumentStrokeTarget[];
  selectionDescriptor?: SelectionGestureDescriptor;
  ruler?: Readonly<{ state: GestureRulerState; pivot?: Readonly<{ x: number; y: number }> }>;
  interactionPolicy?: CreateGestureSessionOptions['interactionPolicy'];
}>;

export type EditorInteractionResult = Readonly<{
  state: EditorInteractionState;
  diagnostics: readonly EditorInteractionDiagnostic[];
}>;

function freezeTargets(targets: readonly DocumentStrokeTarget[]): readonly DocumentStrokeTarget[] {
  return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}

function freezePoint(
  point: Readonly<{ x: number; y: number }>
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: point.x, y: point.y });
}

function copySelectionDescriptor(
  descriptor: SelectionGestureDescriptor
): SelectionGestureDescriptor {
  const box = Object.freeze({
    center: freezePoint(descriptor.box.center),
    width: descriptor.box.width,
    height: descriptor.box.height,
    rotationRad: descriptor.box.rotationRad,
  });
  if (descriptor.kind === 'move') {
    return Object.freeze({ kind: 'move', box });
  }
  if (descriptor.kind === 'rotate') {
    return Object.freeze({
      kind: 'rotate',
      box,
      ...(descriptor.pivot ? { pivot: freezePoint(descriptor.pivot) } : {}),
    });
  }
  if (descriptor.kind === 'uniform-scale') {
    return Object.freeze({
      kind: 'uniform-scale',
      box,
      anchor: freezePoint(descriptor.anchor),
      handle: freezePoint(descriptor.handle),
      ...(descriptor.minimumScreenExtent === undefined
        ? {}
        : { minimumScreenExtent: descriptor.minimumScreenExtent }),
    });
  }
  return Object.freeze({
    kind: 'resize',
    box,
    anchor: freezePoint(descriptor.anchor),
    axis: Object.freeze({ ...descriptor.axis }),
    ...(descriptor.minimumSize === undefined ? {} : { minimumSize: descriptor.minimumSize }),
  });
}

function copyRuler(
  ruler: Readonly<{ state: GestureRulerState; pivot?: Readonly<{ x: number; y: number }> }>
): Readonly<{ state: GestureRulerState; pivot?: Readonly<{ x: number; y: number }> }> {
  return Object.freeze({
    state: Object.freeze({
      center: freezePoint(ruler.state.center),
      rotationRad: ruler.state.rotationRad,
    }),
    ...(ruler.pivot ? { pivot: freezePoint(ruler.pivot) } : {}),
  });
}

function copyViewport(viewport: DrawingViewport): DrawingViewport {
  return Object.freeze({ ...viewport });
}

function screenToWorld(point: Readonly<{ x: number; y: number }>, viewport: DrawingViewport) {
  const x = (point.x - viewport.tx) / viewport.scale;
  const y = (point.y - viewport.ty) / viewport.scale;
  return Number.isFinite(x) && Number.isFinite(y) ? freezePoint({ x, y }) : null;
}

/**
 * GestureSession 只处理宿主 screen DIP；交互层以手势起始 viewport 将其一次映射为 world DIP。
 * 缩放标量与视口无关，旧 resize 的两个轴保持原样以维持 non-uniform 拒绝防线。
 */
export function selectionIntentToWorld(
  intent: SelectionGestureIntent,
  beginViewport: DrawingViewport
): SelectionGestureIntent | null {
  if (!Number.isFinite(beginViewport.scale) || beginViewport.scale <= 0) return null;
  if (intent.kind === 'move') {
    const x = intent.delta.x / beginViewport.scale;
    const y = intent.delta.y / beginViewport.scale;
    return Number.isFinite(x) && Number.isFinite(y)
      ? Object.freeze({ kind: 'move', delta: freezePoint({ x, y }) })
      : null;
  }
  if (intent.kind === 'rotate') {
    const pivot = screenToWorld(intent.pivot, beginViewport);
    return pivot && Number.isFinite(intent.deltaRad)
      ? Object.freeze({ kind: 'rotate', pivot, deltaRad: intent.deltaRad })
      : null;
  }
  const anchor = screenToWorld(intent.anchor, beginViewport);
  if (!anchor) return null;
  if (intent.kind === 'uniform-scale') {
    return Number.isFinite(intent.scale)
      ? Object.freeze({ kind: 'uniform-scale', anchor, scale: intent.scale })
      : null;
  }
  return Number.isFinite(intent.scale.x) && Number.isFinite(intent.scale.y)
    ? Object.freeze({
        kind: 'resize',
        anchor,
        axis: Object.freeze({ ...intent.axis }),
        scale: Object.freeze({ ...intent.scale }),
      })
    : null;
}

function transientInWorld(
  session: GestureSession,
  beginViewport: DrawingViewport
): GestureTransientState {
  const screenIntent = session.transient.selection ?? session.transient.uniformScaleSelection;
  const selection = screenIntent ? selectionIntentToWorld(screenIntent, beginViewport) : undefined;
  if (!selection) return Object.freeze({ ...session.transient });
  return selection.kind === 'uniform-scale'
    ? Object.freeze({ ...session.transient, uniformScaleSelection: selection })
    : Object.freeze({ ...session.transient, selection });
}

function previewFor(
  runtime: EditorRuntimeState,
  targets: readonly DocumentStrokeTarget[],
  transient: GestureTransientState
): EditorSelectionPreview | undefined {
  const intent = transient.selection ?? transient.uniformScaleSelection;
  if (!intent || targets.length === 0) return undefined;
  const transform = transformSelection(runtime.documentState.document, targets, intent);
  if (transform.diagnostics.length > 0) return undefined;
  const preview = materializeEditorDocumentPreview(runtime.documentState, {
    type: 'replace-strokes',
    expectedRevision: runtime.documentState.revision,
    replacements: transform.replacements,
  });
  return preview ? Object.freeze({ intent, document: preview.document }) : undefined;
}

function targetMatchesDocument(document: DrawingValueV2, target: DocumentStrokeTarget): boolean {
  const stroke = document.strokes[target.index];
  return (
    stroke !== undefined &&
    Number.isInteger(target.index) &&
    target.index >= 0 &&
    stroke.id === target.expectedId &&
    (target.expectedTool === undefined || stroke.tool === target.expectedTool)
  );
}

function hasValidSelectionTargets(
  document: DrawingValueV2,
  targets: readonly DocumentStrokeTarget[]
): boolean {
  const indexes = new Set<number>();
  return (
    targets.length > 0 &&
    targets.every((target) => {
      if (indexes.has(target.index) || !targetMatchesDocument(document, target)) return false;
      indexes.add(target.index);
      return true;
    })
  );
}

function clearSelection(): Pick<
  EditorInteractionState,
  'selectionTargets' | 'selectionDescriptor' | 'selectionPreview'
> {
  return {
    selectionTargets: Object.freeze([]),
    selectionDescriptor: undefined,
    selectionPreview: undefined,
  };
}

/**
 * 文档变更后的 selection 生命周期：仅 append 保留仍有效的 targets；selection 自身的变换
 * 保留 targets；删除、替换、完整 document 提交、undo/redo 一律清空 targets/descriptor/preview。
 */
function selectionAfterDocumentChange(
  state: EditorInteractionState,
  runtime: EditorRuntimeState,
  policy: 'append' | 'selection-transform' | 'clear'
): Pick<EditorInteractionState, 'selectionTargets' | 'selectionDescriptor' | 'selectionPreview'> {
  if (
    policy !== 'clear' &&
    hasValidSelectionTargets(runtime.documentState.document, state.selectionTargets)
  ) {
    return {
      selectionTargets: state.selectionTargets,
      // 自身变换后 targets 仍有效，但原 descriptor 的 box/anchor 属于旧 frame，不能复用。
      ...(policy === 'append' && state.selectionDescriptor
        ? { selectionDescriptor: state.selectionDescriptor }
        : { selectionDescriptor: undefined }),
      selectionPreview: undefined,
    };
  }
  return clearSelection();
}

function createState(
  state: Omit<EditorInteractionState, 'diagnostics'>,
  diagnostics: readonly EditorInteractionDiagnostic[] = []
): EditorInteractionState {
  return Object.freeze({ ...state, diagnostics: Object.freeze([...diagnostics]) });
}

function result(
  state: EditorInteractionState,
  diagnostics: readonly EditorInteractionDiagnostic[] = []
): EditorInteractionResult {
  return { state: createState(state, diagnostics), diagnostics };
}

function activeResult(
  state: EditorInteractionState,
  diagnostics: readonly EditorInteractionDiagnostic[]
): EditorInteractionResult {
  return result(state, diagnostics);
}

function sessionOptions(state: EditorInteractionState): CreateGestureSessionOptions {
  return {
    document: state.runtime.documentState.document,
    tool: state.tool,
    ...(state.selectionDescriptor ? { selection: state.selectionDescriptor } : {}),
    ...(state.ruler ? { ruler: state.ruler } : {}),
    ...(state.interactionPolicy ? { interactionPolicy: state.interactionPolicy } : {}),
  };
}

function configuredState(
  state: EditorInteractionState,
  updates: Partial<
    Pick<
      EditorInteractionState,
      | 'viewport'
      | 'tool'
      | 'selectionTargets'
      | 'selectionDescriptor'
      | 'ruler'
      | 'interactionPolicy'
    >
  >
): EditorInteractionState {
  return createState({
    ...state,
    ...updates,
    activeGesture: undefined,
    transient: Object.freeze({}),
    selectionPreview: undefined,
  });
}

/** 创建纯交互协调状态；初始 document 与 runtime snapshot 均不会共享调用方可变数组。 */
export function createEditorInteractionState(
  document: DrawingValueV2,
  options: CreateEditorInteractionOptions = {}
): EditorInteractionState {
  const viewport = normalizeViewportTransform(options.viewport ?? DEFAULT_DRAWING_VIEWPORT);
  return createState({
    runtime: createEditorRuntimeState(document),
    viewport: copyViewport(viewport ?? DEFAULT_DRAWING_VIEWPORT),
    tool: options.tool ?? 'pen',
    selectionTargets: freezeTargets(options.selectionTargets ?? []),
    ...(options.selectionDescriptor
      ? { selectionDescriptor: copySelectionDescriptor(options.selectionDescriptor) }
      : {}),
    ...(options.ruler ? { ruler: copyRuler(options.ruler) } : {}),
    ...(options.interactionPolicy
      ? { interactionPolicy: Object.freeze({ ...options.interactionPolicy }) }
      : {}),
    transient: Object.freeze({}),
  });
}

/** 设置下一次 selection gesture 所用的稳定 targets/descriptor；激活手势期间拒绝重配。 */
export function setEditorSelection(
  state: EditorInteractionState,
  targets: readonly DocumentStrokeTarget[],
  descriptor?: SelectionGestureDescriptor
): EditorInteractionResult {
  if (state.activeGesture) {
    return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  }
  return {
    state: configuredState(state, {
      selectionTargets: freezeTargets(targets),
      ...(descriptor
        ? { selectionDescriptor: copySelectionDescriptor(descriptor) }
        : { selectionDescriptor: undefined }),
    }),
    diagnostics: [],
  };
}

/** 设置下一次 gesture 的工具；现有 GestureSession 仍会对未实现工具产生安全 unsupported 状态。 */
export function setEditorInteractionTool(
  state: EditorInteractionState,
  tool: GestureSessionTool
): EditorInteractionResult {
  if (state.activeGesture) {
    return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  }
  return { state: configuredState(state, { tool }), diagnostics: [] };
}

/** 直接设置经过既有 viewport 边界规范化的临时视口，不影响 document 或 history。 */
export function setEditorInteractionViewport(
  state: EditorInteractionState,
  viewport: DrawingViewport
): EditorInteractionResult {
  if (state.activeGesture) {
    return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  }
  const normalized = normalizeViewportTransform(viewport);
  if (!normalized) {
    return activeResult(state, [{ type: 'invalid-interaction-viewport' }]);
  }
  return { state: configuredState(state, { viewport: copyViewport(normalized) }), diagnostics: [] };
}

/**
 * 在交互边界提交离散 document 命令并同步 selection 生命周期。
 * `append-stroke` 是唯一不清空已验证 selection 的普通命令；其余真实写入全部失效。
 */
export function commitEditorInteractionCommand(
  state: EditorInteractionState,
  command: EditorDocumentCommand
): EditorInteractionResult {
  if (state.activeGesture) return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  const committed = applyEditorRuntimeCommand(state.runtime, command);
  if (committed.state === state.runtime) return { state, diagnostics: committed.diagnostics };
  const selection = selectionAfterDocumentChange(
    state,
    committed.state,
    command.type === 'append-stroke'
      ? 'append'
      : command.type === 'apply-selection-transform'
        ? 'selection-transform'
        : 'clear'
  );
  return {
    state: createState(
      { ...state, runtime: committed.state, transient: Object.freeze({}), ...selection },
      committed.diagnostics
    ),
    diagnostics: committed.diagnostics,
  };
}

/**
 * 提交 trusted core producer 的完整 document snapshot（例如 text session）。完整 snapshot 无法
 * 证明只是 append，因此所有真实提交保守清空 selection；陈旧/no-op 保持原 interaction 引用。
 */
export function commitEditorInteractionDocument(
  state: EditorInteractionState,
  expectedRevision: number,
  document: DrawingValueV2
): EditorInteractionResult {
  if (state.activeGesture) return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  const committed = commitEditorRuntimeDocument(state.runtime, expectedRevision, document);
  if (committed.state === state.runtime) return { state, diagnostics: committed.diagnostics };
  return {
    state: createState(
      { ...state, runtime: committed.state, transient: Object.freeze({}), ...clearSelection() },
      committed.diagnostics
    ),
    diagnostics: committed.diagnostics,
  };
}

/** 从当前 runtime document 创建并锁定一段 GestureSession。 */
export function beginEditorGesture(state: EditorInteractionState): EditorInteractionResult {
  if (state.activeGesture) {
    return activeResult(state, [{ type: 'gesture-already-active' }]);
  }
  const session = createGestureSession(sessionOptions(state));
  const next = createState({
    ...state,
    activeGesture: Object.freeze({
      session,
      beginRevision: state.runtime.documentState.revision,
      beginViewport: copyViewport(state.viewport),
    }),
    transient: transientInWorld(session, state.viewport),
    selectionPreview: undefined,
  });
  return { state: next, diagnostics: [] };
}

/**
 * 消费一个已规范化 pointer 输入。viewport preview 永远以 beginViewport 为基准，history 只由
 * GestureSession 的 document/selection 完成 effect 触发，cancel 与 navigation 不会写 document。
 */
export function reduceEditorGesture(
  state: EditorInteractionState,
  input: NormalizedPointerInput
): EditorInteractionResult {
  const active = state.activeGesture;
  if (!active) {
    return activeResult(state, [{ type: 'no-active-gesture' }]);
  }
  const transition = reduceGestureSession(active.session, input);
  let runtime = state.runtime;
  let ruler = state.ruler;
  let committedSelectionTransform = false;
  const diagnostics: EditorInteractionDiagnostic[] = [];
  const revisionMatches = runtime.documentState.revision === active.beginRevision;

  for (const effect of transition.effects) {
    if (effect.type === 'ruler-complete') {
      ruler = Object.freeze({ state: effect.state });
      continue;
    }
    if (!revisionMatches) {
      diagnostics.push({
        type: 'stale-gesture-revision',
        expectedRevision: active.beginRevision,
        actualRevision: runtime.documentState.revision,
      });
      continue;
    }
    if (effect.type === 'document-commit') {
      const committed = commitEditorRuntimeDocument(runtime, active.beginRevision, effect.document);
      runtime = committed.state;
      diagnostics.push(...committed.diagnostics);
      continue;
    }
    if (state.selectionTargets.length === 0) {
      diagnostics.push({ type: 'no-selection-targets' });
      continue;
    }
    const worldIntent = selectionIntentToWorld(effect.intent, active.beginViewport);
    if (!worldIntent) {
      diagnostics.push({ type: 'invalid-editor-document' });
      continue;
    }
    const runtimeBeforeCommit = runtime;
    const committed = commitSelectionIntent(runtime, state.selectionTargets, worldIntent);
    runtime = committed.state;
    committedSelectionTransform ||=
      committed.state !== runtimeBeforeCommit && committed.diagnostics.length === 0;
    diagnostics.push(...committed.diagnostics);
  }

  const navigationIntent = transition.session.transient.navigation?.intent;
  const previewViewport = navigationIntent
    ? (applyViewportTransformIntent(active.beginViewport, navigationIntent) ?? state.viewport)
    : state.viewport;
  const isActive = transition.session.status === 'active';
  const transient = transientInWorld(transition.session, active.beginViewport);
  // 外部 revision 已推进时，活动手势既不能提交，也不能产生基于错误 snapshot 的 preview。
  const selectionPreview =
    runtime.documentState.revision === active.beginRevision
      ? previewFor(runtime, state.selectionTargets, transient)
      : undefined;
  const selection =
    runtime.documentState.revision !== active.beginRevision
      ? clearSelection()
      : runtime === state.runtime
        ? undefined
        : selectionAfterDocumentChange(
            state,
            runtime,
            committedSelectionTransform ? 'selection-transform' : 'clear'
          );
  const next = createState(
    {
      ...state,
      runtime,
      viewport: copyViewport(previewViewport),
      ...(ruler ? { ruler } : {}),
      ...(isActive
        ? {
            activeGesture: Object.freeze({ ...active, session: transition.session }),
            transient,
            ...(selection ?? {}),
            ...(selectionPreview ? { selectionPreview } : { selectionPreview: undefined }),
          }
        : {
            activeGesture: undefined,
            transient: Object.freeze({}),
            ...(selection ?? {}),
            selectionPreview: undefined,
          }),
    },
    diagnostics
  );
  return { state: next, diagnostics };
}

/** undo 与活动 session 不可混用，避免使用旧 begin revision 覆盖已经回退的 document。 */
export function undoEditorInteraction(state: EditorInteractionState): EditorInteractionResult {
  if (state.activeGesture) {
    return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  }
  const undone = undoEditorRuntime(state.runtime);
  return {
    state: createState(
      {
        ...state,
        runtime: undone.state,
        transient: Object.freeze({}),
        ...(undone.state === state.runtime ? {} : clearSelection()),
        selectionPreview: undefined,
      },
      undone.diagnostics
    ),
    diagnostics: undone.diagnostics,
  };
}

/** redo 与活动 session 不可混用，避免使用旧 begin revision 覆盖重放后的 document。 */
export function redoEditorInteraction(state: EditorInteractionState): EditorInteractionResult {
  if (state.activeGesture) {
    return activeResult(state, [{ type: 'active-gesture-conflict' }]);
  }
  const redone = redoEditorRuntime(state.runtime);
  return {
    state: createState(
      {
        ...state,
        runtime: redone.state,
        transient: Object.freeze({}),
        ...(redone.state === state.runtime ? {} : clearSelection()),
        selectionPreview: undefined,
      },
      redone.diagnostics
    ),
    diagnostics: redone.diagnostics,
  };
}
