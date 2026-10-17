import { normalizePointerInput } from '../normalizePointerInput';
import { resolveTargetRole } from '../resolveTargetRole';

function pointerEvent(
  type: string,
  target: EventTarget,
  overrides: Record<string, unknown> = {}
): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    target: { value: target },
    pointerType: { value: 'pen' },
    clientX: { value: 32 },
    clientY: { value: 48 },
    timeStamp: { value: 123 },
    pressure: { value: 0.5 },
    button: { value: 0 },
    buttons: { value: 1 },
    altKey: { value: true },
    ctrlKey: { value: false },
    metaKey: { value: true },
    shiftKey: { value: false },
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { value }])),
  });
  return event;
}

describe('normalizePointerInput', () => {
  it('uses host content-box coordinates and emits all modifiers without mutating the event', () => {
    const host = document.createElement('div');
    const event = pointerEvent('pointerdown', host);
    const before = {
      pointerType: event.pointerType,
      clientX: event.clientX,
      pressure: event.pressure,
    };
    Object.defineProperties(host, {
      clientLeft: { value: 2 },
      clientTop: { value: 3 },
    });
    host.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;

    expect(normalizePointerInput(event, { host })).toEqual({
      phase: 'down',
      pointerId: 7,
      device: 'pen',
      screen: { x: 20, y: 25 },
      timestamp: 123,
      modifiers: { alt: true, ctrl: false, meta: true, shift: false },
      pressure: 0.5,
      button: 0,
      buttons: 1,
      targetRole: 'paper',
    });
    expect({
      pointerType: event.pointerType,
      clientX: event.clientX,
      pressure: event.pressure,
    }).toEqual(before);
  });

  it('rejects unsupported pointer events and uses injected time only for invalid event timestamps', () => {
    const host = document.createElement('div');

    expect(
      normalizePointerInput(pointerEvent('pointerdown', host, { pointerType: 'trackpad' }), {
        host,
      })
    ).toBeNull();
    expect(normalizePointerInput(pointerEvent('wheel', host), { host })).toBeNull();
    expect(
      normalizePointerInput(pointerEvent('pointermove', host, { timeStamp: NaN }), {
        host,
        now: () => 456,
      })
    ).toMatchObject({ phase: 'move', timestamp: 456 });
    expect(
      normalizePointerInput(pointerEvent('pointerdown', host), {
        host,
        resolveTargetRole: () => 'not-a-core-role' as never,
      })
    ).toMatchObject({ targetRole: 'none' });
  });

  it('accepts explicit host-local point, role, and lifecycle phase for legacy capture seams', () => {
    const host = document.createElement('div');
    const move = pointerEvent('pointermove', host, {
      pointerType: 'mouse',
      button: -1,
      buttons: 1,
      altKey: undefined,
      ctrlKey: undefined,
      metaKey: undefined,
      shiftKey: undefined,
    });

    expect(
      normalizePointerInput(move, {
        host,
        point: { x: 12, y: 34 },
        phase: 'cancel',
        targetRole: 'ruler',
      })
    ).toEqual({
      phase: 'cancel',
      pointerId: 7,
      device: 'mouse',
      screen: { x: 12, y: 34 },
      timestamp: 123,
      modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      pressure: 0.5,
      buttons: 1,
      targetRole: 'ruler',
    });
    expect(normalizePointerInput(move, { host, point: { x: Number.NaN, y: 0 } })).toBeNull();
  });

  it('gives ruler, selection, and safe controls their fixed role precedence', () => {
    const host = document.createElement('div');
    const ruler = document.createElement('button');
    ruler.dataset.testid = 'drawing-ruler';
    const selection = document.createElement('button');
    selection.dataset.lassoResizeHandle = 'se';
    const control = document.createElement('button');
    const paper = document.createElement('div');
    const outside = document.createElement('div');
    host.append(ruler, selection, control, paper);

    expect(resolveTargetRole(ruler, host)).toBe('ruler');
    expect(resolveTargetRole(selection, host)).toBe('selection');
    expect(resolveTargetRole(control, host)).toBe('safe-control');
    expect(resolveTargetRole(paper, host)).toBe('paper');
    expect(resolveTargetRole(outside, host)).toBe('none');
    expect(resolveTargetRole(document.createTextNode('x'), host)).toBe('none');
  });
});
