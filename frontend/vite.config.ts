import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev the frontend only ever talks to a same-origin `/api` path; this proxy
      // forwards it to the backend (§16). Keeps CORS out of the local loop entirely.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
