import { canonicalizeClosedRing } from '../../packages/painting/src/core/polygonBoolean';
import { intersection } from 'polyclip-ts';
const path = [
  [100, 10],
  [20, 90],
  [60, 50],
  [60, 90],
  [10, 70],
  [40, 0],
  [20, 50],
  [40, 70],
  [90, 60],
  [90, 0],
].map(([x, y]) => ({ x, y }));
const canonical = canonicalizeClosedRing(path);
if (!canonical.ok) throw Error('canonical');
const lasso = canonical.polygons.map((p) =>
  [p.outer, ...p.holes].map((r) => r.map((p) => [p.x, p.y]))
);
const target = [
  [
    [
      [51, 61],
      [54, 61],
      [54, 64],
      [51, 64],
    ],
  ],
];
console.log(
  JSON.stringify(
    { path, canonical, intersection: intersection(target as never, lasso as never) },
    null,
    2
  )
);
