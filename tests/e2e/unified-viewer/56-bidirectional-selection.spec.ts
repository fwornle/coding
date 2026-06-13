// PHASE 56 RED — turns GREEN incrementally by Plans 02/03/04 and verified
//                 end-to-end in Plan 04.
//
// Spec 1 covers AC #2 (graph → others highlight).
// Spec 2 covers AC #3 (history sidebar → graph + timeline).
// Spec 3 covers AC #4 (timeline tick → graph + history).
// Spec 4 covers AC #7 (Esc clears all three panes — passes after Plan 01
//        Task 2 for the store-side; visual zero-count assertions go fully
//        GREEN once Plans 02 + 03 wire the highlight classes).
//
// Driver: window.__viewerStore (published by Plan 01 Task 2 in
// UnifiedViewer.tsx). We do NOT touch __viewerSigma here — the coding view
// is rendered by D3GraphCanvas, not SigmaCanvas (UnifiedViewer.tsx:353:
// `const useD3 = system === 'coding' && renderer === 'd3'`). Driving
// selection through the Zustand store is the same code path the in-tree
// click handlers use, so the spec is semantically equivalent to a real
// canvas click and avoids the D3-force-settle race in headless chromium.
//
// References:
// - 56-CONTEXT.md ACs #2/#3/#4/#7
// - 56-PATTERNS.md § tests/e2e/unified-viewer/56-bidirectional-selection.spec.ts (NEW)
// - tests/e2e/unified-viewer/entity-detail.spec.ts (analog — "drive selection
//   via store, assert panel reacts" pattern)
//
// AVAILABILITY NOTE: this spec assumes the operator-managed `npm run dev`
// on :5173 is up (playwright.config.ts has no webServer block — see CLAUDE.md
// for the Vite dev contract). When running headless from a parallel-execution
// worktree, the Vite server runs from the main repo's working tree.

import { test, expect } from '@playwright/test'

interface WindowWithViewerStore {
  __viewerStore?: {
    getState(): {
      selectedNodeId: string | null
      selectionSource: string | null
      lslSessionFilter: string[]
      lslFilterEntityIds: ReadonlySet<string> | null
      highlightedRowKey: string | null
      selectedSessionId: string | null
      setSelection(args: {
        nodeId?: string | null
        sessionId?: string | null
        highlightedRowKey?: string | null
        source: string | null
        pathToSelected?: Set<string>
      }): void
      clearSelection(): void
    }
  }
}

test.describe('Unified Viewer — Phase 56 bidirectional selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Wait for the Plan 01 Task 2 hook to be published AND for data to
    // arrive — the LSL timeline strip rendering at least one tick proves
    // the lsl/sessions fetch resolved and the graph data fetch is far
    // enough along to expose real entity ids. 30s tolerance for D3 force
    // settle + LSL fetch on cold cache.
    await expect(async () => {
      const hookExists = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        return typeof w.__viewerStore?.getState === 'function'
      })
      expect(hookExists).toBe(true)
      const ticks = await page.locator('[data-testid^="lsl-tick-"]').count()
      expect(ticks).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })
  })

  test('Spec 1 — selecting a graph node highlights matching history row + timeline tick (AC #2)', async ({
    page,
  }) => {
    // AC #2: Selecting a node in the graph highlights matching row(s) in
    // history sidebar AND ticks on the timeline.

    // Source the first entity id from the live obs-api so the selection
    // refers to a real node in the graph. The unified-viewer at :5173 is
    // dev-proxied to obs-api :12436; we hit obs-api directly because that
    // path doesn't depend on the dev-server proxy config.
    const firstNodeId = await page.evaluate(async () => {
      const r = await fetch('http://localhost:12436/api/coding/entities?limit=1')
      if (!r.ok) return null
      const j = (await r.json()) as { data?: Array<{ id?: string }> }
      return j.data?.[0]?.id ?? null
    })
    expect(firstNodeId).not.toBeNull()

    await page.evaluate((id) => {
      const w = window as unknown as WindowWithViewerStore
      w.__viewerStore!.getState().setSelection({
        nodeId: id,
        source: 'graph',
        pathToSelected: new Set([id as string]),
      })
    }, firstNodeId)

    // History sidebar row highlighted. The visual highlight class is added
    // in Plan 02; until then this assertion is RED.
    await expect(page.locator(`[data-history-id="${firstNodeId}"]`)).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.locator(`[data-history-id="${firstNodeId}"]`)).toHaveClass(
      /bg-blue|ring-blue|bg-accent/,
      { timeout: 5_000 },
    )

    // Timeline tick ring — LslTimelineStrip already exposes `ring-blue-500`
    // via its `isSelectedBucket` predicate (lines 422-435). Plan 02
    // verifies this still fires after the atomic-write extension.
    await expect(
      page
        .locator('[data-testid^="lsl-tick-"]')
        .filter({ has: page.locator('.ring-blue-500') }),
    ).toHaveCount(1, { timeout: 5_000 })
  })

  test('Spec 2 — clicking a history sidebar row drives graph + timeline (AC #3)', async ({
    page,
  }) => {
    // AC #3: Selecting a row in the history sidebar centers/highlights the
    // corresponding node in the graph AND highlights the matching timeline
    // tick. Plan 02 makes the click write atomically through setSelection().

    const firstRow = page.locator('[data-history-id]').first()
    await expect(firstRow).toBeVisible({ timeout: 10_000 })
    const rowId = await firstRow.getAttribute('data-history-id')
    expect(rowId).not.toBeNull()

    await firstRow.click()

    // Store reflects the click — RED until Plan 02 routes the click
    // through setSelection({ source: 'history' }) instead of bare setState.
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        return {
          id: w.__viewerStore!.getState().selectedNodeId,
          src: w.__viewerStore!.getState().selectionSource,
        }
      })
      expect(s.id).toBe(rowId)
      expect(s.src).toBe('history')
    }).toPass({ timeout: 5_000 })

    // Timeline tick ringed once the matching session shows highlight.
    await expect(page.locator('.ring-blue-500')).toHaveCount(1, { timeout: 5_000 })
  })

  test('Spec 3 — clicking a timeline tick drives graph + history (AC #4)', async ({
    page,
  }) => {
    // AC #4: Clicking a timeline tick or session-segment selects the
    // corresponding node(s) in the graph AND scrolls/highlights the
    // matching history sidebar row. Today's LslTimelineStrip already
    // writes selectedNodeId on click (lines 287-330); Plan 03 extends to
    // setSelection({ source: 'timeline', highlightedRowKey, selectedSessionId }).

    const firstTick = page.locator('[data-testid^="lsl-tick-sess-"]').first()
    await expect(firstTick).toBeVisible({ timeout: 10_000 })
    await firstTick.click()

    // Store reflects the tick click. selectedNodeId is non-null because the
    // tick exposes its session's entityIds; selectionSource is 'timeline'
    // (RED until Plan 03's atomic-write extension).
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        return {
          id: w.__viewerStore!.getState().selectedNodeId,
          src: w.__viewerStore!.getState().selectionSource,
        }
      })
      expect(s.id).not.toBeNull()
      expect(s.src).toBe('timeline')
    }).toPass({ timeout: 5_000 })

    // The matching history sidebar row exists in DOM after the click.
    const selectedId = await page.evaluate(() => {
      const w = window as unknown as WindowWithViewerStore
      return w.__viewerStore!.getState().selectedNodeId
    })
    await expect(
      page.locator(`[data-history-id="${selectedId}"]`),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('Spec 4 — Esc clears selection in all three panes (AC #7)', async ({ page }) => {
    // AC #7: Esc + click-background clears selection in all three panes
    // simultaneously. Plan 01 Task 2 routes Esc through clearSelection()
    // which cascades through the LSL filter slice — so the store-side
    // assertions go GREEN today. The visual zero-count assertions on
    // `.ring-blue-500` and `[data-history-id].bg-blue` go GREEN once
    // Plans 02 + 03 wire the highlight classes (they're already absent
    // today simply because the highlights haven't been added yet).

    const firstNodeId = await page.evaluate(async () => {
      const r = await fetch('http://localhost:12436/api/coding/entities?limit=1')
      if (!r.ok) return null
      const j = (await r.json()) as { data?: Array<{ id?: string }> }
      return j.data?.[0]?.id ?? null
    })
    expect(firstNodeId).not.toBeNull()

    // Drive a multi-pane selection: graph node + LSL session filter +
    // history row highlight. All set atomically via the store hook.
    await page.evaluate((id) => {
      const w = window as unknown as WindowWithViewerStore
      const store = w.__viewerStore!.getState()
      store.setSelection({
        nodeId: id,
        highlightedRowKey: id,
        sessionId: 'sess-test',
        source: 'graph',
        pathToSelected: new Set([id as string]),
      })
    }, firstNodeId)

    await page.keyboard.press('Escape')

    // Store-side cascade — passes after Plan 01 Task 2.
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        const st = w.__viewerStore!.getState()
        return {
          id: st.selectedNodeId,
          src: st.selectionSource,
          lsl: st.lslSessionFilter.length,
        }
      })
      expect(s.id).toBeNull()
      expect(s.src).toBeNull()
      expect(s.lsl).toBe(0)
    }).toPass({ timeout: 5_000 })

    // Visual cascade — Plans 02 + 03 wire these classes; for now they're
    // absent simply because the highlights haven't been added yet. The
    // assertions are still valuable: they fence against future regressions
    // where a stale highlight class outlives the cleared store snapshot.
    await expect(
      page.locator(
        '[data-history-id].bg-blue, [data-history-id].ring-blue, [data-history-id].bg-accent',
      ),
    ).toHaveCount(0)
    await expect(page.locator('.ring-blue-500')).toHaveCount(0)
  })
})
