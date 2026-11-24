import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative, so the built index.html asks for ./assets/... and resolves it
  // against wherever it was served from. One build then works at the root of
  // a host or under a sublocation of an existing site (ADR 0030). There is no
  // client-side router here, so the document URL is always the mount point.
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
