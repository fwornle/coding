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
  // The runs table GROUPS by experiment and the per-cell rows — the only rows that
  // carry an Explain button — start collapsed. Without expanding first there are zero
  // such buttons on the page and every test in this file silently skips. (The table
  // gained grouping after this spec was written; the skip guard hid the regression.)
  const expandAll = page.getByRole('button', { name: 'Expand all' });
  if ((await expandAll.count()) > 0) {
    await expandAll.first().click();
    await page.waitForTimeout(500);
  }
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
    await expect(empty).toContainText(/inject|no captured buffer/i);
  });
});

/**
 * Per-turn capture + selection funnel.
 *
 * These assert the UI contract against a KNOWN payload via route interception rather
 * than whatever happens to be on disk: the shapes that matter most (a session with
 * several turns; a turn where NOTHING was injected; a stage whose drop list was capped)
 * are precisely the ones you cannot count on finding in live data.
 *
 * The behaviour under test only became possible when the capture stopped overwriting a
 * single file per session — before that a session had exactly one turn to show, always
 * the last, and a zero-item turn was discarded outright.
 */
const CAPTURE_ROUTE = '**/api/retrieve-capture**';

const mkTurn = (turn: number, itemCount: number, opts: { emptiedAt?: string; truncate?: boolean } = {}) => ({
  turn,
  capturedAt: `2026-08-22T10:0${turn}:00.000Z`,
  meta: { query: `prompt for turn ${turn}`, budget: 1000, results_count: itemCount, tokens_used: 120 * itemCount, latency_ms: 140 },
  items: Array.from({ length: itemCount }, (_, i) => ({
    id: `t${turn}-i${i}`, tier: 'insights', rrfScore: 0.4 - i * 0.05, score: 0.81,
    payload: { topic: `Turn ${turn} Insight ${i}`, confidence: 0.9, summary_preview: 'body' },
  })),
  trace: {
    candidates: { semantic: 80, keyword: 0, fused: 80 },
    injected: itemCount,
    tokens_used: 120 * itemCount,
    budget: 700,
    judge_outcome: 'judged',
    stages: [
      {
        name: 'idf-floor', in: 80, out: opts.emptiedAt === 'idf-floor' ? 0 : 52,
        dropped: Array.from({ length: opts.truncate ? 12 : 3 }, (_, i) => ({
          id: `drop-${i}`, tier: 'digests', title: `Off-topic item ${i}`, rrfScore: 0.2 - i * 0.01, score: 0.76,
        })),
        dropped_total: opts.truncate ? 28 : 3,
        note: 'dropped: shares no discriminating keyword with the query',
      },
      ...(opts.emptiedAt === 'idf-floor' ? [] : [
        { name: 'judge', in: 12, out: itemCount, dropped: [{ id: 'j1', tier: 'insights', title: 'Judged not useful', rrfScore: 0.15, score: 0.8 }], dropped_total: 12 - itemCount },
        { name: 'assembly', in: itemCount, out: itemCount, dropped: [], dropped_total: 0 },
      ]),
    ],
  },
});

test.describe('Performance — per-turn KB capture and the selection funnel', () => {
  /**
   * Open the KB dialog on ANY run, with /api/retrieve-capture mocked.
   *
   * Deliberately does NOT use findRuns(): that probes /api/context-breakdown once per
   * run (1300+ sequential fetches) to find a run with real captured knowledge_text.
   * These tests supply the capture themselves, so any run will do — the KB band
   * segment renders regardless of whether the run has its own capture.
   */
  async function openKbWithCapture(page: Page, payload: unknown): Promise<boolean> {
    await page.route(CAPTURE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    // Take the target from the DOM, not from /api/experiments/runs: the table filters
    // and paginates, so the API's first row is frequently not one of the rendered ones.
    const expandAll = page.getByRole('button', { name: 'Expand all' });
    if ((await expandAll.count()) > 0) {
      await expandAll.first().click();
      await page.waitForTimeout(500);
    }
    const explain = page.locator('button[aria-label^="Explain context and caching for "]');
    const total = await explain.count();
    if (total === 0) return false;
    // The band only renders a `know` segment when that run's captured buffer actually
    // carried retrieved knowledge, so not every run can open this modal. Try a handful
    // rather than probing all ~1300 (findRuns' approach, one HTTP call per run).
    for (let i = 0; i < Math.min(total, 12); i += 1) {
      await explain.nth(i).scrollIntoViewIfNeeded();
      await explain.nth(i).click();
      await page.waitForSelector(EXPLAINER, { timeout: 8_000 });
      const seg = page.locator(KB_SEGMENT);
      if (await seg.isVisible({ timeout: 2_500 }).catch(() => false)) {
        await seg.click();
        await expect(page.locator(KB_DIALOG)).toBeVisible();
        return true;
      }
      await page.keyboard.press('Escape');     // close the explainer, try the next run
      await page.waitForTimeout(200);
    }
    return false;
  }

  test('a multi-turn session offers a turn picker and switches captures locally', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const turns = [mkTurn(0, 3), mkTurn(1, 2), mkTurn(2, 4)];
    const ok = await openKbWithCapture(page, {
      task_id: 'mock', turn: 2, meta: turns[2].meta, items: turns[2].items, trace: turns[2].trace, turns,
    });
    test.skip(!ok, 'no run reachable in the runs table');

    const picker = page.locator('[data-testid="kb-turn-picker"]');
    await expect(picker).toBeVisible();
    await expect(picker).toContainText('Retrieval ran 3 times');
    await expect(page.locator('[data-testid="kb-turn-button"]')).toHaveCount(3);

    // Defaults to the LAST turn (4 items), matching the server's default selection.
    await expect(page.locator('[data-testid="kb-funnel"]')).toContainText('injected 4');

    // Selecting an earlier turn re-renders from local state — no refetch needed.
    await page.locator('[data-testid="kb-turn-button"]').first().click();
    await expect(page.locator('[data-testid="kb-funnel"]')).toContainText('injected 3');
    await expect(page.locator('[data-testid="kb-query-block"]')).toContainText('prompt for turn 0');
  });

  test('the funnel explains a turn where nothing was injected', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const empty = mkTurn(0, 0, { emptiedAt: 'idf-floor' });
    const ok = await openKbWithCapture(page, {
      task_id: 'mock', turn: 0, meta: empty.meta, items: [], trace: empty.trace, turns: [empty],
    });
    test.skip(!ok, 'no run reachable in the runs table');

    // The point: zero injected is an ANSWER, not a gap — and it names the stage.
    const callout = page.locator('[data-testid="kb-funnel-emptied"]');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText('Nothing was injected this turn');
    await expect(callout).toContainText('Relevance floor');
    await expect(callout).toContainText('That is the gate working');
  });

  test('a capped drop list says how many it is not showing', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const t = mkTurn(0, 3, { truncate: true });
    const ok = await openKbWithCapture(page, {
      task_id: 'mock', turn: 0, meta: t.meta, items: t.items, trace: t.trace, turns: [t],
    });
    test.skip(!ok, 'no run reachable in the runs table');

    // Expand the floor stage and confirm the sample is labelled as a sample.
    await page.locator('[data-testid="kb-funnel-stage-idf-floor"] summary').click();
    await expect(page.locator('[data-testid="kb-funnel-drop"]').first()).toBeVisible();
    const note = page.locator('[data-testid="kb-funnel-truncated"]').first();
    await expect(note).toBeVisible();
    await expect(note).toContainText('Showing the 12 highest-ranked of 28 dropped');
  });
});
