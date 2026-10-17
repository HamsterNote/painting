import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const retired = [
  'packages/painting/src/skia',
  'packages/painting/src/components',
  'packages/painting/src/render',
  'apps/playground/public/canvaskit.wasm',
  'apps/playground/src/editor-candidate',
];
for (const path of retired) {
  // Empty directories left by a patch are harmless and are not part of Git or npm packs.
  assert(
    !existsSync(path) ||
      (statSync(path).isDirectory() &&
        !readdirSync(path, { recursive: true }).some((entry) =>
          statSync(join(path, entry)).isFile()
        )),
    `Retired runtime remains: ${path}`
  );
}
const forbidden = /@shopify\/react-native-skia|canvaskit-wasm|setup-skia-web|\/canvaskit\.wasm/;
for (const workspace of ['packages/painting', 'packages/painting-board', 'apps/playground']) {
  const manifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));
  assert(!forbidden.test(JSON.stringify(manifest)), `Retired dependency or export: ${workspace}`);
  assert(!manifest.exports?.['./skia'], `Skia export remains: ${workspace}`);
  function checkExport(value) {
    if (typeof value === 'string') {
      assert(
        existsSync(join(workspace, value)),
        `Missing exported artifact: ${workspace}/${value}`
      );
      return;
    }
    assert(value && typeof value === 'object', `Invalid export: ${workspace}`);
    Object.values(value).forEach(checkExport);
  }
  Object.values(manifest.exports ?? {}).forEach(checkExport);
}
assert(
  !forbidden.test(readFileSync('pnpm-lock.yaml', 'utf8')),
  'Retired lockfile dependency remains'
);
for (const directory of [
  'packages/painting/lib',
  'packages/painting-board/lib',
  'apps/playground/dist',
]) {
  assert(existsSync(directory), `Build first: ${directory}`);
  const files = readdirSync(directory, { recursive: true }).filter((path) =>
    /\.(?:js|json|ts)$/.test(path)
  );
  assert(
    files.some((path) => path.endsWith('.js')),
    `Missing JavaScript artifacts: ${directory}`
  );
  for (const path of files) {
    assert(!/(^|\/)skia\//i.test(path), `Retired build entry: ${directory}/${path}`);
    assert(
      !forbidden.test(readFileSync(join(directory, path), 'utf8')),
      `Retired runtime reference: ${directory}/${path}`
    );
  }
}
console.log(
  'Layered delivery: exports exist; source, lockfile and both packages/Expo artifacts contain no retired Skia runtime.'
);
