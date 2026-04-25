# Phase 31: Working Memory - Research

**Researched:** 2026-04-25
**Domain:** Retrieval service extension -- KG query + STATE.md parsing + token-budgeted markdown assembly
**Confidence:** HIGH

## Summary

Phase 31 adds a "Working Memory" section to every retrieval response. This section provides agents with baseline project awareness: what the project is (KG hierarchy -- Project + Component nodes), and what is happening now (current milestone, active phase, known issues from STATE.md). The working memory is generated live on each `retrieve()` call by querying the in-memory Graphology KG via the VKB HTTP API and reading STATE.md from disk.

The implementation is straightforward: a new module `src/retrieval/working-memory.js` that (1) fetches Project + Component entities from the VKB API at `localhost:8080/api/entities`, (2) parses STATE.md frontmatter for milestone/phase/status, and (3) assembles a markdown section under 300 tokens. The `RetrievalService.retrieve()` method is modified to call this module first, prepend its output to the response markdown, and pass the remaining budget (700 tokens) to `assembleBudgetedMarkdown()`.

**Primary recommendation:** Create a single new module `src/retrieval/working-memory.js` with a `buildWorkingMemory()` function. Modify `retrieve()` in `retrieval-service.js` to call it and adjust the budget split. No new dependencies needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Working memory contains BOTH structural awareness (KG hierarchy) AND current project state
- **D-02:** Working memory does NOT include SubComponent or Detail-level KG entities
- **D-03:** Live KG query on every retrieval request (no caching)
- **D-04:** No caching or snapshot files
- **D-05:** Fixed 300/700 token split (working memory gets 300, semantic results get 700)
- **D-06:** Total budget stays at 1000 tokens (not increased)
- **D-07:** If working memory exceeds 300 tokens, truncate by dropping Component descriptions first, then Components entirely
- **D-08:** Live query approach -- no explicit update triggers needed
- **D-09:** Data sources: KG entities (type=Project, Component) and STATE.md
- **D-10:** New insights/digests don't directly affect working memory

### Claude's Discretion
- Exact format of the working memory markdown section (headers, bullet points, condensed prose)
- How to read STATE.md efficiently (parse frontmatter only vs. full read)
- Whether to include the active phase's success criteria or just the phase name
- How to handle the case where KG has no Project/Component entities (graceful degradation)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WMEM-01 | Persistent working memory template captures current project state, conventions, known issues | `buildWorkingMemory()` assembles KG hierarchy (Project + Components) + STATE.md frontmatter into structured markdown |
| WMEM-02 | Working memory is injected as a fixed prefix alongside retrieval results | `retrieve()` prepends working memory markdown before `assembleBudgetedMarkdown()` output |
| WMEM-03 | Working memory stays under 500 tokens | D-05 sets a tighter 300-token ceiling; `countTokens` from `gpt-tokenizer` enforces it with truncation strategy from D-07 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| KG entity query (Project + Component) | API / Backend (VKB at :8080) | -- | VKB HTTP API provides lock-free KG access; retrieval service is a client |
| STATE.md parsing | API / Backend (retrieval service) | -- | File is on the host filesystem; retrieval service runs host-side |
| Working memory assembly | API / Backend (retrieval service) | -- | Token counting + markdown formatting in `src/retrieval/` |
| Budget split orchestration | API / Backend (retrieval service) | -- | `retrieve()` carves 300 tokens for WM, passes 700 to semantic assembly |
| Working memory delivery to agents | API / Backend (server.js endpoint) | -- | Transparent -- WM is part of the `markdown` field in the existing response |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| gpt-tokenizer | ^3.2.0 | Accurate token counting for 300-token budget enforcement | Already used in `token-budget.js` [VERIFIED: package.json] |
| graphology | ^0.25.4 | In-memory KG storage (queried via VKB API, not directly) | Already the KG backend [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs (readFileSync) | built-in | Read STATE.md from disk | Every `buildWorkingMemory()` call |
| node:http (fetch) | built-in | Call VKB API for KG entities | Every `buildWorkingMemory()` call |

### Alternatives Considered
None -- all libraries are already in the project. No new dependencies needed.

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### System Architecture Diagram

```
retrieve(query) called
        |
        v
+------------------+        +-----------------+
| buildWorkingMemory|------->| VKB API :8080   |
| (working-memory.js)|       | GET /api/entities|
|                  |        | ?type=Project   |
|                  |        | ?type=Component |
|                  |        +-----------------+
|                  |
|                  |------->| STATE.md (disk) |
|                  |        | parse frontmatter|
+--------+---------+        +-----------------+
         |
         v
   wmMarkdown (<=300 tokens)
         |
         v
+------------------+
| retrieve() main  |
| retrieval-service|
|                  |
| 1. wmMarkdown    |  <-- prepend
| 2. semantic fuse |  <-- budget=700
| 3. combine       |
+--------+---------+
         |
         v
{ markdown: "## Working Memory\n...\n\n## Insights\n...", meta: {...} }
```

### Recommended Project Structure
```
src/
  retrieval/
    working-memory.js    # NEW: buildWorkingMemory() function
    retrieval-service.js # MODIFIED: call buildWorkingMemory(), adjust budget
    token-budget.js      # UNCHANGED
    rrf-fusion.js        # UNCHANGED
    keyword-search.js    # UNCHANGED
```

### Pattern 1: VKB API Query for KG Entities
**What:** HTTP GET to `localhost:8080/api/entities?team=coding&type=Project` and `type=Component`
**When to use:** Every retrieval request to build working memory
**Example:**
```javascript
// Source: Verified against live VKB API response
async function fetchKGEntities() {
  const base = 'http://localhost:8080/api/entities?team=coding';
  const [projectRes, componentRes] = await Promise.all([
    fetch(`${base}&type=Project`, { signal: AbortSignal.timeout(2000) }),
    fetch(`${base}&type=Component`, { signal: AbortSignal.timeout(2000) }),
  ]);
  const projectData = await projectRes.json();
  const componentData = await componentRes.json();
  // Response shape: { entities: [{ entity_name, entity_type, observations: [...] }] }
  return {
    project: projectData.entities?.[0] || null,
    components: componentData.entities || [],
  };
}
```

### Pattern 2: STATE.md Frontmatter Parsing
**What:** Read STATE.md YAML frontmatter for milestone, phase, status
**When to use:** Every retrieval request
**Example:**
```javascript
// Source: Verified against .planning/STATE.md structure
import { readFileSync } from 'node:fs';

function parseStateFrontmatter(codingRoot) {
  const statePath = `${codingRoot}/.planning/STATE.md`;
  try {
    const content = readFileSync(statePath, 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    // Simple YAML parsing for known keys (no dependency needed)
    const fm = fmMatch[1];
    const get = (key) => {
      const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
    };
    return {
      milestone: get('milestone'),
      milestoneName: get('milestone_name'),
      status: get('status'),
      stoppedAt: get('stopped_at'),
      lastActivity: get('last_activity'),
    };
  } catch {
    return null;
  }
}
```

### Pattern 3: Token-Budgeted Truncation (D-07)
**What:** Enforce 300-token ceiling with graceful degradation
**When to use:** After assembling full working memory markdown
**Example:**
```javascript
// Source: Pattern derived from existing token-budget.js
import { countTokens } from 'gpt-tokenizer';

function truncateWorkingMemory(markdown, maxTokens = 300) {
  if (countTokens(markdown) <= maxTokens) return markdown;
  // Step 1: Drop component descriptions, keep names only
  // Step 2: If still over, drop components entirely, keep Project + state
  // Step 3: If still over, truncate state section
}
```

### Anti-Patterns to Avoid
- **Direct Graphology access from retrieval service:** The KG is loaded in the MCP server process (Docker). The retrieval service runs host-side. Use VKB HTTP API instead to avoid LevelDB lock conflicts. [VERIFIED: STATE.md decision "Retrieval service runs host-side"]
- **Parsing full STATE.md body:** The frontmatter has all needed fields (milestone, status, stopped_at). Parsing the full markdown body wastes time and tokens.
- **Caching working memory:** D-03/D-04 explicitly forbid caching. The KG is in-memory and VKB API is fast.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Character-based estimation | `gpt-tokenizer.countTokens()` | Already used in `token-budget.js`; accurate for budget enforcement |
| YAML parsing (full) | Full YAML parser for STATE.md | Regex-based frontmatter extraction | STATE.md frontmatter is simple key-value; avoids adding `yaml` dependency to retrieval modules |
| KG graph traversal | Direct Graphology queries | VKB HTTP API `GET /api/entities` | Lock-free access; retrieval service is host-side, KG is in Docker |

**Key insight:** The working memory module needs exactly two data sources, both already accessible: VKB API (HTTP, already running at :8080) and STATE.md (filesystem, host-side). No new infrastructure needed.

## Common Pitfalls

### Pitfall 1: VKB Server Not Running
**What goes wrong:** `buildWorkingMemory()` fails because VKB at :8080 is down
**Why it happens:** VKB server may not be started, or Docker services are down
**How to avoid:** Fail-open pattern -- if VKB is unreachable within 2s timeout, return empty working memory and proceed with full 1000-token semantic budget. Never block retrieval on working memory.
**Warning signs:** Working memory section missing from retrieval responses

### Pitfall 2: Token Budget Mismatch
**What goes wrong:** Working memory takes 400 tokens, semantic results get only 600, total exceeds 1000
**Why it happens:** Token counting done with word-count proxy instead of `countTokens()`
**How to avoid:** Use `gpt-tokenizer.countTokens()` consistently. Count WM tokens FIRST, then pass `budget - wmTokens` (capped at 700) to `assembleBudgetedMarkdown()`.
**Warning signs:** Retrieval responses exceeding 1000 tokens total

### Pitfall 3: KG Has No Project/Component Entities
**What goes wrong:** `buildWorkingMemory()` returns empty or crashes
**Why it happens:** Fresh project, KG not yet populated by wave-analysis
**How to avoid:** Graceful degradation -- if no Project entity exists, return state-only working memory (milestone + phase from STATE.md). If no STATE.md either, return empty string.
**Warning signs:** Working memory section contains only header with no content

### Pitfall 4: STATE.md Path Hardcoded
**What goes wrong:** Working memory fails in non-coding projects
**Why it happens:** Path to `.planning/STATE.md` hardcoded to coding repo
**How to avoid:** Accept `codingRoot` parameter, derive from `process.env.CODING_REPO` or `__dirname` relative path (same pattern as server.js line 26).
**Warning signs:** "ENOENT: no such file" errors in non-standard deployments

### Pitfall 5: VKB API Response Shape Changes
**What goes wrong:** Entity parsing fails silently
**Why it happens:** VKB API returns `{ entities: [...] }` wrapper, not a bare array
**How to avoid:** Always access `.entities` property from response. Verified current shape: `{ entities: [{ entity_name, entity_type, observations: [...] }] }` [VERIFIED: live API call]
**Warning signs:** Working memory shows "0 components" despite populated KG

## Code Examples

### Complete `buildWorkingMemory()` Skeleton
```javascript
// Source: Derived from verified VKB API shape + STATE.md structure
import { readFileSync } from 'node:fs';
import { countTokens } from 'gpt-tokenizer';

const WM_BUDGET = 300;
const VKB_TIMEOUT = 2000;
const VKB_BASE = 'http://localhost:8080';

/**
 * Build working memory section from KG + STATE.md.
 * Fail-open: returns { markdown: '', tokens: 0 } on any error.
 *
 * @param {string} codingRoot - Path to coding repo root
 * @returns {Promise<{ markdown: string, tokens: number }>}
 */
export async function buildWorkingMemory(codingRoot) {
  try {
    const [kgData, stateData] = await Promise.all([
      fetchKGStructure(),
      Promise.resolve(parseStateFrontmatter(codingRoot)),
    ]);
    
    let markdown = assembleMarkdown(kgData, stateData);
    let tokens = countTokens(markdown);
    
    if (tokens > WM_BUDGET) {
      markdown = truncateToFit(markdown, kgData, stateData, WM_BUDGET);
      tokens = countTokens(markdown);
    }
    
    return { markdown, tokens };
  } catch (err) {
    process.stderr.write(`[WorkingMemory] Failed: ${err.message}\n`);
    return { markdown: '', tokens: 0 };
  }
}
```

### Modified `retrieve()` Integration Point
```javascript
// In retrieval-service.js, inside retrieve():
async retrieve(query, options = {}) {
  const { budget = this.defaultBudget, threshold = this.scoreThreshold, context = null } = options;
  
  if (!this._initialized) await this.initialize();
  
  // NEW: Build working memory (fail-open)
  const wm = await buildWorkingMemory(this.codingRoot);
  const semanticBudget = Math.max(budget - wm.tokens, 100); // At least 100 for semantic
  
  // ... existing embed + search + fuse logic ...
  
  const { markdown: semanticMarkdown, tokensUsed } = assembleBudgetedMarkdown(fused, semanticBudget);
  
  // Combine: working memory prefix + semantic results
  const markdown = wm.markdown
    ? `${wm.markdown}\n\n${semanticMarkdown}`
    : semanticMarkdown;
  
  return {
    markdown,
    meta: {
      query,
      budget,
      results_count: fused.length,
      tokens_used: wm.tokens + tokensUsed,
      working_memory_tokens: wm.tokens,
      latency_ms: 0,
    },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No project awareness in retrieval | Working memory prefix with KG structure + state | Phase 31 (this phase) | Agents get baseline project awareness on every query |
| Full 1000-token semantic budget | 300/700 split (WM + semantic) | Phase 31 (this phase) | Slightly less semantic context, much better baseline awareness |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | VKB API response shape is `{ entities: [...] }` with `entity_name`, `entity_type`, `observations` fields | Code Examples | Entity parsing fails silently -- verified via live API call, LOW risk |
| A2 | STATE.md frontmatter always has `milestone`, `status`, `stopped_at` keys | Pattern 2 | Graceful degradation handles missing keys -- LOW risk |
| A3 | ~1 word = ~1 token for plain English in gpt-tokenizer | Summary | Budget slightly over/under -- mitigated by `countTokens()` actual check |

All critical claims verified. A1 confirmed via live VKB API call. A2 confirmed via reading STATE.md. A3 is a rough heuristic only used for reasoning, not in code.

## Open Questions

1. **Component description extraction from observations**
   - What we know: Each Component entity has an `observations` array. The first observation typically starts with `[LLM]` and contains a prose description. [VERIFIED: live API]
   - What's unclear: Should we use the first observation as the "description", or extract a shorter form?
   - Recommendation: Use first observation's `content` field, truncated to ~50 chars per component. This keeps descriptions concise within the 300-token budget.

2. **Known issues from STATE.md**
   - What we know: STATE.md has a `### Blockers/Concerns` section in the body (not frontmatter).
   - What's unclear: D-01 mentions "known issues from STATE.md" but the frontmatter doesn't have a dedicated field for issues.
   - Recommendation: Parse `### Blockers/Concerns` section from the body (simple regex for lines starting with `- `). If absent, omit the issues subsection. This is within Claude's discretion per CONTEXT.md.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| VKB server (:8080) | KG entity queries | Yes | running | Fail-open: return state-only WM |
| STATE.md | Project state | Yes | on disk | Fail-open: return KG-only WM |
| gpt-tokenizer | Token counting | Yes | ^3.2.0 | -- (already installed) |
| Qdrant | Semantic search (existing) | Yes | running | -- (existing, not changed) |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:**
- VKB server down: Return state-only working memory (milestone + phase from STATE.md)
- STATE.md missing: Return KG-only working memory (Project + Components)
- Both missing: Return empty working memory, full 1000-token budget for semantic results

## Project Constraints (from CLAUDE.md)

- **TypeScript mandatory with strict type checking** -- However, `src/retrieval/` modules are plain JS (locked decision from STATE.md: "Plain JS for src/retrieval/ modules to match server.js consumer"). New `working-memory.js` follows this pattern.
- **Never modify working APIs for TypeScript compliance** -- Retrieval API response shape stays the same (adds `working_memory_tokens` to meta, non-breaking).
- **Submodule build pipeline** -- Not applicable; `src/retrieval/` is bind-mounted, no Docker rebuild needed for changes.
- **Constraint system** -- `no-console-log` applies; use `process.stderr.write()` for logging.

## Sources

### Primary (HIGH confidence)
- Live VKB API at localhost:8080 -- verified entity response shape, entity counts (1 Project, 8 Components)
- `src/retrieval/retrieval-service.js` -- verified `retrieve()` method signature and flow
- `src/retrieval/token-budget.js` -- verified `assembleBudgetedMarkdown()` signature and `countTokens` usage
- `.planning/STATE.md` -- verified frontmatter structure and body sections
- `src/hooks/retrieval-client.js` -- verified client uses `markdown` field from response
- `31-CONTEXT.md` -- all locked decisions (D-01 through D-10)

### Secondary (MEDIUM confidence)
- `lib/ukb-unified/core/VkbApiClient.js` -- API client patterns for VKB

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, verified in package.json
- Architecture: HIGH -- simple extension of existing retrieval pipeline, all integration points verified in source
- Pitfalls: HIGH -- verified VKB API availability, STATE.md structure, and token counting behavior

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (stable -- no external dependencies changing)
