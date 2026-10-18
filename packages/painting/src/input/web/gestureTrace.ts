/** Opt-in diagnostics. Entries contain metadata, never document/text/image contents. */
export type GestureTraceEntry = Readonly<{
  scope: 'event' | 'freehand' | 'navigation' | 'semantic' | 'presentation';
  action: string;
  reason?: string;
  pointerId?: number | string;
  source?: string;
  ownerPointerId?: number;
  sessionId?: string;
  commitId?: string;
  objectId?: string;
  tool?: string;
  target?: string;
  timeStamp?: number;
  trusted?: boolean;
  buttons?: number;
  pressure?: number;
  x?: number;
  y?: number;
  captured?: boolean;
  defaultPrevented?: boolean;
  cancelable?: boolean;
  touchAction?: string;
  sampleCount?: number;
  batchSequence?: number;
  viewportRevision?: number;
  documentRevision?: number;
  pendingCount?: number;
  ok?: boolean;
}>;

export type GestureTraceObserver = (entry: GestureTraceEntry) => void;

export function traceGesture(observer: GestureTraceObserver | undefined, entry: GestureTraceEntry) {
  try {
    observer?.(entry);
  } catch {
    // Instrumentation must never interrupt input or presentation.
  }
}

/** Observe before routing, including up outside the host and capture transfer. */
export function observeGestureEvents(host: HTMLElement, observer: GestureTraceObserver) {
  const view = host.ownerDocument.defaultView!;
  const pointers = new Set<number>();
  const events = [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'gotpointercapture',
    'lostpointercapture',
  ] as const;
  const record = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : undefined;
    if (event.type === 'pointerdown' && target && host.contains(target))
      pointers.add(event.pointerId);
    if (!pointers.has(event.pointerId)) return;
    traceGesture(observer, {
      scope: 'event',
      action: event.type,
      pointerId: event.pointerId,
      source: event.pointerType,
      timeStamp: event.timeStamp,
      trusted: event.isTrusted,
      buttons: event.buttons,
      pressure: event.pressure,
      x: event.clientX,
      y: event.clientY,
      captured: host.hasPointerCapture?.(event.pointerId) ?? false,
      defaultPrevented: event.defaultPrevented,
      cancelable: event.cancelable,
      target:
        target === host
          ? 'surface'
          : target?.closest('[data-interactive]')
            ? 'control'
            : target?.closest('[data-object-id]')
              ? 'object'
              : (target?.tagName.toLowerCase() ?? 'window'),
      ...(event.type === 'pointerdown'
        ? { touchAction: view.getComputedStyle(host).touchAction }
        : {}),
    });
    if (event.type === 'pointerup' || event.type === 'pointercancel')
      pointers.delete(event.pointerId);
  };
  const background = (event: Event) => {
    traceGesture(observer, {
      scope: 'event',
      action: event.type,
      reason: host.ownerDocument.visibilityState,
    });
    if (event.type !== 'visibilitychange' || host.ownerDocument.visibilityState === 'hidden')
      pointers.clear();
  };
  events.forEach((event) => view.addEventListener(event, record, true));
  view.addEventListener('blur', background);
  view.addEventListener('pagehide', background);
  host.ownerDocument.addEventListener('visibilitychange', background);
  return () => {
    events.forEach((event) => view.removeEventListener(event, record, true));
    view.removeEventListener('blur', background);
    view.removeEventListener('pagehide', background);
    host.ownerDocument.removeEventListener('visibilitychange', background);
    pointers.clear();
  };
}
