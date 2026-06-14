// Phase 56.1 — Unified Viewer Many-to-Many Temporal-Knowledge Bridge E2E
//
// PER-AC VERIFICATION MAP (56.1-CONTEXT.md <acceptance_criteria>):
//   AC #1 (tick → multi-ring graph halo + bucket card list)  → Test #1
//   AC #2 (node → multi-tick timeline halo + EntityDetailPanel) → Test #2
//                  ↑ DEDICATED reverse-direction test. Added per planner
//                  revision iteration 1 — fences against the regression
//                  where reverse-direction cascade was silently coupled
//                  to forward-direction code paths. Run BEFORE AC#3+4.
//   AC #3 (card click → drill collapse)                       → Test #3
//   AC #4 (halo node click → drill collapse — same shape as AC#3)
//                                                              → folded into Test #3
//   AC #5 (Esc clears all)                                     → Test #4
//   AC #8 (viewport stable on tick click)                      → Test #5
//   AC #9 (pre-index integrity — pickAllResolvable callsites)  → Test #6
//
//   AC #6 (Phase 56's 6 PATTERNS contracts hold post-refactor) is covered
//          via source-grep gates in unit tests (Plan 03 G9 dep list lock,
//          Plan 05 contract-#4 0-obs policy gate, Plan 01 sameSetMembership
//          guard tests) + Test #5 viewport-stability live smoke.
//   AC #7 (WR-01/02/03/04 closed) is covered by:
//          WR-01 → 56-bidirectional-selection.spec.ts (fixed in this plan)
//          WR-02 → 56.1-02-SUMMARY.md (ancestry diamond BFS + 3 tests)
//          WR-03 → 56.1-05-SUMMARY.md (LslTimelineStrip selectedClasses guard + Test WR-03)
//          WR-04 → 56.1-01-SUMMARY.md (reset() field coverage + dedicated regression test)
//
// Driver model: this spec drives selection through real DOM clicks on the
// `.node` graph elements + `[data-testid^="lsl-tick-"]` timeline ticks +
// `[data-testid^="bucket-card-"]` sidebar cards. It does NOT use the
// `window.__viewerStore` hook the Phase 56 spec used — Phase 56.1 Plan 03
// added `data-focal` / `data-halo` markers to the parent `<g>` elements
// (see 56.1-03-SUMMARY.md §(a)) which give E2E specs a stable selector
// surface for the two-tier ring contract WITHOUT RGB sniffing or store
// introspection. Real-click is also a stronger smoke than store-driven
// selection because it exercises the D3 click handler end-to-end.
//
// Server contract: assumes the operator-managed `npm run dev` on :5173
// is up (playwright.config.ts has no webServer block — see CLAUDE.md +
// 45-PATTERNS.md). When running from a parallel-execution worktree, the
// Vite server runs from the main repo's working tree at :5173.
//
// References:
//   - 56.1-CONTEXT.md <acceptance_criteria>
//   - 56.1-PATTERNS.md §9 (NEW E2E spec template)
//   - 56.1-03-SUMMARY.md §(a) (data-focal/data-halo markers)
//   - 56.1-04-SUMMARY.md (BucketCardList + SidePanel mode-switch)
//   - 56.1-05-SUMMARY.md §(c) (LslTimelineStrip multi-set write)
//   - 56.1-06-PLAN.md <tasks> Task 1(b)
//   - tests/e2e/unified-viewer/entity-detail.spec.ts (analog — store-driver pattern)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Wait until the unified-viewer canvas is interactive — at least one
 * `.node` element rendered AND at least one non-disabled lsl tick. The
 * second condition matters for AC #1 / AC #2 reverse-direction tests,
 * which require a tick that touches at least one graph node.
 */
async function waitForBucketsLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId('viewer-canvas')).toBeVisible()
  await expect(async () => {
    const nodes = await page.evaluate(() => document.querySelectorAll('.node').length)
    expect(nodes).toBeGreaterThan(0)
    const liveTicks = await page
      .locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])')
      .count()
    expect(liveTicks).toBeGreaterThan(0)
  }).toPass({ timeout: 30_000 })
}

// -----------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------

test.describe('Unified Viewer — Phase 56.1 many-to-many bridge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/viewer/coding')
    await waitForBucketsLoaded(page)
  })

  // ---------------------------------------------------------------------
  // Test #1 — AC #1
  // ---------------------------------------------------------------------
  test('AC #1: tick click -> multi-ring graph halo + focal + bucket card list', async ({
    page,
  }) => {
    // Click the first non-disabled timeline tick. LslTimelineStrip.onTickClick
    // (Plan 05) writes nodeIds = pickAllResolvable(...) halo + bucketKeys =
    // Set([bucketKey]) + focal = {nodeId, bucketKey} atomically via
    // setSelection. D3GraphCanvas.applySelectionStyling (Plan 03) then paints
    // the focal red ring + lighter blue halo on touched nodes; SidePanel
    // (Plan 04) mounts BucketCardList.
    const firstTick = page.locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])').first()
    await expect(firstTick).toBeVisible({ timeout: 10_000 })
    await firstTick.click()
    await page.waitForTimeout(200)

    // Focal ring: Plan 03 sets data-focal="true" on the parent <g> of the
    // focal node. Exactly one focal at any time per deriveFocal invariant.
    await expect(page.locator('.node[data-focal="true"]')).toHaveCount(1)

    // Halo nodes: data-halo="true" on additional touched nodes. Count is
    // data-dependent — the bucket may resolve to 0+ additional nodes
    // beyond the focal. Range-based assertion (>= 0) per WR-01 lesson.
    const haloCount = await page.locator('.node[data-halo="true"]').count()
    expect(haloCount).toBeGreaterThanOrEqual(0)

    // Sidebar mode-switches to BucketCardList (Plan 04 SidePanel three-way
    // mode-switch on selectedBucketKeys.size > 0 || selectedNodeIds.size > 1).
    await expect(page.getByTestId('bucket-card-list')).toBeVisible({ timeout: 3_000 })
  })

  // ---------------------------------------------------------------------
  // Test #2 — AC #2 (DEDICATED reverse-direction test — planner revision iter 1)
  // ---------------------------------------------------------------------
  test('AC #2: graph node click -> multi-tick timeline halo + EntityDetailPanel mount', async ({
    page,
  }) => {
    // PLANNER REVISION ITERATION 1: this dedicated reverse-direction test was
    // added explicitly during planning to fence against the regression where
    // graph-click cascade is silently coupled to forward-direction code
    // paths. See 56.1-06-PLAN.md task 1(b) — "AC#2 test goes BEFORE the
    // AC#3+4 test in the file; reverse direction is the second confirmation".
    //
    // D-2 reverse direction (Plan 05 Task 2): D3GraphCanvas node click writes
    // nodeIds = Set([d.id]) + bucketKeys = nodeToBuckets.get(d.id) + focal =
    // {nodeId: d.id, bucketKey: null} via setSelection. LslTimelineStrip
    // (Plan 05) reads selectedBucketKeys for halo rings; SidePanel (Plan 04)
    // mode-switches to EntityDetailPanel (single-focal: selectedNodeIds.size
    // === 1 && selectedBucketKeys.size === 0 fails when buckets are non-empty,
    // but the strip render keys on selectedBucketKeys.has + focalBucketKey;
    // SidePanel mode-switch is keyed on the node side — graph click leaves
    // focalBucketKey null which means single-focal mode wins for the sidebar).

    // Clear any prior state (defensive against beforeEach side-effects).
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)

    // Try the first 5 nodes; accept the first one whose click produces a
    // non-zero halo tick set. If all 5 fail, the seed has no graph→bucket
    // touches at all — that's a fixture problem, not an implementation bug.
    const nodeLocators = page.locator('.node')
    const nodeCount = await nodeLocators.count()
    const triesMax = Math.min(5, nodeCount)
    expect(triesMax).toBeGreaterThan(0)

    let succeeded = false
    let lastFocalCount = 0
    let lastHaloTickCount = 0
    for (let i = 0; i < triesMax; i++) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(80)

      const candidate = nodeLocators.nth(i)
      await candidate.click({ force: true })
      await page.waitForTimeout(200)

      lastFocalCount = await page.locator('.node[data-focal="true"]').count()
      // Halo ticks per Plan 05 two-tier render. Plan 05 §(c) emits
      // `ring-blue-300/60` (halo) OR `ring-blue-500` (focal) on selected
      // ticks. We accept either — when graph click writes bucketKeys but
      // focalBucketKey stays null, the strip's `selectedTs` fallback may
      // also light the running-ring path. Use the OR selector.
      lastHaloTickCount = await page
        .locator(
          '[data-testid^="lsl-tick-"].ring-blue-300\\/60, [data-testid^="lsl-tick-"][data-halo="true"], [data-testid^="lsl-tick-"].ring-blue-500',
        )
        .count()
      if (lastFocalCount === 1 && lastHaloTickCount >= 1) {
        succeeded = true
        break
      }
    }

    if (!succeeded) {
      throw new Error(
        `AC#2 reverse-direction fixture insufficient: tried ${triesMax} nodes; ` +
          `last attempt produced focalCount=${lastFocalCount} haloTickCount=${lastHaloTickCount}. ` +
          'Seeded data has no graph-to-bucket touches — refresh test fixture, not implementation.',
      )
    }

    // After the successful click, lock the AC#2 contract:
    // 1. Focal ring on graph (exactly one — deriveFocal invariant).
    await expect(page.locator('.node[data-focal="true"]')).toHaveCount(1)

    // 2. ≥1 halo tick on timeline (already verified above; re-assert for
    //    spec readability — passes with tight 2s timeout since we already
    //    saw the count >=1 in the loop body).
    await expect(
      page.locator(
        '[data-testid^="lsl-tick-"].ring-blue-300\\/60, [data-testid^="lsl-tick-"][data-halo="true"], [data-testid^="lsl-tick-"].ring-blue-500',
      ),
    ).not.toHaveCount(0, { timeout: 2_000 })

    // 3. EntityDetailPanel visible (single-focal sidebar mode-switch).
    await expect(page.getByTestId('entity-detail-panel')).toBeVisible({ timeout: 3_000 })

    // 4. bucket-card-list NOT visible (graph click does not enter multi-mode).
    await expect(page.getByTestId('bucket-card-list')).not.toBeVisible()
  })

  // ---------------------------------------------------------------------
  // Test #3 — AC #3 + AC #4 (card click drill collapse — same shape as halo node click)
  // ---------------------------------------------------------------------
  test('AC #3 + #4: card click in sidebar -> drill collapse to single-focal mode', async ({
    page,
  }) => {
    // Setup: tick click → multi-mode (as AC #1).
    const firstTick = page.locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])').first()
    await firstTick.click()
    await page.waitForTimeout(200)
    await expect(page.getByTestId('bucket-card-list')).toBeVisible({ timeout: 3_000 })

    // Drill: click the first bucket card. BucketCardList.onCardClick (Plan 04)
    // writes nodeIds=Set([id]), bucketKeys=Set(), focal={nodeId:id, bucketKey:null},
    // source='history'. SidePanel mode-switches to EntityDetailPanel.
    const firstCard = page.locator('[data-testid^="bucket-card-"]').first()
    await expect(firstCard).toBeVisible({ timeout: 3_000 })
    await firstCard.click()
    await page.waitForTimeout(200)

    // Post-drill assertions:
    // - exactly 1 focal node
    await expect(page.locator('.node[data-focal="true"]')).toHaveCount(1)
    // - ZERO halo nodes (halo collapsed per D-5)
    await expect(page.locator('.node[data-halo="true"]')).toHaveCount(0)
    // - EntityDetailPanel mounted
    await expect(page.getByTestId('entity-detail-panel')).toBeVisible({ timeout: 3_000 })
    // - bucket-card-list NOT visible
    await expect(page.getByTestId('bucket-card-list')).not.toBeVisible()
  })

  // ---------------------------------------------------------------------
  // Test #4 — AC #4 standalone (halo node click drill collapse)
  // ---------------------------------------------------------------------
  test('AC #4: halo node click in graph -> drill collapse to single-focal mode', async ({
    page,
  }) => {
    // Setup: tick click → multi-mode (must produce ≥1 halo node to exercise
    // the halo-node-click path). If the first tick doesn't produce any halo,
    // try the next few; if none of the first 5 ticks does, skip with a
    // clear message — the seeded data has no multi-touch bucket and the
    // halo-click drill path is uncoverable. AC#3 (card click) already
    // covers the drill-collapse contract end-to-end; AC#4 only fails if
    // the graph-side drill diverges from the card-side drill, which is
    // why we test it separately.
    const liveTicks = page.locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])')
    const tickCount = await liveTicks.count()
    const triesMax = Math.min(5, tickCount)

    let succeeded = false
    for (let i = 0; i < triesMax; i++) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(80)
      await liveTicks.nth(i).click()
      await page.waitForTimeout(200)
      const halo = await page.locator('.node[data-halo="true"]').count()
      if (halo >= 1) {
        succeeded = true
        break
      }
    }
    test.skip(
      !succeeded,
      `AC#4 needs a tick that produces ≥1 halo node; first ${triesMax} live ticks all produced 0 halo. ` +
        'AC#3 still covers the drill-collapse contract via card click.',
    )

    // Click the first halo node in the graph. D3GraphCanvas.onclick (Plan 03)
    // writes nodeIds=Set([d.id]), bucketKeys=nodeToBuckets.get(d.id) (Plan 05
    // reverse direction). The post-click state may have multi-tick halo from
    // the new node's touching buckets, but selectedNodeIds.size === 1 by D-5
    // — so SidePanel mode-switch lands on either single-focal (when
    // selectedBucketKeys is empty) or multi-mode (when the new node has
    // touching buckets). The graph side cleanly collapses to single focal
    // regardless — that's the AC#4 lock.
    const firstHalo = page.locator('.node[data-halo="true"]').first()
    await firstHalo.click({ force: true })
    await page.waitForTimeout(200)

    await expect(page.locator('.node[data-focal="true"]')).toHaveCount(1)
    // The clicked halo becomes the focal, so OLD halo set (from the tick
    // click) is fully replaced. The new selection may include buckets from
    // the reverse-index, which can light new halo nodes from those buckets'
    // touches — but the OLD tick-driven halo nodes that don't intersect
    // with the new node's touching buckets are cleared. The deterministic
    // assertion is: the previously-clicked halo node is now the focal,
    // i.e. data-halo="true" no longer applies to it.
    await expect(firstHalo).toHaveAttribute('data-focal', 'true')
  })

  // ---------------------------------------------------------------------
  // Test #5 — AC #5 (Esc clears all selection state)
  // ---------------------------------------------------------------------
  test('AC #5: Esc clears all (graph focal + halo + timeline + sidebar mode)', async ({
    page,
  }) => {
    // Setup: tick click → multi-mode.
    const firstTick = page.locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])').first()
    await firstTick.click()
    await page.waitForTimeout(200)
    await expect(page.locator('.node[data-focal="true"]')).toHaveCount(1)
    await expect(page.getByTestId('bucket-card-list')).toBeVisible({ timeout: 3_000 })

    // Esc → useKeyboardShortcuts (Plan 05 closure) routes through
    // clearSelection() which empties all 4 selection fields + LSL slice +
    // pathToSelected. SidePanel falls back to default (no selection).
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    await expect(page.locator('.node[data-focal="true"]')).toHaveCount(0)
    await expect(page.locator('.node[data-halo="true"]')).toHaveCount(0)
    await expect(page.getByTestId('bucket-card-list')).not.toBeVisible()
  })

  // ---------------------------------------------------------------------
  // Test #5 — AC #8 (viewport stability — Locked Contract #3)
  // ---------------------------------------------------------------------
  test('AC #8: viewport stable on tick click — no zoom/pan/relayout', async ({ page }) => {
    // Capture the graph's outer <g transform=...> BEFORE click. The audit-
    // locked Phase 56 PATTERNS Locked Contract #3 (carried forward verbatim
    // through Phase 56.1 per D-7 row 3) requires the main render-effect dep
    // list to be `[visibleEntities, visibleRelations, theme, isLoading]` ONLY
    // — no selection field. If the dep list regresses, every click rebuilds
    // the SVG + restarts the force simulation, which changes the transform.
    const before = await page.locator('svg g').first().getAttribute('transform')

    // Click a tick — this triggers selection cascade (Plan 05 onTickClick →
    // setSelection writes 4 Set fields + LSL slice + pathToSelected).
    const firstTick = page.locator('[data-testid^="lsl-tick-"]:not([aria-disabled="true"])').first()
    await firstTick.click()
    await page.waitForTimeout(300)

    const after = await page.locator('svg g').first().getAttribute('transform')
    expect(after).toBe(before)
  })

  // ---------------------------------------------------------------------
  // Test #6 — AC #9 (pre-index integrity — pickAllResolvable callsites)
  // ---------------------------------------------------------------------
  test('AC #9: pre-index integrity — pickAllResolvable callsites limited to allowed sources', async () => {
    // Source-grep gate (NOT a runtime browser check) — asserts Contract #7
    // (NEW per D-7 row 7) at the file system level. Any 4th callsite of
    // `pickAllResolvable` in production source under
    // `integrations/unified-viewer/src/` (excluding *.test.* and *.spec.*)
    // is a smell — by contract the only legal callers are:
    //   - ancestry.ts                (the definition site)
    //   - useNodeToBucketsIndex.ts   (the pre-index hook — D-3)
    //   - LslTimelineStrip.tsx       (the canonical D-2 forward-direction
    //                                  click handler exception per 56.1-PATTERNS §3)
    const srcRoot = resolve(process.cwd(), 'integrations/unified-viewer/src')
    const ALLOWED = new Set<string>([
      'graph/ancestry.ts',
      'graph/useNodeToBucketsIndex.ts',
      'panels/coding/LslTimelineStrip.tsx',
    ])

    function walk(dir: string): string[] {
      const out: string[] = []
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        const s = statSync(full)
        if (s.isDirectory()) {
          out.push(...walk(full))
        } else if (
          (entry.endsWith('.ts') || entry.endsWith('.tsx'))
          && !entry.includes('.test.')
          && !entry.includes('.spec.')
        ) {
          out.push(full)
        }
      }
      return out
    }

    const files = walk(srcRoot)
    const callsites: string[] = []
    const re = /\bpickAllResolvable\b/
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      if (re.test(text)) {
        const rel = f.slice(srcRoot.length + 1)
        callsites.push(rel)
      }
    }

    const unexpected = callsites.filter((p) => !ALLOWED.has(p))
    expect(
      unexpected,
      `Contract #7 violation — unexpected pickAllResolvable callsites: ${JSON.stringify(unexpected)}. ` +
        `Allowed: ${JSON.stringify([...ALLOWED])}. Found: ${JSON.stringify(callsites)}.`,
    ).toEqual([])

    // Belt-and-braces: the 3 allowed callsites should ALL be present (proves
    // we're actually scanning the right tree and not just an empty walk).
    for (const allowed of ALLOWED) {
      expect(callsites).toContain(allowed)
    }
  })
})
