/** @jest-environment node */

import {
  createPointerOwnershipState,
  getActivePointerCount,
  getActivePointerIds,
  getPointerOwner,
  reducePointerOwnership,
  snapshotPointerOwnership,
} from '../../core';
import type { InputPhase, NormalizedPointerInput, TargetRole } from '../../core';

function input(
  pointerId: string | number,
  phase: InputPhase,
  targetRole: TargetRole = 'paper'
): NormalizedPointerInput {
  return {
    pointerId,
    phase,
    targetRole,
    device: 'touch',
    screen: { x: 0, y: 0 },
    timestamp: 0,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
  };
}

describe('core/gesture/ownership', () => {
  it('locks a pointer to its down target despite later cross-target moves', () => {
    const down = reducePointerOwnership(createPointerOwnershipState(), input('paper-1', 'down', 'paper'));
    const moved = reducePointerOwnership(down, input('paper-1', 'move', 'ruler'));

    expect(getPointerOwner(moved, 'paper-1')).toBe('paper');
    expect(getActivePointerIds(moved, 'paper')).toEqual(['paper-1']);
    expect(getActivePointerIds(moved, 'ruler')).toEqual([]);
  });

  it('keeps same-owner and cross-owner pointers independent, excluding ruler from paper counts', () => {
    const state = [
      input('paper-1', 'down', 'paper'),
      input('paper-2', 'down', 'paper'),
      input('ruler-1', 'down', 'ruler'),
      input('ruler-2', 'down', 'ruler'),
    ].reduce(reducePointerOwnership, createPointerOwnershipState());

    expect(getActivePointerIds(state, 'paper')).toEqual(['paper-1', 'paper-2']);
    expect(getActivePointerCount(state, 'paper')).toBe(2);
    expect(getActivePointerIds(state, 'ruler')).toEqual(['ruler-1', 'ruler-2']);
    expect(getActivePointerCount(state, 'ruler')).toBe(2);
  });

  it('does not give paper ownership to safe controls or empty hit targets', () => {
    const state = [input('control', 'down', 'safe-control'), input('empty', 'down', 'none')].reduce(
      reducePointerOwnership,
      createPointerOwnershipState()
    );

    expect(getPointerOwner(state, 'control')).toBeUndefined();
    expect(getPointerOwner(state, 'empty')).toBeUndefined();
    expect(getActivePointerCount(state, 'paper')).toBe(0);
  });

  it('safely ignores unknown lifecycle events and duplicate down without duplicating ownership', () => {
    const empty = createPointerOwnershipState();
    const unknownMove = reducePointerOwnership(empty, input('missing', 'move', 'paper'));
    const unknownUp = reducePointerOwnership(empty, input('missing', 'up', 'paper'));
    const unknownCancel = reducePointerOwnership(empty, input('missing', 'cancel', 'paper'));
    const owned = reducePointerOwnership(empty, input('one', 'down', 'paper'));
    const duplicateDown = reducePointerOwnership(owned, input('one', 'down', 'ruler'));

    expect(unknownMove).toBe(empty);
    expect(unknownUp).toBe(empty);
    expect(unknownCancel).toBe(empty);
    expect(duplicateDown).toBe(owned);
    expect(getActivePointerIds(duplicateDown, 'paper')).toEqual(['one']);
    expect(getActivePointerCount(duplicateDown, 'ruler')).toBe(0);
  });

  it('cleans a known pointer on up or cancel while preserving other owners', () => {
    const initial = [input('paper', 'down', 'paper'), input('selection', 'down', 'selection')].reduce(
      reducePointerOwnership,
      createPointerOwnershipState()
    );
    const afterUp = reducePointerOwnership(initial, input('paper', 'up', 'ruler'));
    const afterCancel = reducePointerOwnership(afterUp, input('selection', 'cancel', 'paper'));

    expect(getActivePointerCount(afterUp, 'paper')).toBe(0);
    expect(getPointerOwner(afterUp, 'selection')).toBe('selection');
    expect(afterCancel.active).toEqual([]);
  });

  it('preserves down order and returns an independent immutable snapshot for later paper arbitration', () => {
    const state = [
      input('paper-first', 'down', 'paper'),
      input('ruler', 'down', 'ruler'),
      input('paper-second', 'down', 'paper'),
    ].reduce(reducePointerOwnership, createPointerOwnershipState());
    const snapshot = snapshotPointerOwnership(state);
    const afterRelease = reducePointerOwnership(state, input('paper-first', 'up'));

    expect(snapshot.active).toEqual([
      { pointerId: 'paper-first', owner: 'paper', downOrder: 0 },
      { pointerId: 'ruler', owner: 'ruler', downOrder: 1 },
      { pointerId: 'paper-second', owner: 'paper', downOrder: 2 },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.active)).toBe(true);
    expect(Object.isFrozen(snapshot.active[0])).toBe(true);
    expect(snapshot.active).not.toBe(state.active);
    expect(afterRelease.active.map(({ pointerId }) => pointerId)).toEqual(['ruler', 'paper-second']);
    expect(snapshot.active.map(({ pointerId }) => pointerId)).toEqual(['paper-first', 'ruler', 'paper-second']);
  });
});
