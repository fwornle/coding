// Phase 45 Plan 06 — Spec 1: System routing.
// AMENDED by Phase 55 Plan 01 Task 3 (D-55-01b — CAP system dropped).
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "system-routing"
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/App.tsx (routes)
//                  + integrations/unified-viewer/src/routes/UnifiedViewer.tsx
//                  + integrations/unified-viewer/src/routes/UnknownSystem.tsx
//
// What this spec asserts (Phase 55, 2-system viewer):
//   1. `/` redirects (via React-Router <Navigate replace>) to `/viewer/coding`.
//   2. `/viewer/coding` mounts the viewer and renders the canvas wrapper.
//   3. `/viewer/okb` mounts the viewer and renders the canvas wrapper.
//   4. `/viewer/cap` falls through to UnknownSystem (cap is no longer valid).
//      NO `(CORS)` banner, NO `cc.bmwgroup.net` string anywhere on the page.
//   5. `/viewer/foo` shows the UnknownSystem 404 page with the two
//      recovery links labeled per UI-SPEC.

import { test, expect } from '@playwright/test'

test.describe('Unified Viewer — system routing (Phase 55)', () => {
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

  test('/viewer/cap falls through to UnknownSystem (D-55-01b — CAP dropped)', async ({
    page,
  }) => {
    await page.goto('/viewer/cap')
    // UnknownSystem 404 page renders — NOT the viewer chrome.
    await expect(page.getByTestId('unknown-system')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Unknown system' })).toBeVisible()
    // Two recovery links (Coding + OKB) — CAP is not in the list.
    const links = page.getByTestId('unknown-system-links')
    await expect(links).toBeVisible()
    await expect(links.getByRole('link', { name: 'Coding' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'OKB' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'CAP' })).toHaveCount(0)
    // D-55-01c: no `cc.bmwgroup.net` anywhere on the page; no misleading
    // `(CORS)` banner from the hallucinated Phase 45 URL.
    const body = await page.locator('body').textContent()
    expect(body ?? '').not.toContain('cc.bmwgroup.net')
    expect(body ?? '').not.toMatch(/\(CORS\)/)
  })

  test('/viewer/foo renders the UnknownSystem page with recovery links', async ({
    page,
  }) => {
    await page.goto('/viewer/foo')
    await expect(page.getByTestId('unknown-system')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Unknown system' })).toBeVisible()
    const links = page.getByTestId('unknown-system-links')
    await expect(links).toBeVisible()
    // Two recovery links per Phase 55 (Coding + OKB; CAP dropped).
    await expect(links.getByRole('link', { name: 'Coding' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'OKB' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'CAP' })).toHaveCount(0)
  })
})
