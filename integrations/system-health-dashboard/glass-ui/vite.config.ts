// The reduced glass UI: this directory is the Vite root, the dashboard's src/ is
// '@' exactly as in ../vite.config.ts. scripts/glass/extract.mjs builds it with
// `--outDir <tree>/ui`; a plain build lands in ../dist/glass-ui.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from '../tailwind.config'

// Modules glass builds WITHOUT, each swapped for a glass-ui stand-in: coding's own
// site providers, and the Token Usage parts glass never renders (see omitted.tsx).
// Matched on the resolved file, so relative and '@/' imports alike are caught.
const SWAPPED: Array<[RegExp, string]> = [
  [/src\/lib\/provider-site\.ts$/, 'provider-site.ts'],
  [/src\/pages\/token-usage-settings-dialog\.tsx$/, 'omitted.tsx'],
  [/src\/pages\/token-usage-routing-tab\.tsx$/, 'omitted.tsx'],
]
const swapForGlass = {
  name: 'glass-swap',
  enforce: 'pre' as const,
  async resolveId(this: { resolve: (s: string, i?: string, o?: object) => Promise<{ id: string } | null> }, source: string, importer?: string) {
    if (!importer) return null
    const r = await this.resolve(source, importer, { skipSelf: true })
    const hit = r && SWAPPED.find(([re]) => re.test(r.id.split('?')[0]))
    return hit ? path.resolve(__dirname, hit[1]) : null
  },
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [swapForGlass, react()],
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
