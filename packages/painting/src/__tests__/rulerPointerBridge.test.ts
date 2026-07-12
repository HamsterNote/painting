import { installCapturePhaseRulerPointerBridge } from '../rulerPointerBridge';

function createPointerEvent(
  pointerType: 'mouse' | 'touch' | 'pen',
): Event {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    button: { value: 0 },
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
  });

  return event;
}

describe('installCapturePhaseRulerPointerBridge', () => {
  it.each(['mouse', 'touch', 'pen'] as const)(
    'forwards %s ruler pointerdown events into multi-drag before bubble handlers stop them',
    (pointerType) => {
      const listenerTarget = document.createElement('div');
      const rulerTarget = document.createElement('div');
      rulerTarget.setAttribute('data-testid', 'drawing-ruler');
      listenerTarget.appendChild(rulerTarget);

      const handlePointerDown = jest.fn();
      const dispose = installCapturePhaseRulerPointerBridge({
        listenerTarget,
        multiDragRef: { current: { handlePointerDown } },
        getInteractionOwnerOptions: (input) => ({
          input,
          isDrawingEnabled: true,
          isRulerEnabled: true,
          virtualPaperEnabled: true,
          allowedDrawingInputMethods: ['mouse', 'touch', 'pen'],
          activeTouchPointers: pointerType === 'touch' ? 2 : 1,
        }),
      });

      rulerTarget.dispatchEvent(createPointerEvent(pointerType));

      expect(handlePointerDown).toHaveBeenCalledTimes(1);

      dispose();
    }
  );
});
