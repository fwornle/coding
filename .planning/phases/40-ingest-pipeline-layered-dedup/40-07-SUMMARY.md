---
phase: 40-ingest-pipeline-layered-dedup
plan: 07
subsystem: public-api-barrel
tags: [km-core, public-api, barrel, sub-path-exports, pipe-01, dedup-01, package-json-exports]

# Dependency graph
requires:
  - phase: 40-ingest-pipeline-layered-dedup/01
    provides: src/dedup/types.ts + src/pipeline/types.ts — public type surface this plan re-exports.
  - phase: 40-ingest-pipeline-layered-dedup/02
    provides: JaccardNameMatcher class — runtime re-export target in both root barrel and dedup sub-barrel.
  - phase: 40-ingest-pipeline-layered-dedup/03
    provides: CosineEmbeddingMatcher class + EmbeddingClient interface — runtime + type re-exports.
  - phase: 40-ingest-pipeline-layered-dedup/04
    provides: LLMSemanticMatcher class + LLMClient interface — runtime + type re-exports.
  - phase: 40-ingest-pipeline-layered-dedup/05
    provides: LayeredDeduplicator class — runtime re-export.
  - phase: 40-ingest-pipeline-layered-dedup/06a
    provides: IngestPipeline class — runtime re-export.
  - phase: 40-ingest-pipeline-layered-dedup/06b
    provides: integration tests proving the IngestPipeline+LayeredDeduplicator composition before barrel exposure.

provides:
  - "src/dedup/types.ts (amended) — adds `export type { EmbeddingClient }` + `export type { LLMClient }` (replaces Plan 01's deferred-TODO)."
  - "src/pipeline/index.ts (new, ~21 lines) — pipeline sub-barrel; 1 runtime re-export (IngestPipeline) + 7 type re-exports (IngestPipelineOpts, IngestOpts, IngestResult, PhaseCallback, StageName, Extractor, Synthesizer)."
  - "src/dedup/index.ts (new, ~27 lines) — dedup sub-barrel; 4 runtime re-exports (LayeredDeduplicator + 3 layer matchers) + 7 type re-exports (3 layer interfaces + MatchResult/DedupResult + EmbeddingClient/LLMClient)."
  - "src/index.ts (amended, +33 lines appended) — Phase 40 block at file tail; 5 runtime re-exports + 14 type re-exports. Append-only; Phase 37/38/39 exports byte-identical."
  - "package.json (amended, +8 lines in exports map) — adds ./pipeline + ./dedup sub-path entries mirroring Phase 38's ./ontology precedent. Final exports map has 4 entries: ., ./ontology, ./pipeline, ./dedup."

affects:
  - 41 (A INT-01) — A's migration can now `import { IngestPipeline, LayeredDeduplicator, CosineEmbeddingMatcher, LLMSemanticMatcher } from '@fwornle/km-core'` directly from the published surface.
  - 42 (B INT-02) — B's migration can `import { IngestPipeline, LayeredDeduplicator, JaccardNameMatcher } from '@fwornle/km-core'` and delete its local Jaccard copy (SC#4 full discharge).
  - 43 (C INT-03) — C's migration can compose the full 3-layer chain via the root barrel or `@fwornle/km-core/dedup`.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern G (Sub-Barrel + Sub-Path Export) — applied to ./pipeline + ./dedup, mirroring Phase 38's ./ontology precedent. The sub-path entries in package.json's exports map use the same shape (types + import dual fields)."
    - "Append-only root-barrel block — Phase 40's block appended after Phase 39's backfillEntityDataModel exports, mirroring the Phase 39 append pattern (PATTERNS offset 550-554)."
    - "Type-only re-export co-location — EmbeddingClient + LLMClient are co-located with their matcher impls in CosineEmbeddingMatcher.ts + LLMSemanticMatcher.ts (Warning #4 fix), then re-exported from src/dedup/types.ts for the dedup sub-barrel surface."
    - "JS-suffix relative imports throughout (CF-D06) — all 6 affected files preserve the .js suffix convention."

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/pipeline/index.ts (21 LOC) — pipeline sub-barrel.
    - /Users/Q284340/Agentic/km-core/src/dedup/index.ts (27 LOC) — dedup sub-barrel.
  modified:
    - /Users/Q284340/Agentic/km-core/src/dedup/types.ts (+12/-7 lines) — replaces Plan 01 deferred-TODO with active type re-exports for EmbeddingClient + LLMClient.
    - /Users/Q284340/Agentic/km-core/src/index.ts (+33 lines, append-only) — Phase 40 block.
    - /Users/Q284340/Agentic/km-core/package.json (+8 lines in exports map) — two new sub-path entries.

key-decisions:
  - "Type-only re-exports for EmbeddingClient + LLMClient. The runtime client behaviour (the actual fetch / vendor call) lives in caller-supplied implementations (A wires its own EmbeddingClient in Phase 41; B/C similarly); km-core ships only the interface shapes."
  - "Append-only edit to src/index.ts — Phase 39's backfillEntityDataModel exports stay byte-identical. Verified via pre-edit grep snapshot: `grep -c 'backfillEntityDataModel' src/index.ts` returned 2 before AND after this plan (1 export line + 1 JSDoc comment reference — pre-existing; not introduced or removed by Plan 07)."
  - "Sub-barrel shape mirrors Phase 38 + Phase 39 precedents verbatim — no novel patterns introduced. The dedup sub-barrel exposes 4 runtime classes (vs. 1 for ontology and 1 for segments) because Phase 40 ships a class hierarchy, not a single composition class. Pattern G covers this directly."
  - "External-consumer smoke compile uses NodeNext + strict mode + a fresh npm-installed dependency via file:// link — exactly mirrors Phase 38 Plan 38-03 FLAG-1 verification. All 3 probe files (root + ./pipeline + ./dedup) compile clean. Probes also validate runtime resolution by instantiating JaccardNameMatcher and checking the threshold type."

patterns-established: []  # Plan 07 reuses Phase 38 + Phase 39 sub-barrel pattern; no new patterns this plan.

requirements-completed: [PIPE-01, DEDUP-01]  # The public-API surface that makes both requirements consumable.

# Metrics
duration: ~15min
completed: 2026-05-22
---

# Phase 40 Plan 07: Public API Barrel Wiring Summary

**One-liner:** The 5 Phase 40 runtime classes (IngestPipeline + LayeredDeduplicator + 3 layer matchers) and all 14 public type names are now exported from both the root barrel (`@fwornle/km-core`) and dedicated sub-paths (`@fwornle/km-core/pipeline` + `@fwornle/km-core/dedup`); package.json's exports map gains the two sub-path entries (mirroring Phase 38's `./ontology` precedent); full suite stays green at 143 tests and external smoke compile is clean for all 3 probes.

## What This Plan Delivered

### Task 1 — src/dedup/types.ts amendment

Replaced the Plan 01 deferred-TODO comment at the bottom of `src/dedup/types.ts` with two active type-only re-exports:

```typescript
export type { EmbeddingClient } from './CosineEmbeddingMatcher.js';
export type { LLMClient } from './LLMSemanticMatcher.js';
```

Also updated the header comment block to drop the "deferred to Plan 07" prose and explain the co-location rationale (Warning #4: interface lives with the class that types it; dedup sub-barrel still gets a complete type surface via this re-export).

Verification: `grep -cE "^export type \{ EmbeddingClient \} from './CosineEmbeddingMatcher\.js';" src/dedup/types.ts` = 1; same for LLMClient; `grep -cE "(TODO\(40-07\)|Plan 07 will add)"` = 0; `npx tsc --noEmit` clean.

### Task 2 — src/pipeline/index.ts + src/dedup/index.ts sub-barrels

**`src/pipeline/index.ts`** (21 LOC):
- Header comment block per PATTERNS offset 170-193 (advertises `@fwornle/km-core/pipeline` sub-path + root-barrel equivalence).
- Runtime: `export { IngestPipeline } from './IngestPipeline.js';`
- Types: `export type { IngestPipelineOpts, IngestOpts, IngestResult, PhaseCallback, StageName, Extractor, Synthesizer } from './types.js';`

**`src/dedup/index.ts`** (27 LOC):
- Header comment block per PATTERNS offset 524-546.
- Runtime: 4 named class re-exports — LayeredDeduplicator, JaccardNameMatcher, CosineEmbeddingMatcher, LLMSemanticMatcher (each from `./<name>.js`).
- Types: `export type { ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, MatchResult, DedupResult, EmbeddingClient, LLMClient } from './types.js';`

Both files compile clean under `npx tsc --noEmit`. Zero `console.*`. All relative imports use the `.js` suffix.

### Task 3 — src/index.ts root-barrel append block

Appended a single 33-line block AFTER the existing Phase 39 `backfillEntityDataModel` exports (line 89 of the pre-edit file). Block per PATTERNS offset 556-589 (verbatim):

- 8-line Phase 40 comment header (PIPE-01 + DEDUP-01 — Pipeline threads ProvenanceStamp, supersession via Phase 39 putEntity, D-44 short-circuit, CR-01 legacy-id widening).
- `export { IngestPipeline } from './pipeline/IngestPipeline.js';`
- `export type { IngestPipelineOpts, IngestOpts, IngestResult, PhaseCallback, StageName, Extractor, Synthesizer } from './pipeline/types.js';`
- 4 class re-exports — LayeredDeduplicator + JaccardNameMatcher + CosineEmbeddingMatcher + LLMSemanticMatcher.
- `export type { ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, MatchResult, DedupResult, EmbeddingClient, LLMClient } from './dedup/types.js';`

Pre-existing exports untouched: Phase 39 `backfillEntityDataModel` + Phase 38 `OntologyRegistry`/`loadOntologyFile`/`OntologyValidator` + Phase 37 `GraphKMStore`/`mintEntityId`/`parseEntityId` all still exported. `npx tsc --noEmit` clean.

### Task 4 — package.json exports-map extension

Added two new entries AFTER the existing `./ontology` entry (no other field touched). Final exports map (4 entries):

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./ontology": {
    "types": "./dist/ontology/index.d.ts",
    "import": "./dist/ontology/index.js"
  },
  "./pipeline": {
    "types": "./dist/pipeline/index.d.ts",
    "import": "./dist/pipeline/index.js"
  },
  "./dedup": {
    "types": "./dist/dedup/index.d.ts",
    "import": "./dist/dedup/index.js"
  }
}
```

Validation via node one-liner: all 4 entries present; `./ontology` byte-identical; root `.` byte-identical; types + import fields populated for both new entries. `name` / `version` / `scripts` / `dependencies` / `devDependencies` all preserved.

### Task 5 — Build + full-suite test + external smoke compile

**Build (`npm run build`):** exit 0, zero `error TS` lines. All 14 expected dist artifacts present:

```
dist/pipeline/index.js + .d.ts                ✓
dist/pipeline/IngestPipeline.js + .d.ts       ✓
dist/dedup/index.js + .d.ts                   ✓
dist/dedup/LayeredDeduplicator.js + .d.ts     ✓
dist/dedup/JaccardNameMatcher.js + .d.ts      ✓
dist/dedup/CosineEmbeddingMatcher.js + .d.ts  ✓
dist/dedup/LLMSemanticMatcher.js + .d.ts      ✓
```

**Tests (`npm test`):** `Test Files 17 passed (17) / Tests 143 passed (143)` — full suite green, zero regression on the 143 Plan 06b baseline (this plan added no tests; barrel wiring only).

**External smoke compile:** All 3 probe files compiled clean under `npx tsc --noEmit` (NodeNext + strict) against a freshly `npm install`'d `@fwornle/km-core` via `file://` link in a tmpdir:

- `probe-root.ts`: imports 5 runtime classes + 14 types from `@fwornle/km-core`; instantiates `new JaccardNameMatcher()`; asserts `threshold` is `number`. → ROOT IMPORT OK.
- `probe-pipeline.ts`: imports `IngestPipeline` + 7 types from `@fwornle/km-core/pipeline`. → PIPELINE SUBPATH OK.
- `probe-dedup.ts`: imports 4 runtime classes + 7 types from `@fwornle/km-core/dedup`; instantiates `new JaccardNameMatcher()`; asserts `threshold` is `number`. → DEDUP SUBPATH OK.

**Direct dist-import sanity probes** (per acceptance criteria, bypass exports map):
- `node --input-type=module -e "import { IngestPipeline, LayeredDeduplicator, JaccardNameMatcher } from './dist/index.js'; new JaccardNameMatcher(); console.log('ROOT IMPORT OK');"` → `ROOT IMPORT OK`.
- `node --input-type=module -e "import { IngestPipeline } from './dist/pipeline/index.js'; console.log('PIPELINE SUBPATH OK');"` → `PIPELINE SUBPATH OK`.
- `node --input-type=module -e "import { LayeredDeduplicator, JaccardNameMatcher } from './dist/dedup/index.js'; new JaccardNameMatcher(); console.log('DEDUP SUBPATH OK');"` → `DEDUP SUBPATH OK`.

Tmpdir cleaned up.

## ROADMAP Phase 40 Success Criteria — Traced to Tests

| SC | Description | Verification |
|----|-------------|--------------|
| SC#1 | Pipeline framework runs 4-stage extract → dedup → store → synthesize | `tests/unit/pipeline.test.ts` 'stage order: ingest runs extract → dedup → store → synthesize in order' (40-T11), 'IngestResult shape' (40-T17) + Plan 40-01 compile-time type contracts |
| SC#2 | Layered dedup catches synthetic collision (3-layer composition) | `tests/integration/layered-dedup-collision-catch.test.ts` '3-collision order' (Plan 40-06b) |
| SC#3 | skipStages cadence works (caller opts out of any subset of 4 stages) | `tests/unit/pipeline.test.ts` 'skipStages synthesize' (40-T13), 'skipStages extract contract' (40-T14), 'runStage synthesize' (40-T15) |
| SC#4 | No duplicated dedup algorithm in B's codebase | Partially via Plan 06b's composition (LayeredDeduplicator + JaccardNameMatcher used in single integration test). FULL discharge at end of Phase 42 (INT-02) when B's local Jaccard copy in `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` is deleted. Per D-45: Phase 40 ships ONLY the km-core library; Phase 42 deletes the duplicate. |

## Test Counts + Build State

- **Before this plan:** 17 test files, 143 tests passing (Plan 06b baseline).
- **After this plan:** 17 test files, **143 tests passing** (+0 new tests — barrel wiring only).
- **TypeScript strict-mode (`npx tsc --noEmit`):** ✓ zero errors.
- **`npm run build`:** ✓ exit 0; 14 new/preserved dist artifacts confirmed.
- **External smoke compile (tmpdir + `npm install` + `tsc --noEmit`):** ✓ all 3 probes pass.
- **Direct dist-import sanity probes:** ✓ ROOT/PIPELINE/DEDUP all OK.

## Task Commits (all in `~/Agentic/km-core/` on `main`)

1. **Task 1:** `5bbd3a4 feat(40-07): re-export EmbeddingClient + LLMClient from src/dedup/types.ts`
2. **Task 2:** `cb43d83 feat(40-07): add src/pipeline/index.ts + src/dedup/index.ts sub-barrels`
3. **Task 3:** `ee1c0a9 feat(40-07): append Phase 40 block to root src/index.ts barrel`
4. **Task 4:** `939dd49 feat(40-07): extend package.json exports map with ./pipeline + ./dedup`
5. **Task 5:** verification-only (build + test + smoke); no source-file changes; no commit.

Plan metadata (this SUMMARY): committed in this coding/ worktree as `docs(40-07): summary`.

## Deviations from Plan

**None.** Plan executed exactly as written.

One acceptance-criterion observation worth noting (not a deviation): Task 3's verify-script asserts `grep -c "backfillEntityDataModel" src/index.ts | grep -q "^1$"`, but the pre-edit count was already 2 (one export line + one JSDoc comment reference). The criterion's *intent* — "Phase 39 export must still be present and unchanged" — is fully satisfied: the count is byte-identical (2 → 2) before and after my append. I did not modify any pre-existing line; the append-only invariant holds.

## Self-Check

- ✓ `~/Agentic/km-core/src/dedup/types.ts` amended (TODO replaced with 2 active type re-exports; verified via grep).
- ✓ `~/Agentic/km-core/src/pipeline/index.ts` exists (21 LOC, verified via `test -f` + content grep).
- ✓ `~/Agentic/km-core/src/dedup/index.ts` exists (27 LOC, verified via `test -f` + content grep).
- ✓ `~/Agentic/km-core/src/index.ts` Phase 40 block appended (5 runtime + 14 type re-exports; verified via grep for each export line).
- ✓ `~/Agentic/km-core/package.json` exports map has 4 entries (verified via node JSON parse + key-existence assertions).
- ✓ Commits in `~/Agentic/km-core/`:
  - `5bbd3a4` (`feat(40-07): re-export EmbeddingClient + LLMClient from src/dedup/types.ts`) — FOUND.
  - `cb43d83` (`feat(40-07): add src/pipeline/index.ts + src/dedup/index.ts sub-barrels`) — FOUND.
  - `ee1c0a9` (`feat(40-07): append Phase 40 block to root src/index.ts barrel`) — FOUND.
  - `939dd49` (`feat(40-07): extend package.json exports map with ./pipeline + ./dedup`) — FOUND.
- ✓ `npx tsc --noEmit` clean after each task and at end.
- ✓ `npm run build` exit 0; 14 expected dist artifacts all present.
- ✓ `npm test` exit 0: 17 files / 143 tests passing.
- ✓ External smoke compile: all 3 probes compile clean and runtime probes print expected OK strings.

## Self-Check: PASSED

---

**Phase 40 ready for `/gsd:verify-phase 40`.**

Phase 41 (A INT-01), Phase 42 (B INT-02), Phase 43 (C INT-03) can now consume the Phase 40 surface via either the root barrel or the dedicated sub-paths. Phase 42's full discharge of SC#4 will delete B's local Jaccard copy and re-bind to `@fwornle/km-core/dedup`'s `JaccardNameMatcher`.

*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-22*
