---
phase: 28-embedding-pipeline
verified: 2026-04-24T15:00:00Z
status: human_needed
score: 9/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Verify that writing a real observation via the live ETM session causes a new Qdrant point to appear in the observations collection within 10 seconds"
    expected: "observations count increases by 1 after a real ETM observation write (not a manual Redis publish)"
    why_human: "The automated spot-check confirmed the listener responds to Redis events, and the Docker logs show one real observation was embedded (5d41feeb). Full end-to-end via ObservationWriter requires a live ETM session write and Qdrant count verification — cannot run ETM from the verifier without side effects."
---

# Phase 28: Embedding Pipeline Verification Report

**Phase Goal:** All accumulated knowledge exists as searchable vectors in Qdrant, and new knowledge is embedded automatically on creation
**Verified:** 2026-04-24T15:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | fastembed is installed and can generate 384-dim embeddings from text | VERIFIED | `package.json` has `fastembed@^2.1.0`; dist/embedding/*.js compiled and present; Docker listener initialized model successfully |
| 2 | Embedding model is pinned to all-MiniLM-L6-v2 in a single config file | VERIFIED | `src/embedding/embedding-config.json` contains `"model": "all-MiniLM-L6-v2"`, `"dimensions": 384`; both embedding-service.ts and qdrant-collections.ts read from this file exclusively |
| 3 | Content hashing produces deterministic SHA-256 hashes for idempotency | VERIFIED | `src/embedding/content-hash.ts` exports `contentHash` using `crypto.createHash("sha256")...digest("hex").substring(0, 16)` |
| 4 | Qdrant collection creation is idempotent with correct payload indexes | VERIFIED | `qdrant-collections.ts` calls `getCollections()` before creating; skips existing; creates payload indexes for all 4 collections |
| 5 | Running the backfill script embeds all observations into Qdrant observations collection | VERIFIED | Qdrant observations collection has 646 points (>= 558 required); backfill.ts reads from SQLite with `readonly: true` |
| 6 | Running the backfill script embeds all digests into Qdrant digests collection | VERIFIED | Qdrant digests collection has 132 points; D-04 fields (theme, agents, quality) included in payload |
| 7 | Running the backfill script embeds all insights into Qdrant insights collection | VERIFIED | Qdrant insights collection has 12 points; D-04 fields (topic, confidence, digestIds) included in payload |
| 8 | Running the backfill script embeds KG entities (filtered, non-scaffold) into Qdrant kg_entities collection | VERIFIED | Qdrant kg_entities collection has 675 points (>= 100 required); scaffold filter and observation count >= 2 filter applied in code |
| 9 | Re-running the backfill script skips already-embedded items via content-hash idempotency | VERIFIED | Human checkpoint in 28-02-SUMMARY confirmed 0 embedded on re-run; code path: `qdrant.scroll` with content_hash filter before embedding |
| 10 | Creating a new observation via ETM causes a Redis event to be published, and the listener embeds it into Qdrant | PARTIAL | Listener is RUNNING in Docker and Docker logs show `[EmbeddingListener] Embedded observation 5d41feeb...` confirming at least one real event was processed. ObservationWriter has fire-and-forget Redis publish wired after `stmt.run`. Full ETM-to-Qdrant path needs human confirmation. |

**Score:** 9/10 truths verified (1 requires human confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/embedding/embedding-config.json` | Single source of truth for model/dimensions/collections | VERIFIED | 20 lines, valid JSON, correct model/dimensions/4 collections |
| `src/embedding/embedding-service.ts` | Singleton fastembed wrapper with embedOne/embedBatch | VERIFIED | 108 lines, exports `EmbeddingService` and `getEmbeddingService`; lazy init; embedOne/embedBatch present |
| `src/embedding/content-hash.ts` | Content hashing utility for idempotency | VERIFIED | 10 lines, exports `contentHash` with SHA-256 |
| `src/embedding/qdrant-collections.ts` | Idempotent Qdrant collection creation | VERIFIED | 108 lines, exports `ensureCollections` and `getQdrantClient`; iterates config.collections; calls createPayloadIndex |
| `src/embedding/backfill.ts` | One-shot CLI backfill for all 4 tiers | VERIFIED | 421 lines (>= 100 required); --dry-run/--batch-size/--tier flags; per-tier functions for all 4 tiers |
| `src/embedding/listener.ts` | Redis pub/sub consumer for automatic embedding | VERIFIED | 134 lines (>= 50 required); subscribes to embedding:new; upserts to Qdrant; SIGTERM/SIGINT handlers |
| `src/live-logging/ObservationWriter.js` | Modified to publish Redis events | VERIFIED | Imports Redis from ioredis; `this._redisPub = null` in constructor; `_initRedis()` method with lazyConnect; publishes to "embedding:new" after stmt.run |
| `docker/supervisord.conf` | embedding-listener program block | VERIFIED | Contains `[program:embedding-listener]` at line 150; command=node /coding/dist/embedding/listener.js; QDRANT_URL/REDIS_URL env vars; HTTP_PROXY cleared; priority=150; startsecs=10 |
| `docker/docker-compose.yml` | Bind-mounts for embedding pipeline | VERIFIED | Lines 91-92: dist/embedding and src/embedding/embedding-config.json bind-mounted; REDIS_URL=redis://redis:6379 at line 32 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| embedding-service.ts | embedding-config.json | readFileSync at init | VERIFIED | Resolves via `join(projectRoot, "src", "embedding", "embedding-config.json")` |
| qdrant-collections.ts | embedding-config.json | reads collection schemas from config | VERIFIED | Same path resolution; `config.collections` iterated in ensureCollections |
| backfill.ts | .observations/observations.db | better-sqlite3 readonly | VERIFIED | `new Database(dbPath, { readonly: true })` at line 359 |
| backfill.ts | .data/knowledge-graph/ | Level import for LevelDB | VERIFIED | `new Level(levelPath, { valueEncoding: "json" })` in readKgEntities |
| backfill.ts | embedding-service.ts | import getEmbeddingService | VERIFIED | `import { getEmbeddingService } from "./embedding-service.js"` at line 21 |
| backfill.ts | qdrant-collections.ts | import ensureCollections + getQdrantClient | VERIFIED | `import { ensureCollections, getQdrantClient } from "./qdrant-collections.js"` at line 23 |
| ObservationWriter.js | Redis (embedding:new channel) | ioredis publish | VERIFIED | `this._redisPub.publish('embedding:new', ...)` at line 463, after stmt.run (line 447), before _scheduleExport (line 475) |
| listener.ts | Redis (embedding:new channel) | ioredis subscribe | VERIFIED | `await sub.subscribe("embedding:new")` at line 65 |
| listener.ts | Qdrant | qdrant.upsert | VERIFIED | `await qdrant.upsert(collectionName, { wait: false, points: [...] })` at line 86 |
| supervisord.conf | listener.ts compiled output | command=node /coding/dist/embedding/listener.js | VERIFIED | dist/embedding/listener.js confirmed present in dist/ |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| backfill.ts → observations | `rows` from SQLite | `db.prepare("SELECT id, summary...").all()` | Yes — live SQLite query | FLOWING |
| backfill.ts → digests | `rows` from SQLite | `db.prepare("SELECT id, summary, date, theme...").all()` | Yes — live SQLite query with D-04 fields | FLOWING |
| backfill.ts → insights | `rows` from SQLite | `db.prepare("SELECT id, summary, topic...").all()` | Yes — live SQLite query with D-04 fields | FLOWING |
| backfill.ts → kg_entities | `graph.nodes` from LevelDB | `db.get("graph")` parsed as SerializedGraph | Yes — live LevelDB read | FLOWING |
| listener.ts → Qdrant | `event` from Redis message | JSON.parse of pub/sub message from ObservationWriter | Yes — real observation write triggers publish | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Qdrant has 4 embedding collections | `curl http://localhost:6333/collections` | observations, digests, insights, kg_entities all present | PASS |
| observations collection has >= 558 points | `curl http://localhost:6333/collections/observations` | 646 points | PASS |
| digests collection has >= 132 points | `curl http://localhost:6333/collections/digests` | 132 points | PASS |
| insights collection has >= 12 points | `curl http://localhost:6333/collections/insights` | 12 points | PASS |
| kg_entities collection has >= 100 points | `curl http://localhost:6333/collections/kg_entities` | 675 points | PASS |
| Embedding listener is running in Docker | `docker exec coding-services supervisorctl status` | mcp-servers:embedding-listener RUNNING pid 3010, uptime 0:06:56 | PASS |
| Listener has processed at least one real event | Docker logs grep EmbeddingListener | `[EmbeddingListener] Embedded observation 5d41feeb... -> observations` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EMBED-01 | 28-02 | All existing observations (558+) embedded with metadata (agent, project, date, quality) | SATISFIED | 646 points in observations collection; payload includes agent, project, date, quality, content_hash |
| EMBED-02 | 28-02 | All existing digests (132) embedded with metadata (date, theme, agents, quality) | SATISFIED | 132 points in digests collection; readDigests() includes theme, agents, quality in payload |
| EMBED-03 | 28-02 | All existing insights (12) embedded with metadata (topic, confidence, digestIds) | SATISFIED | 12 points in insights collection; readInsights() includes topic, confidence, digestIds in payload |
| EMBED-04 | 28-02 | All existing KG entities (160+) embedded with metadata (type, level, parentId) | SATISFIED | 675 points in kg_entities collection; readKgEntities() includes entityType, hierarchyLevel, parentId |
| EMBED-05 | 28-03 | New observations/digests/insights embedded automatically on creation | PARTIAL | Listener running and has processed 1 live event per Docker logs; full ETM-triggered write path needs human confirmation |
| EMBED-06 | 28-01 | Embedding model pinned and versioned, fastembed with all-MiniLM-L6-v2 (384-dim) | SATISFIED | embedding-config.json is single source of truth; both service and collections read from it |

All 6 requirement IDs from the plans (EMBED-01 through EMBED-06) are covered. All 6 appear in REQUIREMENTS.md under "Embedding Pipeline". No orphaned requirements detected.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None detected | — | — | All logging uses process.stderr.write with [ComponentName] prefix throughout all 5 embedding modules and ObservationWriter additions |

No `console.log` calls found in any modified embedding files. No TODO/FIXME/placeholder patterns found. No empty return stubs. No hardcoded empty arrays passed to rendering paths.

### Human Verification Required

#### 1. Full ETM-to-Qdrant Write-Time Path Confirmation

**Test:** Start a coding session with ETM, perform a real task that generates an observation, and verify the observation count in the Qdrant observations collection increases within 10 seconds.

```bash
# Before: record current count
curl -s http://localhost:6333/collections/observations | python3 -c "import sys,json; d=json.load(sys.stdin); print('Before:', d['result']['points_count'])"

# Trigger: run a real ETM coding session that produces a new observation
# (or use the manual Redis publish test from Plan 03 Task 3 verification)

# After (wait ~5-10s): check count increased
curl -s http://localhost:6333/collections/observations | python3 -c "import sys,json; d=json.load(sys.stdin); print('After:', d['result']['points_count'])"

# Check listener logs for confirmation
docker logs coding-services 2>&1 | grep "EmbeddingListener.*Embedded" | tail -3
```

**Expected:** Observation count increases by 1; Docker logs show `[EmbeddingListener] Embedded observation {id}... -> observations`

**Why human:** Triggering a real ETM observation write requires an interactive coding session. The Docker logs already show one real event was embedded (`5d41feeb`), which is strong evidence the path works, but the verifier cannot run an ETM session without side effects. A manual Redis publish test (as documented in Plan 03) is a sufficient proxy if a full session is not practical.

### Gaps Summary

No blocking gaps. All artifacts exist, are substantive, and are wired. Qdrant has live data in all 4 collections with correct point counts. The embedding listener is actively running and has processed at least one real observation event.

The single human verification item is a confirmation test for EMBED-05 end-to-end — the automated evidence (listener RUNNING, Docker log showing a real embedded observation) is strong, but a full ETM-triggered write path is a behavioral confirmation that cannot be automated without side effects.

---

_Verified: 2026-04-24T15:00:00Z_
_Verifier: Claude (gsd-verifier)_
