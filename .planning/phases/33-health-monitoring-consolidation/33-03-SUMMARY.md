---
phase: 33-health-monitoring-consolidation
plan: 03
subsystem: infra
tags: [express, esm, docker, psm, health, coordinator, rule-engine, spec-r6, spec-r7]

requires:
  - phase: 33-02
    provides: scripts/health-coordinator.js skeleton (Express server + currentState shape + 4 endpoints + INJECT_THROW hook)
  - phase: 33-01
    provides: lib/utils/log-rotator.js (createRotatingLogger helper)

provides:
  - Full check registry on the 5s tick: docker .State.Health.Status passthrough (SPEC R7), PSM-backed db_health + service liveness, LSL staleness pass, per-rule iteration over all four categories from health-verification-rules.json (D-05)
  - loadRules() + hot-reload on POST /health/refresh (D-04, D-05)
  - forEachEnabledRule(category, fn) with per-rule try/catch isolation (SPEC R6)
  - FORBIDDEN_RULE_NAMES set blocking bind_mount_freshness (D-06) and supervisord_status (D-08) at runtime even if config still contains them — defense-in-depth before plan 33-06 deletes them
  - pollDockerHealth() shelling docker inspect coding-services --format '{{.State.Health.Status}}' with 5s spawnSync timeout
  - INJECT_THROW slice names extended from 1 ('tick') to 5 ('docker_health', 'lsl', 'services', 'db_health', 'tick') for AC #13 testability
  - currentState.files top-level slot (was missing from skeleton; populated by the files rule iterator)
  - Per-slice catch blocks that surface 'unknown' (never 'healthy') on exception — SPEC R6 grep gate clean

affects: [33-04 (reporters POST /signals against the live registry), 33-05 (readers fetch populated /health/state, no longer just stubs), 33-07 (cutover smoke test will see real Docker container.healthcheck reflected verbatim), 33-08 (verification grep gates against scripts/health-coordinator.js for force-recreate/applyDockerOverrides/console.log all clean)]

tech-stack:
  added: []  # node:child_process spawnSync is built-in; ProcessStateManager already in repo
  patterns:
    - "Per-slice try/catch in runAllChecks: container, lsl, services, db_health each isolated; per-rule errors caught inside forEachEnabledRule. Single throwing slice cannot poison other slices (SPEC R6)."
    - "Docker .State.Health.Status passthrough verbatim (SPEC R7) — empty/'none' / docker-daemon-down all surface as 'unknown', never 'healthy'."
    - "FORBIDDEN_RULE_NAMES Set as defense-in-depth: planner deletes the rules in plan 33-06; coordinator must not process them in any plan ordering."
    - "INJECT_THROW.includes(<slice>) at the top of each slice's try block — the test injection point is in the slice itself, not in a wrapper, so the failure path is exactly the slice's own catch."
    - "Hot-reload on POST /health/refresh: dashboard 'Run Verification' triggers immediate full-poll AND re-reads rules so config edits take effect without coordinator restart."
    - "PSM aggregation: levelDB.available && !levelDB.locked && qdrant.available -> 'healthy'; otherwise 'degraded'. Phase A's Docker-VM-PID whitelist for LevelDB lock holders flows through unchanged because PSM owns it."

key-files:
  modified:
    - scripts/health-coordinator.js (322 -> 600 lines; +293 / -15)

key-decisions:
  - "Database aggregation is computed from PSM's structured return (levelDB + qdrant) rather than from a single status field, so the per-rule entries (databases.leveldb_lock_check, databases.qdrant_availability, etc.) coexist with the PSM aggregate without collision. Per-rule entries default to 'unknown' until a check populates them."
  - "PSM's getRegisteredServices() does not exist on the current PSM API — coordinator gates the call with `typeof psm.getRegisteredServices === 'function'` so the absence falls through to signal-driven population. The plan's <interfaces> block named the method as a hint; the actual <action> code already had the typeof guard. Result: services are populated from POST /signals (33-04) until/unless PSM gains a getter."
  - "The files rule handler resolves relative paths against REPO_ROOT (path.join). Absolute paths pass through verbatim. Missing files / bad paths -> 'unknown'; successfully stat'd -> 'present' with the freshest mtime across all paths in the rule."
  - "Removed the literal token 'force-recreate' from the FORBIDDEN_RULE_NAMES preamble comment to satisfy the SPEC R5 grep gate (`! grep -q 'force-recreate' scripts/health-coordinator.js`). The decision rationale survives: 'narrow heals only'."

patterns-established:
  - "runAllChecks() / tick() split: tick() is the outer guard with INJECT_THROW.includes('tick') for end-to-end fault injection; runAllChecks() is the per-slice runner with isolation. Plan 33-04 / 33-05 / 33-07 extend the registry by adding more slices, never by changing this split."
  - "Per-rule slot defaulting: every enabled rule that lacks a check implementation gets an 'unknown' entry on first iteration. This ensures /health/state is never silent about a rule (SPEC R8 schema preservation requires the rules to be greppable)."

requirements-completed: [R3, R4, R5, R6, R7, R8]

duration: 18min
completed: 2026-05-06
---

# Phase 33: Health Monitoring Consolidation — Plan 03 Summary

**The coordinator now runs a real check registry on every 5s tick: Docker container health from `docker inspect`, PSM-backed database + service health, per-rule iteration across all four categories (databases / services / processes / files) from `config/health-verification-rules.json`, with per-slice error isolation that surfaces `unknown` on any exception (SPEC R6) — never `healthy`.**

## Commits

| Hash | Type | Subject |
|------|------|---------|
| `dd0bb4aac` | feat | Wire full check registry + Docker healthcheck passthrough into coordinator |

## What Changed in `scripts/health-coordinator.js`

| Slice | Before (skeleton, 33-02) | After (this plan) |
|-------|--------------------------|-------------------|
| Imports | express, cors, path, fs, fileURLToPath, runIfMain, createRotatingLogger | + `node:child_process` spawnSync, + `./process-state-manager.js` ProcessStateManager |
| Constants | PORT, TICK_MS, STARTED_AT, LOG_PATH, HEARTBEAT_STALENESS_MS, EVICT_AFTER_STOPPED_MS, INJECT_THROW | + `RULES_PATH`, `DOCKER_INSPECT_TIMEOUT_MS=5_000`, `FORBIDDEN_RULE_NAMES` Set with `bind_mount_freshness` + `supervisord_status` |
| `currentState` | container, services, lsl, lsl_by_project, processes, databases, generated_at, coordinator_uptime_s | + `files: []` (W6 — required by D-05 rule iteration) |
| Rules loader | (none) | `function loadRules()` reads `config/health-verification-rules.json`; logs ERROR + returns null on parse failure; called on startup AND on every `POST /health/refresh` |
| Rule iteration | (none) | `async function forEachEnabledRule(category, fn)` with FORBIDDEN_RULE_NAMES skip + per-rule try/catch |
| PSM | (none) | `new ProcessStateManager({ codingRoot: REPO_ROOT })` instantiated module-load; `psm.initialize()` runs async; `psmReady` gate prevents pre-init crashes |
| Docker passthrough | (none) | `function pollDockerHealth()` shells `docker inspect coding-services --format '{{.State.Health.Status}}'` with 5s timeout; empty/error → `{ status: 'unknown', last_probe_end: null }` |
| `tick()` body | `refreshLslStaleness()` + timestamp update | Delegates to `runAllChecks()` |
| `runAllChecks()` | (none) | New function, per-slice try/catch over container / lsl / services / db_health, then `forEachEnabledRule` for all four categories, then timestamp update |
| INJECT_THROW slices | `tick` only | `tick` + `docker_health` + `lsl` + `services` + `db_health` (5 total) |
| `POST /health/refresh` | `forceTick()` → return state | + `loadRules()` re-read so config edits take effect without restart (D-04) |

## Check Registry Shape (SPEC R8 schema preserved)

Each tick, in order:

1. **`container.healthcheck`** ← `pollDockerHealth()` returns Docker's `Status` verbatim (`healthy` / `unhealthy` / `starting` / `none` / `unknown`). 30s underlying probe cadence is by design (SPEC R7 says "surface as-is").
2. **`lsl` + `lsl_by_project`** ← `refreshLslStaleness()` (D-10): >15s stale → `stopped`; >5min stopped → evicted; project rollup recomputed.
3. **`services`** ← if PSM exposes `getRegisteredServices` (currently it does not), populates from PSM; otherwise falls through to signal-driven population (33-04 wires reporters to `POST /signals`).
4. **`databases.status`** ← PSM `checkDatabaseHealth()` aggregate: `healthy` iff `levelDB.available && !levelDB.locked && qdrant.available`; otherwise `degraded`. Phase A's Docker-VM-PID whitelist for LevelDB lock holders flows through unchanged.
5. **Per-rule iteration over all four categories** (D-05):
   - `databases`: ensures `currentState.databases.<rule_name>` exists (default `'unknown'`) for each enabled rule. PSM-backed slice above sets the aggregate; per-rule entries make `/health/state.databases.leveldb_lock_check` greppable.
   - `services`: ensures an entry in `currentState.services` for each enabled rule (default `'unknown'`); signals from 33-04 reporters update them.
   - `files`: `fs.statSync` on each path in `rule.path` or `rule.paths`. Relative paths resolve against REPO_ROOT; missing paths stay `'unknown'`; freshest mtime wins.
   - `processes`: ensures an entry in `currentState.processes` for each enabled rule (default `'unknown'`); signals from 33-04 reporters update them.

## INJECT_THROW Slice Names (AC #13 testability)

`HEALTH_COORDINATOR_INJECT_THROW=<comma-sep-list>` — set any of:

| Slice | Effect on next tick |
|-------|---------------------|
| `tick` | Outer guard throws; runAllChecks does not run; nothing is overwritten to `'healthy'` |
| `docker_health` | `pollDockerHealth()` throws; `currentState.container = { healthcheck: 'unknown', last_probe_end: null }` |
| `lsl` | LSL staleness skipped; `lsl_by_project` rollup all `'unknown'` |
| `services` | Services slice throws; existing entries mapped to `status: 'unknown'` |
| `db_health` | DB slice throws; `currentState.databases = { status: 'unknown' }` |

## Defense-in-Depth: Forbidden Rules

The plan's `FORBIDDEN_RULE_NAMES = new Set(['bind_mount_freshness', 'supervisord_status'])` is checked at the TOP of `forEachEnabledRule`. If config still contains either rule (until plan 33-06 deletes them), the coordinator emits a WARN log line and SKIPS the rule. This is intentional belt-and-suspenders:

- `bind_mount_freshness` (D-06): the heal action whole-container restart cannot fix the macOS Docker virtiofs cause; the rule has been the single biggest source of churn in production. Phase A removed the orphan file from its `files[]` list; plan 33-06 finishes the cleanup by removing the rule's top-level definition. Until then, the coordinator MUST NOT process it.
- `supervisord_status` (D-08): host coordinator drops in-container process supervision entirely. Container internal-process health is delegated to (a) Docker's own healthcheck (SPEC R7) and (b) the in-container dashboard URL `:3032/api/...` for fine-grained per-process visibility.

## SPEC R6 Compliance

Every slice's catch block surfaces `'unknown'` (never `'healthy'`):

| Slice | catch behaviour |
|-------|-----------------|
| container | `currentState.container = { healthcheck: 'unknown', last_probe_end: null }` |
| lsl | `currentState.lsl_by_project = { <project>: 'unknown', ... }` |
| services | `currentState.services = currentState.services.map(s => ({ ...s, status: 'unknown' }))` |
| db_health | `currentState.databases = { status: 'unknown' }` |
| files (per-rule) | `entry.status = 'unknown'` |
| docker inspect failure | `{ status: 'unknown', last_probe_end: null }` (caught inside `pollDockerHealth`) |
| docker inspect timeout | spawnSync `result.status !== 0` → `{ status: 'unknown', last_probe_end: null }` |
| Outer `tick()` guard | logs error; does NOT touch any slice (each slice has set its own state on its own catch) |

The grep gate `! grep -nE "catch[^/]*return\s*['\"]healthy" scripts/health-coordinator.js` is clean (0 matches).

## Self-Check: PASSED

| Check | Status |
|-------|--------|
| `node --check scripts/health-coordinator.js` exits 0 | PASS |
| Total lines: 600 (≥ 350) | PASS |
| `function loadRules()` declared | PASS |
| `function pollDockerHealth()` declared | PASS |
| `async function runAllChecks()` declared | PASS |
| `import ProcessStateManager` present | PASS |
| `FORBIDDEN_RULE_NAMES` contains both `bind_mount_freshness` AND `supervisord_status` | PASS |
| `forEachEnabledRule('databases'`, `'services'`, `'processes'`, `'files'` — 4 distinct call sites | PASS (one each) |
| `currentState.files` top-level slot | PASS |
| `INJECT_THROW.includes(...)` count = 5 | PASS |
| Literal `docker inspect coding-services` present (in the JSDoc) | PASS |
| Regex `docker.*inspect.*coding-services.*State\.Health\.Status` matches | PASS |
| `applyDockerOverrides` absent | PASS |
| `force-recreate` absent | PASS (was 1 in the comment, removed) |
| `verifyBindMountFreshness` absent | PASS |
| `verifySupervisord` absent | PASS |
| `console.log` absent | PASS |
| catch...return 'healthy' absent | PASS |
| Plist NOT loaded (`launchctl list \| grep com.coding.health-coordinator` empty) | PASS |
| Commit `dd0bb4aac` exists in `git log` | PASS |

## Deferred Items

- **Manual end-to-end smoke test** (start coordinator with `HEALTH_COORDINATOR_PORT=13036 node scripts/health-coordinator.js &`, sleep 7, curl `/health/state`, verify all 4 rule categories populated and `.container.healthcheck.status` is one of healthy/unhealthy/starting/none/unknown). The plan's acceptance_criteria explicitly defers this: "Manual smoke ... — to be done in plan 33-07 acceptance, not here." Sandbox in this worktree denied long-running `node` invocations, which is consistent with the deferral.
- **Reporter wiring** (33-04): once `health-verifier.js` and `statusline-health-monitor.js` are reduced to reporters that POST `service_status` signals, `currentState.services` will be populated from real signals. Today the rule iterator just creates `'unknown'` placeholders.
- **PSM `getRegisteredServices` method**: the plan's `<interfaces>` block names this method but PSM does not expose it. Coordinator's `typeof psm.getRegisteredServices === 'function'` guard means the call is a no-op until PSM is extended (or until reporters fill the slot via signals — the more likely path per Phase 33 architecture).
- **STATE.md / ROADMAP.md updates**: per the worktree-mode contract, the orchestrator owns those writes after wave merge. This executor MUST NOT touch them.

## Deviations

None — plan executed exactly as written. Two micro-adjustments worth flagging:

1. The plan's preamble comment block contained the literal token `force-recreate` (in the rationale "Per SPEC R5 (no force-recreate)"). The success criterion `! grep -q "force-recreate" scripts/health-coordinator.js` would have failed. Rewrote that phrase as "Per SPEC R5 (narrow heals only)" — same meaning, satisfies the gate. Documented in key-decisions.
2. PSM aggregation: PSM's `checkDatabaseHealth()` returns `{ levelDB: { available, locked, lockedBy }, qdrant: { available } }`, not a single status field. The plan's example code had `currentState.databases = { status: dbStatus?.healthy ? 'healthy' : (dbStatus?.status || 'unknown') }` which would always evaluate `dbStatus?.healthy` as `undefined` (falsy) and fall through to `dbStatus?.status` (also `undefined`) → `'unknown'`. Adapted to compute the aggregate from `levelDB.available && !levelDB.locked && qdrant.available` and pass through the structured `levelDB`/`qdrant` sub-objects so consumers see the detail.

## Issues Encountered

- **Worktree path confusion**: tooling initially routed Edit calls through the parent repo path (`/Users/Q284340/Agentic/coding/scripts/...`) instead of the worktree path (`/Users/Q284340/Agentic/coding/.claude/worktrees/agent-.../scripts/...`). Detected mid-flight when `git status` from the worktree showed no changes. Recovered by saving the edited file aside, restoring the parent file via `git checkout HEAD -- <path>`, and copying the edited content to the correct worktree path before staging + committing. No data loss; commit landed cleanly on `worktree-agent-a4a9f5dbe0262fc96`.
- **Sandbox denial on long-running `node`**: smoke test on port 13036 could not be run in this worktree. The plan's acceptance criteria explicitly defer the smoke test to plan 33-07; static-analysis gates (all 14 of them) were sufficient to satisfy this plan's acceptance.

## Self-Check: PASSED

| Artifact | Status |
|----------|--------|
| `.planning/phases/33-health-monitoring-consolidation/33-03-SUMMARY.md` | FOUND |
| `scripts/health-coordinator.js` | FOUND (600 lines) |
| Commit `dd0bb4aac` | FOUND in git log |
