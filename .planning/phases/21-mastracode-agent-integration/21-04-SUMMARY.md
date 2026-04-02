---
phase: 21-mastracode-agent-integration
plan: 04
subsystem: infra
tags: [mastracode, lifecycle-hooks, ndjson, lsl, transcript-capture]

# Dependency graph
requires:
  - phase: 21-mastracode-agent-integration
    provides: MastraTranscriptReader watching .observations/transcripts/ for NDJSON files (21-03)
provides:
  - hooks.json generation with 6 lifecycle hook commands writing NDJSON to .observations/transcripts/
  - End-to-end data flow: mastracode hook -> NDJSON append -> MastraTranscriptReader tail -> ETM -> LSL
affects: [mastracode-lsl-logging, enhanced-transcript-monitor]

# Tech tracking
tech-stack:
  added: []
  patterns: [ndjson-hook-writer, json-safe-shell-escaping]

key-files:
  created: []
  modified:
    - config/agents/mastra.sh

key-decisions:
  - "Single rolling transcript file (mastra-transcript.jsonl) rather than per-session files -- MastraTranscriptReader handles session boundaries via session_start/end events"
  - "6 hook events (SessionStart, SessionEnd, UserPromptSubmit, Stop, PreToolUse, PostToolUse) for complete conversation capture including tool usage"
  - "Absolute transcript path baked into hooks.json at generation time; MASTRACODE_* env vars resolve at hook execution time"

patterns-established:
  - "Shell-to-NDJSON bridge: lifecycle hook commands that produce JSON lines matching a reader's expected event schema"
  - "JSON-safe message escaping via sed (backslash/quote/tab) and tr (newline removal) for arbitrary user/assistant content"

requirements-completed: [MSTR-03]

# Metrics
duration: 3min
completed: 2026-04-02
---

# Phase 21 Plan 04: Mastra Lifecycle Hook NDJSON Writers Summary

**hooks.json populated with 6 lifecycle hook commands writing NDJSON transcript events to .observations/transcripts/ for MastraTranscriptReader consumption**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-02T16:46:56Z
- **Completed:** 2026-04-02T16:50:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Replaced empty hook arrays in hooks.json with _generate_mastra_hooks_config function producing 6 real hook commands
- Each hook command writes a properly-formatted NDJSON line to .observations/transcripts/mastra-transcript.jsonl
- NDJSON event types match MastraTranscriptReader._normalizeEvent() expected format (session_start, session_end, message with role user/assistant, onToolCall, onToolResult)
- Transcript directory created during agent_pre_launch via mkdir -p

## Task Commits

Each task was committed atomically:

1. **Task 1: Populate hooks.json with NDJSON-writing hook commands** - `da7c2342` (feat)

## Files Created/Modified
- `config/agents/mastra.sh` - Added _generate_mastra_hooks_config function with 6 hook event commands (SessionStart, SessionEnd, UserPromptSubmit, Stop, PreToolUse, PostToolUse) writing NDJSON to .observations/transcripts/mastra-transcript.jsonl; updated agent_pre_launch to call the function and create transcript directory

## Decisions Made
- Single rolling transcript file (mastra-transcript.jsonl) instead of per-session files, since MastraTranscriptReader handles session boundaries via session_start/end NDJSON events and uses offset-based tailing
- Added PreToolUse and PostToolUse hooks beyond the 4 required (SessionStart, SessionEnd, UserPromptSubmit, Stop) to capture tool usage data that MastraTranscriptReader already handles via onToolCall/onToolResult event types
- Used unquoted heredoc (<<HOOKS_EOF) so transcript_file path expands at generation time while MASTRACODE_* vars are escaped to expand at hook runtime

## Deviations from Plan

None - plan executed exactly as written. Added PreToolUse/PostToolUse hooks as a minor enhancement (the reader already supports these event types).

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all hook commands produce complete NDJSON events. The pipeline is fully wired pending actual mastracode execution.

## Next Phase Readiness
- Phase 21 gap closure complete: hooks.json now has real commands that write NDJSON
- End-to-end flow is: mastracode fires hook -> shell appends NDJSON line -> MastraTranscriptReader tails file -> ETM processes -> LSL output
- Runtime verification needed: exact MASTRACODE_* env var names are from research (may differ in actual mastracode release)

## Self-Check: PASSED

---
*Phase: 21-mastracode-agent-integration*
*Completed: 2026-04-02*
