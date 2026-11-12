export { createProbeCell } from './lasso-query-probe';
import {
  createLayeredLassoQuery,
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';

export function createCompatibilityCell(collinear: boolean) {
  const [x, y, size] = collinear ? [40, 40, 20] : [31, 31, 3];
  const prepared = prepareLayeredObjectQuery(
    {
      schemaVersion: 3,
      documentRevision: 0,
      objects: [
        {
          kind: 'image',
          objectId: 'target',
          objectRevision: 1,
          transformRevision: 1,
          transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          src: 'data:image/png;base64,AA==',
          localBounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
        },
      ],
    },
    new FreehandGeometryCache()
  );
  if (!prepared.ok) throw new Error(prepared.error.code);
  const path = (
    collinear
      ? [
          [0, 0],
          [100, 0],
          [100, 20],
          [20, 20],
          [20, 40],
          [0, 40],
        ]
      : [
          [70, 10],
          [20, 50],
          [10, 20],
          [10, 60],
          [0, 70],
          [10, 20],
          [40, 40],
        ]
  ).map(([x, y]) => ({ x, y }));
  const oracle = queryObjectLasso(prepared.value, path, 'intersects');
  return {
    run(iterations: number) {
      const start = performance.now();
      let result;
      for (let i = 0; i < iterations; i++) {
        const query = createLayeredLassoQuery(prepared.value, path);
        result = query.ok ? query.value.step(() => 0, Infinity) : query;
      }
      return { iterations, totalMs: performance.now() - start, result, oracle };
    },
  };
}
