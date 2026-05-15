import type React from 'react';
import type { PointerPhase } from '@system-ui-js/multi-drag-core';

import { normalizePointerInput } from '../normalizePointerInput';

const PointerPhaseValue = {
  Start: 'start',
  Move: 'move',
  End: 'end',
  Cancel: 'cancel',
} as const;

describe('normalizePointerInput', () => {
  const makeEvent = (props: {
    offsetX: number;
    offsetY: number;
    pointerId?: number;
    pointerType?: string;
    timeStamp?: number;
  }) =>
    ({
      pointerId: props.pointerId ?? 0,
      pointerType: props.pointerType,
      timeStamp: props.timeStamp ?? 0,
      nativeEvent: { offsetX: props.offsetX, offsetY: props.offsetY },
    }) as unknown as React.PointerEvent<HTMLDivElement>;

  it('maps start phase', () => {
    const result = normalizePointerInput(
      makeEvent({
        offsetX: 10,
        offsetY: 20,
        pointerId: 1,
        pointerType: 'touch',
      }),
      PointerPhaseValue.Start as PointerPhase
    );

    expect(result.phase).toBe(PointerPhaseValue.Start);
    expect(result.point.x).toBe(10);
    expect(result.point.y).toBe(20);
    expect(result.pointerId).toBe(1);
    expect(result.pointerType).toBe('touch');
  });

  it('maps move phase', () => {
    const result = normalizePointerInput(
      makeEvent({ offsetX: 11, offsetY: 21, pointerId: 2, pointerType: 'pen' }),
      PointerPhaseValue.Move as PointerPhase
    );

    expect(result.phase).toBe(PointerPhaseValue.Move);
  });

  it('maps end phase', () => {
    const result = normalizePointerInput(
      makeEvent({ offsetX: 12, offsetY: 22, pointerId: 3, pointerType: 'mouse' }),
      PointerPhaseValue.End as PointerPhase
    );

    expect(result.phase).toBe(PointerPhaseValue.End);
  });

  it('maps cancel phase', () => {
    const result = normalizePointerInput(
      makeEvent({
        offsetX: 13,
        offsetY: 23,
        pointerId: 4,
        pointerType: 'touch',
      }),
      PointerPhaseValue.Cancel as PointerPhase
    );

    expect(result.phase).toBe(PointerPhaseValue.Cancel);
  });

  it('falls back pointerType to mouse when missing', () => {
    const result = normalizePointerInput(
      makeEvent({ offsetX: 1, offsetY: 2 }),
      PointerPhaseValue.Start as PointerPhase
    );

    expect(result.pointerType).toBe('mouse');
  });

  it('falls back identifier to 0 when missing', () => {
    const result = normalizePointerInput(
      makeEvent({ offsetX: 1, offsetY: 2 }),
      PointerPhaseValue.Start as PointerPhase
    );

    expect(result.pointerId).toBe(0);
  });
});
