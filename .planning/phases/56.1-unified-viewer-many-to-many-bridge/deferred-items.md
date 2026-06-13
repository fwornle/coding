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
