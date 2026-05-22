---
phase: 40-ingest-pipeline-layered-dedup
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - /Users/Q284340/Agentic/km-core/src/pipeline/types.ts
  - /Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts
  - /Users/Q284340/Agentic/km-core/src/pipeline/index.ts
  - /Users/Q284340/Agentic/km-core/src/dedup/types.ts
  - /Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts
  - /Users/Q284340/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts
  - /Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts
  - /Users/Q284340/Agentic/km-core/src/dedup/LayeredDeduplicator.ts
  - /Users/Q284340/Agentic/km-core/src/dedup/index.ts
  - /Users/Q284340/Agentic/km-core/src/index.ts
  - /Users/Q284340/Agentic/km-core/package.json
findings:
  critical: 4
  warning: 8
  info: 5
  total: 17
status: issues_found
---

# Phase 40: Code Review Report

**Reviewed:** 2026-05-22
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 40 implements an `IngestPipeline` (4-stage orchestrator) plus a 3-layer `LayeredDeduplicator` (Jaccard / cosine / LLM-semantic) plus the public-API barrel + package.json sub-paths. Overall the type plumbing is careful and the docstrings are very rich, but adversarial review surfaces material defects:

- **4 BLOCKERS** — runtime bugs and contract holes that will mis-behave under real callers: missing `ontologyClass` defensive guard inside `IngestPipeline` (will pass `undefined` into `store.findByOntologyClass` despite the surrounding code claiming the dedup orchestrator catches that case), wrong identity-guard in `JaccardNameMatcher` (rejects matches on `Entity.id` even though the pipeline calls dedup with a NEW entity whose v7 id is unique by construction — but still wrong if the candidate pool ever contains the same logical entity at a different id), `parseDedupResponse` throws on slop responses (LLM matcher's `'skip'` mode does catch it, but the `'throw'` mode propagates `SyntaxError` not a typed error), and `IngestPipeline.runStage('extract')` ignores the caller-supplied `domain` (drops it on the floor, breaks parity with `ingest()`).
- **8 WARNINGS** — `parseDedupResponse` consumes pre-trim content as `s` then re-trims fence-groups inconsistently with the rest of the fallthrough; `LayeredDeduplicator` short-circuit gate double-tests `matched && confidence >= threshold` but layer implementations already enforce threshold internally, so calibration runs with low ctor thresholds can silently invert priorities; `survivor!` non-null assertions on a discriminated union that doesn't truly enforce the invariant; `Date.now()` for wall-clock instead of `performance.now()`; synthesizer receives predecessor (survivor) IDs not the just-stored successor IDs, which is the documented contract but is at minimum ambiguous; per-entity sequential await loops in `ingest()` and `runStage('store')`; LLM matcher prompt builds `newNames` as a single-element array (over-general OKM port); `IngestPipeline.deduplicator` typed as `LayeredDeduplicator` but ctor accepts `Deduplicator` then casts (`as LayeredDeduplicator`).
- **5 INFO** — barrel duplicates exports between root `src/index.ts` and the `pipeline`/`dedup` sub-barrels (acceptable but documented as a redundancy); minor JSDoc + naming nits.

Phase 40 is **not ready to ship as-is**. The BLOCKER issues must be fixed before downstream phases (41/42/43) wire concrete clients.

## Critical Issues

### CR-01: `IngestPipeline.ingest()` passes `undefined` into `store.findByOntologyClass` when entity lacks `ontologyClass` AND `entityType` falls back to undefined-stringification — `LayeredDeduplicator`'s Pitfall-1 guard is bypassed at the pre-load layer

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:197-204`
**Issue:**
The dedup stage in `ingest()` computes `const ontologyClass = entity.ontologyClass ?? entity.entityType;` and then calls `this.store.findByOntologyClass(ontologyClass)`. `Entity.entityType` is a required `string` field on the type, so the runtime invariant *should* hold — but the LayeredDeduplicator's documented Pitfall-1 guard (`LayeredDeduplicator.ts:136`) explicitly handles the case where `!entity.ontologyClass && !entity.entityType`. That guard runs **after** `findByOntologyClass` has already been called with an empty/undefined-ish argument from the pipeline. If a caller's extractor returns an entity missing `entityType` (e.g. legacy A/B fixtures sliced into the pipeline pre-backfill, or a buggy extractor), `findByOntologyClass(undefined as any)` will silently return an empty array (because `entity.entityType !== undefined` is true for every stored entity) — so dedup gets an empty candidate pool, every input becomes "net-new", and duplicates are silently written. The LayeredDeduplicator's guard never fires because we never reach it.

The pipeline must either (a) assert `entity.entityType` is a non-empty string before the `findByOntologyClass` call (and skip/error the entity if missing), or (b) move the Pitfall-1 guard into the pipeline so the candidate-pool sourcing is gated by the same invariant.

**Fix:**
```typescript
// Stage 2: dedup (per-entity, candidate pool scoped via D-46).
const dedupDecisions: Array<{ entity: Entity; survivor?: Entity }> = [];
if (!skip.has('dedup')) {
  this.onPhase?.({ stage: 'dedup', status: 'start' });
  const t0 = Date.now();
  for (const entity of entities) {
    const ontologyClass = entity.ontologyClass ?? entity.entityType;
    // Pitfall 1: don't even try to pre-load if neither class is set.
    // Skip dedup for this entity; let putEntity strict validation surface
    // the missing-ontology error downstream.
    if (!ontologyClass) {
      process.stderr.write(
        `[km-core/pipeline] entity ${String(entity.id)} missing ontologyClass/entityType — skipping dedup\n`,
      );
      dedupDecisions.push({ entity });
      continue;
    }
    const candidates = await this.store.findByOntologyClass(ontologyClass);
    const dedupResult: DedupResult = await this.deduplicator.dedup(entity, candidates);
    dedupDecisions.push({
      entity,
      survivor: dedupResult.matched ? dedupResult.survivor : undefined,
    });
  }
  // ... rest unchanged
}
```

### CR-02: `JaccardNameMatcher` self-identity guard via `candidate.id === entity.id` is meaningless when the pipeline calls it with a FRESHLY-MINTED entity — and silently wrong when the pipeline calls it with a pre-stamped entity that happens to collide

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts:53`
**Issue:**
`JaccardNameMatcher.match()` (and `CosineEmbeddingMatcher.match()` lines 123, and `LLMSemanticMatcher.match()` line 132) all skip a candidate when `candidate.id === entity.id`. But the pipeline calls `dedup(entity, candidates)` BEFORE `store.putEntity(entity, ...)` — at that point, the input entity's `id` is either (a) freshly minted by the extractor (uniquely v7, so collision with any candidate is astronomically improbable), or (b) unset/empty (the store will mint it during `putEntity`). The guard CAN match in case (b) when `entity.id === undefined` and a candidate also happens to have `id === undefined` — but more importantly the guard is structurally wrong for the dedup contract:

The whole point of dedup is to find a candidate that is the SAME LOGICAL ENTITY as the input but at a DIFFERENT id. A candidate with the same id is the same physical row — which can't happen on the new-entity write path. So the guard is dead code on the happy path AND it actively WRONG when an extractor that runs an idempotent re-extraction (e.g. re-processing the same observation file) hands the pipeline an entity whose id matches an existing stored entity: the guard would skip the perfect match and the pipeline would write a duplicate.

The downstream consequence is at the IngestPipeline level: if an extractor re-emits a previously-stored entity (legacy id round-trip), the dedup layers will refuse to match it against itself and a second copy will be written with the same id — and `store.putEntity` on the strict path doesn't dedupe-by-id either (it stamps a new validFrom).

**Fix:**
Remove the `candidate.id === entity.id` guard or replace it with a `legacyId` / `name`-tuple check that actually reflects "this candidate is the entity itself". For the happy-path new-entity case the guard is unneeded; for the re-extraction case the guard actively prevents the correct dedup match.

```typescript
// JaccardNameMatcher.ts — replace line 53
for (const candidate of candidates) {
  // No self-id guard: by construction of D-46 (active-only candidate pool),
  // an exact id collision means the same logical entity, which IS what
  // dedup is meant to catch. Self-write protection is the store's job, not
  // the matcher's. See CR-02.
  const score = jaccard(entity.name, candidate.name);
  if (score >= this.threshold && (!best || score > best.score)) {
    best = { candidate, score };
  }
}
```
(Same change in `CosineEmbeddingMatcher.ts:123` and `LLMSemanticMatcher.ts:132`.)

### CR-03: `parseDedupResponse` in `LLMSemanticMatcher` throws raw `SyntaxError` on the bare-brace failure path — `onError: 'throw'` mode surfaces an opaque `JSON.parse` error to the caller, not a typed dedup error

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts:200-228`
**Issue:**
The 5-stage unwrap is documented as defensive, but stage 5 (`return JSON.parse(s);`) on line 227 throws a raw `SyntaxError` if NONE of the fences/braces matched (e.g. the LLM returned bare prose like `"No duplicates found."`). In `onError: 'skip'` mode the outer try/catch (line 160) swallows it, BUT the warning written to stderr says `"match error for ... skipping"` — the operator has no way to distinguish a JSON-parse failure from an LLM-timeout from a network error from a client-thrown error. In `onError: 'throw'` mode (line 161), the raw `SyntaxError` propagates up to the LayeredDeduplicator and then to the IngestPipeline caller — exposing an internal JSON-shape detail as a public error type.

Additionally the bare-brace branch (line 219) doesn't actually run when `s` starts with `{` — but if the response is `"Sure, here is the JSON: {invalid json content}"`, the bare-brace branch will execute, slice from first `{` to last `}`, and pass the (still-invalid) substring to `JSON.parse` which throws. The 4-stage fallthrough has no "give up gracefully and return no-match" terminal branch.

**Fix:**
Wrap the terminal `JSON.parse` in a try/catch that returns an explicit no-match shape, and throw a typed error from `match()` only when `onError: 'throw'`:

```typescript
function parseDedupResponse(
  raw: string,
): { matches?: Array<{ newName: string; existingName: string }> } {
  let s = raw.trim();
  // ... (existing unwrap stages unchanged) ...
  try {
    return JSON.parse(s);
  } catch {
    // Defense-in-depth: LLM returned non-JSON prose despite the
    // responseFormat hint. Return an empty matches array so the
    // caller treats it as "no duplicates".
    return { matches: [] };
  }
}
```

Or, alternatively, leave `parseDedupResponse` throwing and wrap the `parseDedupResponse` call inside `match()` with a try/catch that re-throws as `new Error('LLMSemanticMatcher: failed to parse response — ' + raw.slice(0, 200))` so `onError: 'throw'` callers get a meaningful error type.

### CR-04: `IngestPipeline.runStage('extract', ...)` drops `opts.provenance` AND ignores the `domain` that `ingest()` honors — surface drift between the two entry points

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:288, 309`
**Issue:**
The `runStage('extract', ...)` overload (line 288) is declared as `runStage(name: 'extract', input: string, opts: { provenance: ProvenanceStamp })`. The opts object REQUIRES `provenance`, but the implementation (line 309) just calls `this.extractor.extract(input as string, undefined)` — `provenance` is never used, AND the second argument to the extractor is hardcoded to `undefined`, ignoring any domain the caller might want to pass.

Meanwhile `ingest()` (line 181) correctly calls `this.extractor.extract(text, opts.domain)`. This is a surface-drift bug: callers using `runStage('extract', ...)` for off-pipeline invocation lose domain scoping. Plus the overload's `provenance` requirement is misleading — extract doesn't need it (only store + synthesize do), so the type signature is lying about what runStage actually needs.

**Fix:**
Either accept `domain` in the overload OR drop the misleading `provenance` requirement (since it's unused for `extract`):

```typescript
// Overload — line 288
runStage(name: 'extract', input: string, opts?: { domain?: string }): Promise<Entity[]>;

// Implementation — line 309
case 'extract': {
  return this.extractor.extract(input as string, opts?.domain);
}
```

(The implementation signature on line 298 also needs to widen its `opts` to allow `domain?: string`.)

## Warnings

### WR-01: `LayeredDeduplicator` short-circuit gate's `confidence >= layer.threshold` is redundant AND silently re-defines what "matched" means

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/LayeredDeduplicator.ts:166`
**Issue:**
The gate is `if (this.shortCircuit && result.matched && result.confidence >= layer.threshold)`. But every layer's `match()` already enforces `score >= this.threshold` before setting `matched: true` (see `JaccardNameMatcher.ts:55`, `CosineEmbeddingMatcher.ts:125`). The `result.confidence >= layer.threshold` check is therefore always true when `result.matched` is true — UNLESS a custom layer impl violates that invariant, in which case the orchestrator silently overrides the layer's matched verdict. This is undocumented behavior: a custom layer that intentionally reports `matched: true` with low confidence (e.g. for a UI "best-guess" mode) will be dropped by the orchestrator with no audit trail entry distinguishing it from a non-match.

The aggregation path (line 182) uses `layerResults.find((r) => r.matched)` — NO threshold gate. So shortCircuit:true and shortCircuit:false now disagree on what counts as a match.

**Fix:**
Either remove the threshold re-check (trust the layer) OR add it consistently to both paths. Recommend removing:

```typescript
if (this.shortCircuit && result.matched) {
  return {
    matched: true,
    // ...
  };
}
```

### WR-02: `IngestPipeline.deduplicator` field is typed as `LayeredDeduplicator` but the ctor accepts the structural `Deduplicator` interface — `as LayeredDeduplicator` cast erases the type safety the field claims

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:127, 134`
**Issue:**
Field declared `private deduplicator: LayeredDeduplicator` on line 127. Ctor parameter is `opts: IngestPipelineOpts` whose `deduplicator` slot is the structural `Deduplicator` interface (the inline interface in `types.ts:110-113`). The ctor body does `this.deduplicator = opts.deduplicator as LayeredDeduplicator;` (line 134) — a downcast that asserts the structural type IS the class.

This breaks the documented Plan 40-01 forward-reference rationale (the whole point of declaring `Deduplicator` inline was that the pipeline shouldn't depend on `LayeredDeduplicator`'s concrete shape). Worse, callers can pass any `{ dedup: ... }` object and the cast won't catch it — but the field's declared type implies callers GET a `LayeredDeduplicator` back if they read it through reflection. A test passing a mock `{ dedup: vi.fn() }` will succeed at compile time but fail any property access on `this.deduplicator` that isn't on the structural interface.

**Fix:**
Type the field as the structural interface — the implementation only ever uses `.dedup()` which is on the structural type:

```typescript
import type { Extractor, Synthesizer, PhaseCallback, IngestResult,
  IngestOpts, IngestPipelineOpts, StageName, Deduplicator } from './types.js';

// ... line 127
private deduplicator: Deduplicator;

// ... line 134
this.deduplicator = opts.deduplicator; // no cast
```

(Remove the unused `import type { LayeredDeduplicator }` at line 84 — see IN-02.)

### WR-03: `survivor!` non-null assertions in `LayeredDeduplicator` short-circuit + winner paths trust an invariant that's enforced only at runtime by the layer impls

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/LayeredDeduplicator.ts:170, 186`
**Issue:**
Both the short-circuit return (line 170) and the aggregation return (line 186) use `result.survivor!` / `winner.survivor!`. The `MatchResult` type (`dedup/types.ts:46-53`) declares `survivor?: Entity` — so TypeScript can't statically prove the assertion. The runtime invariant ("matched: true ⇒ survivor is defined") is documented in JSDoc on lines 39-45, but a custom `ExactNameLayer` impl that returns `{ matched: true, confidence: 0.95 }` without `survivor` will pass the type checker and crash `IngestPipeline.ingest()` at line 233 with a non-obvious `Cannot read property 'id' of undefined` from `survivor.id`.

**Fix:**
Make `MatchResult` a discriminated union:

```typescript
// dedup/types.ts
export type MatchResult =
  | { matched: true; survivor: Entity; confidence: number }
  | { matched: false; confidence: number };
```

Then the `!` assertions can be removed — TypeScript narrows automatically after the `matched` check.

### WR-04: `Date.now()` for wall-clock timing in `IngestPipeline` — should use `performance.now()` for sub-millisecond accuracy and clock-skew resilience

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:180, 196, 227, 257`
**Issue:**
The pipeline uses `Date.now()` for per-stage wall-clock measurement. `Date.now()` is system-clock-based and (a) can go backward if NTP corrects the clock mid-stage, producing negative `durationMs`, (b) has millisecond resolution only, which loses signal for fast stages like `extract` over short text. `performance.now()` (Node 16+, monotonic, microsecond resolution) is the correct primitive.

**Fix:**
```typescript
import { performance } from 'node:perf_hooks'; // optional — globalThis.performance also works on Node 22

// Replace each `Date.now()` with `performance.now()`
const t0 = performance.now();
// ...
durations.extractMs = Math.round(performance.now() - t0);
```

### WR-05: Synthesizer receives PREDECESSOR (closed/superseded) entity IDs, not the just-stored SUCCESSOR IDs — documented contract is brittle

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:258`
**Issue:**
`const survivorIds = dedupDecisions.filter((d) => d.survivor).map((d) => d.survivor!.id);` — `d.survivor` is the matched candidate (the PRIOR entity that the new one supersedes). After the store stage, `d.survivor.validUntil` has been auto-stamped by `putEntity` (Phase 39 D-33), and the actually-just-written entity is the new one (with `supersedes: survivor.id` and a fresh `id`). Passing the predecessor's id to the synthesizer means the synthesizer reads a CLOSED row from the store — fine if the synthesizer is read-only and only needs the (now stale) attributes, but DANGEROUS if the synthesizer tries to write follow-on relations off that id (e.g. `addRelation({ from: survivorId, to: ... })` will succeed but the source node is closed).

The doc comment on line 252-254 says "matched-survivors-only contract per RESEARCH Example 5 line 646 verbatim". I cannot verify the source, but the semantic is at minimum surprising. If the intent is "give the synthesizer the IDs of entities that survived dedup [i.e. are the canonical row to read]", it should pass the SUCCESSOR ids (the new entities just stored). If the intent is "give the synthesizer the IDs of entities that were MATCHED so it can decide what relations to add to them", the predecessor id is correct but the comment should make clear those rows are now closed.

**Fix:**
At minimum, expand the JSDoc on `Synthesizer.synthesize` (`pipeline/types.ts:91`) to make explicit which ids the synthesizer receives (predecessor vs successor) and what state those rows are in at synthesize-time. Optionally, pass BOTH:

```typescript
await this.synthesizer.synthesize(survivorIds, {
  provenance: opts.provenance,
  // Document explicitly: these are the matched-predecessor IDs; their
  // validUntil was just stamped by the store stage. Read-only access only;
  // for writes, look up the successor via store.findRelations(SUPERSEDED_BY).
});
```

### WR-06: Sequential `await` over entity arrays in `ingest()` Stage 2/3 and `runStage('store')` — caller cannot parallelize, and a single slow LLM call in the dedup loop stalls the entire batch

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:197-209, 228-241, 327-338`
**Issue:**
Stages 2 and 3 use serial `for ... await` loops. For dedup (line 197), this means LLM-layer calls are strictly sequential across the entity batch — a 100-entity batch with a 5s LLM timeout per call yields 500s of wall-clock latency. Stage 3 (store) serializes putEntity calls — putEntity does graph mutation + LevelDB writes, and serial vs Promise.all of N writes against a single LevelDB is essentially the same throughput, BUT serial-await means a single hung putEntity call (e.g. ontology validation triggering an async load) freezes the entire ingest.

Performance is explicitly listed as out-of-v1-scope per `<review_scope>`, BUT the LLM-call serialization in dedup IS a correctness issue when combined with WR-07 (per-entity LLM matcher prompts) because a partial pipeline failure mid-batch leaves the store in an inconsistent state — the entities processed before the failure are written, the ones after are not, and there's no retry hook.

**Fix:**
For Stage 3 (store), keep serial — putEntity ordering matters for supersession closure. For Stage 2 (dedup), document that the LayeredDeduplicator's per-entity calls are sequential and let downstream phases (A/B/C adapters) wrap the pipeline in `Promise.all([pipeline.ingest(text1), pipeline.ingest(text2), ...])` if they want parallelism — but that creates per-batch candidate-pool races (D-46 pre-load isn't atomic with putEntity). Either (a) document the serialization explicitly in the JSDoc, or (b) add a `concurrency?: number` ingest opt and use `p-limit` (would need a dependency add — defer to a follow-up plan).

### WR-07: `LLMSemanticMatcher.match()` sends a SINGLE-ELEMENT `newNames` array to the LLM — wasteful prompt + ignores OKM's batching opportunity

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts:144`
**Issue:**
The user prompt (line 144) is built as `USER_PROMPT(ontologyClass, [entity.name], existingNames)` — a single-element `newNames` array. The prompt's `JSON.stringify(newNames)` yields `["Foo"]` for every call. This is a port from OKM's `batchLLMDedup` which actually batched MULTIPLE new entities into a single LLM call. The Phase 40 surface throws away that batching: callers pay full per-entity LLM latency for each entity in the IngestPipeline batch.

The "matches" response shape supports multiple matches per call. By accepting one entity per call, the matcher pays N× LLM latency for N entities and N× the system-prompt token cost. The LayeredDeduplicator's per-entity contract makes this unavoidable for v0.1, but the prompt should at least use a non-array form when N=1 to save tokens, OR the LLMSemanticMatcher should expose a `matchBatch(entities: Entity[], ...)` method that batches.

**Fix:**
For v0.1 (per-entity contract), simplify the prompt to acknowledge the single-entity case:

```typescript
const USER_PROMPT = (
  ontologyClass: string,
  newName: string,
  existingNames: string[],
): string =>
  `Ontology class: ${ontologyClass}

New entity name: ${JSON.stringify(newName)}
Existing entities: ${JSON.stringify(existingNames)}

Identify whether the new entity is a semantic duplicate of any existing entity. Return a JSON object {"matches": [{"newName": ..., "existingName": ...}]} or {"matches": []} if no duplicate.`;
```

And update the call site to pass `entity.name` (a string) instead of `[entity.name]` (an array). Or, ideally, add a `batchMatch()` method to the `LLMSemanticLayer` interface for downstream phases to use.

### WR-08: `parseDedupResponse` mutates `s` in place across fallthrough branches — first-fence-match path skips the bare-brace branch even on its own failure

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/LLMSemanticMatcher.ts:206-225`
**Issue:**
The unwrap is a single `s = ...` mutation chain. If the anchored fence matches (line 207) but the captured content `fenceMatch[1]` is empty or non-JSON (e.g. the LLM emitted ` ```json\n\n``` `, an empty fenced block), `s` is set to the empty string and the subsequent `JSON.parse('')` throws. The bare-brace fallback (lines 215-225) is in the `else` branch and NEVER runs once any fence matched, even if the fence content is garbage. This is documented as "first stage that produces valid JSON-shaped text wins" (line 199) but the code doesn't validate the stage output — it just trusts the first regex match.

**Fix:**
Validate after each unwrap stage and fall through on validation failure:

```typescript
function parseDedupResponse(raw: string): { matches?: Array<{newName: string; existingName: string}> } {
  const s = raw.trim();
  const candidates: string[] = [];

  // Stage 1: anchored fence
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());

  // Stage 2: unanchored fence
  const unanchored = s.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (unanchored) candidates.push(unanchored[1].trim());

  // Stage 3: bare-brace
  if (!s.startsWith('{') && !s.startsWith('[')) {
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(s.slice(firstBrace, lastBrace + 1));
    }
  }

  // Stage 4: raw
  candidates.push(s);

  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  return { matches: [] };
}
```

## Info

### IN-01: `src/index.ts` duplicates the entire pipeline + dedup sub-barrel surface — redundant export sites that must stay in sync manually

**File:** `/Users/Q284340/Agentic/km-core/src/index.ts:99-122`
**Issue:**
Root barrel re-exports `IngestPipeline`, `LayeredDeduplicator`, 3 matcher classes, 7 types via direct `from './pipeline/...'` / `from './dedup/...'`. These same symbols are also exported from `./pipeline/index.ts` and `./dedup/index.ts`. The sub-barrel + root-barrel split is intentional (`package.json` `exports` map line 16-23 exposes both `./pipeline` and `./dedup` as sub-paths) but the root barrel duplicates rather than re-exporting from the sub-barrels.

**Fix:**
Re-export from the sub-barrels instead of from the leaf files:

```typescript
// src/index.ts — replace lines 99-122
export { IngestPipeline } from './pipeline/index.js';
export type { IngestPipelineOpts, IngestOpts, IngestResult, PhaseCallback,
  StageName, Extractor, Synthesizer } from './pipeline/index.js';

export { LayeredDeduplicator, JaccardNameMatcher, CosineEmbeddingMatcher,
  LLMSemanticMatcher } from './dedup/index.js';
export type { ExactNameLayer, EmbeddingLayer, LLMSemanticLayer, MatchResult,
  DedupResult, EmbeddingClient, LLMClient } from './dedup/index.js';
```

This guarantees the two surfaces stay in sync by construction.

### IN-02: Unused `LayeredDeduplicator` import in `IngestPipeline.ts`

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:84`
**Issue:**
`import type { LayeredDeduplicator } from '../dedup/LayeredDeduplicator.js';` is used only as a type assertion target (line 134) — but per WR-02 the cast should be removed, in which case this import becomes orphaned. The JSDoc {@link} on lines 98, 105 also references `LayeredDeduplicator` but JSDoc {@link} doesn't require an import.

**Fix:**
Remove once WR-02 is applied.

### IN-03: `JaccardNameMatcher.jaccard()` returns 1.0 for two empty-string names — silent false positive on extractor-bug input

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/JaccardNameMatcher.ts:70-76`
**Issue:**
`'' .toLowerCase().split(/\s+/)` returns `['']` (a single empty-string element). Two empty inputs produce intersection `{''}` and union `{''}`, score 1.0. With default threshold 0.85, two empty-named entities match each other with confidence 1.0 — but `Entity.name` is a required field and the extractor SHOULD never emit an empty name. Still, the silent 1.0 score is a sharp edge: a buggy extractor that emits `{ name: '' }` will see all empty-named entities collapse into a single survivor.

**Fix:**
Guard at the top of `jaccard()`:

```typescript
function jaccard(a: string, b: string): number {
  if (!a || !b) return 0; // empty names cannot match
  const words1 = new Set(a.toLowerCase().split(/\s+/));
  const words2 = new Set(b.toLowerCase().split(/\s+/));
  // ...
}
```

### IN-04: `CosineEmbeddingMatcher.match()` calls `client.embed()` in parallel via `Promise.all` for the entire candidate batch — no batching opportunity exposed to the client

**File:** `/Users/Q284340/Agentic/km-core/src/dedup/CosineEmbeddingMatcher.ts:117-120`
**Issue:**
`Promise.all([client.embed(text), ...candidates.map(c => client.embed(textOf(c)))])` fans out N+1 embed calls in parallel. For a 200-entity candidate pool (a single ontologyClass after backfill), that's 201 concurrent calls to the embedding service. If the client is a remote API (e.g. OpenAI embeddings, Cohere), this hits rate limits immediately. The matcher should expose a `client.embedBatch(texts: string[]): Promise<Float32Array[]>` opt that callers can implement for their batch-supporting providers.

**Fix:**
Extend `EmbeddingClient` to optionally support batch embedding:

```typescript
export interface EmbeddingClient {
  embed(text: string): Promise<Float32Array | number[]>;
  embedBatch?(texts: string[]): Promise<Array<Float32Array | number[]>>;
}
```

And in `match()`:

```typescript
const texts = [this.textOf(entity), ...candidates.map((c) => this.textOf(c))];
const vecs = this.client.embedBatch
  ? await this.client.embedBatch(texts)
  : await Promise.all(texts.map((t) => this.client.embed(t)));
const [entityVec, ...candidateVecs] = vecs;
```

### IN-05: JSDoc claims `IngestResult.skippedCount` is "pipeline-internal use, default 0" but the code never sets it to anything other than 0 — incomplete contract

**File:** `/Users/Q284340/Agentic/km-core/src/pipeline/IngestPipeline.ts:170, types.ts:188-191`
**Issue:**
`result.skippedCount` is initialized to 0 in `ingest()` (line 170) and never mutated. The `IngestResult` type doc (lines 188-191 of types.ts) says it's "pipeline-internal use, default 0" — but there's no internal use either. Same for `droppedCount` (line 171, doc lines 192-193). These fields are dead in v0.1.

If they're future-reserved, drop them from v0.1 and add when used. If they're meant to reflect entities the pipeline filtered out (e.g. when CR-01's defensive guard fires), they should be incremented at the relevant skip site.

**Fix:**
Either remove `skippedCount` and `droppedCount` from `IngestResult` until they're used, OR wire them up to the CR-01 defensive-skip path (`skippedCount++` when an entity is skipped at the dedup pre-load stage).

---

_Reviewed: 2026-05-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
