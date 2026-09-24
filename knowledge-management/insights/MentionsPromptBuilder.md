# MentionsPromptBuilder

**Type:** Detail

## What It Is

`MentionsPromptBuilder` refers to `buildMentionsPrompt`, one of five public exports of `src/live-logging/MentionsClassifier.js`, alongside `loadMentionCandidates`, `extractMentionsFromLLMResponse`, `classifyMentions`, and `__resetCacheForTests`. Its documented contract, drawn from the file's header docstring, is `buildMentionsPrompt(insightSummary, candidates): {process, taskType, messages}`. Critically, the actual function body was not returned by file retrieval — the supplied excerpt of `MentionsClassifier.js` truncates immediately after `loadMentionCandidates()`. Everything asserted here about internal behavior is therefore inference from the docstring, sibling function shapes, and the downstream consumer, not from observed source code implementing `buildMentionsPrompt` itself.

## Architecture and Design

Within the parent `MentionsClassifier` module, the classifier pipeline is organized as a sequence of narrowly scoped functions: `loadMentionCandidates` produces a candidate catalog, `buildMentionsPrompt` shapes that catalog plus an `insightSummary` into a request body, and `callProxy` performs the network call. This reflects a "closed-set prompt construction" pattern — the LLM's valid output space is constrained before the call is made, by encoding only the candidates returned from `loadMentionCandidates` (already filtered through `STRICT_TYPES` to Component/SubComponent/Detail) into the prompt's natural-language instructions.

A second pattern evident from the fully-retrieved `callProxy` is the separation of prompt construction from network robustness concerns: pacing (via the sibling `MentionsPacingGate` cluster — `_paced()`, `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`), timeouts (`REQUEST_TIMEOUT_MS`, 60s `AbortSignal.timeout`), and error detailing all live in `callProxy`, not in the prompt builder. `MentionsPromptBuilder` is thus a pure, synchronous data-shaping step, decoupled from I/O and retry logic — consistent with the module's own documented principle of "one LLM call per Insight" (D-02).

## Implementation Details

The only concrete, code-grounded details are the module-level constants `PROCESS_LABEL = 'consolidator-mentions'` and `TASK_TYPE = 'mentions-classification'`, which are plausibly stitched directly into the `process` and `taskType` fields of the builder's returned object, matching the documented `{process, taskType, messages}` shape. The `messages` array is presumed to be constructed from the `insightSummary` argument and the `candidates` array — itself produced by `loadMentionCandidates(kmStore)`, whose implementation runs three parallel `kmStore.findByOntologyClass()` calls for 'Component', 'SubComponent', and 'Detail', filters through `STRICT_TYPES`, and maps results to `{id, name, description}`.

No `for`/`map` loop over `candidates` inside `buildMentionsPrompt` was observed, so the exact serialization format (e.g., whether IDs, names, and descriptions are all embedded, and in what template) cannot be verified. Likewise, whether "primary subject" framing — distinguishing an Insight's main entity from incidental mentions, a concern evidenced by the existence of `MentionsClassifier.primary-subject.test.js` — is injected here or elsewhere remains a plausible but unconfirmed role, since neither the test file nor the function body was retrieved.

## Integration Points

`MentionsPromptBuilder` sits structurally between `MentionCandidateLoader` (`loadMentionCandidates`, the candidate catalog) and `callProxy` (network I/O) in the classifier pipeline. Its output — the `{process, taskType, messages}` body — is passed directly to `callProxy`, which wraps the call in the `MentionsPacingGate` gate and applies a request timeout, but has no visibility into pacing or retries itself. Both `MentionsClassifier.test.js` and `MentionsClassifier.primary-subject.test.js` import `buildMentionsPrompt`, indicating it is exercised by both the general behavioral suite and the suite targeting primary-subject extraction, though the specifics of those tests were not retrieved. As a function nested within `MentionsClassifier.js` rather than a standalone module, it has no separate file or class of its own, mirroring the sibling `MentionCandidateLoader` and `MentionsPacingGate`, which are likewise internal groupings rather than independent components.

## Usage Guidelines

Because the closed-set constraint on valid LLM output originates in `loadMentionCandidates`'s `STRICT_TYPES` filter, any change to that filter should be understood to propagate into whatever instructions `buildMentionsPrompt` encodes — the two functions are tightly coupled by data contract even though they are separately testable. Developers should treat prompt construction and network robustness as intentionally separate concerns per the module's design: pacing, timeout, and retry changes belong in `callProxy` and the `MentionsPacingGate` internals, not in the prompt builder. Given the significant gap in retrieved evidence — the function body, its message template, and its test assertions were never returned by file retrieval — any future work touching `buildMentionsPrompt` should first pull the full source of `MentionsClassifier.js` rather than relying on this document's inferred behavior for exact prompt wording or message structuring.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The code graph's parent-context notes that `MentionsClassifier.js`'s test coverage is split across a general-behavior suite (`MentionsClassifier.test.js`) and a suite specifically targeting the 'primary subject' extraction path (`MentionsClassifier.primary-subject.test.js`). Since `buildMentionsPrompt` is one of the five imports common to both files per the graph data, it is plausible the prompt builder is where 'primary subject' framing (e.g., distinguishing the Insight's main entity from incidentally mentioned ones) would be injected into the LLM messages — but neither test file's contents nor the function body were retrieved, so this remains a plausible role inferred from naming and import lists, not a confirmed behavior.

**Other:**
- The parent-context code graph confirms `buildMentionsPrompt` is one of exactly five public exports of `src/live-logging/MentionsClassifier.js`, alongside `loadMentionCandidates`, `extractMentionsFromLLMResponse`, `classifyMentions`, and `__resetCacheForTests`, and that both `MentionsClassifier.test.js` and `MentionsClassifier.primary-subject.test.js` import it. However, the actual retrieved source for `MentionsClassifier.js` is truncated immediately after the body of `loadMentionCandidates()` — the definition of `buildMentionsPrompt` itself was never returned by file retrieval, so no implementation detail (prompt template, message roles, candidate serialization format) can be verified from the supplied code.


## Hierarchy Context

### Parent
- [MentionsClassifier](./MentionsClassifier.md) -- [CGR] MentionsClassifier.js (module) in MentionsClassifier.js

### Siblings
- [MentionsResponseParser](./MentionsResponseParser.md) -- [LLM+CGR] No file, class, or export named "MentionsResponseParser" appears anywhere in the supplied code or in the code graph evidence for the parent MentionsClassifier component. The parent's own observations list exactly five public exports of MentionsClassifier.js — loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, and __resetCacheForTests — and "MentionsResponseParser" is not one of them, nor is it referenced as an internal helper, imported module, or class anywhere in the retrieved MentionsClassifier.js excerpt.
- [MentionsPacingGate](./MentionsPacingGate.md) -- [LLM+CGR] The pacing gate is not a separate class or exported symbol named 'MentionsPacingGate' — it is an internal cluster of four module-private bindings inside src/live-logging/MentionsClassifier.js: `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`, and `_paced()`. This matches the parent entity's [LLM] observation describing 'its own global pacing gate (_paced(), _minIntervalMs(), _pace, _lastCallStartedAt)' verbatim — the code graph confirms these are private helpers, not part of the five public exports (loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, __resetCacheForTests), so the gate is reachable by external callers only indirectly, through classifyMentions() → callProxy().
- [MentionCandidateLoader](./MentionCandidateLoader.md) -- [LLM+CGR] The code graph's parent-context observations describe a `loadMentionCandidates()` function as living inside `MentionsClassifier.js`, and the retrieved file `src/live-logging/MentionsClassifier.js` confirms this exactly — the JSDoc header lists `loadMentionCandidates(kmStore): Promise<Candidate[]>` as the first public export, and its implementation (visible in the truncated tail of the file) runs three parallel `kmStore.findByOntologyClass()` calls for 'Component', 'SubComponent', and 'Detail', then filters the merged result through a `STRICT_TYPES` set before mapping to `{id, name, description}`. There is, however, no separate class, module, or file named 'MentionCandidateLoader' anywhere in the supplied code — it is a single exported function nested inside a larger classifier module, not a standalone component.


---

*Generated from 9 observations*
