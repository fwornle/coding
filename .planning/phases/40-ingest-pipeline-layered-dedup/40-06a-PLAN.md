---
phase: 40-ingest-pipeline-layered-dedup
plan: 06a
type: execute
wave: 4
depends_on: ["40-01", "40-02", "40-03", "40-04", "40-05"]
files_modified:
  - ~/Agentic/km-core/src/pipeline/IngestPipeline.ts
  - ~/Agentic/km-core/tests/unit/pipeline.test.ts
autonomous: true
requirements: [PIPE-01]
must_haves:
  truths:
    - "IngestPipeline.ingest(text, opts) runs 4 stages in order: extract → dedup → store → synthesize."
    - "skipStages: ['synthesize'] runs the other 3 and records 'synthesize' in IngestResult.skippedStages."
    - "skipStages: ['extract'] with non-empty text throws (per RESEARCH.md Pitfall 5 spec-defined behavior)."
    - "onPhase callback fires for every executed stage with start + done events."
    - "Pipeline threads opts.provenance to store.putEntity unchanged — pipeline NEVER invents a ProvenanceStamp (CF-D30)."
    - "Pipeline pre-loads candidates via store.findByOntologyClass(entity.ontologyClass) before each dedup() call (D-46)."
    - "Pipeline pre-loaded candidates inherit Phase 39 D-34 active-only filter (superseded predecessors excluded)."
    - "When dedup returns matched: true, pipeline calls store.putEntity({ ...entity, supersedes: survivor.id }, { provenance }) — Phase 39 D-33 handles atomic closure internally."
    - "runStage is declared as 4 TypeScript function overloads (per RESEARCH.md Q2 RESOLVED) — NOT a generic <T>."
    - "runStage('synthesize', survivorIds, opts) runs synthesize standalone (A's daily-cron path per D-43)."
    - "Pipeline passes ONLY matched-survivor ids to synthesizer.synthesize (dedupDecisions.filter((d) => d.survivor).map((d) => d.survivor!.id)) — RESEARCH.md Example 5 line 646 verbatim."
  artifacts:
    - path: "~/Agentic/km-core/src/pipeline/IngestPipeline.ts"
      provides: "4-stage pipeline orchestrator (PIPE-01 framework)"
      contains: "export class IngestPipeline; async ingest; async runStage"
    - path: "~/Agentic/km-core/tests/unit/pipeline.test.ts"
      provides: "Unit-test coverage of pipeline contracts (Validation Architecture lines 921-927 + 941; VALIDATION rows 40-T11..40-T18)"
      contains: "describe('IngestPipeline'"
  key_links:
    - from: "src/pipeline/IngestPipeline.ts"
      to: "src/store/GraphKMStore.js"
      via: "store.putEntity + store.findByOntologyClass"
      pattern: "store\\.(putEntity|findByOntologyClass)"
    - from: "src/pipeline/IngestPipeline.ts"
      to: "src/dedup/LayeredDeduplicator.js"
      via: "deduplicator.dedup(entity, candidates)"
      pattern: "deduplicator\\.dedup"
---

<objective>
Land the 4-stage `IngestPipeline` orchestrator class itself (`src/pipeline/IngestPipeline.ts`) plus its unit-test coverage (`tests/unit/pipeline.test.ts`). This is the FIRST half of the original Plan 40-06 split: source class + unit tests only. The 3 integration test files (supersession, candidate-pool, SC#2 collision) ship in Plan 40-06b.

The pipeline composes the extractor, deduplicator, store, and synthesizer into a single `ingest(text, opts)` call. Threads caller-supplied `ProvenanceStamp` through all stages without modification (CF-D30 — pipeline NEVER invents a stamp). Pre-loads same-class candidates via `store.findByOntologyClass(entity.ontologyClass)` before each dedup call (D-46), inheriting Phase 39 D-34's active-only-by-default filter. When dedup matches, writes the new entity with `supersedes: survivor.id` and lets Phase 39's `putEntity` handle the atomic predecessor-closure (D-33 + CR-01).

`runStage` is declared as **4 TypeScript function overloads** (LOCKED by RESEARCH.md Q2 RESOLVED — NOT a generic `runStage<T = unknown>`). The overloads pin the input/return types per stage name so callers get static type errors when they pass the wrong argument shape.

Output: 1 source file (~250 lines per RESEARCH size estimate) + 1 unit test file (10 tests covering VALIDATION rows 40-T11..40-T18 + 2 extras) + green vitest run + dist/ rebuilt.

This plan deliberately stays at ~30-35% context budget. The integration tests in Plan 40-06b are sequenced after this (Wave 4b) and depend on the IngestPipeline class existing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/40-ingest-pipeline-layered-dedup/40-CONTEXT.md
@.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md
@.planning/phases/40-ingest-pipeline-layered-dedup/40-PATTERNS.md
@.planning/phases/40-ingest-pipeline-layered-dedup/40-05-SUMMARY.md
@.planning/phases/39-entity-data-model/39-REVIEW-FIX.md

<interfaces>
<!-- Plan 01 types this plan implements against + Phase 39 store API. -->

From src/pipeline/types.ts (Plan 01):
  export interface IngestPipelineOpts { extractor: Extractor; deduplicator: LayeredDeduplicator; synthesizer: Synthesizer; onPhase?: PhaseCallback; }
  export interface IngestOpts { provenance: ProvenanceStamp; skipStages?: StageName[]; domain?: string; }
  export interface IngestResult { extractedCount; mergedCount; storedCount; skippedCount; droppedCount; durations: {...}; skippedStages: StageName[]; }
  export type StageName = 'extract' | 'dedup' | 'store' | 'synthesize';
  export type PhaseCallback = (e: { stage: StageName; status: 'start' | 'done'; count?; durationMs? }) => void;

From src/dedup/LayeredDeduplicator.ts (Plan 05):
  class LayeredDeduplicator { async dedup(entity: Entity, candidates: Entity[]): Promise<DedupResult>; }

From src/store/GraphKMStore.ts (Phase 39 — DO NOT MODIFY):
  async putEntity(e, opts: { provenance: ProvenanceStamp, skipOntologyCheck?: boolean }): Promise<EntityId>
  async findByOntologyClass(cls: string, opts?: { includeSuperseded?: boolean }): Promise<Entity[]>  // active-only default (D-34)
  async getSupersessionChain(id: EntityId): Promise<Entity[]>
  async batch(ops: BatchOp[]): Promise<void>  // CR-01 widening: ops[i].skipOntologyCheck per-op

runStage signatures (LOCKED by RESEARCH.md Q2 RESOLVED — 4 typed function overloads, NOT a generic):
  runStage(name: 'extract', input: string, opts: { provenance: ProvenanceStamp }): Promise<Entity[]>
  runStage(name: 'dedup', input: Entity, opts: { candidates: Entity[] }): Promise<DedupDecision>
  runStage(name: 'store', input: Entity[], opts: { provenance: ProvenanceStamp; supersedes?: Map<EntityId, EntityId> }): Promise<Entity[]>
  runStage(name: 'synthesize', input: EntityId[], opts: { provenance: ProvenanceStamp }): Promise<void>
  // Plus a single implementation signature at the end (the union — runtime body uses switch on `name`).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write src/pipeline/IngestPipeline.ts + unit tests/unit/pipeline.test.ts (RED→GREEN)</name>
  <files>
    ~/Agentic/km-core/src/pipeline/IngestPipeline.ts
    ~/Agentic/km-core/tests/unit/pipeline.test.ts
  </files>
  <read_first>
    - ~/Agentic/km-core/src/store/GraphKMStore.ts (lines 80-180, 325-411, 556-570, 631-680 — putEntity signature + provenance threading + findByOntologyClass + getSupersessionChain)
    - ~/Agentic/km-core/src/segments/merge.ts (Pattern F SOURCE-comment header + stderr-warn idiom)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts (lines 76-316 — verbatim source for 4-stage chain; lines 28-68 for context types reference)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md offset 545-668 (Example 5 — complete reference impl; line 646 locks the synthesizer-input contract to filter+map of matched survivors)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md "## Open Questions (RESOLVED)" Q2 (LOCKS runStage to 4 typed overloads — NOT a generic; copy the 4 signatures verbatim)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md offset 246-250 (Pitfall 5 — skipStages: ['extract'] throws)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md offset 258-269 (Pitfall 7 — 10 OKM-specific blocks NOT to port)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-PATTERNS.md offset 36-135 ("src/pipeline/IngestPipeline.ts" section — class shape + 4-stage orchestration line-by-line port targets)
    - ~/Agentic/km-core/tests/unit/graph-store.test.ts (Ctx + makeFixture + lifecycle pattern)
    - ~/Agentic/km-core/tests/unit/_helpers/fakes.ts (Plan 01 — makeFakeExtractor, makeFakeSynthesizer, makeLayerStub, mkEntity, PROV)
  </read_first>
  <behavior>
    Source file behavior (after this task):
    - 4-stage `ingest(text, opts)` runs extract → dedup (per-entity, candidate-pool pre-loaded per D-46) → store (putEntity with supersedes when matched) → synthesize.
    - `onPhase` fires start + done for every executed stage; skipped stages emit no callbacks.
    - `IngestResult.skippedStages` enumerates skipped stages; durations object populated per executed stage.
    - `skipStages: ['extract']` with `text !== ''` throws (Pitfall 5).
    - `runStage('synthesize', survivorIds, opts)` invokes synthesizer.synthesize(survivorIds, { provenance }).
    - `runStage` is overloaded as 4 typed function signatures (one per StageName) plus one implementation signature — NOT a generic `<T>`.

    Unit tests (VALIDATION rows 40-T11..40-T18 + 2 extras, 10 total):
    - `'stage order: ingest runs extract → dedup → store → synthesize in order'` (40-T11) — record call order on fakes; assert sequence.
    - `'onPhase observability: callback fires start + done for each executed stage'` (40-T12).
    - `'skipStages synthesize: runs other 3 + records ["synthesize"] in IngestResult.skippedStages'` (40-T13).
    - `'skipStages extract contract: throws when text is non-empty (Pitfall 5)'` (40-T14).
    - `'runStage synthesize: invokes synthesizer.synthesize(survivorIds, { provenance }) standalone'` (40-T15).
    - `'provenance threading: store.putEntity receives the caller-supplied ProvenanceStamp unchanged'` (40-T16) — spy on store.putEntity and assert the opts arg equals the input PROV.
    - `'IngestResult shape: { extractedCount, mergedCount, storedCount, skippedCount, droppedCount, durations: {...}, skippedStages }'` (40-T17) — full shape assertion.
    - `'provenance required: throws TypeError-like error when opts.provenance is omitted'` (40-T18) — cast `as any` to bypass TS, run, expect throw.
    - `'candidate pool per-entity: store.findByOntologyClass called once per extracted entity with entity.ontologyClass'` — extractor returns 3 entities; spy on store.findByOntologyClass; assert call count 3 + correct args.
    - `'dedup match: store.putEntity called with { ...entity, supersedes: survivor.id }'` — wire a layer stub that always matches; spy on putEntity; assert the entity passed includes the supersedes field.
  </behavior>
  <action>
    Step A — Write IngestPipeline.ts per RESEARCH.md Example 5 (offset 545-668) + PATTERNS.md offset 36-135 + RESEARCH.md Q2 RESOLVED (runStage 4-overload lock).

    File structure:
    1. SOURCE-comment header (Pattern F template, mirror the merge.ts:1-31 style) — SOURCE = OKM `pipeline.ts:76-316` (4-stage flow + onPhase); DELTAS = the 6 OKM-specific drops listed in RESEARCH.md Pitfall 7 (PII filter, populateEvidenceMetadata, createDerivedFromEdges, handleMetricEntities, handleSupersession, recordPatternOccurrences) + 4 split-mode entry-point drops (extractOnly, deduplicateAndStore, synthesizeAll, resolveEntities) + D-42 options-object ctor + D-43 skipStages + D-46 candidate-pool pre-load + CF-D30 provenance threading + no-console-log (all 6 OKM console.* lines at pipeline.ts:119, 124, 159, 269, 282 removed; observability via onPhase callback only) + RESEARCH Q2 RESOLVED runStage 4-overload form (NOT generic).

    2. Imports: `import type { GraphKMStore } from '../store/GraphKMStore.js'; import type { Entity, EntityId, ProvenanceStamp } from '../types/entity.js'; import type { LayeredDeduplicator, DedupDecision } from '../dedup/LayeredDeduplicator.js'; import type { Extractor, Synthesizer, PhaseCallback, IngestResult, IngestOpts, IngestPipelineOpts, StageName } from './types.js';` (all type-only).

    3. Export `class IngestPipeline`:
       - Private fields: store, extractor, deduplicator, synthesizer, onPhase?.
       - ctor `(store: GraphKMStore, opts: IngestPipelineOpts)` — store positional (primary subject per CF-D14), rest in opts.
       - `async ingest(text: string, opts: IngestOpts): Promise<IngestResult>`:
         - GUARD: `if (!opts || !opts.provenance) throw new Error('IngestPipeline.ingest requires opts.provenance (CF-D30 — pipeline does not invent provenance)');`
         - Build `const skip = new Set<StageName>(opts.skipStages ?? []);`
         - GUARD: `if (skip.has('extract') && text && text.length > 0) throw new Error('skipStages: ["extract"] is only valid with empty text — use runStage() for off-pipeline stage invocation (Pitfall 5)');`
         - Initialize result + durations records per Example 5 lines 587-592.
         - Stage 1 (extract): if !skip.has('extract'): fire `onPhase?.({ stage: 'extract', status: 'start' })`, time `extractor.extract(text, opts.domain)`, fire done with `count: entities.length`.
         - Stage 2 (dedup): if !skip.has('dedup'): per-entity loop calling `store.findByOntologyClass(entity.ontologyClass ?? entity.entityType)` THEN `deduplicator.dedup(entity, candidates)`; collect `dedupDecisions[]`. ELSE: pass-through entities as net-new. Fire onPhase start+done.
         - Stage 3 (store): if !skip.has('store'): per decision, if survivor → `store.putEntity({ ...entity, supersedes: survivor.id }, { provenance: opts.provenance })`; else → `store.putEntity(entity, { provenance: opts.provenance })`. Increment `result.storedCount`. Fire onPhase start+done.
         - Stage 4 (synthesize): if !skip.has('synthesize'): build the survivor-ids array as matched-survivors-only per RESEARCH.md Example 5 line 646 verbatim — the line MUST be `const survivorIds = dedupDecisions.filter((d) => d.survivor).map((d) => d.survivor!.id);`. This passes ONLY the ids of survivors that were matched during dedup — NOT every stored entity's id. The synthesizer is responsible for querying the store for any additional context it needs (PATTERNS.md offset 161 confirms: "Synthesizer receives entity IDs not entities — synthesizer reads from store if needed"). Then `await this.synthesizer.synthesize(survivorIds, { provenance: opts.provenance });` + fire onPhase done.
         - Final: assemble `result.durations` from the timing map, return result.

       - `runStage` — declared as 4 typed function overloads (LOCKED by RESEARCH.md Q2 RESOLVED; copy these signatures verbatim — do NOT use a generic `<T>`):
         - Overload 1: `runStage(name: 'extract', input: string, opts: { provenance: ProvenanceStamp }): Promise<Entity[]>;`
         - Overload 2: `runStage(name: 'dedup', input: Entity, opts: { candidates: Entity[] }): Promise<DedupDecision>;`
         - Overload 3: `runStage(name: 'store', input: Entity[], opts: { provenance: ProvenanceStamp; supersedes?: Map<EntityId, EntityId> }): Promise<Entity[]>;`
         - Overload 4: `runStage(name: 'synthesize', input: EntityId[], opts: { provenance: ProvenanceStamp }): Promise<void>;`
         - Plus one implementation signature at the end whose param types are the union (e.g. `name: StageName`, `input: string | Entity | Entity[] | EntityId[]`, `opts: { provenance?: ProvenanceStamp; candidates?: Entity[]; supersedes?: Map<EntityId, EntityId> }`) returning `Promise<Entity[] | DedupDecision | void>`. Body switches on `name`:
           - case 'extract' → `return this.extractor.extract(input as string, undefined);`
           - case 'dedup' → guard `if (!opts.candidates) throw new Error("runStage('dedup') requires opts.candidates");` then `return this.deduplicator.dedup(input as Entity, opts.candidates);`
           - case 'store' → guard provenance; loop `input as Entity[]`; for each, apply `opts.supersedes?.get(entity.id)` if present (build `{ ...entity, supersedes }`); `await this.store.putEntity(...)`; return stored entities.
           - case 'synthesize' → guard provenance; `return this.synthesizer.synthesize(input as EntityId[], { provenance: opts.provenance });`
         - Per RESEARCH.md Q3 + A6 — do NOT fire onPhase callbacks for `runStage` (keep contracts identical to `skipStages` invocation; ingest() is the only path that fires onPhase).

    4. NO `console.*` — onPhase is the ONLY observability channel. Stderr-warns can be added for catastrophic errors (e.g., extractor returns non-array) prefixed `[km-core/pipeline]`.

    All relative imports use `.js` suffix.

    Step B — Write tests/unit/pipeline.test.ts with the 10 tests above. Follow PATTERNS.md offset 594-655 for Ctx + makeFixture + lifecycle pattern. Use `tests/unit/graph-store.test.ts:8-71` as the template. Use the `_helpers/fakes.ts` factories.

    For the SC#3 cadence-control test ("skipStages: ['synthesize'] runs other 3 + records in skippedStages"), assert `result.skippedStages` is `['synthesize']` and `result.storedCount` equals the extracted count.

    For the "runStage synthesize" test, instantiate pipeline with a spied synthesizer; call `await pipeline.runStage('synthesize', [entity.id], { provenance: PROV })`; assert `synthesizer.synthesize` was called with `([entity.id], { provenance: PROV })`. Because runStage is overloaded, TS should accept `[entity.id]` (EntityId[]) as the input arg for the 'synthesize' overload — verify by NOT casting in the test (a cast would mask an overload regression).

    Run RED → fix Pitfall 5 / provenance-required guards → GREEN.

    Build + verify: `cd ~/Agentic/km-core && npm run build && npx vitest run tests/unit/pipeline.test.ts`.
  </action>
  <verify>
    <automated>cd ~/Agentic/km-core && npm run build 2>&1 | grep -qE "error TS" && echo "BUILD FAILED" || echo "BUILD OK" && cd ~/Agentic/km-core && npx vitest run tests/unit/pipeline.test.ts 2>&1 | grep -E "Tests.*10 passed" && echo "GREEN OK"</automated>
  </verify>
  <acceptance_criteria>
    - File `~/Agentic/km-core/src/pipeline/IngestPipeline.ts` exists.
    - `grep -c "export class IngestPipeline" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns `1`.
    - `grep -c "store.findByOntologyClass" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns `1`.
    - `grep -c "store.putEntity" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns at least `2` (matched + unmatched branches).
    - `grep -c "deduplicator.dedup" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns `1`.
    - `grep -c "supersedes: survivor.id" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns `1`.
    - Provenance-required guard: `grep -c "requires opts.provenance" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns at least `1`.
    - Pitfall 5 guard: `grep -cE "(skipStages.*extract.*empty text|Pitfall 5)" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns at least `1`.
    - All 4 stage names referenced: `grep -cE "stage:\\s*'(extract|dedup|store|synthesize)'" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns at least `4`.
    - Zero console.*: `grep -v '^//' ~/Agentic/km-core/src/pipeline/IngestPipeline.ts | grep -v '^ \\* ' | grep -cE 'console\\.(log|info|warn|error|debug)' | grep -q "^0$"`.
    - NO use of raw `store.batch()` for supersession (Pitfall 2 — must go through putEntity): `grep -cE "store\\.batch" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts | grep -q "^0$"` (zero direct batch calls; supersession goes through putEntity).
    - **Matched-survivors-only synthesizer-input contract present exactly once** (Warning #5 cleanup — locks the final decision; RESEARCH Example 5 line 646 verbatim): `grep -c 'dedupDecisions.filter((d) => d.survivor).map' ~/Agentic/km-core/src/pipeline/IngestPipeline.ts | grep -q '^1$'`.
    - **runStage declared as 4 typed overloads, NOT a generic** (Q2 RESOLVED enforcement) — first overload (extract) is declared verbatim: `grep -c "runStage(name: 'extract'" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts | grep -q '^1$'`.
    - All 4 runStage overload signatures present: `grep -cE "runStage\\(name: '(extract|dedup|store|synthesize)'" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts` returns at least `4`.
    - **NO generic runStage form**: `grep -cE "runStage<[A-Za-z_]" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts | grep -q '^0$'` (zero matches of `runStage<T...`).
    - All 10 unit tests pass: `npx vitest run tests/unit/pipeline.test.ts` exits 0.
    - The 8 VALIDATION-rows 40-T11..40-T18 named tests are individually runnable (one greppable name each): `for name in "stage order" "onPhase observability" "skipStages synthesize" "skipStages extract contract" "runStage synthesize" "provenance threading" "IngestResult shape" "provenance required"; do npx vitest run tests/unit/pipeline.test.ts -t "$name" 2>&1 | grep -qE "Tests.*[1-9].*passed" || echo "MISSING: $name"; done` prints nothing (no missing names).
    - All relative imports use .js: `grep -E "^import.*from '\\.\\./" ~/Agentic/km-core/src/pipeline/IngestPipeline.ts | grep -vE "\\.js';\\s*$" | wc -l | grep -q "^0$"`.
  </acceptance_criteria>
  <done>IngestPipeline source + 10 passing unit tests; provenance + Pitfall 5 guards in place; supersession routed through putEntity (no raw batch); runStage declared as 4 typed overloads per Q2 RESOLVED; matched-survivors-only synthesizer-input contract present exactly once; npm run build green.</done>
</task>

<task type="auto">
  <name>Task 2: Build + per-file regression check</name>
  <files>(no source files modified — verification only)</files>
  <read_first>
    - /Users/Q284340/Agentic/coding/CLAUDE.md (Submodule build pipeline)
  </read_first>
  <action>
    Run `cd ~/Agentic/km-core && npm run build` — expect zero `tsc` errors. Confirm `dist/pipeline/IngestPipeline.js` + `.d.ts` exist.

    Run `cd ~/Agentic/km-core && npm test` to confirm the new 10 pipeline tests + all prior tests pass. Plan 40-06b's 3 integration test files do NOT yet exist; that's expected at this wave.

    Capture the full test count for the SUMMARY.
  </action>
  <verify>
    <automated>cd ~/Agentic/km-core && npm run build 2>&1 | grep -qE "error TS" && echo "BUILD FAILED" || echo "BUILD OK" && test -f ~/Agentic/km-core/dist/pipeline/IngestPipeline.js && echo "DIST OK" && cd ~/Agentic/km-core && npm test 2>&1 | tee /tmp/40-06a-task-2-test.log | grep -E "Test Files|Tests.*passed"</automated>
  </verify>
  <acceptance_criteria>
    - `npm run build` exit 0.
    - `~/Agentic/km-core/dist/pipeline/IngestPipeline.js` + `.d.ts` exist.
    - `npm test` exit 0; full suite green.
    - The 8 VALIDATION-named pipeline.test.ts tests (rows 40-T11..40-T18) are individually runnable.
  </acceptance_criteria>
  <done>dist/ fresh; full suite green; Plan 40-06b (integration tests) can proceed.</done>
</task>

</tasks>

<verification>
- Plan goal: 4-stage pipeline orchestrator class + unit-test coverage of VALIDATION rows 40-T11..40-T18 (PIPE-01 framework). Integration tests (rows 40-T19..40-T22) ship in 40-06b.
- Verify the pipeline can be imported + instantiated end-to-end (in isolation, without integration tests): `cd ~/Agentic/km-core && node --input-type=module -e "import { IngestPipeline } from './dist/pipeline/IngestPipeline.js'; console.log(typeof IngestPipeline);"` should print `function`.
</verification>

<success_criteria>
- 1 source file (IngestPipeline.ts) + 1 unit test file (pipeline.test.ts) created.
- 10 unit tests pass; all 8 VALIDATION-named tests (40-T11..40-T18) individually green.
- `dist/pipeline/IngestPipeline.js` + `.d.ts` exist.
- runStage declared as 4 typed function overloads (zero matches of `runStage<T...`); first overload (extract) grep-verifiable.
- Matched-survivors-only synthesizer-input contract present exactly once (Warning #5 cleanup).
- Phase 39 boundary preserved: pipeline goes through putEntity (zero direct store.batch calls in IngestPipeline.ts).
</success_criteria>

<output>
Create `.planning/phases/40-ingest-pipeline-layered-dedup/40-06a-SUMMARY.md` when done. Summary must:
  - Confirm Tasks 1, 2 green; cite test counts.
  - List the 10 unit-test names + which VALIDATION row each maps to (40-T11..40-T18 + 2 extras).
  - Confirm the runStage 4-overload form is present (paste the 4 signature lines).
  - Confirm the matched-survivors-only synthesizer-input line is present (paste the verbatim line).
  - State the total test count after this plan.
  - Confirm `dist/pipeline/IngestPipeline.js` exists.
  - State explicitly: "Plan 40-06b can now proceed — IngestPipeline class is on disk and importable."
</output>
</content>
</invoke>