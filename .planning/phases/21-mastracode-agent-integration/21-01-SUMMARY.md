---
phase: 21-mastracode-agent-integration
plan: 01
subsystem: infra
tags: [mastracode, agent-adapter, tmux, launcher, bash]

# Dependency graph
requires:
  - phase: 20-foundation-opencode-om
    provides: agent adapter pattern (opencode.sh, launch-agent-common.sh)
provides:
  - config/agents/mastra.sh agent adapter with AGENT_COMMAND=mastracode
  - scripts/launch-mastra.sh thin launch wrapper
  - bin/coding --mastra flag for CLI invocation
  - Wave 0 test stubs for downstream plans (21-03)
affects: [21-02, 21-03, mastracode-agent-integration]

# Tech tracking
tech-stack:
  added: [mastracode]
  patterns: [agent-adapter-pattern, lifecycle-hooks-over-pipe-pane]

key-files:
  created:
    - config/agents/mastra.sh
    - scripts/launch-mastra.sh
    - tests/unit/test-mastra-reader.js
  modified:
    - bin/coding
    - tests/integration/launcher-e2e.sh

key-decisions:
  - "AGENT_ENABLE_PIPE_CAPTURE=false per D-08: lifecycle hooks instead of pipe-pane"
  - "LLM proxy health check on port 8089 (warn-only, per D-15)"
  - "hooks.json auto-created in ~/.mastracode/ for transcript capture readiness"

patterns-established:
  - "Mastra adapter follows identical structure to opencode.sh/claude.sh"
  - "Lifecycle hooks for transcript capture (not tmux pipe-pane)"

requirements-completed: [MSTR-01]

# Metrics
duration: 2min
completed: 2026-04-02
---

# Phase 21 Plan 01: Mastra Agent Adapter Summary

**Mastracode agent adapter, launch wrapper, and --mastra CLI flag enabling `coding --mastra` to start mastracode in standard tmux layout**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-02T06:05:34Z
- **Completed:** 2026-04-02T06:07:54Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Agent adapter with AGENT_COMMAND="mastracode", network-adaptive model selection, LLM proxy validation on port 8089
- Launch wrapper delegating to launch-agent-common.sh framework
- `coding --mastra` flag in CLI with help text documentation
- Wave 0 test stubs: MastraTranscriptReader unit test + test_mastra_flag integration test

## Task Commits

Each task was committed atomically:

1. **Task 0: Create Wave 0 test stubs** - `4456e0fe` (test)
2. **Task 1: Create mastra agent adapter and launch wrapper** - `9a800750` (feat)
3. **Task 2: Add --mastra flag to main launcher and help text** - `b276ee32` (feat)

## Files Created/Modified
- `config/agents/mastra.sh` - Mastra agent adapter (variables, check_requirements, pre_launch)
- `scripts/launch-mastra.sh` - Thin launch wrapper sourcing common framework
- `bin/coding` - Added --mastra flag to parser, help text, agents list, examples
- `tests/unit/test-mastra-reader.js` - Wave 0 stub for MastraTranscriptReader (skipped until 21-03)
- `tests/integration/launcher-e2e.sh` - test_mastra_flag validating adapter config and launcher

## Decisions Made
- AGENT_ENABLE_PIPE_CAPTURE=false per D-08: mastracode uses lifecycle hooks for transcript capture
- LLM proxy health check uses port 8089 (D-15), warn-only to avoid blocking startup
- Auto-creates ~/.mastracode/hooks.json with empty hook arrays for transcript capture readiness
- Network-adaptive: VPN uses copilot-enterprise, public uses claude-opus-4-6

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required. Users need `npm install -g mastracode` before using `coding --mastra`.

## Next Phase Readiness
- Agent adapter and launcher in place for Phase 21-02 (tmux statusline integration)
- Test stubs ready for Phase 21-03 (transcript reader implementation)
- hooks.json scaffold ready for lifecycle hook wiring

## Self-Check: PASSED

All 4 files exist. All 3 task commits verified.

---
*Phase: 21-mastracode-agent-integration*
*Completed: 2026-04-02*
