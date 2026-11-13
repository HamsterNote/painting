// Isolated research only: npm install --prefix <root> --ignore-scripts the pinned candidates.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(process.argv[2] ?? 'artifacts/research/lasso-release/libraries');
const require = createRequire(`${root}/package.json`);
const polyclip = require('polyclip-ts');
const clipping = require('polygon-clipping');
const turf = require('@turf/boolean-intersects').booleanIntersects;
const clipperLib = require('js-angusj-clipper');
const clipper = await clipperLib.loadNativeClipperLibInstanceAsync(
  clipperLib.NativeClipperLibRequestedFormat.WasmOnly
);
const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const touching = square.map(([x, y]) => [x + 10, y]);
const point = { type: 'Point', coordinates: [5, 5] };
const rings = {
  square,
  repeated: [[0, 0], ...square],
  twiceWound: [...square, ...square.slice(1)],
  bowtie: [
    [0, 0],
    [10, 10],
    [0, 10],
    [10, 0],
    [0, 0],
  ],
  point: [[0, 0]],
  line: [
    [0, 0],
    [10, 0],
  ],
  collinear: [
    [0, 0],
    [5, 0],
    [10, 0],
    [0, 0],
  ],
  empty: [],
};
const attempt = (fn) => {
  try {
    return fn();
  } catch (e) {
    return { error: e.message };
  }
};
const results = {};
for (const [name, ring] of Object.entries(rings)) {
  results[name] = {
    polyclipUnion: attempt(() => polyclip.union([ring])),
    polygonClippingUnion: attempt(() => clipping.union([ring])),
    turfPointIntersects: attempt(() => turf(point, { type: 'Polygon', coordinates: [ring] })),
    clipperNonZeroUnion: attempt(() =>
      clipper.clipToPaths({
        clipType: clipperLib.ClipType.Union,
        subjectFillType: clipperLib.PolyFillType.NonZero,
        subjectInputs: [{ data: ring.map(([x, y]) => ({ x, y })), closed: true }],
      })
    ),
  };
}
results.boundaryTouch = {
  polyclip: polyclip.intersection([square], [touching]),
  polygonClipping: clipping.intersection([square], [touching]),
  turf: turf(
    { type: 'Polygon', coordinates: [square] },
    { type: 'Polygon', coordinates: [touching] }
  ),
};
const sizes = [];
for (const name of [
  'polyclip-ts',
  'polygon-clipping',
  '@turf/boolean-intersects',
  'js-angusj-clipper',
]) {
  const entry = name === 'js-angusj-clipper' ? `${name}/web/index.js` : name;
  const built = await build({
    stdin: {
      contents: `import * as library from '${entry}'; globalThis.libraryProbe = library;`,
      resolveDir: root,
    },
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'esm',
    write: false,
  });
  const bytes = built.outputFiles[0].contents;
  const metadata = JSON.parse(await readFile(`${root}/node_modules/${name}/package.json`, 'utf8'));
  sizes.push({
    name,
    version: metadata.version,
    entry,
    bytes: bytes.length,
    gzip: gzipSync(bytes).length,
  });
}
await writeFile(`${root}/probe.json`, JSON.stringify({ results, sizes }, null, 2));
console.log(JSON.stringify({ results, sizes }, null, 2));
