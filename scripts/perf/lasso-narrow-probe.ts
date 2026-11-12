import {
  lassoFixture,
  lassoTrajectory,
} from '../../apps/playground/src/layered-editor/lassoPerformanceFixture';
import {
  createLayeredLassoQuery,
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';

export function createCell(count: number, scenario: string) {
  const document = lassoFixture(count, scenario);
  const prepared = prepareLayeredObjectQuery(document, new FreehandGeometryCache());
  if (!prepared.ok) throw new Error(prepared.error.code);
  const points = lassoTrajectory(scenario);
  return {
    run(prefix: number, observe = false) {
      const path = points.slice(0, prefix);
      const fallbacks: { objectId: string; ms: number; reason: string }[] = [];
      const start = performance.now();
      const query = createLayeredLassoQuery(
        prepared.value,
        path,
        observe
          ? {
              now: () => performance.now(),
              onFallback: (objectId, ms, reason) => {
                fallbacks.push({ objectId, ms, reason });
              },
            }
          : undefined
      );
      const setupEnd = observe ? performance.now() : start;
      const result = query.ok ? query.value.step(() => 0, Infinity)! : query;
      const end = performance.now();
      const fallbackMs = fallbacks.reduce((sum, f) => sum + f.ms, 0);
      return {
        queryMs: end - start,
        result,
        candidateCount: query.ok ? query.value.candidateCount : 0,
        ...(observe
          ? {
              setupMs: setupEnd - start,
              fallbackCandidates: new Set(fallbacks.map((f) => f.objectId)).size,
              fallbackMs,
              fallbackTimeShare: end > start ? fallbackMs / (end - start) : 0,
              path,
              // Saved after the end timestamp; explain high fallback rates from
              // the actual prepared geometry without changing formal timings.
              fallbackObjects: [...new Set(fallbacks.map((f) => f.objectId))].map((objectId) => {
                const entry = prepared.value.entries.find((e) => e.objectId === objectId)!;
                return {
                  objectId,
                  kind: entry.kind,
                  margin: entry.margin,
                  polygons: entry.pieces.map((piece) => piece.polygons),
                };
              }),
              fallbacks: fallbacks.map((f) => {
                const entry = prepared.value.entries.find((e) => e.objectId === f.objectId)!;
                return {
                  ...f,
                  kind: entry.kind,
                  pieces: entry.pieces.length,
                  vertices: entry.pieces.reduce(
                    (sum, piece) =>
                      sum +
                      piece.polygons.reduce(
                        (n, p) => n + p.outer.length + p.holes.reduce((n, h) => n + h.length, 0),
                        0
                      ),
                    0
                  ),
                  broadphase: entry.broadphase,
                };
              }),
            }
          : {}),
      };
    },
    oracle(prefix: number) {
      return queryObjectLasso(prepared.value, points.slice(0, prefix), 'intersects');
    },
  };
}
