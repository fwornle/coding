# Phase 28: Embedding Pipeline - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 6 new files to create
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/embedding/embedding-config.json` | config | — | `integrations/mcp-server-semantic-analysis/config/` (bind-mounted JSON configs) | role-match |
| `src/embedding/embedding-service.ts` | service | request-response | `scripts/fast-embedding-generator.js` | role-match |
| `src/embedding/qdrant-collections.ts` | utility | CRUD | `scripts/index-ontology-to-qdrant.js` lines 76-192 | exact |
| `src/embedding/content-hash.ts` | utility | transform | `src/utils/EmbeddingGenerator.cjs` lines 357-359 | role-match |
| `src/embedding/backfill.ts` | utility (CLI) | batch | `scripts/backfill-raw-observations.js` + `scripts/sync-graph-to-qdrant.js` | role-match |
| `src/embedding/listener.ts` | service | event-driven | No Redis pub/sub listener exists yet — see No Analog section |
| `docker/supervisord.conf` (modify) | config | — | `docker/supervisord.conf` lines 25-44 (`[program:semantic-analysis]`) | exact |
| `src/live-logging/ObservationWriter.js` (modify) | service | request-response | `src/live-logging/ObservationWriter.js` itself | self-reference |

---

## Pattern Assignments

### `src/embedding/embedding-config.json` (config)

**Analog:** `integrations/mcp-server-semantic-analysis/config/` (bind-mounted JSON config pattern) and the shape defined in RESEARCH.md

**Config shape to copy directly from RESEARCH.md** (no existing analog — use RESEARCH.md pattern):
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

**Bind-mount pattern** (from `docker/docker-compose.yml` lines 77-78):
```yaml
# Config files (live-mounted to avoid staleness)
- ${CODING_REPO:-.}/integrations/mcp-server-semantic-analysis/config:/coding/integrations/mcp-server-semantic-analysis/config:rw
```
Bind-mount `src/embedding/embedding-config.json` the same way so Docker listener reads the same file.

---

### `src/embedding/embedding-service.ts` (service, request-response)

**Analog:** `scripts/fast-embedding-generator.js`

**Imports pattern** (`scripts/fast-embedding-generator.js` lines 12-13):
```javascript
import { pipeline } from '@xenova/transformers';
```
Replace with fastembed equivalent:
```typescript
import { EmbeddingModel, FlagEmbedding } from "fastembed";
import { readFileSync } from "node:fs";
```

**Singleton + lazy-init pattern** (`scripts/fast-embedding-generator.js` lines 14-48):
```javascript
class FastEmbeddingGenerator {
  constructor() {
    this.extractor = null;
    this.initPromise = null;
  }

  async initialize() {
    if (this.extractor) return this.extractor;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      // one-time init
      this.extractor = await pipeline('feature-extraction', this.modelName, { ... });
      return this.extractor;
    })();
    return this.initPromise;
  }
}

let instance = null;
export function getFastEmbeddingGenerator() {
  if (!instance) instance = new FastEmbeddingGenerator();
  return instance;
}
```
Apply identical singleton + guarded-init pattern but with `FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2 })`.

**Single embed method** (`scripts/fast-embedding-generator.js` lines 56-66):
```javascript
async generate(text) {
  await this.initialize();
  const output = await this.extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
```
Replace with fastembed's `queryEmbed(text)` (returns `number[]` directly, no pooling step needed).

**Batch embed method** (`scripts/fast-embedding-generator.js` lines 70-81):
```javascript
async generateBatch(texts) {
  await this.initialize();
  const results = await Promise.all(texts.map(text => this.generate(text)));
  return results;
}
```
Replace with fastembed's async generator: `model.embed(texts, batchSize)` — iterate with `for await`.

**TypeScript conventions** (project-wide, CLAUDE.md): strict mode, ESM (`"type": "module"` in `package.json`). Use `.ts` extension and `import` statements.

---

### `src/embedding/qdrant-collections.ts` (utility, CRUD)

**Analog:** `scripts/index-ontology-to-qdrant.js`

**Client init pattern** (`scripts/index-ontology-to-qdrant.js` lines 12, 17-19, 80-92):
```javascript
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_HOST = process.env.QDRANT_HOST || 'localhost';
const QDRANT_PORT = parseInt(process.env.QDRANT_PORT || '6333');
const VECTOR_SIZE = 384;

const qdrant = new QdrantClient({
  url: `http://${QDRANT_HOST}:${QDRANT_PORT}`,
});

// Check Qdrant availability (fail fast with clear error)
try {
  await qdrant.getCollections();
  console.log(`Connected to Qdrant at ${QDRANT_HOST}:${QDRANT_PORT}`);
} catch (error) {
  console.error('Failed to connect to Qdrant:', error.message);
  console.error('  Make sure Qdrant is running: docker-compose up -d qdrant');
  process.exit(1);
}
```
**Note:** In Docker listener, use `process.env.QDRANT_URL` (`http://qdrant:6333`) instead of localhost.

**Idempotent collection creation pattern** (`scripts/index-ontology-to-qdrant.js` lines 171-192):
```javascript
async function createCollection(qdrant, collectionName) {
  try {
    await qdrant.getCollection(collectionName);
    // exists — skip or recreate
  } catch (error) {
    // does not exist — create
  }
  await qdrant.createCollection(collectionName, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
}
```
For Phase 28, prefer **skip-if-exists** (not recreate) since backfill is idempotent via content hash:
```typescript
const collections = await qdrant.getCollections();
const exists = collections.collections.some(c => c.name === name);
if (!exists) {
  await qdrant.createCollection(name, { vectors: { size: 384, distance: "Cosine" } });
  await qdrant.createPayloadIndex(name, { field_name: "agent", field_schema: "keyword" });
  // ... other payload indexes from embedding-config.json
}
```

**Upsert pattern** (`scripts/index-ontology-to-qdrant.js` lines 135-140):
```javascript
await qdrant.upsert(collectionName, {
  wait: true,
  points,
});
```
Always use `wait: true` for backfill (confirms persistence). For real-time listener, `wait: false` reduces latency.

---

### `src/embedding/content-hash.ts` (utility, transform)

**Analog:** `src/utils/EmbeddingGenerator.cjs` (cache key generation, lines 356-359)

**Hash pattern** (`src/utils/EmbeddingGenerator.cjs` lines 356-359):
```javascript
getCacheKey(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
```
Adapt as exported function with truncation for use as Qdrant payload field:
```typescript
import crypto from "node:crypto";

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").substring(0, 16);
}
```

**Import style:** Use `node:crypto` prefix (Node.js built-in convention used in `src/live-logging/ObservationWriter.js` line 12):
```javascript
import crypto from 'node:crypto';
```

---

### `src/embedding/backfill.ts` (CLI, batch)

**Analog 1:** `scripts/backfill-raw-observations.js` (SQLite + batch loop pattern)
**Analog 2:** `scripts/sync-graph-to-qdrant.js` (structured CLI with init/teardown pattern)

**CLI shebang + arg parsing** (`scripts/sync-graph-to-qdrant.js` lines 1-49):
```javascript
#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const options = { dryRun: false, batchSize: 64 };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') options.dryRun = true;
  if (args[i] === '--batch-size' && args[i+1]) { options.batchSize = parseInt(args[i+1]); i++; }
}
```

**SQLite read pattern** (`scripts/backfill-raw-observations.js` lines 6-23):
```javascript
import Database from 'better-sqlite3';

const db = new Database(DB_PATH);  // readonly for backfill
const rows = db.prepare(`
  SELECT id, summary, agent, created_at, quality FROM observations
`).all();
```
Add `readonly: true` option for backfill safety: `new Database(DB_PATH, { readonly: true })`.

**Batch-loop with progress reporting** (`scripts/backfill-raw-observations.js` lines 26-116):
```javascript
let success = 0, failed = 0, skipped = 0;

for (let i = 0; i < rows.length; i++) {
  const obs = rows[i];
  // ... process each
  process.stderr.write(`  [${i+1}/${rows.length}] OK: ${obs.id}\n`);
  success++;
}

process.stderr.write(`\nDone: ${success} updated, ${failed} failed, ${skipped} skipped\n`);
db.close();
```

**init/teardown wrapper** (`scripts/sync-graph-to-qdrant.js` lines 52-252):
```javascript
async function main() {
  let db = null;
  try {
    db = new Database(DB_PATH, { readonly: true });
    // ... work ...
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  } finally {
    if (db) db.close();
  }
}
main().catch(error => { console.error('Fatal:', error); process.exit(1); });
```

**LevelDB read pattern** (`scripts/sync-graph-to-qdrant.js` lines 71-78 for path convention; use `Level` from `level` package):
```typescript
import { Level } from "level";

const kgDb = new Level("/Users/Q284340/Agentic/coding/.data/knowledge-graph", {
  valueEncoding: "json",
});
// Iterate all keys:
for await (const [key, value] of kgDb.iterator()) {
  // filter scaffold nodes, build text, embed
}
await kgDb.close();
```

**Error handling:** Use `process.stderr.write()` for all diagnostic output (not `console.log`) — matches `src/live-logging/ObservationWriter.js` lines 124, 130.

---

### `src/embedding/listener.ts` (service, event-driven)

**Analog:** No exact match in codebase. Closest structural patterns:

- **Process startup / keep-alive:** `scripts/health-verifier.js` lines 64-80 (class extending EventEmitter, long-running daemon)
- **Error-resilient loop:** `scripts/backfill-raw-observations.js` lines 74-111 (try/catch per item, continue on failure)
- **Logging style:** `src/live-logging/ObservationWriter.js` lines 124, 130 (`process.stderr.write`)

**Inferred listener structure from RESEARCH.md patterns:**
```typescript
import Redis from "ioredis";
import { QdrantClient } from "@qdrant/js-client-rest";
import { getEmbeddingService } from "./embedding-service.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

const sub = new Redis(REDIS_URL);
const qdrant = new QdrantClient({ url: QDRANT_URL });
const embedder = await getEmbeddingService();

sub.subscribe("embedding:new", (err) => {
  if (err) {
    process.stderr.write(`[EmbeddingListener] Subscribe error: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write("[EmbeddingListener] Subscribed to embedding:new\n");
});

sub.on("message", async (channel, message) => {
  try {
    const event = JSON.parse(message);
    const vector = await embedder.embedOne(event.content);
    await qdrant.upsert(`${event.type}s`, {
      wait: false,
      points: [{ id: event.id, vector, payload: event.metadata }],
    });
  } catch (err) {
    process.stderr.write(`[EmbeddingListener] Failed to embed: ${err.message}\n`);
    // Do not crash — next event will be processed
  }
});
```

**See "No Analog Found" section below for full notes.**

---

### `docker/supervisord.conf` (modify — add new program block)

**Analog:** `docker/supervisord.conf` lines 25-44 (`[program:semantic-analysis]`) — exact match for the pattern to copy.

**Program block to copy and adapt** (`docker/supervisord.conf` lines 25-44):
```ini
[program:semantic-analysis]
command=node /coding/integrations/mcp-server-semantic-analysis/dist/sse-server.js
directory=/coding/integrations/mcp-server-semantic-analysis
environment=
    CODING_ROOT="/coding",
    SEMANTIC_ANALYSIS_PORT="%(ENV_SEMANTIC_ANALYSIS_PORT)s",
    QDRANT_URL="%(ENV_QDRANT_URL)s",
    ANTHROPIC_API_KEY="%(ENV_ANTHROPIC_API_KEY)s"
autostart=true
autorestart=true
startsecs=5
startretries=3
stopwaitsecs=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=100
```
New block for embedding listener:
```ini
[program:embedding-listener]
command=node /coding/src/embedding/listener.js
directory=/coding
environment=
    QDRANT_URL="%(ENV_QDRANT_URL)s",
    REDIS_URL="%(ENV_REDIS_URL)s",
    HTTP_PROXY="",
    HTTPS_PROXY="",
    http_proxy="",
    https_proxy=""
autostart=true
autorestart=true
startsecs=10
startretries=3
stopwaitsecs=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=150
```
Note `HTTP_PROXY=""` cleared (same as `constraint-monitor` at lines 70-73) to prevent proxy interference with Qdrant/Redis connections inside Docker.

---

### `src/live-logging/ObservationWriter.js` (modify — add Redis publish)

**File is its own reference.** Hook point is after successful SQLite write.

**Write-lock and dedup pattern** (`src/live-logging/ObservationWriter.js` lines 62-67):
```javascript
/** Write lock: serializes DB writes so concurrent fire-and-forget calls
 *  don't race past the semantic dedup check (TOCTOU prevention) */
this._writeLock = Promise.resolve();
```
Add the Redis publisher initialization similarly — hold as `this._redisPub` and initialize lazily (do not block constructor).

**Error isolation pattern** (`src/live-logging/ObservationWriter.js` lines 120-128):
```javascript
try {
  this._redactor = new ConfigurableRedactor({ ... });
  await this._redactor.initialize();
  process.stderr.write(`[ObservationWriter] Redactor initialized ...\n`);
} catch (err) {
  process.stderr.write(`[ObservationWriter] Redactor init failed ...: ${err.message}\n`);
  this._redactor = null;
}
```
Apply identical try/catch pattern for Redis publisher init — if Redis is unreachable, set `this._redisPub = null` and continue. Observation writes must never fail because Redis is down.

**Fire-and-forget publish** (to add after the SQLite insert succeeds):
```javascript
// Fire-and-forget: never block the write path on Redis
if (this._redisPub) {
  this._redisPub.publish("embedding:new", JSON.stringify({
    type: "observation",
    id: obs.id,
    content: obs.summary,
    metadata: { agent: obs.agent, quality: obs.quality, date: obs.created_at?.slice(0, 10), project: "coding" },
    timestamp: new Date().toISOString(),
  })).catch(err => {
    process.stderr.write(`[ObservationWriter] Redis publish failed (non-fatal): ${err.message}\n`);
  });
}
```

---

## Shared Patterns

### TypeScript / ESM File Style
**Source:** `src/live-logging/ObservationWriter.js` lines 11-16, `scripts/backfill-raw-observations.js` lines 6-11
**Apply to:** All new `.ts` files in `src/embedding/`

```javascript
// ESM imports with node: prefix for builtins
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```
All new TS files compile to ESM (root `package.json` has `"type": "module"`). Use `import` not `require`.

### Stderr Logging
**Source:** `src/live-logging/ObservationWriter.js` lines 124, 130-131
**Apply to:** All new files in `src/embedding/`

```javascript
process.stderr.write(`[ComponentName] Message here\n`);
```
Never use `console.log` in `.ts`/`.js` files (constraint `no-console-log` will fire). Use `process.stderr.write()` with bracketed component prefix.

### Qdrant Client Initialization
**Source:** `scripts/index-ontology-to-qdrant.js` lines 12, 17-19, 80-87
**Apply to:** `qdrant-collections.ts`, `backfill.ts`, `listener.ts`

```typescript
import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const qdrant = new QdrantClient({ url: QDRANT_URL });
```
In Docker context use `QDRANT_URL=http://qdrant:6333` (from `docker-compose.yml` line 32). On host use `http://localhost:6333`.

### Error Isolation for Optional Services
**Source:** `src/live-logging/ObservationWriter.js` lines 118-128
**Apply to:** `listener.ts` (Redis connection), `ObservationWriter.js` modification (Redis publisher)

Pattern: wrap optional-dependency initialization in try/catch, set to null on failure, check for null before use, never throw to caller.

### CLI Script Structure
**Source:** `scripts/backfill-raw-observations.js` lines 1-119, `scripts/sync-graph-to-qdrant.js` lines 1-252
**Apply to:** `backfill.ts`

Structure: parse args → initialize services → run batch loop with per-item try/catch → report counts → close resources in `finally`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/embedding/listener.ts` | service | event-driven (Redis pub/sub) | No existing Redis pub/sub subscriber anywhere in the codebase. The constraint-monitor has `node-redis` in its deps but the code does not use pub/sub. The closest structural analog is the long-running daemon pattern from `scripts/health-verifier.js`. Planner should use RESEARCH.md Pattern 4 (Redis pub/sub) as the primary reference for this file. |

---

## Metadata

**Analog search scope:** `src/`, `scripts/`, `integrations/mcp-server-semantic-analysis/src/`, `docker/`
**Files scanned:** 12 files read in full or in targeted sections
**Pattern extraction date:** 2026-04-24

**Key notes for planner:**
- Root `package.json` is `"type": "module"` — all new `.ts` files compile to ESM, no CommonJS
- `@qdrant/js-client-rest` is already installed (root `package.json` line 23); `fastembed` and `ioredis` must be added
- Redis is at `redis://redis:6379` inside Docker, `redis://localhost:6379` from host (port-mapped in `docker-compose.yml` line 143)
- The `no-console-log` constraint fires on `.ts`/`.js` edits — use `process.stderr.write()` throughout
- `better-sqlite3` and `level` are already installed in root deps; use them directly without re-installing
- Supervisord `priority=150` for embedding listener places it after MCP servers (100) but before health-verifier (200) — listener depends on Qdrant and Redis being up first
