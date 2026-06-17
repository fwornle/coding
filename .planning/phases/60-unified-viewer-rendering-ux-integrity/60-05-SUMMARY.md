---
phase: 60-unified-viewer-rendering-ux-integrity
plan: 05
subsystem: ui
tags: [react, typescript, ontology, filters, vitest, tdd, unified-viewer]

# Dependency graph
requires:
  - phase: 57-lower-ontology-project-tagging-foundation
    provides: "10 L2 classes in .data/ontologies/coding.lower.json (LiveLoggingSystem, ConstraintMonitor, KnowledgeManagement, BatchSemanticAnalysis, RapidLlmProxy, DockerizedServices, OnlineObservation, OnlineDigest, OnlineInsight, EtmDaemon) — source of truth for L1->L2 group construction"
  - phase: 55-unified-viewer-feature-parity-with-vokb
    provides: "OntologyFilter render primitives (renderClassCheckbox, renderSubGroup, __none__ sentinel handling, count badge / [all]/[none] link-button shape, micro-type tokens) reused verbatim by the new API-driven path"
  - phase: 44-…
    provides: "ApiClient.listOntologyClasses() GET /api/v1/ontology/classes?withDisplay=true returning OntologyClass[] with {name, level?, parent?, display?}"
provides:
  - "OntologyFilter dual-mode rendering: legacy hardcoded path (VOKB tab via VOKB_SCHEMA) AND API-driven L1->L2 path (coding tab via apiClient.listOntologyClasses)"
  - "Coding-tab L1 collapsible groups containing L2 children (per Phase 57 lower ontology)"
  - "L0 anchors (System, Project) ungrouped at the top of the filter"
  - "Per-class count badges on L2 rows, [all]/[none] link-buttons on L1 groups"
  - "UI-only L1 collapse (selectedOntologyClasses untouched)"
  - "BC fallback for pre-Plan-04 string[] response shape"
  - "Error fallback (rejected fetch -> flat rows from entity-derived classes)"
  - "VOKB tab regression preservation — Upper Ontology / Failure Model groups render verbatim (W-1)"
affects:
  - "Phase 61 OKB routing — VOKB schema migration follow-up: VOKB tab still uses hardcoded VOKB_SCHEMA; planned schema-source migration to API-driven path is deferred to a separate phase per Phase 60 deferred ideas"
  - "Phase 60 Plan 06+ (other G1-G4 work) — independent of Plan 05; share the same /api/v1/ontology/classes?withDisplay=true endpoint that this plan consumes"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Component prop-driven mode-switch: required dependency injected (apiClient) + optional schema prop, with absence-of-prop selecting the new code path"
    - "Single-fetch-per-mount registry consumption (useEffect with cleanup cancellation, no entity-dep re-fetch)"
    - "Static file-read assertion in vitest (readFileSync against process.cwd()-relative src path) as a robust grep-style check for dead-code removal"
    - "Graceful BC+error fallbacks (no-level response treated as flat; rejected fetch derives flat list from entity payload)"

key-files:
  created: []
  modified:
    - "integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx — dropped CODING_SCHEMA + Typed Views; added apiClient prop + API-driven L1->L2 build + L0 anchor section + UI-only L1 collapse"
    - "integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx — replaced VOKB/CODING legacy assertions with 15 tests covering D-16..D-20 + W-1 regression + BC + loading + error fallbacks"
    - "integrations/unified-viewer/src/panels/FilterRail.tsx — replaced CODING_SCHEMA import with VOKB_SCHEMA; inverted system-based schema derivation (coding -> no prop / API-driven; okb -> VOKB_SCHEMA / legacy); threaded apiClient through to mount"
    - "integrations/unified-viewer/src/panels/FilterRail.test.tsx — updated Phase 55-08 coding-tab assertion to match new contract (Typed Views absent; listOntologyClasses invoked); awaited async fetch in Ontology-Class-mount BC test"

key-decisions:
  - "Kept VOKB_SCHEMA + classifyAvailable + groupingSchema?: optional prop verbatim per checker W-1 — VOKB schema migration is explicitly deferred to a later phase. Legacy path is selected purely by groupingSchema being PROVIDED; coding tab omits it."
  - "Loading state renders nothing (return null) rather than a placeholder spinner — keeps the rail visually quiet on first paint and matches Phase 56 stability contract (no jank during fetch)."
  - "Error fallback derives flat-list classes from entities (not from the rejected response) — keeps the filter usable as a last resort even when the registry endpoint is down."
  - "L1 collapse state stored as Record<string, boolean> keyed by L1 name (not boolean-per-L1 useState) so the collapse mechanism scales to N L1 classes without code churn."
  - "Source-grep dead-code check (Test 1) implemented as a file-read assertion via fs.readFileSync(path.resolve(process.cwd(), 'src/...')) rather than an acceptance-criteria-only grep — runs inside vitest, surfaces regression to anyone re-introducing CODING_SCHEMA."

patterns-established:
  - "Dual-mode component: legacy path enabled by prop-presence, new path is default — preserves regression surface without an explicit feature flag"
  - "File-content static-assertion test pattern for verifying dead-code removal — runs in vitest using node:fs + node:path"

requirements-completed: [LOWERONTO-03]

# Metrics
duration: ~12 min
completed: 2026-06-17
---

# Phase 60 Plan 05: OntologyFilter L2 Lower-Ontology Group Rendering Summary

**Dual-mode OntologyFilter — drops CODING_SCHEMA + Typed Views; coding tab now builds L1->L2 groups from `/api/v1/ontology/classes?withDisplay=true`; VOKB tab keeps VOKB_SCHEMA legacy path verbatim**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-17T12:50:36Z
- **Completed:** 2026-06-17T13:02:32Z
- **Tasks:** 2 (Task 1 TDD: RED + GREEN; Task 2: rewire)
- **Files modified:** 4

## Accomplishments

- Phase 57's 10 L2 classes (`LiveLoggingSystem`, `ConstraintMonitor`, `KnowledgeManagement`, `BatchSemanticAnalysis`, `RapidLlmProxy`, `DockerizedServices`, `OnlineObservation`, `OnlineDigest`, `OnlineInsight`, `EtmDaemon`) now render as collapsible L2 sub-rows under their L1 parents (`Component`, `SubComponent`, `Detail`) in the coding-tab Ontology Class filter.
- Phase 55 stopgap `CODING_SCHEMA` + the `Typed Views` (LSL Pipeline / Patterns / Other) group are gone — single mental model for operators (D-16).
- L0 anchors (`System`, `Project`) sit ungrouped at the top of the filter so operators can always toggle the system root + project anchors directly (D-20).
- L1 group disclosure triangle is UI-only — clicking collapses the L2 list without mutating `selectedOntologyClasses` (D-19).
- `[all]` / `[none]` link-buttons on each L1 group operate on its L2 children with the existing union-add / filter-remove semantics (D-18).
- VOKB tab continues to render Upper Ontology + Failure Model + Lower Ontology + RaaS / KPI-FW / Business groups verbatim via the legacy `VOKB_SCHEMA` path (W-1 regression preservation).
- BC fallback honours the pre-Plan-04 server shape (string-array, no `level` fields) → flat rows.
- Error fallback (rejected fetch) → flat rows derived from distinct `entity.ontologyClass` values, surfaced via `Logger.warn`.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for OntologyFilter dual-mode rendering** — `90d0e6337` (test)
2. **Task 1 GREEN: implement dual-mode OntologyFilter** — `7ecf857cd` (feat)
3. **Task 2: rewire FilterRail OntologyFilter mount to dual-mode contract** — `f03ae81a2` (feat)

_Note: Task 1 was a TDD task — separate RED (test) and GREEN (feat) commits per the tdd-execution flow._

## Files Created/Modified

- `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` — Dropped `CODING_SCHEMA` + `Typed Views` (D-16). Added required `apiClient: ApiClient` prop. Implemented API-driven path: fetches `listOntologyClasses()` once on mount; builds L0 ungrouped rows + L1->L2 collapsible groups + L1 flat rows from the response intersected with available classes. Preserved VOKB_SCHEMA + `classifyAvailable` + the optional `groupingSchema` prop verbatim (W-1). Legacy hardcoded path renders unchanged when `groupingSchema` is provided. Added per-L1 UI-only collapse, BC fallback, error fallback, loading-as-null.
- `integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx` — Replaced the Phase 55 VOKB-vs-CODING test surface with 11 Phase 60 contract tests (D-16..D-20 + W-1 + BC + loading + error fallbacks) plus micro-type retention. Test 1 uses `fs.readFileSync` to grep the source file for the dead constants (guards against silent re-introduction).
- `integrations/unified-viewer/src/panels/FilterRail.tsx` — Replaced `CODING_SCHEMA` import with `VOKB_SCHEMA`; inverted derivation: `legacyGroupingSchema = system === 'okb' ? VOKB_SCHEMA : undefined`. Threaded `apiClient` through to the `<OntologyFilter>` mount. Coding tab now consumes the API-driven path; OKB tab pins `legacyGroupingSchema={VOKB_SCHEMA}` to keep its Upper/Lower groups (W-1).
- `integrations/unified-viewer/src/panels/FilterRail.test.tsx` — Updated the Phase 55-08 'system === "coding"' assertion to assert Typed Views / LSL Pipeline are absent and `listOntologyClasses` is called (API-driven path). Awaited the async fetch in the 'mounts OntologyFilter' Ontology-Class-header assertion (`findByText` instead of synchronous `getByText`).

## Decisions Made

- See `key-decisions` frontmatter above.
- The two most consequential are (a) keeping `VOKB_SCHEMA` and the optional `groupingSchema` prop intact per W-1 (the planner's scope guard, not a code smell to remove later in this phase), and (b) selecting the API-driven path purely by prop-absence rather than a `mode` enum — this keeps the call sites symmetric (no caller has to opt-in; the new path is the default).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] FilterRail.test.tsx Phase 55-08 'mounts OntologyFilter' assertion**
- **Found during:** Task 2 (verification)
- **Issue:** A pre-existing Phase 55 test used synchronous `screen.getByText('Ontology Class')` on the coding-tab default mount. The Phase 60 API-driven path returns `null` while the fetch is pending (intentional per Test 9 in Task 1 — no jank). The test failed because it didn't wait for the fetch to resolve.
- **Fix:** Changed `getByText` → `await findByText` and made the test `async`. The contract being tested (panel renders the group header) is unchanged; the test now correctly awaits the async render boundary.
- **Files modified:** `integrations/unified-viewer/src/panels/FilterRail.test.tsx`
- **Verification:** Test now passes; FilterRail.test.tsx 16/16, OntologyFilter.test.tsx 15/15.
- **Committed in:** `f03ae81a2` (Task 2 commit)

**2. [Rule 3 - Blocking] FilterRail.test.tsx Phase 55-08 'on system === coding' assertion**
- **Found during:** Task 2 (verification)
- **Issue:** A pre-existing Phase 55 test asserted that on `system === 'coding'`, the OntologyFilter renders `'Hierarchy'` and `'Typed Views'` group headers from `CODING_SCHEMA`. Phase 60 D-16 explicitly removes that schema.
- **Fix:** Replaced the assertion with the Phase 60 contract: `Typed Views` and `LSL Pipeline` group headers MUST be ABSENT (D-16), and `listOntologyClasses` MUST be called (API-driven path active).
- **Files modified:** `integrations/unified-viewer/src/panels/FilterRail.test.tsx`
- **Verification:** New assertion runs against the API-driven path; test passes.
- **Committed in:** `f03ae81a2` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking pre-existing tests on the file under refactor)
**Impact on plan:** Both fixes were required to land the plan; they preserve the original test intent (panel mounts; coding-vs-okb schema differentiation) under the new contract. No scope creep — both fall inside the planned `<files_modified>` set (`FilterRail.tsx` + its test).

## Issues Encountered

- The worktree initially had no `node_modules`. Symlinked `integrations/unified-viewer/node_modules` to the main repo's `node_modules` so vitest + tsc would resolve. Symlink left untracked (gitignored as the parent matches `node_modules/`).
- A broader `vitest run` of the full unified-viewer suite shows 17 failing tests across 8 files — ALL pre-existing in main, all in files NOT modified by this plan (`LayerFilter.test`, `viewer-store.test`, `SigmaCanvas.test`, `node-renderer.test`, `color-fallback.test`, `NavBar.test`, `UnifiedViewer.test`, `system-endpoints.test`). Per the SCOPE BOUNDARY rule, these are out of scope for Plan 05 and tracked separately.

## Threat Flags

None — Plan 05 only re-shapes the client-side rendering of a registry response that was already trusted. No new network endpoints, no auth-path changes, no schema changes at trust boundaries. The threat model in the PLAN already documents the two relevant threats (T-60-05-01 mitigated via error fallback; T-60-05-02 accepted as non-sensitive operator metadata).

## Verification Performed

- `npx tsc --noEmit` — exits 0
- `npx vitest run src/panels/filters/OntologyFilter.test.tsx` — 15/15 passing (Test 1 + 1b + 1c + Tests 2-10 + micro-type)
- `npx vitest run src/panels/FilterRail.test.tsx` — 16/16 passing
- `npm run build` — vite production bundle succeeds (4.77s, no errors)
- `grep -rn "CODING_SCHEMA" integrations/unified-viewer/src/` — no matches outside test docstrings (OntologyFilter.tsx source clean; runtime imports gone from FilterRail.tsx)
- `grep -nE "level === (0|1|2)" integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` — confirms L0/L1/L2 branches present (lines 457, 466, 470)
- `grep -cE "text-\[10px\]|text-\[9px\]|text-\[8px\]" integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` — returns 19 matches (micro-type tokens preserved verbatim per UI-SPEC §3)

## Next Phase Readiness

- LOWERONTO-03 SC#5 mechanics are in place: Phase 57 L2 classes render as collapsible groups under L1 parents in the coding tab; per-class count badges populated; `[all]`/`[none]` link-buttons bulk-toggle the L2 children.
- VOKB tab grouping preserved verbatim (W-1) — no regression to `/viewer/okb` Upper/Lower rendering.
- Visual smoke against `localhost:5173/viewer/coding` should now show the 10 L2 classes nested under their L1 parents instead of the old `Typed Views` group. (Smoke not run in this worktree — gsd-browser belongs to the orchestrator's verification step.)
- VOKB schema migration to API-driven path remains DEFERRED (Phase 60 deferred ideas) — this plan does NOT close that follow-up; VOKB tab still uses hardcoded VOKB_SCHEMA.

## Self-Check: PASSED

Verified the following claims:

- File `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` exists at the worktree path.
- File `integrations/unified-viewer/src/panels/filters/OntologyFilter.test.tsx` exists at the worktree path.
- File `integrations/unified-viewer/src/panels/FilterRail.tsx` exists at the worktree path.
- File `integrations/unified-viewer/src/panels/FilterRail.test.tsx` exists at the worktree path.
- File `.planning/phases/60-unified-viewer-rendering-ux-integrity/60-05-SUMMARY.md` exists at the worktree path (this file).
- Commit `90d0e6337` (RED) exists on HEAD.
- Commit `7ecf857cd` (GREEN) exists on HEAD.
- Commit `f03ae81a2` (Task 2 rewire) exists on HEAD.

---

*Phase: 60-unified-viewer-rendering-ux-integrity*
*Completed: 2026-06-17*
