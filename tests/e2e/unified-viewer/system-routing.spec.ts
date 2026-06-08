// Phase 45 Plan 06 — Spec 1: System routing.
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "system-routing"
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/App.tsx (routes)
//                  + integrations/unified-viewer/src/routes/UnifiedViewer.tsx
//                  + integrations/unified-viewer/src/routes/UnknownSystem.tsx
//
// What this spec asserts:
//   1. `/` redirects (via React-Router <Navigate replace>) to `/viewer/coding`.
//   2. `/viewer/coding` mounts the viewer and renders the canvas wrapper.
//   3. `/viewer/okb` mounts the viewer and renders the canvas wrapper.
//   4. `/viewer/cap` mounts the viewer — but may surface the unreachable /
//      CORS banner if Probe 1 was RED (BMW corp network not reachable from
//      this executor). Both outcomes are accepted, mirroring 45-06-PLAN.md
//      Task 2 spec-1 contract.
//   5. `/viewer/foo` shows the UnknownSystem 404 page with the three
//      recovery links labeled per UI-SPEC.
//
// We use the `viewer-canvas` and `unknown-system` testids stabilised by
// Plans 03 / 04 / 05 — anchoring selectors there keeps the spec robust
// against CSS class churn.

import { test, expect } from '@playwright/test'

test.describe('Unified Viewer — system routing', () => {
  test('GET / redirects to /viewer/coding', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/viewer\/coding$/)
    // The viewer chrome must have mounted — `viewer-navbar` exists.
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()
  })

  test('/viewer/coding mounts the viewer chrome', async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()
    // Active nav link reflects the current system.
    await expect(page.getByTestId('nav-link-coding')).toHaveAttribute(
      'data-active',
      'true',
    )
  })

  test('/viewer/okb mounts the viewer chrome', async ({ page }) => {
    await page.goto('/viewer/okb')
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()
    await expect(page.getByTestId('nav-link-okb')).toHaveAttribute(
      'data-active',
      'true',
    )
    // OKB carries the Markdown side-panel tab.
    await expect(page.getByTestId('tab-markdown')).toBeVisible()
  })

  test('/viewer/cap mounts the viewer chrome (live or error banner)', async ({
    page,
  }) => {
    await page.goto('/viewer/cap')
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()
    await expect(page.getByTestId('nav-link-cap')).toHaveAttribute(
      'data-active',
      'true',
    )
    // CAP carries the RCA side-panel tab regardless of backend reachability.
    await expect(page.getByTestId('tab-rca')).toBeVisible()
    // Either the canvas is live OR an error banner mentions the CAP base URL.
    // Probe 1 RED → ErrorUnreachableState/ErrorCorsState renders inside
    // viewer-canvas with copy `Cannot reach cap API at https://okm.cc.bmwgroup.net...`.
    const sigmaRoot = page.getByTestId('sigma-canvas-root')
    const unreachable = page.getByTestId('state-error-unreachable')
    const cors = page.getByTestId('state-error-cors')
    const empty = page.getByTestId('state-empty-no-data')
    const loading = page.getByTestId('state-initial-loading')
    // Wait up to 15s for one of the five mutually-exclusive states.
    await expect(async () => {
      const counts = await Promise.all([
        sigmaRoot.count(),
        unreachable.count(),
        cors.count(),
        empty.count(),
        loading.count(),
      ])
      expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })
  })

  test('/viewer/foo renders the UnknownSystem page with recovery links', async ({
    page,
  }) => {
    await page.goto('/viewer/foo')
    await expect(page.getByTestId('unknown-system')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Unknown system' })).toBeVisible()
    const links = page.getByTestId('unknown-system-links')
    await expect(links).toBeVisible()
    // Three recovery links — Coding / OKB / CAP.
    await expect(links.getByRole('link', { name: 'Coding' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'OKB' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'CAP' })).toBeVisible()
  })
})
