import { useCallback, useSyncExternalStore } from 'react';
import type {
  LayeredEditorChannel,
  LayeredEditorController,
  LayeredEditorSnapshotMap,
} from '../core/layeredEditorController';

export function useEditorSnapshot<C extends Exclude<LayeredEditorChannel, 'interaction'>>(
  controller: LayeredEditorController,
  channel: C
): LayeredEditorSnapshotMap[C] {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(channel, listener),
    [controller, channel]
  );
  const getSnapshot = useCallback(() => controller.getSnapshot(channel), [controller, channel]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
