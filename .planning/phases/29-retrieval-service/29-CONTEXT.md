# Phase 29: Retrieval Service - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a hybrid retrieval HTTP endpoint on the existing health API (port 3033) that accepts a query, searches all 4 Qdrant collections + SQLite FTS, fuses results via Reciprocal Rank Fusion with tier weighting, enforces a token budget, and returns pre-formatted markdown ready for agent injection.

</domain>

<decisions>
## Implementation Decisions

### Service Location
- **D-01:** Add the retrieval endpoint (`POST /api/retrieve`) to the existing health API server at port 3033 (`integrations/system-health-dashboard/server.js`). No new port, process, or Docker service. The health API already has Express, SQLite access, and observation endpoints.

### Hybrid Scoring Strategy
- **D-02:** Use Reciprocal Rank Fusion (RRF) to combine results from three retrieval sources: semantic search (Qdrant cosine similarity), keyword search (SQLite FTS if available, else LIKE fallback), and recency scoring (exponential decay based on item age).
- **D-03:** Tier-weighted scoring multipliers: insights 1.5x, digests 1.2x, KG entities 1.0x, observations 0.8x. Applied after RRF fusion to prioritize higher-quality knowledge tiers.
- **D-04:** Relevance threshold of 0.75 minimum similarity score for Qdrant results. Below-threshold results are discarded, not returned as noise.

### Response Format
- **D-05:** Return pre-formatted markdown ready for direct injection into agent context. Format includes tier headers (## Insights, ## Digests, ## Entities, ## Observations), source attribution per result (date, agent, topic), and relevance scores.
- **D-06:** Response is a JSON object with `{ markdown: string, meta: { query, budget, results_count, latency_ms } }` -- the markdown field is the injectable content, meta is for debugging/monitoring.

### Token Budgeting
- **D-07:** Use `gpt-tokenizer` (GPT-4 tokenizer) for token counting. ~5-10% variance vs Claude tokenizer is acceptable for budgeting purposes.
- **D-08:** Default budget of ~1000 tokens. Configurable per request via `budget` parameter. Fill budget by tier priority: insights first, then digests, then KG entities, then observations. Stop adding results when budget would be exceeded.
- **D-09:** Each result is formatted and token-counted before inclusion. If a single result exceeds remaining budget, truncate its summary_preview to fit rather than skipping entirely.

### Claude's Discretion
- FTS table creation strategy (CREATE VIRTUAL TABLE ... USING fts5 vs LIKE fallback)
- RRF constant k parameter (typically 60, can be tuned)
- Recency decay half-life (e.g., 7 days, 14 days, 30 days)
- Whether to embed the query on-the-fly using fastembed or accept a pre-computed vector
- Error handling strategy when Qdrant is unreachable (return empty vs cached results)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 28 Outputs (Foundation)
- `src/embedding/embedding-service.ts` -- fastembed wrapper for query embedding (embedOne)
- `src/embedding/qdrant-collections.ts` -- Qdrant client management, collection schemas
- `src/embedding/embedding-config.json` -- Model config, collection names, dimensions
- `src/embedding/content-hash.ts` -- Content hash utility (for dedup if needed)

### Target Integration Point
- `integrations/system-health-dashboard/server.js` -- Health API server where /api/retrieve will be added. Read existing endpoint patterns (handleGetObservations, etc.)

### Data Sources
- `.observations/observations.db` -- SQLite with observations, digests, insights tables
- Qdrant at localhost:6333 -- 4 collections (observations, digests, insights, kg_entities) populated by Phase 28

### Research
- `.planning/research/FEATURES.md` -- Hybrid retrieval, token budgeting, tier-weighted scoring details
- `.planning/research/ARCHITECTURE.md` -- Host/Docker split, data flow diagrams
- `.planning/research/PITFALLS.md` -- Context rot, latency constraints, over-engineering warnings

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `embedding-service.ts`: Use `embedOne(query)` to embed the user's query for Qdrant search
- `qdrant-collections.ts`: Use `getClient()` for Qdrant search operations, `getCollectionNames()` for collection list
- Health API server: Express app with existing middleware, error handling, SQLite connection helpers
- `gpt-tokenizer`: Already in package.json, ready to import

### Established Patterns
- Health API endpoints follow `handleGetX(req, res)` method pattern
- SQLite access via `better-sqlite3` with WAL mode
- Process.stderr.write for logging (no console.log -- constraint)
- JSON responses with error handling

### Integration Points
- New `POST /api/retrieve` route added to server.js route registration
- Imports from `../../src/embedding/` for fastembed and Qdrant access
- SQLite connection reused from existing health API database helpers

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches for RRF fusion and token-budgeted assembly.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 29-retrieval-service*
*Context gathered: 2026-04-24*
