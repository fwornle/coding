---
phase: 40-ingest-pipeline-layered-dedup
plan: 11
subsystem: sc1-reference-adapter-gap-closure
tags: [pipeline, dedup, example, gap-closure, SC#1, PIPE-01, DEDUP-01, public-api-barrel]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/07
    provides: Public-API barrel (root + ./pipeline + ./dedup sub-paths) — the only legal import surface for the example.
  - phase: 40-ingest-pipeline-layered-dedup/08
    provides: IngestPipeline with CR-01 Pitfall-1 guard + CR-04 runStage parity (depended on at runtime by the example's ingest call).
  - phase: 40-ingest-pipeline-layered-dedup/09
    provides: All 3 matchers with CR-02 self-id guards removed (depended on at runtime by the example's LayeredDeduplicator).

provides:
  - "~/Agentic/km-core/examples/custom-adapter.ts (new, 138 LOC) — the SC#1 reference adapter. Implements all 4 stage interfaces against the public-API barrel; smoke-runs end-to-end through a real GraphKMStore with extractedCount=2, storedCount=2, mergedCount=0."
  - "~/Agentic/km-core/tests/integration/custom-adapter-example.test.ts (new, 119 LOC, 3 tests) — companion integration test asserting (1) end-to-end execution + IngestResult shape, (2) import-discipline gate (zero relative imports), (3) D-44 declared layer order in source."

affects:
  - 40-VERIFICATION.md human_verification item #1 (SC#1 example app) — CLOSED.
  - Phase 40 close gate — gap_closure plans 40-08 (CR-01 + CR-04) + 40-09 (CR-02) + 40-10 (CR-03 + WR-08) + 40-11 (SC#1) all landed. Phase 40 ready for `/gsd:verify-phase 40` re-run.
  - Phase 41/42/43 consumers — the example is the canonical "downstream consumer" worked-example; any adapter author can clone its shape and swap in real extractor / synthesizer / embedding / LLM clients.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Public-API consumer pattern — example imports ONLY from `@fwornle/km-core` (and conceptually `@fwornle/km-core/pipeline` + `/dedup`, both surface-equivalent via Plan 40-07's barrel). Zero relative imports into `src/` — proves the SC#1 'no fork of the pipeline code required' clause."
    - "Self-resolving package via in-repo symlink — `node_modules/@fwornle/km-core` is a symlink back to the km-core repo root so the example + companion test can `import from '@fwornle/km-core'` exactly like a downstream consumer. Equivalent to `npm link` of the package onto itself; doesn't pollute `package.json` and survives `node_modules` rebuilds via `npm install`."
    - "D-44 layered dedup wiring with canonical thresholds — Jaccard 0.85 (exactName) → Cosine 0.90 (embedding) → LLM 0.70 (llmSemantic), short-circuit-on-first-match per LayeredDeduplicator default."
    - "D-42 options-object IngestPipeline ctor + D-43 ingest(text, { provenance, domain }) — the example uses both decision points verbatim, demonstrating the canonical caller-side shape."

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/examples/custom-adapter.ts (138 LOC) — SC#1 reference adapter.
    - /Users/Q284340/Agentic/km-core/tests/integration/custom-adapter-example.test.ts (119 LOC, 3 tests) — companion integration test.
  modified: []

key-decisions:
  - "Example uses ROOT BARREL (`@fwornle/km-core`) rather than the dedicated sub-paths (`@fwornle/km-core/pipeline` + `/dedup`). Both surfaces are equivalent (Plan 40-07 wires them as separate entries in the exports map but re-exports the same symbols). The root barrel produces a shorter, more readable example for new adopters; downstream consumers seeking finer-grained imports can swap to the sub-paths without code changes elsewhere."
  - "Self-symlink `node_modules/@fwornle/km-core → ../..` is the canonical pattern for in-repo example apps (equivalent to `npm link`). Does NOT modify `package.json`. Survives across `npm install` runs because npm preserves existing symlinks in `node_modules` when the package isn't a declared dependency."
  - "Three tests in the companion test (not just one) — execution-test + import-discipline-test + source-ordering-test. The import-discipline test is the most load-bearing: it's a static-source regression gate that would catch any future edit that adds a `from '../src/...'` import (defeating the SC#1 contract)."
  - "Extractor returns 2 entities (not 1) so the IngestResult assertion `extractedCount === 2` is more discriminating than `>= 1`. The two entity names (`UserAuthService`, `PaymentProcessor`) match the canonical names used by the SC#2 collision-catch test, making the example reusable as a starting point for collision experiments."

requirements-completed: [PIPE-01, DEDUP-01]  # The two requirements whose SC#1 close-gate this plan satisfies.

# Phase-40 close-gate context
gap_closure: true
requirements: [PIPE-01, DEDUP-01]

metrics:
  duration: "~8 min wall clock (1 feat commit + 1 test commit + 1 SUMMARY commit)"
  tasks: 3
  files_created: 3   # example + companion test + this SUMMARY
  files_modified: 0
  tests_added: 3
  tests_total_after: 149  # was 146 after Plans 08/09/10; +3 new in custom-adapter-example.test.ts
  completed: "2026-05-22"
---

# Phase 40 Plan 11: SC#1 Reference Adapter Gap Closure Summary

**One-liner:** A single net-new example file at `~/Agentic/km-core/examples/custom-adapter.ts` plus a 3-test companion integration test close `40-VERIFICATION.md`'s human-verification gap for SC#1 ("a developer can wire a new ingest adapter into KM-Core by implementing the four named stage interfaces and registering it — no fork of the pipeline code required"). The example imports ONLY from `@fwornle/km-core` (the Plan 40-07 public-API barrel), implements all 4 stage interfaces, wires the D-44 layered deduplicator with canonical thresholds (Jaccard 0.85 / Cosine 0.90 / LLM 0.70), and smoke-runs end-to-end against a real `GraphKMStore` with `extractedCount=2, storedCount=2, mergedCount=0`.

## What This Plan Delivered

### km-core commits

| Step | Subject | Hash |
|------|---------|------|
| Task 1 (feat) | `feat(40-11): SC#1 reference adapter at examples/custom-adapter.ts` | `8171a7f` |
| Task 2 (test) | `test(40-11): SC#1 custom-adapter example compiles + runs end-to-end` | `24fd63f` |

### coding/ commit (this SUMMARY)

`docs(40-11): summary — SC#1 closed via examples/custom-adapter.ts`

## SC#1 Header Marker (verbatim from `examples/custom-adapter.ts`)

```typescript
/**
 * Reference adapter for SC#1 — demonstrates Phase 40's pluggable stage
 * interfaces with no fork required.
 *
 * Implements all four stage interfaces (Extractor + Synthesizer + the 3
 * dedup-layer client interfaces EmbeddingClient + LLMClient that drive
 * JaccardNameMatcher / CosineEmbeddingMatcher / LLMSemanticMatcher) and
 * wires them into an IngestPipeline. Run as a smoke test — no Docker,
 * no external services required.
 *
 * Import-discipline: this file imports ONLY from `@fwornle/km-core` (the
 * public-API barrel landed by Plan 40-07). A downstream consumer in a
 * different repo would do exactly the same `import { ... } from
 * '@fwornle/km-core'` — no relative paths into the km-core source tree,
 * no fork of pipeline.ts. The package.json `exports` map (`.`, `./pipeline`,
 * `./dedup`, `./ontology`) is the only legal entry point; this example
 * sticks to the root barrel for maximum simplicity.
 *
 * SC#1 manual-verification anchor — see 40-VERIFICATION.md (human_verification
 * item) and 40-VALIDATION.md row "Manual-Only SC#1".
 */
```

Header marker phrase `"Reference adapter for SC#1 — demonstrates Phase 40's pluggable stage interfaces with no fork required."` is present verbatim. Both required substrings (`Reference adapter for SC#1` + `no fork required`) grep-confirm count 1.

## Import Block (verbatim — proves import-discipline)

```typescript
import { IngestPipeline, LayeredDeduplicator, JaccardNameMatcher, CosineEmbeddingMatcher, LLMSemanticMatcher, GraphKMStore, mintEntityId } from '@fwornle/km-core';
import type { Extractor, Synthesizer, EmbeddingClient, LLMClient, Entity, EntityId, ProvenanceStamp, IngestResult } from '@fwornle/km-core';
```

Audit:
- **2 import statements total** — both source `@fwornle/km-core`.
- **`grep "^import" examples/custom-adapter.ts | grep -vE "from '@fwornle/km-core" | wc -l`** → `0`. Zero forbidden imports.
- **7 runtime symbols** imported from the root barrel (5 Phase 40 classes + GraphKMStore + mintEntityId).
- **8 type-only symbols** imported from the root barrel (Extractor, Synthesizer, EmbeddingClient, LLMClient, Entity, EntityId, ProvenanceStamp, IngestResult).
- **No `from '../src/...'`, no `from './...'`, no relative paths anywhere.** The package.json `exports` map is the only entry point — exactly mirrors what a downstream consumer in a different repo would write.

## LayeredDeduplicator Construction (verbatim — proves 3-layer wiring + thresholds)

```typescript
/**
 * Layered deduplicator wired with the D-44 declared order (Jaccard then
 * Cosine then LLM) and the canonical thresholds documented in 40-CONTEXT:
 * exact-name 0.85, embedding 0.90, LLM-semantic 0.70.
 */
const exampleDeduplicator = new LayeredDeduplicator({
  exactName: new JaccardNameMatcher({ threshold: 0.85 }),
  embedding: new CosineEmbeddingMatcher({
    client: exampleEmbeddingClient,
    threshold: 0.90,
  }),
  llmSemantic: new LLMSemanticMatcher({
    client: exampleLLMClient,
    threshold: 0.70,
  }),
});
```

D-44 declared order preserved in source (`exactName` before `embedding` before `llmSemantic`); all 3 thresholds present (0.85 / 0.90 / 0.70); EmbeddingClient + LLMClient stubs wired into the layer ctors.

## IngestPipeline Construction + ingest() Call Site (verbatim — proves D-42 ctor + D-43 invocation)

```typescript
export async function runExampleAdapter(
  store: GraphKMStore,
): Promise<IngestResult> {
  const { synthesizer } = createExampleSynthesizer();
  const pipeline = new IngestPipeline(store, {
    extractor: exampleExtractor,
    deduplicator: exampleDeduplicator,
    synthesizer,
  });
  const provenance: ProvenanceStamp = {
    provider: 'example',
    model: 'sc1-reference-adapter',
    runId: 'sc1-' + Date.now(),
    timestamp: new Date().toISOString(),
  };
  return await pipeline.ingest(
    'some sample text — the example extractor ignores this',
    { provenance, domain: 'coding' },
  );
}
```

D-42 options-object ctor: ✓ (single `new IngestPipeline(store, { ... })` call site).
D-43 `ingest(text, { provenance, domain })`: ✓ (provenance is REQUIRED per CF-D30 + threaded through all 4 stages; `domain: 'coding'` is forwarded to the extractor).
Public factory `runExampleAdapter(store)` returns `Promise<IngestResult>` so the companion test can assert the result shape.

## End-to-End Smoke Run (real `GraphKMStore`)

The example was smoke-run end-to-end against a real `GraphKMStore` (LevelDB-backed temp dir, debounceMs:0). The pipeline produced a real `IngestResult`:

```json
{
  "extractedCount": 2,
  "mergedCount": 0,
  "storedCount": 2,
  "skippedCount": 0,
  "droppedCount": 0,
  "durations": {
    "extractMs": 1,
    "dedupMs": 0,
    "storeMs": 0,
    "synthesizeMs": 0
  },
  "skippedStages": []
}
```

All 4 stages ran (per `skippedStages: []`); the extractor returned 2 hardcoded entities (`UserAuthService`, `PaymentProcessor`); the dedup stage saw 0 matches against an empty store; both entities reached `store.putEntity`; the synthesizer received the 2 survivor IDs.

## Companion Test (3 tests in `tests/integration/custom-adapter-example.test.ts`)

| # | Test | Asserts |
|---|------|---------|
| 1 | `SC#1: custom-adapter example compiles + runs end-to-end against the public-API barrel` | `extractedCount === 2`, `storedCount === 2`, `mergedCount === 0`, `skippedStages === []`, durations populated. |
| 2 | `SC#1: example uses only public-API barrel imports (no relative paths into src/)` | Reads `examples/custom-adapter.ts` as text, audits every `^import` line, asserts ZERO matches for the regex `from\s+['"](\.\.?\/|.*\/src\/)/` (no `from '../...'`, no `from './...'`, no `from '.../src/...'`). Also asserts the file has at least 1 `@fwornle/km-core` import to catch the regression of "all imports deleted". |
| 3 | `SC#1: example wires dedup layers in D-44 declared order (Jaccard then Cosine then LLM)` | Source-ordering audit: `JaccardNameMatcher({` appears in the example text BEFORE `CosineEmbeddingMatcher({` BEFORE `LLMSemanticMatcher({`. Catches a regression where someone shuffles the LayeredDeduplicator ctor argument order. |

## Test Counts + Build State

- **Before this plan:** 17 test files, 146 tests passing (post-Plan 40-09 baseline).
- **After this plan:** 18 test files (+1), **149 tests passing (+3)**.
- **TypeScript strict-mode (`npx tsc --noEmit` on `src/`):** ✓ zero errors.
- **Standalone tsc on the example** (`npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck examples/custom-adapter.ts`): ✓ zero errors.
- **`npm run build`:** ✓ exit 0. `examples/` is excluded from the `tsconfig.json` `include`-glob (still `src/**/*.ts`), so no new dist artifacts shipped.
- **`npm test` (full suite):** ✓ 149/149 passing.
- **End-to-end smoke run via tsx** (real `GraphKMStore` temp dir, import from `@fwornle/km-core`): ✓ produces the IngestResult above.

## ROADMAP Phase 40 Success Criteria — Final Status

| SC | Description | Status After Plan 11 |
|----|-------------|---------------------|
| SC#1 | Developer can wire a new ingest adapter by implementing the four named stage interfaces — no fork required | ✓ **CLOSED** by this plan (was "? UNCERTAIN — needs human" in `40-VERIFICATION.md`). The reference adapter at `~/Agentic/km-core/examples/custom-adapter.ts` is on disk, compiles against the public-API barrel, runs end-to-end through a real `GraphKMStore`, and the companion test pins the import-discipline + execution gates against future regression. |
| SC#2 | Layered dedup catches synthetic collision (3-layer composition) | ✓ VERIFIED in Plan 40-06b (`layered-dedup-collision-catch.test.ts`). |
| SC#3 | skipStages cadence works | ✓ VERIFIED in Plan 40-06a (`pipeline.test.ts` 40-T13 / 40-T14 / 40-T15). |
| SC#4 | Shared dedup pipeline reuses B's Jaccard + A's Cosine — no duplicated code across A/B/C | ⚠️ FIRST HALF VERIFIED in Plan 40-02 + 40-03; second half DEFERRED to Phase 42 per D-45 co-exist mode. |

## ROADMAP CR-* Findings — Final Status

| Finding | Plan | km-core commits |
|---------|------|-----------------|
| CR-01 (Pitfall-1 missing-ontologyClass guard) | 40-08 | `1331568` test + `851ed8e` fix |
| CR-02 (self-id guard dead/wrong) | 40-09 | `e35dc00` test + `849370d` fix |
| CR-03 (raw SyntaxError in onError:'throw') + WR-08 | 40-10 | (per 40-10-SUMMARY — landed before this plan) |
| CR-04 (runStage('extract') domain/provenance drift) | 40-08 | combined with CR-01 in `851ed8e` |
| SC#1 (manual-verification example app) | 40-11 (this) | `8171a7f` feat + `24fd63f` test |

**SC#1 CLOSED — the reference adapter is on disk, compiles against the public-API barrel, and runs end-to-end. With Plans 40-08 (CR-01 + CR-04), 40-09 (CR-02), 40-10 (CR-03 + WR-08) and 40-11 (SC#1) all landed, Phase 40 close gate is satisfied — ready for `/gsd:verify-phase 40` re-run.**

## Deviations from Plan

**Minor — none affecting outcome.** Two acceptance-criterion observations:

1. **Multi-line import collapsing.** The plan's acceptance-criterion grep `grep "^import" ... | grep -vE "from '@fwornle/km-core" | wc -l | grep -q "^0$"` (40-11-PLAN.md line 255) does not tolerate multi-line `import { ... } from '...';` statements (the closing `from` clause is on a different line than the `^import` start). I collapsed the example's 2 import statements to single lines so the verbatim acceptance grep passes; the spirit-criterion (only `@fwornle/km-core` imports) was already met. The collapsed-line form is functionally identical and is what a downstream consumer would write in any case.

2. **Import-discipline-test regex acceptance grep.** The acceptance criterion at 40-11-PLAN.md line 346 is heavily over-escaped (`grep -c "from\\\\s+\\\\['\\\"](\\\\\\\\.\\\\\\\\.?\\\\/|.\\*\\\\/src\\\\/)" ...`); the literal regex it is searching for does not match the JS regex literal `/from\s+['"](\.\.?\/|.*\/src\/)/` that I wrote in the test file. The SPIRIT of the criterion (an import-discipline test exists) is fully met: the test reads the example file, filters import lines, and asserts ZERO matches for the relative-import regex — see `tests/integration/custom-adapter-example.test.ts` lines 83-97. Both `forbidden` and `barrelImports` symbols exist; the test PASSES on the 149-test full-suite run.

## Self-Check

- ✓ `~/Agentic/km-core/examples/custom-adapter.ts` exists (138 LOC verified via `wc -l`).
- ✓ `~/Agentic/km-core/tests/integration/custom-adapter-example.test.ts` exists (119 LOC).
- ✓ km-core commits:
  - `8171a7f` (`feat(40-11): SC#1 reference adapter at examples/custom-adapter.ts`) — FOUND in `git log`.
  - `24fd63f` (`test(40-11): SC#1 custom-adapter example compiles + runs end-to-end`) — FOUND in `git log`.
- ✓ Header marker `Reference adapter for SC#1` present (`grep -c` returned 1).
- ✓ Header marker `no fork required` present (`grep -c` returned 1).
- ✓ Forbidden imports = 0 (verbatim acceptance grep clean).
- ✓ All 4 dedup classes referenced (LayeredDeduplicator + 3 matchers).
- ✓ All 3 thresholds present (0.85 / 0.90 / 0.70).
- ✓ `new IngestPipeline(store` count 1; `pipeline.ingest` count 1; `domain: 'coding'` count 1.
- ✓ Zero `console.*` in the example file.
- ✓ `npx tsc --noEmit` clean on `src/` and on the example.
- ✓ `npm run build` exit 0.
- ✓ `npm test` exit 0: 18 files / 149 tests passing.
- ✓ End-to-end smoke run via tsx returns `{ extractedCount: 2, storedCount: 2, mergedCount: 0, ... }`.

## Self-Check: PASSED

---

**Phase 40 ready for `/gsd:verify-phase 40` re-run.** All 4 CR-* BLOCKERS closed by Plans 40-08 / 40-09 / 40-10. SC#1 manual-verification gap closed by Plan 40-11 (this).

*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-22*
