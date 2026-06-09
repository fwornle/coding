// Phase 55 Plan 01 Task 3 — 55-cap-removal smoke test.
//
// REPLACES the Phase 45 Plan 06 RCA-ingestion mock-mode spec. The CAP
// system is GONE (D-55-01b), so RCA ingestion ops no longer exist in
// the unified viewer. This file remains at its Phase 45 path so the
// 55-01-PLAN.md verification command (which greps this filename) keeps
// working through the cutover.
//
// PER-TASK VERIFICATION MAP: 55-01-PLAN.md Task 3 <behavior>
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/routes/UnifiedViewer.tsx
//                  + integrations/unified-viewer/src/routes/UnknownSystem.tsx
//                  + integrations/unified-viewer/src/config/system-endpoints.ts
//
// What this spec asserts:
//   1. /viewer/cap falls through to UnknownSystem (NOT the viewer chrome).
//   2. The page body contains zero `cc.bmwgroup.net` substring.
//   3. The page body contains no `(CORS)` banner copy from Phase 45's
//      hallucinated URL.
//   4. The UnknownSystem page's recovery links list only Coding + OKB
//      (no CAP link).

import { test, expect } from '@playwright/test'

test.describe('Unified Viewer — 55 CAP removal smoke (Phase 55 Plan 01 Task 3)', () => {
  test('/viewer/cap renders UnknownSystem with no cc.bmwgroup.net / no (CORS) banner', async ({
    page,
  }) => {
    await page.goto('/viewer/cap')

    // 1. UnknownSystem renders — viewer chrome does NOT.
    await expect(page.getByTestId('unknown-system')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Unknown system' })).toBeVisible()
    // Verify the viewer chrome did NOT mount.
    await expect(page.getByTestId('viewer-navbar')).toHaveCount(0)
    await expect(page.getByTestId('viewer-canvas')).toHaveCount(0)

    // 2. No `cc.bmwgroup.net` anywhere on the page (D-55-01c).
    const body = await page.locator('body').textContent()
    expect(body ?? '').not.toContain('cc.bmwgroup.net')

    // 3. No misleading `(CORS)` banner from the Phase 45 hallucinated URL.
    expect(body ?? '').not.toMatch(/\(CORS\)/)

    // 4. Recovery links — Coding + OKB only (CAP dropped per D-55-01b).
    const links = page.getByTestId('unknown-system-links')
    await expect(links).toBeVisible()
    await expect(links.getByRole('link', { name: 'Coding' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'OKB' })).toBeVisible()
    await expect(links.getByRole('link', { name: 'CAP' })).toHaveCount(0)
  })
})
