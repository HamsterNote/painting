import type { LayeredEditorController } from '../core/layeredEditorController';
import { createLayeredToolSession, type SelectionOperation } from '../core/layeredToolSession';
import type { Point } from '../model/document';
import type { WebFreehandPolicy } from '../input/web/freehandWebAdapter';
import { createZoomFeedback } from './zoomFeedback';
import { traceGesture, type GestureTraceObserver } from '../input/web/gestureTrace';

/** Object identity is for ordinary hover/click only; captured trajectories use geometry. */
export function resolveObjectId(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null)
    : null;
}

export function createSemanticWebAdapter(options: {
  host: HTMLElement;
  controller: LayeredEditorController;
  allocateId: () => string;
  policy?: WebFreehandPolicy;
  onText: (point: Point) => void;
  onImage?: (point: Point) => void;
  onError: (error: unknown) => void;
  beforeGesture?: () => void;
  onTrace?: GestureTraceObserver;
  listen?: boolean;
  canNavigate?: () => boolean;
}) {
  const { host, controller } = options;
  const view = host.ownerDocument.defaultView!;
  const zoomFeedback = createZoomFeedback(controller, view);
  const engine = createLayeredToolSession(controller, options.allocateId);
  let owner: { id: number; source: string; start: Point; pan: boolean } | undefined;
  let snapshot = controller.getSnapshot('viewport');
  const screen = (event: PointerEvent): Point => {
    const rect = host.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - host.clientLeft,
      y: event.clientY - rect.top - host.clientTop,
    };
  };
  const world = (point: Point): Point => ({
    x: (point.x - snapshot.viewport.tx) / snapshot.viewport.scale,
    y: (point.y - snapshot.viewport.ty) / snapshot.viewport.scale,
  });
  const control = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest('button,input,textarea,select,a[href],[contenteditable],[data-interactive]');
  function safely(action: () => void) {
    try {
      action();
    } catch (error) {
      cancel();
      options.onError(error);
    }
  }
  function down(event: PointerEvent) {
    const tool = controller.getSnapshot('tools').activeTool;
    if (owner || tool === 'freehand' || event.button !== 0 || control(event.target)) return;
    if (
      !['pen', 'touch', 'mouse'].includes(event.pointerType) ||
      options.policy?.[event.pointerType as keyof WebFreehandPolicy] === 'none'
    )
      return;
    snapshot = controller.getSnapshot('viewport');
    const point = screen(event);
    options.beforeGesture?.();
    if (tool === 'text') {
      options.onText(world(point));
      event.preventDefault();
      return;
    }
    if (tool === 'image') {
      options.onImage?.(world(point));
      event.preventDefault();
      return;
    }
    const handle =
      event.target instanceof Element ? event.target.closest('[data-selection-operation]') : null;
    const operation = (handle?.getAttribute('data-selection-operation') ??
      'move') as SelectionOperation;
    safely(() => {
      if (
        tool !== 'pan' &&
        !engine.begin(
          world(point),
          operation,
          event.shiftKey,
          resolveObjectId(event.target) ?? undefined
        )
      )
        return;
      owner = { id: event.pointerId, source: event.pointerType, start: point, pan: tool === 'pan' };
      if (options.onTrace)
        traceGesture(options.onTrace, {
          scope: 'semantic',
          action: 'begin',
          reason: 'owned',
          pointerId: owner.id,
          source: owner.source,
          tool,
        });
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        /* Window listeners retain continuity. */
      }
      event.preventDefault();
    });
  }
  function hover(event: PointerEvent) {
    if (!owner) {
      const id = resolveObjectId(event.target);
      if (id) host.dataset.hoverObjectId = id;
      else delete host.dataset.hoverObjectId;
      if (!control(event.target)) {
        snapshot = controller.getSnapshot('viewport');
        safely(() => engine.hover(world(screen(event))));
      }
    }
  }
  function move(event: PointerEvent) {
    if (!owner || event.pointerId !== owner.id || event.pointerType !== owner.source) return;
    safely(() => {
      if (owner!.pan) {
        const point = screen(event);
        const latest = controller.getSnapshot('viewport');
        controller.updateViewport({
          type: 'replace',
          expectedRevision: latest.revision,
          viewport: {
            ...snapshot.viewport,
            tx: snapshot.viewport.tx + point.x - owner!.start.x,
            ty: snapshot.viewport.ty + point.y - owner!.start.y,
          },
        });
      } else {
        let events: readonly PointerEvent[] = [event];
        try {
          const coalesced = event.getCoalescedEvents?.();
          if (coalesced?.length) events = coalesced;
        } catch {
          /* Parent sample remains available. */
        }
        engine.update(events.map((sample) => world(screen(sample))));
      }
    });
    event.preventDefault();
  }
  function release() {
    const current = owner;
    if (current && options.onTrace)
      traceGesture(options.onTrace, {
        scope: 'semantic',
        action: 'release',
        pointerId: current.id,
        source: current.source,
      });
    owner = undefined;
    if (current)
      try {
        host.releasePointerCapture(current.id);
      } catch {
        /* Already released. */
      }
  }
  function up(event: PointerEvent) {
    if (!owner || event.pointerId !== owner.id || event.pointerType !== owner.source) return;
    safely(() => {
      if (!owner!.pan) {
        engine.update([world(screen(event))]);
        engine.end();
      }
    });
    release();
  }
  function cancel() {
    zoomFeedback.clear();
    engine.cancel();
    release();
    return (
      controller.getSnapshot('preview').objects.length === 0 &&
      controller.getSnapshot('preview').path.length === 0 &&
      controller.getSnapshot('preview').hiddenIds.length === 0
    );
  }
  function pointerCancel(event: PointerEvent) {
    if (owner?.id === event.pointerId) cancel();
  }
  function doubleClick(event: MouseEvent) {
    if (control(event.target)) return;
    safely(() => {
      if (engine.completePolygon(event.detail === 2)) event.preventDefault();
    });
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && (owner || engine.isPlacing())) {
      cancel();
      event.preventDefault();
    }
  }
  function hidden() {
    if (host.ownerDocument.visibilityState === 'hidden') cancel();
  }
  function wheel(event: WheelEvent) {
    if (control(event.target) || options.canNavigate?.() === false) return;
    const config = controller.getSnapshot('navigation').virtualPaper;
    const modified = event.ctrlKey || event.metaKey;
    const zoom =
      config.enabled &&
      config.enabledInteractions.includes(modified ? 'mouseWheelCtrlZoom' : 'mouseWheelZoom');
    const pan =
      config.enabled && !modified && config.enabledInteractions.includes('trackpadScrollPan');
    if (!zoom && !pan) return;
    event.preventDefault();
    const current = controller.getSnapshot('viewport');
    const rect = host.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
    const ratio = zoom ? Math.exp(-event.deltaY * unit * 0.002) : 1;
    const scale = Math.max(
      config.minScale,
      Math.min(config.maxScale, current.viewport.scale * ratio)
    );
    const result = controller.updateViewport({
      type: 'replace',
      expectedRevision: current.revision,
      viewport:
        ratio !== 1
          ? {
              scale,
              tx: anchor.x - ((anchor.x - current.viewport.tx) * scale) / current.viewport.scale,
              ty: anchor.y - ((anchor.y - current.viewport.ty) * scale) / current.viewport.scale,
            }
          : {
              ...current.viewport,
              tx: current.viewport.tx - event.deltaX * unit,
              ty: current.viewport.ty - event.deltaY * unit,
            },
    });
    if (result.ok && zoom) zoomFeedback.show(scale, anchor);
  }
  const unsubscribe = controller.subscribe('tools', () => {
    if (owner) cancel();
  });
  if (options.listen !== false) {
    host.addEventListener('pointerdown', down);
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', pointerCancel);
  }
  view.addEventListener('blur', cancel);
  host.ownerDocument.addEventListener('visibilitychange', hidden);
  host.addEventListener('pointermove', hover);
  host.addEventListener('dblclick', doubleClick);
  host.addEventListener('wheel', wheel, { passive: false });
  view.addEventListener('keydown', keyDown);
  return {
    cancel,
    dispatch(event: PointerEvent) {
      if (event.type === 'pointerdown') down(event);
      else if (event.type === 'pointermove') move(event);
      else if (event.type === 'pointerup') up(event);
      else if (event.type === 'pointercancel') pointerCancel(event);
    },
    destroy() {
      cancel();
      engine.destroy();
      unsubscribe();
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('pointermove', hover);
      host.removeEventListener('dblclick', doubleClick);
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      view.removeEventListener('pointercancel', pointerCancel);
      view.removeEventListener('blur', cancel);
      view.removeEventListener('keydown', keyDown);
      host.ownerDocument.removeEventListener('visibilitychange', hidden);
    },
  };
}
