import jestExpoPreset from 'jest-expo/jest-preset.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const expoJavaScriptTransform = Object.entries(jestExpoPreset.transform).find(([pattern]) =>
  pattern.includes('[jt]sx?')
);

const [, [, expoBabelOptions]] = expoJavaScriptTransform;
const {
  babelrcRoots: _babelrcRoots,
  configFile: _configFile,
  extends: _extends,
  ...expoCallerOptions
} = expoBabelOptions;

const nativeBabelTransform = [
  'babel-jest',
  {
    // Expo's preset is resolved from the app workspace, never from root Babel config.
    ...expoCallerOptions,
    babelrc: false,
    configFile: path.join(rootDir, 'tests/jest/babel.native.cjs'),
    cwd: rootDir,
    root: rootDir,
    rootMode: 'root',
  },
];

const expoTransform = {
  ...Object.fromEntries(
    Object.entries(jestExpoPreset.transform).filter(([pattern]) => !pattern.includes('[jt]sx?'))
  ),
  // Explicitly replace the JavaScript transformer so jest-expo cannot inject root Babel options.
  '^.+\\.[jt]sx?$': nativeBabelTransform,
};

const legacyWebProject = {
  displayName: 'legacy-web',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/packages'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/lib/',
    '/apps/',
    '/tests/',
    '/__tests__/fixtures/',
    // 纯 Node 的 core 测试由下方 core-node project 专门运行，这里精确排除，
    // 避免同一批用例在 jsdom 项目里被重复执行。
    '/__tests__/core/',
    '/__tests__/interactionFeedback\\.test\\.ts$',
    '/__tests__/selectionRotation\\.test\\.ts$',
    '/__tests__/utils\\.test\\.ts$',
    '/__tests__/viewport-affine\\.test\\.ts$',
    '/__tests__/viewport\\.test\\.ts$',
    '/__tests__/stroke-helpers\\.test\\.ts$',
    '/__tests__/task15-regression\\.test\\.ts$',
  ],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/jest.mockRN.js',
    '^@hamster-note/painting$': '<rootDir>/packages/painting/src/index.ts',
    '^@hamster-note/painting/(.*)$': '<rootDir>/packages/painting/src/$1',
    '^@hamster-note/painting-board$': '<rootDir>/packages/painting-board/src/index.tsx',
    '^@hamster-note/painting-board/(.*)$': '<rootDir>/packages/painting-board/src/$1',
    // @hamster-note/components 的 exports 仅提供 import 条件，jest 默认走 require，
    // 这里直接映射到 ESM 产物，配合下方 transformIgnorePatterns 经 babel 转译。
    // pnpm 将此依赖链接到使用它的 workspace，而非仓库根 node_modules。
    '^@hamster-note/components$':
      '<rootDir>/packages/painting/node_modules/@hamster-note/components/dist/index.js',
  },
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  // @hamster-note/components 是纯 ESM 产物，需经 babel-jest 转换才能在 Jest 中运行。
  // pnpm realpath 包含两段 node_modules，白名单同时覆盖其 .pnpm 真实路径。
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?@hamster-note/components/)',
  ],
};

// 纯 Node 环境的核心逻辑测试：不依赖 DOM / React Native 运行时。
// 这些用例只覆盖 packages/painting 下无副作用的核心模块（core、model、
// viewport、stroke-helpers 等），因此可以在更快的 node 环境中运行。
const coreNodeProject = {
  displayName: 'core-node',
  testEnvironment: 'node',
  // 精确圈定允许在纯 Node 下运行的测试文件；新增普通 DOM/RN 测试不会误入此项目。
  testMatch: [
    '<rootDir>/packages/painting/src/__tests__/core/**/*.test.ts',
    '<rootDir>/packages/painting/src/__tests__/interactionFeedback.test.ts',
    '<rootDir>/packages/painting/src/__tests__/selectionRotation.test.ts',
    '<rootDir>/packages/painting/src/__tests__/utils.test.ts',
    '<rootDir>/packages/painting/src/__tests__/viewport-affine.test.ts',
    '<rootDir>/packages/painting/src/__tests__/viewport.test.ts',
    '<rootDir>/packages/painting/src/__tests__/stroke-helpers.test.ts',
    '<rootDir>/packages/painting/src/__tests__/task15-regression.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // 复用根 babel.config.cjs（preset-env target node current）将 TS/ESM 转成 CJS。
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
};

const nativeProject = {
  ...jestExpoPreset,
  displayName: 'native',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/jest/native/**/*.native.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest/native/setup.cjs'],
  transform: expoTransform,
};

export default {
  projects: [legacyWebProject, coreNodeProject, nativeProject],
};
