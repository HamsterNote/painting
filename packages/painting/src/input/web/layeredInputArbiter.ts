import type { LayeredEditorController } from '../../core/layeredEditorController';
import type { NormalizedPointerInput, TargetRole } from '../../core/input';
import {
  createLayeredInputArbitration,
  reduceLayeredInputArbitration,
  type LayeredInputArbitrationEvent,
  type LayeredInputIntent,
} from '../../core/layeredInputArbitration';

export type LayeredInputPort = {
  dispatch(event: PointerEvent): void;
  cancel(): boolean;
};

export function createLayeredInputArbiter(options: {
  host: HTMLElement;
  controller: LayeredEditorController;
  tool: LayeredInputPort;
  navigation: LayeredInputPort & { begin(events: readonly PointerEvent[]): void };
  targetRole?: (event: PointerEvent) => TargetRole;
  onDiagnostic?: (message: string) => void;
}) {
  const { host, controller, tool, navigation } = options;
  const view = host.ownerDocument.defaultView!;
  const events = new Map<string | number, PointerEvent>();
  const seen = new WeakSet<Event>();
  let state = createLayeredInputArbitration();
  let destroyed = false;
  let mode = controller.getSnapshot('input').mode;

  function execute(intents: readonly LayeredInputIntent[]) {
    for (const intent of intents) {
      if (intent.type === 'detect-pen') controller.recordPenDown();
      else if (intent.type === 'cancel') {
        const ok = (intent.target === 'tool' ? tool : navigation).cancel();
        if (!ok) options.onDiagnostic?.('Input cancellation failed; navigation refused');
        dispatch({ type: 'cancel-result', ok });
      } else if (intent.type === 'begin-navigation') {
        navigation.begin(intent.pointers.map((p) => events.get(p.pointerId)!));
      } else {
        const event = events.get(intent.input.pointerId);
        if (event) (intent.target === 'tool' ? tool : navigation).dispatch(event);
      }
    }
  }
  function dispatch(event: LayeredInputArbitrationEvent) {
    const result = reduceLayeredInputArbitration(state, event);
    state = result.state;
    execute(result.intents);
  }
  function normalize(event: PointerEvent): NormalizedPointerInput | undefined {
    const source = event.pointerType;
    if (source !== 'mouse' && source !== 'touch' && source !== 'pen') return;
    if (
      !Number.isSafeInteger(event.pointerId) ||
      event.pointerId < 0 ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY) ||
      !Number.isFinite(event.timeStamp) ||
      (event.pressure !== undefined && !Number.isFinite(event.pressure))
    )
      return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left - host.clientLeft;
    const y = event.clientY - rect.top - host.clientTop;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const control =
      event.target instanceof Element &&
      event.target.closest(
        'button,input,textarea,select,a[href],[contenteditable],[data-interactive]'
      );
    const targetRole = control
      ? 'safe-control'
      : (options.targetRole?.(event) ??
        (event.target instanceof Element && event.target.closest('[data-selection-operation]')
          ? 'selection'
          : 'paper'));
    return {
      phase:
        event.type === 'pointerdown'
          ? 'down'
          : event.type === 'pointerup'
            ? 'up'
            : event.type === 'pointercancel'
              ? 'cancel'
              : 'move',
      pointerId: event.pointerId,
      device: source,
      targetRole,
      screen: { x, y },
      timestamp: event.timeStamp,
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      },
    };
  }
  function pointer(event: PointerEvent) {
    if (destroyed || seen.has(event)) return;
    seen.add(event);
    const input = normalize(event);
    if (!input || (input.phase === 'down' && event.button !== 0)) return;
    events.set(input.pointerId, event);
    dispatch({
      type: 'pointer',
      input,
      policy: controller.getSnapshot('input'),
      panTool: controller.getSnapshot('tools').activeTool === 'pan',
    });
    if (input.phase === 'up' || input.phase === 'cancel') events.delete(input.pointerId);
  }
  const reset = () => dispatch({ type: 'reset' });
  const hidden = () => {
    if (host.ownerDocument.visibilityState === 'hidden') reset();
  };
  const stopInput = controller.subscribe('input', () => {
    const next = controller.getSnapshot('input').mode;
    if (mode !== next) {
      mode = next;
      reset();
    }
  });
  const stopTools = controller.subscribe('tools', reset);
  host.addEventListener('pointerdown', pointer);
  view.addEventListener('pointermove', pointer, true);
  view.addEventListener('pointerup', pointer, true);
  view.addEventListener('pointercancel', pointer, true);
  view.addEventListener('blur', reset);
  view.addEventListener('pagehide', reset);
  host.ownerDocument.addEventListener('visibilitychange', hidden);
  return {
    destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      stopInput();
      stopTools();
      host.removeEventListener('pointerdown', pointer);
      view.removeEventListener('pointermove', pointer, true);
      view.removeEventListener('pointerup', pointer, true);
      view.removeEventListener('pointercancel', pointer, true);
      view.removeEventListener('blur', reset);
      view.removeEventListener('pagehide', reset);
      host.ownerDocument.removeEventListener('visibilitychange', hidden);
      events.clear();
    },
  };
}
