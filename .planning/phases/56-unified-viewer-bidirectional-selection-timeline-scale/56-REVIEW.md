---
phase: 56-unified-viewer-bidirectional-selection-timeline-scale
reviewed: 2026-06-13T14:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - integrations/unified-viewer/src/store/viewer-store.ts
  - integrations/unified-viewer/src/store/viewer-store.test.ts
  - integrations/unified-viewer/src/hooks/useKeyboardShortcuts.ts
  - integrations/unified-viewer/src/hooks/useKeyboardShortcuts.test.tsx
  - integrations/unified-viewer/src/panels/HistorySidebar.tsx
  - integrations/unified-viewer/src/panels/HistorySidebar.test.tsx
  - integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx
  - integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.test.tsx
  - integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx
  - integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx
  - integrations/unified-viewer/src/graph/D3GraphCanvas.tsx
  - integrations/unified-viewer/src/graph/D3GraphCanvas.test.ts
  - integrations/unified-viewer/src/graph/ancestry.ts
  - integrations/unified-viewer/src/graph/ancestry.test.ts
  - integrations/unified-viewer/src/graph/visibility-predicate.ts
  - integrations/unified-viewer/src/graph/useVisibleEntityIds.ts
  - integrations/unified-viewer/src/routes/UnifiedViewer.tsx
  - integrations/unified-viewer/src/types/global.d.ts
  - tests/e2e/unified-viewer/56-bidirectional-selection.spec.ts
findings:
  critical: 3
  warning: 4
  info: 1
  total: 8
status: issues_found
---

# Phase 56: Code Review Report

**Reviewed:** 2026-06-13T14:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 56 delivers bidirectional selection sync across the graph canvas, LSL timeline strip, and history sidebars, plus a timestamp scale row for the strip. The store model is sound — the `setSelection` / `clearSelection` API, `sameSetMembership` deep-equal guard, `selectedSessionStartAt` sibling contract, and phantom-id resolution (`pickFirstResolvable`) are all correctly implemented in the store and in `LslTimelineStrip`.

Three blockers surface from cross-module analysis rather than individual file review:

1. Both sidebar panels (`HistorySidebar`, `OccurrenceHistorySidebar`) use direct `useViewerStore.setState({…})` with a 4-field payload that does NOT clear the active LSL session filter or the sibling session fields. A history-row click after a timeline-tick click leaves the graph dimmed to the previous session's entities while showing the new entity's detail panel — a broken UX state the user cannot recover from without knowing to use Esc.
2. `D3GraphCanvas` node-click direct `setState` clears `selectedSessionId` but silently leaves `selectedSessionStartAt` stale — a violation of the audit §7 R2 sibling-clear invariant.
3. The global Esc guard in `useKeyboardShortcuts` checks only `selectedNodeId !== null`, missing the sidebar-only mode scenario where `selectedNodeId === null` but `selectedSessionId` and `lslFilterEntityIds` are both set (because the entity had no graph-visible ancestor). Esc cannot clear those stuck fields.

---

## Critical Issues

### CR-01: HistorySidebar and OccurrenceHistorySidebar clicks leave stale LSL session filter active

**File:** `integrations/unified-viewer/src/panels/HistorySidebar.tsx:100-105` and `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx:113-118`

**Issue:** Both panels write a 4-field direct `useViewerStore.setState({selectedNodeId, pathToSelected, highlightedRowKey, selectionSource})`. They do NOT write `selectedSessionId: null`, `selectedSessionStartAt: null`, `lslSessionFilter: []`, or `lslFilterEntityIds: null`. When a user clicks a timeline tick (setting all four LSL fields) and then clicks a history row, the graph's `visibleEntities` useMemo still intersects against the stale `lslFilterEntityIds` — the graph stays narrowed to the previous session's entities while the side panel has already swapped to the new entity's detail. The user sees a mismatched state with no obvious recovery path short of pressing Esc (which itself has a separate bug — see CR-03).

This also violates the locked Phase 56 design contract from `56-PATTERNS.md`: "All cross-pane selection writes route through `setSelection` / `clearSelection` — zero inline `useViewerStore.setState({…})` calls outside the store file."

**Fix:** Replace both direct `setState` calls with `setSelection` plus explicit session-field clearing. Because `setSelection` preserves fields not passed in args, the session fields must be explicitly nulled:

```typescript
// HistorySidebar.tsx onClick  (same pattern for OccurrenceHistorySidebar)
const onClick = (id: string) => {
  useViewerStore.getState().setSelection({
    nodeId: id,
    highlightedRowKey: id,
    source: 'history',
    pathToSelected: new Set<string>(),
    // Explicitly clear session fields so LSL filter doesn't leak across panes.
    sessionId: null,
    sessionStartAt: null,
    lslSessionFilter: [],
    lslFilterEntityIds: null,
  })
  Logger.info(Logger.Categories.PANELS, `HistorySidebar → ${id}`)
}
```

The `setSelection` action signature already accepts all of these keys; `lslSessionFilter` and `lslFilterEntityIds` are the Phase 56 audit §6.3 additions. The store comment at line 95 needs the contradicting "or via `useViewerStore.setState({…})`" clause removed or tightened to exclude selection writes.

---

### CR-02: D3GraphCanvas node-click leaves `selectedSessionStartAt` stale (sibling-clear invariant violation)

**File:** `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx:527-533`

**Issue:** The graph node-click handler writes:

```typescript
useViewerStore.setState({
  selectedNodeId: d.id,
  pathToSelected: new Set(path.nodeDepths.keys()),
  highlightedRowKey: d.id,
  selectionSource: 'graph',
  selectedSessionId: null,        // ← clears session id
  // selectedSessionStartAt NOT present ← stale from prior tick click
})
```

Audit §7 R2 locks the invariant: "`selectedSessionId` and `selectedSessionStartAt` are ALWAYS written + cleared together — never one without the other." After a timeline-tick click sets both fields, a graph node-click clears `selectedSessionId` but leaves `selectedSessionStartAt` pointing at the previous tick. Currently this doesn't produce a visible ring (the tick ring predicate requires `selectedSessionId !== null`, which is now false), but any future consumer that reads `selectedSessionStartAt` independently (e.g. a tooltip or deep-link generator) will see inconsistent state. The G3 source-grep test in `D3GraphCanvas.test.ts` only checks for `selectedSessionId: null`; it does not cover the sibling.

**Fix:** Add `selectedSessionStartAt: null` to the node-click payload, OR replace the direct `setState` with `setSelection` which handles the sibling reset automatically:

```typescript
useViewerStore.getState().setSelection({
  nodeId: d.id,
  pathToSelected: new Set(path.nodeDepths.keys()),
  highlightedRowKey: d.id,
  source: 'graph',
  sessionId: null,          // setSelection resets sessionStartAt to null when sessionId is in args
  lslSessionFilter: [],
  lslFilterEntityIds: null,
})
```

Update the D3GraphCanvas G3 test to also assert `selectedSessionStartAt` is null post-click.

---

### CR-03: Esc guard `selectedNodeId !== null` fails to clear sidebar-only mode selection

**File:** `integrations/unified-viewer/src/hooks/useKeyboardShortcuts.ts:174-179`

**Issue:** The Esc handler at lines 174-179:

```typescript
const { selectedNodeId, clearSelection } = useViewerStore.getState()
if (selectedNodeId !== null) {
  clearSelection()
  event.preventDefault()
  // ...
}
```

`clearSelection()` is never called when `selectedNodeId === null`. The sidebar-only mode (introduced in Phase 56-04 round 4) writes `selectedNodeId: null` when no graph-visible ancestor can be resolved from a tick's entity ids, but still writes `selectedSessionId`, `lslFilterEntityIds`, and `lslSessionFilter` via `setSelection`. A user in sidebar-only mode presses Esc and gets no response — the LSL filter remains active, the session tick stays ringed, the graph stays dimmed. The only working escape is to press Esc while the strip itself has focus (which triggers `onStripKeyDown`'s `clearLslSessionFilter()`), or to explicitly click the background of the graph.

Test 13 in `useKeyboardShortcuts.test.tsx` was written to validate the guard and asserts that `lslSessionFilter` is NOT cleared when `selectedNodeId === null` — this test validates the broken behavior for the sidebar-only mode case.

**Fix:** Widen the guard condition to cover any active selection state:

```typescript
const {
  selectedNodeId, selectedSessionId, lslSessionFilter, clearSelection,
} = useViewerStore.getState()
const hasSelection =
  selectedNodeId !== null ||
  selectedSessionId !== null ||
  lslSessionFilter.length > 0
if (hasSelection) {
  clearSelection()
  event.preventDefault()
  Logger.debug(Logger.Categories.STORE, 'Esc: cleared selection (all panes)')
}
```

Add a new test case: sidebar-only mode (selectedNodeId=null, selectedSessionId set, lslSessionFilter set) → Esc clears all three. Test 13 must be updated to narrow its scenario to "no selection at all" (not "node unselected but session filter set by a prior tick click").

---

## Warnings

### WR-01: E2E Spec 2 asserts `.ring-blue-500` count === 1 without session coverage guarantee (flaky)

**File:** `tests/e2e/unified-viewer/56-bidirectional-selection.spec.ts:201`

**Issue:** Spec 2 clicks the first `[data-history-id]` row and immediately asserts `page.locator('.ring-blue-500').toHaveCount(1, { timeout: 5_000 })`. The timeline tick ring only lights via `isSelectedBucket` (entity `createdAt` inside a session `[startAt, endAt)` range). If the first history row is an Insight whose `createdAt` falls outside every loaded session's range (quite plausible — KG entities may predate the 7-day window), zero ticks will ring and the assertion fails. The companion Spec 1 correctly tolerates this with `toBeGreaterThanOrEqual(0)`.

Furthermore, because HistorySidebar's `onClick` uses direct `setState` (CR-01 above), `selectedSessionId` stays null after the click — only the `isSelectedBucket` path can produce a ring. The assertion is therefore data-dependent AND depends on a code path that is currently broken.

**Fix:** Replace the strict count assertion with a tolerant one matching Spec 1's pattern, and add a note tying the strict assertion to a future Phase 56.1 milestone when entity-to-session attestation is reliable:

```typescript
const ringedTicks = await page
  .locator('[data-testid^="lsl-tick-"].ring-blue-500')
  .count()
expect(ringedTicks).toBeGreaterThanOrEqual(0) // 0 when entity has no session coverage
```

---

### WR-02: `computeAncestryPath` drops all but the first parent path in diamond hierarchies

**File:** `integrations/unified-viewer/src/graph/ancestry.ts:52-72`

**Issue:** The BFS in `computeAncestryPath` populates `visited` with all ancestors but `parentOf` stores only the **first** parent encountered for each node (line 59: `if (!parentOf.has(cur)) parentOf.set(cur, p)`). The final path walk at lines 63-72 follows `parentOf` from `selectedId` to root, so `nodeDepths` only contains nodes on ONE linear path — nodes reachable via a secondary parent are silently excluded.

Consequently `resolveToVisibleAncestor` (which iterates `nodeDepths.keys()`) will return `null` when the only graph-visible ancestor is reachable exclusively via the "secondary" parent chain. In a knowledge graph where Component A has parents P1 and P2 (merged entities, multi-parent imports), and only P2 is visible, the resolution returns null even though a valid ancestor exists.

The KB currently enforces a tree structure in practice, so this is not an immediate production defect. However the contract in `56-PATTERNS.md` contract #6 ("any non-null `selectedNodeId` write originating outside `D3GraphCanvas` MUST resolve to a graph-visible ancestor first") is silently unenforceable for multi-parent graphs.

**Fix:** Change the BFS to accumulate ALL ancestors into `nodeDepths` — not only those on the single `parentOf` chain. The depth value for multi-path nodes can be the minimum BFS distance:

```typescript
// After the parentOf-based path walk, add any remaining visited nodes
// that the linear path walk didn't reach (multi-parent case).
for (const id of visited) {
  if (!nodeDepths.has(id)) {
    nodeDepths.set(id, depth + 1) // conservative: beyond the longest known chain
  }
}
```

Alternatively: replace the two-phase "BFS then path walk" with a single BFS that tracks depth directly.

Add a test in `ancestry.test.ts` covering a diamond hierarchy where only the secondary-path ancestor is visible.

---

### WR-03: Race window between `classOptions` seeding and first tick click forces sidebar-only mode

**File:** `integrations/unified-viewer/src/graph/useVisibleEntityIds.ts:53-81` and `integrations/unified-viewer/src/routes/UnifiedViewer.tsx:220-241`

**Issue:** `useVisibleEntityIds` reads `selectedClasses` from the store. The initial store value of `selectedClasses` is an empty `Set`. `isEntityVisible` at `visibility-predicate.ts:97` treats an empty set as "hide everything" (`!filters.selectedClasses.has(cls)` is always true when the set is empty). `UnifiedViewer` auto-seeds `selectedClasses` in a `useEffect` that fires one React commit after data loads. During this one-commit window, `useVisibleEntityIds` returns an empty set, so `pickFirstResolvable` resolves all tick entity ids to `null` — a tick click in this window writes `selectedNodeId: null` (sidebar-only mode) for entities that WOULD be graph-visible after seeding.

This is a transient window (milliseconds on a warm cache), but the pattern is reproducible on cold page load: click a tick before the auto-seed effect fires → stuck in sidebar-only mode with no graph ring, no trace, even for resolvable entities.

**Fix (short-term):** Guard `isEntityVisible` against an empty `selectedClasses` — treat empty as "all visible" (matching `selectedLayers: []` and `selectedDomains: []` semantics in the rest of the predicate):

```typescript
// visibility-predicate.ts line 95-97 — replace with:
if (filters.selectedClasses.size > 0) {
  if (typeof cls !== 'string' || !filters.selectedClasses.has(cls)) return false
}
```

This is consistent with the VOKB invariant (empty selection = all visible) that the other filter slices already follow.

---

### WR-04: `reset()` does not clear `lslSessionFilter`, `lslFilterEntityIds`, or `pathToSelected`

**File:** `integrations/unified-viewer/src/store/viewer-store.ts:416-427`

**Issue:** `clearSelection()` correctly clears the full selection slice including `lslSessionFilter: []`, `lslFilterEntityIds: null`, and `pathToSelected: new Set()`. `reset()` — used by the in-system Clear button in the `EmptyFilterState` — clears `selectedNodeId`, `selectedEdgeId`, `selectionSource`, `highlightedRowKey`, `selectedSessionId`, `selectedSessionStartAt`, and `searchQuery`. It does NOT reset:

- `lslSessionFilter` — LSL filter persists after Clear
- `lslFilterEntityIds` — graph stays narrowed after Clear
- `pathToSelected` — ancestry trace overlay persists after Clear

The Phase 56 `56-PATTERNS.md` note says "extend reset() too" and the store comment at line 413 claims it does. The implementation is incomplete.

**Fix:** Add the three missing fields to `reset()`:

```typescript
reset: () =>
  set({
    selectedNodeId: null,
    selectedEdgeId: null,
    searchQuery: '',
    selectedClasses: new Set<string>(),
    selectionSource: null,
    highlightedRowKey: null,
    selectedSessionId: null,
    selectedSessionStartAt: null,
    pathToSelected: new Set<string>(),     // ← add
    lslSessionFilter: [],                   // ← add
    lslFilterEntityIds: null,              // ← add
  }),
```

Add an assertion to the viewer-store test: after `reset()`, all three fields are at their cleared values.

---

## Info

### IN-01: `formatRelativeTime` in `HistorySidebar.tsx` uses misleading `performance` API comment

**File:** `integrations/unified-viewer/src/panels/HistorySidebar.tsx:45-47`

**Issue:** The comment at line 43 says "taking 'now' here would mutate identity across re-renders … Use validity-from-current-document-load via the performance API instead." However, `performance.timeOrigin + performance.now()` computes the current wall-clock time in milliseconds — it is arithmetically identical to `Date.now()`. The performance API does not provide a "fixed reference point"; it provides higher-precision timing from the same epoch. The stated concern about identity mutation is also moot: `formatRelativeTime` is called inside `useMemo` so it only runs when `items` changes, not on every render.

**Fix:** Replace the computation and the comment:

```typescript
const now = Date.now()
```

---

_Reviewed: 2026-06-13T14:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
