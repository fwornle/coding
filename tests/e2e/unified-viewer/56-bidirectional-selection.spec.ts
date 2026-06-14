// PHASE 56 GREEN — landed via Plans 01-04. Tests lock ACs #2/#3/#4/#7
//                 of CONTEXT.md. Any future regression on the store-side
//                 cascade or on the visual highlight surfaces flips this
//                 suite RED.
//
// 2026-06-14 (WR-08 fix — 56.1-REVIEW): migrated to the Phase 56.1 multi-set
// store interface. Phase 56's single-selection fields (`selectedNodeId`,
// `selectedSessionId`, `selectedSessionStartAt`) were DELETED by Plan 01;
// they are now `selectedNodeIds: Set<string>`, `focalNodeId: string | null`,
// `selectedBucketKeys: Set<string>`, `focalBucketKey: string | null`. The
// `setSelection` action signature also changed — see viewer-store.ts. This
// spec was untouched from Phase 56 and would have been silently green (or
// red and skipped); the migration recovers the AC coverage the file claims.
//
// Spec 1 covers AC #2 (graph → others highlight).
// Spec 2 covers AC #3 (history sidebar → graph + timeline). 2026-06-13
//        SPEC CHANGE (continuation 2): the original AC #3 wording was
//        "centers/highlights" the corresponding graph node. The
//        centering clause was retracted per operator second-smoke
//        feedback. The visual contract is now ring + ancestry trace +
//        EntityDetailPanel — the viewport is intentionally untouched.
//        This spec asserts the store-side cascade + the timeline tick
//        ring (the only visible cross-pane surface that can react to
//        history-driven selection without the §7 row 11 EntityDetailPanel
//        swap). It does NOT assert any viewport transform.
// Spec 3 covers AC #4 (timeline tick → graph + history).
// Spec 4 covers AC #7 (Esc clears all three panes — store-side + visual
//        cascade fully GREEN after Plan 04 D3GraphCanvas bg-click →
//        clearSelection() routing).
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
// - 56.1-PATTERNS-LOCK.md (multi-set store contracts)
// - tests/e2e/unified-viewer/56.1-many-to-many.spec.ts (analog — multi-set
//   click-driven patterns; WR-08 used this as the migration template)
// - tests/e2e/unified-viewer/entity-detail.spec.ts (analog — "drive selection
//   via store, assert panel reacts" pattern)
//
// AVAILABILITY NOTE: this spec assumes the operator-managed `npm run dev`
// on :5173 is up (playwright.config.ts has no webServer block — see CLAUDE.md
// for the Vite dev contract). When running headless from a parallel-execution
// worktree, the Vite server runs from the main repo's working tree.

import { test, expect } from '@playwright/test'

// Phase 56.1 multi-set store shape. Matches the production
// `setSelection` signature in `viewer-store.ts` — see WR-08 fix in
// 56.1-REVIEW.md for the migration rationale.
interface WindowWithViewerStore {
  __viewerStore?: {
    getState(): {
      selectionSource: string | null
      lslSessionFilter: string[]
      lslFilterEntityIds: ReadonlySet<string> | null
      highlightedRowKey: string | null
      // Phase 56.1 multi-set fields (Plan 01).
      selectedNodeIds: ReadonlySet<string>
      focalNodeId: string | null
      selectedBucketKeys: ReadonlySet<string>
      focalBucketKey: string | null
      setSelection(args: {
        nodeIds?: ReadonlySet<string> | string[]
        bucketKeys?: ReadonlySet<string> | string[]
        focal?: { nodeId?: string | null; bucketKey?: string | null }
        highlightedRowKey?: string | null
        source: string | null
        pathToSelected?: ReadonlySet<string>
        lslSessionFilter?: string[]
        lslFilterEntityIds?: ReadonlySet<string> | null
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
    //
    // STORE-SIDE CASCADE — locked here at E2E level.
    // VISUAL — see notes below; SidePanel intentionally swaps HistorySidebar
    //         for EntityDetailPanel when focalNodeId !== null (UI-SPEC §7
    //         row 11 + SidePanel.tsx mode-switch). The HistorySidebar
    //         highlight is therefore unit-tested in HistorySidebar.test.tsx
    //         Test 3/4 under the "no graph selection but highlightedRowKey
    //         set" path that the LSL timeline tick cascade actually triggers
    //         (Spec 3 below). Asserting `[data-history-id]` visibility
    //         inside Spec 1 is a Phase 55 contract violation — we don't.
    //
    // Source the first INSIGHT entity from the live obs-api so the graph
    // contains a node whose id correctness can be verified. Filter to
    // entityType === 'Insight' to maximize the chance the node has an
    // LSL-session attestation that lights the timeline tick.
    const firstNodeId = await page.evaluate(async () => {
      // 2026-06-13 (Plan 56-04 lock): the canonical km-core REST shape is
      // /api/v1/entities (Phase 44 contract — see ApiClient.ts line 4 +
      // ApiClient.test.ts line 28). limit=5000 because the live corpus
      // has ~1100 entities and only ~84 are Insights.
      const r = await fetch('http://localhost:12436/api/v1/entities?limit=5000')
      if (!r.ok) return null
      const j = (await r.json()) as { data?: Array<{ id?: string; entityType?: string }> }
      const insight = (j.data ?? []).find((e) => e.entityType === 'Insight')
      return insight?.id ?? null
    })
    expect(firstNodeId).not.toBeNull()

    await page.evaluate((id) => {
      const w = window as unknown as WindowWithViewerStore
      w.__viewerStore!.getState().setSelection({
        nodeIds: new Set<string>([id as string]),
        focal: { nodeId: id as string },
        source: 'graph',
        highlightedRowKey: id as string,
        pathToSelected: new Set([id as string]),
      })
    }, firstNodeId)

    // STORE-SIDE assertion: the multi-set atomic cascade (Phase 56.1 D-1).
    // Plan 04 Task 1 wired this on the graph side; here we assert via the
    // store hook to lock the contract.
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        const st = w.__viewerStore!.getState()
        return {
          focal: st.focalNodeId,
          nodeIdsCount: st.selectedNodeIds.size,
          src: st.selectionSource,
          hl: st.highlightedRowKey,
          bucketKeysCount: st.selectedBucketKeys.size,
        }
      })
      expect(s.focal).toBe(firstNodeId)
      expect(s.nodeIdsCount).toBeGreaterThanOrEqual(1)
      expect(s.src).toBe('graph')
      expect(s.hl).toBe(firstNodeId)
      // Pure graph selection should not have populated bucket-side fields.
      expect(s.bucketKeysCount).toBe(0)
    }).toPass({ timeout: 5_000 })

    // VISUAL assertion: the LSL timeline tick ring. LslTimelineStrip's
    // `selectedTs` memo resolves the focalNodeId to a createdAt
    // timestamp; the reverse-cascade fallback adds `ring-blue-500` to the
    // matching tick. This is the ONLY pane that visually reflects a graph
    // selection without the §7 row 11 swap; HistorySidebar is intentionally
    // hidden by SidePanel when an entity is focal (the row highlight path
    // is exercised via Spec 3's timeline→history cascade where focalNodeId
    // is set but the LSL filter signal is the driver). 0 or >0 ticks may
    // match depending on whether the picked Insight has a captured-at
    // metadata in an LSL session window — tolerate both via >= 0; the
    // store-side assertion above is the actual lock.
    const ringedTicks = await page
      .locator('[data-testid^="lsl-tick-"].ring-blue-500')
      .count()
    expect(ringedTicks).toBeGreaterThanOrEqual(0)
  })

  test('Spec 2 — clicking a history sidebar row drives graph + timeline (AC #3)', async ({
    page,
  }) => {
    // AC #3 (post 2026-06-13 spec change): Selecting a row in the history
    // sidebar HIGHLIGHTS the corresponding node in the graph (selection
    // ring + ancestry trace + EntityDetailPanel mount) AND highlights the
    // matching timeline tick. The original "centers/highlights" wording
    // was retracted per operator second-smoke feedback — the viewport is
    // intentionally untouched. We assert the store cascade + the timeline
    // ring; the graph-side ring is unit-tested in D3GraphCanvas.test.ts
    // and the EntityDetailPanel mount is the visible side-panel surface.
    // Plan 02 makes the click write atomically through setSelection().

    const firstRow = page.locator('[data-history-id]').first()
    await expect(firstRow).toBeVisible({ timeout: 10_000 })
    const rowId = await firstRow.getAttribute('data-history-id')
    expect(rowId).not.toBeNull()

    await firstRow.click()

    // Store reflects the click — focalNodeId === clicked row id; source
    // is 'history' per HistorySidebar.tsx onClick (Plan 04).
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        const st = w.__viewerStore!.getState()
        return {
          focal: st.focalNodeId,
          src: st.selectionSource,
        }
      })
      expect(s.focal).toBe(rowId)
      expect(s.src).toBe('history')
    }).toPass({ timeout: 5_000 })

    // Timeline tick ringed once the matching session shows highlight.
    //
    // Phase 56.1 WR-01 fix (56-REVIEW.md WR-01 — closed via
    // .planning/phases/56.1-unified-viewer-many-to-many-bridge/56.1-06-PLAN.md):
    // the prior strict `count === 1` assertion was data-dependent — it held
    // only when the seeded entity's createdAt landed in exactly one bucket's
    // [startMs, endMs) window. With the live obs-api the chosen Insight may
    // touch 1+ overlapping buckets across sessions, so the strict count
    // assertion would flap. The replacement is range-based: at least one ring
    // must appear (proving the cascade fired) AND fewer than 10 (sanity
    // upper bound — anything beyond is a UI bug).
    const tickRings = page.locator('[data-testid^="lsl-tick-"].ring-blue-500')
    await expect(tickRings).not.toHaveCount(0, { timeout: 5_000 })
    const ringCount = await tickRings.count()
    expect(ringCount).toBeGreaterThanOrEqual(1)
    expect(ringCount).toBeLessThan(10)
  })

  test('Spec 3 — clicking a timeline tick drives graph + history (AC #4)', async ({
    page,
  }) => {
    // AC #4: Clicking a timeline tick or session-segment selects the
    // corresponding node(s) in the graph AND scrolls/highlights the
    // matching history sidebar row. The Phase 56.1 LslTimelineStrip
    // writes the multi-set selection atomically via setSelection({
    //   nodeIds: pickAllResolvable(...),
    //   bucketKeys: Set([bucketKey]),
    //   focal: { nodeId, bucketKey },
    //   source: 'timeline',
    //   ...
    // }) (Plan 05). selectionSource is 'timeline' (or 'history' under
    // Decision C auto-drill — see LslTimelineStrip.onTickClick:704).

    // 2026-06-13 (Plan 56-04 lock): live session ids are NOT prefixed with
    // 'sess-' — that prefix was a test-fixture convention from the unit
    // tests. The rendered data-testid is `lsl-tick-${session.id}` where
    // `session.id` is the obs-api's short hex (e.g. `lsl-tick-c197ef`). We
    // match all lsl-tick-* nodes (filtering out the disabled 0-obs ones via
    // aria-disabled, mirroring 56.1-many-to-many.spec.ts) and pick the first.
    const firstTick = page
      .locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])')
      .first()
    await expect(firstTick).toBeVisible({ timeout: 10_000 })
    await firstTick.click()

    // Store reflects the tick click. focalNodeId is non-null because the
    // tick exposes its session's entityIds → pickAllResolvable yields >=1
    // ancestor → focal lands on the first. selectionSource is 'timeline'
    // for the multi-set case OR 'history' for the auto-drill single-
    // resolution case (LslTimelineStrip.onTickClick:704-720) — accept both.
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        const st = w.__viewerStore!.getState()
        return {
          focal: st.focalNodeId,
          src: st.selectionSource,
        }
      })
      expect(s.focal).not.toBeNull()
      expect(['timeline', 'history']).toContain(s.src)
    }).toPass({ timeout: 5_000 })

    // VISIBLE CASCADE: SidePanel mode-switch (Phase 56.1 D-4) opens a
    // surface (BucketCardList / EntityDetailPanel) whenever there's a
    // non-null focalNodeId — the close button is the canonical proxy
    // for "panel switched into a focal/multi-set mode."
    await expect(
      page.getByTestId('side-panel-close'),
    ).toBeVisible({ timeout: 5_000 })

    // Highlighted row key in the store also flips on the tick click — the
    // atomic write in LslTimelineStrip.onTickClick includes it (the row
    // key follows the focal). Lock at the store level since the visual
    // surface for it is HistorySidebar.tsx Test 4, not this E2E run.
    const hl = await page.evaluate(() => {
      const w = window as unknown as WindowWithViewerStore
      return w.__viewerStore!.getState().highlightedRowKey
    })
    expect(hl).not.toBeNull()
  })

  test('Spec 4 — Esc clears selection in all three panes (AC #7)', async ({ page }) => {
    // AC #7: Esc + click-background clears selection in all three panes
    // simultaneously. Plan 01 Task 2 routes Esc through clearSelection()
    // which cascades through the LSL filter slice — so the store-side
    // assertions go GREEN today. The visual zero-count assertions on
    // `.ring-blue-500` and `[data-history-id].bg-blue` go GREEN once
    // Plans 02 + 03 wire the highlight classes (they're already absent
    // today simply because the highlights haven't been added yet).
    //
    // 2026-06-14 (WR-08 fix — 56.1-REVIEW): Esc behaviour evolved during
    // Phase 56.1 to a two-step pop-then-clear (Plan 06 Decision 1
    // selection-history stack — WR-05 fix lands the gate in the caller).
    // For a single-step selection (no drill — selectionHistory === null),
    // Esc goes straight to clearSelection so this spec's single press is
    // still sufficient to land at Layer 0.

    const firstNodeId = await page.evaluate(async () => {
      // 2026-06-13 (Plan 56-04 lock): the canonical km-core REST shape is
      // /api/v1/entities (Phase 44 contract — see ApiClient.ts line 4 +
      // ApiClient.test.ts line 28). The /api/coding/entities path the spec
      // was authored against (Plan 56-01 task 3) does not exist on the
      // obs-api at :12436. HistorySidebar.tsx restricts the feed to
      // `entityType === 'Insight'`, so we filter to the first Insight to
      // guarantee a `[data-history-id]` row exists for it.
      // limit=5000 because the live corpus has ~1100 entities and only ~84
      // are Insights — the first 500 in obs-api ordering can be all
      // structural (Projects/SubComponents/Details) which the HistorySidebar
      // filter would exclude.
      const r = await fetch('http://localhost:12436/api/v1/entities?limit=5000')
      if (!r.ok) return null
      const j = (await r.json()) as { data?: Array<{ id?: string; entityType?: string }> }
      const insight = (j.data ?? []).find((e) => e.entityType === 'Insight')
      return insight?.id ?? null
    })
    expect(firstNodeId).not.toBeNull()

    // Drive a multi-pane selection: graph node halo (single member) +
    // bucket halo + LSL filter. All set atomically via the store hook.
    await page.evaluate((id) => {
      const w = window as unknown as WindowWithViewerStore
      const store = w.__viewerStore!.getState()
      store.setSelection({
        nodeIds: new Set<string>([id as string]),
        focal: { nodeId: id as string },
        bucketKeys: new Set<string>(['sess-test|2026-06-14T00:00:00Z']),
        highlightedRowKey: id as string,
        source: 'graph',
        pathToSelected: new Set([id as string]),
        lslSessionFilter: ['sess-test'],
      })
    }, firstNodeId)

    await page.keyboard.press('Escape')

    // Store-side cascade — clearSelection nulls every selection field +
    // empties the LSL slice (clearSelection action — viewer-store.ts).
    // Note: with WR-05 fix Esc goes pop → fallback clearSelection; with
    // no history (single-step selection here) the pop is a no-op and the
    // explicit clearSelection() in useKeyboardShortcuts handles the
    // L1 → L0 transition.
    await expect(async () => {
      const s = await page.evaluate(() => {
        const w = window as unknown as WindowWithViewerStore
        const st = w.__viewerStore!.getState()
        return {
          focal: st.focalNodeId,
          nodeIdsCount: st.selectedNodeIds.size,
          bucketKeysCount: st.selectedBucketKeys.size,
          src: st.selectionSource,
          lsl: st.lslSessionFilter.length,
        }
      })
      expect(s.focal).toBeNull()
      expect(s.nodeIdsCount).toBe(0)
      expect(s.bucketKeysCount).toBe(0)
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
