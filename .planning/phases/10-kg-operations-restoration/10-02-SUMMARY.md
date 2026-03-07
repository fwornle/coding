---
phase: 10-kg-operations-restoration
plan: 02
subsystem: knowledge-graph
tags: [dedup, edge-prediction, hierarchy, cosine-similarity, kg-operators]

requires:
  - phase: 09-agent-pipeline-integration
    provides: Wave pipeline with entity hierarchy (parentId, level, hierarchyPath)
provides:
  - Hierarchy-aware dedup (parentId-scoped key + semantic second pass)
  - Cross-branch edge prediction (getL1Ancestor filter)
  - Verified conv handles any BatchContext shape
affects: [10-03-wave-controller-wiring, 10-04-embedding-subprocess]

tech-stack:
  added: []
  patterns: [two-pass-dedup, cross-branch-prediction, hierarchy-scoped-keys]

key-files:
  created: []
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts

key-decisions:
  - "Two-pass dedup: exact name match (parentId-scoped), then cosine > 0.9 with same parent+level"
  - "Edge prediction compares within-run entities (not vs empty accumulatedKG) using ordered pair loop"
  - "Same-branch pairs (same L1 ancestor) skipped in edge prediction"
  - "mergeEntities() now preserves incoming hierarchy fields (parentId, level, hierarchyPath) via null-coalesce"

patterns-established:
  - "Hierarchy-scoped dedup key: parentId::normalizedName prevents cross-parent merging"
  - "Cross-branch filter: getL1Ancestor() extracts L1 from hierarchyPath for branch comparison"

requirements-completed: [KGOP-01, KGOP-04, KGOP-05]

duration: 2min
completed: 2026-03-07
---

# Phase 10 Plan 02: KG Operator Logic Summary

**Hierarchy-aware two-pass dedup with parentId-scoped keys and cross-branch-only edge prediction via L1 ancestor filtering**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T13:47:57Z
- **Completed:** 2026-03-07T13:50:20Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Dedup key changed from `normalizedName` to `parentId::normalizedName` so same-name entities under different parents survive
- Added semantic second pass merging entities with cosine > 0.9, same parent, same level
- Edge prediction now compares within-run entities using ordered pair loop (i < j)
- Added getL1Ancestor() helper; same-branch pairs skipped in prediction
- Conv operator verified to handle empty commits/sessions arrays gracefully
- mergeEntities() now preserves incoming hierarchy fields (parentId, level, hierarchyPath)

## Task Commits

Each task was committed atomically:

1. **Task 1: Make dedup hierarchy-aware with two-pass strategy** - `91ed1c4` (feat)
2. **Task 2: Add cross-branch filter to edge prediction and adapt conv** - `861810e` (feat)

**Submodule ref update:** `08e243b` (chore: parent repo)

## Files Created/Modified
- `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` - Hierarchy-aware dedup, cross-branch edge prediction, mergeEntities hierarchy field preservation

## Decisions Made
- Two-pass dedup strategy: exact match first (fast), then semantic similarity second (catches near-duplicates)
- Edge prediction uses ordered pair loop within run entities rather than comparing against empty accumulatedKG
- Conv operator works as-is with any BatchContext -- no changes needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] mergeEntities() hierarchy field preservation**
- **Found during:** Task 2 (commit hook or linter added it)
- **Issue:** mergeEntities() spread operator overwrites hierarchy fields (parentId, level, hierarchyPath) -- incoming values lost
- **Fix:** Added explicit `parentId: incoming.parentId ?? existing.parentId`, same for level and hierarchyPath
- **Files modified:** kg-operators.ts mergeEntities()
- **Verification:** TypeScript compiles, fields explicitly handled
- **Committed in:** 861810e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical -- KGOP-06 fix)
**Impact on plan:** Essential fix for hierarchy preservation during entity merging. Aligns with KGOP-06 requirement from research.

## Issues Encountered
- Pre-existing TypeScript error in semantic-analyzer.ts (line 741, `input` property on ExecFileOptions) -- out of scope, does not affect kg-operators.ts

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- KG operator logic is complete and ready for wiring into wave-controller (Plan 03)
- mergeEntities() hierarchy fix ensures operators don't lose parentId during merge
- Edge prediction cross-branch filter ready for use with real embeddings (Plan 04)

---
*Phase: 10-kg-operations-restoration*
*Completed: 2026-03-07*
