---
phase: 31-working-memory
reviewed: 2026-04-24T17:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/retrieval/working-memory.js
  - src/retrieval/retrieval-service.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-04-24T17:00:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Two new modules implement working memory assembly (`working-memory.js`) and hybrid retrieval orchestration (`retrieval-service.js`). The overall design is sound: fail-open error handling, AbortSignal timeout on VKB fetches, graceful per-collection degradation in Qdrant search, and a well-structured progressive truncation strategy. No security vulnerabilities were found.

Three warnings are raised: a regex in `parseStateFrontmatter` that silently drops the Blockers/Concerns section when the file has no trailing newline; a negative intermediate value in the semantic budget calculation that is saved by a downstream clamp but could return 0-token semantic results in edge cases; and a singleton factory that silently discards constructor options on repeated calls. Three info items cover a synthetic ID collision risk, a missing JSDoc parameter, and a minor promise wrapping pattern.

## Warnings

### WR-01: Concerns section silently dropped when STATE.md has no trailing newline

**File:** `src/retrieval/working-memory.js:90`
**Issue:** The regex lookahead `(?=\n##|\n---|\n$)` requires a literal `\n` before end-of-string. If STATE.md ends without a trailing newline — common when editors strip them — the final alternative `\n$` never matches and the entire Blockers/Concerns section is silently ignored even when it contains content. The `##` and `---` alternatives are fine; only the end-of-file case is broken.
**Fix:**
```js
// Replace \n$ with (?:\n|$) to match end-of-string with or without trailing newline
const concernsMatch = bodyAfterFrontmatter.match(
  /### Blockers\/Concerns\n([\s\S]*?)(?=\n##|\n---|\n|$)/
);
// More robust: use a non-greedy match to end-of-section or end-of-string
const concernsMatch = bodyAfterFrontmatter.match(
  /### Blockers\/Concerns\n([\s\S]*?)(?=\n#{1,3} |\n---\s*\n|$)/
);
```

### WR-02: Negative semantic budget silently collapses to 100-token floor

**File:** `src/retrieval/retrieval-service.js:106-108`
**Issue:** When `wm.tokens` (up to 300) exceeds `budget`, `semanticBudget` is negative before `Math.max` clamps it to 100. For any caller that passes `budget < 100` (e.g. a tight-budget tool call with `budget=50`), the effective semantic budget is silently inflated to 100 tokens — more than the caller requested in total. The comment on line 107 says "if WM overshoots" but the condition also fires when the caller's budget is simply small.
**Fix:**
```js
// Make the intent explicit and avoid inflating beyond caller's total budget
const semanticBudget = Math.max(budget - wm.tokens, Math.min(100, budget));
```
This keeps the 100-token floor only when it doesn't exceed the caller's total budget.

### WR-03: Singleton factory silently ignores options on second call

**File:** `src/retrieval/retrieval-service.js:317-319`
**Issue:** `getRetrievalService(options)` creates the instance only once. Any subsequent call with different `options` (e.g., a different `dbGetter`, `scoreThreshold`, or `codingRoot`) silently receives the original instance. No warning is emitted. This is a latent bug if the factory is called from multiple entry points with differing configuration.
**Fix:**
```js
export function getRetrievalService(options) {
  if (!instance) {
    instance = new RetrievalService(options);
  } else if (options && Object.keys(options).length > 0) {
    process.stderr.write(
      '[RetrievalService] getRetrievalService() called with options after singleton created; options ignored.\n'
    );
  }
  return instance;
}
```

## Info

### IN-01: `Math.random()` used as synthetic ID fallback — collision-prone under load

**File:** `src/retrieval/retrieval-service.js:294`
**Issue:** The fallback branch `Math.random().toString(36).slice(2)` generates ~10 characters of base-36 random data. With 36^10 ≈ 3.7 × 10^15 possible values the collision probability is negligible in practice, but if `item.id` is missing for structural reasons (not just occasionally), many results in a single response could collide and be deduplicated incorrectly by downstream RRF code.
**Fix:** Use a simple counter or `crypto.randomUUID()` for a guaranteed-unique fallback:
```js
import { randomUUID } from 'node:crypto';
// ...
id: item.id ? `kw-${tier}-${item.id}` : `kw-${tier}-${randomUUID()}`,
```

### IN-02: `context` parameter undocumented in `retrieve()` JSDoc

**File:** `src/retrieval/retrieval-service.js:97`
**Issue:** `context` is destructured from `options` and used throughout the method (lines 126-129, 205-253) but is absent from the `@param {object} [options]` JSDoc block. Callers cannot discover the `context` parameter from the documented API.
**Fix:** Add to the JSDoc:
```js
 * @param {object} [options.context] - Optional context for relevance boosting ({ project, cwd, recent_files })
```

### IN-03: Unnecessary `Promise.resolve()` wrapping of synchronous call

**File:** `src/retrieval/working-memory.js:263`
**Issue:** `Promise.resolve(parseStateFrontmatter(codingRoot))` wraps a synchronous function in a resolved promise solely to pass it to `Promise.all`. While functionally correct, it obscures the fact that `parseStateFrontmatter` is synchronous and adds a minor conceptual mismatch — if the function is ever refactored to be async, the double-wrapping would hide the change.
**Fix:** Call directly — `Promise.all` accepts non-promise values natively:
```js
const [kgData, stateData] = await Promise.all([
  fetchKGStructure(),
  parseStateFrontmatter(codingRoot),   // Promise.all wraps non-thenables automatically
]);
```

---

_Reviewed: 2026-04-24T17:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
