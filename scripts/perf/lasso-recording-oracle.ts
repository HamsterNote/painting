import {
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';
import type { EditorDocument, Point } from '../../packages/painting/src/model/document';

export function query(document: EditorDocument, points: Point[]) {
  const prepared = prepareLayeredObjectQuery(document, new FreehandGeometryCache());
  if (!prepared.ok) throw new Error(prepared.error.code);
  const result = queryObjectLasso(prepared.value, points, 'intersects');
  if (!result.ok) throw new Error(result.error.code);
  return result.value.map((hit) => hit.objectId);
}
