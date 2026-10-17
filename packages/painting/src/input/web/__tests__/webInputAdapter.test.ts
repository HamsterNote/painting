import { createWebInputAdapter } from '../webInputAdapter';
import type { NormalizedPointerInput } from '../../../core/internal';

function pointerEvent(
  type: string,
  pointerId: number,
  overrides: Record<string, unknown> = {}
): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
    clientX: { value: 10 },
    clientY: { value: 20 },
    timeStamp: { value: 100 },
    pressure: { value: 0.5 },
    button: { value: 0 },
    buttons: { value: 1 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { value }])),
  });
  return event;
}

describe('createWebInputAdapter', () => {
  let host: HTMLDivElement;
  let received: NormalizedPointerInput[];
  let captures: number[];
  let releases: number[];

  beforeEach(() => {
    host = document.createElement('div');
    received = [];
    captures = [];
    releases = [];
    host.setPointerCapture = jest.fn((pointerId: number) => captures.push(pointerId));
    host.releasePointerCapture = jest.fn((pointerId: number) => releases.push(pointerId));
    host.hasPointerCapture = jest.fn(() => true);
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('activates only valid downs, captures them, forwards their lifecycle, and releases on up', () => {
    const adapter = createWebInputAdapter({ host, onInput: (input) => received.push(input) });
    const invalidDown = pointerEvent('pointerdown', 1, { pointerType: 'trackpad' });
    const down = pointerEvent('pointerdown', 2);
    const move = pointerEvent('pointermove', 2, { clientX: 30 });
    const up = pointerEvent('pointerup', 2, { clientX: 40 });

    host.dispatchEvent(invalidDown);
    host.dispatchEvent(down);
    host.dispatchEvent(move);
    host.dispatchEvent(up);

    expect(received.map((input) => input.phase)).toEqual(['down', 'move', 'up']);
    expect(received[1].screen.x).toBe(30);
    expect(captures).toEqual([2]);
    expect(releases).toEqual([2]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });

  it('ends pointercancel lifecycles and releases capture', () => {
    const adapter = createWebInputAdapter({ host, onInput: (input) => received.push(input) });
    host.dispatchEvent(pointerEvent('pointerdown', 9));
    host.dispatchEvent(pointerEvent('pointercancel', 9));

    expect(received.map((input) => input.phase)).toEqual(['down', 'cancel']);
    expect(releases).toEqual([9]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });

  it('uses the last normalized sample to cancel after lost capture and window blur', () => {
    const adapter = createWebInputAdapter({ host, onInput: (input) => received.push(input) });
    host.dispatchEvent(pointerEvent('pointerdown', 1, { clientX: 12 }));
    host.dispatchEvent(pointerEvent('pointermove', 1, { clientX: 18 }));
    host.dispatchEvent(pointerEvent('lostpointercapture', 1));
    host.dispatchEvent(pointerEvent('pointerdown', 2));
    host.dispatchEvent(pointerEvent('pointerdown', 3));
    window.dispatchEvent(new Event('blur'));

    expect(received.filter((input) => input.phase === 'cancel')).toEqual([
      expect.objectContaining({ pointerId: 1, screen: { x: 18, y: 20 } }),
      expect.objectContaining({ pointerId: 2, screen: { x: 10, y: 20 } }),
      expect.objectContaining({ pointerId: 3, screen: { x: 10, y: 20 } }),
    ]);
    expect(adapter.getActivePointerIds()).toEqual([]);
    adapter.destroy();
  });

  it('cancels active pointers before destroy and never changes dispatched browser events', () => {
    const adapter = createWebInputAdapter({ host, onInput: (input) => received.push(input) });
    const down = pointerEvent('pointerdown', 1, { pressure: 0.8 });
    host.dispatchEvent(down);
    adapter.destroy();
    host.dispatchEvent(pointerEvent('pointermove', 1));

    expect(received.map((input) => input.phase)).toEqual(['down', 'cancel']);
    expect(received[1]).toMatchObject({ pointerId: 1, pressure: 0.8 });
    expect(down.pressure).toBe(0.8);
    expect(adapter.getActivePointerIds()).toEqual([]);
  });
});
