# Phase 56.1 Deferred Items

Items discovered during execution that are **out of scope** for the current
plan but should be tracked for future fixes.

## Pre-existing Test Failures (Plan 01)

Two `toggleLayer` tests in `integrations/unified-viewer/src/store/viewer-store.test.ts`
fail on main and continue to fail after Plan 01:

- `useViewerStore — Phase 55 action setters (Task 2) > toggleLayer('evidence') from empty list adds it`
  - Test expects `['evidence']`. Actual: `['pattern']`.
- `useViewerStore — Phase 55 action setters (Task 2) > toggleLayer('evidence') when already present removes it`
  - Test expects `[]`. Actual: `['pattern', 'evidence']`.

**Root cause:** `toggleLayer` was modified in 2026-06-12 (per the inline source
comment at lines ~444-470) to materialize the full `ALL_LAYERS = ['evidence',
'pattern']` set first when starting from `[]` (the "all visible" sentinel),
then apply the toggle. The Phase 55-04 tests were written against the old
"push the single value onto the array" behavior and never updated when the
implementation flipped.

**Confirmation:** Failure reproduces on main branch (`/Users/Q284340/Agentic/coding`)
without any Phase 56.1 changes:
```
cd /Users/Q284340/Agentic/coding/integrations/unified-viewer && \
  npx vitest run src/store/viewer-store.test.ts
# → Tests  2 failed | 51 passed (53)
```

**Scope:** Out of scope for Plan 56.1-01 (selection slice refactor). The tests
were not introduced or modified by Task 1/2. Per the SCOPE BOUNDARY directive:
"Only auto-fix issues DIRECTLY caused by the current task's changes."

**Suggested fix (future plan):** Update both tests to assert the materialized
semantics — `toggleLayer('evidence')` from `[]` should produce `['pattern']`
(evidence removed from the materialized `['evidence', 'pattern']` set); a
second call should produce `['__none__']` (per the case-(B) branch).

## Stale Phase-56-Field References in Existing Sidebar Tests (Plan 04)

Plan 56.1-04 explicitly scoped Task 2 to migrate `SidePanel.tsx` and
`HistorySidebar.tsx` production sources WITHOUT touching their `.test.tsx`
files (plan Task 2 step 10: "Do NOT modify HistorySidebar.test.tsx in this
plan ... but adding HistorySidebar.test.tsx fixes here would balloon the
plan size. The store-level invariants are covered by Plan 01's tests").

The migration deletes the Phase 56 single-selection field names from the
store; tests that still write/read those names regress. The exact tests:

### `integrations/unified-viewer/src/panels/HistorySidebar.test.tsx`
- `Test 2: clicking a row writes selection atomically (Phase 56 contract)`
  - Reads `s.selectedNodeId` — replaced by `s.focalNodeId` (Plan 01).
- `Test 8 (CR-01): clicking a row clears the stale LSL session-filter scope + sibling session-tick fields that a prior timeline-tick click left behind`
  - Pre-seeds `selectedSessionId`/`selectedSessionStartAt` and reads them
    post-click — both fields were removed by Plan 01 (replaced by the
    `selectedBucketKeys` Set + `focalBucketKey` derived field).

### `integrations/unified-viewer/src/panels/SidePanel.test.tsx`
- `Phase 55 — width expands to w-[30rem] when entity has markdown_url + Markdown tab`
- `Phase 55 — width expands to w-[30rem] when entity.description.length > 800`
  - Both pre-seed `useViewerStore.setState({ selectedNodeId: 'mdurl' })` /
    `'longdesc'`. After the field rename, the seed has no effect; `entity`
    derives from `focalNodeId` (still null), the width predicate stays at
    `w-96`, and the `/w-\[30rem\]/` assertion fails.

**Scope:** Out of scope per Plan 56.1-04 Task 2 step 10. Plan 04's contract
is the production-source migration + the new BucketCardList tests (which all
pass). The deleted-field test references are a Wave-3 cleanup item — fix is
mechanical: replace `selectedNodeId` → `focalNodeId` (plus matching writer
seeds: replace `setState({ selectedNodeId: id })` with
`useViewerStore.getState().setSelectedNode(id)` so the multi-set + focal
fields are kept consistent via the imperative shim).

### `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx` + others
Several other consumers (`OccurrenceHistorySidebar.tsx`, `D3GraphCanvas.tsx`,
`LslTimelineStrip.tsx`, `useKeyboardShortcuts.ts`, `events.ts`, `reducers.ts`)
also reference the deleted Phase 56 fields and are tsc-compile-broken since
Plan 01 closed. These are addressed by Plans 03/05/06 in their respective
Wave scopes — out of scope for Plan 04.

## ~~Stale Phase-56-Field References in 13 Additional Test Files (Plan 05)~~ — CLOSED 2026-06-13 by Plan 05

Originally documented as deferred, but the volume (~157 mechanical
occurrences across 13 test files) was blocking the project-wide tsc
gate stated in Plan 05's verify block. Closed inline by Plan 05 as a
Rule-3 (auto-fix blocking issues) batch sweep alongside the active-source
migration. Recipe used:

- `setState({ selectedNodeId: id })` → `getState().setSelectedNode(id)`
- `getState().selectedNodeId` → `getState().focalNodeId`
- `setState({ selectedSessionId: id, selectedSessionStartAt: startAt })` →
  `setState({ selectedBucketKeys: new Set([\`${id}|${startAt}\`]), focalBucketKey: \`${id}|${startAt}\` })`
- `setState({ selectedNodeId: null, ... })` blocks with extra keys → split into
  `getState().setSelectedNode(null)` + `setState({ ...other keys })`.

Production sources also closed in the same sweep: `EntityDetailPanel.tsx`,
`MarkdownViewerPanel.tsx`, `OccurrenceHistorySidebar.tsx`.

Files closed (all 13 test files + 4 production files):
- src/graph/SigmaCanvas.test.tsx, events.test.ts, graph-builder.test.ts
- src/hooks/useKeyboardShortcuts.test.tsx
- src/panels/EntityDetailPanel.test.tsx + .tsx
- src/panels/FilterRail.test.tsx
- src/panels/HistorySidebar.test.tsx
- src/panels/MarkdownViewerPanel.test.tsx + .tsx
- src/panels/OccurrenceHistorySidebar.test.tsx + .tsx
- src/panels/SidePanel.test.tsx
- src/panels/TrendingPanel.test.tsx
- src/panels/coding/EtmTailSheet.test.tsx
- src/panels/coding/HierarchyNavigator.test.tsx
- src/panels/coding/WorkflowStatusPanel.test.tsx
- src/routes/IssueTriageView.test.tsx

**Post-sweep state (2026-06-13):** project-wide tsc 0 errors. vitest 619/637
pass; the remaining 18 failures all reproduce on main repo without any
Phase 56.1 changes (toggleLayer / LayerFilter / OntologyFilter / NavBar /
UnifiedViewer / color-fallback / system-endpoints / node-renderer /
SigmaCanvas makeEdgeReducer-default-opacity) and are out-of-scope
pre-existing failures unrelated to the multi-set selection refactor.
