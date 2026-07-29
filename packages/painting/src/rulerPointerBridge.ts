import { POINTER_DOWN_CAPTURE_OPTIONS } from './virtualPaperPointerCapture';

type RulerPointerBridgeOptions = {
  readonly listenerTarget: EventTarget;
  readonly onPointerDown: (event: PointerEvent) => void;
};

function isPointerDomEvent(event: Event): event is PointerEvent {
  return (
    event.type === 'pointerdown' &&
    'button' in event &&
    'clientX' in event &&
    'clientY' in event &&
    'pointerId' in event &&
    'pointerType' in event &&
    typeof event.button === 'number' &&
    typeof event.clientX === 'number' &&
    typeof event.clientY === 'number' &&
    typeof event.pointerId === 'number' &&
    typeof event.pointerType === 'string'
  );
}

export function installCapturePhaseRulerPointerBridge(
  options: RulerPointerBridgeOptions
): () => void {
  const handleRulerPointerDownBridgeEvent: EventListener = (event) => {
    if (isPointerDomEvent(event)) {
      options.onPointerDown(event);
    }
  };

  options.listenerTarget.addEventListener(
    'pointerdown',
    handleRulerPointerDownBridgeEvent,
    POINTER_DOWN_CAPTURE_OPTIONS
  );
  return () => {
    options.listenerTarget.removeEventListener(
      'pointerdown',
      handleRulerPointerDownBridgeEvent,
      POINTER_DOWN_CAPTURE_OPTIONS
    );
  };
}
