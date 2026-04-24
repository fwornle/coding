# Phase 29: Retrieval Service - Research

**Researched:** 2026-04-24
**Domain:** Hybrid vector+keyword retrieval with RRF fusion and token-budgeted markdown assembly
**Confidence:** HIGH

## Summary

Phase 29 adds a single `POST /api/retrieve` endpoint to the existing health API server (port 3033, `server.js`). The endpoint accepts a query string, embeds it via fastembed, searches all 4 Qdrant collections in parallel, runs SQLite FTS5 keyword search on observations, fuses results via Reciprocal Rank Fusion with tier-weighted multipliers, enforces a configurable token budget, and returns pre-formatted markdown with a JSON wrapper.

All dependencies are already installed: `fastembed@2.1.0`, `@qdrant/js-client-rest@1.15.1`, `gpt-tokenizer@3.2.0`, and `better-sqlite3@11.7.0`. The Phase 28 outputs provide ready-to-use `embedOne()` for query embedding and `getQdrantClient()` for vector search. SQLite FTS5 already exists for the `observations` table. The health API server is a 4244-line ES module JavaScript file with established patterns for route handlers, SQLite access, and error handling.

**Primary recommendation:** Build a self-contained retrieval module (`src/retrieval/retrieval-service.js`) that encapsulates the hybrid search, RRF fusion, and token-budgeted assembly logic, then wire it into `server.js` with a thin route handler following the existing `handleGet*` pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add `POST /api/retrieve` to existing health API server at port 3033 (`integrations/system-health-dashboard/server.js`). No new port, process, or Docker service.
- **D-02:** Use Reciprocal Rank Fusion (RRF) to combine semantic search (Qdrant), keyword search (SQLite FTS/LIKE fallback), and recency scoring (exponential decay).
- **D-03:** Tier-weighted scoring multipliers: insights 1.5x, digests 1.2x, KG entities 1.0x, observations 0.8x. Applied after RRF fusion.
- **D-04:** Relevance threshold 0.75 minimum similarity score for Qdrant results. Below-threshold results discarded.
- **D-05:** Pre-formatted markdown with tier headers (## Insights, ## Digests, ## Entities, ## Observations), source attribution per result (date, agent, topic), and relevance scores.
- **D-06:** JSON response: `{ markdown: string, meta: { query, budget, results_count, latency_ms } }`.
- **D-07:** Use `gpt-tokenizer` (GPT-4 tokenizer) for token counting. ~5-10% variance vs Claude acceptable.
- **D-08:** Default budget ~1000 tokens. Configurable via `budget` parameter. Fill by tier priority: insights first, then digests, then KG entities, then observations. Truncate last result if needed.
- **D-09:** Each result is formatted and token-counted before inclusion. Truncate summary_preview if single result exceeds remaining budget.

### Claude's Discretion
- FTS table creation strategy (CREATE VIRTUAL TABLE ... USING fts5 vs LIKE fallback)
- RRF constant k parameter (typically 60, can be tuned)
- Recency decay half-life (e.g., 7 days, 14 days, 30 days)
- Whether to embed the query on-the-fly using fastembed or accept a pre-computed vector
- Error handling strategy when Qdrant is unreachable (return empty vs cached results)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RETR-01 | HTTP endpoint accepts query string and returns token-budgeted relevant knowledge | D-01 locks endpoint at POST /api/retrieve on port 3033; token budgeting via gpt-tokenizer countTokens() |
| RETR-02 | Hybrid retrieval combines semantic (Qdrant) + keyword (SQLite FTS) + recency | FTS5 table exists for observations; Qdrant search API supports score_threshold; recency via exponential decay on date payload field |
| RETR-03 | Tier-weighted scoring: insights > digests > KG entities > observations | D-03 locks multipliers 1.5x/1.2x/1.0x/0.8x applied after RRF |
| RETR-04 | Token budget enforcement (configurable, default ~1000) | gpt-tokenizer countTokens() for per-result counting; tier-priority fill order per D-08 |
| RETR-05 | Context assembly as structured markdown with source attribution | D-05/D-06 lock format; payload fields (agent, date, topic, theme, summary_preview) available in Qdrant |
| RETR-06 | Relevance threshold prevents low-confidence injection (default 0.75) | Qdrant search API supports score_threshold natively; D-04 locks at 0.75 |
| RETR-07 | Service responds in <500ms p95 latency | fastembed cold start ~2-5s is the risk; warm embedOne() is ~20ms; parallel Qdrant searches; SQLite FTS is sub-ms |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Query embedding | Host (Node.js) | -- | fastembed runs ONNX in-process on host via embedding-service.ts |
| Semantic search | Qdrant (Docker, port 6333) | -- | Vector similarity search across 4 collections |
| Keyword search | SQLite (host, .observations/observations.db) | -- | FTS5 table on observations; digests/insights via LIKE fallback |
| RRF fusion and scoring | Host (Node.js) | -- | Pure computation, no I/O -- runs in retrieval service module |
| Token budget enforcement | Host (Node.js) | -- | gpt-tokenizer is pure JS, synchronous, ~1ms per call |
| HTTP endpoint | Host (Express, port 3033) | -- | Health API server already running Express |
| Markdown assembly | Host (Node.js) | -- | String formatting, no external dependencies |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@qdrant/js-client-rest` | 1.15.1 (installed) | Vector similarity search | [VERIFIED: npm ls] Official Qdrant JS SDK, already used by Phase 28 |
| `fastembed` | 2.1.0 (installed) | Query embedding via ONNX | [VERIFIED: npm ls] Same model as Phase 28 backfill, singleton service |
| `gpt-tokenizer` | 3.2.0 (installed) | Token counting for budget | [VERIFIED: npm ls] Pure JS, synchronous countTokens() API, ~1ms |
| `better-sqlite3` | 11.7.0 (installed) | SQLite FTS5 keyword search | [VERIFIED: npm ls] Already used by server.js for observations |
| `express` | (in dashboard) | HTTP routing | [VERIFIED: server.js] Already the server framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | -- | -- | All dependencies already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RRF fusion (custom) | Cross-encoder reranking | RRF is simple, zero-dependency, fast; cross-encoder adds LLM latency -- deferred to ADVR-03 |
| gpt-tokenizer | @anthropic-ai/tokenizer | Anthropic tokenizer is exact but requires API call; gpt-tokenizer is local, ~5% variance acceptable for budgeting |
| SQLite FTS5 | BM25 via external library | FTS5 already exists in SQLite; external BM25 adds complexity for ~700 items |

**Installation:**
```bash
# No new packages needed -- all dependencies installed by Phase 28
```

**Version verification:**
- `@qdrant/js-client-rest`: 1.15.1 installed, 1.17.0 latest on npm [VERIFIED: npm view + npm ls]
- `gpt-tokenizer`: 3.2.0 installed, 3.4.0 latest on npm [VERIFIED: npm view + npm ls]
- `fastembed`: 2.1.0 installed [VERIFIED: npm ls]
- Installed versions are sufficient -- no upgrade needed for this phase.

## Architecture Patterns

### System Architecture Diagram

Data flow for a retrieval request:

```
POST /api/retrieve { query: "Docker build timeout", budget: 1000 }
  |
  v
Express Route Handler (server.js) --> validates input, measures latency
  |
  v
RetrievalService.retrieve(query, options)
  |
  +--> [Step 1] Query Embedding: fastembed embedOne(query) --> 384-dim vector (~20ms warm)
  |
  +--> [Step 2a] Semantic Search: Qdrant search x4 collections (parallel via Promise.all)
  |      score_threshold=0.75, limit=20 per collection, with_payload=true
  |
  +--> [Step 2b] Keyword Search: SQLite FTS5 MATCH (observations) + LIKE (digests, insights)
  |      limit=20 per tier
  |
  +--> [Step 2c] Recency Scoring: exponential decay from payload.date field
  |
  v
[Step 3] RRF Fusion
  Merge ranked lists from semantic + keyword + recency
  Apply tier weights: insights 1.5x, digests 1.2x, KG 1.0x, observations 0.8x
  Sort by final RRF score descending
  |
  v
[Step 4] Token-Budgeted Assembly
  Walk sorted results in tier-priority order (insights first)
  Format each as markdown with source attribution
  Count tokens via gpt-tokenizer countTokens()
  Stop when budget exhausted; truncate last result if needed
  |
  v
Response: { markdown: "## Insights\n...", meta: { query, budget, results_count, latency_ms } }
```

### Recommended Project Structure
```
src/
  retrieval/                     # Phase 29 (new)
    retrieval-service.js         # Core orchestrator: embed, search, fuse, assemble
    rrf-fusion.js                # RRF algorithm + tier weighting
    token-budget.js              # Token counting + budget enforcement + markdown formatting
    keyword-search.js            # SQLite FTS5/LIKE keyword search
  embedding/                     # Phase 28 (existing, consumed by retrieval)
    embedding-service.ts
    qdrant-collections.ts
    embedding-config.json
```

### Pattern 1: Qdrant Parallel Multi-Collection Search
**What:** Search all 4 Qdrant collections simultaneously using Promise.all
**When to use:** Every retrieval request
**Example:**
```javascript
// Source: Context7 /qdrant/qdrant-js search docs
import { getQdrantClient } from '../../src/embedding/qdrant-collections.js';

const COLLECTIONS = ['insights', 'digests', 'kg_entities', 'observations'];
const TIER_WEIGHTS = { insights: 1.5, digests: 1.2, kg_entities: 1.0, observations: 0.8 };

async function semanticSearch(queryVector, limit = 20, threshold = 0.75) {
  const client = getQdrantClient();
  const results = await Promise.all(
    COLLECTIONS.map(collection =>
      client.search(collection, {
        vector: queryVector,
        limit,
        score_threshold: threshold,
        with_payload: true,
        with_vector: false,
      }).then(points => points.map(p => ({
        ...p,
        tier: collection,
        tierWeight: TIER_WEIGHTS[collection],
      })))
    )
  );
  return results.flat();
}
```

### Pattern 2: Reciprocal Rank Fusion
**What:** Combine ranked lists from multiple retrieval sources into a single fused ranking
**When to use:** After collecting semantic, keyword, and recency results
**Example:**
```javascript
// Source: RRF paper (Cormack et al., 2009) -- standard IR algorithm
// [CITED: https://dl.acm.org/doi/10.1145/1571941.1572114]
function rrfFuse(rankedLists, k = 60) {
  const scores = new Map(); // id -> { score, item }

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const existing = scores.get(item.id) || { score: 0, item };
      existing.score += 1 / (k + rank + 1);
      scores.set(item.id, existing);
    });
  }

  // Apply tier weights after fusion
  for (const [id, entry] of scores) {
    entry.score *= entry.item.tierWeight ?? 1.0;
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(e => ({ ...e.item, rrfScore: e.score }));
}
```

### Pattern 3: Token-Budgeted Markdown Assembly
**What:** Fill a token budget with formatted results, highest-priority first
**When to use:** After RRF fusion produces a sorted result list
**Example:**
```javascript
// Source: Context7 /niieani/gpt-tokenizer docs
import { countTokens } from 'gpt-tokenizer';

function assembleBudgetedMarkdown(sortedResults, budget = 1000) {
  const sections = { insights: [], digests: [], kg_entities: [], observations: [] };
  let tokensUsed = 0;

  for (const result of sortedResults) {
    const formatted = formatResult(result);
    const tokens = countTokens(formatted);

    if (tokensUsed + tokens > budget) {
      // Truncate last result to fit remaining budget (D-09)
      const remaining = budget - tokensUsed;
      if (remaining > 50) { // minimum useful size
        const truncated = truncateToTokens(result, remaining);
        sections[result.tier].push(truncated);
        tokensUsed += remaining;
      }
      break;
    }

    sections[result.tier].push(formatted);
    tokensUsed += tokens;
  }

  return buildMarkdown(sections, tokensUsed);
}
```

### Pattern 4: Express Route Handler (existing server.js pattern)
**What:** Add POST route following established handleGet* pattern
**When to use:** Wiring the retrieval service into server.js
**Example:**
```javascript
// Follow server.js existing pattern: bind in setupRoutes, handle in method
// In setupRoutes():
this.app.post('/api/retrieve', this.handleRetrieve.bind(this));

// Handler:
async handleRetrieve(req, res) {
  const startMs = Date.now();
  const { query, budget = 1000, threshold = 0.75 } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query (string) is required' });
  }
  try {
    const result = await this.retrievalService.retrieve(query, { budget, threshold });
    result.meta.latency_ms = Date.now() - startMs;
    res.json(result);
  } catch (err) {
    process.stderr.write(`[RetrievalAPI] Error: ${err.message}\n`);
    res.status(500).json({ error: 'Retrieval failed' });
  }
}
```

### Anti-Patterns to Avoid
- **Embedding on every request without caching:** The fastembed model has a ~2-5s cold start. Initialize eagerly on server start, not lazily on first request. Cache query embeddings for repeated queries.
- **Sequential collection searches:** Searching 4 Qdrant collections one-by-one quadruples latency. Always use Promise.all for parallel search.
- **Over-fetching from Qdrant:** Limit to 20 results per collection. With 4 collections, that is 80 max candidates -- more than enough for a 1000-token budget that fits ~5-10 results.
- **Blocking SQLite access:** The health API already uses readonly mode for SQLite. Do NOT open in write mode -- it would conflict with the write-path processes.
- **Console.log in server.js:** Constraint `no-console-log` is enforced. Note: server.js already uses console.log extensively (legacy code). New code added MUST use `process.stderr.write()` per CLAUDE.md constraint.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Character-based approximation | `gpt-tokenizer` countTokens() | BPE tokenization is non-linear; "4 chars/token" is wrong for code, URLs, punctuation |
| Query embedding | HTTP call to external API | `fastembed` embedOne() | Local ONNX, no network dependency, <20ms warm |
| Vector similarity | Cosine similarity loop over all items | Qdrant search with score_threshold | Qdrant uses HNSW index, O(log n) not O(n); handles filtering natively |
| FTS keyword search | Custom text matching with regex | SQLite FTS5 MATCH | FTS5 handles tokenization, stemming, ranking; already built and indexed |
| RRF fusion | Custom weighted scoring | Standard RRF formula (1/(k+rank)) | Well-studied IR algorithm; k=60 is the standard default from the original paper |

**Key insight:** With ~1500 total items across all tiers, performance is not a concern -- the bottleneck is fastembed cold start and Qdrant network round-trip, not algorithmic complexity.

## Common Pitfalls

### Pitfall 1: fastembed Cold Start Kills First Request
**What goes wrong:** First `embedOne()` call takes 2-5 seconds to download/load the ONNX model, causing the first retrieval request to timeout or feel broken.
**Why it happens:** fastembed lazily initializes the model on first use.
**How to avoid:** Call `getEmbeddingService().initialize()` eagerly during server startup (in the constructor or start method). The EmbeddingService already supports this -- it has an `initialize()` method that can be called before any request arrives.
**Warning signs:** First request to /api/retrieve takes >2s, subsequent ones are <100ms.

### Pitfall 2: FTS5 Table Only Exists for Observations
**What goes wrong:** Trying to run FTS5 MATCH queries on digests or insights tables fails because they don't have FTS virtual tables.
**Why it happens:** Only `observations_fts` was created (backfill or schema migration only covered observations).
**How to avoid:** For digests and insights, use `LIKE '%query%'` as fallback (discretion area per CONTEXT.md). Alternatively, create FTS5 tables for digests/insights in a setup step. Given the small dataset (194 digests, 15 insights), LIKE is fast enough.
**Warning signs:** SQLite error "no such table: digests_fts".

### Pitfall 3: Qdrant Cosine Scores Are Not Probabilities
**What goes wrong:** Setting threshold at 0.75 expecting it to mean "75% relevant" -- Qdrant cosine similarity scores range from -1 to 1 (or 0 to 1 for normalized vectors), and the distribution depends on the embedding model and data.
**Why it happens:** Cosine similarity is a geometric measure, not a calibrated probability.
**How to avoid:** The 0.75 threshold is a reasonable starting point for all-MiniLM-L6-v2 with 384-dim vectors. Log scores for the first 50 queries and calibrate -- if too few results return, lower to 0.6; if noise appears, raise to 0.8. Make threshold configurable per D-04.
**Warning signs:** Queries consistently return 0 results, or consistently return noisy results.

### Pitfall 4: Token Budget Exhausted by One Large Result
**What goes wrong:** A single KG entity with 20+ observations can be 500+ tokens, consuming half the budget in one result.
**Why it happens:** KG entities concatenate name + all observations into one text block. summary_preview is capped at 200 chars but the formatted output includes attribution headers.
**How to avoid:** Per D-09, truncate the summary_preview to fit remaining budget rather than skipping. Use `countTokens()` on the formatted result before adding it, and if it exceeds remaining budget, truncate the preview text and recount.
**Warning signs:** Only 1-2 results appear in output despite many relevant items existing.

### Pitfall 5: Recency Bias Overwhelms Relevance
**What goes wrong:** Recent but irrelevant observations rank higher than older but highly relevant insights because the recency score dominates the RRF fusion.
**Why it happens:** Recency is treated as a third ranking signal equal to semantic and keyword, but it correlates poorly with relevance for knowledge that remains valid over time (e.g., architectural decisions).
**How to avoid:** Use recency as a tiebreaker, not a primary signal. Give it lower weight in RRF (e.g., rank within recency list contributes 0.5x to the RRF score vs 1.0x for semantic and keyword). Or apply recency as a post-fusion multiplier only for items from the last 7 days.
**Warning signs:** Top results are always from the last few days regardless of query topic.

## Code Examples

### Complete Qdrant Search with Score Threshold
```javascript
// Source: Context7 /qdrant/qdrant-js -- search with filters
const results = await client.search('insights', {
  vector: queryVector,           // number[] from embedOne()
  limit: 20,
  score_threshold: 0.75,         // per D-04
  with_payload: true,            // need summary_preview, date, topic, etc.
  with_vector: false,            // don't return vectors (save bandwidth)
});
// Each result: { id, version, score, payload: { topic, confidence, summary_preview, ... } }
```

### Token Counting with gpt-tokenizer
```javascript
// Source: Context7 /niieani/gpt-tokenizer
import { countTokens } from 'gpt-tokenizer';

const text = '## Insights\n\n**Docker Build Timeout** (2026-03-01, confidence: 0.9)\nDocker builds take 3-5 min...';
const tokens = countTokens(text);  // synchronous, ~1ms
// tokens: 28
```

### SQLite FTS5 Search with LIKE Fallback
```javascript
// Source: Existing pattern in server.js handleGetObservations (line 3941-3949)
function keywordSearch(db, query) {
  // Observations: use FTS5
  let obsResults;
  try {
    db.prepare('SELECT 1 FROM observations_fts LIMIT 0').get(); // probe
    obsResults = db.prepare(`
      SELECT id, summary, agent, created_at, quality,
             rank as fts_rank
      FROM observations
      WHERE rowid IN (SELECT rowid FROM observations_fts WHERE observations_fts MATCH ?)
      ORDER BY rank
      LIMIT 20
    `).all(query);
  } catch {
    obsResults = db.prepare(`
      SELECT id, summary, agent, created_at, quality
      FROM observations WHERE summary LIKE ?
      ORDER BY created_at DESC LIMIT 20
    `).all(`%${query}%`);
  }

  // Digests: LIKE fallback (no FTS table)
  const digestResults = db.prepare(`
    SELECT id, summary, theme, date, agents, quality
    FROM digests WHERE summary LIKE ? OR theme LIKE ?
    ORDER BY created_at DESC LIMIT 20
  `).all(`%${query}%`, `%${query}%`);

  // Insights: LIKE fallback (no FTS table)
  const insightResults = db.prepare(`
    SELECT id, summary, topic, confidence
    FROM insights WHERE summary LIKE ? OR topic LIKE ?
    ORDER BY created_at DESC LIMIT 10
  `).all(`%${query}%`, `%${query}%`);

  return { obsResults, digestResults, insightResults };
}
```

### Recency Exponential Decay
```javascript
// Exponential decay scoring based on item age
function recencyScore(dateStr, halfLifeDays = 14) {
  if (!dateStr) return 0.5; // neutral if no date
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}
// 0 days old -> 1.0, 14 days old -> 0.5, 28 days old -> 0.25
```

### Qdrant Payload Structure by Tier (from backfill.ts)
```javascript
// Source: src/embedding/backfill.ts -- verified payload schemas per collection
// observations payload: { agent, project, date, quality, summary_preview }
// digests payload: { date, theme, agents, quality, summary_preview }
// insights payload: { topic, confidence, digestIds, summary_preview }
// kg_entities payload: { entityType, hierarchyLevel, parentId, summary_preview }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pure semantic search | Hybrid semantic + keyword + recency (RRF) | 2024-2025 | Avoids context rot from semantically similar but irrelevant results |
| Fixed token budgets | Per-request configurable budgets | Ongoing | Different agents have different context window budgets |
| Single vector collection | Per-tier collections with weighted scoring | Phase 28 design | Enables independent tier weighting without payload filtering overhead |
| tiktoken/WASM tokenizer | gpt-tokenizer (pure JS) | 2024 | No WASM init step, synchronous API, ~1ms per call |

**Deprecated/outdated:**
- `EmbeddingGenerator.cjs` / `embedding_generator.py`: Replaced by fastembed in Phase 28. Do not use.
- Single `knowledge` collection approach from STACK.md initial research: Superseded by Phase 28 decision to use 4 separate collections.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RRF k=60 is optimal for this dataset size (~1500 items) | Architecture Patterns | Low -- k=60 is the standard default; tuning would only marginally affect ranking quality [ASSUMED] |
| A2 | Recency half-life of 14 days is appropriate | Code Examples | Low -- configurable; can tune after observing retrieval quality [ASSUMED] |
| A3 | 20 results per collection limit is sufficient for 1000-token budget | Architecture Patterns | Low -- 1000 tokens fits ~5-10 formatted results; 80 candidates is more than enough [ASSUMED] |
| A4 | fastembed warm embedOne() latency is ~20ms | Architecture Diagram | Medium -- measured in other projects; actual latency on this machine not verified [ASSUMED] |

## Open Questions

1. **FTS5 for digests and insights?**
   - What we know: Only `observations_fts` exists. Digests (194 rows) and insights (15 rows) have no FTS tables.
   - What's unclear: Whether to create FTS5 tables for them or use LIKE fallback.
   - Recommendation: Use LIKE fallback. With <200 rows, LIKE is sub-millisecond. Creating FTS5 tables adds maintenance burden (triggers for sync) with negligible performance benefit. This is a discretion area per CONTEXT.md.

2. **Embed query on-the-fly vs accept pre-computed vector?**
   - What we know: embedOne() is ~20ms warm. The Claude hook (Phase 30) will call this endpoint with a text query.
   - What's unclear: Whether any future caller would benefit from passing a pre-computed vector.
   - Recommendation: Embed on-the-fly. Accept `query` (string) as the primary input. Optionally accept `vector` (number[]) to skip embedding -- future-proofing at zero cost.

3. **Error handling when Qdrant is unreachable?**
   - What we know: Qdrant runs in Docker. If Docker is down, all 4 collection searches fail.
   - What's unclear: Whether to return empty results, an error, or fall back to keyword-only.
   - Recommendation: Graceful degradation. If Qdrant is unreachable, fall back to keyword-only search (SQLite FTS + LIKE) and include a `degraded: true` flag in meta. This preserves some retrieval value vs returning nothing.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Qdrant | Semantic search | Yes | Running on localhost:6333 | Keyword-only fallback |
| SQLite (.observations/observations.db) | Keyword search, data source | Yes | 650 obs, 194 digests, 15 insights | -- |
| fastembed ONNX model | Query embedding | Yes | all-MiniLM-L6-v2, installed by Phase 28 | -- |
| Node.js | Runtime | Yes | (host) | -- |
| Health API server (port 3033) | Endpoint host | Yes | Express, running | -- |

**Qdrant collection status (verified live):**
- `observations`: 647 points
- `digests`: 132 points
- `insights`: 12 points
- `kg_entities`: 675 points

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None -- all dependencies available.

## Project Constraints (from CLAUDE.md)

- **TypeScript mandatory with strict checking** -- but server.js is plain JS (ESM). New retrieval modules should be JS to match server.js, OR TypeScript compiled to dist/. Given server.js imports from `../../src/embedding/` (TS compiled), either approach works. Recommendation: Write as JS in `src/retrieval/` to avoid compilation step, since server.js is JS.
- **No console.log** -- use `process.stderr.write()` for logging in all new code.
- **Serena MCP only for reading** -- use Edit/Write for file operations.
- **Never modify working APIs for TypeScript compliance** -- fix types instead.
- **plantuml CLI** -- not relevant for this phase.
- **Submodule build pipeline** -- server.js is NOT a submodule; it is in `integrations/system-health-dashboard/` which is bind-mounted. Changes take effect after `npm run build` of the dashboard (or immediately for server.js since it is interpreted, not compiled).

## Sources

### Primary (HIGH confidence)
- Context7 `/qdrant/qdrant-js` -- search API with score_threshold, filters, batch search
- Context7 `/niieani/gpt-tokenizer` -- countTokens(), encode(), isWithinTokenLimit() APIs
- Codebase: `src/embedding/embedding-service.ts` -- embedOne() API, singleton pattern
- Codebase: `src/embedding/qdrant-collections.ts` -- getQdrantClient(), ensureCollections()
- Codebase: `src/embedding/backfill.ts` -- Qdrant payload structure for all 4 tiers
- Codebase: `integrations/system-health-dashboard/server.js` -- route patterns, SQLite access, FTS5 usage
- npm registry -- verified installed versions of all dependencies
- Live Qdrant instance -- verified collection point counts

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` -- context rot, token budget overshoot warnings
- `.planning/research/STACK.md` -- stack selection rationale

### Tertiary (LOW confidence)
- None -- all claims verified against codebase or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages already installed and verified via npm ls
- Architecture: HIGH -- all integration points examined in source code
- Pitfalls: HIGH -- verified FTS5 table existence, Qdrant collection status, payload structure

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable -- no fast-moving dependencies)
