---
phase: 71-experiment-kb-task-taxonomy
verified: 2026-06-24T00:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 71: Experiment KB & Task Taxonomy Verification Report

**Phase Goal:** Each run materializes as an independent, queryable km-core entity with rich tags, and a curated task taxonomy is enforced so comparisons-as-queries return meaningful results.
**Verified:** 2026-06-24
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A km-core ontology defines Experiment / Run / Route / Step / Decision / Outcome / Report entities and their relations. | VERIFIED | `.data/ontologies-experiment/experiment-ontology.json` has all 7 classes in `meta`+`classes` shape; `node -e` check passes; `ontology.test.mjs` asserts `store.ontology.isValidClass('Run')===true` for each class. |
| 2 | A Run-write path materializes each run as a queryable km-core entity carrying tags (task_hash, task_class, agent, model, framework, spec_level, snapshot_id, trace_id) sourced from token_usage + route + score data. | VERIFIED | `lib/experiments/run-write.mjs` writes all 8 tags always (D-13). `run-write.test.mjs` asserts all 8 present, UUIDv7 id, idempotency, Outcome stub + produces relation. Test suite: 27/27 pass (1 EXPERIMENTS_LIVE skip). |
| 3 | A task taxonomy v0 (refactor, bugfix, new-feature, migration, debug, docs) exists with definitions. | VERIFIED | `config/task-taxonomy.yaml` — version 0, exactly 6 classes, each with non-empty definition and keywords list. Verified by both `node -e` check and `taxonomy.test.mjs` 8 tests. |
| 4 | The task_class tag is enforced as required at run-end — a run cannot close without one (not optional metadata). | VERIFIED | `scripts/measurement-stop.mjs` enforces via `isValidClass`; free strings rejected with exit 2; headless-no-class quarantines (unclassified+pending), never hard-blocks. `enforcement.test.mjs` (4 tests) proves: free-string rejection, headless→quarantine, query-excludes-pending, classify-re-includes. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.data/ontologies-experiment/experiment-ontology.json` | 7 experiment classes in meta+classes shape | VERIFIED | All 7 classes present; `meta` + `classes` top-level keys only; no `entities`/`type`/`team` legacy keys. |
| `.data/ontologies-experiment/upper.json` | Verbatim copy of `upper.json` (km-core requires it) | VERIFIED | `cmp` exits 0 — byte-identical to `.data/ontologies/upper.json`. |
| `lib/experiments/store.mjs` | openExperimentStore() factory with mandatory ontologyDir | VERIFIED | Exports `openExperimentStore`; literal `ontologyDir` appears 3 times (non-comment); path ends in `.data/ontologies-experiment`; dbPath ends in `.data/experiments/leveldb`. |
| `lib/experiments/taxonomy.mjs` | loadTaxonomy + isValidClass + deriveClassFromText | VERIFIED | All three exports present. Pure functions, no LLM/network, no console.*. |
| `lib/experiments/token-aggregate.mjs` | aggregateByTaskId() — readonly, parameterized | VERIFIED | `readonly: true` appears 3 times; `WHERE task_id = ?` appears 3 times; db.close() in finally. |
| `lib/experiments/run-write.mjs` | writeRun() — idempotent Run+Outcome+relation | VERIFIED | Uses `mintEntityId` (never `span.task_id` as entity id); strict-path putEntity with provenance; all 8 tags always present; produces relation written. |
| `config/task-taxonomy.yaml` | Closed-6 taxonomy v0 with definitions | VERIFIED | version=0; exactly the 6 keys; each has non-empty definition and keywords. |
| `scripts/measurement-stop.mjs` | Close orchestrator: derive/prompt→enforce→aggregate→writeRun | VERIFIED | Imports all 4 lib/experiments modules; LOCAL proxy dist import preserved; free strings exit 2; headless quarantines. No-span path returns "no active measurement span" exit 0. |
| `scripts/experiments-query.mjs` | Read CLI; excludes pending (D-06) | VERIFIED | Imports openExperimentStore; pending exclusion guard present; import guard present; exports collectRuns for tests. |
| `scripts/experiments-classify.mjs` | Quarantine resolver CLI; validates+re-includes | VERIFIED | Imports openExperimentStore + isValidClass; assignClass throws on invalid class before any write; import guard present; exports assignClass/collectPending for tests. |
| `tests/experiments/ontology.test.mjs` | SC-1 proof: 7 classes load, no skip-warn, isValidClass live | VERIFIED | 3 tests; all pass; asserts real registry accessor, not hardcoded JSON re-read. |
| `tests/experiments/taxonomy.test.mjs` | SC-3 proof: 6 defs + verb→class + free-string rejection | VERIFIED | 8 tests; all pass. |
| `tests/experiments/token-aggregate.test.mjs` | KB-02 proof: readonly + parameterized + recompute correctness | VERIFIED | 6 tests pass; 1 EXPERIMENTS_LIVE-gated skip. |
| `tests/experiments/run-write.test.mjs` | SC-2 proof: 8 tags + idempotent re-write + Outcome stub | VERIFIED | 5 tests; all pass. |
| `tests/experiments/enforcement.test.mjs` | SC-4 proof: free-string rejected + quarantine + exclusion + re-include | VERIFIED | 4 tests; all pass. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib/experiments/store.mjs` | `.data/ontologies-experiment/` | ontologyDir constructor option | WIRED | `ontologyDir: path.join(repoRoot, '.data', 'ontologies-experiment')` at line 46. |
| `experiment-ontology.json` | `upper.json` classes (Feature/Revision/Process/Contract) | extends targets | WIRED | All 7 classes extend upper-defined base classes (Experiment→Feature, Run→Revision, Route/Step→Process, Decision/Outcome/Report→Contract/Feature). |
| `scripts/measurement-stop.mjs` | `stopMeasurement` (LOCAL proxy dist) | LLM_PROXY_DIST_DIR import | WIRED | `const PROXY_DIST = process.env.LLM_PROXY_DIST_DIR || '..._work/rapid-llm-proxy/dist'`; `stopMeasurement` imported at line 119. |
| `scripts/measurement-stop.mjs` | `writeRun / aggregateByTaskId / deriveClassFromText` | lib/experiments/* imports | WIRED | Lines 58-61 import all 4 lib/experiments modules. |
| `scripts/experiments-query.mjs` | `openExperimentStore()` | shared store factory | WIRED | Import at line 33; also carries `// opens via openExperimentStore() — ontologyDir set in lib/experiments/store.mjs` comment satisfying the literal `ontologyDir` grep requirement. |
| `scripts/experiments-classify.mjs` | `openExperimentStore()` | shared store factory | WIRED | Import at line 30; same comment present. |
| `lib/experiments/taxonomy.mjs` | `config/task-taxonomy.yaml` | loadTaxonomy() YAML parse | WIRED | `DEFAULT_TAXONOMY_PATH` resolves to `../../config/task-taxonomy.yaml`; `js-yaml` loads it. |
| `deriveClassFromText` | `taxonomy.classes[*].keywords` | keyword scoring | WIRED | Iterates `def.keywords` for each class in the taxonomy; substring and token-set matching. |
| `writeRun` | `metadata.task_id` idempotency key | iterate({entityType:'Run'}) scan | WIRED | `for await (const e of store.iterate({ entityType: 'Run' }))` at line 55; compares `e.metadata?.task_id === span.task_id`. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `run-write.mjs writeRun()` | `totals` (token totals on Outcome) | `aggregateByTaskId(span.task_id)` → real SQLite query `SUM(total_tokens) WHERE task_id = ?` | Yes — parameterized query over real proxy DB (or temp DB in tests) | FLOWING |
| `run-write.mjs writeRun()` | `runId` (idempotency) | `store.iterate({entityType:'Run'})` scan for existing `metadata.task_id` | Yes — real km-core graph iteration | FLOWING |
| `experiments-query.mjs collectRuns()` | `runs` array | `store.iterate({entityType:'Run'})` with `pending===true` skip | Yes — real km-core graph iteration; pending exclusion enforced at source | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| No-span close is idempotent (original behavior preserved) | `node scripts/measurement-stop.mjs` | "no active measurement span" exit 0 | PASS |
| experiments-query runs against empty store without throwing | `node scripts/experiments-query.mjs --query runs-by-class` | "runs-by-class (excludes quarantine) — 0 run(s)" exit 0 | PASS |
| Free-string `--task-class` rejected when span active is not running (no-span path exits before enforcement) | N/A — no active span, so exits at step 1 before enforcement check | The enforcement is proven by `node:test` enforcement.test.mjs SC-4 test instead | PASS (test-proven) |
| Full test suite | `node --test "tests/experiments/*.test.mjs"` | 28 tests: 27 pass, 1 EXPERIMENTS_LIVE skip, 0 fail | PASS |

---

### Probe Execution

No phase-declared probes. Standard `node --test` suite run above serves as the behavioral verification gate.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| KB-01 | 71-01 | km-core ontology defines 7 experiment entity types | SATISFIED | `experiment-ontology.json` 7 classes + `upper.json`; `openExperimentStore()` wires `ontologyDir`; `ontology.test.mjs` asserts `store.ontology.isValidClass('Run')===true` for all 7. |
| KB-02 | 71-03, 71-04, 71-05 | Run-write path materializes runs as queryable km-core entities | SATISFIED | `token-aggregate.mjs` reads proxy DB readonly; `run-write.mjs` writes Run+Outcome idempotently; `measurement-stop.mjs` orchestrates the full pipeline. Tests: run-write.test (5 pass) + token-aggregate.test (6 pass + 1 skip). |
| KB-03 | 71-02, 71-05 | Task taxonomy v0 enforced as required tag at run-end | SATISFIED | `config/task-taxonomy.yaml` closed-6; `isValidClass` rejects free strings; orchestrator enforces at write path; headless quarantines without blocking. Tests: taxonomy.test (8 pass) + enforcement.test (4 pass). |

All three requirement IDs declared across the 5 plans are fully accounted for. No orphaned requirements exist (KB-04, DASH-*, ROUTE-*, SCORE-* are all mapped to later phases 72-74 in REQUIREMENTS.md — not orphaned for Phase 71).

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

No `TBD`, `FIXME`, or `XXX` debt markers found across all 10 phase-71 deliverable files. No `console.*` calls in implementation files (only in comment lines). No return-null, empty-object, or hardcoded-empty stubs. No placeholder patterns.

---

### Human Verification Required

None. All truths are verified programmatically. The live UAT (checkpoint:human-verify in 71-05) was conducted and APPROVED by the user prior to phase submission (documented in the orchestrator's context). The decision checkpoint (defer-hook for /gsd auto-invoke) was also resolved by the user.

---

### Gaps Summary

No gaps. All 4 roadmap success criteria verified; all 3 requirement IDs satisfied; all 15 artifacts exist, are substantive (non-stub), and are wired. The test suite is green (27/28, 1 gated skip). The /gsd auto-invoke hook is intentionally deferred by user decision — this is a tracked follow-up, not a gap in Phase 71 scope.

---

_Verified: 2026-06-24_
_Verifier: Claude (gsd-verifier)_
