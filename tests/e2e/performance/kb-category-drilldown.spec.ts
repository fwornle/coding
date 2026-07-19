/**
 * tests/e2e/performance/kb-category-drilldown.spec.ts
 *
 * Phase A of the "real per-category KB content" feature (context-cache-explainer.tsx):
 * the "Retrieved Knowledge — the injected context block" sub-modal now segments the
 * captured knowledge_text into its 5 categories (Working Memory / Insights / Digests /
 * Entities / Observations), shows real abbreviated content per category, and each
 * populated category opens a 3rd-level drill-down sub-modal with the full content.
 *
 * Contract under test:
 *   - A run WITH captured knowledge_text: each present KB category row shows real
 *     content and is clickable → [data-testid="kb-category-dialog"] with item cards.
 *   - A run whose agent injects NO KB block (opencode/copilot): the KB modal shows the
 *     honest agent-specific empty-state ([data-testid="kb-no-content"]).
 *
 * Driven deterministically via the exposed Redux store (window.__REDUX_STORE__ +
 * performance/setExplainTaskId) so we don't depend on a specific run being on the
 * visible/​paginated runs table.
 *
 * Offline guard: skips (never hard-fails) when the dashboard at :3032 is unreachable
 * or no run with the required data shape exists (fresh checkout / CI).
 */

import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3032';
const PERFORMANCE_TAB = '[data-testid="performance-tab"]';
const EXPLAINER = '[data-testid="context-cache-explainer"]';
const KB_SEGMENT = '[data-testid="kb-segment"]';
const KB_DIALOG = '[data-testid="kb-detail-dialog"]';
const KB_CATEGORY_DIALOG = '[data-testid="kb-category-dialog"]';

async function gotoPerformance(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { timeout: 8_000 });
    await page.waitForSelector(PERFORMANCE_TAB, { timeout: 8_000 });
    await page.click(PERFORMANCE_TAB);
    await page.waitForSelector('[data-testid="runs-table"]', { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

// Find (a) a run whose capture has non-empty knowledge_text (populated KB), and
// (b) an ILLUSTRATIVE run with no usable per-run capture (real=null in the modal),
// preferring a non-Claude agent so the empty-state shows the agent-specific message.
// The illustrative case is the one the user actually hit (opencode copilot-direct
// run): the `know` band segment still renders, so the KB modal opens (empty).
async function findRuns(page: Page): Promise<{ populated: string | null; illustrative: string | null }> {
  return page.evaluate(async () => {
    const out: { populated: string | null; illustrative: string | null } = { populated: null, illustrative: null };
    const rowsRes = await fetch('/api/experiments/runs').then((r) => r.json()).catch(() => null);
    const rows: any[] = rowsRes?.rows ?? [];
    for (const r of rows) {
      const id = r.task_id;
      if (!id) continue;
      const agent = String(r.canonical_agent ?? r.agent ?? '');
      const d = await fetch('/api/context-breakdown?task_id=' + encodeURIComponent(id))
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      const usable = d && Array.isArray(d.categories) && d.total_bytes > 0;
      if (usable && (d.knowledge_text || '').trim()) {
        if (!out.populated) out.populated = id;
      } else if (!usable && !out.illustrative && agent && !/claude/i.test(agent)) {
        out.illustrative = id;
      }
      if (out.populated && out.illustrative) break;
    }
    return out;
  });
}

// Open the explainer via the run's real "Explain" button (its aria-label embeds the
// task_id). The runs table paginates 15 rows at a time, so reveal more rows until the
// target run's button is present. Returns false if the run never surfaces.
async function openExplainer(page: Page, taskId: string): Promise<boolean> {
  const btn = page.locator(`button[aria-label="Explain context and caching for ${taskId}"]`);
  for (let i = 0; i < 8; i++) {
    if ((await btn.count()) > 0) break;
    const more = page.locator('[data-testid="runs-pagination"] button');
    if ((await more.count()) === 0) break;
    await more.first().click();
    await page.waitForTimeout(200);
  }
  if ((await btn.count()) === 0) return false;
  await btn.first().scrollIntoViewIfNeeded();
  await btn.first().click();
  await page.waitForSelector(EXPLAINER, { timeout: 8_000 });
  // The band (and its kb-segment) render even for illustrative runs; the per-run
  // capture is fetched async after the dialog opens.
  await page.waitForSelector(KB_SEGMENT, { timeout: 8_000 });
  return true;
}

test.describe('Performance — Retrieved-Knowledge per-category drill-down', () => {
  test('a populated run breaks the KB block into clickable categories with item cards', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const { populated } = await findRuns(page);
    test.skip(!populated, 'no run with captured knowledge_text available');

    const opened = await openExplainer(page, populated as string);
    test.skip(!opened, 'populated run not reachable in the runs table');
    await page.click(KB_SEGMENT);
    await expect(page.locator(KB_DIALOG)).toBeVisible();

    // Real content path is shown (not the "no capture" empty-state).
    await expect(page.locator('[data-testid="kb-real-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="kb-no-content"]')).toHaveCount(0);

    // At least one category row is populated + clickable. Insights/Digests/Entities/
    // Observations are the semantic tiers; Working Memory is always present too.
    const clickable = page.locator(
      '[data-testid="kb-detail-dialog"] button[data-testid^="kb-section-"]',
    );
    const n = await clickable.count();
    expect(n).toBeGreaterThan(0);

    // Drill into the first populated category → 3rd-level sub-modal with item cards.
    await clickable.first().click();
    await expect(page.locator(KB_CATEGORY_DIALOG)).toBeVisible();
    await expect(
      page.locator(`${KB_CATEGORY_DIALOG} [data-testid="kb-item-card"]`).first(),
    ).toBeVisible();
  });

  test('a non-injecting agent run shows the honest agent-specific empty state', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const { illustrative } = await findRuns(page);
    test.skip(!illustrative, 'no illustrative non-Claude run available');

    const opened = await openExplainer(page, illustrative as string);
    test.skip(!opened, 'illustrative run not reachable in the runs table');
    await page.click(KB_SEGMENT);
    await expect(page.locator(KB_DIALOG)).toBeVisible();

    // No real content; the empty-state explains WHY, naming the agent and that it
    // doesn't inject the KB block (rather than a misleading generic "re-run").
    const empty = page.locator('[data-testid="kb-no-content"]');
    await expect(empty).toBeVisible();
    await expect(page.locator('[data-testid="kb-real-content"]')).toHaveCount(0);
    await expect(empty).toContainText(/doesn’t inject|does not inject|no captured buffer/i);
  });
});
