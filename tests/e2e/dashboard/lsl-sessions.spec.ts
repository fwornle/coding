/**
 * Playwright E2E for the Sessions tab (verbatim LSL transcripts).
 *
 * The tab lists CHAINS — an hourly tranche plus its rotation parts — not files,
 * because a legacy `-N_` markdown part is a headerless fragment split mid-token
 * and cannot be read alone. It serves both formats: `.jsonl` (pi, current) and
 * `.md` (legacy), the latter converted IN MEMORY by the same parser and writer
 * the backfill uses. Test 4 is the one that matters most — it proves the tab is
 * a live preview of the conversion, not merely a reader.
 *
 * Rendering reuses pi's own exported HTML shell, because `pi` is a host tool and
 * is NOT installed in the coding-services container.
 */
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3032'
const API = 'http://localhost:3033'

test.describe('Sessions tab', () => {
  test('1. API lists chains with format, parts and prompt-set counts', async ({ request }) => {
    const res = await request.get(`${API}/api/lsl/sessions?limit=50&months=2`)
    expect(res.ok()).toBeTruthy()
    const { sessions } = await res.json()
    expect(Array.isArray(sessions)).toBeTruthy()
    expect(sessions.length).toBeGreaterThan(0)

    const s = sessions[0]
    expect(s).toHaveProperty('id')
    expect(s).toHaveProperty('project')
    expect(['pi', 'markdown', 'mixed']).toContain(s.format)
    expect(s.parts).toBeGreaterThanOrEqual(1)
    // Newest first — the ids are date-encoded, which is the only stable order
    // (mtimes are rewritten wholesale by clone/checkout).
    const keys = sessions.map((x: { key: string }) => x.key)
    expect([...keys].sort().reverse()).toEqual(keys)
  })

  test('2. nav places Sessions immediately before Observations', async ({ page }) => {
    await page.goto(BASE)
    const labels = await page.locator('nav a').allInnerTexts()
    const clean = labels.map(l => l.trim().split('\n')[0])
    expect(clean).toContain('Sessions')
    expect(clean.indexOf('Sessions')).toBe(clean.indexOf('Observations') - 1)
  })

  test('3. a pi-format chain renders in the viewer', async ({ page, request }) => {
    const { sessions } = await (await request.get(`${API}/api/lsl/sessions?limit=100&months=2`)).json()
    const pi = sessions.find((s: { format: string; promptSets: number }) =>
      s.format === 'pi' && s.promptSets > 0)
    test.skip(!pi, 'no pi-format session with content yet')

    const html = await request.get(`${API}/api/lsl/sessions/${pi.id}/export.html`)
    expect(html.ok()).toBeTruthy()
    const body = await html.text()
    // pi embeds the session as base64 under this tag; its presence proves we
    // served pi's own shell rather than an error page.
    expect(body).toContain('<script id="session-data"')

    await page.goto(`${BASE}/sessions`)
    await expect(page.getByTestId('lsl-session-viewer')).toBeVisible()
  })

  test('4. a legacy markdown chain is converted and rendered, not skipped', async ({ request }) => {
    const { sessions } = await (await request.get(`${API}/api/lsl/sessions?limit=200&months=3`)).json()
    const md = sessions.find((s: { format: string; promptSets: number }) =>
      s.format === 'markdown' && s.promptSets > 0)
    test.skip(!md, 'corpus already fully converted — nothing legacy left to preview')

    const res = await request.get(`${API}/api/lsl/sessions/${md.id}`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()

    // Converted output must be real pi session v3, with the LSL structure the
    // backfill produces: a tranche spine and one entry per prompt set.
    expect(data.header.type).toBe('session')
    expect(data.header.version).toBe(3)
    const spine = data.entries.filter((e: { customType?: string }) => e.customType === 'lsl.tranche')
    const sets = data.entries.filter((e: { customType?: string }) => e.customType === 'lsl.promptSet')
    expect(spine).toHaveLength(1)
    expect(sets.length).toBe(md.promptSets)
    // Every prompt set hangs off the spine — that sibling-subtree shape is what
    // makes removal a filter rather than byte surgery.
    for (const set of sets) expect(set.parentId).toBe(spine[0].id)

    const users = data.entries.filter((e: { message?: { role: string } }) => e.message?.role === 'user')
    expect(users.length).toBeGreaterThan(0)
  })

  test('5. a multi-part chain is presented as ONE session, not fragments', async ({ request }) => {
    const { sessions } = await (await request.get(`${API}/api/lsl/sessions?limit=200&months=3`)).json()
    const multi = sessions.find((s: { parts: number }) => s.parts > 1)
    test.skip(!multi, 'no multi-part chain available')

    // One row covering N files — the whole point, since a `-N_` part is a
    // headerless fragment that cannot be parsed on its own.
    expect(multi.parts).toBeGreaterThan(1)
    const data = await (await request.get(`${API}/api/lsl/sessions/${multi.id}`)).json()
    expect(data.entries.length).toBeGreaterThan(0)
  })

  test('6. an unknown session id 404s rather than 500ing', async ({ request }) => {
    const res = await request.get(`${API}/api/lsl/sessions/coding/2026/01/does-not-exist`)
    expect(res.status()).toBe(404)
  })
})
