---
phase: 71-experiment-kb-task-taxonomy
plan: 01
subsystem: knowledge-management
tags: [km-core, ontology, experiment-kb, GraphKMStore, performance-measurement]

# Dependency graph
requires:
  - phase: 38-ontology-registry
    provides: km-core OntologyRegistry (meta+classes shape, isValidClass, extends-merge)
  - phase: 37-km-core-foundation
    provides: GraphKMStore (dedicated dbPath/exportDir/ontologyDir construction)
provides:
  - "openExperimentStore() — the single dedicated experiment km-core store factory (D-01)"
  - "Standalone experiment ontology with all 7 classes (Experiment/Run/Route/Step/Decision/Outcome/Report) (D-02, KB-01)"
  - "Live entityType validation: store.ontology.isValidClass('Run') === true (SC-1)"
affects: [71-04-run-write, 71-05-query-classify-CLIs, 72-route-metrics, 74-performance-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dedicated second km-core store with isolated ontologyDir (upper.json copy + lower ontology)"
    - "Explicit repoRoot override on the store factory for hermetic, env-race-free tests"

key-files:
  created:
    - .data/ontologies-experiment/upper.json
    - .data/ontologies-experiment/experiment-ontology.json
    - lib/experiments/store.mjs
    - tests/experiments/ontology.test.mjs
  modified:
    - .gitignore

key-decisions:
  - "Experiment ontology authored ONLY in km-core meta+classes shape; never the legacy name/version/type/entities shape (Pitfall 2)"
  - "ontologyDir points at the standalone .data/ontologies-experiment/, NOT the shared .data/ontologies/ nor the km-core package dir (D-02)"
  - "Dedicated dbPath at .data/experiments/leveldb, separate from the shared .data/knowledge-graph/ store (D-01)"
  - "Added openExperimentStore({repoRoot}) override so tests open isolated stores without racing on the process-global CODING_REPO env var"

patterns-established:
  - "Pattern 1: every experiment CLI opens via openExperimentStore() — never new GraphKMStore inline — guaranteeing the mandatory ontologyDir (CLAUDE.md km-core rule)"
  - "Pattern 2: isolated-store test harness copies the REAL ontology dir into a tmp repoRoot, throwaway leveldb, stderr-captured for skip-warn assertion"

requirements-completed: [KB-01]

# Metrics
duration: 14min
completed: 2026-06-23
---

# Phase 71 Plan 01: Experiment Store & Ontology Foundation Summary

**Created the dedicated experiment km-core store (`openExperimentStore()`) and the standalone 7-class experiment ontology that loads into a live OntologyRegistry where `isValidClass('Run')` is true — the foundation every later Phase 71 plan consumes.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 4 completed
- **Files created:** 4
- **Files modified:** 1

## Accomplishments
- Authored `.data/ontologies-experiment/experiment-ontology.json` in the km-core `meta`+`classes` shape with exactly 7 classes (Experiment, Run, Route, Step, Decision, Outcome, Report); Run carries the 8-tag property set incl. the `taskClass` enum (closed-6 + `unclassified`) and Outcome carries the `closedState` enum (`closed`/`quarantined`).
- Copied `upper.json` verbatim into the dedicated ontology dir (km-core's `OntologyRegistry.loadFromDisk` requires it) — `cmp` byte-identical.
- Built `openExperimentStore()` as the single dedicated-store factory with the mandatory explicit `ontologyDir` (CLAUDE.md acceptance grep) pointing at `.data/ontologies-experiment/` and `dbPath` at `.data/experiments/leveldb` (D-01).
- Proved SC-1 with a 3-case `node:test` suite: registry is live (not noop), all 7 classes valid via the real `isValidClass` accessor (plus a negative control), and no `skipping malformed ontology file` warning on load (Pitfall 2 guard).
- Gitignored the single-owner LevelDB binary while keeping exports + ontology JSONs committable.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dedicated experiment ontology dir (upper copy + experiment-ontology.json)** — `bf9db82db` (feat)
2. **Task 2: openExperimentStore() factory** — `84b831d75` (feat)
3. **Task 3: ontology.test.mjs (SC-1 proof) + repoRoot test seam** — `bac546ee9` (test)
4. **Task 4: gitignore experiment leveldb** — `91a8e5986` (chore)

_Note: Task 3 (tdd="true") — the implementation under test (store.mjs + ontology) was committed in Tasks 1-2; the test commit also carries the Rule 3 `repoRoot` blocking-fix that made the test hermetic._

## Files Created/Modified
- `.data/ontologies-experiment/upper.json` — verbatim copy of the upper ontology (km-core loader requirement)
- `.data/ontologies-experiment/experiment-ontology.json` — the 7 experiment classes in km-core meta+classes shape, extends upper (Feature/Revision/Process/Contract)
- `lib/experiments/store.mjs` — `openExperimentStore()`, the single dedicated-store factory with mandatory `ontologyDir`
- `tests/experiments/ontology.test.mjs` — SC-1 proof (7 classes load, registry live, no skip-warn)
- `.gitignore` — ignore `.data/experiments/leveldb/`; keep exports + ontology tracked

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `repoRoot` override to `openExperimentStore()` for hermetic tests**
- **Found during:** Task 3
- **Issue:** The original plan-text test isolation strategy mutated `process.env.CODING_REPO` to point at a tmpdir before each `openExperimentStore()` call. `process.env` is process-global; with three sequential `node:test` cases each setting/restoring it around an async open, the store's km-core `OntologyRegistry` (constructed synchronously inside `open()`) read a stale/other-test repo root, producing `ENOENT … <other-tmp>/.data/ontologies-experiment/upper.json` and failing 2 of 3 tests.
- **Fix:** Added an optional `opts.repoRoot` parameter to `openExperimentStore()` (defaults to `process.env.CODING_REPO` then the canonical path — production behavior unchanged). The test now passes `{ repoRoot: tmp }` explicitly, eliminating the shared-env race. This also strengthens the factory's testability for 71-04/71-05.
- **Files modified:** `lib/experiments/store.mjs`, `tests/experiments/ontology.test.mjs`
- **Commit:** `bac546ee9`

## Verification

- `node -e` ontology shape check: 7 classes present, meta+classes shape, no legacy `entities` key — PASS
- `cmp` upper.json byte-identical to source — PASS
- `grep -v '^\s*//' lib/experiments/store.mjs | grep -c ontologyDir` ≥ 1 (mandatory CLAUDE.md grep) — PASS
- `node --test tests/experiments/ontology.test.mjs` exits 0, all 3 SC-1 assertions pass — PASS
- `git check-ignore` confirms leveldb ignored, ontology JSONs committable — PASS
- No `console.*` in store.mjs or the test; no `--live` argv gate (none needed) — PASS

## TDD Gate Compliance

Task 3 (`tdd="true"`) is a test that proves an already-built artifact (the ontology + factory from Tasks 1-2). Per the plan's task ordering the implementation precedes the test commit; the suite was run and confirmed GREEN (exit 0, 3/3) before the `test(...)` commit. No standalone RED phase was applicable because the artifacts under test are the deliverables of Tasks 1-2, not net-new behavior introduced in Task 3.

## Known Stubs

None that block KB-01. The Route/Step/Decision/Report classes are intentionally schema-only stubs (empty `properties`, populated in Phases 72-74 per the ontology `description` fields and D-12) — documented in the ontology itself, not silent placeholders.

## Self-Check: PASSED

- `.data/ontologies-experiment/upper.json` — FOUND
- `.data/ontologies-experiment/experiment-ontology.json` — FOUND
- `lib/experiments/store.mjs` — FOUND
- `tests/experiments/ontology.test.mjs` — FOUND
- `.gitignore` (modified) — FOUND
- Commit `bf9db82db` — FOUND
- Commit `84b831d75` — FOUND
- Commit `bac546ee9` — FOUND
- Commit `91a8e5986` — FOUND
