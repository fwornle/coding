/**
 * tests/e2e/performance/experiment-control.spec.ts
 *
 * Phase 85 Plan 06 (Wave 5) — structural e2e for the Experiment Control Center
 * on the Performance tab (D-01/D-08/D-09/D-11/D-12). This spec proves the STATIC
 * launcher / monitor / re-run STRUCTURE renders and its data-testids exist; the
 * live launch→monitor→cancel→re-run DYNAMICS are the human-gated Task 2 (a real
 * host spawn cannot run deterministically in a headless assertion).
 *
 * What it asserts (against a deployed :3032 dashboard):
 *   - the Experiment Launcher card renders on the Performance tab
 *     (`spec-select`, `capture-raw-bodies`, `launch-experiment`)
 *   - selecting a real spec (populated from GET /api/experiments/specs via the
 *     proxy → vkb-server) reveals the server-resolved matrix preview
 *     (`matrix-preview` + a numeric `matrix-cell-count`, D-09)
 *   - the capture_raw_bodies checkbox exists and defaults OFF (D-12)
 *   - a Re-run button (`rerun-experiment`) appears on a completed experiment run
 *     row and, when clicked, pre-fills the launcher (`rerun-banner`, D-11)
 *
 * Per CLAUDE.md `gsd-browser` rule:
 *   - Structured E2E goes under tests/e2e/<area>/<spec>.spec.ts and runs via
 *     `npx playwright test`. Ad-hoc smokes / screenshots use the `gsd-browser` CLI.
 *   - DO NOT hand-roll an inline `chromium.launch()` script.
 *
 * Offline guard: the dashboard at localhost:3032 is operator-managed and may not
 * be running in CI / a fresh checkout. Each test skips (does not hard-fail) when
 * the Performance tab is unreachable, mirroring canonical-columns.spec.ts — the
 * spec never blocks the suite on an absent server. The re-run assertion also
 * skips gracefully when the runs table holds no completed experiment run (a
 * seeded/idle dashboard) — it asserts structure only when the row is present.
 */

import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3032';
const PERFORMANCE_TAB = '[data-testid="performance-tab"]';

const SPEC_SELECT = '[data-testid="spec-select"]';
const MATRIX_PREVIEW = '[data-testid="matrix-preview"]';
const MATRIX_CELL_COUNT = '[data-testid="matrix-cell-count"]';
const CAPTURE_RAW_BODIES = '[data-testid="capture-raw-bodies"]';
const LAUNCH_EXPERIMENT = '[data-testid="launch-experiment"]';
const RERUN_EXPERIMENT = '[data-testid="rerun-experiment"]';
const RERUN_BANNER = '[data-testid="rerun-banner"]';

/**
 * Navigate to the Performance tab. Returns false (→ test.skip) when the
 * dashboard is unreachable so the suite never hard-fails without a live server.
 *
 * Gate on the Experiment Launcher's `spec-select`, NOT the runs table: the
 * runs table renders only when runs exist ("No runs recorded yet" on a fresh
 * dashboard has no `runs-table`), whereas the launcher always renders on the
 * Performance tab — it is the control surface this spec asserts.
 */
async function gotoPerformance(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { timeout: 8_000 });
    await page.waitForSelector(PERFORMANCE_TAB, { timeout: 8_000 });
    await page.click(PERFORMANCE_TAB);
    await page.waitForSelector(SPEC_SELECT, { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('Phase 85 Experiment Control Center — launcher / matrix preview / re-run structure', () => {
  test('the Experiment Launcher card renders with spec-select + capture + launch controls', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — Task 2 human gate covers live');

    // The launcher's core controls — the operator CONTROL surface (D-09/D-12).
    await expect(page.locator(SPEC_SELECT)).toBeVisible();
    await expect(page.locator(CAPTURE_RAW_BODIES)).toBeVisible();
    await expect(page.locator(LAUNCH_EXPERIMENT)).toBeVisible();
  });

  test('capture_raw_bodies defaults OFF (D-12 — explicit opt-in)', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — Task 2 human gate covers live');

    // The checkbox is a shadcn Checkbox (role=checkbox) labelled by the
    // capture-raw-bodies span; it must start unchecked.
    const checkbox = page.getByRole('checkbox').filter({ has: page.locator(':scope') });
    // Prefer an explicit id-anchored lookup: the span sits inside the same label
    // as the checkbox; assert the checkbox next to the capture span is not checked.
    const captureRow = page.locator('label', { has: page.locator(CAPTURE_RAW_BODIES) });
    const box = captureRow.getByRole('checkbox');
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    // Silence the unused-locator lint without weakening the primary assertion.
    void checkbox;
  });

  test('selecting a spec reveals the server-resolved matrix preview with a numeric cell count (D-09)', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — Task 2 human gate covers live');

    const select = page.locator(SPEC_SELECT);
    await expect(select).toBeVisible();

    // Pick the first real (non-placeholder, non-malformed) spec option. The
    // placeholder option has value="" — choose the first option with a value.
    const optionValues = await select.locator('option').evaluateAll((opts) =>
      (opts as HTMLOptionElement[])
        .filter((o) => o.value !== '' && !o.disabled)
        .map((o) => o.value)
    );
    test.skip(optionValues.length === 0, 'no experiment specs listed (config/experiments empty on this host)');

    await select.selectOption(optionValues[0]);

    // D-09: the matrix preview appears with a numeric cell count read from the
    // server's variantCount × repeats (never a client-side axes recompute).
    await expect(page.locator(MATRIX_PREVIEW)).toBeVisible();
    const cellCountText = (await page.locator(MATRIX_CELL_COUNT).textContent())?.trim() ?? '';
    expect(cellCountText).toMatch(/^\d+$/);
    expect(Number(cellCountText)).toBeGreaterThan(0);
  });

  test('a completed experiment run row exposes a Re-run button that pre-fills the launcher (D-11)', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running — Task 2 human gate covers live');

    const rerunButtons = page.locator(RERUN_EXPERIMENT);
    const count = await rerunButtons.count();
    // A seeded/idle dashboard may hold no completed experiment run — the Re-run
    // guard (variant/base_variant provenance + terminal_state==='complete') then
    // renders no button. Skip rather than fail; the live gate (Task 2) drives a
    // real re-run against a freshly-completed run.
    test.skip(count === 0, 'no completed experiment run in the table — Task 2 human gate drives a live re-run');

    await rerunButtons.first().click();

    // D-11: clicking Re-run seeds the launcher prefill → the rerun banner renders.
    await expect(page.locator(RERUN_BANNER)).toBeVisible();
    // And the spec select is now non-empty (pre-filled with the run's spec).
    await expect(page.locator(SPEC_SELECT)).not.toHaveValue('');
  });
});
