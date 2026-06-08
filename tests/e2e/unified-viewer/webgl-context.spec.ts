// Phase 45 Plan 06 — Spec 9: WebGL context lifecycle (20-cycle loop).
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "webgl-context" +
//   T-45-02-01 Denial-of-Service mitigation closure.
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/graph/SigmaCanvas.tsx
//                  (the `<SigmaContainer>` cleanup discharged by the
//                  `key={system}` remount in UnifiedViewer.tsx)
//
// Pitfall 8: Chrome bumps the WebGL context count limit at 16 active
// contexts. Each `<SigmaContainer>` mount allocates ONE WebGL context;
// if the previous container is not cleaned up, a 20-iteration switch
// loop blows past the limit and the canvas refuses to render the 17th+
// container.
//
// What this spec asserts:
//   1. Navigate /viewer/coding → /viewer/okb → /viewer/coding → ... 20
//      full cycles (40 navigations).
//   2. After the loop, the canvas still renders (sigma-canvas-root testid
//      visible) on the final route.
//   3. NO console message matches `/WebGL.*context/i` across the entire
//      run (Chrome's specific warning is "WARNING: Too many active WebGL
//      contexts. Oldest context will be lost." — case-insensitive
//      `webgl.*context` covers it).

import { test, expect } from '@playwright/test'

test.describe('Unified Viewer — WebGL context lifecycle', () => {
  test('20-cycle system switch leaks no WebGL contexts', async ({ page }) => {
    test.setTimeout(180_000) // 3min — sigma needs ~1-2s to settle per route.

    const webglWarnings: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (/webgl.*context/i.test(text)) {
        webglWarnings.push(`[${msg.type()}] ${text}`)
      }
    })

    await page.goto('/viewer/coding')
    await expect(page.getByTestId('sigma-canvas-root')).toBeVisible({
      timeout: 30_000,
    })

    for (let i = 0; i < 20; i++) {
      await page.goto('/viewer/okb')
      await expect(page.getByTestId('viewer-canvas')).toBeVisible({
        timeout: 30_000,
      })
      await page.goto('/viewer/coding')
      await expect(page.getByTestId('viewer-canvas')).toBeVisible({
        timeout: 30_000,
      })
    }

    // After the 20-cycle loop, the canvas is still visible.
    await expect(page.getByTestId('sigma-canvas-root')).toBeVisible({
      timeout: 30_000,
    })

    // Zero WebGL context warnings across the entire run.
    expect(webglWarnings).toEqual([])
  })
})
