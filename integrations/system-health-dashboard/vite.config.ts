import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-redux': ['@reduxjs/toolkit', 'react-redux'],
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: parseInt(process.env.SYSTEM_HEALTH_DASHBOARD_PORT || '3032'),
    strictPort: true, // Fail if port is occupied instead of auto-switching
    // IPv4 loopback, explicitly. With 'localhost' Vite took the resolver's
    // first answer — [::1] on a Linux box whose /etc/hosts lists it first —
    // while Node's http client (the starter's health check, the api-server's
    // peers) dialled 127.0.0.1: refused, so a fresh harness install never got
    // a dashboard. Browsers try both families, so http://localhost:3032 still works.
    host: '127.0.0.1',
    // Same-origin /api/* -> the dashboard api-server, exactly as static-server.js
    // does in the container. This dev server IS the dashboard on a machine with
    // no Docker (the harness tier; scripts/start-services-robust.js runs
    // `npm run dev`). Without the proxy /api/features came back as index.html,
    // the features slice failed open and every tab showed, on precisely the
    // tier that switches most of them off.
    proxy: {
      '/api': `http://127.0.0.1:${process.env.SYSTEM_HEALTH_API_PORT || '3033'}`,
    },
  },
  preview: {
    port: parseInt(process.env.SYSTEM_HEALTH_DASHBOARD_PORT || '3032'),
  },
  define: {
    'process.env.SYSTEM_HEALTH_API_PORT': JSON.stringify(process.env.SYSTEM_HEALTH_API_PORT || '3033'),
  },
})
