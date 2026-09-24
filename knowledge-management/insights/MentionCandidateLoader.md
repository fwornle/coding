# MentionCandidateLoader

**Type:** Detail

## What It Is

"MentionCandidateLoader" is not an independently named file, class, or module anywhere in the retrieved codebase. It is a documentation label attached to a single function, `loadMentionCandidates()`, which is exported from `src/live-logging/MentionsClassifier.js` alongside four sibling exports: `buildMentionsPrompt` (implemented by MentionsPromptBuilder), `extractMentionsFromLLMResponse`, `classifyMentions`, and `__resetCacheForTests`. The function's JSDoc signature is `loadMentionCandidates(kmStore): Promise<Candidate[]>`, and its body — visible in the truncated tail of the file — fans out three parallel `kmStore.findByOntologyClass()` calls for the ontology classes 'Component', 'SubComponent', and 'Detail'.

Any document that treats this as a standalone architectural unit is drawing a boundary the source code itself does not draw. It exists only as behavior inside MentionsClassifier, its true parent, and should be understood as one facet of that module rather than a separately deployable or instantiable component.

## Architecture and Design

The core design decision is a strict allow-list filter layered atop a looser query primitive. `kmStore.findByOntologyClass()` matches on an OR-gate (`entityType === cls OR ontologyClass === cls`), which is permissive by construction. `loadMentionCandidates()` compensates by applying `STRICT_TYPES = new Set(['Component', 'SubComponent', 'Detail'])` via `.filter((e) => STRICT_TYPES.has(e.entityType))` before mapping results into the candidate shape `{id, name, description}`. This client-side filtering, rather than pushing the type constraint into the store query, is documented in the module's own decision log as D-03, and exists specifically to exclude entities whose `ontologyClass` was mis-stamped 'Detail' during the Phase 37/38 era (74 Insights, 16 Processes, 11 Containers, 15 Observations affected).

The second notable pattern is per-instance memoization: a module-level `let _candidateCache = new WeakMap();` keyed by the `kmStore` instance itself, mirroring the `_projectAnchorCache` pattern found in `consolidator.js:592`. A comment beside the declaration explicitly cites 'PATTERNS.md landmine 8' and cross-references that same consolidator line, signaling this is a deliberate, previously-debated scoping choice rather than an oversight.

## Implementation Details

Mechanically, the function performs three concurrent `kmStore.findByOntologyClass()` calls (Component, SubComponent, Detail), merges the results, and filters the merged set through the `STRICT_TYPES` Set before mapping to the final candidate DTO. This fan-out-then-filter shape means the strictness guarantee lives entirely in application code, not in the store's query semantics — a trade-off that keeps the store's query primitive general-purpose while pushing correctness responsibility onto this loader.

Caching is intentionally scoped to a single consolidation cycle rather than the process lifetime: because a WeakMap key is the `kmStore` instance, the cache is only as long-lived as callers make it, and the design assumes callers pass the same store handle throughout one consolidation run. This matters because that same run can emit new L1/L2/L3 entities that would otherwise need to be visible to later reads within the same pass — the WeakMap scoping is the mechanism chosen to balance freshness against redundant queries.

Other module-level constants — `PROCESS_LABEL`, `TASK_TYPE`, `SANITY_CAP` — are shared across `MentionsClassifier.js` and presumably touch this loader's neighbors, though their direct interaction with `loadMentionCandidates()` isn't confirmed in the retrieved excerpt.

## Integration Points

`loadMentionCandidates()` depends on `kmStore` as its sole external collaborator, calling `findByOntologyClass()` three times per invocation. Within its parent module, it sits alongside MentionsPromptBuilder (`buildMentionsPrompt`), whose implementation was truncated from the retrieved source and remains unverified, and alongside the internal-only MentionsPacingGate cluster (`_paced()`, `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`), which throttles calls but is only reachable indirectly via `classifyMentions() → callProxy()`. MentionsResponseParser, listed as a nominal sibling, does not correspond to any actual export or internal helper in the retrieved code and should not be assumed to interact with this loader.

The `__resetCacheForTests` export strongly implies test infrastructure exists to reset `_candidateCache` between test runs, though the actual test files (`MentionsClassifier.test.js`, `MentionsClassifier.primary-subject.test.js`) were not retrieved, so the specifics of what assertions exercise the STRICT_TYPES filter or WeakMap lifecycle remain unconfirmed.

## Usage Guidelines

Callers must pass a consistent `kmStore` instance for the duration of a consolidation cycle to get correct cache behavior — swapping store instances mid-cycle defeats the WeakMap's intended reuse, while reusing a stale store across cycles risks serving outdated candidates. Because the STRICT_TYPES filter exists to guard against historical ontology mis-stamping, any future addition of new ontology classes intended as valid mention candidates must be added deliberately to `STRICT_TYPES`, not inferred from `findByOntologyClass()`'s looser matching. Tests should be written or checked against `__resetCacheForTests` to confirm cache isolation between test cases, since no such verification exists in the currently retrieved files.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The code graph's parent-context observations describe a `loadMentionCandidates()` function as living inside `MentionsClassifier.js`, and the retrieved file `src/live-logging/MentionsClassifier.js` confirms this exactly — the JSDoc header lists `loadMentionCandidates(kmStore): Promise<Candidate[]>` as the first public export, and its implementation (visible in the truncated tail of the file) runs three parallel `kmStore.findByOntologyClass()` calls for 'Component', 'SubComponent', and 'Detail', then filters the merged result through a `STRICT_TYPES` set before mapping to `{id, name, description}`. There is, however, no separate class, module, or file named 'MentionCandidateLoader' anywhere in the supplied code — it is a single exported function nested inside a larger classifier module, not a standalone component.

**Other:**
- Per the parent's own [LLM] observation, `loadMentionCandidates()` layers a strict `entityType` filter on top of `kmStore.findByOntologyClass()`'s looser OR-gate matching (entityType === cls OR ontologyClass === cls), specifically to exclude 74 Insights, 16 Processes, 11 Containers, and 15 Observations whose `ontologyClass` was mis-stamped 'Detail' during the Phase 37/38 era. The retrieved `MentionsClassifier.js` source corroborates this precisely: the visible tail defines `const STRICT_TYPES = new Set(['Component', 'SubComponent', 'Detail'])` and applies `.filter((e) => STRICT_TYPES.has(e.entityType))` to the concatenated results of the three `findByOntologyClass` calls, before mapping to the candidate shape — matching decision D-03 cited in the header comment.
- The parent context's [LLM] observation states the candidate catalog is memoized via a WeakMap (`_candidateCache`) scoped per kmStore instance, mirroring a per-run `_projectAnchorCache` pattern in `consolidator.js:592`. The retrieved `MentionsClassifier.js` file confirms the WeakMap declaration (`let _candidateCache = new WeakMap();`) and its accompanying comment, which explicitly cites 'PATTERNS.md landmine 8' and the same `consolidator.js` line-592 cross-reference — the loader's caching strategy is a deliberate scope choice (per-consolidation-cycle, not long-lived) rather than an oversight, since new L1/L2/L3 entities can be emitted by the same consolidation pass that reads them.


## Hierarchy Context

### Parent
- [MentionsClassifier](./MentionsClassifier.md) -- [CGR] MentionsClassifier.js (module) in MentionsClassifier.js

### Siblings
- [MentionsPromptBuilder](./MentionsPromptBuilder.md) -- [LLM+CGR] The parent-context code graph confirms `buildMentionsPrompt` is one of exactly five public exports of `src/live-logging/MentionsClassifier.js`, alongside `loadMentionCandidates`, `extractMentionsFromLLMResponse`, `classifyMentions`, and `__resetCacheForTests`, and that both `MentionsClassifier.test.js` and `MentionsClassifier.primary-subject.test.js` import it. However, the actual retrieved source for `MentionsClassifier.js` is truncated immediately after the body of `loadMentionCandidates()` — the definition of `buildMentionsPrompt` itself was never returned by file retrieval, so no implementation detail (prompt template, message roles, candidate serialization format) can be verified from the supplied code.
- [MentionsResponseParser](./MentionsResponseParser.md) -- [LLM+CGR] No file, class, or export named "MentionsResponseParser" appears anywhere in the supplied code or in the code graph evidence for the parent MentionsClassifier component. The parent's own observations list exactly five public exports of MentionsClassifier.js — loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, and __resetCacheForTests — and "MentionsResponseParser" is not one of them, nor is it referenced as an internal helper, imported module, or class anywhere in the retrieved MentionsClassifier.js excerpt.
- [MentionsPacingGate](./MentionsPacingGate.md) -- [LLM+CGR] The pacing gate is not a separate class or exported symbol named 'MentionsPacingGate' — it is an internal cluster of four module-private bindings inside src/live-logging/MentionsClassifier.js: `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`, and `_paced()`. This matches the parent entity's [LLM] observation describing 'its own global pacing gate (_paced(), _minIntervalMs(), _pace, _lastCallStartedAt)' verbatim — the code graph confirms these are private helpers, not part of the five public exports (loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, __resetCacheForTests), so the gate is reachable by external callers only indirectly, through classifyMentions() → callProxy().


---

*Generated from 9 observations*
