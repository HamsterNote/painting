import { createPointerInputController } from '../pointerInputController';

function pointerEvent(type: string, pointerId: number): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
  });
  return event;
}

describe('createPointerInputController', () => {
  it('tracks active pointer count', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const controller = createPointerInputController(element);

    expect(controller.getActivePointerCount()).toBe(0);

    element.dispatchEvent(pointerEvent('pointerdown', 1));
    element.dispatchEvent(pointerEvent('pointerdown', 2));

    expect(controller.getActivePointerCount()).toBe(2);

    document.dispatchEvent(pointerEvent('pointerup', 1));

    expect(controller.getActivePointerCount()).toBe(1);

    controller.destroy();
    expect(controller.getActivePointerCount()).toBe(0);
    element.remove();
  });
});
