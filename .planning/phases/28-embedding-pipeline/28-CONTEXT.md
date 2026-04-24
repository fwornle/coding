# Phase 28: Embedding Pipeline - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Embed all four knowledge tiers (observations, digests, insights, KG entities) into Qdrant as searchable 384-dim vectors, with automatic embedding of new items on creation via Redis pub/sub event bus. Includes a one-shot CLI backfill script for existing items.

</domain>

<decisions>
## Implementation Decisions

### Embedding Model & Runtime
- **D-01:** Use `fastembed` (Node.js ONNX runtime) instead of the existing Python subprocess approach (`EmbeddingGenerator.cjs` / `embedding_generator.py`). The Python approach requires sentence-transformers/torch which were never installed in Docker. fastembed runs ONNX natively in Node.js with the same all-MiniLM-L6-v2 model producing 384-dim vectors.
- **D-02:** Pin embedding model to `all-MiniLM-L6-v2` in a single config location. Model version must be tracked so future model changes trigger re-embedding.

### Qdrant Collection Architecture
- **D-03:** Create 4 separate Qdrant collections -- one per knowledge tier: `observations`, `digests`, `insights`, `kg_entities`. Separate collections enable independent scoring weights, easier debugging, and natural tier-weighted retrieval in Phase 29.
- **D-04:** Each collection stores metadata alongside vectors: observations get (agent, project, date, quality), digests get (date, theme, agents, quality), insights get (topic, confidence, digestIds), KG entities get (type, level, parentId).

### Write-Time Embedding via Event Bus
- **D-05:** Use Redis pub/sub for embedding events. Writers (ObservationWriter, consolidation daemon) emit events on new observation/digest/insight creation. A separate embedding listener process consumes events and upserts to Qdrant. Redis is already in the Docker stack.
- **D-06:** The event bus approach decouples embedding from the write path -- writers don't block on embedding, and the embedding process can be restarted independently.

### Batch Backfill
- **D-07:** A one-shot CLI script embeds all existing items (558 observations, 132 digests, 12 insights, 160+ KG entities). Content-hash based idempotency ensures re-runs skip already-embedded items.
- **D-08:** The backfill script reads from SQLite (observations.db for observations/digests/insights) and LevelDB (.data/knowledge-graph/ for KG entities), embeds via fastembed, and upserts to Qdrant.

### Claude's Discretion
- Exact Redis channel naming and message format
- Embedding batch size for backfill (researcher should determine optimal batch size for fastembed)
- Whether to reuse the existing `EmbeddingCache` (disk-backed, 7-day TTL) or let Qdrant be the sole cache
- ONNX model download strategy (pre-download during build vs lazy download on first use)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Embedding Infrastructure
- `src/utils/EmbeddingGenerator.cjs` -- Current Python subprocess embedding generator (being REPLACED by fastembed)
- `integrations/mcp-server-semantic-analysis/src/utils/embedding-cache.ts` -- Disk-backed embedding cache with TTL and content-hash invalidation (potential reuse)
- `integrations/mcp-server-semantic-analysis/src/utils/embedding_generator.py` -- Python embedding script (being replaced)

### Data Sources
- `src/live-logging/ObservationWriter.js` -- Write path for new observations, hook point for Redis events
- `.observations/observations.db` -- SQLite source for observations, digests, insights (better-sqlite3)
- `.data/knowledge-graph/` -- LevelDB source for KG entities (Graphology)
- `.data/observation-export/observations.json` -- JSON export of all observations with schema reference
- `.data/observation-export/digests.json` -- JSON export of all digests with schema reference
- `.data/observation-export/insights.json` -- JSON export of all insights with schema reference

### Qdrant
- `docker/docker-compose.yml` -- Qdrant service definition, port 6333
- `scripts/health-verifier.js` -- Existing Qdrant health check pattern

### Research
- `.planning/research/STACK.md` -- Stack recommendations including fastembed, @qdrant/js-client-rest, gpt-tokenizer
- `.planning/research/ARCHITECTURE.md` -- Architecture decisions including host/Docker split
- `.planning/research/PITFALLS.md` -- Pitfall warnings for embedding pipeline

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EmbeddingCache` (embedding-cache.ts): Disk-backed cache with content-hash invalidation. Could be reused for caching fastembed results locally before Qdrant upsert.
- `ObservationExporter` (ObservationExporter.js): Exports all observations/digests/insights as JSON. Useful as data source for the backfill script.
- Health verifier Qdrant check: `scripts/health-verifier.js` has existing pattern for Qdrant connectivity checks.

### Established Patterns
- Docker services use supervisord for process management
- Host-side scripts use `better-sqlite3` for SQLite access
- Redis is available at port 6379 (Docker)
- LLM proxy at port 12435 for model access (not needed for embeddings with fastembed)

### Integration Points
- `ObservationWriter.writeObservation()` -- emit Redis event after successful write
- Consolidation daemon (digest/insight creation) -- emit Redis event after new digest/insight
- `docker-compose.yml` -- may need new embedding service or extend coding-services
- `package.json` -- add fastembed, @qdrant/js-client-rest dependencies

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches for fastembed integration and Qdrant collection setup.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 28-embedding-pipeline*
*Context gathered: 2026-04-24*
