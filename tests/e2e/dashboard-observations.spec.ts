/**
 * tests/e2e/dashboard-observations.spec.ts
 *
 * Phase 44 Wave 0 — RED until:
 *   * Plan 44-10 (SQLite → km-core migration) populates km-core with
 *     observations carrying populated agent + project metadata.
 *   * Plan 44-07 (A typed-view cutover) mounts /api/coding/observations as
 *     a typed view reading km-core entities and reshaping via
 *     lib/km-core/src/adapters/observation-view.ts.
 *   * Plan 44-11 (verification) adds the data-testid attributes the spec
 *     queries — `data-testid="observations-table"`,
 *     `data-testid^="observation-row-"`, `data-testid="cell-agent"`,
 *     `data-testid="cell-project"`. If the dashboard panel already uses
 *     different testids the spec MUST be updated in Plan 44-11 to match
 *     the actual selectors (a deviation captured in Plan 44-11's SUMMARY).
 *
 * Pitfall 2 lock: after A's typed-view cutover the dashboard at :3032 must
 * keep rendering agent + project cells from observations exactly as it did
 * pre-migration. Empty cells = migration regression.
 *
 * EXPECTED FAILURE MODE (RED today):
 *   * The dashboard panel currently does NOT advertise
 *     `data-testid="observations-table"` (verify via gsd-browser snapshot
 *     of localhost:3032). The `page.waitForSelector(...)` call will time
 *     out after 15s with a clear "selector not found" error naming the
 *     missing testid.
 *   * Even if a testid were present today, the dashboard reads
 *     /api/observations (the legacy SQLite path) — agent/project cells
 *     ARE populated today from SQLite. The migration regression we guard
 *     against is the FUTURE state where Plan 44-07 routes the dashboard
 *     through typed views and Plan 44-10 owns the data migration.
 *
 * Per CLAUDE.md `gsd-browser` rule:
 *   * Structured E2E goes under tests/e2e/<area>/<spec>.spec.ts and runs
 *     via `npx playwright test`.
 *   * Ad-hoc smokes against localhost:3032 use the `gsd-browser` CLI
 *     (`gsd-browser navigate http://localhost:3032 && gsd-browser screenshot`).
 *   * DO NOT hand-roll an inline `chromium.launch()` script — that
 *     re-triggers the `prefer-gsd-browser` constraint per CLAUDE.md.
 */

import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const CODING_ROOT = join(__dirname2, '..', '..');
const ARTIFACTS_DIR = join(CODING_ROOT, 'tests', 'e2e', '_artifacts');

const DASHBOARD_URL = 'http://localhost:3032';
const OBSERVATIONS_TABLE_SELECTOR = '[data-testid="observations-table"]';
const ROW_SELECTOR = '[data-testid^="observation-row-"]';
const AGENT_CELL_SELECTOR = '[data-testid="cell-agent"]';
const PROJECT_CELL_SELECTOR = '[data-testid="cell-project"]';

async function navigateToObservations(page: Page) {
  await page.goto(DASHBOARD_URL);
  // Wait for the observations panel — Plan 44-11 will add this testid OR
  // the spec must be relaxed during verification. RED today.
  await page.waitForSelector(OBSERVATIONS_TABLE_SELECTOR, { timeout: 15_000 });
  // Polling settle (mirrors the workflow-graph-colors.spec.ts:73 pattern).
  await page.waitForTimeout(2000);
}

test.describe('Phase 44 dashboard observations panel (Wave 0 RED)', () => {
  test('observations panel renders with [data-testid="observations-table"]', async ({ page }) => {
    await navigateToObservations(page);
    const table = page.locator(OBSERVATIONS_TABLE_SELECTOR);
    await expect(table).toBeVisible();
  });

  test('first observation row populates agent + project cells (Pitfall 2 lock)', async ({ page }) => {
    await navigateToObservations(page);
    const firstRow = page.locator(ROW_SELECTOR).first();
    await expect(firstRow).toBeVisible();
    const agentCell = firstRow.locator(AGENT_CELL_SELECTOR);
    const projectCell = firstRow.locator(PROJECT_CELL_SELECTOR);
    await expect(agentCell).not.toHaveText('');
    await expect(projectCell).not.toHaveText('');
  });

  test('smoke screenshot for audit trail under tests/e2e/_artifacts/', async ({ page }) => {
    await navigateToObservations(page);
    if (!existsSync(ARTIFACTS_DIR)) {
      mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }
    const outPath = join(ARTIFACTS_DIR, `dashboard-observations-${Date.now()}.png`);
    // Per CLAUDE.md gsd-browser rule: a structured E2E may take screenshots
    // via the playwright Page API. Ad-hoc smokes outside this spec use the
    // gsd-browser CLI instead.
    await page.screenshot({ path: outPath, fullPage: true });
    expect(existsSync(outPath)).toBe(true);
  });
});
