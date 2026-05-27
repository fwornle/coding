---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 11
subsystem: infra
status: tasks_1_and_2_complete_checkpoints_pending
tags: [phase-51, closure, launchd, health-coordinator, sub-agent-capture, final-verification, plan-50-03-mirror]

# Dependency graph
requires:
  - phase: 50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r
    provides: launchd/com.coding.lsl-resolver.plist + scripts/install-lsl-resolver-launchd.sh + scripts/lsl-resolver-job.sh template (Plan 50-03 mirror)
  - phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
    provides:
      - "Plan 51-01 — agent-agnostic sweep dispatcher (scripts/sweep-sub-agents.mjs invoked by sub-agent-sweep-job.sh)"
      - "Plan 51-07 — claude live daemon (scripts/sub-agent-live-claude.mjs wired to com.coding.sub-agent-live-claude.plist)"
      - "Plan 51-08 — opencode live daemon (scripts/sub-agent-live-opencode.mjs wired to com.coding.sub-agent-live-opencode.plist)"
      - "Plan 51-09 — copilot live daemon (scripts/sub-agent-live-copilot.mjs wired to com.coding.sub-agent-live-copilot.plist)"
      - "Plan 51-10 — lib/lsl/registry-reader.mjs (loadAllHeartbeats imported by health-coordinator)"
provides:
  - "launchd/com.coding.sub-agent-sweep.plist — 30-min sweep job (StartInterval=1800, no KeepAlive)"
  - "launchd/com.coding.sub-agent-live-claude.plist — KeepAlive=true (restart on crash)"
  - "launchd/com.coding.sub-agent-live-opencode.plist — KeepAlive=true (restart on crash)"
  - "launchd/com.coding.sub-agent-live-copilot.plist — KeepAlive=true (restart on crash)"
  - "scripts/install-sub-agent-launchd.sh — idempotent 4-plist installer"
  - "scripts/sub-agent-sweep-job.sh — wrapper around sweep-sub-agents.mjs with proxy probe + atomic state"
  - "scripts/health-coordinator.js — extended with sub_agent_capture block in /health/state (Path A)"
affects:
  - "Phase 51 closure (this is the final plan)"
  - "Dashboard knowledge-pipeline + sub-agent capture indicators (post-checkpoint)"
  - "Operator runbook: a single `bash scripts/install-sub-agent-launchd.sh` boots all 4 jobs"

# Tech tracking
tech-stack:
  added: []  # zero new npm packages across entire Phase 51 — T-51-11-SC mitigation honored
  patterns:
    - "launchd plist + idempotent installer + wrapper-script trio (Plan 50-03 verbatim, extended to 4-label iteration)"
    - "Per-job KeepAlive policy: KeepAlive=true for crashable live daemons + StartInterval=1800 for sweep (anti-tight-loop)"
    - "ThrottleInterval=60s on live daemons matches each daemon's >10-errors/60s self-exit gate"
    - "StandardErrorPath redirection into .data/live-<agent>.log keeps daemon heartbeat lines OUT of operator terminal"
    - "Pure additive dynamic-import for cross-module lazy load (registry-reader.mjs via import() so missing module doesn't crash coordinator at startup)"

key-files:
  created:
    - "launchd/com.coding.sub-agent-sweep.plist (30 lines)"
    - "launchd/com.coding.sub-agent-live-claude.plist (37 lines)"
    - "launchd/com.coding.sub-agent-live-opencode.plist (37 lines)"
    - "launchd/com.coding.sub-agent-live-copilot.plist (37 lines)"
    - "scripts/install-sub-agent-launchd.sh (executable, 102 lines)"
    - "scripts/sub-agent-sweep-job.sh (executable, 96 lines)"
    - "tests/integration/sub-agent-launchd-install.test.js (264 lines, 8 tests)"
    - "tests/integration/health-coordinator-sub-agent-block.test.js (158 lines, 6 tests)"
  modified:
    - "scripts/health-coordinator.js (+158 lines additive — sub_agent_capture default state + pollSubAgentCapture() + runAllChecks wire-up)"

key-decisions:
  - "Path A chosen for health-coordinator extension (not Path B documented skip) — registry-reader.mjs is already ESM-import-friendly and the integration is purely additive (~110 lines including jsdoc + defensive fallback). The Plan 50-03 architectural-drift concern does not apply here because Plan 51-10 specifically built the registry-reader to be a coordinator-friendly facade."
  - "Live-daemon stderr redirected to .data/live-<agent>.log per the user's `nohup ... >> .data/live-<agent>.log 2>&1 &` recipe (Wave-5 follow-up defect mitigation). Without this redirection the daemons' 30s heartbeat log lines would bleed into the operator's terminal and corrupt opencode/copilot TUIs. Plan PLAN.md interfaces block called for .logs/ — the user's explicit directive in execute-plan objective takes precedence."
  - "Live-daemon plists explicitly stamp --state-file with the agent-suffixed path (sub-agent-live-state-claude.json etc.) per registry-reader.mjs's HEARTBEAT_FILES contract. Without the explicit flag, sub-agent-live-claude.mjs's hardcoded default lacks the -claude suffix and Plan 51-10's reader can't find it."
  - "Dynamic-import of lib/lsl/registry-reader.mjs (instead of top-level import) means a stale/missing module never crashes the coordinator at startup — defensive per the coordinator's must-keep-running invariant. The cost (~1ms of import latency every 5s tick) is invisible at this cadence."
  - "Mastra slot in sub_agent_capture is forward-compat per RESEARCH-mastra.md — `available: false` with a documented reason is the permanent shape (no Path A spawn hook ever materializes)."

patterns-established:
  - "Multi-label launchd installer iteration: the PLISTS=(label1 label2 ...) array + bash for-loop is the canonical pattern for Phase 51+ rollouts that need >1 launchd job"
  - "Coordinator extension via dynamic-import of a Plan-X-built lib helper: the coordinator never hard-imports a lib/ module added in a separate plan to avoid coupling its startup to the helper's existence"
  - "Defensive aggregator-of-aggregator pattern: pollSubAgentCapture wraps registry-reader's already-defensive loadAllHeartbeats with one more try/catch, ensuring the coordinator's tick loop never gets corrupted"

requirements-completed: []

# Metrics
duration: ~25min (Tasks 1+2; Tasks 3+4 are human-verify checkpoints, not in this duration)
started: 2026-05-27T08:24:00Z
checkpoint_at: 2026-05-27T08:51:00Z
completed: PENDING_OPERATOR_VERIFICATION
files_created: 8
files_modified: 1
tests_added: 14
tests_passing: "14 of 14 (plus 7/7 Plan 50-03 regression + 10/10 Plan 51-10 regression = 31 green across the affected surface)"
---

# Phase 51 Plan 11: Launchd integration + health-coordinator sub_agent_capture (Tasks 1+2 complete; Tasks 3+4 await operator)

**Four launchd plists + idempotent installer + sweep wrapper + health-coordinator sub_agent_capture extension. All artifacts ready for operator install at the Task 3 checkpoint.**

## Performance

- **Duration:** ~25 min (Tasks 1+2 implementation)
- **Started:** 2026-05-27T08:24:00Z (worktree reset to base 613f34f23)
- **Checkpoint reached:** 2026-05-27T08:51:00Z
- **Tasks complete:** 2 of 4 (Task 1 launchd artifacts; Task 2 health-coordinator extension)
- **Tasks pending:** 2 of 4 (Task 3 operator install + smoke verify; Task 4 final phase verification)
- **Files created:** 8
- **Files modified:** 1
- **Tests added:** 14 (8 launchd integration + 6 health-coordinator integration)

## Accomplishments

- **Four launchd plists** matching Plan 50-03's verbatim shape (Label, ProgramArguments, ThrottleInterval, WorkingDirectory, EnvironmentVariables.PATH). One sweep job + three live daemons. Sweep has StartInterval=1800 (30 min) with NO KeepAlive (avoids tight-loop on failure per Plan 50-03 precedent). Live daemons have KeepAlive=true with SuccessfulExit=false + ThrottleInterval=60s (anti-tight-loop guard matches each daemon's >10-errors/60s self-exit gate from Plan 51-07/08/09).
- **Stderr redirection into `.data/live-<agent>.log`** for every live daemon (and `.data/live-sub-agent-sweep.log` for the sweep). This is the Wave-5 follow-up defect mitigation — the daemons emit a heartbeat log line to stderr every 30s, which would otherwise bleed into the operator's terminal under bare `&` invocation (corrupting opencode/copilot TUIs). Matches the user's `nohup ... >> .data/live-<agent>.log 2>&1 &` recipe verbatim.
- **Idempotent 4-label installer** (`scripts/install-sub-agent-launchd.sh`) iterates the PLISTS=(...) array via bash for-loop, doing `plutil -lint` + `diff -q` short-circuit + bootout-before-bootstrap per label. Final `launchctl list | grep -qF` registration check exits non-zero if bootstrap silently dropped any job. Pre-creates `.data/` so the stderr-log destinations exist before launchd binds.
- **Sweep wrapper** (`scripts/sub-agent-sweep-job.sh`) mirrors `scripts/lsl-resolver-job.sh` line-by-line with label swaps: `set -euo pipefail` immediately after shebang (Plan 50-03 done-criterion grep `head -3 ... | grep -F` passes verbatim) + LLM proxy reachability probe (2xx/4xx OK, everything else → exit 0 to avoid launchd spam) + `--since` resumes from `.data/sub-agent-sweep-state.json` or defaults to 7 days ago + atomic `.tmp + mv` state write + `SWEEP_BIN` env override for testability. Zero `console.*` calls (it's bash; matches the Plan 50-03 grep gate).
- **Health-coordinator sub_agent_capture extension (Path A)** — `scripts/health-coordinator.js` now stamps `currentState.sub_agent_capture` every tick. The new `pollSubAgentCapture()` async function:
  1. Dynamic-imports `lib/lsl/registry-reader.mjs` (Plan 51-10's defensive aggregator) so a stale/missing module never crashes the coordinator at startup
  2. Reads heartbeat files via `loadAllHeartbeats({stateDir: '.data'})` — Plan 51-10's uid-check + stale-mtime gate
  3. Reads `.data/sub-agent-sweep-state.json` for `last_sweep_at`
  4. Aggregates per-agent counters + decides status: `healthy` (any fresh) / `degraded` (files exist but all stale OR sweep ran without live tier) / `unknown` (cold boot, no evidence)
  5. Mastra slot is forward-compat per RESEARCH-mastra.md — `available: false` is permanent
- **8 launchd integration tests** + **6 health-coordinator integration tests** = **14 new tests**, all green. Phase 50-03 regression suite (7 tests) + Plan 51-10 regression suite (10 tests) both stay green. **CLAUDE.md no-console-log compliance preserved**: baseline 0 → 0 in both modified files.
- **D-Reuse cumulative gate clean** — `git diff --stat 613f34f23..HEAD lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` returns 0 files changed (Phase 50 primitives untouched across all 11 plans of Phase 51).
- **T-51-11-SC mitigation honored** — zero new npm packages across the entire Phase 51 (`git diff package.json` returns 0 lines changed cumulatively).

## Task Commits

Each task was committed atomically on the worktree branch:

1. **Task 1a: Plists + installer + sweep wrapper** — `df77bd164` (feat)
2. **Task 1b: 8 integration tests for launchd plists** — `916279bef` (test)
3. **Task 2: health-coordinator sub_agent_capture block (Path A) + 6 tests** — `ac79467b7` (feat)
4. **Task 3: human-verify checkpoint — operator install** — PENDING (orchestrator must surface this checkpoint to user)
5. **Task 4: human-verify checkpoint — final phase verification** — PENDING (operator runs a fresh `/gsd-execute-phase` and validates all 6 CONTEXT.md ACs)

## Files Created/Modified

### Created

- `launchd/com.coding.sub-agent-sweep.plist` — 30-min sweep launchd definition (StartInterval=1800, no KeepAlive)
- `launchd/com.coding.sub-agent-live-claude.plist` — Claude live daemon definition (KeepAlive=true, ThrottleInterval=60, stderr→.data/live-claude.log)
- `launchd/com.coding.sub-agent-live-opencode.plist` — OpenCode live daemon definition
- `launchd/com.coding.sub-agent-live-copilot.plist` — Copilot live daemon definition
- `scripts/install-sub-agent-launchd.sh` — Idempotent installer that iterates the 4-label array (executable)
- `scripts/sub-agent-sweep-job.sh` — Wrapper around `scripts/sweep-sub-agents.mjs` with proxy probe + atomic state (executable)
- `tests/integration/sub-agent-launchd-install.test.js` — 8 integration tests (plutil-lint, bash -n, atomic write, KeepAlive policy split, stderr-redirection regression gate)
- `tests/integration/health-coordinator-sub-agent-block.test.js` — 6 integration tests covering status transitions, defensive malformed-JSON, parse-after-edit regression, and mixed-state aggregation

### Modified

- `scripts/health-coordinator.js` — `+158 lines` purely additive:
  - New `sub_agent_capture` slot in `currentState` (defaulted at startup with all four agents stubbed)
  - New `async function pollSubAgentCapture()` (~110 lines including jsdoc + defensive fallback)
  - New `await pollSubAgentCapture()` invocation wired into `runAllChecks()` after `pollKnowledgePipeline()`

## Decisions Made

See key-decisions in frontmatter (5 decisions logged). Notable:

1. **Path A over Path B for health-coordinator.** The Plan 50-03 architectural-drift precedent does not apply here because Plan 51-10 specifically built `registry-reader.mjs` as a coordinator-friendly aggregator. The dynamic-import + try/catch wrap ensures the coordinator's must-keep-running invariant is preserved.
2. **Stderr→`.data/live-<agent>.log` redirection** per the user's explicit directive in the execute-plan objective (which overrides the Plan PLAN.md interfaces block's `.logs/` suggestion). Matches the user's `nohup` recipe.
3. **Explicit `--state-file` flag in each live-daemon plist** per `lib/lsl/registry-reader.mjs::HEARTBEAT_FILES` contract — without the flag, Plan 51-07's daemon would write to the un-suffixed default and the reader couldn't find it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Live daemons' heartbeat stderr → .data/live-<agent>.log redirection**

- **Found during:** Reading the Plan 51-11 PLAN.md `<interfaces>` block in light of the execute-plan objective.
- **Issue:** Plan PLAN.md's interfaces block suggested `.logs/sub-agent-live-claude.log` etc., but the execute-plan objective explicitly states: *"the launchd plists you ship in this plan MUST set `<key>StandardErrorPath</key>` to a log file under `.data/` (e.g. `.data/live-claude.log`)"*. The objective also references the user's manual recipe `nohup ... >> .data/live-<agent>.log 2>&1 &`. Without the directive's mitigation, the daemons' 30s heartbeat lines would corrupt opencode/copilot TUIs when an operator hand-runs them under bare `&`.
- **Fix:** All four plists (sweep + three live daemons) redirect `StandardErrorPath` AND `StandardOutPath` to `.data/live-<agent>.log` (or `.data/live-sub-agent-sweep.log` for the sweep). The installer pre-creates `.data/` so the destinations exist before launchd binds. Test 8 includes an explicit regression gate (`new RegExp(\`...\\.data/live-${agent}\\.log...\`)`) that catches any future revert.
- **Files modified:** All four `launchd/com.coding.sub-agent-*.plist` + `scripts/install-sub-agent-launchd.sh` (mkdir -p `.data/`) + `tests/integration/sub-agent-launchd-install.test.js` (regression gate).
- **Verification:** Test 8 asserts `<key>StandardErrorPath</key>...<string>...\\.data/live-<agent>\\.log</string>` regex match for all three live daemons; all 8 launchd tests green.
- **Committed in:** `df77bd164` (Task 1a artifacts) + `916279bef` (Task 1b regression-gate test)

**Total deviations:** 1 auto-fixed (Rule 2 missing critical — stderr redirection prevents terminal corruption per the Wave-5 follow-up defect).
**Impact on plan:** Strictly improving — closes a known UX defect that would have surfaced as soon as an operator ran a daemon under bare `&` for testing.

## Issues Encountered

None during Tasks 1+2 implementation. All acceptance criteria gates passed first-try.

## Human-Verify Checkpoints — Tasks 3 + 4 (PENDING OPERATOR)

The remaining two tasks in Plan 51-11 are explicit `checkpoint:human-verify` gates per the PLAN.md `<tasks>` block. The orchestrator MUST surface them to the user before Phase 51 closes.

### Task 3 — Operator install + smoke-verify all 4 launchd jobs

**What's ready:** All 4 plists pass `plutil -lint`, installer + wrapper pass `bash -n`, 8 integration tests green, 6 health-coordinator tests green, D-Reuse gate clean.

**What the operator runs:**

```bash
# 1. Install all 4 jobs (idempotent — safe to re-run)
bash /Users/Q284340/Agentic/coding/scripts/install-sub-agent-launchd.sh

# 2. Confirm registration (expect 4 lines)
launchctl list | grep com.coding.sub-agent

# 3. Tail logs for 60s — expect at least one heartbeat per live daemon
tail -F .data/live-claude.log .data/live-opencode.log .data/live-copilot.log

# 4. Manual sweep kickstart
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-sweep
tail -F .data/live-sub-agent-sweep.log

# 5. Verify 4 state files
ls -la .data/sub-agent-live-state-*.json .data/sub-agent-sweep-state.json

# 6. Dashboard check (visual, per memory feedback_e2e_verify.md)
# Open http://localhost:3032 — knowledge-pipeline badge GREEN + sub-agent indicator shows 4 agents
# Capture screenshot to .planning/phases/51-…/verification/51-11-dashboard.png
```

**Resume signal:** `"approved"` when all 4 jobs loaded + at least one heartbeat per live daemon + dashboard screenshot captured. `"failure: <description>"` to report a regression.

### Task 4 — Final phase verification (6 CONTEXT.md acceptance criteria)

**What's ready:** Task 3 must approve first. Then operator runs a fresh `/gsd-execute-phase` and verifies the six ACs (backfill, LSL parity, observation parity within ≤15min, agent-agnostic, idempotency, dashboard truth).

**Resume signal:** `"phase 51 closed"` when all 6 ACs pass with screenshots. `"AC#N failure: <description>"` to report a regression.

## Phase 51 Closure Status (this plan's perspective)

- **All 11 plans on disk:** 51-01 through 51-11 with SUMMARYs (51-11 SUMMARY is this file)
- **Cumulative D-Reuse gate:** CLEAN across all 11 plans (`git diff --stat 613f34f23..HEAD lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` = 0 files)
- **Cumulative T-51-11-SC mitigation:** zero new npm packages across Phase 51 (`git diff package.json` = 0 lines changed)
- **Operator gates pending:** Task 3 (install) + Task 4 (6-AC verification). Until both approve, STATE Current Position should NOT advance to Phase 43.

## Next Phase Readiness

**Phase 43 (v7.1 OKM Cross-Repo Migration)** is the documented next position per STATE.md / CONTEXT.md, but the orchestrator should NOT re-point STATE Current Position until the two human-verify checkpoints (Tasks 3 + 4) approve. The artifacts shipped in this plan are the LAST code changes Phase 51 needs; everything remaining is operator validation.

## Self-Check: PASSED

Per `<self_check>` requirement — verified all claims before committing SUMMARY:

- `[ -f launchd/com.coding.sub-agent-sweep.plist ]` → FOUND
- `[ -f launchd/com.coding.sub-agent-live-claude.plist ]` → FOUND
- `[ -f launchd/com.coding.sub-agent-live-opencode.plist ]` → FOUND
- `[ -f launchd/com.coding.sub-agent-live-copilot.plist ]` → FOUND
- `[ -f scripts/install-sub-agent-launchd.sh ]` → FOUND (executable)
- `[ -f scripts/sub-agent-sweep-job.sh ]` → FOUND (executable)
- `[ -f tests/integration/sub-agent-launchd-install.test.js ]` → FOUND (8 tests green)
- `[ -f tests/integration/health-coordinator-sub-agent-block.test.js ]` → FOUND (6 tests green)
- `git log --oneline | grep df77bd164` → FOUND
- `git log --oneline | grep 916279bef` → FOUND
- `git log --oneline | grep ac79467b7` → FOUND
- D-Reuse cumulative gate clean
- 0 console.* in scripts/health-coordinator.js (baseline preserved)
- 14 of 14 new tests green; 7/7 Plan 50-03 + 10/10 Plan 51-10 regressions green

---

*Phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as · Plan: 11*
*Status: tasks 1+2 complete; tasks 3+4 pending operator at checkpoint*
