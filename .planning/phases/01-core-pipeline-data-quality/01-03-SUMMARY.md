---
phase: 01-core-pipeline-data-quality
plan: 03
subsystem: infra
tags: [json-parsing, docker, markdown-fence, observation-generation, typescript]

# Dependency graph
requires:
  - phase: 01-core-pipeline-data-quality/01-02
    provides: LLM synthesis in createEntityObservation and createSemanticInsightObservation (the methods this plan fixes JSON parsing for)
provides:
  - Markdown fence stripping before JSON.parse in createEntityObservation
  - Markdown fence stripping before JSON.parse in createSemanticInsightObservation
  - Docker bind-mount persisting knowledge-management/insights/ to host filesystem
affects: [01-04, 01-05, ukb-pipeline, insight-document-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Markdown fence stripping: const cleaned = result.insights.replace(/^```json?\\n?/m, '').replace(/\\n?```$/m, '').trim() before JSON.parse(cleaned)"
    - "Docker bind-mount for writable host paths uses no :ro suffix"

key-files:
  created: []
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts
    - docker/docker-compose.yml

key-decisions:
  - "Apply fence-stripping only to the two unfixed methods (createEntityObservation, createSemanticInsightObservation) -- createArchitecturalDecisionObservation and createCodeEvolutionObservation already had the fix"
  - "knowledge-management mount is read-write (no :ro) because container must write insight files to that path"

patterns-established:
  - "Fence stripping pattern: always strip markdown fences before JSON.parse when parsing LLM response payloads"

requirements-completed: [OBSV-01, OBSV-02]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 1 Plan 3: JSON Parse Fix + Docker Insight Persistence Summary

**Markdown fence stripping added to createEntityObservation and createSemanticInsightObservation, eliminating 293+63 LLM synthesis fallbacks; Docker bind-mount added for knowledge-management/ to persist insight documents to host**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T13:04:22Z
- **Completed:** 2026-02-27T13:07:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Both createEntityObservation and createSemanticInsightObservation now strip markdown fences before JSON.parse, matching the pattern used in the two already-fixed methods (createArchitecturalDecisionObservation line 341, createCodeEvolutionObservation line 463)
- Docker compose bind-mount for knowledge-management/ added so insight documents written inside the container at /coding/knowledge-management/insights/ persist to host across restarts
- No new TypeScript compilation errors introduced (3 pre-existing errors in coordinator.ts remain, as documented in previous plans)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add markdown fence stripping to createEntityObservation and createSemanticInsightObservation** - `b922b4b2` (fix)
2. **Task 2: Add knowledge-management bind-mount to Docker compose** - `28d2aa1e` (feat)

## Files Created/Modified
- `integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts` - Added cleaned variable with fence-stripping regex before JSON.parse in two methods; 4 total fence-stripping occurrences (was 2)
- `docker/docker-compose.yml` - Added knowledge-management read-write bind-mount after .specstory mount in coding-services volumes section

## Decisions Made
- Applied fence-stripping only to the two unfixed methods (createEntityObservation, createSemanticInsightObservation) -- the plan explicitly scoped the fix to these two, leaving the already-fixed methods and the unrelated createCorrelationObservation untouched
- knowledge-management mount uses no :ro suffix because the container must write insight files to that directory

## Deviations from Plan

None - plan executed exactly as written.

Note: The fix for createEntityObservation was already present in the submodule HEAD (commit e9cd3f4, which was part of a prior 01-04 plan execution). The parent repo submodule pointer was updated to reflect this. The fix for createSemanticInsightObservation was applied as planned. Both methods verified at lines 943 and 1335.

## Issues Encountered
- The observation-generation-agent.ts file is in a git submodule (integrations/mcp-server-semantic-analysis). Changes must be committed within the submodule first, then the parent repo submodule pointer updated. The Task 1 fix was already committed in the submodule as part of a prior 01-04 execution; only the parent repo pointer commit was needed.

## User Setup Required
None - no external service configuration required. Docker compose change takes effect on next docker-compose up -d coding-services.

## Next Phase Readiness
- JSON parse fixes complete for all 4 LLM synthesis methods in observation-generation-agent.ts
- Docker persist for insight documents ready (requires container restart to activate bind-mount)
- Ready for Phase 1 Plan 4 (entity naming normalization) and Plan 5 (validation)

---
*Phase: 01-core-pipeline-data-quality*
*Completed: 2026-02-27*
