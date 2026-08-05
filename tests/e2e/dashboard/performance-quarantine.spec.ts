/**
 * Playwright E2E for quarantined (Run.pending) runs on the Performance page.
 *
 * Regression guard for two defects found together:
 *  1. "Show quarantined (N)" always read (0). The count was computed over the
 *     already-fetched rows while the fetch asked the server to EXCLUDE pending
 *     runs — so the counted set contained none by construction, and the checkbox
 *     looked inert even with 21 quarantined runs on the server.
 *  2. Quarantined rows, once shown, were visually identical to counted runs
 *     despite being excluded from every headline number.
 *
 * The fix fetches with includePending=true always and filters client-side, so:
 *  - the count is real, and toggling needs no refetch;
 *  - the summary cards still exclude quarantined runs while the toggle is off;
 *  - shown quarantined rows carry a red wash + an explicit badge.
 */
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3032'
const API = 'http://localhost:3033'

/**
 * Server truth for how many quarantined runs exist.
 *
 * Retries: :3033 proxies this to the experiments API, and under the load of the
 * whole dashboard suite it intermittently answers with an error body carrying no
 * `rows` — which used to blow up as "Cannot read properties of undefined".
 */
async function quarantinedOnServer(request: any): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const res = await request.get(`${API}/api/experiments/runs?includePending=true`)
    const body = res.ok() ? await res.json().catch(() => null) : null
    const rows = body?.rows ?? body?.runs
    if (Array.isArray(rows)) {
      return (rows as Array<{ pending?: boolean }>).filter((r) => r.pending === true).length
    }
    if (attempt >= 3) throw new Error(`experiments API returned no rows after ${attempt + 1} attempts (status ${res.status()})`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

/**
 * Drive the quarantine checkbox to an explicit state.
 *
 * Deliberately ONE click, then assert — no retry loop. A retry here would paper
 * over the exact defect this file guards: while the control was wrapped in
 * `<label htmlFor>` pointing at itself, a click landing on the checked-state
 * indicator forwarded a second click from the label, so the two toggles cancelled
 * and the box could not be unchecked. Clicking N times would hide that; failing
 * on the first click surfaces it.
 */
async function setQuarantine(page: any, on: boolean) {
  const toggle = page.getByTestId('include-pending-toggle')
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  if ((await toggle.getAttribute('aria-checked')) === String(on)) return
  await page.evaluate(() => window.scrollTo(0, 0))
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on), { timeout: 10_000 })
}

test.beforeEach(async ({ request }) => {
  const ok = await request.get(`${API}/api/experiments/runs`).then((r: any) => r.ok()).catch(() => false)
  test.skip(!ok, 'experiments API (:3033) not reachable — start services first')
})

test('backend: includePending is what surfaces quarantined runs', async ({ request }) => {
  const plain = await request.get(`${API}/api/experiments/runs`).then((r) => r.json())
  const withPending = await request.get(`${API}/api/experiments/runs?includePending=true`).then((r) => r.json())

  // Default excludes them entirely — this is why a count over the default fetch
  // could never be anything but zero.
  expect(plain.rows.filter((r: any) => r.pending === true)).toHaveLength(0)
  expect(withPending.rows.length).toBeGreaterThanOrEqual(plain.rows.length)
})

test('the toggle reports the real quarantined count, not 0', async ({ page, request }) => {
  const expected = await quarantinedOnServer(request)
  test.skip(expected === 0, 'no quarantined runs in the store to assert on')

  await page.goto(`${BASE}/performance`)
  const label = page.getByTestId('include-pending-row')
  await expect(label).toContainText(`Show quarantined (${expected})`, { timeout: 20_000 })
  // The specific regression: never the literal "(0)" while runs exist.
  await expect(label).not.toContainText('Show quarantined (0)')
})

test('quarantined runs stay out of the summary cards until opted in', async ({ page, request }) => {
  const expected = await quarantinedOnServer(request)
  test.skip(expected === 0, 'no quarantined runs in the store to assert on')

  await page.goto(`${BASE}/performance`)
  const totalCard = page.locator('text=Total runs').locator('xpath=..')
  await expect(totalCard).toBeVisible({ timeout: 20_000 })
  // Wait for the first fetch to land before sampling — reading a cold 0 here and
  // then asserting 0 + expected made this flaky on a just-restarted backend.
  await expect
    .poll(async () => Number((await totalCard.innerText()).match(/(\d+)/g)?.pop()), { timeout: 20_000 })
    .toBeGreaterThan(0)
  const before = Number((await totalCard.innerText()).match(/(\d+)/g)?.pop())

  await setQuarantine(page, true)
  await expect
    .poll(async () => Number((await totalCard.innerText()).match(/(\d+)/g)?.pop()), { timeout: 10_000 })
    .toBe(before + expected)
})

test('shown quarantined rows are visually marked (wash + badge)', async ({ page, request }) => {
  const expected = await quarantinedOnServer(request)
  test.skip(expected === 0, 'no quarantined runs in the store to assert on')

  await page.goto(`${BASE}/performance`)
  await setQuarantine(page, true)
  await page.getByTestId('toggle-all-groups').click()

  const rows = page.locator('[data-testid="run-row"][data-quarantined="true"]')
  await expect(rows.first()).toBeVisible({ timeout: 20_000 })

  // Every marked row carries the per-row badge...
  const rowCount = await rows.count()
  expect(await page.getByTestId('run-quarantined-badge').count()).toBe(rowCount)

  // ...and a reddish background distinct from a normal row's transparent one.
  const bg = await rows.first().evaluate((el) => getComputedStyle(el).backgroundColor)
  const [r, g, b] = bg.match(/[\d.]+/g)!.map(Number)
  expect(r).toBeGreaterThan(g)
  expect(r).toBeGreaterThan(b)

  // The owning group header is marked too, with a leading (on-screen) badge.
  const groupBadge = page.getByTestId('group-quarantined-badge').first()
  await expect(groupBadge).toBeVisible()
  const box = await groupBadge.boundingBox()
  const width = page.viewportSize()?.width ?? 1280
  expect(box!.x).toBeLessThan(width) // not pushed off the 30-column-wide row
})

test('toggling off hides them again without a refetch round-trip', async ({ page, request }) => {
  const expected = await quarantinedOnServer(request)
  test.skip(expected === 0, 'no quarantined runs in the store to assert on')

  await page.goto(`${BASE}/performance`)
  await setQuarantine(page, true)
  // Child run rows only exist while their group is expanded — without this the
  // locator below can never match, regardless of the toggle.
  await page.getByTestId('toggle-all-groups').click()
  await expect(page.locator('[data-testid="run-row"][data-quarantined="true"]').first()).toBeVisible({ timeout: 20_000 })

  await setQuarantine(page, false)
  await expect(page.locator('[data-testid="run-row"][data-quarantined="true"]')).toHaveCount(0, { timeout: 5_000 })
  // Count survives hiding — it is read off the fetched set, not the visible one.
  await expect(page.getByTestId('include-pending-row')).toContainText(`(${expected})`)
})
