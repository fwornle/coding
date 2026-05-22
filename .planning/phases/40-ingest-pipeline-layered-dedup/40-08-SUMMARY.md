---
phase: 40-ingest-pipeline-layered-dedup
plan: 08
subsystem: pipeline-orchestrator-gap-closure
tags: [pipeline, ingest, orchestrator, gap-closure, CR-01, CR-04, pitfall-1, runStage, PIPE-01]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/06a
    provides: IngestPipeline class — the defect site for both CR-01 and CR-04.
  - phase: 40-ingest-pipeline-layered-dedup/06b
    provides: integration tests + SC#2 canonical collision-catch test that must remain green post-fix.
  - phase: 40-ingest-pipeline-layered-dedup/07
    provides: barrel exports — surface remains byte-identical after CR-04 overload widening.

provides:
  - "src/pipeline/IngestPipeline.ts (amended) — CR-01 Pitfall-1 guard hoisted into the dedup pre-load loop; CR-04 runStage('extract') overload widened (drop provenance, add optional domain) and impl threads opts?.domain to extractor.extract."
  - "tests/unit/pipeline.test.ts (amended) — 2 new RED→GREEN tests pinning CR-01 + CR-04 against future regression."
  - "dist/pipeline/IngestPipeline.{js,d.ts} — regenerated; new overload + guard shipped."

affects:
  - 40-VERIFICATION.md gaps #1 (CR-01) and #4 (CR-04) — both closed.
  - 40-REVIEW.md BLOCKER findings CR-01 + CR-04 — both resolved.
  - Phase 41/42/43 consumers — runStage('extract') now safely accepts opts?.domain; ingest() and runStage stay parity-clean.
  - 40-09, 40-10, 40-11 — remaining gap-closure plans (CR-02 / CR-03 + WR-08 / SC#1 example).

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stderr-warn diagnostic channel only — `process.stderr.write('[km-core/pipeline] ...')` (no console.*); mirrors LayeredDeduplicator.ts:137 and segments/merge.ts:134-136 idiom."
    - "Pitfall-1 guard hoisted up one layer — the guard previously only ran inside LayeredDeduplicator.dedup() (after the candidate-pool pre-load); now also runs in IngestPipeline before findByOntologyClass."
    - "TypeScript function-overload polymorphism preserved — RESEARCH Q2 RESOLVED 4-overload form intact; only overload 1's parameter shape changes."

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts (+23/-7 lines — CR-01 guard block + CR-04 overload + impl widening)
    - /Users/Q284340/Agentic/km-core/tests/unit/pipeline.test.ts (+87 lines — 2 appended tests)

key-decisions:
  - "CR-01 fix uses [km-core/pipeline] stderr prefix (not [km-core/dedup]) — the pipeline owns the diagnostic since it owns the candidate-pool pre-load. LayeredDeduplicator's own [km-core/dedup] guard is unchanged and serves as defense-in-depth for the runStage('dedup') off-pipeline path where the pipeline guard does not fire."
  - "CR-04 widens the IMPLEMENTATION signature's opts parameter to optional, requiring all `opts.candidates` / `opts.provenance` / `opts.supersedes` references inside the dedup / store / synthesize branches to use the `opts?.candidates` / `opts?.provenance` / `opts?.supersedes` form. Throw messages remain byte-identical. Overloads 2, 3, 4 are byte-identical to pre-fix state."
  - "CR-04 test deliberately does NOT import or reference ProvenanceStamp — the test demonstrates that the misleading provenance requirement is gone. Acceptance criterion `grep -c provenance` inside the CR-04 test returns 0."
  - "Both BLOCKER fixes ship in a single km-core commit because they touch a single file (IngestPipeline.ts) — surgical edits at the two defect sites only; everything else byte-identical."

# Phase-40 close-gate context
gap_closure: true
requirements: [PIPE-01]

metrics:
  duration: "~10 min wall clock (1 RED test commit + 1 GREEN fix commit + 1 SUMMARY commit)"
  tasks: 3
  files_created: 1   # 40-08-SUMMARY.md
  files_modified: 2  # IngestPipeline.ts + pipeline.test.ts
  tests_added: 2
  tests_total_after: 145
  completed: "2026-05-22"
---

# Phase 40 Plan 08: CR-01 + CR-04 Gap Closure Summary

**One-liner:** Two surgical edits to `IngestPipeline.ts` close two BLOCKER findings from `40-REVIEW.md`: CR-01 hoists LayeredDeduplicator's Pitfall-1 guard into the pipeline (so `findByOntologyClass` is never called with `undefined`); CR-04 widens `runStage('extract')` to drop the misleading `provenance` requirement and thread caller-supplied `opts.domain` through to the extractor (parity with `ingest()`).

## What This Plan Delivered

### km-core commits

| Step | Subject | Hash |
|------|---------|------|
| Task 1 (RED) | `test(40-08): add RED tests pinning CR-01 + CR-04` | `1331568` |
| Task 2 (GREEN) | `fix(40-08): CR-01 hoist Pitfall-1 guard + CR-04 fix runStage('extract') domain/provenance drift` | `851ed8e` |

### coding/ commit (this SUMMARY)

`docs(40-08): summary — CR-01 + CR-04 closed in km-core IngestPipeline.ts`

## CR-01 — Verbatim Guard Block (post-fix)

From `~/Agentic/km-core/src/pipeline/IngestPipeline.ts` lines 197-213:

```typescript
for (const entity of entities) {
  const ontologyClass = entity.ontologyClass ?? entity.entityType;
  // CR-01 Pitfall-1 guard hoisted into the pipeline (mirrors
  // LayeredDeduplicator.ts:136-143). When BOTH ontologyClass and
  // entityType are falsy, findByOntologyClass would silently return []
  // and every input becomes net-new — a silent duplicate-write hazard.
  // Skip the dedup pre-load for this entity; net-new write at Stage 3
  // surfaces the missing-ontology via putEntity strict validation.
  if (!ontologyClass) {
    process.stderr.write(
      '[km-core/pipeline] entity ' +
        String(entity.id) +
        ' missing ontologyClass/entityType — skipping dedup\n',
    );
    dedupDecisions.push({ entity });
    continue;
  }
  // D-46 active-only candidate pool (Phase 39 D-34 default filter).
  const candidates = await this.store.findByOntologyClass(ontologyClass);
  // ...
}
```

**Behavior delta:** When an entity arrives with `entity.ontologyClass = undefined` AND `entity.entityType = ''` (or any other falsy combination), the pipeline:
- Does **not** call `store.findByOntologyClass(undefined)` (was: silent duplicate-write hazard).
- Emits a `[km-core/pipeline]` stderr-warn naming the entity id and the missing field.
- Records a `{ entity }` decision with no survivor — falls through to a net-new write at Stage 3.
- Continues processing the remaining entities (no early termination of the batch).

## CR-04 — Verbatim Overload + Implementation (post-fix)

### Overload 1 (widened) — `~/Agentic/km-core/src/pipeline/IngestPipeline.ts:302-303`

```typescript
/** Run only the extract stage. `provenance` is NOT needed (CR-04 fix); `opts.domain` threads through to extractor.extract. */
runStage(name: 'extract', input: string, opts?: { domain?: string }): Promise<Entity[]>;
```

### Implementation `case 'extract'` body — line 324

```typescript
case 'extract': {
  return this.extractor.extract(input as string, opts?.domain);
}
```

### Implementation signature (widened to accept `domain` + optional opts)

```typescript
async runStage(
  name: StageName,
  input: string | Entity | Entity[] | EntityId[],
  opts?: {
    provenance?: ProvenanceStamp;
    candidates?: Entity[];
    supersedes?: Map<EntityId, EntityId>;
    domain?: string;
  },
): Promise<Entity[] | DedupResult | void>
```

**Behavior delta:**
- `runStage('extract', text, { domain: 'coding' })` now threads `'coding'` into `extractor.extract(text, 'coding')` (was: hardcoded `undefined`, dropping caller's domain on the floor).
- `runStage('extract', text)` compiles (opts is optional); calls `extractor.extract(text, undefined)`.
- `provenance` is no longer required on the extract overload (the type was lying — extract doesn't use it).
- Overloads 2 (dedup), 3 (store), 4 (synthesize) are **byte-identical** to pre-fix — RESEARCH Q2 RESOLVED contract preserved.

## Invariants Preserved

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Overloads 2, 3, 4 unchanged | ✓ | `grep -cE "runStage\(name: '(dedup\|store\|synthesize)'"` returns 3, all signatures byte-identical |
| 4 typed runStage overloads still present | ✓ | `grep -cE "runStage\(name: '(extract\|dedup\|store\|synthesize)'"` returns 4 |
| No generic `runStage<T>` form | ✓ | `grep -cE "runStage<[A-Za-z_]"` returns 0 |
| Phase 39 boundary — no raw `store.batch` | ✓ | `grep -cE "store\.batch"` returns 0 |
| Matched-survivors-only synthesizer-input contract | ✓ | `grep -c 'dedupDecisions.filter((d) => d.survivor).map'` returns 1 |
| No-console-log gate | ✓ | `grep -cE 'console\.(log\|info\|warn\|error\|debug)'` returns 0 |
| Pre-existing 10 pipeline test names preserved | ✓ | All 10 VALIDATION-named tests still in `tests/unit/pipeline.test.ts` |
| Relative imports use .js suffix | ✓ | 0 violations |

## Test Counts + Build State

- **Before this plan:** 17 test files, 143 tests passing (end of Plan 40-07).
- **After this plan:** 17 test files, **145 tests passing** (+2 new pipeline tests pinning CR-01 + CR-04).
- **RED→GREEN proof:**
  - Pre-fix (RED state, `1331568`): `tests/unit/pipeline.test.ts` ran with 2 failed / 10 passed (12 total). Failures: `findSpy` called once with `''` (CR-01); `extractor.extract` last-called with `('sample text', undefined)` not `('sample text', 'coding')` (CR-04).
  - Post-fix (GREEN state, `851ed8e`): `tests/unit/pipeline.test.ts` runs 12/12 passed in 484ms.
- **TypeScript strict-mode (`npx tsc --noEmit`):** ✓ exit 0, no output.
- **Full suite (`npm test`):** ✓ exit 0; `Test Files 17 passed (17); Tests 145 passed (145)` in 905ms.
- **`npm run build`:** ✓ exit 0; `dist/pipeline/IngestPipeline.js` + `IngestPipeline.d.ts` regenerated.

## Acceptance Criteria — All Met

```
=== CR-01 guard present                              (==1)   1  ✓ "missing ontologyClass/entityType — skipping dedup"
=== CR-01 [km-core/pipeline] prefix                  (≥1)    2  ✓
=== CR-01 if (!ontologyClass) present                (==1)   1  ✓
=== CR-04 overload widened                           (==1)   1  ✓ "runStage(name: 'extract', input: string, opts?: { domain"
=== CR-04 extract case threads opts?.domain          (==1)   1  ✓
=== CR-04 no longer hardcodes undefined              (==0)   0  ✓
=== 4 typed runStage overloads still present         (≥4)    4  ✓
=== No generic runStage<T form                       (==0)   0  ✓
=== Phase 39 boundary preserved (no store.batch)     (==0)   0  ✓
=== Matched-survivors-only synth line                (==1)   1  ✓
=== Zero console.*                                   (==0)   0  ✓
=== Relative imports without .js suffix              (==0)   0  ✓
=== Total pipeline tests                             (==12)  12 ✓
=== Pipeline suite green                                     ✓
=== Full suite green                                 (≥145) 145 ✓
=== dist/pipeline/IngestPipeline.{js,d.ts}                   ✓ regenerated
```

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's Task 2 Step C noted that the implementation's existing `opts` references in the dedup / store / synthesize cases would need to be widened to `opts?.candidates` / `opts?.provenance` / `opts?.supersedes` form once `opts` became optional on the impl signature. That widening was applied as planned; throw messages stayed byte-identical.

## Phase 40 Close-Gate Status

**CR-01 + CR-04 closed.** Remaining gap-closure plans for Phase 40:

- **CR-02** → Plan **40-09** (self-id guard in 3 matchers — Jaccard / Cosine / LLMSemantic)
- **CR-03 + WR-08** → Plan **40-10** (parseDedupResponse hardening)
- **SC#1 example** → Plan **40-11** (`examples/custom-adapter.ts` write + manual run)

Phase 40 close gate flips to green when all 4 gap plans (08, 09, 10, 11) land.

## Self-Check

- ✓ `~/Agentic/km-core/src/pipeline/IngestPipeline.ts` exists and contains the CR-01 guard block + the widened CR-04 overload.
- ✓ `~/Agentic/km-core/tests/unit/pipeline.test.ts` exists with 12 `test(` declarations (was 10).
- ✓ `~/Agentic/km-core/dist/pipeline/IngestPipeline.js` + `.d.ts` exist after `npm run build`.
- ✓ km-core commit `1331568` exists: `test(40-08): add RED tests pinning CR-01 + CR-04`.
- ✓ km-core commit `851ed8e` exists: `fix(40-08): CR-01 hoist Pitfall-1 guard + CR-04 fix runStage('extract') domain/provenance drift`.
- ✓ Full vitest suite (145 tests) passes.
- ✓ `npx tsc --noEmit` strict-mode clean.

## Self-Check: PASSED

---

**Plans 40-09 + 40-10 + 40-11 can proceed independently — `IngestPipeline.ts` is now CR-01 + CR-04 clean.**
