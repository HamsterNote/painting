// Build with esbuild --bundle --platform=node --format=cjs, then node --test.
// Kept outside Jest's VM: the 100-object/10,000-path oracle campaign is CPU-heavy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLayeredLassoQuery,
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';
import type { DocumentObject, Point } from '../../packages/painting/src/model/document';

test('seed 245: 100 grid images, exact review trajectory and 10,000 integer trajectories match unchanged oracle', () => {
  const objects: DocumentObject[] = Array.from({ length: 100 }, (_, i) => {
    const x = (i % 10) * 10 + 1,
      y = Math.floor(i / 10) * 10 + 1;
    return {
      kind: 'image',
      objectId: `image-${i}`,
      objectRevision: 1,
      transformRevision: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      src: 'data:image/png;base64,AA==',
      localBounds: { minX: x, minY: y, maxX: x + 3, maxY: y + 3 },
    };
  });
  const prepared = prepareLayeredObjectQuery(
    { schemaVersion: 3, documentRevision: 0, objects },
    new FreehandGeometryCache()
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error(prepared.error.code);
  const complete = (path: readonly Point[]) => {
    const query = createLayeredLassoQuery(prepared.value, path);
    return query.ok ? query.value.step(() => 0, Infinity)! : query;
  };
  // Review attachment contains this exact counterexample, but does not record
  // its original PRNG seed/generator. Do not label our seed as the review seed.
  const review = [
    [70, 10],
    [20, 50],
    [10, 20],
    [10, 60],
    [0, 70],
    [10, 20],
    [40, 40],
  ].map(([x, y]) => ({ x, y }));
  const expected = queryObjectLasso(prepared.value, review, 'intersects');
  assert(expected.ok && expected.value.some((hit) => hit.objectId === 'image-33'));
  assert.deepEqual(complete(review), expected);
  let seed = 245;
  const random = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
  for (let index = 0; index < 10000; index++) {
    const state = seed;
    const path: Point[] = Array.from({ length: 3 + Math.floor(random() * 8) }, () => ({
      x: Math.floor(random() * 11) * 10,
      y: Math.floor(random() * 11) * 10,
    }));
    const oracle = queryObjectLasso(prepared.value, path, 'intersects');
    const actual = complete(path);
    assert.deepEqual(actual, oracle, JSON.stringify({ index, seed: state, path }));
    if ((index + 1) % 1000 === 0)
      console.log(JSON.stringify({ seed: 245, completed: index + 1, objects: 100, mismatches: 0 }));
  }
});
