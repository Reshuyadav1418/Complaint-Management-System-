import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is proxied in development so the session cookie is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
});
