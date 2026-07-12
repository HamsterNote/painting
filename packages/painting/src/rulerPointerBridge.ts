import {
  buildPointerInteractionInput,
  classifyInteraction,
  type ClassifyInteractionOptions,
} from './interactionOwnership';
import { POINTER_DOWN_CAPTURE_OPTIONS } from './virtualPaperPointerCapture';

type MultiDragPointerDownBridge = {
  readonly handlePointerDown?: (event: PointerEvent) => void;
};

type MultiDragPointerDownBridgeRef = {
  readonly current: object | null;
};

type RulerPointerBridgeOptions = {
  readonly listenerTarget: EventTarget;
  readonly multiDragRef: MultiDragPointerDownBridgeRef;
  readonly getInteractionOwnerOptions: (
    input: ClassifyInteractionOptions['input'],
    activeTouchPointers?: number
  ) => ClassifyInteractionOptions;
};

function isPointerDomEvent(event: Event): event is PointerEvent {
  return event.type.startsWith('pointer');
}

export function installCapturePhaseRulerPointerBridge(
  options: RulerPointerBridgeOptions
): () => void {
  const handleRulerPointerDownBridge = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    const owner = classifyInteraction(
      options.getInteractionOwnerOptions(buildPointerInteractionInput(event))
    );
    if (owner !== 'ruler') {
      return;
    }
    // @system-ui-js/multi-drag exposes this runtime arrow property while
    // marking it private in declarations; the bridge must call the same
    // entrypoint before virtual-paper stops mouse pointerdown in bubble.
    const multiDrag = options.multiDragRef.current as object as MultiDragPointerDownBridge | null;
    multiDrag?.handlePointerDown?.(event);
  };
  const handleRulerPointerDownBridgeEvent: EventListener = (event) => {
    if (isPointerDomEvent(event)) {
      handleRulerPointerDownBridge(event);
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
