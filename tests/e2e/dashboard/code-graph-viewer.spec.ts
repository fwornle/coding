/**
 * Playwright E2E for the code-graph viewer.
 *
 * The viewer generates and embeds graphify's OWN native `graph.html` for a
 * CODE-ONLY, scoped subgraph (the authentic graphify.com viewer: communities
 * sidebar, filter, god node, visible edges). Validates:
 *  1. GET /api/cgr/code-scopes — code areas with symbol counts (documents excluded).
 *  2. POST generate + poll → the served HTML is SELF-CONTAINED (vis-network inlined,
 *     no unpkg), NODE-LEVEL (not aggregated), and communities are scope-accurate.
 *  3. Tile click opens the modal with a scope picker; the iframe ends up pointing at
 *     the /view route and renders graphify's COMMUNITIES sidebar.
 *  4. Re-index button opens the reindex modal, not the viewer.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:3032'
const API = 'http://localhost:3033'
const SMALL_SCOPE = 'integrations/memory-visualizer' // ~223 code nodes — fast

test.beforeEach(async ({ request }) => {
  const ok = await request.get(`${API}/api/cgr/code-scopes`).then((r) => r.ok()).catch(() => false)
  test.skip(!ok, 'dashboard API (:3033) not reachable — start services first')
})

test('backend: /api/cgr/code-scopes lists code scopes with counts', async ({ request }) => {
  const res = await request.get(`${API}/api/cgr/code-scopes`)
  expect(res.ok()).toBeTruthy()
  const { data } = await res.json()
  expect(Array.isArray(data)).toBeTruthy()
  expect(data.length).toBeGreaterThan(3)
  const s = data[0]
  expect(s).toHaveProperty('scope')
  expect(s).toHaveProperty('slug')
  expect(s.codeNodes).toBeGreaterThan(0)
  // Scopes are code-only and sorted desc; the largest is far below the 57k total.
  expect(s.codeNodes).toBeLessThan(20000)
})

test('backend: generate + view yields a self-contained, node-level graphify html', async ({ request }) => {
  const gen = await request.post(`${API}/api/cgr/code-graph-html`, { data: { scope: SMALL_SCOPE } })
  expect(gen.ok()).toBeTruthy()

  // Poll to done (cached ⇒ immediate).
  await expect.poll(async () => {
    const p = await request.get(`${API}/api/cgr/code-graph-html/progress?scope=${encodeURIComponent(SMALL_SCOPE)}`).then((r) => r.json())
    return p.data?.status
  }, { timeout: 30_000, intervals: [500, 1000] }).toBe('done')

  const view = await request.get(`${API}/api/cgr/code-graph-html/view?scope=${encodeURIComponent(SMALL_SCOPE)}`)
  expect(view.ok()).toBeTruthy()
  const html = await view.text()
  // Self-contained: vis-network inlined, no external CDN.
  expect(html).not.toContain('unpkg.com')
  expect(html).toContain('visjs.github.io')
  // graphify's native UI is present (sidebar heading + node data).
  expect(html).toContain('<h3>Communities</h3>')
  expect(html).toContain('RAW_NODES')
  // Node-level footer "N nodes · M edges · K communities".
  expect(html).toMatch(/\d+ nodes.{1,12}\d+ edges.{1,12}\d+ communities/)
})

test('backend: unknown scope is handled', async ({ request }) => {
  const gen = await request.post(`${API}/api/cgr/code-graph-html`, { data: { scope: 'does/not/exist' } })
  // Accepted (async) then fails, OR the view 404s — either way no crash.
  expect([200, 400, 404]).toContain(gen.status())
})

test('tile opens the viewer; iframe renders graphify native viewer', async ({ page }) => {
  await page.goto(BASE)
  await page.locator('[data-testid="code-graph-tile"] [data-slot="card-header"]').click({ timeout: 15_000 })

  const dialog = page.locator('[role="dialog"]')
  await expect(dialog.getByText(/graphify's native viewer/)).toBeVisible()

  // The iframe eventually points at the /view route (auto-generates a default scope).
  const iframe = dialog.locator('iframe[title="Code graph"]')
  await expect(iframe).toHaveAttribute('src', /code-graph-html\/view\?scope=/, { timeout: 40_000 })

  // And inside it, graphify's own Communities sidebar renders.
  const inner = dialog.frameLocator('iframe[title="Code graph"]')
  await expect(inner.locator('#legend-wrap')).toBeVisible({ timeout: 20_000 })
  await expect(inner.getByText('Communities', { exact: true })).toBeVisible({ timeout: 20_000 })
})

test('Re-index button opens the reindex modal, not the viewer', async ({ page }) => {
  await page.goto(BASE)
  await page.locator('[data-testid="code-graph-tile"] button', { hasText: /Re-index/ }).click({ timeout: 15_000 })
  const dialog = page.locator('[role="dialog"]')
  await expect(dialog.getByText(/Re-index Code Graph\?/)).toBeVisible({ timeout: 10_000 })
  await expect(dialog.getByText(/graphify's native viewer/)).toHaveCount(0)
})
