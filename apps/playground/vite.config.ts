import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5263,
    host: true,
  },
  resolve: {
    alias: {
      '@hamster-note/painting': path.resolve(__dirname, '../../packages/painting/src/index.ts'),
    },
  },
});
