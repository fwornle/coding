---
phase: 13-code-graph-agent-integration
plan: 02
subsystem: analysis-pipeline
tags: [cgr, wave-agents, observation-tagging, llm-prompts, code-graph]

# Dependency graph
requires:
  - phase: 13-code-graph-agent-integration
    plan: 01
    provides: "CgrQueryCache, CgrObservationBuilder, wave-types CGR extensions, WaveController CGR getters"
  - phase: 09-agent-restoration
    provides: "EnrichedEntity, AnalysisArtifacts, SemanticAnalysisAgent.analyzeEntityCode()"
provides:
  - "CGR queries wired into all 3 wave agents (component, entity details, call graphs)"
  - "SemanticAnalysisAgent <code_graph> prompt injection via cgrContext parameter"
  - "autoTagObservations() for [LLM+CGR]/[LLM] provenance tagging"
  - "_noCgrEvidence flag on L2/L3 entities lacking CGR evidence"
  - "Per-wave CGR stats in step metrics for dashboard visibility"
affects: [13-03-PLAN, dashboard, trace-history]

# Tech tracking
tech-stack:
  added: []
  patterns: [cgr-query-per-entity, observation-provenance-tagging, cgr-graceful-degradation]

key-files:
  created: []
  modified:
    - integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts
    - integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts

key-decisions:
  - "autoTagObservations is a static method on SemanticAnalysisAgent -- reusable without instantiation"
  - "CGR observations preserved as [CGR]-prefixed during SAA replacement -- existingCgrObs pattern"
  - "Wave agent constructors extended with optional cgrCache/cgrBuilder params (backward compatible)"
  - "CGR stats captured per wave step via captureAgentMetrics outputs field"

patterns-established:
  - "CGR query -> [CGR] observations -> SAA with cgrContext -> autoTag [LLM+CGR]/[LLM]: standard per-entity pipeline"
  - "Preserve existing [CGR] observations when SAA replaces LLM observations"
  - "Optional constructor params with ?? null fallback for backward compatibility"

requirements-completed: [CGR-01, CGR-02, CGR-03]

# Metrics
duration: 5min
completed: 2026-03-09
---

# Phase 13 Plan 02: CGR Wave Agent Integration Summary

**CGR queries wired into all 3 wave agents with [CGR]/[LLM+CGR]/[LLM] provenance tagging and <code_graph> prompt injection into SemanticAnalysisAgent**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-09T17:24:59Z
- **Completed:** 2026-03-09T17:30:01Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Wired CGR queries into Wave1 (component entities), Wave2 (entity details with callees/imports), and Wave3 (entity details + deep call graphs depth 2)
- Added autoTagObservations() static method on SemanticAnalysisAgent for post-processing LLM observations with [LLM+CGR] or [LLM] provenance tags
- SemanticAnalysisAgent injects <code_graph> XML section into LLM prompts when cgrContext is provided, with explicit tagging instructions
- WaveController passes CGR cache/builder to all wave agent constructors and captures per-wave CGR stats in step metrics

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify SAA + Wave agents for CGR integration** - `8c830ec` (feat)
2. **Task 2: Wire CGR cache/builder into wave-controller** - `286268b` (feat)

**Submodule pointer:** `95111610` (chore: update submodule pointer)

## Files Created/Modified
- `src/agents/semantic-analysis-agent.ts` - Added cgrContext prompt injection and autoTagObservations() static method
- `src/agents/wave1-project-agent.ts` - CGR component entity queries, cgrPromptContextMap for enrichment, auto-tagging
- `src/agents/wave2-component-agent.ts` - CGR entity details queries per L2, [CGR] observations, _noCgrEvidence flag
- `src/agents/wave3-detail-agent.ts` - CGR entity details + deep call graph queries per L3, call chain observations
- `src/agents/wave-controller.ts` - Pass cgrCache/cgrBuilder to agents, CGR stats in step metrics, enhanced run summary

## Decisions Made
- autoTagObservations uses regex-based code reference detection (PascalCase, file extensions, paths) to determine [LLM+CGR] vs [LLM] -- does not rely solely on LLM self-tagging
- Existing [CGR] observations preserved when SAA replaces entity observations -- filter-then-prepend pattern
- Wave1 CGR is optional (L0/L1) per locked decision -- no _noCgrEvidence flag set for L1 entities
- Constructor params are optional with ?? null fallback to maintain backward compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All wave agents now query CGR and produce tagged observations
- Plan 03 can add trace integration (TraceCGRQuery) and dashboard CGR indicators
- Pipeline degrades gracefully when CGR is unavailable -- LLM-only mode works unchanged

## Self-Check: PASSED

All 5 modified files verified present. Submodule commits 8c830ec and 286268b verified in git log. Parent repo commit 95111610 verified. TypeScript compiles cleanly (npx tsc --noEmit).

---
*Phase: 13-code-graph-agent-integration*
*Completed: 2026-03-09*
