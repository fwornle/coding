import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// PATTERN SOURCE: integrations/system-health-dashboard/vite.config.ts:1-37
// Phase 45 additions (per 45-PATTERNS.md):
//   - vendor-graph chunk (sigma / graphology / @react-sigma/core)
//   - vendor-markdown chunk (react-markdown / remark-gfm / rehype-highlight / highlight.js)
//   - server.port: 5173 + strictPort (per 45-RESEARCH.md Wave-0 CORS probe row 1)
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
          'vendor-icons': ['lucide-react'],
          'vendor-graph': ['sigma', 'graphology', '@react-sigma/core'],
          'vendor-markdown': [
            'react-markdown',
            'remark-gfm',
            'rehype-highlight',
            'highlight.js',
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
