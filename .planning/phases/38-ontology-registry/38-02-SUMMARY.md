---
phase: 38-ontology-registry
plan: 02
subsystem: km-core
tags: [km-core, ontology, test-fixtures, json, sc3-fixture, B-shape]

# Dependency graph
requires:
  - phase: 38-01
    provides: "OntologyFile/OntologyClass/OntologyProperty/ResolvedClass type surface — the synthetic fixture conforms to this shape (extends?, defaultLayer, relationships are all part of OntologyClass)"
provides:
  - "tests/fixtures/ontology/{upper,kpifw,business,raas}.json — 4 OKM ontology JSONs byte-identical to OKM source (the canonical reference shape for ONTO-01/02)"
  - "tests/fixtures/ontology/coding-ontology.json — synthetic B-shape lower ontology proxy (7 L1 + 5 L2 = 12 classes) for SC#3 verification"
  - "The fixture directory itself (~/Agentic/km-core/tests/fixtures/ontology/) — readdirSync auto-discovery target for Plan 03 registry tests and Plan 06 integration tests"
affects: [38-03, 38-04, 38-05, 38-06, 42-okb-migration, 43-okm-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verbatim file-copy fixture pattern (cmp byte-equality assertion, not JSON.parse roundtrip — PATTERNS.md landmine respected)"
    - "Synthetic B-shape proxy with self-documenting meta.description (Phase 42 ownership + source-count drift call-out)"
    - "Empty relationships:{} satisfies Record<string,string[]> contract — minimal valid shape for fixture purposes"

key-files:
  created:
    - "/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/upper.json (7809 bytes, 13 classes; verbatim OKM copy)"
    - "/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/kpifw.json (2899 bytes, 5 classes, meta.extends:upper; verbatim OKM copy)"
    - "/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/business.json (3608 bytes, 5 classes; verbatim OKM copy)"
    - "/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/raas.json (2889 bytes, 6 classes, per-class extends across upper; verbatim OKM copy)"
    - "/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/coding-ontology.json (3035 bytes, 12 classes; synthetic B-shape proxy)"
  modified: []

key-decisions:
  - "Used `cp` for the 4 OKM fixtures (not JSON.parse+JSON.stringify) so byte-equality holds — PATTERNS.md flagged the reformat path as a landmine. Verified by `cmp` returning exit 0 against each OKM source."
  - "Synthetic fixture uses on-disk component-manifest.yaml count of 7 L1 + 5 L2 (12 classes total), NOT the 8 L1 + 5 L2 figure quoted in 38-CONTEXT.md / 38-PATTERNS.md. This is a documentation-source drift in CONTEXT/PATTERNS, not a fixture defect — the YAML on disk has exactly 7 L1 components. Drift surfaced in this SUMMARY per the plan's explicit instruction; meta.description in the fixture also calls it out so anyone reading the JSON alone sees the discrepancy."
  - "Synthetic fixture drops B's aliases + keywords (per PATTERNS.md DELTAS bullet 1) — these have no natural home in C's JSON ontology shape; Phase 42 decides whether they survive the real YAML→JSON conversion."
  - "Synthetic fixture uses empty relationships:{} for all 12 classes — type-valid (Record<string,string[]> with {}) and avoids inventing semantic content that Phase 42 would have to re-validate."
  - "meta.description self-documents the synthetic nature: contains 'Synthetic', 'proxy for B's component-manifest.yaml', and 'Phase 42 owns the real YAML→JSON conversion' — operator inspecting the file sees the lineage immediately (T-38-02-03 mitigation)."

patterns-established:
  - "Verbatim-copy fixture: when test data is sourced from another repo, copy bytes (not parsed-then-stringified). `cmp <source> <dest>` exit-0 is the test for fidelity."
  - "Synthetic fixture meta-description must encode (a) synthetic-ness, (b) source-of-truth pointer, (c) ownership-of-real-conversion phase — so operator reading the JSON alone can trace lineage without consulting plan docs."
  - "B-shape proxy uses on-disk YAML count as source of truth when planning docs and YAML disagree — fixture matches the live artifact; doc drift is reported, not propagated."

requirements-completed:
  - ONTO-01
  - ONTO-02

# Metrics
duration: 3min
completed: 2026-05-20
---

# Phase 38 Plan 02: Test Fixtures Summary

**Five JSON ontology fixtures (4 verbatim OKM copies + 1 synthetic 12-class B-shape proxy) land in `~/Agentic/km-core/tests/fixtures/ontology/`, ready for Plan 03/06 to load via readdirSync auto-discovery and exercise both ontology-level (`meta.extends`) and per-class (`extends`) merging.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-20T11:50:00Z (approx)
- **Completed:** 2026-05-20T11:53:00Z (approx)
- **Tasks:** 2
- **Files modified:** 5 (all created)

## Accomplishments

- 4 OKM ontology JSONs (`upper.json` 7809 bytes / `kpifw.json` 2899 bytes / `business.json` 3608 bytes / `raas.json` 2889 bytes) copied **byte-identical** into `~/Agentic/km-core/tests/fixtures/ontology/` via `cp`. Verified each pair with `cmp` exit-0 against the OKM source under `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/ontology/`. These exercise the registry's core auto-discovery + extends-merging contract (ONTO-01 + ONTO-02) against real production-shape data.
- Synthetic `coding-ontology.json` (3035 bytes) authored to mirror B's `component-manifest.yaml` semantically in C's JSON shape: `meta.extends: "upper"` + 7 L1 classes each `extends: "Component"` + 5 L2 classes each `extends: "<L1 parent>"`. Backs SC#3 verification per D-26 — Phase 42 owns the real YAML→JSON conversion; this is a temporary B-shape proxy.
- Directory layout matches the contract for the registry's `readdirSync(...).filter(f => f.endsWith('.json'))` auto-discovery: exactly 5 .json files, no `.gitkeep`, no sibling README, no clutter (PATTERNS.md landmine respected).
- All 5 files parse as valid JSON (`json.load(open(f))` returns clean on each).
- The synthetic fixture exercises both kinds of `extends` simultaneously: ontology-level (`meta.extends: "upper"`) AND per-class (each L1 extends `Component` from upper; each L2 extends its L1 parent).

## Source-count callout: 7 L1, not 8 L1

> **PLAN-CHECK Strength #2: on-disk truth is 7 L1 + 5 L2 = 12 classes** in the synthetic fixture, NOT the "8 L1 + 5 L2" figure quoted in `38-CONTEXT.md` (D-26 + Specific Ideas) and `38-PATTERNS.md`. The plan file `38-02-PLAN.md` `<interfaces>` section called this out explicitly and instructed me to use on-disk truth and surface the discrepancy here.
>
> **Source of truth used:** `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/config/component-manifest.yaml`.
>
> **Exact L1 names from the YAML (in document order, lines 14, 32, 51, 68, 115, 132, 148):** LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, SemanticAnalysis. That is **7** components at `level: 1`. The plan-doc figure of 8 L1 likely predates a manifest reduction. CONTEXT/PATTERNS should be amended (or annotated) at the next opportunity; this fixture matches the live artifact.
>
> **L2 names:** ManualLearning + OnlineLearning (under KnowledgeManagement) + Pipeline + Ontology + Insights (under SemanticAnalysis) — that is **5**, matching the plan's L2 count.
>
> Net: fixture has **12 classes total** (7 + 5), assertion was checked at write time:
> ```
> python3 -c "import json; d=json.load(open('.../coding-ontology.json')); assert len(d['classes'])==12; print('OK')"
> # OK
> ```

## Task Commits

Each task was committed atomically inside the km-core repo on `main`:

1. **Task 1: Copy 4 OKM ontology JSONs verbatim** — `5e31b3e` (feat: 4 files; 471 insertions; `cmp` byte-equality verified against OKM source on each pair)
2. **Task 2: Author synthetic coding-ontology.json (B-shape proxy)** — `972bd3a` (feat: 1 file; 82 insertions; 12 classes; meta.extends="upper"; 7 L1 extends "Component" + 5 L2 extends their L1 parent)

km-core HEAD before plan: `88dff82` (Plan 38-01's last commit — `feat(38-01): add loadOntologyFile sync JSON reader`).
km-core HEAD after plan: `972bd3a`.

**Plan metadata (coding repo):** committed separately with this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/upper.json` — Created (7809 bytes, 13 classes; OKM v2 streamlined upper ontology: Component, DataAsset, Infrastructure, Job, Pipeline, Service, Session, Step, FailurePattern, Incident, Resolution, RootCause, Symptom). Byte-identical to OKM source.
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/kpifw.json` — Created (2899 bytes, 5 classes, `meta.extends: "upper"`; includes per-class `KPIPipeline extends Pipeline` — the prototypical cross-ontology per-class extends case). Byte-identical to OKM source.
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/business.json` — Created (3608 bytes, 5 classes, `meta.extends: "upper"`). Byte-identical to OKM source.
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/raas.json` — Created (2889 bytes, 6 classes, `meta.extends: "upper"`; includes per-class `RPU extends Component`, `ArgoWorkflow extends Pipeline`, `S3DataPath extends DataAsset` — exercises three cross-ontology per-class extends in a single file). Byte-identical to OKM source.
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/coding-ontology.json` — Created (3035 bytes, 12 classes; synthetic). `meta.name: "coding"`, `meta.version: "1.0.0"`, `meta.extends: "upper"`, `meta.description` self-documents synthetic nature + Phase 42 ownership + source-count drift. Classes: 7 L1 (LiveLoggingSystem, LLMAbstraction, DockerizedServices, KnowledgeManagement, CodingPatterns, ConstraintSystem, SemanticAnalysis), each `extends: "Component"`, each `defaultLayer: "evidence"`, each `relationships: {}`. + 5 L2 (ManualLearning, OnlineLearning under KnowledgeManagement; Pipeline, Ontology, Insights under SemanticAnalysis), each `extends` its L1 parent, each `defaultLayer: "evidence"`, each `relationships: {}`. No `aliases`, no `keywords` (PATTERNS.md DELTAS bullet 1).

## Decisions Made

- **Verbatim file-copy over re-serialize:** Used `cp` for the 4 OKM fixtures (not `JSON.parse` + `JSON.stringify`). PATTERNS.md flagged the reformat path as a landmine — sticking to `cp` preserves OKM's 2-space indentation, trailing newlines, key ordering, etc. The acceptance criterion `cmp <src> <dst>` proves the contract held; all 4 returned exit 0.
- **On-disk source of truth for the synthetic fixture's class count:** chose 7 L1 + 5 L2 = 12 classes (matching `component-manifest.yaml` verbatim) rather than the 8 L1 figure quoted in `38-CONTEXT.md` and `38-PATTERNS.md`. The plan itself authorized this explicitly under `<interfaces>` ("Use the on-disk source of truth (7 L1 + 5 L2 = 12 classes) and call out the count discrepancy in the SUMMARY as a documentation-source drift, not a fixture defect"). The drift is surfaced both here and in the fixture's `meta.description`.
- **Empty `relationships: {}` on the synthetic fixture:** OKM's `OntologyClass` interface declares `relationships: Record<string, string[]>` with no `?`, but an empty object satisfies that type. Avoiding invented semantic content (e.g., "PART_OF: ['Coding']") keeps Phase 42 unconstrained when it generates the real conversion.
- **No barrel changes, no source-code changes, no `.gitkeep`:** Fixtures-only plan per the wave-1 zero-dependency contract. The directory layout matches exactly what Plan 03's `readdirSync` will see.
- **`defaultLayer: "evidence"` on all synthetic classes:** matches the `Layer` literal union from Phase 37's `src/types/entity.ts` (`'evidence' | 'pattern'`); reuses the single-source-of-truth pattern established by Plan 38-01.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria from both tasks pass:

- Task 1: `mkdir -p` idempotent ✓ — all 4 files present at target paths ✓ — `cmp` exit 0 for each of (upper, kpifw, business, raas) ✓ — `kpifw.json.meta.extends == "upper"` round-trips through `json.load` ✓ — file count is exactly 4 after Task 1 ✓.
- Task 2: file exists ✓ — parses as JSON ✓ — `meta.extends == "upper"` ✓ — total class count is 12 ✓ — all 7 L1 have `extends == "Component"` ✓ — all 5 L2 have `extends` pointing at correct L1 parent ✓ — `grep aliases|keywords` returns 0 ✓ — file count is exactly 5 after Task 2 ✓.

The plan's authorized accommodation of the 7 L1 vs 8 L1 doc-drift is not a deviation — it was explicitly directed in the `<interfaces>` block. Recorded under "Decisions Made" + "Source-count callout" rather than "Deviations" because it followed the plan.

## Issues Encountered

None.

## TDD Gate Compliance

Plan 38-02 type is `execute` (not `tdd`). No RED→GREEN→REFACTOR gate sequence required. The fixtures are inputs to the registry tests in Plan 38-06; this plan ships only data.

## Threat Flags

None — Plan 38-02 introduces only static JSON data files in a test-fixtures directory. The threat register dispositions are honored:
- **T-38-02-01 (Tampering: OKM copy not byte-equal)** mitigated — `cmp` exit-0 against each of the 4 OKM source files; the verbatim-copy invariant holds.
- **T-38-02-02 (Information Disclosure: B internal names leak)** accepted — B's `component-manifest.yaml` is in the public coding repo; names are already public-facing per the project's open-source posture.
- **T-38-02-03 (Tampering: synthetic fixture hides its synthetic nature)** mitigated — `meta.description` contains "Synthetic", "proxy for B's component-manifest.yaml", and "Phase 42 owns the real YAML→JSON conversion". Operator inspecting the file sees the lineage immediately.

## User Setup Required

None — pure test-fixture additions inside km-core. No environment variables, no dashboard configuration, no external services touched.

## Next Phase Readiness

- **Plan 38-03 (OntologyRegistry class)** — Ready. The registry's `readdirSync` auto-discovery + `loadOntologyFile` calls now have a real fixture directory to point at; Plan 03 tests will use `path.join(import.meta.dirname, '../fixtures/ontology')` per PATTERNS.md guidance.
- **Plan 38-04 (registryBackedValidator factory)** — Indirectly ready; the factory uses the registry, the registry uses these fixtures. No new dependency.
- **Plan 38-05 (GraphKMStore wiring)** — Ready. Auto-wiring tests will pass `ontologyDir: <fixture dir>` to the store constructor and assert `store.ontology.isValidClass('Component')` and `isValidClass('RPU')` return true.
- **Plan 38-06 (tests)** — Ready. Test fixtures are now durably available; the SC#3 test will load `upper.json` + `coding-ontology.json` into a tmpdir (per PATTERNS.md landmine: isolate SC#3 from OKM-fixture cross-contamination) and assert load + per-class extends-merge succeeds.
- **No blockers.** km-core compiles clean (no source-code changes); fixture directory contains exactly the 5 .json files the registry contract expects.

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/upper.json` — FOUND (`test -f` true, 7809 bytes, `cmp` against OKM exit 0)
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/kpifw.json` — FOUND (`test -f` true, 2899 bytes, `cmp` against OKM exit 0)
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/business.json` — FOUND (`test -f` true, 3608 bytes, `cmp` against OKM exit 0)
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/raas.json` — FOUND (`test -f` true, 2889 bytes, `cmp` against OKM exit 0)
- `/Users/Q284340/Agentic/km-core/tests/fixtures/ontology/coding-ontology.json` — FOUND (`test -f` true, 3035 bytes; `json.load` returns clean; 12 classes; `meta.extends == "upper"`)
- km-core commit `5e31b3e` — FOUND in `git log --oneline -4` (`feat(38-02): add 4 OKM ontology fixtures verbatim`)
- km-core commit `972bd3a` — FOUND in `git log --oneline -4` (`feat(38-02): add synthetic coding-ontology.json B-shape fixture`)
- `ls -1 tests/fixtures/ontology/*.json | wc -l` = 5 (no `.gitkeep`, no clutter)
- `cd /Users/Q284340/Agentic/km-core && git status tests/fixtures/ontology/` — clean

---
*Phase: 38-ontology-registry*
*Completed: 2026-05-20*
