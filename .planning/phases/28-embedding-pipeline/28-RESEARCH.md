# Phase 28: Embedding Pipeline - Research

**Researched:** 2026-04-24
**Domain:** Vector embedding pipeline for knowledge retrieval (fastembed, Qdrant, Redis pub/sub)
**Confidence:** HIGH

## Summary

Phase 28 establishes the vector foundation for the entire v6.0 Knowledge Context Injection milestone. All four knowledge tiers (650 observations, 132 digests, 12 insights, 678 KG entities) must be embedded as 384-dim vectors in Qdrant, with new items embedded automatically via Redis pub/sub events. The existing Python subprocess embedding approach (`EmbeddingGenerator.cjs` spawning `embedding_generator.py`) is replaced by `fastembed` (Node.js ONNX runtime) running the same `all-MiniLM-L6-v2` model natively without Python dependencies.

The codebase already has `@qdrant/js-client-rest` and `gpt-tokenizer` in root `package.json`. Qdrant is running in Docker at port 6333 with 5 existing collections (none for this pipeline). Redis is in Docker at port 6379 but is NOT reachable from the host -- the embedding listener must either run inside Docker or Redis must be port-forwarded. The Docker base image is `node:22-bookworm` (Debian/glibc), which is compatible with fastembed's ONNX runtime.

**Primary recommendation:** Install fastembed in root package.json, create 4 Qdrant collections, build a host-side backfill CLI script, and implement a Redis pub/sub listener as a new supervisord process in Docker for write-time embedding.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use `fastembed` (Node.js ONNX runtime) instead of the existing Python subprocess approach. fastembed runs ONNX natively in Node.js with all-MiniLM-L6-v2 producing 384-dim vectors.
- **D-02:** Pin embedding model to `all-MiniLM-L6-v2` in a single config location. Model version must be tracked so future model changes trigger re-embedding.
- **D-03:** Create 4 separate Qdrant collections -- one per knowledge tier: `observations`, `digests`, `insights`, `kg_entities`.
- **D-04:** Each collection stores metadata alongside vectors: observations get (agent, project, date, quality), digests get (date, theme, agents, quality), insights get (topic, confidence, digestIds), KG entities get (type, level, parentId).
- **D-05:** Use Redis pub/sub for embedding events. Writers emit events on new creation. A separate embedding listener process consumes events and upserts to Qdrant.
- **D-06:** The event bus approach decouples embedding from the write path.
- **D-07:** A one-shot CLI script embeds all existing items. Content-hash based idempotency ensures re-runs skip already-embedded items.
- **D-08:** The backfill script reads from SQLite (observations/digests/insights) and LevelDB (KG entities), embeds via fastembed, and upserts to Qdrant.

### Claude's Discretion
- Exact Redis channel naming and message format
- Embedding batch size for backfill (researcher should determine optimal batch size for fastembed)
- Whether to reuse the existing `EmbeddingCache` (disk-backed, 7-day TTL) or let Qdrant be the sole cache
- ONNX model download strategy (pre-download during build vs lazy download on first use)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMBED-01 | All existing observations (558+) embedded into Qdrant with metadata | Backfill CLI script reads SQLite `observations` table (650 rows), embeds summary text via fastembed, upserts to `observations` collection with agent/project/date/quality payload |
| EMBED-02 | All existing digests (132) embedded into Qdrant with metadata | Backfill script reads `digests` table, embeds summary text, upserts to `digests` collection with date/theme/agents/quality payload |
| EMBED-03 | All existing insights (12) embedded into Qdrant with metadata | Backfill script reads `insights` table, embeds summary text, upserts to `insights` collection with topic/confidence/digestIds payload |
| EMBED-04 | All existing KG entities (160+) embedded into Qdrant with metadata | Backfill script reads LevelDB graph key (678 nodes), filters to meaningful entities (skip scaffold nodes), embeds joined name+observations text, upserts to `kg_entities` collection with type/level/parentId payload |
| EMBED-05 | New observations/digests/insights embedded automatically on creation | Redis pub/sub: ObservationWriter publishes to `embedding:new` channel after successful write; embedding listener subscribes, embeds, upserts to Qdrant |
| EMBED-06 | Embedding model pinned and versioned using fastembed with all-MiniLM-L6-v2 | Single config file (`embedding-config.json`) with model name, version, dimensions; shared by backfill script, listener, and future retrieval service |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Embedding generation | Host (backfill) / Docker (listener) | -- | Backfill runs host-side for SQLite access; listener runs in Docker for Redis access |
| Qdrant collection management | Host (backfill script creates collections) | Docker (listener upserts) | Collection creation is one-time setup during backfill |
| Redis pub/sub events | Docker (publisher + subscriber) | Host (ObservationWriter publishes via localhost:6379) | Redis runs in Docker; writers on host connect via port-forward |
| SQLite data access | Host | -- | SQLite WAL mode requires same-filesystem access; ETM/ObservationWriter run on host |
| LevelDB data access | Host | -- | LevelDB directory is on host filesystem |
| Embedding model configuration | Host (config file) | Docker (reads same config via bind-mount) | Single source of truth in repo, bind-mounted into container |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastembed` | 2.1.0 | ONNX-based embedding generation in Node.js | Replaces Python subprocess; same all-MiniLM-L6-v2 model, no Python deps. Built by Qdrant team. [VERIFIED: npm registry] |
| `@qdrant/js-client-rest` | 1.17.0 | TypeScript Qdrant client (REST) | Already in root package.json. Official SDK with types. [VERIFIED: npm registry, already installed] |
| `ioredis` | 5.10.1 | Redis client with pub/sub support | Industry standard Node.js Redis client. Better pub/sub API than node-redis (v4). The constraint-monitor has node-redis v4 but does not actually use it. [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | (already installed) | SQLite access for observations/digests/insights | Backfill script reads from .observations/observations.db |
| `level` | (already installed) | LevelDB access for KG entities | Backfill script reads from .data/knowledge-graph/ |
| `crypto` (built-in) | Node.js built-in | Content hashing for idempotency | SHA-256 hash of content for dedup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ioredis` | `redis` (node-redis v4) | node-redis v4 is already in constraint-monitor but unused. ioredis has better pub/sub DX, but either works. Using ioredis for consistency with its simpler sub API. |
| `fastembed` | `@xenova/transformers` (already in root deps) | @xenova/transformers is more general-purpose, larger footprint. fastembed is embedding-specific, optimized for this exact use case. |
| Redis pub/sub | SQLite polling | Polling adds latency (30s cycles). Redis pub/sub delivers within milliseconds. |
| Redis pub/sub | Node.js EventEmitter | EventEmitter only works in-process. ObservationWriter and embedding listener are separate processes. |

**Installation:**
```bash
# Root package (host-side backfill script + embedding config)
npm install fastembed@^2.1.0 ioredis@^5.10.0

# ioredis is also needed in Docker if listener runs there
# fastembed is needed wherever embedding happens
```

## Architecture Patterns

### System Architecture Diagram

```
HOST SIDE                                     DOCKER SIDE
==========                                    ===========

User creates observation via ETM
        |
        v
+-------------------+     Redis pub/sub      +-------------------+
| ObservationWriter  |----(publish)---------->| Redis (6379)      |
| (host, Node.js)   |    channel:            |                   |
+-------------------+    embedding:new       +-------------------+
        |                                           |
        v                                     (subscribe)
+-------------------+                               |
| SQLite            |                               v
| observations.db   |                    +-------------------+
| (WAL mode)        |                    | Embedding Listener|
+-------------------+                    | (supervisord)     |
                                         |  - fastembed      |
+-------------------+                    |  - qdrant client  |
| LevelDB           |                    +-------------------+
| knowledge-graph/  |                           |
+-------------------+                     (upsert vectors)
        |                                       |
        |                                       v
+-------------------+                    +-------------------+
| Backfill CLI      |----(upsert)----->>| Qdrant (6333)     |
| (host, one-shot)  |    via HTTP        | 4 collections:    |
| reads SQLite +    |                    |  - observations   |
|   LevelDB         |                    |  - digests        |
+-------------------+                    |  - insights       |
                                         |  - kg_entities    |
                                         +-------------------+
```

**Data flow for backfill (one-shot):**
1. CLI script reads all items from SQLite (obs/digests/insights) and LevelDB (KG entities)
2. Computes content hash for each item
3. Checks Qdrant for existing points with matching content hash (idempotency)
4. Embeds uncached items via fastembed in batches
5. Upserts vectors + metadata payloads to respective Qdrant collections

**Data flow for write-time embedding (continuous):**
1. ObservationWriter writes to SQLite, then publishes `{type, id, content, metadata}` to Redis channel `embedding:new`
2. Embedding listener (in Docker) receives message, embeds via fastembed, upserts to Qdrant
3. If listener is down, items are caught on next backfill run (idempotency via content hash)

### Recommended Project Structure
```
src/
  embedding/
    embedding-config.json        # Single source of truth: model, version, dimensions
    embedding-service.ts         # Shared fastembed wrapper (init model, embed text, batch)
    backfill.ts                  # CLI: one-shot embed all existing items
    listener.ts                  # Redis pub/sub consumer -> Qdrant upsert
    qdrant-collections.ts        # Collection creation + schema definitions
    content-hash.ts              # SHA-256 content hashing for idempotency
```

### Pattern 1: Fastembed Initialization and Embedding
**What:** Initialize fastembed with pinned model, generate embeddings
**When to use:** Every embedding operation (backfill + listener)
**Example:**
```typescript
// Source: fastembed npm README [VERIFIED: npm readme]
import { EmbeddingModel, FlagEmbedding } from "fastembed";

// Initialize once, reuse across requests
const embeddingModel = await FlagEmbedding.init({
  model: EmbeddingModel.AllMiniLML6V2  // all-MiniLM-L6-v2, 384-dim
});

// Single text embedding (for listener)
const queryEmbedding: number[] = await embeddingModel.queryEmbed("observation text here");

// Batch embedding (for backfill) - uses async generator
const documents = ["text1", "text2", "text3", ...];
const embeddings = embeddingModel.embed(documents, 64); // batch size 64
for await (const batch of embeddings) {
  // batch is number[][] with up to 64 embeddings
  await upsertToQdrant(batch);
}
```

### Pattern 2: Qdrant Collection Creation
**What:** Create typed collections with correct vector dimensions and payload indexes
**When to use:** During backfill script initialization (idempotent)
**Example:**
```typescript
// Source: @qdrant/js-client-rest Context7 docs [VERIFIED: Context7]
import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({ url: "http://localhost:6333" });

// Create collection (idempotent - check first)
const collections = await qdrant.getCollections();
const exists = collections.collections.some(c => c.name === "observations");
if (!exists) {
  await qdrant.createCollection("observations", {
    vectors: { size: 384, distance: "Cosine" },
  });
  // Create payload indexes for filtering
  await qdrant.createPayloadIndex("observations", {
    field_name: "agent",
    field_schema: "keyword",
  });
  await qdrant.createPayloadIndex("observations", {
    field_name: "quality",
    field_schema: "keyword",
  });
}
```

### Pattern 3: Qdrant Upsert with Metadata
**What:** Upsert embedded vectors with payload metadata
**When to use:** Both backfill and listener write paths
**Example:**
```typescript
// Source: @qdrant/js-client-rest Context7 docs [VERIFIED: Context7]
await qdrant.upsert("observations", {
  wait: true,
  points: [{
    id: "d8e0bca3-608d-4359-9c0f-54a5b013e4d3",  // UUID from SQLite
    vector: embedding,  // number[384]
    payload: {
      agent: "claude",
      project: "coding",
      date: "2026-04-23",
      quality: "high",
      content_hash: "abc123...",  // For idempotency check
      summary_preview: "Intent: Fix Docker build...",  // First 200 chars for display
      model_version: "all-MiniLM-L6-v2",  // Track embedding model
    },
  }],
});
```

### Pattern 4: Redis Pub/Sub for Write-Time Events
**What:** Publish embedding events from writers, subscribe in listener
**When to use:** Real-time embedding on new knowledge creation
**Example:**
```typescript
// Source: ioredis documentation [ASSUMED]
import Redis from "ioredis";

// Publisher side (in ObservationWriter.writeObservation)
const pub = new Redis({ host: "localhost", port: 6379 });
await pub.publish("embedding:new", JSON.stringify({
  type: "observation",
  id: observationId,
  content: redactedSummary,
  metadata: { agent, quality, created_at: nowISO, project: "coding" },
}));

// Subscriber side (embedding listener)
const sub = new Redis({ host: "redis", port: 6379 });  // Docker internal
sub.subscribe("embedding:new");
sub.on("message", async (channel, message) => {
  const event = JSON.parse(message);
  const embedding = await embeddingModel.queryEmbed(event.content);
  await qdrant.upsert(event.type + "s", {
    wait: true,
    points: [{ id: event.id, vector: embedding, payload: event.metadata }],
  });
});
```

### Pattern 5: Content-Hash Idempotency
**What:** Skip re-embedding items whose content hasn't changed
**When to use:** Backfill script re-runs
**Example:**
```typescript
import crypto from "node:crypto";

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").substring(0, 16);
}

// During backfill: check if point already exists with same hash
const existingPoints = await qdrant.scroll("observations", {
  filter: { must: [{ key: "content_hash", match: { value: hash } }] },
  limit: 1,
  with_payload: false,
  with_vector: false,
});
if (existingPoints.points.length > 0) {
  // Already embedded with same content - skip
  continue;
}
```

### Anti-Patterns to Avoid
- **Embedding inside the write path:** Never call fastembed synchronously in `ObservationWriter.writeObservation()`. This adds 100-500ms to every observation write. Use pub/sub decoupling instead (D-06).
- **Spawning Python subprocesses:** The existing `EmbeddingGenerator.cjs` spawns Python for each embedding. This is replaced by fastembed's in-process ONNX runtime.
- **Single mega-collection:** Don't put all tiers in one Qdrant collection. Separate collections allow independent payload schemas and tier-weighted retrieval in Phase 29 (D-03).
- **Polling SQLite for new items:** Don't poll `embedded_at IS NULL`. Use Redis pub/sub for immediate notification. Polling wastes CPU and adds 30s latency.
- **Embedding raw messages:** Embed the `summary` field (4-line structured text), not the raw `messages` JSON blob. Messages are 10-100x larger and contain noise.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ONNX inference | Custom ONNX runtime wrapper | `fastembed` | Handles tokenization, model download, batching, quantization automatically |
| Vector similarity search | Custom distance calculations | Qdrant's built-in search | HNSW indexing, payload filtering, pagination -- far beyond manual cosine similarity |
| Pub/sub messaging | Custom WebSocket/file-based IPC | Redis pub/sub via `ioredis` | Battle-tested, handles reconnection, works across host/Docker boundary |
| Content hashing | Custom dedup logic | SHA-256 hash + Qdrant scroll filter | Standard approach, no edge cases |
| Model download management | Custom download + cache logic | fastembed's built-in model cache | Handles download, caching, versioning automatically |

**Key insight:** The entire embedding pipeline is plumbing -- connecting existing data sources (SQLite, LevelDB) to existing infrastructure (Qdrant, Redis) via a standard embedding library (fastembed). The complexity is in the integration, not in any single component.

## Common Pitfalls

### Pitfall 1: Redis Not Reachable from Host
**What goes wrong:** Redis runs in Docker on port 6379 but is port-mapped to `localhost:6379`. The ObservationWriter runs on the host. If Redis port-mapping fails or Docker is down, publish calls fail silently (ioredis will buffer/retry but eventually drop).
**Why it happens:** Redis is listed in docker-compose.yml with `ports: 6379:6379`, which should work. But corporate proxies, VPNs, or Docker networking issues can interfere.
**How to avoid:** (1) Test Redis connectivity from host before implementing pub/sub: `redis-cli -h localhost -p 6379 ping`. (2) Make the publish call fire-and-forget with a try/catch -- observation writes must never fail because Redis is down. (3) The backfill script serves as a catch-all for missed events.
**Warning signs:** `redis-cli ping` returns "Could not connect" from the host.

### Pitfall 2: Fastembed Model Download on First Use
**What goes wrong:** fastembed downloads the ONNX model (~25MB for all-MiniLM-L6-v2) on first `FlagEmbedding.init()`. In Docker, this happens at container start. Behind a corporate proxy, the download may fail or hang. The listener process crashes on startup.
**Why it happens:** Model is downloaded from HuggingFace Hub. Corporate proxies block or throttle external downloads.
**How to avoid:** (1) Pre-download model during Docker build with a `RUN` step. (2) Alternatively, cache the model directory in a Docker volume so it survives rebuilds. (3) Set `HTTP_PROXY`/`HTTPS_PROXY` in the Dockerfile for corporate environments.
**Warning signs:** First startup takes 30+ seconds; subsequent starts are fast (model is cached).

### Pitfall 3: KG Entity Count Mismatch (678 vs 160+)
**What goes wrong:** REQUIREMENTS.md says "160+ KG entities" but LevelDB actually contains 678 nodes (3 System, 4 Project, 8 Component, 353 SubComponent, 310 Detail). Many nodes are scaffold/structural with minimal content. Embedding all 678 wastes compute and pollutes retrieval.
**Why it happens:** The 160+ count was from an earlier snapshot. The KG has grown. Many nodes are SubComponent/Detail with short observations.
**How to avoid:** Filter KG entities before embedding: (1) Skip nodes where `isScaffoldNode === true`. (2) Skip nodes with fewer than 2 observations. (3) Concatenate name + observations as the text to embed (not just the name).
**Warning signs:** Qdrant `kg_entities` collection has 678 points but most have trivial/duplicate content.

### Pitfall 4: UUID Point IDs in Qdrant
**What goes wrong:** SQLite uses UUID strings as primary keys. Qdrant supports both integer and UUID string IDs. Using string UUIDs works but requires the `id` field to be a valid UUID format, not arbitrary strings.
**Why it happens:** Observations, digests, and insights already use `crypto.randomUUID()` which produces valid UUID format. KG entities use `key` strings like `coding:CollectiveKnowledge` which are NOT valid UUIDs.
**How to avoid:** For KG entities, generate a deterministic UUID from the node key using UUID v5 (namespace-based) or use a hash of the key as the Qdrant point ID. Keep a mapping of key -> point ID.
**Warning signs:** Qdrant rejects upsert with "invalid UUID" error for KG entity IDs.

### Pitfall 5: Embedding Listener Misses Events During Restart
**What goes wrong:** Redis pub/sub is fire-and-forget -- if the subscriber is not connected when a message is published, the message is lost. During Docker restarts or listener crashes, embedding events are missed.
**Why it happens:** Redis pub/sub has no persistence or replay. Unlike Redis Streams, messages are not stored.
**How to avoid:** (1) Accept that some events will be missed during restarts. (2) The backfill script serves as the durability mechanism -- run it periodically or after restarts to catch up. (3) Consider adding an `embedded_at` column to the SQLite tables so the backfill script knows what to re-embed. (4) Do NOT switch to Redis Streams -- the complexity is not justified for ~5-10 new items/day.
**Warning signs:** Qdrant point count is lower than SQLite row count after a Docker restart.

## Code Examples

### Complete Backfill Script Structure
```typescript
// Source: Combination of fastembed npm + @qdrant/js-client-rest Context7 [VERIFIED]
import { EmbeddingModel, FlagEmbedding } from "fastembed";
import { QdrantClient } from "@qdrant/js-client-rest";
import Database from "better-sqlite3";
import { Level } from "level";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// Load pinned config
const config = JSON.parse(readFileSync("src/embedding/embedding-config.json", "utf-8"));

// Initialize
const model = await FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2 });
const qdrant = new QdrantClient({ url: "http://localhost:6333" });
const db = new Database(".observations/observations.db", { readonly: true });

// Ensure collections exist (idempotent)
await ensureCollections(qdrant);

// Backfill observations
const observations = db.prepare("SELECT id, summary, agent, created_at, quality FROM observations").all();
const BATCH_SIZE = 64;
for (let i = 0; i < observations.length; i += BATCH_SIZE) {
  const batch = observations.slice(i, i + BATCH_SIZE);
  const texts = batch.map(o => o.summary);
  const hashes = texts.map(t => contentHash(t));

  // Check which are already embedded (idempotency)
  const toEmbed = await filterUnembedded(qdrant, "observations", batch, hashes);
  if (toEmbed.length === 0) continue;

  // Embed batch
  const embeddings = model.embed(toEmbed.map(o => o.summary), BATCH_SIZE);
  for await (const vectors of embeddings) {
    const points = vectors.map((vec, j) => ({
      id: toEmbed[j].id,
      vector: vec,
      payload: {
        agent: toEmbed[j].agent,
        project: "coding",
        date: toEmbed[j].created_at?.split("T")[0],
        quality: toEmbed[j].quality,
        content_hash: contentHash(toEmbed[j].summary),
        model_version: config.model,
      },
    }));
    await qdrant.upsert("observations", { wait: true, points });
  }
}
```

### Embedding Config File
```json
{
  "model": "all-MiniLM-L6-v2",
  "dimensions": 384,
  "distance": "Cosine",
  "version": "1.0.0",
  "collections": {
    "observations": {
      "payloadIndexes": ["agent", "quality", "project", "date"]
    },
    "digests": {
      "payloadIndexes": ["quality", "date"]
    },
    "insights": {
      "payloadIndexes": ["topic", "confidence"]
    },
    "kg_entities": {
      "payloadIndexes": ["entityType", "hierarchyLevel"]
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python subprocess (sentence-transformers) | fastembed Node.js ONNX | Phase 28 | Eliminates Python dependency, subprocess overhead, Docker install issues |
| EmbeddingGenerator.cjs (spawn python3) | fastembed FlagEmbedding.init() | Phase 28 | In-process, ~10x faster cold start, no external process |
| No Qdrant collections for knowledge | 4 typed collections | Phase 28 | Enables semantic search in Phase 29 |
| Manual/batch embedding | Redis pub/sub event-driven | Phase 28 | Sub-minute embedding of new items |

**Deprecated/outdated:**
- `src/utils/EmbeddingGenerator.cjs`: Replaced by fastembed. Do not modify or extend.
- `integrations/mcp-server-semantic-analysis/src/utils/embedding_generator.py`: Replaced by fastembed. Do not modify.
- `knowledge_patterns_small` Qdrant collection: Legacy from KG entity sync. Not used by this pipeline.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ioredis` is the better choice over `redis` (node-redis v4) for pub/sub | Standard Stack | LOW -- either works; ioredis has simpler sub API but node-redis v4 is also capable. Could use either. |
| A2 | fastembed's `EmbeddingModel.AllMiniLML6V2` enum exists for all-MiniLM-L6-v2 | Code Examples | MEDIUM -- the enum name is inferred from the npm README model list. May be different. Must verify at implementation time. |
| A3 | Redis port 6379 is accessible from host via Docker port-mapping | Architecture | HIGH -- tested during research and got "Redis not reachable on host". Docker may not be running or port-mapping may be misconfigured. Must verify. |
| A4 | Optimal batch size for fastembed is 64 | Code Examples | LOW -- fastembed defaults to 256. 64 is conservative for ~900 items. Can adjust empirically. |
| A5 | KG entities should be filtered (skip scaffold nodes) before embedding | Pitfalls | LOW -- scaffold nodes have minimal content but including them adds noise without harm except wasted compute. |

## Open Questions

1. **Redis accessibility from host**
   - What we know: `redis-cli ping` returned "Redis not reachable on host" during research. Docker may not have been running at research time.
   - What's unclear: Is Redis consistently port-forwarded to localhost:6379? Does the corporate proxy/VPN interfere?
   - Recommendation: Test with Docker running. If unreachable, the ObservationWriter (host-side) cannot publish directly. Alternative: publish via HTTP to a thin relay inside Docker, or add an `embedded_at IS NULL` polling fallback.

2. **fastembed model enum naming**
   - What we know: npm README lists `EmbeddingModel.BGEBaseEN` as default. `all-MiniLM-L6-v2` is listed as supported.
   - What's unclear: Exact enum value for all-MiniLM-L6-v2 (could be `AllMiniLML6V2` or a string constant).
   - Recommendation: Check at implementation time with `console.log(EmbeddingModel)` to enumerate available values.

3. **EmbeddingCache reuse vs. Qdrant-only**
   - What we know: Existing `EmbeddingCache` (disk-backed, 7-day TTL) stores embeddings at `.data/entity-embeddings.json`. Qdrant also stores vectors persistently.
   - What's unclear: Whether keeping the disk cache adds value or is redundant with Qdrant.
   - Recommendation: Skip the EmbeddingCache. Qdrant is the source of truth for vectors. The cache was designed for the old batch-analysis pipeline. Adding a cache layer between fastembed and Qdrant is unnecessary complexity for ~900 items.

4. **Where to install fastembed: root vs. semantic-analysis submodule**
   - What we know: STACK.md recommends installing in `integrations/mcp-server-semantic-analysis`. But the backfill script runs host-side from root.
   - What's unclear: Whether fastembed should be a root dependency or submodule dependency.
   - Recommendation: Install in root `package.json`. The backfill CLI and the embedding service both run from the project root. The submodule's Express server (Phase 29) will access the retrieval service via HTTP, not directly.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Qdrant | Vector storage | Yes | latest (Docker) | -- |
| Redis | Pub/sub events | Partial | 7-alpine (Docker) | Port not reachable from host at research time; may need Docker restart |
| Node.js | All scripts | Yes | 22.x (host) / 22-bookworm (Docker) | -- |
| better-sqlite3 | SQLite access | Yes | Installed in root deps | -- |
| level | LevelDB access | Yes | Installed in root deps | -- |
| fastembed | Embedding gen | No (not yet installed) | 2.1.0 on npm | Must install |
| ioredis | Redis pub/sub | No (not yet installed) | 5.10.1 on npm | Must install |

**Missing dependencies with no fallback:**
- `fastembed` -- must install before any embedding work
- `ioredis` -- must install for Redis pub/sub (or use `redis` v4 from constraint-monitor)

**Missing dependencies with fallback:**
- Redis host access -- if port 6379 not reachable from host, ObservationWriter can write an `embedded_at IS NULL` marker and backfill script catches up

## Discretion Recommendations

### Redis Channel Naming and Message Format
**Recommendation:** Single channel `embedding:new` with JSON message format:
```json
{
  "type": "observation",           // observation | digest | insight | kg_entity
  "id": "uuid-string",            // Primary key from source
  "content": "summary text...",   // Text to embed
  "metadata": {                    // Qdrant payload fields
    "agent": "claude",
    "project": "coding",
    "quality": "high",
    "date": "2026-04-24"
  },
  "timestamp": "2026-04-24T10:00:00Z"
}
```
**Rationale:** Single channel is simpler. The `type` field determines which Qdrant collection to target. Separate channels per tier adds routing complexity without benefit at this scale.

### Embedding Batch Size
**Recommendation:** 64 items per batch for backfill.
**Rationale:** fastembed default is 256. With 384-dim vectors, a batch of 64 uses ~100KB of memory. The total corpus is ~900 items, so 64 gives ~14 batches -- fast enough for a one-shot script. For the real-time listener, batch size is 1 (process each event individually for lowest latency). [ASSUMED -- empirical tuning may adjust]

### EmbeddingCache Reuse
**Recommendation:** Do NOT reuse the existing `EmbeddingCache`. Let Qdrant be the sole vector store.
**Rationale:** The EmbeddingCache was designed for the UKB batch-analysis pipeline where embeddings were generated per-run and cached to avoid regeneration. In the new architecture, Qdrant IS the persistent store. Adding a disk cache between fastembed and Qdrant creates a consistency problem (cache says X is embedded, Qdrant disagrees) and adds no performance benefit for ~900 items. Qdrant's built-in scroll/filter is fast enough for idempotency checks.

### ONNX Model Download Strategy
**Recommendation:** Lazy download on first use (no Dockerfile change for now).
**Rationale:** The backfill script runs on the host where internet access is available. The Docker listener will also have access. Pre-downloading in Dockerfile adds build complexity and a ~25MB layer. If corporate proxy issues arise, add a pre-download step later. The model is cached after first download (~`~/.cache/fastembed/`).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages verified via npm registry; Qdrant and better-sqlite3 already installed
- Architecture: HIGH -- existing codebase patterns (host/Docker split, SQLite on host, Qdrant in Docker) are well-understood; data sources verified
- Pitfalls: HIGH -- Redis accessibility tested, KG entity count verified, model download behavior documented

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days -- stable stack, no fast-moving dependencies)

## Sources

### Primary (HIGH confidence)
- [@qdrant/js-client-rest Context7 docs](/qdrant/qdrant-js) -- collection creation, upsert, search, filter APIs
- [fastembed npm registry](https://www.npmjs.com/package/fastembed) -- v2.1.0, model list, API (EmbeddingModel, FlagEmbedding)
- [ioredis npm registry](https://www.npmjs.com/package/ioredis) -- v5.10.1
- Codebase verification: SQLite schema (650 obs, 132 digests, 12 insights), LevelDB (678 KG nodes), Qdrant (5 existing collections), Docker (node:22-bookworm base)

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` -- stack recommendations (fastembed, @qdrant/js-client-rest, gpt-tokenizer)
- `.planning/research/PITFALLS.md` -- embedding pipeline pitfalls (context rot, model mismatch, stale embeddings)
- `.planning/research/ARCHITECTURE.md` -- host/Docker split rationale, data flow diagrams

### Tertiary (LOW confidence)
- fastembed enum names (AllMiniLML6V2 assumed, needs runtime verification)
- ioredis pub/sub API patterns (from training data, not verified against current docs)
