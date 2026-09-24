# MentionsPacingGate

**Type:** Detail

## What It Is

MentionsPacingGate is not a standalone class or exported symbol, but an internal cluster of four module-private bindings inside `src/live-logging/MentionsClassifier.js`: `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`, and `_paced()`. It is one of the mechanisms the parent module MentionsClassifier implements internally, distinct from its five public exports (`loadMentionCandidates`, `buildMentionsPrompt`, `extractMentionsFromLLMResponse`, `classifyMentions`, `__resetCacheForTests`). External callers only reach the gate indirectly, via `classifyMentions()` → `callProxy()`. Unlike sibling components such as MentionCandidateLoader (a real exported function, `loadMentionCandidates`) or MentionsPromptBuilder (`buildMentionsPrompt`), the pacing gate has no independent public surface at all — it exists purely to protect a shared external dependency.

## Architecture and Design

The core pattern is a promise-chain serialization queue — a "poor-<COMPANY_NAME_REDACTED>'s mutex" — rather than a semaphore, mutex primitive, or external queue library. Each call to `_paced(fn)` chains onto the module-level `_pace` promise, and the chain is deliberately split in two: the promise that advances the queue always resolves (via `.then(() => undefined, () => undefined)`), while the actual caller receives the unaltered `run` promise carrying `fn()`'s true resolution or rejection. This "fail-open chain advancement with faithful-result propagation" ensures one failed call can never wedge the whole queue, while callers still see real errors.

State ownership is module-global rather than per-instance: `_pace` and `_lastCallStartedAt` are top-level `let` bindings, contrasting deliberately with the per-kmStore-instance `_candidateCache` WeakMap (per PATTERNS.md landmine 8). This asymmetry reflects the underlying constraint being modeled — the Claude Max-OAuth haiku rate limit is a property of the shared proxy account, not of any individual consolidation run, so serialization must span all callers process-wide.

## Implementation Details

`_minIntervalMs()` reads `process.env.MENTIONS_MIN_INTERVAL_MS` fresh on every call rather than caching at module load, falling back to 1000ms when absent or non-finite (`Number.isFinite(v) && v >= 0 ? v : 1000`). This is intentional: ES module top-level `const` values freeze at first import, which would make an env override load-order-dependent; per-call reads let tests zero out pacing without fighting import ordering.

The wait calculation uses wall-clock arithmetic rather than a fixed sleep: `wait = _lastCallStartedAt + interval - Date.now()`, only delaying if positive. Because `_lastCallStartedAt` is stamped at call *start*, a slow proxy response (bounded by `REQUEST_TIMEOUT_MS = 60_000`) naturally satisfies spacing without stacking an artificial delay on top.

Structurally, `callProxy()` wraps its entire body — the fetch call plus the undici-cause-chain error unwrapping (per the parent's D-04.1 observation) — inside a single `_paced(async () => {...})` closure. Gate and error-handling are thus coupled at one call site rather than composed as separate layers, making timeout and pacing latencies additive: a burst of N queued calls could accumulate up to N × (interval + 60000)ms of worst-case latency.

## Integration Points

The gate's only integration point is `callProxy()`, invoked from `classifyMentions()`, which fetches against the rapid-llm-proxy `/api/complete` endpoint. It has no reusable/exported form and is not factored out as a general rate-limiter utility — it exists solely to protect this module's single external dependency. Sibling functions (`buildMentionsPrompt`, `loadMentionCandidates`, `extractMentionsFromLLMResponse`) are unrelated to pacing and operate independently within the same file. The gate's worst-case latency also interacts with system-level constraints noted at the parent level: the consolidator's 15s KG-push budget can be blown through by accumulated gate-plus-timeout latency, compounding with the classifier's known haiku-fallback slowness.

## Usage Guidelines

Developers should treat `_paced()` as the mandatory wrapper for any new call into the proxy from this module — bypassing it reintroduces the per-model rate-limit risk the gate exists to prevent. Because state is module-global, this gate is only correct for a single-process consolidator; importing this module into a multi-tenant or multi-process context would silently break the serialization guarantee, since each process would maintain its own independent `_pace` chain. Tests should rely on `MENTIONS_MIN_INTERVAL_MS=0` (or similar) rather than mocking `_paced` internals, given the deliberate per-call env read. Finally, anyone modifying `callProxy()` should be aware that pacing and timeout/error-handling logic are tightly coupled in one closure — separating them would require deliberate refactoring, not just wrapping.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The pacing gate is not a separate class or exported symbol named 'MentionsPacingGate' — it is an internal cluster of four module-private bindings inside src/live-logging/MentionsClassifier.js: `_minIntervalMs()`, `_pace`, `_lastCallStartedAt`, and `_paced()`. This matches the parent entity's [LLM] observation describing 'its own global pacing gate (_paced(), _minIntervalMs(), _pace, _lastCallStartedAt)' verbatim — the code graph confirms these are private helpers, not part of the five public exports (loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, __resetCacheForTests), so the gate is reachable by external callers only indirectly, through classifyMentions() → callProxy().


## Hierarchy Context

### Parent
- [MentionsClassifier](./MentionsClassifier.md) -- [CGR] MentionsClassifier.js (module) in MentionsClassifier.js

### Siblings
- [MentionsPromptBuilder](./MentionsPromptBuilder.md) -- [LLM+CGR] The parent-context code graph confirms `buildMentionsPrompt` is one of exactly five public exports of `src/live-logging/MentionsClassifier.js`, alongside `loadMentionCandidates`, `extractMentionsFromLLMResponse`, `classifyMentions`, and `__resetCacheForTests`, and that both `MentionsClassifier.test.js` and `MentionsClassifier.primary-subject.test.js` import it. However, the actual retrieved source for `MentionsClassifier.js` is truncated immediately after the body of `loadMentionCandidates()` — the definition of `buildMentionsPrompt` itself was never returned by file retrieval, so no implementation detail (prompt template, message roles, candidate serialization format) can be verified from the supplied code.
- [MentionsResponseParser](./MentionsResponseParser.md) -- [LLM+CGR] No file, class, or export named "MentionsResponseParser" appears anywhere in the supplied code or in the code graph evidence for the parent MentionsClassifier component. The parent's own observations list exactly five public exports of MentionsClassifier.js — loadMentionCandidates, buildMentionsPrompt, extractMentionsFromLLMResponse, classifyMentions, and __resetCacheForTests — and "MentionsResponseParser" is not one of them, nor is it referenced as an internal helper, imported module, or class anywhere in the retrieved MentionsClassifier.js excerpt.
- [MentionCandidateLoader](./MentionCandidateLoader.md) -- [LLM+CGR] The code graph's parent-context observations describe a `loadMentionCandidates()` function as living inside `MentionsClassifier.js`, and the retrieved file `src/live-logging/MentionsClassifier.js` confirms this exactly — the JSDoc header lists `loadMentionCandidates(kmStore): Promise<Candidate[]>` as the first public export, and its implementation (visible in the truncated tail of the file) runs three parallel `kmStore.findByOntologyClass()` calls for 'Component', 'SubComponent', and 'Detail', then filters the merged result through a `STRICT_TYPES` set before mapping to `{id, name, description}`. There is, however, no separate class, module, or file named 'MentionCandidateLoader' anywhere in the supplied code — it is a single exported function nested inside a larger classifier module, not a standalone component.


---

*Generated from 9 observations*
