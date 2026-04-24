---
phase: 28-embedding-pipeline
plan: 01
subsystem: embedding
tags: [fastembed, qdrant, ioredis, onnx, all-MiniLM-L6-v2, vector-embeddings]

requires:
  - phase: none
    provides: "First plan in milestone v6.0"
provides:
  - "fastembed and ioredis npm dependencies installed"
  - "Embedding config (single source of truth for model, dimensions, collections)"
  - "EmbeddingService singleton wrapping fastembed with embedOne/embedBatch"
  - "contentHash utility for idempotency checks"
  - "ensureCollections/getQdrantClient for Qdrant collection management"
affects: [28-02-backfill, 28-03-listener, 29-retrieval-service]

tech-stack:
  added: [fastembed@2.1.0, ioredis@5.10.0]
  patterns: [singleton-lazy-init, content-hash-idempotency, stderr-logging]

key-files:
  created:
    - src/embedding/embedding-config.json
    - src/embedding/embedding-service.ts
    - src/embedding/content-hash.ts
    - src/embedding/qdrant-collections.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "EmbeddingModel.AllMiniLML6V2 enum verified at runtime (not assumed from docs)"
  - "queryEmbed returns typed array (Float32Array), converted to number[] via Array.from"
  - "embedBatch yields converted number[][] batches from fastembed async generator"

patterns-established:
  - "Singleton lazy-init: module-level instance + guarded initialize() with initPromise"
  - "Config from JSON: readFileSync with import.meta.url path resolution"
  - "Stderr logging: process.stderr.write with [ComponentName] prefix throughout"

requirements-completed: [EMBED-06]

duration: 3min
completed: 2026-04-24
---

# Phase 28 Plan 01: Embedding Pipeline Foundation Summary

**fastembed ONNX embedding service with all-MiniLM-L6-v2 (384-dim), content hashing for idempotency, and Qdrant collection management for 4 knowledge tiers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-24T11:06:12Z
- **Completed:** 2026-04-24T11:09:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed fastembed (ONNX-based Node.js embeddings) and ioredis (Redis pub/sub) as project dependencies
- Created embedding-config.json as single source of truth for model name, version, dimensions, and 4 collection schemas with payload indexes (per D-02/D-03/D-04)
- Built EmbeddingService singleton with lazy ONNX model initialization, embedOne (single text), and embedBatch (async generator for bulk) methods
- Created contentHash utility producing deterministic 16-char SHA-256 hex strings for Qdrant idempotency
- Built ensureCollections with fail-fast connectivity check, idempotent collection creation, and payload index setup

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create embedding config** - `ba3ef5d3` (feat)
2. **Task 2: Create embedding-service, content-hash, and qdrant-collections modules** - `3c7ee3f4` (feat)

## Files Created/Modified
- `package.json` - Added fastembed@^2.1.0 and ioredis@^5.10.0 to dependencies
- `src/embedding/embedding-config.json` - Pinned model config with 4 collection schemas
- `src/embedding/content-hash.ts` - SHA-256 truncated hash for idempotency
- `src/embedding/embedding-service.ts` - Singleton fastembed wrapper with embedOne/embedBatch
- `src/embedding/qdrant-collections.ts` - Idempotent Qdrant collection creation with payload indexes

## Decisions Made
- Verified `EmbeddingModel.AllMiniLML6V2` enum exists at runtime (confirmed, matches docs)
- `queryEmbed` returns Float32Array, not number[] -- added `Array.from()` conversion in embedOne
- `embed` async generator batches also return typed arrays -- added per-element `Array.from()` conversion in embedBatch
- Used `import.meta.url` + `fileURLToPath` for `__dirname` resolution (ESM pattern consistent with project)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript errors when running `tsc --noEmit` without `--project tsconfig.json` flag (fastembed's own .d.ts has a `Module '"fs"' has no default export` error under default TS settings). Resolved by using project tsconfig which has `skipLibCheck: true`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All foundation modules ready for Plan 02 (backfill CLI) and Plan 03 (listener)
- backfill.ts can import getEmbeddingService, contentHash, ensureCollections, getQdrantClient
- listener.ts can import getEmbeddingService and getQdrantClient
- Qdrant must be running for ensureCollections to succeed (backfill/listener will call it at startup)

---
*Phase: 28-embedding-pipeline*
*Completed: 2026-04-24*
