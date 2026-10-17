/** @jest-environment node */

import { isNormalizedPointerInput } from '../../core';
import type { NormalizedPointerInput } from '../../core';

function input(overrides: Partial<NormalizedPointerInput> = {}): NormalizedPointerInput {
  return {
    phase: 'down',
    pointerId: 'pointer-1',
    device: 'pen',
    screen: { x: 12.5, y: -4 },
    timestamp: 100,
    modifiers: { alt: false, ctrl: false, meta: false, shift: true },
    targetRole: 'paper',
    ...overrides,
  };
}

describe('core/input', () => {
  it('describes a complete, immutable platform-neutral pointer sample', () => {
    const sample = Object.freeze(
      input({
        pointerId: 4,
        pressure: 0.75,
        button: 0,
        buttons: 1,
      })
    );
    const beforeValidation = JSON.parse(JSON.stringify(sample));

    expect(isNormalizedPointerInput(sample)).toBe(true);
    expect(sample).toEqual({
      phase: 'down',
      pointerId: 4,
      device: 'pen',
      screen: { x: 12.5, y: -4 },
      timestamp: 100,
      modifiers: { alt: false, ctrl: false, meta: false, shift: true },
      pressure: 0.75,
      button: 0,
      buttons: 1,
      targetRole: 'paper',
    });
    expect(sample).toEqual(beforeValidation);
  });

  it.each([
    ['unknown device', input({ device: 'trackpad' as never })],
    ['incomplete modifiers', { ...input(), modifiers: { alt: false, ctrl: false, meta: false } }],
    ['non-finite local DIP coordinate', input({ screen: { x: NaN, y: 0 } })],
    ['non-finite timestamp', input({ timestamp: Infinity })],
    ['out-of-range pressure', input({ pressure: 1.1 })],
    ['negative button bitfield', input({ buttons: -1 })],
    ['unknown target role', input({ targetRole: 'overlay' as never })],
  ])('rejects %s without coercing or guessing', (_reason, value) => {
    expect(isNormalizedPointerInput(value)).toBe(false);
  });
});
