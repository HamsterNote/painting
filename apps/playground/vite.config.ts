import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const extensions = [
  '.web.tsx',
  '.tsx',
  '.web.ts',
  '.ts',
  '.web.jsx',
  '.jsx',
  '.web.js',
  '.js',
  '.css',
  '.json',
];

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
    }),
  ],
  define: {
    global: 'globalThis',
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  resolve: {
    extensions,
    alias: {
      'react-native': 'react-native-web',
      '@hamster-note/painting': path.resolve(__dirname, '../../packages/painting/src/index.ts'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      resolveExtensions: extensions,
      jsx: 'automatic',
      loader: { '.js': 'jsx' },
    },
    include: ['react-native-web'],
  },
  server: {
    port: 5266,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  publicDir: 'assets',
});
