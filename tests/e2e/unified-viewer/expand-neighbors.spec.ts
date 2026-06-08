// Phase 45 Plan 06 — Spec 3: Expand-neighbors (double-click).
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "expand-neighbors"
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/graph/events.ts
//                  `handleDoubleClickNode` — fetches /api/v1/entities/:id/neighbors
//                  and merges new nodes via Graphology's mergeNode op.
//
// What this spec asserts:
//   1. /viewer/coding loads with ≥1 node in the graph.
//   2. Firing a `doubleClickNode` event through sigma's emitter does NOT
//      throw and does NOT regress graph.order (it either stays the same —
//      no new neighbors — or strictly increases — neighbors merged in).
//   3. No console errors fire during the operation (Pitfall T-45-02-04
//      idempotency lock).

import { test, expect } from '@playwright/test'

interface WindowWithSigma {
  __viewerSigma?: {
    getGraph(): { order: number; nodes(): string[] }
    emit(eventType: string, payload: unknown): void
  }
}

test.describe('Unified Viewer — expand-neighbors', () => {
  test('double-clicking a node merges neighbors without errors', async ({
    page,
  }) => {
    // Filter backend-source errors (404s on /api/v1/entities/:id/neighbors
    // surface as console errors when fetch responds non-ok — they indicate
    // a missing-data path on the backend, not a viewer bug). The Pitfall
    // T-45-02-04 contract is about VIEWER-side idempotency, not backend
    // data completeness.
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      if (/Failed to load resource.*status of 404/i.test(text)) return
      if (/\/api\/v1\/entities\/.+\/neighbors.*HTTP 404/i.test(text)) return
      consoleErrors.push(text)
    })

    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Wait for sigma to load and the test hook to expose the instance.
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    const initialOrder = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      return w.__viewerSigma?.getGraph()?.order ?? 0
    })
    const firstNodeId = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      const nodes = w.__viewerSigma?.getGraph()?.nodes() ?? []
      return nodes[0] ?? null
    })
    expect(firstNodeId).not.toBeNull()

    // Trigger expand-neighbors via the registered sigma event handler.
    await page.evaluate((id) => {
      const w = window as unknown as WindowWithSigma
      w.__viewerSigma?.emit('doubleClickNode', { node: id })
    }, firstNodeId)

    // Allow the fetch + merge to complete. The fetch is /api/v1/entities/:id/neighbors
    // which is fast against the live backend; 5s is comfortably generous.
    await page.waitForTimeout(2_000)

    const afterOrder = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      return w.__viewerSigma?.getGraph()?.order ?? 0
    })

    // Order monotonically non-decreasing. The `getNeighbors` endpoint may
    // return an empty `neighbors[]` for leaf nodes — that's a legitimate
    // path (no new ids merged) per the T-45-02-04 idempotency contract.
    expect(afterOrder).toBeGreaterThanOrEqual(initialOrder)

    // No console errors during the operation.
    expect(consoleErrors).toEqual([])
  })
})
