import {
  applyViewportTransformIntent,
  createGestureSession,
  createViewportTransformIntent,
  normalizeViewportTransform,
  reduceGestureSession,
  type DrawingViewport,
  type GestureInteractionPolicy,
  type GestureSession,
  type Point,
  type TargetRole,
  type ViewportScaleLimits,
  type ViewportTransformIntent,
} from '../core';
import * as webInput from '../input/web/normalizePointerInput';

export type ViewportGestureRequest = Readonly<{
  phase: 'preview' | 'commit';
  source: 'wheel' | 'touch' | 'pointer';
  intent: ViewportTransformIntent;
  viewport: DrawingViewport;
}>;

export type ViewportZoomFeedback = Readonly<{
  source: 'wheel' | 'touch' | 'pointer';
  /** 手势当前可见焦点；zoom-only intent 的固定 focal 不可用于触摸反馈定位。 */
  point: Point;
  focal: Point;
  scale: number;
}>;

export type ViewportWheelOptions = Readonly<{
  /** 缺省时启用 wheel；接入方可显式关闭。 */
  enabled?: boolean;
  /** 在读取坐标前过滤 wheel；用于区分普通 wheel zoom、Ctrl zoom 与 trackpad pan。 */
  shouldHandle?: (event: WheelEvent) => boolean;
  /** Ctrl 或 Cmd 才缩放，适配浏览器 pinch-to-wheel 的平台行为。 */
  requireCtrlOrMeta?: boolean;
  /** 将单个 wheel 样本转换为缩放比例；非法比例会安全忽略。 */
  getScaleRatio?: (event: WheelEvent) => number;
  /** 将 wheel 转成平移/缩放 intent 的当前焦点；省略时固定 focal zoom。 */
  getCurrentFocal?: (event: WheelEvent, focal: Point) => Point;
}>;

export type ViewportGestureControllerOptions = Readonly<{
  host: HTMLElement;
  listenerTarget: EventTarget;
  getRenderedViewport: () => DrawingViewport | null;
  scaleLimits?: ViewportScaleLimits;
  interactionPolicy?: GestureInteractionPolicy;
  /** 只在 pointerdown 调用，返回的角色会由 core 锁定到该 pointer 的生命周期结束。 */
  getTargetRole: (event: PointerEvent, point: Point) => TargetRole;
  toLocalPoint: (event: PointerEvent | WheelEvent) => Point;
  onViewportRequest: (request: ViewportGestureRequest) => void;
  onZoomFeedback?: (feedback: ViewportZoomFeedback | null) => void;
  onActiveChange?: (active: boolean) => void;
  wheel?: ViewportWheelOptions;
}>;

export type ViewportGestureController = Readonly<{
  cancel: () => void;
  dispose: () => void;
}>;

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isKnownPointerDevice(value: string): value is 'mouse' | 'pen' | 'touch' {
  return value === 'mouse' || value === 'pen' || value === 'touch';
}

function isPointerEvent(event: Event): event is PointerEvent {
  return (
    'pointerId' in event &&
    'pointerType' in event &&
    'clientX' in event &&
    'clientY' in event &&
    typeof event.pointerId === 'number' &&
    typeof event.pointerType === 'string' &&
    typeof event.clientX === 'number' &&
    typeof event.clientY === 'number'
  );
}

function consume(event: Event): void {
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopPropagation();
}

/**
 * legacy DOM viewport 接缝：DOM 只负责输入生命周期、capture 与 ownership gate。所有 pointer
 * 手势的导航 intent 都由 core GestureSession 产生，再以手势开始时的 rendered viewport 为基准
 * 应用。它不接入任何渲染 Frame，也不会维护未经 controlled 父级确认的 viewport truth。
 */
export function createViewportGestureController(
  options: ViewportGestureControllerOptions
): ViewportGestureController {
  let session: GestureSession | null = null;
  let baselineViewport: DrawingViewport | null = null;
  let activePointerIds = new Set<number>();
  let touchPointerIds: readonly number[] = [];
  const suppressedPointerIds = new Set<number>();
  let interactionActive = false;
  let disposed = false;

  const setActive = (active: boolean) => {
    if (interactionActive === active) {
      return;
    }
    interactionActive = active;
    options.onActiveChange?.(active);
  };
  const release = (pointerId: number) => {
    try {
      if (options.host.hasPointerCapture(pointerId)) {
        options.host.releasePointerCapture(pointerId);
      }
    } catch {
      // JSDOM 和嵌入宿主可不支持 pointer capture；会话清理仍要继续。
    }
  };
  const capture = (pointerId: number) => {
    try {
      options.host.setPointerCapture(pointerId);
    } catch {
      // document capture listener 是 pointer capture 不可用时的生命周期后备。
    }
  };
  const finish = () => {
    for (const pointerId of activePointerIds) {
      release(pointerId);
    }
    session = null;
    baselineViewport = null;
    activePointerIds = new Set<number>();
    touchPointerIds = [];
    suppressedPointerIds.clear();
    setActive(false);
    options.onZoomFeedback?.(null);
  };
  const requestFor = (
    intent: ViewportTransformIntent,
    phase: 'preview' | 'commit',
    source: 'wheel' | 'touch' | 'pointer',
    feedbackPoint = intent.currentFocal
  ) => {
    if (!baselineViewport) {
      return;
    }
    const viewport = applyViewportTransformIntent(baselineViewport, intent, options.scaleLimits);
    if (!viewport) {
      return;
    }
    options.onViewportRequest({ phase, source, intent, viewport });
    if (intent.scaleRatio !== 1) {
      options.onZoomFeedback?.({
        source,
        point: feedbackPoint,
        focal: intent.currentFocal,
        scale: viewport.scale,
      });
    }
  };
  const consumeTransition = (
    next: GestureSession,
    phase: 'preview' | 'commit',
    source: 'touch' | 'pointer'
  ) => {
    session = next;
    const navigation = next.transient.navigation;
    setActive(navigation !== undefined);
    if (navigation) {
      requestFor(navigation.intent, phase, source, navigation.currentMidpoint);
    }
  };
  const start = (event: PointerEvent, point: Point, targetRole: TargetRole): boolean => {
    const baseline = options.getRenderedViewport();
    const normalized = baseline ? normalizeViewportTransform(baseline, options.scaleLimits) : null;
    const input = webInput.normalizePointerInput(event, {
      host: options.host,
      now: () => 0,
      point,
      phase: 'down',
      targetRole,
    });
    if (!normalized || !input) {
      return false;
    }
    baselineViewport = normalized;
    session = createGestureSession({
      document: { schemaVersion: 2, strokes: [] },
      interactionPolicy: options.interactionPolicy,
    });
    const transition = reduceGestureSession(session, input);
    consumeTransition(transition.session, 'preview', input.device === 'touch' ? 'touch' : 'pointer');
    return true;
  };
  const continueSession = (
    event: PointerEvent,
    phase: 'down' | 'move' | 'up' | 'cancel',
    point: Point,
    targetRole: TargetRole,
    requestPhase: 'preview' | 'commit'
  ) => {
    if (!session) {
      return;
    }
    const input = webInput.normalizePointerInput(event, {
      host: options.host,
      now: () => 0,
      point,
      phase,
      targetRole,
    });
    if (!input) {
      return;
    }
    const transition = reduceGestureSession(session, input);
    consumeTransition(transition.session, requestPhase, input.device === 'touch' ? 'touch' : 'pointer');
  };
  const handleDown = (event: PointerEvent) => {
    if (disposed || (event.pointerType !== 'touch' && event.button !== 0)) {
      return;
    }
    const point = options.toLocalPoint(event);
    const device = event.pointerType;
    if (!isKnownPointerDevice(device) || !isFinitePoint(point)) {
      return;
    }
    const targetRole = options.getTargetRole(event, point);
    // role 只在 down 读取。非 paper 绝不进入 core ownership，也不会被之后的移动重分类。
    if (targetRole !== 'paper') {
      return;
    }
    if (session === null) {
      if (!start(event, point, targetRole)) {
        return;
      }
    } else if (device === 'touch' && touchPointerIds.length < 2) {
      continueSession(event, 'down', point, targetRole, 'preview');
    } else if (device === 'touch') {
      // 第三触点不进入 core，固定 pair 在任一成员结束前不被替换。
      suppressedPointerIds.add(event.pointerId);
      consume(event);
      return;
    } else {
      return;
    }
    activePointerIds.add(event.pointerId);
    if (device === 'touch') {
      touchPointerIds = [...touchPointerIds, event.pointerId];
    }
    capture(event.pointerId);
    // two-touch-only 策略的首指仍可由 legacy drawing 层维持其 pending draw；等 core
    // 真正进入 navigation 后才阻断后续事件，避免提前吞掉合法的单指绘制。
    if (interactionActive) {
      consume(event);
    }
  };
  const handleMove = (event: PointerEvent) => {
    if (suppressedPointerIds.has(event.pointerId)) {
      consume(event);
      return;
    }
    if (!session || !activePointerIds.has(event.pointerId)) {
      return;
    }
    const point = options.toLocalPoint(event);
    if (!isFinitePoint(point)) {
      return;
    }
    continueSession(event, 'move', point, 'paper', 'preview');
    if (interactionActive) {
      consume(event);
    }
  };
  const handleEnd = (event: PointerEvent) => {
    if (suppressedPointerIds.delete(event.pointerId)) {
      release(event.pointerId);
      consume(event);
      return;
    }
    if (!session || !activePointerIds.has(event.pointerId)) {
      return;
    }
    // two-touch-only 的首指在未组成 pair 前只是候选，不得吞掉其绘制层的 pointerup。
    const wasNavigating = interactionActive;
    const point = options.toLocalPoint(event);
    const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
    if (isFinitePoint(point)) {
      if (!cancelled) {
        // core 的 up 会清除 transient navigation；先让最终样本走一次 move，才能以最终坐标提交。
        continueSession(event, 'move', point, 'paper', 'commit');
      }
      continueSession(event, cancelled ? 'cancel' : 'up', point, 'paper', 'preview');
    }
    if (wasNavigating) {
      consume(event);
    }
    finish();
  };
  const handleWheel = (event: WheelEvent) => {
    if (
      disposed ||
      options.wheel?.enabled === false ||
      (options.wheel?.shouldHandle !== undefined && !options.wheel.shouldHandle(event))
    ) {
      return;
    }
    if (options.wheel?.requireCtrlOrMeta === true && !event.ctrlKey && !event.metaKey) {
      return;
    }
    const focal = options.toLocalPoint(event);
    const rendered = options.getRenderedViewport();
    const baseline = rendered ? normalizeViewportTransform(rendered, options.scaleLimits) : null;
    const ratio = options.wheel?.getScaleRatio?.(event) ?? Math.exp(-event.deltaY * 0.002);
    const currentFocal = options.wheel?.getCurrentFocal?.(event, focal) ?? focal;
    const intent =
      isFinitePoint(focal) && isFinitePoint(currentFocal)
        ? createViewportTransformIntent(focal, currentFocal, ratio)
        : null;
    const viewport = baseline && intent
      ? applyViewportTransformIntent(baseline, intent, options.scaleLimits)
      : null;
    if (!viewport || !intent) {
      return;
    }
    options.onViewportRequest({ phase: 'commit', source: 'wheel', intent, viewport });
    options.onZoomFeedback?.({ source: 'wheel', point: currentFocal, focal, scale: viewport.scale });
    consume(event);
  };
  const downListener: EventListener = (event) => {
    if (isPointerEvent(event)) {
      handleDown(event);
    }
  };
  const moveListener: EventListener = (event) => {
    if (isPointerEvent(event)) {
      handleMove(event);
    }
  };
  const endListener: EventListener = (event) => {
    if (isPointerEvent(event)) {
      handleEnd(event);
    }
  };
  const wheelListener: EventListener = (event) => {
    if (event instanceof WheelEvent) {
      handleWheel(event);
    }
  };
  const blurTarget = options.host.ownerDocument.defaultView;

  options.listenerTarget.addEventListener('pointerdown', downListener, true);
  document.addEventListener('pointermove', moveListener, true);
  document.addEventListener('pointerup', endListener, true);
  document.addEventListener('pointercancel', endListener, true);
  options.host.addEventListener('lostpointercapture', endListener, true);
  options.listenerTarget.addEventListener('wheel', wheelListener, true);
  blurTarget?.addEventListener('blur', finish);

  return Object.freeze({
    cancel: finish,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      options.listenerTarget.removeEventListener('pointerdown', downListener, true);
      document.removeEventListener('pointermove', moveListener, true);
      document.removeEventListener('pointerup', endListener, true);
      document.removeEventListener('pointercancel', endListener, true);
      options.host.removeEventListener('lostpointercapture', endListener, true);
      options.listenerTarget.removeEventListener('wheel', wheelListener, true);
      blurTarget?.removeEventListener('blur', finish);
      finish();
    },
  });
}
