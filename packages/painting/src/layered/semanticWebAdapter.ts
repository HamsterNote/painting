import type { LayeredEditorController } from '../core/layeredEditorController';
import { createLayeredToolSession, type SelectionOperation } from '../core/layeredToolSession';
import type { Point } from '../model/document';
import type { WebFreehandPolicy } from '../input/web/freehandWebAdapter';

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
}) {
  const { host, controller } = options;
  const view = host.ownerDocument.defaultView!;
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
    engine.cancel();
    release();
  }
  function pointerCancel(event: PointerEvent) {
    if (owner?.id === event.pointerId) cancel();
  }
  function hidden() {
    if (host.ownerDocument.visibilityState === 'hidden') cancel();
  }
  function wheel(event: WheelEvent) {
    if (control(event.target)) return;
    event.preventDefault();
    const current = controller.getSnapshot('viewport');
    const rect = host.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const ratio = event.ctrlKey || event.metaKey ? Math.exp(-event.deltaY * 0.002) : 1;
    const scale = Math.max(0.25, Math.min(8, current.viewport.scale * ratio));
    controller.updateViewport({
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
              tx: current.viewport.tx - event.deltaX,
              ty: current.viewport.ty - event.deltaY,
            },
    });
  }
  const unsubscribe = controller.subscribe('tools', () => {
    if (owner) cancel();
  });
  host.addEventListener('pointerdown', down);
  host.addEventListener('pointermove', hover);
  host.addEventListener('wheel', wheel, { passive: false });
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', pointerCancel);
  view.addEventListener('blur', cancel);
  host.ownerDocument.addEventListener('visibilitychange', hidden);
  return {
    destroy() {
      cancel();
      engine.destroy();
      unsubscribe();
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('pointermove', hover);
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      view.removeEventListener('pointercancel', pointerCancel);
      view.removeEventListener('blur', cancel);
      host.ownerDocument.removeEventListener('visibilitychange', hidden);
    },
  };
}
