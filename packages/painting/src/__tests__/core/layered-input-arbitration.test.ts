import {
  createLayeredInputArbitration,
  reduceLayeredInputArbitration,
} from '../../core/layeredInputArbitration';
import { createLayeredInputSnapshot } from '../../core/layeredInputMode';
import type { NormalizedPointerInput } from '../../core/input';

function pointer(
  id: number,
  phase: NormalizedPointerInput['phase'] = 'down',
  device: NormalizedPointerInput['device'] = 'touch',
  targetRole: NormalizedPointerInput['targetRole'] = 'paper'
): NormalizedPointerInput {
  return {
    pointerId: id,
    phase,
    device,
    targetRole,
    timestamp: 0,
    screen: { x: id * 10, y: 0 },
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
  };
}

function harness(mode: 'auto' | 'finger' | 'pen' = 'auto', penSeen = false) {
  let state = createLayeredInputArbitration();
  const dispatch = (input: NormalizedPointerInput) => {
    const result = reduceLayeredInputArbitration(state, {
      type: 'pointer',
      input,
      policy: createLayeredInputSnapshot(mode, penSeen),
      panTool: false,
    });
    state = result.state;
    return result.intents;
  };
  const ack = (ok: boolean) => {
    const result = reduceLayeredInputArbitration(state, { type: 'cancel-result', ok });
    state = result.state;
    return result.intents;
  };
  return { dispatch, ack, state: () => state };
}

test.each([
  ['auto', false, 'tool'],
  ['auto', true, 'navigation'],
  ['finger', true, 'tool'],
  ['pen', false, 'navigation'],
] as const)(
  '%s / latch %s routes one finger to %s and retains pair navigation',
  (mode, seen, expected) => {
    const h = harness(mode, seen);
    expect(h.dispatch(pointer(1))).toEqual([
      { type: 'route', target: expected, input: pointer(1) },
    ]);
    h.dispatch(pointer(1, 'move'));
    expect(h.dispatch(pointer(2))).toEqual([{ type: 'cancel', target: expected }]);
    expect(h.state().gesture?.kind).not.toBe('touch-pair');
    expect(h.ack(true)).toEqual([
      { type: 'begin-navigation', pointers: [pointer(1, 'move'), pointer(2)] },
    ]);
    expect(h.state().gesture?.kind).toBe('touch-pair');
  }
);

test('failed cancellation cannot begin navigation or route the second finger', () => {
  const h = harness();
  h.dispatch(pointer(1));
  h.dispatch(pointer(2));
  expect(h.ack(false)).toEqual([]);
  expect(h.state().gesture?.kind).toBe('single-tool');
  expect(h.dispatch(pointer(2, 'move'))).toEqual([]);
  expect(h.dispatch(pointer(1, 'up'))).toEqual([
    { type: 'route', target: 'tool', input: pointer(1, 'up') },
  ]);
});

test.each(['pen', 'touch'] as const)(
  'signed %s identity routes its own lifecycle only',
  (source) => {
    const h = harness();
    const id = source === 'pen' ? -765894345 : -765894343;
    const down = h.dispatch(pointer(id, 'down', source));
    expect(down).toEqual([
      ...(source === 'pen' ? [{ type: 'detect-pen' }] : []),
      { type: 'route', target: 'tool', input: pointer(id, 'down', source) },
    ]);
    expect(h.dispatch(pointer(-id, 'move', source))).toEqual([]);
    for (const phase of ['move', 'up'] as const) {
      expect(h.dispatch(pointer(id, phase, source))).toEqual([
        { type: 'route', target: 'tool', input: pointer(id, phase, source) },
      ]);
    }
    expect(h.state().ownership.active).toEqual([]);
  }
);

test('negative touch IDs cancel the single owner before forming the original pair', () => {
  const h = harness();
  const first = -765894343;
  const second = -765894342;
  h.dispatch(pointer(first));
  h.dispatch(pointer(first, 'move'));
  expect(h.dispatch(pointer(second))).toEqual([{ type: 'cancel', target: 'tool' }]);
  expect(h.ack(true)).toEqual([
    { type: 'begin-navigation', pointers: [pointer(first, 'move'), pointer(second)] },
  ]);
  expect(h.state().gesture?.ids).toEqual([first, second]);
  expect(h.dispatch(pointer(second, 'move'))).toEqual([
    { type: 'route', target: 'navigation', input: pointer(second, 'move') },
  ]);
});

test('first pen down preempts touch only after cancel ACK; late touch up cannot commit', () => {
  const h = harness();
  h.dispatch(pointer(1));
  expect(h.dispatch(pointer(2, 'down', 'pen'))).toEqual([
    { type: 'detect-pen' },
    { type: 'cancel', target: 'tool' },
  ]);
  expect(h.ack(true)).toEqual([
    { type: 'route', target: 'tool', input: pointer(2, 'down', 'pen') },
  ]);
  expect(h.dispatch(pointer(1, 'up'))).toEqual([]);
  expect(h.dispatch(pointer(2, 'up', 'pen'))).toEqual([
    { type: 'route', target: 'tool', input: pointer(2, 'up', 'pen') },
  ]);
});

test('pen suppresses palms through pen end until all contacts drain', () => {
  const h = harness();
  expect(h.dispatch(pointer(1, 'down', 'pen')).map((i) => i.type)).toEqual(['detect-pen', 'route']);
  expect(h.dispatch(pointer(2))).toEqual([]);
  expect(h.dispatch(pointer(3))).toEqual([]);
  h.dispatch(pointer(1, 'up', 'pen'));
  expect(h.dispatch(pointer(2, 'move'))).toEqual([]);
  h.dispatch(pointer(2, 'up'));
  h.dispatch(pointer(3, 'up'));
  expect(h.dispatch(pointer(4)).map((i) => i.type)).toEqual(['route']);
  h.dispatch(pointer(5));
  expect(h.ack(true)[0]?.type).toBe('begin-navigation');
});

test('pair keeps ownership when pen or third finger arrives and never substitutes survivors', () => {
  const h = harness();
  h.dispatch(pointer(1));
  h.dispatch(pointer(2));
  h.ack(true);
  expect(h.dispatch(pointer(3, 'down', 'pen'))).toEqual([{ type: 'detect-pen' }]);
  expect(h.dispatch(pointer(4))).toEqual([]);
  expect(h.state().gesture?.ids).toEqual([1, 2]);
  h.dispatch(pointer(1, 'up'));
  expect(h.dispatch(pointer(2, 'move'))).toEqual([]);
  expect(h.dispatch(pointer(4, 'move'))).toEqual([]);
  h.dispatch(pointer(2, 'up'));
  h.dispatch(pointer(3, 'up', 'pen'));
  h.dispatch(pointer(4, 'up'));
  expect(h.dispatch(pointer(5, 'down', 'pen')).map((i) => i.type)).toEqual(['detect-pen', 'route']);
});

test('controls and ruler do not mix with paper; selection handles retain their owner', () => {
  const h = harness();
  expect(h.dispatch(pointer(10, 'down', 'pen', 'safe-control'))).toEqual([]);
  expect(h.dispatch(pointer(11, 'down', 'touch', 'ruler'))).toEqual([]);
  h.dispatch(pointer(1));
  expect(h.state().gesture?.ids).toEqual([1]);
  h.dispatch(pointer(11, 'up', 'touch', 'ruler'));
  expect(h.state().ownership.active.some((p) => p.pointerId === 11)).toBe(false);
  h.dispatch(pointer(1, 'up'));
  h.dispatch(pointer(2, 'down', 'touch', 'selection'));
  h.dispatch(pointer(2, 'move', 'touch', 'paper'));
  expect(h.state().contacts[0].targetRole).toBe('selection');
  expect(h.dispatch(pointer(3))).toEqual([]);
  expect(h.state().gesture?.ids).toEqual([2]);
  expect(h.dispatch(pointer(2, 'up'))).toEqual([
    { type: 'route', target: 'tool', input: pointer(2, 'up') },
  ]);
});

test.each(['selection', 'ruler', 'safe-control'] as const)(
  'paper contact crossing %s retains its down role and still forms a paper pair',
  (role) => {
    const h = harness();
    h.dispatch(pointer(1));
    h.dispatch(pointer(1, 'move', 'touch', role));
    expect(h.state().contacts[0]).toEqual(pointer(1, 'move'));
    expect(h.dispatch(pointer(2))).toEqual([{ type: 'cancel', target: 'tool' }]);
    expect(h.ack(true)).toEqual([
      { type: 'begin-navigation', pointers: [pointer(1, 'move'), pointer(2)] },
    ]);
    expect(h.dispatch(pointer(2, 'move'))).toEqual([
      { type: 'route', target: 'navigation', input: pointer(2, 'move') },
    ]);
  }
);

test('policy reset cancels business transactions and isolates old contacts without replay', () => {
  const h = harness();
  h.dispatch(pointer(1));
  const reset = reduceLayeredInputArbitration(h.state(), { type: 'reset' });
  expect(reset.intents).toEqual([
    { type: 'cancel', target: 'tool', reason: 'policy' },
    { type: 'cancel', target: 'navigation', reason: 'policy' },
  ]);
  expect(reset.state.gesture).toBeUndefined();
  expect(reset.state.suppressed).toEqual([1]);
});

test('lifecycle reset drops ownership without waiting for missing terminal events', () => {
  const h = harness();
  h.dispatch(pointer(1));
  const reset = reduceLayeredInputArbitration(h.state(), { type: 'reset', reason: 'lifecycle' });
  expect(reset.state).toEqual(createLayeredInputArbitration());
  expect(reset.intents.map((intent) => intent.type)).toEqual(['cancel', 'cancel']);
  const next = reduceLayeredInputArbitration(reset.state, {
    type: 'pointer',
    input: pointer(1),
    policy: createLayeredInputSnapshot('auto', false),
    panTool: false,
  });
  expect(next.intents).toEqual([{ type: 'route', target: 'tool', input: pointer(1) }]);
});
