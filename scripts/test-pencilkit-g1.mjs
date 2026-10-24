import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

const native = path.join(root, 'packages/painting-pencilkit/ios');
const production = [
  'PencilkitG1Sampler.swift',
  'PencilkitPreviewLedger.swift',
  'PencilkitDemoHitTesting.swift',
  'PencilkitDemoCanvasView.swift',
  'PencilkitDemoTouchObserver.swift',
  'PaintingPencilkitView.swift',
].map((file) => path.join(native, file));

try {
  if (process.platform === 'darwin') {
    const sdk = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {
      encoding: 'utf8',
    });
    if (sdk.error) throw sdk.error;
    if (sdk.status !== 0) throw new Error(`iOS SDK lookup failed: ${sdk.stderr}`);
    const sdkOutput = path.join(output, 'apple-sdk');
    mkdirSync(sdkOutput);
    const sdkArgs = [
      '-swift-version',
      '5',
      '-sdk',
      sdk.stdout.trim(),
      '-target',
      `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios15.1-simulator`,
    ];
    // Expo alone is stubbed here. UIKit, PencilKit, selectors and optional dispatch are Apple's.
    run('xcrun', [
      'swiftc',
      ...sdkArgs,
      '-emit-module',
      '-module-name',
      'ExpoModulesCore',
      '-emit-module-path',
      path.join(sdkOutput, 'ExpoModulesCore.swiftmodule'),
      path.join(fixtures, 'ExpoModulesCore.swift'),
    ]);
    run('xcrun', [
      'swiftc',
      ...sdkArgs,
      '-warnings-as-errors',
      '-typecheck',
      '-I',
      sdkOutput,
      ...production,
      path.join(native, 'PencilkitDemoDrawingDelegate.swift'),
      path.join(fixtures, 'AppleDelegateContract.swift'),
    ]);
    console.log('PASS: production view delegate contract against the real iOS Simulator SDK');
  } else {
    console.log('SKIP: real Apple SDK delegate contract requires macOS/Xcode');
  }
  // Compile the production sampler unchanged against narrow host-only UIKit/PencilKit fixtures.
  for (const module of ['UIKit', 'PencilKit', 'ExpoModulesCore']) {
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
      ...(module !== 'UIKit' ? ['-lUIKit'] : []),
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
    '-lExpoModulesCore',
    ...production,
    path.join(fixtures, 'DrawingDelegate.swift'),
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
