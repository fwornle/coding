---
phase: 33-health-monitoring-consolidation
plan: 07
subsystem: infra
tags: [cutover, launchctl, docker-compose, single-process-supervision, spec-r9, spec-r2, wave-5]
status: pending human-verify

requires:
  - phase: 33-02
    provides: ~/Library/LaunchAgents/com.coding.health-coordinator.plist (created on disk; this plan bootstraps it for the first time)
  - phase: 33-04
    provides: scripts/health-verifier.js + scripts/statusline-health-monitor.js reduced to reporters (no longer auto-heal — coordinator owns supervision)
  - phase: 33-05
    provides: integrations/system-health-dashboard/server.js + integrations/mcp-constraint-monitor/src/dashboard-server.js reverse-proxy /health-verifier/* routes to host coordinator (SPEC R8 + RESEARCH §8 leak)
  - phase: 33-06
    provides: config/health-verification-rules.json without bind_mount_freshness/supervisord_status; scripts/health-remediation-actions.js without refreshBindMounts/--force-recreate; B2 pre-cutover smoke gate PASS

provides:
  - HEALTH_COORDINATOR_URL=http://host.docker.internal:3034 wired into the coding-services container (D-02)
  - 4 legacy host daemons deleted from disk + git (SPEC R9): system-monitor-watchdog, global-process-supervisor, global-service-coordinator, global-lsl-coordinator
  - Legacy launchd plist com.coding.system-watchdog booted out + removed from disk
  - New launchd plist com.coding.health-coordinator bootstrapped (first time loaded)
  - Coordinator process running (PID 92419 as of cutover) and serving /health, /health/state, /signals, /health/refresh from 0.0.0.0:3034
  - Container can reach the host coordinator via host.docker.internal (verified)
  - Stale .health/*-transcript-monitor-health.json files removed; .lsl-recovery-lock and lsl-watchdog-heartbeat.json removed (PATTERNS.md: ETM no longer writes them post-cutover)
  - 7 stragglers cleaned up where Phase 33's earlier waves missed legacy-daemon references (Rule 3 deviation): scripts/{health-coordinator, auto-restart-watcher, fix-runifmain-closing, fix-esm-paths, combined-status-line, start-services-robust, monitoring-verifier}.js

affects:
  - launch-agent-common.sh's monitoring-verifier --strict gate now probes the new health-coordinator HTTP server instead of the deleted scripts; Claude session startup post-cutover is unblocked
  - 33-08 acceptance — full 50-trial detection-latency runs against the live cutover; quick.sh smoke test from 33-01 now PASSES (was SKIP on Wave 0)

tech-stack:
  added: []
  patterns:
    - "Cutover (not shadow) migration: legacy plist booted out + new plist bootstrapped + 4 legacy script files deleted in the same plan, per SPEC Constraints 'Migration policy: cutover, not shadow'."
    - "Host launchd KeepAlive supervision: com.coding.health-coordinator.plist (created in 33-02) replaces com.coding.system-watchdog.plist + the four-daemon supervisor-of-supervisor tree."
    - "Container -> host coordinator via HEALTH_COORDINATOR_URL=http://host.docker.internal:3034 (D-02). extra_hosts: ['host.docker.internal:host-gateway'] in docker-compose.yml wires this on Linux; on macOS Docker Desktop it resolves natively. SAME shape as OBS_API_URL=http://host.docker.internal:12436 (line 61)."
    - "W9 fail-loud bootout pattern: conditional launchctl bootout with hard-fail-on-bootout-error (per RESEARCH §9 macOS 14+ requires bootout, not unload). Post-bootout assertion enforces the legacy plist is no longer in launchctl list before proceeding."
    - "Rule 3 deviation: 7 source files contained residual references to the four deleted daemons. Three categories of cleanup applied: (a) JSDoc/comment rewording for files where the references were prose-only; (b) removal of deleted-file paths from one-shot maintenance script lists (fix-runifmain-closing, fix-esm-paths); (c) substantial method-level rewrite to redirect monitoring-verifier.js's strict-mode probe at the new health-coordinator HTTP server, plus deletion of the GPS spawn paths from combined-status-line.js and start-services-robust.js since launchd's KeepAlive owns supervision post-cutover."

key-files:
  created: []
  modified:
    - docker/docker-compose.yml (+4 lines — HEALTH_COORDINATOR_URL env var)
    - scripts/health-coordinator.js (+5/-4 lines — reword JSDoc references)
    - scripts/auto-restart-watcher.js (+3/-1 lines — reword JSDoc reference)
    - scripts/fix-runifmain-closing.js (+4/-3 lines — list cleanup)
    - scripts/fix-esm-paths.js (+5/-3 lines — list cleanup)
    - scripts/combined-status-line.js (-127 lines — delete GPS spawn methods + arbitration block)
    - scripts/start-services-robust.js (-92 lines — delete globalProcessSupervisor service config + invocation block; +5 lines reword comments)
    - scripts/monitoring-verifier.js (~73-line refactor — verifySystemWatchdog/verifyCoordinator/verifyRecoveryTest/installAll redirected at health-coordinator HTTP)
  deleted:
    - scripts/system-monitor-watchdog.js (legacy launchd-driven watchdog of supervisor + coordinator daemons; SPEC R9)
    - scripts/global-process-supervisor.js (host process supervisor of health-verifier + statusline-health-monitor; SPEC R9)
    - scripts/global-service-coordinator.js (global service coordinator daemon; SPEC R9)
    - scripts/global-lsl-coordinator.js (per-project LSL transcript-monitor coordinator; SPEC R9)
    - ~/Library/LaunchAgents/com.coding.system-watchdog.plist (legacy plist booted out + rm; SPEC R9)
    - .health/*-transcript-monitor-health.json (7 stale files — PATTERNS.md: ETM no longer writes them)
    - .health/.lsl-recovery-lock, .health/lsl-watchdog-heartbeat.json

key-decisions:
  - "Cutover sequence (intentional and atomic): (1) compose env var lands on disk, (2) container rebuilt + restarted picking up the env var, (3) 4 legacy daemon scripts git-rm'd (with stragglers cleaned up in a separate commit per Rule 3 deviation), (4) legacy plist booted out + rm'd, (5) port 3034 freed if held, (6) new plist bootstrapped, (7) coordinator HTTP probed up, (8) stale .health/*.json files cleaned. Step 8's cleanup is harmless if files are already absent (rm -f)."
  - "SPEC AC #2 'exactly one com.coding.* launchctl entry' deviation: at cutover time launchctl shows TWO entries — com.coding.health-coordinator (the new one this plan bootstrapped) AND com.coding.llm-cli-proxy (a separate launch agent for the LLM CLI proxy at /Users/Q284340/Agentic/_work/rapid-llm-proxy/bin/start-llm-proxy.sh, predates Phase 33's SPEC, out of scope per SPEC Boundaries 'In scope/Out of scope'). The SPEC author did not anticipate the LLM CLI proxy launch agent. Treating AC #2's intent as 'exactly one of the four-legacy-daemon-replacement entries' is the right interpretation; literal AC #2 grep would require booting out llm-cli-proxy which is not in this plan's scope. Documented as a SPEC↔reality drift to be reconciled by the verifier."
  - "SPEC AC #3 path mismatch deviation: the SPEC mentions /health/state.container.healthcheck but the coordinator's actual schema (from plan 33-03's wave-controller refactor) uses /health/state.container.status. The container CAN reach the coordinator (verified — HTTP 200 + valid JSON parsed) and .container key is present; the specific .healthcheck child key returns null in both host AND container fetches (i.e., consistent SoT, no host-vs-container drift). This is a prior-plan implementation gap from 33-03, not a 33-07 cutover regression. The plan's intent (container can reach coordinator and parse the response) is satisfied."
  - "Rule 3 deviation, scope-expanded cleanup: the plan's Task 3 audit grep (`grep -rEl 'system-monitor-watchdog|global-process-supervisor|global-service-coordinator|global-lsl-coordinator' scripts/ integrations/ lib/ tests/ --include='*.js' --include='*.mjs' --include='*.ts' --include='*.tsx'`) was expected to find zero matches per the plan's `<read_first>` analysis (Plan 33-04/05 supposedly already cleaned all consumers). Reality: 7 files still contained references. Five were trivial (cosmetic JSDoc / one-shot maintenance script path lists), but three were runtime-active (combined-status-line.js's GPS spawn arbitration; start-services-robust.js's globalProcessSupervisor service config; monitoring-verifier.js's --strict gate that bin/coding's launch-agent-common.sh runs at every Claude session startup). Without cleanup of monitoring-verifier.js in particular, EVERY post-cutover Claude session would have failed the strict gate and exited 1. This is a Rule 3 (auto-fix blocking issue) — fixed in commit ae8d504ff."

requirements-completed: [R1, R2, R5, R7, R9]

duration: 25min
completed: 2026-05-07
tasks_completed: 4
tasks_pending: 1
files_modified: 8
files_deleted: 4
total_lines_added: 51
total_lines_deleted: 3122
commits: 3
---

# Phase 33 Plan 07: Cutover Commit — Summary (PARTIAL — pending Task 5 human-verify)

**Status:** Tasks 1-4 complete. Task 5 is a `checkpoint:human-verify` gate — awaiting user approval. This SUMMARY documents the cutover state for the human verifier and is finalized when the human approves.

The Phase 33 cutover landed: HEALTH_COORDINATOR_URL is wired into the coding-services container, the four legacy host daemons (system watchdog + 3 supervisors) are deleted from disk and git, the legacy launchd plist com.coding.system-watchdog is booted out + removed from disk, and the new com.coding.health-coordinator plist is bootstrapped and serving HTTP on :3034 from both host and container.

## Cutover Steps Executed

| Step | What | Outcome |
|------|------|---------|
| Task 1 | Add `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` to `docker/docker-compose.yml` `coding-services.environment` | YAML valid; env var lands at line 65 (inside coding-services block) |
| Task 2 | `docker-compose build coding-services && docker-compose up -d coding-services` (using worktree's compose file) | Image rebuilt (118.5s build); container Up + healthy; `docker exec coding-services printenv HEALTH_COORDINATOR_URL` returns `http://host.docker.internal:3034` |
| Task 3 | `git rm` the four legacy daemon scripts | 4 files deleted (-2,758 lines); `! grep -rEl '<legacy-names>' --include='*.js' …` exits 0 after stragglers cleaned up; all 7 kept scripts pass `node --check` |
| Task 3 stragglers | Rule 3 deviation — clean up 7 files that still referenced the deleted daemons | Resolved in commit ae8d504ff (-364/+129 lines); see Deviations section |
| Task 4 — Step 2 | `launchctl bootout gui/$UID com.coding.system-watchdog.plist` | Bootout succeeded; W9 post-bootout assertion confirmed legacy no longer in launchctl |
| Task 4 — Step 3 | `rm -f ~/Library/LaunchAgents/com.coding.system-watchdog.plist` | File deleted from disk |
| Task 4 — Step 4 | `test -f com.coding.health-coordinator.plist` | OK (created by plan 33-02) |
| Task 4 — Step 5 | Free port 3034 | Port already free; nothing to kill |
| Task 4 — Step 6 | `launchctl bootstrap gui/$UID com.coding.health-coordinator.plist` | Exit 0; plist loaded |
| Task 4 — Step 7 | Wait for coordinator HTTP | `curl /health` succeeded after 3 seconds |
| Task 4 — Step 8 | `rm -f .health/*-transcript-monitor-health.json .health/.lsl-recovery-lock .health/lsl-watchdog-heartbeat.json` | 7 stale per-project transcript-monitor-health files removed; lock and heartbeat files (already absent — no-op) |

## Coordinator State At Cutover Completion

**Coordinator process (PID 92419 — `health-coordinator.js` on `/opt/homebrew/bin/node`):**

```
  PID ELAPSED STARTED COMMAND
92419   01:07  9:04AM /opt/homebrew/bin/node /Users/Q284340/Agentic/coding/scripts/health-coordinator.js
```

**Coordinator uptime as of cutover summary write:** 65 seconds (and counting; launchd KeepAlive ensures it stays up).

**`launchctl list | grep com.coding`:**

```
67019   0   com.coding.llm-cli-proxy
92419   0   com.coding.health-coordinator
```

(Two entries; `com.coding.llm-cli-proxy` is out of scope of Phase 33 — see Deviation #2 below for the SPEC AC #2 wording mismatch.)

## /health/state Probe Results (SPEC AC #3 + #4)

**Host (curl localhost:3034/health/state):**

Top-level keys returned (jq `keys`):

```
[
  "container",
  "coordinator_uptime_s",
  "databases",
  "files",
  "generated_at",
  "lsl",
  "lsl_by_project",
  "processes",
  "services"
]
```

All 7 SPEC AC #3 mandated keys present (`container`, `services`, `lsl`, `lsl_by_project`, `processes`, `generated_at`, `coordinator_uptime_s`); plus `databases` and `files` from the rule iterator (additive, not removing).

**Container (docker exec coding-services curl host.docker.internal:3034/health/state):**

Identical keys returned — same SoT, no host/container drift. The container's HEALTH_COORDINATOR_URL env var is set, the extra_hosts line in docker-compose.yml resolves host.docker.internal, and the curl path through Docker Desktop succeeds. SPEC AC #4 satisfied (with the wording deviation noted under Deviation #3).

## Smoke Test Result

```
$ bash scripts/__tests__/health-coordinator/quick.sh
[TEST  1] coordinator HTTP /health responds                            PASS
[TEST  2] /health/state has all required keys                          PASS

============================================
Total: 2  Passed: 2  Failed: 0  Skipped: 0
============================================
exit 0
```

Both smoke tests now PASS. (Pre-cutover, the coordinator was unreachable on production :3034 and quick.sh reported SKIP per the plan-33-01 contract; post-cutover, it PASSES.)

## Commits This Plan

| Hash | Message |
|------|---------|
| `c859c0124` | feat(33-07): add HEALTH_COORDINATOR_URL env var to coding-services |
| `9b09e8695` | feat(33-07): delete four legacy daemon scripts (SPEC R9) |
| `ae8d504ff` | fix(33-07): scrub residual references to deleted legacy daemons |
| (pending) | docs(33-07): summary — partial pre-checkpoint (this commit, before Task 5 human-verify) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] 7 source files still referenced the four deleted legacy daemons after Task 3's `git rm`**

- **Found during:** Task 3 audit grep (the explicit acceptance gate `! grep -rEl '<legacy-names>' scripts/ integrations/ lib/ tests/ --include='*.js' …`).
- **Issue:** The plan's `<read_first>` notes anticipated the audit grep would return zero matches because plans 33-04 and 33-05 supposedly cleaned all consumers ("Plan 33-04's reduction of `statusline-health-monitor.js` already removed `getGlobalCodingMonitorHealth` (which called global-service-coordinator). Plan 33-05's migration of `health-prompt-hook.js` removed the `global-lsl-coordinator` spawn. So a clean grep is expected — but DO check."). Reality: 7 files still contained references — three of them runtime-active.
- **Fix:** Three categories of cleanup, all in commit `ae8d504ff`:
  - **Cosmetic** (JSDoc / comment rewrites — no behavior change): `scripts/health-coordinator.js`, `scripts/auto-restart-watcher.js`. The references were prose-only ("Replaces system-monitor-watchdog.js, global-process-supervisor.js, …"); reworded to use generic role names instead of file names.
  - **Path-list pruning** (one-shot maintenance scripts — no behavior change): `scripts/fix-runifmain-closing.js`, `scripts/fix-esm-paths.js`. Removed the deleted-script paths from each script's filesToCheck/filesToFix array.
  - **Runtime cleanup** (real behavior change — necessary post-cutover): three files needed surgery:
    - `scripts/combined-status-line.js`: deleted ~120 lines (`isGlobalProcessSupervisorRunning`, `ensureGlobalProcessSupervisorRunning`, `startGlobalProcessSupervisor` methods + the GPS-vs-CSL spawn-arbitration block at the top of `generateStatus()`). Without this, CSL would have repeatedly tried to spawn the deleted supervisor.js (no-op'd by `existsSync` early-return, but spamming logs).
    - `scripts/start-services-robust.js`: deleted ~78 lines (the `globalProcessSupervisor` service config block in `SERVICE_CONFIGS` at lines 588-665, plus its invocation block in `main()` at lines 1283-1302). Without this, `start-services-robust.js` would have logged "Global process supervisor died immediately" on every `bin/coding` launch (the script-not-found case actually returns gracefully but the surrounding `startServiceWithRetry` would still report a failed service).
    - `scripts/monitoring-verifier.js`: rewrote `verifySystemWatchdog` (now probes `launchctl list | grep com.coding.health-coordinator`), `verifyCoordinator` (now `fetch http://localhost:3034/health` + `/health/state`), `verifyRecoveryTest` (now checks `~/Library/LaunchAgents/com.coding.health-coordinator.plist` exists), and `installAll` (no longer mutates launchd; just reports diagnostics). **Critical**: `bin/coding`'s `launch-agent-common.sh:67` calls `node monitoring-verifier.js --project … --strict` and EXITS 1 if the verifier fails — without this rewrite, EVERY new Claude session post-cutover would be blocked. This was the highest-impact straggler.
- **Files modified:** scripts/{health-coordinator, auto-restart-watcher, fix-runifmain-closing, fix-esm-paths, combined-status-line, start-services-robust, monitoring-verifier}.js
- **Commit:** `ae8d504ff`

### Documented but not auto-fixed (out of scope of this plan)

**2. [Documented deviation] SPEC AC #2 wording mismatch — `com.coding.llm-cli-proxy` is out of scope of Phase 33**

- **What it says:** "SPEC AC #2: `launchctl list | grep '^com\\.coding\\.'` returns exactly one entry: `com.coding.health-coordinator`."
- **Reality at cutover:** `launchctl list | grep com.coding` shows TWO entries — `com.coding.health-coordinator` (the new one this plan bootstrapped) AND `com.coding.llm-cli-proxy` (a separate launch agent for the LLM CLI proxy at `/Users/Q284340/Agentic/_work/rapid-llm-proxy/bin/start-llm-proxy.sh`, predates Phase 33's SPEC; documented in MEMORY.md "LLM proxy: launchd wrapper for corp-vs-public HTTPS_PROXY").
- **Why this is OK:** SPEC Boundaries explicitly enumerate Phase 33's scope (the four legacy host daemons + the system watchdog plist), and the LLM CLI proxy is not in that list. The SPEC author did not anticipate the LLM CLI proxy launch agent. The intent of AC #2 is "exactly one of the FOUR legacy-daemon replacements is loaded, not multiple watchdog/supervisor entries"; that intent is satisfied (only one of `com.coding.health-coordinator` is loaded).
- **Surfaced for the verifier.** A future SPEC clarification could re-word AC #2 as `launchctl list | grep -c '^.*com\\.coding\\.(system-watchdog|health-coordinator)'` returns exactly 1.
- **No fix applied:** booting out `com.coding.llm-cli-proxy` is explicitly out of this plan's scope.

**3. [Documented deviation] SPEC AC #4 path mismatch — `.container.healthcheck` returns null but container CAN reach coordinator**

- **What it says:** "SPEC AC #4: container can reach coordinator: `docker exec coding-services curl -fs http://host.docker.internal:3034/health/state | jq -e '.container.healthcheck' >/dev/null` exits 0."
- **Reality at cutover:** Container HTTP fetch succeeds (HTTP 200, valid JSON parsed by jq). The `.container` key is present and contains `{ status, last_probe_end }`. But the specific child key `.container.healthcheck` (which the SPEC AC #4 jq path expects) is `null` — both from host AND container (i.e., consistent SoT, no drift).
- **Root cause:** The coordinator's `.container` schema (from plan 33-03's wave-controller refactor) emits `{ status, last_probe_end }`, not `{ healthcheck }`. The SPEC author wrote AC #4 against an earlier draft schema that included `.container.healthcheck`.
- **Why this is NOT a 33-07 regression:** The plan's intent — "container can reach coordinator and parse the response" — is satisfied (verified with `jq -e '.container'` returning success). The specific child key is a prior-plan implementation gap from 33-03.
- **Surfaced for the verifier.** A future SPEC patch / 33-03 follow-up could either rename `.container.status` → `.container.healthcheck` or update AC #4's jq path.
- **No fix applied:** changing the coordinator's schema is out of this plan's scope and could break readers.

## Awaiting

Task 5 — `checkpoint:human-verify` blocking gate. Per the plan's `<how-to-verify>`:

1. Open http://localhost:3032 in a browser; system-health dashboard renders; "Health Status" card sourced from new coordinator.
2. Click "Run Verification" button; lastUpdate timestamp advances (proves D-04: button → POST /health/refresh → coordinator force-tick).
3. Open http://localhost:3030; constraint dashboard still renders; health-verifier panel populates from coordinator data.
4. `tail -f /Users/Q284340/Agentic/coding/.logs/health-coordinator.log` shows periodic 5s tick activity.
5. `pgrep -fl 'system-monitor-watchdog|global-process-supervisor|global-service-coordinator|global-lsl-coordinator'` is empty (SPEC AC #1).
6. `launchctl list | grep com.coding` (SPEC AC #2 — see Deviation #2 above for the LLM CLI proxy entry).
7. (Optional but recommended) Two `coding/bin/coding` panes in tmux against this repo; dashboard's LSL panel shows two distinct sessions; close one and verify dashboard still says project healthy with one session stopped.

Human types **"approved"** when items 1-6 (and ideally 7) all pass; otherwise reports the failure with the diagnostic captures from the plan's how-to-verify section.

## Post-Checkpoint Patch (Option A from human-verify) — 2026-05-07

Human-verify revealed gaps the agent's pre-checkpoint smoke test (`quick.sh`) didn't catch — `quick.sh` only checks HTTP responsiveness and key presence, not data correctness. The user chose **Option A: kill zombie daemons in this plan, defer the rest to 33-08**.

### Patch applied (Deviation #4)

**Problem:** SPEC AC #1 (`pgrep` for legacy daemons returns empty) was VIOLATED at the checkpoint:

```
5299  global-lsl-coordinator.js monitor          (ppid=1, detached nohup daemon)
32167 global-service-coordinator.js --daemon     (ppid=1)
88822 global-process-supervisor.js --daemon      (ppid=1)
```

These were spawned by `bin/coding/launch-agent-common.sh` -> `scripts/agent-common-setup.sh` in earlier sessions via `nohup ... &`. The plan's `launchctl bootout` step couldn't reach them because they're children of launchd (PID 1), not children of the legacy plist's job.

**Fixed by:**

1. **Killed the 3 zombie PIDs** with `kill` then `kill -9` for the LSL one. Post-kill: `pgrep -fl '<legacy-names>'` returns empty. SPEC AC #1 now satisfied.

2. **Patched `scripts/agent-common-setup.sh`** to remove residual spawn calls so future session restarts don't re-spawn deleted daemons:
   - Lines 404-423 (function `start_transcript_monitoring`): removed the `if node ".../global-lsl-coordinator.js" ensure ... ; then ... else fallback ...` wrapper. The "fallback" path (which spawns ETM directly via `nohup node enhanced-transcript-monitor.js`) is now the always-path. ETM (reduced to a reporter in 33-04) POSTs `lsl_heartbeat` to the coordinator.
   - Lines 516-539 (function `start_global_lsl_monitoring`): replaced body with `return 0` no-op stub. Function definition retained so the call at line 755 and `export -f` at line 780 don't break — to be cleaned up in 33-08 gap-closure.

3. **Verified** `bash -n scripts/agent-common-setup.sh` exits 0 (syntax OK).

### Known gaps for 33-08 to surface (NOT fixed in this plan)

These are real gaps the human-verify uncovered. Deferred to **plan 33-08 acceptance suite + `/gsd-plan-phase 33 --gaps` cycle**, not patched inline because they cross plan boundaries:

| # | Symptom | Root cause | Owner phase |
|---|---|---|---|
| G1 | Coordinator's `services[]` returns ALL `status: "unknown"` (vkb_server, constraint_monitor, dashboard_server, health_dashboard_api/frontend, etc.) — dashboard at :3032 shows 8 violations + all ports "Down" | **33-03 gap.** Coordinator's check registry has no active probe for services that don't POST signals. Legacy `global-service-coordinator.js` did periodic port liveness probes; that logic wasn't ported into `health-coordinator.js`'s registry. | 33-08 -> gap-closure |
| G2 | Dashboard "Run Verification" button -> `[HEALTH] [ERROR] Failed to trigger verification: Verification trigger failed` in browser console | **33-05 bug.** Dashboard's POST `/api/health-verifier/verify` reverse-proxy isn't successfully reaching coordinator's POST `/health/refresh`. Likely method/header issue in `_forwardCoordinator`. | 33-08 -> gap-closure |
| G3 | Tmux statusline shows `[LSL🔴]` red on both panes; project names missing — but coordinator reports `lsl_by_project: {coding: 'healthy', daFrankTeam: 'healthy'}` | **33-04 gap.** Session-ID mismatch between ETM signals (`claude-60474-1777723363`) and statusline reader's expected key (`coding-claude-85122`). Reader's key derivation or ETM payload's `session_id` differs across reader/coordinator. | 33-08 -> gap-closure |
| G4 (already documented as Deviation #3) | `.container.healthcheck` is `null` (SPEC AC #4 jq path) | **33-03 schema drift.** Coordinator emits `.container.{status, last_probe_end}` not `.container.healthcheck`. | 33-08 -> gap-closure (or SPEC patch) |
| G5 (low priority) | `scripts/free-coding-ports.sh` lines 21-28 still reference `global-service-coordinator` | Pgrep-guarded no-op — only runs at coding-stop time, harmless when target process doesn't exist. | 33-08 cleanup |

**Expected 33-08 outcome:** AC #1 will now pass after this patch, AC #2 will deviation-pass, AC #3 will pass, AC #4 will deviation-pass, AC #5 (two-session-agreement) will likely fail due to G3, AC #6 (verification-trigger-via-dashboard) will fail due to G2. **That's expected and OK** — 33-08's job is to surface these, then `/gsd-plan-phase 33 --gaps` writes the closure plan.

## Self-Check: PASSED (post-patch checkpoint state)

| Artifact | Status |
|----------|--------|
| `docker/docker-compose.yml` contains `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` | FOUND |
| `docker exec coding-services printenv HEALTH_COORDINATOR_URL` returns the URL | PASS |
| 4 legacy daemon scripts deleted from disk | PASS (all 4) |
| 4 legacy daemon scripts deleted from git index | PASS (`git status` clean for these paths) |
| audit grep `! grep -rEl '<legacy-names>' --include='*.js' …` exits 0 | PASS (after Rule 3 cleanup commit `ae8d504ff`) |
| Legacy plist booted out + file deleted | PASS |
| New plist file present on disk | PASS |
| New plist loaded in launchctl | PASS |
| Coordinator HTTP `/health` reachable from host | PASS |
| Coordinator HTTP `/health/state` from host has all 7 SPEC AC #3 keys | PASS |
| Container can fetch `/health/state` via host.docker.internal | PASS |
| Stale `.health/*-transcript-monitor-health.json` files removed | PASS (count 0) |
| `bash scripts/__tests__/health-coordinator/quick.sh` exit 0 | PASS (2/2 tests pass) |
| Commit `c859c0124` (Task 1: compose env) | FOUND in `git log` |
| Commit `9b09e8695` (Task 3: legacy script deletions) | FOUND in `git log` |
| Commit `ae8d504ff` (Task 3 deviation: straggler cleanup) | FOUND in `git log` |
| All 7 kept + 7 cleaned scripts pass `node --check` | PASS (14 / 14) |
| SPEC AC #2 (exactly 1 com.coding.* entry) | DEVIATION (Deviation #2 — LLM CLI proxy out of scope) |
| SPEC AC #4 (`.container.healthcheck` jq path) | DEVIATION (Deviation #3 — schema drift, container reachability OK) |

State management note: STATE.md and ROADMAP.md NOT modified by this executor (per orchestrator instructions — Task 5 is a blocking checkpoint and the orchestrator owns those writes when human approves).
