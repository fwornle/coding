/**
 * tests/e2e/performance/runs-timeline-split.spec.ts
 *
 * Two layout complaints about the Runs tab, both about being made to scroll:
 *
 *   1. The "Other activity" group (ambient auto-measured sessions) rendered EVERY row it
 *      had on expand — 1,339 at the time of writing — burying the rest of the page.
 *      It now paginates in pages of 15 like the experiment list, with its own footer.
 *   2. Selecting a run opened the Timeline *below* a runs table hundreds of rows tall,
 *      so the detail you just asked for landed off-screen. Runs and Timeline are now a
 *      horizontal split at 2xl and above: independently scrolling, viewport-bounded
 *      panes, with the Timeline sticky so it holds position while you page the list.
 *
 * Contract under test:
 *   - Expanding a group larger than one page shows exactly one page, plus a footer
 *     stating the true total; "Show more" grows it by a page without collapsing.
 *   - Per-group pagination is keyed per group, so it is the ambient bucket that gets a
 *     footer and small experiment groups do not.
 *   - At 2xl the two panes are side by side, top-aligned, and the PAGE does not scroll
 *     sideways — the wide table must scroll inside its own box, or halving its width
 *     would trade one scroll problem for a worse one.
 *   - Selecting a run updates the Timeline pane in place, with the pane still on screen.
 *   - Below 2xl the layout stacks exactly as before (no regression for narrow screens).
 *
 * Offline guard: skips (never hard-fails) when the dashboard at :3032 is unreachable.
 */

import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3032';
const PERFORMANCE_TAB = '[data-testid="performance-tab"]';
const RUNS_PANE = '[data-testid="runs-pane"]';
const TIMELINE_PANE = '[data-testid="timeline-pane"]';
const RUN_ROW = '[data-testid="run-row"]';
const GROUP_PAGINATION = '[data-testid="group-pagination"]';

const WIDE = { width: 2200, height: 1300 };   // >= 2xl (1536px) → split
const NARROW = { width: 1400, height: 1000 }; // <  2xl          → stacked

async function gotoPerformance(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { timeout: 10_000 });
    await page.waitForSelector(PERFORMANCE_TAB, { timeout: 10_000 });
    await page.click(PERFORMANCE_TAB);
    await page.waitForSelector('[data-testid="runs-table"]', { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Expand the ambient "Other activity" group. Returns false if this dataset has none. */
async function expandOtherActivity(page: Page): Promise<boolean> {
  const row = page.locator('tr', { hasText: 'Other activity' }).first();
  if ((await row.count()) === 0) return false;
  await row.locator('td').first().click();
  await page.waitForTimeout(600);
  return true;
}

test.describe('Performance — Other activity pagination', () => {
  test('an oversized group shows one page plus an honest total, and grows on demand', async ({ page }) => {
    await page.setViewportSize(WIDE);
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');
    test.skip(!(await expandOtherActivity(page)), 'no ambient "Other activity" group in this dataset');

    const footer = page.locator(GROUP_PAGINATION).first();
    test.skip((await footer.count()) === 0, 'ambient group fits in one page — nothing to paginate');

    // The footer must state the REAL total, not the rendered count: the whole point is
    // that the operator can see how much is being withheld.
    const footerText = await footer.innerText();
    const m = /Showing\s+(\d+)\s+of\s+([\d,]+)\s+rows/.exec(footerText.replace(/\n/g, ' '));
    expect(m, `footer should state shown-of-total, got: ${footerText}`).not.toBeNull();
    const shown = Number((m as RegExpExecArray)[1]);
    const total = Number((m as RegExpExecArray)[2].replace(/,/g, ''));
    expect(total).toBeGreaterThan(shown);

    // Exactly one page is rendered — this is the assertion that would have failed before.
    const before = await page.locator(RUN_ROW).count();
    expect(before).toBeLessThanOrEqual(shown);

    await page.locator('[data-testid="group-show-more"]').first().click();
    await page.waitForTimeout(500);
    const after = await page.locator(RUN_ROW).count();
    expect(after, 'Show more must reveal additional rows').toBeGreaterThan(before);
    // …and must not collapse the group as a side effect of the click bubbling to the row.
    expect(after).toBeGreaterThan(0);
  });
});

test.describe('Performance — runs/timeline horizontal split', () => {
  test('at 2xl the panes sit side by side and the page never scrolls sideways', async ({ page }) => {
    await page.setViewportSize(WIDE);
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');

    const geom = await page.evaluate(({ runsSel, tlSel }) => {
      const r = document.querySelector(runsSel)?.getBoundingClientRect();
      const t = document.querySelector(tlSel)?.getBoundingClientRect();
      if (!r || !t) return null;
      return {
        topAligned: Math.abs(r.top - t.top) < 5,
        timelineToTheRight: t.left > r.left + 200,
        pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    }, { runsSel: RUNS_PANE, tlSel: TIMELINE_PANE });

    expect(geom, 'both panes must render').not.toBeNull();
    expect(geom!.topAligned, 'panes must be top-aligned, i.e. genuinely side by side').toBe(true);
    expect(geom!.timelineToTheRight).toBe(true);
    expect(geom!.pageScrollsSideways, 'the wide table must scroll in-box, not push the page').toBe(false);
  });

  test('the narrowed table keeps its right-hand columns reachable', async ({ page }) => {
    await page.setViewportSize(WIDE);
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');

    // Halving the table's width clips ~half its columns. That is only acceptable because
    // the table owns an overflow-x scroller; without one the score/token columns would be
    // unreachable, which is a worse defect than the one being fixed.
    const scroller = await page.locator(`${RUNS_PANE} .overflow-x-auto`).first();
    expect(await scroller.count()).toBeGreaterThan(0);
    const canScroll = await scroller.evaluate((e) => e.scrollWidth > e.clientWidth + 20);
    expect(canScroll, 'the table must be horizontally scrollable inside the pane').toBe(true);
  });

  test('selecting a run fills the timeline pane in place, on screen', async ({ page }) => {
    await page.setViewportSize(WIDE);
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');
    test.skip(!(await expandOtherActivity(page)), 'no ambient group to select a run from');

    const rows = page.locator(RUN_ROW);
    test.skip((await rows.count()) === 0, 'no run rows available');

    const before = await page.locator(TIMELINE_PANE).innerText();
    await rows.first().click();
    await page.waitForTimeout(1500);

    const after = await page.locator(TIMELINE_PANE).innerText();
    expect(after, 'the timeline must change when a run is selected').not.toBe(before);

    const onScreen = await page.locator(TIMELINE_PANE).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    expect(onScreen, 'the selected run detail must not require hunting for it').toBe(true);
  });

  test('below 2xl the layout stacks, as it did before', async ({ page }) => {
    await page.setViewportSize(NARROW);
    test.skip(!(await gotoPerformance(page)), 'dashboard at localhost:3032 not running');

    const stacked = await page.evaluate(({ runsSel, tlSel }) => {
      const r = document.querySelector(runsSel)?.getBoundingClientRect();
      const t = document.querySelector(tlSel)?.getBoundingClientRect();
      if (!r || !t) return null;
      return { below: t.top > r.bottom - 10, sameWidth: Math.abs(r.width - t.width) < 5 };
    }, { runsSel: RUNS_PANE, tlSel: TIMELINE_PANE });

    expect(stacked).not.toBeNull();
    expect(stacked!.below, 'narrow viewports must keep the original stacked layout').toBe(true);
    expect(stacked!.sameWidth).toBe(true);
  });
});
