import { installCapturePhaseRulerPointerBridge } from '../rulerPointerBridge';

function createPointerEvent(
  pointerType: 'mouse' | 'touch' | 'pen',
): Event {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: 10 },
    clientY: { value: 20 },
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
  });

  return event;
}

describe('installCapturePhaseRulerPointerBridge', () => {
  it.each(['mouse', 'touch', 'pen'] as const)(
    'forwards %s pointerdown events to the ruler ingress before bubble handlers stop them',
    (pointerType) => {
      const listenerTarget = document.createElement('div');
      const rulerTarget = document.createElement('div');
      rulerTarget.setAttribute('data-testid', 'drawing-ruler');
      listenerTarget.appendChild(rulerTarget);

      const onPointerDown = jest.fn();
      const dispose = installCapturePhaseRulerPointerBridge({
        listenerTarget,
        onPointerDown,
      });

      rulerTarget.dispatchEvent(createPointerEvent(pointerType));

      expect(onPointerDown).toHaveBeenCalledTimes(1);

      dispose();
    }
  );

  it('ignores a plain Event that only uses the pointerdown event name', () => {
    const listenerTarget = document.createElement('div');
    const onPointerDown = jest.fn();
    const dispose = installCapturePhaseRulerPointerBridge({ listenerTarget, onPointerDown });

    listenerTarget.dispatchEvent(new Event('pointerdown'));

    expect(onPointerDown).not.toHaveBeenCalled();
    dispose();
  });
});
