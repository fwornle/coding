---
phase: 30-claude-hook-adapter
plan: 01
subsystem: hooks
tags: [claude-code, hooks, knowledge-injection, retrieval, UserPromptSubmit]

requires:
  - phase: 29-retrieval-service
    provides: POST /api/retrieve endpoint on port 3033 returning token-budgeted markdown
provides:
  - Knowledge injection hook script that calls retrieval service on substantive prompts
  - Hook registration in .claude/settings.local.json alongside existing constraint monitor
  - Fail-open design ensuring Claude Code never blocked by retrieval service issues
affects: [31-working-memory, 32-agent-profiles]

tech-stack:
  added: []
  patterns: [UserPromptSubmit hook with additionalContext injection, fail-open HTTP with resolve(null)]

key-files:
  created:
    - src/hooks/knowledge-injection-hook.js
  modified:
    - .claude/settings.local.json

key-decisions:
  - "Plain JS (not TypeScript) for hook script -- matches existing hook pattern and server.js convention"
  - "MIN_WORDS=4 threshold instead of MIN_TOKENS=20 -- practical filtering for short acknowledgments"
  - "Budget 1000 tokens with threshold 0.75 for retrieval calls -- balances relevance with context size"

patterns-established:
  - "UserPromptSubmit hook pattern: stdin JSON parsing, prompt filtering (empty/slash/short), fail-open HTTP, single stdout.write"
  - "Multiple hooks per event: array entries in settings.local.json UserPromptSubmit run independently"

requirements-completed: [HOOK-01, HOOK-02, HOOK-03]

duration: 12min
completed: 2026-04-24
---

# Phase 30 Plan 01: Claude Hook Adapter Summary

**UserPromptSubmit hook injecting Qdrant-retrieved knowledge (insights, digests, entities, observations) as system-reminder context into Claude Code conversations with fail-open design**

## Performance

- **Duration:** ~12 min (across checkpoint pause)
- **Started:** 2026-04-24T17:11:00Z
- **Completed:** 2026-04-25T07:05:00Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 2

## Accomplishments
- Knowledge injection hook that calls POST /api/retrieve and injects returned markdown as system-reminder context
- Prompt filtering: empty prompts, slash commands, and short prompts (< 4 words) skip injection
- Fail-open design: 2-second HTTP timeout, 5-second safety ceiling, all errors resolve to null (no stdout = no injection)
- Registered alongside existing constraint monitor hook in .claude/settings.local.json
- Human-verified working end-to-end: insights and digests visible in Claude Code conversation context

## Task Commits

Each task was committed atomically:

1. **Task 1: Create knowledge injection hook script** - `09eeab9f` (feat)
2. **Task 2: Register hook and verify end-to-end** - `cce3129d` (feat)
3. **Post-checkpoint fix: stdin reading and word count threshold** - `e3315677` (fix)

Task 3 was a human-verify checkpoint -- approved by user after confirming knowledge injection visible in live session.

## Files Created/Modified
- `src/hooks/knowledge-injection-hook.js` - Hook script: reads stdin JSON, filters prompts, calls retrieval service, outputs additionalContext JSON
- `.claude/settings.local.json` - Added second UserPromptSubmit entry for knowledge injection hook

## Decisions Made
- Used plain JS (ESM) matching existing hook convention -- no TypeScript compilation needed
- Set MIN_WORDS=4 (changed from plan's MIN_TOKENS=20) as practical threshold for filtering acknowledgments
- Budget 1000 tokens with 0.75 relevance threshold balances quality with context window usage

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stdin reading guard and word count threshold**
- **Found during:** Post-Task 2 (during live testing before checkpoint)
- **Issue:** Two bugs: (a) `process.stdin.isTTY === false` guard was inverted -- when piped, isTTY is undefined (not false), so strict equality failed; (b) MIN_TOKENS=20 was too high -- most substantive prompts have fewer than 20 whitespace-separated words
- **Fix:** Changed to `!process.stdin.isTTY` (truthy check) and reduced threshold to MIN_WORDS=4
- **Files modified:** src/hooks/knowledge-injection-hook.js
- **Verification:** Tested with piped input -- hook correctly reads stdin and processes prompts
- **Committed in:** e3315677

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Bug fix was essential for the hook to function at all. No scope creep.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required. Hook is registered and active for any new Claude Code session started with `coding --claude` or `claude-mcp`.

## Next Phase Readiness
- Phase 30 complete -- Claude Code now receives knowledge injection on every substantive prompt
- Phase 31 (Working Memory) can build on the retrieval response format to add a persistent project state prefix
- Phase 32 (Agent Profiles) can follow the same hook pattern for OpenCode and Copilot adapters

---
*Phase: 30-claude-hook-adapter*
*Completed: 2026-04-24*
