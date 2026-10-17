/** @jest-environment node */

import { createNativeInputAdapter } from '../nativeInputAdapter';
import type { NativeTouchEvent } from '../nativeInputAdapter';
import type { NormalizedPointerInput } from '../../../core';

function event(
  eventType: NativeTouchEvent['eventType'],
  pointerType: string,
  changedTouches: readonly { id: string | number; x: number; y: number }[]
): NativeTouchEvent {
  return { eventType, pointerType, changedTouches };
}

describe('createNativeInputAdapter', () => {
  let received: NormalizedPointerInput[];

  beforeEach(() => {
    received = [];
  });

  it.each([
    [1, 'TOUCH', 'down', 'touch'],
    ['TOUCHES_MOVE', 'STYLUS', 'move', 'pen'],
    [3, 'MOUSE', 'up', 'mouse'],
    ['TOUCHES_CANCELLED', 'touch', 'cancel', 'touch'],
  ] as const)('maps RNGH %s and %s to core %s/%s', (eventType, pointerType, phase, device) => {
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: () => 'paper',
      now: () => 10,
    });

    // 非 down 不能自行打开；预先 down 后只断言本案例产生的最后一个生命周期样本。
    if (phase !== 'down') {
      adapter.handleTouches(event(1, pointerType, [{ id: 1, x: 0, y: 0 }]));
    }
    adapter.handleTouches(event(eventType, pointerType, [{ id: 1, x: 4, y: 5 }]));

    expect(received.at(-1)).toMatchObject({ phase, pointerId: 1, device, screen: { x: 4, y: 5 } });
    adapter.destroy();
  });

  it('converts only view-local x/y to host-local DIP and supplies fixed native modifiers', () => {
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: (point) => (point.x === 12 && point.y === 23 ? 'paper' : 'none'),
      toHostLocal: (point) => ({ x: point.x + 10, y: point.y + 20 }),
      now: () => 99,
    });

    adapter.handleTouches(event(1, 'TOUCH', [{ id: 1, x: 2, y: 3 }]));

    expect(received).toEqual([
      expect.objectContaining({
        screen: { x: 12, y: 23 },
        timestamp: 99,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
        targetRole: 'paper',
      }),
    ]);
    adapter.destroy();
  });

  it('rejects unknown input devices and makes invalid resolver values explicit none', () => {
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: () => 'invalid-role' as never,
    });

    adapter.handleTouches(event(1, 'KEY', [{ id: 1, x: 0, y: 0 }]));
    adapter.handleTouches(event(1, 'OTHER', [{ id: 2, x: 0, y: 0 }]));
    adapter.handleTouches(event(1, 'trackpad', [{ id: 3, x: 0, y: 0 }]));
    adapter.handleTouches(event(1, 'touch', [{ id: 4, x: 0, y: 0 }]));

    expect(received).toEqual([expect.objectContaining({ pointerId: 4, targetRole: 'none' })]);
    expect(adapter.getActivePointerIds()).toEqual([4]);
    adapter.destroy();
  });

  it('tracks changed touches by ID rather than array position and locks each down role and device', () => {
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: (point) => (point.x === 1 ? 'ruler' : 'paper'),
      now: () => 5,
    });

    adapter.handleTouches(
      event(1, 'TOUCH', [
        { id: 'a', x: 1, y: 1 },
        { id: 'b', x: 2, y: 2 },
      ])
    );
    adapter.handleTouches(
      event(2, 'STYLUS', [
        { id: 'b', x: 20, y: 2 },
        { id: 'a', x: 10, y: 1 },
      ])
    );
    adapter.handleTouches(
      event(3, 'MOUSE', [
        { id: 'a', x: 30, y: 1 },
        { id: 'b', x: 40, y: 2 },
      ])
    );

    expect(received).toEqual([
      expect.objectContaining({ phase: 'down', pointerId: 'a', targetRole: 'ruler', device: 'touch' }),
      expect.objectContaining({ phase: 'down', pointerId: 'b', targetRole: 'paper', device: 'touch' }),
      expect.objectContaining({ phase: 'move', pointerId: 'b', screen: { x: 20, y: 2 }, targetRole: 'paper', device: 'touch' }),
      expect.objectContaining({ phase: 'move', pointerId: 'a', screen: { x: 10, y: 1 }, targetRole: 'ruler', device: 'touch' }),
      expect.objectContaining({ phase: 'up', pointerId: 'a', screen: { x: 30, y: 1 }, targetRole: 'ruler', device: 'touch' }),
      expect.objectContaining({ phase: 'up', pointerId: 'b', screen: { x: 40, y: 2 }, targetRole: 'paper', device: 'touch' }),
    ]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });

  it('ignores duplicate downs and unordered closes without overwriting active ownership', () => {
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: () => 'selection',
    });

    adapter.handleTouches(event(1, 'TOUCH', [{ id: 1, x: 1, y: 1 }]));
    adapter.handleTouches(event(1, 'MOUSE', [{ id: 1, x: 2, y: 2 }]));
    adapter.handleTouches(event(3, 'TOUCH', [{ id: 2, x: 3, y: 3 }]));
    adapter.handleTouches(event(3, 'MOUSE', [{ id: 1, x: 4, y: 4 }]));
    adapter.handleTouches(event(4, 'MOUSE', [{ id: 1, x: 5, y: 5 }]));

    expect(received).toEqual([
      expect.objectContaining({ phase: 'down', device: 'touch', targetRole: 'selection' }),
      expect.objectContaining({ phase: 'up', device: 'touch', targetRole: 'selection', screen: { x: 4, y: 4 } }),
    ]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });

  it.each([
    [true, 5, 'up'],
    [true, 'END', 'up'],
    [false, 1, 'cancel'],
    [true, 'CANCELLED', 'cancel'],
  ] as const)('finalize(%s, %s) closes all remaining pointers as %s', (success, state, phase) => {
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: () => 'paper',
    });
    adapter.handleTouches(event(1, 'TOUCH', [{ id: 'one', x: 1, y: 2 }]));
    adapter.handleTouches(event(1, 'TOUCH', [{ id: 'two', x: 3, y: 4 }]));
    adapter.handleFinalize({ state }, success);
    adapter.handleFinalize({ state }, success);

    expect(received.slice(2)).toEqual([
      expect.objectContaining({ pointerId: 'one', phase, screen: { x: 1, y: 2 } }),
      expect.objectContaining({ pointerId: 'two', phase, screen: { x: 3, y: 4 } }),
    ]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });

  it('cancels all active inputs on destroy and refuses guard-invalid samples without mutating callbacks', () => {
    const source = event(1, 'TOUCH', [{ id: 1, x: 2, y: 3 }]);
    const adapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: () => 'paper',
      toHostLocal: (point) => (point.x === 2 ? { x: Number.NaN, y: point.y } : point),
    });

    adapter.handleTouches(source);
    expect(received).toEqual([]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    expect(source).toEqual(event(1, 'TOUCH', [{ id: 1, x: 2, y: 3 }]));

    const validAdapter = createNativeInputAdapter({
      onInput: (input) => received.push(input),
      resolveTargetRole: () => 'paper',
    });
    validAdapter.handleTouches(event(1, 'TOUCH', [{ id: 2, x: 4, y: 5 }]));
    validAdapter.destroy();
    validAdapter.destroy();

    expect(received).toEqual([
      expect.objectContaining({ phase: 'down', pointerId: 2 }),
      expect.objectContaining({ phase: 'cancel', pointerId: 2, screen: { x: 4, y: 5 } }),
    ]);
    expect(validAdapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });
});
