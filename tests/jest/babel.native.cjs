const path = require('node:path');

const appRoot = path.resolve(__dirname, '../../apps/playground');

module.exports = {
  presets: [
    [
      require.resolve('babel-preset-expo', { paths: [appRoot] }),
      {
        // Keep Babel's target selection aligned with jest-expo's caller metadata.
        lazyImports: false,
      },
    ],
  ],
};
