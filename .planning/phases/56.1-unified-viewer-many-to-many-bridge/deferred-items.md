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

## Stale Phase-56-Field References in 13 Additional Test Files (Plan 05)

Plan 05 closed the **active source** chain: `events.ts`, `graph-builder.ts`,
`reducers.ts`, `useKeyboardShortcuts.ts`, `graph-builder.test.ts` (the only
test that paired with a runtime source migration) were migrated to
`focalNodeId` + the multi-set fields opportunistically (Rule 3 closure for
the runtime path that Plan 05's E2E surface needs).

The remaining 13 test files reference the deleted Phase 56 fields and remain
tsc-compile-broken. They are NOT in Plan 05's `<files_modified>` and migrating
them would balloon Plan 05 well beyond its forward-direction integration scope.
Same mechanical sweep applies as the Plan 04 deferred items: replace
`selectedNodeId` → `focalNodeId`; replace `setState({ selectedNodeId: id })`
with `useViewerStore.getState().setSelectedNode(id)`; replace
`selectedSessionId` / `selectedSessionStartAt` reads with
`focalBucketKey` / `selectedBucketKeys.has(\`${id}|${startAt}\`)`.

### Affected test files (all out-of-scope for Plan 05):

- `src/graph/SigmaCanvas.test.tsx` (5 refs)
- `src/hooks/useKeyboardShortcuts.test.tsx` (33 refs — largest)
- `src/panels/EntityDetailPanel.test.tsx` (30 refs)
- `src/panels/FilterRail.test.tsx` (1 ref)
- `src/panels/HistorySidebar.test.tsx` (26 refs — overlaps with Plan 04 deferred)
- `src/panels/MarkdownViewerPanel.test.tsx` (15 refs)
- `src/panels/OccurrenceHistorySidebar.test.tsx` (27 refs)
- `src/panels/SidePanel.test.tsx` (4 refs — overlaps with Plan 04 deferred)
- `src/panels/TrendingPanel.test.tsx` (5 refs)
- `src/panels/coding/EtmTailSheet.test.tsx` (2 refs)
- `src/panels/coding/HierarchyNavigator.test.tsx` (1 ref)
- `src/panels/coding/WorkflowStatusPanel.test.tsx` (3 refs)
- `src/routes/IssueTriageView.test.tsx` (5 refs)

**Total:** ~157 mechanical field-rename occurrences across 13 test files.

**Fix path:** A dedicated Wave-3 cleanup plan (proposed: Plan 06 task or a
fresh 56.1-07-PLAN.md) can execute the mechanical replace in a single pass.
No semantic decisions remain — every site is a 1:1 rename per the recipe
above. Plans 03 + 04 + 05 closed every PRODUCTION reference; this is purely
test-fixture cleanup that does not affect runtime behaviour.
