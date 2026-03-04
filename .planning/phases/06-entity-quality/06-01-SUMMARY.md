---
phase: 06-entity-quality
plan: 01
subsystem: pipeline
tags: [llm-prompts, observation-quality, wave-agents, validation, code-graph-rag]

# Dependency graph
requires:
  - phase: 05-wave-orchestration
    provides: Wave1/2/3 agent classes with LLM prompts and execute() flow
provides:
  - Enhanced LLM prompts in all 3 wave agents with GOOD/BAD observation examples
  - Post-LLM observation validation (isSpecificObservation + ensureMinimumObservations)
  - Retry-then-supplement strategy ensuring 3+ specific observations per entity
  - Code-graph-rag integration for file-based supplementation fallback
affects: [06-entity-quality, wave-analysis, knowledge-graph-quality]

# Tech tracking
tech-stack:
  added: []
  patterns: [observation-validation, retry-supplement-fallback, lenient-specificity-filter]

key-files:
  created: []
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts

key-decisions:
  - "Lenient isSpecificObservation: 80+ chars always pass, 30+ chars with any code artifact indicator pass"
  - "Three-step validation: filter generic -> LLM retry with enriched prompt -> supplement from description/hierarchy/sourceFiles/CGR"
  - "Validation wired between parse and build steps (not after entity construction) to ensure clean observations"
  - "Same validation pattern duplicated in each agent class rather than shared utility to avoid cross-agent coupling"

patterns-established:
  - "Observation validation pattern: isSpecificObservation() + ensureMinimumObservations() with filter-retry-supplement"
  - "LLM retry for observations: smaller maxTokens (512), targeted prompt with GOOD examples, JSON array response"
  - "Code-graph-rag fallback: try sourceFiles from wave input first, then CGR Cypher lookup, then generic supplement"

requirements-completed: [QUAL-01]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 6 Plan 01: Observation Quality Enforcement Summary

**Enhanced wave agent LLM prompts with GOOD/BAD examples and added 3-step observation validation (filter, LLM retry, supplement) enforcing 3+ specific observations per entity**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T16:14:41Z
- **Completed:** 2026-03-04T16:19:26Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- All 3 wave agent LLM prompts now include explicit GOOD/BAD observation examples requiring code artifact references
- Post-LLM validation ensures every entity has 3+ specific observations with retry and supplementation fallbacks
- Third supplement source uses code-graph-rag file analysis (sourceFiles from wave input or CGR Cypher lookup) before falling back to generic text
- TypeScript compiles clean with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance LLM prompts in all 3 wave agents** - `e09cf46` (feat)
2. **Task 2: Add observation validation with retry and supplementation** - `a903a70` (feat)

**Submodule ref update:** `39f17c1e` (chore: update semantic-analysis submodule)

## Files Created/Modified
- `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` - Enhanced prompt (5-7 obs with GOOD/BAD examples) + isSpecificObservation() + ensureMinimumObservations() wired after analyzeComponent
- `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts` - Enhanced prompt (5-7 obs per sub-component) + same validation methods wired after parseL2Response per sub-component
- `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts` - Enhanced prompt (3-5 obs per detail) + same validation methods wired after parseL3Response per detail entity

## Decisions Made
- Lenient specificity filter: observations >= 80 chars always pass (likely specific enough per Research pitfall 3); shorter observations need at least one code artifact indicator (PascalCase, file extension, method call, file path, or language keyword)
- Validation methods duplicated per agent class rather than extracted to shared utility -- keeps agents self-contained and avoids cross-agent coupling for 3 small methods
- Retry prompt uses same LLM service but with smaller maxTokens (512) and requests exactly N missing observations
- Code-graph-rag lookup in supplementation is best-effort with silent catch -- keeps pipeline resilient when Memgraph is down

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Submodule commit required: files are inside `integrations/mcp-server-semantic-analysis` git submodule, so commits were made in submodule first then parent repo submodule ref was updated. Standard workflow for this project.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- QUAL-01 (3+ specific observations per entity) is now enforced at the code level
- Plans 06-02 (insight document generation) and 06-03 (PlantUML diagrams for L1/L2) can proceed
- Submodule needs `npm run build` + Docker rebuild before runtime validation

---
*Phase: 06-entity-quality*
*Completed: 2026-03-04*

## Self-Check: PASSED

All files, commits, and artifacts verified.
