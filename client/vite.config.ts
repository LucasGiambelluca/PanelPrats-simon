import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,            // expone en LAN / túnel
    allowedHosts: true,    // acepta dominios de túnel (ngrok/cloudflared)
    proxy: {
      // El front llama relativo /api → vite proxyea al backend. Así con UN solo
      // túnel (al 5173) la página y la API quedan en el mismo origen.
      '/api': 'http://localhost:3001',
    },
  },
});
