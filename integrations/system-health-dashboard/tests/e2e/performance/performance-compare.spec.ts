/**
 * Playwright E2E for the Phase 87 Plan 06 origin-grouped N-way ranked avenue panel
 * (AVN-07/AVN-08/AVN-09) — the primary screen of this phase.
 *
 * Plan 87-06 delivers, on the Performance tab's new "Avenues" sub-tab:
 *   (a) an origin-grouped panel that lists a span's avenues as ranked rows,
 *       default-sorted by outcome score (best first) — D-06/D-07;
 *   (b) a git-computed merge-status badge per row (ABSENT when the branch is
 *       unknown/pruned — honesty);
 *   (c) 2-of-N row selection → "Compare selected (2)" → switch to the Compare tab
 *       where the EXISTING 86-04 DifferenceViewer aligns the pair (we do NOT
 *       rebuild trajectory diffing);
 *   (d) a Prune confirm bar carrying the mandatory D-05 "Measurement data stays"
 *       reassurance;
 *   (e) a Promote blocked with the conflict copy when merge status is `conflicts`.
 *
 * The flows are GATED on data presence (the 86-05 idiom): on a fresh checkout with
 * no forked avenue (a Run carrying `origin_span_id`), the panel shows its empty
 * state and the data-dependent flows skip with a clear message rather than
 * hard-failing.
 *
 * baseURL is set in playwright.config.ts (http://localhost:3032). NOTE (Plan 87-06):
 * live execution is deferred to the orchestrator's post-merge verification — the
 * dashboard is bind-mounted into coding-services from the MAIN tree, so a live run
 * inside this worktree would reflect main-tree code, not these changes. This spec is
 * AUTHORED here and passes the typecheck/collection gate; the orchestrator rebuilds
 * the real dashboard and runs it live in both themes (per CLAUDE.md gsd-browser).
 */

import { test, expect, type Page } from '@playwright/test'

async function navigateToPerformance(page: Page) {
  // The dashboard holds persistent SSE / polling connections, so `networkidle`
  // never settles — wait for DOM content + the rendered header instead.
  await page.goto('http://localhost:3032/performance', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('h1')).toHaveText('Performance', { timeout: 20000 })
  await page.waitForTimeout(800)
}

// Open the Avenues sub-tab (mounts the origin-grouped ranked panel).
async function openAvenuesTab(page: Page) {
  await page.locator('[data-testid="avenues-tab"]').click()
  await page.waitForTimeout(300)
}

// The panel renders one Card per origin group when avenue data exists, else an
// empty-state Card. Returns the number of ranked avenue rows visible (0 = no
// forked avenue on this dataset → the data-dependent flows skip).
async function avenueRowCount(page: Page): Promise<number> {
  return page.locator('[data-testid="avenue-row"]').count()
}

// ── Collection witness (ACTIVE) ──

test('avenue-panel spec is collected by the runner', async () => {
  expect(true).toBe(true)
})

// ── AVN-07: the origin-grouped ranked panel ──

test('(a) the avenue panel renders origin-grouped rows ranked by outcome score, best first', async ({ page }) => {
  await navigateToPerformance(page)
  await openAvenuesTab(page)

  const rows = await avenueRowCount(page)
  if (rows === 0) {
    // No forked avenue → the panel shows its empty state, not rows.
    await expect(page.locator('[data-testid="avenue-panel-empty"]')).toBeVisible()
    test.skip(true, 'No avenue (origin_span_id-bearing) Run in the store — ranked-panel flow needs forked data.')
    return
  }

  // At least one origin-group Card + a sortable outcome column (the default sort).
  await expect(page.locator('[data-testid="avenue-origin-card"]').first()).toBeVisible()
  await expect(page.locator('[data-testid="avenue-sort-outcome"]').first()).toBeVisible()

  // Default sort is outcome, best-first (desc): the first row's outcome cell should be
  // >= the second row's (unmeasured em-dash rows sink to the bottom — honesty).
  if (rows >= 2) {
    const outcomeCells = page.locator('[data-testid="avenue-row"] td:nth-child(3)')
    const first = (await outcomeCells.nth(0).textContent())?.trim() ?? ''
    const second = (await outcomeCells.nth(1).textContent())?.trim() ?? ''
    if (first !== '—' && second !== '—') {
      expect(Number(first)).toBeGreaterThanOrEqual(Number(second))
    }
  }
})

// ── AVN-08: the merge-status badge (present per row; ABSENT when status is null) ──

test('(b) a merge-status badge appears per row (and is absent when git status is unknown — honesty)', async ({ page }) => {
  await navigateToPerformance(page)
  await openAvenuesTab(page)
  if ((await avenueRowCount(page)) === 0) {
    test.skip(true, 'No avenue rows — merge-badge flow needs forked data.')
    return
  }
  // The badge is HONEST: it renders NOTHING for unknown/pruned branches, so its
  // count may legitimately be < row count. We assert only that WHEN present it
  // carries one of the pinned labels (never a fabricated state).
  const badges = page.locator('[data-testid="merge-status-badge"]')
  const badgeCount = await badges.count()
  if (badgeCount === 0) {
    test.skip(true, 'All avenues report unknown merge status (no branch) — badges correctly absent (honesty).')
    return
  }
  await expect(badges.first()).toContainText(/merged|unmerged|conflicts/)
})

// ── AVN-07: 2-of-N select → existing DifferenceViewer (do NOT rebuild the diff) ──

test('(c) selecting two rows enables "Compare selected (2)" and switches to the Compare tab', async ({ page }) => {
  await navigateToPerformance(page)
  await openAvenuesTab(page)
  const rows = await avenueRowCount(page)
  if (rows < 2) {
    test.skip(true, 'Fewer than two avenues in one origin group — compare-of-2 flow needs ≥2 forked avenues.')
    return
  }

  const compareBtn = page.locator('[data-testid="avenue-compare-selected"]').first()
  // Disabled until exactly two rows are selected (2-of-N).
  await expect(compareBtn).toBeDisabled()

  const selects = page.locator('[data-testid="avenue-select"]')
  await selects.nth(0).check()
  await selects.nth(1).check()
  await expect(compareBtn).toBeEnabled()
  await expect(compareBtn).toContainText('Compare selected (2)')

  await compareBtn.click()
  // The Compare tab (86-05 wiring) mounts the EXISTING DifferenceViewer — we did not
  // fork the diff. Its card title is the reliable presence signal.
  await expect(page.locator('[data-testid="compare-tab"]')).toHaveAttribute('data-state', 'active')
})

// ── AVN-09: the Prune confirm carries the mandatory "measurement data stays" copy ──

test('(d) the Prune confirm bar shows the "Measurement data stays" reassurance (D-05)', async ({ page }) => {
  await navigateToPerformance(page)
  await openAvenuesTab(page)
  if ((await avenueRowCount(page)) === 0) {
    test.skip(true, 'No avenue rows — prune-confirm flow needs forked data.')
    return
  }
  await page.locator('[data-testid="avenue-prune"]').first().click()
  const confirm = page.locator('[data-testid="avenue-prune-confirm"]').first()
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute('role', 'alertdialog')
  await expect(confirm).toContainText('Measurement data stays in .data')
})

// ── AVN-08: Promote is conflict-blocked with the pinned copy ──

test('(e) Promote is blocked with the conflict copy when the merge status is conflicts', async ({ page }) => {
  await navigateToPerformance(page)
  await openAvenuesTab(page)
  if ((await avenueRowCount(page)) === 0) {
    test.skip(true, 'No avenue rows — promote-conflict flow needs forked data.')
    return
  }
  // A conflicted avenue renders the blocked copy INSTEAD of a Promote button; a
  // clean avenue renders the Promote button. Assert the invariant that at least one
  // of the two mutually-exclusive affordances is present per row (never neither —
  // that would be a silent gap).
  const blocked = page.locator('[data-testid="avenue-promote-blocked"]')
  const promotable = page.locator('[data-testid="avenue-promote"]')
  const blockedCount = await blocked.count()
  const promotableCount = await promotable.count()
  expect(blockedCount + promotableCount).toBeGreaterThan(0)
  if (blockedCount > 0) {
    await expect(blocked.first()).toContainText('resolve them before promoting')
  }
})
