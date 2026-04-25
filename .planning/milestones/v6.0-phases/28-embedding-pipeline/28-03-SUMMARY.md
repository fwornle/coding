---
phase: 28-embedding-pipeline
plan: 03
subsystem: infra
tags: [redis, qdrant, fastembed, pubsub, supervisord, ioredis, embedding]

# Dependency graph
requires:
  - phase: 28-embedding-pipeline/28-01
    provides: "EmbeddingService, getQdrantClient, ensureCollections, contentHash"
provides:
  - "Redis pub/sub embedding listener (src/embedding/listener.ts)"
  - "ObservationWriter fire-and-forget Redis publishing on new observations"
  - "Supervisord process for embedding listener in Docker"
affects: [retrieval-service, phase-29]

# Tech tracking
tech-stack:
  added: [ioredis (pub/sub)]
  patterns: [fire-and-forget Redis publish, lazy Redis init with fail-fast, supervisord long-running listener]

key-files:
  created:
    - src/embedding/listener.ts
  modified:
    - src/live-logging/ObservationWriter.js
    - docker/supervisord.conf
    - docker/docker-compose.yml
    - src/embedding/embedding-service.ts
    - src/embedding/qdrant-collections.ts

key-decisions:
  - "Fire-and-forget Redis publish with retryStrategy: () => null ensures observation writes never block on Redis"
  - "Listener runs as supervisord process (priority=150) with autorestart for crash resilience"
  - "Config path resolved from src/ not dist/ since embedding-config.json is not compiled by tsc"

patterns-established:
  - "Redis pub/sub event bus: publisher uses lazy init + fire-and-forget, subscriber is long-running supervisord process"
  - "Docker bind-mount pattern for embedding pipeline: dist/embedding/ + src/embedding/embedding-config.json"

requirements-completed: [EMBED-05]

# Metrics
duration: 45min
completed: 2026-04-24
---

# Phase 28 Plan 03: Write-Time Embedding Hooks Summary

**Redis pub/sub event bus wiring ObservationWriter to embedding listener for automatic Qdrant upserts within seconds of observation creation**

## Performance

- **Duration:** ~45 min (across checkpoint pause)
- **Started:** 2026-04-24T13:00:00Z
- **Completed:** 2026-04-24T14:30:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 7 (code files only: 6)

## Accomplishments
- New observations are automatically embedded into Qdrant within seconds of creation via Redis pub/sub
- Embedding is fully decoupled from write path -- ObservationWriter publishes fire-and-forget events that never block observation writes
- Listener runs as a resilient supervisord process with autorestart and graceful shutdown (SIGTERM/SIGINT)
- End-to-end verified: test Redis event published, listener processed it, Qdrant observation count increased (645 -> 646)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create embedding listener and modify ObservationWriter** - `f7588e7f` (feat)
2. **Task 2: Configure Docker for embedding listener process** - `a614010f` (chore)
3. **Task 3: Verify write-time embedding end-to-end** - checkpoint approved (no code commit)

**Fix commit:** `16a66fe3` - fix(28-03): resolve config path and Docker native deps for embedding listener

## Files Created/Modified
- `src/embedding/listener.ts` - Redis pub/sub subscriber that embeds new items into Qdrant via fastembed
- `src/live-logging/ObservationWriter.js` - Added lazy Redis publisher with fire-and-forget publish after observation writes
- `docker/supervisord.conf` - New [program:embedding-listener] block with proxy clearing and priority=150
- `docker/docker-compose.yml` - Bind-mounts for dist/embedding/ and embedding-config.json
- `src/embedding/embedding-service.ts` - Config path resolution fix (src/ instead of dist/)
- `src/embedding/qdrant-collections.ts` - Config path resolution fix (src/ instead of dist/)

## Decisions Made
- Redis connection uses `lazyConnect: true` + `connectTimeout: 2000` + `retryStrategy: () => null` to fail fast without blocking observation writes
- `_redisInitAttempted` flag prevents repeated init attempts if Redis is down
- Listener uses `wait: false` on Qdrant upsert for non-blocking real-time path
- Config path resolved from `src/embedding/embedding-config.json` (not `dist/`) since JSON config is not compiled by tsc

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Config path resolution from dist/ to src/**
- **Found during:** Task 3 (verification checkpoint)
- **Issue:** embedding-service.ts and qdrant-collections.ts resolved embedding-config.json relative to `dist/` but the JSON file only exists in `src/` (tsc does not copy JSON files)
- **Fix:** Changed path resolution to use `src/embedding/embedding-config.json` from project root
- **Files modified:** src/embedding/embedding-service.ts, src/embedding/qdrant-collections.ts
- **Committed in:** 16a66fe3

**2. [Rule 3 - Blocking] Missing native tokenizer binary for ARM64 Linux**
- **Found during:** Task 3 (verification checkpoint)
- **Issue:** fastembed's tokenizer required `@anush008/tokenizers-linux-arm64-gnu` native binary which was not installed in the Docker image
- **Fix:** Added explicit npm install of the native dependency in Dockerfile
- **Files modified:** docker/Dockerfile (or equivalent install step)
- **Committed in:** 16a66fe3

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for the listener to start in Docker. No scope creep.

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 28 is now complete: all 3 plans delivered (foundation, backfill, write-time hooks)
- Qdrant has vectors for all 4 knowledge tiers with automatic embedding for new observations
- Ready for Phase 29 (Retrieval Service) which will query these vectors

---
*Phase: 28-embedding-pipeline*
*Completed: 2026-04-24*

## Self-Check: PASSED
