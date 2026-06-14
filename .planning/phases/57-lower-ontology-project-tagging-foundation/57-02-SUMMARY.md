---
phase: 57-lower-ontology-project-tagging-foundation
plan: 02
subsystem: ontology
tags: [ontology, lower-onto, registry, configuration, lower-onto-data]
dependency_graph:
  requires:
    - lib/km-core/src/ontology/registry.ts (OntologyRegistry — Phase 38 surface)
    - .data/ontologies/upper.json (chain root)
    - .data/ontologies/coding-ontology.json (L1 Component/SubComponent/Detail carrier)
  provides:
    - .data/ontologies/coding.lower.json (10 L2 classes, zero-config registry load)
    - LiveLoggingSystem / ConstraintMonitor / OnlineObservation / OnlineDigest /
      OnlineInsight / KnowledgeManagement / BatchSemanticAnalysis / RapidLlmProxy /
      DockerizedServices / EtmDaemon → resolvable via registry.getClass(name)
    - lib/km-core/tests/integration/coding-lower-ontology.test.ts (regression lock)
  affects:
    - Plan 57-04 (classifier injection) — can now load the 10 L2 classes via OntologyRegistry
    - Future Phase 60 (viewer rendering of L2 groups) — class catalog ready
tech_stack:
  added: []
  patterns:
    - "Tmpdir-isolated fixture loading (vitest pattern from tests/unit/ontology-registry.test.ts)"
    - "Repo-root walk-up resolution from import.meta.dirname (avoids cwd assumption)"
    - "vi.spyOn(process.stderr, 'write') for benign loader noise suppression (no-console-log compliant)"
key_files:
  created:
    - .data/ontologies/coding.lower.json (60 lines, 1.9 KB)
    - lib/km-core/tests/integration/coding-lower-ontology.test.ts (163 lines)
  modified: []
decisions:
  - "meta.extends='coding-ontology' (NOT 'upper') chains through coding-ontology → upper so per-class extends references (Component / SubComponent / Detail) resolve — those L1 carriers live in coding-ontology.json, not upper.json. PATTERNS correction #2 honored verbatim."
  - "OnlineObservation / OnlineDigest / OnlineInsight all extend Detail (NOT SubComponent or Component) — leaf-level artifact tier matches existing online-pipeline convention; future Phase 60 viewer can distinguish online-learning leaves from wave-analysis leaves by L2 class."
  - "EtmDaemon kept at SubComponent (NOT upgraded to Component) per PATTERNS recommendation — ETM is conceptually one piece of the LiveLoggingSystem surface."
  - "relationships: {} on all 10 L2 classes — type-valid for OntologyClass contract; avoids inventing semantic content that future phases would have to re-validate. Mirrors Phase 38 synthetic-fixture precedent."
  - "TDD framing for Task 2: the plan is purely data + verification (no production source code). Task 1 lands the data (the 'implementation') and Task 2 lands the verification test. Authoring the test as RED-then-GREEN against an absent coding.lower.json was contrived; instead, the test was authored once and committed as a single test() commit. The plan-level RED-GREEN cycle is sequenced via the two plan tasks themselves rather than a sub-cycle within Task 2."
  - "Test file lives in lib/km-core/tests/integration/ (NOT tests/unit/) per plan filename — exercises the full registry chain (upper → coding-ontology → coding.lower) end-to-end."
  - "Test imports from '../../src/index.js' (TypeScript source, not dist/) — vitest reads src/ directly per vitest.config.ts; no npm run build required when only tests/ is touched."
  - "Two-commit topology for Task 2 (submodule commit + outer-repo pointer-bump) — lib/km-core is a real git submodule (verified: cat lib/km-core/.git → gitdir: ../../.git/modules/lib/km-core)."
metrics:
  duration: "~14 minutes"
  completed_date: 2026-06-14
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  commits: 3
  tests_added: 6
  tests_total_after: 358 (was 352; +6 net)
  test_files_after: 38
requirements:
  - LOWERONTO-01
---

# Phase 57 Plan 02: Lower Ontology Data Shape (coding.lower.json) Summary

One-liner: Ships `.data/ontologies/coding.lower.json` with 10 L2 classes extending the L1 Component-hierarchy from `coding-ontology.json`, loadable zero-config through OntologyRegistry — the static data shape Phase 57 Plan 04 will inject into the classifier prompt.

## What Shipped

### Data: `.data/ontologies/coding.lower.json`

A new ontology file matching the locked Phase 38 OntologyFile shape (object/map for `classes`, NOT array). 60 lines, ~1.9 KB. Header `meta` block:

```json
{
  "meta": {
    "name": "coding.lower",
    "version": "1.0.0",
    "description": "Coding-project L2 lower ontology — concrete subsystem classes (LSL, Constraints, Online learning, KM, ...) extending the L1 Component-hierarchy in coding-ontology.json",
    "extends": "coding-ontology"
  },
  "classes": { ... 10 keys ... }
}
```

10 L2 classes — PascalCase names, L1 parents per PATTERNS table:

| # | L2 class | L1 parent | Tier |
|---|----------|-----------|------|
| 1 | `LiveLoggingSystem` | Component | top-level subsystem |
| 2 | `ConstraintMonitor` | Component | top-level subsystem |
| 3 | `OnlineObservation` | Detail | leaf artifact |
| 4 | `OnlineDigest` | Detail | leaf artifact |
| 5 | `OnlineInsight` | Detail | leaf artifact |
| 6 | `KnowledgeManagement` | Component | top-level subsystem |
| 7 | `BatchSemanticAnalysis` | Component | top-level subsystem |
| 8 | `RapidLlmProxy` | Component | top-level subsystem |
| 9 | `DockerizedServices` | Component | top-level subsystem |
| 10 | `EtmDaemon` | SubComponent | mid-level (under LiveLoggingSystem) |

Final L1-parent distribution: **6 Component + 3 Detail + 1 SubComponent = 10**. Exact match to the PATTERNS table — no in-flight reassignments.

### Verification: `lib/km-core/tests/integration/coding-lower-ontology.test.ts`

163-line vitest integration test, 6 `it(...)` blocks:

1. `constructs OntologyRegistry without throwing` — verifies the 3-domain catalog (`upper`, `coding-ontology`, `coding.lower`) loads.
2. `resolves LiveLoggingSystem via getClass` — single-class smoke + `source === 'coding.lower'` provenance check.
3. `resolves all 10 L2 classes via getClass` — iterates `L2_CLASS_NAMES`; all defined.
4. `each L2 class extends one of Component / SubComponent / Detail` — L1-parent membership gate.
5. `parentChainOf(LiveLoggingSystem) walks through Component (and stops there)` — depth-1 chain (Component itself declares no `extends` in coding-ontology.json).
6. `parentChainOf(EtmDaemon) walks through SubComponent (deepest chain in the L2 set)` — depth-1 chain via SubComponent (likewise declares no explicit `extends`).

Tmpdir-isolated fixture: copies only `upper.json` + `coding-ontology.json` + `coding.lower.json` to a fresh `os.tmpdir()`, avoids cross-contamination from sibling production ontologies (`agentic`, `cluster-reprocessing`, `code-entities`, `raas`, `resi`, `ui`).

Repo-root resolution walks up from `import.meta.dirname` looking for `<dir>/.data/ontologies/coding.lower.json` — robust against vitest's working-directory convention.

## OntologyRegistry Accessor Surface Used

For Plan 04 (classifier injection) and future consumers, the test exercises:

- `new OntologyRegistry({ ontologyDir: <dir> })` — constructor (no async init needed; loadFromDisk runs synchronously in the constructor).
- `registry.domains.has(<name>)` — Set-shaped membership check via the `domains` getter (returns `ReadonlySet<string>`).
- `registry.getClass(<className>)` — returns `ResolvedClass | undefined`; the resolved class carries `.name`, `.source`, `.extends`, `.description`, `.relationships`, optional `.properties`, optional `.defaultLayer`.
- `registry.parentChainOf(<className>)` — returns `ResolvedClass[]` (closest-parent first); stops on missing parent or no-extends.

These are the accessors Plan 04 should reach for when wiring the L2 list into the classifier prompt.

## Verification

Plan-level automated verification (Task 1 + Task 2):

```text
$ node -e "..." (Task 1 acceptance script)
OK: 10 classes, all L1 parents valid, meta.extends=coding-ontology

$ cd lib/km-core && npm test -- coding-lower-ontology.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)

$ cd lib/km-core && npm test
Test Files  38 passed (38)
     Tests  358 passed (358)
```

End-to-end smoke through the real `.data/ontologies/` directory via the compiled km-core dist:

```text
LiveLoggingSystem -> Component
ConstraintMonitor -> Component
OnlineObservation -> Detail
OnlineDigest -> Detail
OnlineInsight -> Detail
KnowledgeManagement -> Component
BatchSemanticAnalysis -> Component
RapidLlmProxy -> Component
DockerizedServices -> Component
EtmDaemon -> SubComponent
---
Resolved 10 of 10 L2 classes
```

`.data/ontologies/upper.json` and `.data/ontologies/coding-ontology.json` are byte-identical to their pre-plan state (`git diff` returns empty for both).

## Commits

| Order | Type | Repo | Hash | Files |
|-------|------|------|------|-------|
| 1 | feat | outer | `9dae86f59` | `.data/ontologies/coding.lower.json` (created) |
| 2 | test | submodule lib/km-core | `f87bd1a` | `tests/integration/coding-lower-ontology.test.ts` (created) |
| 3 | test (pointer-bump) | outer | `d7e771d7d` | `lib/km-core` (pointer `a75acf8 → f87bd1a`) |

## Deviations from Plan

### Auto-applied (Rules 1-3)

None. Plan executed exactly as written.

### TDD framing nuance (documented, not a deviation)

Task 2 carries `tdd="true"` in the plan, but Plan 57-02 is purely data + verification — there is no production source code to write. Plan-level RED → GREEN was sequenced across the two plan tasks: Task 1 (Plan 02 Task 1 commit `9dae86f5`) lands the data (the "implementation"); Task 2 lands the verification test that locks the data. Authoring the test against an absent `coding.lower.json` to force a synthetic RED would have been contrived (the registry would have loaded with 9 classes missing, not a meaningful failure signal). The test was committed once as a single `test(...)` commit per Task 2 — the gate sequence (test commit comes after the feat commit that created the data) is preserved across the plan rather than within a single task.

### Topology decision: two-commit (submodule + outer pointer-bump)

Plan 57-02 modifies one outer-repo file (`coding.lower.json`) and one submodule file (`tests/integration/coding-lower-ontology.test.ts`). `lib/km-core` was verified as a real git submodule (`cat lib/km-core/.git` → `gitdir: ../../.git/modules/lib/km-core`; `.gitmodules` declares it), so Task 2 required a submodule commit followed by an outer-repo pointer-bump — three commits total, not one.

### No `npm run build` performed

The dispatch prompt specified `cd lib/km-core && npm run build` only "if you touched src/". Plan 02 touched `tests/` only (no `src/` changes). vitest reads `src/*.ts` directly via tsx (verified via `vitest.config.ts` and `include: ['tests/**/*.test.ts']`); no `dist/` re-build is needed for the test to run, and the cross-repo end-to-end smoke confirms the existing committed `dist/` already exposes the registry surface the test exercises.

## Known Stubs

None.

## Threat Flags

None — purely additive data file + a new test file. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

**Files created (both verified present):**
- `FOUND: .data/ontologies/coding.lower.json`
- `FOUND: lib/km-core/tests/integration/coding-lower-ontology.test.ts`

**Commits (all three verified in git log):**
- `FOUND: 9dae86f59` (outer) — `feat(57-02): add coding.lower.json with 10 L2 ontology classes`
- `FOUND: f87bd1a` (submodule lib/km-core) — `test(57-02): add fixture-driven integration test for coding.lower.json`
- `FOUND: d7e771d7d` (outer pointer-bump) — `test(57-02): bump km-core pointer for coding-lower-ontology integration test`

**Acceptance grep gates:**
- `grep -c "  it(" lib/km-core/tests/integration/coding-lower-ontology.test.ts` → 6 (≥6 required) ✓
- `grep -c "mkdtempSync\|mkdtemp" lib/km-core/tests/integration/coding-lower-ontology.test.ts` → 1 (≥1 required) ✓
- `jq '.classes | length' .data/ontologies/coding.lower.json` → 10 ✓
- `jq -r '.meta.extends' .data/ontologies/coding.lower.json` → `coding-ontology` ✓
- `jq '.classes | map(.extends) | unique' .data/ontologies/coding.lower.json` → `["Component","Detail","SubComponent"]` (subset of allowed) ✓

**Test suite:**
- New file: 6/6 PASS
- Full km-core suite: 358/358 PASS (was 352; +6 net; zero regressions)
