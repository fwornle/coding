---
phase: 40-ingest-pipeline-layered-dedup
plan: 01
subsystem: api
tags: [km-core, ingest-pipeline, dedup, layered-dedup, types-only, pipe-01, dedup-01, scaffold, test-fakes]

# Dependency graph
requires:
  - phase: 39-entity-data-model/01
    provides: Entity / ProvenanceStamp / EntityProvenance types and PutEntityOpts contract that the pipeline threads through all 4 stages (CF-D30 writer-side stamping)
  - phase: 39-entity-data-model/03
    provides: GraphKMStore supersession closure (D-33) — Plan 40-05's store stage relies on putEntity({ ...entity, supersedes: survivor.id }) auto-closing the predecessor atomically
  - phase: 39-entity-data-model/04
    provides: backfill machinery (unrelated to pipeline shape but ships in the same km-core package)
provides:
  - "src/pipeline/types.ts — 4-stage pipeline public type surface (PIPE-01): StageName, Extractor, Synthesizer, Deduplicator (structural contract), PhaseCallback, IngestPipelineOpts, IngestOpts, IngestResult"
  - "src/dedup/types.ts — 3-layer dedup public type surface (DEDUP-01): ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, MatchResult, DedupResult"
  - "tests/unit/_helpers/fakes.ts — universal test fakes barrel (5 exports): mkEntity, makeFakeExtractor, makeFakeSynthesizer, makeLayerStub (3-overload discriminated factory), PROV"
  - "Inline Deduplicator structural interface in src/pipeline/types.ts — what IngestPipeline requires from the deduplicator slot; Plan 40-05's LayeredDeduplicator class will satisfy it"
affects:
  - 40-02 (JaccardNameMatcher port) — implements ExactNameLayer from src/dedup/types.ts; can pull mkEntity + makeLayerStub from fakes.ts
  - 40-03 (CosineEmbeddingMatcher port) — implements EmbeddingLayer from src/dedup/types.ts; creates its own fakes-embedding.ts with the EmbeddingClient fake co-located with the matcher (Warning #4)
  - 40-04 (LLMSemanticMatcher port) — implements LLMSemanticLayer from src/dedup/types.ts; creates its own fakes-llm.ts with the LLMClient fake co-located with the matcher (Warning #4)
  - 40-05 (LayeredDeduplicator class) — implements the inline Deduplicator interface from src/pipeline/types.ts; consumes ExactNameLayer / EmbeddingLayer / LLMSemanticLayer / MatchResult / DedupResult from src/dedup/types.ts; uses makeLayerStub from fakes.ts
  - 40-06a (IngestPipeline class) — consumes IngestPipelineOpts / IngestOpts / IngestResult / PhaseCallback / StageName / Extractor / Synthesizer / Deduplicator from src/pipeline/types.ts; uses makeFakeExtractor / makeFakeSynthesizer / PROV from fakes.ts
  - 40-07 (root barrel) — re-exports everything from src/pipeline/types.ts and src/dedup/types.ts via src/index.ts; ALSO appends EmbeddingClient + LLMClient re-exports in src/dedup/types.ts once Plans 40-03 + 40-04 have created the matcher files
  - 41 (A INT-01) — A's adapter consumes the typed Deduplicator + EmbeddingLayer surface
  - 42 (B INT-02) — B's adapter consumes the typed Deduplicator + ExactNameLayer surface

# Tech tracking
tech-stack:
  added: []  # pure types-only, no new dependencies
  patterns:
    - "Public-type module convention (src/<dir>/types.ts) extended with two new modules — pipeline + dedup — mirroring Phase 37's src/store/types.ts and Phase 38's src/types/ontology.ts"
    - "SOURCE-comment file header (PATTERNS.md Pattern F) — both new types modules cite the OKM source-of-truth file + line range + enumerated deltas"
    - "Structural-contract pattern — when a types module needs to reference a not-yet-created class (LayeredDeduplicator in Plan 05), declare an inline structural interface (Deduplicator) the eventual class will implement. Avoids cross-plan forward-reference TS2307 errors."
    - "Test fakes barrel pattern — tests/unit/_helpers/<name>.ts (leading underscore + no `.test.` substring) keeps the file out of vitest's discovery. New convention for km-core (no prior _helpers/ dir existed); future test-helper additions should follow."
    - "Co-located client fakes (Warning #4 fix) — instead of one mega fakes.ts that forward-references every client interface in the codebase, each matcher plan creates its own fakes-<name>.ts co-located with its client interface. fakes.ts holds only universal-needed factories."

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/pipeline/types.ts (223 lines) — Pipeline public type surface. Defines StageName, Extractor, Synthesizer, Deduplicator (structural contract; Plan 05's LayeredDeduplicator implements it), PhaseCallback, IngestPipelineOpts, IngestOpts (provenance REQUIRED per CF-D30), IngestResult. SOURCE-comment header cites OKM pipeline.ts:28-68 + 4 deltas. Type-only relative imports use `.js` suffix per CF-D06.
    - /Users/Q284340/Agentic/km-core/src/dedup/types.ts (135 lines) — Dedup public type surface. Defines ExactNameLayer, EmbeddingLayer, LLMSemanticLayer (each with `readonly threshold: number` + async `match(entity, candidates): Promise<MatchResult>`), MatchResult (per-layer verdict), DedupResult (aggregated verdict with matchedLayer discriminator + allLayerResults audit trail). SOURCE-comment header cites OKM deduplicator.ts:24-36 + 2 deltas. TODO marker for Plan 07's EmbeddingClient + LLMClient re-exports.
    - /Users/Q284340/Agentic/km-core/tests/unit/_helpers/fakes.ts (146 lines) — Universal test fakes barrel. 5 exports: mkEntity (deterministic Entity builder mirroring segments-merge.test.ts:20-32), makeFakeExtractor (vi.fn-backed Extractor stub), makeFakeSynthesizer (vi.fn-backed Synthesizer stub), makeLayerStub (3-overload discriminated factory for ExactName/Embedding/LLMSemantic stubs), PROV (canonical test ProvenanceStamp constant). Deliberately omits EmbeddingClient + LLMClient fakes — those ship co-located with their matchers in Plans 40-03 + 40-04.
  modified: []  # plan is net-new files only — no existing km-core files touched

key-decisions:
  - "Inline `Deduplicator` interface in src/pipeline/types.ts (Rule 3 deviation): the plan-author-prescribed `import type { LayeredDeduplicator } from '../dedup/LayeredDeduplicator.js'` would TS2307 at Plan 40-01 time (that class file lives in Plan 40-05). Resolved by declaring an inline structural `Deduplicator` interface with the single method `dedup(entity, candidates): Promise<DedupResult>` — what IngestPipeline actually needs from the deduplicator slot. Plan 40-05's LayeredDeduplicator class will declare `implements Deduplicator`. The plan-author's NOTE in Task 1 ('forward-reference is OK — type-only imports erase at compile time') is incorrect for TypeScript NodeNext + strict mode — type-only imports still require module resolution; only the runtime emission is elided."
  - "Task execution order: Task 2 (dedup/types.ts) before Task 1 (pipeline/types.ts). pipeline/types.ts imports `DedupResult` from `../dedup/types.js` (for the inline Deduplicator interface's return type), so dedup/types.ts must exist first for Task 1's per-task tsc verification to pass. The plan's listed Task ordering (1 → 2 → 3) was followed in spirit (all three created during Plan 40-01) but committed in dependency order (2 → 1 → 3). All three commits carry the `(40-01):` scope tag so the plan's history is grep-recoverable."
  - "IngestResult.skippedStages canonicalized via `Array.from(new Set(...))` — documented in the JSDoc but the actual canonicalization happens in Plan 40-05's pipeline implementation. Plan 40-01 only locks the field shape."
  - "fakes.ts exports 5 universal factories (not 7 from the original PATTERNS.md spec). EmbeddingClient + LLMClient fakes are deferred to Plans 40-03 + 40-04 per the Warning #4 fix in 40-01-PLAN <objective>. This keeps fakes.ts compilable end-to-end at Plan 01 completion with no carve-outs needed in the per-task tsc verify step."
  - "Existing test suite shows 92 passing / 9 test files (not 56 / 9 as the plan stated). Plan's '56 passing' was stale by the time Plan 40 entered execution (Phase 39's plans 01-04 + Phase 38's adjustments grew the suite). Zero regression — the 92 number is the post-Plan-40-01 baseline."

patterns-established:
  - "Pattern 40-T1 (Structural Contract for Forward-Reference Avoidance): when a types module needs a symbol from a not-yet-created class, declare an inline structural interface (e.g., `Deduplicator`) the eventual class will `implements`. Avoids TS2307 cascades across plan ordering."
  - "Pattern 40-T2 (Co-located Test Fakes per Client Interface): per the Warning #4 fix, each matcher plan that introduces a new client interface (EmbeddingClient in 40-03, LLMClient in 40-04) creates its own `fakes-<name>.ts` co-located with the matcher. Keeps a single fakes.ts from carrying forward-reference imports across waves."
  - "Pattern 40-T3 (_helpers/ Subdir for Non-Test Test Files): tests/unit/_helpers/<name>.ts with leading underscore + no `.test.` substring keeps the file out of vitest's default discovery. First use of this convention in km-core; future helper files should land here."

requirements-completed: [PIPE-01, DEDUP-01]

# Metrics
duration: 7min
completed: 2026-05-21
---

# Phase 40 Plan 01: Pipeline + Dedup Type-Surface Scaffold Summary

**Two pure-types modules (`src/pipeline/types.ts` + `src/dedup/types.ts`) plus a universal test-fakes barrel (`tests/unit/_helpers/fakes.ts`) — locks the 4-stage pipeline and 3-layer dedup public type surfaces in km-core so Wave 1's three parallel layer ports (40-02 / 40-03 / 40-04) and Wave 2's orchestrators (40-05 / 40-06a) compile against typed interfaces with zero scavenger-hunt dependencies.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-21T16:28:53Z
- **Completed:** 2026-05-21T16:36:41Z
- **Tasks:** 3 (all `type=auto` — TDD RED step deferred per the plan's `Test (deferred to Plan ...)` markers, since Plan 40-01 ships no runtime code)
- **Files created:** 3 in km-core (504 LOC total) + 1 in coding/ (this SUMMARY)
- **Files modified:** 0

## Accomplishments

- **PIPE-01 type surface locked** — `src/pipeline/types.ts` (223 lines) ships `StageName`, `Extractor`, `Synthesizer`, `Deduplicator` (structural contract), `PhaseCallback`, `IngestPipelineOpts`, `IngestOpts`, `IngestResult`. Provenance is REQUIRED on `IngestOpts` per CF-D30; the pipeline never invents a `ProvenanceStamp`. `IngestResult` adds `skippedStages` / `skippedCount` / `droppedCount` / explicit `durations.{extract,dedup,store,synthesize}Ms` on top of OKM's shape, and drops OKM's caller-specific `entityIds` / `errors` / `orphanNodeIds` / `confirmedCount` per 40-RESEARCH Q2 #9.
- **DEDUP-01 type surface locked** — `src/dedup/types.ts` (135 lines) ships the three D-44 layer interfaces (`ExactNameLayer`, `EmbeddingLayer`, `LLMSemanticLayer`), each with `readonly threshold: number` + async `match(entity, candidates): Promise<MatchResult>`. `DedupResult` carries the `matchedLayer: 'exactName' | 'embedding' | 'llmSemantic'` discriminator + `allLayerResults` audit trail so `shortCircuit: false` calibration runs can record every layer's verdict.
- **Universal test fakes barrel ships with 5 factories** — `tests/unit/_helpers/fakes.ts` (146 lines): `mkEntity` (deterministic Entity builder), `makeFakeExtractor` + `makeFakeSynthesizer` (vi.fn-backed stage stubs), `makeLayerStub` (3-overload discriminated factory for typed layer stubs), `PROV` (canonical test ProvenanceStamp). Vitest's default test discovery skips it (no `.test.` substring; the `_helpers/` underscore prefix signals "not a test file").
- **Wave 1 unblocked** — Plans 40-02 / 40-03 / 40-04 can now run in parallel; each layer port has its typed contract (`ExactNameLayer` / `EmbeddingLayer` / `LLMSemanticLayer`), `MatchResult` to return, and `mkEntity` + `makeLayerStub` available from `fakes.ts` for the layer-internal tests. Plans 40-03 + 40-04 create their own `fakes-embedding.ts` + `fakes-llm.ts` co-located with the respective matchers — the Warning #4 fix keeps client-interface fakes out of `fakes.ts` so no forward-reference imports leak across plans.

## Task Commits

Each task was committed atomically in `~/Agentic/km-core/`:

1. **Task 2 (committed first per dependency order): Dedup public type surface** — `09e0873` (`feat(40-01): scaffold dedup public type surface`)
2. **Task 1 (committed second): Pipeline public type surface** — `3e6c6ef` (`feat(40-01): scaffold pipeline public type surface`)
3. **Task 3: Universal test fakes barrel** — `85015ca` (`test(40-01): add universal test fakes barrel for pipeline + dedup tests`)

**Plan metadata (this SUMMARY):** committed in this coding/ worktree via the orchestrator's `git_commit_metadata` step (`docs(40-01): summary`).

## Files Created/Modified

- `~/Agentic/km-core/src/dedup/types.ts` (135 LOC, created) — 3 layer interfaces (`ExactNameLayer` / `EmbeddingLayer` / `LLMSemanticLayer`), `MatchResult`, `DedupResult`. Pure types, no runtime, no `console.*`. All relative imports use `.js` suffix.
- `~/Agentic/km-core/src/pipeline/types.ts` (223 LOC, created) — 8 exports: `StageName`, `Extractor`, `Synthesizer`, `Deduplicator` (inline structural contract), `PhaseCallback`, `IngestPipelineOpts`, `IngestOpts`, `IngestResult`. Pure types, no runtime, no `console.*`. All relative imports use `.js` suffix.
- `~/Agentic/km-core/tests/unit/_helpers/fakes.ts` (146 LOC, created) — 5 exports: `mkEntity`, `makeFakeExtractor`, `makeFakeSynthesizer`, `makeLayerStub` (3-signature overload), `PROV`. No `console.*`. Vitest does not pick it up as a test file.

## Verification

- **`cd ~/Agentic/km-core && npx tsc --noEmit` — exit 0, fully clean** (Warning #4 fix verified — no "expected errors in fakes.ts" carve-out anymore; the file compiles end-to-end at Plan 01 completion).
- **`cd ~/Agentic/km-core && npx vitest run` — `Test Files 9 passed (9)` / `Tests 92 passed (92)`** (zero regression; the 92-test baseline is the post-Plan-40-01 number — the plan's stated "56 passing" was stale from before Phases 38-39 grew the suite).
- **`fakes.ts` not picked up by vitest** (`vitest run 2>&1 | grep -c "fakes.ts"` returns 0).
- **All grep acceptance checks pass** for each task (StageName / IngestPipelineOpts / IngestOpts / IngestResult / Extractor / Synthesizer / PhaseCallback in pipeline/types.ts; ExactNameLayer / EmbeddingLayer / LLMSemanticLayer / MatchResult / DedupResult + 3× `readonly threshold: number` in dedup/types.ts; mkEntity / makeFakeExtractor / makeFakeSynthesizer / makeLayerStub / PROV in fakes.ts; zero `makeFakeEmbeddingClient` / `makeMockLLMClient` in fakes.ts per Warning #4).
- **Zero `console.*` outside comments** in any of the three new files (no-console-log compliance verified via `grep -v '^//' | grep -v '^ \* ' | grep -cE 'console\.(...)'` returning 0).
- **All relative imports use the `.js` suffix** (CF-D06 compliance) in all three files.

## Decisions Made

See `key-decisions` in frontmatter — five decisions tagged for STATE.md propagation:

1. Inline `Deduplicator` interface in `src/pipeline/types.ts` (Rule 3 deviation — fixes the plan-author's forward-reference assumption that type-only imports of nonexistent files are TS-safe under NodeNext + strict mode; they are not).
2. Task execution order reordered to 2 → 1 → 3 (Rule 3 deviation — `src/pipeline/types.ts` imports `DedupResult` from `../dedup/types.js`, so the dedup module must exist first for the per-task tsc verify to pass).
3. `IngestResult.skippedStages` canonicalized via `Array.from(new Set(...))` documented in JSDoc; actual canonicalization lives in Plan 40-05's pipeline impl.
4. fakes.ts ships 5 universal factories (not 7) per Warning #4 — `EmbeddingClient` / `LLMClient` fakes ship co-located with their matchers in Plans 40-03 + 40-04.
5. Baseline test suite is 92 / 9 (not 56 / 9 as the plan stated); zero regression on the 92 number.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Inline `Deduplicator` interface instead of forward-reference import of `LayeredDeduplicator`**

- **Found during:** Task 1 (src/pipeline/types.ts creation)
- **Issue:** The plan-author-prescribed `import type { LayeredDeduplicator } from '../dedup/LayeredDeduplicator.js';` (40-01-PLAN line 115) would produce `error TS2307: Cannot find module '../dedup/LayeredDeduplicator.js' or its corresponding type declarations` at Plan 40-01 time, because that class file is created in Plan 40-05. The plan's note "forward-reference is OK — type-only imports erase at compile time" is incorrect for TypeScript NodeNext + `strict` mode: type-only imports still require module-resolution success at compile time; only the runtime emission of the import is elided.
- **Verification approach:** Confirmed via a minimal repro in `/tmp/ts-test/` with the same `tsconfig.json` shape as km-core — a type-only import of a nonexistent `./nonexistent.js` produces `error TS2307` under `--module NodeNext --strict`.
- **Fix:** Declared an inline structural `Deduplicator` interface in `src/pipeline/types.ts`:
  ```typescript
  export interface Deduplicator {
    dedup(entity: Entity, candidates: Entity[]): Promise<DedupResult>;
  }
  ```
  `IngestPipelineOpts.deduplicator` is now typed `Deduplicator` instead of `LayeredDeduplicator`. Plan 40-05's `LayeredDeduplicator` class will declare `implements Deduplicator` (or simply satisfy structural typing).
- **Files modified:** `~/Agentic/km-core/src/pipeline/types.ts` (created with the inline interface in place — never had the forward-reference import).
- **Committed in:** `3e6c6ef` (Task 1 commit).
- **Downstream impact:** Plan 40-05's `LayeredDeduplicator` class header should add `implements Deduplicator` (importing from `../pipeline/types.js`). The Deduplicator interface lives in `src/pipeline/types.ts` because the pipeline is the consumer of the contract; the dedup module ships its own LayeredDeduplicator implementation that satisfies it. This is the same authoritative-consumer pattern as `OntologyValidator` (declared by the store, implemented by `src/validation/ontology.ts`).

**2. [Rule 3 - Blocking] Task execution order reordered: 2 → 1 → 3**

- **Found during:** Setup of Task 1.
- **Issue:** `src/pipeline/types.ts` imports `DedupResult` from `../dedup/types.js` (consumed by the inline `Deduplicator.dedup()` signature). Per-task verify steps run `npx tsc --noEmit` and must pass for each commit. If Task 1 were committed first, `src/dedup/types.ts` would not yet exist and tsc would fail with TS2307. Task 2 must exist on disk for Task 1's verify to succeed.
- **Fix:** Created Task 2 file first, then Task 1, then Task 3. All three commits carry the `feat(40-01):` / `test(40-01):` scope tag so the plan's commit history is grep-recoverable via `git log --grep '(40-01)'`. The task semantic content matches the plan exactly; only the on-disk ordering differs.
- **Files modified:** None (no files moved; just commit ordering).
- **Committed in:** Commits `09e0873` (Task 2 first), `3e6c6ef` (Task 1 second), `85015ca` (Task 3 third).
- **Downstream impact:** None — Wave 1 plans can still read all three files in the order most natural to them.

**3. [Rule 1 - Bug] Test-suite baseline number documented as 92 / 9, not 56 / 9**

- **Found during:** Pre-execution baseline verification (before Task 2 creation).
- **Issue:** Plan 40-01 line 46 + line 261 state "existing 56-test suite still passes" and "the existing 56-test suite". The actual baseline at Plan 40 execution time is 92 tests / 9 test files — the suite grew during Phase 38 (ontology-registry plans) and Phase 39 (entity-data-model plans 01-04). The plan's stated number was stale at the time it was written / not refreshed.
- **Fix:** This SUMMARY's `Verification` section uses the correct 92 / 9 number. No code change needed — the spirit of the acceptance criterion ("existing test suite still passes / zero regression") is fully satisfied (92 / 9 → 92 / 9 with the three new files added).
- **Files modified:** This SUMMARY only.
- **Committed in:** N/A (documentation-only deviation).

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 1 stale-spec bug).
**Impact on plan:** All three deviations are necessary for the plan's verify steps to succeed. None introduce new functionality or scope; all preserve the plan's stated objective (lock the type surface so Wave 1 can run in parallel). The inline-`Deduplicator` decision is the only deviation that downstream plans will notice — Plan 40-05's LayeredDeduplicator class should `implements Deduplicator` from `../pipeline/types.js`.

## OKM Type-Shape Deltas

Per the plan's `<output>` requirement to note deltas applied to OKM type shapes:

### IngestResult deltas (vs OKM `pipeline.ts:51-61`)

- **Dropped fields:** `entityIds`, `errors`, `orphanNodeIds`, `confirmedCount` (per 40-RESEARCH Q2 #9 dropdown list).
- **Added fields:** `skippedStages: StageName[]`, `skippedCount: number`, `droppedCount: number`.
- **Restructured `durations`:** OKM ships a single flat `durations: Record<string, number>`; km-core ships an explicit shape `durations: { extractMs, dedupMs, storeMs, synthesizeMs }` so all four are typed.

### PhaseCallback deltas (vs OKM `pipeline.ts:64-68`)

- **Added field:** `count?: number` (per 40-CONTEXT specifics line 139) so `status: 'done'` events can carry a per-stage population count.

### IngestPipelineOpts deltas (vs OKM IngestionPipeline ctor)

- **Options-object replaces 4-positional ctor** per D-42 / CF-D14. OKM: `new IngestionPipeline(extractor, deduplicator, synthesizer, onPhase?)`; km-core: `new IngestPipeline(store, { extractor, deduplicator, synthesizer, onPhase? })`. The `store` argument is positional because it's the central dependency (matches Phase 39 GraphKMStore ctor precedent); the three stage impls move into the options-object.

### IngestOpts deltas (net-new in km-core)

- OKM did not have a per-call opts struct; the equivalent shape lived as scattered positional args. km-core's `IngestOpts` collects `provenance` (REQUIRED per CF-D30), `skipStages?` (per D-43), `domain?` (passed verbatim to the extractor).

### Dedup type deltas (vs OKM `deduplicator.ts:24-36`)

- **Split into per-layer + aggregated verdicts:** OKM ships a single `DeduplicationResult`; km-core splits it into `MatchResult` (per-layer return) + `DedupResult` (LayeredDeduplicator aggregated return).
- **Added `matchedLayer` discriminator** on `DedupResult` so callers can route on which layer matched without inspecting `allLayerResults`.
- **Added `allLayerResults` audit trail** on `DedupResult` so `shortCircuit: false` calibration runs can record every layer's verdict.
- **Threshold becomes per-layer `readonly` field** on each layer interface (not on the dedup result type) per D-44.

## Issues Encountered

None — the three deviations above were caught at pre-execution review and resolved with mechanical fixes (inline interface, commit reordering, doc-only baseline-number correction). No checkpoints needed; no human verification gates triggered.

## Next Phase Readiness

**Plans 02, 03, 04 can now run in parallel** — types contracts and 5 universal shared fakes are in place. Plans 03 + 04 create their own client-specific fakes (`fakes-embedding.ts`, `fakes-llm.ts`) co-located with their matchers.

- **Plan 40-02 (JaccardNameMatcher port):** consume `ExactNameLayer` + `MatchResult` from `src/dedup/types.ts`; reuse `mkEntity` + `makeLayerStub({ kind: 'exactName' })` from `fakes.ts`.
- **Plan 40-03 (CosineEmbeddingMatcher port):** consume `EmbeddingLayer` + `MatchResult` from `src/dedup/types.ts`; reuse `mkEntity` from `fakes.ts`; create `tests/unit/_helpers/fakes-embedding.ts` with the `EmbeddingClient` interface + `makeFakeEmbeddingClient()` co-located with the matcher.
- **Plan 40-04 (LLMSemanticMatcher port):** consume `LLMSemanticLayer` + `MatchResult` from `src/dedup/types.ts`; reuse `mkEntity` from `fakes.ts`; create `tests/unit/_helpers/fakes-llm.ts` with the `LLMClient` interface + `makeMockLLMClient()` co-located with the matcher.

After Wave 1, Plan 40-05 implements `LayeredDeduplicator` (consuming the three layer interfaces + `DedupResult` from `src/dedup/types.ts`, declaring `implements Deduplicator` from `src/pipeline/types.ts`). Plan 40-06a implements `IngestPipeline` consuming the full pipeline type surface. Plan 40-07 wires the root barrel.

No blockers, no concerns. Wave 1 unblocked.

## Self-Check: PASSED

- Created files exist:
  - `/Users/Q284340/Agentic/km-core/src/pipeline/types.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/src/dedup/types.ts` — FOUND
  - `/Users/Q284340/Agentic/km-core/tests/unit/_helpers/fakes.ts` — FOUND
- Commits exist in `~/Agentic/km-core/`:
  - `09e0873` (`feat(40-01): scaffold dedup public type surface`) — FOUND
  - `3e6c6ef` (`feat(40-01): scaffold pipeline public type surface`) — FOUND
  - `85015ca` (`test(40-01): add universal test fakes barrel for pipeline + dedup tests`) — FOUND
- `tsc --noEmit` clean: PASSED
- `npx vitest run` zero-regression (92/9 → 92/9): PASSED

---
*Phase: 40-ingest-pipeline-layered-dedup*
*Completed: 2026-05-21*
