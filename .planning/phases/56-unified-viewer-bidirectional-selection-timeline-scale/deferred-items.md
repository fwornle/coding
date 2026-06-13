# Phase 56 — Deferred Items (Out-of-Scope During Execution)

These items were discovered during Phase 56 execution but are unrelated to Phase 56's
shared selection scope. Filed for future cleanup.

## Pre-existing test failures in viewer-store.test.ts (Phase 55 layers slice)

Discovered: Plan 56-01 Task 1 (during baseline verification).

Two tests in `useViewerStore — Phase 55 action setters (Task 2)` already fail on the
plan baseline (commit `97d51bb29`, no Phase 56 changes yet applied):

- `toggleLayer('evidence') from empty list adds it`
  - Expected: `['evidence']`
  - Actual: `['evidence', 'pattern']` (current behaviour materialises the full set first
    so the empty-array "all visible" sentinel toggles correctly per the layer-filter UX
    fix referenced inline at `viewer-store.ts:259-285`)

- `toggleLayer('evidence') when already present removes it`
  - Expected: `[]`
  - Actual: `['pattern', 'evidence']` (the test sets up via two `toggleLayer('evidence')`
    calls but the sentinel makes the first call expand to `['evidence', 'pattern']`)

Root cause: the Phase 55 layer-toggle implementation evolved (the inline comment block
at viewer-store.ts:259-285 documents the empty-array / `__none__` sentinel logic added
after the tests were written) but the matching test expectations were not updated.

Scope decision: pre-existing, outside Phase 56 files_modified. Tracked here for the
Phase 55 owner to clean up. Phase 56 added 13 new tests (all GREEN); the failing pair
is unchanged from the baseline.

Recommendation: update the test expectations to match the materialise-then-toggle
behaviour, OR if the original empty-array contract is preferred, revert the toggleLayer
body — but that would regress the UX bugs the inline comment block documents.

## Pre-existing test failure in LslTimelineStrip.test.tsx Test 7 (Cmd/Ctrl+click)

Discovered: Plan 56-03 Task 2 (during GREEN verification).

Test 7 (`Cmd/Ctrl+click calls addLslSessionFilter (additive)`) was in the baseline
failure list before Plan 03 started (Tests 2/6/7/9 all failed — the visible cause was
`entities.find is not a function` in the strip's `selectedTs` memo because the test
mocked `globalThis.fetch` with a sessions-shaped envelope that returned an object,
not an Entity[], to `apiClient.listEntities()`).

Plan 03's [Rule 3 blocking] mock of `useGraphData` neutralised the crash, surfacing
the *true* underlying baseline issue:

- The test seeds `lslSessionFilter: ['sess-aaaaaaaa']` BEFORE render
- On first render with `selectedNodeId === null`, the strip's deselect effect at
  lines 187-211 unconditionally clears `lslSessionFilter` to `[]`
- The subsequent meta-click then writes `[sessionId]` (additive over empty)
- Assertion `expect(filter).toContain('sess-aaaaaaaa')` fails because the deselect
  effect already nuked it

Root cause: the deselect effect's cleanup branch fires on EVERY mount where
`selectedTs === null`, not just on a transition from selected → null. This is a
latent bug in the strip's mount-time UX (it overrides user-set LSL filter state
the moment the strip remounts with no node selected).

Scope decision: pre-existing baseline failure; Plan 03's changes do NOT touch the
deselect effect or the meta-click branch's `lslSessionFilter` write (only added
three new fields alongside). Tracked here for the Phase 55 owner (this effect was
introduced in Phase 55 plans 06/11 per the inline comment at lines 187-211).

Recommendation: gate the deselect cleanup on a previous-selected ref (only clear
if `selectedTs` was non-null on the previous render), OR update Test 7 to set
`selectedNodeId` to a value that resolves through the mock entities so the
deselect effect doesn't fire. The latter is the smaller fix and is consistent
with Test 19's approach.
