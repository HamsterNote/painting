import {
  createGestureSession,
  reduceGestureSession,
  type SelectionGestureDescriptor,
  type SelectionIntent,
} from '../../core/internal';
import type { Point } from '../../core/input';
import * as webInput from './normalizePointerInput';

export type SelectionGestureControllerOptions = Readonly<{
  host: HTMLElement;
  listenerTarget: EventTarget;
  toLocalPoint: (event: PointerEvent) => Point;
  /** 返回 null 即不接管，调用方在此复用工具、输入方法、owner 与 ruler 命中 gate。 */
  describe: (event: PointerEvent, point: Point) => SelectionGestureDescriptor | null;
  onPreview: (intent: SelectionIntent) => void;
  onCommit: (intent: SelectionIntent) => void;
  onStart: () => void;
  onEnd: (committed: boolean) => void;
}>;

export type SelectionGestureController = Readonly<{
  cancel: () => void;
  dispose: () => void;
}>;

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
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

function consumeSelectionEvent(event: Event): void {
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopPropagation();
}

/**
 * legacy DOM 选区接缝：只执行 capture 分类、宿主本地 DIP 转换和 pointer lifecycle；所有
 * move/resize/rotate intent 均由 core GestureSession 推导。它不伪造事件也不调用 multi-drag。
 */
export function createSelectionGestureController(
  options: SelectionGestureControllerOptions
): SelectionGestureController {
  let pointerId: number | null = null;
  let session: ReturnType<typeof createGestureSession> | null = null;
  let lastRotationDelta = 0;
  let accumulatedRotationDelta = 0;
  let disposed = false;

  const release = (id: number) => {
    try {
      if (options.host.hasPointerCapture(id)) {
        options.host.releasePointerCapture(id);
      }
    } catch {
      // 测试环境和部分嵌入宿主可不支持 capture；仍要完成会话清理。
    }
  };
  const finish = (committed = false) => {
    const id = pointerId;
    pointerId = null;
    session = null;
    lastRotationDelta = 0;
    accumulatedRotationDelta = 0;
    if (id !== null) {
      release(id);
      options.onEnd(committed);
    }
  };
  const unwrapIntent = (intent: SelectionIntent): SelectionIntent => {
    if (intent.kind !== 'rotate') {
      return intent;
    }
    // core 输出相对起点的短弧 delta；adapter 保留连续拖动经过 +/-PI 时的完整转角。
    const increment = Math.atan2(
      Math.sin(intent.deltaRad - lastRotationDelta),
      Math.cos(intent.deltaRad - lastRotationDelta)
    );
    lastRotationDelta = intent.deltaRad;
    accumulatedRotationDelta += increment;
    return { ...intent, deltaRad: accumulatedRotationDelta };
  };
  const cancel = () => finish();
  const handleDown = (event: PointerEvent) => {
    if (disposed || pointerId !== null) {
      return;
    }
    const point = options.toLocalPoint(event);
    if (!isFinitePoint(point)) {
      return;
    }
    const descriptor = options.describe(event, point);
    if (!descriptor) {
      return;
    }
    session = createGestureSession({
      document: { schemaVersion: 2, strokes: [] },
      selection: descriptor,
    });
    const input = webInput.normalizePointerInput(event, {
      host: options.host,
      now: () => 0,
      point,
      phase: 'down',
      targetRole: 'selection',
    });
    if (!input) {
      session = null;
      return;
    }
    session = reduceGestureSession(session, input).session;
    pointerId = event.pointerId;
    lastRotationDelta = 0;
    accumulatedRotationDelta = 0;
    try {
      options.host.setPointerCapture(event.pointerId);
    } catch {
      // document capture listener remains the lifecycle fallback.
    }
    options.onStart();
    consumeSelectionEvent(event);
  };
  const handleMove = (event: PointerEvent) => {
    if (!session || pointerId !== event.pointerId) {
      return;
    }
    const point = options.toLocalPoint(event);
    if (!isFinitePoint(point)) {
      return;
    }
    const input = webInput.normalizePointerInput(event, {
      host: options.host,
      now: () => 0,
      point,
      phase: 'move',
      targetRole: 'selection',
    });
    if (!input) {
      return;
    }
    const transition = reduceGestureSession(session, input);
    session = transition.session;
    if (transition.session.transient.selection) {
      options.onPreview(unwrapIntent(transition.session.transient.selection));
    }
    consumeSelectionEvent(event);
  };
  const handleEnd = (event: PointerEvent) => {
    if (!session || pointerId !== event.pointerId) {
      return;
    }
    const point = options.toLocalPoint(event);
    const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
    let committed = false;
    if (isFinitePoint(point)) {
      const input = webInput.normalizePointerInput(event, {
        host: options.host,
        now: () => 0,
        point,
        phase: cancelled ? 'cancel' : 'up',
        targetRole: 'selection',
      });
      if (input) {
        const transition = reduceGestureSession(session, input);
        session = transition.session;
        for (const effect of transition.effects) {
          if (effect.type === 'selection-commit') {
            // `up` 已由 core 纳入最终 intent；preview 必须先更新，再由外层一次性持久化。
            const intent = unwrapIntent(effect.intent);
            options.onPreview(intent);
            options.onCommit(intent);
            committed = true;
          }
        }
      }
    }
    consumeSelectionEvent(event);
    finish(committed);
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
