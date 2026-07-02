---
phase: 67-reproducibility-replay-rig
plan: 02
subsystem: testing
tags: [reproducibility, replay, clock-shim, transcript-scrape, node-test, date-shim, harness]

# Dependency graph
requires:
  - phase: 67-01
    provides: "redacted transcript fixture (tests/repro/_fixtures/transcript-fragment.jsonl) + match-key/record/replay modules under lib/repro/fixtures/"
provides:
  - "lib/repro/fixtures/clock.mjs — deterministic freeze-base + monotonic-offset Date shim (installClock/clockBase)"
  - "lib/repro/fixtures/harness-record.mjs — real transcript record() + honest replay hard-fail (recordHarnessFixtures/replayHarnessChannel)"
  - "tests/repro/clock.test.mjs + tests/repro/harness-stub.test.mjs (14 node:test cases)"
affects: [67-05, 67-06, 67-07, measurement-start, measurement-stop, repro-restore, integration-layer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injectable now() seam for deterministic clock tests (no real sleeps)"
    - "Subclass-native-Date shim (ShimDate extends Date) preserving instanceof + statics"
    - "Record-present / replay-hard-fails honesty for non-tappable channels"

key-files:
  created:
    - lib/repro/fixtures/clock.mjs
    - lib/repro/fixtures/harness-record.mjs
    - tests/repro/clock.test.mjs
    - tests/repro/harness-stub.test.mjs
  modified: []

key-decisions:
  - "Clock shim subclasses native Date (ShimDate extends Date) rather than proxying — keeps instanceof Date and Date.parse/UTC statics native; only no-arg new Date() + Date.now() are shimmed"
  - "installClock accepts an injectable { now } seam so determinism/monotonicity are proven with a stubbed performance.now sequence, no real sleeps"
  - "clockBase exported as an ESM live-binding let so importers can inspect the last-installed base"
  - "Harness record anchors the span-window decision on the tool_use invocation timestamp; pairs it with its tool_result (content-array or top-level toolUseResult) by tool_use_id"
  - "MCP tool detection via the mcp__<server>__<tool> name convention (name.startsWith('mcp__')) alongside literal WebSearch/WebFetch"
  - "replayHarnessChannel always throws REPLAY_UNSUPPORTED_CHANNEL and never returns — honest hard-fail per D-06/D-08/SC-4"

patterns-established:
  - "Pattern: daemon-forbidden global shim — header explicitly forbids importing clock.mjs into long-running daemons (obs-api/proxy/health-coordinator); uninstall() reverses the Date override"
  - "Pattern: best-effort file-I/O recorder — recordHarnessFixtures wraps all I/O in try/catch, returns a written-count, never throws on the hot path, writes only under caller outDir"

requirements-completed: [REPRO-02]

# Metrics
duration: 12min
completed: 2026-07-02
---

# Phase 67 Plan 02: Clock Shim + Harness Channel (record-present / replay-hard-fails) Summary

**Shipped the two REPRO-02 channels with no proxy chokepoint: a deterministic freeze-base + monotonic-offset Date shim (replay-run entrypoints only, daemon-forbidden) and the WebSearch/WebFetch/MCP harness channel as an honest post-hoc transcript record() plus a replay() that hard-fails REPLAY_UNSUPPORTED_CHANNEL rather than silently hitting live services.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-02T15:05Z (worktree base)
- **Completed:** 2026-07-02
- **Tasks:** 2/2
- **Files created:** 4

## Accomplishments

### Task 1 — clock.mjs (deterministic freeze-base + monotonic-offset Date shim)

- `installClock(base, { now })` captures `replayStart = now()` and overrides the global `Date.now()` + no-arg `new Date()` to return `base + Math.round(now() - replayStart)`.
- Implemented as `class ShimDate extends NativeDate` so `instanceof Date` and the inherited statics (`Date.parse`, `Date.UTC`) stay native; only the no-arg constructor path and `Date.now` are shimmed. Parametrized `new Date(x)` is untouched.
- Returns an idempotent `{ uninstall() }` handle that restores the native `Date`.
- Exports `clockBase` as an ESM live-binding reflecting the last-installed base.
- Header comment forbids importing the shim into long-running daemons (obs-api, proxy, health-coordinator) per RESEARCH — freezing their wall clock would corrupt emitted timestamps.
- 7 node:test cases prove determinism (exact reproducible output from a stubbed `now` sequence), monotonicity (non-decreasing even with flat/fractional deltas), first-reading `>= base` within epsilon, no-arg vs parametrized `new Date()`, and native restoration after `uninstall()`.

### Task 2 — harness-record.mjs (transcript record() + honest replay hard-fail)

- `recordHarnessFixtures({ transcriptDir, startedAt, endedAt, outDir })` mirrors the `lib/lsl/route/build-trace.mjs` transcript-reader contract: resolves the transcript dir via `LSL_CLAUDE_PROJECTS_DIR` → `~/.claude/projects/-Users-Q284340-Agentic-coding` home default, reads `*.jsonl` line-by-line, indexes `tool_use` blocks for WebSearch/WebFetch/MCP tools, pairs them with their `tool_result` (content-array) or top-level `toolUseResult` by `tool_use_id`, keeps only those whose invocation timestamp is within `[startedAt, endedAt]` (inclusive lexical ISO-8601 compare), and writes each pair to `<outDir>/harness/`.
- Best-effort: all I/O wrapped in try/catch, returns a written-count (0 on any failure), never throws on the hot path; fixtures land only under the caller-provided `outDir` (T-67-02-01 — tool_result content may carry web content/PII).
- `replayHarnessChannel(name)` always throws `REPLAY_UNSUPPORTED_CHANNEL: <name>` and never returns a value — the honest hard-fail per D-06/D-08/SC-4 (harness tools run in the Claude harness, not the proxy; RESEARCH Assumption A1). Surfaced at span-open by the Plan 07 integration layer.
- 7 node:test cases: bracketing window writes ≥1 WebSearch fixture, excluding window writes 0, a bad transcript dir never throws (writes 0), and replay of WebSearch/WebFetch/MCP throws + never returns.

## Verification

- `node --test tests/repro/clock.test.mjs tests/repro/harness-stub.test.mjs` → **14 pass / 0 fail** (6 suites).
- `grep -n "REPLAY_UNSUPPORTED_CHANNEL" lib/repro/fixtures/harness-record.mjs` → present (throw site line 224).
- `grep -n "daemon" lib/repro/fixtures/clock.mjs` → present (header warning, 2 hits).
- key_links pattern `LSL_CLAUDE_PROJECTS_DIR|tool_result|toolUseResult` → all present in harness-record.mjs.

## Must-Haves Satisfied

- ✓ On replay the clock returns a deterministic monotonic value derived from the frozen snapshot base (D-08 clock).
- ✓ WebSearch/WebFetch/MCP tool results within the span window are recorded from the Claude transcript JSONL.
- ✓ Replay of a harness channel with no viable tap hard-fails REPLAY_UNSUPPORTED_CHANNEL (never silent degradation) (D-06/D-08/SC-4).

## TDD Gate Compliance

Each task followed RED → GREEN with distinct commits:

| Task | RED (test) | GREEN (feat) |
| ---- | ---------- | ------------ |
| 1 (clock) | `16cd54c23` | `ea4e40ad3` |
| 2 (harness) | `598690a2c` | `b9f57f59b` |

RED commits confirmed failing (module-missing import error) before implementation; GREEN commits confirmed passing. No unexpected RED passes.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes, no authentication gates, no checkpoints. No package-manager installs (Node built-ins + existing repo modules only, per threat register T-67-02-SC).

## Threat Register Dispositions

- **T-67-02-01** (harness fixture PII) — mitigated: fixtures written only under caller `outDir`; record best-effort; tests use `mkdtempSync` only, no tracked paths.
- **T-67-02-02** (false comparability) — mitigated: `replayHarnessChannel` throws, never fabricates/hits-live; asserted in test.
- **T-67-02-03** (global Date tampering) — mitigated: shim header-documented as daemon-forbidden; `uninstall()` restores natives (test-verified).

## Commits

- `16cd54c23` test(67-02): add failing determinism+monotonicity suite for clock shim
- `ea4e40ad3` feat(67-02): implement deterministic monotonic clock shim (D-08)
- `598690a2c` test(67-02): add failing harness record/replay-hard-fail suite
- `b9f57f59b` feat(67-02): harness transcript record() + honest replay hard-fail (D-08)

## Self-Check: PASSED

- Files: FOUND lib/repro/fixtures/clock.mjs, FOUND lib/repro/fixtures/harness-record.mjs, FOUND tests/repro/clock.test.mjs, FOUND tests/repro/harness-stub.test.mjs
- Commits: 16cd54c23, ea4e40ad3, 598690a2c, b9f57f59b all present in git log
