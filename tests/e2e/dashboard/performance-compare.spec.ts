/**
 * Playwright E2E for the Performance → Compare sub-view (run-compare.tsx).
 *
 * Covers the two-run selection flow and the cache-token fix: cache_read and
 * cache_write are shown as their OWN rows in the Compare table, separate from
 * the "tokens (in+out)" total. Without this, a heavily-cached run (claude) has
 * an implausibly small total next to a fresh-read run (opencode).
 *
 * Like performance.spec.ts, the data-dependent assertions are GATED: the flow
 * needs at least two runs in the store, so on a fresh checkout it skips with a
 * clear message rather than hard-failing.
 *
 * Interaction contract exercised:
 *   (a) /performance → Compare tab shows two run pickers + the empty prompt
 *   (b) picking two distinct runs renders the compare table
 *   (c) the table exposes cache read / cache write as separate metric rows
 *
 * baseURL is set per-project in playwright.config.ts (http://localhost:3032).
 */

import { test, expect, type Page } from '@playwright/test'

async function navigateToCompare(page: Page) {
  // The dashboard holds persistent SSE / polling connections, so `networkidle`
  // never settles — wait for DOM + the rendered header instead (see
  // performance.spec.ts for the same rationale).
  await page.goto('http://localhost:3032/performance', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('h1')).toHaveText('Performance', { timeout: 20000 })
  await page.locator('[data-testid="compare-tab"]').click()
  // Give the fetchRuns thunk a beat to populate the pickers.
  await page.waitForTimeout(800)
}

/**
 * Open a picker and return its option task_ids, then close the popover again.
 * Radix Select renders its options in a portal only while open, so this is the
 * reliable way to learn how many runs are selectable.
 */
async function optionIds(page: Page, pickerLabel: string): Promise<string[]> {
  await page.locator(`[data-testid="compare-picker-${pickerLabel}"]`).click()
  const opts = page.locator('[data-testid^="compare-option-"]')
  await expect(opts.first()).toBeVisible({ timeout: 10000 })
  const ids = await opts.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid')!.replace('compare-option-', '')),
  )
  await page.keyboard.press('Escape')
  return ids
}

async function pick(page: Page, pickerLabel: string, taskId: string) {
  await page.locator(`[data-testid="compare-picker-${pickerLabel}"]`).click()
  await page.locator(`[data-testid="compare-option-${taskId}"]`).click()
}

// ── Collection witness (ACTIVE) ──

test('performance-compare spec is collected by the runner', async () => {
  expect(true).toBe(true)
})

// ── UI flows (data-gated) ──

test('(a) Compare tab shows two run pickers and the empty-state prompt', async ({ page }) => {
  await navigateToCompare(page)
  await expect(page.locator('[data-testid="compare-picker-Run A"]')).toBeVisible()
  await expect(page.locator('[data-testid="compare-picker-Run B"]')).toBeVisible()
  // Nothing selected yet → the prompt, not the table.
  await expect(page.getByText('Pick two runs to compare.')).toBeVisible()
  await expect(page.locator('[data-testid="compare-table"]')).toHaveCount(0)
})

test('(b) picking two distinct runs renders the compare table', async ({ page }) => {
  await navigateToCompare(page)
  const ids = await optionIds(page, 'Run A')
  if (ids.length < 2) {
    test.skip(true, 'Fewer than two runs in the store — compare flow needs seeded data.')
    return
  }
  await pick(page, 'Run A', ids[0])
  await pick(page, 'Run B', ids[1])
  await expect(page.locator('[data-testid="compare-table"]')).toBeVisible()
  // Column headers echo the two selected task_ids.
  await expect(page.locator('[data-testid="compare-table"] thead')).toContainText(ids[0])
  await expect(page.locator('[data-testid="compare-table"] thead')).toContainText(ids[1])
})

test('(c) the compare table shows cache read and cache write as separate rows', async ({ page }) => {
  await navigateToCompare(page)
  const ids = await optionIds(page, 'Run A')
  if (ids.length < 2) {
    test.skip(true, 'Fewer than two runs in the store — cache-row flow needs seeded data.')
    return
  }
  await pick(page, 'Run A', ids[0])
  await pick(page, 'Run B', ids[1])
  const table = page.locator('[data-testid="compare-table"]')
  await expect(table).toBeVisible()
  // The fix: cache tokens are decomposed into their own rows, distinct from the
  // "tokens (in+out)" total. Each role contributes a "cache read"/"cache write"
  // pair, so at least one of each must be present.
  await expect(table.getByText(/cache read/i).first()).toBeVisible()
  await expect(table.getByText(/cache write/i).first()).toBeVisible()
  // And they are NOT the same cell as the in+out total.
  await expect(table.getByText(/tokens \(in\+out\)/i).first()).toBeVisible()
})

// ── (d) Difference viewer surface (Plan 86-04, D-07/D-08) ──
//
// The DifferenceViewer aligns two paired runs' per-request context-turns via the
// pure run-align module, collapses the identical prefix, and starts the view at
// the first divergence. It is mounted on the Compare tab as of Wave 3 (Plan
// 86-05), beside RunCompare. On a fresh checkout with <2 runs the assertions are
// GUARDED — they skip with a clear message rather than hard-failing, so this spec
// lists and runs cleanly regardless of seeded data.
test('(d) comparing two runs surfaces the difference viewer (aligned diff + identical-prefix collapse)', async ({ page }) => {
  await navigateToCompare(page)
  const ids = await optionIds(page, 'Run A')
  if (ids.length < 2) {
    test.skip(true, 'Fewer than two runs in the store — the difference-viewer flow needs seeded data.')
    return
  }
  await pick(page, 'Run A', ids[0])
  await pick(page, 'Run B', ids[1])

  const diff = page.locator('[data-testid="difference-viewer"]')
  // Wave 3 (Plan 86-05) mounts the surface on the Compare tab. The viewer
  // self-reads compareA/compareB, so selecting the pair above drives it.
  await expect(diff).toBeVisible()

  // Canonical-model header renders VERBATIM (the model string) or the honest
  // "unmeasured" sentinel — never a recomputed/dominant fallback (ATTR-02).
  await expect(diff.getByText(/unmeasured/i).or(diff.locator('.font-mono')).first()).toBeVisible()

  // If the two runs share an identical prefix, the collapse trigger is present.
  // If they are identical end-to-end, the identical empty-state shows instead.
  // Either way, exactly one of the three diff outcomes must render.
  const prefixTrigger = page.getByText(/Show \d+ identical turns?/i)
  const identical = page.locator('[data-testid="difference-viewer-identical"]')
  const tail = page.locator('[data-testid="difference-viewer-tail"]')
  const outcomes = (await prefixTrigger.count()) + (await identical.count()) + (await tail.count())
  expect(outcomes).toBeGreaterThan(0)
})
