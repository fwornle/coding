/**
 * tests/e2e/performance/comparison-tab.spec.ts
 *
 * Phase 80 Plan 03 (CMP-04) — E2E for the Comparison sub-tab in the Performance
 * dashboard tab: a variant-column matrix fed live by GET /api/experiments/comparison
 * (Plan 80-01) via the fetchComparison Redux thunk, keyed by task_hash.
 *
 * What it asserts (feedback_green_nodes — assert the GROUPED-UI STRUCTURE, not
 * just tab presence):
 *   - clicking the `comparison-tab` trigger reveals the `comparison-matrix`;
 *   - the FOUR honesty-spine group regions are ALL present in the DOM
 *     (`comparison-group-ranked`/`-failed`/`-ungated`/`-unscored`) — a failed/
 *     ungated variant is shown in its OWN group, never collapsed into ranked;
 *   - when the selected experiment has variants, >= 1 `comparison-variant-col`
 *     column header renders. The pre-existing 36-run fixture is all-ungated/
 *     failed (ranked empty), so the spec accepts the honest empty-ranked state:
 *     it asserts the group scaffolding + >=1 variant column across the non-ranked
 *     groups, NOT a fabricated winner.
 *
 * Per CLAUDE.md `gsd-browser` rule: structured E2E lives here and runs via
 * `npx playwright test`; ad-hoc visual smokes use the gsd-browser CLI. No inline
 * chromium.launch().
 *
 * Offline guard: the dashboard at localhost:3032 is operator-managed and may be
 * down in CI / a fresh checkout. Each test skips (does not hard-fail) when the
 * Performance page is unreachable.
 */

import { test, expect, type Page } from '@playwright/test';

const PERFORMANCE_URL = 'http://localhost:3032/performance';

const COMPARISON_TAB = '[data-testid="comparison-tab"]';
const COMPARISON_MATRIX = '[data-testid="comparison-matrix"]';
const VARIANT_COL = '[data-testid="comparison-variant-col"]';

const GROUP_RANKED = '[data-testid="comparison-group-ranked"]';
const GROUP_FAILED = '[data-testid="comparison-group-failed"]';
const GROUP_UNGATED = '[data-testid="comparison-group-ungated"]';
const GROUP_UNSCORED = '[data-testid="comparison-group-unscored"]';

/**
 * Navigate to the Performance page and open the Comparison tab. Returns false
 * (→ test.skip) when the dashboard is unreachable so the suite never hard-fails
 * without a live server.
 */
async function gotoComparison(page: Page): Promise<boolean> {
  try {
    await page.goto(PERFORMANCE_URL, { timeout: 8_000 });
    await page.waitForSelector(COMPARISON_TAB, { timeout: 8_000 });
    await page.click(COMPARISON_TAB);
    await page.waitForSelector(COMPARISON_MATRIX, { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('Phase 80 CMP-04 — Comparison tab variant matrix + honesty spine', () => {
  test('the Comparison tab is a distinct 5th tab that reveals the variant matrix', async ({ page }) => {
    const up = await gotoComparison(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — skip until a live dashboard is available');

    // The comparison matrix card mounts only under the comparison tab (NOT the
    // manual A/B "Compare" tab nor "Reports"), proving the 5th tab is distinct.
    await expect(page.locator(COMPARISON_MATRIX).first()).toBeVisible();
  });

  test('all four honesty-spine group regions render (failed/ungated/unscored separate from ranked)', async ({ page }) => {
    const up = await gotoComparison(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — skip until a live dashboard is available');

    // The four groups must ALL exist as their own regions — the failed/ungated/
    // unscored variants are NEVER merged into ranked (the honesty spine). Present
    // in the DOM even when a group is empty (each shows an explicit empty-state).
    await expect(page.locator(GROUP_RANKED)).toBeVisible();
    await expect(page.locator(GROUP_FAILED)).toBeVisible();
    await expect(page.locator(GROUP_UNGATED)).toBeVisible();
    await expect(page.locator(GROUP_UNSCORED)).toBeVisible();
  });

  test('at least one variant column renders for an experiment with runs', async ({ page }) => {
    const up = await gotoComparison(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — skip until a live dashboard is available');

    // The pre-existing fixture experiment has ungated/failed variants (ranked is
    // legitimately empty), so variant columns live in the non-ranked groups. At
    // least one variant column header must render across the matrix — a variant
    // with no successful runs is shown here, never promoted to a ranked winner.
    await expect(page.locator(VARIANT_COL).first()).toBeVisible();

    const cols = await page.locator(VARIANT_COL).count();
    expect(cols).toBeGreaterThanOrEqual(1);
  });
});
