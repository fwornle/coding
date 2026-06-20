# Deferred Items — Phase 61

Out-of-scope discoveries during execution. NOT fixed (scope boundary: only auto-fix issues directly caused by the current task).

## 61-02

- **Pre-existing tsc errors in `integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx`** (lines 365, 366, 395): `Type 'null' is not assignable to type 'number | undefined'` — the test passes `level: null` for `OntologyClass.level` which is typed `number | undefined`. Present on base commit `f3fd30686` (Phase 60 OntologyFilter work), NOT introduced by 61-02. Task 1 files (`ApiClient.ts`, `useGraphData.ts`) compile clean. Fix: change `level: null` → `level: undefined` (3 sites) in a follow-up touching OntologyFilter. Tracked, not fixed here.

- **Pre-existing stale label assertions in `integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx`** (4 tests): assert nav/recovery-link text `'Coding'`/`'OKB'` but the shipped `SYSTEM_LABELS` were renamed to `'VKB'`/`'VOKB'` (Phase 55 rename, 2026-06-11, `system-endpoints.ts:33-36`). Pre-existing on base (6 of 13 tests in this file were already failing before 61-02). 61-02 took this file from 3→9 passing by fixing the `RELATIONS_KEY` mock export; the remaining 4 failures are the unrelated Phase 55 label drift. Fix: update the 4 assertions to `'VKB'`/`'VOKB'` in a follow-up. Not fixed here (out of 61-02 scope — Phase 55 label concern, not OKB routing honesty).
