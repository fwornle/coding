/**
 * tests/e2e/performance/canonical-columns.spec.ts
 *
 * Phase 75 Plan 01 (Wave 0) — RED e2e spec for the ATTR-02 two-column model
 * render + the empty-canonical sentinel (D-05).
 *
 * RED today because:
 *   - The runs table renders a single `run.model` cell; the canonical (chat)
 *     model column and the background-service-models column do NOT exist yet.
 *   - The data-testid hooks this spec queries — `run-canonical-model` and
 *     `run-background-models` — are the contract Plan 06 must expose.
 *   - The "unmeasured" empty-canonical sentinel (legacy Run with no ATTR-03
 *     foreground capture) and the "—" empty-background sentinel are not rendered.
 *
 * Per CLAUDE.md `gsd-browser` rule:
 *   - Structured E2E goes under tests/e2e/<area>/<spec>.spec.ts and runs via
 *     `npx playwright test`. Ad-hoc smokes use the `gsd-browser` CLI.
 *   - DO NOT hand-roll an inline `chromium.launch()` script.
 *
 * Offline guard: the dashboard at localhost:3032 is operator-managed and may not
 * be running in CI / a fresh checkout. Each test skips (does not hard-fail) when
 * the Performance tab is unreachable, so this spec can sit RED in the suite
 * until Plan 06 ships the columns AND a live dashboard is available — it never
 * blocks the suite on an absent server.
 */

import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3032';
const PERFORMANCE_TAB = '[data-testid="performance-tab"]';
const RUNS_TABLE = '[data-testid="runs-table"]';
const CANONICAL_MODEL_CELL = '[data-testid="run-canonical-model"]';
const BACKGROUND_MODELS_CELL = '[data-testid="run-background-models"]';

const CANONICAL_MODEL_HEADER = '[data-testid="runs-col-canonical-model"]';
const BACKGROUND_MODELS_HEADER = '[data-testid="runs-col-background-models"]';

const EMPTY_CANONICAL_SENTINEL = 'unmeasured';
const EMPTY_BACKGROUND_SENTINEL = '—';

/**
 * Navigate to the Performance tab. Returns false (→ test.skip) when the
 * dashboard is unreachable so the suite never hard-fails without a live server.
 */
async function gotoPerformance(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { timeout: 8_000 });
    await page.waitForSelector(PERFORMANCE_TAB, { timeout: 8_000 });
    await page.click(PERFORMANCE_TAB);
    await page.waitForSelector(RUNS_TABLE, { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('Phase 75 ATTR-02 — two model columns + empty-canonical sentinel (Wave 0 RED)', () => {
  test('runs table renders TWO model columns (canonical chat model | background service models)', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — RED until Plan 06 + live dashboard');

    // Both column headers must exist — the Plan 06 contract.
    await expect(page.locator(CANONICAL_MODEL_HEADER)).toBeVisible();
    await expect(page.locator(BACKGROUND_MODELS_HEADER)).toBeVisible();

    // And the per-row cells the headers describe.
    await expect(page.locator(CANONICAL_MODEL_CELL).first()).toBeVisible();
    await expect(page.locator(BACKGROUND_MODELS_CELL).first()).toBeVisible();
  });

  test('legacy Run (no canonical capture) shows the "unmeasured" sentinel, NOT a dominant fallback', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — RED until Plan 06 + live dashboard');

    // D-05: an empty canonical renders "unmeasured" — never silently falls back
    // to the dominant-by-count model.
    const sentinel = page.locator(CANONICAL_MODEL_CELL, { hasText: EMPTY_CANONICAL_SENTINEL });
    await expect(sentinel.first()).toBeVisible();
  });

  test('empty background-models cell renders the "—" sentinel', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — RED until Plan 06 + live dashboard');

    const emDash = page.locator(BACKGROUND_MODELS_CELL, { hasText: EMPTY_BACKGROUND_SENTINEL });
    await expect(emDash.first()).toBeVisible();
  });
});
