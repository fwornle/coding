// Phase 45 Plan 06 — Spec 2: Entity detail panel.
//
// PER-TASK VERIFICATION MAP: 45-VALIDATION.md row "entity-detail"
// SOURCE-OF-TRUTH: integrations/unified-viewer/src/panels/EntityDetailPanel.tsx
//                  + integrations/unified-viewer/src/store/viewer-store.ts
//
// What this spec asserts:
//   1. Loading /viewer/coding eventually renders the sigma canvas (≥1 node).
//   2. Programmatically selecting a node via the Zustand store —
//      `useViewerStore.setState({ selectedNodeId: '<id>' })` — surfaces
//      the EntityDetailPanel via the `entity-detail-panel` testid.
//   3. The panel renders the entity-name testid with non-empty text and
//      the entity-class-badge testid.
//   4. The Phase 44 camelCase wire-shape lock holds — a `digest`-like
//      entity carries `observationIds` (camelCase, array), NOT
//      `observation_ids` (snake_case, undefined). We test this by
//      calling the obs-api directly: `/api/coding/digests?limit=1`.
//
// We click the node via the Zustand store rather than a coordinate-based
// canvas click because sigma's WebGL hit-testing is unreliable inside
// headless chromium when ForceAtlas2 is still settling. The store path
// is the same code path the click event handler invokes (`events.ts`
// line `deps.setStore({ selectedNodeId: nodeId })`), so the test is
// semantically equivalent.

import { test, expect } from '@playwright/test'

interface WindowWithSigma {
  __viewerSigma?: {
    getGraph(): { order: number; nodes(): string[] }
  }
}

test.describe('Unified Viewer — entity detail panel', () => {
  test('selecting a node surfaces the entity detail panel', async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Wait until at least one node is loaded via the test hook.
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    // Pick the first node id from the graph and write it into the store.
    const firstNodeId = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      const nodes = w.__viewerSigma?.getGraph()?.nodes() ?? []
      return nodes[0] ?? null
    })
    expect(firstNodeId).not.toBeNull()

    // Drive selection via Zustand directly — same code path the click
    // handler in events.ts uses.
    await page.evaluate((id) => {
      const w = window as unknown as {
        // The store is module-scoped — re-import via dynamic require would
        // not work in the bundled context, so we set the selection through
        // a sigma click event the panel observes. Easiest: dispatch a
        // synthetic CustomEvent the React store subscribes to is not
        // available, so we use the public API surface: stash on window in
        // dev mode + the store exposes itself via React DevTools — but the
        // simplest stable path is to invoke the Zustand `useViewerStore`
        // module's `setState` via the global it re-exports. Plan 06 does
        // NOT add a new global; instead we rely on the click-through-canvas
        // pattern via sigma's emit('clickNode').
        __viewerSigma?: {
          emit(eventType: string, payload: unknown): void
        }
      }
      // Sigma exposes an event emitter; fire a synthetic clickNode so the
      // registered handler in SigmaCanvas runs `setStore({ selectedNodeId })`.
      w.__viewerSigma?.emit('clickNode', { node: id })
    }, firstNodeId)

    // The EntityDetailPanel becomes visible once the store flips.
    await expect(page.getByTestId('entity-detail-panel')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId('entity-name')).not.toHaveText('')
    await expect(page.getByTestId('entity-class-badge')).toBeVisible()
  })

  test('camelCase wire shape: digest.observationIds is the array key', async ({
    request,
  }) => {
    // Phase 44 Plan 16 lock: typed-view envelope returns camelCase. The
    // viewer trusts this contract end-to-end. Run the assertion directly
    // against the live A backend (the dashboard already runs this idiom).
    const res = await request.get('http://localhost:12436/api/coding/digests?limit=1')
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>
    }
    expect(Array.isArray(body.data)).toBe(true)
    if (body.data.length === 0) {
      // Empty database is acceptable — wire shape verification is moot.
      test.skip(true, 'No digests to verify wire shape against')
      return
    }
    const digest = body.data[0]
    // camelCase MUST be present.
    expect(digest).toHaveProperty('observationIds')
    expect(Array.isArray(digest.observationIds)).toBe(true)
    // snake_case MUST NOT be present.
    expect(digest).not.toHaveProperty('observation_ids')
  })
})
