---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 04
subsystem: ui
tags: [zustand, react, store, vokb-parity, filters, ring-buffer, etm, lsl, hierarchy]

# Dependency graph
requires:
  - phase: 45-unified-viewer-foundation
    provides: "Zustand store baseline with selectedNodeId/Edge, searchQuery, visibleLevels, selectedClasses Set, theme, filterRailCollapsed slices + actions"
provides:
  - "Extended viewer-store.ts with 7 VOKB filtersSlice fields (selectedLayers, selectedDomains, selectedOntologyClasses, showEdges, showClusters, showRelationLabels, showMergedOnly, hideDocNodes)"
  - "Mode slice (mode: 'kg' | 'triage' with setMode)"
  - "Trends slice (trendingPatterns: TrendingPattern[] with setTrendingPatterns)"
  - "ETM live-tail slice (etmObservations ring buffer max 100, etmStreamConnected, etmSheetOpen)"
  - "Hierarchy + LSL slices (hierarchySubtreeFilter, lslSessionFilter with idempotent multi-select add)"
  - "Inline TrendingPattern interface co-located with the store"
  - "ETM_OBSERVATION_RING_BUFFER_MAX constant export (100)"
  - "ViewerMode type export ('kg' | 'triage')"
affects:
  - 55-05 (renderer — node program reads showEdges, showRelationLabels)
  - 55-06 (TrendingPanel — reads trendingPatterns)
  - 55-07 (StatsBar/Mode toggle — reads mode, setMode)
  - 55-08 (LayerFilter — reads selectedLayers, toggleLayer)
  - 55-09 (DomainFilter — reads selectedDomains, toggleDomain)
  - 55-10 (TriageView — reads mode === 'triage')
  - 55-11 (HierarchyNavigator — reads hierarchySubtreeFilter)
  - 55-12 (EtmTailSheet — reads etmObservations, pushObservation)
  - 55-13 (LSL session filter UI — reads lslSessionFilter)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VOKB Redux → Zustand slice translation (action-name parity for portability)"
    - "Empty-array filter semantic ([] = 'all visible', consumer interprets)"
    - "Ring-buffer push via [obs, ...prev].slice(0, MAX)"
    - "Idempotent multi-select add (no duplicate guard)"
    - "Inline shared type co-located with single consumer until widening"
    - "Zustand v5 getInitialState() for fresh-factory assertions in TDD"

key-files:
  created: []
  modified:
    - "integrations/unified-viewer/src/store/viewer-store.ts"
    - "integrations/unified-viewer/src/store/viewer-store.test.ts"

key-decisions:
  - "Retained Phase 45 selectedClasses Set (+ toggleClass / setSelectedClasses) as a BC shim instead of removing the field — removal would compile-break 7+ files outside files_modified scope (FilterRail.tsx, UnifiedViewer.tsx, graph-builder.ts, SigmaCanvas.test.tsx, FilterRail.test.tsx, EntityDetailPanel.test.tsx, MarkdownViewerPanel.test.tsx, useKeyboardShortcuts.test.tsx) and violate the plan-level `tsc --noEmit → exit 0` gate. Plan 55-08 retires the shim when OntologyFilter replaces FilterRail's flat ClassList. Tests reflect this via a positive BC-shim assertion in place of the NEGATIVE 'not-on-state' case."
  - "Used Zustand v5 getInitialState() (vanilla.d.ts:12) for initial-state assertions in viewer-store.test.ts. setState seeding in beforeEach silently passes initial-state checks even before the store factory wires the new fields — getInitialState() reads the store-creator output directly, which is the only way to guarantee a meaningful RED phase."
  - "Inlined TrendingPattern interface in viewer-store.ts rather than importing from a shared module — only consumer for now. Plan 55-06 can extract to a shared types module when StatsBar / trends endpoint widens the surface."
  - "Exported ETM_OBSERVATION_RING_BUFFER_MAX as a named const so the 55-12 EtmTailSheet can reference the same cap in its UI hint text without re-encoding the magic number."

patterns-established:
  - "VOKB Redux → Zustand action-name parity: `toggleLayer`, `toggleDomain`, `toggleOntologyClass`, `setSelectedOntologyClasses`, `toggleShow*` mirror filtersSlice.ts exactly so future cross-repo source moves are mechanical."
  - "Empty-array = 'all visible' semantic in the store; consumers (renderer, FilterRail) interpret emptiness. The store NEVER pre-seeds with 'all known values' — this preserves the VOKB invariant per UI-SPEC §10."
  - "Ring-buffer push: `[newItem, ...prev].slice(0, MAX)` is the canonical Zustand idiom for newest-first capped queues; deterministic, side-effect-free, no per-call cost beyond Array.slice."
  - "BC shim policy at wave boundaries: when a wave-1 plan introduces a renamed field, the previous field stays as a deprecation shim until the wave-N plan that owns the replacement UI retires it (avoids cross-wave merge conflicts on shared types)."

requirements-completed: [UI-02]

# Metrics
duration: 10min
completed: 2026-06-09
---

# Phase 55 Plan 04: Zustand store extension for VOKB filter / mode / ETM / hierarchy / LSL slices

**Zustand store now exposes 7 VOKB filtersSlice fields, mode toggle, trends cache, ETM ring-buffer + connection state, and coding-only hierarchy / LSL multi-select — unblocking 9 wave-2+ consumer plans without further store shape changes.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-09T14:52:07Z
- **Completed:** 2026-06-09T15:02:03Z
- **Tasks:** 2 (both TDD, RED + GREEN gates committed)
- **Files modified:** 2

## Accomplishments

- Extended `ViewerState` with 18 new fields and 16 new action setters covering all VOKB filtersSlice parity, mode, trends, ETM tail, hierarchy navigator and LSL session multi-select
- Hard-capped ETM observation ring buffer at 100 entries (T-55-04-01 mitigation) with newest-first push semantics
- Preserved 100% of Phase 45 store BC (218/218 tests across 26 files still green, including pre-existing FilterRail / SigmaCanvas / graph-builder / UnifiedViewer suites)
- VOKB Redux action-name parity established so future source moves between repos are mechanical
- 33 store unit tests (5 Phase 45 BC + 13 Phase 55 initial-state + 15 Phase 55 actions) — all green
- Acceptance greps pass: 0 raw `console.*` in store, 16 hits on the 8-action expected-presence regex
- `npx tsc --noEmit` exit 0 across the entire `integrations/unified-viewer` package

## Task Commits

Each task was committed atomically following the TDD RED → GREEN cycle:

1. **Task 1 + 2 (RED):** add failing tests for VOKB filter/mode/coding store slices — `8003d87a7` (test)
2. **Task 1 + 2 (GREEN):** extend Zustand store with VOKB filter/mode/coding slices — `f1e042f9f` (feat)

_Note: Both Task 1 (state shape / initial values) and Task 2 (action setters) implementations are in the same GREEN commit because both `<verify>` blocks reference the SAME test file (`viewer-store.test.ts`) and the same store implementation file — splitting them would have left the test file in a partially-passing state between commits with no isolation benefit. Both tasks' `<behavior>` cases are individually present in the test file and traceable._

REFACTOR phase: skipped — code structure is already grouped by slice (Phase 45 baseline, VOKB filtersSlice parity, mode, trends, ETM, hierarchy/LSL) with descriptive section headers; no cleanup pass was required.

## Files Created/Modified

- `integrations/unified-viewer/src/store/viewer-store.ts` (modified) — extended `ViewerState` interface and store factory with 18 new fields + 16 new actions; preserved all Phase 45 baseline; added `TrendingPattern` interface, `ViewerMode` type alias, `ETM_OBSERVATION_RING_BUFFER_MAX` constant export
- `integrations/unified-viewer/src/store/viewer-store.test.ts` (modified) — appended 28 new Phase 55 test cases (13 initial-state + 15 action), kept the 5 Phase 45 baseline cases verbatim; introduced the `getInitialState()` pattern for fresh-factory assertions

## Decisions Made

- **BC-shim retention of `selectedClasses` Set:** The plan's `<behavior>` Task 1 included a NEGATIVE assertion (`selectedClasses` MUST NOT be on state) but the plan-level verification requires `tsc --noEmit → exit 0`, and 7 files outside `files_modified` consume `selectedClasses` / `toggleClass` / `setSelectedClasses`. Removing the field outright would have broken compilation immediately and required modifying files the plan-author explicitly fenced off. The pragmatic resolution: keep the Set field + its two actions as a BC shim, document the deviation, and let Plan 55-08 retire them when OntologyFilter replaces FilterRail's flat ClassList (Plan 55-08's `depends_on: [55-04]` confirms it owns the replacement surface).
- **`getInitialState()` for RED-phase isolation:** initial test draft used `beforeEach + useViewerStore.setState({...new fields...})` which Zustand v5 accepts as untyped keys and so the initial-state assertions passed BEFORE the store factory was modified — a stuck RED phase per the TDD doc's fail-fast rule. Switched to `useViewerStore.getInitialState()` (zustand v5 vanilla.d.ts:12) which reads the store-creator output, making the absent-field cases properly fail before GREEN.
- **Inline `TrendingPattern` over shared module:** The interface lives in `viewer-store.ts` next to its single current consumer (the `trendingPatterns` slice setter). Plan 55-06 owns the trends API surface and can extract this to a shared types module when StatsBar lands and a second consumer appears.
- **Exported `ETM_OBSERVATION_RING_BUFFER_MAX` constant:** so EtmTailSheet (55-12) and any test fixture can reference `import { ETM_OBSERVATION_RING_BUFFER_MAX }` rather than re-encoding `100`. This makes the cap traceable to a single source per UI-SPEC §13.3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Replaced NEGATIVE `selectedClasses`-not-on-state assertion with a BC-shim presence assertion**

- **Found during:** Task 1 RED phase, while preparing the failing tests
- **Issue:** The plan's `<behavior>` for Task 1 included `Test: NEGATIVE — selectedClasses (the OLD Set field) is NOT on state (TS-level + runtime Object.hasOwn check)`. Implementing it as written required removing the `selectedClasses` field from `ViewerState`. But:
  - 7 files outside the plan's `files_modified` scope reference `selectedClasses` / `toggleClass` / `setSelectedClasses`: `panels/FilterRail.tsx`, `panels/FilterRail.test.tsx`, `panels/MarkdownViewerPanel.test.tsx`, `panels/EntityDetailPanel.test.tsx`, `graph/SigmaCanvas.test.tsx`, `graph/graph-builder.ts`, `graph/graph-builder.test.ts`, `routes/UnifiedViewer.tsx`, `hooks/useKeyboardShortcuts.test.tsx`
  - The plan-level verification block requires `npx tsc --noEmit → exit 0` — removing the field would fail tsc immediately on 50+ usages
  - The plan's must_have truths state "Existing Phase 45 store state and actions are unchanged (BC)" which conflicts with the removal
  - Plan 55-08 (`depends_on: [55-04]`, wave 3) owns the FilterRail.tsx replacement that retires `selectedClasses` cleanly
- **Fix:** Kept `selectedClasses: Set<string>`, `toggleClass`, `setSelectedClasses` in the store as a BC shim. Replaced the NEGATIVE assertion in the test file with a positive `expect(initial().selectedClasses).toBeInstanceOf(Set)` assertion that documents the shim's intentional presence and references this SUMMARY for the deviation rationale.
- **Files modified:** `integrations/unified-viewer/src/store/viewer-store.ts`, `integrations/unified-viewer/src/store/viewer-store.test.ts`
- **Verification:** Full suite `npx vitest run` → 218/218 green across 26 files; `npx tsc --noEmit` exit 0; `grep -c "selectedClasses" integrations/unified-viewer/src/` confirms downstream callers still compile against the shim
- **Committed in:** `f1e042f9f` (the GREEN commit)

**2. [Rule 3 — Blocking issue] Switched initial-state assertions to `getInitialState()` to recover the RED phase**

- **Found during:** Task 1 RED phase, on first test run
- **Issue:** Initial RED-phase test draft used `beforeEach + useViewerStore.setState({all-new-fields-here})` to reset state between tests. Zustand v5 accepts arbitrary keys on `setState` (it's `Partial<State>`-typed but does not validate against the type at runtime), so the initial-state cases all PASSED before any store code was changed — a stuck RED that the TDD doc explicitly flags as "STOP. The feature may already exist or the test is not testing what you think."
- **Fix:** Switched the Task 1 `describe` block to call `useViewerStore.getInitialState()` (Zustand v5, `node_modules/zustand/vanilla.d.ts:12`) which returns the FRESH store-creator snapshot rather than whatever a prior `setState` wrote. This makes the absent-field assertions properly fail before GREEN. The Task 2 action-setter `describe` block keeps the `beforeEach + setState` pattern because it tests action effects, which require a known starting state.
- **Files modified:** `integrations/unified-viewer/src/store/viewer-store.test.ts`
- **Verification:** Re-ran tests after the switch — 11/13 initial-state cases failed (RED confirmed), 2 BC cases passed (Phase 45 fields seeded by setState still present). After GREEN: all 13 pass.
- **Committed in:** `8003d87a7` (the RED commit)

**3. [Rule 2 — Missing critical functionality] Combined Task 1 + Task 2 implementation into a single GREEN commit**

- **Found during:** Planning the GREEN commit
- **Issue:** The plan structured Tasks 1 and 2 as two TDD cycles ("Task 1 does NOT add action implementations — that's Task 2"). But both `<verify>` blocks target the same `viewer-store.test.ts` file and the same `viewer-store.ts` implementation. Splitting GREEN into two commits would have required either: (a) implementing Task 1 GREEN with the action signatures present but bodies stubbed to throw, then a Task 2 GREEN to fill them in — which would leave the codebase in a half-working state between commits — or (b) running only the initial-state tests in commit-1 and pretending the action tests don't exist, then running them in commit-2.
- **Fix:** Committed the RED phase covering BOTH tasks' `<behavior>` cases in one `test(55-04):` commit and the GREEN phase covering both implementations in one `feat(55-04):` commit. The commit messages enumerate the slices and actions delivered per task explicitly so traceability is preserved.
- **Files modified:** none beyond the standard plan files
- **Verification:** Each task's `<verify>` automated command was run (separately) against the GREEN commit and both passed
- **Committed in:** `f1e042f9f` (the GREEN commit) + `8003d87a7` (the RED commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 2 commit-structure)
**Impact on plan:** All three deviations preserve plan intent (slice shape, action surface, BC, ring-buffer cap, VOKB action-name parity, zero-console discipline). None introduce new public surface or runtime behavior beyond what the plan specifies. The BC-shim retention is the only material delta from the plan author's stated removal intent — it is deferred to Plan 55-08 which owns the replacement UI and will retire the shim cleanly.

## Issues Encountered

None beyond the deviations documented above. The pre-baseline `npm install` for `integrations/unified-viewer` was needed because the worktree starts without `node_modules`; subsequent test runs and tsc passes were uneventful.

## User Setup Required

None — no external service configuration required. All changes are in-process Zustand store state.

## Next Phase Readiness

Wave 2+ consumer plans (55-05 through 55-13) can now mount selector hooks against:

- `useViewerStore((s) => s.selectedLayers)` / `s.toggleLayer` (55-08 LayerFilter)
- `useViewerStore((s) => s.selectedDomains)` / `s.toggleDomain` (55-09 DomainFilter)
- `useViewerStore((s) => s.selectedOntologyClasses)` / `s.toggleOntologyClass` / `s.setSelectedOntologyClasses` (55-08 OntologyFilter)
- `useViewerStore((s) => s.showEdges)` / `s.toggleShowEdges` (55-05 renderer)
- `useViewerStore((s) => s.mode)` / `s.setMode` (55-07 NavBar mode toggle, 55-10 TriagePlaceholder)
- `useViewerStore((s) => s.trendingPatterns)` / `s.setTrendingPatterns` (55-06 TrendingPanel)
- `useViewerStore((s) => s.etmObservations)` / `s.pushObservation` / `s.etmStreamConnected` / `s.etmSheetOpen` (55-12 EtmTailSheet + SSE consumer)
- `useViewerStore((s) => s.hierarchySubtreeFilter)` / `s.setHierarchySubtreeFilter` (55-11 HierarchyNavigator)
- `useViewerStore((s) => s.lslSessionFilter)` / `s.setLslSessionFilter` / `s.addLslSessionFilter` / `s.clearLslSessionFilter` (55-13 LSL session multi-select)

The single outstanding concern for downstream plans is the `selectedClasses` BC shim — Plan 55-08 should plan to remove it (and its three actions) as part of the OntologyFilter mount, at which point downstream FilterRail / SigmaCanvas / graph-builder / UnifiedViewer / their tests can also migrate to `selectedOntologyClasses` in one atomic shift.

## Self-Check: PASSED

Verification of claims in this summary:

```
FOUND: integrations/unified-viewer/src/store/viewer-store.ts
FOUND: integrations/unified-viewer/src/store/viewer-store.test.ts
FOUND: commit 8003d87a7 (RED — test)
FOUND: commit f1e042f9f (GREEN — feat)
GREP CHECK: console.* in store file = 0 (success criterion met)
GREP CHECK: action-presence regex = 16 hits (≥8 required, success criterion met)
TEST RUN: 33/33 store tests green
SUITE RUN: 218/218 unified-viewer tests green across 26 files
TSC CHECK: npx tsc --noEmit exit 0
```

---
*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Completed: 2026-06-09*
