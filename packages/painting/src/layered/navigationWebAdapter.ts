import type {
  LayeredEditorController,
  LayeredViewportSnapshot,
} from '../core/layeredEditorController';
import { createRulerGestureController } from '../input/web/rulerGestureController';
import {
  getInfiniteRulerLayout,
  isInsideRuler,
  projectPointToRulerCenterline,
} from '../ruler/geometry';
import { applyViewportTransformIntent } from '../core/viewportTransform';
import type { Point } from '../model/document';
import { createZoomFeedback } from './zoomFeedback';
import { traceGesture, type GestureTraceObserver } from '../input/web/gestureTrace';

/** Touch navigation owns a fixed pair; ignored contacts never become a deferred gesture. */
export function createNavigationWebAdapter(
  host: HTMLElement,
  controller: LayeredEditorController,
  _touchDraw = false,
  onTrace?: GestureTraceObserver,
  options: { listen?: boolean; canNavigate?: () => boolean } = {}
) {
  const view = host.ownerDocument.defaultView!;
  const zoomFeedback = createZoomFeedback(controller, view);
  const touches = new Map<number, Point>();
  const suppressed = new Set<number>();
  let baseline: { viewport: LayeredViewportSnapshot; focal: Point; distance: number } | undefined;
  let drag:
    { id: number; source: string; start: Point; viewport: LayeredViewportSnapshot } | undefined;
  const config = () => controller.getSnapshot('navigation').virtualPaper;
  const allows = (
    interaction: Parameters<ReturnType<typeof config>['enabledInteractions']['includes']>[0]
  ) =>
    (options.listen === false && interaction.startsWith('touch')) ||
    (config().enabled && config().enabledInteractions.includes(interaction));
  const screen = (event: PointerEvent): Point => {
    const rect = host.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - host.clientLeft,
      y: event.clientY - rect.top - host.clientTop,
    };
  };
  const writing = () =>
    controller.getSnapshot('interaction').activeFreehand?.status === 'collecting' ||
    options.canNavigate?.() === false;
  const measure = () => {
    const [a, b] = [...touches.values()];
    return {
      focal: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
    };
  };
  const resetBaseline = () => {
    baseline = touches.size
      ? { viewport: controller.getSnapshot('viewport'), ...measure() }
      : undefined;
  };
  const consume = (event: PointerEvent) => {
    if (onTrace)
      traceGesture(onTrace, {
        scope: 'navigation',
        action: event.type,
        reason: suppressed.has(event.pointerId) ? 'suppressed' : 'owned',
        pointerId: event.pointerId,
        source: event.pointerType,
      });
    event.preventDefault();
    event.stopPropagation();
  };
  function down(event: PointerEvent) {
    if (
      event.target instanceof Element &&
      event.target.closest('[data-interactive],button,input,textarea,select')
    )
      return;
    if (event.pointerType !== 'touch') {
      const enabled =
        event.pointerType === 'mouse'
          ? allows('mouseDragPan')
          : event.pointerType === 'pen' && allows('penPan');
      if (
        enabled &&
        !event.defaultPrevented &&
        !writing() &&
        !drag &&
        !touches.size &&
        event.button === 0
      ) {
        drag = {
          id: event.pointerId,
          source: event.pointerType,
          start: screen(event),
          viewport: controller.getSnapshot('viewport'),
        };
        try {
          host.setPointerCapture(event.pointerId);
        } catch {
          /* Window listeners retain continuity. */
        }
        consume(event);
      }
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('[data-interactive],button,input,textarea,select')
    )
      return;
    if (
      !config().enabled ||
      (!allows('touchSingleFingerPan') &&
        !allows('touchTwoFingerPan') &&
        !allows('touchTwoFingerZoom'))
    )
      return;
    if (writing() || drag || touches.size >= 2 || suppressed.size) {
      suppressed.add(event.pointerId);
      consume(event);
      return;
    }
    touches.set(event.pointerId, screen(event));
    resetBaseline();
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      /* Window listeners retain continuity. */
    }
    consume(event);
  }
  function move(event: PointerEvent) {
    if (drag?.id === event.pointerId && drag.source === event.pointerType) {
      if (writing() || (options.listen !== false && !config().enabled)) {
        drag = undefined;
        return;
      }
      const point = screen(event);
      controller.updateViewport({
        type: 'replace',
        expectedRevision: controller.getSnapshot('viewport').revision,
        viewport: {
          ...drag.viewport.viewport,
          tx: drag.viewport.viewport.tx + point.x - drag.start.x,
          ty: drag.viewport.viewport.ty + point.y - drag.start.y,
        },
      });
      consume(event);
      return;
    }
    if (suppressed.has(event.pointerId)) {
      consume(event);
      return;
    }
    if (!touches.has(event.pointerId) || !baseline) return;
    if (writing()) {
      for (const id of touches.keys()) suppressed.add(id);
      touches.clear();
      baseline = undefined;
      consume(event);
      return;
    }
    touches.set(event.pointerId, screen(event));
    const current = measure();
    const pan = touches.size === 1 ? allows('touchSingleFingerPan') : allows('touchTwoFingerPan');
    const viewport = applyViewportTransformIntent(
      baseline.viewport.viewport,
      {
        startFocal: baseline.focal,
        currentFocal: pan ? current.focal : baseline.focal,
        scaleRatio:
          allows('touchTwoFingerZoom') && baseline.distance > 0
            ? current.distance / baseline.distance
            : 1,
      },
      { min: config().minScale, max: config().maxScale }
    );
    if (viewport) {
      const result = controller.updateViewport({
        type: 'replace',
        expectedRevision: controller.getSnapshot('viewport').revision,
        viewport,
      });
      if (result.ok && touches.size === 2 && viewport.scale !== baseline.viewport.viewport.scale)
        zoomFeedback.show(viewport.scale, current.focal);
    }
    consume(event);
  }
  function end(event: PointerEvent) {
    if (drag?.id === event.pointerId) {
      drag = undefined;
      consume(event);
      return;
    }
    if (suppressed.delete(event.pointerId)) {
      consume(event);
      return;
    }
    if (!touches.has(event.pointerId)) return;
    // The surviving finger must lift before it can start a fresh navigation gesture.
    touches.delete(event.pointerId);
    for (const id of touches.keys()) suppressed.add(id);
    touches.clear();
    baseline = undefined;
    try {
      host.releasePointerCapture(event.pointerId);
    } catch {
      /* Already released. */
    }
    consume(event);
  }
  function cancel() {
    zoomFeedback.clear();
    drag = undefined;
    touches.clear();
    suppressed.clear();
    baseline = undefined;
  }
  const ruler = createRulerGestureController({
    host,
    onTrace,
    listenerTarget: host,
    getRulerState: () => {
      const state = controller.getSnapshot('navigation').ruler;
      return state.visible && !writing() ? state : null;
    },
    getRotationPivot: (state) => {
      const rect = host.getBoundingClientRect();
      return rect.width > 0
        ? getInfiniteRulerLayout({
            logicalCenter: state.center,
            rotationRad: state.rotationRad,
            height: controller.getSnapshot('navigation').ruler.height,
            viewport: rect,
          }).visualCenter
        : state.center;
    },
    hitTest: (event) => {
      const state = controller.getSnapshot('navigation').ruler;
      return state.visible && !writing() && isInsideRuler(screen(event), { ...state, length: 1 });
    },
    toLocalPoint: screen,
    onState: (state) =>
      controller.setNavigation({
        ruler: { ...controller.getSnapshot('navigation').ruler, ...state },
      }),
    onActiveChange: (active) => {
      if (onTrace)
        traceGesture(onTrace, {
          scope: 'navigation',
          action: 'ruler',
          reason: active ? 'owned' : 'released',
        });
    },
    onRotationFeedback: (feedback) =>
      controller.setNavigation({
        rotationFeedback: feedback
          ? {
              point: projectPointToRulerCenterline(feedback.point, feedback.state),
              rotationRad: feedback.rotationRad,
            }
          : null,
      }),
  });
  if (options.listen !== false) {
    host.addEventListener('pointerdown', down, true);
    view.addEventListener('pointermove', move, true);
    view.addEventListener('pointerup', end, true);
    view.addEventListener('pointercancel', end, true);
    view.addEventListener('blur', cancel);
    view.addEventListener('pagehide', cancel);
  }
  const hidden = () => {
    if (host.ownerDocument.visibilityState === 'hidden') {
      cancel();
      ruler.cancel();
    }
  };
  if (options.listen !== false) host.ownerDocument.addEventListener('visibilitychange', hidden);
  const capture = (id: number) => {
    try {
      host.setPointerCapture(id);
    } catch {
      /* Window retains continuity. */
    }
  };
  return {
    targetRole(event: PointerEvent) {
      const state = controller.getSnapshot('navigation').ruler;
      // A frozen ruler still owns its hit area; it must not become a paper contact.
      return event.pointerType === 'touch' &&
        state.visible &&
        isInsideRuler(screen(event), { ...state, length: 1 })
        ? ('ruler' as const)
        : undefined;
    },
    cancel() {
      cancel();
      return true;
    },
    begin(events: readonly PointerEvent[]) {
      cancel();
      for (const event of events) {
        touches.set(event.pointerId, screen(event));
        capture(event.pointerId);
      }
      resetBaseline();
    },
    dispatch(event: PointerEvent) {
      if (event.type === 'pointerdown') {
        drag = {
          id: event.pointerId,
          source: event.pointerType,
          start: screen(event),
          viewport: controller.getSnapshot('viewport'),
        };
        capture(event.pointerId);
        consume(event);
      } else if (event.type === 'pointermove') move(event);
      else if (event.type === 'pointerup' || event.type === 'pointercancel') end(event);
    },
    destroy() {
      ruler.dispose();
      cancel();
      host.removeEventListener('pointerdown', down, true);
      view.removeEventListener('pointermove', move, true);
      view.removeEventListener('pointerup', end, true);
      view.removeEventListener('pointercancel', end, true);
      view.removeEventListener('blur', cancel);
      view.removeEventListener('pagehide', cancel);
      host.ownerDocument.removeEventListener('visibilitychange', hidden);
    },
  };
}
