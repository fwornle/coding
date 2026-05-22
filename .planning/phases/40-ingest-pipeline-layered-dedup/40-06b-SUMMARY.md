---
phase: 40-ingest-pipeline-layered-dedup
plan: 06b
subsystem: pipeline-integration-tests
tags: [pipeline, integration-tests, dedup, supersession, candidate-pool, SC#2, PIPE-01, DEDUP-01]
requires:
  - 40-01 # PROV / mkEntity / makeFakeExtractor / makeFakeSynthesizer / makeLayerStub
  - 40-02 # JaccardNameMatcher (used directly in SC#2)
  - 40-03 # CosineEmbeddingMatcher + makeFakeEmbeddingClient (used directly in SC#2)
  - 40-04 # LLMSemanticMatcher + makeMockLLMClient (used directly in SC#2)
  - 40-05 # LayeredDeduplicator (composed in every integration test)
  - 40-06a # IngestPipeline class on disk (the subject of all 3 integration files)
  - 39    # GraphKMStore.putEntity (D-33 closure) + findByOntologyClass (D-34 active-only) + batch (CR-01 per-op skipOntologyCheck)
provides:
  - "tests/integration/layered-dedup-collision-catch.test.ts — ROADMAP SC#2 verification (VALIDATION row 40-T19)"
  - "tests/integration/pipeline-supersession.test.ts — Phase 39 D-33 + CR-01 integration coverage (VALIDATION rows 40-T20, 40-T21)"
  - "tests/integration/pipeline-candidate-pool.test.ts — D-46 + Phase 39 D-34 active-only coverage (VALIDATION row 40-T22)"
affects:
  - "~/Agentic/km-core/tests/integration/ — three new test files, no source files touched"
  - "Plan 40-07 (barrel) — can now proceed; all cross-module boundary contracts are integration-test-verified"
tech-stack:
  added: [] # zero new deps — uses existing vitest 4.1.6 + helpers from Plans 40-01/03/04
  patterns:
    - "real GraphKMStore + tmpdir lifecycle (mirror of tests/integration/round-trip.test.ts)"
    - "stubbed layer matchers (makeLayerStub) for deterministic dedup verdicts in supersession + pool tests"
    - "real layer matchers (Jaccard + Cosine + LLM) for the SC#2 collision test"
    - "deterministic fake embedding vectors via Map<text, number[]> (40-PATTERNS offset 723-738)"
    - "fake LLM client returning a single static match (40-PATTERNS Pattern F)"
key-files:
  created:
    - "~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts (~287 lines, 11.7 KB)"
    - "~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts (~310 lines, 10.7 KB)"
    - "~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts (~268 lines, 8.6 KB)"
  modified: []
decisions:
  - "SC#2 LLM-call-count assertion uses BOTH `expect(llmClient.complete).toHaveBeenCalledTimes(1)` AND `expect((llmClient.complete as ...).mock.calls.length).toBe(1)` so the 40-06b-PLAN acceptance grep (`llmClient\\..*\\.calls\\.length`) matches verbatim while the first form keeps the test idiomatic."
  - "Synthetic embedding vectors are 5-dim unit vectors per axis-allocation table in the SC#2 test header — keeps cosines exact (0.93 vs CartCheckoutService; 0.40 vs PaymentProcessor; 0 elsewhere) so threshold comparisons are deterministic across runs."
  - "All three integration files use `vi.spyOn` on the real store / deduplicator rather than swapping in mocks — the goal is to verify the cross-module boundary contracts, so the store must be real."
  - "Supersession + candidate-pool tests stub the dedup layer via makeLayerStub instead of using the real JaccardNameMatcher; this keeps those tests immune to per-layer threshold tuning in later phases. Only the SC#2 test (which IS about real-matcher behavior) uses concrete matchers."
  - "CR-01 legacy-id test seeds the predecessor via `store.batch([{ type: 'putEntity', entity: { id: 'legacy-nanoid-xyz', ... }, skipOntologyCheck: true }])` — the same trusted-path pattern Phase 42's B-side migration uses (commit 44c1e9b reference in 39-REVIEW-FIX.md)."
metrics:
  duration: "~45 min wall clock (read existing source / fakes / pipeline contract; write 3 integration files; iterate to GREEN; verify)"
  tasks: 3
  files_created: 3
  files_modified: 0
  tests_added: 9
  tests_total_after: 143
  completed: "2026-05-22"
---

# Phase 40 Plan 06b: Cross-Module Boundary Integration Tests Summary

**One-liner:** Three integration test files exercise the IngestPipeline (Plan 40-06a) end-to-end against a real GraphKMStore, locking the four cross-module boundary contracts that the unit tests can't reach: ROADMAP SC#2 (synthetic 3-collision batch — 40-T19), Phase 39 D-33 supersession through the pipeline (40-T20), Phase 39 CR-01 legacy-id widening (40-T21), and Phase 39 D-34 active-only candidate-pool inheritance via Plan 40 D-46 (40-T22).

## What This Plan Delivered

### `tests/integration/layered-dedup-collision-catch.test.ts` (1 test, ~287 lines)

ROADMAP SC#2 contract — load-bearing for the Phase 40 verification gate.

**Setup:** 3 Component-class entities seeded via `store.putEntity`; extractor emits 3 new Component-class entities; LayeredDeduplicator composes `JaccardNameMatcher` (default 0.85 threshold) + `CosineEmbeddingMatcher` (default 0.90) + `LLMSemanticMatcher` (default 0.70) with fake embedding/LLM clients.

**Synthetic-batch design** (verbatim from 40-RESEARCH offset 960-976):

| Layer | Seeded survivor      | New entity             | Match reason                              |
| ----- | -------------------- | ---------------------- | ----------------------------------------- |
| 1     | `UserAuthService`    | `UserAuthService`      | Jaccard 1.0 ≥ 0.85 (identical word set)   |
| 2     | `CartCheckoutService`| `CartCheckoutFlow`     | Cosine 0.93 ≥ 0.90 (fake-embedding-tuned) |
| 3     | `PaymentProcessor`   | `BillingService`       | LLM returns explicit match (Jaccard 0, cosine 0.40 < 0.90) |

**Fake embedding vectors** are 5-dim unit vectors with axis allocation: axis 0 (CartCheckout), axis 1 (orthogonal padding for CartCheckoutFlow), axis 2 (UserAuthService), axis 3 (PaymentProcessor / BillingService primary), axis 4 (BillingService padding). Cosines fall out exactly: 0.93 vs CartCheckoutService, 0.40 vs PaymentProcessor, 0 elsewhere.

**Load-bearing assertion:**

```typescript
expect(llmClient.complete).toHaveBeenCalledTimes(1);
expect((llmClient.complete as ...).mock.calls.length).toBe(1);
```

This proves both upper-layer short-circuits fired correctly — entity #1 stopped at Jaccard, entity #2 stopped at cosine, only entity #3 fell through to the LLM. Without short-circuit, every entity would burn an LLM call.

**Phase 39 D-33 verification:** for ALL THREE layer verdicts, `getSupersessionChain(newId)` returns `[seed, new]` and each seed's `validUntil` is stamped to the new entity's `validFrom`. The LLM-layer match routes through the same `putEntity({...entity, supersedes: survivor.id})` codepath as the Jaccard and cosine matches — no special-casing per layer.

**SC#2 verification result:** Layered dedup collision test PASSED. `llmClient.complete.mock.calls.length === 1` (verified short-circuit through both upper layers). `mergedCount=3`, `storedCount=3`, `skippedStages=[]`.

### `tests/integration/pipeline-supersession.test.ts` (4 tests, ~310 lines)

Phase 39 D-33 atomic closure and CR-01 legacy-id widening exercised through the full pipeline.

| # | Test name                                                                                                          | Maps to        |
| - | ------------------------------------------------------------------------------------------------------------------ | -------------- |
| 1 | `'supersedes via matched survivor — predecessor closed atomically (Phase 39 D-33 verified)'`                       | **40-T20**     |
| 2 | `'CR-01 legacy predecessor — dedup match against legacy non-v7 id does NOT throw (Pitfall 2 verified)'`            | **40-T21**     |
| 3 | `'no-dedup-match — entity stored as net-new with provenance stamped'`                                              | extra coverage |
| 4 | `'getSupersessionChain returns predecessor + successor in validFrom order'`                                        | extra coverage |

**CR-01 verification result:** Phase 39 CR-01 path verified — `pipeline-supersession.test.ts` test `'CR-01 legacy predecessor'` passed; no throw on `legacy-nanoid-xyz` id supersession, and the predecessor's `validUntil` is set after the pipeline run, proving CR-01's per-op `skipOntologyCheck: true` widening keeps D-33's atomic closure batch self-consistent when the predecessor was originally stored on the trusted bulk-import path.

### `tests/integration/pipeline-candidate-pool.test.ts` (4 tests, ~268 lines)

D-46 candidate-pool sourcing through Phase 39 D-34's active-only default.

| # | Test name                                                                                                       | Maps to        |
| - | --------------------------------------------------------------------------------------------------------------- | -------------- |
| 1 | `'candidate pool scoped by ontologyClass — entities of different classes are not compared'`                     | extra coverage |
| 2 | `'candidate pool excludes superseded predecessors by default (Phase 39 D-34 inherited) — active-only candidates'` | **40-T22**     |
| 3 | `'entity with undefined ontologyClass falls back to entityType for pool lookup'`                                | extra coverage |
| 4 | `'empty candidate pool — dedup short-circuits to no-match'`                                                     | extra coverage |

**40-T22 verification result:** D-46 + D-34 active-only filter verified — `pipeline-candidate-pool.test.ts` test `'active-only candidates'` passed. After seeding predecessor A and superseding it with B via `store.putEntity({...B, supersedes: A.id})`, the pipeline's pre-loaded candidate pool for a new same-named entity contains only B; A is excluded.

## Acceptance Criteria — All Met

```
=== new GraphKMStore in supersession    (≥1)  1  OK
=== new GraphKMStore in candidate-pool  (≥1)  1  OK
=== skipOntologyCheck in supersession   (≥1)  4  OK
=== SC#2 / 3-collision / 3-collision-order (≥1)  7  OK
=== Layer matcher imports in SC#2       (≥3)  8  OK
=== llmClient .calls.length assertion   (≥1)  2  OK  (toHaveBeenCalledTimes + explicit .mock.calls.length)
=== getSupersessionChain in SC#2        (≥1)  4  OK
=== mergedCount/storedCount === 3       (==2) 2  OK
=== 40-T19 runnable                     PASS  Tests 1 passed (1)
=== 40-T20 runnable                     PASS  Tests 1 passed | 3 skipped
=== 40-T21 runnable                     PASS  Tests 1 passed | 3 skipped
=== 40-T22 runnable                     PASS  Tests 1 passed | 3 skipped
=== Zero src/ changes                   PASS  git status --porcelain src/ empty
=== npm run build                       PASS  tsc exit 0
=== npm test (full suite)               PASS  17 files / 143 tests
```

## Full-Suite Regression (Task 3)

```
> @fwornle/km-core@0.1.0 test
> vitest run

 Test Files  17 passed (17)
      Tests  143 passed (143)
   Start at  07:07:38
   Duration  1.31s
```

Before this plan: 14 files / 134 tests. After this plan: **17 files / 143 tests** (+3 integration files, +9 integration tests).

## Test Count Mapping

| File                                            | Tests | VALIDATION rows covered      |
| ----------------------------------------------- | ----- | ---------------------------- |
| `layered-dedup-collision-catch.test.ts`         | 1     | 40-T19 (SC#2)                |
| `pipeline-supersession.test.ts`                 | 4     | 40-T20, 40-T21 + 2 extras    |
| `pipeline-candidate-pool.test.ts`               | 4     | 40-T22 + 3 extras            |
| **Total new in 40-06b**                         | **9** | **40-T19, 40-T20, 40-T21, 40-T22** |

All 9 integration tests pass; total km-core suite is now 143 tests across 17 files.

## Commits Created (km-core repo)

```
7535f0f test(40-06b): SC#2 layered-dedup collision catch (VALIDATION row 40-T19)
307d427 test(40-06b): integration tests for supersession + candidate-pool
```

Two commits — Task 3 (full-suite regression check) introduced no file changes so produced no commit; the verification result is captured in this summary.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's acceptance grep for the LLM-call-count assertion uses the regex `llmClient\\..*\\.calls\\.length`. The idiomatic vitest form is `expect(llmClient.complete).toHaveBeenCalledTimes(1)`, which does NOT contain `.calls.length`. To satisfy both the idiomatic style and the grep, the SC#2 test now asserts both forms back-to-back — see the "decisions" entry in the frontmatter. This is a notation choice, not a deviation from the plan's intent.

## Self-Check

- OK `~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` exists (`ls -la` confirmed).
- OK `~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts` exists.
- OK `~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts` exists.
- OK Commit `307d427` (Task 1: supersession + candidate-pool tests) on km-core main.
- OK Commit `7535f0f` (Task 2: SC#2 collision test) on km-core main.
- OK `cd ~/Agentic/km-core && npx tsc --noEmit` → exit 0.
- OK `cd ~/Agentic/km-core && npm test` → 143 tests passed.
- OK `cd ~/Agentic/km-core && npm run build` → exit 0; `dist/` intact.
- OK `git status --porcelain src/` returns 0 lines — zero source files modified in 40-06b.

## Self-Check: PASSED

---

**Plan 40-07 (barrel) can now proceed.** All Phase 40 cross-module boundary contracts (ROADMAP SC#2, Phase 39 D-33 + CR-01 + D-34, Phase 40 D-46) are verified by passing integration tests. The IngestPipeline framework is ready for downstream Phase 41/42/43 consumers once the root barrel re-exports land in Plan 40-07.
