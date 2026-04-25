# Phase 31: Working Memory - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a persistent working memory section to the retrieval service response -- a concise, auto-generated project state summary that gives every agent conversation baseline awareness of what this project is, how it's structured, and what's currently happening. Injected as a fixed prefix before semantic search results.

</domain>

<decisions>
## Implementation Decisions

### Content Scope
- **D-01:** Working memory contains BOTH structural awareness (KG hierarchy) AND current project state. Specifically:
  - **Structure:** Top-level Project node + all Component-level nodes with their one-line descriptions from the KG. This gives agents awareness of project architecture (e.g., "LSL system", "ETM pipeline", "Docker services", "OKB knowledge base").
  - **State:** Current milestone, active/recent phase, known issues from STATE.md. This gives agents awareness of what's happening now.
- **D-02:** Working memory does NOT include SubComponent or Detail-level KG entities -- those are too granular for a 300-token budget. Semantic search already surfaces those when relevant to the query.

### Generation Strategy
- **D-03:** Live KG query on every retrieval request. The working memory section is generated fresh from the KG + STATE.md on each call to `retrieve()`. Accepts the ~50-100ms latency cost for maximum freshness.
- **D-04:** No caching or snapshot files. The query is lightweight (top-level + component entities only, ~10-15 nodes) and the KG is in-memory (Graphology), so the read is fast.

### Budget Allocation
- **D-05:** Fixed 300/700 token split. Working memory gets a firm 300-token ceiling. Semantic retrieval results get the remaining 700 tokens from the default 1000-token budget.
- **D-06:** The total budget stays at 1000 tokens (not increased). Working memory is carved from the existing budget per WMEM-03 requirement.
- **D-07:** If working memory exceeds 300 tokens, truncate by dropping Component descriptions first (keep names), then drop Components entirely (keep only Project node + state).

### Update Triggers
- **D-08:** The live query approach means every request gets fresh data -- no explicit "update trigger" needed for the working memory itself.
- **D-09:** The data sources that working memory queries are: KG entities (type=Project, Component) and STATE.md (milestone, phase, known issues). Changes to KG entities or STATE.md are automatically reflected on the next retrieval call.
- **D-10:** New insights and digests don't directly affect working memory content (those are structural KG nodes and state), but they may indirectly change Component descriptions if the KG is updated. This satisfies SC3 -- KG entity changes are immediately visible.

### Claude's Discretion
- Exact format of the working memory markdown section (headers, bullet points, condensed prose)
- How to read STATE.md efficiently (parse frontmatter only vs. full read)
- Whether to include the active phase's success criteria or just the phase name
- How to handle the case where KG has no Project/Component entities (graceful degradation)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Retrieval Service (Phase 29)
- `src/retrieval/retrieval-service.js` -- RetrievalService class with `retrieve()` method. Working memory assembly goes here.
- `src/retrieval/token-budget.js` -- `assembleBudgetedMarkdown()` function. Budget split happens here.
- `src/retrieval/rrf-fusion.js` -- RRF fusion and tier weights. Working memory is prepended AFTER fusion.

### Knowledge Graph
- `integrations/mcp-server-semantic-analysis/src/utils/kg-operators.ts` -- KGEntity interface, graph read operations
- `.data/knowledge-graph/` -- Graphology + LevelDB storage (in-memory graph, persistent backing)

### Project State
- `.planning/STATE.md` -- Current milestone, phase, known issues (read for state section)

### Hook Infrastructure (Phase 30/30.1)
- `src/hooks/retrieval-client.js` -- Shared client all adapters use. Working memory comes through as part of the retrieval response.
- `integrations/system-health-dashboard/server.js` -- `handleRetrieve` endpoint that calls RetrievalService

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RetrievalService.retrieve()` already returns `{ markdown, meta }` -- working memory prepends to `markdown`
- `assembleBudgetedMarkdown(fused, budget)` in `token-budget.js` handles the semantic results. Working memory budget is separate (300 tokens carved out before calling this with budget=700).
- KG is loaded in-memory via Graphology -- entity queries are O(1) lookups by type

### Established Patterns
- Retrieval response is structured markdown with tier headers (`## Insights`, `## Digests`, etc.)
- Working memory becomes a new tier header (`## Working Memory`) prepended before other tiers
- Token estimation via `str.split(/\s+/).length` (word count proxy) used elsewhere

### Integration Points
- `RetrievalService.retrieve()` -- add working memory assembly step before `assembleBudgetedMarkdown`
- `token-budget.js` -- adjust budget parameter to 700 when working memory is present
- KG read API -- query entities by type (Project, Component)

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- standard retrieval service extension with KG queries.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 31-working-memory*
*Context gathered: 2026-04-25*
