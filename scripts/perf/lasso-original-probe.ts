import {
  lassoFixture,
  lassoTrajectory,
} from '../../apps/playground/src/layered-editor/lassoPerformanceFixture';
import {
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';

// Runner replaces the complete query module with git show 81bff35:<path>.
// This adapter never imports the new factory, which did not exist at that SHA.
export function createCell(count: number, scenario: string) {
  const document = lassoFixture(count, scenario);
  const prepared = prepareLayeredObjectQuery(document, new FreehandGeometryCache());
  if (!prepared.ok) throw new Error(prepared.error.code);
  const points = lassoTrajectory(scenario);
  return {
    run(prefix: number) {
      const path = points.slice(0, prefix);
      const start = performance.now();
      const result = queryObjectLasso(prepared.value, path, 'intersects');
      const end = performance.now();
      return { queryMs: end - start, result };
    },
  };
}
