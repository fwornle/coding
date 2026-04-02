---
phase: 21-mastracode-agent-integration
plan: 03
subsystem: infra
tags: [mastracode, transcript-reader, etm, ndjson, lifecycle-hooks, lsl]

# Dependency graph
requires:
  - phase: 21-mastracode-agent-integration
    provides: agent adapter with AGENT_TRANSCRIPT_FMT=mastra (21-01), statusline/health integration (21-02)
provides:
  - MastraTranscriptReader class for watching/parsing mastra lifecycle hook NDJSON transcripts
  - ETM integration with mastra transcript detection, normalization, and LSL pipeline wiring
  - Agent identity metadata in LSL session headers for all agent types
  - Activated unit tests (13 passing) for MastraTranscriptReader
affects: [mastracode-lsl-logging, enhanced-transcript-monitor]

# Tech tracking
tech-stack:
  added: []
  patterns: [ndjson-transcript-normalization, agent-identity-in-lsl-header, file-tailing-reader]

key-files:
  created:
    - src/live-logging/MastraTranscriptReader.js
  modified:
    - scripts/enhanced-transcript-monitor.js
    - tests/unit/test-mastra-reader.js

key-decisions:
  - "Mastra NDJSON events normalized to Claude-compatible format in ETM (same pattern as copilot normalization)"
  - "MastraTranscriptReader watches .observations/transcripts/ for .jsonl/.ndjson files via fs.watch + polling fallback"
  - "Agent identity added to ALL LSL session headers (Mastracode, Claude Code, GitHub Copilot, OpenCode) per D-11"

patterns-established:
  - "Agent-type-aware LSL headers: agentDisplayName map for per-agent identification in session metadata"
  - "NDJSON normalization: normalizeMastraMessages() converts lifecycle hook events to Claude exchange format"
  - "Transcript directory scanning: findMastraTranscriptDir() detects .observations/transcripts/ alongside other transcript sources"

requirements-completed: [MSTR-03]

# Metrics
duration: 6min
completed: 2026-04-02
---

# Phase 21 Plan 03: Transcript Reader & ETM Integration Summary

**MastraTranscriptReader watching NDJSON lifecycle hook transcripts with full ETM pipeline integration -- mastra conversations flow through exchange extraction, classification, and LSL output**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-02T06:14:16Z
- **Completed:** 2026-04-02T06:20:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- MastraTranscriptReader (421 lines) watches .observations/transcripts/ for NDJSON files, parses mastra lifecycle hook events (message, onStepFinish, onToolCall, onToolResult, session_start/end), emits message/exchange events
- ETM integration: findMastraTranscriptDir(), findCurrentTranscript(), findAllActiveTranscripts(), normalizeMastraMessages() -- mastra is a first-class transcript source alongside Claude, Copilot, and OpenCode
- Agent identity in LSL session headers for all four agent types (per D-11)
- Wave 0 test stubs activated with real imports and 13 passing tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MastraTranscriptReader** - `327ea985` (feat)
2. **Task 2: Register MastraTranscriptReader in ETM** - `2b6604ec` (feat)

## Files Created/Modified
- `src/live-logging/MastraTranscriptReader.js` - File-watching NDJSON reader for mastra lifecycle hook transcripts with EventEmitter pattern, incremental tailing, exchange detection, and static extractExchangesFromBatch()
- `scripts/enhanced-transcript-monitor.js` - Added MastraTranscriptReader import, findMastraTranscriptDir(), mastra detection in transcript discovery, normalizeMastraMessages(), agent identity in LSL headers
- `tests/unit/test-mastra-reader.js` - Activated from Wave 0 stubs with real MastraTranscriptReader import and 13 tests covering class interface, exchange extraction, tool call handling, and NDJSON parsing

## Decisions Made
- Mastra NDJSON events are normalized to Claude-compatible message format in the ETM (same approach as copilot normalization) -- this keeps the downstream exchange extraction and LSL pipeline unchanged
- MastraTranscriptReader uses fs.watch + polling fallback for cross-platform reliability
- Agent identity added to ALL LSL session headers (not just mastra) -- improves traceability for all agent types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Force-added file past src/**/*.js gitignore rule**
- **Found during:** Task 1 (committing MastraTranscriptReader.js)
- **Issue:** .gitignore line 187 excludes `src/**/*.js`, but all existing src/live-logging/*.js files are tracked via git add -f
- **Fix:** Used `git add -f` to force-track the new file (same approach as all other files in src/live-logging/)
- **Files modified:** src/live-logging/MastraTranscriptReader.js
- **Verification:** File tracked and committed successfully
- **Committed in:** 327ea985 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor git workflow issue, no scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all code paths are wired to real implementations. MastraTranscriptReader is fully functional pending mastra lifecycle hooks writing actual NDJSON files to .observations/transcripts/.

## Next Phase Readiness
- Phase 21 complete: mastracode is fully integrated as `coding --mastra` with agent adapter, launch wrapper, statusline, health monitoring, and LSL transcript capture
- Mastra lifecycle hooks need to be configured to write NDJSON to .observations/transcripts/ for the reader to have actual input
- The ETM will automatically detect and process mastra transcripts when they appear

## Self-Check: PASSED

---
*Phase: 21-mastracode-agent-integration*
*Completed: 2026-04-02*
