import type React from 'react';
import type { NormalizedPointerInput, PointerPhase } from '@system-ui-js/multi-drag-core';

export function normalizePointerInput(
  event: React.PointerEvent<HTMLDivElement>,
  phase: PointerPhase
): NormalizedPointerInput {
  const nativeEvent = event.nativeEvent;
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType || 'mouse',
    phase,
    timestamp: event.timeStamp,
    point: {
      x: nativeEvent.offsetX,
      y: nativeEvent.offsetY,
    },
  };
}
