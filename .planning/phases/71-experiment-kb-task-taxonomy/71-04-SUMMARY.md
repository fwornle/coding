---
phase: 71-experiment-kb-task-taxonomy
plan: 04
subsystem: experiments-kb
tags: [km-core, run-write, idempotency, Outcome-stub, KB-02, D-12, D-13, D-14]

# Dependency graph
requires:
  - phase: 71-01
    provides: "openExperimentStore() — open experiment GraphKMStore with ontologyDir (strict-path putEntity validates entityType)"
  - phase: 71-03
    provides: "aggregateByTaskId() — token totals + dominant agent/model feeding the Run tags + Outcome stub"
provides:
  - "writeRun(store, { span, taskClass, pending, tags, totals }) → idempotent Run (8 tags) + Outcome stub + produces relation"
affects:
  - "71-05 close orchestrator (measurement-stop wires aggregateByTaskId → writeRun)"
  - "71-05 experiments-query / experiments-classify (read the Runs writeRun materializes)"
  - "72-route-metrics, 74-performance-dashboard (consume Run/Outcome entities)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent km-core write: iterate({entityType}) metadata.task_id scan → mint-once-or-update (never task_id as id — Pitfall 1)"
    - "Strict-path putEntity with synthetic ProvenanceStamp (entityType validated against the registry; NOT skipOntologyCheck)"
    - "Capture the putEntity RETURN value as the authoritative node id for the subsequent addRelation"

key-files:
  created:
    - lib/experiments/run-write.mjs
    - tests/experiments/run-write.test.mjs
  modified: []

key-decisions:
  - "Outcome idempotency keyed on a metadata.run_task_id back-link (the Outcome carries no task_id of its own), so a re-close self-heals the SAME Outcome's totals rather than creating a second stub"
  - "Use the putEntity RETURN id (not a locally pre-minted variable) as the source of truth for the produces relation — the store mints internally and the relation endpoints must match the persisted node ids"
  - "All 8 tags default to null where the tags arg omits a source (D-13), with spec_level/snapshot_id ALWAYS explicitly null (deferred surfaces)"

requirements-completed: [KB-02]

# Metrics
duration: 11min
completed: 2026-06-23
---

# Phase 71 Plan 04: Idempotent Run-Write Path (KB-02) Summary

**`writeRun(store, { span, taskClass, pending, tags, totals })` materializes each measurement span as an independent, queryable km-core Run entity carrying all 8 tags (D-13), plus a basic Outcome stub (token totals + closedState) and a `Run--produces-->Outcome` relation (D-12) — idempotent on `metadata.task_id` so a re-close updates the same node and self-heals the Outcome totals rather than duplicating (D-14).**

## Performance

- **Duration:** ~11 min
- **Tasks:** 1 completed (TDD: RED → GREEN, no REFACTOR needed)
- **Files created:** 2
- **Files modified:** 0

## What Was Built

- **`lib/experiments/run-write.mjs`** — exports `async function writeRun(store, { span, taskClass, pending, tags, totals })`:
  1. **Idempotent lookup** — scans `for await (const e of store.iterate({ entityType: 'Run' }))` for the one whose `e.metadata?.task_id === span.task_id`, capturing its `id` if found.
  2. **Synthetic provenance** — builds a `{ provider:'coding-measure-stop', model:'n/a', runId:span.task_id, timestamp }` stamp (the store never invents one — D-30).
  3. **Run write** — strict-path `putEntity` with `entityType:'Run'`, `layer:'evidence'`, `name:span.task_id`, `description:span.goal_sentence ?? ''`, and `metadata` carrying `task_id` (idempotency key) PLUS all 8 tags ALWAYS (`task_hash, task_class, agent, model, framework, spec_level:null, snapshot_id:null, trace_id`), plus `pending`/`started_at`/`ended_at`. On first write the id is `mintEntityId()` (NEVER `span.task_id` — Pitfall 1); on re-close it reuses the existing id. The **returned** id is the authoritative node id.
  4. **Outcome stub** — strict-path `putEntity` with `entityType:'Outcome'`, metadata `totalTokens/inputTokens/outputTokens/reasoningTokens` from `totals` + `closedState: pending ? 'quarantined' : 'closed'` + a `run_task_id` back-link for idempotent re-close lookup.
  5. **Relation** — `addRelation({ type:'produces', from: runId, to: outcomeId })`.
  Route/Step/Decision/Report stay schema-only (D-12). Output via `process.stderr.write` only (no console.*).
- **`tests/experiments/run-write.test.mjs`** — node:test, 5 cases against a TEMP store (isolated `repoRoot` tmpdir with the REAL ontology copied verbatim, mirroring `ontology.test.mjs`): (1) 8-tag presence + spec_level/snapshot_id null; (2) minted-UUIDv7 id matched against the `…-7…` shape, asserting it is never `t1`; (3) re-close idempotency — exactly 1 Run + same id + Outcome totals self-healed 300→400; (4) Outcome stub fields + exactly-one `produces` relation targeting the Outcome; (5) pending close → `pending:true` + `closedState:'quarantined'` (D-06).

## Verification

- `node --test tests/experiments/run-write.test.mjs` → **5 pass / 0 fail**.
- Cross-file regression: `ontology.test.mjs` + `token-aggregate.test.mjs` + `run-write.test.mjs` together → **15 tests, 14 pass, 0 fail, 1 skip** (the EXPERIMENTS_LIVE-gated token-aggregate live case).
- Source greps (acceptance criteria): `mintEntityId` imported + used for the entity id (lines 27/77/113); NO `id: *.task_id` assignment (the two `task_id` hits are `metadata.task_id` + `run_task_id`); strict-path `{ provenance }` on both putEntity calls; NO `skipOntologyCheck` (only a comment naming it as what we avoid); zero `console.*`.

## Threat Model Compliance

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-71-04-01 (unvalidated entityType bypassing the ontology) | mitigate | ✓ strict-path putEntity with a provenance stamp — `entityType:'Run'/'Outcome'` validated against the registry; NO skipOntologyCheck. |
| T-71-04-02 (duplicate Runs on re-close) | mitigate | ✓ metadata.task_id scan + mint-once-or-update; test asserts exactly 1 Run + 1 Outcome after two writes (D-14). |
| T-71-04-03 (npm installs) | mitigate | ✓ no new installs — `@fwornle/km-core` already present. |

## TDD Gate Compliance

- **RED:** `b1fbe9314 test(71-04): add failing SC-2 test ...` — confirmed all 5 cases failed with `ERR_MODULE_NOT_FOUND` (run-write.mjs absent) before implementation.
- **GREEN:** `1e2bfb77b feat(71-04): implement idempotent writeRun ...` — 5/5 pass.
- **REFACTOR:** none needed — the implementation was minimal/clean (one inline clarity edit during GREEN, no separate refactor commit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Use the `putEntity` RETURN id for the produces relation (not a pre-minted local id)**
- **Found during:** Task 1 GREEN phase.
- **Issue:** The RESEARCH Pattern-2 skeleton pre-mints `const id = existingId ?? mintEntityId()`, writes the Run *without* passing that id on first write, then uses the local `id` for `addRelation`. But `GraphKMStore.putEntity` mints its OWN id internally when `e.id` is absent (GraphKMStore.js:285-286) and **returns** the persisted id. The local pre-minted variable was never persisted, so `addRelation({ from: localId })` threw `Source node not found`.
- **Fix:** Pass the minted id explicitly into `putEntity` (`id: existingId ?? mintEntityId()`) AND capture the **returned** id (`const runId = await store.putEntity(...)`) as the authoritative node id for the relation — the same correction applied to the Outcome (`outcomeId`). Both writes are deterministic and the relation endpoints now match the persisted nodes.
- **Files modified:** `lib/experiments/run-write.mjs`.
- **Commit:** `1e2bfb77b`.

**2. [Rule 2 - Missing critical functionality] Idempotent Outcome via a `run_task_id` back-link**
- **Found during:** Task 1 implementation.
- **Issue:** The RESEARCH §"Run + Outcome stub" skeleton always mints a fresh Outcome id, so a re-close (D-14 self-heal) would leave the FIRST Outcome orphaned and write a SECOND — polluting the per-Run outcome with stale token totals. The plan's `<behavior>` requires the re-close to UPDATE (exactly one Outcome with the recomputed totals).
- **Fix:** The Outcome carries a `metadata.run_task_id` back-link (it has no task_id of its own); on re-close `writeRun` scans `iterate({entityType:'Outcome'})` for the matching `run_task_id` and reuses that id, so the SAME Outcome's totals self-heal. Test case 3 asserts exactly 1 Outcome with `totalTokens` updated 300→400 after re-close.
- **Files modified:** `lib/experiments/run-write.mjs`, `tests/experiments/run-write.test.mjs`.
- **Commit:** `1e2bfb77b` (impl) / `b1fbe9314` (test).

## Known Stubs

None silent. The Outcome is the intentional v0 stub (token totals + closedState only — D-12); Route/Step/Decision/Report remain schema-only by design (populated in Phases 72-74). Both are documented intent, not placeholders.

## Self-Check: PASSED

- `lib/experiments/run-write.mjs` — FOUND
- `tests/experiments/run-write.test.mjs` — FOUND
- Commit `b1fbe9314` (RED) — FOUND
- Commit `1e2bfb77b` (GREEN) — FOUND
