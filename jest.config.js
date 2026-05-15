export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/packages'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/lib/', '/apps/', '/tests/ui/'],
  moduleNameMapper: {
    '^@hamster-note/painting$': '<rootDir>/packages/painting/src/index.ts',
    '^@hamster-note/painting/(.*)$': '<rootDir>/packages/painting/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!@system-ui-js/multi-drag-core/)'],
};
