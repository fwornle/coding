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
