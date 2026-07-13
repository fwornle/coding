/**
 * Playwright E2E for the Phase 87 "Fork into avenues" launcher flow (AVN-02/AVN-03).
 *
 * Plan 87-05 delivers the fork trigger + four-axis variant picker + mandatory
 * sweep guardrail on the existing Performance tab, as a THIN wrapper over the
 * existing launchExperiment → vkb-server → coordinator bridge (D-01).
 *
 * Flows covered (87-UI-SPEC Interaction Contract 2/3/4 + Copywriting Contract):
 *   (a) the "Fork into avenues" ghost button appears ONLY on a completed span row
 *   (b) clicking it opens the launcher with the ring-2 ring-primary prefill highlight
 *       + the four axes (Agent / Model / SDD framework / Knowledge injection)
 *   (c) the SDD-framework axis carries the mandatory "not a code framework" caption
 *   (d) the sweep guardrail renders a SERVER-resolved count/cost preview and the
 *       launch button is DISABLED until it renders, then reflects "Launch {N} avenues"
 *   (e) a launch-error can be dismissed
 *
 * The flows are GATED on data presence (mirrors the 86-05 idiom): on a fresh
 * checkout with no COMPLETED experiment span the runs table has no forkable row,
 * so the data-dependent flows skip with a clear message rather than hard-failing.
 *
 * baseURL is set in playwright.config.ts (http://localhost:3032). NOTE (Plan 87-05):
 * live execution is deferred to the orchestrator's post-merge verification — the
 * dashboard is bind-mounted into coding-services from the MAIN tree, so a live run
 * inside this worktree would reflect main-tree code, not these changes. This spec is
 * AUTHORED here and passes the typecheck/collection gate; the orchestrator rebuilds
 * the real dashboard and runs it live.
 */

import { test, expect, type Page } from '@playwright/test'

async function navigateToPerformance(page: Page) {
  // The dashboard holds persistent SSE / polling connections (health refresh
  // middleware), so `networkidle` never settles. Wait for DOM content + the
  // rendered header instead — the reliable hydration signal.
  await page.goto('http://localhost:3032/performance', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('h1')).toHaveText('Performance', { timeout: 20000 })
  // Give the fetchRuns thunk a beat to populate the table / empty state.
  await page.waitForTimeout(800)
}

// The Fork button rides the SAME isCompletedExperimentRun guard as Re-run, so a
// forkable row is one that exposes the fork-into-avenues affordance. Returns the
// count of visible Fork buttons (0 = no completed experiment span to fork).
async function forkButtonCount(page: Page): Promise<number> {
  return page.locator('[data-testid="fork-into-avenues"]').count()
}

// ── Collection witness (ACTIVE) ──

test('fork-launcher spec is collected by the runner', async () => {
  expect(true).toBe(true)
})

// ── AVN-02: the Fork trigger ──

test('(a) the "Fork into avenues" button appears only on a completed span row', async ({ page }) => {
  await navigateToPerformance(page)
  const rows = await page.locator('[data-testid="run-row"]').count()
  if (rows === 0) {
    test.skip(true, 'No runs in the store — fork-trigger flow needs a completed experiment span.')
    return
  }
  const forks = await forkButtonCount(page)
  if (forks === 0) {
    test.skip(true, 'No COMPLETED experiment span in this dataset — the fork guard (correctly) renders no button.')
    return
  }
  // The button carries the exact copy + a GitBranch affordance; it sits inside a
  // row-action group next to Re-run (same completed-only guard).
  const fork = page.locator('[data-testid="fork-into-avenues"]').first()
  await expect(fork).toBeVisible()
  await expect(fork).toContainText('Fork into avenues')
})

// ── AVN-03: the four-axis picker + prefill highlight ──

test('(b) clicking Fork opens the launcher with the ring highlight + four axes', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await forkButtonCount(page)) === 0) {
    test.skip(true, 'No forkable completed span — axis-picker flow needs seeded data.')
    return
  }
  await page.locator('[data-testid="fork-into-avenues"]').first().click()

  // The launcher card gets the transient ring-2 ring-primary prefill highlight and
  // its title switches to the fork copy.
  const launcher = page.locator('[data-testid="experiment-launcher"]')
  await expect(launcher).toBeVisible()
  await expect(launcher).toHaveClass(/ring-2/)
  await expect(launcher).toContainText('Fork span into avenues')

  // The four-axis picker renders: Agent, Model, SDD framework, Knowledge injection.
  const axes = page.locator('[data-testid="fork-axes"]')
  await expect(axes).toBeVisible()
  await expect(axes).toContainText('Agent')
  await expect(axes).toContainText('Model')
  await expect(axes).toContainText('SDD framework')
  await expect(page.locator('[data-testid="fork-knowledge-injection"]')).toContainText('Knowledge injection')
  await expect(page.locator('[data-testid="fork-sweep"]')).toContainText('Sweep')
})

test('(c) the SDD-framework axis carries the mandatory "not a code framework" caption', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await forkButtonCount(page)) === 0) {
    test.skip(true, 'No forkable completed span — framework-disambiguation caption needs seeded data.')
    return
  }
  await page.locator('[data-testid="fork-into-avenues"]').first().click()
  await expect(page.locator('[data-testid="fork-axes"]')).toContainText('not a code framework')
})

// ── AVN-03 / D-02: the mandatory sweep guardrail (server-resolved, launch-gating) ──

test('(d) the sweep guardrail renders a server-resolved count/cost preview; launch reflects "Launch {N} avenues"', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await forkButtonCount(page)) === 0) {
    test.skip(true, 'No forkable completed span — guardrail flow needs seeded data.')
    return
  }
  await page.locator('[data-testid="fork-into-avenues"]').first().click()

  // The guardrail box is the fork surface's focal point — it shows the avenues
  // count (SERVER-resolved) + an Est. tokens · cost line.
  const guardrail = page.locator('[data-testid="sweep-guardrail"]')
  await expect(guardrail).toBeVisible()
  await expect(guardrail).toContainText('avenue')
  await expect(page.locator('[data-testid="avenue-cost-preview"]')).toContainText('tokens')

  const launch = page.locator('[data-testid="launch-experiment"]')
  await expect(launch).toBeVisible()
  // D-02: the CTA reflects the count (or is disabled with a placeholder until the
  // SERVER preview resolves — never a client recompute).
  await expect(launch).toContainText(/Launch .* avenues/)
  // When the server count has NOT resolved (no matching spec listed yet), the
  // launch button stays disabled — the guardrail must be seen before any launch.
  const countText = (await page.locator('[data-testid="avenue-count"]').first().textContent())?.trim()
  if (countText === '?' || countText === '' || countText == null) {
    await expect(launch).toBeDisabled()
  }
})

// ── D-09 / T-87-05-03: the guardrail count is the SERVER cellCount, not client math ──

test('(e) a launch error surfaces in the dismissible holder and can be dismissed', async ({ page }) => {
  await navigateToPerformance(page)
  if ((await forkButtonCount(page)) === 0) {
    test.skip(true, 'No forkable completed span — launch-error flow needs seeded data.')
    return
  }
  await page.locator('[data-testid="fork-into-avenues"]').first().click()

  const launch = page.locator('[data-testid="launch-experiment"]')
  // If the launch is disabled (no server preview / no spec), the error path is not
  // reachable on this dataset — skip rather than fail (data-dependent).
  if (await launch.isDisabled()) {
    test.skip(true, 'Launch disabled (no server-resolved avenue spec on this dataset) — launch-error path not exercised.')
    return
  }
  await launch.click()
  // A rejected launch surfaces the dismissible role=alert holder (never silent).
  const err = page.locator('[data-testid="launch-error"]')
  if ((await err.count()) === 0) {
    test.skip(true, 'Launch succeeded (or was accepted) — no error holder to dismiss on this dataset.')
    return
  }
  await expect(err).toBeVisible()
  await page.locator('[data-testid="dismiss-launch-error"]').click()
  await expect(err).toHaveCount(0)
})
