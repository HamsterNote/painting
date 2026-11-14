// Reuse HAM-245's structural probe on every recorded fallback, outside timings.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error('Usage: node scripts/perf/lasso-fallback-geometry.mjs INPUT OUTPUT');
const environment = JSON.parse(await readFile(`${input}/environment.json`, 'utf8'));
const sha = environment.revisions.B;
const template = await readFile('scripts/perf/lasso-ink360.ts', 'utf8');
await mkdir(output, { recursive: true });
const summary = [];
for (const file of (await readdir(input)).filter((name) => name.endsWith('-B.json')).sort()) {
  const raw = JSON.parse(await readFile(`${input}/${file}`, 'utf8'));
  if (!raw.fallbacks?.length) continue;
  const [, scenario, count, prefix] = file.match(
    /^(local|dense|mixed)-(\d+)-r\d+-a\d+-p(\d+)-B\.json$/
  );
  for (const { objectId } of raw.fallbacks) {
    let source = template;
    const replace = (needle, replacement) => {
      assert.equal(source.split(needle).length, 2);
      source = source.replace(needle, replacement);
    };
    replace("lassoFixture(500, 'local')", `lassoFixture(${Number(count)}, '${scenario}')`);
    replace(
      "lassoTrajectory('local')",
      `lassoTrajectory('${scenario}').slice(0, ${Number(prefix)})`
    );
    replace(
      'prepared.value.entries[360]',
      `prepared.value.entries.find(e => e.objectId === ${JSON.stringify(objectId)})`
    );
    replace(
      'document.objects[360]',
      `document.objects.find(o => o.objectId === ${JSON.stringify(objectId)})`
    );
    // Geometry evidence has no clock: these probes are valid on a busy host.
    replace('const begin = performance.now();', '');
    replace('const ms = performance.now() - begin;', '');
    replace('referenceUnthrottledMs: ms,', '');
    const id = `${scenario}-${count}-p${prefix}-${objectId}`;
    await writeFile(`${output}/${id}.ts`, source);
    await build({
      stdin: {
        contents: source,
        resolveDir: path.resolve('scripts/perf'),
        loader: 'ts',
        sourcefile: `${id}.ts`,
      },
      outfile: `${output}/${id}.cjs`,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      sourcemap: true,
      plugins: [
        {
          name: 'frozen-geometry',
          setup(builder) {
            builder.onLoad({ filter: /\.(ts|tsx)$/ }, ({ path: file }) => {
              const relative = path.relative(process.cwd(), file);
              if (
                !relative.startsWith('packages/painting/src/') &&
                !relative.startsWith('apps/playground/src/')
              )
                return;
              let contents = execFileSync('git', ['show', `${sha}:${relative}`], {
                encoding: 'utf8',
              });
              if (relative.endsWith('/core/layeredObjectQuery.ts'))
                contents +=
                  '\nexport { orient2d, canonicalLasso, withinLassoMargin, lineMissesExpandedEdgeBox, segmentSegmentDistance, pieceIntersectsLasso };';
              return { contents, loader: file.endsWith('.tsx') ? 'tsx' : 'ts' };
            });
          },
        },
      ],
    });
    const text = execFileSync(process.execPath, [`${output}/${id}.cjs`], { encoding: 'utf8' });
    await writeFile(`${output}/${id}.json`, text);
    const geometry = JSON.parse(text);
    const recorded = raw.fallbackObjects.find((o) => o.objectId === objectId);
    assert.equal(geometry.vertices, recorded.polygons[0][0].outer.length);
    const row = {
      id,
      sha,
      sourceFile: file,
      geometryFile: `${id}.json`,
      vertices: geometry.vertices,
      selfContacts: geometry.crossings.length,
      zeroEdges: geometry.zeroEdges,
      minimumEdgeLength: geometry.minEdge,
      canonical: geometry.objectCanonical,
      margin: geometry.margin,
      nearestDistance: geometry.nearest,
      referenceHit: geometry.reference,
      marginResult: geometry.marginResult,
      ambiguousPairs: geometry.suspicious.filter((pair) => !pair.reverse),
    };
    summary.push(row);
    console.log(JSON.stringify(row));
  }
}
await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
