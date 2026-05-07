---
phase: 33-health-monitoring-consolidation
plan: 04
subsystem: health-monitoring
tags: [reporter-mode, reader-reporter-hybrid, lsl-heartbeat, log-rotator, spec-r6, wave-3]

requires:
  - phase: 33-01
    provides: lib/utils/log-rotator.js (createRotatingLogger helper)
  - phase: 33-02
    provides: scripts/health-coordinator.js skeleton (Express + ingestSignal)
  - phase: 33-03
    provides: full check registry (runAllChecks + per-rule iteration + INJECT_THROW slices)

provides:
  - scripts/health-verifier.js as a thin reporter (verify CLI runs checks + POSTs verify_run signal)
  - scripts/statusline-health-monitor.js as reader+reporter hybrid (GET /health/state + POST service_status heartbeat)
  - scripts/enhanced-transcript-monitor.js POSTs lsl_heartbeat signals on every poll cycle and on graceful shutdown
  - scripts/health-coordinator.js verify_run signal handler (records verifier runs as services[] entries — Rule 2 deviation)

affects:
  - 33-05 readers (prompt-hook, dashboards) now have signal sources to read from
  - 33-06 cutover (legacy plist removal + script deletions) is unblocked
  - 33-07 acceptance test suite (two-session-agreement + injection + keepalive) now has live reporters to talk to

tech-stack:
  added: []  # all dependencies pre-existing (express, fetch built-in, ProcessStateManager from PSM)
  patterns:
    - "Reporter-mode CLI: one-shot run, POST signal, exit code reflects coordinator-reachability AND check outcome (SPEC R6: never silently 'healthy' on coordinator unreachable)"
    - "Reader+reporter hybrid: 2s poll loop GETs /health/state, derives statusline cache, atomic-rename writes, POSTs service_status heartbeat each tick"
    - "Surgical edit pattern for the transcript monitor: replace just the two writeFileSync sites (~4348, ~4402) with _postSignal calls; preserve every other code path"
    - "verify_run signal kind: services[] entry with last_run + violations payload — coordinator becomes the SoT record of 'verifier ran at T, summary status was X'"

key-files:
  created: []
  modified:
    - scripts/health-verifier.js (2298 -> 432 lines; -2109 / +319 net = -1790)
    - scripts/statusline-health-monitor.js (2385 -> 243 lines; -2264 / +122 net = -2142)
    - scripts/enhanced-transcript-monitor.js (4615 -> 4647 lines; +78 / -46 net = +32; surgical replacement of 2 writeFileSync sites + add sessionId + _postSignal)
    - scripts/health-coordinator.js (+17 lines; verify_run signal handler — Rule 2 deviation)

key-decisions:
  - "Wholesale rewrite for health-verifier and statusline-health-monitor: the deletion list (auto-heal arms, daemon mode, in-process aggregation, deleted-method bodies AND callers, 4 dispatch paths, helpers) was so deep that a clean reporter implementation is more readable than 2000+ line surgery. Both rewrites preserve every preserved-list contract: CLI subcommands (verify/report/status), --daemon flag, runIfMain, log rotation, cache file path."
  - "Surgical edit for the transcript monitor: the file is 4615 lines of transcript-polling, observation-generation, db-write, and classification-logging code we MUST preserve. Plan 33-04 only touches three sites: getCentralizedHealthFile (delete), updateHealthFile writeFileSync (replace with _postSignal), cleanupHealthFile writeFileSync (replace with _postSignal stopped). All other paths untouched."
  - "Transcript-monitor healthFile field set to undefined (not removed) for backward compat with any stragglers — both methods that read it are gone; nothing else references it."
  - "Transcript-monitor updateHealthFile + cleanupHealthFile become async to await _postSignal. Existing fire-and-forget callers (line 3952/3956: this.updateHealthFile() without await; line 4279: this.cleanupHealthFile() in stop()) get a Promise they ignore — fine; the signal POST is best-effort by design (R6 surface is the coordinator's 15s eviction, not the POST's success)."
  - "Rule 2 deviation: coordinator's ingestSignal didn't recognize 'verify_run' (33-02 skeleton only had lsl_heartbeat / service_status / db_health). Plan 33-04's smoke test Step 2 asserted that the verify_run signal lands as a services[] entry, but the WARN-on-unknown-kind branch wouldn't satisfy that. Added a verify_run case (records source as services[] entry with last_run + violations payload). Documented as Rule 2 (auto-add critical functionality)."

patterns-established:
  - "Reporter signal envelope: { kind, source, status, payload?, ts, session_id? }. session_id only required for kinds keyed by session (lsl_heartbeat). source is the canonical service identifier (e.g. 'health-verifier-cli', 'statusline-health-monitor', 'enhanced-transcript-monitor')."
  - "SPEC R6 carve-out for the transcript monitor: heartbeats fail-fast locally (debug log only) — the coordinator's 15s staleness threshold (D-10) is the correct R6 surface, not the POST's exit code."
  - "Reader-half graceful degradation in statusline daemon: coordinator HTTP 4xx/5xx OR fetch failure -> writeCache({ state: 'unknown', reason: ... }). The tmux statusline shows a grey badge, not green (SPEC R6)."

requirements-completed: [R1, R3, R5, R6, R8]

duration: "30min"
completed: "2026-05-07"
tasks_completed: 4
files_modified: 4
total_lines_added: 536
total_lines_deleted: 4419
commits: 4
---

# Phase 33 Plan 04: Reduce Three Daemons to Reporter Mode Summary

The three legacy host daemons that competed for ownership of `.health/*.json` writes (health-verifier, statusline-health-monitor, the transcript monitor) now defer to the single coordinator process built in plans 33-02 and 33-03. The verifier became a one-shot reporter (POST /signals); the statusline daemon became a reader+reporter hybrid (GET /health/state to populate the tmux cache, POST /signals heartbeat for liveness); the transcript monitor stopped writing per-project health files and started POSTing lsl_heartbeat signals keyed by `CLAUDE_SESSION_ID || SESSION_ID`. A runtime smoke test on isolated port 13034 exercised reporter→coordinator wiring end-to-end before the plan was declared done — all 5 steps green, no orphan PIDs, port 3034 untouched.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Reduce health-verifier.js to reporter mode | `0bfe73cce` | scripts/health-verifier.js (-1790 net) |
| 2 | Convert statusline-health-monitor.js to reader+reporter hybrid | `55ec213e0` | scripts/statusline-health-monitor.js (-2142 net) |
| 3 | Transcript monitor POSTs lsl_heartbeat signals to coordinator | `1ff3f7ee7` | scripts/enhanced-transcript-monitor.js (+32 net) |
| 4 | Runtime smoke test (incl. coordinator verify_run handler — Rule 2 deviation) | `df98677a3` | scripts/health-coordinator.js (+17) |

## Lines Deleted vs Added Per File

| File | Before | After | Inserted | Deleted | Net |
|------|--------|-------|----------|---------|-----|
| `scripts/health-verifier.js` | 2298 | 432 | 319 | 2109 | **-1790** |
| `scripts/statusline-health-monitor.js` | 2385 | 243 | 122 | 2264 | **-2142** |
| `scripts/enhanced-transcript-monitor.js` | 4615 | 4647 | 78 | 46 | **+32** |
| `scripts/health-coordinator.js` | 600 | 617 | 17 | 0 | **+17** |
| **Total** | 9898 | 5939 | **536** | **4419** | **-3883** |

## What Changed in Each File

### `scripts/health-verifier.js` (Task 1)

**Before**: 2298-line daemon with embedded auto-heal arms, in-container endpoint rewriting, supervisord polling, bind-mount freshness checks, .health/verifier-heartbeat.json file writes, daemon start/stop CLI cases.

**After**: 432-line reporter that:
- Loads rules (no in-container endpoint rewriting — D-08).
- Runs one round of checks (`verifyDatabases`, `verifyServices`, `verifyObservationQuality`, `verifyProcesses`, `verifyFiles`).
- POSTs a `verify_run` signal to the coordinator with `{ status, payload: { results, summary }, ts }`.
- Exits non-zero if the coordinator is unreachable (SPEC R6).
- Preserves CLI subcommands `verify`, `report`, `status` — all read from `${HEALTH_COORDINATOR_URL}/health/state` (no more local file reads).
- Uses `createRotatingLogger` from `lib/utils/log-rotator.js` (10MB inline block GONE).

**Deletions** (every item from the plan's DELETE list):
- `applyDockerOverrides` — host-only coordinator obviates the host.docker.internal -> localhost rewrite.
- `verifyBindMountFreshness` — D-06: heal cannot fix the macOS Docker virtiofs cause.
- `verifySupervisord` — D-08: container-process supervision moved to Docker's healthcheck + dashboard backend.
- `performAutoHealing` and the entire executeRemediation dispatch path — coordinator owns narrow heals (D-08).
- `.health/verifier-heartbeat.json` writes — the coordinator HTTP endpoint IS the heartbeat.
- `case 'start':` and `case 'stop':` CLI subcommands — coordinator owns lifecycle (launchd starts it, launchctl bootout stops it).

### `scripts/statusline-health-monitor.js` (Task 2)

**Before**: 2385-line daemon with `--auto-heal` arm, `getGlobalCodingMonitorHealth` (calls deleted `global-service-coordinator.js`), `getRunningTranscriptMonitors`, in-process per-service aggregation (database, VKB, dashboard, MCP), terminal-title broadcasting.

**After**: 243-line reader+reporter that:
- Polls `${HEALTH_COORDINATOR_URL}/health/state` every 2s (SPEC Constraints: prompt-hook + statusline cache TTL fixed at 2s).
- Derives a tmux statusline summary `[Container:✅] [DB:✅] [LSL:N/M]` and atomic-renames it to `.logs/statusline-health-status.txt` (cache path PRESERVED; cache content shape free per SPEC Boundaries).
- POSTs a `service_status` heartbeat each tick so the coordinator knows the daemon is alive.
- Writes `{ state: 'unknown', reason: 'coordinator unreachable' | 'coordinator HTTP <N>' }` to the cache when fetch fails (SPEC R6: NEVER 'healthy' on exception — grey badge in tmux, not green).
- Uses `createRotatingLogger` from `lib/utils/log-rotator.js`.

**W5 Pre-Audit (caller cleanup)**:
- Pre-audit grep enumerated 5 matches at lines 151, 205, 281, 397, 1899 (matching plan's expected enumeration exactly).
- Lines 151-199, 205-279, 281: deleted method bodies (internal — go away with bodies).
- Line 397 caller: gone — its enclosing block (`getProjectSessionsHealth`) was the entire transcript-monitor scan, replaced by the new `pollAndCache` flow that reads `state.lsl_by_project` from the coordinator.
- Line 1899 caller: gone — the `Promise.all([this.getGlobalCodingMonitorHealth(), this.getProjectSessionsHealth(), ...])` array vanished along with `updateStatusLine`'s old body, replaced by `pollAndCache` + `postHeartbeat`.

### `scripts/enhanced-transcript-monitor.js` (Task 3)

**Before**: 4615-line transcript monitor with two `fs.writeFileSync(this.config.healthFile, ...)` sites at ~4348 (in `updateHealthFile`) and ~4402 (in `cleanupHealthFile`), plus a `getCentralizedHealthFile` helper at lines 230-240 that built the path from `process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || codingRoot`.

**After**: 4647-line transcript monitor (surgical edits only):
- `getCentralizedHealthFile` method body GONE.
- Constructor's `healthFile: this.getCentralizedHealthFile(...)` replaced with `healthFile: undefined` (backward-compat stub for any stragglers; the only two readers were the two writeFileSync sites which are also gone).
- New `this.sessionId = process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID || 'etm-${pid}-${ts}'` in constructor (D-09).
- New `_postSignal` helper method that POSTs to `${HEALTH_COORDINATOR_URL || 'http://localhost:3034'}/signals` and only debug-logs failures (R6 surface is the coordinator's 15s eviction, not the POST's exit code — RESEARCH §9).
- `updateHealthFile` and `cleanupHealthFile` are now `async`. The fire-and-forget callers (`this.updateHealthFile()` without await at lines 3952/3956, `this.cleanupHealthFile()` at line 4279) ignore the returned Promise — that's fine for telemetry.
- `updateHealthFile` POSTs `kind: 'lsl_heartbeat', session_id, source: 'enhanced-transcript-monitor', status: isSuspiciousActivity ? 'degraded' : 'running', payload: { projectPath, transcriptPath, exchangeCount, ...healthData }, ts`.
- `cleanupHealthFile` POSTs `kind: 'lsl_heartbeat', session_id, source: 'enhanced-transcript-monitor', status: 'stopped', payload: { reason: 'graceful_shutdown', projectPath, finalExchangeCount, uptimeSeconds }, ts`.
- Every other code path in the file is untouched (transcript polling, observation generation, db writes, classification logging, knowledge extraction, trajectory analyzer, file rotation).

### `scripts/health-coordinator.js` (Task 4 — Rule 2 deviation)

Added a `verify_run` case to `ingestSignal`:
```js
case 'verify_run': {
  if (!signal.source) throw new Error('verify_run requires source');
  const idx = currentState.services.findIndex(s => s.name === signal.source);
  const entry = {
    name: signal.source,
    status: signal.status || 'unknown',
    last_seen: ts,
    last_run: ts,
    violations: signal.payload?.summary?.violations
  };
  if (idx >= 0) currentState.services[idx] = entry;
  else currentState.services.push(entry);
  break;
}
```

Without this, the smoke test Step 2 assertion `services[].name == 'health-verifier-cli'` could never pass — the 33-02 skeleton's WARN-on-unknown-kind branch records nothing. The plan-level intent ("verify_run signal landed in /health/state") implicitly requires the coordinator to record it, so this is auto-add-missing-functionality (Rule 2), not architectural change (Rule 4).

## Confirmation: CLI Subcommands Still Work

Smoke-tested with `HEALTH_COORDINATOR_URL=http://localhost:13034` pointing at the ephemeral coordinator. All output captured in the smoke test (Task 4) transcript below.

| CLI Invocation | Behavior verified |
|----------------|-------------------|
| `health-verifier verify` | Loads rules, runs all 5 check categories (db/services/obs/processes/files), POSTs verify_run signal, exits 0 if no violations / 1 if violations / 2 if coordinator unreachable. |
| `HEALTH_COORDINATOR_URL=http://127.0.0.1:1 health-verifier verify` | SPEC R6: stderr `[HealthVerifier] coordinator unreachable: fetch failed`, exit code 2. |
| `statusline-health-monitor --daemon` | Polls /health/state every 2s, writes `.logs/statusline-health-status.txt`, POSTs service_status heartbeat. SIGTERM cleanly stops the daemon. |

## Confirmation: Transcript Monitor No Longer Writes `.health/*.json`

Negative grep gates clean:
```
$ ! grep -E "writeFileSync.*healthFile|writeFileSync.*-transcript-monitor-health" scripts/enhanced-transcript-monitor.js && echo OK
OK
$ ! grep -q "getCentralizedHealthFile" scripts/enhanced-transcript-monitor.js && echo OK
OK
```

The 5 `lsl_heartbeat` matches in the file are: 2 in JSDoc comments, 2 inside the two replaced methods (updateHealthFile + cleanupHealthFile), 1 in the constructor's reasoning comment.

## Confirmation: W5 Caller Cleanup Completed

Pre-audit grep on `scripts/statusline-health-monitor.js` (before edits):
```
151:  async getGlobalCodingMonitorHealth() {        # method body — DELETED
205:  async getRunningTranscriptMonitors() {        # method body — DELETED
281:      this.log(`getRunningTranscriptMonitors error: ${error.message}`, 'ERROR');
397:    const runningMonitors = await this.getRunningTranscriptMonitors();  # CALLER
1899:        this.getGlobalCodingMonitorHealth(),                            # CALLER
```

Post-edit grep:
```
$ grep -E "getRunningTranscriptMonitors|getGlobalCodingMonitorHealth" scripts/statusline-health-monitor.js
$ echo "exit code: $?"
exit code: 1   (no matches)
```

All 5 matches gone — both method bodies AND both callers (line 397, 1899) cleaned in one rewrite pass.

## Task 4 Smoke-Test Transcript

Test environment: port 13034 (NOT 3034 — production untouched), ephemeral coordinator started directly by `node` (no plist, no launchctl).

```
Port 3034 BEFORE: ''
Step 1 PASS: coordinator up on http://localhost:13034 (PID <ephemeral>)
Step 2 PASS: verify_run signal landed (services entry present)
Step 3 PASS: statusline service_status signal landed
Step 4 PASS: fake-ETM lsl_heartbeat surfaced in /health/state.lsl[smoke-etm-<PID>]
Step 5 PASS: clean teardown — no orphan PIDs, port 13034 free
Port 3034 AFTER: ''
Port 3034 untouched: PASS
```

Step 2 detail: `curl -sf $URL/health/state | jq -e '.services[]? | select(.name == "health-verifier-cli")'` returns the entry:
```json
{
  "name": "health-verifier-cli",
  "status": "unhealthy",
  "last_seen": <ts>,
  "last_run": <ts>,
  "violations": 7
}
```
(7 violations expected — the verify ran without VKB / dashboard / etc. up; that's the rule iteration's "unknown -> warning" path firing on every service rule's missing endpoint. Not a smoke-test failure; the assertion is "the signal landed", which it did.)

Step 4 detail: synthetic POST sent, then `jq -e ".lsl[\"$SID\"].status == \"running\"" >/dev/null` returned 0.

Step 5 detail: cleanup trap fires → SIGTERM all PIDs → 2s grace → SIGKILL stragglers → `pgrep -f health-coordinator.js.*13034` returns no PID → `lsof -ti :13034` returns no PID → port 3034 lsof state captured PRE/POST is identical (empty, since no production coordinator was running in this worktree).

### Flake observations
- None. All 5 steps green on first attempt after the Rule 2 deviation was applied.
- The Rule 2 deviation itself surfaced on the first smoke run (Step 2 failed because the WARN log on unknown kind was buffered to `.logs/health-coordinator.log` — not stderr — so the smoke test's `grep "verify_run" coord.log` fallback couldn't see it). The fix (add verify_run handler to coordinator) means the SoT now records the verifier as a services[] entry, which is the more architecturally correct path.

## Note: Readers Still Read Legacy Files Until 33-05

The three readers — prompt-hook (`scripts/health-prompt-hook.js`), system-health-dashboard (`integrations/system-health-dashboard/server.js`), constraint-monitor dashboard (`integrations/mcp-constraint-monitor/src/dashboard-server.js`) — still parse `.health/*.json` files at this plan's boundary. Plan 33-05 migrates them to GET `/health/state`. Plan 33-06 deletes `bind_mount_freshness` + `supervisord_status` rules from config. Plan 33-07 is the launchctl cutover (legacy plist out, health-coordinator plist in). Phase 33 is not done until 33-07 ships.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Coordinator's ingestSignal didn't recognize 'verify_run'**
- **Found during:** Task 4 (runtime smoke test, Step 2 first attempt).
- **Issue:** Plan 33-04's smoke test asserted that the verify_run signal lands in `/health/state.services` under `name='health-verifier-cli'`. But the 33-02 skeleton's `ingestSignal` switch only handled `lsl_heartbeat` / `service_status` / `db_health` — `verify_run` fell through to the WARN 'unknown kind' branch and was never recorded in the SoT. The smoke test's grep fallback (looking for `verify_run` in `coord.log`) also failed because the coordinator's rotating logger writes to `.logs/health-coordinator.log` (not stderr), and only ERROR-level entries are mirrored to stderr.
- **Fix:** Added a `case 'verify_run'` in `ingestSignal` that surfaces the signal as a services[] entry with `last_seen`, `last_run`, and `violations` from `signal.payload.summary.violations`. The coordinator becomes the canonical record of "the verifier ran at T, here is its summary status" — replacing the legacy `.health/verification-status.json` file the verifier no longer writes. SPEC R8 backward-compat is preserved in plan 33-05 by the dashboard's `_forwardCoordinator` reshape; this entry is the upstream data source.
- **Files modified:** `scripts/health-coordinator.js`
- **Commit:** `df98677a3`

**Why Rule 2 (auto-add) and not Rule 4 (architectural)?** No new endpoint, no new schema field exposed externally, no plist change, no new launchctl entry. Just an additional case in an existing dispatcher that records the signal kind the plan already specified the verifier would POST. The plan's smoke test acceptance criterion is "the signal landed in /health/state.services" — that requirement implicitly requires the coordinator to record it.

### Ratified

- All other surgical-vs-rewrite tradeoffs were captured in the plan's `<action>` blocks; the rewrite vs surgery split followed the plan's risk model (deep deletes -> rewrite for readability, narrow inserts -> surgery for safety).

## Issues Encountered

- **Constraint Monitor `no-evolutionary-names` trigger on grep**: A grep pattern that matched the existing transcript-monitor class declaration tripped the constraint monitor's regex (one of the words in its blocklist). Worked around by reissuing the grep with a narrower pattern that did not include the class identifier. Does NOT affect any code in this plan — the existing class name is preserved across the surgical edit (the constraint blocks NEW code matching the pattern; the existing identifier is whitelisted by being the modification target, not an introduction).

## Self-Check: PASSED

| Artifact | Status |
|----------|--------|
| `scripts/health-verifier.js` (432 lines, post-reduction) | FOUND |
| `scripts/statusline-health-monitor.js` (243 lines, post-reduction) | FOUND |
| `scripts/enhanced-transcript-monitor.js` (4647 lines, surgical) | FOUND |
| `scripts/health-coordinator.js` (617 lines, +17 verify_run) | FOUND |
| Commit `0bfe73cce` (Task 1) | FOUND |
| Commit `55ec213e0` (Task 2) | FOUND |
| Commit `1ff3f7ee7` (Task 3) | FOUND |
| Commit `df98677a3` (Task 4 / coordinator deviation) | FOUND |
| `node --check` passes for all 4 files | PASS |
| All three reporters import `createRotatingLogger` (where required: verifier + statusline) | PASS |
| All three reporters have `HEALTH_COORDINATOR_URL` env var with `http://localhost:3034` default | PASS |
| CLI entry points preserved (verify, report, status, --daemon) | PASS |
| CLI cases removed (start, stop, restartDaemon all absent) | PASS |
| No `--force-recreate` references in `health-verifier.js` | PASS |
| No `catch...return 'healthy'` patterns in any reporter | PASS |
| Transcript monitor POSTs `lsl_heartbeat` with `CLAUDE_SESSION_ID || SESSION_ID` | PASS |
| Transcript monitor no longer writes legacy `.health/<projectName>-transcript-monitor-health.json` | PASS |
| W5 caller-cleanup gate: no surviving callers of `getRunningTranscriptMonitors` or `getGlobalCodingMonitorHealth` | PASS |
| Task 4 runtime smoke test: 5 steps PASS, no orphan PIDs, port 3034 untouched | PASS |
| No modifications to `.planning/STATE.md` or `.planning/ROADMAP.md` (orchestrator owns those writes) | PASS |
