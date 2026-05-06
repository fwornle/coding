# Phase 33: Health Monitoring Consolidation — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 22 (12 NEW, 8 MODIFY-reduce-or-migrate, 1 MODIFY-config, 1 MODIFY-compose, several DELETE)
**Analogs found:** 22 / 22 (every new/modified file has a verbatim repo-internal analog)

---

## File Classification

### NEW files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `scripts/health-coordinator.js` | HTTP server (single-owner SoT) + tick scheduler | request-response + scheduled-poll | `scripts/observations-api-server.mjs` | exact (single-owner-HTTP-gateway) |
| `lib/utils/log-rotator.js` | utility (helper library) | file-I/O | `scripts/health-verifier.js:179-188` (and identical block at `scripts/statusline-health-monitor.js:137-145`) | exact (extract-as-is) |
| `~/Library/LaunchAgents/com.coding.health-coordinator.plist` | launchd plist (config) | event-driven (launchd-managed) | `~/Library/LaunchAgents/com.coding.system-watchdog.plist` | role-match (different KeepAlive policy) |
| `scripts/__tests__/health-coordinator/_helpers.sh` | test helper library | (n/a) | `tests/integration/launcher-e2e.sh:43-105` (`run_test`, `assert_*`) | exact (lift verbatim) |
| `scripts/__tests__/health-coordinator/quick.sh` | smoke test wrapper | request-response | `tests/integration/launcher-e2e.sh` (top-of-file pattern) | role-match |
| `scripts/__tests__/health-coordinator/run-all.sh` | full-suite wrapper | (n/a) | `tests/integration/launcher-e2e.sh` (test-runner pattern) | role-match |
| `scripts/__tests__/health-coordinator/two-session-agreement.test.sh` | integration test (process orchestration) | event-driven | `tests/integration/launcher-e2e.sh` + RESEARCH §4 mock-reporter | role-match |
| `scripts/__tests__/health-coordinator/detection-latency.test.sh` | latency benchmark (50 trials) | request-response loop | RESEARCH §5 (bash + python3 statistics.quantiles) | new-pattern (well-specified) |
| `scripts/__tests__/health-coordinator/injection.test.sh` | fault-injection test | request-response | RESEARCH §10 (env-var injection point) | new-pattern (well-specified) |
| `scripts/__tests__/health-coordinator/eviction.test.sh` | integration test (5-min eviction per D-10) | scheduled | derived from two-session-agreement | role-match |
| `scripts/__tests__/health-coordinator/keepalive.test.sh` | resilience (kill -9, expect respawn) | event-driven | RESEARCH §1 deterministic test snippet | new-pattern (well-specified) |
| `scripts/__tests__/health-coordinator/docker-health-passthrough.test.sh` | unit test (verify Docker `.State.Health.Status` reflected as-is) | request-response | RESEARCH §2 `docker inspect` snippet | new-pattern |
| `scripts/__tests__/health-coordinator/rules-schema.test.mjs` | schema validation (Ajv) | request-response | n/a (NEW; only `node:test` consumer in this phase) | new-pattern (well-specified) |

### MODIFY (reduce to reporter)

| Modified File | Role | Data Flow | Pattern To Apply | Match Quality |
|---------------|------|-----------|------------------|---------------|
| `scripts/health-verifier.js` | reporter (was: daemon + heal) | request-response (POST) | obs-api fetch-error pattern (`integrations/system-health-dashboard/server.js:4163-4172`) | role-match |
| `scripts/statusline-health-monitor.js` | reporter + reader hybrid | request-response | obs-api fetch + cache-write | role-match |
| `scripts/enhanced-transcript-monitor.js` | add `POST /signals` heartbeat (replaces `updateHealthFile()` write at `:4348`, `cleanupHealthFile()` write at `:4402`) | request-response | obs-api `_forwardObsApi` (server.js:4162-4172) | exact |

### MODIFY (consumer migration to HTTP SoT)

| Modified File | Role | Data Flow | Analog (in-repo) | Match Quality |
|---------------|------|-----------|------------------|---------------|
| `scripts/health-prompt-hook.js` | consumer (single fetch replaces multiple readFileSync) | request-response | obs-api `_fetchObsApi` (server.js:4179-4188) | exact |
| `integrations/system-health-dashboard/server.js` | reverse-proxy 4 routes | request-response | obs-api `_forwardObsApi` (same file:4160-4172) | exact (already used 6× in same file for obs-api) |
| `integrations/mcp-constraint-monitor/src/dashboard-server.js` | reverse-proxy 2 routes (per RESEARCH §8 leak — added per user resolution) | request-response | obs-api `_forwardObsApi` | exact |

### MODIFY (config / compose / delete)

| File | Action | Lines |
|------|--------|-------|
| `config/health-verification-rules.json` | DELETE `bind_mount_freshness` rule (lines 140-163); DELETE `supervisord_status` rule (line 201+); REMOVE `health-verifier` from `expected_processes` array | per D-06, D-07, D-08 |
| `scripts/health-remediation-actions.js` | DELETE `refreshBindMounts()` (lines 819-870 inclusive); DELETE its caller dispatch case at line 178 | per D-06 |
| `docker/docker-compose.yml` | ADD `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` to `coding-services.environment` block (block ends ~line 80, before `extra_hosts`) | per D-02 |
| `scripts/system-monitor-watchdog.js` | DELETE (or replace contents with single removed-in-Phase-33 comment) | per SPEC R9 |
| `scripts/global-process-supervisor.js` | DELETE | per SPEC R9 |
| `scripts/global-service-coordinator.js` | DELETE | per SPEC R9 |
| `scripts/global-lsl-coordinator.js` | DELETE | per SPEC R9 |
| `~/Library/LaunchAgents/com.coding.system-watchdog.plist` | `launchctl bootout gui/$UID …` then `rm` (cutover commit) | per SPEC R9 |

### UNCHANGED (do not touch)

- `integrations/system-health-dashboard/dist/*` — frontend bundle, not rebuilt this phase
- `integrations/system-health-dashboard/public/*` — static assets

---

## Pattern Assignments

### `scripts/health-coordinator.js` (HTTP server + tick scheduler, single-owner SoT)

**Analog:** `scripts/observations-api-server.mjs` — exact same role (single-owner HTTP gateway), same Express bootstrap, same `host.docker.internal` reverse-access topology.

**Imports + path/port pattern** (lift from `observations-api-server.mjs:24-37`):
```js
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js'; // NEW (see below)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.HEALTH_COORDINATOR_PORT || '3034', 10);
```

**App + middleware + bind pattern** (lift from `observations-api-server.mjs:231-249, 688-689`):
```js
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT, role: 'health-coordinator' }));
app.get('/health/state', (_req, res) => res.json(currentState));
app.post('/signals', (req, res) => { ingestSignal(req.body); res.json({ ok: true }); });
app.post('/health/refresh', async (_req, res) => { await forceTick(); res.json(currentState); });

// IMPORTANT: bind 0.0.0.0 (not 127.0.0.1) so Linux Docker containers reaching
// via host-gateway can connect — same reason obs-api binds 0.0.0.0. Localhost
// scoping is enforced at the network layer (Docker Desktop loopback / firewall),
// not at the listen address. See RESEARCH §3.
const server = app.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`[HealthCoordinator] listening on http://0.0.0.0:${PORT}\n`);
});
```

**Graceful shutdown** (lift from `observations-api-server.mjs:700-723`, simplified — no in-flight DB drain):
```js
async function shutdown(signal) {
  process.stderr.write(`[HealthCoordinator] ${signal} — shutting down\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**EADDRINUSE handling** (NEW — RESEARCH §1 and §9 pitfall): listen for the server's `'error'` event with `code: 'EADDRINUSE'` and `process.exit(1)` with a clear stderr message so launchd's `StandardErrorPath` is diagnosable.

**Rule iteration pattern** (port from `health-verifier.js:289-385`):
```js
// Read at: scripts/health-verifier.js:289-291, 387, 887, 955, 1059
async verifyDatabases() {
  const dbRules = this.rules.rules.databases;
  if (dbRules.leveldb_lock_check.enabled) { /* check + push to checks[] */ }
  if (dbRules.leveldb_accessibility.enabled) { /* … */ }
}
// The coordinator's tick fans out the same way: rules.rules.{databases,services,processes,files}
// → check fn → push to in-memory currentState. The legacy file writes (this.reportPath,
// this.statusPath) are DROPPED; SoT is in-memory only (CONTEXT "Claude's Discretion").
```

**Class-name log prefix** (CONVENTIONS.md "Logging" + observed in `health-verifier.js:173` and `statusline-health-monitor.js:131`): `[HealthCoordinator] message`. Use `process.stderr.write(...)` (CLAUDE.md `no-console-log` constraint; obs-api uses this at `:77, 689`).

**Landmines (do NOT copy from obs-api):**
- `ensureWriter()` / SQLite-WAL handling (lines 42-87) — coordinator has no DB.
- `_consolidationPromise` shutdown drain — coordinator has no long-running work.
- `isCorruptionError()` / `invalidateDb()` — DB-specific.
- `writeFileSync` to `verifier-heartbeat.json` (legacy `health-verifier.js` pattern) — coordinator's "heartbeat" is the HTTP endpoint itself.

**Landmines (do NOT copy from health-verifier.js):**
- `applyDockerOverrides()` (lines 119-148): the legacy in-container vs host endpoint rewriting; coordinator only runs on host so the `host.docker.internal → localhost` swap (lines 53-58) is unnecessary.
- `verifyBindMountFreshness()` and any `bind_mount_freshness` reference — DELETED per D-06.
- `verifySupervisord()` — DELETED per D-08.
- Any `auto_heal` *invocation* path — coordinator only logs/surfaces; narrow heals (D-08) are limited to `supervisorctl restart <service>`, `docker restart coding-services`, or host-daemon restart, never `--force-recreate`.

---

### `lib/utils/log-rotator.js` (NEW shared helper)

**Analog:** `scripts/health-verifier.js:171-188` AND identical block at `scripts/statusline-health-monitor.js:129-146`.

**Excerpt to extract verbatim** (`health-verifier.js:171-188`):
```js
log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] [HealthVerifier] ${message}\n`;
  if (this.debug || level === 'ERROR') console.log(logEntry.trim());
  try {
    try {
      const sz = fsSync.statSync(this.logPath).size;
      if (sz > 10 * 1024 * 1024) fsSync.renameSync(this.logPath, this.logPath + '.1');
    } catch { /* missing/unwritable on first call is fine */ }
    fsSync.appendFileSync(this.logPath, logEntry);
  } catch (error) {
    console.error(`Failed to write log: ${error.message}`);
  }
}
```

**Recommended extracted shape** (RESEARCH §7):
```js
// lib/utils/log-rotator.js — ~25 lines, no new dep, Node built-ins only
import fs from 'node:fs';

export function createRotatingLogger({ logPath, prefix, maxBytes = 10 * 1024 * 1024, debug = false }) {
  return function log(message, level = 'INFO') {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] [${prefix}] ${message}\n`;
    if (debug || level === 'ERROR') process.stderr.write(line);
    try {
      try {
        const sz = fs.statSync(logPath).size;
        if (sz > maxBytes) fs.renameSync(logPath, logPath + '.1');
      } catch { /* missing/unwritable on first call is fine */ }
      fs.appendFileSync(logPath, line);
    } catch (err) {
      process.stderr.write(`Failed to write log: ${err.message}\n`);
    }
  };
}
```

**After extracting**: `health-verifier.js:171-188` and `statusline-health-monitor.js:129-146` should both `import { createRotatingLogger }` and replace their inline block. Coordinator imports the same helper.

**Landmines:** none (the original block is already dependency-free; `console.log` → `process.stderr.write` is the only adjustment required for the coding constraint system's `no-console-log` rule).

---

### `~/Library/LaunchAgents/com.coding.health-coordinator.plist`

**Analog:** `~/Library/LaunchAgents/com.coding.system-watchdog.plist` (read above).

**Existing plist (verbatim, for reference)**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.coding.system-watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/Q284340/Agentic/coding/scripts/system-monitor-watchdog.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/Q284340/Agentic/coding</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin</string>
    </dict>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><false/>
    <key>StandardOutPath</key>
    <string>/Users/Q284340/Agentic/coding/.logs/system-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/Q284340/Agentic/coding/.logs/system-watchdog.log</string>
    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>
```

**Apply for new plist** (RESEARCH §1 — verbatim recommended):
- Keep: `Label` (renamed `com.coding.health-coordinator`), `ProgramArguments[0]` (`/opt/homebrew/bin/node`), `ProgramArguments[1]` (new path: `…/scripts/health-coordinator.js`), `WorkingDirectory`, `EnvironmentVariables.PATH`, `StandardOutPath`/`StandardErrorPath` (new `.logs/health-coordinator.log`), `ThrottleInterval=30`.
- **Change:** `KeepAlive` from `<false/>` → `<true/>` (SPEC R9: launchd respawns on any exit). RESEARCH §1 verifies this against `man launchd.plist(5)`.
- **Add:** `EnvironmentVariables.HEALTH_COORDINATOR_PORT=3034` (RESEARCH §1 sample plist).
- **Remove:** `StartInterval=60` (legacy launches the watchdog every 60s; coordinator is a long-running daemon, KeepAlive replaces this).

**Landmine:** `launchctl unload` is NOT enough for the legacy plist on macOS 14+. Use `launchctl bootout gui/$UID ~/Library/LaunchAgents/com.coding.system-watchdog.plist && rm <path>` (RESEARCH §9). Cutover commit's deploy script must encode this.

---

### `scripts/health-verifier.js` reduce-to-reporter

**Analog for the new reporter shape:** the obs-api forward pattern at `integrations/system-health-dashboard/server.js:4179-4188` — single `fetch`, fail-loud, no silent fallback.

**Read first** (existing rule iteration to fold into coordinator, then delete from this file):
- Lines 60-95: constructor + rules loading
- Lines 119-148: `applyDockerOverrides` — DELETE in reporter mode (host-only)
- Lines 285-385: `verifyDatabases` — MOVE into coordinator
- Lines 387-880: `verifyServices`, `verifyObservationQuality`, `verifyProcesses` — MOVE into coordinator
- Lines 887-1054: `verifyProcesses` (process registry checks) — MOVE
- Lines 1059-1180: `verifyFiles` — MOVE
- Lines 1184-1280: `verifyBindMountFreshness` — **DELETE** (D-06)
- Lines 955-1054: `verifySupervisord` — **DELETE** (D-08)
- Lines 235-260: auto-healing loop — **DELETE** (R5: heal moves to coordinator and is narrow)
- Line 2140 (approx.): `runIfMain(import.meta.url, …)` — KEEP (CLI entry preserved per CONTEXT.md "reporter mode for legacy scripts")

**After reduction, the file's body should resemble:**
```js
import { runIfMain } from '../lib/utils/esm-cli.js';
import { createRotatingLogger } from '../lib/utils/log-rotator.js';

const COORDINATOR = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';

async function postSignal(signal) {
  try {
    const r = await fetch(`${COORDINATOR}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal)
    });
    if (!r.ok) throw new Error(`signal POST ${r.status}`);
  } catch (err) {
    // SPEC R6: do NOT silently treat as healthy. Log, propagate, exit non-zero
    // when running in CLI verify mode so callers learn the coordinator is down.
    process.stderr.write(`[HealthVerifier] coordinator unreachable: ${err.message}\n`);
    throw err;
  }
}
```

**Auth/Guard pattern:** none — host-only loopback (SPEC Constraints "no encryption / authn").

**Error handling pattern (apply universally per SPEC R6):** no `try { … } catch { return 'healthy'; }`. Catch must propagate or surface `unknown`. Forbidden grep target: `grep -rE "catch\\b.*\\{[^}]*return\\s*['\"]" scripts/health-verifier.js` (must be empty after refactor).

**Landmines:**
- DO NOT preserve `applyDockerOverrides` (R7 + D-08 obviate the in-container rewrite).
- DO NOT keep the heartbeat-file writer at the bottom of the file (legacy `.health/verifier-heartbeat.json` pattern).
- DO NOT keep `restartDaemon`/`stop` CLI subcommands — coordinator owns lifecycle now.
- KEEP CLI entry points `verify` and `report` per SPEC Constraints "Reporter mode for legacy scripts".

---

### `scripts/statusline-health-monitor.js` reduce-to-reporter+reader

**Analog:** Same dual pattern — POST signal then GET state.

**Read first:**
- Lines 129-146: log-rotation block — REPLACE with `createRotatingLogger`
- Lines 151-199: `getGlobalCodingMonitorHealth` — DELETE (calls deleted `global-service-coordinator.js`)
- Lines 205-279: `getRunningTranscriptMonitors` — DELETE (replace with `GET /health/state.lsl_by_project`)

**After reduction:**
```js
const COORDINATOR = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
async function pollAndCache() {
  const r = await fetch(`${COORDINATOR}/health/state`);
  if (!r.ok) {
    // SPEC R6: NOT 'healthy'. Write 'unknown' marker into cache file so the
    // tmux statusline shows a grey badge, not green.
    writeCache({ state: 'unknown', reason: `coordinator HTTP ${r.status}` });
    return;
  }
  const state = await r.json();
  writeCache(deriveStatuslineFromState(state));
}
```

**Landmines:** statusline cache file format is **explicitly NOT preserved** (SPEC Boundaries). Free to rewrite the cache file's JSON shape.

---

### `scripts/enhanced-transcript-monitor.js` (add `POST /signals` heartbeat)

**Analog:** `_forwardObsApi` from `integrations/system-health-dashboard/server.js:4162-4172` for the fetch shape; in-house signal builder.

**Read first** (existing health-file write sites):
- Lines 230-240: `getCentralizedHealthFile` — **DELETE** (no more file path; signal carries `projectPath`)
- Lines 4310-4351: `updateHealthFile()` — REPLACE the `fs.writeFileSync` at `:4348` with a `postSignal({ kind: 'lsl_heartbeat', session_id, projectPath, transcriptPath, status, ts })` call
- Lines 4387-4407: `cleanupHealthFile()` — REPLACE the `fs.writeFileSync` at `:4402` with `postSignal({ kind: 'lsl_heartbeat', session_id, status: 'stopped', reason: 'graceful_shutdown', ts })`

**Session-id source** (D-09): read once at construction
```js
this.sessionId =
  process.env.CLAUDE_SESSION_ID ||
  process.env.SESSION_ID ||
  `etm-${process.pid}-${Date.now()}`; // last-resort, not authoritative
```
Verified at `scripts/launch-agent-common.sh:67-76` — `bin/coding` already exports both `SESSION_ID` and `CLAUDE_SESSION_ID` into the session env.

**Replacement excerpt for `updateHealthFile`:**
```js
async updateHealthFile() {
  // ... existing health data assembly above remains unchanged ...
  try {
    await fetch(`${process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034'}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'lsl_heartbeat',
        session_id: this.sessionId,
        source: 'enhanced-transcript-monitor',
        status: isSuspiciousActivity ? 'degraded' : 'running',
        payload: { projectPath: this.config.projectPath, transcriptPath: this.transcriptPath, exchangeCount: this.exchangeCount, ...healthData },
        ts: Date.now()
      })
    });
  } catch (err) {
    this.debug(`signal POST failed: ${err.message}`); // local debug only; SPEC R6: surfacing handled by coordinator (it will mark this session 'stopped' after >15s with no signal)
  }
}
```

**Landmines:**
- DO NOT keep `fs.writeFileSync(this.config.healthFile, …)` at `:4348` or `:4402`.
- DO NOT keep `getCentralizedHealthFile()` — its consumers all migrate to the HTTP SoT.
- The `.health/.lsl-recovery-lock` and `.global-lsl-registry.json` files are now **read-only artifacts** (legacy `health-prompt-hook` reads of them go away; ETM should not write them either).

---

### `scripts/health-prompt-hook.js` (consumer migration)

**Analog:** `_fetchObsApi` at `integrations/system-health-dashboard/server.js:4179-4188` (single fetch, return null on failure).

**Read first:**
- Lines 16-27: imports + constants — replace `STATUS_FILE` constant with `COORDINATOR_URL`
- Lines 73-100: `checkHealthStatus` — REWRITE as single `fetch`
- Lines 230-263: `checkLSLHealth` recovery-lock spawn of `global-lsl-coordinator.js` — **DELETE** (the daemon is being deleted; coordinator owns recovery)
- Lines 280-297: `_watchdogIsFresh` — **DELETE**
- Lines 303-346: `outputHealthContext` — KEEP shape; data source becomes `await fetchCoordinatorState()`

**Excerpt to apply** (replaces `checkHealthStatus()`):
```js
async function checkHealthStatus() {
  const url = process.env.HEALTH_COORDINATOR_URL || 'http://localhost:3034';
  // RESEARCH §9 pitfall: keep graceful no-op when running outside coding env.
  // The "coordinator URL not in coding env" branch is the existing
  // `!existsSync(VERIFIER_SCRIPT)` exit-0 branch — preserve it; SPEC R6's
  // no-fallback-to-healthy applies to coordinator-side checks, not consumer-
  // side env-detection.
  if (!existsSync(VERIFIER_SCRIPT)) {
    return { servicesAvailable: false, exists: false, isStale: false, shouldBlock: false };
  }
  try {
    const r = await fetch(`${url}/health/state`);
    if (!r.ok) {
      return { servicesAvailable: true, exists: true, isStale: false, shouldBlock: false,
               status: { overallStatus: 'unknown', upstream: 'http_error' } };
    }
    const state = await r.json();
    return { servicesAvailable: true, exists: true, isStale: false, shouldBlock: false, status: deriveSummary(state) };
  } catch (err) {
    // SPEC R6: NOT 'healthy' on exception. Surface 'unknown'.
    return { servicesAvailable: true, exists: true, isStale: false, shouldBlock: false,
             status: { overallStatus: 'unknown', upstream: 'unreachable', error: err.message } };
  }
}
```

**Output JSON shape** (SPEC R8 — unchanged): `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: <string> } }` — preserved at `:340-345`.

**Landmines:**
- DO NOT spawn `global-lsl-coordinator.js` (deleted in this phase) at `:245-251`.
- DO NOT read any of: `.health/<projectName>-transcript-monitor-health.json`, `.health/.lsl-recovery-lock`, `.health/lsl-watchdog-heartbeat.json`, `.global-lsl-registry.json`, `.observations/db-recovering.json`. All of these are now reflected in `/health/state` (or out of scope).
- KEEP the `existsSync(VERIFIER_SCRIPT)` early-exit branch at `:74-84`: it's the "running outside coding env" graceful no-op. RESEARCH §9 confirms this distinction.
- KEEP `process.exit(0)` on Fatal errors at `:64-67, 362-365` — hooks must never block Claude on errors (Claude Code hook contract).

---

### `integrations/system-health-dashboard/server.js` (4-route reverse-proxy)

**Analog (in the SAME file):** `_forwardObsApi` at lines 4162-4172. The same file already does this pattern 6× for obs-api routes — this is exactly the established convention to extend.

**Existing fetch-and-forward pattern to reuse verbatim** (`integrations/system-health-dashboard/server.js:4160-4172`):
```js
async _forwardObsApi(req, res, pathAndQuery) {
    const base = process.env.OBS_API_URL || 'http://host.docker.internal:12436';
    const url = `${base}${pathAndQuery}`;
    try {
        const upstream = await fetch(url, { method: 'GET' });
        const body = await upstream.text();
        res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(body);
    } catch (err) {
        process.stderr.write(`[ObservationsAPI] forward to ${url} failed: ${err.message}\n`);
        res.status(502).json({ error: 'Observations API unreachable' });
    }
}
```

**Apply** (NEW helper `_forwardCoordinator(req, res, pathAndQuery)` mirroring above):
- `base = process.env.HEALTH_COORDINATOR_URL || 'http://host.docker.internal:3034'`
- Error log prefix: `[HealthCoordinatorProxy]`
- **Critical override of generic 502** (RESEARCH §6): when upstream fetch fails, the dashboard's 4 health routes must return the SPEC R8-mandated JSON shape with `overallStatus: 'unknown'` (NOT 'healthy'), so the dashboard frontend in `dist/` continues to render. RESEARCH §6 has the exact 503 body to use:
```js
res.status(503).json({
  overallStatus: 'unknown',
  violationCount: 0,
  criticalCount: 0,
  lastUpdate: new Date().toISOString(),
  autoHealingActive: false,
  upstream: 'unreachable'
});
```

**Routes to migrate** (registered at `:216-219`):
```js
// Read at: integrations/system-health-dashboard/server.js:216-219 (existing wiring)
this.app.get('/api/health-verifier/status',  this.cachedGet(1000, this.handleGetHealthStatus.bind(this)));
this.app.get('/api/health-verifier/report',  this.cachedGet(1000, this.handleGetHealthReport.bind(this)));
this.app.post('/api/health-verifier/verify', this.handleTriggerVerification.bind(this));
this.app.post('/api/health-verifier/restart-service', this.handleRestartService.bind(this));
```

For each handler:
- `handleGetHealthStatus` (lines 307-357): REPLACE the `readFileSync(statusPath, …)` block at line 325 with `await this._forwardCoordinator(req, res, '/health/state')` and reshape upstream JSON into the existing `{ status, data: { overallStatus, violationCount, criticalCount, lastUpdate, autoHealingActive } }` envelope.
- `handleGetHealthReport` (lines 478-507): REPLACE `readFileSync(reportPath, …)` at line 493 with the same pattern; reshape into `{ status, data: { checks, violations } }`.
- `handleTriggerVerification` (lines 512-544): REPLACE `execSync('node "${verifierScript}" verify …')` at line 524 with `POST /health/refresh` to the coordinator (D-04).
- `handleRestartService` (lines 549+): map service-name → narrow heal action per D-08; the coordinator may expose a dedicated endpoint or the dashboard may call `supervisorctl` for in-container services through Docker exec (research deliberately deferred — see D-08 tradeoff acknowledged).
- `checkDaemonHeartbeat` (lines 363-398) and `restartDaemon` (lines 403+): **DELETE** entire methods. The coordinator's launchd KeepAlive is the heartbeat truth; dashboard never restarts a daemon.

**Landmines:**
- DO NOT keep any `readFileSync(join(codingRoot, '.health/…'), …)` calls. SPEC AC: `! grep -rE "readFileSync.*\\.health/(verification|.*-transcript-monitor)" integrations/system-health-dashboard/server.js`.
- DO NOT keep `spawn('node', [verifierScript, 'verify'], …)` (line 463) — replaced by `POST /health/refresh`.
- KEEP the route paths `/api/health-verifier/status`, `/api/health-verifier/report`, `/api/health-verifier/verify` (SPEC R8).
- KEEP all NON-health-verifier routes intact (`/api/observations`, `/api/digests`, `/api/insights` are owned by obs-api proxy — already working).

---

### `integrations/mcp-constraint-monitor/src/dashboard-server.js` (added per user resolution; RESEARCH §8 leak)

**Analog:** Same `_forwardObsApi` pattern from `integrations/system-health-dashboard/server.js:4162-4172`.

**Read first:**
- Line 12: `import { readFileSync, …, statSync } from 'fs';` — KEEP (still needed for non-health code paths)
- Lines 955-997: `handleGetHealthStatus` — REPLACE `readFileSync(statusPath, …)` at `:973` with the fetch pattern.
- Lines 1000-1030+: `handleGetHealthReport` — REPLACE `readFileSync(reportPath, …)` at `:1018` with the fetch pattern.

**Replacement excerpt** (apply at both call sites — same shape as system-health-dashboard above):
```js
async handleGetHealthStatus(req, res) {
  try {
    const url = process.env.HEALTH_COORDINATOR_URL || 'http://host.docker.internal:3034';
    const upstream = await fetch(`${url}/health/state`);
    if (!upstream.ok) {
      return res.status(503).json({
        status: 'success',
        data: { status: 'unknown', overallStatus: 'unknown', upstream: `HTTP ${upstream.status}` }
      });
    }
    const state = await upstream.json();
    res.json({ status: 'success', data: reshapeForConstraintDashboard(state) });
  } catch (err) {
    logger.error('Failed to get health status', { error: err.message });
    res.status(503).json({ status: 'success', data: { status: 'unknown', upstream: 'unreachable' } });
  }
}
```

**Submodule rebuild rule (CLAUDE.md, RESEARCH §10 "Project Constraints"):** changes to `integrations/mcp-constraint-monitor/src/*.js` follow the submodule rebuild protocol:
1. `cd integrations/mcp-constraint-monitor && npm run build` (if `package.json` has a TS build step — confirm via `grep -E '"build"|"start"' integrations/mcp-constraint-monitor/package.json`).
2. `cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`.
The plan's task description must include both steps; forgetting the build step is a recurring failure mode.

**Landmines:**
- DO NOT touch any code outside lines 955-1030 unless a separate audit confirms the rest of the file is unchanged. The dashboard server is large; the surgery is specifically the two health-verifier reader paths.
- DO NOT delete the `import` for `readFileSync` (line 12) — other handlers in the file (LSL registry reads at `:157, 668, 836`, violations file at `:498`) still use it.

---

### `scripts/__tests__/health-coordinator/_helpers.sh` (test helper library)

**Analog:** `tests/integration/launcher-e2e.sh:43-105` — the `run_test`, `assert_*`, color-output helpers.

**Excerpt to lift verbatim** (lines 43-105):
```bash
# ============================================
# Test Helpers (lifted from tests/integration/launcher-e2e.sh:43-105)
# ============================================

run_test() {
  local test_name="$1"
  local test_func="$2"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  printf "${CYAN}[TEST %2d]${NC} %-60s " "$TOTAL_TESTS" "$test_name"
  local output exit_code
  output=$($test_func 2>&1) && exit_code=0 || exit_code=$?
  if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}"; TESTS_PASSED=$((TESTS_PASSED + 1))
  elif [ $exit_code -eq 2 ]; then
    echo -e "${YELLOW}SKIP${NC}"; TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    [ -n "$output" ] && echo "    Reason: $output"
  else
    echo -e "${RED}FAIL${NC}"; TESTS_FAILED=$((TESTS_FAILED + 1))
    [ -n "$output" ] && echo "$output" | sed 's/^/    /'
  fi
}

assert_exit_code()      { ... }   # lift verbatim from :76-84
assert_output_contains()    { ... }   # lift verbatim from :86-95
assert_output_not_contains(){ ... }   # lift verbatim from :97-104
```

**Add (NEW for Phase 33):**
```bash
# Coordinator-specific helpers
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

assert_state_field() {
  local jq_path="$1"; local expected="$2"; local context="$3"
  local actual
  actual=$(curl -sf "$URL/health/state" | jq -r "$jq_path")
  if [ "$actual" != "$expected" ]; then
    echo "Expected $jq_path == $expected, got $actual ($context)"
    return 1
  fi
}

wait_for_coordinator() {
  for i in $(seq 1 30); do
    if curl -sf "$URL/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "coordinator did not respond on $URL within 30s"; return 1
}
```

**Landmines:**
- DO NOT use `set -e` at the top of the helpers file — `run_test` deliberately captures non-zero exits via `$?`. The launcher e2e file does `set -e` at `:15` because its test harness depends on it; the coordinator helpers should match that pattern when used by `quick.sh` / `run-all.sh` but the helpers file itself is sourced, not executed.
- macOS `grep`: use `-qF --` (CLAUDE.md "Shell Scripting") to avoid option parsing issues on `--force-recreate`-style assertion payloads.

---

### `scripts/__tests__/health-coordinator/two-session-agreement.test.sh` (the headline test)

**Analog:** `tests/integration/launcher-e2e.sh` overall structure + RESEARCH §4 mock-reporter.

**Excerpt** (RESEARCH §4 verbatim, with stub-reporter approach to avoid bin/coding interactivity):
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"
SID_A="claude-test-A-$$"; SID_B="claude-test-B-$$"

# Spawn two mock reporters in /coding (project rollup expects projectPath=…/coding)
PROJECT="/Users/Q284340/Agentic/coding"
mock_reporter() {
  local sid="$1"
  while true; do
    curl -s -X POST -H 'Content-Type: application/json' \
      -d "{\"kind\":\"lsl_heartbeat\",\"session_id\":\"$sid\",\"source\":\"mock\",\"status\":\"running\",\"payload\":{\"projectPath\":\"$PROJECT\"},\"ts\":$(python3 -c 'import time; print(int(time.time()*1000))')}" \
      "$URL/signals" >/dev/null
    sleep 4
  done
}
mock_reporter "$SID_A" & A_PID=$!
mock_reporter "$SID_B" & B_PID=$!
trap 'kill $A_PID $B_PID 2>/dev/null || true' EXIT

sleep 7  # let two ticks roll through

assert_state_field '.lsl_by_project["coding"]' 'healthy' 'both sessions live' || exit 1
[[ $(curl -sf "$URL/health/state" | jq -r '.lsl | length') -ge 2 ]] || { echo "expected ≥2 lsl entries"; exit 1; }

# Kill A
kill -9 "$A_PID"
sleep 17  # > 15s heartbeat-staleness threshold (D-10)

assert_state_field ".lsl[\"$SID_A\"].status" 'stopped' 'A killed' || exit 1
assert_state_field ".lsl[\"$SID_B\"].status" 'running' 'B alive'   || exit 1
assert_state_field '.lsl_by_project["coding"]' 'healthy' 'project still healthy' || exit 1

# Three-reader agreement (SPEC AC #5)
prompt_hook_out=$(echo '{"cwd":"/Users/Q284340/Agentic/coding"}' | node "$SCRIPT_DIR/../../health-prompt-hook.js")
echo "$prompt_hook_out" | grep -qF -- '"hookSpecificOutput"' || { echo "prompt-hook shape broken"; exit 1; }
echo "$prompt_hook_out" | grep -qF 'LSL DOWN' && { echo "prompt-hook reported LSL DOWN — FAIL (expected healthy)"; exit 1; } || true

curl -fs http://localhost:3032/api/health-verifier/status | jq -e '.data.overallStatus != "unhealthy"' >/dev/null \
  || { echo "dashboard reports unhealthy — FAIL"; exit 1; }

echo "PASS: two-session agreement — A=stopped, B=running, project=healthy"
```

**Landmines:**
- The `bin/coding` interactive launch is DELIBERATELY NOT used here (RESEARCH §4 — it can't be driven non-interactively). Real-tmux verification is a manual step under `33-VERIFICATION.md`.
- Heartbeat staleness threshold MUST match D-10 (15s). If the coordinator's threshold differs, this test will be flaky.
- Don't rely on `gdate +%s%N` for timestamps — use `python3 -c 'import time; …'` (RESEARCH §5; portable across mac and Linux).

---

### `scripts/__tests__/health-coordinator/detection-latency.test.sh`

**Analog:** RESEARCH §5 (verbatim — no in-repo bash latency benchmark exists).

**Open question** (RESEARCH §5 + Open Question #1): SPEC names `supervisorctl stop web-services:vkb-server` but D-08 drops in-container supervisord polling, so that injection only surfaces via 30s Docker healthcheck — outside the 10s SLA. Use one of these instead:
1. **Recommended:** `HEALTH_COORDINATOR_INJECT_THROW=db_health` env-var injection (RESEARCH §10) — coordinator throws on next tick, surfaces as `unknown` in 5-10s.
2. Kill a host service the coordinator's PSM tracks (e.g., obs-api on :12436) — `process.kill(pid, 0)` is signal 0, instant detection on the next 5s tick.
3. POST a synthetic `unknown`-status signal and time how long until it surfaces.

**Excerpt to apply** (RESEARCH §5 with Option 1 chosen):
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

samples=()
for i in $(seq 1 50); do
  T0=$(python3 -c 'import time; print(time.time())')
  # Option 1: env-var injection (cleanest; planner should confirm chosen path with user)
  launchctl setenv HEALTH_COORDINATOR_INJECT_THROW "db_health"
  launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"
  while true; do
    state=$(curl -sf "$URL/health/state")
    if echo "$state" | jq -e '.databases.status == "unknown"' >/dev/null 2>&1; then
      T1=$(python3 -c 'import time; print(time.time())')
      samples+=( "$(python3 -c "print($T1 - $T0)")" )
      break
    fi
    sleep 0.5
  done
  launchctl unsetenv HEALTH_COORDINATOR_INJECT_THROW
  launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"
  sleep 3
done

printf '%s\n' "${samples[@]}" | python3 -c "
import sys, statistics
s=sorted(float(x) for x in sys.stdin)
qs=statistics.quantiles(s, n=100)
print(f'P95={qs[94]:.3f} P99={qs[98]:.3f}')
assert qs[94] <= 10.0, f'P95 violated: {qs[94]}'
assert qs[98] <= 15.0, f'P99 violated: {qs[98]}'
"
```

**Landmines:**
- DO NOT use `supervisorctl stop` for the latency test (RESEARCH §5 — 30s Docker healthcheck dominates).
- DO NOT use macOS `date +%s.%N` (BSD date doesn't support `%N`). Use `python3` (RESEARCH §5).
- 50 trials × ~5s injection + ~3s settle = ~400-500s expected runtime. Document in `33-VERIFICATION.md`.

---

### `scripts/__tests__/health-coordinator/injection.test.sh`

**Analog:** RESEARCH §10 (verbatim).

**Excerpt:**
```bash
#!/bin/bash
set -e
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

launchctl setenv HEALTH_COORDINATOR_INJECT_THROW "db_health"
launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"
sleep 8  # one 5s tick + slack

result=$(curl -sf "$URL/health/state" | jq -r '.databases.status')
launchctl unsetenv HEALTH_COORDINATOR_INJECT_THROW
launchctl kickstart -k "gui/$UID/com.coding.health-coordinator"

if [ "$result" = "healthy" ]; then
  echo "FAIL: injected throw resulted in 'healthy' (SPEC R6 violated)"; exit 1
fi
if [ "$result" != "unknown" ]; then
  echo "FAIL: expected 'unknown', got '$result'"; exit 1
fi
echo "PASS: injection → unknown (SPEC R6 + AC #13)"
```

---

### `scripts/__tests__/health-coordinator/keepalive.test.sh`

**Analog:** RESEARCH §1 deterministic test snippet (verbatim).

**Excerpt:**
```bash
#!/bin/bash
set -e
old_pid=$(pgrep -f health-coordinator.js | head -1)
[ -n "$old_pid" ] || { echo "FAIL: no coordinator running"; exit 1; }
kill -9 "$old_pid"
for i in $(seq 1 35); do
  new_pid=$(pgrep -f health-coordinator.js | head -1)
  if [ -n "$new_pid" ] && [ "$new_pid" != "$old_pid" ]; then
    echo "PASS: respawned in ${i}s: ${old_pid} -> ${new_pid}"; exit 0
  fi
  sleep 1
done
echo "FAIL: coordinator did not respawn within 35s"; exit 1
```

**Landmine:** the SPEC's AC #11 explicitly uses `pgrep -f health-coordinator` — match exactly.

---

### `scripts/__tests__/health-coordinator/eviction.test.sh`

**Analog:** Two-session-agreement structure (above), with longer wait window per D-10 (5 min).

**Excerpt:**
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"

SID="evict-test-$$"
# Send one heartbeat then stop
curl -sf -X POST -H 'Content-Type: application/json' \
  -d "{\"kind\":\"lsl_heartbeat\",\"session_id\":\"$SID\",\"source\":\"mock\",\"status\":\"running\",\"payload\":{\"projectPath\":\"/tmp\"},\"ts\":$(python3 -c 'import time; print(int(time.time()*1000))')}" \
  "$URL/signals" >/dev/null

sleep 17  # > 15s threshold → status: stopped
assert_state_field ".lsl[\"$SID\"].status" 'stopped' 'session stopped' || exit 1

# Wait 5 min + slack — D-10: stopped sessions evict after 5min
echo "Waiting 310s for eviction..."
sleep 310

[[ $(curl -sf "$URL/health/state" | jq -r ".lsl[\"$SID\"]") == 'null' ]] \
  || { echo "FAIL: session still in lsl after 5min"; exit 1; }
echo "PASS: session evicted after 5min"
```

**Landmine:** runtime 5+ min — quarantine to `run-all.sh`, NOT `quick.sh`.

---

### `scripts/__tests__/health-coordinator/docker-health-passthrough.test.sh`

**Analog:** RESEARCH §2 docker inspect snippet.

**Excerpt:**
```bash
#!/bin/bash
set -e
URL="${HEALTH_COORDINATOR_URL:-http://localhost:3034}"
docker_status=$(docker inspect coding-services --format '{{.State.Health.Status}}')
coordinator_status=$(curl -sf "$URL/health/state" | jq -r '.container.healthcheck')
[ "$docker_status" = "$coordinator_status" ] || { echo "FAIL: docker=$docker_status coordinator=$coordinator_status"; exit 1; }
echo "PASS: docker.Health.Status=$docker_status surfaced as-is"
```

---

### `scripts/__tests__/health-coordinator/rules-schema.test.mjs`

**Analog:** none in repo (NEW). Use `node:test` + `ajv` (already in package.json).

**Read first:** `config/health-verification-rules.json` top-level keys (SPEC R8): `version`, `description`, `verification`, `rules.{databases,services,processes,files}`, `severity_definitions`, `auto_healing`, `reporting`, `alert_thresholds`. Per-rule keys: `enabled`, `severity`, `check_type`, `auto_heal`, `auto_heal_action`.

**Excerpt:**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, '../../../config/health-verification-rules.json');

const schema = {
  type: 'object',
  required: ['version', 'description', 'verification', 'rules', 'severity_definitions', 'auto_healing', 'reporting'],
  properties: {
    version: { type: 'string' },
    rules: {
      type: 'object',
      required: ['databases', 'services', 'processes', 'files'],
      additionalProperties: { type: 'object' }
    }
  },
  additionalProperties: true
};

test('rules schema preserves SPEC R8 top-level structure', () => {
  const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  const ok = new Ajv().compile(schema)(rules);
  assert.equal(ok, true, 'rules.json must validate');
  assert.equal(rules.rules.services.bind_mount_freshness, undefined, 'D-06: bind_mount_freshness deleted');
  assert.equal(rules.rules.processes.supervisord_status, undefined, 'D-08: supervisord_status deleted');
});
```

---

### `config/health-verification-rules.json` (DELETIONS only)

**Read first:** lines 140-163 (`bind_mount_freshness` block), lines 201-212 (`supervisord_status` block).

**Apply (per D-06, D-07, D-08):**
- DELETE the entire `bind_mount_freshness` object at lines 140-163. Result: `services` block ends after `enhanced_transcript_monitor` block.
- DELETE the entire `supervisord_status` object starting at line 201. (D-08: drop container-process supervision from host coordinator entirely.)
- INDIRECT (already moot): the `expected_processes` array inside `supervisord_status` (line 207+) — vanishes with parent block.

**Landmines:**
- DO NOT change top-level structure (`rules.databases`, `rules.services`, `rules.processes`, `rules.files`) — SPEC R8 / Acceptance criterion: rules-schema test above.
- DO NOT delete `leveldb_lock_check`, `qdrant_availability`, `enhanced_transcript_monitor` — those continue to be checked by the coordinator.
- KEEP `auto_healing.enabled = true` at the top level if it exists; coordinator now interprets per-rule `auto_heal` narrowly per D-08 (no whole-container actions).

---

### `scripts/health-remediation-actions.js` (DELETE refreshBindMounts + dispatch)

**Read first:**
- Line 178: dispatch case `result = await this.refreshBindMounts(issueDetails);` — DELETE
- Lines 819-870 (approx., includes the closing brace): entire `refreshBindMounts` method body — DELETE

**Verify after deletion:**
```bash
grep -rE "force-recreate|--force-recreate|refreshBindMounts|bind_mount_freshness" scripts/health-remediation-actions.js scripts/health-verifier.js
# expected: empty (SPEC AC #6, #7)
```

**Landmines:**
- DO NOT delete unrelated remediations in this file (e.g., `restart_qdrant`, `cleanup_dead_processes`). Only the `refreshBindMounts` method and its dispatch case.
- D-08 reduces all remaining auto-heals to "smallest unit": `supervisorctl restart <service>` (in-container), `docker restart coding-services` (one-shot, NOT `--force-recreate`), and host-daemon restart through coordinator's PSM. Anything in this file that runs `docker-compose up -d --force-recreate` for any other rule should be flagged for the planner.

---

### `docker/docker-compose.yml` (ADD env var)

**Read first:** lines 25-78 (the `coding-services.environment` block), specifically line 60-61 area where `OBS_API_URL=http://host.docker.internal:12436` is set.

**Apply (D-02, D-03):** add adjacent to the existing `OBS_API_URL`:
```yaml
      # Health Coordinator — host-side SoT for system health (Phase 33)
      # In-container readers (dashboard, constraint-monitor) reach the host
      # coordinator via host.docker.internal (extra_hosts wires this on Linux).
      - HEALTH_COORDINATOR_URL=http://host.docker.internal:3034
```

**Landmines:**
- DO NOT touch `extra_hosts: ["host.docker.internal:host-gateway"]` at lines 131-132 — already correctly configured for Linux.
- DO NOT change the `healthcheck:` block at lines 141-146 — Docker's own healthcheck is the SoT for container health (SPEC R7).
- DO NOT add a port mapping for `:3034` — the coordinator runs on the HOST, not inside the container. The container reaches it via host.docker.internal.

---

## Shared Patterns (cross-cutting)

### Authentication / Authorization
**Source:** none — SPEC explicitly says "Encryption / authn on `GET /health/state` — endpoint binds to localhost only" (SPEC Boundaries).
**Apply to:** all coordinator endpoints. Bind `0.0.0.0` per RESEARCH §3 (Linux Docker requires this; firewall enforces locality), but do not add auth middleware.

### Error Handling (SPEC R6 — detection, not silent fallback)
**Source pattern:** obs-api `_forwardObsApi` (system-health-dashboard/server.js:4162-4172) — catches fetch errors, returns `502` with explicit error body, logs to stderr.
**Apply to:** ALL fetch sites in migrated readers (health-prompt-hook.js, system-health-dashboard/server.js, mcp-constraint-monitor/dashboard-server.js, statusline-health-monitor.js).
**Critical override:** when the upstream is unreachable, dashboard responses must use `overallStatus: 'unknown'` (NOT `'healthy'`) — RESEARCH §6 has the exact 503 body. SPEC R6 grep gate: `grep -rE "catch\\b.*\\{[^}]*return\\s*['\"]healthy" scripts/health-prompt-hook.js scripts/health-verifier.js scripts/process-state-manager.js` must be empty.

### Logging
**Source:** `lib/utils/log-rotator.js` (NEW, this phase) — extracted from `health-verifier.js:171-188`.
**Apply to:** coordinator + the two reduced reporters. Class-name prefix per CONVENTIONS.md ("Logging").
**Constraint Monitor compat:** use `process.stderr.write(...)`, NOT `console.log` — CLAUDE.md "no-console-log" constraint, obs-api uses this at `:77, 689`.

### Config Loading
**Source:** `health-verifier.js:100-148` — `loadRules()` + `applyDockerOverrides()`.
**Apply to:** coordinator. KEEP `loadRules()`. DELETE `applyDockerOverrides()` (host-only — no `host.docker.internal → localhost` swap needed).

### CLI Entry
**Source:** `lib/utils/esm-cli.js` `runIfMain(import.meta.url, fn)`.
**Apply to:** coordinator + reporters. Coordinator's `main()` starts the Express listener and the 5s tick. Reporters' `main()` is a one-shot signal POST (CLI mode preserved per CONTEXT.md "Reporter mode for legacy scripts").

### Submodule Rebuild
**Source:** CLAUDE.md "Submodules & Build Pipeline" + RESEARCH §10 "Project Constraints".
**Apply to:** ANY change in `integrations/mcp-constraint-monitor/src/*.js` (the constraint-monitor migration in this phase).
**Steps (REQUIRED in plan):**
```bash
cd integrations/mcp-constraint-monitor && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```
**Exception:** `integrations/system-health-dashboard/server.js` is bind-mounted, no Docker rebuild needed.

---

## No Analog Found

| File | Role | Data Flow | Resolution |
|------|------|-----------|------------|
| `scripts/__tests__/health-coordinator/rules-schema.test.mjs` | schema test (Ajv) | request-response | NEW pattern — see RESEARCH §10 / per-task verification map row 33-05-03; pattern documented above |
| `scripts/__tests__/health-coordinator/detection-latency.test.sh` | latency benchmark | request-response loop | NEW pattern — RESEARCH §5 (verbatim) |
| `scripts/__tests__/health-coordinator/injection.test.sh` | fault injection | request-response | NEW pattern — RESEARCH §10 (env-var injection point) |
| `scripts/__tests__/health-coordinator/keepalive.test.sh` | resilience (kill -9) | event-driven | NEW pattern — RESEARCH §1 deterministic snippet |

All four have well-specified excerpts in RESEARCH.md; planner should reference RESEARCH section numbers in `<read_first>` blocks rather than search for analogs.

---

## Metadata

**Analog search scope:**
- `scripts/` (all .js, .mjs, .sh, plist files) — primary source for in-repo patterns
- `integrations/system-health-dashboard/server.js` — primary analog for fetch reverse-proxy
- `integrations/mcp-constraint-monitor/src/dashboard-server.js` — secondary leak target
- `tests/integration/`, `tests/` — bash test patterns
- `lib/utils/` — shared helper conventions
- `~/Library/LaunchAgents/com.coding.*.plist` — launchd plist analog
- `config/health-verification-rules.json`, `docker/docker-compose.yml` — config anchors

**Files scanned:** 14 source/config files read in full or in targeted ranges; 3 grep sweeps for cross-cutting pattern occurrences.

**Pattern extraction date:** 2026-05-06

---

## PATTERN MAPPING COMPLETE

**Phase:** 33 — health-monitoring-consolidation
**Files classified:** 22 (12 NEW, 7 MODIFY-reduce/migrate, 1 MODIFY-config-deletions, 1 MODIFY-compose, 1 MODIFY-remediation-deletion, 4 SCRIPT-DELETE, 1 PLIST-REMOVE)
**Analogs found:** 22 / 22

### Coverage
- Files with exact analog (verbatim copy/paste possible): 11
  - `scripts/health-coordinator.js` ← `scripts/observations-api-server.mjs`
  - `lib/utils/log-rotator.js` ← `scripts/health-verifier.js:171-188`
  - `scripts/enhanced-transcript-monitor.js` (signal POST) ← `_forwardObsApi`
  - `scripts/health-prompt-hook.js` ← `_fetchObsApi`
  - `integrations/system-health-dashboard/server.js` (4 routes) ← in-file `_forwardObsApi` (already used 6× for obs-api)
  - `integrations/mcp-constraint-monitor/src/dashboard-server.js` ← `_forwardObsApi`
  - `scripts/__tests__/health-coordinator/_helpers.sh` ← `tests/integration/launcher-e2e.sh:43-105`
  - `scripts/__tests__/health-coordinator/two-session-agreement.test.sh` ← RESEARCH §4 (mock reporters)
  - `scripts/__tests__/health-coordinator/docker-health-passthrough.test.sh` ← RESEARCH §2 docker inspect
  - `~/Library/LaunchAgents/com.coding.health-coordinator.plist` ← `~/Library/LaunchAgents/com.coding.system-watchdog.plist` (3 key changes)
  - `config/health-verification-rules.json` (deletions) ← line-pinpointed in current file
- Files with role-match analog: 7 (the test scripts that need new bash pattern but are well-specified in RESEARCH)
- Files with no analog: 0 — RESEARCH already supplies new-pattern excerpts for the four well-specified tests
- Files DELETED outright: 5 (4 legacy scripts + 1 plist)

### Key Patterns Identified
- **Single-owner HTTP gateway pattern is the project default** — `obs-api` (`scripts/observations-api-server.mjs`) is the established analog; coordinator follows verbatim (Express on 0.0.0.0, `runIfMain` CLI, graceful shutdown, `process.stderr.write` logging).
- **Reverse-proxy via `_forwardObsApi` is already the convention in `integrations/system-health-dashboard/server.js`** (used 6× for obs-api routes); the 4 health-verifier routes simply add a 7th, 8th, 9th, 10th use of the same pattern with `HEALTH_COORDINATOR_URL` substituted for `OBS_API_URL`.
- **10MB log-rotation block is identical in two files** (`health-verifier.js:171-188` ≡ `statusline-health-monitor.js:129-146`) — extract to `lib/utils/log-rotator.js`, replace both call sites, coordinator imports the same helper.
- **Bash test pattern is `tests/integration/launcher-e2e.sh:43-105`** — `run_test`, `assert_exit_code`, `assert_output_contains`, `assert_output_not_contains`. Lift verbatim into `_helpers.sh`.
- **Per-rule auto_heal narrowness (D-08)** is enforced by deleting two whole rule blocks (`bind_mount_freshness`, `supervisord_status`) and one entire method (`refreshBindMounts`) — a structural deletion, not a logic edit.
- **Session ID source is already wired by `bin/coding`** at `scripts/launch-agent-common.sh:67-76` — `CLAUDE_SESSION_ID`/`SESSION_ID` env vars are guaranteed in tmux session env.
- **Constraint Monitor leak (RESEARCH §8)** must be migrated in the same phase even though SPEC's grep targets don't include it — otherwise the constraint dashboard at :3030 silently breaks at cutover.
- **Detection-latency injection target (RESEARCH §5 + Open Question #1)** — SPEC names `supervisorctl stop` but D-08 makes that path 30s-bounded; planner must resolve with user (recommend `HEALTH_COORDINATOR_INJECT_THROW=db_health` env-var injection or host-process-kill).

### File Created
`/Users/Q284340/Agentic/coding/.planning/phases/33-health-monitoring-consolidation/33-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference verbatim excerpts in PLAN.md `<read_first>` and `<action>` fields without rediscovering analogs. The two SPEC↔CONTEXT tensions flagged in RESEARCH (latency-injection target; constraint-monitor in/out of scope) are noted in this file's Landmines + Open Questions but are decisions for the planner/user, not the pattern mapper.
