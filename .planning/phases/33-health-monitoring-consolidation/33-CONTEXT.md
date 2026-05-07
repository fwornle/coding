# Phase 33: Health Monitoring Consolidation - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the four-layer host watchdog stack (launchd → system-monitor-watchdog → global-process-supervisor → service) and the parallel readers of `.health/*.json` with a **single host coordinator process** that:

- Owns the canonical health-state Single Source of Truth.
- Exposes it via `GET /health/state` on `localhost:3034` (containers reach via `host.docker.internal:3034`).
- Receives heartbeat signals from reporters via `POST /signals`.
- Surfaces failures within 10s p95 / 15s p99 of the underlying event.
- Drives narrow, level-matched auto-heal (no more whole-container `--force-recreate`).
- Is the only process started by launchd (one plist; if it dies, launchd restarts it).

After cutover: one new daemon (`health-coordinator`), four legacy daemons removed, two existing scripts (`health-verifier.js`, `statusline-health-monitor.js`) reduced to reporter mode (no auto-heal arms), three external contracts preserved (prompt-hook JSON shape, dashboard `/api/health-verifier/*` endpoints, `health-verification-rules.json` top-level schema).

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**9 requirements are locked.** See `33-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `33-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- New host process `health-coordinator` (single binary or single node script) implementing the SoT writer and HTTP server.
- New `launchd com.coding.health-coordinator.plist` replacing `com.coding.system-watchdog.plist`.
- Removal of the four legacy host daemons (`system-monitor-watchdog`, `global-process-supervisor`, `global-service-coordinator`, `global-lsl-coordinator`) and their launchd hooks.
- Conversion of `health-verifier.js` and `statusline-health-monitor.js` from active heal-and-restart daemons into pure REPORTER scripts.
- New `GET /health/state` HTTP contract on the coordinator (default port 3034; configurable via env).
- Migration of three readers (dashboard `:3032`, statusline daemon, `health-prompt-hook`) and the in-container `/api/health-verifier/status` proxy to use the new HTTP SoT.
- Per-session keyed LSL entries with project rollup view.
- Removal of `.health/*.json` files from the writer side.
- Removal of the `bind_mount_freshness` auto-heal entry from `config/health-verification-rules.json`.
- Acceptance test script that reproduces the "two-session agreement" scenario.

**Out of scope (from SPEC.md):**
- Knowledge graph (UKB) workflow changes.
- Observations / consolidation pipeline (works as of Phase A).
- LSL bucketing redesign (the "hour rollover" issue) — separate phase.
- Constraint Monitor / dashboard at `:3030` — only changes are how it consumes the new SoT.
- Statusline cache file format — explicitly NOT a backward-compat commitment.
- Sub-second / event-driven detection — explicitly deferred; 10s p95 polling is sufficient.
- Encryption / authn on `GET /health/state` — endpoint binds to localhost only.

</spec_lock>

<decisions>
## Implementation Decisions

### Signal Protocol (Reporter → Coordinator)

- **D-01: HTTP POST per signal.** Reporters send `POST /signals` with a JSON body on each tick. Idempotent, debuggable with `curl`, fits existing Express patterns. ~5s heartbeat → ~12 POSTs/min/reporter — trivial overhead. If coordinator is unreachable, POST fails fast and reporter logs it (matches SPEC R6 detection-not-fallback). WebSocket and coordinator-pulls-reporters were rejected (negligible bandwidth savings vs added complexity / surface area).

- **D-02: URL discovery via `HEALTH_COORDINATOR_URL` env var.** Single env var read by every reporter and reader. Defaults:
  - Host processes: `http://localhost:3034`
  - In-container processes: `http://host.docker.internal:3034` (set in `docker/docker-compose.yml`)
  No scattered hardcoded URLs; one place to retune the port.

### Backward-Compat Proxy (Dashboard `/api/health-verifier/*`)

- **D-03: In-container dashboard backend reverse-proxies to host coordinator.** `integrations/system-health-dashboard/server.js` keeps the existing route handlers (`/api/health-verifier/status`, `/api/health-verifier/report`, `/api/health`, `POST /api/health-verifier/verify`) but each handler `fetch`es `host.docker.internal:3034/health/state` and reshapes the response into the existing JSON shape. The dashboard frontend in `dist/` is **not** rebuilt this phase. SPEC R8 (compat) holds; SoT integrity holds.

- **D-04: "Run Verification" button forwards to `POST /health/refresh`.** Coordinator exposes `POST /health/refresh` that triggers an immediate full-poll out-of-band of the 5s tick and returns the resulting state. Dashboard's existing POST `/api/health-verifier/verify` proxies to that endpoint. Spawning an in-container verifier (today's behavior) is explicitly forbidden — it would defeat the SoT.

### Rules Engine Fate (`config/health-verification-rules.json`)

- **D-05: Coordinator consumes rules directly.** On startup, the coordinator reads `health-verification-rules.json`; each `enabled` rule becomes a registered check on the 5s tick. Schema (top-level keys, per-rule `enabled`/`severity`/`check_type`/`auto_heal`/`auto_heal_action`) preserved per SPEC R8. The current rules-engine code in `scripts/health-verifier.js` is folded into the coordinator's check registry, then `health-verifier.js` is reduced to a reporter that POSTs the heartbeats / signals it owns.

- **D-06: Delete the `bind_mount_freshness` rule entirely.** Per SPEC R5: the heal action (`docker compose --force-recreate`) cannot fix the macOS Docker virtiofs cause; the rule has been the single biggest source of churn in production. Phase A removed the orphan `scripts/consolidate-observations.js` from its `files[]` list — Phase 33 finishes the cleanup by removing the rule's top-level definition, its remediation handler in `health-remediation-actions.js`, and any references in tests / fixtures. If macOS bind-mount staleness ever returns as a legitimate concern, surface it as a `WARNING` only — never auto-heal.

- **D-07: Remove `health-verifier` from `supervisord_status.expected_processes`.** In-container `health-verifier` is intentionally `autostart=false` per Phase A; removing it from the expected list ratifies the "intentional disable" decision in config rather than only via the `STOPPED Not started` filter.

- **D-08: Drop container-process supervision from the host coordinator entirely.** The coordinator no longer runs `docker exec coding-services supervisorctl status`. Container internal-process health is delegated to (a) Docker's own container healthcheck (per SPEC R7 — coordinator surfaces `docker inspect ... .State.Health.Status`) and (b) the in-container dashboard URL `:3032/api/...` for fine-grained per-process visibility (consumers who need that detail open the dashboard). **Tradeoff acknowledged:** loses fine-grained "which process inside container is dead" visibility from the host's `/health/state` payload. Acceptable because (i) Docker's healthcheck already auto-restarts an unhealthy container, (ii) the dashboard's own backend can still expose per-supervisorctl-program status when its UI demands it, (iii) the SPEC's narrow-auto-heal goal explicitly prefers Docker-driven container restart over host-driven supervisorctl gymnastics.

### Session ID Derivation

- **D-09: Reporter uses existing session env var as `session_id`.** `enhanced-transcript-monitor.js` and the converted `statusline-health-monitor.js` reporter read `process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID` and POST it on every heartbeat. `bin/coding` already sets these in the tmux env (e.g. `claude-60474-1777723363`). For non-claude agents (copilot/opencode/mastra), the wrapper script is responsible for setting `SESSION_ID` in the same shape (this is a small change to those wrappers, in scope for Phase 33).

- **D-10: Stopped sessions linger 5 min then evict.** When a session's heartbeat is >15s stale, coordinator marks `lsl[<sid>].status = 'stopped'` but keeps the entry visible in `/health/state.lsl`. After 5 min in `stopped`, coordinator drops the entry. Per-project rollup recomputes on each tick: `lsl_by_project[name] = healthy ⇔ ≥1 session_id under that project is fresh`. Lets users see "session X stopped" in the dashboard without stale entries accumulating forever.

- **D-11: Statusline LSL badge uses per-pane semantics** (locked 2026-05-07 in plan 33-13 for G3 closure; user picked option (b) from the decision checkpoint). The tmux statusline reads `state.lsl[CLAUDE_SESSION_ID]` from the coordinator (the canonical D-09 session-id form), NOT the project rollup `lsl_by_project[name]`. Rationale: per-pane semantics let the user see WHICH pane is sick — with two tmux panes / same project, a dead pane shows red, a live pane stays green. This is strictly more informative than the project rollup at the same implementation cost. Consumer: `scripts/combined-status-line.js` `getLSLHealthStatus()`. Fail-closed to `'down'` on coordinator unreachable, missing `CLAUDE_SESSION_ID`, or missing entry — consistent with SPEC R6 (never silently `'healthy'` on error).

### Claude's Discretion

The following lower-impact decisions are left to the planner/researcher to recommend; they were intentionally not pinned in discussion:

- **Coordinator state durability**: in-memory only (recommended default — restart re-derives from polls in ≤10s) vs JSON checkpoint vs SQLite. Lean toward in-memory unless verifier discovers a concrete need to persist across restarts.
- **Test harness shape for the two-session agreement test**: bash + curl + jq vs Node.js with `node:test` vs Jest. Bash matches the shell-driven nature; node:test gives JSON-assertion ergonomics. Either acceptable.
- **launchd plist relaunch policy**: `KeepAlive=true` with `ThrottleInterval` set conservatively (e.g., 30s). Standard pattern, no debate needed.
- **Log rotation in the new coordinator**: reuse the 10 MB rotation pattern Phase A added to `health-verifier.js` and `statusline-health-monitor.js` (inline `statSync` + `renameSync` to `.log.1` on overflow). No new dependency.
- **Coordinator language/runtime**: Node.js 22 ESM with Express. Project default. Not in question.

### Phase A residue worth ratifying in Phase 33

The following came from the recent Phase A tactical work and should be kept (or made permanent) as part of this phase:

- The PSM Docker-VM-PID whitelist for LevelDB lock detection (`scripts/process-state-manager.js`) — keep.
- The `STOPPED Not started` filter in `supervisord_status` check — REPLACED by D-07/D-08 (the supervisord_status check is dropped entirely from the host coordinator). The filter logic in `scripts/health-verifier.js` will move into the in-container dashboard backend if it still wants the same display.
- 10 MB log rotation in `health-verifier.js` and `statusline-health-monitor.js` — keep (and use the same pattern in the new coordinator).
- Stale `.health/*-transcript-monitor-health.json` cleanup — Phase 33 obviates the file model entirely; the four files cleaned in Phase A stay deleted.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SPEC and Roadmap

- `.planning/phases/33-health-monitoring-consolidation/33-SPEC.md` — **Locked requirements — MUST read before planning.** 9 requirements + 13 acceptance checks + 7 in-scope / 7 out-of-scope items.
- `.planning/ROADMAP.md` — Phase 33 entry under v7.0 milestone heading.
- `.planning/codebase/STACK.md` — Node 22 / ES modules / Express / Jest 29.7. Port assignments — 3034 is free for the coordinator.
- `.planning/codebase/CONVENTIONS.md` — naming, error handling, logging, JSDoc patterns the new coordinator must follow.

### Existing legacy daemons (to be removed during cutover)

- `scripts/system-monitor-watchdog.js` — launchd-fired meta-watchdog (1499+ runs); remove the launchd plist `~/Library/LaunchAgents/com.coding.system-watchdog.plist` and delete the script (or keep as dead code with a `// removed in Phase 33` header).
- `scripts/global-process-supervisor.js` — manages `statusline-health-monitor`, `health-verifier`. Folded into coordinator.
- `scripts/global-service-coordinator.js` — manages `constraint-api`, `constraint-dashboard` (dashboard at `:3030`). Constraint dashboard's lifecycle moves to the coordinator's check registry.
- `scripts/global-lsl-coordinator.js` — separate watchdog for transcript monitors. Folded into coordinator.

### Existing scripts that become reporters

- `scripts/health-verifier.js` — today: host-side checker with auto-heal arms. After Phase 33: pure reporter that POSTs signals to the coordinator. Auto-heal action invocation removed; check evaluation logic moves into the coordinator (D-05).
- `scripts/statusline-health-monitor.js --daemon --auto-heal` — today: writes `.logs/combined-status-line-cache-coding.txt`. After Phase 33: reads `/health/state` from coordinator and writes the same cache file (file format may change — not a SPEC compat commitment).
- `scripts/enhanced-transcript-monitor.js` — adds `POST /signals` heartbeat on each transcript poll (uses `CLAUDE_SESSION_ID`). The legacy `.health/<projectName>-transcript-monitor-health.json` file write is removed.

### Existing consumers to migrate to HTTP

- `scripts/health-prompt-hook.js` — currently does multiple `readFileSync` of `.health/*.json` and `.observations/db-recovering.json`. After Phase 33: single `fetch(HEALTH_COORDINATOR_URL + '/health/state')` (with the same fail-loud-on-error policy per SPEC R6).
- `integrations/system-health-dashboard/server.js` — the four `/api/health-verifier/*` route handlers reverse-proxy to the host coordinator (D-03/D-04). The dashboard's `/api/observations`, `/api/digests`, `/api/insights` routes are NOT touched (they're served by the obs-api on host, not by the coordinator).

### Config / infra

- `config/health-verification-rules.json` — schema preserved; `bind_mount_freshness` rule deleted (D-06); `health-verifier` removed from `supervisord_status.expected_processes` (D-07); `supervisord_status` rule itself removed from the coordinator's check set (D-08).
- `scripts/process-state-manager.js` — PSM continues to track service registrations and database-health checks; the lock-holder Docker-VM-PID whitelist from Phase A stays.
- `scripts/health-remediation-actions.js` — `refreshBindMounts()` deleted along with the rule (D-06). Other remediation actions reviewed: keep only those that match a level-narrow heal (D-08 forbids whole-container actions).
- `docker/docker-compose.yml` — add `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` to the `coding-services` `environment` block; ensures the in-container dashboard backend (D-03) and any other in-container reader can reach the host coordinator.
- `docker/supervisord.conf` — in-container `health-verifier` already disabled in Phase A; that decision is ratified, no change required here.
- `~/Library/LaunchAgents/com.coding.system-watchdog.plist` — removed.
- `~/Library/LaunchAgents/com.coding.health-coordinator.plist` — new; runs `node /Users/Q284340/Agentic/coding/scripts/health-coordinator.js` with `KeepAlive=true`, `ThrottleInterval=30`, `RunAtLoad=true`.

### Tests

- `scripts/__tests__/health-coordinator/two-session-agreement.test.{sh,js}` — new; the headline acceptance test from SPEC.md (Requirement 3 + Acceptance Criteria #5).
- `scripts/__tests__/health-coordinator/detection-latency.test.{sh,js}` — new; SPEC Acceptance Criteria #6 (50 trials, P95 / P99 measured against `supervisorctl stop` injection).
- `scripts/__tests__/health-coordinator/injection.test.{sh,js}` — new; SPEC Acceptance Criteria #13 (forced exception in a check function returns `unknown`, never `healthy`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Express HTTP servers**: every existing service (`obs-api` on `:12436`, dashboard backend, semantic-analysis SSE) uses Express. The coordinator can reuse this pattern verbatim — no new framework selection.
- **PSM (`scripts/process-state-manager.js`)**: already has `registerService`, `getHealthStatus`, lock-holder detection (with the Phase A Docker-VM-PID whitelist). The coordinator can use PSM as the in-process state container for service registrations and DB-health, even though `/health/state` is the externally-visible SoT.
- **`bin/coding` env wiring**: `bin/coding` already sets `CLAUDE_SESSION_ID`, `SESSION_ID`, `CODING_REPO`, `CODING_AGENT`, `CODING_PROJECT_DIR`, etc. into the tmux session env. The coordinator's session-id contract piggybacks on this without new infrastructure.
- **Phase A log-rotation pattern**: inline `statSync` + 10 MB threshold + `renameSync` to `.log.1`. Already in `scripts/health-verifier.js` and `scripts/statusline-health-monitor.js`. Reuse in the new coordinator's `log()` method.
- **Existing Docker healthcheck**: `coding-services` already declares `healthcheck: ["CMD-SHELL", "curl -sf http://localhost:8080/health || exit 1"]` in `docker-compose.yml`. SPEC R7's "delegate container health to Docker" is mostly already true — coordinator just needs to read `docker inspect ... .State.Health.Status` instead of running its own probes.

### Established Patterns

- **ES modules + JSDoc**: scripts use `import`/`export` and JSDoc on public methods. Coordinator follows the same.
- **Class-name log prefix**: all logging uses `[ClassName] message` prefix. Coordinator: `[HealthCoordinator]`.
- **Configuration object parameters in constructors**: `new HealthCoordinator({ port: 3034, rulesPath, ... })`.
- **`runIfMain`**: scripts use the `lib/utils/esm-cli.js` `runIfMain(import.meta.url, fn)` helper for CLI entry points; coordinator follows.
- **`proper-lockfile`**: already in dependencies for concurrent file ops; available if the coordinator ever needs file locking (it shouldn't, given in-memory state).

### Integration Points

- **Reader: dashboard backend** (`integrations/system-health-dashboard/server.js`): four route handlers change from local file reads to `fetch(HEALTH_COORDINATOR_URL + '/health/state')`. Frontend dist/ unchanged.
- **Reader: prompt hook** (`scripts/health-prompt-hook.js`): single `fetch` replaces multiple `readFileSync` calls. Output JSON shape preserved per SPEC R8 (top-level `hookSpecificOutput.additionalContext` stays).
- **Reader: statusline daemon** (`scripts/statusline-health-monitor.js`): now a reporter+reader hybrid — POSTs heartbeats to coordinator, reads back `/health/state` to write its tmux cache file.
- **Reporter: enhanced-transcript-monitor** (`scripts/enhanced-transcript-monitor.js`): adds a `POST /signals` call per heartbeat tick. The legacy `.health/<projectName>-transcript-monitor-health.json` file write is removed.
- **Launch chain**: `~/Library/LaunchAgents/com.coding.system-watchdog.plist` (today) → `~/Library/LaunchAgents/com.coding.health-coordinator.plist` (Phase 33). Cutover: in one commit, the old plist is `launchctl unload`-ed and the new one `launchctl load`-ed; rollback path = the reverse.

</code_context>

<specifics>
## Specific Ideas

- **Coordinator endpoint shape (`GET /health/state`)** returns top-level keys `{ container, services, lsl, lsl_by_project, processes, generated_at, coordinator_uptime_s }` per SPEC Acceptance Criteria #3. Researcher should propose the per-key sub-schema.

- **Coordinator endpoint shape (`POST /signals`)** receives `{ kind, session_id?, source, status, payload?, ts }`. Researcher should propose the discriminator values for `kind` (e.g., `lsl_heartbeat`, `service_status`, `db_health`).

- **Headline acceptance test** is the one to write FIRST. SPEC Acceptance Criteria #5: two `coding/bin/coding` sessions in `/coding`, kill one, all three readers (dashboard, statusline cache, prompt-hook) agree the project is still healthy with one stopped session, no consumer reports "LSL DOWN" at any point.

</specifics>

<deferred>
## Deferred Ideas

- **LSL hour-rollover redesign** (the "first-vs-last tranche" issue) — Phase A applied a one-line tactical fix (use last exchange's tranche). Long-term redesign with split-on-hour-boundary semantics is its own phase; not Phase 33.
- **Sub-second / event-driven health detection** (inotify, supervisord event listener, `docker events`) — explicitly out of scope per SPEC; future phase if 10s SLA proves insufficient.
- **Encryption / authn on `/health/state`** — SoT binds to localhost only; future phase if non-local consumers ever appear.
- **Bind-mount freshness as a WARNING rule** — D-06 deletes the rule entirely; if the macOS Docker virtiofs bug returns as a real concern, add it back as severity=warning with auto_heal=false (visibility, no action).
- **Statusline cache file format redesign** — SPEC explicitly does not preserve the existing format; Phase 33 may freely rewrite, but a separate UX phase could use the freedom to surface per-session state in the tmux statusline (e.g., "[LSL: 1/2 sessions live]" instead of a single dot).
- **Consolidating `scripts/process-state-manager.js` into the coordinator** — PSM has its own bugs and unique concerns (LevelDB lock detection, knowledge-graph DB locking). Phase 33 keeps PSM as a separate concern; folding it into the coordinator is a follow-up design question.

</deferred>

---

*Phase: 33-health-monitoring-consolidation*
*Context gathered: 2026-05-06*
