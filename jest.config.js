export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/packages'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/lib/', '/apps/', '/tests/ui/', '/__tests__/fixtures/'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/jest.mockRN.js',
    '^@hamster-note/painting$': '<rootDir>/packages/painting/src/index.ts',
    '^@hamster-note/painting/(.*)$': '<rootDir>/packages/painting/src/$1',
    '^@hamster-note/painting-board$': '<rootDir>/packages/painting-board/src/index.tsx',
    '^@hamster-note/painting-board/(.*)$': '<rootDir>/packages/painting-board/src/$1',
    // @hamster-note/components 的 exports 仅提供 import 条件，jest 默认走 require，
    // 这里直接映射到 ESM 产物，配合下方 transformIgnorePatterns 经 babel 转译
    '^@hamster-note/components$': '<rootDir>/node_modules/@hamster-note/components/dist/index.js',
  },
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  // @hamster-note/components 是纯 ESM 产物，需经 babel-jest 转换才能在 jest 中运行
  transformIgnorePatterns: [
    '/node_modules/(?!(@system-ui-js/(multi-drag|multi-drag-core)|@hamster-note/components)/)',
  ],
};
