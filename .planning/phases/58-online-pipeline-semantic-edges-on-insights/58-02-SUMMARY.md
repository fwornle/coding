---
phase: 58-online-pipeline-semantic-edges-on-insights
plan: 02
plan_id: 58-02
subsystem: B/live-logging
tags: [writer-path-unification, atomicity, mentions-edges, phase-58, d-04, d-06]
status: complete
requires:
  - "58-01 (MentionsClassifier — loadMentionCandidates + classifyMentions; consumed by both writeInsight options.mentionsTargetIds plumbing AND _pushInsightToKG pre-write classification)"
  - "44-12 (ObservationWriter.writeInsight + legacyInsightToEntity adapter — the kmStore-native writer surface this plan extends with mentionsTargetIds)"
  - "44-17 (ObservationConsolidator kmStore single-owner pattern — the consolidator constructor already accepts options.kmStore which Plan 02 layers options.observationWriter onto)"
  - "55-06 (observation-written EventEmitter convention — guides how the writer's mentions-edge stderr logs follow the non-fatal log pattern)"
provides:
  - "ObservationWriter._emitMentionsEdges(kmStore, fromId, targetIds) — N-edge generalization of _anchorEntity with self-loop guard, findRelations dedup probe, and benign-error stderr logging per Shared Pattern A"
  - "ObservationWriter.writeInsight(row, options={mentionsTargetIds: string[]}) — extended signature; emits putEntity → mentions×N → capturedBy inside one try-block so the km-core JSON exporter's 5s debounce window batches node + all edges into one tick (EDGE-02 atomicity)"
  - "ObservationConsolidator._observationWriter handle + _ensureObservationWriter lazy getter — D-06 unification surface; tests inject a mock via options.observationWriter, production lazy-constructs against the shared this._kmStore"
  - "ObservationConsolidator._pushInsightToKG refactored — no fetch() calls (HTTP-PUT retired); no inlined kmStore.putEntity; routes through this._observationWriter.writeInsight(row, {mentionsTargetIds}); emits has_insight post-writeInsight via this._kmStore.addRelation"
  - "9 passing unit tests at src/live-logging/ObservationWriter.test.js locking the EDGE-01 / EDGE-02 / D-04.1 / D-06 contracts"
affects:
  - src/live-logging/ObservationWriter.js (+125 / -4 lines — writeInsight signature extension, _emitMentionsEdges helper, ontologyClass guard)
  - src/live-logging/ObservationConsolidator.js (+156 / -35 lines — ObservationWriter+MentionsClassifier imports, _observationWriter handle, _ensureObservationWriter lazy getter, _pushInsightToKG body rewrite)
  - src/live-logging/ObservationWriter.test.js (NEW — 570 lines, 9 tests across 8 describe blocks)
tech-stack:
  added: []
  patterns:
    - "N-edge atomicity helper (_emitMentionsEdges) as a generalization of the 1-edge _anchorEntity pattern — same try/catch + benign-error stderr convention, same in-loop dedup-before-write shape from reprojectFromOnlineStore.ts:441-456 (PATTERNS Shared Pattern A)"
    - "Lazy getter for an externally-injectable handle (_ensureObservationWriter) — mirrors how the writer constructs the kmStore lazily when not externally supplied (Plan 44-12 pattern). Production passes nothing; tests inject a mock via options.observationWriter; the same one-call-cached return shape both paths produce"
    - "fail-fast classifier ordering (D-04.1) — classifyMentions runs BEFORE writeInsight so a proxy outage skips the write entirely; the write-then-edge-later alternative re-introduces the orphan-bleed window the phase is closing"
    - "callLog index assertion for in-loop ordering — mock kmStore records every op into a shared array; tests assert putEntity index < every mentions addRelation index < capturedBy addRelation index, locking the writer's try-block ordering structurally"
    - "Mock kmStore mirroring km-core legacyId-merge semantics — repeat putEntity with the same legacyId returns the same id, enabling Test 3's idempotency assertion (without this, every call would mint a new id and findRelations dedup would miss)"
    - "globalThis.fetch stubbing for two distinct downstream surfaces in one test (Test 7) — _ensureProjectAnchor's VKB HTTP PUT (D-06.1 keeps this path live; out-of-scope to migrate) AND classifyMentions' rapid-llm-proxy /api/complete call routed by URL substring match"
key-files:
  created:
    - "src/live-logging/ObservationWriter.test.js (570 lines, 9 tests, zero network)"
    - ".planning/phases/58-online-pipeline-semantic-edges-on-insights/58-02-SUMMARY.md (this file)"
  modified:
    - "src/live-logging/ObservationWriter.js (+125 lines: _emitMentionsEdges + writeInsight extension)"
    - "src/live-logging/ObservationConsolidator.js (+156 / -35 lines: imports + _observationWriter wiring + _pushInsightToKG rewrite)"
decisions:
  - "Preserved the writer's `if (!entity.ontologyClass)` guard literally — the plan's Task 1 step 2 wording locked this shape, and the consequence is that the mapper-supplied 'Insight' value survives instead of being clobbered to 'Detail'. Pre-Phase-58 every writeInsight call replaced the mapper's 'Insight' with 'Detail' (existing surface bug, not noticed because no test asserted ontologyClass). Post-Phase-58 writeInsight calls now produce entities with ontologyClass='Insight' — the correct label. NOTE: this does NOT propagate the consolidator's `entityClass` L2 classification (OnlineInsight etc.) through the mapper because `legacyInsightToEntity` HARDCODES both entityType='Insight' and ontologyClass='Insight' (see lib/km-core/src/adapters/legacy-ingest.ts line 347-348). The consolidator's `entityClass` survives in `row.metadata.ontology.classificationConfidence` as an audit trail; if a future plan needs the L2 class on the entity itself, the mapper must be extended to honor row.entityType / row.ontologyClass. The plan's `<interfaces>` block flagged this caveat (line 107 — 'verify the mapping and adjust the consolidator's row construction'); we documented and accepted it as out-of-scope."
  - "Resolved mintedId via `findByLegacyId({system:'A', id: entry.topic})` AFTER writeInsight returns rather than threading the writer's internal mintedId through the return value. Rationale: writeInsight returns `row.id` per its existing contract (the legacyId, not the km-core mint); changing that signature would break every existing caller (Plan 44-12 era). The lookup adds one extra kmStore call per Insight write but mirrors the established convention used by `_backfillProjectsInBatch` (line ~860) and other consolidator paths. The fail-fast `if (projectName && mintedId)` guard handles the rare case where the lookup returns null."
  - "Did NOT add a runId fields to ObservationWriter constructor — the writer auto-generates one in its constructor (`obs-writer-${Date.now()}-${rand}`). _ensureObservationWriter post-construction overrides `this._observationWriter._runId = this._runId` so the writer's provenance stamps trace back to the originating consolidation cycle. This is a controlled write to a documented private field; production km-core readers do not inspect runId values cross-instance."
  - "Test 5 (self-loop guard) pre-seeds the mock kmStore with the anchor entity (id='anchor-lsl-1') so the second-minted id is predictable as 'mock-ent-2'; the test passes that string as one of the mentionsTargetIds and asserts it's skipped. The deterministic id derivation comes from the mock's `mock-ent-${entities.size + 1}` pattern."
  - "Test 7 (consolidator route-through) builds a custom mock writer that sets `kmStore._entities.set(mintedId, {legacyId: {system:'A', id: row.id}})` so the consolidator's post-writeInsight `findByLegacyId` lookup resolves the minted id for the has_insight addRelation. Without this, the has_insight branch's `if (projectName && mintedId)` guard would skip and the test would fail; documenting this so future test authors understand why the mock writer mutates kmStore state."
  - "Did NOT modify the bridge backfill (_relinkOrphanOnlineInsights, line ~1962) — that's Plan 03's scope per D-06.2 ('Same backfill code path as D-05'). Plan 02 is targeted on `_pushInsightToKG` only; the bridge keeps its HTTP-PUT shape until Plan 03 migrates it alongside the one-shot backfill script."
  - "Stderr capture in Test 6 swaps `process.stderr.write` for an array-pushing stub inside a try/finally — same pattern used by Phase 57 LSL tests; ensures the original stream is restored even when assertions throw mid-test."
metrics:
  duration_min: 22
  total_tasks: 3
  completed_tasks: 3
  deferred_tasks: 0
  completed_date: 2026-06-15
  net_test_delta: 9
  net_loc_delta: 812
  commits:
    - "8ac47ccd6 feat(58-02): extend writeInsight with mentionsTargetIds + atomic edge emission"
    - "88e67463c refactor(58-02): route _pushInsightToKG through ObservationWriter.writeInsight"
    - "9a2c2b3d8 test(58-02): lock EDGE-01 / EDGE-02 / D-04.1 / D-06 contracts at unit level"
requirements:
  - EDGE-01
  - EDGE-02
---

# Phase 58 Plan 02: Writer-Path Unification + Atomicity Contract Summary

**One-liner:** Refactors `ObservationConsolidator._pushInsightToKG` to route every Insight write through `ObservationWriter.writeInsight` (D-06), extends `writeInsight` with an optional `options.mentionsTargetIds` parameter that emits N `mentions` edges in the same try-block as `putEntity` (EDGE-02 atomicity — the km-core JSON exporter's 5s debounce envelope batches node + all edges into one tick), preserves the `has_insight` project-anchor edge via a post-writeInsight `kmStore.addRelation` call, and inherits the capturedBy fix from commit `955617a1a` by construction (writeInsight calls `_anchorEntity` internally — every consumer including the consolidator gets it for free). 9 passing unit tests lock the contract; the consolidator no longer issues `fetch(PUT /api/entities/...)` or `fetch(POST /api/relations)` from `_pushInsightToKG`.

## What Shipped (Public Surface)

### `src/live-logging/ObservationWriter.js`

```javascript
// NEW helper — N-edge generalization of _anchorEntity (Plan 44-12 era)
async _emitMentionsEdges(kmStore, fromId, targetIds) {
  if (!fromId) return;
  if (!Array.isArray(targetIds) || targetIds.length === 0) return;
  for (const toId of targetIds) {
    if (!toId || toId === fromId) continue;   // self-loop guard
    try {
      const existing = await kmStore.findRelations({ from: fromId, to: toId, type: 'mentions' });
      if (Array.isArray(existing) && existing.length > 0) continue;   // dedup
    } catch (err) {
      process.stderr.write(`[ObservationWriter] mentions dedup probe ... failed (non-fatal): ${err.message}\n`);
    }
    try {
      await kmStore.addRelation({
        from: fromId,
        to: toId,
        type: 'mentions',
        metadata: {
          source: 'observation-writer',
          classifiedAt: new Date().toISOString(),
          classifier: 'llm-haiku',
        },
      });
    } catch (err) {
      process.stderr.write(`[ObservationWriter] mentions edge ${fromId}->${toId} failed (non-fatal): ${err.message}\n`);
    }
  }
}

// EXTENDED — accepts options.mentionsTargetIds
async writeInsight(row, options = {}) {
  if (!row || typeof row !== 'object') throw new Error('[ObservationWriter] writeInsight: row required');
  if (!row.id) throw new Error('[ObservationWriter] writeInsight: row.id required');
  const mentionsTargetIds = Array.isArray(options?.mentionsTargetIds) ? options.mentionsTargetIds : [];
  const kmStore = await this._ensureKmStore();
  const ts = row.created_at || new Date().toISOString();
  try {
    const entity = legacyInsightToEntity(row, this._runId, ts);
    if (!entity.ontologyClass) entity.ontologyClass = 'Detail';   // ← guard preserves mapper's 'Insight'
    entity.metadata = { ...entity.metadata, source: entity.metadata?.source ?? 'auto' };
    const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
    await this._emitMentionsEdges(kmStore, mintedId, mentionsTargetIds);   // ← NEW
    await this._anchorEntity(kmStore, mintedId);                            // ← unchanged
    return row.id;
  } catch (err) { /* unchanged */ }
}
```

### `src/live-logging/ObservationConsolidator.js`

```javascript
// NEW imports
import { ObservationWriter } from './ObservationWriter.js';
import { loadMentionCandidates, classifyMentions } from './MentionsClassifier.js';

// NEW constructor field
this._observationWriter = options.observationWriter || null;

// NEW lazy getter
_ensureObservationWriter() {
  if (this._observationWriter) return this._observationWriter;
  if (!this._kmStore) throw new Error('[ObservationConsolidator] cannot construct ObservationWriter ...');
  this._observationWriter = new ObservationWriter({ kmStore: this._kmStore, configPath: this.configPath });
  if (this._runId) this._observationWriter._runId = this._runId;
  return this._observationWriter;
}

// REFACTORED _pushInsightToKG body (no fetch, no inlined putEntity)
async _pushInsightToKG(entry) {
  if (!entry?.topic) return;
  if (!this._kmStore) throw new Error('[ObservationConsolidator] km-core not configured ...');
  const vkbUrl = process.env.VKB_API_URL || 'http://localhost:8080';
  const project = entry.project || 'coding';
  const { entityClass, confidence: classConf } = this._classifyInsightByOntology(entry.topic, entry.summary || '');
  const projectName = await this._ensureProjectAnchor(vkbUrl, project);

  // D-04 step 2 — classifier BEFORE write
  let mentionsTargetIds = [];
  try {
    const candidates = await loadMentionCandidates(this._kmStore);
    mentionsTargetIds = await classifyMentions(entry.summary || entry.topic, candidates);
  } catch (err) {
    process.stderr.write(`[Consolidator→KG] mentions classifier failed for ${entry.topic}: ${err.message}\n`);
    return;   // D-04.1 fail-fast — no half-Insight
  }

  // D-06 route-through
  const writer = this._ensureObservationWriter();
  const row = { /* { id, topic, summary, entityType, ontologyClass, team, source, metadata, ... } */ };
  let mintedId;
  try {
    await writer.writeInsight(row, { mentionsTargetIds });
    const persisted = await this._kmStore.findByLegacyId({ system: 'A', id: entry.topic });
    mintedId = persisted?.id || null;
  } catch (err) { /* swallow + log + return */ }

  // D-06 preserve — has_insight edge stays consolidator-side
  if (projectName && mintedId) {
    const projects = await this._kmStore.findByOntologyClass('Project');
    const projectId = projects.find((p) => p.name === projectName)?.id;
    if (projectId) {
      const existing = await this._kmStore.findRelations({ from: projectId, to: mintedId, type: 'has_insight' });
      if (existing.length === 0) {
        await this._kmStore.addRelation({
          from: projectId,
          to: mintedId,
          type: 'has_insight',
          metadata: { source: 'observation-consolidator', team: project, confidence: 1.0 },
        });
      }
    }
  }
}
```

## Test Surface (9 / 9 Passing, Zero Network)

| # | Behaviour Locked | Decision Closed |
|---|------------------|-----------------|
| 1 | Ordering inside writeInsight: putEntity index < every mentions addRelation index < capturedBy addRelation index (callLog assertion) | EDGE-02 atomicity (in-loop shape that feeds the 5s exporter-debounce envelope) |
| 2 | 3 mentions edges land on the store; each carries `metadata.source='observation-writer'` and a parseable ISO classifiedAt | EDGE-01 emission + threat T-58-02-04 traceability |
| 3 | Repeat writes do NOT multiply edges (findRelations dedup); the mock honors km-core legacyId-merge semantics so putEntity is identity-stable | D-04 / D-05 idempotency (PATTERNS Shared Pattern A) |
| 4 | `writeInsight(row, {mentionsTargetIds: []})` and `writeInsight(row)` both emit 0 mentions edges; capturedBy still fires (anchor-only baseline) | Empty-input safety + capturedBy preservation |
| 5 | When a mentionsTargetId equals the mintedId, it's skipped | Self-loop defense in depth |
| 6 | One target throws Target-not-found mid-loop; other targets still write; writer doesn't rethrow; stderr captures `[ObservationWriter] mentions edge ...->e2 failed (non-fatal)` | Benign-error handling per `_anchorEntity` precedent |
| 7 | Consolidator's `_pushInsightToKG` calls injected mock `observationWriter.writeInsight` with `mentionsTargetIds: ['e1','e2']` from classifier output AND emits the post-writeInsight `has_insight` addRelation | D-06 route-through path |
| 8 | When classifier throws (HTTP 500), mock writer's `writeInsight` is NEVER called (zero putEntity calls, zero mentions edges) | D-04.1 fail-fast (no half-Insight) |

Run: `node --test src/live-logging/ObservationWriter.test.js` → `tests 9 / pass 9 / fail 0` (suites 8 — Test 4 has two sub-cases inside one describe block).

## Verification Block (From Plan)

| Gate | Result |
|------|--------|
| `node --check src/live-logging/ObservationWriter.js` | exit 0 (PARSE OK) |
| `node --check src/live-logging/ObservationConsolidator.js` | exit 0 (PARSE OK) |
| `node --test src/live-logging/ObservationWriter.test.js` | exit 0 (9 / 9 pass) |
| `node --test src/live-logging/MentionsClassifier.test.js` (regression check) | exit 0 (10 / 10 pass — Plan 58-01 unaffected) |
| `grep -c "_emitMentionsEdges" src/live-logging/ObservationWriter.js` ≥ 2 | 3 hits (definition + JSDoc + call site) |
| `grep -cE "writeInsight\s*\(\s*row\s*,\s*options" src/live-logging/ObservationWriter.js` ≥ 1 | 1 (signature extended) |
| `grep -c "mentionsTargetIds" src/live-logging/ObservationWriter.js` ≥ 2 | 5 hits |
| `grep -cE "type:\s*['\"]mentions['\"]" src/live-logging/ObservationWriter.js` ≥ 1 | 3 hits |
| `grep -cE "findRelations\(\{[^}]*type:\s*['\"]mentions['\"]" src/live-logging/ObservationWriter.js` ≥ 1 | 1 hit (dedup probe) |
| `grep -cE "source:\s*['\"]observation-writer['\"]" src/live-logging/ObservationWriter.js` ≥ 1 | 3 hits |
| `grep -cE "if\s*\(\s*!entity\.ontologyClass\s*\)" src/live-logging/ObservationWriter.js` ≥ 1 | 1 hit |
| writeInsight ordering: putEntity → _emitMentionsEdges → _anchorEntity | VERIFIED via awk extract |
| `awk '/^  async _pushInsightToKG\(entry\) \{$/,/^  \}$/' src/live-logging/ObservationConsolidator.js \| grep -c "fetch("` == 0 | 0 (HTTP-PUT retired from method body) |
| Consolidator imports MentionsClassifier | 1 hit |
| `this._observationWriter` field present in consolidator constructor | 2 hits |
| `_ensureObservationWriter` definition + call site | 3 hits |
| `_pushInsightToKG` body calls `writer.writeInsight` | 1 hit |
| `_pushInsightToKG` body calls `classifyMentions` | 1 hit |
| `_pushInsightToKG` body passes `mentionsTargetIds` | 4 hits |
| `_pushInsightToKG` body preserves entityClass/classConf/projectName locals | 10 hits |
| `_pushInsightToKG` body emits `this._kmStore.addRelation` | 1 hit (the post-writeInsight has_insight) |
| `_pushInsightToKG` body has `type: 'has_insight'` | 2 hits |
| `_pushInsightToKG` body does NOT inline `kmStore.putEntity` | 0 hits |
| call-site swallow `try { await this._pushInsightToKG(entry); } catch { /* swallowed */ }` byte-identical | 1 hit (preserved) |
| `console.*` calls outside comments — ObservationWriter | 0 |
| `console.*` calls outside comments — ObservationConsolidator | 0 |
| `console.*` calls outside comments — ObservationWriter.test.js | 0 |
| Test file contains `callLog` references | 20 hits |
| Test file contains EDGE-02 / atomicity narrative | 13 hits |
| Test file contains `classifyMentions` stub | 5 hits |
| Test file contains fail-fast / D-04.1 narrative | 8 hits |
| Test file contains `observationWriter` references | 4 hits |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Test 3 (idempotency) initially failed because mock kmStore minted a fresh id per putEntity call**

- **Found during:** First Task 3 test run
- **Issue:** The initial mock kmStore's `putEntity` always minted a new id (`mock-ent-${entities.size + 1}`) regardless of legacyId, so the second `writeInsight` call produced a different `fromId` than the first. The writer's `findRelations({from: newId, to: 'e1', type: 'mentions'})` dedup probe returned empty (no edge for the new from id) → wrote a second mentions edge → Test 3 assertion failed with `2 !== 1`.
- **Root cause:** The mock did not mirror km-core's actual `putEntity` semantics, which merge on `legacyId` (a row with `legacyId.id='topic-foo'` returns the same minted id on every call after the first).
- **Fix:** Updated the mock's `putEntity` to scan for an existing entity with matching `legacyId.{system,id}` and return its id when found. This is the canonical km-core behavior; the mock previously deviated from it silently.
- **Files modified:** `src/live-logging/ObservationWriter.test.js` (8-line addition to the mock's putEntity)
- **Commit:** part of `9a2c2b3d8` (test commit was iterated, not re-committed separately)
- **Why Rule 1, not Rule 3:** The bug was in the test fixture (which I authored in this task), not a blocker on production code. Strictly, this is a fixture defect surfaced by the test running against it. Tracking under Rule 1 because the assertion correctly identified that "the writer's dedup probe will fail against a non-km-core-spec kmStore" — fixing the fixture (not the writer) is the right answer.

### Architectural Decisions

**1. legacyInsightToEntity hardcodes ontologyClass='Insight' — consolidator's L2 classification does NOT propagate to the entity**

- **Plan expectation** (line 107 of 58-02-PLAN.md): "The consolidator's row payload MUST be shaped so that legacyInsightToEntity produces an Entity whose `entityType` / `ontologyClass` are the consolidator's `entityClass` local — verify the mapping and adjust the consolidator's row construction"
- **Reality on disk** (`lib/km-core/src/adapters/legacy-ingest.ts` line 347-348): The mapper hardcodes `entityType: 'Insight'` and `ontologyClass: 'Insight'`, ignoring `row.entityType` / `row.ontologyClass`. The plan's expectation cannot be satisfied without changing the mapper.
- **Decision** (in scope of Plan 02): Follow the plan's Task 1 step 2 wording literally — apply the `if (!entity.ontologyClass)` guard to preserve whatever the mapper sets. Since the mapper always sets `ontologyClass='Insight'`, the post-Plan-02 effect is that every writeInsight call produces entities with `ontologyClass='Insight'` (correct) instead of the pre-Plan-02 `ontologyClass='Detail'` (wrong — was clobbered by the writer). The consolidator's `entityClass` (OnlineInsight etc.) is preserved in `row.metadata.ontology.classificationConfidence` as an audit trail.
- **Why not architectural Rule 4:** Extending the mapper to honor `row.entityType` / `row.ontologyClass` is a non-trivial change to the canonical `legacy-ingest` adapter (Plan 44-12 era), affects three writer entry points (writeObservation / writeDigest / writeInsight), and may surface other callers who relied on the hardcoded 'Insight'. Out-of-scope for Plan 02. The plan's `<interfaces>` block already flagged this caveat. Documenting and accepting it is the correct trade-off; if the L2 class on the entity itself becomes load-bearing later, a follow-up plan extends the mapper.
- **Acceptance impact:** EDGE-01 (mentions edges) and EDGE-02 (atomicity) are unaffected — the edges fire regardless of which ontologyClass is set on the node. The semantic question "does the Insight know its L2 class" is independent of "does the Insight have its mentions edges".

### Auth Gates

None. Tests stub `globalThis.fetch` for both the rapid-llm-proxy `/api/complete` call AND the consolidator's `_ensureProjectAnchor` VKB HTTP PUT (D-06.1 keeps that VKB path live; the test verifies route-through ordering, not the VKB-write semantics).

## Threat Surface

No new threat surface beyond what the plan's `<threat_model>` documents.

- **T-58-02-01 (Tampering — classifier output → addRelation)** → mitigated by Plan 58-01's `extractMentionsFromLLMResponse` closed-set guard (passed through unchanged) PLUS Plan 02's `_emitMentionsEdges` self-loop guard (`toId === fromId` skip) and benign Source/Target-not-found handling.
- **T-58-02-02 (Tampering — concurrent reader sees orphan Insight)** → Test 1 callLog assertion locks the in-loop ordering (putEntity → mentions×N → capturedBy) that feeds the km-core JSON exporter's 5s debounce envelope. A concurrent `/api/v1/entities` reader sees either the pre-write state OR the post-write state (node + all edges) but never an intermediate orphan-Insight state.
- **T-58-02-03 (DoS — writer fails on every Insight if LLM proxy down)** → Test 8 confirms D-04.1 fail-fast structurally: when classifier throws, writeInsight is NEVER called. Trade-off accepted: no Insight progress until proxy recovers, but no half-Insight pollution either.
- **T-58-02-04 (Repudiation — metadata.source ambiguity)** → Test 2 asserts `metadata.source='observation-writer'` on every writer-path mentions edge; the consolidator's post-writeInsight has_insight edge stamps `source='observation-consolidator'`. Plan 03's backfill paths will stamp `'backfill-insight-mentions'` and `'consolidator-bridge'` — three distinct writers, three distinct strings, full traceability.
- **T-58-02-SC (Supply-chain — npm package installs)** → No new package installs. Verified: `git diff --stat HEAD~3 HEAD package.json` shows 0 changes; the test file imports only Node built-ins (`node:test`, `node:assert/strict`) and project modules (`./ObservationWriter.js`, `./ObservationConsolidator.js`, `./MentionsClassifier.js`).

## Known Stubs

None. The writer-path and consolidator changes both wire live data flows end-to-end. The `_pushInsightToKG` method writes real Insights with real mentions edges + has_insight + capturedBy as soon as the consolidator runs in production. No placeholder data, no UI components, no TODOs.

## TDD Gate Compliance

This plan uses `type="auto" tdd="true"` for Task 3 (test) and `type="auto"` (non-TDD) for Tasks 1+2 (implementation). The commit sequence:

- `8ac47ccd6 feat(58-02)` — writeInsight extension (implementation first; the writer is new behavior — no prior test could fail)
- `88e67463c refactor(58-02)` — consolidator refactor (implementation)
- `9a2c2b3d8 test(58-02)` — locking tests written AFTER the implementation

Strict RED→GREEN→REFACTOR was not the contracted sequence per the plan's task types — Tasks 1+2 are `type="auto"` (write, verify with grep gates, commit), Task 3 is `tdd="true"` but ran against already-shipped implementation rather than against a missing-implementation state. Tests are passing on first run (with one Rule 1 fixture fix during Task 3) and lock the behaviour the plan demanded. This matches the plan's `<verify>` block at the Task level (`node --check` for Tasks 1+2, `node --test` for Task 3); no plan-level TDD frontmatter (`type: tdd`) demanded the RED-first sequence at the plan level.

## Self-Check: PASSED

- File `src/live-logging/ObservationWriter.js` exists: FOUND
- File `src/live-logging/ObservationConsolidator.js` exists: FOUND
- File `src/live-logging/ObservationWriter.test.js` exists: FOUND
- Commit `8ac47ccd6` exists: FOUND
- Commit `88e67463c` exists: FOUND
- Commit `9a2c2b3d8` exists: FOUND
- `node --check src/live-logging/ObservationWriter.js` exit 0: VERIFIED
- `node --check src/live-logging/ObservationConsolidator.js` exit 0: VERIFIED
- `node --test src/live-logging/ObservationWriter.test.js` 9 / 9 pass: VERIFIED
- `node --test src/live-logging/MentionsClassifier.test.js` 10 / 10 pass (no regression on Plan 58-01): VERIFIED
- All grep gates in plan's `<acceptance_criteria>` and `<verification>` blocks pass: VERIFIED
- No new console.* in any modified file: VERIFIED
- Call-site swallow at line ~1745 preserved byte-identical: VERIFIED
- No untracked files left behind in `src/live-logging/`: VERIFIED (`git status --short` clean post-commit)
- No file deletions in any commit: VERIFIED (`git diff --diff-filter=D --name-only HEAD~3 HEAD` empty)
