import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发态代理 /api 到 Express，生产态由 Express 同源服务 dist/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
