---
phase: 32-agent-profiles-additional-adapters
plan: 01
subsystem: retrieval
tags: [rrf-fusion, agent-profiles, knowledge-injection, scoring]

requires:
  - phase: 30-knowledge-injection-claude
    provides: retrieval service with RRF fusion and token-budgeted assembly
  - phase: 30.1-cross-project-adapters
    provides: four adapter hooks (Claude, OpenCode, Copilot, Mastra) with retrieval-client

provides:
  - Per-agent tier weight profiles in config/agent-profiles.json
  - Agent-profile-aware RRF fusion (loadAgentProfiles + agentProfile param)
  - All four adapters passing agent identity in retrieval context

affects: [32-02, retrieval-service, knowledge-injection]

tech-stack:
  added: []
  patterns: [per-agent scoring profiles, two-pass tier weighting in RRF fusion]

key-files:
  created: [config/agent-profiles.json]
  modified: [src/retrieval/rrf-fusion.js, src/retrieval/retrieval-service.js, src/hooks/knowledge-injection-hook.js, src/hooks/knowledge-injection-opencode.js, src/hooks/knowledge-injection-copilot.js, src/hooks/knowledge-injection-mastra.js]

key-decisions:
  - "Hardcoded agent names in adapters rather than using CODING_AGENT env var -- simpler, more explicit, no runtime dependency"
  - "Agent profile multipliers applied as second pass after base TIER_WEIGHTS -- preserves base scoring, additive tuning"
  - "loadAgentProfiles caches on first call with fail-open fallback to empty object"

patterns-established:
  - "Two-pass tier weighting: base TIER_WEIGHTS first, then per-agent multipliers"
  - "Agent identity flows through context.agent from adapter to retrieval service to RRF fusion"

requirements-completed: [HOOK-04, HOOK-05, PROF-01]

duration: 2min
completed: 2026-04-25
---

# Phase 32 Plan 01: Agent Profiles Summary

**Per-agent RRF scoring profiles with tier weight multipliers flowing from all four adapters through retrieval service to fusion layer**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-25T09:29:29Z
- **Completed:** 2026-04-25T09:31:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created config/agent-profiles.json with per-agent tier weight multipliers for claude, opencode, copilot, and mastra
- Extended RRF fusion with loadAgentProfiles() (cached, fail-open) and agentProfile parameter for second-pass multipliers
- All four knowledge injection adapters now pass agent identity in retrieval context, enabling per-agent scoring

## Task Commits

Each task was committed atomically:

1. **Task 1: Create agent profiles config and update RRF fusion** - `b12c0960` (feat)
2. **Task 2: Pass agent identity from all four adapters** - `bfe4e477` (feat)

## Files Created/Modified
- `config/agent-profiles.json` - Per-agent tier weight multiplier overrides (claude, opencode, copilot, mastra)
- `src/retrieval/rrf-fusion.js` - Added loadAgentProfiles(), extended rrfFuse() with agentProfile param
- `src/retrieval/retrieval-service.js` - Passes context.agent profile to rrfFuse
- `src/hooks/knowledge-injection-hook.js` - Added agent:'claude' to context
- `src/hooks/knowledge-injection-opencode.js` - Added agent:'opencode' to context
- `src/hooks/knowledge-injection-copilot.js` - Added agent:'copilot' to context
- `src/hooks/knowledge-injection-mastra.js` - Added agent:'mastra' to context

## Decisions Made
- Hardcoded agent names per adapter rather than reading CODING_AGENT env var -- simpler and more explicit
- Agent profile multipliers as second pass after base TIER_WEIGHTS -- preserves base scoring, agent tuning is additive
- loadAgentProfiles uses readFileSync with module-level cache and fail-open (returns {} on error)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Agent profiles active; same query with different agent contexts produces different result rankings
- Ready for Plan 32-02 (additional adapter features)

---
*Phase: 32-agent-profiles-additional-adapters*
*Completed: 2026-04-25*
