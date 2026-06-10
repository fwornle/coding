// Phase 55 Plan 13 — Spec: CAP tab removal verification (D-55-01b / D-55-01c).
//
// SCOPE: Phase 55 amends Phase 45 D-45-02 — CAP was a hallucinated URL
//        (`https://okm.cc.bmwgroup.net` does not exist; nothing is on
//         cc.bmwgroup.net). Phase 55 ships a 2-system viewer (coding + okb).
//
// What this spec asserts:
//   1. /viewer/cap falls through to UnknownSystem (NOT a redirect to
//      cc.bmwgroup.net, NOT a (CORS) banner from the phantom URL).
//   2. Page body does not contain the literal string `cc.bmwgroup.net` —
//      forbidden-string gate per D-55-01c.
//   3. No `cap` entry in the NavBar; no `nav-link-cap` testid.
//   4. UnknownSystem recovery links list Coding + OKB only — no CAP entry.
//   5. Forbidden-string check ALSO runs on /viewer/coding and /viewer/okb
//      so any inherited cc.bmwgroup.net string in the application shell
//      (footer, error banners, ToS, etc.) is caught.
//
// SOURCE-OF-TRUTH:
//   - integrations/unified-viewer/src/config/system-endpoints.ts (System union)
//   - integrations/unified-viewer/src/routes/UnknownSystem.tsx
//   - integrations/unified-viewer/src/panels/NavBar.tsx (nav-link-<sys>)
//
// SEE ALSO: 55-01-SUMMARY.md (CAP removal evidence) — this spec is the
//           runtime gate that proves the purge holds.

import { test, expect } from '@playwright/test'

test.describe('Phase 55 — CAP tab removed (D-55-01b / D-55-01c)', () => {
  test('/viewer/cap renders UnknownSystem 404 page (no redirect, no CORS banner)', async ({
    page,
  }) => {
    await page.goto('/viewer/cap')

    // UnknownSystem rendered (NOT the viewer chrome).
    await expect(page.getByTestId('unknown-system')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Unknown system' }),
    ).toBeVisible()

    // No `(CORS)` banner from the hallucinated Phase 45 URL.
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
    expect(body).not.toMatch(/\(CORS\)/)
  })

  test('UnknownSystem recovery links do not include CAP', async ({ page }) => {
    await page.goto('/viewer/cap')
    const links = page.getByTestId('unknown-system-links')
    await expect(links).toBeVisible()
    await expect(links.getByRole('link', { name: 'Coding' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'OKB' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'CAP' })).toHaveCount(0)

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('NavBar shows only Coding + OKB nav links (no CAP entry)', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()

    // Two valid system links present, CAP absent.
    await expect(page.getByTestId('nav-link-coding')).toBeVisible()
    await expect(page.getByTestId('nav-link-okb')).toBeVisible()
    await expect(page.getByTestId('nav-link-cap')).toHaveCount(0)

    // Forbidden-string gate (D-55-01c).
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })

  test('forbidden-string gate holds on /viewer/okb', async ({ page }) => {
    await page.goto('/viewer/okb')
    await expect(page.getByTestId('viewer-navbar')).toBeVisible()
    const body = (await page.locator('body').textContent()) ?? ''
    expect(body).not.toContain('cc.bmwgroup.net')
  })
})
