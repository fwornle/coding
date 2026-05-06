# Phase 33: Health Monitoring Consolidation — Specification

**Created:** 2026-05-06
**Ambiguity score:** 0.10 (gate: ≤ 0.20)
**Requirements:** 9 locked

## Goal

Replace the four-layer host watchdog stack and the parallel readers of `.health/*.json` with a single coordinator process that owns one HTTP-served Single Source of Truth (SoT) for health state, exposes per-session keyed entries, and enforces a 10-second p95 detection SLA — such that the dashboard at `:3032`, the statusline daemon, the `health-prompt-hook`, and the in-container `/api/health-verifier/status` endpoint all derive their answer from the SAME SoT and never disagree.

## Background

**Today's stack** (all unhealthy, all interacting):

- `launchd com.coding.system-watchdog` (every ≥30s) → `scripts/system-monitor-watchdog.js`
  - Watches: `global-process-supervisor.js`, `global-service-coordinator.js`. 1499+ runs, kills supervisor every ~2 min when its health-file write cadence drifts past a 120s threshold.
- `scripts/global-process-supervisor.js` (PSM-tracked) → spawns:
  - `scripts/statusline-health-monitor.js --daemon --auto-heal`
  - `scripts/health-verifier.js start` (host)
- `scripts/global-service-coordinator.js --daemon`
- `scripts/global-lsl-coordinator.js monitor` (separate watchdog for transcript monitors)
- In-container supervisord program `health-verifier` (ran the same `scripts/health-verifier.js` file but inside the container — crash-looped on `lsof ENOENT` and `docker: not found`; disabled in Phase A)

**Today's readers** (each independently parsing files, fabricating their own view):

- Dashboard at `:3032` reads `/coding/.health/verification-status.json` inside container (NOT bind-mounted → drifts from host).
- Statusline daemon writes `.logs/combined-status-line-cache-coding.txt` from `.health/*` files.
- `scripts/health-prompt-hook.js` independently reads `.health/<projectName>-transcript-monitor-health.json`, `.observations/db-recovering.json`, `.health/.lsl-recovery-lock`, `.health/lsl-watchdog-heartbeat.json`, `.global-lsl-registry.json` — failures default to "all healthy" via silent `try/catch`.
- In-container `/api/health-verifier/verify` POST endpoint spawns its own short-lived verifier (which uses the in-container code lacking lsof/docker).

**Symptoms in production** (already remediated tactically in Phase A; untouched root cause):

- LSL "🔴 DOWN" while transcript monitor was actively writing every 4s (stale `.health/*-transcript-monitor-health.json` files for abandoned projects fire false alarms).
- Dashboard reports "Healthy 12 checks passed" while container was in a `bind_mount_freshness` recreate loop every ~5 min (different rule sets, no SoT agreement).
- `system-monitor-watchdog` killed `global-process-supervisor` 5 times in 12 min in one observed window because its 120s staleness threshold was tighter than the supervisor's actual write cadence under load.
- `--force-recreate coding-services` fired every 5 min for a stale rule referencing `scripts/consolidate-observations.js` — a file that was no longer bind-mounted, so the heal action could not possibly fix the symptom.
- Observation pipeline "gap" of 35 minutes because the transcript-monitor was the sole writer and a routine restart left no replay-from-state mechanism.

**v5.0 history:** the original "Service Reliability & Health System Overhaul" (Phases 24-27, planned but never shipped) was meant to address this. Phase 33 supersedes it with sharper, executable scope.

## Requirements

1. **Coordinator process owns the SoT**: a single host process is the sole writer of health state.
   - Current: four host node processes (`system-monitor-watchdog`, `global-process-supervisor`, `global-service-coordinator`, `global-lsl-coordinator`) and the in-container `/api/health-verifier/verify` handler all write to overlapping `.health/*.json` files.
   - Target: one host process named `health-coordinator` (or equivalent) is launched by `launchd com.coding.health-coordinator`; no other process writes to the SoT.
   - Acceptance: `pgrep -fl 'system-monitor-watchdog\|global-process-supervisor\|global-service-coordinator\|global-lsl-coordinator'` returns empty after Phase 33 ships; `lsof` on any SoT-backing storage shows only the coordinator PID as writer.

2. **HTTP endpoint serves the SoT**: every consumer reads via HTTP, not by parsing files.
   - Current: dashboard, statusline, prompt-hook, in-container endpoint each read different files.
   - Target: coordinator binds a localhost HTTP server (TBD port; default `3034`) exposing `GET /health/state` returning the canonical JSON; container readers use `host.docker.internal:<port>`.
   - Acceptance: `grep -rE "readFileSync.*\\.health/" scripts/health-prompt-hook.js scripts/statusline-health-monitor.js integrations/system-health-dashboard/server.js` returns zero matches against `verification-status.json` / `verification-report.json` / `*-transcript-monitor-health.json` after the cutover; instead, all three read via `fetch` against the coordinator endpoint.

3. **Per-session keyed health entries**: the SoT keys LSL health by session id, not by project alone.
   - Current: `.health/<projectName>-transcript-monitor-health.json` — one slot per project; two parallel sessions in the same project clobber each other.
   - Target: `/health/state` returns `{ lsl: { "<session_id>": { status, lastBeat, transcriptPath, projectPath, agent } } }` plus a derived per-project rollup `lsl_by_project[projectName] = "healthy" iff any session_id within projectName is fresh`.
   - Acceptance: with two `coding/bin/coding` sessions running in the same project, `GET /health/state` returns two distinct `lsl[*]` entries; killing one shows it as `status:'stopped'` while the other remains `status:'running'`; `lsl_by_project['coding']` stays `healthy`.

4. **Detection latency SLA**: real failures surface in the SoT within 10s p95 / 15s p99.
   - Current: latency varies from 0s (signal-driven) to 2 min (file mtime polling); no measurable SLA.
   - Target: coordinator polls each tracked entity every 5s; failure visible in `GET /health/state` within 10s p95.
   - Acceptance: instrumented test: stop a known service (e.g., `supervisorctl stop web-services:vkb-server`) at time T0; record T1 = time the next `GET /health/state` reports it as failed; over 50 trials, P95(T1-T0) ≤ 10s, P99(T1-T0) ≤ 15s.

5. **Narrow auto-heal: action targets the failed level**: no more sledgehammer container recreates.
   - Current: `bind_mount_freshness` rule fires `docker compose up -d --force-recreate coding-services` (whole-container recreate) for a per-file mismatch; `system-monitor-watchdog` kills+restarts the entire `global-process-supervisor` for a stale-mtime trigger.
   - Target: each auto-heal action is constrained to the smallest unit that owns the failure: in-container service down → `supervisorctl restart <service>`; host daemon down → coordinator restarts that daemon; container unhealthy per Docker's own healthcheck → `docker restart coding-services` (one container restart, not `--force-recreate`); bind-mount file-staleness rules → DELETED, not healed (the heal cannot fix the cause).
   - Acceptance: `grep -rE "force-recreate|--force-recreate" scripts/health-remediation-actions.js scripts/health-verifier.js` returns zero matches after Phase 33; the `bind_mount_freshness` auto-heal entry is removed from `config/health-verification-rules.json`.

6. **Detection, not silent fallback**: failed health-state checks must NOT default to "healthy".
   - Current: `scripts/health-prompt-hook.js:259-262` returns "All systems operational" on any uncaught exception; multiple `try { real check } catch { /* ignore */ }` blocks elsewhere silently treat errors as success.
   - Target: every check that can fail returns one of `healthy | degraded | unknown` — never "healthy" on exception. `unknown` propagates to consumers and renders distinctly (e.g., grey badge, not green).
   - Acceptance: `grep -rE "catch\\b.*\\{[^}]*return\\s*['\"]" scripts/health-prompt-hook.js scripts/health-verifier.js scripts/process-state-manager.js` (allowing for newlines) shows no fallback-to-healthy patterns; new `health-status-spec.test.js` injects exceptions in each check and asserts `unknown`, never `healthy`.

7. **Container health is delegated to Docker**: the host stack does not second-guess Docker's healthcheck.
   - Current: `health-verifier.js` runs `docker ps --filter status=running` to decide whether the container is "healthy"; multiple host-side rules duplicate Docker's own healthcheck logic.
   - Target: coordinator reads `docker inspect coding-services --format '{{.State.Health.Status}}'` (the Docker-native answer) and surfaces it as-is in `GET /health/state.container.healthcheck`; if Docker says `unhealthy`, the coordinator's only auto-heal is `docker restart coding-services` (one shot, no force-recreate); restart-policy `unless-stopped` is left to Docker.
   - Acceptance: `grep -rE "docker (ps|inspect) --filter\\s+status" scripts/health-verifier.js` returns zero matches after refactor; `GET /health/state.container.healthcheck` reflects Docker's reported state within 10s.

8. **Backward-compatible external contracts**: phase preserves three external contracts.
   - Current: prompt-hook returns `{hookSpecificOutput: {hookEventName, additionalContext}}`; dashboard endpoints `/api/health-verifier/status`, `/api/health-verifier/report`, `/api/health`, `POST /api/health-verifier/verify` are consumed by the dashboard frontend in `dist/`; `config/health-verification-rules.json` schema is referenced by intel and prior phases.
   - Target: prompt-hook output JSON shape unchanged (only string content may change); the four dashboard URLs respond with the same response shape (now proxied to the coordinator); `config/health-verification-rules.json` keeps its top-level structure (`rules.{databases,services,processes,...}` and per-rule keys `enabled`, `severity`, `check_type`, `auto_heal`, `auto_heal_action`); fields may be added but not removed/renamed.
   - Acceptance: existing `dist/` dashboard JS runs unchanged against the new endpoints; `health-prompt-hook.js` test assertion on the response JSON shape still passes; loading `config/health-verification-rules.json` with an Ajv schema (extracted from current keys) still validates successfully.

9. **Single-process supervision tree**: launchd starts ONE coordinator; if it dies, launchd restarts it.
   - Current: launchd starts `system-monitor-watchdog` which monitors a tree of node daemons; supervisor-of-supervisor pattern with multiple paths to "alive".
   - Target: a single `launchd com.coding.health-coordinator.plist` runs the coordinator; the four legacy watchdog plists/daemons are removed; if the coordinator process exits, launchd's `KeepAlive` restarts it within 30s.
   - Acceptance: `launchctl list | grep com.coding` returns exactly one entry (`com.coding.health-coordinator`); after `kill -9 <coordinator_pid>`, `pgrep -f health-coordinator` returns a fresh PID within 30s.

## Boundaries

**In scope:**

- New host process `health-coordinator` (single binary or single node script) implementing the SoT writer and HTTP server.
- New `launchd com.coding.health-coordinator.plist` replacing `com.coding.system-watchdog.plist`.
- Removal of the four legacy host daemons (`system-monitor-watchdog`, `global-process-supervisor`, `global-service-coordinator`, `global-lsl-coordinator`) and their launchd hooks.
- Conversion of `health-verifier.js` and `statusline-health-monitor.js` from active heal-and-restart daemons into pure REPORTER scripts (they emit signals to the coordinator; they no longer auto-heal).
- New `GET /health/state` HTTP contract on the coordinator (default port 3034; configurable via env).
- Migration of three readers (dashboard `:3032`, statusline daemon, `health-prompt-hook`) and the in-container `/api/health-verifier/status` proxy to use the new HTTP SoT.
- Per-session keyed LSL entries with project rollup view.
- Removal of `.health/*.json` files from the writer side (consumers no longer parse them).
- Removal of the `bind_mount_freshness` auto-heal entry from `config/health-verification-rules.json` (the heal action cannot fix the cause).
- Acceptance test script that reproduces the "two-session agreement" scenario (Requirement 3) and runs in CI.

**Out of scope:**

- Knowledge graph (UKB) workflow changes — owned by milestones v6.0 / v7.x; touching it here invites scope creep and a UKB-specific reviewer.
- Observations / consolidation pipeline (`scripts/consolidate-observations.js`, `obs-api`) — works as of Phase A; only changes here are where the pipeline intersects health monitoring (e.g., dropping observation-pipeline health from `health-verification-rules.json` if duplicated).
- LSL bucketing redesign (the "hour rollover" first-vs-last-tranche issue) — separate proposal worth its own phase; Phase A applied a one-line tactical fix that is sufficient until then.
- Constraint Monitor / dashboard at `:3030` — its rules are fine; only changes here are in how it consumes health state from the new SoT (a single `fetch` swap).
- Statusline cache file format (`.logs/combined-status-line-cache-coding.txt`) — explicitly NOT a backward-compat commitment; the new statusline reporter may rewrite this file in any shape it likes.
- Sub-second / event-driven detection (inotify, supervisord event listener, `docker events`) — explicitly deferred; 10s p95 polling is sufficient for the user-visible failure modes today.
- Encryption / authn on `GET /health/state` — endpoint binds to localhost only; container access is via `host.docker.internal` which is also localhost-scoped for Docker Desktop. If a non-localhost listener is ever needed, that is a separate phase.

## Constraints

- **Detection latency**: a failure visible to the coordinator MUST appear in `GET /health/state` within 10s p95 / 15s p99. Coordinator heartbeat fixed at 5s; dashboard auto-refresh fixed at 5s; prompt-hook + statusline cache TTL fixed at 2s.
- **Migration policy**: cutover, not shadow. All four legacy daemons are stopped and disabled in the same commit that installs the new coordinator. Rollback path = `launchctl unload com.coding.health-coordinator.plist` plus `launchctl load com.coding.system-watchdog.plist` and revert the SHA.
- **Reporter mode for legacy scripts**: `scripts/health-verifier.js` and `scripts/statusline-health-monitor.js` are NOT deleted in Phase 33; they are reduced to reporter scripts that POST signals to the coordinator. Their auto-heal arms are removed. They keep their CLI entry points so any cron / launch-on-demand callers continue to function.
- **Backward-compatible external contracts** (Requirement 8): three contracts preserved (prompt-hook JSON shape; dashboard `/api/health-verifier/*` URLs and response shapes; `config/health-verification-rules.json` top-level schema). Statusline cache file format is explicitly NOT preserved.
- **No bind-mount of `scripts/`** is required (the in-container dashboard backend stops calling the in-container verifier; instead it proxies `/api/health-verifier/status` to the host coordinator via `host.docker.internal:3034`).
- **Platform**: macOS Docker Desktop (M-series) and Linux Docker hosts both supported. The coordinator must work whether `host.docker.internal` resolves natively (Docker Desktop) or via `--add-host=host.docker.internal:host-gateway` (Linux); the existing compose file already passes the latter.
- **No new external dependencies** beyond what's already in `package.json` (`express` exists; node `http` is built-in). No `inotify`, no `chokidar` for SoT signals; the coordinator polls.
- **Tests live in the repo**: the two-session agreement acceptance test (Requirement 3) is a node script under `scripts/__tests__/` or `tests/health/`, not an external manual procedure.

## Acceptance Criteria

- [ ] `pgrep -fl '(system-monitor-watchdog|global-process-supervisor|global-service-coordinator|global-lsl-coordinator)'` returns empty after Phase 33 ships.
- [ ] `launchctl list | grep '^com\\.coding\\.'` returns exactly one entry: `com.coding.health-coordinator`.
- [ ] `curl -s http://localhost:3034/health/state` returns valid JSON with top-level keys `{ container, services, lsl, lsl_by_project, processes, generated_at, coordinator_uptime_s }`.
- [ ] Container reader: `docker exec coding-services curl -s http://host.docker.internal:3034/health/state` returns the SAME bytes the host sees (within the 5s heartbeat window).
- [ ] Two-session agreement test (scripted): two `coding/bin/coding` sessions running in `/coding`; dashboard, statusline cache, and prompt-hook all report `lsl_by_project.coding = healthy`; killing one session shows `lsl[<sid>].status = 'stopped'` for the dead one and `lsl_by_project.coding = healthy` (still — because the other session lives); no consumer reports "LSL DOWN" at any point. Test exits 0.
- [ ] Detection-latency test (scripted): 50 trials of `supervisorctl stop web-services:vkb-server` followed by polling `GET /health/state`. P95(T1−T0) ≤ 10s, P99(T1−T0) ≤ 15s. Test exits 0.
- [ ] `grep -rE "force-recreate|--force-recreate" scripts/health-remediation-actions.js scripts/health-verifier.js` returns zero matches.
- [ ] `grep -rE "readFileSync.*\\.health/(verification|.*-transcript-monitor)" scripts/health-prompt-hook.js scripts/statusline-health-monitor.js integrations/system-health-dashboard/server.js` returns zero matches.
- [ ] Prompt-hook JSON shape preserved: `echo '{"cwd":"/Users/Q284340/Agentic/coding"}' | node scripts/health-prompt-hook.js | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "hookSpecificOutput" in d and "additionalContext" in d["hookSpecificOutput"]'` exits 0.
- [ ] Dashboard endpoints preserved: `curl -fs http://localhost:3032/api/health-verifier/status | python3 -m json.tool` returns valid JSON with the same top-level keys present today (`overallStatus`, `violationCount`, `criticalCount`, `lastUpdate`, `autoHealingActive`).
- [ ] `config/health-verification-rules.json` validates against an Ajv schema extracted from the current file's top-level structure.
- [ ] Coordinator survives `kill -9 <pid>`: launchd respawns it within 30s; `pgrep -f health-coordinator` returns a fresh PID.
- [ ] Injection test: in `scripts/health-verifier.js` reporter mode, replace one check function body with `throw new Error('forced')`; the coordinator's `GET /health/state` reflects that signal as `unknown`, never `healthy`.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                                                              |
|--------------------|-------|------|--------|----------------------------------------------------------------------------------------------------|
| Goal Clarity       | 0.92  | 0.75 | ✓      | SoT physical form (HTTP @ host), per-session keying, headline acceptance test all locked.          |
| Boundary Clarity   | 0.92  | 0.70 | ✓      | Cutover migration; explicit out-of-scope list (UKB, observations, LSL bucketing, sub-second).      |
| Constraint Clarity | 0.88  | 0.65 | ✓      | 10s p95 / 15s p99 SLA; 5s heartbeat; three backward-compat contracts; no new deps.                 |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 13 pass/fail checks including 2 scripted scenario tests with measured latency.                     |
| **Ambiguity**      | 0.10  | ≤0.20| ✓      |                                                                                                    |

## Interview Log

| Round | Perspective    | Question summary                                              | Decision locked                                                                                       |
|-------|----------------|---------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| 1     | Researcher     | Where does the SoT physically live?                           | HTTP endpoint on host (`/health/state`), coordinator-owned, container reads via `host.docker.internal`. |
| 1     | Researcher     | What's "healthy LSL" when 2 sessions run in 1 project?         | Per-session keyed; project healthy iff ≥1 session_id fresh; dead sessions visible but don't red-flag the project. |
| 2     | Simplifier     | How aggressive is the migration from 4 watchdogs to 1?         | Cutover. All four legacy daemons stopped + disabled in the same commit. Old health-verifier / statusline-monitor become reporters (no auto-heal). Old `.health/*.json` deleted. |
| 2     | Simplifier     | What single scenario, when it passes, declares Phase 33 done?  | Two-session agreement test (scripted). Two sessions in `coding`, kill one, all three readers agree the project is still healthy with one stopped session. |
| 3     | Boundary Keeper| What detection latency SLA?                                    | 5s heartbeat, 10s p95 / 15s p99 detection. Dashboard refresh 5s; prompt-hook + statusline cache 2s.    |
| 3     | Boundary Keeper| What backward-compat contracts must be preserved?              | Prompt-hook JSON shape; dashboard `/api/health-verifier/*` endpoints + response shapes; `config/health-verification-rules.json` top-level schema. **Statusline cache file format NOT preserved.** |

---

*Phase: 33-health-monitoring-consolidation*
*Spec created: 2026-05-06*
*Next step: /gsd-discuss-phase 33 — implementation decisions (coordinator language/runtime, reporter signal protocol, exact port, plist details, test harness shape)*
