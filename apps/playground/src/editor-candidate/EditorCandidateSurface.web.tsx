import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Skia, type SkImage } from '@shopify/react-native-skia';
import type { SkiaDrawingCanvasProps, SkiaOverlay } from '@hamster-note/painting/skia';
import {
  addEditorControllerToolVertex,
  applyEditorRuntimeCommand,
  appendPreparedDrawingEntry,
  beginEditorGesture,
  beginEditorControllerToolPointer,
  beginExistingTextEditSession,
  beginNewTextEditSession,
  cancelEditorControllerTool,
  cancelTextEditSession,
  commitEditorRuntimeDocument,
  commitEditorControllerCandidate,
  commitEditorControllerEraser,
  commitTextEditSession,
  createResourceRegistry,
  createPreparedDrawingSpatialIndex,
  createEditorControllerState,
  deriveSelectionFrame,
  deriveSelectionOverlayModel,
  endTextEditComposition,
  finishEditorControllerBezier,
  finishEditorControllerPolygon,
  finishEditorControllerToolPointer,
  hitTestSelectionOverlay,
  hitTestDrawingFrame,
  moveEditorControllerToolPointer,
  queryEditorControllerDrawingFrameEraser,
  queryEditorControllerDrawingFrameLasso,
  redoEditorInteraction,
  reduceEditorGesture,
  removeImageResource,
  registerImageResource,
  requestTextEditCommit,
  resolveImageResource,
  prepareDrawingDocument,
  panViewport,
  screenToCanvas,
  setEditorSelection,
  setEditorControllerSelection,
  setEditorControllerTool,
  setEditorInteractionViewport,
  undoEditorInteraction,
  tryCreateDrawingFrame,
  type DrawingFrame,
  updateTextEditDraft,
  startTextEditComposition,
  type DrawingPointV2,
  type DrawingStrokeV2,
  type DrawingValueV2,
  type EditorControllerState,
  type EditorControllerTool,
  type EditorInteractionState,
  type EditorRuntimeState,
  type ImageStrokeV2,
  type NormalizedPointerInput,
  type PreparedDrawingDocument,
  type PreparedDrawingSpatialIndex,
  type ResourceRegistry,
  type TextEditSession,
  zoomViewportAt,
} from '@hamster-note/painting/core';
import { createWebInputAdapter } from '@hamster-note/painting/input/web';
import {
  constrainPointToRulerEdge,
  createRulerEdgeConstraint,
  getInfiniteRulerLayout,
  isInsideRuler,
  projectPointToRulerCenterline,
  type RulerEdgeConstraint,
} from '@hamster-note/painting/ruler';
import { useCandidateFontAssets, useCandidateTextShaping } from './CandidateTextResources.web';
import {
  useCandidateLifecycleDiagnostics,
  type CandidateLifecycleDiagnostics,
} from './CandidateLifecycleDiagnostics.web';
import {
  EDITOR_PERFORMANCE_WORKLOAD,
  checksumPerformanceDocument,
  beginEditorPerformanceMeasurementWindow,
  createEditorPerformanceMeasurements,
  createEditorPerformanceWorkload,
  finalizeEditorPerformanceMeasurementWindow,
  measurementSnapshot,
  queuePerformancePointerEmission,
  readEditorPerformanceMode,
  recordPerformanceCommit,
  recordPerformancePointerInput,
  resetEditorPerformanceMeasurements,
  startEditorPerformanceSampling,
  type HamsterEditorPerformanceApi,
  type PerformancePointerEmission,
  type PerformancePointerSample,
} from './EditorCandidatePerformance.web';
import { rebaseOverlaysToFrame } from './frameOverlays.web';
import { PenPreviewCanvasBackend } from './penPreviewCanvas.web';

const EMPTY_DOCUMENT: DrawingValueV2 = { schemaVersion: 2, strokes: [] };
const ERASER_RADIUS = 18;
const RULER_HEIGHT = 42;
// 候选 Web 导入在解码前冻结输入，避免巨大或非图片文件进入 Data URL / CanvasKit 内存路径。
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_CANVAS_LAYOUT_EDGE = 32_768;
const INITIAL_RULER_STATE = {
  // 尺子只使用宿主局部 screen-DIP，不随文档或 viewport 持久化。
  center: { x: 360, y: 230 },
  rotationRad: 0,
} as const;
const TOOLS = [
  ['pen', 'Pen'],
  ['line', '直线'],
  ['rect', '矩形'],
  ['ellipse', '椭圆'],
  ['polygon', '多边形'],
  ['bezier', '贝塞尔'],
  ['eraser', '橡皮擦'],
  ['lasso', '套索'],
  ['text', '文本'],
  ['image', '图片'],
] as const satisfies readonly (readonly [EditorControllerTool, string])[];

let nextStrokeId = 0;

type PanPointer = Readonly<{
  pointerId: string | number;
  start: Readonly<{ x: number; y: number }>;
  viewport: EditorInteractionState['viewport'];
}>;

type PointerOwner = 'ruler' | 'selection' | 'paper' | 'pan' | 'none';

type ZoomFeedback = Readonly<{ x: number; y: number; scale: number }>;

type FrameQueryOperation = 'none' | 'lasso' | 'eraser';

type FrameQueryStatus = Readonly<{
  mode: 'idle' | 'frame' | 'blocked';
  operation: FrameQueryOperation;
  frameRevision: number | null;
  diagnostics: readonly string[];
}>;

const INITIAL_FRAME_QUERY_STATUS: FrameQueryStatus = {
  mode: 'idle',
  operation: 'none',
  frameRevision: null,
  diagnostics: [],
};

function diagnosticTypes(diagnostics: readonly Readonly<{ type: string }>[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.type);
}

export interface EditorCandidateSurfaceProps {
  /** 仅由 Web route 在 CanvasKit 初始化成功后注入。 */
  canvasComponent: ComponentType<
    SkiaDrawingCanvasProps & {
      resolveImage?: (reference: { resourceId?: string; src: string }) => SkImage | null;
    }
  >;
}

type CanvasSize = Readonly<{ width: number; height: number }>;

function validCanvasSize(width: number, height: number): CanvasSize | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_CANVAS_LAYOUT_EDGE ||
    height > MAX_CANVAS_LAYOUT_EDGE
  ) {
    return null;
  }
  return { width, height };
}

/**
 * 增量 prepared 管线快照：持有源 document 引用（用于严格前缀证明）与其对应的 prepared/index。
 * 只作为组件内 useMemo 的 append 缓存；缓存本身与下游 frame 一样不可变，旧快照绝不被就地修改。
 */
type PreparedPipelineSnapshot = Readonly<{
  document: DrawingValueV2;
  prepared: PreparedDrawingDocument | null;
  spatialIndex: PreparedDrawingSpatialIndex | null;
  error: string | null;
}>;

/**
 * 严格 append-only 判定：新 document 必须更长，且旧 document 的每一条 stroke 都要与新 document
 * 对应前缀逐一同引用（===）。只看 count 或 id 无法排除 replace/reorder/同 id 新对象等非追加变更。
 */
function isStrictStrokeAppend(previous: DrawingValueV2, next: DrawingValueV2): boolean {
  if (next.strokes.length <= previous.strokes.length) return false;
  for (let index = 0; index < previous.strokes.length; index += 1) {
    if (previous.strokes[index] !== next.strokes[index]) return false;
  }
  return true;
}

/** D2-D4 只在显式二分查询下改变 Canvas 分支，默认产品路径不会读取这些阶段。 */
type CanvasDiagnosticStage =
  | 'surface-no-canvas'
  | 'canvas-empty-no-font'
  | 'canvas-empty-font'
  | 'canvas-current-no-font'
  | 'canvas-current-font';

function readCanvasDiagnosticStage(): CanvasDiagnosticStage | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get('diagnostics') !== '1') return null;
  const stage = query.get('diagStage');
  if (
    stage === 'surface-no-canvas' ||
    stage === 'canvas-empty-no-font' ||
    stage === 'canvas-empty-font' ||
    stage === 'canvas-current-no-font' ||
    stage === 'canvas-current-font'
  ) {
    return stage;
  }
  return null;
}

/**
 * perfRenderer 诊断变体（仅在 `perf=1` 时生效；否则一律 null，正式 perf=1 语义不变）。
 * 它只选择「送进 Canvas 的 world / overlay 组合」，绝不改变 adapter/core/document、提交、
 * 资源初始化或测量 hook；因此各模式下的 pointerSamples / commit / longtask 记录方式完全一致。
 *  - empty-pulse：不绘 world、不绘真实 pen 预览，仅一个屏外极小 pulse；
 *  - overlay-only：完整真实 pen 预览（overlay），不绘 world，同时 pulse；
 *  - world-pulse：完整真实世界（含 100k 静态 world），无 pen 预览，同时 pulse；
 *  - split-canvas：单编辑器逻辑、双 Canvas 分层。底层 world Canvas 用真实 frame/图片/字体
 *    （overlays=[]，React.memo 隔离静态场景）；顶层透明 overlay Canvas 用相同 viewport/layout
 *    的 empty frame + 完整原 frameOverlays（屏外 pulse）。两层 DIP/dSF 对齐、top wrapper
 *    pointerEvents:none，事件仍由正式 host 处理。
 *  - canvas2d-pen：静态 Skia world + 顶层透明 Canvas2D 增量 pen 预览（Oracle 决策的 Web 金丝雀）。
 *    底层 Skia world 用真实 frame（overlays 只排除活动 pen 草稿，其余 overlay 全部保留）；
 *    顶层 `<canvas>` 由 PenPreviewCanvasBackend 以增量尾部方式绘制 pen 草稿，同步挂在
 *    adapter 输入回调的 core session 更新之后，绝不按 React render 全量回放。
 *    adapter/core/document/提交/测量路径与正式模式完全一致（同一 input adapter、同一 controller、
 *    同一 setController 与真实 commit 计时），仅 pen 草稿的可见载体从 Skia overlay 换成 Canvas2D。
 */
export type PerfRendererMode =
  'empty-pulse' | 'overlay-only' | 'world-pulse' | 'split-canvas' | 'canvas2d-pen';

export function readPerfRendererMode(): PerfRendererMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const query = new URLSearchParams(window.location.search);
    // 诊断变体必须依附正式 perf run；缺失 perf=1 时完全不生效。
    if (query.get('perf') !== '1') return null;
    const mode = query.get('perfRenderer');
    return mode === 'empty-pulse' ||
      mode === 'overlay-only' ||
      mode === 'world-pulse' ||
      mode === 'split-canvas' ||
      mode === 'canvas2d-pen'
      ? mode
      : null;
  } catch {
    return null;
  }
}

/** Canvas 的挂载与文本资源状态无关。Frame 内的单条 pending/error 文本自行退出 render/hit。 */
function CandidateCanvasLifecycle({
  diagnostics,
  children,
}: Readonly<{
  diagnostics: CandidateLifecycleDiagnostics;
  children: ReactNode;
}>) {
  useEffect(() => {
    diagnostics.increment('canvas-mounts');
    return () => diagnostics.increment('canvas-unmounts');
  }, [diagnostics]);
  return children;
}

/** split-canvas 两层的稳定空 overlay 引用，避免 world 层因新数组字面量而重渲染。 */
const EMPTY_LAYER_OVERLAYS: readonly SkiaOverlay[] = Object.freeze([]);

/**
 * split-canvas 诊断层 props。world 层依赖每个字段的引用稳定才能真正跳过重渲染：
 * frame / canvasComponent / canvasProps / resolveImage / fontManager / fontFamily / overlays
 * 在 overlay-only publish 期间必须保持不变。
 */
type SplitCanvasLayerProps = Readonly<{
  canvasComponent: EditorCandidateSurfaceProps['canvasComponent'];
  frame: DrawingFrame;
  overlays: readonly SkiaOverlay[];
  resolveImage?: SkiaDrawingCanvasProps['resolveImage'];
  fontManager?: SkiaDrawingCanvasProps['fontManager'];
  fontFamily?: string;
  canvasProps: NonNullable<SkiaDrawingCanvasProps['canvasProps']>;
  width: number;
  height: number;
}>;

/**
 * split-canvas 底层 world 层：真实 frame / 图片 / 字体，overlays=[]。
 *
 * React.memo + 调用方传入稳定引用，使顶层 overlay 的每次 publish 都不会重渲染或重绘 world，
 * 从而真正隔离静态场景（而不是把两个 SkiaDrawingCanvas 并列后持续更新 world）。
 * `data-perf-layer-renders` 记录该层实际发生的 React render 次数（仅诊断，不代表实际 draw）。
 */
export const SplitCanvasWorldLayer = memo(function SplitCanvasWorldLayer(
  props: SplitCanvasLayerProps
) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const CanvasComponent = props.canvasComponent;
  return (
    <div
      data-perf-canvas-layer="world"
      data-perf-layer-renders={String(renderCountRef.current)}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: props.width,
        height: props.height,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <CanvasComponent
        frame={props.frame}
        overlays={EMPTY_LAYER_OVERLAYS}
        resolveImage={props.resolveImage}
        fontManager={props.fontManager}
        fontFamily={props.fontFamily}
        canvasProps={props.canvasProps}
      />
    </div>
  );
});

/**
 * canvas2d-pen 底层 world 层：与 SplitCanvasWorldLayer 同款 memo 隔离，但把调用方的
 * overlays 真实下发——split-canvas 的 world 层按其自身契约硬编码空 overlays（顶层 overlay
 * canvas 承载全部 overlays），不能直接复用，否则尺子/选框草稿/形状草稿等非 pen overlay
 * 会被静默丢弃。本层只排除活动 pen 草稿（上游 resolveCanvas2dPenWorldOverlays 已过滤），
 * 其余 overlay 全部保留；pen 手势期间 overlays 为共享冻结空引用，memo 跳过重渲染。
 */
export const Canvas2dPenWorldLayer = memo(function Canvas2dPenWorldLayer(
  props: SplitCanvasLayerProps
) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const CanvasComponent = props.canvasComponent;
  return (
    <div
      data-perf-canvas-layer="world"
      data-perf-layer-renders={String(renderCountRef.current)}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: props.width,
        height: props.height,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <CanvasComponent
        frame={props.frame}
        overlays={props.overlays}
        resolveImage={props.resolveImage}
        fontManager={props.fontManager}
        fontFamily={props.fontFamily}
        canvasProps={props.canvasProps}
      />
    </div>
  );
});

/**
 * split-canvas 顶层透明 overlay 层：相同 viewport/layout 的 empty frame + 完整原 frameOverlays
 * （诊断 pulse 为屏外极小 command）。外层 wrapper `pointerEvents: 'none'`，保证事件仍走正式 host
 * 的单编辑器路径；每次 publish 重渲染以驱动 overlay redraw。
 * `data-perf-layer-renders` 记录该层实际发生的 React render 次数（仅诊断，不代表实际 draw）。
 */
export function SplitCanvasOverlayLayer(props: SplitCanvasLayerProps) {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const CanvasComponent = props.canvasComponent;
  return (
    <div
      data-perf-canvas-layer="overlay"
      data-perf-layer-renders={String(renderCountRef.current)}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: props.width,
        height: props.height,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <CanvasComponent
        frame={props.frame}
        overlays={props.overlays}
        fontManager={props.fontManager}
        fontFamily={props.fontFamily}
        canvasProps={props.canvasProps}
      />
    </div>
  );
}

/**
 * 计算 split-canvas overlay 层实际下发的 overlays。
 *
 * split 模式绝不注入屏外 diagnosticPulseOverlay（两层都无 pulse），只保留完整真实 frameOverlays；
 * 其余诊断模式维持原有 pulse 行为。抽成纯函数以便定向单测断言「split 不带 pulse、真实 overlays 不丢」。
 */
export function resolveSplitOverlayOverlays(
  perfRendererMode: PerfRendererMode | null,
  frameOverlays: readonly SkiaOverlay[],
  diagnosticPulseOverlay: SkiaOverlay | null
): readonly SkiaOverlay[] {
  if (perfRendererMode === 'split-canvas') return frameOverlays;
  return diagnosticPulseOverlay === null
    ? frameOverlays
    : [...frameOverlays, diagnosticPulseOverlay];
}

/**
 * 根性能诊断节点上的 pulse 标记，供 10s gate 预检严格读取：
 *  - split-canvas：'off'（两层均不注入 pulse）；
 *  - canvas2d-pen：'off'（pen 预览本身即真实视觉负载，不注入 pulse）；
 *  - 其余诊断脉冲模式：'on'；
 *  - 正式 /?perf=1（null）：不输出该属性，正式 DOM 完全不变。
 */
export function resolvePerfRendererPulseMarker(
  perfRendererMode: PerfRendererMode | null
): 'off' | 'on' | null {
  if (perfRendererMode === null) return null;
  return perfRendererMode === 'split-canvas' || perfRendererMode === 'canvas2d-pen' ? 'off' : 'on';
}

/**
 * canvas2d-pen 模式下被 Canvas2D 增量预览接管的 pen 草稿 overlay id
 * （与 draftOverlay 中 continuous pen 分支的 id 严格一致；其余 overlay 一律保留）。
 */
export const CANVAS2D_PEN_DRAFT_OVERLAY_ID = 'editor-candidate-pen-draft';

/**
 * 计算 canvas2d-pen 模式送进 Skia world 层的 overlays：
 * 只排除活动 pen 草稿（它由顶层 Canvas2D 增量预览绘制），其余 overlay 原样保留。
 *
 * fail closed：非 canvas2d-pen 模式、或 Canvas2D 预览不可用（backend 未挂载/不健康/未激活）
 * 时原样返回 frameOverlays——pen 草稿回到 Skia overlay，绝不出现「两边都不画」的隐形预览。
 * 过滤结果为空时返回共享冻结空引用，保证 world 层 React.memo 在 pen 手势期间跳过重渲染。
 */
export function resolveCanvas2dPenWorldOverlays(
  perfRendererMode: PerfRendererMode | null,
  frameOverlays: readonly SkiaOverlay[],
  penPreviewUsable: boolean
): readonly SkiaOverlay[] {
  if (perfRendererMode !== 'canvas2d-pen' || !penPreviewUsable) return frameOverlays;
  const filtered = frameOverlays.filter((overlay) => overlay.id !== CANVAS2D_PEN_DRAFT_OVERLAY_ID);
  // 结果为空：返回稳定空引用（world 层 memo 依赖引用稳定）。
  if (filtered.length === 0) return EMPTY_LAYER_OVERLAYS;
  // 本来就没有 pen 草稿：引用原样返回，不制造新数组打扰 world 层 memo。
  return filtered.length === frameOverlays.length ? frameOverlays : filtered;
}

/** pen 抬笔后的 Canvas2D 预览清除策略。 */
export type Canvas2dPenCommitClear = 'retain-until-world-present' | 'clear-immediately';

/**
 * 提交结果决定清除策略：已提交必须保留预览直到 world 绘制可见（避免空帧）；
 * 未提交（退化候选/预览未激活）则立即清除，绝不保留陈旧预览。
 */
export function resolveCanvas2dPenCommitClear(committedOnce: boolean): Canvas2dPenCommitClear {
  return committedOnce ? 'retain-until-world-present' : 'clear-immediately';
}

/**
 * 保留预览的清除门槛（纯函数）：只有「含新 revision 的 world frame 已 commit 到 React」
 * 之后才允许进入延迟清除流程；绝不按普通 React render 清除。
 */
export function canClearRetainedPenPreview(
  pendingRevision: number | null,
  documentRevision: number,
  frameReady: boolean
): boolean {
  return pendingRevision !== null && frameReady && documentRevision >= pendingRevision;
}

/**
 * 保留预览的最终清除（窄助手，供提交保留 effect 与聚焦单测共用）。
 *
 * 无条件清除「保留时锁定的那一实例」：pen 提交后 backend 仍处于 active（只有 clear 才复位），
 * 旧的「仅 !isActive 才 clear」会让已提交的保留预览永久残留、diagnostic 谎称 cleared（P0）。
 * 返回是否实际调用了 clear——disposed/缺失实例不算已清除，调用方据此不得上报 'cleared'。
 * 这里只断言 clear 被实际调用，不做任何像素级可见性断言（Skia 无显式 draw 信号）。
 */
export function clearRetainedCanvas2dPenPreview(
  backend: Pick<PenPreviewCanvasBackend, 'isDisposed' | 'clear'> | null
): boolean {
  if (!backend || backend.isDisposed) return false;
  backend.clear();
  return true;
}

/** performance-only synthetic input scheduler 的固定 pre-arm lead（严格在正式窗口之外）。 */
export const PERF_SCHEDULER_PREARM_LEAD_MS = 100;

export type PerformanceDeadline = Readonly<{ index: number; scheduledAt: number }>;

export type PerformanceDeadlineSchedulerCounters = {
  /** 每个 event 的初始注册 + 所有早醒重排累计的 setTimeout 次数（含初始 1200）。 */
  timerAttemptCount: number;
  /** callbackAt < scheduledAt 的早醒次数（只重排，不产生 event）。 */
  earlyRetryCount: number;
};

/**
 * 生成 eventCount 个绝对 deadline：scheduledAt = startAt + index * (1000/eventsPerSecond)。
 * startAt 由 armingStartedAt + prearm lead 得到，保证全部 timer 的 arming 发生在正式窗口之外。
 */
export function buildPerformanceDeadlines(
  startAt: number,
  eventCount: number,
  eventsPerSecond: number
): readonly PerformanceDeadline[] {
  const intervalMs = 1_000 / eventsPerSecond;
  return Array.from({ length: eventCount }, (_, index) => ({
    index,
    scheduledAt: startAt + index * intervalMs,
  }));
}

/** timer 延迟向上取整以减少浏览器提前唤醒；提前唤醒仍由 wakeup guard 兜底重排。 */
export function nextSchedulerDelayMs(now: number, scheduledAt: number): number {
  return Math.max(0, Math.ceil(scheduledAt - now));
}

/** callbackAt >= scheduledAt 才派发；严格早到一律重排，不 clamp、不丢样本。 */
export function classifySchedulerWakeup(
  callbackAt: number,
  scheduledAt: number
): 'reschedule-early' | 'dispatch' {
  return callbackAt < scheduledAt ? 'reschedule-early' : 'dispatch';
}

/** arming 未记录或晚于 startAt 视为超窗：正式 workload prerequisite 判 INVALID（不移动窗口/不重试）。 */
export function isArmingOverrun(allTimersRegisteredAt: number | null, startAt: number): boolean {
  return allTimersRegisteredAt === null || allTimersRegisteredAt > startAt;
}

export type SchedulePerformanceDeadlinesOptions = Readonly<{
  deadlines: readonly PerformanceDeadline[];
  now: () => number;
  setTimeout: (handler: () => void, delayMs: number) => void;
  shouldContinue: () => boolean;
  onDeadline: (deadline: PerformanceDeadline, callbackAt: number) => void;
}>;

/**
 * 纯排程核心（`now`/`setTimeout` 可注入，供受控 fake-timer 单测）：
 *  - 每个 deadline 的初始注册与每次早醒重排都计入 `timerAttemptCount`（含初始 eventCount 次）；
 *  - `callbackAt < scheduledAt` 时只重排同一 index（`earlyRetryCount`+1），绝不派发或产生额外 event；
 *  - 满足 `callbackAt >= scheduledAt` 才调用 onDeadline，每个 index 恰好一次；
 *  - `shouldContinue()===false`（settlement/unmount）后不再重排或派发；
 *  - 返回全部 deadline 注册完成时刻 allTimersRegisteredAt。
 */
export function schedulePerformanceDeadlines(
  counters: PerformanceDeadlineSchedulerCounters,
  options: SchedulePerformanceDeadlinesOptions
): number {
  const schedule = (deadline: PerformanceDeadline): void => {
    if (!options.shouldContinue()) return;
    const delayMs = nextSchedulerDelayMs(options.now(), deadline.scheduledAt);
    counters.timerAttemptCount += 1;
    options.setTimeout(() => {
      if (!options.shouldContinue()) return;
      const callbackAt = options.now();
      if (classifySchedulerWakeup(callbackAt, deadline.scheduledAt) === 'reschedule-early') {
        counters.earlyRetryCount += 1;
        schedule(deadline);
        return;
      }
      options.onDeadline(deadline, callbackAt);
    }, delayMs);
  };
  for (const deadline of options.deadlines) schedule(deadline);
  return options.now();
}

function updateInteraction(
  state: EditorControllerState,
  interaction: EditorInteractionState
): EditorControllerState {
  return { ...state, interaction, diagnostics: interaction.diagnostics };
}

function worldPoint(input: NormalizedPointerInput, state: EditorControllerState): DrawingPointV2 {
  const point = screenToCanvas(input.screen, state.interaction.viewport);
  return input.pressure === undefined ? point : { ...point, pressure: input.pressure };
}

function appendSample(
  samples: readonly DrawingPointV2[],
  point: DrawingPointV2
): readonly DrawingPointV2[] {
  const previous = samples[samples.length - 1];
  return previous && previous.x === point.x && previous.y === point.y
    ? samples
    : [...samples, point];
}

function supportsRulerEdgeConstraint(tool: EditorControllerTool): boolean {
  return tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ellipse';
}

function hasNonCollinearVertices(points: readonly DrawingPointV2[]): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const second = points.find((point) => point.x !== first.x || point.y !== first.y);
  return (
    second !== undefined &&
    points.some(
      (point) =>
        (second.x - first.x) * (point.y - first.y) !== (second.y - first.y) * (point.x - first.x)
    )
  );
}

function ellipsePreviewPoints(
  first: DrawingPointV2,
  second: DrawingPointV2
): readonly DrawingPointV2[] {
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const radiusX = Math.abs(second.x - first.x) / 2;
  const radiusY = Math.abs(second.y - first.y) / 2;
  return Array.from({ length: 25 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY };
  });
}

/** 本地草稿只负责可视化；候选构造、查询与持久化均由 core controller 负责。 */
function draftOverlay(
  state: EditorControllerState,
  eraserSamples: readonly DrawingPointV2[],
  lassoSamples: readonly DrawingPointV2[]
): readonly SkiaOverlay[] {
  if (eraserSamples.length > 0) {
    const last = eraserSamples[eraserSamples.length - 1];
    return [
      {
        id: 'editor-candidate-eraser-track',
        kind: 'polyline',
        space: 'world',
        points: eraserSamples,
        style: { color: '#B42318', strokeWidth: 2, dashArray: [4, 3] },
      },
      {
        id: 'editor-candidate-eraser-radius',
        kind: 'polyline',
        space: 'world',
        points: ellipsePreviewPoints(
          { x: last.x - ERASER_RADIUS, y: last.y - ERASER_RADIUS },
          { x: last.x + ERASER_RADIUS, y: last.y + ERASER_RADIUS }
        ),
        closed: true,
        style: { color: '#B42318', strokeWidth: 1.5, dashArray: [3, 3] },
      },
    ];
  }
  if (lassoSamples.length > 0) {
    return [
      {
        id: 'editor-candidate-lasso-draft',
        kind: 'polyline',
        space: 'world',
        points: lassoSamples,
        closed: lassoSamples.length >= 3,
        style: { color: '#7A2EE6', strokeWidth: 2, dashArray: [5, 4] },
      },
    ];
  }

  const session = state.toolSession;
  if (!session || session.status !== 'active' || session.points.length === 0) return [];
  const style = { color: '#2563EB', strokeWidth: 2, dashArray: [5, 4] };
  if (session.kind === 'continuous') {
    if (session.tool === 'line' && session.points.length === 2) {
      return [
        {
          id: 'editor-candidate-line-draft',
          kind: 'line',
          space: 'world',
          from: session.points[0],
          to: session.points[1],
          style,
        },
      ];
    }
    if (session.tool === 'rect' && session.points.length === 2) {
      const [first, second] = session.points;
      return [
        {
          id: 'editor-candidate-rect-draft',
          kind: 'rect',
          space: 'world',
          origin: first,
          width: second.x - first.x,
          height: second.y - first.y,
          style,
        },
      ];
    }
    if (session.tool === 'ellipse' && session.points.length === 2) {
      return [
        {
          id: 'editor-candidate-ellipse-draft',
          kind: 'polyline',
          space: 'world',
          points: ellipsePreviewPoints(session.points[0], session.points[1]),
          closed: true,
          style,
        },
      ];
    }
    return [
      {
        id: 'editor-candidate-pen-draft',
        kind: 'polyline',
        space: 'world',
        points: session.points,
        style,
      },
    ];
  }
  if (session.kind === 'vertices') {
    const isBezier = session.tool === 'bezier';
    return [
      {
        id: `editor-candidate-${session.tool}-controls`,
        kind: 'polyline',
        space: 'world',
        points: session.points,
        style,
      },
      ...session.points.map((point, index) => ({
        id: `editor-candidate-${session.tool}-control-${index}`,
        kind: 'circle' as const,
        space: 'world' as const,
        center: point,
        radius: 4,
        style: {
          color: isBezier ? '#9B51E0' : '#2563EB',
          fillColor: '#FFFFFF',
          fillOpacity: 1,
          strokeWidth: 1.5,
        },
      })),
    ];
  }
  return [];
}

function toolPrompt(tool: EditorControllerTool, sessionPoints: readonly DrawingPointV2[]): string {
  if (tool === 'line' || tool === 'rect' || tool === 'ellipse')
    return '拖拽生成候选；松开时只提交一次，取消不会写入历史。';
  if (tool === 'polygon')
    return `逐点点击添加顶点（当前 ${sessionPoints.length} 个）；至少 3 个非共线顶点后可完成。`;
  if (tool === 'bezier')
    return `逐点点击四个控制点（当前 ${sessionPoints.length}/4）；第 4 点后自动提交一次。`;
  if (tool === 'eraser')
    return `拖拽以半径 ${ERASER_RADIUS} world-DIP 查询并删除命中对象；无命中不写入历史。`;
  if (tool === 'lasso') return '拖拽形成闭合套索；松开时只更新选择，不写入历史。';
  if (tool === 'text') return '点击画布或使用“新建文本”开始草稿；完成后只提交一次。';
  if (tool === 'image') return '点击画布或使用文件选择器导入图片；解码失败不会写入 document。';
  return '拖拽绘制 Pen；松开后提交一次，取消不会写入历史。';
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('FileReader 读取失败'));
    reader.readAsDataURL(file);
  });
}

function decodeHtmlImage(
  src: string
): Promise<Readonly<{ naturalWidth: number; naturalHeight: number }>> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    image.onerror = () => reject(new Error('浏览器无法解码该图片'));
    image.src = src;
  });
}

type DisposableSkImage = SkImage & Readonly<{ dispose?: () => void; delete?: () => void }>;

function disposeSkImage(image: SkImage | null): void {
  const disposable = image as DisposableSkImage | null;
  // Skia Web versions expose either dispose or delete; never assume one exists in the candidate route.
  if (typeof disposable?.dispose === 'function') disposable.dispose();
  else if (typeof disposable?.delete === 'function') disposable.delete();
}

function validateImageFile(file: File): void {
  if (!IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error(`不支持的图片 MIME：${file.type || '未声明'}（仅 PNG、JPEG、WebP）`);
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`图片文件必须在 1 B 至 ${MAX_IMAGE_FILE_BYTES} B 之间`);
  }
}

function validateImageDimensions(naturalWidth: number, naturalHeight: number): void {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    naturalWidth > MAX_IMAGE_EDGE ||
    naturalHeight > MAX_IMAGE_EDGE ||
    naturalWidth * naturalHeight > MAX_IMAGE_PIXELS
  ) {
    throw new Error(`图片尺寸超限（最大 ${MAX_IMAGE_EDGE} px 边长、${MAX_IMAGE_PIXELS} 总像素）`);
  }
}

function referencedImageResources(runtime: EditorRuntimeState): Readonly<{
  ids: ReadonlySet<string>;
  srcs: ReadonlySet<string>;
}> {
  const ids = new Set<string>();
  const srcs = new Set<string>();
  const snapshots = [runtime.documentState, ...runtime.undoStack, ...runtime.redoStack];
  for (const snapshot of snapshots) {
    for (const stroke of snapshot.document.strokes) {
      if (stroke.tool !== 'image') continue;
      if (stroke.resourceId) ids.add(stroke.resourceId);
      srcs.add(stroke.src);
    }
  }
  return { ids, srcs };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textEditorBox(
  session: TextEditSession,
  document: DrawingValueV2,
  viewport: EditorInteractionState['viewport']
) {
  const target =
    session.mode === 'new'
      ? (session.target as {
          points: readonly DrawingPointV2[];
          fontSize: number;
          rotationRad?: number;
        })
      : (() => {
          const existing = session.target as { index: number };
          const stroke = document.strokes[existing.index];
          return stroke?.tool === 'text'
            ? { points: stroke.points, fontSize: stroke.fontSize, rotationRad: stroke.rotationRad }
            : {
                points: [
                  { x: 40, y: 40 },
                  { x: 300, y: 112 },
                ],
                fontSize: 22,
                rotationRad: 0,
              };
        })();
  const first = target.points[0] ?? { x: 40, y: 40 };
  const last = target.points[target.points.length - 1] ?? { x: first.x + 260, y: first.y + 72 };
  const width = Math.max(Math.abs(last.x - first.x) * viewport.scale, 140);
  const height = Math.max(Math.abs(last.y - first.y) * viewport.scale, 52);
  const centerX = ((first.x + last.x) / 2) * viewport.scale + viewport.tx;
  const centerY = ((first.y + last.y) / 2) * viewport.scale + viewport.ty;
  return {
    // text geometry is center anchored; CSS rotation mirrors stroke.rotationRad without changing paragraph width.
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    fontSize: target.fontSize * viewport.scale,
    rotationRad: target.rotationRad ?? 0,
  };
}

/** 选框视觉只消费 core 派生的 screen-DIP model，不在 UI 侧重算几何。 */
function SelectionOverlay({
  model,
}: Readonly<{ model: NonNullable<ReturnType<typeof deriveSelectionOverlayModel>> }>) {
  const { frame, handles } = model;
  return (
    <div
      data-testid="selection-frame"
      title="当前选择的选框，可拖动内部移动，拖动四角等比缩放，拖动上方手柄旋转"
      style={{
        position: 'absolute',
        left: frame.minX,
        top: frame.minY,
        width: frame.maxX - frame.minX,
        height: frame.maxY - frame.minY,
        boxSizing: 'border-box',
        border: '1.5px solid #2563EB',
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      {handles.map((handle) => {
        const testId =
          handle.kind === 'rotate'
            ? 'selection-rotate-handle'
            : `selection-handle-${handle.corner}`;
        const label =
          handle.kind === 'rotate' ? '旋转选中对象' : `从${handle.corner}角等比缩放选中对象`;
        return (
          <div
            key={testId}
            data-testid={testId}
            title={label}
            style={{
              position: 'absolute',
              left: handle.center.x - frame.minX - handle.size / 2,
              top: handle.center.y - frame.minY - handle.size / 2,
              width: handle.size,
              height: handle.size,
              boxSizing: 'border-box',
              border: '1.5px solid #1D4ED8',
              borderRadius: handle.kind === 'rotate' ? '50%' : 2,
              background: '#FFFFFF',
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </div>
  );
}

export default function EditorCandidateSurface({
  canvasComponent: SkiaDrawingCanvas,
}: EditorCandidateSurfaceProps) {
  const lifecycleDiagnostics = useCandidateLifecycleDiagnostics();
  const canvasDiagnosticStage = readCanvasDiagnosticStage();
  const canvasSuppressedForDiagnostics = canvasDiagnosticStage === 'surface-no-canvas';
  // perf query 只在 Web Surface 首次挂载读取；正常 route 永远沿用 EMPTY_DOCUMENT。
  const [performanceMode] = useState(readEditorPerformanceMode);
  // perfRenderer 诊断变体：仅在 perf=1 时非 null；默认 null 让下方全部保持正式路径。
  const [perfRendererMode] = useState(readPerfRendererMode);
  const [controller, setController] = useState(() =>
    createEditorControllerState(
      performanceMode ? createEditorPerformanceWorkload() : EMPTY_DOCUMENT,
      {
        tool: 'pen',
        toolStyle: { strokeColor: '#172033', strokeWidth: 3 },
        createId: () => `candidate-stroke-${++nextStrokeId}`,
        ruler: { state: INITIAL_RULER_STATE },
      }
    )
  );
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const [canvasSize, setCanvasSize] = useState<CanvasSize | null>(null);
  const [layoutProblem, setLayoutProblem] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [panEnabled, setPanEnabled] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [eraserSamples, setEraserSamples] = useState<readonly DrawingPointV2[]>([]);
  const [lassoSamples, setLassoSamples] = useState<readonly DrawingPointV2[]>([]);
  const [pointerDrawing, setPointerDrawing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 文本草稿只存在 core session；runtime/document 在完成时才接收一次结果。
  const [textSession, setTextSession] = useState<TextEditSession | null>(null);
  const textSessionRef = useRef<TextEditSession | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textSequenceRef = useRef(0);
  const [registry, setRegistry] = useState<ResourceRegistry>(() => createResourceRegistry());
  const registryRef = useRef(registry);
  registryRef.current = registry;
  // Skia resolver 必须同步，因此异步解码成功后才写入这两个 ready 索引。
  const readyImagesByIdRef = useRef(new Map<string, SkImage>());
  const readyImagesBySrcRef = useRef(new Map<string, SkImage>());
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageAnchorRef = useRef<DrawingPointV2 | null>(null);
  const imageSequenceRef = useRef(0);
  // 每轮选择独占 token；取消、下一次选择和 unmount 都会让旧异步结果失效。
  const imageOperationRef = useRef(0);
  const imageUnmountedRef = useRef(false);
  const imageImportingRef = useRef(false);
  const [imageImporting, setImageImporting] = useState(false);
  const [imageImportStatus, setImageImportStatus] = useState('等待选择图片');
  // 仅供 Web 验收读取：不参与布局或导入语义，记录真正从 registry 释放的资源数量。
  const [imageReleaseMetrics, setImageReleaseMetrics] = useState({ last: 0, total: 0 });
  const panEnabledRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const panPointerRef = useRef<PanPointer | null>(null);
  const actionPointerRef = useRef<string | number | null>(null);
  // owner 只在 down-time 决定；Pointer capture 后的 DOM target 不能改变既有归属。
  const pointerOwnersRef = useRef(new Map<string | number, PointerOwner>());
  const paperNavigationPointersRef = useRef<readonly (string | number)[] | null>(null);
  const rulerEdgeConstraintsRef = useRef(new Map<string | number, RulerEdgeConstraint>());
  const latestPointerInputsRef = useRef(new Map<string | number, NormalizedPointerInput>());
  const eraserSamplesRef = useRef<readonly DrawingPointV2[]>([]);
  const lassoSamplesRef = useRef<readonly DrawingPointV2[]>([]);
  const frameRef = useRef<DrawingFrame | null>(null);
  // 与 frame 绑定的 runtime revision 必须和 frame 同步替换，不能在 pointer up 时现取当前 revision。
  const frameRevisionRef = useRef<number | null>(null);
  const [frameQueryStatus, setFrameQueryStatus] = useState<FrameQueryStatus>(
    INITIAL_FRAME_QUERY_STATUS
  );
  const [textRetryGeneration, setTextRetryGeneration] = useState(0);
  const [zoomFeedback, setZoomFeedback] = useState<ZoomFeedback | null>(null);
  const zoomFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rulerAngleFeedback, setRulerAngleFeedback] = useState<Readonly<{
    x: number;
    y: number;
    rotationRad: number;
  }> | null>(null);
  // 只在 perf mode 运行采样；数组留在 ref 内，避免测量本身造成 state/render 反馈。
  const performanceMeasurementsRef = useRef(createEditorPerformanceMeasurements());
  const performancePointerSampleRef = useRef<ReturnType<
    typeof recordPerformancePointerInput
  > | null>(null);
  // The capturing listener sees the exact DOM event before the formal adapter normalizes it.
  // This keeps the perf-only identity out of production input semantics while making the
  // adapter receipt auditable against the dispatch that caused it.
  const performanceAdapterReceiptEmissionRef = useRef<PerformancePointerEmission | null>(null);
  const performancePendingCommitSamplesRef = useRef<
    ReturnType<typeof recordPerformancePointerInput>[]
  >([]);
  const performanceSnapshotRef = useRef<() => Record<string, unknown>>(() => ({
    status: 'mounting',
  }));
  const runHighRatePenInputRef = useRef<
    (
      options: Readonly<{ eventsPerSecond: number; durationMs: number }>
    ) => Promise<Record<string, unknown>>
  >(async () => ({ status: 'mounting' }));
  const runRebaseProbeRef = useRef<() => Record<string, unknown>>(() => ({ status: 'mounting' }));
  const performanceRunActiveRef = useRef(false);
  // perfRenderer：每个 adapter receipt 计一次 visual publish，供屏外 pulse 逐次变化。
  const perfRendererModeRef = useRef(perfRendererMode);
  perfRendererModeRef.current = perfRendererMode;
  const diagnosticPublishRef = useRef(0);
  // ---- canvas2d-pen 金丝雀宿主状态（仅 perfRenderer=canvas2d-pen 时创建 backend）----
  const penPreviewBackendRef = useRef<PenPreviewCanvasBackend | null>(null);
  // 单调递增的笔次 epoch；backend 要求严格递增以阻止已结束的旧笔复活。
  const penStrokeEpochRef = useRef(0);
  // pen 提交后保留预览，直到含新 revision 的 world frame commit 且再延迟 2 个 rAF；
  // 绝不按普通 React render 清除，避免「预览已清、world 未画」的空帧。
  // backend 锁定保留时的那一实例：最终清除只清它，canvas 重挂载后的新实例绝不被误清。
  const penPreviewPendingCommitRef = useRef<Readonly<{
    revision: number;
    backend: PenPreviewCanvasBackend;
  }> | null>(null);
  const [canaryCommitClear, setCanaryCommitClear] = useState<'idle' | 'retained' | 'cleared'>(
    'idle'
  );
  const [canaryCanvasCount, setCanaryCanvasCount] = useState<number | null>(null);

  const setCanvasHost = useCallback((node: unknown) => {
    setHost(node as HTMLElement | null);
  }, []);

  const releaseUnreferencedImages = useCallback((runtime: EditorRuntimeState) => {
    // 空 registry 是常态（无图片模式），直接返回避免构造 references 集合。
    if (registryRef.current.records.length === 0) return;
    const references = referencedImageResources(runtime);
    let nextRegistry = registryRef.current;
    let released = 0;
    for (const record of registryRef.current.records) {
      // 一条资源只会在当前 document、undo 和 redo 三处都不可达后才真正释放。
      if (references.ids.has(record.resourceId) || references.srcs.has(record.src)) continue;
      nextRegistry = removeImageResource(nextRegistry, record.resourceId);
      released += 1;
      const image = readyImagesByIdRef.current.get(record.resourceId) ?? null;
      readyImagesByIdRef.current.delete(record.resourceId);
      if (!image) continue;
      const stillIndexed = [...readyImagesByIdRef.current.values()].some(
        (candidate) => candidate === image
      );
      if (!stillIndexed) {
        for (const [src, candidate] of readyImagesBySrcRef.current) {
          if (candidate === image) readyImagesBySrcRef.current.delete(src);
        }
        disposeSkImage(image);
      }
    }
    if (nextRegistry !== registryRef.current) {
      registryRef.current = nextRegistry;
      setRegistry(nextRegistry);
    }
    if (released > 0) {
      setImageReleaseMetrics(({ total }) => ({ last: released, total: total + released }));
    }
  }, []);

  /**
   * 同步应用最新的完整 controller state：ref 立即前进，必要时释放资源，并把本次 adapter sample
   * 收入 pending commit（由下一次真实 React commit 归因），随后立即 setController 触发发布。
   */
  const updateController = useCallback(
    (next: EditorControllerState) => {
      // runtime 身份不变则 document/undo/redo 的引用集合不变，无需做资源释放扫描。
      const previousRuntime = controllerRef.current.interaction.runtime;
      controllerRef.current = next;
      if (previousRuntime !== next.interaction.runtime) {
        releaseUnreferencedImages(next.interaction.runtime);
      }
      // 只关联由正式 host adapter 收到的输入；effect 在 React 实际 UI commit 后记录原始延迟。
      if (performanceMode && performancePointerSampleRef.current) {
        performancePendingCommitSamplesRef.current.push(performancePointerSampleRef.current);
        performancePointerSampleRef.current = null;
      }
      setController(next);
    },
    [performanceMode, releaseUnreferencedImages]
  );

  useEffect(() => {
    if (!performanceMode) return;
    for (const sample of performancePendingCommitSamplesRef.current.splice(0)) {
      recordPerformanceCommit(performanceMeasurementsRef.current, sample);
    }
  }, [controller, performanceMode]);

  const replaceTextSession = useCallback((next: TextEditSession | null) => {
    textSessionRef.current = next;
    setTextSession(next);
  }, []);

  useEffect(() => {
    if (textSession) {
      textareaRef.current?.focus();
    }
  }, [textSession]);

  useEffect(
    () => () => {
      imageUnmountedRef.current = true;
      imageOperationRef.current += 1;
      imageImportingRef.current = false;
      const images = new Set<SkImage>(readyImagesByIdRef.current.values());
      readyImagesByIdRef.current.clear();
      readyImagesBySrcRef.current.clear();
      for (const image of images) disposeSkImage(image);
    },
    []
  );

  const beginNewText = useCallback(
    (point?: DrawingPointV2) => {
      if (textSessionRef.current) return;
      const sequence = ++textSequenceRef.current;
      const origin = point ?? { x: 72 + (sequence % 3) * 28, y: 72 + (sequence % 4) * 26 };
      replaceTextSession(
        beginNewTextEditSession(
          {
            id: `candidate-text-${sequence}`,
            points: [origin, { x: origin.x + 260, y: origin.y + 72 }],
            fontSize: 22,
          },
          { text: '', strokeColor: '#172033' }
        )
      );
      setNotice('文本草稿已开始；输入、测量和 composition 不会写入 document。');
    },
    [replaceTextSession]
  );

  const beginExistingText = useCallback(
    (index: number, stroke: DrawingStrokeV2) => {
      if (textSessionRef.current || stroke.tool !== 'text') return;
      replaceTextSession(
        beginExistingTextEditSession(
          { index, expectedStrokeId: stroke.id, expectedTool: 'text' },
          {
            text: stroke.text,
            points: stroke.points,
            fontSize: stroke.fontSize,
            strokeColor: stroke.strokeColor,
            strokeWidth: stroke.strokeWidth,
          }
        )
      );
      setNotice('正在编辑既有文本；目标由 core 的 index / id / tool 三元组锁定。');
    },
    [replaceTextSession]
  );

  const finishTextCommit = useCallback(
    (session: TextEditSession) => {
      const current = controllerRef.current;
      const committed = commitTextEditSession(
        current.interaction.runtime.documentState.document,
        session
      );
      const applied = commitEditorRuntimeDocument(
        current.interaction.runtime,
        current.interaction.runtime.documentState.revision,
        committed.document
      );
      if (applied.state !== current.interaction.runtime) {
        // 文本提交绕过 controller command，需显式同步 core 文档变更后的 selection 生命周期。
        const next = updateInteraction(current, {
          ...current.interaction,
          runtime: applied.state,
          diagnostics: [],
        });
        updateController(setEditorControllerSelection(next, []).state);
        setNotice(
          session.mode === 'new' ? '新文本已提交一次，可撤销。' : '文本修改已提交一次，可撤销。'
        );
      } else {
        setNotice(
          committed.diagnostics.length > 0
            ? '文本未提交：目标已过期或会话无效。'
            : '空文本未写入 document。'
        );
      }
      replaceTextSession(null);
    },
    [replaceTextSession, updateController]
  );

  const handleTextareaInput = useCallback(() => {
    const current = textSessionRef.current;
    const textarea = textareaRef.current;
    if (!current || !textarea) return;
    replaceTextSession(
      updateTextEditDraft(current, { text: textarea.value, measuredHeight: textarea.scrollHeight })
    );
  }, [replaceTextSession]);

  const handleCompositionStart = useCallback(() => {
    const current = textSessionRef.current;
    if (current) replaceTextSession(startTextEditComposition(current));
  }, [replaceTextSession]);

  const handleCompositionEnd = useCallback(() => {
    const current = textSessionRef.current;
    if (!current) return;
    let next = updateTextEditDraft(current, {
      text: textareaRef.current?.value ?? current.draft.text,
    });
    next = endTextEditComposition(next);
    if (next.commitRequested) finishTextCommit(next);
    else replaceTextSession(next);
  }, [finishTextCommit, replaceTextSession]);

  const completeText = useCallback(() => {
    const current = textSessionRef.current;
    if (!current) return;
    let next = updateTextEditDraft(current, {
      text: textareaRef.current?.value ?? current.draft.text,
      ...(textareaRef.current ? { measuredHeight: textareaRef.current.scrollHeight } : {}),
    });
    next = requestTextEditCommit(next);
    if (next.isComposing) replaceTextSession(next);
    else finishTextCommit(next);
  }, [finishTextCommit, replaceTextSession]);

  const cancelText = useCallback(() => {
    const current = textSessionRef.current;
    if (current) cancelTextEditSession(current);
    replaceTextSession(null);
    setNotice('文本会话已取消，document 与 history 未变。');
  }, [replaceTextSession]);

  const importImage = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      // 清空 value，允许用户再次选择同一文件；取消时不改变 registry 或 document。
      input.value = '';
      if (!file) {
        imageOperationRef.current += 1;
        imageAnchorRef.current = null;
        setImageImportStatus('已取消（document 与 history 未变）');
        return;
      }

      const operation = ++imageOperationRef.current;
      const operationRevision = controllerRef.current.interaction.runtime.documentState.revision;
      setImageImportStatus('读取并解码中…');
      imageImportingRef.current = true;
      setImageImporting(true);
      void (async () => {
        let skImage: SkImage | null = null;
        try {
          validateImageFile(file);
          const src = await readFileAsDataURL(file);
          if (imageUnmountedRef.current || operation !== imageOperationRef.current) return;
          const { naturalWidth, naturalHeight } = await decodeHtmlImage(src);
          if (imageUnmountedRef.current || operation !== imageOperationRef.current) return;
          validateImageDimensions(naturalWidth, naturalHeight);
          skImage = Skia.Image.MakeImageFromEncoded(
            Skia.Data.fromBase64(src.slice(src.indexOf(',') + 1))
          );
          if (!skImage) {
            throw new Error('Skia 无法解码该图片');
          }
          if (imageUnmountedRef.current || operation !== imageOperationRef.current) return;

          // 相同 data URL 复用已有 registry/resource 像素，避免重复导入无界增长。
          const existing = registryRef.current.records.find((record) => record.src === src);
          const resourceId =
            existing?.resourceId ??
            (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `candidate-resource-${Date.now()}-${++imageSequenceRef.current}`);
          const registered = registerImageResource(registryRef.current, {
            resourceId,
            src,
            naturalWidth,
            naturalHeight,
          });
          if (registered.diagnostics.length > 0) {
            throw new Error('资源 ID 冲突，未导入图片');
          }
          if (imageUnmountedRef.current || operation !== imageOperationRef.current) return;
          const anchor = imageAnchorRef.current ?? { x: 84, y: 120 };
          const width = Math.min(240, naturalWidth);
          const height = (width * naturalHeight) / naturalWidth;
          const stroke: ImageStrokeV2 = {
            schemaVersion: 2,
            id: `candidate-image-${++imageSequenceRef.current}`,
            tool: 'image',
            resourceId,
            src,
            points: [anchor, { x: anchor.x + width, y: anchor.y + height }],
            strokeColor: '#455A64',
            strokeWidth: 1.5,
          };
          const current = controllerRef.current;
          if (current.interaction.runtime.documentState.revision !== operationRevision) {
            throw new Error('图片导入期间 document 已变化，已丢弃过期结果');
          }
          const appended = applyEditorRuntimeCommand(current.interaction.runtime, {
            type: 'append-stroke',
            expectedRevision: current.interaction.runtime.documentState.revision,
            stroke,
          });
          if (appended.state === current.interaction.runtime) {
            throw new Error('图片笔迹未能写入 document');
          }
          if (imageUnmountedRef.current || operation !== imageOperationRef.current) return;
          // registry 与 ready image 都只在 document append 成功后发布，避免半导入资源。
          registryRef.current = registered.registry;
          setRegistry(registered.registry);
          const retained =
            readyImagesByIdRef.current.get(resourceId) ?? readyImagesBySrcRef.current.get(src);
          if (retained) {
            disposeSkImage(skImage);
            skImage = null;
          } else {
            readyImagesByIdRef.current.set(resourceId, skImage);
            readyImagesBySrcRef.current.set(src, skImage);
            skImage = null;
          }
          imageAnchorRef.current = null;
          updateController(
            updateInteraction(current, {
              ...current.interaction,
              runtime: appended.state,
              diagnostics: [],
            })
          );
          setImageImportStatus(`已导入 ${naturalWidth}×${naturalHeight}，已写入一条可撤销历史`);
          setNotice('图片已登记资源并提交一次，可撤销。');
        } catch (error) {
          if (imageUnmountedRef.current || operation !== imageOperationRef.current) return;
          imageAnchorRef.current = null;
          setImageImportStatus(`失败：${errorMessage(error)}（document 与 history 未变）`);
          setNotice('图片导入失败，未写入 document 或 history。');
        } finally {
          disposeSkImage(skImage);
          if (!imageUnmountedRef.current && operation === imageOperationRef.current) {
            imageImportingRef.current = false;
            setImageImporting(false);
          }
        }
      })();
    },
    [updateController]
  );

  const handleImageInputCancel = useCallback(() => {
    imageOperationRef.current += 1;
    imageImportingRef.current = false;
    setImageImporting(false);
    imageAnchorRef.current = null;
    setImageImportStatus('已取消（document 与 history 未变）');
  }, []);

  useEffect(() => {
    const input = imageInputRef.current;
    if (!input) return;
    // file input 的取消是 Web 原生事件，React 的 input props 尚未声明它。
    input.addEventListener('cancel', handleImageInputCancel);
    return () => input.removeEventListener('cancel', handleImageInputCancel);
  }, [handleImageInputCancel]);

  const resolveImage = useCallback(
    (reference: { resourceId?: string; src: string }): SkImage | null => {
      const resolved = resolveImageResource(registryRef.current, reference).resource;
      if (resolved) {
        const image = readyImagesByIdRef.current.get(resolved.resourceId);
        if (image) return image;
      }
      return readyImagesBySrcRef.current.get(reference.src) ?? null;
    },
    []
  );

  const clearTransientPreview = useCallback(() => {
    eraserSamplesRef.current = [];
    lassoSamplesRef.current = [];
    setEraserSamples([]);
    setLassoSamples([]);
    setPointerDrawing(false);
  }, []);

  const resetToolSession = useCallback(
    (state: EditorControllerState, tool = state.tool) => {
      clearTransientPreview();
      return setEditorControllerTool(state, tool).state;
    },
    [clearTransientPreview]
  );

  // ---- canvas2d-pen 金丝雀：增量 Canvas2D pen 预览的同步钩子 ----
  // 全部只在 adapter 输入回调里同步调用（core session 更新之后），绝不在 React render/effect
  // 里按渲染回放；非 canvas2d-pen 模式一律 no-op（backend 根本不会被创建）。

  /** callback ref：顶层透明 canvas 挂载时创建后端，卸载时 dispose（fail closed）。 */
  const setPenPreviewCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node === null) {
      penPreviewBackendRef.current?.dispose();
      penPreviewBackendRef.current = null;
      return;
    }
    if (perfRendererModeRef.current !== 'canvas2d-pen') return;
    if (penPreviewBackendRef.current !== null) return;
    // DPR / CSS DIP / backing / pointerEvents 全部由后端配置；frame 惰性读取，绝不跨帧缓存仿射。
    penPreviewBackendRef.current = new PenPreviewCanvasBackend({
      canvas: node,
      getFrame: () => frameRef.current,
    });
  }, []);

  /** 无条件清理当前预览与保留标记（取消/换工具/undo/redo/清空等语义化边界）。 */
  const clearCanvas2dPenPreview = useCallback(() => {
    penPreviewBackendRef.current?.clear();
    penPreviewPendingCommitRef.current = null;
  }, []);

  /** fail closed：backend 一旦不健康，立即清掉可见残留并放弃保留，绝不留陈旧预览。 */
  const sweepUnhealthyPenPreview = useCallback((backend: PenPreviewCanvasBackend) => {
    if (backend.healthy) return;
    backend.clear();
    penPreviewPendingCommitRef.current = null;
  }, []);

  /** pen down 同步点：core session 更新后立即在同一事件回调里 begin（不等待 React render）。 */
  const syncCanvas2dPenBegin = useCallback(
    (next: EditorControllerState) => {
      if (perfRendererModeRef.current !== 'canvas2d-pen') return;
      const backend = penPreviewBackendRef.current;
      if (!backend || backend.isDisposed) return;
      const session = next.toolSession;
      if (
        !session ||
        session.kind !== 'continuous' ||
        session.tool !== 'pen' ||
        session.status !== 'active'
      ) {
        return;
      }
      penStrokeEpochRef.current += 1;
      // 新一笔取代任何待清除的上一笔保留；begin 自身会清表面并重置 dash 相位。
      penPreviewPendingCommitRef.current = null;
      setCanaryCommitClear('idle');
      backend.begin(penStrokeEpochRef.current, session.points);
      sweepUnhealthyPenPreview(backend);
    },
    [sweepUnhealthyPenPreview]
  );

  /** pen move 同步点：只增量消费 core session 的新增尾部，绝不全量重投影。 */
  const syncCanvas2dPenAppend = useCallback(
    (next: EditorControllerState) => {
      if (perfRendererModeRef.current !== 'canvas2d-pen') return;
      const backend = penPreviewBackendRef.current;
      if (!backend || backend.isDisposed || !backend.isActive) return;
      const session = next.toolSession;
      if (!session || session.kind !== 'continuous' || session.tool !== 'pen') return;
      backend.append(penStrokeEpochRef.current, session.points);
      sweepUnhealthyPenPreview(backend);
    },
    [sweepUnhealthyPenPreview]
  );

  /**
   * pen up 同步点：先把 finished session 的完整尾部 flush 进预览，再按提交结果决定
   * 保留（已提交：等 world 绘制可见后清，避免空帧）或立即清（退化未提交/预览不活跃）。
   */
  const syncCanvas2dPenCommit = useCallback(
    (
      finished: EditorControllerState,
      committedState: EditorControllerState,
      committedOnce: boolean
    ) => {
      if (perfRendererModeRef.current !== 'canvas2d-pen') return;
      const backend = penPreviewBackendRef.current;
      if (!backend || backend.isDisposed) return;
      const session = finished.toolSession;
      if (session?.kind === 'continuous' && session.tool === 'pen') {
        backend.append(penStrokeEpochRef.current, session.points);
      }
      if (!backend.healthy) {
        backend.clear();
        penPreviewPendingCommitRef.current = null;
        setCanaryCommitClear('idle');
        return;
      }
      if (
        resolveCanvas2dPenCommitClear(committedOnce) === 'retain-until-world-present' &&
        backend.isActive
      ) {
        // 锁定当前实例：最终清除只清这一实例；新笔 begin 会替换 pending，天然身份隔离。
        penPreviewPendingCommitRef.current = {
          revision: committedState.interaction.runtime.documentState.revision,
          backend,
        };
        setCanaryCommitClear('retained');
        return;
      }
      backend.clear();
      penPreviewPendingCommitRef.current = null;
      setCanaryCommitClear('idle');
    },
    []
  );

  const cancelTool = useCallback(() => {
    const current = controllerRef.current;
    actionPointerRef.current = null;
    clearCanvas2dPenPreview();
    updateController(resetToolSession(cancelEditorControllerTool(current).state));
    setNotice(
      `${current.tool === 'polygon' ? '多边形' : current.tool === 'bezier' ? '贝塞尔' : '当前'}候选已取消，未写入历史。`
    );
  }, [clearCanvas2dPenPreview, resetToolSession, updateController]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      // 阻止浏览器滚动；Space 只改变导航归属，不会创建任何工具会话。
      event.preventDefault();
      spaceHeldRef.current = true;
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    panEnabledRef.current = panEnabled;
  }, [panEnabled]);

  /** Web adapter 是唯一 pointer 生命周期边界，避免 mouse/touch 双通道重复提交。 */
  useEffect(() => {
    if (!host) return;
    const adapter = createWebInputAdapter({
      host,
      onInput: (input) => {
        if (perfRendererModeRef.current !== null) {
          // 每个正式 adapter receipt = 一次 visual publish，仅用于牵引诊断 pulse；不写任何测量数据。
          diagnosticPublishRef.current += 1;
        }
        if (performanceMode) {
          performancePointerSampleRef.current = recordPerformancePointerInput(
            performanceMeasurementsRef.current,
            input.pointerId,
            input.phase,
            performanceAdapterReceiptEmissionRef.current
          );
          performanceAdapterReceiptEmissionRef.current = null;
        }
        latestPointerInputsRef.current.set(input.pointerId, input);
        const current = controllerRef.current;
        const rulerState =
          current.interaction.transient.ruler?.state ??
          current.interaction.ruler?.state ??
          INITIAL_RULER_STATE;
        // visualCenter 是可视裁切段中点，也是下一次 Alt 旋转传给 core 的稳定 pivot。
        const rulerLayout = getInfiniteRulerLayout({
          logicalCenter: rulerState.center,
          rotationRad: rulerState.rotationRad,
          height: RULER_HEIGHT,
          viewport: { width: host.clientWidth, height: host.clientHeight },
        });
        const rulerRect = {
          center: rulerState.center,
          length: rulerLayout.renderLength,
          height: RULER_HEIGHT,
          rotationRad: rulerState.rotationRad,
        };
        const lockedOwner = pointerOwnersRef.current.get(input.pointerId);
        const geometricRulerHit = isInsideRuler(input.screen, rulerRect);
        // safe-control / none 是路由早退条件，不能被宿主几何上的尺子条带覆盖。
        const rawRole =
          input.targetRole === 'safe-control' || input.targetRole === 'none'
            ? input.targetRole
            : geometricRulerHit
              ? 'ruler'
              : input.targetRole;
        // core 的 owner 与候选路由均在 down-time 锁定；capture 后 target 的变化不参与重分类。
        const rulerModifierHeld =
          input.modifiers.alt || input.modifiers.ctrl || input.modifiers.meta;
        let normalizedInput = lockedOwner
          ? { ...input, targetRole: lockedOwner === 'pan' ? ('paper' as const) : lockedOwner }
          : rawRole === 'ruler' &&
              (input.device === 'pen' || (input.device === 'mouse' && !rulerModifierHeld))
            ? { ...input, targetRole: 'paper' as const }
            : { ...input, targetRole: rawRole };
        if (input.phase === 'down' && input.device === 'mouse' && input.button !== 0) return;
        if (
          !lockedOwner &&
          input.phase !== 'down' &&
          (input.targetRole === 'safe-control' || input.targetRole === 'none')
        ) {
          return;
        }
        const downSelectionFrame =
          normalizedInput.phase === 'down'
            ? deriveSelectionFrame(
                current.interaction.runtime.documentState.document,
                current.selectionTargets
              )
            : null;
        const downSelectionOverlay = downSelectionFrame
          ? deriveSelectionOverlayModel(downSelectionFrame, current.interaction.viewport)
          : null;
        const downSelectionHit = downSelectionOverlay
          ? hitTestSelectionOverlay(downSelectionOverlay, normalizedInput.screen)
          : null;
        // Space/pan 高于选框；否则选框命中优先于尺子层。
        if (
          downSelectionHit &&
          normalizedInput.phase === 'down' &&
          !panEnabledRef.current &&
          !spaceHeldRef.current
        ) {
          normalizedInput = { ...normalizedInput, targetRole: 'selection' };
        }
        if (!lockedOwner && normalizedInput.phase === 'down') {
          if (
            normalizedInput.targetRole === 'safe-control' ||
            normalizedInput.targetRole === 'none'
          ) {
            pointerOwnersRef.current.set(normalizedInput.pointerId, 'none');
            return;
          }
          if (panEnabledRef.current || spaceHeldRef.current) {
            pointerOwnersRef.current.set(normalizedInput.pointerId, 'pan');
            normalizedInput = { ...normalizedInput, targetRole: 'paper' };
          } else if (normalizedInput.targetRole === 'selection') {
            pointerOwnersRef.current.set(normalizedInput.pointerId, 'selection');
          } else if (
            normalizedInput.targetRole === 'ruler' &&
            (normalizedInput.device === 'touch' || rulerModifierHeld)
          ) {
            pointerOwnersRef.current.set(normalizedInput.pointerId, 'ruler');
          } else {
            pointerOwnersRef.current.set(normalizedInput.pointerId, 'paper');
            normalizedInput = { ...normalizedInput, targetRole: 'paper' };
          }
        }
        const activeRulerPointer =
          current.interaction.activeGesture?.session.ownership.active.some(
            (entry) => entry.pointerId === normalizedInput.pointerId && entry.owner === 'ruler'
          ) ?? false;
        const rulerRuntime = current.interaction.activeGesture?.session.ruler;
        const canBeginRuler =
          normalizedInput.phase === 'down' &&
          normalizedInput.targetRole === 'ruler' &&
          ((!current.interaction.activeGesture &&
            actionPointerRef.current === null &&
            panPointerRef.current === null &&
            !panEnabledRef.current &&
            !spaceHeldRef.current) ||
            (normalizedInput.device === 'touch' && rulerRuntime?.kind === 'touch-wait'));

        // Pointer capture 会让 move/up 的 DOM target 回到 host；依赖 core 已锁定的
        // owner 继续路由，不能因 Space、平移或越过 paper 而夺走已归属的尺子指针。
        if (activeRulerPointer || canBeginRuler) {
          const begun = current.interaction.activeGesture
            ? { state: current.interaction }
            : beginEditorGesture({
                ...current.interaction,
                // 每段新尺子手势取当前可视裁切段中点；不回退到 INITIAL_RULER_STATE 的 pivot。
                ruler: { state: rulerState, pivot: rulerLayout.visualCenter },
              });
          const reduced = reduceEditorGesture(begun.state, normalizedInput);
          updateController(updateInteraction(current, reduced.state));
          const transientRuler = reduced.state.transient.ruler;
          if (
            transientRuler &&
            (normalizedInput.modifiers.alt || transientRuler.pointerIds.length === 2)
          ) {
            const feedbackPoint =
              transientRuler.pointerIds.length === 2
                ? projectPointToRulerCenterline(normalizedInput.screen, transientRuler.state)
                : (current.interaction.activeGesture?.session.rulerOptions?.pivot ??
                  rulerLayout.visualCenter);
            setRulerAngleFeedback({
              x: feedbackPoint.x,
              y: feedbackPoint.y,
              rotationRad: transientRuler.state.rotationRad,
            });
          }
          if (normalizedInput.phase === 'down') {
            setNotice(
              normalizedInput.device === 'touch'
                ? '尺子触摸已接入：单指等待，双指只平移和旋转，不缩放。'
                : normalizedInput.modifiers.alt
                  ? '尺子旋转预览中；松开后更新非持久尺子状态。'
                  : '尺子平移预览中；松开后更新非持久尺子状态。'
            );
          } else if (normalizedInput.phase === 'up') {
            setNotice(
              normalizedInput.device === 'touch'
                ? '尺子触摸手势已结束；document、history 与 viewport 未变。'
                : '尺子状态已更新；document、history 与 viewport 未变。'
            );
          } else if (normalizedInput.phase === 'cancel') {
            setNotice('尺子手势已取消；document、history 与 viewport 未变。');
          }
          if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel') {
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
            if (!reduced.state.activeGesture) setRulerAngleFeedback(null);
          }
          return;
        }
        // 第三指、已有尺子鼠标会话或另一 owner 的活动手势都不能被尺子接管。
        if (normalizedInput.phase === 'down' && normalizedInput.targetRole === 'ruler') return;
        const activePaperNavigation =
          current.interaction.activeGesture?.session.transient.navigation !== undefined &&
          paperNavigationPointersRef.current?.includes(normalizedInput.pointerId);
        if (
          paperNavigationPointersRef.current !== null &&
          !paperNavigationPointersRef.current.includes(normalizedInput.pointerId)
        ) {
          // 固定首对触点完成前，第三指绝不替换其中任何一指或落入候选工具。
          if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel') {
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
          }
          return;
        }
        // 候选工具先取得的单指 touch 在第二指抵达时立即丢弃本地候选，随后仅由 core
        // GestureSession 维护固定双指 pair。这样不会把同一笔同时写入 tool/controller 与 core。
        if (
          normalizedInput.phase === 'down' &&
          normalizedInput.device === 'touch' &&
          normalizedInput.targetRole === 'paper' &&
          actionPointerRef.current !== null &&
          actionPointerRef.current !== normalizedInput.pointerId &&
          !current.interaction.activeGesture
        ) {
          const first = latestPointerInputsRef.current.get(actionPointerRef.current);
          if (first?.device === 'touch') {
            actionPointerRef.current = null;
            clearTransientPreview();
            clearCanvas2dPenPreview();
            const reset = resetToolSession(cancelEditorControllerTool(current).state);
            const begun = beginEditorGesture({
              ...reset.interaction,
              interactionPolicy: { singleTouch: 'none', twoTouch: 'pan-zoom' },
            });
            const firstReduced = reduceEditorGesture(begun.state, {
              ...first,
              phase: 'down',
              targetRole: 'paper',
            });
            const reduced = reduceEditorGesture(firstReduced.state, normalizedInput);
            paperNavigationPointersRef.current = [first.pointerId, normalizedInput.pointerId];
            updateController(updateInteraction(reset, reduced.state));
            setNotice('纸面双触导航预览中；固定双指只更新 viewport，不写入 document 或 history。');
            return;
          }
        }
        if (activePaperNavigation) {
          const reduced = reduceEditorGesture(current.interaction, normalizedInput);
          updateController(updateInteraction(current, reduced.state));
          if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel') {
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
            if (!reduced.state.activeGesture) {
              paperNavigationPointersRef.current = null;
              setNotice('纸面双触导航已结束；document 与 history 未变。');
            }
          }
          return;
        }
        const selectionGestureActive =
          current.interaction.activeGesture !== undefined &&
          current.interaction.activeGesture.session.selection !== null;
        const selectionHit = downSelectionHit;
        // 一旦工具或 selection 手势已取得该 pointer，Space/平移切换不能中途夺走它。
        const shouldPan =
          !selectionGestureActive &&
          (lockedOwner === 'pan' || panPointerRef.current?.pointerId === normalizedInput.pointerId);

        if (shouldPan) {
          if (normalizedInput.phase === 'down') {
            panPointerRef.current = {
              pointerId: normalizedInput.pointerId,
              start: normalizedInput.screen,
              viewport: current.interaction.viewport,
            };
            return;
          }
          const activePan = panPointerRef.current;
          if (!activePan || activePan.pointerId !== normalizedInput.pointerId) return;
          if (normalizedInput.phase === 'move') {
            const viewport = panViewport(activePan.viewport, {
              x: normalizedInput.screen.x - activePan.start.x,
              y: normalizedInput.screen.y - activePan.start.y,
            });
            if (viewport) {
              const viewportResult = setEditorInteractionViewport(current.interaction, viewport);
              updateController(updateInteraction(current, viewportResult.state));
            }
          } else if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel') {
            panPointerRef.current = null;
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
          }
          return;
        }

        if (normalizedInput.phase === 'down') {
          if (textSessionRef.current || imageImportingRef.current) return;
          if (actionPointerRef.current !== null) return;
          actionPointerRef.current = normalizedInput.pointerId;
          if (selectionHit) {
            if (current.interaction.activeGesture) {
              actionPointerRef.current = null;
              return;
            }
            // 在 down-time 同时冻结 descriptor 与 lasso 产生的 stable targets，后续只走 core 手势。
            const selected = setEditorSelection(
              current.interaction,
              current.selectionTargets,
              selectionHit.gesture
            );
            const begun = beginEditorGesture(selected.state);
            const reduced = reduceEditorGesture(begun.state, {
              ...normalizedInput,
              targetRole: 'selection',
            });
            updateController(updateInteraction(current, reduced.state));
            setNotice(
              `${selectionHit.kind === 'move' ? '移动' : selectionHit.kind === 'rotate' ? '旋转' : '等比缩放'}预览中；松开后最多提交一次。`
            );
            return;
          }
          // 尺边约束使用 host screen-DIP，随后才映射为候选 tool 的 world 点。
          if (supportsRulerEdgeConstraint(current.tool)) {
            rulerEdgeConstraintsRef.current.set(
              normalizedInput.pointerId,
              createRulerEdgeConstraint(normalizedInput.screen, rulerRect)
            );
          }
          const point = worldPoint(normalizedInput, current);
          setNotice(null);
          if (current.tool === 'text') {
            actionPointerRef.current = null;
            // 文本编辑命中只信任本轮 frame；pending/error text 已被 frame 排除，不会留下旧 hit。
            const hit = frameRef.current
              ? hitTestDrawingFrame(frameRef.current, normalizedInput.screen)
              : null;
            if (hit?.entry.source.stroke.tool === 'text') {
              beginExistingText(hit.entry.source.key, hit.entry.source.stroke);
            } else {
              beginNewText(point);
            }
            return;
          }
          if (current.tool === 'image') {
            actionPointerRef.current = null;
            imageAnchorRef.current = point;
            setImageImportStatus('请选择图片；取消不会写入 document。');
            imageInputRef.current?.click();
            return;
          }
          if (current.tool === 'eraser') {
            eraserSamplesRef.current = [point];
            setEraserSamples(eraserSamplesRef.current);
            setPointerDrawing(true);
            return;
          }
          if (current.tool === 'lasso') {
            lassoSamplesRef.current = [point];
            setLassoSamples(lassoSamplesRef.current);
            setPointerDrawing(true);
            return;
          }
          if (current.tool === 'polygon' || current.tool === 'bezier') {
            // 顶点工具以一次 down 为一个离散点击；up 不属于持续工具会话，立即释放 ownership。
            actionPointerRef.current = null;
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
            const added = addEditorControllerToolVertex(current, point);
            if (
              current.tool === 'bezier' &&
              added.state.toolSession?.kind === 'vertices' &&
              added.state.toolSession.points.length === 4
            ) {
              const finished = finishEditorControllerBezier(added.state);
              const committed = commitEditorControllerCandidate(finished.state);
              const committedOnce =
                committed.state.interaction.runtime !== current.interaction.runtime;
              updateController(resetToolSession(committed.state));
              setNotice(
                committedOnce
                  ? '已收集四个控制点，贝塞尔已提交一次。'
                  : '贝塞尔候选无法提交，未写入历史。'
              );
            } else {
              updateController(added.state);
            }
            return;
          }
          setPointerDrawing(true);
          const begunToolPointer = beginEditorControllerToolPointer(current, point).state;
          updateController(begunToolPointer);
          // canvas2d-pen：core session 更新后同步 begin 增量预览（仅 pen；其余工具 no-op）。
          syncCanvas2dPenBegin(begunToolPointer);
          return;
        }

        if (actionPointerRef.current !== normalizedInput.pointerId) {
          // 固定 pair 的首指结束后，第二指只等待自己的 terminal sample；不得重新落入工具，
          // 但必须清掉候选路由缓存，避免浏览器复用 pointerId 时沿用旧 owner。
          if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel') {
            rulerEdgeConstraintsRef.current.delete(normalizedInput.pointerId);
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
          }
          return;
        }
        if (selectionGestureActive) {
          const reduced = reduceEditorGesture(current.interaction, {
            ...normalizedInput,
            targetRole: 'selection',
          });
          if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel')
            actionPointerRef.current = null;
          if (normalizedInput.phase === 'up' || normalizedInput.phase === 'cancel') {
            pointerOwnersRef.current.delete(normalizedInput.pointerId);
            latestPointerInputsRef.current.delete(normalizedInput.pointerId);
          }
          updateController(updateInteraction(current, reduced.state));
          if (normalizedInput.phase === 'up') {
            const committed = reduced.state.runtime !== current.interaction.runtime;
            setNotice(
              committed ? '选框变换已提交一次，可撤销。' : '选框变换未改变 document，未写入历史。'
            );
          } else if (normalizedInput.phase === 'cancel') {
            setNotice('选框变换已取消，document 与 history 未变。');
          }
          return;
        }
        const constraint = rulerEdgeConstraintsRef.current.get(normalizedInput.pointerId);
        const constrained = constraint
          ? constrainPointToRulerEdge(normalizedInput.screen, constraint)
          : null;
        if (constrained)
          rulerEdgeConstraintsRef.current.set(normalizedInput.pointerId, constrained.constraint);
        const point = worldPoint(
          constrained ? { ...normalizedInput, screen: constrained.point } : normalizedInput,
          current
        );
        if (normalizedInput.phase === 'move') {
          if (current.tool === 'eraser') {
            eraserSamplesRef.current = appendSample(eraserSamplesRef.current, point);
            setEraserSamples(eraserSamplesRef.current);
          } else if (current.tool === 'lasso') {
            lassoSamplesRef.current = appendSample(lassoSamplesRef.current, point);
            setLassoSamples(lassoSamplesRef.current);
          } else if (current.tool !== 'polygon' && current.tool !== 'bezier') {
            const moved = moveEditorControllerToolPointer(current, point).state;
            updateController(moved);
            // canvas2d-pen：core session 更新后同步追加尾部（O(新增点)，非全量回放）。
            syncCanvas2dPenAppend(moved);
          }
          return;
        }

        actionPointerRef.current = null;
        setPointerDrawing(false);
        if (normalizedInput.phase === 'cancel') {
          rulerEdgeConstraintsRef.current.delete(normalizedInput.pointerId);
          pointerOwnersRef.current.delete(normalizedInput.pointerId);
          latestPointerInputsRef.current.delete(normalizedInput.pointerId);
          updateController(resetToolSession(cancelEditorControllerTool(current).state));
          clearTransientPreview();
          // 取消不会写入 document：Skia 草稿同步消失，Canvas2D 预览也立即清除（无空帧风险）。
          clearCanvas2dPenPreview();
          setNotice('指针已取消，候选已丢弃且未写入历史。');
          return;
        }
        if (normalizedInput.phase !== 'up') return;
        rulerEdgeConstraintsRef.current.delete(normalizedInput.pointerId);
        pointerOwnersRef.current.delete(normalizedInput.pointerId);
        latestPointerInputsRef.current.delete(normalizedInput.pointerId);
        if (current.tool === 'eraser') {
          const samples = appendSample(eraserSamplesRef.current, point);
          const readyFrame = frameRef.current;
          const frameRevision = frameRevisionRef.current;
          if (!readyFrame || frameRevision === null) {
            // 缺失 frame 时只清除稳定选择；严禁退回 raw document query，以免 pending/unresolved 条目命中。
            updateController(resetToolSession(setEditorControllerSelection(current, []).state));
            clearTransientPreview();
            setFrameQueryStatus({
              mode: 'blocked',
              operation: 'eraser',
              frameRevision: null,
              diagnostics: ['frame-unavailable'],
            });
            setNotice('橡皮擦未查询：当前 frame 未就绪，document 与 history 未变。');
            return;
          }
          const queried = queryEditorControllerDrawingFrameEraser(
            current,
            readyFrame,
            frameRevision,
            samples,
            ERASER_RADIUS,
            { topmostOnly: false }
          );
          const targetCount = queried.state.selectionTargets.length;
          const committed = targetCount > 0 ? commitEditorControllerEraser(queried.state) : queried;
          updateController(resetToolSession(committed.state));
          clearTransientPreview();
          setFrameQueryStatus({
            mode: 'frame',
            operation: 'eraser',
            frameRevision,
            diagnostics: diagnosticTypes(queried.diagnostics),
          });
          setNotice(
            queried.diagnostics.length > 0
              ? `橡皮擦 frame 查询被拒绝：${diagnosticTypes(queried.diagnostics).join(', ')}；未写入历史。`
              : targetCount > 0
                ? `橡皮擦已一次删除 ${targetCount} 个对象，可撤销。`
                : '橡皮擦没有命中对象，未写入历史。'
          );
          return;
        }
        if (current.tool === 'lasso') {
          const polygon = appendSample(lassoSamplesRef.current, point);
          const readyFrame = frameRef.current;
          const frameRevision = frameRevisionRef.current;
          if (!readyFrame || frameRevision === null) {
            // 和 eraser 相同：frame 缺失时只归零选择，不能让 raw document 成为隐藏 fallback。
            updateController(resetToolSession(setEditorControllerSelection(current, []).state));
            clearTransientPreview();
            setFrameQueryStatus({
              mode: 'blocked',
              operation: 'lasso',
              frameRevision: null,
              diagnostics: ['frame-unavailable'],
            });
            setNotice('套索未查询：当前 frame 未就绪，选择已清零，document 与 history 未变。');
            return;
          }
          const queried = queryEditorControllerDrawingFrameLasso(
            current,
            readyFrame,
            frameRevision,
            polygon
          );
          updateController(queried.state);
          clearTransientPreview();
          setFrameQueryStatus({
            mode: 'frame',
            operation: 'lasso',
            frameRevision,
            diagnostics: diagnosticTypes(queried.diagnostics),
          });
          setNotice(
            queried.diagnostics.some(
              (diagnostic) => diagnostic.type === 'frame-revision-mismatch'
            ) ||
              queried.diagnostics.some(
                (diagnostic) => diagnostic.type === 'frame-document-identity-mismatch'
              )
              ? `套索 frame 查询被拒绝：${diagnosticTypes(queried.diagnostics).join(', ')}；选择已清零且未写入历史。`
              : queried.diagnostics.some(
                    (diagnostic) => diagnostic.type === 'invalid-lasso-polygon'
                  )
                ? '套索需要至少三个有效顶点；选择未改变且未写入历史。'
                : `套索已更新选择：${queried.state.selectionTargets.length} 个对象；未写入历史。`
          );
          return;
        }
        if (current.tool === 'polygon' || current.tool === 'bezier') return;

        const finished = finishEditorControllerToolPointer(current, point);
        const committed = commitEditorControllerCandidate(finished.state);
        const committedOnce = committed.state.interaction.runtime !== current.interaction.runtime;
        updateController(resetToolSession(committed.state));
        // canvas2d-pen：已提交则保留预览直到 world 绘制可见（避免空帧）；未提交立即清除。
        if (current.tool === 'pen') {
          syncCanvas2dPenCommit(finished.state, committed.state, committedOnce);
        }
        setNotice(
          committedOnce
            ? `${current.tool === 'pen' ? 'Pen' : '形状'}已提交一次。`
            : '候选退化或不可提交，未写入历史。'
        );
      },
    });
    const capturePerfEmission = (event: Event) => {
      const emission = (
        event as PointerEvent & { __hamsterPerfEmission?: PerformancePointerEmission }
      ).__hamsterPerfEmission;
      performanceAdapterReceiptEmissionRef.current = emission ?? null;
    };
    host.addEventListener('pointerdown', capturePerfEmission, true);
    host.addEventListener('pointermove', capturePerfEmission, true);
    host.addEventListener('pointerup', capturePerfEmission, true);
    host.addEventListener('pointercancel', capturePerfEmission, true);
    return () => {
      host.removeEventListener('pointerdown', capturePerfEmission, true);
      host.removeEventListener('pointermove', capturePerfEmission, true);
      host.removeEventListener('pointerup', capturePerfEmission, true);
      host.removeEventListener('pointercancel', capturePerfEmission, true);
      adapter.destroy();
    };
  }, [
    beginExistingText,
    beginNewText,
    clearCanvas2dPenPreview,
    clearTransientPreview,
    host,
    performanceMode,
    resetToolSession,
    syncCanvas2dPenAppend,
    syncCanvas2dPenBegin,
    syncCanvas2dPenCommit,
    updateController,
  ]);

  useEffect(() => {
    if (!host) return;
    const showZoomFeedback = (x: number, y: number, scale: number) => {
      if (zoomFeedbackTimerRef.current) clearTimeout(zoomFeedbackTimerRef.current);
      setZoomFeedback({ x, y, scale });
      zoomFeedbackTimerRef.current = setTimeout(() => setZoomFeedback(null), 750);
    };
    const onWheel = (event: WheelEvent) => {
      const bounds = host.getBoundingClientRect();
      const focal = {
        x: event.clientX - bounds.left - host.clientLeft,
        y: event.clientY - bounds.top - host.clientTop,
      };
      if (!Number.isFinite(focal.x) || !Number.isFinite(focal.y)) return;
      const current = controllerRef.current;
      // Ctrl/Cmd 是浏览器 pinch-to-wheel 的缩放信号；横向/Shift 轨迹板滚动保持平移。
      const pans =
        !event.ctrlKey && !event.metaKey && (event.shiftKey || Math.abs(event.deltaX) > 0);
      const viewport = pans
        ? panViewport(current.interaction.viewport, {
            x: event.shiftKey ? -event.deltaY : -event.deltaX,
            y: event.shiftKey ? 0 : -event.deltaY,
          })
        : zoomViewportAt(current.interaction.viewport, focal, Math.exp(-event.deltaY * 0.002));
      if (!viewport) return;
      const result = setEditorInteractionViewport(current.interaction, viewport);
      if (result.state === current.interaction) return;
      event.preventDefault();
      updateController(updateInteraction(current, result.state));
      if (!pans) showZoomFeedback(focal.x, focal.y, viewport.scale);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      if (zoomFeedbackTimerRef.current) clearTimeout(zoomFeedbackTimerRef.current);
    };
  }, [host, updateController]);

  const onCanvasLayout = useCallback(
    (event: LayoutChangeEvent) => {
      lifecycleDiagnostics.increment('layout-events');
      const { width, height } = event.nativeEvent.layout;
      const next = validCanvasSize(width, height);
      if (!next) {
        const problem = `无效画布尺寸 ${String(width)}×${String(height)}（要求有限正数，单边不超过 ${MAX_CANVAS_LAYOUT_EDGE}）`;
        setLayoutProblem((current) => (current === problem ? current : problem));
        lifecycleDiagnostics.set('layout-status', 'invalid');
        return;
      }
      setLayoutProblem((current) => (current === null ? current : null));
      lifecycleDiagnostics.set('layout-status', `${next.width}x${next.height}`);
      setCanvasSize((current) => {
        if (current?.width === next.width && current.height === next.height) return current;
        lifecycleDiagnostics.increment('layout-changes');
        return next;
      });
    },
    [lifecycleDiagnostics]
  );

  const selectTool = useCallback(
    (tool: EditorControllerTool) => {
      if (textSessionRef.current || imageImportingRef.current) {
        setNotice('请先完成或取消当前文本/图片会话。');
        return;
      }
      actionPointerRef.current = null;
      pointerOwnersRef.current.clear();
      paperNavigationPointersRef.current = null;
      rulerEdgeConstraintsRef.current.clear();
      clearTransientPreview();
      // 换工具让任何活动/保留中的 pen 预览立即失效，绝不把陈旧预览带进下一个工具。
      clearCanvas2dPenPreview();
      updateController(setEditorControllerTool(controllerRef.current, tool).state);
      setNotice(null);
    },
    [clearCanvas2dPenPreview, clearTransientPreview, updateController]
  );

  const finishPolygon = useCallback(() => {
    const current = controllerRef.current;
    const points = current.toolSession?.kind === 'vertices' ? current.toolSession.points : [];
    if (!hasNonCollinearVertices(points)) {
      setNotice('多边形至少需要三个非共线顶点，未写入历史。');
      return;
    }
    const finished = finishEditorControllerPolygon(current);
    const committed = commitEditorControllerCandidate(finished.state);
    const committedOnce = committed.state.interaction.runtime !== current.interaction.runtime;
    updateController(resetToolSession(committed.state, 'polygon'));
    setNotice(committedOnce ? '多边形已提交一次。' : '多边形候选无法提交，未写入历史。');
  }, [resetToolSession, updateController]);

  const undo = useCallback(() => {
    const current = controllerRef.current;
    const interaction = undoEditorInteraction(current.interaction).state;
    // controller 镜像自己的 stable targets，必须使用 core undo 后的清空结果刷新它。
    const next = updateInteraction(current, interaction);
    // undo 立即改写 world：任何保留中的 pen 预览都已不属于当前 document，必须同步清除。
    clearCanvas2dPenPreview();
    updateController(setEditorControllerSelection(next, interaction.selectionTargets).state);
  }, [clearCanvas2dPenPreview, updateController]);

  const redo = useCallback(() => {
    const current = controllerRef.current;
    const interaction = redoEditorInteraction(current.interaction).state;
    // 同 undo：不允许 footer 或选框继续读取 redo 前的 controller targets。
    const next = updateInteraction(current, interaction);
    clearCanvas2dPenPreview();
    updateController(setEditorControllerSelection(next, interaction.selectionTargets).state);
  }, [clearCanvas2dPenPreview, updateController]);

  const clear = useCallback(() => {
    const current = controllerRef.current;
    const { document, revision } = current.interaction.runtime.documentState;
    const cleared = applyEditorRuntimeCommand(current.interaction.runtime, {
      type: 'remove-strokes',
      expectedRevision: revision,
      targets: document.strokes.map((stroke, index) => ({
        index,
        expectedId: stroke.id,
        expectedTool: stroke.tool,
      })),
    });
    if (cleared.state !== current.interaction.runtime) {
      const next = updateInteraction(current, {
        ...current.interaction,
        runtime: cleared.state,
        diagnostics: [],
      });
      // 清空改写 world：保留中的 pen 预览同步失效，避免陈旧预览覆盖空文档。
      clearCanvas2dPenPreview();
      updateController(setEditorControllerSelection(next, []).state);
    }
  }, [clearCanvas2dPenPreview, updateController]);

  const clearSelection = useCallback(() => {
    updateController(setEditorControllerSelection(controllerRef.current, []).state);
    setNotice('选择已清除，未写入历史。');
  }, [updateController]);

  const panBy = useCallback(
    (x: number, y: number) => {
      const current = controllerRef.current;
      const viewport = current.interaction.viewport;
      const result = setEditorInteractionViewport(current.interaction, {
        ...viewport,
        tx: viewport.tx + x,
        ty: viewport.ty + y,
      });
      updateController(updateInteraction(current, result.state));
    },
    [updateController]
  );

  const document = controller.interaction.runtime.documentState.document;
  const runtime = controller.interaction.runtime;
  const documentRevision = runtime.documentState.revision;
  const sessionPoints =
    controller.toolSession?.kind === 'vertices' ? controller.toolSession.points : [];
  const hasOpenCandidate =
    pointerDrawing ||
    controller.toolSession?.status === 'active' ||
    controller.interaction.activeGesture !== undefined ||
    textSession !== null ||
    imageImporting;
  const canFinishPolygon = controller.tool === 'polygon' && hasNonCollinearVertices(sessionPoints);
  const overlays = useMemo(
    () => draftOverlay(controller, eraserSamples, lassoSamples),
    [controller, eraserSamples, lassoSamples]
  );
  // core 已物化并冻结活动选框预览；UI 不重放 replacement，也不改写 runtime document/history。
  const previewDocument = controller.interaction.selectionPreview?.document ?? document;
  const selectionFrame = useMemo(
    () => deriveSelectionFrame(previewDocument, controller.selectionTargets),
    [controller.selectionTargets, previewDocument]
  );
  const selectionOverlay = useMemo(
    () =>
      selectionFrame
        ? deriveSelectionOverlayModel(selectionFrame, controller.interaction.viewport)
        : null,
    [controller.interaction.viewport, selectionFrame]
  );
  // 活动预览来自 core transient；完成 effect 才会把它写回 interaction.ruler。
  const displayedRuler =
    controller.interaction.transient.ruler?.state ??
    controller.interaction.ruler?.state ??
    INITIAL_RULER_STATE;
  // 绘制与命中都从这一份公开尺子几何推导，避免 selector 的矩形与可见尺身漂移。
  const rulerLayout = useMemo(
    () =>
      getInfiniteRulerLayout({
        logicalCenter: displayedRuler.center,
        rotationRad: displayedRuler.rotationRad,
        height: RULER_HEIGHT,
        viewport: canvasSize ?? { width: 1, height: 1 },
      }),
    [canvasSize, displayedRuler]
  );
  const rulerRotationDegrees = Math.round((displayedRuler.rotationRad * 180) / Math.PI);
  // 编辑既有文本时暂时从 renderer 移除目标，避免与绝对定位 textarea 重叠显示。
  const renderDocument = useMemo(() => {
    if (textSession?.mode !== 'existing') return previewDocument;
    const target = textSession.target as { index: number };
    const withoutEditingStroke: DrawingValueV2 = {
      schemaVersion: 2,
      strokes: previewDocument.strokes.filter((_, index) => index !== target.index),
    };
    return withoutEditingStroke;
  }, [previewDocument, textSession]);
  // 生产资产需求取完整 runtime document，编辑时隐藏的 stroke 也不能让已注册资源在 session 中被卸载。
  const documentTexts = useMemo(
    () => [
      ...document.strokes.flatMap((stroke) => (stroke.tool === 'text' ? [stroke.text] : [])),
      ...(textSession ? [textSession.draft.text] : []),
    ],
    [document, textSession]
  );
  // 已提交文本面板的可见性：把 O(n) 的 .some() 收敛为随 document 记忆化的布尔值，
  // 避免 perf workload（100k 笔迹、无文本）在每次 render 都全量扫描。
  const hasCommittedText = useMemo(
    () => document.strokes.some((stroke) => stroke.tool === 'text'),
    [document]
  );
  const fontAssets = useCandidateFontAssets(
    documentTexts,
    textRetryGeneration,
    lifecycleDiagnostics
  );
  // prepared document 与 spatial index 只能由同一个 document identity 成对创建。
  // 缓存最近一次成功计算的 document + prepared/index，用于严格 append-only 增量化。
  const pipelineSnapshotRef = useRef<PreparedPipelineSnapshot | null>(null);
  const pipeline = useMemo(() => {
    const previous = pipelineSnapshotRef.current;
    // 同一 document identity：直接复用缓存（覆盖 StrictMode/重复调用，避免同一份被重建两次）。
    if (previous !== null && previous.document === renderDocument) return previous;
    if (
      previous !== null &&
      previous.prepared !== null &&
      previous.spatialIndex !== null &&
      previous.spatialIndex.prepared === previous.prepared &&
      previous.prepared.strokeCount === previous.document.strokes.length &&
      isStrictStrokeAppend(previous.document, renderDocument)
    ) {
      try {
        let spatialIndex = previous.spatialIndex;
        // 可能一次追加多条：逐条走 core 增量 API，始终复用上一段不可变 index。
        for (
          let index = previous.document.strokes.length;
          index < renderDocument.strokes.length;
          index += 1
        ) {
          spatialIndex = appendPreparedDrawingEntry(spatialIndex, renderDocument.strokes[index]);
        }
        const incremental: PreparedPipelineSnapshot = {
          document: renderDocument,
          prepared: spatialIndex.prepared,
          spatialIndex,
          error: null,
        };
        pipelineSnapshotRef.current = incremental;
        return incremental;
      } catch {
        // 增量路径异常一律退回全量重建，绝不把半成品快照交给下游 frame。
      }
    }
    try {
      const prepared = prepareDrawingDocument(renderDocument);
      const rebuilt: PreparedPipelineSnapshot = {
        document: renderDocument,
        prepared,
        spatialIndex: createPreparedDrawingSpatialIndex(prepared),
        error: null,
      };
      pipelineSnapshotRef.current = rebuilt;
      return rebuilt;
    } catch (error) {
      const failed: PreparedPipelineSnapshot = {
        document: renderDocument,
        prepared: null,
        spatialIndex: null,
        error: errorMessage(error),
      };
      pipelineSnapshotRef.current = failed;
      return failed;
    }
  }, [renderDocument]);
  // 第一帧仅抽取 core text requests；它不挂载 renderer，因此不会产生 fallback render/hit。
  const textRequestFrame = useMemo(() => {
    if (!pipeline.prepared || !pipeline.spatialIndex || !canvasSize) return null;
    const outcome = tryCreateDrawingFrame({
      prepared: pipeline.prepared,
      spatialIndex: pipeline.spatialIndex,
      viewport: controller.interaction.viewport,
      layoutSize: canvasSize,
    });
    return outcome.ok ? outcome.frame : null;
  }, [canvasSize, controller.interaction.viewport, pipeline.prepared, pipeline.spatialIndex]);
  const textRequests = useMemo(() => {
    if (!textRequestFrame) return [];
    return textRequestFrame.visibleEntries.flatMap((entry) =>
      entry.fragments.flatMap((fragment) => {
        const resourceBox = (
          fragment as Readonly<{
            resourceBox?: Readonly<{
              tool?: string;
              textRequest?: import('@hamster-note/painting/core').FrameTextRequest;
            }>;
          }>
        ).resourceBox;
        return fragment.kind === 'semantic-area' &&
          resourceBox?.tool === 'text' &&
          resourceBox.textRequest
          ? [resourceBox.textRequest]
          : [];
      })
    );
  }, [textRequestFrame]);
  const textShaping = useCandidateTextShaping(fontAssets, textRequests);
  // resolve 函数本身保持在 ref 内；frame 的可观察重建门是 document/viewport/layout 与 program revision。
  const resolveTextProgramRef = useRef(textShaping.resolveTextProgram);
  resolveTextProgramRef.current = textShaping.resolveTextProgram;
  const frameInput = useMemo(
    () => ({
      documentRevision,
      viewport: controller.interaction.viewport,
      layoutSize: canvasSize,
      resourceRevision: fontAssets.resourceRevision,
      providerIdentity: fontAssets.providerIdentity,
      textProgramRevision: textShaping.programRevision,
    }),
    [
      canvasSize,
      controller.interaction.viewport,
      documentRevision,
      fontAssets.providerIdentity,
      fontAssets.resourceRevision,
      textShaping.programRevision,
    ]
  );
  // 这是唯一允许交给 Skia canvas 的 frame：resolveTextProgram 同步读 controller 的 ready cache。
  const frameOutcome = useMemo(() => {
    if (!pipeline.prepared || !pipeline.spatialIndex || !frameInput.layoutSize) {
      return null;
    }
    return tryCreateDrawingFrame({
      prepared: pipeline.prepared,
      spatialIndex: pipeline.spatialIndex,
      viewport: frameInput.viewport,
      layoutSize: frameInput.layoutSize,
      resolveTextProgram: (request) => resolveTextProgramRef.current(request),
    });
  }, [frameInput, pipeline.prepared, pipeline.spatialIndex]);
  const frame = frameOutcome?.ok ? frameOutcome.frame : null;
  useEffect(() => {
    if (frame) lifecycleDiagnostics.increment('frame-builds');
  }, [frame, lifecycleDiagnostics]);
  useEffect(() => {
    lifecycleDiagnostics.set('resource-revision', String(fontAssets.resourceRevision));
    lifecycleDiagnostics.set('provider-identity', fontAssets.providerIdentity);
    lifecycleDiagnostics.set('route-phase', frame ? 'frame-ready' : 'frame-blocked');
  }, [fontAssets.providerIdentity, fontAssets.resourceRevision, frame, lifecycleDiagnostics]);
  // ---- canvas2d-pen 金丝雀派生量（非该模式时 backend 恒为 null，全部退化为正式语义）----
  // 提前到 frameOverlays 之前：健康路径在 rebase 前即剔除 pen 草稿，避免整段草稿点的无效重定基。
  const penPreviewBackend = penPreviewBackendRef.current;
  // 只有 Canvas2D 后端健康且正在真实预览当前 pen 草稿时，才把 pen 草稿从 Skia overlays 排除；
  // 否则 pen 草稿回到 Skia（fail closed），绝不出现两边都不画的隐形预览。
  const canvas2dPenPreviewUsable =
    perfRendererMode === 'canvas2d-pen' &&
    penPreviewBackend !== null &&
    penPreviewBackend.healthy &&
    penPreviewBackend.isActive;
  const frameOverlays = useMemo(() => {
    if (!frame) return [];
    // canvas2d-pen 健康路径：pen 草稿由 Canvas2D 增量预览接管，rebase 前即按 id 剔除，
    // 避免每次 publish 对整段草稿点做 O(全部点) 的 world→local 重定基。
    // rebaseOverlaysToFrame 逐 overlay 映射且保留 id/顺序，故输出与「rebase 后过滤」严格等价。
    const source = canvas2dPenPreviewUsable
      ? overlays.filter((overlay) => overlay.id !== CANVAS2D_PEN_DRAFT_OVERLAY_ID)
      : overlays;
    return rebaseOverlaysToFrame(source, frame);
  }, [frame, overlays, canvas2dPenPreviewUsable]);
  // ---- perfRenderer 诊断变体（perfRendererMode 为 null 时下方全部保持正式语义）----
  // 只替换送进 Canvas 的 world / overlay，不改任何 core/document/提交/测量路径。
  const diagnosticPublish = diagnosticPublishRef.current;
  // 空 world frame：与真实 frame 使用同一 viewport/layout，因此 frameOrigin 与 localToScreen
  // 一致，供 overlay-only 的 world overlay 以同一矩阵正确投影。
  const diagnosticEmptyFrame = useMemo(() => {
    if (perfRendererMode === null || canvasSize === null) return null;
    try {
      const prepared = prepareDrawingDocument(EMPTY_DOCUMENT);
      const outcome = tryCreateDrawingFrame({
        prepared,
        spatialIndex: createPreparedDrawingSpatialIndex(prepared),
        viewport: controller.interaction.viewport,
        layoutSize: canvasSize,
      });
      return outcome.ok ? outcome.frame : null;
    } catch {
      return null;
    }
  }, [perfRendererMode, canvasSize, controller.interaction.viewport]);
  // 屏外极小 command：仅端点随每次 publish 变化，牵引真实 RN Skia redraw；位于 canvas 外，
  // 不产生可见像素，也不进入任何测量字段。
  // split-canvas 明确不注入任何 pulse（由 resolveSplitOverlayOverlays 保持），故此处直接返回 null。
  const diagnosticPulseOverlay = useMemo<SkiaOverlay | null>(() => {
    if (perfRendererMode === null || perfRendererMode === 'split-canvas') return null;
    const offset = (diagnosticPublish % 512) * 0.001;
    return {
      id: 'perf-renderer-pulse',
      space: 'screen',
      kind: 'line',
      from: { x: -1000, y: -1000 },
      to: { x: -1000 + offset, y: -1000 },
      style: { strokeWidth: 1, color: '#000000' },
    };
  }, [perfRendererMode, diagnosticPublish]);
  const canvasFrame =
    perfRendererMode === null || perfRendererMode === 'world-pulse' ? frame : diagnosticEmptyFrame;
  const canvasBaseOverlays =
    perfRendererMode === null || perfRendererMode === 'overlay-only' ? frameOverlays : [];
  const canvasOverlays =
    diagnosticPulseOverlay === null
      ? canvasBaseOverlays
      : [...canvasBaseOverlays, diagnosticPulseOverlay];
  // split-canvas：底层 world 用真实 frame；顶层 overlay 用同一 viewport/layout 的 empty frame
  // 承载完整原 frameOverlays（明确不注入 pulse）。world 层由 React.memo 隔离，props 保持稳定。
  const splitOverlayOverlays = resolveSplitOverlayOverlays(
    perfRendererMode,
    frameOverlays,
    diagnosticPulseOverlay
  );
  const splitCanvasReady = frame !== null && diagnosticEmptyFrame !== null;
  const canvas2dPenWorldOverlays = useMemo(
    () =>
      resolveCanvas2dPenWorldOverlays(perfRendererMode, frameOverlays, canvas2dPenPreviewUsable),
    [perfRendererMode, frameOverlays, canvas2dPenPreviewUsable]
  );
  const penPreviewCounters = penPreviewBackend?.getCounters() ?? null;
  // 10s gate 预检读取：split→'off'、其余诊断脉冲模式→'on'、正式→不输出该属性。
  const perfRendererPulseMarker = resolvePerfRendererPulseMarker(perfRendererMode);
  const diagnosticSurfacePhase = !canvasSize
    ? 'surface-starting'
    : !frame
      ? 'layout-ready'
      : textShaping.error > 0 || (fontAssets.phase === 'ready' && !fontAssets.fontManager)
        ? 'font-error'
        : fontAssets.phase === 'pending' || textShaping.phase === 'pending'
          ? 'font-pending'
          : fontAssets.phase === 'ready' && textShaping.phase === 'ready'
            ? 'font-ready'
            : 'frame-ready';
  const frameBlocked = !canvasSize || layoutProblem !== null || pipeline.error !== null || !frame;
  // 只有 frame 本身不可用才禁用输入；文本单条 pending/error 已由同一 frame 排除 render/hit。
  frameRef.current = frameBlocked ? null : frame;
  frameRevisionRef.current = frameBlocked ? null : documentRevision;
  const editorBox = textSession
    ? textEditorBox(textSession, document, controller.interaction.viewport)
    : null;
  const status =
    notice ??
    `${toolPrompt(controller.tool, sessionPoints)}${panEnabled || spaceHeld ? ' 当前为平移模式。' : ' 按住 Space 拖拽可平移画布。'}`;
  // checksum 改为按需计算：只在 getSnapshot 读取时对当前 document 计算一次，避免 perf run 的
  // pointerup 提交 render（100k 笔迹）里同步做全量扫描并长时间占用主线程。getSnapshot 在窗口
  // 结束后调用，闭包始终捕获最新一次 render 的 document，故最终文档与 checksum 语义不变。
  performanceSnapshotRef.current = () => {
    const performanceChecksum = performanceMode ? checksumPerformanceDocument(document) : null;
    return {
      version: EDITOR_PERFORMANCE_WORKLOAD.version,
      mode: performanceMode ? 'enabled' : 'disabled',
      workload: performanceMode
        ? {
            ...EDITOR_PERFORMANCE_WORKLOAD,
            checksum: performanceChecksum,
          }
        : null,
      canvas: {
        ready: canvasDiagnosticStage === null && frame !== null && initialLatinFontPublished,
        size: canvasSize ? { ...canvasSize } : null,
        frameStatus: frame ? 'ready' : 'blocked',
      },
      document: {
        strokeCount: document.strokes.length,
        revision: documentRevision,
        checksum: performanceChecksum,
      },
      frame: frame
        ? {
            ready: true,
            origin: { ...frame.frameOrigin },
            visibleWorldBounds: { ...frame.visibleWorldBounds },
            visible: frame.visibleEntries.length,
            renderable: frame.renderableEntries.length,
            unresolved: frame.unresolvedClippingKeys.length,
            unresolvedKeys: [...frame.unresolvedClippingKeys],
            diagnostics: frame.diagnostics.map((diagnostic) => ({ ...diagnostic })),
          }
        : {
            ready: false,
            visible: 0,
            renderable: 0,
            unresolved: 0,
            unresolvedKeys: [],
            diagnostics:
              frameOutcome && !frameOutcome.ok
                ? frameOutcome.diagnostics.map((item) => ({ ...item }))
                : [],
          },
      resources: {
        revision: fontAssets.resourceRevision,
        providerRevision: textShaping.programRevision,
        providerIdentity: fontAssets.providerIdentity,
      },
      measurements: measurementSnapshot(performanceMeasurementsRef.current),
    };
  };
  runHighRatePenInputRef.current = async ({ eventsPerSecond, durationMs }) => {
    const measurements = performanceMeasurementsRef.current;
    const invalid =
      !Number.isFinite(eventsPerSecond) ||
      !Number.isInteger(eventsPerSecond) ||
      eventsPerSecond <= 0 ||
      !Number.isFinite(durationMs) ||
      !Number.isInteger(durationMs) ||
      durationMs <= 0;
    if (invalid || !host || performanceRunActiveRef.current) {
      return {
        status: invalid
          ? 'invalid-options'
          : performanceRunActiveRef.current
            ? 'already-running'
            : 'host-unavailable',
        requested: { eventsPerSecond, durationMs },
      };
    }
    const eventCount = (eventsPerSecond * durationMs) / 1_000;
    if (!Number.isInteger(eventCount) || eventCount < 2 || typeof PointerEvent === 'undefined') {
      return {
        status:
          typeof PointerEvent === 'undefined'
            ? 'pointer-event-unsupported'
            : 'non-integral-event-count',
        requested: { eventsPerSecond, durationMs },
        eventCount,
      };
    }
    performanceRunActiveRef.current = true;
    // A run owns exactly one raw collection. Sampling is not allowed to include route startup,
    // snapshot serialization, or Playwright's cross-process object transfer.
    resetEditorPerformanceMeasurements(measurements);
    const stopSampling = startEditorPerformanceSampling(measurements);
    const pointerId = 90_001;
    const bounds = host.getBoundingClientRect();
    // 运行期间宿主尺寸固定：把 clientWidth/clientHeight 缓存在闭包外，避免每次 timer 回调重复布局读取。
    const hostClientWidth = host.clientWidth;
    const hostClientHeight = host.clientHeight;
    // 固定 pre-arm lead：先在正式窗口之外注册全部绝对 deadline timer，避免首个 deadline
    // 与 arming 争用主线程；startAt/windowEnd/120Hz interval 语义保持不变。
    const armingStartedAt = performance.now();
    const prearmLeadMs = PERF_SCHEDULER_PREARM_LEAD_MS;
    const startAt = armingStartedAt + prearmLeadMs;
    const intervalMs = 1_000 / eventsPerSecond;
    const plans = buildPerformanceDeadlines(startAt, eventCount, eventsPerSecond);
    const scheduleWindowEndsAt = startAt + durationMs;
    // Settlement has a bounded, explicit grace period. Missing receipt/commit/rAF stays INVALID;
    // it must never prolong observation into snapshot creation or runner object transport.
    const settlementDeadlineAt = scheduleWindowEndsAt + durationMs;
    return new Promise<Record<string, unknown>>((resolve) => {
      let dispatched = 0;
      let settled = false;
      let allTimersRegisteredAt: number | null = null;
      const schedulerCounters: PerformanceDeadlineSchedulerCounters = {
        timerAttemptCount: 0,
        earlyRetryCount: 0,
      };
      const complete = (settledWithinWindow: boolean) => {
        if (settled) return;
        settled = true;
        finalizeEditorPerformanceMeasurementWindow(measurements);
        stopSampling();
        performanceRunActiveRef.current = false;
        const emittedAt = measurements.pointerSamples
          .map((sample) => sample.emittedAt)
          .filter((value): value is number => Number.isFinite(value));
        const callbackAt = measurements.pointerSamples
          .map((sample) => sample.callbackAt)
          .filter((value): value is number => Number.isFinite(value));
        const scheduleLatenessMs = measurements.pointerSamples
          .map((sample) =>
            sample.callbackAt !== null && sample.scheduledAt !== null
              ? sample.callbackAt - sample.scheduledAt
              : Number.NaN
          )
          .filter((value): value is number => Number.isFinite(value));
        const backlogAtCallback = measurements.pointerSamples
          .map((sample) => sample.backlogAtCallback)
          .filter((value): value is number => Number.isFinite(value));
        const emittedCount = emittedAt.length;
        const allSamplesSettled =
          emittedCount === eventCount &&
          measurements.pointerSamples.every(
            (sample) =>
              sample.receivedAt !== null && sample.commitAt !== null && sample.nextFrameAt !== null
          );
        const workloadPrerequisiteFailed =
          emittedCount !== eventCount ||
          !allSamplesSettled ||
          !settledWithinWindow ||
          isArmingOverrun(allTimersRegisteredAt, startAt) ||
          (emittedAt.length > 0 && Math.max(...emittedAt) > scheduleWindowEndsAt);
        resolve({
          status: workloadPrerequisiteFailed ? 'workload-prerequisite-failed' : 'completed',
          requested: { eventsPerSecond, durationMs },
          actual: {
            eventCount,
            dispatched,
            pointerId,
            armingStartedAt,
            prearmLeadMs,
            allTimersRegisteredAt,
            timerAttemptCount: schedulerCounters.timerAttemptCount,
            earlyRetryCount: schedulerCounters.earlyRetryCount,
            firstScheduledAt: plans[0]?.scheduledAt ?? null,
            lastScheduledAt: plans.at(-1)?.scheduledAt ?? null,
            firstCallbackAt: callbackAt.length > 0 ? Math.min(...callbackAt) : null,
            lastCallbackAt: callbackAt.length > 0 ? Math.max(...callbackAt) : null,
            lastEmittedAt: emittedAt.length > 0 ? Math.max(...emittedAt) : null,
            scheduleWindowEndsAt,
            settlementDeadlineAt,
            actualOpenLoopSpanMs:
              emittedAt.length > 0 ? Math.max(...emittedAt) - Math.min(...emittedAt) : null,
            callbackSpanMs:
              callbackAt.length > 0 ? Math.max(...callbackAt) - Math.min(...callbackAt) : null,
            maxScheduleLatenessMs:
              scheduleLatenessMs.length > 0 ? Math.max(...scheduleLatenessMs) : null,
            maxBacklogAtCallback:
              backlogAtCallback.length > 0 ? Math.max(...backlogAtCallback) : null,
            settlementCompletedAt: measurements.measurementWindow.stoppedAt,
            settledWithinWindow,
          },
          workloadPrerequisiteFailed,
          measurements: measurementSnapshot(measurements),
        });
      };
      const trySettle = () => {
        const samplesSettled =
          dispatched === eventCount &&
          measurements.pendingPointerEmissions.length === 0 &&
          measurements.pendingFrameSamples.length === 0 &&
          performancePendingCommitSamplesRef.current.length === 0 &&
          measurements.pointerSamples.length === eventCount &&
          measurements.pointerSamples.every((sample) => sample.commitAt !== null);
        if (samplesSettled) {
          complete(true);
          return;
        }
        if (performance.now() >= settlementDeadlineAt) {
          complete(false);
          return;
        }
        window.requestAnimationFrame(trySettle);
      };
      /**
       * 单个 event 到达绝对 deadline 后的记录与派发。排程/早醒重排由纯核心
       * `schedulePerformanceDeadlines` 负责；这里只处理「已确认 callbackAt >= scheduledAt」的情况。
       */
      const onDeadline = (deadline: PerformanceDeadline, callbackAt: number): void => {
        const { index, scheduledAt } = deadline;
        const deadlinesDueAtCallback = Math.max(
          0,
          Math.floor((callbackAt - startAt) / intervalMs) + 1
        );
        const phase: PerformancePointerSample['phase'] =
          index === 0 ? 'down' : index === eventCount - 1 ? 'up' : 'move';
        const x =
          120 + ((index * 7) % Math.max(1, Math.floor(Math.min(640, hostClientWidth - 160))));
        const y =
          120 + ((index * 5) % Math.max(1, Math.floor(Math.min(360, hostClientHeight - 160))));
        const emission: PerformancePointerEmission = {
          eventId: `run-${startAt.toFixed(3)}-event-${index + 1}`,
          sequence: index + 1,
          scheduledAt,
          callbackAt,
          backlogAtCallback: Math.max(0, deadlinesDueAtCallback - index - 1),
          emittedAt: performance.now(),
          phase,
          pointerId,
        };
        if (index === 0) beginEditorPerformanceMeasurementWindow(measurements, emission.emittedAt);
        queuePerformancePointerEmission(measurements, emission);
        // 合成 PointerEvent 走正式 host adapter；它不是硬件输入的替代或模拟声明。
        const event = new PointerEvent(`pointer${phase}`, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'pen',
          isPrimary: true,
          clientX: bounds.left + host.clientLeft + x,
          clientY: bounds.top + host.clientTop + y,
          pressure: phase === 'up' ? 0 : 0.5,
          button: 0,
          buttons: phase === 'up' ? 0 : 1,
        });
        Object.defineProperty(event, '__hamsterPerfEmission', { value: emission });
        host.dispatchEvent(event);
        dispatched += 1;
        if (dispatched === eventCount) window.requestAnimationFrame(trySettle);
      };
      allTimersRegisteredAt = schedulePerformanceDeadlines(schedulerCounters, {
        deadlines: plans,
        now: () => performance.now(),
        setTimeout: (handler, delayMs) => {
          window.setTimeout(handler, delayMs);
        },
        shouldContinue: () => performanceRunActiveRef.current,
        onDeadline,
      });
    });
  };
  runRebaseProbeRef.current = () => {
    const probes = [
      { label: 'positive', point: { x: 1_000_000_000.125, y: 1_000_000_000.125 } },
      { label: 'negative', point: { x: -1_000_000_000.125, y: -1_000_000_000.125 } },
    ].flatMap(({ label, point }) =>
      [0.25, 1, 8].map((scale) => {
        if (!pipeline.prepared || !pipeline.spatialIndex || !canvasSize) {
          return { label, scale, status: 'frame-input-unavailable' };
        }
        const viewport = {
          scale,
          tx: canvasSize.width / 2 - point.x * scale,
          ty: canvasSize.height / 2 - point.y * scale,
        };
        const outcome = tryCreateDrawingFrame({
          prepared: pipeline.prepared,
          spatialIndex: pipeline.spatialIndex,
          viewport,
          layoutSize: canvasSize,
          resolveTextProgram: (request) => resolveTextProgramRef.current(request),
        });
        if (!outcome.ok) {
          return {
            label,
            scale,
            status: 'frame-rejected',
            diagnostics: outcome.diagnostics.map((item) => ({ ...item })),
          };
        }
        const screen = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
        const hit = hitTestDrawingFrame(outcome.frame, screen, 2);
        return {
          label,
          scale,
          status: 'frame-ready',
          finite: [
            outcome.frame.frameOrigin.x,
            outcome.frame.frameOrigin.y,
            outcome.frame.visibleWorldBounds.minX,
            outcome.frame.visibleWorldBounds.minY,
            outcome.frame.visibleWorldBounds.maxX,
            outcome.frame.visibleWorldBounds.maxY,
          ].every(Number.isFinite),
          hit: hit
            ? {
                key: hit.entry.source.key,
                tool: hit.entry.source.stroke.tool,
                point: { ...hit.point },
              }
            : null,
          frameOrigin: { ...outcome.frame.frameOrigin },
          visible: outcome.frame.visibleEntries.length,
          renderable: outcome.frame.renderableEntries.length,
          unresolved: outcome.frame.unresolvedClippingKeys.length,
          diagnostics: outcome.frame.diagnostics.map((item) => ({ ...item })),
        };
      })
    );
    return { version: EDITOR_PERFORMANCE_WORKLOAD.version, probes };
  };
  useEffect(() => {
    if (!performanceMode) return;
    const api: HamsterEditorPerformanceApi = Object.freeze<HamsterEditorPerformanceApi>({
      getSnapshot: () => performanceSnapshotRef.current(),
      resetMeasurements: () =>
        resetEditorPerformanceMeasurements(performanceMeasurementsRef.current),
      runHighRatePenInput: (options) => runHighRatePenInputRef.current(options),
      runRebaseProbe: () => runRebaseProbeRef.current(),
    });
    Object.defineProperty(window, '__hamsterEditorPerf', {
      configurable: true,
      value: api,
      writable: false,
    });
    return () => {
      performanceRunActiveRef.current = false;
      if (window.__hamsterEditorPerf === api) delete window.__hamsterEditorPerf;
    };
  }, [performanceMode]);
  const canvasProps = useMemo(
    () =>
      canvasSize ? { style: { width: canvasSize.width, height: canvasSize.height } } : undefined,
    [canvasSize]
  );
  const emptyDiagnosticFrame = (() => {
    if (
      (canvasDiagnosticStage !== 'canvas-empty-no-font' &&
        canvasDiagnosticStage !== 'canvas-empty-font') ||
      !canvasSize
    ) {
      return { frame: null, error: null };
    }
    try {
      // D3 空负载永远从空 document 创建有限 frame，不会意外携带当前文档、图片或文本资源。
      const prepared = prepareDrawingDocument(EMPTY_DOCUMENT);
      const outcome = tryCreateDrawingFrame({
        prepared,
        spatialIndex: createPreparedDrawingSpatialIndex(prepared),
        viewport: controller.interaction.viewport,
        layoutSize: canvasSize,
      });
      return outcome.ok
        ? { frame: outcome.frame, error: null }
        : { frame: null, error: '空诊断 frame 未能创建' };
    } catch (error) {
      return { frame: null, error: errorMessage(error) };
    }
  })();
  // 只有已发布 owner 的 revision、manager 与 family 同时存在，才允许空字体阶段首次挂 Canvas。
  const initialLatinFontPublished =
    fontAssets.phase === 'ready' &&
    fontAssets.resourceRevision > 0 &&
    fontAssets.fontManager !== null &&
    fontAssets.rendererFontFamily !== null;
  // D4 不造空 frame、不先以无字体 Canvas 挂载再替换：只有已发布的 Latin FontOwner
  // 同时提供 revision、FontManager 与 renderer family 后，才允许正式 payload 首次进入 Canvas。
  const currentFrameFontPublished = initialLatinFontPublished;
  // 默认产品路径与 D4 使用同一首次挂载契约：有限 current frame 和同一已发布 Latin
  // FontOwner 必须在同一次 render 中到齐。资源 tier 更新期间 hook 会保留旧 owner，因而
  // 已挂载 Canvas 不会接收到 fontManager=undefined 的中间 payload。
  const canMountDefaultCanvas =
    canvasDiagnosticStage === null && !frameBlocked && initialLatinFontPublished;
  const canvasDiagnosticError =
    (canvasDiagnosticStage === 'canvas-empty-no-font' ||
      canvasDiagnosticStage === 'canvas-empty-font') &&
    emptyDiagnosticFrame.error !== null
      ? emptyDiagnosticFrame.error
      : canvasDiagnosticStage === 'canvas-empty-font' && fontAssets.phase === 'ready'
        ? initialLatinFontPublished
          ? null
          : 'Latin FontOwner 已完成但未发布可用 renderer 字体'
        : canvasDiagnosticStage === 'canvas-current-no-font' &&
            canvasSize !== null &&
            (layoutProblem !== null || pipeline.error !== null)
          ? (layoutProblem ?? pipeline.error)
          : canvasDiagnosticStage === 'canvas-current-font' &&
              canvasSize !== null &&
              (layoutProblem !== null || pipeline.error !== null)
            ? (layoutProblem ?? pipeline.error)
            : canvasDiagnosticStage === 'canvas-current-font' &&
                fontAssets.phase === 'ready' &&
                !currentFrameFontPublished
              ? 'Latin FontOwner 已完成但未发布可用 renderer 字体'
              : null;
  const canvasDiagnosticPhase =
    canvasDiagnosticError !== null
      ? 'error'
      : canvasDiagnosticStage === 'canvas-current-font' && !currentFrameFontPublished
        ? 'waiting-font'
        : canvasDiagnosticStage === 'canvas-current-font'
          ? frame && !layoutProblem
            ? 'current-frame-font-mounted'
            : 'waiting-font'
          : canvasDiagnosticStage === 'canvas-empty-font' && !initialLatinFontPublished
            ? 'waiting-resources'
            : canvasDiagnosticStage === 'canvas-empty-no-font' && emptyDiagnosticFrame.frame
              ? 'empty-canvas-mounted'
              : canvasDiagnosticStage === 'canvas-empty-font' && emptyDiagnosticFrame.frame
                ? 'empty-canvas-mounted'
                : canvasDiagnosticStage === 'canvas-current-no-font' && frame && !layoutProblem
                  ? 'current-payload-mounted'
                  : 'waiting-resources';
  const diagnosticCanvasFrame =
    canvasDiagnosticStage === 'canvas-empty-no-font'
      ? emptyDiagnosticFrame.frame
      : canvasDiagnosticStage === 'canvas-empty-font' && initialLatinFontPublished
        ? emptyDiagnosticFrame.frame
        : canvasDiagnosticStage === 'canvas-current-no-font' && !layoutProblem
          ? frame
          : canvasDiagnosticStage === 'canvas-current-font' &&
              currentFrameFontPublished &&
              !layoutProblem
            ? frame
            : null;

  // ---- canvas2d-pen 金丝雀 effects（其余模式全部早退，不影响正式路径）----

  // pan/zoom 使 viewport 变化：对活动笔做一次显式失效的全量重投影（非 pen 手势期间为 no-op）。
  const canaryViewport = controller.interaction.viewport;
  useEffect(() => {
    if (perfRendererMode !== 'canvas2d-pen') return;
    const backend = penPreviewBackendRef.current;
    if (backend?.isActive) backend.reproject();
  }, [perfRendererMode, canaryViewport]);

  // 布局尺寸变化：由后端重配 DPR/backing 并回放（DPR 变化也经此显式刷新）。
  useEffect(() => {
    if (perfRendererMode !== 'canvas2d-pen') return;
    penPreviewBackendRef.current?.resize();
  }, [perfRendererMode, canvasSize]);

  /**
   * 提交保留策略：只有含新 revision 的 world frame 已 commit 到 React（本 effect 触发）后，
   * 再保守等待 2 个 rAF 让 CanvasKit 实际呈现，才清除 Canvas2D 预览——绝不按 render 清除。
   * 清除是无条件的（commit 后 backend 仍 active），但只清保留时锁定的那一实例；
   * 'cleared' 只在 clear 实际调用后上报。SkiaDrawingCanvas 不暴露显式 draw generation 信号，
   * 这是保守延迟而非伪造的可见性证明；该事实由金丝雀 data-commit-clear-policy 如实上报。
   */
  useEffect(() => {
    if (perfRendererMode !== 'canvas2d-pen') return;
    const pending = penPreviewPendingCommitRef.current;
    if (pending === null) return;
    if (!canClearRetainedPenPreview(pending.revision, documentRevision, frame !== null)) {
      return;
    }
    let cancelled = false;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        // fail closed：等待期间新笔开始（begin 替换/清空 pending）或语义化取消
        // （pending 清空、预览已清）时身份不再匹配，绝不清除新笔的实时预览。
        if (penPreviewPendingCommitRef.current !== pending) return;
        penPreviewPendingCommitRef.current = null;
        // 无条件清除保留时锁定的那一实例：commit 后 backend 仍 active，旧逻辑
        // 「仅 !isActive 才清」会让保留预览永久残留且 marker 谎称 cleared（P0）。
        // 实例已 dispose（canvas 重挂载）则不算已清除，绝不谎称 'cleared'。
        const cleared = clearRetainedCanvas2dPenPreview(pending.backend);
        setCanaryCommitClear(cleared ? 'cleared' : 'idle');
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== 0) window.cancelAnimationFrame(secondFrame);
    };
  }, [perfRendererMode, frame, documentRevision]);

  // 卸载即释放后端（fail closed：disposed 后 healthy=false，所有写入 no-op）。
  useEffect(
    () => () => {
      penPreviewBackendRef.current?.dispose();
      penPreviewBackendRef.current = null;
    },
    []
  );

  // 物理 canvas 计数：诊断读取真实 DOM（Skia world canvas + Canvas2D pen canvas），绝不硬编码。
  useEffect(() => {
    if (perfRendererMode !== 'canvas2d-pen' || !host || !canMountDefaultCanvas) return;
    const raf = window.requestAnimationFrame(() => {
      setCanaryCanvasCount(host.querySelectorAll('canvas').length);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [perfRendererMode, host, canMountDefaultCanvas, canvasSize]);

  return (
    <View testID="editor-candidate-root" style={styles.root}>
      {lifecycleDiagnostics.enabled ? (
        canvasDiagnosticStage === 'canvas-empty-no-font' ||
        canvasDiagnosticStage === 'canvas-empty-font' ||
        canvasDiagnosticStage === 'canvas-current-no-font' ||
        canvasDiagnosticStage === 'canvas-current-font' ? (
          <div
            ref={lifecycleDiagnostics.attach}
            data-testid="editor-candidate-canvas-diagnostics"
            data-canvas-diag-stage={canvasDiagnosticStage}
            data-canvas-diag-phase={canvasDiagnosticPhase}
            {...(canvasDiagnosticError ? { 'data-canvas-diag-error': canvasDiagnosticError } : {})}
            aria-hidden="true"
            style={{ display: 'none' }}
          />
        ) : (
          <div
            ref={lifecycleDiagnostics.attach}
            data-testid="editor-candidate-lifecycle-diagnostics"
            aria-hidden="true"
            style={{ display: 'none' }}
          />
        )
      ) : null}
      {performanceMode ? (
        <div
          data-testid="editor-candidate-performance-diagnostics"
          data-workload-ready={String(
            document.strokes.length === EDITOR_PERFORMANCE_WORKLOAD.strokeCount
          )}
          data-workload-seed={String(EDITOR_PERFORMANCE_WORKLOAD.seed)}
          data-workload-strokes={String(document.strokes.length)}
          data-frame-ready={String(frame !== null)}
          data-visible={String(frame?.visibleEntries.length ?? 0)}
          data-renderable={String(frame?.renderableEntries.length ?? 0)}
          data-resource-revision={String(fontAssets.resourceRevision)}
          // perfRenderer 诊断标记：正式路径为 'formal'；诊断变体明确暴露实际送进 Canvas 的
          // world 选择与 pulse，避免把诊断数据伪装成正式渲染。
          data-perf-renderer={perfRendererMode ?? 'formal'}
          data-perf-renderer-world={
            perfRendererMode === null ||
            perfRendererMode === 'world-pulse' ||
            perfRendererMode === 'split-canvas' ||
            perfRendererMode === 'canvas2d-pen'
              ? 'real'
              : 'empty'
          }
          data-perf-renderer-canvas-ready={String(
            perfRendererMode === 'split-canvas'
              ? splitCanvasReady && canMountDefaultCanvas
              : perfRendererMode === 'canvas2d-pen'
                ? frame !== null && canMountDefaultCanvas
                : canvasFrame !== null && canMountDefaultCanvas
          )}
          // split-canvas 由两个真实 Canvas 合成，world 与 overlay 在 native 合成上并非同一帧原子提交；
          // split 明确不注入任何 pulse。仅诊断用，不修改正式单 Canvas 路径。
          {...(perfRendererMode === 'split-canvas'
            ? { 'data-perf-renderer-note': 'split-canvas-layers-composited-non-atomically' }
            : perfRendererMode === 'canvas2d-pen'
              ? {
                  'data-perf-renderer-note':
                    'canvas2d-pen-overlay-composited-non-atomically-no-explicit-skia-draw-signal',
                }
              : {})}
          // pulse 标记：split='off'、其余诊断脉冲模式='on'、正式不输出（DOM 完全不变）。
          {...(perfRendererPulseMarker === null
            ? {}
            : { 'data-perf-renderer-pulse': perfRendererPulseMarker })}
          aria-hidden="true"
          style={{ display: 'none' }}
        />
      ) : null}
      {perfRendererMode === 'canvas2d-pen' ? (
        // canvas2d-pen 金丝雀诊断节点：如实上报 backend 健康、增量/回放计数、物理 canvas 数
        // 与提交清除策略状态；只读 ref/计数器，不改任何产品默认断言。
        <div
          data-testid="editor-candidate-canvas2d-pen-canary"
          data-canary="canvas2d-pen"
          data-backend-mounted={String(penPreviewBackend !== null)}
          data-healthy={String(penPreviewCounters?.healthy ?? false)}
          data-preview-active={String(penPreviewBackend?.isActive ?? false)}
          data-segment-draws={String(penPreviewCounters?.segmentDrawCount ?? 0)}
          data-full-replays={String(penPreviewCounters?.fullReplayCount ?? 0)}
          data-pen-epochs={String(penStrokeEpochRef.current)}
          data-physical-canvas-count={String(canaryCanvasCount ?? 0)}
          data-commit-clear={canaryCommitClear}
          data-commit-clear-policy="retain-until-world-frame-commit-plus-2raf-no-explicit-skia-draw-signal"
          aria-hidden="true"
          style={{ display: 'none' }}
        />
      ) : null}
      <View style={styles.topbar}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>候选第三纵切</Text>
          <Text style={styles.title}>Web Skia 编辑器</Text>
          <Text style={styles.subtitle}>
            仅 Chromium Web 候选；尺子使用 core 手势接缝，原生与真实多触仍未验收。
          </Text>
        </View>
        <View
          testID="editor-candidate-status"
          accessibilityLiveRegion="polite"
          style={styles.statusPill}
        >
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>

      <View style={styles.workspace}>
        <View style={styles.toolbar} accessibilityLabel="候选编辑器工具栏">
          <Text style={styles.toolbarLabel}>工具</Text>
          {TOOLS.map(([id, label]) => {
            const selected = controller.tool === id;
            return (
              <Pressable
                key={id}
                testID={`editor-candidate-tool-${id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${label}，${selected ? '已启用' : '点击启用'}`}
                onPress={() => selectTool(id)}
                style={selected ? styles.activeTool : styles.tool}
              >
                <Text style={selected ? styles.activeToolText : styles.toolText}>{label}</Text>
              </Pressable>
            );
          })}
          <View style={styles.divider} />
          <Text testID="editor-candidate-selection-transform" style={styles.honestNote}>
            选框变换：移动、旋转、四角等比缩放
          </Text>
          <Text testID="editor-candidate-ruler-status" style={styles.honestNote}>
            尺子：core 手势已接入
          </Text>
        </View>

        <View style={styles.editorPane}>
          <View style={styles.commandBar}>
            <View style={styles.commandGroup}>
              <Pressable
                testID="editor-candidate-undo"
                accessibilityRole="button"
                accessibilityLabel="撤销"
                disabled={runtime.undoStack.length === 0 || hasOpenCandidate}
                onPress={undo}
                style={[
                  styles.command,
                  (runtime.undoStack.length === 0 || hasOpenCandidate) && styles.commandDisabled,
                ]}
              >
                <Text style={styles.commandText}>撤销</Text>
              </Pressable>
              <Pressable
                testID="editor-candidate-redo"
                accessibilityRole="button"
                accessibilityLabel="重做"
                disabled={runtime.redoStack.length === 0 || hasOpenCandidate}
                onPress={redo}
                style={[
                  styles.command,
                  (runtime.redoStack.length === 0 || hasOpenCandidate) && styles.commandDisabled,
                ]}
              >
                <Text style={styles.commandText}>重做</Text>
              </Pressable>
              <Pressable
                testID="editor-candidate-clear"
                accessibilityRole="button"
                accessibilityLabel="清空所有对象，可撤销"
                disabled={document.strokes.length === 0 || hasOpenCandidate}
                onPress={clear}
                style={[
                  styles.command,
                  styles.clearCommand,
                  (document.strokes.length === 0 || hasOpenCandidate) && styles.commandDisabled,
                ]}
              >
                <Text style={styles.clearText}>清空</Text>
              </Pressable>
              <Pressable
                testID="editor-candidate-clear-selection"
                accessibilityRole="button"
                accessibilityLabel="清除当前选择，不写入历史"
                disabled={controller.selectionTargets.length === 0 || hasOpenCandidate}
                onPress={clearSelection}
                style={[
                  styles.command,
                  (controller.selectionTargets.length === 0 || hasOpenCandidate) &&
                    styles.commandDisabled,
                ]}
              >
                <Text style={styles.commandText}>清除选择</Text>
              </Pressable>
              <Pressable
                testID="editor-candidate-text-create"
                accessibilityRole="button"
                accessibilityLabel="新建文本"
                disabled={textSession !== null || imageImporting}
                onPress={() => beginNewText()}
                style={[
                  styles.command,
                  (textSession !== null || imageImporting) && styles.commandDisabled,
                ]}
              >
                <Text style={styles.commandText}>新建文本</Text>
              </Pressable>
              <Pressable
                testID="editor-candidate-image-import"
                accessibilityRole="button"
                accessibilityLabel="选择并导入图片"
                disabled={textSession !== null || imageImporting}
                onPress={() => {
                  imageAnchorRef.current = null;
                  setImageImportStatus('请选择图片；取消不会写入 document。');
                  imageInputRef.current?.click();
                }}
                style={[
                  styles.command,
                  (textSession !== null || imageImporting) && styles.commandDisabled,
                ]}
              >
                <Text style={styles.commandText}>导入图片</Text>
              </Pressable>
            </View>
            <View style={styles.commandGroup}>
              {controller.tool === 'polygon' ? (
                <Pressable
                  testID="editor-candidate-polygon-finish"
                  accessibilityRole="button"
                  accessibilityLabel="完成多边形"
                  disabled={!canFinishPolygon}
                  onPress={finishPolygon}
                  style={[styles.command, !canFinishPolygon && styles.commandDisabled]}
                >
                  <Text style={styles.commandText}>完成多边形</Text>
                </Pressable>
              ) : null}
              {controller.tool === 'polygon' || controller.tool === 'bezier' ? (
                <Pressable
                  testID={`editor-candidate-${controller.tool}-cancel`}
                  accessibilityRole="button"
                  accessibilityLabel={`取消${controller.tool === 'polygon' ? '多边形' : '贝塞尔'}候选`}
                  disabled={sessionPoints.length === 0}
                  onPress={cancelTool}
                  style={[styles.command, sessionPoints.length === 0 && styles.commandDisabled]}
                >
                  <Text style={styles.commandText}>
                    取消{controller.tool === 'polygon' ? '多边形' : '贝塞尔'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                testID="editor-candidate-pan-toggle"
                accessibilityRole="button"
                accessibilityLabel="切换平移模式"
                onPress={() => setPanEnabled((enabled) => !enabled)}
                style={[styles.command, panEnabled && styles.panActive]}
              >
                <Text style={styles.commandText}>{panEnabled ? '退出平移' : '平移模式'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="向左平移画布"
                onPress={() => panBy(-80, 0)}
                style={styles.panStep}
              >
                <Text style={styles.commandText}>←</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="向右平移画布"
                onPress={() => panBy(80, 0)}
                style={styles.panStep}
              >
                <Text style={styles.commandText}>→</Text>
              </Pressable>
            </View>
          </View>

          <View
            ref={setCanvasHost}
            testID="editor-candidate-canvas"
            accessibilityLabel="候选编辑器画布"
            onLayout={onCanvasLayout}
            style={[
              styles.canvasHost,
              panEnabled || spaceHeld ? styles.canvasHostPan : styles.canvasHostDraw,
              // react-native 的公共 ViewStyle 未声明该 Web 属性，但 react-native-web 会透传它。
              { touchAction: 'none' } as never,
            ]}
          >
            {canvasSuppressedForDiagnostics ? (
              <div
                data-testid="editor-candidate-surface-diagnostics"
                data-surface-phase={diagnosticSurfacePhase}
                data-canvas-suppressed="true"
              />
            ) : diagnosticCanvasFrame ? (
              <CandidateCanvasLifecycle diagnostics={lifecycleDiagnostics}>
                {canvasDiagnosticStage === 'canvas-empty-font' ? (
                  <SkiaDrawingCanvas
                    frame={diagnosticCanvasFrame}
                    overlays={[]}
                    fontManager={fontAssets.fontManager!}
                    fontFamily={fontAssets.rendererFontFamily!}
                    canvasProps={canvasProps!}
                  />
                ) : canvasDiagnosticStage === 'canvas-empty-no-font' ? (
                  <SkiaDrawingCanvas
                    frame={diagnosticCanvasFrame}
                    overlays={[]}
                    canvasProps={canvasProps!}
                  />
                ) : canvasDiagnosticStage === 'canvas-current-font' ? (
                  <SkiaDrawingCanvas
                    frame={diagnosticCanvasFrame}
                    overlays={frameOverlays}
                    resolveImage={resolveImage}
                    fontManager={fontAssets.fontManager!}
                    fontFamily={fontAssets.rendererFontFamily!}
                    canvasProps={canvasProps!}
                  />
                ) : (
                  <SkiaDrawingCanvas
                    frame={diagnosticCanvasFrame}
                    overlays={frameOverlays}
                    canvasProps={canvasProps!}
                  />
                )}
              </CandidateCanvasLifecycle>
            ) : perfRendererMode === 'canvas2d-pen' &&
              canMountDefaultCanvas &&
              frame !== null &&
              canvasSize !== null ? (
              // canvas2d-pen：底层静态 Skia world（只排除活动 pen 草稿，其余 overlay 真实
              // 下发）+ 顶层透明 Canvas2D 增量 pen 预览。world 层用专用 memo 层组件，pen 手势
              // 期间 props 引用全部稳定（frame/viewport/document 不变、overlays 为共享空引用），
              // 因此不会重渲染/重绘静态 world；pen 草稿由后端在 adapter 回调里同步增量绘制。
              <CandidateCanvasLifecycle diagnostics={lifecycleDiagnostics}>
                <Canvas2dPenWorldLayer
                  canvasComponent={SkiaDrawingCanvas}
                  frame={frame}
                  overlays={canvas2dPenWorldOverlays}
                  resolveImage={resolveImage}
                  fontManager={fontAssets.fontManager!}
                  fontFamily={fontAssets.rendererFontFamily!}
                  canvasProps={canvasProps!}
                  width={canvasSize.width}
                  height={canvasSize.height}
                />
                <canvas
                  ref={setPenPreviewCanvas}
                  data-perf-canvas-layer="canvas2d-pen"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    // CSS DIP 尺寸与 world 层严格一致；backing 像素/DPR 由后端按 clientWidth 配置。
                    width: canvasSize.width,
                    height: canvasSize.height,
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
              </CandidateCanvasLifecycle>
            ) : perfRendererMode === 'split-canvas' &&
              canMountDefaultCanvas &&
              frame !== null &&
              diagnosticEmptyFrame !== null &&
              canvasSize !== null ? (
              <CandidateCanvasLifecycle diagnostics={lifecycleDiagnostics}>
                <SplitCanvasWorldLayer
                  canvasComponent={SkiaDrawingCanvas}
                  frame={frame}
                  overlays={EMPTY_LAYER_OVERLAYS}
                  resolveImage={resolveImage}
                  fontManager={fontAssets.fontManager!}
                  fontFamily={fontAssets.rendererFontFamily!}
                  canvasProps={canvasProps!}
                  width={canvasSize.width}
                  height={canvasSize.height}
                />
                <SplitCanvasOverlayLayer
                  canvasComponent={SkiaDrawingCanvas}
                  frame={diagnosticEmptyFrame}
                  overlays={splitOverlayOverlays}
                  fontManager={fontAssets.fontManager!}
                  fontFamily={fontAssets.rendererFontFamily!}
                  canvasProps={canvasProps!}
                  width={canvasSize.width}
                  height={canvasSize.height}
                />
              </CandidateCanvasLifecycle>
            ) : canMountDefaultCanvas && canvasFrame !== null ? (
              <CandidateCanvasLifecycle diagnostics={lifecycleDiagnostics}>
                <SkiaDrawingCanvas
                  frame={canvasFrame}
                  overlays={canvasOverlays}
                  resolveImage={resolveImage}
                  fontManager={fontAssets.fontManager!}
                  fontFamily={fontAssets.rendererFontFamily!}
                  canvasProps={canvasProps!}
                />
              </CandidateCanvasLifecycle>
            ) : (
              <View testID="editor-candidate-frame-gate" style={styles.frameStatus}>
                <Text style={styles.canvasLoading}>
                  {!canvasSize
                    ? '正在测量画布…'
                    : layoutProblem
                      ? `frame 已阻止：${layoutProblem}`
                      : pipeline.error
                        ? `frame 准备失败：${pipeline.error}`
                        : 'frame 尚未就绪'}
                </Text>
              </View>
            )}
            <View
              testID="editor-candidate-ruler"
              accessibilityLabel="候选编辑器尺子。鼠标按住 Ctrl 或 Command 平移，按住 Alt 旋转；触摸可使用单指或双指刚体手势。"
              style={styles.rulerSelector}
            >
              <div
                data-testid="drawing-ruler-background"
                title="Ctrl 或 Command 拖动平移，Alt 拖动旋转；触摸双指只平移和旋转"
                style={{
                  position: 'absolute',
                  // 保持逻辑 center 可观察；实际可见尺身仍由同一 layout 的 visualCenter 对齐。
                  left: displayedRuler.center.x,
                  top: displayedRuler.center.y,
                  width: rulerLayout.renderLength,
                  height: RULER_HEIGHT,
                  transform: `translate(${rulerLayout.visualCenter.x - displayedRuler.center.x - rulerLayout.renderLength / 2}px, ${rulerLayout.visualCenter.y - displayedRuler.center.y - RULER_HEIGHT / 2}px) rotate(${displayedRuler.rotationRad}rad)`,
                  transformOrigin: 'center',
                  boxSizing: 'border-box',
                  borderTop: '1px solid rgba(30, 78, 167, 0.6)',
                  borderBottom: '1px solid rgba(30, 78, 167, 0.6)',
                  background:
                    'repeating-linear-gradient(90deg, rgba(37, 99, 235, 0.18) 0 1px, transparent 1px 12px)',
                  backgroundColor: 'rgba(219, 234, 254, 0.72)',
                  cursor: 'grab',
                  touchAction: 'none',
                  zIndex: 1,
                }}
              >
                <span
                  data-testid="editor-candidate-ruler-rotation"
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: 5,
                    transform: 'translateX(-50%)',
                    color: '#1E4EA7',
                    fontSize: 10,
                    fontWeight: 800,
                    userSelect: 'none',
                  }}
                >
                  {rulerRotationDegrees} deg
                </span>
              </div>
            </View>
            {zoomFeedback ? (
              <div
                data-testid="editor-candidate-zoom-feedback"
                aria-live="polite"
                style={{
                  position: 'absolute',
                  left: zoomFeedback.x,
                  top: zoomFeedback.y,
                  transform: 'translate(-50%, -150%)',
                  zIndex: 5,
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: 'rgba(23, 32, 51, 0.88)',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 800,
                  pointerEvents: 'none',
                }}
              >
                {Math.round(zoomFeedback.scale * 100)}%
              </div>
            ) : null}
            {rulerAngleFeedback ? (
              <div
                data-testid="editor-candidate-ruler-angle-feedback"
                data-feedback-x={String(rulerAngleFeedback.x)}
                data-feedback-y={String(rulerAngleFeedback.y)}
                style={{
                  position: 'absolute',
                  left: rulerAngleFeedback.x,
                  top: rulerAngleFeedback.y,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 5,
                  width: 44,
                  height: 44,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  background: '#FFFFFF',
                  boxShadow: '0 1px 4px rgba(23, 32, 51, 0.22)',
                  color: '#172033',
                  fontSize: 12,
                  fontWeight: 800,
                  pointerEvents: 'none',
                }}
              >
                {Math.round((rulerAngleFeedback.rotationRad * 180) / Math.PI)} deg
              </div>
            ) : null}
            {controller.interaction.selectionPreview ? (
              <div
                data-testid="selection-preview"
                title="选框变换预览"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
              />
            ) : null}
            {selectionOverlay ? <SelectionOverlay model={selectionOverlay} /> : null}
            {textSession && editorBox ? (
              <textarea
                ref={textareaRef}
                data-testid="editor-candidate-textarea"
                defaultValue={textSession.draft.text}
                onInput={handleTextareaInput}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                aria-label="文本编辑草稿"
                style={{
                  position: 'absolute',
                  left: editorBox.left,
                  top: editorBox.top,
                  width: editorBox.width,
                  height: editorBox.height,
                  fontSize: editorBox.fontSize,
                  lineHeight: 1.25,
                  transform: `rotate(${editorBox.rotationRad}rad)`,
                  transformOrigin: 'center',
                  padding: 5,
                  border: '2px solid #2563EB',
                  borderRadius: 6,
                  background: '#FFFFFF',
                  color: '#172033',
                  resize: 'none',
                  outline: 'none',
                  zIndex: 2,
                }}
              />
            ) : null}
          </View>

          {textSession ? (
            <View style={styles.textSessionBar}>
              <Text style={styles.textSessionNote}>
                文本草稿：{textSession.mode === 'new' ? '新建' : '编辑既有'} · composition{' '}
                {textSession.isComposing ? '中' : '否'} · Enter 换行，不提交
              </Text>
              <Pressable
                testID="editor-candidate-text-done"
                accessibilityRole="button"
                accessibilityLabel="完成文本编辑"
                onPress={completeText}
                style={styles.command}
              >
                <Text style={styles.commandText}>
                  完成{textSession.isComposing ? '（完成后提交）' : ''}
                </Text>
              </Pressable>
              <Pressable
                testID="editor-candidate-text-cancel"
                accessibilityRole="button"
                accessibilityLabel="取消文本编辑"
                onPress={cancelText}
                style={styles.command}
              >
                <Text style={styles.commandText}>取消</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.importPanel}>
            <input
              ref={imageInputRef}
              data-testid="editor-candidate-image-file-input"
              type="file"
              accept="image/*"
              onChange={importImage}
              style={{ fontSize: 12 }}
            />
            <Text
              testID="editor-candidate-image-import-status"
              accessibilityLiveRegion="polite"
              style={styles.importStatus}
            >
              {imageImportStatus}
            </Text>
          </View>

          {hasCommittedText ? (
            <View style={styles.textList}>
              <Text style={styles.listLabel}>已提交文本</Text>
              {document.strokes.map((stroke, index) =>
                stroke.tool === 'text' ? (
                  <View key={stroke.id} style={styles.textRow}>
                    <Text style={styles.committedText}>
                      “{stroke.text.length > 28 ? `${stroke.text.slice(0, 28)}…` : stroke.text}”
                    </Text>
                    <Pressable
                      testID={`editor-candidate-text-edit-${stroke.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`编辑文本 ${stroke.id}`}
                      disabled={textSession !== null || imageImporting}
                      onPress={() => beginExistingText(index, stroke)}
                      style={[
                        styles.smallCommand,
                        (textSession !== null || imageImporting) && styles.commandDisabled,
                      ]}
                    >
                      <Text style={styles.commandText}>编辑</Text>
                    </Pressable>
                  </View>
                ) : null
              )}
            </View>
          ) : null}

          <View style={styles.footer}>
            <div
              data-testid="editor-candidate-image-release-diagnostics"
              data-last-release={String(imageReleaseMetrics.last)}
              data-release-total={String(imageReleaseMetrics.total)}
              aria-hidden="true"
              style={{ display: 'none' }}
            >
              image releases last {imageReleaseMetrics.last} total {imageReleaseMetrics.total}
            </div>
            <Text testID="editor-candidate-frame-status" style={styles.metric}>
              {frame
                ? '正式 frame 已挂载（PreparedDocument -> SpatialIndex -> DrawingFrame -> SkiaCanvas）'
                : '正式 frame 未挂载'}
            </Text>
            <Text testID="editor-candidate-frame-diagnostics" style={styles.metric}>
              Frame {frame ? 'ready' : 'blocked'} · visible {frame?.visibleEntries.length ?? 0} ·
              renderable {frame?.renderableEntries.length ?? 0}
            </Text>
            <Text
              testID="editor-candidate-frame-query-status"
              accessibilityLabel={`Frame 查询 ${frameQueryStatus.mode}，${frameQueryStatus.operation}，revision ${frameQueryStatus.frameRevision ?? 'none'}，诊断 ${frameQueryStatus.diagnostics.join(', ') || 'none'}`}
              style={styles.metric}
            >
              Frame query {frameQueryStatus.mode} · {frameQueryStatus.operation} · revision{' '}
              {frameQueryStatus.frameRevision ?? 'none'} · diagnostics{' '}
              {frameQueryStatus.diagnostics.join(', ') || 'none'}
            </Text>
            <Text testID="editor-candidate-frame-unresolved" style={styles.metric}>
              未解决裁剪 {frame?.unresolvedClippingKeys.length ?? 0}
            </Text>
            <Text testID="editor-candidate-text-assets" style={styles.metric}>
              文本资产 {fontAssets.summary}
            </Text>
            <Text testID="editor-candidate-text-shaping-status" style={styles.metric}>
              shaping {textShaping.phase} · ready {textShaping.ready} · pending{' '}
              {textShaping.pending} · error {textShaping.error}
            </Text>
            <Text testID="editor-candidate-text-resource-status" style={styles.metric}>
              文本资源：ready {textShaping.ready} · pending {textShaping.pending} · error{' '}
              {textShaping.error}
            </Text>
            {textShaping.entries.map((entry, index) => (
              <Text
                key={`${index}-${entry.phase}-${entry.message ?? ''}`}
                testID={`editor-candidate-text-entry-status-${index}`}
                style={styles.metric}
              >
                text[{index}] {entry.phase}
                {entry.message ? `：${entry.message}` : ''}
              </Text>
            ))}
            {textShaping.error > 0 ? (
              <Pressable
                testID="editor-candidate-text-resource-retry"
                accessibilityRole="button"
                accessibilityLabel="重新加载失败字体并重试失败文本 shaping"
                onPress={() => setTextRetryGeneration((generation) => generation + 1)}
                style={styles.frameRetry}
              >
                <Text style={styles.frameRetryText}>重试失败文本资源</Text>
              </Pressable>
            ) : null}
            <Text testID="editor-candidate-count" style={styles.metric}>
              笔迹 {document.strokes.length}
            </Text>
            <Text
              testID="editor-candidate-selection-count"
              accessibilityLabel={`当前选择 ${controller.selectionTargets.length} 个对象`}
              style={styles.metric}
            >
              选择 {controller.selectionTargets.length}
            </Text>
            <Text testID="editor-candidate-history" style={styles.metric}>
              Undo depth {runtime.undoStack.length} · Redo depth {runtime.redoStack.length}
            </Text>
            <Text testID="editor-candidate-resource-count" style={styles.metric}>
              资源 {registry.records.length}
            </Text>
            <Text testID="editor-candidate-image-import-policy" style={styles.metric}>
              图片限制：PNG/JPEG/WebP · 最大 {MAX_IMAGE_FILE_BYTES} B · {MAX_IMAGE_EDGE} px ·{' '}
              {MAX_IMAGE_PIXELS} 像素
            </Text>
            <Text testID="editor-candidate-image-import-state" style={styles.metric}>
              图片导入 {imageImporting ? 'pending' : 'idle'} · registry-first · undo/redo
              可达资源保留
            </Text>
            <Text style={styles.metric}>
              缩放 {Math.round(controller.interaction.viewport.scale * 100)}%
            </Text>
            <Text style={styles.metric}>
              视口 {Math.round(controller.interaction.viewport.tx)},{' '}
              {Math.round(controller.interaction.viewport.ty)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: '100%', backgroundColor: '#F4F5F7' },
  topbar: {
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: '#DDE2EA',
    backgroundColor: '#FFFFFF',
  },
  heading: { gap: 3 },
  eyebrow: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: { color: '#172033', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19 },
  statusPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#EAF2FF',
  },
  statusText: { color: '#1E4EA7', fontSize: 12, lineHeight: 17 },
  workspace: { flex: 1, flexDirection: 'row', minHeight: 540 },
  toolbar: {
    width: 144,
    gap: 8,
    padding: 12,
    borderRightWidth: 1,
    borderColor: '#DDE2EA',
    backgroundColor: '#FBFCFE',
  },
  toolbarLabel: {
    marginBottom: 2,
    color: '#667085',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tool: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8, backgroundColor: '#EEF1F5' },
  toolText: { color: '#344054', fontSize: 12, fontWeight: '700' },
  activeTool: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#1D4ED8',
  },
  activeToolText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  divider: { height: 1, marginVertical: 4, backgroundColor: '#DDE2EA' },
  honestNote: { color: '#7A8495', fontSize: 11, lineHeight: 16 },
  editorPane: { flex: 1, minWidth: 0, gap: 10, padding: 12 },
  commandBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  commandGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  command: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#CBD3E1',
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  commandDisabled: { opacity: 0.42 },
  commandText: { color: '#344054', fontSize: 12, fontWeight: '700' },
  clearCommand: { borderColor: '#F5C2C7' },
  clearText: { color: '#B42318', fontSize: 12, fontWeight: '700' },
  panActive: { borderColor: '#2563EB', backgroundColor: '#EAF2FF' },
  panStep: {
    minWidth: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#CBD3E1',
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  canvasHost: {
    flex: 1,
    minHeight: 460,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#C9D2DF',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  canvasHostDraw: { cursor: 'crosshair' as never },
  canvasHostPan: { cursor: 'grab' as never },
  rulerSelector: { position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'box-none' },
  canvasLoading: { margin: 'auto', color: '#667085', fontSize: 13 },
  frameStatus: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 18,
  },
  frameRetry: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: '#1D4ED8',
  },
  frameRetryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  textSessionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  textSessionNote: { flexGrow: 1, color: '#1E4EA7', fontSize: 12, lineHeight: 17 },
  importPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#DDE2EA',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  importStatus: { flex: 1, minWidth: 180, color: '#667085', fontSize: 12, lineHeight: 17 },
  textList: {
    gap: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#DDE2EA',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  listLabel: { color: '#667085', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  textRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  committedText: { flex: 1, color: '#344054', fontSize: 12 },
  smallCommand: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#CBD3E1',
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 2 },
  metric: { color: '#667085', fontSize: 12 },
});
