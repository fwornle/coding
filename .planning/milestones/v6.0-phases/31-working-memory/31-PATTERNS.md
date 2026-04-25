# Phase 31: Working Memory - Pattern Map

**Mapped:** 2026-04-25
**Files analyzed:** 2 (1 new, 1 modified)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/retrieval/working-memory.js` (NEW) | service | request-response | `src/retrieval/keyword-search.js` | exact |
| `src/retrieval/retrieval-service.js` (MODIFIED) | controller | request-response | self (existing code) | exact |

## Pattern Assignments

### `src/retrieval/working-memory.js` (service, request-response) -- NEW

**Analog:** `src/retrieval/keyword-search.js` (sibling module in same directory, same JS style, same JSDoc conventions)

**Secondary Analog:** `lib/ukb-unified/core/VkbApiClient.js` (VKB HTTP API access pattern)

**Imports pattern** (from `token-budget.js` lines 1-11 and `keyword-search.js` lines 1-13):
```javascript
/**
 * Working memory assembly for retrieval responses.
 *
 * Queries KG entities (Project + Component) via VKB HTTP API and parses
 * STATE.md frontmatter for current milestone/phase/status. Assembles a
 * token-budgeted markdown section (<=300 tokens) prepended to retrieval results.
 *
 * @module working-memory
 */

import { readFileSync } from 'node:fs';
import { countTokens } from 'gpt-tokenizer';
```

**VKB API fetch pattern** (from `VkbApiClient.js` lines 8-55):
```javascript
// VkbApiClient uses fetch + AbortSignal.timeout for HTTP calls to localhost:8080
// Key patterns:
//   - Base URL: 'http://localhost:8080'
//   - Timeout: AbortSignal.timeout(2000) for health checks, configurable for data
//   - Endpoint: GET /api/entities?team=coding&type=Project
//   - Response shape: { entities: [{ entity_name, entity_type, observations: [...] }] }
//   - Error: check response.ok, parse error JSON

const response = await fetch(url, {
  method: 'GET',
  signal: AbortSignal.timeout(this.timeout)
});
if (!response.ok) {
  const error = await response.json();
  throw new Error(error.message || 'Failed to get entities');
}
return await response.json();
```

**Error handling pattern** (from `retrieval-service.js` lines 168-174):
```javascript
// Graceful degradation: catch errors, log to stderr, return empty fallback
.catch((err) => {
  process.stderr.write(
    `[RetrievalService] Qdrant search failed (${collection}): ${err.message}\n`
  );
  return []; // graceful degradation
})
```

**Token counting pattern** (from `token-budget.js` lines 11, 65-66):
```javascript
import { countTokens } from 'gpt-tokenizer';
// ...
const headerTokens = countTokens(header);
const available = tokenBudget - headerTokens - 5; // 5-token safety margin
```

**Logging pattern** (from `retrieval-service.js` line 64):
```javascript
// NEVER use console.log (constraint: no-console-log). Use process.stderr.write.
process.stderr.write('[RetrievalService] Initialized (fastembed warm, Qdrant connected)\n');
```

---

### `src/retrieval/retrieval-service.js` (controller, request-response) -- MODIFIED

**Analog:** Self -- modify the existing `retrieve()` method.

**Current retrieve() method** (lines 92-135):
```javascript
async retrieve(query, options = {}) {
  const { budget = this.defaultBudget, threshold = this.scoreThreshold, context = null } = options;

  if (!this._initialized) {
    await this.initialize();
  }

  // Step 1: Embed query
  const vector = await this.embeddingService.embedOne(query);

  // Steps 2-4: search + fuse ...

  // Step 5: Token-budgeted markdown assembly
  const { markdown, tokensUsed } = assembleBudgetedMarkdown(fused, budget);

  return {
    markdown,
    meta: {
      query,
      budget,
      results_count: fused.length,
      tokens_used: tokensUsed,
      latency_ms: 0,
    },
  };
}
```

**Modification point** -- Insert working memory call between initialization check (line 98) and Step 1 (line 101). Adjust budget passed to `assembleBudgetedMarkdown` on line 122. Add `working_memory_tokens` to meta object. Import `buildWorkingMemory` from `./working-memory.js`.

**Import addition pattern** (line 20, after existing imports):
```javascript
import { buildWorkingMemory } from './working-memory.js';
```

---

## Shared Patterns

### Logging (no-console-log constraint)
**Source:** `src/retrieval/retrieval-service.js` line 64
**Apply to:** `working-memory.js`
```javascript
process.stderr.write(`[WorkingMemory] ${message}\n`);
```

### Fail-Open / Graceful Degradation
**Source:** `src/retrieval/retrieval-service.js` lines 168-174
**Apply to:** `working-memory.js` (VKB fetch failure, STATE.md read failure)
```javascript
// Pattern: try the operation, catch error, log to stderr, return empty/default
try {
  // ... operation
} catch (err) {
  process.stderr.write(`[WorkingMemory] VKB fetch failed: ${err.message}\n`);
  return { markdown: '', tokens: 0 };
}
```

### Token Counting with gpt-tokenizer
**Source:** `src/retrieval/token-budget.js` line 11
**Apply to:** `working-memory.js` (300-token budget enforcement)
```javascript
import { countTokens } from 'gpt-tokenizer';
// Use countTokens(markdownString) for accurate budget checks
```

### JSDoc Module Documentation
**Source:** `src/retrieval/keyword-search.js` lines 1-13, `src/retrieval/token-budget.js` lines 1-9
**Apply to:** `working-memory.js`
```javascript
/**
 * Module description.
 *
 * Additional context and usage notes.
 *
 * @module module-name
 */
```

### STATE.md Frontmatter Structure
**Source:** `.planning/STATE.md` lines 1-15
**Apply to:** `working-memory.js` (parsing target)
```yaml
---
gsd_state_version: 1.0
milestone: v6.0
milestone_name: -- Knowledge Context Injection
status: planning
stopped_at: Phase 31 context gathered
last_updated: "2026-04-25T08:26:15.522Z"
last_activity: 2026-04-25
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 8
  completed_plans: 8
  percent: 100
---
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| -- | -- | -- | All files have strong analogs |

## Metadata

**Analog search scope:** `src/retrieval/`, `lib/ukb-unified/core/`, `.planning/`
**Files scanned:** 6 (retrieval-service.js, token-budget.js, rrf-fusion.js, keyword-search.js, VkbApiClient.js, STATE.md)
**Pattern extraction date:** 2026-04-25
