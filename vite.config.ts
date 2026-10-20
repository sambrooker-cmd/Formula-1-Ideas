import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true, // reachable from other devices on the LAN
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
