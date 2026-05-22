---
phase: 40-ingest-pipeline-layered-dedup
verified: 2026-05-22T07:45:00Z
status: gaps_found
score: 3.5/4 success criteria verified (SC#4 partial-by-design per D-45)
overrides_applied: 0
gaps:
  - truth: "CR-01: IngestPipeline.ingest() passes undefined into store.findByOntologyClass when entity lacks ontologyClass — LayeredDeduplicator's Pitfall-1 guard is bypassed at the pre-load layer"
    status: failed
    reason: "Pipeline calls findByOntologyClass(entity.ontologyClass ?? entity.entityType) at IngestPipeline.ts:198-200 BEFORE the deduplicator's defensive guard runs (LayeredDeduplicator.ts:136). When both are absent, findByOntologyClass(undefined) silently returns empty and duplicates can be written. Surfaced in 40-REVIEW.md as BLOCKER #1."
    artifacts:
      - path: "/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts"
        issue: "Lines 198-200 — no guard before findByOntologyClass call; depends on a runtime invariant that's not asserted"
    missing:
      - "Assert entity.entityType is a non-empty string before findByOntologyClass, or hoist LayeredDeduplicator's Pitfall-1 guard into the pipeline"
  - truth: "CR-02: candidate.id === entity.id self-identity guard in all 3 matchers is dead code on the happy path AND actively wrong on the legacy-id re-extraction path"
    status: failed
    reason: "JaccardNameMatcher.ts:53, CosineEmbeddingMatcher.ts:123, LLMSemanticMatcher.ts:132 — pipeline calls dedup BEFORE putEntity, so input entity.id is either freshly-minted (never collides) or unset. The guard only ever matches when an extractor re-emits a previously-stored entity with the same id — at which point it INCORRECTLY skips the perfect match and a duplicate is written. Surfaced in 40-REVIEW.md as BLOCKER #2."
    artifacts:
      - path: "/Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts"
        issue: "Line 53 — `if (candidate.id === entity.id) continue;` — dead code on happy path; wrong on legacy-id re-extraction"
      - path: "/Users/Q284340/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts"
        issue: "Line 123 — same self-id guard"
      - path: "/Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts"
        issue: "Line 132 — same self-id guard"
    missing:
      - "Remove the candidate.id === entity.id guard or replace with a name/legacyId-tuple check that actually reflects 'this candidate is the entity itself'"
  - truth: "CR-03: parseDedupResponse throws raw SyntaxError on the bare-brace failure path — onError: 'throw' surfaces an opaque JSON.parse error to callers instead of a typed dedup error"
    status: failed
    reason: "LLMSemanticMatcher.ts:200-228 — the 5-stage unwrap's terminal JSON.parse can throw a raw SyntaxError. onError: 'skip' swallows it but writes a misleading 'match error' message; onError: 'throw' propagates the SyntaxError to the LayeredDeduplicator and out of IngestPipeline as a public error type. Surfaced in 40-REVIEW.md as BLOCKER #3."
    artifacts:
      - path: "/Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts"
        issue: "Lines 200-228 — terminal JSON.parse can throw raw SyntaxError; no graceful no-match fallback"
    missing:
      - "Wrap terminal JSON.parse in try/catch that returns { matches: [] } as the no-match fallback, or re-throw as a typed error in match()"
  - truth: "CR-04: IngestPipeline.runStage('extract') drops opts.provenance AND ignores domain — surface drift between ingest() and runStage('extract')"
    status: failed
    reason: "IngestPipeline.ts:288 declares the overload as `runStage(name: 'extract', input: string, opts: { provenance: ProvenanceStamp })` but the implementation on line 309 calls `this.extractor.extract(input as string, undefined)` — provenance is never used AND domain is hardcoded undefined, breaking parity with ingest() (line 181) which honors opts.domain. Callers using runStage('extract') for off-pipeline invocation lose domain scoping. Surfaced in 40-REVIEW.md as BLOCKER #4."
    artifacts:
      - path: "/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts"
        issue: "Lines 288, 298-309 — overload requires provenance (unused for extract) and ignores domain; ingest() honors domain so the two entry points diverge"
    missing:
      - "Either widen the runStage('extract') overload to accept `opts?: { domain?: string }` and drop the misleading provenance requirement, or thread opts.domain through to this.extractor.extract(input, opts?.domain)"
deferred:
  - truth: "SC#4 — no duplicated dedup code remains across A/B/C"
    addressed_in: "Phase 42"
    evidence: "Cross-repo note + ROADMAP: 'Co-exist mode (D-45) — A's ObservationConsolidator and B's WaveController are NOT modified by Phase 40. Phase 41 migrates A; Phase 42 migrates B; full SC#4 discharge at end of Phase 42.' B's `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` still exists on disk (verified). Phase 40 only ships the canonical library; deletion of duplicates is intentionally deferred."
human_verification:
  - test: "Build a 30-line example app at `~/Agentic/km-core/examples/custom-adapter.ts` that implements all 4 stage interfaces against an in-memory store and runs successfully"
    expected: "Example app compiles + runs to completion against the public-API barrel without forking pipeline code; demonstrates SC#1 directly. (Phase 41/42 production wiring also serves as proof, but the example is the canonical SC#1 manual verification per 40-VALIDATION.md line 93.)"
    why_human: "SC#1 requires a fresh consumer to try the API. The file `~/Agentic/km-core/examples/custom-adapter.ts` does not exist (verified) — the planner deferred this to manual verification, which has not yet been performed. Cannot be verified by grep alone — needs a human to write the example and confirm it runs."
  - test: "Decide whether the 4 BLOCKER findings from 40-REVIEW.md (CR-01..CR-04) gate the close of Phase 40 or are punted to a follow-up plan (e.g. 40-08-PLAN.md or a Phase 41 prerequisite)"
    expected: "Either (a) all 4 CR-* fixes land before Phase 41 begins consuming the API, or (b) accepted via VERIFICATION.md overrides with explicit deferral notes and follow-up issues filed"
    why_human: "All 4 BLOCKERS were surfaced by the code-review depth pass on 2026-05-22 AFTER the test suite went green. The implementation passes all 143 tests + build + tsc — these are correctness gaps the test suite does NOT cover (no fixture exercises the CR-01 missing-ontologyClass path; CR-02's legacy-id re-extraction case isn't tested; CR-03's onError: 'throw' SyntaxError isn't asserted; CR-04's runStage('extract') domain-drop isn't asserted). Human decision is whether to fix-before-merge or accept-with-deferral, and what guarantees Phase 41 / 42 / 43 need."
---

# Phase 40: Ingest Pipeline & Layered Dedup — Verification Report

**Phase Goal:** Define the 4-stage ingest-time consolidation framework (extract → dedup → store → synthesize) and the layered dedup pipeline (exact-name → embedding cosine → LLM semantic) in KM-Core, exposing pluggable stage hooks so A's digest/insight roll-up and B's wave-agents can both implement against the shared abstraction without code duplication.

**Verified:** 2026-05-22
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth (Success Criterion) | Status | Evidence |
| --- | ------------------------- | ------ | -------- |
| SC#1 | A developer can wire a new ingest adapter into KM-Core by implementing the four named stage interfaces and registering it — no fork required | ? UNCERTAIN — needs human | All 4 caller-pluggable interfaces exist: `Extractor` (pipeline/types.ts:73), `Synthesizer` (pipeline/types.ts:91), `EmbeddingClient` (CosineEmbeddingMatcher.ts:56), `LLMClient` (LLMSemanticMatcher.ts:62). `IngestPipeline` ctor is options-object (D-42). Package exports map exposes `./pipeline` + `./dedup` (package.json:16-23). BUT no example adapter exists at `~/Agentic/km-core/examples/custom-adapter.ts` — Phase 41/42/43 production wiring will serve as final proof. Human verification deferred per 40-VALIDATION.md line 93. |
| SC#2 | Running the layered dedup pipeline on a synthetic batch with a known exact-name + embedding-cosine + LLM-semantic collision catches all three at the correct layer in order | ✓ VERIFIED | `tests/integration/layered-dedup-collision-catch.test.ts` (1 test, T19) runs the canonical 3-collision batch: UserAuthService→Jaccard 1.0, CartCheckoutFlow→cosine 0.93, BillingService→LLM. LOAD-BEARING assertion `llmClient.complete.mock.calls.length === 1` proves both upper-layer short-circuits fired. All 3 entities have valid supersession chains via Phase 39 D-33. Test PASSED in single-file run (356ms) and as part of full suite (143 passed). |
| SC#3 | A user can choose which stages execute on what cadence per system (per ingest / per wave / cron) via configuration, with the framework enforcing the four-stage order | ✓ VERIFIED | `IngestOpts.skipStages?: StageName[]` (pipeline/types.ts:173) — opt-out, not reorder. Stage order is fixed in `ingest()` (IngestPipeline.ts:178/194/225/255). `IngestResult.skippedStages` echoes back canonicalized (IngestPipeline.ts:173). Pitfall-5 guard throws when skipStages includes 'extract' with non-empty text (IngestPipeline.ts:159-163). `runStage()` 4-overload form for off-pipeline invocation (IngestPipeline.ts:287-294). T13/T14 cover the contract. |
| SC#4 | Shared dedup pipeline reuses B's existing fuzzy-name Jaccard logic and A's embedding-cosine logic as plug-in implementations — no duplicated dedup code remains across A/B/C | ⚠️ PARTIAL — deferred to Phase 42 per D-45 co-exist mode | First half VERIFIED: JaccardNameMatcher is a verbatim port from B (`integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts:436-445`), see attribution in JaccardNameMatcher.ts:65-69. CosineEmbeddingMatcher is a verbatim port from A's `scripts/dedup-insights-by-embedding.js:56-64`. Second half DEFERRED: B's `deduplication.ts` still exists on disk (verified) — its deletion is intentionally deferred to Phase 42 per cross_repo_note + D-45 co-exist mode. ROADMAP entry confirms: "Phase 41 migrates A; Phase 42 migrates B; full SC#4 discharge at end of Phase 42." |

**Score:** 3 / 4 fully verified; 1 partial-by-design (SC#4, deferred to Phase 42); 1 success criterion needs human verification (SC#1 example app).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/pipeline/types.ts` | Public type surface (Extractor, Synthesizer, PhaseCallback, IngestResult, IngestOpts, IngestPipelineOpts, StageName, Deduplicator) | ✓ VERIFIED | 224 lines; all 8 types exported; D-42, D-43, CF-D30, D-46 annotations present |
| `src/pipeline/IngestPipeline.ts` | 4-stage orchestrator class, options-object ctor, runStage 4-overload | ✓ VERIFIED | 358 lines; class implements all 4 stages in fixed order; runStage 4 overloads typed per StageName; CF-D30 provenance-required guard at line 151 |
| `src/pipeline/index.ts` | Sub-barrel exporting IngestPipeline + all public types | ✓ VERIFIED | Exports IngestPipeline + 7 types from types.ts |
| `src/dedup/types.ts` | Layer interfaces (ExactNameLayer, EmbeddingLayer, LLMSemanticLayer), MatchResult, DedupResult, type-only EmbeddingClient/LLMClient re-exports | ✓ VERIFIED | 141 lines; D-44 contract documented; type-only re-exports from matcher files at lines 139-140 |
| `src/dedup/JaccardNameMatcher.ts` | implements ExactNameLayer, threshold default 0.85, verbatim port from B's deduplication.ts:436-445 | ✓ VERIFIED | 77 lines; `class JaccardNameMatcher implements ExactNameLayer`; threshold default 0.85; verbatim port confirmed in source comment |
| `src/dedup/CosineEmbeddingMatcher.ts` | implements EmbeddingLayer, threshold default 0.90, verbatim port from A's dedup-insights-by-embedding.js:56-64 | ✓ VERIFIED | 156 lines; `class CosineEmbeddingMatcher implements EmbeddingLayer`; threshold default 0.90; verbatim port confirmed in source comment |
| `src/dedup/LLMSemanticMatcher.ts` | implements LLMSemanticLayer, threshold default 0.70, ports OKM's batchLLMDedup | ✓ VERIFIED | File exists; `class LLMSemanticMatcher implements LLMSemanticLayer`; threshold default 0.70; ports OKM lines 421-475 |
| `src/dedup/LayeredDeduplicator.ts` | 3-layer orchestrator with D-44 short-circuit, declared order, optional slots, Pitfall-1 guard | ✓ VERIFIED | 194 lines; iterates exactName→embedding→llmSemantic; shortCircuit default true; Pitfall-1 guard at lines 136-143; shortCircuit:false aggregation path at lines 178-191 |
| `src/dedup/index.ts` | Sub-barrel exporting 4 runtime classes + 7 types | ✓ VERIFIED | Exports LayeredDeduplicator + 3 matcher classes + 7 types |
| `src/index.ts` (Phase 40 append) | Root barrel exports IngestPipeline + LayeredDeduplicator + 3 matchers + 7 types | ✓ VERIFIED | Lines 91-122; all expected symbols re-exported from leaf files (IN-01 acceptable redundancy noted in REVIEW) |
| `package.json` exports map | `./pipeline` + `./dedup` sub-path entries with types + import targets | ✓ VERIFIED | Lines 16-23; both entries present mirroring Phase 38's `./ontology` precedent |
| `tests/unit/pipeline.test.ts` | IngestPipeline unit tests (T11-T18) | ✓ VERIFIED | 10 `test(` declarations (T11..T18 + 2 extras); single-file run PASSED |
| `tests/integration/pipeline-supersession.test.ts` | T20+T21 supersession + CR-01 legacy-id integration | ✓ VERIFIED | 4 `test(` declarations; PASSED |
| `tests/integration/pipeline-candidate-pool.test.ts` | T22 D-46 + Phase 39 D-34 active-only integration | ✓ VERIFIED | 4 `test(` declarations; PASSED |
| `tests/integration/layered-dedup-collision-catch.test.ts` | **SC#2 canonical test** (T19) | ✓ VERIFIED | 1 `test(` declaration; LOAD-BEARING `llmClient.complete.mock.calls.length === 1` asserted; PASSED |
| `examples/custom-adapter.ts` | Manual SC#1 verification — example app | ✗ MISSING | Directory `~/Agentic/km-core/examples/` does not exist; SC#1 manual verification deferred to Phase 41/42 production proof OR human writing the example |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| IngestPipeline.ingest() | LayeredDeduplicator.dedup() | this.deduplicator.dedup(entity, candidates) at line 201 | WIRED | Per-entity in Stage 2; receives D-46 candidate pool |
| IngestPipeline.ingest() Stage 3 | GraphKMStore.putEntity() | this.store.putEntity({ ...entity, supersedes }, { provenance }) at lines 232/238 | WIRED | Threads CF-D30 provenance; sets supersedes when dedup matched |
| IngestPipeline.ingest() Stage 2 candidate-pool pre-load | GraphKMStore.findByOntologyClass() | this.store.findByOntologyClass(ontologyClass) at line 200 | PARTIAL | Works in happy path; CR-01 (BLOCKER #1) — undefined argument flows through when entity lacks ontologyClass AND entityType |
| LayeredDeduplicator.dedup() | Layer.match() (3 layers) | layer.match(entity, candidates) at line 164 | WIRED | Iterates in declared order; short-circuit gate at line 166 |
| JaccardNameMatcher / CosineEmbeddingMatcher / LLMSemanticMatcher | (interfaces) ExactNameLayer / EmbeddingLayer / LLMSemanticLayer | `implements <Interface>` declarations | WIRED | All 3 matchers correctly implement the layer interfaces from src/dedup/types.ts |
| package.json exports | dist/pipeline/index.js, dist/dedup/index.js | exports map sub-paths | WIRED | dist/pipeline + dist/dedup both built (verified directory listing) |
| Root barrel src/index.ts | Sub-barrels (pipeline/index.ts, dedup/index.ts) | re-export | PARTIAL — IN-01 nit | Root barrel re-exports from leaf files instead of sub-barrels; functionally identical, manual sync risk acknowledged in REVIEW.md IN-01 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full vitest suite passes | `cd ~/Agentic/km-core && npx vitest run` | 17 files / 143 tests passed in 1.04s | ✓ PASS |
| TypeScript strict compile | `cd ~/Agentic/km-core && npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Production build | `cd ~/Agentic/km-core && npm run build` | exit 0; `dist/pipeline/*` + `dist/dedup/*` populated with .js + .d.ts | ✓ PASS |
| SC#2 canonical integration test | `npx vitest run tests/integration/layered-dedup-collision-catch.test.ts` | 1/1 passed in 356ms | ✓ PASS |
| Pipeline + integration tests pass | `npx vitest run tests/unit/pipeline.test.ts tests/integration/pipeline-supersession.test.ts tests/integration/pipeline-candidate-pool.test.ts` | 3 files / 18 tests passed in 427ms | ✓ PASS |
| Commit history matches phase | `git log --oneline \| grep "40-0"` | 16 commits found (feat + test for plans 01-07, matches Wave 0 RED/GREEN convention) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| PIPE-01 | 40-01, 40-06a, 40-06b, 40-07 | 4-stage ingest-time consolidation pipeline (extract → dedup → store → synthesize) defined in KM-Core | ✓ SATISFIED | IngestPipeline class + types + barrels + integration tests (T11-T22). SC#2 canonical test asserts cross-module supersession via Phase 39. REQUIREMENTS.md row marked Phase 40 — Pending (will flip to Complete on verifier pass once 4 CR-* gaps are decided). |
| DEDUP-01 | 40-01, 40-02, 40-03, 40-04, 40-05, 40-06b, 40-07 | Layered dedup pipeline (exact name → embedding cosine → LLM semantic) defined in KM-Core | ✓ SATISFIED | 3 matcher classes + LayeredDeduplicator + types + barrels. Jaccard ports B, Cosine ports A — layer reuse half of SC#4 verified. SC#2 + 6 unit tests for LayeredDeduplicator (T05-T10) + 3 matcher test files. REQUIREMENTS.md row marked Phase 40 — Pending. |

**Orphans:** None. REQUIREMENTS.md maps exactly PIPE-01 and DEDUP-01 to Phase 40; both are claimed across the 7 plans.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| `src/pipeline/IngestPipeline.ts:198-200` | CR-01: missing defensive ontologyClass guard before findByOntologyClass | 🛑 BLOCKER (REVIEW.md) | Silent duplicate writes when entity lacks ontologyClass + entityType — gaps section CR-01 |
| `src/dedup/JaccardNameMatcher.ts:53`, `CosineEmbeddingMatcher.ts:123`, `LLMSemanticMatcher.ts:132` | CR-02: candidate.id === entity.id self-id guard — dead/wrong | 🛑 BLOCKER (REVIEW.md) | Legacy-id re-extraction writes duplicates — gaps section CR-02 |
| `src/dedup/LLMSemanticMatcher.ts:200-228` | CR-03: parseDedupResponse throws raw SyntaxError on terminal path | 🛑 BLOCKER (REVIEW.md) | Opaque error in onError:'throw' mode — gaps section CR-03 |
| `src/pipeline/IngestPipeline.ts:288, 309` | CR-04: runStage('extract') drops domain, lies about provenance | 🛑 BLOCKER (REVIEW.md) | Surface drift between ingest() and runStage('extract') — gaps section CR-04 |
| (8 warnings + 5 info from REVIEW.md WR-01..WR-08, IN-01..IN-05) | various | ⚠️ Warning / ℹ️ Info | Documented in 40-REVIEW.md; non-blocking for goal achievement; surfaced here for visibility |

**Note:** No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, or `PLACEHOLDER` markers in any Phase 40 source files (verified by grep). The BLOCKER findings come from the code-review depth pass, not from debt-marker scan.

### Human Verification Required

#### 1. SC#1 example adapter

**Test:** Build a 30-line example app at `~/Agentic/km-core/examples/custom-adapter.ts` that implements all 4 stage interfaces (Extractor, Synthesizer, plus a Deduplicator slot — typically the canonical LayeredDeduplicator with one or more layer impls) against an in-memory GraphKMStore-equivalent and runs successfully.
**Expected:** Example compiles + runs to completion against the public-API barrel (no relative imports into internal files); demonstrates SC#1 directly without forking pipeline code.
**Why human:** SC#1 is explicitly listed as `Manual-Only` in 40-VALIDATION.md line 93. The directory `~/Agentic/km-core/examples/` does not exist on disk (verified). Either (a) write the example to discharge SC#1 immediately, or (b) accept the deferral and rely on Phase 41/42/43 adapter wiring as production proof.

#### 2. REVIEW.md BLOCKER disposition decision

**Test:** Decide whether the 4 BLOCKER findings (CR-01..CR-04) from `40-REVIEW.md` gate the close of Phase 40 or are punted to a follow-up plan (e.g. `40-08-PLAN.md` or a Phase 41 prerequisite gate).
**Expected:** Either (a) all 4 CR-* fixes land in a Phase 40 close-out plan before Phase 41 consumes the API surface, or (b) the deviations are accepted via `VERIFICATION.md` `overrides:` entries with explicit deferral rationale + follow-up issues filed.
**Why human:** All 4 BLOCKERS were surfaced by the standard-depth code review AFTER the test suite went green. The implementation passes all 143 tests, build, and tsc — these are correctness gaps the test suite does NOT cover (no fixture exercises CR-01's missing-ontologyClass path; CR-02's legacy-id re-extraction case isn't asserted; CR-03's `onError: 'throw'` SyntaxError isn't tested; CR-04's `runStage('extract')` domain-drop isn't asserted). The decision is whether to fix-before-merge or accept-with-deferral, and what contractual guarantees Phase 41/42/43 need.

### Gaps Summary

Phase 40 ships a clean, well-typed, well-tested 4-stage ingest framework + 3-layer dedup pipeline. The test suite is green (143/143), `tsc --strict` clean, build clean, and the SC#2 canonical 3-collision integration test PASSES with the LOAD-BEARING assertion that the LLM is called exactly once (proving short-circuit fires across both upper layers). PIPE-01 and DEDUP-01 are both satisfied at the artifact + key-link level.

**However**, the standard-depth code review (`40-REVIEW.md`) surfaced **4 BLOCKERS** that the test suite does NOT cover:
- **CR-01:** Missing ontologyClass defensive guard at the pipeline's candidate-pool pre-load
- **CR-02:** Wrong self-id guard in all 3 matchers (dead/wrong for legacy-id re-extraction)
- **CR-03:** Raw `SyntaxError` propagation from `parseDedupResponse` in `onError: 'throw'` mode
- **CR-04:** `runStage('extract')` drops `domain`, misleadingly requires `provenance`

These are correctness defects in the API that downstream phases (41/42/43) will rely on. None of them fail an existing test — they're sharp edges that need fixture coverage AND code fixes, OR explicit deferral with accept-overrides.

**SC#4 is partial by design** — D-45 co-exist mode keeps B's `deduplication.ts` and A's existing dedup scripts in place; deletion is deferred to Phase 42. This is explicitly called out in 40-VALIDATION.md Manual-Only table and the ROADMAP entry. Treated as deferred, not failed.

**SC#1 manual verification** has no example adapter on disk yet — needs human to either write the example or accept Phase 41/42/43 production wiring as the proof.

---

_Verified: 2026-05-22_
_Verifier: Claude (gsd-verifier, Opus 4.7 — 1M context)_
