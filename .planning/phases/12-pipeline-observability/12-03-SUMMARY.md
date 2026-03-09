---
phase: 12-pipeline-observability
plan: 03
subsystem: ui
tags: [typescript, react, trace, dashboard, observability, llm-calls]

requires:
  - phase: 12-pipeline-observability
    provides: "Backend trace capture in stepsDetail (Plan 01)"
  - phase: 12-pipeline-observability
    provides: "Extended StepInfo with trace fields, wave grouping selector, constants (Plan 02)"
provides:
  - "Complete TraceModal with 3-level nested trace visualization"
  - "Wave > Step > Agent hierarchy with context-aware detail panels"
  - "Entity flow counters, LLM call detail, code evidence rendering"
  - "Parallel execution waterfall bars"
affects: [12-04, trace-history-comparison, pipeline-debugging]

tech-stack:
  added: []
  patterns: ["3-level hierarchical expand/collapse with Set-based ID tracking", "React.memo sub-components for SSE update isolation"]

key-files:
  created: []
  modified:
    - "integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx"

key-decisions:
  - "Hierarchical expand IDs use slash-delimited paths (wave-1/step-wave1_analyze/agent-id) for parent-child collapse"
  - "Waterfall bars use CSS absolute positioning with percent offsets relative to wave duration"
  - "Code evidence detection via regex matching file paths and PascalCase identifiers in LLM previews"

patterns-established:
  - "Memoized sub-components (EntityFlowBadge, QABadge, LLMCallRow, AgentInstanceRow) for render isolation"
  - "Graceful degradation: check steps[0]?.wave !== undefined to select nested vs flat rendering"

requirements-completed: [OBSV-01, OBSV-02, OBSV-03, OBSV-04]

duration: 5min
completed: 2026-03-09
---

# Phase 12 Plan 03: Trace Modal 3-Level Nested Visualization Summary

**965-line TraceModal rewrite with Wave > Step > Agent nesting, parallel waterfall bars, entity flow counters, LLM call detail with code evidence, and context-aware detail panels**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-09T11:50:00Z
- **Completed:** 2026-03-09T12:23:27Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Complete TraceModal rewrite: 965 lines with 3-level nesting (Wave > Step > Agent instances / LLM calls)
- Summary stats bar with per-wave breakdown (LLM calls, duration, tokens per wave)
- Context-aware right detail panel adapts to wave-level (entity flow diagram), step-level (agent list), and agent-level (LLM call detail)
- Parallel agent waterfall bars using CSS absolute positioning relative to wave start time
- Entity flow inline badges ("9 > 7 > 6") with color-coded produced/QA-passed/persisted counters
- LLM call expand-to-detail with model badge (TIER_COLORS), duration, tokens, prompt/response previews (max 500 chars)
- Code evidence rendering via renderWithCodeEvidence() -- regex detects file paths and PascalCase identifiers, wraps in monospace code tags
- QA pass/fail badges with score, error list, retry indicator
- Non-LLM agents (Ontology, Persistence) visible with "No LLM calls" indicator
- Graceful degradation to flat timeline for old data format without wave fields
- React.memo on all sub-components; useMemo for wave grouping computation

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite TraceModal with 3-level nesting, wave summary bar, and code evidence** - `27c6963a` (feat)
2. **Task 2: Visual verification** - checkpoint approved by user

## Files Created/Modified
- `integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx` - Complete rewrite with 3-level nested trace visualization, 6 memoized sub-components, context-aware detail panel

## Decisions Made
- Hierarchical expand IDs use slash-delimited paths (wave-1/step-name/agent-id) enabling parent-child collapse cascading
- Waterfall bars use CSS absolute positioning with percent offsets relative to wave duration for parallel agent visualization
- Code evidence detection via regex matching file paths (containing / with common extensions) and PascalCase class names -- rendered as monospace code spans with bg-zinc-800

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Trace modal fully operational for pipeline observability
- All Plan 01 backend trace data rendered in Plan 03 UI
- Ready for Plan 04 (wave timeline / history comparison) if planned
- Ontology classification steps confirmed showing expandable LLM calls with prompt/response previews

---
*Phase: 12-pipeline-observability*
*Completed: 2026-03-09*

## Self-Check: PASSED
