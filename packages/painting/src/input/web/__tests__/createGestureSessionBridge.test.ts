/** @jest-environment node */

import { createGestureSession, type NormalizedPointerInput } from '../../../core';
import { createGestureSessionBridge } from '../createGestureSessionBridge';

const DOCUMENT = { schemaVersion: 2 as const, strokes: [] };

function input(pointerId: string, phase: NormalizedPointerInput['phase']): NormalizedPointerInput {
  return {
    phase,
    pointerId,
    device: 'pen',
    screen: { x: phase === 'move' ? 10 : 0, y: 0 },
    timestamp: 100,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    targetRole: 'paper',
  };
}

describe('createGestureSessionBridge', () => {
  it('forwards pen effects only when the core session commits on up', () => {
    const effects: unknown[][] = [];
    const bridge = createGestureSessionBridge({
      createSession: () => createGestureSession({ document: DOCUMENT }),
      onEffects: (next) => effects.push([...next]),
    });

    bridge.handleInput(input('pen', 'down'));
    bridge.handleInput(input('pen', 'move'));
    bridge.handleInput(input('pen', 'up'));

    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual([expect.objectContaining({ type: 'document-commit' })]);
    expect(bridge.getSession().document.strokes).toHaveLength(1);
  });

  it('does not emit a commit for cancel and reset cancels active inputs before replacing the session', () => {
    const effects: unknown[][] = [];
    const createSession = jest.fn(() => createGestureSession({ document: DOCUMENT }));
    const bridge = createGestureSessionBridge({
      createSession,
      onEffects: (next) => effects.push([...next]),
    });

    bridge.handleInput(input('cancelled', 'down'));
    bridge.handleInput(input('cancelled', 'move'));
    bridge.handleInput(input('cancelled', 'cancel'));
    expect(effects).toEqual([]);

    bridge.handleInput(input('reset', 'down'));
    bridge.handleInput(input('reset', 'move'));
    const active = bridge.getSession();
    bridge.reset();

    expect(active.ownership.active).toHaveLength(1);
    expect(bridge.getSession()).not.toBe(active);
    expect(bridge.getSession().ownership.active).toEqual([]);
    expect(bridge.getSession().document.strokes).toEqual([]);
    expect(effects).toEqual([]);
    expect(createSession).toHaveBeenCalledTimes(2);
  });
});
