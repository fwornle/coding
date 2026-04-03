---
phase: 22-transcript-converters
plan: 03
subsystem: live-logging
tags: [transcript, specstory, batch-converter, idempotency, manifest]

# Dependency graph
requires:
  - phase: 22-transcript-converters
    plan: 01
    provides: "TranscriptNormalizer (parseSpecstory), ObservationWriter, CLI skeleton"
provides:
  - "SpecstoryBatchConverter with manifest-based idempotency"
  - "Working specstory subcommand in convert-transcripts CLI"
affects: [specstory-batch-conversion, observation-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [manifest-based-idempotency, atomic-file-writes, sha256-change-detection]

key-files:
  created:
    - src/live-logging/SpecstoryBatchConverter.js
  modified:
    - scripts/convert-transcripts.js

key-decisions:
  - "Manifest saved after each file for crash-safe incremental progress"
  - "Atomic manifest writes via temp file + rename to prevent corruption"
  - "Directories auto-batch without --batch flag (batch is default for specstory)"
  - "SHA-256 content hash detects file changes even without --force"

patterns-established:
  - "Manifest shape: { version: 1, files: { path: { hash, convertedAt, observationCount } } }"
  - "Chronological processing via alphabetical filename sort (YYYY-MM-DD prefix)"

requirements-completed: [CONV-03]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 22 Plan 03: Specstory Batch Converter Summary

**Batch .specstory converter with SHA-256 manifest idempotency, chronological processing, and --force override**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T16:03:58Z
- **Completed:** 2026-04-03T16:07:04Z
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 1

## Accomplishments
- SpecstoryBatchConverter class scans directories, sorts files chronologically, and converts via TranscriptNormalizer + ObservationWriter
- Manifest at .observations/conversion-manifest.json tracks converted files with SHA-256 content hashes
- Re-runs skip already-converted files (idempotency verified in test)
- --force flag overrides idempotency to re-process all files
- CLI specstory subcommand works with both directories and single .md files
- Crash-safe: manifest saved after each file conversion, atomic writes via temp+rename

## Task Commits

Each task was committed atomically:

1. **Task 1: SpecstoryBatchConverter with manifest idempotency** - `6cec3f3b` (feat)
2. **Task 2: Wire specstory subcommand handler in CLI** - `0312206b` (feat)

## Files Created/Modified
- `src/live-logging/SpecstoryBatchConverter.js` - Batch converter with directory scanning, manifest tracking, SHA-256 hashing, force flag support
- `scripts/convert-transcripts.js` - Replaced inline specstory handler with SpecstoryBatchConverter, updated help text, directories auto-batch
- `.observations/conversion-manifest.json` - Runtime manifest tracking converted files

## Decisions Made
- Manifest saved after each file (not at end) for crash-safe incremental progress
- Atomic manifest writes via temp file + rename to prevent corruption on crash
- Directories auto-batch without requiring --batch flag (batch is the natural behavior for specstory)
- SHA-256 content hash enables detecting file changes even without --force

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all functionality is fully wired.

## Issues Encountered
- LLM proxy returns 400 for summarization (model provider routing) but fallback summary works correctly; this is pre-existing behavior from ObservationWriter

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three converters (claude, copilot, specstory) now have working subcommand handlers
- Specstory batch conversion ready for production use on .specstory/history/ directory

---
*Phase: 22-transcript-converters*
*Completed: 2026-04-03*
