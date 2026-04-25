---
phase: 29-retrieval-service
plan: 01
subsystem: retrieval
tags: [rrf, qdrant, fts5, gpt-tokenizer, fastembed, sqlite, hybrid-search]

requires:
  - phase: 28-embedding-pipeline
    provides: "EmbeddingService.embedOne(), getQdrantClient(), 4 Qdrant collections with payload indexes"
provides:
  - "RetrievalService class with retrieve(query) -> { markdown, meta }"
  - "RRF fusion with tier-weighted scoring (rrfFuse, recencyScore, buildRecencyList)"
  - "Token-budgeted markdown assembly (formatResult, truncateResult, assembleBudgetedMarkdown)"
  - "SQLite FTS5/LIKE keyword search (KeywordSearch class)"
  - "Singleton factory getRetrievalService()"
affects: [29-02-server-endpoint, 30-claude-hook, 31-adapters]

tech-stack:
  added: []
  patterns:
    - "RRF fusion with post-fusion tier weighting"
    - "FTS5 probe-and-fallback to LIKE for optional FTS tables"
    - "Parallel Qdrant multi-collection search with per-collection graceful degradation"
    - "Token budget enforcement via gpt-tokenizer countTokens()"

key-files:
  created:
    - src/retrieval/rrf-fusion.js
    - src/retrieval/token-budget.js
    - src/retrieval/keyword-search.js
    - src/retrieval/retrieval-service.js
  modified:
    - .gitignore

key-decisions:
  - "Plain JS (not TypeScript) for src/retrieval/ to match server.js and avoid compilation step"
  - "Import compiled dist/embedding/ outputs rather than raw src/embedding/ TS files"
  - "Added .gitignore exclusion for src/retrieval/*.js since src/**/*.js was globally ignored"
  - "Keyword search IDs prefixed with kw- to avoid collision with Qdrant point UUIDs"

patterns-established:
  - "RRF fusion: accumulate 1/(k+rank+1) scores, then multiply by tier weight"
  - "Keyword search: inject db instance per call, never hold stale reference"
  - "Graceful degradation: catch per-collection Qdrant errors, return [] for failed collections"

requirements-completed: [RETR-02, RETR-03, RETR-04, RETR-05, RETR-06]

duration: 5min
completed: 2026-04-24
---

# Phase 29 Plan 01: Retrieval Service Core Summary

**Hybrid retrieval engine combining RRF-fused semantic (Qdrant) + keyword (FTS5/LIKE) + recency search with tier-weighted scoring and gpt-tokenizer budget enforcement**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-24T13:50:41Z
- **Completed:** 2026-04-24T13:55:14Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RRF fusion algorithm with tier-weighted scoring (insights 1.5x > digests 1.2x > kg_entities 1.0x > observations 0.8x)
- Token-budgeted markdown assembly using gpt-tokenizer with per-result truncation support
- SQLite keyword search with FTS5 probe-and-fallback pattern for observations, LIKE for digests/insights
- RetrievalService orchestrator: embed -> parallel search -> RRF fuse -> assemble, with graceful degradation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RRF fusion, token budget, and keyword search utilities** - `a581a753` (feat)
2. **Task 2: Create RetrievalService orchestrator** - `3b826f57` (feat)

## Files Created/Modified
- `src/retrieval/rrf-fusion.js` - RRF fusion algorithm with tier weighting, recency scoring, recency list builder
- `src/retrieval/token-budget.js` - Token-budgeted markdown assembly with formatResult, truncateResult, assembleBudgetedMarkdown
- `src/retrieval/keyword-search.js` - SQLite FTS5/LIKE keyword search across observations, digests, insights
- `src/retrieval/retrieval-service.js` - Orchestrator combining embed, search, fuse, assemble with singleton factory
- `.gitignore` - Added exclusion for src/retrieval/*.js (plain JS, not compiled TS output)

## Decisions Made
- Used plain JS instead of TypeScript for retrieval modules -- matches server.js (the consumer) and avoids needing a compilation step for these files
- Import from `../../dist/embedding/` (compiled output) rather than `../embedding/` (raw TS) since Node.js cannot import .ts files directly
- Added `!src/retrieval/**/*.js` to .gitignore because `src/**/*.js` was globally ignored (intended for compiled TS output)
- Keyword search results get `kw-{tier}-{id}` synthetic IDs to prevent collision with Qdrant UUID point IDs during RRF deduplication

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] .gitignore blocking src/retrieval/*.js files**
- **Found during:** Task 1 (commit)
- **Issue:** `src/**/*.js` in .gitignore prevented committing the plain JS retrieval modules
- **Fix:** Added `!src/retrieval/**/*.js` exclusion to .gitignore
- **Files modified:** .gitignore
- **Verification:** git add succeeded after exclusion added
- **Committed in:** a581a753 (Task 1 commit)

**2. [Rule 3 - Blocking] Import path to compiled embedding modules**
- **Found during:** Task 2 (retrieval-service.js creation)
- **Issue:** Plan suggested `../embedding/embedding-service.js` but src/embedding/ contains .ts files; compiled output is in dist/embedding/
- **Fix:** Used `../../dist/embedding/embedding-service.js` and `../../dist/embedding/qdrant-collections.js` import paths
- **Files modified:** src/retrieval/retrieval-service.js
- **Verification:** `node -e "import('./src/retrieval/retrieval-service.js')"` succeeds
- **Committed in:** 3b826f57 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for files to be committable and importable. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four retrieval modules are importable as ESM and ready for Plan 02 (server.js endpoint wiring)
- RetrievalService.retrieve() returns { markdown, meta } per D-06 shape
- dbGetter injection pattern ready for server.js to pass _getObservationsDb()

---
*Phase: 29-retrieval-service*
*Completed: 2026-04-24*
