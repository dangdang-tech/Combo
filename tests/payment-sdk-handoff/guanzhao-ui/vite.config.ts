import { defineConfig } from 'vite';

export default defineConfig({
  base: '/mingli/payment-sdk/',
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 4597, strictPort: true },
});
