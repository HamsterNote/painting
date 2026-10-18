#!/usr/bin/env node

/**
 * 只用于 production export 的本地静态服务。带扩展名的请求永远映射到真实文件，
 * 因而资源缺失会返回 404，不会被 SPA fallback 的 HTML 掩盖。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';

const MIME_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function extensionOf(pathname) {
  const basename = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return dot > 0 ? basename.slice(dot).toLowerCase() : '';
}

const root = resolve(readArgument('--root', 'apps/playground/dist'));
const requestedPort = Number.parseInt(readArgument('--port', '0'), 10);
if (!existsSync(root) || !statSync(root).isDirectory()) {
  throw new Error(`Static export directory is unavailable: ${root}`);
}

const indexPath = resolve(root, 'index.html');
if (!existsSync(indexPath)) throw new Error(`SPA index is unavailable: ${indexPath}`);

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Malformed request path');
    return;
  }
  const candidate = resolve(root, `.${pathname}`);
  const contained = candidate === root || candidate.startsWith(`${root}${sep}`);
  const extension = extensionOf(pathname);
  const isFile = contained && existsSync(candidate) && statSync(candidate).isFile();

  // 只有无扩展名的路由才允许落回 index；/assets/missing.js 必须保持 404。
  const filePath = isFile ? candidate : extension === '' ? indexPath : null;
  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const contentType = MIME_TYPES[extensionOf(filePath)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentType,
    'cross-origin-resource-policy': 'same-origin',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath)
    .on('error', () => response.destroy())
    .pipe(response);
});

server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Unable to determine server address');
  process.stdout.write(
    `${JSON.stringify({ event: 'listening', host: '127.0.0.1', port: address.port, root, mimeTypes: MIME_TYPES })}\n`
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
