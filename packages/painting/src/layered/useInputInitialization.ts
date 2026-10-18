import { useEffect, useState } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import type { WebFreehandPolicy } from '../input/web/freehandWebAdapter';
import { readInputModePreference } from './inputModePreference';

/** SSR emits no interactive controls; restoration precedes client input listeners. */
export function useInputInitialization(
  controller: LayeredEditorController,
  policy?: WebFreehandPolicy,
  surface = false
) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const stored = readInputModePreference();
    if (stored !== undefined || surface) {
      const hint = policy?.touch === 'draw' ? 'finger' : policy?.touch === 'none' ? 'pen' : 'auto';
      controller.initializeInputMode(stored ?? hint);
    }
    setReady(true);
  }, [controller, policy, surface]);
  return ready;
}
