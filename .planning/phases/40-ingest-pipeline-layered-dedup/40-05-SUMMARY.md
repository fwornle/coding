---
phase: 40-ingest-pipeline-layered-dedup
plan: 05
subsystem: api
tags: [km-core, ingest-pipeline, dedup, layered-dedup, orchestrator, dedup-01, short-circuit, d-44, d-46, pitfall-1, tdd]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: src/dedup/types.ts (ExactNameLayer / EmbeddingLayer / LLMSemanticLayer / MatchResult / DedupResult) — the typed layer slots and aggregated verdict the orchestrator composes
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: src/pipeline/types.ts (Deduplicator structural contract) — LayeredDeduplicator satisfies it via structural typing (no `implements` keyword needed; consumer is IngestPipelineOpts.deduplicator in Plan 40-06)
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: tests/unit/_helpers/fakes.ts (makeLayerStub + mkEntity) — discriminated layer-stub factory used by all 9 orchestrator unit tests
  - phase: 40-ingest-pipeline-layered-dedup/02
    provides: JaccardNameMatcher (ExactNameLayer impl) — the canonical concrete impl wired into orchestrator's `exactName` slot at IngestPipeline composition time (Plan 40-06)
  - phase: 40-ingest-pipeline-layered-dedup/03
    provides: CosineEmbeddingMatcher (EmbeddingLayer impl) — wired into `embedding` slot at IngestPipeline composition time
  - phase: 40-ingest-pipeline-layered-dedup/04
    provides: LLMSemanticMatcher (LLMSemanticLayer impl) — wired into `llmSemantic` slot at IngestPipeline composition time

provides:
  - "src/dedup/LayeredDeduplicator.ts — 3-layer dedup orchestrator class (DEDUP-01 orchestrator). Exports `LayeredDeduplicator` + `LayeredDeduplicatorOpts`. Composes optional `exactName` / `embedding` / `llmSemantic` slots in declared cost-ascending order with D-44 short-circuit-on-first-match (default true) + Pitfall 1 defensive `[km-core/dedup]` stderr-warn guard."
  - "tests/unit/layered-dedup.test.ts — 9 unit tests covering the orchestrator's D-44 contract: per-layer catches, short-circuit default, shortCircuit:false aggregation (first-matched-wins policy), omitted slots, declared call order, no-match path, Pitfall 1 ontologyClass/entityType guard."

affects:
  - 40-06 (IngestPipeline class) — composes `LayeredDeduplicator` into `IngestPipelineOpts.deduplicator` via the structural `Deduplicator` contract from `src/pipeline/types.ts`. Plan 06 builds the 4-stage pipeline framework (extract → dedup → store → synthesize) around this orchestrator.
  - 40-07 (root barrel) — re-exports `LayeredDeduplicator` + `LayeredDeduplicatorOpts` from `src/dedup/LayeredDeduplicator.js` via `src/index.ts`; also wires the `./dedup` sub-path in `package.json` exports map.
  - 41 (A INT-01) — A's Phase 41 migration consumes the typed `Deduplicator` surface via the orchestrator class; A wires its concrete `EmbeddingClient` into the embedding slot at composition time.
  - 42 (B INT-02) — B's Phase 42 migration consumes the orchestrator with `exactName` only (B's domain doesn't run cosine/LLM layers).
  - 43 (C INT-03) — C's Phase 43 migration consumes the full 3-layer chain (exactName + embedding + llmSemantic) per OKM's existing 3-phase dedup ergonomics.

# Tech tracking
tech-stack:
  added: []  # pure composition over Plan 02/03/04 layer impls; no new runtime deps
  patterns:
    - "Options-object ctor with `?? default` fallback (CF-D14 + GraphKMStore precedent). `shortCircuit ?? true` — the load-bearing default per D-44 production behavior."
    - "Structural-contract satisfaction (Plan 40-01 Decision #1). LayeredDeduplicator satisfies `Deduplicator` from `src/pipeline/types.ts` via structural typing only — no `implements` keyword needed at the class declaration. Plan 40-06 wires it into `IngestPipelineOpts.deduplicator: Deduplicator`."
    - "Layered-iteration with `as const` narrowing (RESEARCH Example 1 line 310). The literal `'exactName' | 'embedding' | 'llmSemantic'` tuple narrows `name` to the `DedupResult.matchedLayer` discriminator union without a runtime cast."
    - "First-matched-wins policy in shortCircuit:false mode (Delta #5 in file header). `layerResults.find((r) => r.matched)` — even if a later layer reports higher confidence, the first matched layer in declared order wins. This keeps shortCircuit:false output deterministic and aligned with shortCircuit:true (same winner; only the audit trail differs)."
    - "Pitfall 1 defensive guard pattern. The orchestrator emits a `[km-core/dedup]` stderr-warn and returns `{ matched: false, allLayerResults: [] }` when the entity has neither `ontologyClass` nor `entityType` — defers the failure to `putEntity` strict validation downstream (the correct place to surface the missing-ontology error per RESEARCH line 213)."

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/dedup/LayeredDeduplicator.ts (193 LOC) — 3-layer dedup orchestrator. Header cites OKM `deduplicator.ts:53-322` with 5 deltas (typed layer slots / options-object ctor / shortCircuit opt / Pitfall 1 guard / first-matched-wins policy). Body: ctor sets fields + `this.shortCircuit = opts.shortCircuit ?? true`; `dedup()` runs the Pitfall 1 guard, iterates `[{exactName}, {embedding}, {llmSemantic}] as const`, pushes to `layerResults`, short-circuits on `this.shortCircuit && result.matched && result.confidence >= layer.threshold`, and falls through to `layerResults.find((r) => r.matched)` for the aggregation path. No `console.*`. All relative imports use `.js`.
    - /Users/Q284340/Agentic/km-core/tests/unit/layered-dedup.test.ts (397 LOC) — 9 unit tests using `makeLayerStub` + `mkEntity` from `_helpers/fakes.ts`. Covers the 6 Validation-Architecture-named tests + call-order assertion via `mock.invocationCallOrder` + Pitfall 1 stderr-spy assertion. No `console.*`. All relative imports use `.js`.
  modified: []  # plan is net-new files only — no existing km-core files touched

key-decisions:
  - "shortCircuit:false winner policy is first-matched-wins (locked here per Plan 05 instruction line 109): `layerResults.find((r) => r.matched)`. Tested explicitly with exactName conf 0.95 (first matched) + embedding conf 0.99 (second matched) — winner is exactName, not the higher-confidence embedding. Rationale: keeps the shortCircuit:false output consistent with shortCircuit:true (same winner; only the audit trail differs), avoids the trap where calibration runs would silently surface different match outcomes than production."
  - "Structural-typing-only satisfaction of `Deduplicator` from `src/pipeline/types.ts`. The class header does NOT declare `implements Deduplicator` — TypeScript's structural typing matches the `dedup(entity, candidates): Promise<DedupResult>` signature automatically. Avoids importing `Deduplicator` from `../pipeline/types.js` purely for the implements clause, which would couple the orchestrator to the pipeline module (the orchestrator currently has zero coupling to pipeline/types.ts). Plan 06 wires `new LayeredDeduplicator({...})` into `IngestPipelineOpts.deduplicator: Deduplicator` — TypeScript verifies the structural match there."
  - "Pitfall 1 defensive guard implemented EXACTLY per PATTERNS offset 253-260 + RESEARCH offset 210-214. The check is `if (!entity.ontologyClass && !entity.entityType)` — both fields must be falsy for the early-return to fire. This is correct per the Pitfall analysis: D-46 candidate pre-load needs at least one of these two fields to source candidates; an entity missing both cannot be deduped meaningfully. Returns `{ matched: false, allLayerResults: [] }` so downstream `putEntity` strict validation still throws on the missing ontology (per RESEARCH line 213 — that's the correct place to surface the error)."
  - "stderr-warn emission uses string concatenation (`'[km-core/dedup] entity ' + String(entity.id) + ...`) instead of template literals. Two reasons: (1) matches the broader Phase 37/38/39/40 stderr-warn convention (segments/merge.ts:134-136 uses concatenation; store/exporter.ts:112 too) and (2) defends against a footgun where `EntityId` is a branded type — interpolation through `String()` coerces explicitly without relying on the brand's `toString` behavior."
  - "Test count baseline updated: post-Plan-40-04 was 115 / 12; post-Plan-40-05 is 124 / 13. The 9 new orchestrator tests + 1 new test file land cleanly with zero regression on the prior 115 tests."

patterns-established:
  - "Pattern 40-O1 (Layered Orchestrator with Optional Slots): when composing N typed strategies/layers with a short-circuit contract, use an `as const` tuple `[{ name: 'a', layer: this.a }, ...]` to iterate in declared order. The literal union narrows the matchedLayer discriminator without a runtime cast. Skip undefined slots with `if (!layer) continue`."
  - "Pattern 40-O2 (First-Matched-Wins in Aggregation Mode): when both short-circuit and aggregate modes need consistent winner semantics, lock first-matched-wins in BOTH paths. The short-circuit path returns immediately on the first qualifying layer; the aggregate path does `find((r) => r.matched)` over the same declared order. Calibration mode (shortCircuit:false) then differs from production ONLY in the audit-trail completeness, never in the winner identity."
  - "Pattern 40-O3 (Defensive Guard Returns Empty Audit Trail): when an early-return defensive guard fires (e.g. Pitfall 1), the audit trail (`allLayerResults: []`) is intentionally empty — no layer ran, no verdict to record. This signals to telemetry/calibration consumers that the orchestrator never engaged its chain on this entity (vs. running and finding no match)."

requirements-completed: [DEDUP-01]

# Metrics
duration: 12min
completed: 2026-05-21
---

# Phase 40 Plan 05: LayeredDeduplicator Orchestrator Summary

**LayeredDeduplicator class lands in km-core — the 3-layer dedup orchestrator (DEDUP-01) that composes optional `exactName` / `embedding` / `llmSemantic` slots in declared cost-ascending order with D-44 short-circuit-on-first-match (default true), Pitfall 1 defensive `[km-core/dedup]` stderr-warn guard, and a first-matched-wins aggregation policy for shortCircuit:false calibration runs. Satisfies the `Deduplicator` structural contract from Plan 01 via structural typing — Plan 06's IngestPipeline composes it verbatim.**

## TDD Cycle

- **RED:** `tests/unit/layered-dedup.test.ts` written first (9 tests). `npx vitest run` → `Error: Cannot find module '../../src/dedup/LayeredDeduplicator.js'` — confirmed RED. Committed as `4598ff3 test(40-05): add failing LayeredDeduplicator unit tests (RED)`.
- **GREEN:** `src/dedup/LayeredDeduplicator.ts` written next. `npx vitest run tests/unit/layered-dedup.test.ts` → `Test Files 1 passed (1) / Tests 9 passed (9)` — all 9 tests pass. `npx tsc --noEmit` clean. Committed as `ce7c404 feat(40-05): implement LayeredDeduplicator (GREEN)`.
- **REFACTOR:** None needed. The implementation followed RESEARCH Example 1 verbatim with the 5 documented deltas; no post-GREEN cleanup required.

## The 9 Tests + RESEARCH.md Validation Architecture Mapping

Per `40-RESEARCH.md` line 928-933 ("Validation Architecture — orchestrator"):

| # | Test name | RESEARCH mapping | What it asserts |
|---|---|---|---|
| 1 | `exact-name layer catches first when matching` | `-t "exact-name layer catches"` | exactName.willMatch=true; result.matchedLayer === 'exactName'; embedding.match + llmSemantic.match called 0 times (short-circuit). |
| 2 | `embedding layer catches when exact-name does not match` | `-t "embedding layer catches"` | exactName.willMatch=false; embedding.willMatch=true; result.matchedLayer === 'embedding'; llmSemantic NOT called. |
| 3 | `llm-semantic layer catches when others do not match` | `-t "llm-semantic layer catches"` | exactName + embedding willMatch=false; llmSemantic.willMatch=true; result.matchedLayer === 'llmSemantic'; all 3 layers called exactly once. |
| 4 | `short-circuits on first matched layer when shortCircuit: true (default)` | `-t "short-circuit on first match"` (looser pattern in RESEARCH; this test is the canonical impl) | All 3 layers willMatch=true at confs 0.95/0.99/1.0; default shortCircuit; downstream call counts === 0; allLayerResults length === 1. |
| 5 | `shortCircuit: false runs all layers even after match (first-matched-wins per Example 1 line 323)` | `-t "no-short-circuit aggregates"` (looser pattern in RESEARCH; this test locks the FIRST-MATCHED-WINS policy) | exactName conf 0.95 (matched) + embedding conf 0.99 (matched) + llmSemantic willMatch=false; shortCircuit:false; all 3 layers called once; allLayerResults length === 3; **winner is exactName (first matched), NOT embedding (higher confidence)**. |
| 6 | `omitted layer slots are skipped` | `-t "omitted layer"` | Only `{ exactName }` supplied; embedding + llmSemantic undefined; orchestrator runs without null-deref; allLayerResults length === 1. |
| 7 | `runs layers in declared order: exactName → embedding → llmSemantic` | (call-order assertion per PATTERNS offset 698) | `mock.invocationCallOrder` on all 3 stubs; assert exactOrder < embedOrder < llmOrder. |
| 8 | `returns matched: false when no layer matches above threshold` | (no-match path) | All 3 willMatch=false; result `{ matched: false, allLayerResults: [3 entries] }`; matchedLayer/survivor/confidence undefined. |
| 9 | `Pitfall 1: entity without ontologyClass AND without entityType — returns matched: false + stderr-warn` | (RESEARCH offset 210-214 + PATTERNS offset 253-260) | `entity.ontologyClass = undefined, entityType = ''`; all 3 stubs wired willMatch=true; stderr-spy asserts `[km-core/dedup]` tag fires; NO layer.match called; result `{ matched: false, allLayerResults: [] }`. |

All 6 Validation-Architecture-named tests (`exact-name layer catches`, `embedding layer catches`, `llm-semantic layer catches`, `short-circuit on first match`, `no-short-circuit aggregates`, `omitted layer`) are grep-findable in the test file (acceptance criteria for Task 1 satisfied at 8 matches ≥ 6).

## ShortCircuit:false Winner Policy (Locked)

**First-matched-wins per 40-RESEARCH Example 1 line 323.** The implementation uses `layerResults.find((r) => r.matched)` for the aggregation path — even when a later layer reports higher confidence, the FIRST matched layer in declared order is the winner.

**Test alignment (Test #5):** Wired exactName at conf 0.95 (first matched) + embedding at conf 0.99 (second matched) — winner is `exactName` (confidence 0.95), NOT `embedding` (confidence 0.99). The test name explicitly cites the locked policy: `'shortCircuit: false runs all layers even after match (first-matched-wins per Example 1 line 323)'`.

**Rationale:** Keeps the shortCircuit:false output consistent with shortCircuit:true — same winner identity; only the audit trail (`allLayerResults`) differs. Calibration runs never silently disagree with production on the match outcome.

## Task Commits

Each task committed atomically in `~/Agentic/km-core/`:

1. **Task 1 (RED): Failing unit tests** — `4598ff3` (`test(40-05): add failing LayeredDeduplicator unit tests (RED)`)
2. **Task 2 (GREEN): Orchestrator impl** — `ce7c404` (`feat(40-05): implement LayeredDeduplicator (GREEN)`)
3. **Task 3 (Build + regression check):** no source-file changes — `dist/` is gitignored; npm run build + npm test green; no commit needed.

**Plan metadata (this SUMMARY):** committed in this coding/ worktree via the orchestrator's `git_commit_metadata` step (`docs(40-05): summary`).

## Files Created/Modified

- `~/Agentic/km-core/src/dedup/LayeredDeduplicator.ts` (193 LOC, created) — Orchestrator class + `LayeredDeduplicatorOpts` interface. Header cites OKM `deduplicator.ts:53-322` with 5 documented deltas. Type-only relative imports use `.js`. No `console.*` (only `process.stderr.write` in the Pitfall 1 guard).
- `~/Agentic/km-core/tests/unit/layered-dedup.test.ts` (397 LOC, created) — 9 unit tests. Imports `LayeredDeduplicator` from `../../src/dedup/LayeredDeduplicator.js`; `makeLayerStub` + `mkEntity` from `./_helpers/fakes.js`. All relative imports use `.js`. No `console.*`.

Generated `dist/dedup/LayeredDeduplicator.js` (7,095 bytes) + `dist/dedup/LayeredDeduplicator.d.ts` (3,517 bytes) confirmed present after `npm run build`. `dist/` is gitignored per km-core convention; consumers via `coding/lib/km-core/` submodule pick up the new dist on next consumer build.

## Verification

- **`cd ~/Agentic/km-core && npx tsc --noEmit` — exit 0, fully clean.**
- **`cd ~/Agentic/km-core && npm run build` — exit 0.** Both `dist/dedup/LayeredDeduplicator.js` and `.d.ts` exist.
- **`cd ~/Agentic/km-core && npx vitest run tests/unit/layered-dedup.test.ts` — `Test Files 1 passed (1) / Tests 9 passed (9)`.**
- **`cd ~/Agentic/km-core && npm test` — `Test Files 13 passed (13) / Tests 124 passed (124)`.** Zero regression on the prior 115 tests; +9 new orchestrator tests; +1 new test file.
- **Smoke test of dist build:** `node -e "import('./dist/dedup/LayeredDeduplicator.js').then(m => { const d = new m.LayeredDeduplicator({}); process.stdout.write('shortCircuit default ok\n'); })"` → `shortCircuit default ok`.
- **All grep acceptance checks pass:**
  - Task 1: `grep -c "^  test(" tests/unit/layered-dedup.test.ts` returns `9`; `grep -c "makeLayerStub" tests/unit/layered-dedup.test.ts` returns `27` (≥9); `grep -cE "(exact-name layer catches|embedding layer catches|llm-semantic layer catches|short-circuit on first match|no-short-circuit aggregates|omitted layer)" tests/unit/layered-dedup.test.ts` returns `8` (≥6).
  - Task 2: `grep -c "export class LayeredDeduplicator" src/dedup/LayeredDeduplicator.ts` = `1`; `grep -c "this.shortCircuit = opts.shortCircuit ?? true" src/dedup/LayeredDeduplicator.ts` = `1`; `grep -cE "(exactName|embedding|llmSemantic)" src/dedup/LayeredDeduplicator.ts` = `18` (≥12); `grep -c "ontologyClass && !entity.entityType" src/dedup/LayeredDeduplicator.ts` = `1`; `grep -c "\[km-core/dedup\]" src/dedup/LayeredDeduplicator.ts` = `3` (≥1); `grep -c "this.shortCircuit && result.matched && result.confidence" src/dedup/LayeredDeduplicator.ts` = `1`; `grep -c "\] as const" src/dedup/LayeredDeduplicator.ts` = `1` (≥1).
- **Zero `console.*` outside comments** in either new file (verified via `grep -v '^//' | grep -v '^ \* ' | grep -cE 'console\.(log|info|warn|error|debug)'` returning 0).
- **All relative imports use the `.js` suffix** (CF-D06 compliance) in both new files.

## Decisions Made

See `key-decisions` in frontmatter — five decisions tagged for STATE.md propagation:

1. ShortCircuit:false winner policy locked as first-matched-wins (`layerResults.find((r) => r.matched)`), tested explicitly with conf-ordering counter-case (exactName 0.95 wins over embedding 0.99). Rationale: consistency with shortCircuit:true.
2. Structural-typing-only satisfaction of `Deduplicator` from `src/pipeline/types.ts` — no `implements Deduplicator` keyword, avoiding pipeline-types import in the orchestrator module. Plan 06 verifies the structural match when wiring into `IngestPipelineOpts.deduplicator`.
3. Pitfall 1 defensive guard implemented exactly per PATTERNS offset 253-260: `if (!entity.ontologyClass && !entity.entityType)` → stderr-warn + early-return with empty allLayerResults. Defers failure to `putEntity` strict validation downstream.
4. stderr-warn uses string concatenation (`'[km-core/dedup] entity ' + String(entity.id) + ...`) to match Phase 37/38/39/40 convention and defend against branded-type `toString` footguns.
5. Test count baseline updated: 115/12 → 124/13 (+9 new tests, +1 new test file, zero regression on prior 115).

## Deviations from Plan

**None.** The plan executed exactly as written. The 5 deltas applied to OKM's `deduplicator.ts:53-322` source pattern are documented in the file header per Pattern F template. The first-matched-wins policy in shortCircuit:false mode was explicitly called out in the plan (`Task 1 <behavior>` line 109) and locked in both the implementation (`layerResults.find((r) => r.matched)`) and the test (Test #5's name + counter-case assertion).

The one-line tidy of the short-circuit condition (from a multi-line `if` to a single line) was a cosmetic adjustment to satisfy the Task 2 acceptance criterion `grep -c "this.shortCircuit && result.matched && result.confidence" ... returns 1` — semantically identical, no behavior change, no test impact. Not a deviation; an acceptance-criterion alignment.

## Issues Encountered

None. The TDD cycle ran cleanly: RED confirmed via module-not-found error; GREEN confirmed via 9/9 tests passing on first try; tsc clean throughout; full suite green (124/13).

## Next Phase Readiness

**Plan 40-06 (IngestPipeline class)** can now compose the orchestrator:

```typescript
import { LayeredDeduplicator } from '@fwornle/km-core';
import { JaccardNameMatcher } from '@fwornle/km-core';
import { CosineEmbeddingMatcher } from '@fwornle/km-core';
import { LLMSemanticMatcher } from '@fwornle/km-core';

const dedup = new LayeredDeduplicator({
  exactName: new JaccardNameMatcher({ threshold: 0.85 }),
  embedding: new CosineEmbeddingMatcher({ client: embedClient, threshold: 0.90 }),
  llmSemantic: new LLMSemanticMatcher({ client: llmClient, threshold: 0.70 }),
  // shortCircuit defaults to true
});

const pipeline = new IngestPipeline(store, {
  extractor,
  deduplicator: dedup,  // structural Deduplicator contract satisfied
  synthesizer,
  onPhase,
});
```

**Plan 40-07 (root barrel)** can add the re-export:

```typescript
// src/index.ts
export { LayeredDeduplicator } from './dedup/LayeredDeduplicator.js';
export type { LayeredDeduplicatorOpts } from './dedup/LayeredDeduplicator.js';
```

No blockers. Wave 3 (this plan) is complete; the orchestrator and all 3 layer impls are now on `main` in `~/Agentic/km-core/`.

## Self-Check: PASSED

- Created files exist:
  - `/Users/Q284340/Agentic/km-core/src/dedup/LayeredDeduplicator.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/layered-dedup.test.ts` — FOUND
- Commits exist in `~/Agentic/km-core/`:
  - `4598ff3` (`test(40-05): add failing LayeredDeduplicator unit tests (RED)`) — FOUND
  - `ce7c404` (`feat(40-05): implement LayeredDeduplicator (GREEN)`) — FOUND
- `tsc --noEmit` clean: PASSED
- `npx vitest run tests/unit/layered-dedup.test.ts` 9/9 green: PASSED
- `npm test` full-suite 124/13 (115/12 + 9/1 new), zero regression: PASSED
- `npm run build` exit 0 + `dist/dedup/LayeredDeduplicator.js` + `.d.ts` present: PASSED
- Smoke `node -e "import('./dist/dedup/LayeredDeduplicator.js')..."` outputs `shortCircuit default ok`: PASSED

## TDD Gate Compliance

The plan is `type=execute` with two `type=auto tdd="true"` tasks (Task 1 RED, Task 2 GREEN) and one `type=auto` non-TDD task (Task 3 build/regression). Gate sequence verified in `git log -- src/dedup/LayeredDeduplicator.ts tests/unit/layered-dedup.test.ts`:

```
ce7c404 feat(40-05): implement LayeredDeduplicator (GREEN)
4598ff3 test(40-05): add failing LayeredDeduplicator unit tests (RED)
```

RED (`test(...)` commit) precedes GREEN (`feat(...)` commit). No REFACTOR commit was needed (the implementation matched RESEARCH Example 1 verbatim; no post-GREEN cleanup). Gate sequence compliant.

---
*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-21*
