import { supersedesPrimaryPointer, type NormalizedPointerInput } from './input';
import {
  createPointerOwnershipState,
  reducePointerOwnership,
  type PointerOwnershipState,
} from './gesture/ownership';
import type { LayeredInputSnapshot } from './layeredInputMode';

type Pointer = NormalizedPointerInput;
export type LayeredInputGesture = Readonly<{
  kind: 'single-tool' | 'pen-tool' | 'single-pan' | 'touch-pair';
  ids: readonly (string | number)[];
}>;
type Target = 'tool' | 'navigation';
export type LayeredInputResetReason = 'policy' | 'lifecycle';
export type LayeredInputIntent =
  | { type: 'detect-pen' }
  | { type: 'cancel'; target: Target; reason?: LayeredInputResetReason }
  | { type: 'route'; target: Target; input: Pointer }
  | { type: 'begin-navigation'; pointers: readonly Pointer[] };
export type LayeredInputArbitration = Readonly<{
  ownership: PointerOwnershipState;
  contacts: readonly Pointer[];
  suppressed: readonly (string | number)[];
  draining: boolean;
  gesture?: LayeredInputGesture;
  pending?:
    | { gesture: LayeredInputGesture; input?: Pointer }
    | {
        restart: Extract<LayeredInputArbitrationEvent, { type: 'pointer' }>;
        retired: Pointer;
      };
}>;
export type LayeredInputArbitrationEvent =
  | { type: 'pointer'; input: Pointer; policy: LayeredInputSnapshot; panTool: boolean }
  | { type: 'cancel-result'; ok: boolean }
  | { type: 'reset'; reason?: LayeredInputResetReason };

export function createLayeredInputArbitration(): LayeredInputArbitration {
  return {
    ownership: createPointerOwnershipState(),
    contacts: [],
    suppressed: [],
    draining: false,
  };
}

function target(gesture: LayeredInputGesture): Target {
  return gesture.kind === 'single-pan' || gesture.kind === 'touch-pair' ? 'navigation' : 'tool';
}

/** Cancellation is a handshake: no navigation intent exists before an affirmative ACK. */
export function reduceLayeredInputArbitration(
  state: LayeredInputArbitration,
  event: LayeredInputArbitrationEvent
): { state: LayeredInputArbitration; intents: readonly LayeredInputIntent[] } {
  const intents: LayeredInputIntent[] = [];
  if (event.type === 'reset') {
    const reason = event.reason ?? 'policy';
    // Business transactions (staged shapes and the ruler) can outlive a pointer gesture.
    intents.push(
      { type: 'cancel', target: 'tool', reason },
      { type: 'cancel', target: 'navigation', reason }
    );
    return {
      state:
        reason === 'lifecycle'
          ? createLayeredInputArbitration()
          : {
              ...state,
              gesture: undefined,
              pending: undefined,
              draining: false,
              suppressed: state.contacts.map((p) => p.pointerId),
            },
      intents,
    };
  }
  if (event.type === 'cancel-result') {
    if (!state.pending) return { state, intents };
    const pending = state.pending;
    if ('restart' in pending) {
      // Keep ownership intact on a failed ACK. Never finish the old trajectory
      // with a new pointer, nor admit new input until cancellation succeeded.
      if (!event.ok) return { state, intents };
      const id = pending.retired.pointerId;
      return reduceLayeredInputArbitration(
        {
          ...state,
          ownership: reducePointerOwnership(state.ownership, {
            ...pending.retired,
            phase: 'cancel',
          }),
          contacts: state.contacts.filter((p) => p.pointerId !== id),
          suppressed: state.suppressed.filter((p) => p !== id),
          gesture: undefined,
          pending: undefined,
          draining: false,
        },
        pending.restart
      );
    }
    if (!event.ok) {
      return {
        state: {
          ...state,
          pending: undefined,
          suppressed: state.contacts
            .filter((p) => !state.gesture?.ids.includes(p.pointerId))
            .map((p) => p.pointerId),
        },
        intents,
      };
    }
    const ids = pending.gesture.ids;
    const suppressed = [
      ...state.suppressed,
      ...state.contacts.filter((p) => !ids.includes(p.pointerId)).map((p) => p.pointerId),
    ];
    if (pending.input) intents.push({ type: 'route', target: 'tool', input: pending.input });
    else
      intents.push({
        type: 'begin-navigation',
        pointers: ids.map((id) => state.contacts.find((p) => p.pointerId === id)!),
      });
    return {
      state: { ...state, pending: undefined, gesture: pending.gesture, suppressed },
      intents,
    };
  }
  const { input, policy, panTool } = event;
  if (
    input.phase === 'down' &&
    (!state.pending || 'restart' in state.pending) &&
    state.gesture?.ids.length === 1 &&
    (input.button === undefined || input.button === 0) &&
    (input.targetRole === 'paper' || input.targetRole === 'selection')
  ) {
    const retired = state.contacts.find((p) => p.pointerId === state.gesture!.ids[0]);
    if (retired && supersedesPrimaryPointer(retired, input)) {
      return {
        state: { ...state, pending: { restart: event, retired } },
        intents: [{ type: 'cancel', target: target(state.gesture) }],
      };
    }
  }
  // A failed recovery ACK leaves routing closed, including when the browser
  // reuses the same pointer ID. Retry cancellation on a fresh primary down;
  // new move/up must never finish the stale tool transaction.
  if (state.pending && 'restart' in state.pending) return { state, intents };
  const id = input.pointerId;
  const existing = state.contacts.find((p) => p.pointerId === id);
  const ownership = reducePointerOwnership(state.ownership, input);
  if (input.phase === 'down') {
    if (
      ownership === state.ownership ||
      (input.targetRole !== 'paper' && input.targetRole !== 'selection')
    )
      return { state: { ...state, ownership }, intents };
    const contacts = [...state.contacts, input];
    const next = { ...state, ownership, contacts };
    if (input.device === 'pen' && input.targetRole === 'paper')
      intents.push({ type: 'detect-pen' });
    if (state.pending || state.draining) {
      return { state: { ...next, suppressed: [...state.suppressed, id] }, intents };
    }
    const gesture = state.gesture;
    if (!gesture) {
      const kind =
        panTool || (input.device === 'touch' && policy.effectiveTouch === 'pan')
          ? 'single-pan'
          : input.device === 'pen'
            ? 'pen-tool'
            : 'single-tool';
      const started: LayeredInputGesture = { kind, ids: [id] };
      intents.push({ type: 'route', target: target(started), input });
      return { state: { ...next, gesture: started }, intents };
    }
    const first = state.contacts.find((p) => p.pointerId === gesture.ids[0])!;
    if (
      input.targetRole === 'paper' &&
      first.targetRole === 'paper' &&
      input.device === 'touch' &&
      first.device === 'touch' &&
      gesture.kind !== 'touch-pair'
    ) {
      const pair: LayeredInputGesture = { kind: 'touch-pair', ids: [first.pointerId, id] };
      if (target(gesture) === 'tool') {
        intents.push({ type: 'cancel', target: 'tool' });
        return { state: { ...next, pending: { gesture: pair } }, intents };
      }
      intents.push({ type: 'cancel', target: 'navigation' });
      return { state: { ...next, pending: { gesture: pair } }, intents };
    }
    if (input.device === 'pen' && first.device === 'touch' && gesture.kind === 'single-tool') {
      intents.push({ type: 'cancel', target: 'tool' });
      return {
        state: { ...next, pending: { gesture: { kind: 'pen-tool', ids: [id] }, input } },
        intents,
      };
    }
    return { state: { ...next, suppressed: [...state.suppressed, id] }, intents };
  }
  if (!existing) return { state: { ...state, ownership }, intents };
  if (existing.device !== input.device) return { state, intents };
  const ended = input.phase === 'up' || input.phase === 'cancel';
  // Capture and hit-target changes must not replace the role claimed on down.
  const contacts = ended
    ? state.contacts.filter((p) => p.pointerId !== id)
    : state.contacts.map((p) =>
        p.pointerId === id ? { ...input, targetRole: p.targetRole, isPrimary: p.isPrimary } : p
      );
  const next = { ...state, ownership, contacts };
  if (state.suppressed.includes(id)) {
    return {
      state: {
        ...next,
        draining: state.draining && contacts.length > 0,
        suppressed: ended ? state.suppressed.filter((p) => p !== id) : state.suppressed,
      },
      intents,
    };
  }
  if (state.gesture?.ids.includes(id)) {
    intents.push({ type: 'route', target: target(state.gesture), input });
    if (ended) {
      return {
        state: {
          ...next,
          gesture: undefined,
          pending: undefined,
          draining: contacts.length > 0,
          suppressed: contacts.map((p) => p.pointerId),
        },
        intents,
      };
    }
  }
  return { state: next, intents };
}
