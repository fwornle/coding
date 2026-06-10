// Phase 55 Plan 13 — Spec: Coding-only surfaces (D-55-02b / UI-SPEC §6 + §13).
//
// SCOPE: Four coding-specific surfaces beyond VOKB parity:
//   - HierarchyNavigator (lazy mount inside FilterRail)
//   - LslTimelineStrip (between main content + Footer)
//   - EtmTailSheet (Radix sheet via NavBar 📡 button; portaled)
//   - WorkflowStatusPanel (below Footer)
//
//   All four mount ONLY when `system === 'coding'` (UnifiedViewer.tsx gating).
//   /viewer/okb MUST NOT render any of them.
//
// What this spec asserts:
//   1. /viewer/coding mounts HierarchyNavigator (or its fallback shimmer
//      `hierarchy-navigator-fallback` if Suspense hasn't resolved yet).
//   2. /viewer/coding mounts LslTimelineStrip (`lsl-strip` testid).
//   3. /viewer/coding mounts WorkflowStatusPanel (`workflow-status-panel`).
//   4. /viewer/coding NavBar exposes the 📡 ETM trigger
//      (`etm-tail-trigger`); clicking it opens the EtmTailSheet
//      (Radix sheet → `etm-tail-sheet` testid).
//   5. /viewer/okb: NONE of those 4 surfaces are present (gate verified).
//   6. Forbidden-string gate (D-55-01c).
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/routes/UnifiedViewer.tsx
//     (system === 'coding' &&  <{Lsl|Workflow|Etm}> mounting)
//   - integrations/unified-viewer/src/panels/FilterRail.tsx
//     (HierarchyNavigator lazy mount with system gate)
//   - integrations/unified-viewer/src/panels/NavBar.tsx (etm-tail-trigger)

import { test, expect } from '@playwright/test'

test.describe('Phase 55 — Coding-only surfaces (D-55-02b)', () => {
  test('/viewer/coding: HierarchyNavigator mounts (or its Suspense fallback)', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-filter-rail')).toBeVisible()

    // Either the real component OR its lazy fallback. Both signal that
    // the gating predicate fired.
    const real = page.getByTestId('hierarchy-navigator')
    const fallback = page.getByTestId('hierarchy-navigator-fallback')
    const realCount = await real.count()
    const fallbackCount = await fallback.count()
    expect(realCount + fallbackCount).toBeGreaterThan(0)

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('/viewer/coding: LslTimelineStrip mounts between content and Footer', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('lsl-strip')).toBeVisible({ timeout: 10_000 })
  })

  test('/viewer/coding: WorkflowStatusPanel mounts below Footer', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('workflow-status-panel')).toBeVisible({
      timeout: 10_000,
    })
  })

  test('/viewer/coding: NavBar 📡 button opens EtmTailSheet', async ({ page }) => {
    await page.goto('/viewer/coding')
    const trigger = page.getByTestId('etm-tail-trigger')
    await expect(trigger).toBeVisible()

    // Before click: sheet not mounted.
    await expect(page.getByTestId('etm-tail-sheet')).toHaveCount(0)

    await trigger.click()

    // Radix sheets portal into document.body — toBeVisible against the
    // testid is portal-tolerant.
    await expect(page.getByTestId('etm-tail-sheet')).toBeVisible({
      timeout: 5_000,
    })
    // After opening, the trigger's aria-label flips to "Close...".
    await expect(trigger).toHaveAttribute(
      'aria-label',
      'Close observation stream',
    )
  })

  test('/viewer/okb: NONE of the coding-only surfaces are present', async ({
    page,
  }) => {
    await page.goto('/viewer/okb')
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Hierarchy (FilterRail-internal) — only the FILTER RAIL mounts on OKB;
    // the HierarchyNavigator is gated by `system === 'coding'` and must
    // not appear (neither real nor fallback).
    await expect(page.getByTestId('hierarchy-navigator')).toHaveCount(0)
    await expect(page.getByTestId('hierarchy-navigator-fallback')).toHaveCount(0)

    // LslTimelineStrip — coding-only.
    await expect(page.getByTestId('lsl-strip')).toHaveCount(0)

    // WorkflowStatusPanel — coding-only.
    await expect(page.getByTestId('workflow-status-panel')).toHaveCount(0)

    // ETM trigger — coding-only (NavBar gates on currentSystem === 'coding').
    await expect(page.getByTestId('etm-tail-trigger')).toHaveCount(0)

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })
})
