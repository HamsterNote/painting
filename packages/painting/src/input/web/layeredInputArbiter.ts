import type { LayeredEditorController } from '../../core/layeredEditorController';
import type { NormalizedPointerInput, TargetRole } from '../../core/input';
import {
  createLayeredInputArbitration,
  reduceLayeredInputArbitration,
  type LayeredInputArbitrationEvent,
  type LayeredInputIntent,
  type LayeredInputResetReason,
} from '../../core/layeredInputArbitration';

export type LayeredInputPort = {
  dispatch(event: PointerEvent): void;
  cancel(reason?: LayeredInputResetReason): boolean;
};

export function createLayeredInputArbiter(options: {
  host: HTMLElement;
  controller: LayeredEditorController;
  tool: LayeredInputPort;
  navigation: LayeredInputPort & { begin(events: readonly PointerEvent[]): void };
  targetRole?: (event: PointerEvent) => TargetRole | undefined;
  onDiagnostic?: (message: string) => void;
}) {
  const { host, controller, tool, navigation } = options;
  const view = host.ownerDocument.defaultView!;
  const events = new Map<string | number, PointerEvent>();
  const seen = new WeakSet<Event>();
  let state = createLayeredInputArbitration();
  let destroyed = false;
  let mode = controller.getSnapshot('input').mode;
  let activeTool = controller.getSnapshot('tools').activeTool;
  let native: { input: NormalizedPointerInput; cancel: () => boolean; owned: boolean } | undefined;

  function execute(intents: readonly LayeredInputIntent[]) {
    for (const intent of intents) {
      if (intent.type === 'detect-pen') {
        if (!native || native.owned) controller.recordPenDown();
      } else if (intent.type === 'cancel') {
        const ok =
          intent.target === 'tool' && native?.owned
            ? native.cancel()
            : (intent.target === 'tool' ? tool : navigation).cancel(intent.reason);
        if (intent.target === 'tool' && native) native.owned = false;
        if (!ok) options.onDiagnostic?.('Input cancellation failed; navigation refused');
        dispatch({ type: 'cancel-result', ok });
      } else if (intent.type === 'begin-navigation') {
        navigation.begin(intent.pointers.map((p) => events.get(p.pointerId)!));
      } else {
        if (intent.target === 'tool' && intent.input.pointerId === native?.input.pointerId) {
          native.owned = intent.input.phase === 'down';
          continue;
        }
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
  const reset = (reason: LayeredInputResetReason = 'policy') => {
    events.clear();
    dispatch({ type: 'reset', reason });
  };
  const interrupt = () => reset('lifecycle');
  const hidden = () => {
    if (host.ownerDocument.visibilityState === 'hidden') interrupt();
  };
  const stopInput = controller.subscribe('input', () => {
    const next = controller.getSnapshot('input').mode;
    if (mode !== next) {
      mode = next;
      reset();
    }
  });
  const stopTools = controller.subscribe('tools', () => {
    const next = controller.getSnapshot('tools').activeTool;
    if (next !== activeTool) {
      activeTool = next;
      reset();
    }
  });
  host.addEventListener('pointerdown', pointer);
  view.addEventListener('pointermove', pointer, true);
  view.addEventListener('pointerup', pointer, true);
  view.addEventListener('pointercancel', pointer, true);
  view.addEventListener('blur', interrupt);
  view.addEventListener('pagehide', interrupt);
  host.ownerDocument.addEventListener('visibilitychange', hidden);
  return {
    // Feed normalized ownership only; never construct or dispatch synthetic DOM events.
    claimNativePencil(input: NormalizedPointerInput, cancel: () => boolean): boolean {
      if (destroyed || native || input.phase !== 'down' || input.device !== 'pen') return false;
      native = { input, cancel, owned: false };
      dispatch({ type: 'pointer', input, policy: controller.getSnapshot('input'), panTool: false });
      if (native?.owned) controller.recordPenDown();
      return native?.owned === true;
    },
    releaseNativePencil() {
      if (!native) return;
      const input = { ...native.input, phase: 'up' as const };
      dispatch({ type: 'pointer', input, policy: controller.getSnapshot('input'), panTool: false });
      native = undefined;
    },
    isWriting: () => state.gesture?.kind === 'single-tool' || state.gesture?.kind === 'pen-tool',
    destroy() {
      if (destroyed) return;
      interrupt();
      destroyed = true;
      stopInput();
      stopTools();
      host.removeEventListener('pointerdown', pointer);
      view.removeEventListener('pointermove', pointer, true);
      view.removeEventListener('pointerup', pointer, true);
      view.removeEventListener('pointercancel', pointer, true);
      view.removeEventListener('blur', interrupt);
      view.removeEventListener('pagehide', interrupt);
      host.ownerDocument.removeEventListener('visibilitychange', hidden);
      events.clear();
    },
  };
}
