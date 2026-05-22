---
phase: 40-ingest-pipeline-layered-dedup
verified: 2026-05-22T10:30:00Z
status: passed
score: 4/4 success criteria verified (SC#4 partial-by-design per D-45 — deferred to Phase 42)
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3.5/4
  gaps_closed:
    - "CR-01: IngestPipeline.ingest() passes undefined into store.findByOntologyClass — Pitfall-1 guard now hoisted into the pipeline (IngestPipeline.ts:199-213)"
    - "CR-02: candidate.id === entity.id self-id guard in all 3 matchers — removed (grep returns 0 hits across src/dedup/*.ts)"
    - "CR-03: parseDedupResponse throws raw SyntaxError — replaced with typed LLMDedupParseError + Contract A heuristic + candidate-list-of-tries unwrap (LLMSemanticMatcher.ts:65-75, 193-198, 289-327)"
    - "CR-04: runStage('extract') drops opts.provenance + ignores domain — overload widened to opts?: { domain?: string }; impl threads opts?.domain (IngestPipeline.ts:303, 325)"
    - "SC#1 human verification: examples/custom-adapter.ts does not exist — file now exists (139 lines) and the 3-test companion suite asserts end-to-end compile + run + import-discipline + D-44 source ordering"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "SC#4 — no duplicated dedup code remains across A/B/C"
    addressed_in: "Phase 42"
    evidence: "ROADMAP entry: 'Co-exist mode (D-45) — A's ObservationConsolidator and B's WaveController are NOT modified by Phase 40. Phase 41 (INT-01) migrates A; Phase 42 (INT-02) migrates B; full SC#4 discharge at end of Phase 42 when B's local Jaccard copy is deleted.' B's `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` still exists on disk (verified). Phase 40 only ships the canonical library; deletion of duplicates is intentionally deferred."
---

# Phase 40: Ingest Pipeline & Layered Dedup — Verification Report (re-verification)

**Phase Goal:** Define the 4-stage ingest-time consolidation framework (extract → dedup → store → synthesize) and the layered dedup pipeline (exact-name → embedding cosine → LLM semantic) in KM-Core, exposing pluggable stage hooks so A's digest/insight roll-up and B's wave-agents can both implement against the shared abstraction without code duplication.

**Verified:** 2026-05-22T10:30:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (4 BLOCKERS + SC#1 human-verify all closed)
**Verifier:** Claude (gsd-verifier, Opus 4.7 — 1M context)

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth (Success Criterion) | Status | Evidence |
| --- | ------------------------- | ------ | -------- |
| SC#1 | A developer can wire a new ingest adapter into KM-Core by implementing the four named stage interfaces and registering it — no fork required | ✓ VERIFIED | `examples/custom-adapter.ts` exists (139 lines). Imports ONLY from `@fwornle/km-core` (root barrel) — verified by reading lines 23-24 and the import-discipline test at `custom-adapter-example.test.ts:83-104`. Implements all 4 stage interfaces — Extractor (line 33), Synthesizer factory (line 59), EmbeddingClient (line 79), LLMClient (line 90). Wires LayeredDeduplicator in D-44 declared order (Jaccard 0.85 → Cosine 0.90 → LLM 0.70) — verified by source-ordering test at lines 106-118. Pipeline ctor uses D-42 options-object (line 123); ingest() called with `{ provenance, domain }` per D-43 (line 134-137). End-to-end runs produce `extractedCount=2, storedCount=2, mergedCount=0` — assertion passes. Self-symlink `node_modules/@fwornle/km-core → ../..` on disk so the test resolves the public-API barrel exactly like a downstream consumer. 3/3 SC#1 integration tests pass. |
| SC#2 | Running the layered dedup pipeline on a synthetic batch with a known exact-name + embedding-cosine + LLM-semantic collision catches all three at the correct layer in order | ✓ VERIFIED | `tests/integration/layered-dedup-collision-catch.test.ts` (1 test, T19) runs the canonical 3-collision batch: `UserAuthService → Jaccard 1.0`, `CartCheckoutFlow → cosine 0.93`, `BillingService → LLM`. LOAD-BEARING assertion `llmClient.complete.mock.calls.length === 1` (line 249, 251) proves both upper-layer short-circuits fired. All 3 entities have valid supersession chains via Phase 39 D-33 (lines 266-277). Test passes in isolated single-file run + full-suite run. |
| SC#3 | A user can choose which stages execute on what cadence per system (per ingest / per wave / cron) via configuration, with the framework enforcing the four-stage order | ✓ VERIFIED | `IngestOpts.skipStages?: StageName[]` (`pipeline/types.ts:173`) — opt-out, not reorder. Stage order locked in `ingest()` (IngestPipeline.ts:178/194/240/270). `IngestResult.skippedStages` echoes back canonicalized (line 173). Pitfall-5 guard throws when skipStages includes `'extract'` with non-empty text (lines 159-163). `runStage()` 4-overload form for off-pipeline invocation (lines 303-309). T13/T14 cover the contract. |
| SC#4 | Shared dedup pipeline reuses B's existing fuzzy-name Jaccard logic and A's embedding-cosine logic as plug-in implementations — no duplicated dedup code remains across A/B/C | ⚠️ PARTIAL — deferred to Phase 42 per D-45 co-exist mode | First half VERIFIED: JaccardNameMatcher is a verbatim port from B (`integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts:436-445`), attribution at JaccardNameMatcher.ts:71-75. CosineEmbeddingMatcher is a verbatim port from A's `scripts/dedup-insights-by-embedding.js:56-64` per header comment at CosineEmbeddingMatcher.ts:140-145. Second half DEFERRED: B's `deduplication.ts` still exists on disk (verified) — deletion intentionally deferred to Phase 42 per cross_repo_note + D-45 co-exist mode. ROADMAP entry confirms: "Phase 41 migrates A; Phase 42 migrates B; full SC#4 discharge at end of Phase 42." Counted as deferred, not failed (Step 9b — clear match against Phase 42 goal). |

**Score:** 4 / 4 success criteria fully verified at the Phase 40 contract level; SC#4 has a structurally deferred second half (deletion of B's local copy) intentionally pushed to Phase 42 per D-45.

### CR-* Gap Closure (re-verification of prior BLOCKERS)

| CR | Defect | Closure Site | Test Coverage | Status |
| -- | ------ | ------------ | ------------- | ------ |
| CR-01 | `IngestPipeline.ingest()` passed `undefined` to `findByOntologyClass` when entity lacks `ontologyClass` + `entityType` | IngestPipeline.ts:199-213 — `if (!ontologyClass)` guard emits `[km-core/pipeline]` stderr + `dedupDecisions.push({ entity })` + `continue`; `findByOntologyClass(undefined)` no longer reachable | pipeline.test.ts:398 — pins `findSpy.not.toHaveBeenCalled()` + stderr substring + still-stored count | ✓ CLOSED |
| CR-02 | `if (candidate.id === entity.id) continue;` in all 3 matchers — dead on happy path, wrong on legacy-id re-extraction | `grep -n "candidate.id === entity.id" src/dedup/*.ts` returns 0 hits. JaccardNameMatcher.ts:54-58 + CosineEmbeddingMatcher.ts:123-127 + LLMSemanticMatcher.ts:159-164 all carry the CR-02-fix comment block; LLMSemanticMatcher.ts:164 is now `const existingNames = candidates.map((c) => c.name)` without `.filter` | 3 RED→GREEN tests (one per matcher): `jaccard-matcher.test.ts:110`, `cosine-matcher.test.ts:102`, `llm-matcher.test.ts:235` — all named `CR-02: legacy-id re-extraction — same-id candidate matches itself` | ✓ CLOSED |
| CR-03 | `parseDedupResponse` could throw raw `SyntaxError` from terminal `JSON.parse`; `onError: 'throw'` surfaced opaque error | LLMSemanticMatcher.ts:65-75 exports typed `LLMDedupParseError extends Error` with `raw` + `cause` fields; match() lines 193-198 apply `response.content.includes('{')` heuristic (Contract A); parseDedupResponse rewritten lines 289-327 as discriminated `ParseDedupResult` union with candidate-list-of-tries (resolves WR-08 as a bonus) | llm-matcher.test.ts:288, 308, 346 — pin (1) tried-JSON+failed → stderr "parse error", (2) onError:throw → `instanceof LLMDedupParseError`, (3) prose-only silent no-match | ✓ CLOSED |
| CR-04 | `runStage('extract')` declared `provenance: ProvenanceStamp` requirement but never used it; impl hardcoded `domain: undefined` | IngestPipeline.ts:303 overload is now `runStage(name: 'extract', input: string, opts?: { domain?: string }): Promise<Entity[]>`; impl line 325 returns `this.extractor.extract(input as string, opts?.domain)`; overloads 2/3/4 byte-identical to pre-fix | pipeline.test.ts:457 — `runStage('extract', 'sample text', { domain: 'coding' })` asserts the domain reaches the extractor | ✓ CLOSED |
| SC#1 | `examples/custom-adapter.ts` did not exist; SC#1 only verifiable by writing example or accepting Phase 41/42 production wiring as proof | `examples/custom-adapter.ts` now exists (139 lines, see SC#1 row above) + companion test file 119 lines | custom-adapter-example.test.ts — 3 tests all pass | ✓ CLOSED |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/pipeline/types.ts` | Public type surface (Extractor, Synthesizer, PhaseCallback, IngestResult, IngestOpts, IngestPipelineOpts, StageName, Deduplicator) | ✓ VERIFIED | 224 lines; all types exported; D-42, D-43, CF-D30, D-46 annotations present |
| `src/pipeline/IngestPipeline.ts` | 4-stage orchestrator class, options-object ctor, runStage 4-overload, CR-01 + CR-04 fixed | ✓ VERIFIED | 375 lines (+17 from CR-01 + CR-04 fixes); class implements all 4 stages in fixed order; runStage 4 overloads typed per StageName; CR-01 guard at 199-213; CR-04 overload at 303 + impl threading at 325 |
| `src/pipeline/index.ts` | Sub-barrel exporting IngestPipeline + all public types | ✓ VERIFIED | 21 lines; exports IngestPipeline + 7 types from types.ts |
| `src/dedup/types.ts` | Layer interfaces (ExactNameLayer, EmbeddingLayer, LLMSemanticLayer), MatchResult, DedupResult, type-only EmbeddingClient/LLMClient re-exports | ✓ VERIFIED | 141 lines; D-44 contract documented; type-only re-exports at lines 139-140 |
| `src/dedup/JaccardNameMatcher.ts` | implements ExactNameLayer, threshold default 0.85, verbatim port from B's deduplication.ts:436-445, CR-02 self-id guard removed | ✓ VERIFIED | 83 lines; `class JaccardNameMatcher implements ExactNameLayer`; threshold default 0.85 line 49; verbatim port confirmed at lines 71-75; CR-02 fix comment + no self-id guard at lines 54-58 |
| `src/dedup/CosineEmbeddingMatcher.ts` | implements EmbeddingLayer, threshold default 0.90, verbatim port from A's dedup-insights-by-embedding.js:56-64, CR-02 self-id guard removed | ✓ VERIFIED | 161 lines; `class CosineEmbeddingMatcher implements EmbeddingLayer`; threshold default 0.90 line 109; verbatim port confirmed at lines 140-145; CR-02 fix comment at 123-127 |
| `src/dedup/LLMSemanticMatcher.ts` | implements LLMSemanticLayer, threshold default 0.70, ports OKM's batchLLMDedup, CR-02 + CR-03 closed | ✓ VERIFIED | 328 lines; `class LLMSemanticMatcher implements LLMSemanticLayer`; threshold default 0.70 line 147; ports OKM lines 421-475; CR-02 fix at 159-164; CR-03 typed-error class at 65-75; Contract A heuristic at 193-198; candidate-list unwrap at 289-327 |
| `src/dedup/LayeredDeduplicator.ts` | 3-layer orchestrator with D-44 short-circuit, declared order, optional slots, Pitfall-1 guard | ✓ VERIFIED | 194 lines; iterates exactName → embedding → llmSemantic; shortCircuit default true; Pitfall-1 guard at lines 130-143; shortCircuit:false aggregation path at lines 178-191 |
| `src/dedup/index.ts` | Sub-barrel exporting 4 runtime classes + 7 types | ✓ VERIFIED | 27 lines; exports LayeredDeduplicator + 3 matcher classes + 7 types |
| `src/index.ts` (Phase 40 append) | Root barrel exports IngestPipeline + LayeredDeduplicator + 3 matchers + 7 types | ✓ VERIFIED | Lines 91-122; all expected symbols re-exported from leaf files (IN-01 acceptable redundancy carried forward in REVIEW) |
| `package.json` exports map | `./pipeline` + `./dedup` sub-path entries with types + import targets | ✓ VERIFIED | Lines 16-23; both entries present mirroring Phase 38's `./ontology` precedent |
| `examples/custom-adapter.ts` | SC#1 reference adapter — implements all 4 stage interfaces via the public-API barrel | ✓ VERIFIED | 139 lines; imports only from `@fwornle/km-core` (lines 23-24); D-44-ordered LayeredDeduplicator wiring (lines 101-111); D-42 options-object ctor (line 123); D-43 ingest call (line 134-137) |
| `tests/unit/pipeline.test.ts` | IngestPipeline unit tests including CR-01 + CR-04 regression pins | ✓ VERIFIED | 484 lines; 12 `test(` declarations; CR-01 test at 398; CR-04 test at 457; single-file run passes |
| `tests/unit/jaccard-matcher.test.ts` | Jaccard layer tests including CR-02 legacy-id re-extraction | ✓ VERIFIED | 154 lines; 7 tests; CR-02 test at line 110 |
| `tests/unit/cosine-matcher.test.ts` | Cosine layer tests including CR-02 legacy-id re-extraction | ✓ VERIFIED | 169 lines; 7 tests; CR-02 test at line 102 |
| `tests/unit/llm-matcher.test.ts` | LLM layer tests including CR-02 + CR-03 + WR-08 | ✓ VERIFIED | 368 lines; 14 tests; CR-02 at 235, CR-03 typed-error at 308, CR-03 prose-only silent at 346, CR-03 stderr at 288, WR-08 fence-then-bail covered (Plan 40-10 SUMMARY confirms test at lines 329-344) |
| `tests/integration/pipeline-supersession.test.ts` | T20 + T21 supersession + CR-01 legacy-id integration | ✓ VERIFIED | 332 lines; tests pass |
| `tests/integration/pipeline-candidate-pool.test.ts` | T22 D-46 + Phase 39 D-34 active-only integration | ✓ VERIFIED | 282 lines; tests pass |
| `tests/integration/layered-dedup-collision-catch.test.ts` | **SC#2 canonical test** (T19) | ✓ VERIFIED | 287 lines; 1 test; LOAD-BEARING `llmClient.complete.mock.calls.length === 1` asserted at line 251; passes in single-file run + full suite |
| `tests/integration/custom-adapter-example.test.ts` | **SC#1 companion test** — compile + run + import-discipline + D-44 ordering | ✓ VERIFIED | 119 lines; 3 tests; all pass; reads example source to assert no relative imports + asserts Jaccard precedes Cosine precedes LLM in source |
| `dist/pipeline/*` + `dist/dedup/*` | Built artifacts present | ✓ VERIFIED | Both directories populated with `.js` + `.d.ts` + sourcemaps; root + sub-barrel indexes present in dist |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| IngestPipeline.ingest() | LayeredDeduplicator.dedup() | `this.deduplicator.dedup(entity, candidates)` at line 216 | WIRED | Per-entity in Stage 2; receives D-46 candidate pool |
| IngestPipeline.ingest() Stage 3 | GraphKMStore.putEntity() | `this.store.putEntity({ ...entity, supersedes }, { provenance })` at lines 247-249 / 253 | WIRED | Threads CF-D30 provenance; sets supersedes when dedup matched |
| IngestPipeline.ingest() Stage 2 candidate-pool pre-load | GraphKMStore.findByOntologyClass() | `this.store.findByOntologyClass(ontologyClass)` at line 215 | WIRED (CR-01 closed) | Guard at 199-213 prevents `findByOntologyClass(undefined)` — pipeline now skips dedup for guard-tripping entities and falls through to Stage 3 net-new write; CR-01 closed |
| LayeredDeduplicator.dedup() | Layer.match() (3 layers) | `layer.match(entity, candidates)` at line 164 | WIRED | Iterates in declared order; short-circuit gate at line 166 |
| JaccardNameMatcher / CosineEmbeddingMatcher / LLMSemanticMatcher | (interfaces) ExactNameLayer / EmbeddingLayer / LLMSemanticLayer | `implements <Interface>` declarations | WIRED | All 3 matchers correctly implement the layer interfaces from src/dedup/types.ts |
| LLMSemanticMatcher.match() | LLMDedupParseError | `throw new LLMDedupParseError(...)` at lines 195-198; `instanceof LLMDedupParseError` branch at line 213 | WIRED (CR-03 closed) | Typed error replaces raw SyntaxError; `onError: 'throw'` propagates the typed error; `onError: 'skip'` (default) catches + stderr-warns + returns no-match |
| IngestPipeline.runStage('extract') | Extractor.extract() | `this.extractor.extract(input as string, opts?.domain)` at line 325 | WIRED (CR-04 closed) | Overload accepts `opts?: { domain?: string }`; impl threads `opts?.domain` through; no misleading provenance requirement |
| `examples/custom-adapter.ts` | `@fwornle/km-core` (public-API barrel) | `import { ... } from '@fwornle/km-core'` at lines 23-24 | WIRED (SC#1 closed) | Self-symlink `node_modules/@fwornle/km-core → ../..` resolves; companion test asserts zero relative imports |
| package.json exports | dist/pipeline/index.js, dist/dedup/index.js | exports map sub-paths | WIRED | dist/pipeline + dist/dedup both built (verified directory listing) |
| Root barrel src/index.ts | Sub-barrels (pipeline/index.ts, dedup/index.ts) | re-export | PARTIAL — IN-01 nit (unchanged) | Root barrel re-exports from leaf files instead of sub-barrels; functionally identical, manual sync risk acknowledged in REVIEW.md IN-01 (carried forward from prior review; gap-closure plans intentionally did not address this) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full vitest suite passes | `cd ~/Agentic/km-core && npx vitest run` | 18 files / 153 tests passed in 1.34s | ✓ PASS |
| TypeScript strict compile | `cd ~/Agentic/km-core && npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Production build | `cd ~/Agentic/km-core && npm run build` | exit 0; `dist/pipeline/*` + `dist/dedup/*` populated with .js + .d.ts | ✓ PASS |
| SC#2 canonical integration test | `npx vitest run tests/integration/layered-dedup-collision-catch.test.ts` | 1/1 passed | ✓ PASS |
| SC#1 reference adapter end-to-end | `npx vitest run tests/integration/custom-adapter-example.test.ts` | 3/3 passed in 494ms | ✓ PASS |
| All Phase 40 unit + integration tests | `npx vitest run tests/unit/pipeline.test.ts tests/unit/{jaccard,cosine,llm}-matcher.test.ts tests/integration/{custom-adapter-example,layered-dedup-collision-catch}.test.ts` | 6 files / 44 tests passed in 477ms | ✓ PASS |
| `candidate.id === entity.id` removed from all matchers (CR-02) | `grep -n "candidate\.id === entity\.id" /Users/Q284340/Agentic/km-core/src/dedup/*.ts` | 0 hits | ✓ PASS |
| Phase 40 commit history present | `cd ~/Agentic/km-core && git log --oneline --all \| grep -E "(40-08\|40-09\|40-10\|40-11)"` | 8 commits found (RED + GREEN for plans 08-11) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| PIPE-01 | 40-01, 40-06a, 40-06b, 40-07, 40-08, 40-11 | 4-stage ingest-time consolidation pipeline (extract → dedup → store → synthesize) defined in KM-Core | ✓ SATISFIED | IngestPipeline class + types + barrels + integration tests (T11-T22) + CR-01 + CR-04 closure + SC#1 reference adapter. REQUIREMENTS.md row remains `Pending` — verifier intent is to flip to `Complete` once Phase 40 closes. |
| DEDUP-01 | 40-01, 40-02, 40-03, 40-04, 40-05, 40-06b, 40-07, 40-09, 40-10, 40-11 | Layered dedup pipeline (exact name → embedding cosine → LLM semantic) defined in KM-Core | ✓ SATISFIED | 3 matcher classes + LayeredDeduplicator + types + barrels + CR-02 + CR-03 closure + SC#1 reference adapter wires all 3 layers. Jaccard ports B, Cosine ports A — layer reuse half of SC#4 verified. SC#2 + 6 unit tests for LayeredDeduplicator (T05-T10) + 3 matcher test files. REQUIREMENTS.md row remains `Pending`. |

**Orphans:** None. REQUIREMENTS.md maps exactly PIPE-01 and DEDUP-01 to Phase 40; both are claimed across the 12 plans (including the 4 gap-closure plans 40-08..40-11). Recommend flipping both rows in REQUIREMENTS.md from `Pending` to `Complete` upon Phase 40 close.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| (none) | No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) in any Phase 40 source file | — | Grep verified: 0 hits |
| (carry-forward from REVIEW.md) | WR-01 (LayeredDeduplicator threshold re-check), WR-02 (LayeredDeduplicator cast in IngestPipeline), WR-03 (survivor! non-null), WR-04 (Date.now timing), WR-09 (example synthesizer never sees survivor IDs), IN-01..IN-04 | ⚠️ Warning / ℹ️ Info | Documented in 40-REVIEW.md; non-blocking for goal achievement; carry-forward from prior review since gap-closure plans were scoped only to BLOCKERS + SC#1 |

### Human Verification Required

None. All prior human-verification items are resolved:

1. **SC#1 reference adapter** — Plan 40-11 wrote `examples/custom-adapter.ts` + companion integration test. The example imports only from the public-API barrel and runs end-to-end against a real GraphKMStore. SC#1 is now provable by inspection + execution; no separate human pass required.

2. **REVIEW.md BLOCKER disposition decision** — All 4 CR-* BLOCKERS landed before Phase 40 close per gap-closure plans 40-08..40-11. The post-gap-closure REVIEW.md (status: `clean`, critical findings: 0) confirms genuine closure. No deferral decision needed.

### Re-verification Notes

- **Previous status:** `gaps_found` (3.5/4 SC, 4 BLOCKERS + 1 human-verify)
- **Re-verification mode:** All 4 previously-failed gaps quickly checked for genuine closure (not just nominal claim). Each closure verified via source-code grep + at-line read + isolated test run.
- **No regressions detected:** 143 → 153 tests (10 new tests from gap-closure RED→GREEN pairs); 17 → 18 test files (custom-adapter-example new). All prior tests still pass. `tsc --noEmit` clean; `npm run build` clean.
- **Phase 40 ROADMAP entry already marks all 12 plans as `[x]` complete** — verifier intent is to flip the REQUIREMENTS.md `Pending` rows to `Complete` upon close.
- **SC#4 second-half deferral is structurally correct** — Phase 42 ROADMAP entry confirms "B's local Jaccard copy is deleted" at end of Phase 42. Counted as deferred per Step 9b, not failed.

### Gaps Summary

**None.** All previously-found gaps are closed in code:

- **CR-01 (Pitfall-1 guard hoisted)** — IngestPipeline.ts:199-213 makes `findByOntologyClass(undefined)` unreachable; pinned by a RED→GREEN test asserting `findSpy.not.toHaveBeenCalled()` + stderr substring + post-skip storage count.
- **CR-02 (self-id guard removed)** — `grep -n "candidate.id === entity.id" src/dedup/*.ts` returns 0 hits; 3 RED→GREEN tests (one per matcher) assert the new legacy-id re-extraction contract directly.
- **CR-03 (typed LLMDedupParseError + Contract A)** — LLMSemanticMatcher.ts:65-75 exports the typed class; lines 193-198 apply the `'{'` heuristic; parseDedupResponse rewritten as discriminated `ParseDedupResult` union with candidate-list-of-tries (closes WR-08 as a bonus); 3 RED→GREEN tests pin (a) stderr "parse error" on tried-JSON-and-failed, (b) `instanceof LLMDedupParseError` in `onError:'throw'` mode (NOT `SyntaxError`), (c) prose-only silent no-match.
- **CR-04 (runStage('extract') parity)** — overload 1 is `runStage(name: 'extract', input: string, opts?: { domain?: string })`; impl threads `opts?.domain`; pinned by a RED→GREEN test asserting the domain reaches the extractor; overloads 2/3/4 byte-identical.
- **SC#1 (reference adapter)** — `examples/custom-adapter.ts` exists, imports only from `@fwornle/km-core`, wires all 3 dedup layers in D-44 declared order with canonical thresholds, and the 3-test companion suite asserts end-to-end runtime + import-discipline + source-ordering gates.

**SC#4 second-half** remains deferred to Phase 42 per D-45 co-exist mode — this is the only outstanding contractual obligation against the phase, and it is structurally addressed by the next milestone phase (Phase 42 deletes B's local Jaccard copy). Counted as deferred (Step 9b), not as a gap.

**Phase 40 is ready to close.** Remaining REVIEW.md warnings (WR-01..WR-04, WR-09, IN-01..IN-04) are non-blocking carry-forward items intentionally not addressed by the gap-closure plans; they belong to a future hardening pass or to consumers' acceptance windows in Phases 41/42/43.

---

_Verified: 2026-05-22T10:30:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 — 1M context)_
_Re-verification mode: full 3-level checks on previously-failed items; regression sanity on previously-passed items; 0 regressions detected._
