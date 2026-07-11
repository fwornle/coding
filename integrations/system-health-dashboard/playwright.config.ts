import { defineConfig } from '@playwright/test'

// Playwright config for the system-health-dashboard e2e specs (Phase 87-05 fork
// launcher flow lives under tests/e2e/performance/). Mirrors the repo-level
// tests/e2e/dashboard/playwright.config.ts: single chromium project, baseURL on
// the dashboard dev/prod port (3032), headless, artefacts on failure only.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: 'http://localhost:3032',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
