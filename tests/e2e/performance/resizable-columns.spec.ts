/**
 * tests/e2e/performance/resizable-columns.spec.ts
 *
 * Runs-table column resizing + reset, and the clickable-element hover affordance
 * (pointer cursor on action buttons). Covers the change that made the Performance
 * runs table's columns draggable with a "Reset columns" control.
 *
 * Contract under test (src/components/performance/runs-table.tsx):
 *   - The table is fixed-layout, driven by a <colgroup> whose <col> widths come
 *     from state hydrated from localStorage['perf.runsTable.colWidths'].
 *   - Each header cell (except the checkbox column) carries a drag handle
 *     `data-testid="col-resize-<colId>"`; dragging it right widens THAT column.
 *   - `data-testid="reset-columns"` restores defaults and clears the stored key;
 *     it is disabled while widths already equal the defaults.
 *   - Action buttons (shadcn Button) expose `cursor: pointer` (the affordance).
 *
 * Per CLAUDE.md gsd-browser rule: structured E2E lives here and runs via
 * `npx playwright test`; ad-hoc smokes use the gsd-browser CLI. No inline
 * chromium.launch().
 *
 * Offline guard: the dashboard at localhost:3032 is operator-managed and may be
 * absent in CI / a fresh checkout. Each test skips (never hard-fails) when the
 * Performance tab is unreachable or the runs table is empty (no rows to act on).
 */

import { test, expect, type Page } from '@playwright/test';

const DASHBOARD_URL = 'http://localhost:3032';
const PERFORMANCE_TAB = '[data-testid="performance-tab"]';
const RUNS_TABLE = '[data-testid="runs-table"]';
const RESET_BUTTON = '[data-testid="reset-columns"]';
const RUN_HANDLE = '[data-testid="col-resize-run"]';
const STORAGE_KEY = 'perf.runsTable.colWidths';

async function gotoPerformance(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { timeout: 8_000 });
    await page.waitForSelector(PERFORMANCE_TAB, { timeout: 8_000 });
    await page.click(PERFORMANCE_TAB);
    await page.waitForSelector(RUNS_TABLE, { timeout: 8_000 });
    // Start every test from the default layout so assertions are deterministic
    // regardless of a width persisted by a prior run or manual session.
    await page.evaluate((k) => window.localStorage.removeItem(k), STORAGE_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(RUNS_TABLE, { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

// The <col> width (px, as a number) for a given column index in the runs table.
async function colWidth(page: Page, index: number): Promise<number> {
  return page.evaluate((i) => {
    const cols = document.querySelectorAll('[data-testid="runs-table"] colgroup col');
    return parseInt((cols[i] as HTMLElement)?.style.width || '0', 10);
  }, index);
}

// Drag a resize handle horizontally by `dx` px using a real mouse gesture.
// `page.mouse` uses viewport coordinates and does NOT auto-scroll, and the runs
// table sits well below the fold — scroll the handle into view first.
async function dragHandle(page: Page, selector: string, dx: number): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`handle ${selector} has no bounding box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test.describe('Performance runs table — resizable columns + reset', () => {
  test('table is fixed-layout with per-column handles and a disabled-at-default reset', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    // Fixed layout is what makes the <col> widths authoritative.
    const layout = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="runs-table"] table')!).tableLayout,
    );
    expect(layout).toBe('fixed');

    // A handle per data column (every column except the checkbox column).
    const handles = await page.locator('[data-testid^="col-resize-"]').count();
    expect(handles).toBeGreaterThanOrEqual(10);

    // At the default layout, Reset is present but disabled.
    await expect(page.locator(RESET_BUTTON)).toBeDisabled();
  });

  test('dragging a handle widens that column and enables Reset', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const before = await colWidth(page, 1); // index 1 = the "run" column
    expect(before).toBeGreaterThan(0);

    await dragHandle(page, RUN_HANDLE, 120);

    const after = await colWidth(page, 1);
    expect(after).toBeGreaterThan(before + 80); // ~+120, allow slack for gesture
    await expect(page.locator(RESET_BUTTON)).toBeEnabled();

    // Width is persisted for next visit.
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored as string).run).toBeGreaterThan(before + 80);
  });

  test('a resized width survives a page reload', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const before = await colWidth(page, 1);
    await dragHandle(page, RUN_HANDLE, 100);
    const resized = await colWidth(page, 1);
    expect(resized).toBeGreaterThan(before);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(RUNS_TABLE, { timeout: 8_000 });

    expect(await colWidth(page, 1)).toBe(resized);
  });

  test('Reset restores default widths and clears the stored key', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    const def = await colWidth(page, 1);
    await dragHandle(page, RUN_HANDLE, 120);
    expect(await colWidth(page, 1)).toBeGreaterThan(def);

    await page.locator(RESET_BUTTON).click();

    expect(await colWidth(page, 1)).toBe(def);
    await expect(page.locator(RESET_BUTTON)).toBeDisabled();
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBeNull();
  });

  test('enabled action buttons expose a pointer cursor (clickable affordance)', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    // Any row action button — "Edit scores" is present on every row.
    const btn = page.locator('[data-testid="edit-scores"]').first();
    const hasRow = (await btn.count()) > 0;
    test.skip(!hasRow, 'no runs present — nothing to hover');

    const cursor = await btn.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('pointer');
  });

  test('disabled buttons show a not-allowed cursor (hover feedback, no pass-through)', async ({ page }) => {
    const up = await gotoPerformance(page);
    test.skip(!up, 'dashboard at localhost:3032 not running');

    // Reset is disabled at the default layout. Previously `disabled:pointer-events-none`
    // made the hover fall through to the parent (plain arrow, no signal); now a disabled
    // button owns its hover and shows `not-allowed`.
    const reset = page.locator(RESET_BUTTON);
    await expect(reset).toBeDisabled();
    const cursor = await reset.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('not-allowed');
    // And the button itself is the hit target at its own center (not skipped).
    const owns = await reset.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || el.contains(top as Node);
    });
    expect(owns).toBe(true);
  });
});
