---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 01
subsystem: unified-viewer
tags: [system-endpoints, routing, cap-removal, okm-routing, side-panel, e2e]
requires:
  - "phase-45 System union + isValidSystem + UnknownSystem scaffold"
  - "OKM Express on :8090 already conforms to Phase 44 /api/v1/* contract (operator pre-flight, D-55-01a)"
provides:
  - "2-system viewer (coding + okb) with cap dropped"
  - "okb routes to OKM Express on :8090 (was :3848 = coding KG silently)"
  - "purged corporate-URL surface across viewer + e2e tests"
affects:
  - "any downstream plan that imports System from system-endpoints (union narrowed: 'coding' | 'okb')"
  - "any UI surface that branched on system==='cap' (now dead)"
  - "any test fixture asserting cc.bmwgroup.net (purged)"
tech-stack:
  added: []
  patterns:
    - "Vite import.meta.env fallback for backend URL (preserved from Phase 45)"
    - "TS narrow union + runtime isValidSystem guard (Phase 45 pattern preserved)"
key-files:
  created: []
  modified:
    - "integrations/unified-viewer/src/config/system-endpoints.ts"
    - "integrations/unified-viewer/src/config/system-endpoints.test.ts"
    - "integrations/unified-viewer/src/panels/SidePanel.tsx"
    - "integrations/unified-viewer/src/panels/SidePanel.test.tsx"
    - "integrations/unified-viewer/src/panels/NavBar.test.tsx"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx"
    - "integrations/unified-viewer/src/lib-domain/states.test.tsx"
    - "integrations/unified-viewer/.env.example"
    - "tests/e2e/unified-viewer/system-routing.spec.ts"
    - "tests/e2e/unified-viewer/rca-ingestion.spec.ts"
  deleted:
    - "integrations/unified-viewer/src/panels/RcaOpsPanel.tsx (dead after cap drop)"
    - "integrations/unified-viewer/src/panels/RcaOpsPanel.test.tsx"
    - "integrations/unified-viewer/src/api/OkmRcaClient.ts (only RcaOpsPanel consumer)"
    - "integrations/unified-viewer/src/api/OkmRcaClient.test.ts"
decisions:
  - "Deleted OkmRcaClient + tests (no consumer after RcaOpsPanel removal) — Rule 3 (dead-code cleanup), tracked in Deviations"
  - "states.test.tsx Tests 5+6 switched from system='cap' to system='okb' (preserves State Contract copy testing on a still-valid system)"
  - "Kept rca-ingestion.spec.ts filename (rewritten as 55-cap-removal smoke) so 55-01-PLAN.md verification grep still matches"
metrics:
  duration_min: 11
  completed_date: "2026-06-09"
  tasks_completed: 3
  files_touched: 14
---

# Phase 55 Plan 01: System-Endpoints CAP Removal + OKB Retarget Summary

**One-liner:** Drop `cap` system entirely (URL was hallucinated), retarget `okb` from semantic-analysis :3848 (was silently serving coding KG) to OKM Express :8090, purge every `cc.bmwgroup.net` and `VITE_BACKEND_CAP_URL` reference from the viewer + its E2E suite.

## What Shipped

Three deliverables from `55-CONTEXT.md`:

- **D-55-01a — Generalized km-core routing:** `SYSTEM_ENDPOINTS.okb` falls back to `http://localhost:8090` (OKM Express). Previous Phase 45 value `:3848` mapped to semantic-analysis which holds the **same** km-core LevelDB store as obs-api at `:12436` — so OKB tab was silently rendering the coding KG, not OKM data.
- **D-55-01b — Drop CAP tab:** `cap` removed from the `System` union, `VALID_SYSTEMS`, `SYSTEM_ENDPOINTS`, `SYSTEM_LABELS`, `isValidSystem`, every test fixture, every E2E spec, `.env.example`'s `VITE_BACKEND_CAP_URL`. The unified viewer is now a 2-system viewer. `/viewer/cap` falls through to `UnknownSystem`.
- **D-55-01c — `cc.bmwgroup.net` purge:** Zero occurrences in `integrations/unified-viewer/` source or tests. Two tests (`system-routing.spec.ts`, `rca-ingestion.spec.ts`) still use the literal as a **negative assertion** (must NOT contain) — this is the gate that proves the purge holds.

The `RcaOpsPanel` was the only consumer of the `cap` system and was therefore dead after D-55-01b. Same for `OkmRcaClient` — the only consumer of `OkmRcaClient` was `RcaOpsPanel`. Both files (plus their tests) were deleted.

## Tasks & Commits

| Task | Name                                                                     | Commit       | Files                                                                                                                     |
| ---- | ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| RED  | Failing tests for system-endpoints without `cap`                          | `70a1edc7f`  | `system-endpoints.test.ts`                                                                                                |
| 1    | Drop `cap` from system-endpoints; retarget okb to OKM Express :8090       | `7b3cbf67e`  | `system-endpoints.ts`, `.env.example`                                                                                     |
| 2    | Drop RCA tab from SidePanel; delete RcaOpsPanel + OkmRcaClient            | `f097b7396`  | `SidePanel.tsx`, `SidePanel.test.tsx`, deleted `RcaOpsPanel.{tsx,test.tsx}`, `OkmRcaClient.{ts,test.ts}`                   |
| 3    | Purge cc.bmwgroup.net + CAP fixtures across viewer tests + e2e            | `25554ce78`  | `states.test.tsx`, `NavBar.test.tsx`, `UnifiedViewer.test.tsx`, `system-routing.spec.ts`, `rca-ingestion.spec.ts`, stale-comment cleanup in `SidePanel.tsx` |

## Verification Gates (all GREEN)

| Gate                                                                                  | Result  | Evidence                                                                 |
| ------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `npx vitest run src/config/system-endpoints.test.ts src/panels/SidePanel.test.tsx`    | PASS    | 20/20 tests across 2 files                                                |
| `npx vitest run` (full suite)                                                          | PASS    | 180/180 tests across 24 files                                             |
| `npx tsc --noEmit`                                                                     | PASS    | exit 0                                                                    |
| `npx vite build`                                                                       | PASS    | built in 3.0–4.4s                                                         |
| `grep -rIn "cc.bmwgroup.net" integrations/unified-viewer/`                              | PASS    | no matches (exit 1)                                                       |
| `grep -rIn "VITE_BACKEND_CAP_URL\|RcaOpsPanel" integrations/unified-viewer/src/`        | PASS    | no matches (exit 1)                                                       |
| `grep -c "8090" integrations/unified-viewer/src/config/system-endpoints.ts`             | 2       | plan said 1; the second match is a clarifying comment, not a 2nd literal  |
| `grep -rn "RcaOpsPanel\|TabValue.*rca\|'rca'" integrations/unified-viewer/src/` (live)  | PASS    | 0 matches in non-test, non-comment source                                 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking dead-code cleanup] Deleted OkmRcaClient + its test**

- **Found during:** Task 2
- **Issue:** After deleting `RcaOpsPanel.tsx`, the only consumer of `OkmRcaClient` was gone. Leaving `OkmRcaClient.ts` and `OkmRcaClient.test.ts` in the tree would (a) keep `https://okm.cc.bmwgroup.net` alive in `OkmRcaClient.test.ts:53` (the `BASE` constant) — violating D-55-01c, and (b) leave an unused module that drags 8 stale fetch-/SSE-mock tests through every full-suite run.
- **Fix:** `git rm` of both files. The cap-system path is gone end-to-end.
- **Files modified:** `integrations/unified-viewer/src/api/OkmRcaClient.ts`, `OkmRcaClient.test.ts` (both deleted)
- **Commit:** `f097b7396`

**2. [Rule 3 — Blocking dead-code cleanup] Updated NavBar.test.tsx to drop `nav-link-cap` assertion**

- **Found during:** plan-level full-suite verification
- **Issue:** `NavBar.test.tsx:42` asserted `screen.getByTestId('nav-link-cap')`. NavBar.tsx itself is dynamic (iterates `VALID_SYSTEMS`), so the test failed at runtime once `VALID_SYSTEMS` lost `'cap'`. Plan's `<read_first>` block did not list this file but it was the only remaining red test after Task 3.
- **Fix:** Test 1 narrowed to two NavLinks (Coding + OKB); CAP link existence is now negated via `queryByTestId('nav-link-cap')` → null.
- **Files modified:** `integrations/unified-viewer/src/panels/NavBar.test.tsx`
- **Commit:** `25554ce78`

**3. [Rule 3 — Blocking dead-code cleanup] Updated states.test.tsx Tests 5+6 to use system="okb" + localhost:8090**

- **Found during:** Task 2 → Task 3 transition (TS errors after System union narrowed)
- **Issue:** `states.test.tsx:59` and `:78` rendered `<ErrorUnreachableState system="cap" baseUrl="https://okm.cc.bmwgroup.net" />` — both forbidden after Phase 55.
- **Fix:** Switched to `system="okb"` + `baseUrl="http://localhost:8090"` (Test 5) and `system="okb"` (Test 6). State Contract copy semantics preserved — the tests still prove the interpolation regex (`Cannot reach {system} API at {baseUrl}...`).
- **Files modified:** `integrations/unified-viewer/src/lib-domain/states.test.tsx`
- **Commit:** `25554ce78`

**4. [Rule 3 — Blocking dead-code cleanup] Updated UnifiedViewer.test.tsx — `/viewer/cap` now asserts UnknownSystem fallback**

- **Found during:** post-Task-2 verification
- **Issue:** UnifiedViewer.test.tsx had a dedicated test asserting `/viewer/cap` renders the active CAP nav-link — that's now wrong: `/viewer/cap` must fall through to `UnknownSystem`.
- **Fix:** Test rewritten to assert `UnknownSystem` renders with exactly 2 recovery links (Coding + OKB, no CAP). Also updated `/viewer/foo` + `/foo` tests to expect 2 links instead of 3.
- **Files modified:** `integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx`
- **Commit:** `25554ce78`

**5. [Rule 3] Updated E2E `system-routing.spec.ts` — `/viewer/cap` is now a UnknownSystem fall-through, not a "live or error banner" probe**

- **Found during:** Task 3
- **Issue:** Phase 45 E2E spec accepted either a live CAP canvas OR an unreachable-error banner. Phase 55 removes both possibilities.
- **Fix:** Test rewritten to assert `UnknownSystem` is shown for `/viewer/cap`, the page body contains no `cc.bmwgroup.net`, no `(CORS)` banner, and the recovery list has 2 links (no CAP).
- **Files modified:** `tests/e2e/unified-viewer/system-routing.spec.ts`
- **Commit:** `25554ce78`

**6. [Documentation hygiene] Stale-comment cleanup in `SidePanel.tsx`**

- **Found during:** verification gate post-task
- **Issue:** the file's leading comment mentioned `RcaOpsPanel` historically, which kept the grep gate `VITE_BACKEND_CAP_URL|RcaOpsPanel` reporting one match (in a comment, not code).
- **Fix:** Comment rephrased to describe the post-Phase-55 tab inventory without naming the deleted file.
- **Commit:** `25554ce78`

### Filename Preservation Note

The Phase 45 E2E spec `tests/e2e/unified-viewer/rca-ingestion.spec.ts` was **rewritten in place** (not renamed) into a focused 55-cap-removal smoke test. Rationale: the `55-01-PLAN.md` `<verify>` block runs `npx playwright test tests/e2e/unified-viewer/rca-ingestion.spec.ts ...`; renaming would break that command. The new spec covers exactly the 4 behaviors listed in the plan's `<behavior>` block for Task 3. A future plan can rename it to `55-cap-removal-smoke.spec.ts` once 55-01 closes.

### Operator-Side Verifications Deferred

The plan's `<verification>` block ends with two `gsd-browser` checks that require a running dev server (`http://localhost:5173`) and the live `coding-services` stack:

- `gsd-browser navigate http://localhost:5173/viewer/cap` — render not-found, no `(CORS)`, no `cc.bmwgroup.net`
- `gsd-browser navigate http://localhost:5173/viewer/okb` — verify the live ApiClient base URL is `http://localhost:8090`

These are smoke probes for the verifier (Phase 55 has its own validation framework), not unit-level gates. They were not run in this executor session (the worktree does not bring up its own Vite dev server). Captured here so the verifier knows where to look.

## TDD Gate Compliance

Plan frontmatter declares each task `tdd="true"`. The RED commit `70a1edc7f` (test-only, 13 cases) precedes the GREEN commit `7b3cbf67e` (system-endpoints.ts + .env.example implementation) — this is the required RED→GREEN sequence for Task 1.

Tasks 2 + 3 were structurally TDD-shaped but the test changes happened to **already** pass on top of Task 1's narrower System union (because the tests describe absence of behavior — "the cap tab isn't there", "rca-link isn't there"). So Task 2's RED+GREEN landed in one commit (`f097b7396`) and Task 3's in `25554ce78`. The plan's `tdd="true"` annotation is honored in spirit (tests written / updated to exercise the new shape, and asserted PASS before commit) but the per-task RED gate is only structurally present in Task 1.

## Known Stubs

None. The plan is a deletion/correction plan — no new UI surface was stood up that could be stubbed.

## Threat Flags

None new. The plan strictly **reduces** attack surface:

- T-55-01-01 (information disclosure: OKB tab shows coding KG) — mitigated via D-55-01a.
- T-55-01-02 (tampering: misleading CORS banner) — mitigated via D-55-01c.
- T-55-01-03 (open redirect via env override) — accepted (local-dev trust model unchanged).

No new network endpoints, no new schema, no new auth paths.

## Self-Check: PASSED

**Files exist:**
- ✓ `integrations/unified-viewer/src/config/system-endpoints.ts` — present, `System = 'coding' | 'okb'`
- ✓ `integrations/unified-viewer/src/config/system-endpoints.test.ts` — present, 13 tests
- ✓ `integrations/unified-viewer/src/panels/SidePanel.tsx` — present, TabValue narrowed
- ✓ `integrations/unified-viewer/src/panels/SidePanel.test.tsx` — present, 7 tests
- ✓ `integrations/unified-viewer/.env.example` — present, no VITE_BACKEND_CAP_URL
- ✓ `tests/e2e/unified-viewer/rca-ingestion.spec.ts` — present, rewritten as 55-cap-removal smoke
- ✓ `integrations/unified-viewer/src/panels/RcaOpsPanel.tsx` — ABSENT (deleted, expected)
- ✓ `integrations/unified-viewer/src/panels/RcaOpsPanel.test.tsx` — ABSENT (deleted, expected)
- ✓ `integrations/unified-viewer/src/api/OkmRcaClient.ts` — ABSENT (deleted, expected)
- ✓ `integrations/unified-viewer/src/api/OkmRcaClient.test.ts` — ABSENT (deleted, expected)

**Commits exist (on `worktree-agent-ad219e075f1f2ad3d`):**
- ✓ `70a1edc7f` — RED for Task 1
- ✓ `7b3cbf67e` — GREEN for Task 1
- ✓ `f097b7396` — Task 2
- ✓ `25554ce78` — Task 3
