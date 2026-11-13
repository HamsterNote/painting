// Count geometry work independently of browser timing. Instrument only the probe
// bundle, leaving the product API and its predicate expressions unchanged.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const output = process.argv[2] ?? 'artifacts/research/lasso-cold/edge-work';
await mkdir(output, { recursive: true });
for (const version of ['7679377', 'current']) {
  await build({
    stdin: {
      contents: `
        import {lassoFixture,lassoTrajectory} from './apps/playground/src/layered-editor/lassoPerformanceFixture';
        import {FreehandGeometryCache} from './packages/painting/src/geometry/freehandCache';
        import {prepareLayeredObjectQuery,createLayeredLassoQuery,edgeWorkStats} from './packages/painting/src/core/layeredObjectQuery';
        const prepared=prepareLayeredObjectQuery(lassoFixture(500,'local'),new FreehandGeometryCache());
        if(!prepared.ok)throw Error('prepare');
        const query=createLayeredLassoQuery(prepared.value,lassoTrajectory('local'));
        if(!query.ok)throw Error('query');
        const result=query.value.step(()=>0,Infinity);
        if(!result.ok)throw Error('result');
        console.log(JSON.stringify({candidates:query.value.candidateCount,selected:result.value.map(h=>h.objectId),...edgeWorkStats()},null,2));
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: `${output}/${version}.cjs`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'count-edge-work',
        setup(build) {
          build.onLoad({ filter: /core\/layeredObjectQuery.ts$/ }, async ({ path }) => {
            let source =
              version === 'current'
                ? await readFile(path, 'utf8')
                : execFileSync(
                    'git',
                    ['show', `${version}:packages/painting/src/core/layeredObjectQuery.ts`],
                    { encoding: 'utf8' }
                  );
            const start = source.indexOf('function withinLassoMargin(');
            const end = source.indexOf('type LassoEdge =', start);
            if (start < 0 || end < 0) throw Error('missing probe boundary');
            let body = source.slice(start, end);
            const insert = (needle, prefix) => {
              if (!body.includes(needle)) throw Error(`missing probe anchor: ${needle}`);
              body = body.replace(needle, prefix + needle);
            };
            insert('let overlappingBounds = false;', 'edgeWork.boundaryObjects++;\n');
            insert('const o1 = dx *', 'edgeWork.edgePairs++;\n');
            if (version === 'current')
              insert('const node = stack.pop()!', 'edgeWork.nodeVisits++;\n');
            else
              body = body.replace(
                'const visit = (node: EdgeNode): PieceHit => {',
                'const visit = (node: EdgeNode): PieceHit => { edgeWork.nodeVisits++;'
              );
            source =
              source.slice(0, start) +
              body +
              source.slice(end) +
              `
          const edgeWork = {boundaryObjects:0,nodeVisits:0,edgePairs:0};
          export const edgeWorkStats = () => edgeWork;
        `;
            return { contents: source, loader: 'ts' };
          });
        },
      },
    ],
  });
  const result = execFileSync(process.execPath, [`${output}/${version}.cjs`], { encoding: 'utf8' });
  await writeFile(`${output}/${version}.json`, result);
  console.log(version, result);
}
