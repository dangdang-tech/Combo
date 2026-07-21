import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 本地也保持与生产一致的同源 /try 路径，试用完成后才能原路回到创作链。
      '/try': 'http://localhost:5174',
      // 真实试用/回流校验走 runtime（更具体规则必须放在通用 /api 前）。
      '/api/v1/runtime': 'http://localhost:3100',
      // 其余 authoring API 与健康检查走 3000。
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ready': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
