import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const output = path.resolve('test-results/toolbar-fixture');
await mkdir(output, { recursive: true });
for (const name of ['light', 'painting']) {
  const result = await build({
    entryPoints: [`packages/painting/src/__tests__/fixtures/toolbar/${name}.tsx`],
    outfile: `${output}/${name}.js`,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    metafile: true,
    alias: { 'react-native': 'react-native-web' },
    // Exercise the public compiled ESM export (also used by downstream bundlers).
    conditions: ['import'],
    nodePaths: [path.resolve('apps/playground/node_modules')],
    mainFields: ['module', 'main'],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (
    name === 'light' &&
    inputs.some((input) =>
      /painting\/lib\/module\/(core|layered|input)|perfect-freehand|react-native/.test(input)
    )
  )
    throw new Error('The toolbar subpath imported an editor or native runtime');
  if (!inputs.some((input) => input.includes('painting/lib/module/toolbar/')))
    throw new Error('Fixture did not resolve the compiled public toolbar export');
  await writeFile(`${output}/${name}-modules.json`, JSON.stringify(inputs, null, 2));
  await writeFile(
    `${output}/${name}.html`,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;font:14px system-ui}button,select{min-height:44px}output{max-width:120px;overflow:hidden}</style><div id="root"></div><script type="module" src="/${name}.js"></script>`
  );
}

const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'light.html';
  if (!/^(light|painting)(\.html|\.js|-modules\.json)$/.test(name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader(
      'Content-Type',
      name.endsWith('.js')
        ? 'text/javascript'
        : name.endsWith('.json')
          ? 'application/json'
          : 'text/html'
    );
    response.end(await readFile(path.join(output, name)));
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(5279, '127.0.0.1');
