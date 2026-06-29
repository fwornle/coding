---
phase: 75-measurement-attribution-accuracy-observation-linkage
plan: 03
subsystem: token-attribution
tags: [stop-adapter, foreground-capture, no-double-count, cladpt, task-id-stamp, attr-03, d-04, wave-2]

# Dependency graph
requires:
  - phase: 75-measurement-attribution-accuracy-observation-linkage
    plan: 01
    provides: "RED node:test tests/lsl/token/stop-adapter-registry.test.mjs + main-session.jsonl fixture"
  - phase: 69-claude-copilot-adapters
    provides: "buildClaudeTokenRows (uid-gated extractor) + token-db insert/dedup + ADAPTER_USER_HASH_* constants + resolveLiveTaskIdSafe"
provides:
  - "STOP_ADAPTERS per-agent registry (claude=transcript, copilot/opencode/mastra=stamp-only) — the D-04 no-double-count contract"
  - "captureForegroundTokens(span, opts) — stop-time foreground capture that stamps cladpt rows with the active task_id, idempotently"
  - "default time-window main-session JSONL locator (injectable override for tests / measurement-stop)"
affects: [75-04-measurement-stop-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-agent registry keyed map { mode, userHash?, build? } — single transcript build binding (claude) is the grep-gated no-double-count invariant"
    - "Compose-three-primitives (buildClaudeTokenRows + insertTokenRowDeduped + resolveLiveTaskIdSafe) — no re-extraction, caller stamps task_id"
    - "Best-effort capture (D-08): whole body try/catch -> process.stderr.write, DB close in finally; never crashes the stop close"

key-files:
  created:
    - lib/lsl/token/stop-adapter-registry.mjs
  modified: []

key-decisions:
  - "captureForegroundTokens accepts BOTH the test seam (opts.dbPath/mainSessionPath/resolveTaskId) AND the production defaults (resolveLiveTaskIdSafe + DEFAULT_TOKEN_DB + time-window locator). Agent comes from opts.agent ?? span.agent."
  - "Unknown agents are treated like stamp-only (return 0, zero transcript work) — fail-safe against double-count for any future agent not yet in the registry."
  - "The located path is passed STRAIGHT to buildClaudeTokenRows; the module performs NO .uid inspection (grep-verified zero `.uid`), so the V4 uid-gate stays solely inside the extractor."

requirements-completed: [ATTR-03]

# Metrics
duration: 8min
completed: 2026-06-29
---

# Phase 75 Plan 03: Per-agent Stop-Adapter Registry & Foreground Token Capture Summary

**A per-agent registry that captures ONLY the proxy-bypassing foreground agent (claude → cladpt transcript rows stamped with the active task_id) while leaving proxy-routed agents (copilot/opencode/mastra) stamp-only — closing the ATTR-03 gap where a measured Opus session recorded 0 cladpt rows, without double-counting tokens that are already in `token_usage` via the proxy.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-06-29
- **Tasks:** 1
- **Files modified:** 1 (1 created)

## Accomplishments

- `lib/lsl/token/stop-adapter-registry.mjs` exports:
  - `STOP_ADAPTERS` — `claude` is the ONLY transcript adapter (`mode:'transcript'`, `userHash:'cladpt'`, `build: buildClaudeTokenRows`); `copilot`/`opencode`/`mastra` are `mode:'stamp-only'` with **no** `build` property (the D-04 no-double-count guard).
  - `captureForegroundTokens(span, opts)` — dispatches on the agent: stamp-only / unknown agents return immediately doing zero transcript work; the claude path resolves the active `task_id`, locates the main-session JSONL by time-window, passes that path STRAIGHT to `build()` (uid-gate intact), then idempotently inserts each row stamped with `cladpt` + the active `task_id`.
- Composes the three existing primitives verbatim — `buildClaudeTokenRows` (transcript→rows, uid-gated), `insertTokenRowDeduped` ((user_hash, tool_call_id) natural-key dedup), `resolveLiveTaskIdSafe` (best-effort task_id) — no re-implementation.
- Turns the Wave-0 RED `tests/lsl/token/stop-adapter-registry.test.mjs` GREEN (5/5).

## Task Commits

1. **Task 1: per-agent registry + claude transcript capture** — `1cb07749c` (feat)

## Files Created/Modified

- `lib/lsl/token/stop-adapter-registry.mjs` *(created)* — `STOP_ADAPTERS` registry + `captureForegroundTokens` + default time-window `locateMainSessionJsonl`. Wiring into `measurement-stop.mjs` is Plan 04.

## Verification

- `node --test tests/lsl/token/stop-adapter-registry.test.mjs` → **5/5 pass** (the plan's acceptance command).
  - claude inserts cladpt rows stamped with `m-stop-1`; opencode (stamp-only) inserts nothing; idempotent re-run dedups; fixture parses through `buildClaudeTokenRows`.
- Acceptance greps:
  - `grep -nE "mode: *'stamp-only'"` → copilot, opencode, mastra (3) ✓
  - `grep -c "build:"` → **1** (claude only — the no-double-count invariant) ✓
  - `grep "insertTokenRowDeduped|resolveLiveTaskIdSafe|buildClaudeTokenRows"` → all three imported and used ✓
  - `grep "\.uid"` → **zero matches** — the uid-gate stays solely inside `buildClaudeTokenRows`; this module performs no uid inspection ✓

## Deviations from Plan

### Auto-fixed / Noted Issues

**1. [Rule 1 — acceptance-grep precision] `grep -c "build:"` initially returned 2**
- **Found during:** Task 1 acceptance grep gate.
- **Issue:** A docstring line literally contained the substring `` `build:` `` (describing the invariant), so the count-grep saw 2 even though there is only ONE real `build:` binding (claude).
- **Fix:** Reworded the docstring to "single transcript-build binding" so the grep gate reflects the real binding count. `grep -c "build:"` now returns **1**.
- **Files modified:** lib/lsl/token/stop-adapter-registry.mjs
- **Commit:** 1cb07749c

**2. [Noted — grep vs. required functionality] `grep "fs.statSync"` matches the time-window locator**
- **Found during:** the "no weaker uid re-stat" acceptance grep (`fs.statSync|getuid`, expected zero matches).
- **Issue:** The default main-session locator MUST read each candidate file's `.mtimeMs` to apply the span time-window filter — the plan itself sanctions this ("locate by time-window (mtime/last-message ts ∈ [started_at, ended_at])"). That read uses `fs.statSync(full).mtimeMs`, which the literal grep flags.
- **Why it is NOT a violation:** The acceptance criterion's intent is "no weaker **uid** re-stat — the gate stays inside `buildClaudeTokenRows`." This module inspects **no `.uid`** at all (`grep "\.uid"` → zero matches); the only `statSync` reads `mtimeMs` for the required time-window, then passes the located path STRAIGHT to `buildClaudeTokenRows` where the real `st.uid === process.getuid()` gate runs unchanged. The threat-model invariants T-75-31 (uid-gate) and T-75-32 (time-window locator) are BOTH satisfied — the literal grep is a coarse proxy for the uid concern and the time-window mtime read is the sanctioned, distinct functionality.
- **Action:** No code change — the `fs.statSync(...).mtimeMs` time-window read is correct, required, and documented here. Constraint-dodging (aliasing the API to evade the grep) was deliberately NOT done per CLAUDE.md.

**3. [Note — directory-glob test invocation]**
- `node --test tests/lsl/token/` (directory form) errors with `Cannot find module .../tests/lsl/token` — a node test-runner quirk when handed a bare directory path, unrelated to this code. The plan's acceptance command is the explicit file form `node --test tests/lsl/token/stop-adapter-registry.test.mjs`, which is GREEN (5/5).

---

**Total deviations:** 1 auto-fixed (grep precision) + 2 documented notes (no code impact).
**Impact on plan:** None on behavior. The registry, capture semantics, no-double-count invariant, and uid-gate preservation all match the plan exactly.

## Authentication Gates

None.

## Known Stubs

None. `captureForegroundTokens` is fully wired against the three real primitives and exercised end-to-end (cladpt insert path) by the GREEN test. Production wiring into `measurement-stop.mjs` is intentionally deferred to Plan 04 (stated in the plan objective), not a stub.

## Threat Flags

None — no new security surface beyond the plan's threat register. The module reads only uid-owned transcript files (gate inside `buildClaudeTokenRows`), writes only distinct-`cladpt` rows via `insertTokenRowDeduped` (no schema migration), and adds no packages.

## User Setup Required

None.

## Next Phase Readiness

- **Plan 04** (measurement-stop wiring): import `captureForegroundTokens` and call `await captureForegroundTokens(span)` BEFORE `aggregateByTaskId` at the stop seam (`measurement-stop.mjs:296-313`), so the cladpt foreground rows exist when the fg/bg breakdown sums. Best-effort wrap per the established stop-path convention; add the A1 bypass-guard warning for in-scope agents with neither proxy nor adapter rows.

## Self-Check: PASSED

- `lib/lsl/token/stop-adapter-registry.mjs` exists on disk.
- Commit `1cb07749c` present in git log.
- `node --test tests/lsl/token/stop-adapter-registry.test.mjs` → 5/5 pass.

---
*Phase: 75-measurement-attribution-accuracy-observation-linkage*
*Completed: 2026-06-29*
