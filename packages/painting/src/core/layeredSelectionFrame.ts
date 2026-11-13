import type { AffineTransform, Bounds, EditorDocument } from '../model/document';
import { IDENTITY_TRANSFORM } from '../model/document';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';

/** UI-only session geometry. The document and undo stack never contain this state. */
export type LayeredSelectionFrame = Readonly<{
  sessionId: number;
  ids: readonly string[];
  bounds: Bounds;
  transform: AffineTransform;
}>;

export function createLayeredSelectionFrame(
  document: EditorDocument,
  ids: readonly string[],
  sessionId: number,
  cache: FreehandGeometryCache
): LayeredSelectionFrame | null {
  if (!ids.length) return null;
  cache.syncDocument(document);
  const selected = new Set(ids);
  const bounds = document.objects
    .filter((o) => selected.has(o.objectId))
    .map((o) => deriveLayeredWorldBounds(o, cache)?.visualWorldBounds);
  if (bounds.length !== ids.length || bounds.some((b) => !b)) return null;
  const frame = {
    minX: Math.min(...bounds.map((b) => b!.minX)),
    minY: Math.min(...bounds.map((b) => b!.minY)),
    maxX: Math.max(...bounds.map((b) => b!.maxX)),
    maxY: Math.max(...bounds.map((b) => b!.maxY)),
  };
  if (!Object.values(frame).every(Number.isFinite)) return null;
  // Preserve drag affordances for degenerate paths.
  if (frame.maxX - frame.minX < 1) {
    const x = (frame.minX + frame.maxX) / 2;
    frame.minX = x - 0.5;
    frame.maxX = x + 0.5;
  }
  if (frame.maxY - frame.minY < 1) {
    const y = (frame.minY + frame.maxY) / 2;
    frame.minY = y - 0.5;
    frame.maxY = y + 0.5;
  }
  return Object.freeze({
    sessionId,
    ids: Object.freeze([...ids]),
    bounds: Object.freeze(frame),
    transform: IDENTITY_TRANSFORM,
  });
}
