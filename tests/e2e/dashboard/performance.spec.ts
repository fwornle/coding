/**
 * Playwright E2E for the Phase 74 "Performance" dashboard tab.
 *
 * Plan 74-06 delivers the page (drawer + reports sub-view) and flips each of the
 * five UI flows from `test.fixme` to live. The flows are GATED on data presence:
 * on a fresh checkout with no closed measurement spans the runs table is empty,
 * so the data-dependent flows skip with a clear message rather than hard-failing.
 *
 * Flows covered (74-UI-SPEC §Interaction Contracts):
 *   (a) /performance loads, h1 reads "Performance", tab sits after Token Usage
 *   (b) faceted sidebar narrows the runs table
 *   (c) clicking a run row opens the right-side detail drawer (Sheet)
 *   (d) a timeline parent turn expands to per-reasoning-step sub-bands + tier badge
 *   (e) "Save report" freezes a snapshot that appears in the Reports sub-view
 *
 * baseURL is set per-project in playwright.config.ts (http://localhost:3032).
 */

import { test, expect, type Page } from '@playwright/test'

async function navigateToPerformance(page: Page) {
  // NOTE: the dashboard holds persistent SSE / polling connections (health
  // refresh middleware), so `networkidle` never settles. Wait for DOM content
  // + the rendered header instead, which is the reliable hydration signal.
  await page.goto('http://localhost:3032/performance', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('h1')).toHaveText('Performance', { timeout: 20000 })
  // Give the fetchRuns thunk a beat to populate the table / empty state.
  await page.waitForTimeout(800)
}

async function runRowCount(page: Page): Promise<number> {
  return page.locator('[data-testid="run-row"]').count()
}

// ── Collection witness (ACTIVE) ──

test('performance spec is collected by the runner', async () => {
  expect(true).toBe(true)
})

// ── UI flows (LIVE — Plan 74-06) ──

test('(a) /performance loads and the h1 reads "Performance"', async ({ page }) => {
  await navigateToPerformance(page)
  await expect(page.locator('h1')).toHaveText('Performance')
  // The Performance nav tab is registered after Token Usage (Plan 05).
  await expect(page.getByRole('link', { name: 'Performance' })).toBeVisible()
})

test('(b) selecting a facet narrows the runs table', async ({ page }) => {
  await navigateToPerformance(page)
  const rowsBefore = await runRowCount(page)
  if (rowsBefore === 0) {
    test.skip(true, 'No runs in the store — facet-narrow flow needs seeded data.')
    return
  }
  // Click the first facet checkbox row and assert the table does not grow.
  const facet = page.locator('[data-testid="facet-row"]').first()
  await expect(facet).toBeVisible()
  await facet.click()
  // Allow the memoized selector + re-render to settle.
  await page.waitForTimeout(300)
  const rowsAfter = await runRowCount(page)
  expect(rowsAfter).toBeLessThanOrEqual(rowsBefore)
})

test('(c) the per-row "Edit scores" button opens the right-side detail drawer', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await runRowCount(page)) === 0) {
    test.skip(true, 'No runs in the store — drawer-open flow needs seeded data.')
    return
  }
  // Row click drives the inline timeline; the drawer opens only via "Edit scores"
  // (decoupled so the timeline is viewable without the modal overlay).
  await page.locator('[data-testid="edit-scores"]').first().click()
  await expect(page.locator('[data-testid="run-detail-drawer"]')).toBeVisible()
  // The drawer shows the 5 rubric rows with editable corrected_* inputs.
  await expect(page.locator('[data-testid="corrected-input-goal_achieved"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save override' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard changes' })).toBeVisible()
})

test('(d) a timeline parent turn expands to reasoning-step sub-bands with a tier badge', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await runRowCount(page)) === 0) {
    test.skip(true, 'No runs in the store — timeline flow needs seeded data.')
    return
  }
  await page.locator('[data-testid="run-row"]').first().click()
  // The timeline loads for the selected run; gate on an expandable parent turn.
  await page.waitForTimeout(500)
  const turns = page.locator('[data-testid="timeline-turn"]')
  if ((await turns.count()) === 0) {
    test.skip(true, 'Selected run has no expandable per-turn timeline (e.g. per-session-aggregate only).')
    return
  }
  // The tier badge is visible BEFORE expanding (honesty signal, D-06).
  await expect(page.locator('[data-testid="granularity-tier-badge"]').first()).toBeVisible()
  await turns.first().click()
  await expect(page.locator('[data-testid="timeline-reasoning-step"]').first()).toBeVisible()
  // Tier badge stays visible after expand.
  await expect(page.locator('[data-testid="granularity-tier-badge"]').first()).toBeVisible()
})

test('(e) "Save report" freezes a snapshot that appears in the Reports sub-view', async ({ page }) => {
  await navigateToPerformance(page)
  // Switch to the Reports sub-tab (inside Performance, not a top-level nav tab).
  await page.locator('[data-testid="reports-tab"]').click()
  const reportsBefore = await page.locator('[data-testid="report-row"]').count()
  await page.locator('[data-testid="save-report"]').click()
  // saveReport → re-dispatch fetchReports → the new report appears in the list.
  await expect
    .poll(async () => page.locator('[data-testid="report-row"]').count(), { timeout: 10000 })
    .toBeGreaterThan(reportsBefore)
  await expect(page.locator('[data-testid="report-row"]').first()).toBeVisible()
})

// ── Timeline v2 flows (LIVE — Plan 86-03) ──

// Open a run's inline timeline and return whether it rendered any v2 turn rows
// (context-turns present). Runs without context-turns show the D-06 fallback.
async function openFirstRunTimeline(page: Page): Promise<boolean> {
  if ((await runRowCount(page)) === 0) return false
  await page.locator('[data-testid="run-row"]').first().click()
  await page.waitForTimeout(600) // fetchTimeline + fetchContextTurns settle
  return true
}

test('(f) a v2 timeline-row opens the single-turn drill-down modal (D-01)', async ({ page }) => {
  await navigateToPerformance(page)
  if (!(await openFirstRunTimeline(page))) {
    test.skip(true, 'No runs in the store — v2 modal flow needs seeded data.')
    return
  }
  const rows = page.locator('[data-testid="timeline-row"]')
  if ((await rows.count()) === 0) {
    test.skip(true, 'Selected run has no per-turn timeline rows.')
    return
  }
  await rows.first().click()
  // The Radix Dialog opens with the single-turn detail.
  await expect(page.locator('[data-testid="turn-modal"]')).toBeVisible()
  await expect(page.locator('[data-testid="turn-message-list"]')).toBeVisible()
})

test('(g) the fullscreen route /performance/timeline/:taskId renders', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await runRowCount(page)) === 0) {
    // The route still renders its shell (title + keyboard hint) with a synthetic
    // taskId even without seeded data — assert the shell mounts.
    await page.goto('http://localhost:3032/performance/timeline/no-such-task', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="timeline-fullscreen"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-testid="fullscreen-canonical-model"]')).toBeVisible()
    return
  }
  // With data, open the inline timeline then click the fullscreen affordance.
  await openFirstRunTimeline(page)
  const link = page.locator('[data-testid="timeline-fullscreen-link"]')
  if ((await link.count()) === 0) {
    test.skip(true, 'No timeline rendered for the selected run.')
    return
  }
  await link.first().click()
  await expect(page.locator('[data-testid="timeline-fullscreen"]')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('[data-testid="fullscreen-title"]')).toBeVisible()
})

test('(h) DASH-02 tier badge + reasoning sub-bands survive the v2 evolution', async ({ page }) => {
  await navigateToPerformance(page)
  if (!(await openFirstRunTimeline(page))) {
    test.skip(true, 'No runs in the store — DASH-02 regression check needs seeded data.')
    return
  }
  if ((await page.locator('[data-testid="timeline-row"]').count()) === 0) {
    test.skip(true, 'Selected run has no per-turn timeline rows.')
    return
  }
  // The granularity tier badge is visible on the v2 row (DASH-02 anchor).
  await expect(page.locator('[data-testid="granularity-tier-badge"]').first()).toBeVisible()
  // If the row has collapsible reasoning children, expanding shows the sub-bands.
  const childTriggers = page.locator('[data-testid="timeline-turn"]')
  if ((await childTriggers.count()) > 0) {
    await childTriggers.first().click()
    await expect(page.locator('[data-testid="timeline-reasoning-step"]').first()).toBeVisible()
  }
})

test('(i) a run without context-turns shows the D-06 "no per-turn context captured" note', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await runRowCount(page)) === 0) {
    test.skip(true, 'No runs in the store — D-06 fallback check needs seeded data.')
    return
  }
  // Walk the runs until one renders the D-06 fallback note (a run lacking
  // captured context-turns). If none do, the note path is untriggerable on this
  // dataset — skip rather than fail (data-dependent, like the other flows).
  const count = await runRowCount(page)
  let found = false
  for (let i = 0; i < count; i++) {
    await page.locator('[data-testid="run-row"]').nth(i).click()
    await page.waitForTimeout(500)
    if (await page.locator('[data-testid="timeline-no-context-note"]').count() > 0) {
      found = true
      await expect(page.locator('[data-testid="timeline-no-context-note"]').first()).toHaveText('no per-turn context captured')
      break
    }
  }
  if (!found) {
    test.skip(true, 'No run without context-turns in this dataset — D-06 note path not exercised.')
  }
})
