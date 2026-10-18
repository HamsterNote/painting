import {
  createGestureSession,
  reduceGestureSession,
  type GestureRulerState,
  type GestureSession,
} from '../../core/gesture/session';
import type { Point } from '../../core/input';
import * as webInput from './normalizePointerInput';
import { traceGesture, type GestureTraceObserver } from './gestureTrace';

type RulerDomState = Readonly<{
  center: Point;
  rotationRad?: number;
}>;

export type RulerGestureControllerOptions = Readonly<{
  host: HTMLElement;
  listenerTarget: EventTarget;
  getRulerState: () => RulerDomState | null;
  getRotationPivot: (state: GestureRulerState) => Point;
  hitTest: (event: PointerEvent) => boolean;
  toLocalPoint: (event: PointerEvent) => Point;
  onState: (state: GestureRulerState) => void;
  onActiveChange: (active: boolean) => void;
  onTrace?: GestureTraceObserver;
  onRotationFeedback: (
    feedback: Readonly<{ rotationRad: number; point: Point; state: GestureRulerState }> | null
  ) => void;
}>;

export type RulerGestureController = Readonly<{
  cancel: (options?: { releaseContacts?: boolean }) => void;
  dispose: () => void;
}>;

type ActiveMouse = Readonly<{
  pointerId: number;
  mode: 'translate' | 'rotate';
  pivot: Point;
  pendingRotation: boolean;
  lastAcceptedPoint: Point | null;
}>;

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function stopRulerEvent(event: Event, onTrace?: GestureTraceObserver): void {
  if (onTrace && isPointerEvent(event))
    traceGesture(onTrace, {
      scope: 'navigation',
      action: event.type,
      reason: 'ruler',
      pointerId: event.pointerId,
      source: event.pointerType,
    });
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopPropagation();
}

/**
 * DOM 尺子输入。它只负责 pointer capture、几何分类与宿主 content-box DIP 归一化；
 * 所有尺子位姿均由 core GestureSession 计算。不会伪造 DOM 事件或调用 multi-drag API。
 */
export function createRulerGestureController(
  options: RulerGestureControllerOptions
): RulerGestureController {
  let session: GestureSession | null = null;
  let mouse: ActiveMouse | null = null;
  let touchIds: readonly number[] = [];
  const touchPoints = new Map<number, Point>();
  const suppressedIds = new Set<number>();
  let disposed = false;

  const release = (pointerId: number) => {
    try {
      if (options.host.hasPointerCapture(pointerId)) {
        options.host.releasePointerCapture(pointerId);
      }
    } catch {
      // 部分宿主或测试环境没有可用的 pointer capture；清理仍必须继续。
    }
  };
  const capture = (pointerId: number) => {
    try {
      options.host.setPointerCapture(pointerId);
    } catch {
      // Pointer capture 是增强而非 core 正确性的前提，document capture 仍覆盖生命周期。
    }
  };
  const currentState = (): GestureRulerState | null => {
    const state = options.getRulerState();
    if (!state || !isFinitePoint(state.center) || !Number.isFinite(state.rotationRad ?? 0)) {
      return null;
    }
    return { center: state.center, rotationRad: state.rotationRad ?? 0 };
  };
  const beginSession = (event: PointerEvent, point: Point, pivot?: Point): boolean => {
    const state = currentState();
    if (!state || !isFinitePoint(point)) {
      return false;
    }
    session = createGestureSession({
      document: { schemaVersion: 2, strokes: [] },
      ruler: { state, pivot },
    });
    consume(event, 'down', point);
    return true;
  };
  const finish = () => {
    const capturedTouchIds = touchIds;
    const capturedMouse = mouse;
    session = null;
    mouse = null;
    touchIds = [];
    touchPoints.clear();
    for (const pointerId of capturedTouchIds) {
      release(pointerId);
    }
    if (capturedMouse) {
      release(capturedMouse.pointerId);
    }
    options.onActiveChange(false);
    options.onRotationFeedback(null);
  };
  const consume = (event: PointerEvent, phase: 'down' | 'move' | 'up' | 'cancel', point: Point) => {
    if (!session) {
      return;
    }
    const input = webInput.normalizePointerInput(event, {
      host: options.host,
      now: () => 0,
      point,
      phase,
      targetRole: 'ruler',
    });
    if (!input) {
      return;
    }
    const transition = reduceGestureSession(session, input);
    session = transition.session;
    const preview = transition.session.transient.ruler;
    if (preview) {
      // `down` 只建立 core session；不可把零位姿当作一次产品状态变更发给受控父级。
      if (phase !== 'down') {
        options.onState(preview.state);
      }
      if (mouse?.mode === 'rotate' || touchIds.length === 2) {
        const touchMidpoint =
          touchIds.length === 2 && touchPoints.has(touchIds[0]) && touchPoints.has(touchIds[1])
            ? {
                x: (touchPoints.get(touchIds[0])!.x + touchPoints.get(touchIds[1])!.x) / 2,
                y: (touchPoints.get(touchIds[0])!.y + touchPoints.get(touchIds[1])!.y) / 2,
              }
            : null;
        options.onRotationFeedback({
          rotationRad: preview.state.rotationRad,
          point: mouse?.pivot ?? touchMidpoint ?? point,
          state: preview.state,
        });
      }
    }
    for (const effect of transition.effects) {
      if (effect.type === 'ruler-complete') {
        options.onState(effect.state);
      }
    }
  };
  const owns = (pointerId: number): boolean =>
    mouse?.pointerId === pointerId || touchIds.includes(pointerId);
  const cancel = ({ releaseContacts = false } = {}) => {
    if (releaseContacts) suppressedIds.clear();
    else {
      for (const id of touchIds) suppressedIds.add(id);
      if (mouse) suppressedIds.add(mouse.pointerId);
    }
    finish();
  };
  const handleDown = (event: PointerEvent) => {
    if (suppressedIds.has(event.pointerId)) {
      stopRulerEvent(event, options.onTrace);
      return;
    }
    if (disposed || !options.hitTest(event)) {
      return;
    }
    const point = options.toLocalPoint(event);
    if (!isFinitePoint(point)) {
      return;
    }
    if (event.pointerType === 'mouse') {
      if (
        event.button !== 0 ||
        mouse ||
        touchIds.length > 0 ||
        (!event.altKey && !event.ctrlKey && !event.metaKey)
      ) {
        return;
      }
      const state = currentState();
      if (!state) {
        return;
      }
      const pivot = options.getRotationPivot(state);
      const rotate = event.altKey;
      const pendingRotation = rotate && Math.hypot(point.x - pivot.x, point.y - pivot.y) < 8;
      mouse = {
        pointerId: event.pointerId,
        mode: rotate ? 'rotate' : 'translate',
        pivot,
        pendingRotation,
        lastAcceptedPoint: pendingRotation ? null : point,
      };
      if (!pendingRotation && !beginSession(event, point, rotate ? pivot : undefined)) {
        mouse = null;
        return;
      }
      capture(event.pointerId);
      options.onActiveChange(true);
      if (rotate) {
        options.onRotationFeedback({ rotationRad: state.rotationRad, point: pivot, state });
      }
      stopRulerEvent(event, options.onTrace);
      return;
    }
    if (event.pointerType !== 'touch' || mouse) {
      return;
    }
    if (touchIds.length >= 2) {
      suppressedIds.add(event.pointerId);
      stopRulerEvent(event, options.onTrace);
      return;
    }
    if (!session) {
      if (!beginSession(event, point)) {
        return;
      }
    } else {
      consume(event, 'down', point);
    }
    touchIds = [...touchIds, event.pointerId];
    touchPoints.set(event.pointerId, point);
    capture(event.pointerId);
    if (touchIds.length === 2) {
      options.onActiveChange(true);
      const preview = session?.transient.ruler;
      if (preview) {
        options.onRotationFeedback({
          rotationRad: preview.state.rotationRad,
          point: {
            x: (touchPoints.get(touchIds[0])!.x + touchPoints.get(touchIds[1])!.x) / 2,
            y: (touchPoints.get(touchIds[0])!.y + touchPoints.get(touchIds[1])!.y) / 2,
          },
          state: preview.state,
        });
      }
    }
    stopRulerEvent(event, options.onTrace);
  };
  const handleMove = (event: PointerEvent) => {
    if (suppressedIds.has(event.pointerId)) {
      stopRulerEvent(event, options.onTrace);
      return;
    }
    if (!owns(event.pointerId)) {
      return;
    }
    const point = options.toLocalPoint(event);
    if (!isFinitePoint(point)) {
      return;
    }
    if (mouse?.pointerId === event.pointerId && mouse.mode === 'rotate') {
      if (Math.hypot(point.x - mouse.pivot.x, point.y - mouse.pivot.y) < 8) {
        mouse = { ...mouse, pendingRotation: true };
        stopRulerEvent(event, options.onTrace);
        return;
      }
      if (mouse.pendingRotation) {
        if (!beginSession(event, point, mouse.pivot)) {
          return;
        }
        mouse = { ...mouse, pendingRotation: false, lastAcceptedPoint: point };
      } else {
        consume(event, 'move', point);
        mouse = { ...mouse, lastAcceptedPoint: point };
      }
    } else {
      if (touchIds.includes(event.pointerId)) {
        touchPoints.set(event.pointerId, point);
      }
      if (touchIds.length === 1 && touchIds[0] === event.pointerId) {
        // 第一触点在 pair 建立前没有位姿效果，但第二触点必须以其最新实际位置组成固定 pair。
        session = null;
        beginSession(event, point);
      } else {
        consume(event, 'move', point);
      }
    }
    stopRulerEvent(event, options.onTrace);
  };
  const handleEnd = (event: PointerEvent) => {
    if (suppressedIds.has(event.pointerId)) {
      if (event.type !== 'lostpointercapture') suppressedIds.delete(event.pointerId);
      release(event.pointerId);
      stopRulerEvent(event, options.onTrace);
      return;
    }
    if (!owns(event.pointerId)) {
      return;
    }
    const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
    const point = options.toLocalPoint(event);
    if (session && isFinitePoint(point)) {
      if (touchIds.includes(event.pointerId)) {
        touchPoints.set(event.pointerId, point);
      }
      const finalPoint =
        mouse?.pointerId === event.pointerId && mouse.mode === 'rotate' && mouse.pendingRotation
          ? mouse.lastAcceptedPoint
          : point;
      if (finalPoint) {
        consume(event, cancelled ? 'cancel' : 'up', finalPoint);
      }
    }
    stopRulerEvent(event, options.onTrace);
    finish();
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
  options.listenerTarget.addEventListener('pointerdown', downListener, true);
  document.addEventListener('pointermove', moveListener, true);
  document.addEventListener('pointerup', endListener, true);
  document.addEventListener('pointercancel', endListener, true);
  options.host.addEventListener('lostpointercapture', endListener, true);

  return Object.freeze({
    cancel,
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
      finish();
    },
  });
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
