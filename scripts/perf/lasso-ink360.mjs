// Structural diagnosis only; Node timing is not the headed 6x acceptance measurement.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = process.argv[2] ?? 'artifacts/research/lasso-cold';
await mkdir(root, { recursive: true });
for (const version of ['9eca18d', 'current']) {
  await build({
    entryPoints: ['scripts/perf/lasso-ink360.ts'],
    outfile: `${root}/inspect-${version}.cjs`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'inspect-private',
        setup(build) {
          build.onLoad({ filter: /core\/layeredObjectQuery.ts$/ }, async ({ path }) => ({
            contents:
              (version === 'current'
                ? await readFile(path, 'utf8')
                : execFileSync(
                    'git',
                    ['show', `${version}:packages/painting/src/core/layeredObjectQuery.ts`],
                    { encoding: 'utf8' }
                  )) +
              '\nexport { orient2d, canonicalLasso, withinLassoMargin, lineMissesExpandedEdgeBox, segmentSegmentDistance, pieceIntersectsLasso };',
            loader: 'ts',
          }));
        },
      },
    ],
  });
  const result = execFileSync(process.execPath, [`${root}/inspect-${version}.cjs`], {
    encoding: 'utf8',
  });
  await writeFile(`${root}/ink-360-${version}.json`, result);
  console.log(version, result);
}
