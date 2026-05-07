---
phase: 33-health-monitoring-consolidation
plan: 05
subsystem: health-monitoring
tags: [reverse-proxy, consumer-migration, prompt-hook, dashboard, constraint-monitor, spec-r6, spec-r8, wave-4]

requires:
  - phase: 33-02
    provides: scripts/health-coordinator.js (Express server + /health/state + /health/refresh endpoints)
  - phase: 33-03
    provides: full coordinator check registry populating /health/state with container/services/lsl/databases/processes
  - phase: 33-04
    provides: live reporters POSTing /signals so /health/state has real data to reshape

provides:
  - scripts/health-prompt-hook.js as a single-fetch consumer of /health/state (preserves SPEC R8 envelope; preserves Q3 graceful no-op)
  - integrations/system-health-dashboard/server.js's 4 health-verifier routes reverse-proxying to coordinator (status, report, verify, restart-service post-hook)
  - integrations/mcp-constraint-monitor/src/dashboard-server.js's 2 health-verifier reader handlers reverse-proxying to coordinator (closes RESEARCH §8 leak)

affects:
  - 33-06 (rules cleanup) is unblocked — no consumer reads bind_mount_freshness / supervisord_status outputs anymore
  - 33-07 (cutover) is unblocked — `.health/*.json` files can be removed without silent breakage anywhere
  - 33-08 (acceptance) — SPEC AC #7 grep gate passes across all migrated consumers

tech-stack:
  added: []  # built-in fetch only
  patterns:
    - "Reverse-proxy via fetch + reshape: mirror the obs-api `_forwardObsApi` pattern already used 6× in system-health-dashboard/server.js. Migration adds 4 more uses with HEALTH_COORDINATOR_URL substituted for OBS_API_URL."
    - "SPEC R6 surface for consumers: coordinator unreachable / HTTP error / parse error all return overallStatus: 'unknown' (NEVER 'healthy'). Consumer-side env-detection branch (Q3) is the carve-out — outside coding repo emits empty additionalContext."
    - "SPEC R8 envelope preservation: consumers reshape coordinator's modern /health/state JSON into each consumer's legacy envelope (prompt-hook hookSpecificOutput; dashboard `{ overallStatus, violationCount, criticalCount, lastUpdate, autoHealingActive }`; constraint-dashboard `{ status, overallStatus, services, lsl_by_project }`). dist/ frontends are NOT rebuilt."
    - "Submodule contract: integrations/mcp-constraint-monitor is a pure-JS submodule (package.json has no `build` script, `main: src/server.js`). Edit src/ → commit inside the submodule on its own branch → bump pointer in parent. Docker rebuild deferred to plan 33-07 cutover (out of scope here)."

key-files:
  modified:
    - scripts/health-prompt-hook.js (365 → 220 lines; -278 / +134 net -144)
    - integrations/system-health-dashboard/server.js (4336 → 4295 lines; -209 / +168 net -41)
    - integrations/mcp-constraint-monitor/src/dashboard-server.js (1152 → 1190 lines; -45 / +83 net +38)

key-decisions:
  - "Hook envelope MUST always emit, even on fatal errors. Added a last-ditch `outputEnvelope('')` in the catch-all so Claude sees a well-formed { hookSpecificOutput: { hookEventName, additionalContext: '' } } even if JSON.parse blows up on stdin. SPEC R8 gate is hard."
  - "deriveSummary() is intentionally narrow — extracts only known fields (container.healthcheck, databases.status, services[*].status, lsl_by_project[*]) and converts each to a fixed-format string. T-33-05-02 mitigation: no unsanitised passthrough of attacker-controlled coordinator response into Claude's prompt."
  - "Dashboard's _forwardCoordinator helper added even though only one route (handleTriggerVerification) currently calls fetch directly through it; the other two readers reshape the response inline. Helper kept for symmetry with obs-api's `_forwardObsApi` and as a hook for future routes."
  - "Dashboard handleRestartService kept its supervisorctl/npm/bin restart commands (D-08 narrow heals — no force-recreate, no docker-compose up -d). Replaced its post-restart `setTimeout` spawn of the verifier script with a `fetch /health/refresh` POST so the dashboard NEVER spawns the verifier script (D-04 gate)."
  - "Dropped `this.lastAutoVerifyTime` constructor init — it tracked rate-limiting for the now-deleted triggerBackgroundVerification method."
  - "Dashboard `dist/` NOT rebuilt — preserved per SPEC R8 backward-compat. W8 grep gate confirms dist/ contains zero supervisorctl/supervisor_status/expected_processes tokens, so the dropped verifySupervisord path never surfaced in the frontend bundle."
  - "Constraint-monitor edit kept the existing `import { readFileSync, ... }` line at the top (line 12) — other handlers in the file (LSL registry reads at ~157, ~668, ~836; violations file at ~498) still use it for non-health purposes. Only the two health-verifier reader handlers changed."
  - "No Docker rebuild for the constraint-monitor change in this plan: package.json has no `build` script (main: src/server.js), so npm run build is N/A. The constraint-monitor service runs from src/ directly. The container will pick up the change on next restart (the cutover commit in plan 33-07 covers the docker-compose env var addition + container rebuild as one atomic commit)."

requirements-completed: [R2, R6, R8]

duration: "25min"
completed: "2026-05-07"
tasks_completed: 3
files_modified: 3
total_lines_added: 385
total_lines_deleted: 532
commits: 4  # 3 in main + 1 inside submodule (b16f9ca)
---

# Phase 33 Plan 05: Migrate Three Consumer Routes to Coordinator HTTP SoT

After this plan, NO consumer in the repo reads `.health/verification-status.json`, `.health/verification-report.json`, or `.health/<projectName>-transcript-monitor-health.json`. The prompt-hook makes a single `fetch` to `${HEALTH_COORDINATOR_URL}/health/state`. The system-health-dashboard's four `/api/health-verifier/*` routes reverse-proxy to the coordinator (with response reshape preserving SPEC R8 envelopes so the existing dashboard frontend in `dist/` keeps rendering). The constraint-monitor dashboard's two reader handlers do the same — closing the silent-breakage leak documented in 33-RESEARCH §8. Coordinator unreachable always surfaces as `overallStatus: 'unknown'`, never `'healthy'` (SPEC R6). The Q3 carve-out (prompt-hook invoked outside the coding repo) emits empty `additionalContext` and exits 0.

## Tasks Completed

| Task | Name | Commit(s) | Key Files |
|------|------|-----------|-----------|
| 1 | Rewrite health-prompt-hook.js to single fetch /health/state | `ccc505b0b` | scripts/health-prompt-hook.js |
| 2 | Reverse-proxy 4 health-verifier routes in dashboard server.js | `1d94015e3` | integrations/system-health-dashboard/server.js |
| 3 | Reverse-proxy 2 health-verifier readers in constraint-monitor (submodule) | submodule `b16f9ca` + parent `c5c4f280a` | integrations/mcp-constraint-monitor/src/dashboard-server.js |

## Lines Modified Per File

| File | Before | After | Inserted | Deleted | Net |
|------|--------|-------|----------|---------|-----|
| `scripts/health-prompt-hook.js` | 365 | 220 | 134 | 278 | **-144** |
| `integrations/system-health-dashboard/server.js` | 4336 | 4295 | 168 | 209 | **-41** |
| `integrations/mcp-constraint-monitor/src/dashboard-server.js` | 1152 | 1190 | 83 | 45 | **+38** |
| **Total** | 5853 | 5705 | **385** | **532** | **-147** |

## What Changed in Each File

### `scripts/health-prompt-hook.js` (Task 1)

**Before**: 365-line hook reading 5 different files (`.health/verification-status.json`, `.health/<project>-transcript-monitor-health.json`, `.health/.lsl-recovery-lock`, `.health/lsl-watchdog-heartbeat.json`, `.global-lsl-registry.json`, `.observations/db-recovering.json`) and spawning `global-lsl-coordinator.js` for auto-recovery — multiple silent `try { ... } catch { /* ignore */ }` paths returning empty/healthy on error.

**After**: 220-line hook with a single coordinator `fetch`:
- `checkHealthStatus()`: one `fetch(${HEALTH_COORDINATOR_URL || 'http://localhost:3034'}/health/state)` call. HTTP error → `overallStatus: 'unknown', upstream: 'http_<status>'`. Network error → `overallStatus: 'unknown', upstream: 'unreachable'`. SPEC R6 grep gate clean.
- `deriveSummary(state)`: narrow extractor — only `container.healthcheck`, `databases.status`, `services[*].status`, `lsl_by_project[*]`. Each maps to a fixed-format string. T-33-05-02 mitigation against attacker-controlled coordinator response injecting prompt content.
- `outputEnvelope(additionalContext)`: single emitter for the SPEC R8 shape `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`. Used in normal flow, error fall-throughs, AND the Q3 carve-out.
- Q3 carve-out: `!existsSync(VERIFIER_SCRIPT)` → `outputEnvelope('')`, exit 0. SPEC R6's no-fallback-to-healthy applies to coordinator-side checks, NOT to this consumer-side env-detection branch (per user-resolved Q3).

**Deletions**:
- `triggerAsyncVerification` (spawned `health-verifier.js verify` daemon — coordinator owns the tick now).
- `outputBlockedResponse` (the `decision: 'block'` path is no longer reachable; coordinator surfaces are always informational).
- `checkLSLHealth` (4-layer LSL recovery logic with file reads of `.health/.lsl-recovery-lock`, `.health/lsl-watchdog-heartbeat.json`, `.global-lsl-registry.json`, `.observations/db-recovering.json`). All replaced by the deriveSummary path reading `state.lsl_by_project`.
- `_isPidAlive` (unused after checkLSLHealth deletion).
- `_watchdogIsFresh` (legacy watchdog file readers).
- `spawn(global-lsl-coordinator.js, 'ensure', codingRoot)` — that daemon is being deleted in plan 33-06.
- `STATUS_FILE` constant + `STALENESS_THRESHOLD_MS` constant (no more file reads, no more staleness checks — the coordinator owns those).

### `integrations/system-health-dashboard/server.js` (Task 2)

**Before**: 4336-line dashboard backend with `handleGetHealthStatus` reading `.health/verification-status.json` (line ~325), `handleGetHealthReport` reading `.health/verification-report.json` (line ~493), `handleTriggerVerification` running `execSync('node "${verifierScript}" verify ...')` (line ~524), `checkDaemonHeartbeat` reading `.health/verifier-heartbeat.json` (lines ~363-398), `restartDaemon` execSync-stopping + spawn-starting the verifier daemon (lines ~403-438), and `triggerBackgroundVerification` orchestrating watchdog + spawn (lines ~444-473). `handleRestartService` had a post-restart `setTimeout` that `spawn`ed `verifierScript verify`.

**After**: 4295-line dashboard backend with:
- New `_forwardCoordinator(req, res, pathAndQuery)` helper at the migration site (mirrors obs-api's `_forwardObsApi` already in this same file). On fetch error → 503 with SPEC R8 envelope using `overallStatus: 'unknown'`.
- `handleGetHealthStatus`: `fetch(${HEALTH_COORDINATOR_URL || 'http://host.docker.internal:3034'}/health/state)`, reshape into `{ overallStatus, violationCount, criticalCount, lastUpdate, autoHealingActive }`. Container.healthcheck === 'unhealthy' → critical violation. Service status !== 'running' → high violation. databases.status !== 'healthy' → high violation. autoHealingActive forced to `false` per D-08 (narrow heals only — not "actively healing").
- `handleGetHealthReport`: same fetch, reshape into `{ checks, violations }`. Each enabled rule in /health/state surfaces as a discrete check (container, service.<name>, process.<name>, lsl.<project>, databases). Status !== 'healthy'/'running' adds a violation entry.
- `handleTriggerVerification`: `fetch(${base}/health/refresh, { method: 'POST' })` — coordinator force-ticks and returns fresh state. D-04 satisfied: dashboard never spawns the verifier script.
- `handleRestartService` post-restart hook: replaced `setTimeout(() => spawn('node', [verifierScript, 'verify']))` with `setTimeout(() => fetch(${base}/health/refresh, { method: 'POST' }))`. The supervisorctl/npm/bin restart commands themselves are unchanged — they are D-08 narrow heals (no `--force-recreate`, no `docker-compose up -d`).

**Deletions** (PATTERNS landmines):
- `checkDaemonHeartbeat` (lines ~363-398) — coordinator's launchd KeepAlive is the heartbeat truth.
- `restartDaemon` (lines ~403-438) — dashboard never restarts a daemon.
- `triggerBackgroundVerification` (lines ~444-473) — callers gone; coordinator ticks itself every 5s.
- Orphaned `this.lastAutoVerifyTime = null` constructor init.

### `integrations/mcp-constraint-monitor/src/dashboard-server.js` (Task 3)

**Before**: 1152-line constraint-dashboard with two health-verifier reader handlers reading `.health/verification-status.json` (line ~961) and `.health/verification-report.json` (line ~1005) — independent of the system-health-dashboard. SPEC's grep targets did NOT include this file (RESEARCH §8 leak), so without this migration the constraint dashboard at `:3030` would have silently returned `{ status: 'offline' }` post-cutover.

**After**: 1190-line constraint-dashboard with:
- `handleGetHealthStatus`: fetch `/health/state` from `${HEALTH_COORDINATOR_URL || 'http://host.docker.internal:3034'}`. Reshapes into the constraint-dashboard's existing envelope: `{ status: 'healthy'|'unhealthy'|'unknown', overallStatus: <coordinator's container.healthcheck>, generated_at, services, lsl_by_project }`. SPEC R6: coordinator unreachable / HTTP error → 503 + `status: 'unknown'`.
- `handleGetHealthReport`: same fetch, reshape into `{ checks, violations }` (subset of the system-health-dashboard's report shape — the constraint frontend doesn't need processes/LSL detail).
- Other handlers in the file (LSL registry reads at lines ~157, ~668, ~836; violations file reads at ~498) UNTOUCHED. The `import { readFileSync, ... } from 'fs'` line at the top is preserved (6 readFileSync call sites remain in non-health handlers).

**Submodule contract**:
- `integrations/mcp-constraint-monitor/package.json` has NO `build` script (`main: src/server.js`, `start: node src/server.js`) — plain JS, no TS compilation. Per CLAUDE.md, `npm run build` is **N/A** for this submodule.
- Submodule commit landed on its `centralized-groq-tracking` branch as `b16f9ca`.
- Parent repo pointer commit `c5c4f280a` updates `integrations/mcp-constraint-monitor` from `9803504` to `b16f9ca`.
- **Docker rebuild deferred to plan 33-07 cutover.** This plan is consumer-migration only; the cutover commit (33-07) bundles the `HEALTH_COORDINATOR_URL` env var addition to `docker-compose.yml`, the container rebuild, and the launchctl plist swap as one atomic commit per SPEC Constraints "cutover, not shadow." Until the container is rebuilt, the running constraint-monitor instance still uses the pre-migration code (which is fine — `.health/verification-*.json` files still exist on disk until the cutover).

## Confirmation: Grep Gates

```bash
$ ! grep -rE "readFileSync.*\.health/(verification|.*-transcript-monitor)" \
    scripts/health-prompt-hook.js \
    integrations/system-health-dashboard/server.js \
    integrations/mcp-constraint-monitor/src/dashboard-server.js \
  && echo "[OK] SPEC AC #7 PASS"
[OK] SPEC AC #7 PASS

$ ! grep -nE "catch[^/]*return\s*['\"]healthy" \
    scripts/health-prompt-hook.js \
    integrations/system-health-dashboard/server.js \
    integrations/mcp-constraint-monitor/src/dashboard-server.js \
  && echo "[OK] SPEC R6 PASS"
[OK] SPEC R6 PASS
```

## Confirmation: Prompt-Hook Output JSON Shape (SPEC R8 / AC #8)

Coordinator unreachable, inside coding repo:
```bash
$ echo '{"cwd":"/Users/Q284340/Agentic/coding"}' | \
    HEALTH_COORDINATOR_URL=http://127.0.0.1:1 node scripts/health-prompt-hook.js
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "⚪ System Health: unknown (unreachable)\n"
  }
}
```
SPEC R8 envelope present. Coordinator unreachable surfaces as `unknown`, never `healthy`.

Q3 graceful no-op (outside coding repo):
```bash
$ echo '{"cwd":"/tmp"}' | CODING_TOOLS_PATH=/tmp node scripts/health-prompt-hook.js
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": ""
  }
}
```
Empty `additionalContext`, exit 0 — no warnings injected into prompts when running outside the coding repo.

## Confirmation: Dashboard W4 / W8 Gates

```bash
$ ! grep -nE "force-recreate|docker-compose up -d|--force-recreate" \
    integrations/system-health-dashboard/server.js
[OK] W4 broad-heal gate clean

$ ! grep -rE "supervisorctl|supervisor_status|expected_processes" \
    integrations/system-health-dashboard/dist/
[OK] W8 dashboard frontend dist gate clean (dist/ untouched, contains
     only index.html, health-icon.svg, and bundled assets/)
```

## Note: Legacy Daemons + Plist + Rules Config Still Untouched

This plan migrates the THREE remaining `.health/*.json` consumers. It does NOT yet:

- Delete the legacy host daemon scripts (`scripts/system-monitor-watchdog.js`, `scripts/global-process-supervisor.js`, `scripts/global-service-coordinator.js`, `scripts/global-lsl-coordinator.js`) — those are deleted in plan 33-07.
- Remove the legacy launchd plist (`com.coding.system-watchdog.plist`) or install the new one — that's plan 33-07.
- Delete the `bind_mount_freshness` and `supervisord_status` rules from `config/health-verification-rules.json` — that's plan 33-06.
- Remove `--force-recreate` and `refreshBindMounts()` from `scripts/health-remediation-actions.js` — that's plan 33-06.
- Add `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` to `docker/docker-compose.yml` — that's plan 33-07.
- Rebuild the Docker container so the in-container dashboards (system-health, constraint-monitor) pick up this plan's changes — that's the cutover commit in plan 33-07.

Phase 33 is not done until 33-07 + 33-08 ship.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dashboard `handleRestartService` post-restart hook still spawned the verifier script**
- **Found during:** Task 2 final grep gate sweep.
- **Issue:** The plan's `<action>` block focused on the four primary routes (`status`, `report`, `verify`, `restart-service`) but the `handleRestartService` body had a `setTimeout(() => spawn('node', [verifierScript, 'verify']))` that fired 2s after each service restart. The Task 2 acceptance criterion `! grep -nE "execSync.*verifierScript|spawn.*verifierScript"` would have failed with this code in place — and D-04 explicitly forbids the dashboard from spawning the verifier script.
- **Fix:** Replaced the post-restart spawn with `fetch(${base}/health/refresh, { method: 'POST' })`. Same intent (kick a verification cycle after the service restarts) but routed through the coordinator's HTTP endpoint instead of forking the verifier script.
- **Files modified:** integrations/system-health-dashboard/server.js
- **Commit:** `1d94015e3`

**2. [Rule 1 - Cleanup] Orphaned `this.lastAutoVerifyTime = null` constructor init**
- **Found during:** Task 2 post-edit `grep -n "triggerBackgroundVerification\|lastAutoVerifyTime"` sweep.
- **Issue:** The deleted `handleGetHealthStatus` (pre-migration) and the deleted `triggerBackgroundVerification` method both used `this.lastAutoVerifyTime` for rate-limiting auto-triggers when `.health/verification-status.json` was stale (>2 min). After migration, neither method exists; the constructor init was dead state.
- **Fix:** Removed the `this.lastAutoVerifyTime = null` line from the constructor.
- **Files modified:** integrations/system-health-dashboard/server.js
- **Commit:** `1d94015e3` (same commit)

### Ratified

- The plan called for keeping the `_forwardCoordinator` helper for symmetry with the obs-api's `_forwardObsApi`, even though the migrated route handlers (handleGetHealthStatus, handleGetHealthReport, handleTriggerVerification) call `fetch` directly with custom reshape rather than going through the helper. The helper IS still wired (6 HEALTH_COORDINATOR_URL references; one in the helper, two each in the three reshape handlers). Future routes that don't need reshaping can use the helper.
- The constraint-monitor's `npm run build` step was confirmed N/A (package.json has no `"build"` script). The plan's acceptance criterion explicitly accommodated this: "if `package.json` has no `"build"` script, this check is N/A — record N/A in summary." Recorded.

## Self-Check: PASSED

| Artifact | Status |
|----------|--------|
| `.planning/phases/33-health-monitoring-consolidation/33-05-SUMMARY.md` | FOUND (this file) |
| `scripts/health-prompt-hook.js` (220 lines, post-rewrite) | FOUND |
| `integrations/system-health-dashboard/server.js` (4295 lines, post-edit) | FOUND |
| `integrations/mcp-constraint-monitor/src/dashboard-server.js` (1190 lines, post-edit) | FOUND |
| Commit `ccc505b0b` (Task 1) in `git log` | FOUND |
| Commit `1d94015e3` (Task 2) in `git log` | FOUND |
| Commit `c5c4f280a` (parent submodule pointer bump) in `git log` | FOUND |
| Submodule commit `b16f9ca` in mcp-constraint-monitor `git log` | FOUND |
| `node --check` passes for all 3 files | PASS |
| SPEC AC #7 grep gate (`! grep -rE "readFileSync.*\.health/(verification\|.*-transcript-monitor)" ...`) | PASS |
| SPEC R6 grep gate (`! grep -nE "catch[^/]*return\s*['\"]healthy" ...`) | PASS |
| SPEC R8 envelope shape preserved when coordinator unreachable | PASS |
| Q3 graceful no-op outside coding repo emits empty additionalContext | PASS |
| HEALTH_COORDINATOR_URL referenced in all 3 files | PASS (1 + 5 + 2 = 8 references total) |
| Dashboard `_forwardCoordinator` / `/health/state` / `/health/refresh` references | PASS (7 matches in dashboard server.js) |
| Dashboard W4 broad-heal gate (no force-recreate / docker-compose up -d) | PASS |
| Dashboard W8 frontend dist gate (no supervisorctl tokens in dist/) | PASS |
| All 4 health-verifier route paths still registered in dashboard server.js | PASS (8 matches across `/api/health-verifier/(status\|report\|verify\|restart-service)\|/api/health\b`) |
| Submodule rebuild N/A confirmed (mcp-constraint-monitor package.json has no `"build"` script) | PASS |
| Constraint-monitor `import { readFileSync, ... } from 'fs'` preserved (other handlers still use it) | PASS (6 readFileSync call sites in non-health handlers) |
