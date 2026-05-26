---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 05
subsystem: infra
tags: [phase-51, mastra, sweep, path-b, ndjson, adapter, forward-compat, sub-agent]

# Dependency graph
requires:
  - phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
    provides: "Plan 51-01 — adapter loader contract (lib/lsl/adapters/index.mjs AGENTS + loadAdapter + getAgentSearchPaths) + registry row schema (lib/lsl/registry.mjs createRegistry)"
  - phase: 50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r
    provides: "lib/lsl/scan-and-convert.mjs (convertTranscriptsToObservations + deriveProjectHint) imported unchanged per D-Reuse — adapter parses NDJSON at the adapter layer instead of modifying deriveProjectHint as RESEARCH-mastra.md suggested"
provides:
  - "Mastra Path B (sweep) adapter implementing the Plan 51-01 contract — agentId='mastra', storageType='ndjson'"
  - "Forward-compat hook for sub-agent NDJSON records (subagent_start / subagent_end / inner messages tagged with subAgentSessionId) — zero re-planning needed when mastracode adds sub-agents"
  - "session_start boundary tracking + multi-session NDJSON partitioning by sessionId (RESEARCH landmine #5 mitigation)"
  - "Path A documented NOT VIABLE for mastracode (RESEARCH §Detection plan — Path A locked verbatim in this SUMMARY)"
  - "loadAdapter('mastra') now resolves to the new file — replaces 'no adapter for mastra' stderr from Plan 51-01 dispatcher"
affects: [51-10-statusline, 51-11-launchd-closure, future-mastracode-sub-agent-support]

# Tech tracking
tech-stack:
  added: []  # Zero new package installs — T-51-05-SC mitigation
  patterns:
    - "Adapter parses NDJSON at the adapter layer rather than modifying Phase 50 deriveProjectHint() — honors D-Reuse cumulative gate even though RESEARCH-mastra.md suggested the alternative"
    - "Per-sub-agent partitioning by subAgentSessionId Map (not file-position) — handles multi-session NDJSON files where multiple parents interleave per RESEARCH landmine #5"
    - "Forward-compat scaffolding pattern — single adapter handles CURRENT (parent-only) AND FUTURE (sub-agent records) shapes; mismatched schema fails Tests 4-7 loudly rather than silently corrupting"
    - "Project mapping derived from filesystem ancestor of .observations/transcripts/ + allowlist regex /^[a-z0-9-]+$/i — project name NOT sourced from NDJSON cwd field (T-51-05-PI mitigation)"
    - "uid-check gate on dir + file before read — non-owned files skipped with stderr (T-51-05-FI mitigation)"

key-files:
  created:
    - "lib/lsl/adapters/mastra-ndjson.mjs (455 lines, 3 exports — adapter named export, parseMastraRecord helper, extractProjectFromPath helper)"
    - "tests/live-logging/adapter-mastra.test.js (281 lines, 13 tests covering contract + shape handling + safety + convertToObservations)"
    - "tests/fixtures/mastra/mastra-transcript-sample.jsonl (17 lines — Section A parent-only mastracode shape + Section B forward-compat 2-sub-agent shape)"
  modified: []  # D-Reuse: Phase 50 primitives untouched (git diff --stat clean)

key-decisions:
  - "Path A documented NOT VIABLE for mastracode — no spawn-time signal exists; the adapter is sweep-only and the recommendation is locked here verbatim per RESEARCH-mastra.md §Detection plan — Path A"
  - "Forward-compat hook scaffolds for the future without consuming current sub-agent records (none exist today); fallback `fallbackIndex` provides sub_index when subagent_start records omit the explicit subIndex field"
  - "Project derivation uses FILESYSTEM PATH ancestor of .observations/transcripts/, NOT the NDJSON cwd field — path-injection via cwd is the documented T-51-05-PI threat; allowlist regex /^[a-z0-9-]+$/i closes it"
  - "session_start records are tracked into a sessions Map for boundary detection (cwd + started_at/ended_at) even though current partitioning gets parent_session_id directly from the subagent_start record's sessionId field — preserves the boundary metadata for future shapes (e.g. session-scoped sub-agents without explicit sessionId on the subagent_start record)"
  - "convertToObservations re-streams the NDJSON per row (not in-memory cache) — keeps the discovery + conversion passes independent; correct under D-Reuse since each pass is bounded by RACE_GUARD_MS / MAX_FILE_BYTES already enforced at the Phase 50 primitive layer"
  - "Empty-rows-in → empty-results-out preserved verbatim — current parent-only NDJSON shape produces zero observation writes today, which is the correct steady-state behavior (no false-positive observations from non-sub-agent activity)"

patterns-established:
  - "Forward-compat adapter pattern — single sweep adapter handles current AND future schema shapes; schema drift in the agent produces test failures (Tests 4-7) instead of silent corruption"
  - "NDJSON sub-agent partitioning by sessionId Map keyed on subAgentSessionId (NOT file position) — required for any agent that writes interleaved multi-session NDJSON"

requirements-completed: []  # Phase 51 is an out-of-milestone bug-fix; plan frontmatter has requirements: []

# Metrics
duration: ~20min
completed: 2026-05-26
---

# Phase 51 Plan 05: Mastra Path B (Sweep) Adapter Summary

**Mastra-ndjson Path B sweep adapter — forward-compat scaffolding handling BOTH current parent-only mastracode NDJSON AND the future sub-agent record shape (subagent_start / subagent_end / inner messages tagged with subAgentSessionId), with Path A documented NOT VIABLE per RESEARCH-mastra.md and D-Reuse cumulative gate green.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-26T17:00Z (approx — agent spawn before first commit)
- **Completed:** 2026-05-26T17:20Z (final feat commit `2c5b6bcfd`)
- **Tasks:** 1 (TDD RED + GREEN)
- **Files created:** 3 (1 production adapter + 1 test suite + 1 fixture)
- **Files modified:** 0 (Phase 50 primitives untouched per D-Reuse)

## Accomplishments

- **Adapter contract implemented** verbatim per Plan 51-01 — `agentId='mastra'`, `storageType='ndjson'`, with `discover()` and `convertToObservations()` methods matching the locked module shape.
- **Forward-compat hook landed.** The adapter handles BOTH the current mastracode shape (parent-only NDJSON — discover() returns [] with a single forward-compat stderr notice) AND the future sub-agent shape (subagent_start / subagent_end / inner messages tagged with subAgentSessionId — discover() emits one row per subagent_start). Zero re-planning needed when mastracode adds sub-agents.
- **Multi-session NDJSON partitioning.** Per RESEARCH-mastra.md landmine #5, sub-agents are partitioned by the `sessionId` field on the `subagent_start` record, NOT by file position. Multi-session interleave (Test 7) locks this behavior.
- **session_start boundaries tracked** into a `sessions` Map (cwd + started_at + ended_at per sessionId) — preserved for future shapes where sub-agents may not carry an explicit sessionId on the subagent_start record.
- **Threat mitigations honored.** uid-check on dir + file (T-51-05-FI); project name derived from filesystem ancestor of `.observations/transcripts/` with `/^[a-z0-9-]+$/i` allowlist (T-51-05-PI); empty / missing files no-op (T-51-05-NX); schema drift fails Tests 4-7 loudly (T-51-05-FC); zero new package installs (T-51-05-SC).
- **`loadAdapter('mastra')` now resolves** to the new file — replaces the "no adapter for mastra" stderr from Plan 51-01's dispatcher. End-to-end smoke confirmed via `node -e "import('./lib/lsl/adapters/index.mjs').then(({loadAdapter}) => loadAdapter('mastra'))"`.
- **13 new tests** in `tests/live-logging/adapter-mastra.test.js`, all passing. Phase 50 47-test regression suite + Phase 51 Plan 01 19-test suite stay green (8 suites / 79 tests in the combined live-logging run).

## Task Commits

Each task was committed atomically as a RED → GREEN pair:

1. **Task 1 RED: failing adapter tests + fixture** — `bf41c5889` (test)
2. **Task 1 GREEN: implement mastra-ndjson adapter** — `2c5b6bcfd` (feat)

**Plan metadata:** committed via this SUMMARY (worktree mode — STATE.md / ROADMAP.md owned by orchestrator after merge).

## Files Created/Modified

### Production code

- **`lib/lsl/adapters/mastra-ndjson.mjs`** (455 lines) — Mastra Path B sweep adapter.
  - `parseMastraRecord(line)` helper — JSON.parse with try/catch; returns null on parse error or empty line.
  - `extractProjectFromPath(filePath)` helper — walks up from the file path looking for `.observations/transcripts/`; returns path.basename of the owning directory; validates against `/^[a-z0-9-]+$/i`; returns null on failure.
  - `adapter.discover({searchPaths, project, since})` — for each searchPath: statSync + uid-check on dir; lists `*.jsonl` / `*.ndjson` files (non-recursive — mastracode writes flat in `.observations/transcripts/`); statSync + uid-check on each file; stream-parses via readline; tracks `sessions` Map + `subAgents` Map; partitions by sessionId per RESEARCH landmine #5; emits one RegistryRow per subagent_start; emits stderr forward-compat notice when zero subagent_start records were seen.
  - `adapter.convertToObservations(rows, {dryRun, tag})` — late-imports ObservationWriter (so tests can mock it); for each row: re-streams the transcript, collects inner messages where `subAgentSessionId === row.agent_metadata.subAgentSessionId`, calls `writer.processMessages(messages, metadata)` with per-row metadata (agent='mastra', project, parent_session_id, sub_index, sub_hash, tag, source, sourceFile).

### Tests

- **`tests/live-logging/adapter-mastra.test.js`** (281 lines, 13 tests) — covers:
  - Test 1 — adapter export shape
  - Tests 2-3 — empty / missing transcripts dir → [] no-op
  - Test 4 — parent-only NDJSON → 0 rows + forward-compat stderr notice
  - Test 5 — single subagent_start → 1 row with full metadata
  - Test 6 — two sub-agents in same file → sub_index=1,2 from explicit subIndex field
  - Test 7 — multi-session NDJSON → partition by sessionId, NOT by file position
  - Test 8 — project derived from filesystem ancestor of `.observations/transcripts/`
  - Test 9 — project allowlist regex (skip bad names with stderr)
  - Test 10 — uid-check (statSync mocked to foreign uid → skip with stderr)
  - Tests 11-13 — convertToObservations dryRun + writer call + empty-rows-in → empty-results-out

### Fixture

- **`tests/fixtures/mastra/mastra-transcript-sample.jsonl`** (17 lines, two sections):
  - **Section A (lines 1-7):** current mastracode shape — session_start + 2 messages + onToolCall + onToolResult + 1 user message + session_end. NO subagent_start. Drives Test 4.
  - **Section B (lines 8-17):** forward-compat — parent session_start + 2 subagent_start/end pairs (subIndex 1 'reviewer' + subIndex 2 'tester') with 2 inner messages per sub-agent + session_end. Drives Tests 5 + 6.

## Path A NOT VIABLE — RESEARCH locked

Per RESEARCH-mastra.md §Detection plan — Path A (verbatim, 2026-05-26):

> **Recommendation: sweep-only for Mastra. Defer Path A indefinitely.**
>
> Rationale:
>
> 1. **No sub-agent boundary in current transcripts** — there is nothing to spawn-hook into. The whole point of Path A is to register a sub-agent's transcript path at spawn time so the live writer can tail it. For mastracode, the parent's transcript IS the only transcript, and the existing `MastraTranscriptReader` already tails it (if ETM is configured per `findMastraTranscriptDir()` at `scripts/enhanced-transcript-monitor.js:1113-1131`).
> 2. **No spawn-time signal** to hook into. `mastracode` doesn't fire a "sub-agent started" lifecycle event; the closest signal is a `PreToolUse` with `tool_name: "subagent.*"`, and **no evidence this convention exists**. Hooking arbitrary `PreToolUse` would generate massive false positives (every Bash/Read/Write tool call would look like a sub-agent spawn).
> 3. **`MastraTranscriptReader` is unmaintained for sub-agents.** The reader (`src/live-logging/MastraTranscriptReader.js:326-349`) detects parent-only `user -> assistant` exchanges. Even if we wanted to wire it in, the parent-session lifecycle plumbing already covers what we'd get.

**Operational consequence:** Phase 51 Wave 4 has only three plans (claude / opencode / copilot live hooks). There is no `51-XX-mastra-live` plan and there should not be one — re-research only if a future mastracode release surfaces a spawn-time event.

## Forward-Compat Hook Explanation

When mastracode adds sub-agent support in the future, the adapter requires **zero re-planning**:

1. **Today (current mastracode shape):** the adapter's `discover()` walks `.observations/transcripts/`, finds the parent-only `mastra-transcript.jsonl`, parses it, sees zero `subagent_start` records, and emits to stderr:
   ```
   [mastra-adapter] no sub-agent records in <file> (parent-only mastracode shape; forward-compat hook ready)
   ```
   Returns `[]`. Steady-state empty-loop is the correct behavior — mastracode has no sub-agents to capture in the first place.

2. **Tomorrow (forward-compat shape):** mastracode begins emitting:
   ```ndjson
   {"type":"subagent_start","sessionId":"<parent>","subAgentSessionId":"<sub>","subIndex":N,"subName":"reviewer","timestamp":"..."}
   {"type":"message","role":"assistant","content":"...","sessionId":"<sub>","subAgentSessionId":"<sub>","timestamp":"..."}
   {"type":"subagent_end","sessionId":"<parent>","subAgentSessionId":"<sub>","timestamp":"..."}
   ```
   The adapter immediately starts emitting RegistryRow per subagent_start. No code changes. No re-research. The `lsl_incomplete: false` metadata flag locks that mastra's forward-compat shape carries inner messages (unlike Copilot's lossy events stream).

3. **Schema drift (mastracode emits a DIFFERENT shape):** Tests 4-7 fail loudly. The recognizer set (`session_start`, `session_end`, `message`, `onToolCall`, `onToolResult`, `subagent_start`, `subagent_end`) in `parseTranscriptFile()` is the audit surface — when mastracode changes the type discriminator (e.g. `subagent.start` dotted vs `subagent_start` snake_case), update the switch and rerun Tests 4-7.

## Empty-File No-Op Behavior — Steady State

For the foreseeable future, the operator's steady-state experience is:

```bash
$ node scripts/sweep-sub-agents.mjs --agent mastra --project coding --dry-run
[mastra-adapter] no sub-agent records in /Users/Q284340/Agentic/coding/.observations/transcripts/mastra-transcript.jsonl (parent-only mastracode shape; forward-compat hook ready)
[sweep] agent=mastra discovered=0 converted=0 skipped=0 failed=0
```

Or, if `.observations/transcripts/` is empty entirely:

```bash
[sweep] agent=mastra discovered=0 converted=0 skipped=0 failed=0
```

Neither output is an error. The mastra branch correctly contributes zero observations to the agent-agnostic sweep because mastracode has no sub-agents.

## Phase 50 D-Reuse Status (cumulative gate)

```
$ git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs
(empty output — D-Reuse honored)
```

RESEARCH-mastra.md §Detection plan — Path B suggested modifying `deriveProjectHint()` in `lib/lsl/scan-and-convert.mjs` to add a `/.observations/transcripts/` branch. This plan instead parses NDJSON at the adapter layer with its own `extractProjectFromPath()` helper — honors D-Reuse cumulative gate. Phase 50's primitive remains byte-identical.

Phase 50's 47-test regression suite (lsl-window + scan-and-convert + resolve-observations-from-lsl + ObservationWriter.prior-context-lsl + ObservationWriter.needs-lsl-resolution) still passes verbatim after Plan 51-05.

## Test Count + Pass Status

| Suite | Tests | Status |
|---|---|---|
| tests/live-logging/adapter-mastra.test.js | 13 | passed |
| tests/live-logging/sub-agent-registry.test.js (Plan 51-01) | 12 | passed |
| tests/live-logging/sweep-sub-agents-dispatcher.test.js (Plan 51-01) | 7 | passed |
| tests/live-logging/scan-and-convert.test.js (Phase 50) | 6 | passed |
| tests/live-logging/lsl-window.test.js (Phase 50) | 14 | passed |
| tests/live-logging/resolve-observations-from-lsl.test.js (Phase 50) | 12 | passed |
| tests/live-logging/ObservationWriter.prior-context-lsl.test.js (Phase 50) | 7 | passed |
| tests/live-logging/ObservationWriter.needs-lsl-resolution.test.js (Phase 50) | 8 | passed |
| **Combined live-logging regression** | **79** | **passed (8 suites)** |

Run command:
```bash
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest \
  tests/live-logging/adapter-mastra.test.js \
  tests/live-logging/sub-agent-registry.test.js \
  tests/live-logging/sweep-sub-agents-dispatcher.test.js \
  tests/live-logging/scan-and-convert.test.js \
  tests/live-logging/lsl-window.test.js \
  tests/live-logging/resolve-observations-from-lsl.test.js \
  tests/live-logging/ObservationWriter.prior-context-lsl.test.js \
  tests/live-logging/ObservationWriter.needs-lsl-resolution.test.js \
  --no-coverage
# Test Suites: 8 passed, 8 total
# Tests:       79 passed, 79 total
```

## Acceptance Grep Gates

| Gate | Expected | Actual | Status |
|---|---|---|---|
| `grep -F "subagent_start" lib/lsl/adapters/mastra-ndjson.mjs` | ≥1 | 7 | ✓ |
| `grep -F "session_start" lib/lsl/adapters/mastra-ndjson.mjs` | ≥1 | 4 | ✓ |
| `grep -F "subAgentSessionId" lib/lsl/adapters/mastra-ndjson.mjs` | ≥2 | 17 | ✓ |
| `grep -F "fs.statSync" lib/lsl/adapters/mastra-ndjson.mjs` | ≥1 | 2 | ✓ |
| `grep -E "/\^\[a-z0-9-\]\+\\\$/i" lib/lsl/adapters/mastra-ndjson.mjs` | ≥1 | 1 | ✓ |
| `grep -c "console\." lib/lsl/adapters/mastra-ndjson.mjs` | =0 | 0 | ✓ |
| `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` | 0 files | 0 files | ✓ |
| `git diff package.json` | 0 lines | 0 lines | ✓ |
| 2 commits: `test(51-05):` + `feat(51-05):` | 2 | 2 | ✓ |
| `adapter-mastra.test.js` | 13/13 pass | 13/13 | ✓ |

## Decisions Made

- **Path A documented NOT VIABLE** — per RESEARCH-mastra.md verbatim quote above. Mastra has only three downstream Wave 4 plans (claude / opencode / copilot), no `51-XX-mastra-live` plan. Documented in this SUMMARY so future maintainers know not to attempt a spawn hook before re-researching mastracode releases.
- **Adapter-layer NDJSON parsing instead of modifying `deriveProjectHint()`** — RESEARCH-mastra.md suggested adding a `/.observations/transcripts/` branch to Phase 50's `deriveProjectHint()`. This plan instead implements `extractProjectFromPath()` locally in the adapter to honor D-Reuse cumulative gate. Trade-off: small duplication of "walk up the path" logic; benefit: Phase 50 primitive remains byte-identical and its 47-test regression suite is not re-verified per Phase 51 plan.
- **Forward-compat scaffolding for sub-agent records** — the adapter parses `subagent_start` / `subagent_end` / inner messages today even though mastracode emits zero such records. Mastra has no sub-agents in production, so the parser is dormant — but if mastracode adds them in the future, the adapter starts emitting RegistryRows with zero re-planning.
- **session_start boundary tracking** — sessions Map records cwd + started_at + ended_at per sessionId even though current partitioning uses the `sessionId` field on `subagent_start` directly. Preserved for future shapes where sub-agents may not carry an explicit sessionId on the subagent_start record (e.g. session-scoped sub-agents that derive parent_session_id from the most-recent session_start).
- **`lsl_incomplete: false` flag locked** — unlike Copilot's lossy events stream (Plan 51-04 likely sets `lsl_incomplete: true` because events stream truncates per RESEARCH-copilot.md), mastra's forward-compat NDJSON shape carries the inner messages bracketed by `subagent_start` / `subagent_end`. The `false` value is a forward contract — if mastracode emits sub-agents without inner messages, this changes and Tests 5-6 will need updating.
- **No new package installs** (T-51-05-SC mitigation) — `git diff package.json` returns 0 lines. The adapter uses only `node:fs`, `node:path`, `node:readline`, `node:process` from the stdlib.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<acceptance_criteria>` block listed all six grep gates and the 13-test verification. Every gate was satisfied on the first GREEN attempt; no Rule 1/2/3 deviations were required.

The one minor judgment call was choosing to emit a project-allowlist failure stderr via the literal string `invalid project path (allowlist failed)` — the plan text (Test 9) only required `'invalid project path'`. The actual stderr matches the `invalid project path` substring per Test 9's regex.

## Issues Encountered

None. Tests passed on the first GREEN attempt.

The RED test for Test 10 (uid-check) initially required some care to construct a Stats-like Proxy that overrides only the `uid` property while letting `isFile()` / `isDirectory()` flow through to the real stat. The Proxy pattern (vs full fake object) keeps the test compatible with Node's stat shape across versions.

## User Setup Required

None — no external service configuration required. The adapter is loaded by Plan 51-01's `loadAdapter('mastra')` automatically; the dispatcher (`scripts/sweep-sub-agents.mjs --agent mastra`) finds it via prefix match.

## Next Phase Readiness

**Wave 2 mastra branch complete.** With Plan 51-05 landed:

- `loadAdapter('mastra')` no longer returns null — sweep dispatcher's mastra branch flows through to discovery
- `scripts/sweep-sub-agents.mjs --agent mastra --project coding --dry-run` produces the forward-compat stderr notice + `discovered=0` (correct steady state)
- The agent-agnostic sweep over claude / opencode / copilot / mastra now has full 4-agent coverage at the adapter layer (subject to Plans 51-02 / 51-03 / 51-04 landing for the other three)

**Wave 4 implication:** there is NO `51-XX-mastra-live` plan. Wave 4 has only three plans (claude / opencode / copilot live hooks). Path A is locked NOT VIABLE; re-evaluate only if a future mastracode release exposes a spawn-time event.

**Wave 6 closure implication:** the final 6-AC verification's "Agent-agnostic" criterion will be satisfied with zero observations from mastra — `metadata.agent='mastra'` rows will only appear if/when mastracode begins emitting sub-agent records. The forward-compat hook is the audit trail that the adapter is ready when that change ships.

## Self-Check: PASSED

Created files exist (verified):

- `lib/lsl/adapters/mastra-ndjson.mjs` ✓ (455 lines)
- `tests/live-logging/adapter-mastra.test.js` ✓ (281 lines)
- `tests/fixtures/mastra/mastra-transcript-sample.jsonl` ✓ (17 lines)

Commits exist (verified via `git log --oneline 59e613c7b..HEAD`):

- `bf41c5889` ✓ (Task 1 RED — failing tests + fixture)
- `2c5b6bcfd` ✓ (Task 1 GREEN — adapter implementation)

Test runs (verified):

- Phase 51 Plan 05 adapter-mastra suite: 13/13 passed ✓
- Phase 51 Plan 01 + Phase 50 combined regression: 79/79 across 8 suites passed ✓

D-Reuse cumulative gate (verified):

- `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` returns 0 files ✓

Acceptance grep gates (all 9 verified): ✓ — see table above.

---

*Phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as*
*Plan: 05*
*Completed: 2026-05-26*
