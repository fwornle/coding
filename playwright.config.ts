// PATTERN SOURCE: 45-06-PLAN.md <interfaces> block — Playwright project
//                 entry for the unified-viewer E2E suite + the existing
//                 dashboard suite at tests/e2e/dashboard/ retained.
// CONTRACT: CLAUDE.md "Visual UI verification — use gsd-browser" mandate:
//   structured E2E tests live at `tests/e2e/<area>/<spec>.spec.ts` and run
//   via `npx playwright test` (gsd-browser is for manual smoke). The
//   `unified-viewer` project below boots Vite on :5173 and targets it.

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // Repo-wide timeout / expect defaults (mirrors tests/e2e/dashboard/playwright.config.ts).
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  // `webServer.reuseExistingServer: true` honors a pre-running `npm run dev`
  // on :5173 (the standing development setup); Playwright only spawns its
  // own Vite if nothing is listening on the port.
  // No top-level `use` — each project carries its own baseURL.
  projects: [
    {
      name: 'unified-viewer',
      testDir: 'tests/e2e/unified-viewer',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        // Headless Chromium ships with --disable-gpu by default; SwiftShader
        // provides a software WebGL backend so sigma's `<canvas>` boot path
        // (Pitfall 8 + T-45-02-01) renders without a real GPU. Without
        // these flags Plan 02's SigmaContainer throws
        // "Cannot read properties of null (reading 'blendFunc')" inside
        // the chromium WebGL adapter.
        launchOptions: {
          args: ['--use-gl=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
        },
      },
    },
    // Existing dashboard project — keeps tests/e2e/dashboard/*.spec.ts
    // discoverable via `npx playwright test --project=dashboard`.
    {
      name: 'dashboard',
      testDir: 'tests/e2e/dashboard',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3032',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],
  // Vite dev server contract:
  //
  // We intentionally OMIT the `webServer:` block. The operator-managed
  // `npm run dev` on :5173 is the supported workflow (see CLAUDE.md +
  // 45-PATTERNS.md + the Plan 02 SigmaCanvas test hook). When run from
  // a parallel-execution worktree that lacks node_modules, Playwright
  // cannot spawn its own Vite — but the standing dev server is already
  // available, so the tests target it directly via `baseURL`.
  //
  // CI / fresh-clone runs should `cd integrations/unified-viewer &&
  // npm install && npm run dev &` before invoking `npx playwright test`.
  // Adding a webServer block here triggered a Playwright bug where the
  // `httpHappyEyeballsAgent` returned 404 for a running Vite on macOS
  // dual-stack — root cause unknown, possibly related to the Node v25
  // happyEyeballs + macOS getaddrinfo interaction. Direct
  // `http.request(url, {agent: httpHappyEyeballsAgent})` returns 200,
  // but `npx playwright test` consistently sees 404, so the safest
  // contract is "operator runs the server, tests assume it's up".
})
