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
  server: {
    port: parseInt(process.env.SYSTEM_HEALTH_DASHBOARD_PORT || '3032'),
  },
  preview: {
    port: parseInt(process.env.SYSTEM_HEALTH_DASHBOARD_PORT || '3032'),
  },
  define: {
    'process.env.SYSTEM_HEALTH_API_PORT': JSON.stringify(process.env.SYSTEM_HEALTH_API_PORT || '3033'),
  },
})
