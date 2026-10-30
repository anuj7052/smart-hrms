import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sphere Enterprise HRMS',
        short_name: 'Sphere',
        description: 'Premium HR operations platform for attendance, leave, employee records, reporting, and eSSL device workflows.',
        theme_color: '#06385b',
        background_color: '#f6faff',
        display: 'standalone',
        icons: [
          { src: '/favicon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/favicon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: true,    // expose on local network so employees can access it
    proxy: {
      // Long-running endpoints (sync-live, historical-import, portal scrapes)
      // can take 30s+, so disable the proxy's idle timeout. Default vite/http-proxy
      // closes the socket too aggressively and the browser gets "socket hang up".
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/socket.io': { target: 'http://localhost:5001', ws: true },
    },
  },
});
