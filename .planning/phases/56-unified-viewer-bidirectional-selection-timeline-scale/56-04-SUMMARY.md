---
phase: 56-unified-viewer-bidirectional-selection-timeline-scale
plan: 04
subsystem: unified-viewer
tags: [bidirectional-selection, regression-fix, gap-closure, click-handler-tests, ancestry-extraction, deselect-effect, lsl-timeline]
dependency_graph:
  requires:
    - "Plan 56-01 selection-sync foundation (viewer-store slice + window.__viewerStore E2E hook + RED Playwright spec)"
    - "Plan 56-02 history-sidebar atomic write + highlight contract"
    - "Plan 56-03 timestamp scale row + onTickClick 7-field atomic write"
    - "Plan 56-04 Task 1 (committed 989c04558) D3GraphCanvas atomic node click + bg→clearSelection + history-driven centering effect"
    - "Plan 56-04 Task 2 (committed 371ad889e) Playwright suite 4/4 GREEN"
  provides:
    - "computeAncestryPath() + HIERARCHY_TYPES extracted from D3GraphCanvas.tsx into shared module src/graph/ancestry.ts — reused by LslTimelineStrip for tick-click central-trace"
    - "LslTimelineStrip deselect-effect gated on real selected→deselected TRANSITION (prevSelectedTsRef) — fixes Issue 1 (window buttons no longer snap back) AND pre-existing Test 7 baseline failure (Cmd/Ctrl+click pre-existing filter wipe)"
    - "LslTimelineStrip tick-ring keyed on (isSelectedBucket || selectedSessionId === s.id) — fixes Issue 2 (empty-entityIds session ticks now ring on their own click)"
    - "LslTimelineStrip onTickClick computes real ancestry path via computeAncestryPath(firstEntityId, relations) — fixes Issue 3 (central-trace renders for tick-resolved focal entities)"
    - "4 click-handler-driven vitest regression locks (Tests 21-24) — the next regression on the same code path surfaces in CI"
  affects:
    - "D3GraphCanvas.tsx — pure code-move (computeAncestryPath now imported instead of inline); 0 behaviour change, all 11 source-grep gates intact, main useEffect dep list still omits selectedNodeId"
    - "useGraphData consumers — LslTimelineStrip now also destructures `relations` from the hook (same hook call, no additional fetch)"
tech-stack:
  added: []
  patterns:
    - "Shared-helper extraction (D3GraphCanvas inline → src/graph/ancestry.ts module) to eliminate drift risk between two consumers of the same ancestry walk"
    - "Transition-tracking via useRef (prevSelectedTsRef) to distinguish 'selected → deselected' from 'mounted in deselected state' inside a single useEffect"
    - "fireEvent.click on rendered buttons (NOT useViewerStore.setState) for handler-driving regression tests — closes the gap the operator surfaced in checkpoint:human-verify"
    - "Tick-ring OR predicate (isSelectedBucket || selectedSessionId === s.id) — keys visual feedback on TWO independent store signals so the cascade fires even when one signal can't resolve"
key-files:
  created:
    - "integrations/unified-viewer/src/graph/ancestry.ts"
    - ".planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-04-SUMMARY.md"
  modified:
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx"
    - "integrations/unified-viewer/src/graph/D3GraphCanvas.tsx"
decisions:
  - "Extract computeAncestryPath to a shared module (src/graph/ancestry.ts) instead of duplicating into LslTimelineStrip — Plan 04 has two consumers needing identical ancestry walks; inline-and-duplicate would drift the moment HIERARCHY_TYPES gains a new edge type. Bit-identical code-move preserves all 11 D3GraphCanvas source-grep gates."
  - "Gate the deselect-effect on prevSelectedTsRef !== null (real selected→deselected TRANSITION) rather than guarding only the window restore on preSlideWindowRef.current. The latter would leave the LSL-filter-clear cascade firing on mount, which is Test 7's pre-existing failure mode. The transition-tracking ref handles both side-effects together."
  - "Re-key tick ring on (isSelectedBucket || selectedSessionId === s.id) — NOT on `selectedNodeId in entities[]` per the resume_instructions sketch. Reason: when entities[] is non-empty AND selectedNodeId IS in entities[], `isSelectedBucket` already fires (via selectedTs → range match). The OR predicate adds the empty-entities AND non-resolving-entity cases without breaking the existing cascade. The 'selectedNodeId in entities[]' predicate would have double-counted the existing path."
  - "Compute pathToSelected in onTickClick for BOTH plain and Cmd/Ctrl branches — modifier-key additive selection still needs the central-trace; without it, only plain clicks would get it and the user's modifier-key UX would silently lose a feature. Mirrors how 56-03 extended both branches with the 3 new Phase 56 fields."
metrics:
  duration_min: 18
  completed_date: 2026-06-13
  tasks_completed: 3
  files_created: 2
  files_modified: 3
  commits: 2
---

# Phase 56 Plan 04 — Wave 3 Gap-Closure Summary

**One-liner:** Diagnosed and fixed three LslTimelineStrip regressions surfaced by the operator's visual-smoke checkpoint that the existing Phase 56 test suite missed — window buttons snapping back to LATEST_WINDOW, tick clicks failing end-to-end, and tick-resolved selections leaving an empty pathToSelected — by gating the deselect-effect on a real selected→deselected transition, re-keying the tick ring on a session-id OR-predicate, and extracting `computeAncestryPath` into a shared module so the strip's `onTickClick` writes the real ancestry path the same way D3GraphCanvas's node click does. Added 4 click-handler-driven vitest cases (Tests 21-24) so the next regression on the same code paths surfaces in CI.

## Performance

- **Duration:** ~18 min (continuation from 602cf438c base)
- **Started:** 2026-06-13T11:14:32Z (after worktree base-reset)
- **Completed:** 2026-06-13T11:32:00Z
- **Tasks completed during this continuation:** 3 (RED tests + GREEN fixes + Playwright re-verification)
- **Files created:** 2 (src/graph/ancestry.ts + this SUMMARY.md)
- **Files modified:** 3 (LslTimelineStrip.tsx + LslTimelineStrip.test.tsx + D3GraphCanvas.tsx)
- **Commits added (continuation):** 2 (ec2bb0a92 test + 5baa4b965 fix)

## Outcome — Regressions Caught + Meta-Lesson

The Plan 04 Task 3 checkpoint:human-verify visual smoke surfaced three real regressions the automated gates missed. Root-cause of the gap: **every Phase 56 test before this plan called `useViewerStore.setState({...})` directly, bypassing the strip's onTickClick handler and the ToggleGroup's onClick → setWindowKey flow.** The store-level assertions all passed because the writes were forced; the user's real click path never exercised.

The 4 new vitest cases drive `fireEvent.click(rendered button)` instead, exercising the same DOM event path the user does. The Playwright Spec 3 also drives a real tick click (`firstTick.click()`) — but its assertions only check store-side cascade (`selectionSource === 'timeline'`, `highlightedRowKey !== null`), not the visual ring, not the path-to-central, and not the window-button persistence — which is why it passed even with the regressions present.

### Issue 1 — Window-toggle buttons (24h/7d/30d/all) snap back to LATEST_WINDOW

**Symptom (operator-reported):** clicking 24h appears to do nothing; the scale labels never change.

**Root cause:** the "deselect-effect" at `LslTimelineStrip.tsx` lines ~209-259 unconditionally fired on every render where `selectedTs === null`. Its dep list includes `windowKey`, so the chain was:

```
user clicks 24h
→ onWindowChange('24h') → setWindowKey('24h')
→ effect re-runs (windowKey changed)
→ selectedTs === null branch fires (no selection)
→ restoreTo = preSlideWindowRef.current ?? LATEST_WINDOW = '7d'
→ restoreTo !== windowKey ('7d' !== '24h') → setWindowKey('7d')
→ effect re-runs (windowKey changed AGAIN)
→ now windowKey === '7d', restoreTo === '7d', no-op
```

The user's choice is silently overwritten between two renders.

**Fix:** track the previous `selectedTs` value via a new ref `prevSelectedTsRef`. The deselect cascade now only fires when `prevSelectedTsRef.current !== null` (we WERE selected) AND `selectedTs === null` (we ARE now deselected). On initial mount and pure window-button clicks with no selection involved, the ref stays null and the cascade is skipped.

**Side benefit:** the same fix turns pre-existing Test 7 baseline failure GREEN (Cmd/Ctrl+click pre-existing filter wipe — documented in `56-03-SUMMARY.md`'s `deferred-items.md`). Test 7 was failing for the same root cause: the deselect-effect cleared `lslSessionFilter: ['sess-aaaaaaaa']` set by `beforeEach` on initial mount, before the user's click had a chance to add to it.

**Regression lock:** Test 21 — `fireEvent.click(btn24h)` and assert the 24h ToggleGroupItem keeps `data-state='on'` (and 7d does not). If the deselect-effect ever re-fires on a window-button click with no selection, this fails.

**Bonus lock:** Test 22 — assert `lslSessionFilter` stays at `['sess-aaaaaaaa']` after mount, verifying no spurious clear.

### Issue 2 — Most tick clicks fail end-to-end (no ring, no cascade)

**Symptom (operator-reported):** clicking most timeline ticks produces no visible feedback — no ring on the tick, no graph node selection, no history sidebar scroll.

**Root cause:** the tick ring keyed exclusively on `isSelectedBucket`, which is derived from `selectedTs` (the `selectedNodeId`'s `createdAt` resolved via `useGraphData(...).entities.find(...)`). For a tick whose session has empty `entityIds[]`, `firstEntityId === null`, so `selectedNodeId` is set to `null` and the ring never fires. For a tick whose `entities[0]` ID is NOT in the live graph data (e.g., filtered out or never loaded), `entities.find` returns undefined and `selectedTs` stays null.

**Fix:** subscribe to `selectedSessionId` and re-key the ring on `(isSelectedBucket || selectedSessionId === s.id)`. The tick now rings on its own click directly, independent of the entity cascade. The running-tick `ring-primary` predicate is also extended to gate on `selectedSessionId === null` so the live ring doesn't compete with a session selection.

**Why not 'selectedNodeId in entities[]' per the resume sketch:** when `entities[]` is non-empty AND `selectedNodeId` IS in `entities[]`, `isSelectedBucket` already fires via the `selectedTs → range match` path. Adding the `entities[]` predicate would have double-counted the existing path. The OR with `selectedSessionId` cleanly handles the empty-entities AND non-resolving-entity cases without changing the existing cascade.

**Regression lock:** Test 23 — render a session with `entityIds: []`, fire the tick click, assert the tick gets `ring-blue-500` class. Bonus: also assert `selectedSessionId === 'sess-empty'` and `selectionSource === 'timeline'`.

### Issue 3 — Tick click writes empty pathToSelected (no central-trace)

**Symptom (operator-reported, partial-success branch of AC #2):** when a tick click DOES resolve to a focal entity, the central-trace never renders.

**Root cause:** `onTickClick` wrote `pathToSelected: new Set()` (hardcoded empty). The graph's `applySelectionStyling` derives the path-trace from `pathToSelected` — empty means no nodes get the trace highlight.

**Fix:** compute `pathToSelected` via the same `computeAncestryPath(firstEntityId, relations)` call D3GraphCanvas uses on node click (line 564 in that file). The helper has been extracted from D3GraphCanvas.tsx into a new shared module `src/graph/ancestry.ts` so both call sites use bit-identical logic and `HIERARCHY_TYPES` never drifts. `useGraphData()` now pulls `relations` alongside `entities` (same hook, no new fetch — TanStack Query caches once across the app).

Both plain-click and Cmd/Ctrl-click branches of `onTickClick` write the real ancestry path; when `firstEntityId` is null (session has no entityIds) the path is an empty Set (consistent with D3GraphCanvas's behaviour on an isolated node).

**Regression lock:** Test 24 — seed `mockEntities` with `e3` plus two ancestors and `__mockRelations` with a 2-hop `contains` chain (root → parent-1 → e3). Fire the tick click for `sess-bbbbbbbb` (whose entityIds is `['e3']`). Assert `selectedNodeId === 'e3'` AND `pathToSelected.size > 0` AND `pathToSelected.has('e3')`.

### Meta-Lesson (the GAP)

**All earlier Phase 56 tests used `useViewerStore.setState({...})` to seed the strip's state directly.** Test 19's "selection→tick highlight" worked because it set `selectedNodeId: 'e3'` and asserted on `ring-blue-500` — but it never exercised the WRITE path (`onTickClick`). Test 18's "atomic write" fired a click but only checked store-side fields — not the visual ring, not the path-to-central, not what happens after a button-click triggers a re-render with no selection.

The earlier mock setup also returned `relations: []` unconditionally, so even if Test 18 had asserted `pathToSelected.size > 0`, it would have passed trivially with a 0-relation graph.

**The rule for Phase 56 going forward:** every store-side write must have at least ONE test that drives the corresponding USER ACTION (fireEvent.click on a rendered button) instead of `setState`. The 4 new tests added by this commit are the down payment; future Phase 56 maintenance plans should backfill this discipline across the existing 13 Phase 55 tests too if any new regressions surface.

## Tasks Completed (continuation only — Tasks 1+2 already committed)

### Task 3a (RED): Add click-handler-driven regression tests

**Commit:** `ec2bb0a92 test(56-04): add RED Phase 56 regression tests for 3 operator-reported issues`

- Added Tests 21-24 to `src/panels/coding/LslTimelineStrip.test.tsx`
- Extended `vi.mock('@/graph/useGraphData')` to read `globalThis.__mockRelations` so Test 24 can seed a 2-hop ancestry chain
- Verified RED: 5 fails (Tests 7 pre-existing baseline + 21/22/23/24 new); 19 GREEN baseline preserved (no new false-positive regressions)

### Task 3b (GREEN): Fix all 3 regressions + extract ancestry helper

**Commit:** `5baa4b965 fix(56-04): close 3 LslTimelineStrip regressions surfaced by visual smoke`

Three source changes + one supporting extraction:

1. **Extract `computeAncestryPath` + `HIERARCHY_TYPES`** from `D3GraphCanvas.tsx` lines 62-126 into new module `src/graph/ancestry.ts`. Bit-identical code-move. `D3GraphCanvas.tsx` now imports the helper. All 11 source-grep gates still hold.

2. **Issue 1 fix in `LslTimelineStrip.tsx`** — new `prevSelectedTsRef` ref tracks the previous `selectedTs`. The deselect-effect now gates its cascade on `prevSelectedTsRef.current !== null` (a real `selected → deselected` transition).

3. **Issue 2 fix in `LslTimelineStrip.tsx`** — subscribe to `selectedSessionId` from the store; re-key tick ring on `(isSelectedBucket || selectedSessionId === s.id)`; gate the running-tick `ring-primary` on `selectedSessionId === null` so the live ring doesn't compete with a session selection.

4. **Issue 3 fix in `LslTimelineStrip.tsx`** — destructure `relations` from `useGraphData()`; in `onTickClick`, compute `pathToSelected = new Set(computeAncestryPath(firstEntityId, relations).nodeDepths.keys())` when `firstEntityId !== null`, else `new Set()`. Both plain and Cmd/Ctrl branches get the real path.

### Task 3c (verify): Re-run Playwright + full vitest

- `npx vitest run src/panels/coding/LslTimelineStrip.test.tsx`: **24/24 GREEN** (5 RED tests flipped to GREEN; no regressions)
- `npx vitest run src/graph/D3GraphCanvas.test.ts`: **11/11 GREEN** (extraction preserved every gate)
- `npx vitest run src/panels/HistorySidebar.test.tsx src/panels/OccurrenceHistorySidebar.test.tsx`: **17/17 GREEN** (sibling panels unaffected)
- `npx tsc --noEmit`: exit 0
- `npx playwright test --project=unified-viewer tests/e2e/unified-viewer/56-bidirectional-selection.spec.ts`: **4/4 GREEN** (9.3s total)

Full unified-viewer vitest suite: 545 passed / 21 failed (10 unrelated baseline test files — Phase 55 toggleLayer + sigma color-fallback + UnifiedViewer routing — none touch Phase 56 surfaces or files I modified).

## Outcome

| Acceptance Criterion (from continuation success_criteria) | Status | Evidence |
|---|---|---|
| All 3 regressions diagnosed root-cause and fixed | PASS | Commits ec2bb0a92 (RED) + 5baa4b965 (GREEN) cover Issues 1/2/3 with separate diagnoses + fixes |
| At least one click-handler-driven vitest per regression | PASS | Test 21 (Issue 1 — window-button click), Test 23 (Issue 2 — tick click on empty entityIds), Test 24 (Issue 3 — tick click ancestry); Test 22 is a bonus lock for Issue 1 |
| Post-fix vitest count = pre-fix + N new GREEN, 0 new fails | PASS | Baseline 19 GREEN in LslTimelineStrip.test.tsx → now 24 GREEN (4 new + Test 7 pre-existing flipped); 0 new regressions across full suite (10 unrelated baseline files unchanged) |
| Post-fix tsc clean | PASS | `npx tsc --noEmit` exit 0 |
| Post-fix 4/4 Playwright specs still GREEN | PASS | 9.3s run, all 4 specs PASS |
| 56-04-SUMMARY.md committed | PASS | This file |
| No modifications to STATE.md or ROADMAP.md | PASS | `git status` shows only the per-commit files + this SUMMARY + node_modules symlink (transient) |

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking issue] Worktree missing `node_modules/`**

- **Found during:** Task 3a vitest first invocation
- **Issue:** `.claude/worktrees/agent-a9885573428511969/integrations/unified-viewer/` has no `node_modules/` so `npx vitest` and `npx tsc` both error with "Cannot find package 'vitest'"
- **Fix:** `python3 -c "import os; os.symlink('/Users/Q284340/Agentic/coding/integrations/unified-viewer/node_modules', '<worktree>/integrations/unified-viewer/node_modules')"`. Same workaround used by Plans 56-01, 56-02, and 56-03; documented in each prior SUMMARY's "Deviations" section as the standard worktree dev workflow. Symlink not committed (transient; gitignored).
- **Why Rule 3 (not Rule 4):** Environment setup; no source files touched.

**2. [Rule 2 — Auto-add missing critical functionality] Shared-helper extraction**

- **Found during:** Task 3b design (planning the Issue 3 fix)
- **Issue:** The resume_instructions suggested either reusing or extracting the ancestry helper. With two consumers (D3GraphCanvas's node click + LslTimelineStrip's tick click), inline-duplicate would silently drift the moment HIERARCHY_TYPES needs a new edge type — a latent correctness bug.
- **Fix:** Extract `computeAncestryPath` + `HIERARCHY_TYPES` into `src/graph/ancestry.ts`. Bit-identical code-move from D3GraphCanvas.tsx lines 62-126; D3GraphCanvas now imports the helper. Verified: all 11 D3GraphCanvas source-grep gates still hold; tsc clean; full Phase 56 test pass.
- **Why Rule 2 (not Rule 4):** This is a correctness measure (preventing drift between two consumers of the same logic). Plan 56-04 already has D3GraphCanvas in scope, and the extraction does not change any external behaviour or contract. The new file is a refactor of in-scope code, not a new architectural primitive.

### Not auto-fixed

None.

## Threat Surface Scan

No new threat surface beyond what Plan 56-04's `threat_model` already declared:

- **T-56-04-02 (DoS — centering effect re-fires on visibleEntities change):** unchanged. The new `pathToSelected` build adds one extra `computeAncestryPath(firstEntityId, relations)` call per tick click — O(R) BFS over the hierarchy edge subset of the relations array, identical cost to the existing D3GraphCanvas node click. Tick clicks are user-initiated, not automated.
- **T-56-04-05 (Visual regression — Phase 55 §7 surfaces):** unchanged. The tick-ring re-key adds a class condition; the live-tick `ring-primary` is gated on `selectedSessionId === null` so the visual is identical when no session is selected. The deselect-effect gate only DELAYS state changes that were previously firing unconditionally on mount — strictly fewer state mutations.

No new endpoints, no new auth paths, no new schema changes. No `threat_flag` to surface.

## Self-Check: PASSED

Per-claim verification (all asserted files / commits exist on the worktree branch):

```
FOUND: integrations/unified-viewer/src/graph/ancestry.ts
FOUND: integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx
FOUND: integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx
FOUND: integrations/unified-viewer/src/graph/D3GraphCanvas.tsx
FOUND: .planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-04-SUMMARY.md

FOUND: ec2bb0a92 test(56-04): add RED Phase 56 regression tests for 3 operator-reported issues
FOUND: 5baa4b965 fix(56-04): close 3 LslTimelineStrip regressions surfaced by visual smoke

GREP PASS: prevSelectedTsRef present in LslTimelineStrip.tsx (Issue 1 fix anchor)
GREP PASS: isSelectedSession || selectedSessionId === s.id in LslTimelineStrip.tsx (Issue 2 fix anchor)
GREP PASS: computeAncestryPath imported in LslTimelineStrip.tsx (Issue 3 fix anchor)
GREP PASS: export function computeAncestryPath in src/graph/ancestry.ts
GREP PASS: import { computeAncestryPath } from './ancestry' in D3GraphCanvas.tsx
GREP PASS: D3GraphCanvas main useEffect dep list still omits selectedNodeId

VITEST PASS: 24/24 LslTimelineStrip.test.tsx (Tests 7, 21, 22, 23, 24 flipped from RED → GREEN)
VITEST PASS: 11/11 D3GraphCanvas.test.ts (extraction preserved gates)
VITEST PASS: 17/17 HistorySidebar.test.tsx + OccurrenceHistorySidebar.test.tsx
PLAYWRIGHT PASS: 4/4 56-bidirectional-selection.spec.ts (9.3s)
TSC PASS: --noEmit exit 0
```

## Known Stubs

None. All 3 regressions are fixed in production code; the 4 new tests drive real DOM events; no placeholders or mock-mode toggles introduced.

## TDD Gate Compliance

This continuation followed strict RED → GREEN with separate commits:

- RED: `ec2bb0a92 test(56-04): add RED Phase 56 regression tests for 3 operator-reported issues` — 4 new tests added (Tests 21-24), all RED at baseline
- GREEN: `5baa4b965 fix(56-04): close 3 LslTimelineStrip regressions surfaced by visual smoke` — all 4 new tests flip to GREEN; pre-existing Test 7 baseline failure flips to GREEN for free

No REFACTOR commit — the extraction in the GREEN commit is a pure code-move (bit-identical to the original inline implementation), verified by re-running 11/11 D3GraphCanvas source-grep gates. A separate refactor commit would create an artificial intermediate state where the strip needed the helper but the helper hadn't been extracted yet.

## Next Plan Readiness

- Plan 56-04 Task 3 (operator visual smoke at /viewer/coding) is the next gate. After this continuation:
  - AC #1 (timestamp scale) — already worked; the bug was the window-button SELECTION not the scale itself. Now buttons stick → user can change the scale.
  - AC #2 (graph → others) — fully wired (D3GraphCanvas atomic node click — committed in Task 1).
  - AC #3 (history → graph centering) — fully wired (centering effect in Task 1).
  - AC #4 (timeline → graph + history) — NOW fully wired. Issue 2 fix gives the tick ring; Issue 3 fix gives the central-trace; existing 56-03 contract gives the sidebar scroll.
  - AC #5 + #7 (Esc + bg-click clears) — fully wired (clearSelection() store action in Plan 01; bg-click routes through it via Task 1).
  - AC #6 (aggregate selectedSessionId) — fully wired in Plan 56-03; Issue 2 fix now visualizes it.
  - AC #8 (no Phase 55 regression) — visual smoke pending operator re-run.
- After Task 3 sign-off, Phase 56 is COMPLETE.

---
*Phase: 56-unified-viewer-bidirectional-selection-timeline-scale*
*Plan 04 continuation completed: 2026-06-13*
