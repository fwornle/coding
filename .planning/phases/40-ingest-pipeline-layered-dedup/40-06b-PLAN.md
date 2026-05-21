---
phase: 40-ingest-pipeline-layered-dedup
plan: 06b
type: execute
wave: 4b
depends_on: ["40-06a"]
files_modified:
  - ~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts
  - ~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts
  - ~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts
autonomous: true
requirements: [PIPE-01, DEDUP-01]
must_haves:
  truths:
    - "The 3 integration tests run against a real GraphKMStore (no mocks for the store) and prove the cross-module boundary contracts work end-to-end."
    - "ROADMAP SC#2 is verified: synthetic 3-collision batch — exactName catches #1, embedding catches #2, llmSemantic catches #3, all in declared order with short-circuit proven via llmClient.complete.mock.calls.length === 1."
    - "Phase 39 D-33 supersession path works: when dedup matches an active survivor, the pipeline's putEntity({...entity, supersedes}) triggers atomic closure; getSupersessionChain returns [predecessor, successor]."
    - "Phase 39 CR-01 path works: pipeline can supersede a legacy non-v7 id predecessor (seeded via batch + skipOntologyCheck) without throwing."
    - "D-46 + D-34 inheritance verified: store.findByOntologyClass returns only active entities; superseded predecessors are excluded from candidate pools by default."
  artifacts:
    - path: "~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts"
      provides: "ROADMAP SC#2 verification — synthetic 3-layer collision batch (VALIDATION row 40-T19)"
      contains: "describe('Layered dedup — SC#2 synthetic collision batch'"
    - path: "~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts"
      provides: "Integration coverage of Phase 39 D-33 supersession + CR-01 legacy-id path (VALIDATION rows 40-T20, 40-T21)"
      contains: "describe('IngestPipeline supersession'"
    - path: "~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts"
      provides: "Integration coverage of D-46 candidate-pool sourcing + Phase 39 D-34 active-only filter (VALIDATION row 40-T22)"
      contains: "describe('IngestPipeline candidate pool'"
  key_links:
    - from: "tests/integration/layered-dedup-collision-catch.test.ts"
      to: "src/pipeline/IngestPipeline.js"
      via: "imports IngestPipeline + LayeredDeduplicator + all 3 layer matchers"
      pattern: "IngestPipeline|LayeredDeduplicator|JaccardNameMatcher|CosineEmbeddingMatcher|LLMSemanticMatcher"
    - from: "tests/integration/pipeline-supersession.test.ts"
      to: "src/store/GraphKMStore.js"
      via: "real GraphKMStore instance + Phase 39 D-33 atomic closure"
      pattern: "new GraphKMStore"
    - from: "tests/integration/pipeline-candidate-pool.test.ts"
      to: "src/store/GraphKMStore.js"
      via: "real GraphKMStore.findByOntologyClass with active-only default"
      pattern: "findByOntologyClass"
---

<objective>
Land the 3 integration test files that verify Phase 40's cross-module boundary contracts: ROADMAP SC#2 (synthetic 3-collision batch), Phase 39 D-33 supersession path, Phase 39 CR-01 legacy-id widening, and D-46 + D-34 candidate-pool active-only filter.

This is the SECOND half of the original Plan 40-06 split. It runs in sub-wave 4b — sequentially after Plan 40-06a (Wave 4) — because the integration tests depend on the IngestPipeline class existing on disk. The execute-phase orchestrator treats 4b as serial-after-4a (no calendar-day separation, just a dependency-order gate).

No source-file changes here. The IngestPipeline class itself ships in 40-06a; this plan only exercises it through real GraphKMStore instances and real layer matchers (with fake EmbeddingClient + fake LLMClient for the SC#2 test so the LLM-call-count assertion stays deterministic).

Output: 3 integration test files + ~9-10 passing integration tests + green npm test + dist/ unchanged (no source modifications).
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
@.planning/phases/40-ingest-pipeline-layered-dedup/40-06a-SUMMARY.md
@.planning/phases/39-entity-data-model/39-REVIEW-FIX.md

<interfaces>
<!-- IngestPipeline class (Plan 40-06a) — DO NOT MODIFY. Integration tests instantiate this. -->

From src/pipeline/IngestPipeline.ts (Plan 40-06a):
  export class IngestPipeline {
    constructor(store: GraphKMStore, opts: IngestPipelineOpts);
    async ingest(text: string, opts: IngestOpts): Promise<IngestResult>;
    runStage(name: 'extract', ...): Promise<Entity[]>;
    runStage(name: 'dedup', ...): Promise<DedupDecision>;
    runStage(name: 'store', ...): Promise<Entity[]>;
    runStage(name: 'synthesize', ...): Promise<void>;
  }

From src/store/GraphKMStore.ts (Phase 39 — DO NOT MODIFY):
  async putEntity(e, opts: PutEntityOpts): Promise<EntityId>     // D-33 atomic closure when supersedes is set
  async findByOntologyClass(cls: string, opts?): Promise<Entity[]>  // active-only default (D-34)
  async getSupersessionChain(id: EntityId): Promise<Entity[]>
  async batch(ops: BatchOp[]): Promise<void>                     // CR-01 widening: ops[i].skipOntologyCheck per-op

From src/dedup/CosineEmbeddingMatcher.ts (Plan 40-03):
  export interface EmbeddingClient { embed(text: string): Promise<Float32Array | number[]>; }

From src/dedup/LLMSemanticMatcher.ts (Plan 40-04):
  export interface LLMClient { complete(req): Promise<{ content: string }>; }

From tests/unit/_helpers/fakes-embedding.ts (Plan 40-03):
  export function makeFakeEmbeddingClient(opts?): EmbeddingClient

From tests/unit/_helpers/fakes-llm.ts (Plan 40-04):
  export function makeMockLLMClient(opts): LLMClient

From tests/unit/_helpers/fakes.ts (Plan 40-01):
  export function mkEntity(overrides?): Entity
  export function makeFakeExtractor(entities): Extractor
  export function makeFakeSynthesizer(): Synthesizer
  export const PROV: ProvenanceStamp
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Integration tests — supersession (D-33 + CR-01) + candidate pool (D-46 + D-34)</name>
  <files>
    ~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts
    ~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts
  </files>
  <read_first>
    - ~/Agentic/km-core/tests/integration/round-trip.test.ts (full-store lifecycle pattern; path.resolve security; tmp dir setup)
    - ~/Agentic/km-core/src/store/GraphKMStore.ts (lines 413-476 — Phase 39 D-33 supersession closure; lines 475-476 — CR-01 per-op skipOntologyCheck for legacy ids; line 556-570 — findByOntologyClass active-only default)
    - /Users/Q284340/Agentic/coding/.planning/phases/39-entity-data-model/39-REVIEW-FIX.md (CR-01 BatchOp.skipOntologyCheck widening, commit 44c1e9b — what triggers it + what would happen without it)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md offset 938-940 (Validation Architecture — integration test names "supersedes via matched survivor", "CR-01 legacy predecessor", "active-only candidates")
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md offset 974-978 (Reverse-supersession path test + Phase 39 CR-01 path test specs)
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-PATTERNS.md offset 784-816 (integration test patterns)
    - ~/Agentic/km-core/tests/unit/_helpers/fakes.ts (Plan 40-01 — fakes for extractor, synthesizer, layer stubs, PROV, mkEntity)
  </read_first>
  <behavior>
    pipeline-supersession.test.ts tests (4 — covers VALIDATION rows 40-T20, 40-T21):
    - `'supersedes via matched survivor — predecessor closed atomically (Phase 39 D-33 verified)'` (40-T20) — seed entity A; ingest text that extractor emits an entity matching A; verify newEntity has supersedes=A.id AND A.validUntil is set AND `store.getSupersessionChain(newEntity.id)` returns `[A, newEntity]`.
    - `'CR-01 legacy predecessor — dedup match against legacy non-v7 id does NOT throw (Pitfall 2 verified)'` (40-T21) — seed a legacy-id entity via `store.batch([{ type: 'putEntity', entity: { id: 'legacy-nanoid-xyz' as EntityId, ... }, skipOntologyCheck: true }])` (CR-01 trusted path). Wire a dedup that matches against this legacy id. Run pipeline ingest — assert no throw + `store.getEntity('legacy-nanoid-xyz' as EntityId).validUntil` is set.
    - `'no-dedup-match — entity stored as net-new with provenance stamped'` — extractor emits entity; dedup returns no-match; verify storedCount=1 + entity exists + entity.metadata.provenance.createdBy matches PROV.
    - `'getSupersessionChain returns predecessor + successor in validFrom order'` — seed A, ingest matching entity B; assert chain = [A, B].

    pipeline-candidate-pool.test.ts tests (4 — covers VALIDATION row 40-T22):
    - `'candidate pool scoped by ontologyClass — entities of different classes are not compared'` — seed 2 entities: one ontologyClass='Component', one ontologyClass='Pattern'. Ingest entity ontologyClass='Component'. Wire a dedup spy assertion: candidates passed to dedup contains only the 'Component' entity, NOT the 'Pattern' entity.
    - `'candidate pool excludes superseded predecessors by default (Phase 39 D-34 inherited) — active-only candidates'` (40-T22) — seed entity A; supersede A with B (via direct putEntity({...B, supersedes: A.id})); ingest entity matching A's name. Wire a dedup spy: candidates contains only B (active), NOT A (superseded).
    - `'entity with undefined ontologyClass falls back to entityType for pool lookup'` — extractor emits entity with `ontologyClass: undefined, entityType: 'Component'`; verify `store.findByOntologyClass` was called with `'Component'`.
    - `'empty candidate pool — dedup short-circuits to no-match'` — seed nothing; ingest entity; dedup is called with `[]`; result is `{ matched: false }`; entity is stored as net-new.

    Use real GraphKMStore instance (not a mock) — these are INTEGRATION tests. Use tmp dirs per round-trip.test.ts pattern.
  </behavior>
  <action>
    Create `~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts` with the 4 tests above. Wire a real `GraphKMStore` (real LevelDB temp dir), real `IngestPipeline`, real `LayeredDeduplicator` with stubbed layers (so we control dedup verdicts deterministically), real `makeFakeExtractor` + `makeFakeSynthesizer` from `_helpers/fakes.ts`.

    For the CR-01 legacy-id test, use the trusted-path bulk insert pattern documented in 39-REVIEW-FIX.md (commit 44c1e9b): `store.batch([{ type: 'putEntity', entity: {...}, skipOntologyCheck: true }])`. This is the same path B's migration uses (Phase 42). Then trigger a pipeline match against that legacy id; the pipeline's `putEntity({...entity, supersedes: 'legacy-nanoid-xyz'})` triggers Phase 39's atomic closure batch (`closedOld + entity` both with `skipOntologyCheck: true` per CR-01); the test verifies no throw + validUntil is set.

    Create `~/Agentic/km-core/tests/integration/pipeline-candidate-pool.test.ts` with the 4 tests. Spy on `store.findByOntologyClass` calls + on the deduplicator's `dedup` invocations to verify what was passed.

    Lifecycle pattern (mirror round-trip.test.ts):
    - `beforeEach` creates a tmpdir via `fs.mkdtempSync(path.join(os.tmpdir(), 'km-core-pipeline-int-'))`, instantiates `new GraphKMStore({ dbPath: ..., exportDir: ..., debounceMs: 0 })`, awaits `store.open()`.
    - `afterEach` awaits `store.close()` and `fs.rmSync(tmpdir, { recursive: true, force: true })`.

    Run RED for each new file (will fail because the source IngestPipeline didn't have these integration points exercised before) → fix any issues (e.g., if Pitfall 2 fires, it means the pipeline took the raw `batch()` path; revert to putEntity in 40-06a's source) → GREEN.

    Build is NOT required — no source files modified.
  </action>
  <verify>
    <automated>cd ~/Agentic/km-core && npx vitest run tests/integration/pipeline-supersession.test.ts 2>&1 | grep -E "Tests.*4 passed" && echo "SUPERSESSION GREEN" && cd ~/Agentic/km-core && npx vitest run tests/integration/pipeline-candidate-pool.test.ts 2>&1 | grep -E "Tests.*4 passed" && echo "POOL GREEN"</automated>
  </verify>
  <acceptance_criteria>
    - Both integration test files exist.
    - `pipeline-supersession.test.ts` has 4 tests; all pass.
    - `pipeline-candidate-pool.test.ts` has 4 tests; all pass.
    - The 3 RESEARCH-named integration tests are individually runnable: `npx vitest run tests/integration/pipeline-supersession.test.ts -t "supersedes via matched survivor"` AND `-t "CR-01 legacy predecessor"` AND `npx vitest run tests/integration/pipeline-candidate-pool.test.ts -t "active-only candidates"` — all three exit 0 with at least 1 test passed.
    - Both integration files use a real `GraphKMStore` (no mock): `grep -c "new GraphKMStore" ~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts` returns at least `1`; same for candidate-pool.
    - CR-01 legacy-id test creates a legacy entity via the trusted-path: `grep -c "skipOntologyCheck: true" ~/Agentic/km-core/tests/integration/pipeline-supersession.test.ts` returns at least `1`.
  </acceptance_criteria>
  <done>2 integration test files + 8 passing integration tests covering the 3 RESEARCH-named boundary tests (40-T20, 40-T21, 40-T22) + 5 additional coverage cases.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: ROADMAP SC#2 synthetic collision test (VALIDATION row 40-T19)</name>
  <files>~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts</files>
  <read_first>
    - /Users/Q284340/Agentic/coding/.planning/phases/40-ingest-pipeline-layered-dedup/40-RESEARCH.md offset 960-976 (Synthetic-batch design for SC#2 — full spec including the 3 seed entities, 3 batch entities, expected per-layer call counts)
    - /Users/Q284340/Agentic/coding/.planning/ROADMAP.md (Phase 40 §"Success Criteria" #2 — verbatim wording)
    - ~/Agentic/km-core/tests/integration/round-trip.test.ts (integration test lifecycle pattern)
    - ~/Agentic/km-core/tests/unit/_helpers/fakes-embedding.ts (Plan 40-03 — makeFakeEmbeddingClient for Map-keyed deterministic responses)
    - ~/Agentic/km-core/tests/unit/_helpers/fakes-llm.ts (Plan 40-04 — makeMockLLMClient for deterministic LLM matches)
    - ~/Agentic/km-core/tests/unit/_helpers/fakes.ts (Plan 40-01 — mkEntity, PROV, makeFakeExtractor, makeFakeSynthesizer)
  </read_first>
  <behavior>
    This is the canonical ROADMAP SC#2 verification — load-bearing for the phase verification gate. Maps to VALIDATION row 40-T19.

    Single test (with sub-asserts): `'SC#2: synthetic 3-collision batch — exactName / embedding / llmSemantic each catch their respective collision in declared order (3-collision order)'`.

    Setup:
    1. Real `GraphKMStore` with real `OntologyRegistry` pointing at a tmp ontology dir containing a minimal `coding-ontology.json` declaring `Component` as a valid class (or skip ontology validation by NOT passing `ontologyDir` to the store ctor — that's simpler).
    2. Seed 3 entities of `ontologyClass: 'Component'` per RESEARCH.md line 964-967:
       - `{ name: 'UserAuthService', description: 'Handles login flow', ... }` (for exact-name target)
       - `{ name: 'CartCheckoutService', description: 'Handles cart-to-payment transition', ... }` (for cosine target)
       - `{ name: 'PaymentProcessor', description: 'Adapter for Stripe + Braintree', ... }` (for LLM-semantic target — equivalent to "BillingService" by LLM knowledge)
    3. Wire a `LayeredDeduplicator` with all 3 real layer matchers:
       - `JaccardNameMatcher` (default threshold 0.85)
       - `CosineEmbeddingMatcher` with a `makeFakeEmbeddingClient` containing a Map keyed by `"<name>\\n\\n<description>"` returning deterministic vectors so that:
         - 'CartCheckoutFlow' vs 'CartCheckoutService' yields cosine 0.93 (matches above 0.90 default)
         - 'BillingService' vs 'PaymentProcessor' yields cosine 0.40 (well below)
         - all other pairs yield 0.20 (well below)
       - `LLMSemanticMatcher` with a `makeMockLLMClient` returning `{ matches: [{ newName: 'BillingService', existingName: 'PaymentProcessor' }] }` for any call.
    4. Wire `IngestPipeline` with these layers + a `makeFakeExtractor` returning the 3-entity batch:
       - `{ name: 'UserAuthService', ontologyClass: 'Component', ... }` (should match seed 1 via Jaccard 1.0)
       - `{ name: 'CartCheckoutFlow', ontologyClass: 'Component', ... }` (Jaccard ~0.5 < 0.85 → no; cosine 0.93 → match seed 2)
       - `{ name: 'BillingService', ontologyClass: 'Component', ... }` (Jaccard 0 → no; cosine 0.40 → no; LLM → match seed 3)
    5. Capture the embedding client's `vi.fn` and the LLM client's `vi.fn`.

    Run: `await pipeline.ingest(text, { provenance: PROV });`

    Assertions:
    - `result.mergedCount === 3` (all three matched).
    - `result.storedCount === 3`.
    - `result.skippedStages === []`.
    - Embedding client's `embed.mock.calls.length` is greater than 0 for the 2nd + 3rd entity's dedup (loose assertion; the important constraint is the LLM call below).
    - **Load-bearing assertion**: `llmClient.complete.mock.calls.length === 1` — proves both exact-name short-circuit (entity 1 didn't hit LLM) and cosine short-circuit (entity 2 didn't hit LLM); only entity 3 fell through to LLM.
    - After ingest, `await store.getSupersessionChain(<id of 'BillingService' new entity>)` returns `[<original PaymentProcessor>, <new BillingService>]` — proves Phase 39 D-33 atomic closure fired automatically through the pipeline.
  </behavior>
  <action>
    Create `~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` per the spec in `<behavior>`. Use real GraphKMStore + real all-3 matchers + fake embedding/LLM clients (from `_helpers/fakes-embedding.ts` and `_helpers/fakes-llm.ts` co-located by Plans 40-03 + 40-04). Single big `test()` (or split into 3 sub-tests if cleaner) with all the assertions.

    Key implementation pitfalls:
    - The fake extractor must return entities WITH `ontologyClass: 'Component'` for the pipeline's `findByOntologyClass(entity.ontologyClass)` to find the seeded candidates.
    - The fake extractor must return entities WITHOUT an `id` field (or with a fresh UUIDv7) so the pipeline writes them as net-new (rather than updating). Use `mintEntityId()` if needed, or omit `id` and rely on Phase 39's stamping inside putEntity.
    - The fake embedding client's Map key MUST match `CosineEmbeddingMatcher`'s default `textOf` output: `"${name}\\n\\n${description ?? ''}".trim()`. Seed entities must have `description` set for the Map keys to align.
    - The synthesizer can be a no-op `makeFakeSynthesizer()` — synthesis is out of scope for this test.

    Run.
  </action>
  <verify>
    <automated>cd ~/Agentic/km-core && npx vitest run tests/integration/layered-dedup-collision-catch.test.ts 2>&1 | tee /tmp/40-06b-task-2-sc2.log | grep -E "Tests.*passed" | grep -vE "0 passed" && echo "SC#2 GREEN"</automated>
  </verify>
  <acceptance_criteria>
    - File `~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` exists.
    - Contains the SC#2 contract test: `grep -cE "SC#2|3-collision batch|3-collision order" ~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` returns at least `1`.
    - Uses real layer matchers: `grep -cE "(JaccardNameMatcher|CosineEmbeddingMatcher|LLMSemanticMatcher)" ~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` returns at least `3`.
    - Asserts LLM call count === 1: `grep -cE "llmClient\\..*\\.calls\\.length" ~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` returns at least `1`.
    - Asserts getSupersessionChain post-ingest: `grep -c "getSupersessionChain" ~/Agentic/km-core/tests/integration/layered-dedup-collision-catch.test.ts` returns at least `1`.
    - Test passes: `npx vitest run tests/integration/layered-dedup-collision-catch.test.ts` exit 0.
    - mergedCount === 3 + storedCount === 3 assertions present.
    - VALIDATION row 40-T19 runnable via `npx vitest run tests/integration/layered-dedup-collision-catch.test.ts -t "3-collision order"` exit 0.
  </acceptance_criteria>
  <done>ROADMAP SC#2 verified by integration test that runs all 3 real layer matchers + asserts LLM-called-only-once (proving short-circuit through both upper layers). VALIDATION row 40-T19 green.</done>
</task>

<task type="auto">
  <name>Task 3: Final full-suite regression check</name>
  <files>(no source files modified — verification only)</files>
  <read_first>
    - /Users/Q284340/Agentic/coding/CLAUDE.md (Submodule build pipeline — note: no source changes here so no rebuild needed)
  </read_first>
  <action>
    Run `cd ~/Agentic/km-core && npm test`. Expect full suite green including 40-06a's 10 pipeline unit tests + this plan's 9 integration tests (4 supersession + 4 candidate-pool + 1 SC#2).

    No `npm run build` is required — this plan modifies zero source files. Confirm `dist/` is still intact (left over from 40-06a's build).

    Capture the full test count for the SUMMARY.
  </action>
  <verify>
    <automated>cd ~/Agentic/km-core && npm test 2>&1 | tee /tmp/40-06b-task-3-test.log | grep -E "Test Files|Tests.*passed"</automated>
  </verify>
  <acceptance_criteria>
    - `npm test` exit 0; full suite green (estimated ~95-100 tests = 56 baseline + ~40 added across Plans 02-06a + ~9 added here in 06b).
    - The 4 VALIDATION integration rows (40-T19, 40-T20, 40-T21, 40-T22) are individually runnable and all green.
  </acceptance_criteria>
  <done>Full suite green; Plan 40-07 (barrel) can proceed.</done>
</task>

</tasks>

<verification>
- Plan goal: 3 integration test files exercise the cross-module boundaries (Phase 39 D-33/CR-01/D-34, Phase 40 D-46, ROADMAP SC#2). All 4 VALIDATION integration rows (40-T19..40-T22) green.
- Verify no source modifications: `cd ~/Agentic/km-core && git status --porcelain src/` returns 0 lines (this plan touches only tests/).
</verification>

<success_criteria>
- 3 integration test files created.
- ~9 integration tests total; all pass.
- ROADMAP SC#2 verified: layered-dedup-collision-catch.test.ts PASSED with llmClient.complete.mock.calls.length === 1.
- Phase 39 CR-01 legacy-predecessor path verified by pipeline-supersession.test.ts.
- D-46 + D-34 active-only candidate-pool filter verified by pipeline-candidate-pool.test.ts.
- All 4 VALIDATION integration rows (40-T19, 40-T20, 40-T21, 40-T22) individually runnable.
- Zero source-file changes (no rebuild needed).
</success_criteria>

<output>
Create `.planning/phases/40-ingest-pipeline-layered-dedup/40-06b-SUMMARY.md` when done. Summary must:
  - Confirm Tasks 1, 2, 3 green; cite test counts per file.
  - State the SC#2 verification result: e.g., "Layered dedup collision test PASSED. llmClient.complete.mock.calls.length === 1 (verified short-circuit through both upper layers). mergedCount=3, storedCount=3."
  - State the CR-01 legacy-predecessor verification: e.g., "Phase 39 CR-01 path verified — pipeline-supersession.test.ts test 'CR-01 legacy predecessor' passed; no throw on legacy-nanoid id supersession."
  - List the 9 integration test names + which VALIDATION row each maps to (40-T19..40-T22 + 5 additional coverage cases).
  - State the total test count after this plan (expect ~95-100 tests).
  - State explicitly: "Plan 40-07 (barrel) can now proceed."
</output>
</content>
</invoke>