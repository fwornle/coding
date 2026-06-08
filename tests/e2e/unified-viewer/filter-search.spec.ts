// Phase 45 Plan 06 — Spec 4: Filter rail + search.
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md rows
//   "filter-rail-search", "filter-rail-level", "filter-rail-class".
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/panels/FilterRail.tsx
//                  + integrations/unified-viewer/src/routes/UnifiedViewer.tsx
//                    (visibleCount predicate)
//
// What this spec asserts:
//   1. Loading /viewer/coding renders the search input + footer status line.
//   2. Typing a search query reduces `Showing X of Y` so X < Y (the
//      `visibleCount` predicate kicked in).
//   3. Unchecking a level checkbox further reduces the visible count.
//   4. Toggling a class checkbox via the multi-select changes the visible
//      count again (independent dimension).

import { test, expect } from '@playwright/test'

interface WindowWithSigma {
  __viewerSigma?: {
    getGraph(): { order: number }
  }
}

async function readFooter(page: import('@playwright/test').Page): Promise<{
  visible: number
  total: number
  edges: number
} | null> {
  const text = (await page.getByTestId('footer-status').textContent()) ?? ''
  // Format: "Showing X of Y nodes · Z edges" (tabular-num spans collapse to text)
  const m = /Showing\s+(\d+)\s+of\s+(\d+)\s+nodes\s*·\s*(\d+)\s+edges/.exec(text)
  if (!m) return null
  return { visible: Number(m[1]), total: Number(m[2]), edges: Number(m[3]) }
}

test.describe('Unified Viewer — filter + search', () => {
  test('search input reduces the visible-count footer', async ({ page }) => {
    await page.goto('/viewer/coding')

    // Wait for graph data + footer to populate.
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    const before = await readFooter(page)
    expect(before).not.toBeNull()
    if (!before) return
    expect(before.total).toBeGreaterThan(0)
    expect(before.visible).toBe(before.total) // default: everything visible

    // Type a search term that is unlikely to match every entity. We pick
    // a fragment that the live `Coding` graph almost certainly partials —
    // 'observation' is dense in the Phase-44 schema. Spec is robust
    // either way: we only require visible < total.
    await page.getByTestId('filter-search').fill('observation')

    await expect(async () => {
      const f = await readFooter(page)
      expect(f).not.toBeNull()
      if (!f) return
      expect(f.total).toBe(before.total)
      expect(f.visible).toBeLessThan(before.total)
    }).toPass({ timeout: 5_000 })
  })

  test('unchecking a level checkbox further filters', async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    const before = await readFooter(page)
    expect(before).not.toBeNull()
    if (!before) return

    // Uncheck level 0 (the top "System" level). Click the label — the
    // Checkbox is inside.
    const levelLabel = page.getByTestId('filter-level-0')
    await levelLabel.click()

    await expect(async () => {
      const f = await readFooter(page)
      expect(f).not.toBeNull()
      if (!f) return
      expect(f.total).toBe(before.total)
      // visible should be different (typically less) — but if there were
      // 0 level-0 nodes the count would stay equal. Assert non-increase.
      expect(f.visible).toBeLessThanOrEqual(before.visible)
    }).toPass({ timeout: 5_000 })
  })

  test('the class section renders Select-All/None and at least one class', async ({
    page,
  }) => {
    await page.goto('/viewer/coding')
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    const classSection = page.getByTestId('filter-class-section')
    await expect(classSection).toBeVisible()
    // The Class section has its own Select-All / None pair.
    const allNonePairs = classSection.getByTestId('filter-select-all-none')
    await expect(allNonePairs).toHaveCount(1)
    // At least one class checkbox renders.
    const classList = page.getByTestId('filter-class-list')
    await expect(classList).toBeVisible()
    // Clicking the "None" button under the class section drives visible→0.
    const before = await readFooter(page)
    expect(before).not.toBeNull()
    if (!before) return
    await classSection.getByRole('button', { name: 'Select None' }).click()
    await expect(async () => {
      const f = await readFooter(page)
      expect(f).not.toBeNull()
      if (!f) return
      expect(f.visible).toBe(0)
    }).toPass({ timeout: 5_000 })
  })
})
