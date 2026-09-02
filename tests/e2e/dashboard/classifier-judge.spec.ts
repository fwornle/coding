/**
 * Playwright E2E for the judge panel on Token Usage → Routing
 * (the "The judge" block inside offload-decision.tsx, and the `judge` rows in
 * the "Candidates never tried" card).
 *
 * ── What this is guarding, and why it is E2E rather than a unit test ─────────
 * On 2026-09-02 two `--pi` turns ran on gh-copilot/claude-sonnet-5 when they
 * should have gone to the local Qwen. The cause was that the classifier's model
 * endpoint had not been running for about a day. Every layer that a person could
 * SEE looked correct: the classifier was `enabled: true`, the impl was named,
 * the offload policy was right, and the only trace of the outage was a string
 * inside one column of one row.
 *
 * The fix is therefore not a behaviour anywhere in particular — it is that the
 * facts reach a screen. That is only testable end to end: a unit test on the
 * hook would pass while the panel rendered nothing, which is exactly the state
 * being defended against.
 *
 * ── Data-independence ───────────────────────────────────────────────────────
 * A dashboard on a machine with no traffic, no classifier configured, or the
 * proxy down is a legitimate state, so every assertion guards on what is
 * actually present. What is NOT optional is the distinction the panel exists to
 * draw: when a backend is listed, it must say both whether it is switched on and
 * whether it is answering — never one standing in for the other.
 */

import { test, expect, type Page } from '@playwright/test'

/**
 * Open Token Usage, switch to the Routing sub-tab, and WAIT FOR THE JUDGE PANEL
 * rather than for the page.
 *
 * The two are several seconds apart: the Observed table renders from one fetch,
 * the offload card from `/api/llm/routing` and the judge block from
 * `/api/llm/classifier` after that. Measured here at ~3s. Guarding a skip on a
 * `count() === 0` taken at table-visible time therefore skipped every judge
 * assertion on a perfectly healthy dashboard — a green run that tested nothing,
 * which is the same failure shape as the outage this file exists for.
 *
 * @returns whether the judge block is present at all, so a caller can skip for
 *   the REAL reason (no classifier configured) rather than for being early.
 */
async function openRoutingTab(page: Page): Promise<boolean> {
  await page.goto('/token-usage')
  await page.getByRole('tab', { name: 'Routing' }).click()
  await expect(
    page.getByText('Observed — what each route actually did')
  ).toBeVisible()
  try {
    await page.getByText('judged by:', { exact: false }).first().waitFor({ timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

test.describe('the judge is visible on the Routing tab', () => {
  let judgePresent = false

  test.beforeEach(async ({ page }) => {
    // Light mode, deterministically. The app reads this key at mount, so it is
    // set before the first navigation rather than after.
    await page.addInitScript(() => localStorage.setItem('dashboard-theme', 'light'))
    judgePresent = await openRoutingTab(page)
  })

  test('names the model that judges, and the network it judges on', async ({ page }) => {
    test.skip(!judgePresent, 'classifier is off, or this proxy predates the endpoint')
    const label = page.getByText('judged by:', { exact: false })
    await expect(label.first()).toBeVisible()

    // The panel must resolve to SOMETHING legible — either a model id or an
    // explicit statement that nothing serves this network. A blank here is the
    // pre-2026-09-02 state: a judge that exists on paper and says nothing.
    const row = label.first().locator('xpath=..')
    await expect(row).toHaveText(/judged by:\s*\S+/)
  })

  test('says separately whether a backend is switched on and whether it answers', async ({ page }) => {
    test.skip(!judgePresent, 'classifier is off')

    // The declared backends, each a checkbox (config) plus a runtime phrase.
    // "Off" and "not answering" have opposite fixes, so one control and one
    // phrase — never a single indicator standing for both.
    const backendRows = page.locator('label').filter({ hasText: /\[(corporate|public|any)\]/ })
    const n = await backendRows.count()
    test.skip(n === 0, 'no judge backends declared')

    for (let i = 0; i < n; i += 1) {
      const row = backendRows.nth(i)
      await expect(row.locator('input[type=checkbox]')).toHaveCount(1)
      await expect(row).toHaveText(/answering|unreachable|not asked on this network/)
    }
  })

  test('shows the rubric — the literal prompt the judge is sent', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /show the rubric/i })
    test.skip(await toggle.count() === 0, 'judge unreachable, so there is no rubric to show')

    await toggle.click()
    const box = page.locator('textarea')
    await expect(box.first()).toBeVisible()
    // The three definition lines are the calibration, not decoration: without
    // them the same model answered `medium` for "how many r's in strawberry".
    // A rubric that has lost one is a silent recalibration of every agent.
    await expect(box.first()).toHaveValue(/small\s*=/)
    await expect(box.first()).toHaveValue(/medium\s*=/)
    await expect(box.first()).toHaveValue(/high\s*=/)
  })

  test('a classifier failure is aggregated, not buried in one row', async ({ page }) => {
    await expect(page.getByText('Candidates never tried')).toBeVisible()

    // The `judge` badge group is the aggregate whose absence hid the outage.
    // Its CONTENT is traffic-dependent — a quiet window legitimately has none —
    // so what is asserted is that when notes exist they are labelled and counted,
    // which is what makes "×4 classifier error" readable at a glance.
    //
    // The badge is a leaf <span>; the row is its parent. Located that way rather
    // than by walking down from the card, because "the card" resolves to the
    // innermost element whose text starts with the title — which has no rows
    // under it, so the whole assertion silently skipped.
    const badges = page.getByText('judge', { exact: true })
    const n = await badges.count()
    test.skip(n === 0, 'no classified turns in this window')

    for (let i = 0; i < n; i += 1) {
      await expect(badges.nth(i).locator('xpath=..')).toHaveText(/×\s*[\d.]+K?$/)
    }
  })

  test('the offload ladder names the per-target band narrowing', async ({ page }) => {
    // `qwen-laptop[public/fg/small]` — the third segment is the target's own
    // `offload_bands`. It is printed only when a target NARROWS the policy, so
    // its absence on an unrestricted target is correct, not a missing field.
    //
    // Addressed by test-id rather than by text: the same string also appears in
    // an SVG <title> on the flow diagram, which is hidden by definition, and a
    // text match found that one first and then asserted it was visible.
    const targets = page.locator('[data-testid^="offload-target-"]')
    const n = await targets.count()
    test.skip(n === 0, 'no offload targets declared')

    for (let i = 0; i < n; i += 1) {
      // Every target states its network and scope; only a narrowing target adds
      // a third segment.
      await expect(targets.nth(i)).toHaveText(/^\[(corporate|public|any)\/[a-z+]+(\/[a-z+]+)?\]$/)
    }
  })
})
