---
phase: 22-transcript-converters
plan: 01
subsystem: live-logging
tags: [transcript, normalization, sqlite, llm-proxy, cli, esm]

# Dependency graph
requires:
  - phase: 20-foundation-opencode-om
    provides: "mastra plugin install, .observations/ directory structure, config.json"
provides:
  - "TranscriptNormalizer with parseClaude/parseCopilot/parseSpecstory"
  - "ObservationWriter class routing LLM calls through localhost:8089 proxy"
  - "CLI entry point (convert-transcripts.js) with subcommand routing"
  - "MastraDBMessage JSDoc typedef as shared contract"
affects: [22-02, 22-03, transcript-converters]

# Tech tracking
tech-stack:
  added: [better-sqlite3]
  patterns: [deterministic-id-hashing, llm-proxy-routing, esm-modules]

key-files:
  created:
    - src/live-logging/TranscriptNormalizer.js
    - src/live-logging/ObservationWriter.js
    - scripts/convert-transcripts.js
  modified: []

key-decisions:
  - "Deterministic SHA-256 IDs from content+timestamp for dedup across re-runs"
  - "better-sqlite3 (sync, already in project) over async LibSQL client"
  - "Fallback summary when LLM proxy unavailable (stores raw message stats)"
  - "Force-add JS files to git (src/**/*.js in .gitignore for compiled TS)"

patterns-established:
  - "MastraDBMessage shape: id, role, content, createdAt, metadata with agent/format/sourceFile"
  - "LLM proxy routing via fetch to localhost:8089/api/complete"
  - "process.stderr.write for all logging (no console.log)"

requirements-completed: [CONV-04]

# Metrics
duration: 7min
completed: 2026-04-03
---

# Phase 22 Plan 01: Shared Normalization Layer Summary

**Three-format transcript normalizer (Claude JSONL, Copilot events, specstory markdown) with LLM-proxy-routed observation writer and CLI skeleton**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-03T15:53:03Z
- **Completed:** 2026-04-03T15:59:50Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- TranscriptNormalizer exports parseClaude, parseCopilot, parseSpecstory returning MastraDBMessage-shaped objects
- ObservationWriter routes LLM summarization through localhost:8089 proxy (not direct API keys)
- CLI skeleton accepts claude/copilot/specstory subcommands with --batch/--force flags and --help output
- Deterministic ID generation prevents duplicates on re-runs

## Task Commits

Each task was committed atomically:

1. **Task 1: TranscriptNormalizer with three format parsers** - `6b0aa9a5` (feat)
2. **Task 2: ObservationWriter with LLM proxy routing and CLI skeleton** - `e08250bc` (feat)

## Files Created/Modified
- `src/live-logging/TranscriptNormalizer.js` - Three format parsers (Claude JSONL, Copilot events, specstory markdown) returning MastraDBMessage objects
- `src/live-logging/ObservationWriter.js` - Observation writer with LLM proxy summarization and better-sqlite3 storage
- `scripts/convert-transcripts.js` - CLI entry point with subcommand routing, --batch/--force flags, stats reporting

## Decisions Made
- Used deterministic SHA-256 content hashing for message IDs to enable safe re-runs without duplicates
- Chose better-sqlite3 (synchronous, already available in project) over async LibSQL client for simplicity
- Implemented fallback summary when LLM proxy is unavailable rather than failing
- Force-added files to git since src/**/*.js is gitignored for compiled TypeScript output

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- src/**/*.js gitignore rule required `git add -f` for new JS files in src/live-logging/ (consistent with existing tracked files in that directory)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TranscriptNormalizer contract ready for Plan 02 (Claude converter) and Plan 03 (specstory batch converter)
- ObservationWriter ready to be consumed by all three converters
- CLI skeleton ready for subcommand handler implementation

---
*Phase: 22-transcript-converters*
*Completed: 2026-04-03*
