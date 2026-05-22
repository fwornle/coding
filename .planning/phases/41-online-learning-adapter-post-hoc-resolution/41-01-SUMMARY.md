---
phase: 41-online-learning-adapter-post-hoc-resolution
plan: 01
subsystem: ontology

tags: [km-core, ontology, learning-artifact, observation, digest, insight, phase-38-onto-02, extends-chain]

# Dependency graph
requires:
  - phase: 38-ontology-registry
    provides: "OntologyRegistry auto-discovery (ONTO-01) + extends + property merging (ONTO-02); upper.json mandatory + filename hardcoded; parentChainOf returns ResolvedClass[]"
provides:
  - "Live /Users/Q284340/Agentic/km-core/ontology/ directory (separate from tests/fixtures/ontology/)"
  - "ontology/upper.json declaring LearningArtifact abstract upper with shared properties (id, project, createdAt, validFrom, validUntil, quality)"
  - "ontology/learning-artifacts.json declaring Observation/Digest/Insight lowers; each extends LearningArtifact; Digest+Insight declare aggregates predicate"
  - "Vitest spec proving registry resolves LearningArtifact, Observation, Digest, Insight, and that ONTO-02 property merging works end-to-end on the new files"
affects: [41-02, 41-03, 41-04, 41-05, 41-06, 41-07, 42, 43]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Live ontology dir at km-core package root (distinct from tests/fixtures/ontology/) — first time the live dir is populated; registry's hardcoded 'upper.json' filename anchors discovery"
    - "Aggregation predicates as graph-edge relationships (parent→child), not class-hierarchy entries — 'aggregates' chosen over derivedFrom/summarizes per D-48 Claude's discretion"
    - "LearningArtifact axis orthogonal to architectural ontology (System/Component/Pipeline/etc.) — PIPE-02 scans the two axes via separate explicit invocations"
    - "parentChainOf.some(rc => rc.name === ...) assertion idiom — chain returns ResolvedClass[] not string[]; canonical correction for downstream plans"

key-files:
  created:
    - "/Users/Q284340/Agentic/km-core/ontology/upper.json (live upper — LearningArtifact axis)"
    - "/Users/Q284340/Agentic/km-core/ontology/learning-artifacts.json (Observation/Digest/Insight lowers extending LearningArtifact)"
    - "/Users/Q284340/Agentic/km-core/tests/unit/ontology-learning-artifacts.test.ts (7 vitest tests)"
  modified: []

key-decisions:
  - "Single live upper.json with one class (LearningArtifact) — registry hardcodes the filename so the LearningArtifact upper class must live INSIDE upper.json, not a separate learning-artifacts-upper.json"
  - "Aggregation edge predicate name = 'aggregates' (single direction, parent→child) — picked from candidates {aggregates, derivedFrom, summarizes} per D-48; matches existing OKM upper-ontology verb style (CONTAINS/PRODUCED_BY)"
  - "Provenance NOT declared as an ontology property — provenance lives on Entity.metadata.provenance (Phase 39 D-30) and is structurally outside the ontology schema; CONTEXT.md's D-48 property list mentioned provenance but the plan body correctly omitted it"
  - "Property merging proven via Test G — Observation's resolved properties contain both createdAt (from LearningArtifact upper) AND summary (declared on Observation lower); confirms Phase 38 ONTO-02 end-to-end"
  - "Test file resolves live ontology dir via path.resolve(import.meta.dirname, '..', '..', 'ontology') — matches the existing tests/unit/ontology-registry.test.ts FIXTURE_DIR pattern under Node 22+ ESM"

patterns-established:
  - "TDD verification-style plan: when the production artifact IS a config file, Task 1 ships the artifact and Task 2 writes the test that asserts the artifact's contract. RED→GREEN inversion is acceptable for declarative artifacts."
  - "Multi-repo execution: feat/test commits land in sibling km-core repo via git -C /Users/Q284340/Agentic/km-core; SUMMARY.md commit lands in coding repo. Orchestrator updates STATE.md/ROADMAP.md after plan completes."

requirements-completed:
  - INT-01
  - PIPE-02

# Metrics
duration: ~5min
completed: 2026-05-22
---

# Phase 41 Plan 01: Ontology — LearningArtifact upper + Observation/Digest/Insight lowers Summary

**Live km-core/ontology/ directory created with LearningArtifact upper class + 3 lowers (Observation/Digest/Insight) extending it, plus 7 vitest tests proving Phase 38 OntologyRegistry auto-discovers them and resolves the extends chain.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-22 (execution kickoff)
- **Completed:** 2026-05-22
- **Tasks:** 2 of 2
- **Files modified:** 0
- **Files created:** 3 (2 ontology JSON in km-core + 1 vitest spec in km-core)

## Accomplishments

- Created the live `/Users/Q284340/Agentic/km-core/ontology/` directory (previously only `tests/fixtures/ontology/` existed under the package root); this is the directory the OntologyRegistry's hardcoded discovery path (`registry.ts:65` `join(ontologyDir, 'upper.json')`) targets.
- Landed `ontology/upper.json` declaring the abstract `LearningArtifact` class with the six shared properties from D-48 (`id`, `project`, `createdAt`, `validFrom`, `validUntil`, `quality`); intentionally excluded `provenance` because that lives on `Entity.metadata.provenance` per Phase 39 D-30, not the ontology schema.
- Landed `ontology/learning-artifacts.json` (`meta.extends: "upper"`) declaring three lowers — `Observation`, `Digest`, `Insight` — each with `extends: "LearningArtifact"`, tier-specific properties, and (for Digest/Insight) `relationships.aggregates` pointing at the child tier.
- Wrote `tests/unit/ontology-learning-artifacts.test.ts` (7 tests A-G) that constructs an `OntologyRegistry` against the live `ontology/` directory and asserts: registry non-empty, all four classes valid, `parentChainOf('Observation')` includes the `LearningArtifact` `ResolvedClass`, both aggregation predicates resolve, and Phase 38 ONTO-02 property merging works (Observation's resolved properties contain BOTH `createdAt` from LearningArtifact AND `summary` from Observation).
- Full km-core vitest suite went from 153 → 160 passing (exactly +7 — zero regressions in Phase 37/38/39/40 tests).

## Task Commits

Each task was committed atomically in the **km-core** sibling repo:

1. **Task 1: Create live ontology/ dir + upper.json + learning-artifacts.json** — `5c27334` (feat) in km-core
2. **Task 2: Add unit tests proving auto-discovery + extends chain** — `c99d300` (test) in km-core

**Plan metadata (this SUMMARY):** committed in the coding orchestrator repo as `docs(41-01)`.

_Note: This plan's "TDD" task (Task 2) did not follow a true RED→GREEN cycle because the production artifact (the JSON files) is declarative and was shipped in Task 1 — see Deviations._

## Files Created/Modified

All created files; nothing modified.

- `/Users/Q284340/Agentic/km-core/ontology/upper.json` — Live upper containing only the `LearningArtifact` abstract class.
- `/Users/Q284340/Agentic/km-core/ontology/learning-artifacts.json` — Lower containing `Observation` / `Digest` / `Insight`, each `extends: LearningArtifact`; `Digest.relationships.aggregates: ["Observation"]`; `Insight.relationships.aggregates: ["Digest"]`.
- `/Users/Q284340/Agentic/km-core/tests/unit/ontology-learning-artifacts.test.ts` — 7-test vitest spec covering auto-discovery, extends chain, aggregation predicates, and property merging.

## Decisions Made

1. **Single live `upper.json`** — Per the Plan's KEY ANOMALY note (line 104 of 41-01-PLAN.md) the registry hardcodes `'upper.json'` as the upper filename via `registry.ts:65`, so the `LearningArtifact` class must live inside `upper.json` (not a separate `learning-artifacts-upper.json` as some 41-PATTERNS.md prose suggested). Selected `upper.json` per the plan body's explicit override.
2. **Aggregation predicate name = `aggregates`** — D-48 left this to Claude's discretion among `{aggregates, derivedFrom, summarizes}`. Selected `aggregates` because it matches the verb style of the existing OKM upper-ontology relationships (`CONTAINS`, `PRODUCED_BY`) and reads naturally as "parent aggregates children" (Digest aggregates Observation; Insight aggregates Digest). Single direction only — no reverse `derivedFrom` predicate added.
3. **No `provenance` property in `LearningArtifact`** — CONTEXT.md D-48 listed `provenance` among the shared upper properties, but Phase 39 D-30 establishes that provenance lives on `Entity.metadata.provenance`, structurally outside the ontology class definitions. The plan body's property list (lines 125-126) correctly omitted `provenance`; followed the plan body.
4. **Test file resolves live ontology dir via `path.resolve(import.meta.dirname, '..', '..', 'ontology')`** — Matches the existing `tests/unit/ontology-registry.test.ts` FIXTURE_DIR pattern at line 46. Node 22+ ESM `import.meta.dirname` is available per `package.json` `engines: ">=22"`.

## Deviations from Plan

### TDD cycle note (informational, not a code deviation)

Task 2 was marked `tdd="true"` but the production artifact (the JSON ontology files) is declarative and was shipped in Task 1, BEFORE the tests. In a strict TDD cycle, this would trip the gate ("If a test passes unexpectedly during the RED phase, STOP"). However, this is a verification-style plan where the test file ITSELF is the new behavior being added in Task 2 — the tests assert that the artifact already on disk satisfies the contract.

**Resolution:** Wrote the tests as designed; they passed on first run (160 passing total, 153 baseline + 7 new). Recorded as a meta-note in TDD Gate Compliance below rather than aborting execution.

### Pre-existing fixture-dir uniqueness caveat (informational, no action taken)

The existing `tests/fixtures/ontology/upper.json` has `meta.name: "upper"`. The new live `ontology/upper.json` also has `meta.name: "upper"`. These two files live in different directories — no registry instance reads both at once — so no collision warning fires. Verified by running the full vitest suite: the only "redefined" warnings are pre-existing (Pipeline class redefined upper → coding from the fixtures-dir tests, unchanged from baseline).

### No auto-fixed issues (Rules 1-3 not triggered)

The plan executed exactly as written. No bugs, missing critical functionality, or blocking issues were discovered. No architectural decisions (Rule 4) were needed.

---

**Total deviations:** 0 auto-fixed (TDD-cycle note + fixture-dir caveat are informational only)
**Impact on plan:** None — plan executed as written; tests pass on first run.

## TDD Gate Compliance

- RED gate: `test(41-01): ...` commit `c99d300` exists. ✓
- GREEN gate: `feat(41-01): ...` commit `5c27334` exists (CHRONOLOGICALLY before the test commit — see TDD cycle note above; the production "code" is the JSON artifact, not implementation logic). ✓
- REFACTOR: not applicable (declarative artifacts).

**Note on gate sequence:** For declarative-artifact tasks like this one, the GREEN commit naturally precedes the RED commit because the test asserts the artifact's shape rather than driving its implementation. Documented as a known acceptable pattern for ontology / config / fixture plans.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 41-02 onward:** can now reference `LearningArtifact` / `Observation` / `Digest` / `Insight` in code that consumes the registry. PIPE-02's default `resolveEntities({ classes: ['LearningArtifact'] })` branch can walk the registry chain to find all three subclasses.
- **Phase 42 (INT-02 B-migration):** the live `ontology/` directory now exists, so when B's wave-controller is wired against KM-Core it can target the same registry without scaffolding the directory.
- **Phase 43 (INT-03 C-migration):** identical readiness signal.
- No blockers or concerns.

## Self-Check: PASSED

Verified before writing this section:

1. **Files exist:**
   - `/Users/Q284340/Agentic/km-core/ontology/upper.json` — FOUND
   - `/Users/Q284340/Agentic/km-core/ontology/learning-artifacts.json` — FOUND
   - `/Users/Q284340/Agentic/km-core/tests/unit/ontology-learning-artifacts.test.ts` — FOUND
2. **Commits exist in km-core:**
   - `5c27334` (Task 1, feat) — FOUND via `git -C /Users/Q284340/Agentic/km-core log --oneline -3`
   - `c99d300` (Task 2, test) — FOUND
3. **Must-haves.truths verified:**
   - JSON files parse (`node -e "JSON.parse(...)"` returned `OK`). ✓
   - Registry construction finds `LearningArtifact`, `Observation`, `Digest`, `Insight` (Tests B + C pass). ✓
   - Observation/Digest/Insight declare `extends: 'LearningArtifact'` and inherit via ONTO-02 (Test G proves merging). ✓
   - Digest declares `aggregates: ['Observation']`, Insight declares `aggregates: ['Digest']` (Tests E + F pass). ✓
4. **Acceptance grep counts:** `"extends": "LearningArtifact"` = 3 (✓); `"aggregates"` = 2 (✓); `meta.name` of upper = `"upper"` (✓); `meta.extends` of lower = `"upper"` (✓); lower classes sorted = `Digest Insight Observation` (✓).
5. **Full vitest:** 160 passing (153 baseline + 7 new). ✓

---

*Phase: 41-online-learning-adapter-post-hoc-resolution*
*Completed: 2026-05-22*
