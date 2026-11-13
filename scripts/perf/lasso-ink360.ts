import {
  lassoFixture,
  lassoTrajectory,
} from '../../apps/playground/src/layered-editor/lassoPerformanceFixture';
import { FreehandGeometryCache } from '../../packages/painting/src/geometry/freehandCache';
import {
  orient2d,
  canonicalLasso,
  withinLassoMargin,
  lineMissesExpandedEdgeBox,
  segmentSegmentDistance,
  pieceIntersectsLasso,
  prepareLayeredObjectQuery,
} from '../../packages/painting/src/core/layeredObjectQuery';
import { canonicalizeClosedRing } from '../../packages/painting/src/core/polygonBoolean';
const document = lassoFixture(500, 'local'),
  path = lassoTrajectory('local');
const prepared = prepareLayeredObjectQuery(document, new FreehandGeometryCache());
if (!prepared.ok) throw new Error('prepare');
const entry = prepared.value.entries[360],
  piece = entry.pieces[0],
  ring = piece.polygons[0].outer;
const lasso = canonicalLasso(path);
if (!lasso.ok) throw new Error('canonical');
const crossings = [];
let zero = 0,
  min = Infinity,
  area = 0;
for (let i = 0; i < ring.length; i++) {
  const a = ring[i],
    b = ring[(i + 1) % ring.length];
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  min = Math.min(min, len);
  if (!len) zero++;
  area += a.x * b.y - a.y * b.x;
  for (let j = i + 2; j < ring.length; j++) {
    if (i === 0 && j === ring.length - 1) continue;
    const c = ring[j],
      d = ring[(j + 1) % ring.length];
    if (
      Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
      Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
      Math.max(c.y, d.y) < Math.min(a.y, b.y)
    )
      continue;
    const o = [
      orient2d(a.x, a.y, b.x, b.y, c.x, c.y),
      orient2d(a.x, a.y, b.x, b.y, d.x, d.y),
      orient2d(c.x, c.y, d.x, d.y, a.x, a.y),
      orient2d(c.x, c.y, d.x, d.y, b.x, b.y),
    ];
    if (o[0] * o[1] <= 0 && o[2] * o[3] <= 0) crossings.push({ i, j, o });
  }
}
const suspicious = [];
let nearest = Infinity;
for (let i = 0; i < ring.length; i++)
  for (let j = 0; j < path.length; j++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      c = path[j],
      d = path[(j + 1) % path.length];
    const dist = segmentSegmentDistance(a, b, c, d);
    if (dist !== null) nearest = Math.min(nearest, dist);
    const minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x),
      minY = Math.min(a.y, b.y),
      maxY = Math.max(a.y, b.y);
    if (
      minX > Math.max(c.x, d.x) ||
      Math.min(c.x, d.x) > maxX ||
      minY > Math.max(c.y, d.y) ||
      Math.min(c.y, d.y) > maxY
    )
      continue;
    const forward = lineMissesExpandedEdgeBox(c, d, minX, minY, maxX, maxY, 0);
    if (!forward)
      suspicious.push({
        i,
        j,
        a,
        b,
        c,
        d,
        distance: dist,
        forward,
        reverse: lineMissesExpandedEdgeBox(
          a,
          b,
          Math.min(c.x, d.x),
          Math.min(c.y, d.y),
          Math.max(c.x, d.x),
          Math.max(c.y, d.y),
          0
        ),
      });
  }
const canonical = canonicalizeClosedRing(ring);
const begin = performance.now();
const reference = pieceIntersectsLasso(piece, lasso.polygons, 0);
const ms = performance.now() - begin;
console.log(
  JSON.stringify(
    {
      samples: document.objects[360].samples.length,
      vertices: ring.length,
      bounds: entry.broadphase,
      margin: entry.margin,
      signedArea: area / 2,
      minEdge: min,
      zeroEdges: zero,
      crossings,
      objectCanonical: canonical.ok
        ? {
            ok: true,
            polygons: canonical.polygons.length,
            vertices: canonical.polygons.reduce(
              (s, p) => s + p.outer.length + p.holes.reduce((s, h) => s + h.length, 0),
              0
            ),
          }
        : canonical,
      lassoVertices: path.length,
      nearest,
      suspicious,
      marginResult: withinLassoMargin(piece, lasso.polygons, 0),
      reference,
      referenceUnthrottledMs: ms,
    },
    null,
    2
  )
);
