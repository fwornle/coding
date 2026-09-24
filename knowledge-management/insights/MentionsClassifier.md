# MentionsClassifier

**Type:** Detail

# MentionsClassifier — Technical Insight Document

## What It Is

MentionsClassifier is implemented as a single module at `src/live-logging/MentionsClassifier.js`, tested by `MentionsClassifier.test.js` and `MentionsClassifier.primary-subject.test.js`. Rather than a class, it is a pure-function pipeline exposing exactly five public exports: `loadMentionCandidates`, `buildMentionsPrompt`, `extractMentionsFromLLMResponse`, `classifyMentions`, and a test-only reset hook `__resetCacheForTests`. It serves as the leaf dependency through which ObservationConsolidator (its parent) resolves which existing Component/SubComponent/Detail entities a freshly regenerated Insight should reference. The module owns no persistence — it returns ids for the caller to write — and its "children" in this documentation set (MentionsPromptBuilder, MentionsResponseParser, MentionsPacingGate, MentionCandidateLoader) are not separate files or classes but internal functions/clusters within this one file.

## Architecture and Design

The core pattern is a four-stage pure pipeline: load candidates → build prompt → extract structured ids from raw LLM text → compose via `classifyMentions`. This is deliberately structural rather than object-oriented, matching ObservationConsolidator's broader orchestrator-over-single-responsibility-modules design.

Candidate loading (`loadMentionCandidates`, functionally what's labeled MentionCandidateLoader) fetches three ontology classes in parallel and applies a `STRICT_TYPES` guard, because `findByOntologyClass` is documented as an OR-gate matching on `entityType` OR a possibly drifted `ontologyClass` field — without the re-filter, mis-stamped legacy data (74 Insights, 16 Processes, 11 Containers, 15 Observations from a Phase 37/38 schema era) would leak into the candidate catalog. The filter sits after fetch, before caching, so bad data is scrubbed once per store rather than on every call.

A module-scoped pacing gate (internally `_paced()`, `_minIntervalMs()`, `_pace`, `_lastCallStartedAt` — referred to as MentionsPacingGate) serializes outbound proxy calls behind a 1000ms default floor, chaining each gated call off the prior settlement via `.then(() => undefined, () => undefined)` so rejections don't wedge the queue. This exists to survive the call density produced by ObservationConsolidator's dirty-parent-only re-consolidation strategy and its full per-cycle insight regeneration — every regenerated Insight is a fresh `classifyMentions` candidate, so the gate absorbs the resulting back-to-back call stream.

## Implementation Details

`callProxy()` wraps `fetch()` with a 60,000ms `REQUEST_TIMEOUT_MS` via `AbortSignal.timeout` and rewraps network failures by inspecting `err.cause`, since undici collapses all socket errors into an indistinguishable `'fetch failed'` string — a fix motivated by 105 indistinguishable obs-api.log failures observed in practice. This timeout is independent of and stacks with the 1000ms pacing floor: a single call can legitimately consume close to a minute even absent pacing delay.

`resolveProxyUrl()` implements the project-wide four-tier precedence (`RAPID_LLM_PROXY_URL` > `LLM_CLI_PROXY_URL` > `LLM_PROXY_URL` > localhost fallback with `LLM_CLI_PROXY_PORT`), duplicated in-module rather than imported from a shared resolver, with `joinProxyEndpoint()` guarding against double-appending `/api/complete`. `TASK_TYPE` ('mentions-classification') routes to claude-haiku via `processOverrides`, while `PROCESS_LABEL` ('consolidator-mentions') is purely an operator-facing log tag — the module treats these as intentionally distinct to avoid silently breaking routing.

The only mutable state is `_candidateCache`, a WeakMap keyed on the caller's `kmStore` instance, absorbing the candidate-catalog fetch cost across all Insights regenerated in one consolidation cycle. `__resetCacheForTests` exists solely to invalidate this between test runs.

## Integration Points

MentionsClassifier sits beneath LiveLoggingSystem and directly beneath ObservationConsolidator, which invokes `classifyMentions` once per consolidated Insight. It has no awareness of ObservationWriterDelegation (its sibling), consistent with a strict separation between classification and persistence. Externally it depends on an LLM proxy (rapid-llm-proxy) reached through `resolveProxyUrl`/`joinProxyEndpoint`, documented as canonically cross-referenced in CLAUDE.md and `scripts/backfill-raw-observations.mjs`.

## Usage Guidelines

Callers should treat `classifyMentions` as the sole entry point; internal helpers (pacing gate, candidate loader) are not part of the public surface and should not be invoked directly. Tests must call `__resetCacheForTests` between runs to avoid stale WeakMap state, and should set `MENTIONS_MIN_INTERVAL_MS=0` to disable pacing. Developers should not conflate `TASK_TYPE` and `PROCESS_LABEL`, and should expect that a single call may block up to 60s regardless of pacing configuration — timeout and pacing budgets must be reasoned about independently.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- Imports: MentionsClassifier.js, loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, __resetCacheForTests, extractMentionsResult

**Other:**
- MentionsClassifier.js (module) in MentionsClassifier.js
- MentionsClassifier.test.js (module) in MentionsClassifier.test.js
- MentionsClassifier.primary-subject.test.js (module) in MentionsClassifier.primary-subject.test.js
- loadMentionCandidates(kmStore) in src/live-logging/MentionsClassifier.js is the function the code graph names as ObservationConsolidator's entry point into this module. It fetches three ontology classes in parallel (kmStore.findByOntologyClass('Component'/'SubComponent'/'Detail')) and then applies a STRICT_TYPES filter (Set(['Component','SubComponent','Detail'])) on the merged result before caching it. The module's own comment states findByOntologyClass is an OR-gate — it matches on entityType OR a possibly-drifted ontologyClass field — and that without the strict re-filter, 74 Insights, 16 Processes, 11 Containers and 15 Observations would leak into the candidate catalog because their ontologyClass field was mis-stamped 'Detail' during an earlier schema era (Phase 37/38, per the inline comment). This confirms the parent-level observation about the STRICT_TYPES guard, but the code additionally shows WHERE the guard sits: after the fetch, before caching, so a mis-stamped entity is dropped once per WeakMap-keyed store rather than re-filtered on every classifyMentions call.
- The code graph's import list for this file — loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, __resetCacheForTests, extractMentionsResult — describes a four-stage pure-function pipeline rather than a class: candidates are loaded once per store, a prompt is built from an insight summary against those candidates, the raw LLM text is parsed back into a closed set of ids, and classifyMentions composes the three. __resetCacheForTests exists purely to invalidate the per-store WeakMap cache between test runs, confirming the module has exactly one piece of internal mutable state (_candidateCache) and treats it as a testing liability significant enough to need an explicit reset hook.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the 'Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap' record, ObservationConsolidator's dirty-parent-only re-consolidation strategy re-synthesizes only parents that gained new children on a given pass, rather than re-synthesizing every parent every cycle. Because classifyMentions is invoked once per consolidated Insight (per the parent's own import-graph observation), this scheduling strategy is what bounds MentionsClassifier's call volume in production — the module's pacing gate (1000ms floor, described above) exists to survive exactly the call density this dirty-parent strategy still produces, not the higher volume a full re-synthesis pass would generate.
- Per the 'ObservationConsolidator — Two-Tier Memory Aggregation' record, insight documents are fully regenerated each consolidation cycle (distinct from the incremental accumulation of raw observations across the two storage backends). A full per-cycle insight regeneration means every regenerated Insight is a fresh candidate for a classifyMentions call, which is the concrete trigger this module's per-run WeakMap cache (_candidateCache, keyed on the kmStore instance) and 1000ms pacing floor are both sized against — the cache absorbs the candidate-catalog cost across all Insights regenerated in one cycle, while the pacing gate absorbs the resulting back-to-back classifyMentions call stream.

## Hierarchy Context

### Parent
- [ObservationConsolidator](./ObservationConsolidator.md) -- [SESSION] Stage 5 Scheduled Observation Consolidation — Cost Model and Routing Gap: implements a dirty-parent-only scheduled re-consolidation strategy that re-synthesizes only parents with new children, far cheaper than full re-synthesis while nearly matching quality.

### Children
- [MentionsPromptBuilder](./MentionsPromptBuilder.md) -- [LLM+CGR] The parent-context code graph confirms `buildMentionsPrompt` is one of exactly five public exports of `src/live-logging/MentionsClassifier.js`, alongside `loadMentionCandidates`, `extractMentionsFromLLMResponse`, `classifyMentions`, and `__resetCacheForTests`, and that both `MentionsClassifier.test.js` and `MentionsClassifier.primary-subject.test.js` import it. However, the actual retrieved source for `MentionsClassifier.js` is truncated immediately after the body of `loadMentionCandidates()` — the definition of `buildMentionsPrompt` itself was never returned by file retrieval, so no implementation detail (prompt template, message roles, candidate serialization format) can be verified from the supplied code.
- [MentionsResponseParser](./MentionsResponseParser.md) -- [LLM+CGR] No file, class, or export named "MentionsResponseParser" appears anywhere in the supplied code or in the code graph evidence for the parent MentionsClassifier component. The parent's own observations list exactly five public exports of MentionsClassifier.js — loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, and __resetCacheForTests — and "MentionsResponseParser" is not one of them, nor is it referenced as an internal helper, imported module, or class anywhere in the retrieved MentionsClassifier.js excerpt.
- [MentionsPacingGate](./MentionsPacingGate.md) -- [LLM+CGR] The pacing gate is not a separate class or exported symbol named 'MentionsPacingGate' — it is an internal cluster of four module-private bindings inside src/live-logging/MentionsClassifier.js: `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`, and `_paced()`. This matches the parent entity's [LLM] observation describing 'its own global pacing gate (_paced(), _minIntervalMs(), _pace, _lastCallStartedAt)' verbatim — the code graph confirms these are private helpers, not part of the five public exports (loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, __resetCacheForTests), so the gate is reachable by external callers only indirectly, through classifyMentions() → callProxy().
- [MentionCandidateLoader](./MentionCandidateLoader.md) -- [LLM+CGR] The code graph's parent-context observations describe a `loadMentionCandidates()` function as living inside `MentionsClassifier.js`, and the retrieved file `src/live-logging/MentionsClassifier.js` confirms this exactly — the JSDoc header lists `loadMentionCandidates(kmStore): Promise<Candidate[]>` as the first public export, and its implementation (visible in the truncated tail of the file) runs three parallel `kmStore.findByOntologyClass()` calls for 'Component', 'SubComponent', and 'Detail', then filters the merged result through a `STRICT_TYPES` set before mapping to `{id, name, description}`. There is, however, no separate class, module, or file named 'MentionCandidateLoader' anywhere in the supplied code — it is a single exported function nested inside a larger classifier module, not a standalone component.

### Siblings
- [ObservationWriterDelegation](./ObservationWriterDelegation.md) -- [SESSION] Per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' record, ObservationWriter.js mediates all observation persistence with turn-aware semantic dedup and snapshot promotion, but [Raw] fallback observations generated on proxy timeout are logged as 'storing' yet have been repeatedly observed to silently fail to persist. This record describes the write-path's own failure mode; it establishes that a caller delegating writes to ObservationWriter inherits an unverified-persistence risk on the fallback branch specifically, not on the primary dedup/snapshot path.


---

*Generated from 14 observations*
