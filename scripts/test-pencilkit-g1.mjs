import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/swift/pencilkit-g1');
const output = mkdtempSync(path.join(tmpdir(), 'pencilkit-g1-'));
const compiler = process.env.SWIFTC ?? 'swiftc';
const extension = process.platform === 'darwin' ? 'dylib' : 'so';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

try {
  // Compile the production sampler unchanged against narrow host-only UIKit/PencilKit fixtures.
  for (const module of ['UIKit', 'PencilKit']) {
    run(compiler, [
      '-swift-version',
      '5',
      '-emit-module',
      '-emit-library',
      '-module-name',
      module,
      '-emit-module-path',
      path.join(output, `${module}.swiftmodule`),
      '-I',
      output,
      '-L',
      output,
      ...(module === 'PencilKit' ? ['-lUIKit'] : []),
      path.join(fixtures, `${module}.swift`),
      '-o',
      path.join(output, `lib${module}.${extension}`),
    ]);
  }
  const executable = path.join(output, 'g1-tests');
  run(compiler, [
    '-swift-version',
    '5',
    '-I',
    output,
    '-L',
    output,
    '-lUIKit',
    '-lPencilKit',
    path.join(root, 'packages/painting-pencilkit/ios/PencilkitG1Sampler.swift'),
    path.join(root, 'packages/painting-pencilkit/ios/PencilkitPreviewLedger.swift'),
    path.join(root, 'packages/painting-pencilkit/ios/PencilkitDemoHitTesting.swift'),
    path.join(root, 'packages/painting-pencilkit/ios/PencilkitDemoCanvasView.swift'),
    path.join(root, 'packages/painting-pencilkit/ios/PencilkitDemoTouchObserver.swift'),
    path.join(fixtures, 'main.swift'),
    '-o',
    executable,
  ]);
  const libraryPath = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  run(executable, [], {
    ...process.env,
    [libraryPath]: [output, process.env[libraryPath]].filter(Boolean).join(path.delimiter),
  });
} finally {
  rmSync(output, { recursive: true, force: true });
}
