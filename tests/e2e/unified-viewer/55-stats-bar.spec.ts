// Phase 55 Plan 13 — Spec: StatsBar parity with VOKB (SC-6 / UI-SPEC §6).
//
// SCOPE: StatsBar lives at the top of the viewer chrome. It must show
//        7 slots: nodes, edges, evidence, patterns, orphans, connectivity %,
//        and a LIVE indicator (=7 slots total = 6 metric cells + 1 LIVE chip).
//        Numbers use the `tabular-nums` class; LIVE dot is `bg-emerald-500`
//        when SSE handshake succeeds, otherwise `bg-muted-foreground`.
//
// What this spec asserts:
//   1. /viewer/coding: StatsBar visible, 6 metric cells + LIVE indicator
//      = 7 slots total. Each metric cell exposes a `stats-metric-<id>` testid.
//   2. /viewer/okb: same StatsBar contract (Phase 55 ships the bar for both
//      systems per UI-SPEC §6).
//   3. The value cells (`stats-metric-<id>-value`) carry the `tabular-nums`
//      class — UI-SPEC §3.5 typography contract.
//   4. The LIVE chip dot exists; we DO NOT pin it to bg-emerald-500 because
//      SSE may not be up in CI — but we assert one of the two valid CSS
//      classes is present (emerald = live, muted-foreground = polling).
//   5. Forbidden-string gate (D-55-01c).
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/panels/StatsBar.tsx (METRICS = 6 cells)
//   - integrations/unified-viewer/src/panels/StatsBar.tsx:204 (live-indicator)
//
// NOTE: METRICS contains 6 entries (nodes, edges, evidence, patterns,
//       orphans, connectivity). The "7 slots" total includes the LIVE chip
//       per UI-SPEC §6. Plan 55-13 acceptance criterion phrasing of
//       "7 numeric metric slots" is reconciled here as 6 metric cells +
//       1 LIVE chip = 7 visible cells.

import { test, expect } from '@playwright/test'

const METRIC_IDS = ['nodes', 'edges', 'evidence', 'patterns', 'orphans', 'connectivity']

test.describe('Phase 55 — StatsBar (SC-6 / UI-SPEC §6)', () => {
  for (const system of ['coding', 'okb'] as const) {
    test(`StatsBar renders 6 metric cells + LIVE chip on /viewer/${system}`, async ({
      page,
    }) => {
      await page.goto(`/viewer/${system}`)
      const bar = page.getByTestId('stats-bar')
      await expect(bar).toBeVisible()

      // 6 metric cells present.
      for (const id of METRIC_IDS) {
        await expect(bar.getByTestId(`stats-metric-${id}`)).toBeVisible()
        await expect(bar.getByTestId(`stats-metric-${id}-value`)).toBeVisible()
      }

      // 7th slot: the LIVE indicator chip.
      await expect(bar.getByTestId('live-indicator')).toBeVisible()
      await expect(bar.getByTestId('live-indicator-dot')).toBeVisible()

      // Forbidden-string gate (D-55-01c).
      const body = (await page.locator('body').textContent()) ?? ''
      expect(body).not.toContain('cc.bmwgroup.net')
    })
  }

  test('metric value cells carry the tabular-nums class', async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('stats-bar')).toBeVisible()

    for (const id of METRIC_IDS) {
      const cell = page.getByTestId(`stats-metric-${id}-value`)
      await expect(cell).toBeVisible()
      const className = (await cell.getAttribute('class')) ?? ''
      expect(className).toContain('tabular-nums')
    }
  })

  test('LIVE chip dot uses emerald-500 (live) or muted-foreground (polling)', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    const dot = page.getByTestId('live-indicator-dot')
    await expect(dot).toBeVisible()

    const className = (await dot.getAttribute('class')) ?? ''
    // Either of the two SSE-state CSS classes must be present.
    const isLive = className.includes('bg-emerald-500')
    const isPolling = className.includes('bg-muted-foreground')
    expect(isLive || isPolling).toBe(true)

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })
})
