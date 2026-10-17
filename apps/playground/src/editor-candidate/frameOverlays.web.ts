import type { DrawingFrame } from '@hamster-note/painting/core';
import type { SkiaOverlay, SkiaPoint } from '@hamster-note/painting/skia';

function localPoint(point: SkiaPoint, frame: DrawingFrame): SkiaPoint {
  return { x: point.x - frame.frameOrigin.x, y: point.y - frame.frameOrigin.y };
}

/** frame canvas 只接受 local world overlay；screen overlay 已是最终 DIP，绝不能二次变换。 */
export function rebaseOverlaysToFrame(
  overlays: readonly SkiaOverlay[],
  frame: DrawingFrame
): readonly SkiaOverlay[] {
  return overlays.map((overlay) => {
    if (overlay.space === 'screen') return overlay;
    if (overlay.kind === 'line') {
      return { ...overlay, from: localPoint(overlay.from, frame), to: localPoint(overlay.to, frame) };
    }
    if (overlay.kind === 'polyline') {
      return { ...overlay, points: overlay.points.map((point) => localPoint(point, frame)) };
    }
    if (overlay.kind === 'circle') {
      return { ...overlay, center: localPoint(overlay.center, frame) };
    }
    if (overlay.kind === 'rect') {
      return { ...overlay, origin: localPoint(overlay.origin, frame) };
    }
    return { ...overlay, origin: localPoint(overlay.origin, frame) };
  });
}
