# Architecture Patterns

**Domain:** Knowledge context injection for multi-agent coding environment
**Researched:** 2026-04-24

## Recommended Architecture

### High-Level Overview

```
HOST SIDE                                    DOCKER SIDE
==========                                   ===========

+------------------+                         +------------------+
| Claude Code      |  UserPromptSubmit hook   | Qdrant (6333)    |
| Copilot          |  +--> injection-hook.js  | 384-dim vectors  |
| OpenCode         |       |                  +------------------+
| Mastracode       |       v                  +------------------+
+------------------+  +------------------+    | Redis (6379)     |
                      | Retrieval Service|    | embedding cache  |
+------------------+  | (host, port 3035)|---→+------------------+
| ETM (host)       |  +------------------+
| ObservationWriter|       ↑
|    ↓             |       | HTTP query
| SQLite (.obs/db) |-------+
+------------------+  reads observations,
                      digests, insights
+------------------+
| LLM Proxy (12435)|  (existing, for
+------------------+   embedding gen)
```

### The Host-Side Decision (CRITICAL)

**The retrieval service MUST run on the host.** Rationale:

1. **SQLite access**: The observations database (`.observations/observations.db`) is the primary knowledge store (650 observations, 132 digests, 12 insights). SQLite requires same-filesystem access -- it uses file-level locking (WAL mode) and cannot be reliably accessed over a Docker bind-mount from inside the container while the host (ETM, ObservationWriter) is simultaneously writing. Running the reader on the host avoids cross-process WAL contention.

2. **Hook latency**: Claude Code's `UserPromptSubmit` hook must complete fast (ideally <500ms). A host-side retrieval service avoids the extra Docker network hop. The hook script runs on the host, so localhost:3035 is a direct connection.

3. **Existing pattern**: ETM, ObservationWriter, LLM Proxy, and the hooks all run on the host. The retrieval service follows this established pattern.

4. **Qdrant is already port-mapped**: Qdrant is exposed at `localhost:6333` from Docker, so the host-side service can query it directly without needing to be inside the Docker network.

**Qdrant stays in Docker.** It is already running there, has persistent volume mounts, and its HTTP API is port-forwarded to the host. No change needed.

**Redis stays in Docker.** Used for embedding caching. Exposed at `localhost:6379`. The host retrieval service can connect to it directly.

### Component Boundaries

| Component | Location | Port | Responsibility | Communicates With |
|-----------|----------|------|---------------|-------------------|
| **Retrieval Service** | Host | 3035 | Accept query, search Qdrant + SQLite, assemble context, return token-budgeted results | Qdrant (6333), Redis (6379), SQLite (file) |
| **Injection Hook** | Host | N/A (hook) | Called by Claude Code on UserPromptSubmit; calls retrieval service; returns additionalContext | Retrieval Service (3035) |
| **Embedding Pipeline** | Host | N/A (daemon) | Watch for new observations/digests/insights, generate embeddings, upsert to Qdrant | SQLite (file), Qdrant (6333), Redis (6379) |
| **Working Memory Store** | Host | N/A (file) | Structured project state document at `.observations/working-memory.json` | Read/written by Retrieval Service and post-response hook |
| **Agent Adapters** | Host | N/A | Agent-specific hooks/middleware for Claude, Copilot, OpenCode, Mastra | Retrieval Service (3035) |
| **Qdrant** | Docker | 6333 | Vector storage for all knowledge tier embeddings | Queried by Retrieval Service, written by Embedding Pipeline |
| **Redis** | Docker | 6379 | Embedding cache, query result cache | Used by Retrieval Service and Embedding Pipeline |

## Data Flows

### Flow 1: Embedding Pipeline (observation -> Qdrant)

```
New observation written to SQLite
        |
Embedding Daemon detects (poll every 30s for embedded_at IS NULL)
        |
Read observation text from SQLite
        |
Generate 384-dim embedding via EmbeddingGenerator.cjs
    (sentence-transformers/all-MiniLM-L6-v2, Python subprocess)
        |
Upsert vector + metadata to Qdrant collection
        |
UPDATE observations SET embedded_at = datetime('now') WHERE id = ?
```

**Collections in Qdrant** (new, separate from existing `knowledge_patterns_small`):
- `knowledge_observations` -- 384-dim, observation embeddings, metadata: agent, session_id, created_at
- `knowledge_digests` -- 384-dim, digest embeddings, metadata: theme, date, observation_ids
- `knowledge_insights` -- 384-dim, insight embeddings, metadata: topic, confidence
- `knowledge_kg_entities` -- 384-dim, KG entity embeddings from LevelDB/JSON export

**Why separate collections**: Different knowledge tiers have different metadata schemas and different retrieval weights. Searching per-collection then merging is cleaner than filtering a single mega-collection. The existing `knowledge_patterns_small` collection (currently 0 points) was built for KG entity sync; the new collections serve a different purpose and should not be conflated.

### Flow 2: Context Injection (user message -> retrieval -> injection)

```
User types prompt in Claude Code
        |
UserPromptSubmit hook fires
        |
injection-hook.js reads stdin (JSON with user prompt text)
        |
HTTP POST to Retrieval Service (localhost:3035/retrieve)
    Body: { query: "user prompt text", agent: "claude", tokenBudget: 4000 }
        |
Retrieval Service:
    1. Generate query embedding (384-dim, cached in Redis by text hash)
    2. Parallel search:
       a. Qdrant semantic search across all 4 collections (top-K per collection)
       b. SQLite FTS5 keyword search on observations_fts
    3. Merge + rank results:
       - Semantic similarity score (0-1)
       - Recency boost (exponential decay, half-life 14 days)
       - Tier weight: insights (1.0) > digests (0.8) > observations (0.6) > KG (0.5)
       - Keyword match bonus (+0.15 for FTS hits that also appear in semantic results)
    4. Token budgeting:
       - Working memory: fixed allocation (~1000 tokens)
       - Semantic results: fill remaining budget, highest-ranked first
       - Truncate individual results if needed to fit
    5. Assemble context block as markdown
        |
Return assembled context string to hook
        |
Hook outputs JSON:
    {
      "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": "<assembled knowledge context>"
      }
    }
    exit 0
        |
Claude sees additionalContext alongside user message
```

**Critical constraint**: Hook stdout is capped at 10,000 characters by Claude Code. The retrieval service must respect this hard limit. With JSON structure overhead, the effective payload budget is ~9,500 characters (~3,500-4,000 tokens).

### Flow 3: Working Memory Update (post-response)

**Recommended approach for v1 (simple):** Working memory is server-side state in the Retrieval Service, not a separate hook.

```
injection-hook.js calls POST /retrieve
        |
Retrieval Service:
    1. Updates working-memory.json with metadata from this query:
       - lastQuery: the current prompt text
       - lastQueryTime: timestamp
       - queryHistory: sliding window of last 10 queries (for session continuity)
    2. Reads working-memory.json for context assembly
    3. Returns assembled context including working memory section
```

**v2 enhancement (deferred):** Add a Stop/PostToolUse hook that sends conversation turn data to `POST /update-memory` for richer extraction (active files, decisions, goals). This requires parsing hook stdin which contains the full turn -- more complex but higher quality memory.

### Flow 4: Feedback Loop (new knowledge auto-embedded)

```
ObservationWriter stores new observation to SQLite
        |
Embedding Daemon polls SQLite (every 30s) for rows where embedded_at IS NULL
        |
Batch embed + upsert to Qdrant
        |
Mark embedded_at = NOW()

ObservationConsolidator creates new digest/insight
        |
Same daemon detects new digest/insight rows (embedded_at IS NULL)
        |
Embed + upsert to Qdrant
```

## Patterns to Follow

### Pattern 1: Thin Hook, Fat Service

**What:** Keep hook scripts minimal -- read stdin, call retrieval service, format output, exit. All logic lives in the retrieval service.

**When:** Always. Hooks run in Claude Code's process and must be fast and reliable.

**Example:**
```javascript
// injection-hook.js -- THIN
import { readFileSync } from 'fs';

const input = readFileSync('/dev/stdin', 'utf8').trim();
if (!input) process.exit(0);

const hookData = JSON.parse(input);
const query = hookData.prompt?.content || hookData.text || '';
if (!query || query.length < 5) process.exit(0);

try {
  const res = await fetch('http://localhost:3035/retrieve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, agent: 'claude', tokenBudget: 4000 }),
    signal: AbortSignal.timeout(2000) // 2s hard timeout
  });
  if (!res.ok) process.exit(0); // fail open
  const { context } = await res.json();
  if (context) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    }));
  }
} catch { /* fail open -- retrieval service down or slow */ }
process.exit(0);
```

### Pattern 2: Fail Open

**What:** If the retrieval service is down, slow (>2s), or errors, the hook exits 0 silently. The agent operates normally without injected context. Never block the user's workflow.

**When:** Every hook interaction. Knowledge injection is an enhancement, not a gate.

### Pattern 3: Token Budget Envelope

**What:** The retrieval service receives a token budget and guarantees the response fits within it. It never returns more than the budget allows.

**When:** Every retrieval call. The 10,000 character hook limit is a hard wall.

**Context template:**
```
<knowledge-context>

## Working Memory
- Current goal: ...
- Active files: ...
- Recent decisions: ...

## Relevant Knowledge
1. [Insight] Topic (confidence: 0.9) -- summary
2. [Digest] Theme (2026-04-20) -- summary
3. [Observation] agent/session -- summary

</knowledge-context>
```

### Pattern 4: Agent Adapter Interface

**What:** Each agent has a thin adapter translating between the agent's hook mechanism and the retrieval service HTTP API.

| Agent | Mechanism | Adapter Type | Notes |
|-------|-----------|-------------|-------|
| Claude Code | UserPromptSubmit hook in settings.local.json | Hook script (Node.js) | Primary adapter, built first |
| Copilot | VS Code extension API or chat pre-request hook | Extension middleware (TS) | Depends on Copilot's extensibility |
| OpenCode | Config hooks (if supported) | Hook script or wrapper | Research needed on OpenCode hook support |
| Mastracode | Mastra agent middleware / system prompt | Agent middleware (TS) | Mastra has memory injection built-in; adapt |

All adapters call the same `POST /retrieve` endpoint. The `agent` field lets the service customize ranking (e.g., weight same-agent observations higher).

## Anti-Patterns to Avoid

### Anti-Pattern 1: Retrieval Service Inside Docker

**What:** Running the retrieval service as another supervisord program inside coding-services.

**Why bad:** SQLite concurrent access across Docker bind-mount boundaries causes WAL lock contention. The host-side ETM and ObservationWriter hold WAL locks; a Docker reader would need to coordinate across the mount. Additionally, adds network latency for hook calls.

**Instead:** Run on host. Access SQLite natively, Qdrant via port-forwarded 6333.

### Anti-Pattern 2: Embedding in the Hook

**What:** Generating query embeddings inside the hook script itself.

**Why bad:** sentence-transformers Python subprocess takes 1-3s cold start. Every prompt would feel sluggish. Even cached, model loading is slow.

**Instead:** The retrieval service keeps a warm embedding model (persistent Python process or pre-loaded model). Query embedding happens server-side in <100ms.

### Anti-Pattern 3: One Giant Qdrant Collection

**What:** Putting all knowledge tiers in a single collection with a `tier` filter field.

**Why bad:** Different tiers have different metadata schemas and update frequencies. Filtering a mega-collection is less efficient than targeted per-collection search, and metadata schema conflicts make payload management messy.

**Instead:** Four dedicated collections, searched in parallel, results merged and ranked.

### Anti-Pattern 4: LLM Calls in Hook Hot Path

**What:** Using LLM to summarize or rerank results inside the hook or the retrieval service's synchronous response path.

**Why bad:** LLM calls take 2-10s. The hook must complete in <2s total. Any LLM call in the hot path makes every prompt unbearably slow.

**Instead:** All LLM work happens in the async embedding daemon (batch processing). The retrieval path uses pure vector math + scoring heuristics.

## Component Dependency Graph (Build Order)

```
Phase 1: Embedding Pipeline
  +-- Extend SQLite schema (add embedded_at columns to observations, digests, insights)
  +-- Create 4 Qdrant collections
  +-- Build embedding daemon (host-side Node.js process)
  +-- Backfill: embed existing 650 observations + 132 digests + 12 insights
  Dependencies: None (Qdrant and SQLite already exist)

Phase 2: Retrieval Service
  +-- HTTP server (host, port 3035, Express or Fastify)
  +-- Qdrant search client (multi-collection parallel search)
  +-- SQLite FTS5 keyword search
  +-- Ranking/scoring engine (hybrid semantic + keyword + recency)
  +-- Token budgeting and context assembly
  +-- Health endpoint (GET /health)
  Dependencies: Phase 1 (Qdrant must have vectors to search)

Phase 3: Claude Code Injection Hook
  +-- injection-hook.js (thin UserPromptSubmit hook)
  +-- Register in .claude/settings.local.json alongside existing constraint hook
  +-- Integration test with retrieval service
  Dependencies: Phase 2 (retrieval service must be running)

Phase 4: Working Memory
  +-- Working memory schema (.observations/working-memory.json)
  +-- Update logic in retrieval service (query-driven updates)
  +-- Include working memory section in context assembly
  Dependencies: Phase 2 (retrieval service)

Phase 5: Additional Agent Adapters
  +-- Copilot adapter
  +-- OpenCode adapter
  +-- Mastracode adapter
  +-- Agent-specific ranking tuning
  Dependencies: Phase 3 (Claude adapter as reference implementation)

Phase 6: Feedback Loop Hardening
  +-- Real-time embedding on new observation write (event-driven instead of polling)
  +-- Consolidator integration (embed new digests/insights immediately)
  +-- KG entity sync (embed on KG update)
  Dependencies: Phase 1 (embedding pipeline)
```

**Critical path**: Phases 1 -> 2 -> 3 are strictly sequential. Phase 4 can start after Phase 2. Phase 5 can start after Phase 3. Phase 6 is an optimization of Phase 1.

## Network Topology

```
HOST (macOS)
+-- Claude Code (tmux pane) --hook--> injection-hook.js --HTTP--> Retrieval Service :3035
+-- Copilot (tmux pane) --adapter--> Retrieval Service :3035
+-- OpenCode (tmux pane) --adapter--> Retrieval Service :3035
+-- Mastracode (tmux pane) --adapter--> Retrieval Service :3035
+-- ETM (host process) --writes--> SQLite (.observations/observations.db)
+-- LLM Proxy :12435 (host process)
+-- Retrieval Service :3035 (NEW, host process)
|   +-- reads SQLite (local file access, read-only)
|   +-- queries Qdrant :6333 (port-forwarded from Docker)
|   +-- queries Redis :6379 (port-forwarded from Docker)
+-- Embedding Daemon (NEW, host process)
    +-- reads SQLite (local file access)
    +-- writes Qdrant :6333
    +-- caches in Redis :6379
    +-- uses EmbeddingGenerator.cjs -> Python subprocess (sentence-transformers)

DOCKER (coding-network bridge)
+-- coding-services container
|   +-- semantic-analysis SSE :3848
|   +-- health dashboard :3032/:3033
|   +-- VKB :8080
|   +-- constraint-monitor :3849
|   +-- code-graph-rag :3850
+-- qdrant container :6333/:6334 <-- port-forwarded to host
+-- redis container :6379 <-- port-forwarded to host
+-- memgraph container :7687 <-- port-forwarded to host
```

### Health Checks

| Component | Health Endpoint | Check Method |
|-----------|----------------|-------------|
| Retrieval Service | `GET /health` on :3035 | HTTP 200, includes Qdrant + SQLite + Redis connectivity status |
| Embedding Daemon | PID file + last-embedded timestamp check | PSM (Process State Manager) |
| Qdrant | `GET /collections` on :6333 | Already monitored by health dashboard |
| Redis | `redis-cli ping` on :6379 | Already monitored by health dashboard |

### Port Allocation

| Port | Service | Location | Status |
|------|---------|----------|--------|
| 3035 | Retrieval Service | Host | **NEW** |
| 6333 | Qdrant HTTP | Docker->Host | Existing |
| 6379 | Redis | Docker->Host | Existing |
| 12435 | LLM Proxy | Host | Existing |
| 3848 | Semantic Analysis SSE | Docker->Host | Existing |
| 3033 | Health Dashboard WS | Docker->Host | Existing |

## Scalability Considerations

| Concern | Current (650 obs) | At 5K observations | At 50K observations |
|---------|-------------------|--------------------|--------------------|
| Qdrant search latency | <10ms | <20ms | <50ms (384-dim is fast) |
| SQLite FTS5 | <5ms | <10ms | <50ms (may need index tuning) |
| Embedding backfill | ~5 min | ~30 min | ~5 hours (batch overnight) |
| Hook response time | <200ms target | <300ms | <500ms (add Redis result caching) |
| Working memory size | ~500 tokens | ~500 tokens (fixed schema) | ~500 tokens (pruned) |
| Qdrant storage | ~5MB | ~50MB | ~500MB (well within limits) |

## Technology Choices for New Components

| Component | Technology | Why |
|-----------|-----------|-----|
| Retrieval Service | Node.js + Express (host) | Matches existing host-side stack (ETM, ObservationWriter, LLM Proxy are all Node.js). Same runtime, same patterns. |
| Embedding Generation | Existing EmbeddingGenerator.cjs -> Python subprocess | Already built, uses sentence-transformers/all-MiniLM-L6-v2, generates 384-dim vectors. Reuse, do not rebuild. |
| Qdrant Client | @qdrant/js-client-rest | Official JS client, used in existing QdrantSyncService. |
| SQLite Access | better-sqlite3 | Already used by ObservationWriter and ObservationConsolidator. Synchronous API, WAL-safe for read-only access. |
| Redis Client | ioredis | Standard Node.js Redis client for embedding cache and query result cache. |
| Hook Scripts | Vanilla Node.js (no external deps) | Hooks must start instantly. No import overhead. Use native fetch (Node 18+). |

## Sources

- Existing codebase: docker-compose.yml, supervisord.conf, settings.local.json, ObservationWriter.js, QdrantSyncService.js, KnowledgeRetriever.js, EmbeddingGenerator.cjs -- HIGH confidence (direct code analysis)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) -- HIGH confidence (official docs, additionalContext field, 10K char limit, JSON output format)
- Qdrant HTTP API at localhost:6333 -- HIGH confidence (live query: 5 existing collections, knowledge_patterns_small has 0 points at 384-dim)
- SQLite schema inspection -- HIGH confidence (live query: 650 observations, 132 digests, 12 insights)
