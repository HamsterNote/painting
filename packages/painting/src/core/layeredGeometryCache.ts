import type { LayeredEditorController } from './layeredEditorController';
import type { EditorDocument } from '../model/document';
import { FreehandGeometryCache } from '../geometry/freehandCache';

const caches = new WeakMap<
  LayeredEditorController,
  { cache: FreehandGeometryCache; document?: EditorDocument }
>();

/** One derived-geometry owner per editor. Identity/revision checks remain in the cache. */
export function layeredGeometryCache(controller: LayeredEditorController): FreehandGeometryCache {
  let state = caches.get(controller);
  if (!state) caches.set(controller, (state = { cache: new FreehandGeometryCache() }));
  const document = controller.getSnapshot('document');
  if (state.document !== document) {
    state.cache.syncDocument(document);
    state.document = document;
  }
  return state.cache;
}
