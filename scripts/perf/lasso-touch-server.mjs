// Temporary diagnostic proxy for the frozen PR53 service; no product code patch.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const records = resolve(process.argv[2] ?? 'artifacts/research/lasso-touch/recordings');
await mkdir(records, { recursive: true });
const recorder = await readFile(new URL('./lasso-touch-recorder.js', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/__lasso_recorder.js' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(recorder);
      return;
    }
    if (url.pathname === '/__lasso_diagnostics' && request.method === 'POST') {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (record?.version !== 1 || !Array.isArray(record.events) || record.events.length > 5000) {
        response.writeHead(400).end();
        return;
      }
      const id = randomUUID();
      await writeFile(resolve(records, `${id}.json`), JSON.stringify(record, null, 2), {
        flag: 'wx',
      });
      console.log(JSON.stringify({ event: 'saved', id, entries: record.events.length }));
      response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id }));
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === '/') {
      response
        .writeHead(302, {
          Location:
            '/layered-editor?fixture=lasso&lassoCount=500&lassoScenario=local&touchDraw=1&lassoPerf=1',
        })
        .end();
      return;
    }
    // Fixed upstream, including for absolute request targets: never an open proxy.
    const upstream = new URL('http://127.0.0.1:6273');
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const source = await fetch(upstream, {
      method: request.method,
      signal: AbortSignal.timeout(30000),
    });
    const type = source.headers.get('content-type') ?? 'application/octet-stream';
    response.writeHead(source.status, { 'Content-Type': type });
    if (request.method === 'HEAD') response.end();
    else if (type.includes('text/html'))
      response.end(
        (await source.text()).replace(
          /<head>/i,
          '<head><script src="/__lasso_recorder.js"></script>'
        )
      );
    else response.end(Buffer.from(await source.arrayBuffer()));
  } catch (error) {
    console.error(String(error));
    if (!response.headersSent) response.writeHead(error instanceof SyntaxError ? 400 : 502);
    response.end();
  }
});
server.listen(6274, '0.0.0.0', () =>
  console.log(JSON.stringify({ event: 'listening', port: 6274, records }))
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close(() => process.exit(0)));
