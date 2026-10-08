// The reduced glass UI: this directory is the Vite root, the dashboard's src/ is
// '@' exactly as in ../vite.config.ts. scripts/glass/extract.mjs builds it with
// `--outDir <tree>/ui`; a plain build lands in ../dist/glass-ui.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from '../tailwind.config'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    // '@/store' first: the exact module only, everything else under '@' as usual.
    alias: [
      { find: /^@\/store$/, replacement: path.resolve(__dirname, 'store.ts') },
      { find: '@', replacement: path.resolve(__dirname, '../src') },
    ],
  },
  // The dashboard's Tailwind config, with content paths that do not depend on the
  // cwd the build runs from: this entry plus the components it pulls in.
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...tailwindConfig,
          content: [path.join(__dirname, '*.{html,tsx,ts}'), path.resolve(__dirname, '../src/**/*.{js,ts,jsx,tsx}')],
        }),
        autoprefixer(),
      ],
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/glass-ui'),
    emptyOutDir: true,
    sourcemap: false,
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
  define: {
    'process.env.SYSTEM_HEALTH_API_PORT': JSON.stringify('3033'),
  },
})
