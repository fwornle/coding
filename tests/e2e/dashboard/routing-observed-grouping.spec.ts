/**
 * Playwright E2E for the "Observed — what each route actually did" table on
 * Token Usage → Routing (token-usage-routing-tab.tsx).
 *
 * The table used to be one flat list of ~40 routes ordered only by token spend,
 * which answered "what cost the most" and nothing else — the four interactive
 * routes scattered among three dozen background jobs, and the 14 wave-analysis
 * routes (one workflow) appearing as 14 unrelated lines. It is now sectioned:
 * foreground first, then background families derived from the route-name
 * prefixes in llm-routing.yaml.
 *
 * What is asserted here is the ORDERING CONTRACT, not the data:
 *   1. Every data row belongs to a section (no orphans above the first header).
 *   2. Foreground is the first section.
 *   3. Every fg-* route sorts above every bg-* route.
 *   4. Foreground is alphabetical — the one section NOT in token order, because
 *      those four are looked up by name and must not reshuffle with spend.
 *   5. "Other" is last when present, so an unrecognised route name is visible
 *      as a straggler rather than silently mixed into a real family.
 *
 * Data-independence: the window may legitimately contain no traffic at all, and
 * on a short window most families are empty (empty sections are not rendered).
 * Each assertion therefore guards on what is actually present rather than
 * expecting a fixed set of sections — a test that demands bg-wave-analysis
 * traffic would fail every time nobody happened to run a UKB workflow.
 */

import { test, expect, type Page } from '@playwright/test'

const FOREGROUND = /^FOREGROUND/i
const OTHER = /^OTHER\b/i

/** Open Token Usage and switch to the Routing sub-tab. */
async function openRoutingTab(page: Page) {
  await page.goto('/token-usage')
  // The sub-tabs are radix triggers; click by role rather than by generated id.
  await page.getByRole('tab', { name: 'Routing' }).click()
  await expect(
    page.getByText('Observed — what each route actually did')
  ).toBeVisible()
}

/**
 * Read the Observed table top to bottom as a flat sequence, so the assertions
 * can talk about relative order. Section headers are the spanning <th> rows;
 * everything else is a route row whose first cell is the route key.
 */
async function readTable(page: Page): Promise<{ kind: 'section' | 'route', text: string }[]> {
  const table = page.locator('table', { hasText: 'Bounced' }).first()
  await expect(table).toBeVisible()

  return table.locator('tbody tr').evaluateAll(rows =>
    rows.map(tr => {
      const header = tr.querySelector('th[scope="colgroup"]')
      if (header) {
        // The label is the header's own text minus the trailing count span.
        const span = header.querySelector('span')
        const full = (header.textContent ?? '').trim()
        const counts = (span?.textContent ?? '').trim()
        return { kind: 'section' as const, text: full.slice(0, full.length - counts.length).trim() }
      }
      const firstCell = tr.querySelector('td')
      return { kind: 'route' as const, text: (firstCell?.textContent ?? '').trim().split(/\s+/)[0] }
    })
  )
}

test.describe('Observed routes are grouped, foreground first', () => {
  test('every route row sits under a section header', async ({ page }) => {
    await openRoutingTab(page)
    const entries = await readTable(page)
    test.skip(entries.length === 0, 'no routed calls recorded in this window')

    // A route appearing before any header would mean a group the renderer did
    // not account for — the failure mode a flat `.map()` regression produces.
    const firstRoute = entries.findIndex(e => e.kind === 'route')
    const firstSection = entries.findIndex(e => e.kind === 'section')
    expect(firstSection).toBeGreaterThanOrEqual(0)
    expect(firstSection).toBeLessThan(firstRoute)
  })

  test('foreground is the first section and precedes every background route', async ({ page }) => {
    await openRoutingTab(page)
    const entries = await readTable(page)
    const routes = entries.filter(e => e.kind === 'route').map(e => e.text)
    test.skip(routes.length === 0, 'no routed calls recorded in this window')

    const sections = entries.filter(e => e.kind === 'section').map(e => e.text)
    const fgRoutes = routes.filter(r => r.startsWith('fg-'))
    test.skip(fgRoutes.length === 0, 'no foreground traffic in this window')

    expect(sections[0]).toMatch(FOREGROUND)

    // The property that matters is relative, not positional: whatever mix of
    // families the window contains, no background route may outrank a
    // foreground one.
    const lastFg = routes.map(r => r.startsWith('fg-')).lastIndexOf(true)
    const firstBg = routes.findIndex(r => !r.startsWith('fg-'))
    if (firstBg !== -1) expect(lastFg).toBeLessThan(firstBg)
  })

  test('foreground routes are contiguous under their header, and alphabetical', async ({ page }) => {
    await openRoutingTab(page)
    const entries = await readTable(page)
    const fgCount = entries.filter(e => e.kind === 'route' && e.text.startsWith('fg-')).length
    test.skip(fgCount < 2, 'fewer than two foreground routes in this window')

    // Contiguity is the half that discriminates. Alphabetical order ALONE is
    // satisfied by the old flat token-ordered table whenever spend happens to
    // rank the four the same way — verified: against the ungrouped renderer the
    // alphabetical assertion passed and caught nothing. Requiring the rows to
    // be consecutive AND directly under the foreground header is what a flat
    // list cannot do, because background routes sort between them.
    const start = entries.findIndex(e => e.kind === 'section' && FOREGROUND.test(e.text))
    expect(start).toBeGreaterThanOrEqual(0)

    const block: string[] = []
    for (let i = start + 1; i < entries.length && entries[i].kind === 'route'; i++) {
      block.push(entries[i].text)
    }
    expect(block).toHaveLength(fgCount)
    expect(block.every(r => r.startsWith('fg-'))).toBe(true)

    // claude, copilot, opencode, pi — a fixed set an operator looks up by name.
    expect(block).toEqual([...block].sort((a, b) => a.localeCompare(b)))
  })

  test('sections exist, and the catch-all is last when present', async ({ page }) => {
    await openRoutingTab(page)
    const entries = await readTable(page)
    test.skip(entries.length === 0, 'no routed calls recorded in this window')

    // Assert sections exist BEFORE looking for "Other". Guarding only on
    // "Other" made this test skip itself on the ungrouped renderer — a table
    // with no sections at all has no "Other" either, so the one arrangement it
    // was meant to reject was the one arrangement it never examined.
    const sections = entries.filter(e => e.kind === 'section').map(e => e.text)
    expect(sections.length).toBeGreaterThan(0)

    // "Other" collects route names outside the known prefixes. It sinking to
    // the bottom is what makes a drifted name noticeable instead of buried.
    if (sections.some(s => OTHER.test(s))) {
      expect(sections[sections.length - 1]).toMatch(OTHER)
    }
  })
})
