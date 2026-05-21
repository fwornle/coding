---
phase: 40
slug: ingest-pipeline-layered-dedup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Distilled from `40-RESEARCH.md` § Validation Architecture (line ~905). The full test design, including the SC#2 synthetic-batch fixture and the CR-01 legacy-id integration test, lives there.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 (pinned in `~/Agentic/km-core/package.json` — matches Phase 37/38/39) |
| **Config file** | `~/Agentic/km-core/vitest.config.ts` (already exists from Phase 37) |
| **Quick run command** | `cd ~/Agentic/km-core && npx vitest run tests/unit/<file>.test.ts` (per-file) |
| **Full suite command** | `cd ~/Agentic/km-core && npm test` (~92 tests pre-Phase-40 → ~115-120 tests post) |
| **Estimated runtime** | <30 seconds (Phase 39 baseline; Phase 40 adds ~20-25 unit + 3 integration tests) |

---

## Sampling Rate

- **After every task commit:** Run `cd ~/Agentic/km-core && npx vitest run tests/unit/<touched-file>.test.ts` (~3-5 seconds)
- **After every plan wave:** Run `cd ~/Agentic/km-core && npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green AND `cd ~/Agentic/km-core && npm run build` must complete clean (tsc strict, zero errors)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Populated from RESEARCH.md `## Validation Architecture` (line 917+). Plan IDs map to the planner's wave structure: 40-01 (types/fakes), 40-02 (Jaccard), 40-03 (Cosine), 40-04 (LLM), 40-05 (LayeredDeduplicator), 40-06 (IngestPipeline + integration tests), 40-07 (barrel).

| Test ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 40-T01 | 40-02 | 2 | DEDUP-01 | `JaccardNameMatcher.match()` returns expected scores for known fixture pairs | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/jaccard-matcher.test.ts -t "score"` | ❌ W0 | ⬜ pending |
| 40-T02 | 40-03 | 2 | DEDUP-01 | `CosineEmbeddingMatcher.match()` with fake `EmbeddingClient` returns expected scores | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/cosine-matcher.test.ts -t "score"` | ❌ W0 | ⬜ pending |
| 40-T03 | 40-04 | 2 | DEDUP-01 | `LLMSemanticMatcher.match()` with mock `LLMClient` parses fenced + raw JSON responses | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/llm-matcher.test.ts -t "json unwrap"` | ❌ W0 | ⬜ pending |
| 40-T04 | 40-04 | 2 | DEDUP-01 | `LLMSemanticMatcher` `onError: 'skip'` returns `{ matched: false }` on client throw | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/llm-matcher.test.ts -t "onError skip"` | ❌ W0 | ⬜ pending |
| 40-T05 | 40-05 | 3 | DEDUP-01 | Synthetic batch: known exact-name collision → caught by `exactName` layer first | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts -t "exact-name layer catches"` | ❌ W0 | ⬜ pending |
| 40-T06 | 40-05 | 3 | DEDUP-01 | Synthetic batch: known cosine collision (no exact match) → caught by `embedding` layer | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts -t "embedding layer catches"` | ❌ W0 | ⬜ pending |
| 40-T07 | 40-05 | 3 | DEDUP-01 | Synthetic batch: known semantic (no exact, no cosine) → caught by `llmSemantic` layer | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts -t "llm-semantic layer catches"` | ❌ W0 | ⬜ pending |
| 40-T08 | 40-05 | 3 | DEDUP-01 | Short-circuit: first-layer match prevents downstream layers from being called | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts -t "short-circuit on first match"` | ❌ W0 | ⬜ pending |
| 40-T09 | 40-05 | 3 | DEDUP-01 | `shortCircuit: false`: all layers run; best match across layers wins | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts -t "no-short-circuit aggregates"` | ❌ W0 | ⬜ pending |
| 40-T10 | 40-05 | 3 | DEDUP-01 | Omitting a layer slot skips that layer cleanly (no null deref) | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts -t "omitted layer"` | ❌ W0 | ⬜ pending |
| 40-T11 | 40-06 | 4 | PIPE-01 | 4 stages run in order `extract → dedup → store → synthesize` | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "stage order"` | ❌ W0 | ⬜ pending |
| 40-T12 | 40-06 | 4 | PIPE-01 | `onPhase` callback fires for each stage with `start` + `end` | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "onPhase observability"` | ❌ W0 | ⬜ pending |
| 40-T13 | 40-06 | 4 | PIPE-01 | `skipStages: ['synthesize']` runs the other 3, records in `IngestResult.skippedStages` | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "skipStages synthesize"` | ❌ W0 | ⬜ pending |
| 40-T14 | 40-06 | 4 | PIPE-01 | `skipStages: ['extract']` either throws or behaves spec-defined (RESEARCH Pitfall 5) | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "skipStages extract contract"` | ❌ W0 | ⬜ pending |
| 40-T15 | 40-06 | 4 | PIPE-01 | `runStage('synthesize', entities, opts)` runs synthesize standalone | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "runStage synthesize"` | ❌ W0 | ⬜ pending |
| 40-T16 | 40-06 | 4 | PIPE-01 | Pipeline threads caller's `provenance` to `store.putEntity` (never invents one) | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "provenance threading"` | ❌ W0 | ⬜ pending |
| 40-T17 | 40-06 | 4 | PIPE-01 | `IngestResult` shape matches `{ extractedCount, mergedCount, storedCount, durations: {...}, skippedStages }` | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "IngestResult shape"` | ❌ W0 | ⬜ pending |
| 40-T18 | 40-06 | 4 | PIPE-01 | Pipeline never invents a ProvenanceStamp; throws if caller omits `provenance` opt (CF-D30 enforcement) | unit | `cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts -t "provenance required"` | ❌ W0 | ⬜ pending |
| 40-T19 | 40-06 | 4 | PIPE-01 + DEDUP-01 | **SC#2 canonical:** 3-collision synthetic batch — `exactName` catches #1, `embedding` catches #2, `llmSemantic` catches #3, all in correct order with short-circuit proven via mock call counts | integration | `cd ~/Agentic/km-core && npx vitest run tests/integration/layered-dedup-collision-catch.test.ts -t "3-collision order"` | ❌ W0 | ⬜ pending |
| 40-T20 | 40-06 | 4 | PIPE-01 | Pipeline's `store` stage triggers Phase 39 D-33 supersession when survivor matched (active path) | integration | `cd ~/Agentic/km-core && npx vitest run tests/integration/pipeline-supersession.test.ts -t "supersedes via matched survivor"` | ❌ W0 | ⬜ pending |
| 40-T21 | 40-06 | 4 | PIPE-01 | **CR-01 boundary:** Pipeline supersession of a legacy-id predecessor uses Phase 39 CR-01 per-op `skipOntologyCheck` (does NOT throw) | integration | `cd ~/Agentic/km-core && npx vitest run tests/integration/pipeline-supersession.test.ts -t "CR-01 legacy predecessor"` | ❌ W0 | ⬜ pending |
| 40-T22 | 40-06 | 4 | PIPE-01 | Pipeline's `store` stage uses Phase 39 D-34 active-only filter when pre-loading candidates (D-46) | integration | `cd ~/Agentic/km-core && npx vitest run tests/integration/pipeline-candidate-pool.test.ts -t "active-only candidates"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `~/Agentic/km-core/tests/unit/_helpers/fakes.ts` — `FakeEmbeddingClient`, `MockLLMClient`, `BuildPipelineFixture`, `mkEntity`, `makeFakeExtractor`, `makeFakeSynthesizer`, `makeLayerStub`, `PROV` (created in Plan 40-01)
- [ ] `~/Agentic/km-core/tests/unit/jaccard-matcher.test.ts` — covers `JaccardNameMatcher` (3 tests)
- [ ] `~/Agentic/km-core/tests/unit/cosine-matcher.test.ts` — covers `CosineEmbeddingMatcher` (3 tests)
- [ ] `~/Agentic/km-core/tests/unit/llm-matcher.test.ts` — covers `LLMSemanticMatcher` (4 tests)
- [ ] `~/Agentic/km-core/tests/unit/layered-dedup.test.ts` — covers `LayeredDeduplicator` orchestration (6 tests)
- [ ] `~/Agentic/km-core/tests/unit/pipeline.test.ts` — covers `IngestPipeline` contract (7 tests + 1 provenance-required throw test)
- [ ] `~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts` — Phase 39 D-33 + CR-01 integration (2 tests)
- [ ] `~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts` — D-46 + Phase 39 D-34 integration (1 test)
- [ ] `~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` — **SC#2 canonical 3-collision test** (1 test, see RESEARCH.md line 960)

**Framework install:** None — vitest 4.0.18 already pinned in km-core.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC#1 ("a developer can wire a new adapter without forking pipeline code") | PIPE-01 | Requires a fresh consumer trying the API; not provable from inside km-core tests | After Phase 40 lands, build a 30-line example app in `~/Agentic/km-core/examples/custom-adapter.ts` that implements all 4 stage interfaces against an in-memory store and runs successfully. Phase 41/42/43 also serve as production proof. |
| SC#4 ("no duplicated dedup code remains across A/B/C") — partial discharge | DEDUP-01 | Full discharge requires Phase 42 (B migration); Phase 40 only ships the canonical library | Verify by inspection: after Phase 40, exactly one production implementation of Jaccard exists in `~/Agentic/km-core/src/dedup/JaccardNameMatcher.ts`. B's `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` still exists (deleted in Phase 42). Full SC#4 verification at end of Phase 42. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (verified by plan-checker against this map)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (9 new test files listed above)
- [ ] No watch-mode flags (`vitest run`, not bare `vitest`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (gate: flip after `npm test` green at end of Phase 40 execution)

**Approval:** pending (auto-flip to approved on `/gsd-verify-work` pass)
