import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// PATTERN SOURCE: Standard Vitest + Vite alignment per 45-PATTERNS.md § No Analog Found.
// Dashboard has no vitest config (it uses Jest at tests/integration/*.test.js).
// jsdom env + jest-dom matchers + the same '@' alias the app uses.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
