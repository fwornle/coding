# Phase 33: Health Monitoring Consolidation — Research

**Researched:** 2026-05-06
**Domain:** macOS launchd + Docker host/container HTTP SoT + Express HTTP coordinator
**Confidence:** HIGH (most facts verified directly against `launchd.plist(5)` man page, live `docker inspect` on coding-services, source reads at file:line)

---

## Goals

Fill in the technical know-how the planner needs to write Phase 33 tasks. Decisions D-01..D-10 are locked; this research does NOT revisit them. Instead it (a) verifies the launchd / Docker / Express specifics the coordinator depends on, (b) extracts reusable shapes from existing repo code (`obs-api`, `health-verifier.js`, PSM), (c) recommends test-harness shapes for the two-session and detection-latency acceptance tests, and (d) flags one real but easy-to-miss leak: the constraint-monitor dashboard at `:3030` independently reads `.health/verification-status.json` and will silently break at cutover unless touched.

**Primary recommendation:** Coordinator = single Node 22 ESM script `scripts/health-coordinator.js` mirroring `scripts/observations-api-server.mjs` bootstrap; launchd plist with `KeepAlive=true` + `ThrottleInterval=30` + `RunAtLoad=true`; tests as bash + `curl` + `python3 -c statistics.quantiles` (host has both); fix the constraint-monitor leak in the same commit even though SPEC's grep targets don't include it.

---

<phase_requirements>
## Phase Requirements

| ID | Description (from SPEC R1..R9) | Research Support |
|----|-------------------------------|------------------|
| R1 | Coordinator process owns the SoT | Confirmed obs-api pattern (single-owner HTTP gateway) is project-standard; mirror it. PSM (`scripts/process-state-manager.js`) already owns service registrations and DB health — coordinator wraps it. |
| R2 | HTTP endpoint serves the SoT | Confirmed `coding-services` already has `extra_hosts: ["host.docker.internal:host-gateway"]` (`docker/docker-compose.yml:131-132`), so in-container readers reach the host coordinator the same way they reach `obs-api:12436` today. |
| R3 | Per-session keyed health entries | ETM (`enhanced-transcript-monitor.js:230-240`) already centralises health files by `projectName`; CONTEXT D-09 + D-10 lock the session-id source and eviction. ETM's `updateHealthFile()` (line 4348) is the exact insertion point for `POST /signals`. |
| R4 | Detection latency SLA (10s p95 / 15s p99) | Coordinator 5s tick is well below the 10s p95 ceiling (Nyquist 2× holds for the worst case where injection happens at tick start). Detection latency = injection-to-tick-window + tick processing; with 5s ticks, worst case ≈ 5s + tick-cost ≪ 10s. |
| R5 | Narrow auto-heal | Confirmed `health-remediation-actions.js:840` does `docker-compose up -d --force-recreate coding-services` for `bind_mount_freshness` and `health-verifier.js:1184/1256/1266` references the rule. SPEC's grep target will pass once both are removed. |
| R6 | Detection, not silent fallback | Confirmed `health-prompt-hook.js:259` has the silent-catch-returning-empty pattern; the rewrite must replace it with a single `fetch` that propagates errors as `unknown`. |
| R7 | Container health delegated to Docker | Verified live: `docker inspect coding-services --format '{{json .State.Health}}'` returns `{"Status":"healthy", "FailingStreak":0, "Log":[…]}` with 5 entries — exactly as SPEC R7 contemplates. |
| R8 | Backward-compatible external contracts | Top-level keys in `config/health-verification-rules.json`: `version`, `description`, `verification`, `rules`, `severity_definitions`, `auto_healing`, `reporting`, `alert_thresholds`. Sub-rule keys: `databases`, `services`, `processes`, `files`. Schema preserved per SPEC. |
| R9 | Single-process supervision tree | `launchd.plist(5)` confirms KeepAlive=true respawns on any exit; ThrottleInterval=30 caps respawn cadence at 30s. `launchctl unload` does NOT trigger respawn (unload removes the job entirely). |
</phase_requirements>

---

## Findings

### 1. launchd specifics for `com.coding.health-coordinator.plist`

**Source:** `man launchd.plist` (section 5), local macOS — authoritative.

**Concrete plist (recommended):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.coding.health-coordinator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/Q284340/Agentic/coding/scripts/health-coordinator.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/Q284340/Agentic/coding</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin</string>
        <key>HEALTH_COORDINATOR_PORT</key>
        <string>3034</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>30</integer>
    <key>StandardOutPath</key>
    <string>/Users/Q284340/Agentic/coding/.logs/health-coordinator.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/Q284340/Agentic/coding/.logs/health-coordinator.log</string>
</dict>
</plist>
```

**Behavior facts (from `man launchd.plist`):**

- `KeepAlive=true` (boolean form): launchd restarts the job on **any** exit (clean exit code 0, signal, crash). [VERIFIED: launchd.plist(5)]
- `ThrottleInterval` default = **10 seconds** (jobs will not be spawned more than once every 10s by default). Setting `30` doubles the cushion the legacy plist uses and matches SPEC AC #11 ("respawns within 30s"). [VERIFIED: launchd.plist(5) "ThrottleInterval"]
- `launchctl unload` (or modern `launchctl bootout`) **removes the job** — KeepAlive does NOT respawn an unloaded job. This is the rollback path SPEC names. [VERIFIED: launchd.plist(5)]
- `RunAtLoad=true` is needed because absent it the job only starts on demand; `KeepAlive` alone does not start the job at load. [VERIFIED: launchd.plist(5) "RunAtLoad"]
- Port-already-taken at first start: launchd does NOT detect this; the node process will exit non-zero with `EADDRINUSE`, which then triggers KeepAlive — and ThrottleInterval=30 throttles the loop. The coordinator itself should `process.exit(1)` with a clear stderr message on EADDRINUSE so the log is diagnosable. [VERIFIED: behavior; node `http.Server` emits `'error'` with `code: 'EADDRINUSE'`]

**Polling for "respawned within 30s" (SPEC AC #11):**

`launchctl list <label>` prints a plist-like dict. Live verification on the existing plist:

```
$ launchctl list com.coding.system-watchdog
{
    "LastExitStatus" = 0;
    "Label" = "com.coding.system-watchdog";
    "Program" = "/opt/homebrew/bin/node";
    ...
};
```

When the job is **running**, the dict additionally contains `"PID" = <integer>;`. When loaded but not running, no `PID` key appears. [VERIFIED: live launchctl output]

**Deterministic test:**
```bash
old_pid=$(pgrep -f health-coordinator.js)
kill -9 "$old_pid"
# Poll for fresh PID up to 35s (ThrottleInterval=30 + slack)
for i in $(seq 1 35); do
    new_pid=$(pgrep -f health-coordinator.js)
    if [ -n "$new_pid" ] && [ "$new_pid" != "$old_pid" ]; then
        echo "respawned in ${i}s: ${old_pid} -> ${new_pid}"; exit 0
    fi
    sleep 1
done
exit 1
```

`launchctl list` is also acceptable but `pgrep -f` is simpler and the SPEC's AC #11 explicitly calls `pgrep -f health-coordinator`.

### 2. Docker healthcheck inspection (SPEC R7)

**Live verification on coding-services right now:**

```bash
docker inspect coding-services --format '{{json .State.Health}}'
# → {"Status":"healthy","FailingStreak":0,"Log":[ … 5 entries … ]}
```

[VERIFIED: live docker inspect on coding-services 2026-05-06]

**Status values** (from Moby source): `"starting"` (during `start_period`), `"healthy"`, `"unhealthy"`, and the field is **absent / `"none"`** for containers without a HEALTHCHECK directive. Empty string is not produced. [CITED: moby/moby `api/types/container/container.go` Health struct] — the live coding-services value is `"healthy"`, confirming format.

**Log array:** Docker keeps the **last 5** healthcheck results (verified live: exactly 5 entries returned). Each entry has:
- `Start` (ISO 8601 UTC timestamp, probe begin)
- `End` (ISO 8601 UTC timestamp, probe end)
- `ExitCode` (integer; 0=healthy, 1=unhealthy, 2=reserved)
- `Output` (stdout+stderr from the probe command, capped at ~4KB)

**Existing healthcheck config** (`docker/docker-compose.yml:141-146`):
```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -sf http://localhost:8080/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 5
  start_period: 120s
```

So `Status` updates every **30s**, and a flap requires 5 consecutive failures (~150s) to flip to `unhealthy`. **Implication for coordinator:** poll `docker inspect` on the 5s tick, but the underlying truth only changes every 30s. That's fine for the coordinator's 10s p95 SLA — SPEC R7 says "surface as-is", not "improve Docker's cadence."

**Last-probe-time field:** Use `Log[-1].End` as the most recent probe completion. Status is updated synchronously when a probe completes, so `Status` and `Log[-1].End` are consistent within microseconds (the probe completion writes both atomically in the daemon). [CITED: moby/moby `daemon/health.go` `handleProbeResult`]

**Single command for the coordinator:**
```bash
docker inspect coding-services --format '{{.State.Health.Status}}'
# starting | healthy | unhealthy | (empty if no healthcheck)
```

### 3. Express bootstrap pattern in this repo

**Mirror `scripts/observations-api-server.mjs` (single-owner HTTP gateway, exact analog).** Skeleton extracted:

```js
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.HEALTH_COORDINATOR_PORT || '3034', 10);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT }));
app.get('/health/state', (_req, res) => res.json(currentState));
app.post('/signals', (req, res) => { /* ingest */ res.json({ ok: true }); });
app.post('/health/refresh', async (_req, res) => { await forceTick(); res.json(currentState); });

const server = app.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`[HealthCoordinator] listening on http://127.0.0.1:${PORT}\n`);
});

async function shutdown(signal) {
  process.stderr.write(`[HealthCoordinator] ${signal} — shutting down\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

[VERIFIED: lifted near-verbatim from `scripts/observations-api-server.mjs:231-244, 688-end`]

**Critical detail:** bind to `127.0.0.1` (not `0.0.0.0`) for the host coordinator since SPEC explicitly limits to localhost. obs-api binds 0.0.0.0 because its in-container clients hit it via host.docker.internal — but that's still mediated by Docker's bridge. For the new coordinator both host clients and container-via-host.docker.internal clients arrive at the host's loopback interface, so 127.0.0.1 is correct and tighter. **Caveat:** Docker Desktop on macOS routes `host.docker.internal` to the host's loopback (verified by the working `OBS_API_URL=http://host.docker.internal:12436`); on Linux Docker, `host.docker.internal:host-gateway` → the host's docker0 bridge IP, which is NOT 127.0.0.1. This repo's `extra_hosts: ["host.docker.internal:host-gateway"]` already covers Linux, but the coordinator must bind `0.0.0.0` to accept Linux container traffic. **Recommendation:** bind `0.0.0.0`, document the localhost expectation in code, mirror obs-api which binds 0.0.0.0 for the same reason. [CITED: docker-compose.yml:131-132 + obs-api line 688]

**`runIfMain` pattern** (`lib/utils/esm-cli.js`): used by both `health-verifier.js:2140` and `statusline-health-monitor.js:2378`. Coordinator follows:
```js
import { runIfMain } from '../lib/utils/esm-cli.js';
runIfMain(import.meta.url, () => { /* main() */ });
```

**Dashboard route layout** (`integrations/system-health-dashboard/server.js:211-219`):
```js
this.app.get('/api/health',                  this.handleHealthCheck);
this.app.get('/api/health-verifier/status',  this.cachedGet(1000, this.handleGetHealthStatus));
this.app.get('/api/health-verifier/report',  this.cachedGet(1000, this.handleGetHealthReport));
this.app.post('/api/health-verifier/verify', this.handleTriggerVerification);
this.app.post('/api/health-verifier/restart-service', this.handleRestartService);
```

D-03 keeps these same handler names; each handler body changes from `readFileSync` (currently lines 309, 480) to `fetch(process.env.HEALTH_COORDINATOR_URL + '/health/state')` and reshape to the existing JSON.

### 4. Two-session test harness (SPEC AC #5 — the headline test)

**Recommendation: bash + `curl` + `jq`** (not node:test or Jest).

**Rationale:**
- The test orchestrates *processes* (kill -9, pgrep, wait for tmux startup) — bash is the natural language.
- This repo already has bash test patterns: `tests/integration/launcher-e2e.sh` (which is the closest analog to what AC #5 needs) and `tests/test-parallel-sessions.sh`. node:test is reserved for unit-style tests like `tests/acceptance/knowledge-system-acceptance.test.js`.
- `jq` is universally available on dev macs; it's the right tool for `.lsl["sid-A"].status == "stopped"` style assertions on `/health/state` JSON.

**Session-id environment** (verified at `scripts/launch-agent-common.sh:67-76`):

```bash
SESSION_ID="${prefix}-$$-$(date +%s)"
export SESSION_ID
export "$AGENT_SESSION_VAR"="$SESSION_ID"   # e.g. CLAUDE_SESSION_ID
```

So `bin/coding` (which sources `launch-agent-common.sh`) sets BOTH `SESSION_ID` and `CLAUDE_SESSION_ID`. The test does NOT need to override them — it just needs to read them out of the spawned tmux session env, OR pre-set them in the parent shell before invoking `bin/coding`.

**Stub option for the test** (`bin/coding` is interactive — can't drive Claude non-interactively in CI). Instead spawn a minimal **mock reporter** that mimics ETM's POST signal cadence:

```bash
# tests/health-coordinator/mock-session-reporter.sh
SID="${1:?session id}"; PROJECT="${2:?project path}"
while true; do
  curl -s -X POST -H 'Content-Type: application/json' \
    -d "{\"kind\":\"lsl_heartbeat\",\"session_id\":\"$SID\",\"projectPath\":\"$PROJECT\",\"status\":\"running\",\"ts\":$(date +%s%N)}" \
    "${HEALTH_COORDINATOR_URL:-http://localhost:3034}/signals" >/dev/null
  sleep 4   # ETM polls every ~4s
done
```

The acceptance test runs two of these in `/coding`, kills one, waits 16-20s (>15s heartbeat-stale threshold), then asserts:

```bash
state=$(curl -sf http://localhost:3034/health/state)
echo "$state" | jq -e '.lsl["'"$SID_DEAD"'"].status == "stopped"' >/dev/null || exit 1
echo "$state" | jq -e '.lsl["'"$SID_LIVE"'"].status == "running"' >/dev/null || exit 1
echo "$state" | jq -e '.lsl_by_project["coding"] == "healthy"' >/dev/null || exit 1
```

This is faster, deterministic, and tests the CONTRACT (per-session keying, project rollup) without entangling with `bin/coding` interactivity. **The full end-to-end with real tmux + real Claude can be a manual verification step under `33-VERIFICATION.md`.**

### 5. Detection-latency test (SPEC AC #6 — 50 trials, P95 ≤ 10s, P99 ≤ 15s)

**Time source:** `python3 -c 'import time; print(time.time())'` works on both macOS and Linux. macOS `date +%s.%N` does NOT support `%N` (BSD date), but `gdate` (GNU coreutils, installed via Homebrew) does. **Recommendation:** use python3 — it's pre-installed everywhere this repo runs and gives microsecond resolution. [VERIFIED: `python3 -c 'import time; print(time.time())'` → `1778053349.7392387`]

**Statistical method:**

```python
python3 -c "
import sys, statistics
samples = [float(x) for x in sys.stdin.read().split()]
samples.sort()
qs = statistics.quantiles(samples, n=100)
print(f'P95={qs[94]:.3f}s P99={qs[98]:.3f}s')
"
```

[VERIFIED: `python3 -c 'import statistics; print(statistics.quantiles([1..10], n=100)[94])'` → 10.45]

`awk` percentiles work for P50/P95 but the `quantiles` API is more readable. Either is acceptable; lean python3.

**Injection method:** SPEC names `supervisorctl stop web-services:vkb-server`. Verified live:

```bash
$ docker exec coding-services supervisorctl status web-services:vkb-server
web-services:vkb-server          RUNNING   pid 98, uptime 1 day, 3:07:51
```

[VERIFIED: live execution] — the command works. Stop via:
```bash
docker exec coding-services supervisorctl stop web-services:vkb-server
# T0 = time of the above command's return
# T1 = first /health/state poll where services.vkb-server.status != 'running'
```

**Faster injection alternative:** kill a host process the coordinator polls (e.g., the obs-api process itself). But the SPEC's whole point is reading the in-container supervisord status — except CONTEXT D-08 explicitly drops in-container supervisord polling. **This is a SPEC↔CONTEXT tension** worth flagging: SPEC AC #6's `supervisorctl stop web-services:vkb-server` injection only matches a check that polls supervisorctl, but D-08 says we don't poll supervisorctl. **Resolution:** the coordinator can still inject failure via that command — but it surfaces as a Docker healthcheck unhealthy state (the vkb-server is what the `:8080/health` probe hits). When vkb-server stops, the next docker healthcheck probe (every 30s; 5 retries) eventually flips Status to unhealthy. That makes the **30s healthcheck interval the dominant cost in detection latency** — vastly larger than the 10s SLA.

**Critical recommendation:** Use a different injection. The coordinator's check set under D-08 includes (a) Docker healthcheck status, (b) database health via PSM, (c) host service liveness via PSM-tracked PIDs, (d) reporter-side signals via `POST /signals`. The **fastest deterministic injection** is to kill a host service that the coordinator's PSM-tracks (e.g., the obs-api process). PSM's `isProcessAlive()` is signal 0 — instant detection on the next 5s tick. **Plan-checker should resolve this with the user**; or use POST /signals injection (set a reporter's status to `unknown` and wait for it to surface).

### 6. `host.docker.internal` reachability

**Already wired:** `docker/docker-compose.yml:131-132` → `extra_hosts: ["host.docker.internal:host-gateway"]`. Containers already reach the host via this name (verified: `OBS_API_URL=http://host.docker.internal:12436` works in production). [VERIFIED: file lines + production usage]

**Failure mode when host coordinator is down:** `curl` from inside the container returns:
- `Connection refused` (TCP RST) — coordinator process not running
- `Connection timed out` — host firewall or coordinator hung mid-listen
- HTTP 5xx — coordinator running but errored

Tested live (with no listener on 3034):
```bash
docker exec coding-services curl -sfo /dev/null -w "%{http_code}\n" http://host.docker.internal:3034/health/state
# → 000   (curl exit non-zero, no HTTP response)
```

[VERIFIED: live test 2026-05-06]

**Implication for D-03 reverse-proxy handlers:** they must catch fetch errors and return a recognisable degraded response (NOT silently fall back to "healthy" — SPEC R6). Recommended shape for the dashboard backend's `/api/health-verifier/status` when the upstream fetch fails:

```js
res.status(503).json({
  overallStatus: 'unknown',  // NOT 'healthy'
  violationCount: 0,
  criticalCount: 0,
  lastUpdate: new Date().toISOString(),
  autoHealingActive: false,
  upstream: 'unreachable'
});
```

The `overallStatus: 'unknown'` is the key — it's the third state SPEC R6 explicitly requires.

### 7. Phase-A residue worth preserving

**Log rotation pattern** (verified at `scripts/health-verifier.js:179-184`):
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

Same pattern at `scripts/statusline-health-monitor.js:140`. **Recommendation:** factor into a tiny shared helper `lib/utils/log-rotator.js` (used by coordinator AND the converted reporters). One file, ~25 lines, no new dependency. NOT a new dependency — Node built-ins only.

**PSM Docker-VM-PID whitelist** (`scripts/process-state-manager.js:687-698`) detects when a LevelDB lock holder is `com.apple.*` / `qemu-system` / a virtualization helper and treats those as healthy (the real owner is in-container). Coordinator inherits this for free by continuing to use `psm.checkDatabaseHealth()` — it lives in PSM, not in the legacy daemons being deleted. [VERIFIED: PSM line range + CONTEXT.md ratification]

**Stale `.health/*-transcript-monitor-health.json` cleanup:** Phase A removed four files; Phase 33 obviates the file model entirely. Just ensure the cutover commit also `rm`s any remaining `.health/*-transcript-monitor-health.json` files so a stale file doesn't confuse a developer running `/gsd-verify-work`.

### 8. Constraint Monitor leak (NOT in SPEC's grep targets, but real)

**`integrations/mcp-constraint-monitor/src/dashboard-server.js:961, 1005`** independently reads:
- `.health/verification-status.json`
- `.health/verification-report.json`

This is the constraint dashboard at `:3030` (different from the system-health dashboard at `:3032`). SPEC R2's grep target list does NOT include this file — but post-cutover those files will not exist. The constraint-dashboard will silently start returning `{status: 'offline'}` for its health-verifier panel.

**Recommendation:** include a small task in the plan to make this file (`dashboard-server.js`) a **fourth migration consumer** — same pattern as the other three (single `fetch` to `host.docker.internal:3034/health/state`, reshape to existing JSON shape). This keeps the constraint dashboard working without a separate phase. Update CLAUDE.md submodule-rebuild rules apply: this is in `integrations/mcp-constraint-monitor`, which is bind-mounted (`docker/docker-compose.yml` already mounts the integration source) — verify whether `npm run build` is needed by checking the submodule's package.json `start` script, OR just rebuild the container per the standard rule. [FILE:LINE VERIFIED]

### 9. Pitfalls / failure modes the planner should encode

| Pitfall | Why it'll happen | Prevention task |
|---------|------------------|-----------------|
| Coordinator exits with EADDRINUSE on launchd respawn | Stale process holds port 3034 across cutover | First task: `lsof -i :3034` in cutover preflight; coordinator logs EADDRINUSE clearly so launchd's StandardErrorPath is diagnosable |
| `force-recreate` grep target finds matches in unrelated files | Legacy comments referencing the term | Acceptance grep is bounded to `health-remediation-actions.js scripts/health-verifier.js` — confirmed 8 hits today, all to be removed |
| Old `~/Library/LaunchAgents/com.coding.system-watchdog.plist` re-loads on next reboot | `launchctl unload` is for the current session unless `-w` is passed | Use `launchctl bootout gui/$UID ~/Library/LaunchAgents/com.coding.system-watchdog.plist && rm ~/Library/LaunchAgents/com.coding.system-watchdog.plist` (modern macOS 14+ syntax). The legacy plist's `KeepAlive=false` saves us — but better to delete the file entirely |
| ETM still writes `.health/*-transcript-monitor-health.json` after cutover | The write site at `enhanced-transcript-monitor.js:4348` and `:4402` is in `updateHealthFile()` and `cleanupHealthFile()` | Plan task replaces both call sites with `POST /signals`; deletes `getCentralizedHealthFile()` (`scripts/enhanced-transcript-monitor.js:230-240`) |
| `prompt-hook.js` returning `unknown` causes a flood of "warning" badges in legitimate offline scenarios (e.g., outside coding repo) | The current code at `:80-84` exits silently when not in coding env. SPEC R6 forbids fallback-to-healthy on EXCEPTION but doesn't forbid graceful-no-op when the env legitimately lacks the coordinator | Keep the "outside coding env → no output" branch; only the inside-coding-env path must surface `unknown`. Document this distinction in the rewrite. |
| Constraint dashboard at `:3030` silently breaks (per finding 8) | `.health/verification-status.json` no longer written | Include constraint-monitor `dashboard-server.js` as a 4th HTTP migration target in the plan |
| `host.docker.internal` 127.0.0.1 binding mistake | Coordinator binds 127.0.0.1 → Linux container readers can't reach via host-gateway | Bind `0.0.0.0` (matches obs-api). Localhost-only constraint enforced by `127.0.0.1`-explicit firewall on production hosts, not by listen address |
| 30s healthcheck interval dominates detection latency for container failures | Already in finding #5; ensure injection test does NOT use vkb-server stop | Pick injection that triggers a 5s-tick check, not a 30s docker healthcheck refresh |

### 10. PRD-style "definition of done"

Tighter "build order" view derived from SPEC's 13 acceptance criteria:

1. **Coordinator skeleton** (`scripts/health-coordinator.js`) — Express on 3034, in-memory state, 5s tick driver, three endpoints (`GET /health/state`, `POST /signals`, `POST /health/refresh`). Must exit non-zero with diagnosable log on EADDRINUSE.
2. **Plist install** (`~/Library/LaunchAgents/com.coding.health-coordinator.plist`) — KeepAlive=true, ThrottleInterval=30, RunAtLoad=true. Test: kill -9 → fresh PID within 30s.
3. **Rule-engine fold-in** — port the `enabled` rule iteration from `health-verifier.js` into the coordinator's check registry. Schema preserved (`config/health-verification-rules.json` top-level keys unchanged).
4. **Rules cleanup** — delete `bind_mount_freshness` from `config/health-verification-rules.json`, delete `refreshBindMounts()` from `health-remediation-actions.js`, remove `health-verifier` from `supervisord_status.expected_processes`, remove the `supervisord_status` rule itself per D-08.
5. **Reporter conversion** — `health-verifier.js` and `statusline-health-monitor.js` → reduce to POST /signals callers; remove auto-heal arms; keep CLI entry points.
6. **ETM signal emission** — replace `enhanced-transcript-monitor.js:4348` writeFileSync with POST /signals using `process.env.CLAUDE_SESSION_ID || process.env.SESSION_ID`. Drop `cleanupHealthFile()` write (replace with a stop-signal POST).
7. **Reader migration (4 consumers, not 3)** — health-prompt-hook.js, statusline-health-monitor.js (now reporter+reader), system-health-dashboard server.js (4 routes), **and constraint-monitor dashboard-server.js (2 routes)** — see finding #8.
8. **Compose env var** — add `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` to `coding-services.environment` in `docker/docker-compose.yml`.
9. **Cutover commit** — single git commit: stops + disables 4 legacy plists/daemons, installs new plist, lands all reader/reporter changes. Rollback path = git revert + reinstate legacy plist.
10. **Tests** — three scripted tests under `scripts/__tests__/health-coordinator/`: two-session-agreement (bash+curl+jq), detection-latency (bash + python3 quantiles, 50 trials), injection (single-shot forced exception → `unknown`).

---

## Validation Architecture

> Required because `nyquist_validation_enabled=true`. The planner uses this section to author 33-VALIDATION.md.

### Sampling Rate vs Observable Rate (Nyquist condition)

| Quantity | Rate / Period | Source |
|----------|---------------|--------|
| Coordinator tick (sample rate) | 5 s | SPEC Constraints; CONTEXT.md "5s heartbeat" |
| ETM heartbeat (signal emission) | ~4 s | `enhanced-transcript-monitor.js` polling cadence |
| SPEC SLA observable | 10 s p95 (failure → `/health/state`) | SPEC R4 |
| Docker healthcheck probe | 30 s | `docker-compose.yml:143` |
| Heartbeat staleness threshold | 15 s | CONTEXT D-10 (>15s stale → `stopped`) |

**Nyquist check:** the coordinator's 5s sampling rate is 2× faster than the 10s p95 SLA — the theorem holds for events of duration ≥ 5s. **Edge case it MISSES:** a sub-5s flap (e.g., a service that fails and recovers within 4s between two ticks). SPEC explicitly defers sub-second / event-driven detection — this miss is acceptable and documented.

The 30s Docker healthcheck cadence is the **only** signal that violates Nyquist for the 10s SLA. Per finding #5 the coordinator surfaces Docker's `Status` as-is; that field's effective sampling rate is 30s, so a real container-unhealthy event has a worst-case observable latency of ~30s + 5s = **35s** in `/health/state.container.healthcheck`. SPEC R7 says "surface as-is", so this is by design — but the test suite must NOT use container-unhealthy as the injection for the 10s p95 latency assertion.

### Edge Cases the Test Proves vs. What It Could Miss

| Test | Proves | Could miss |
|------|--------|------------|
| Two-session agreement (AC #5) | Per-session keying works; project rollup correct; eviction visible | Doesn't test 3+ sessions; doesn't test eviction-after-5min (D-10) |
| Detection latency (AC #6, 50 trials) | P95 ≤ 10s on the chosen injection path | Sub-5s flaps; cross-tick race where heartbeat arrives mid-tick |
| Injection (AC #13) | A check that throws returns `unknown`, not `healthy` | Doesn't test silent return paths in OTHER scripts (e.g., the remaining `try/catch` in PSM) |
| Two-session race timing | Heartbeats from session A and B in same tick window | Coordinator's tick is single-threaded by Node event loop — no actual race; the test is mostly cosmetic |

### Test-as-Code Assertions for the Planner

For the **two-session test** (`scripts/__tests__/health-coordinator/two-session-agreement.test.sh`):
```bash
# Setup: launch two mock reporters with distinct CLAUDE_SESSION_IDs in /coding
# Wait 7s for first ticks
[[ $(curl -sf $URL/health/state | jq -r '.lsl | length') -ge 2 ]]
[[ $(curl -sf $URL/health/state | jq -r '.lsl_by_project["coding"]') == healthy ]]
# Kill reporter A
kill -9 $A_PID
sleep 17  # > 15s staleness threshold
[[ $(curl -sf $URL/health/state | jq -r ".lsl[\"$A_SID\"].status") == stopped ]]
[[ $(curl -sf $URL/health/state | jq -r ".lsl[\"$B_SID\"].status") == running ]]
[[ $(curl -sf $URL/health/state | jq -r '.lsl_by_project["coding"]') == healthy ]]
# Verify all three readers agree:
# - dashboard at :3032/api/health-verifier/status
# - prompt-hook output
# - statusline cache file
```

For the **latency test** (`scripts/__tests__/health-coordinator/detection-latency.test.sh`):
```bash
samples=()
for i in $(seq 1 50); do
  T0=$(python3 -c 'import time; print(time.time())')
  inject_failure  # see finding #5 — pick a host-process kill, NOT supervisorctl stop
  while true; do
    state=$(curl -sf $URL/health/state)
    if echo "$state" | jq -e ".[\"$INJECTED\"].status != \"running\"" >/dev/null 2>&1; then
      T1=$(python3 -c 'import time; print(time.time())')
      samples+=( "$(python3 -c "print($T1 - $T0)")" )
      break
    fi
    sleep 0.5
  done
  restore_service
  sleep 2  # let coordinator settle
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

For the **injection test** (`scripts/__tests__/health-coordinator/injection.test.sh`):
```bash
# Set HEALTH_COORDINATOR_INJECT_THROW=db_health and bounce the coordinator
launchctl kickstart -k gui/$UID/com.coding.health-coordinator
sleep 8  # one tick + slack
result=$(curl -sf $URL/health/state | jq -r '.databases.status')
[[ "$result" == "unknown" ]]  # must NOT be 'healthy'
```

The coordinator should support an env-var injection point for testability — `HEALTH_COORDINATOR_INJECT_THROW=<check_name>` makes that check function `throw new Error('forced')`. Cleaner than monkey-patching `health-verifier.js`.

### Wave 0 Gaps

- [ ] `scripts/__tests__/health-coordinator/` directory does not exist — create it
- [ ] `lib/utils/log-rotator.js` does not exist — extract from health-verifier.js:179-188
- [ ] No bash test-helper library in this repo — but `tests/integration/launcher-e2e.sh:43-48` shows the established `run_test` pattern; reuse verbatim
- [ ] `jq` and `python3` confirmed available on dev mac; document as test prerequisites in `33-VERIFICATION.md`
- [ ] `gdate` available too (Homebrew coreutils) but not required — python3 covers timing

---

## Recommended Build Order

(Repeat of finding #10 in canonical order; the planner can lift these as task IDs.)

1. **Skeleton** — `scripts/health-coordinator.js` with the obs-api skeleton (port 3034, three endpoints, in-memory state, log rotator). Add `HEALTH_COORDINATOR_INJECT_THROW` env-var injection point now (for AC #13).
2. **Plist** — `~/Library/LaunchAgents/com.coding.health-coordinator.plist` with KeepAlive/ThrottleInterval/RunAtLoad as in finding #1.
3. **Tick + check registry** — port `health-verifier.js`'s rule iteration into coordinator's 5s tick. Drop `bind_mount_freshness`, drop `supervisord_status`, drop `health-verifier` from `expected_processes`.
4. **Reporter conversion** — `health-verifier.js` and `statusline-health-monitor.js` to reporter mode (POST /signals; auto-heal arms removed; CLI entry points kept).
5. **ETM** — replace `updateHealthFile()` and `cleanupHealthFile()` writes with POST /signals.
6. **Reader migration (×4)** — health-prompt-hook.js, statusline-health-monitor.js (reader half), system-health-dashboard/server.js (4 routes), **mcp-constraint-monitor/src/dashboard-server.js (2 routes)**.
7. **Compose env** — `HEALTH_COORDINATOR_URL=http://host.docker.internal:3034` in coding-services environment.
8. **Tests** — three scripts under `scripts/__tests__/health-coordinator/` per Validation Architecture.
9. **Cutover commit** — atomic: stop+disable+remove old plists, install new, all reader/reporter changes, all rules cleanup.
10. **Verification** — run the three tests; manual two-real-tmux-sessions verification per `33-VERIFICATION.md`.

---

## Project Constraints (from CLAUDE.md)

The planner MUST encode these in tasks affecting the listed components:

- **PlantUML/Mermaid:** if any architecture diagrams are added, use `plantuml` CLI (NOT `java -jar plantuml.jar`); invoke the `documentation-style` skill first.
- **Submodule rebuild rule** (CRITICAL — recurring failure mode): the constraint-monitor change in finding #8 touches `integrations/mcp-constraint-monitor/`. Per CLAUDE.md, after any TS source change to that submodule:
  1. `cd integrations/mcp-constraint-monitor && npm run build`
  2. `cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`
  However, if the change is to a **JavaScript** file already directly served (no TS compile step), only the Docker rebuild is needed. Plan task should grep the submodule's package.json `start`/`build` scripts to determine which case applies. The system-health-dashboard at `:3032` is bind-mounted (no Docker rebuild needed; just `npm run build` inside its directory if it has TS).
- **TypeScript discipline:** `scripts/health-coordinator.js` is plain JS (matches obs-api precedent); no TS compilation step needed. CLAUDE.md says "TypeScript mandatory with strict checking" but the existing scripts/ directory is JS-first; new coordinator follows the established pattern.
- **No bare `claude`:** Manual verification steps must use `coding --claude`, never `claude`.
- **Constraint Monitor false positives:** the `no-console-log` constraint may fire on the new coordinator. Use `process.stderr.write()` per obs-api's pattern (`scripts/observations-api-server.mjs:77, 689`) — NOT `console.log`.
- **Always plantuml CLI**, **always use `coding --claude`**, **constraint violations are real issues** — directly from CLAUDE.md.

---

## Assumptions Log

> Claims here are tagged `[ASSUMED]` in the body and not directly verified.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Docker healthcheck `Status` field is updated atomically with `Log` write — readers always see consistent values | Finding #2 | Low — even if there's a millisecond skew, the next 5s coordinator tick re-reads both atomically |
| A2 | A node child process killed by `kill -9` is reliably detected by launchd's `KeepAlive=true` (no edge case where launchd misses the SIGKILL) | Finding #1 | Very low — KeepAlive responds to `wait()` returning, which always fires for SIGKILL |
| A3 | Constraint dashboard at `:3030` is the ONLY other in-tree consumer of `.health/verification-*.json` (no other unlisted readers) | Finding #8 | Medium — fix is to widen the grep target list across `integrations/` in the cutover commit; planner task should run `grep -rE "verification-(status\|report).json" integrations/` to confirm |
| A4 | Linux Docker hosts will use `extra_hosts: ["host.docker.internal:host-gateway"]` and the coordinator binding to `0.0.0.0` is sufficient (no firewall config needed on the host's docker0 bridge interface) | Finding #3 | Low — same network topology obs-api already runs on |

---

## Open Questions

1. **Detection-latency injection target for AC #6.** SPEC says `supervisorctl stop web-services:vkb-server`, but D-08 drops in-container supervisord polling and the only path that would surface vkb-server stop in `/health/state` is the 30s Docker healthcheck. Either the SPEC's choice of injection is wrong for the new architecture, or D-08's "drop container-process supervision" needs a carve-out (keep supervisorctl polling for one specific test path). **Recommendation:** ask the user during planning. Alternative injections that match the new architecture: kill the host obs-api process; force a POST /signals with `status: 'unknown'`; or use the new `HEALTH_COORDINATOR_INJECT_THROW` env var. All three give detection latency in the 5-10s range.

2. **Constraint-monitor dashboard at :3030 in-or-out-of-scope?** SPEC says it's out of scope ("only changes are how it consumes the new SoT"). But "consumes the new SoT" means migrating its handlers (finding #8) — which is exactly the in-scope work. Recommendation: include it as a planned task; it's a tiny change (2 file reads → 2 fetch calls) and not including it leaves a silent breakage.

3. **`HEALTH_COORDINATOR_URL` default for prompt-hook running outside coding repo.** Today's prompt-hook gracefully exits when `VERIFIER_SCRIPT` doesn't exist (running outside coding repo). After the rewrite, what should it do when the env var is unset AND it's invoked from a non-coding directory? Recommendation: keep the existing graceful-exit branch, add an unset-env-var path to the same exit-0 branch. SPEC R6's "no fallback to healthy" applies to *coordinator-side* checks, not to the *consumer-side* "I'm not running in coding env" branch.

---

## Sources

### Primary (HIGH confidence)
- `man launchd.plist` (section 5), local macOS — KeepAlive, ThrottleInterval, RunAtLoad authoritative
- Live `docker inspect coding-services --format '{{json .State.Health}}'` — confirmed Status / Log / 5-entry retention
- Live `launchctl list com.coding.system-watchdog` — confirmed output dict shape (LastExitStatus, PID-when-running, Label)
- Live `docker exec coding-services supervisorctl status web-services:vkb-server` — confirmed program name and supervisorctl reachability
- Source files at exact line numbers cited throughout findings (verified)

### Secondary (MEDIUM confidence)
- moby/moby `api/types/container/container.go` Health struct — citation only, not directly fetched
- moby/moby `daemon/health.go` `handleProbeResult` — citation only

### Tertiary (LOW confidence)
- None used in this research; all critical claims verified against either local tooling or repo source

---

## Metadata

**Confidence breakdown:**
- launchd specifics: HIGH — `man launchd.plist(5)` is authoritative
- Docker healthcheck: HIGH — verified live on the actual coding-services container
- Express bootstrap: HIGH — lifted from `obs-api` source verbatim
- Test harness recommendation: HIGH — bash pattern already exists in repo (`tests/integration/launcher-e2e.sh`)
- Detection-latency injection: MEDIUM — discovered SPEC↔CONTEXT tension that planner should resolve with user
- Constraint-monitor leak: HIGH — verified at file:line in source, not in SPEC's grep targets

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days; macOS launchd and Docker healthcheck are stable; expect Express + node 22 stable)

---

## RESEARCH COMPLETE

**Phase:** 33 - health-monitoring-consolidation
**Confidence:** HIGH

### Key Findings
- `man launchd.plist` confirms KeepAlive=true respawns on any exit; ThrottleInterval default 10s, recommended 30s; RunAtLoad must be set explicitly. `launchctl unload`/`bootout` removes the job (no respawn).
- Docker healthcheck on coding-services already returns `{"Status":"healthy", "FailingStreak":0, "Log":[5 entries]}` exactly as SPEC R7 contemplates; 30s probe interval is the dominant latency source for container-level checks.
- `obs-api` (`scripts/observations-api-server.mjs`) is the exact analog for the new coordinator — same single-owner-HTTP-gateway pattern, same Express bootstrap, same `host.docker.internal` reverse access.
- ETM's session-id env vars are already wired by `bin/coding` via `scripts/launch-agent-common.sh:67-76` — no new infrastructure needed.
- **NEW LEAK FOUND:** `integrations/mcp-constraint-monitor/src/dashboard-server.js:961, 1005` reads `.health/verification-*.json` independently — not in SPEC's grep targets but will silently break post-cutover. Plan should include it as a 4th HTTP-migration consumer.
- **SPEC↔CONTEXT TENSION:** SPEC AC #6 names `supervisorctl stop web-services:vkb-server` as the latency-test injection, but D-08 drops in-container supervisord polling. The injection only flips `/health/state` after the 30s Docker healthcheck cycle — well outside the 10s p95 SLA. Planner should choose a different injection (host-process kill or test-only env-var throw); recommend confirming with user.

### File Created
`/Users/Q284340/Agentic/coding/.planning/phases/33-health-monitoring-consolidation/33-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | obs-api + Express pattern verbatim from this repo |
| Architecture | HIGH | All target file:line citations verified |
| Pitfalls | HIGH | Constraint-monitor leak verified at file:line; SPEC/CONTEXT tension flagged |

### Open Questions
1. AC #6 injection target conflict (SPEC says supervisorctl stop, D-08 drops supervisord polling)
2. Constraint-monitor :3030 in/out of scope (SPEC says out, but its handlers must change for SoT to hold)
3. Prompt-hook behavior when `HEALTH_COORDINATOR_URL` unset outside coding env

### Ready for Planning
Research complete. Planner can now create PLAN.md files; the three open questions above should be raised with the user before locking task list.
