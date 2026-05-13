# Status Line Complete Guide

Real-time visual indicators of system health and development activity rendered via the unified tmux status bar. All coding agents (Claude, CoPilot, etc.) are wrapped in tmux sessions; `status-right` invokes `status-line-fast.cjs`, a CommonJS fast-path reader that serves a per-pane pre-rendered cache (~60 ms) and spawns the full `combined-status-line.js` (CSL) renderer only when the cache is stale. The renderer pulls live state from the **health coordinator at :3034** (Phase 33 single source of truth, replacing the retired host-side `health-verifier` daemon and `.health/verification-status.json` file). All five coordinator-derived badges share a single memoized probe per render — see [Architecture → Shared coordinator probe](#shared-coordinator-probe).

![Status Line Display](../images/status-line-display.png)

## Reading the Status Line

### Example Display

```
[🏥✅] [RA⚫C🟢] [🔒77% ⚙️IMP] [📚✅] [📋18-19] 18:34
```

The current pane's project is rendered with an underline (`#[underscore]…#[nounderscore]`) so each parallel tmux window highlights its own project.

### Component Breakdown

| Component | Example | Description |
|-----------|---------|-------------|
| System Health | `[🏥✅]` | Coordinator-derived health rollup (services + databases + container) |
| Active Sessions | `[RA⚫C🟢]` | Per-project abbreviations with graduated activity icons |
| Constraint | `[🔒77%]` | Code quality % (with optional `🟡N` violations sub-segment when non-zero) |
| Knowledge Pipeline | `[📚✅]` | Observation/digest/insight pipeline freshness |
| LSL Time Window | `[📋18-19]` | Session time range (HHMM-HHMM) |
| Time | `18:34` | Local HH:MM, anchored to the right edge |

---

## Complete Emoji Reference

### System Health Indicators

The badge is derived live from the coordinator at `:3034/health/state`. There is no longer a host-side `health-verifier` daemon; the badge reflects the coordinator's rollup of probed services, database checks, and container healthcheck.

| Display | Meaning | Action |
|---------|---------|--------|
| `[🏥✅]` | All systems healthy | None needed |
| `[🏥🟡]` | Non-critical issue (e.g. degraded service or GCM warning) | Check dashboard for details |
| `[🏥⏰]` | **Stale** — coordinator's `generated_at` >3 minutes old | Coordinator may be down; check container |
| `[🏥❌]` | Critical issue (downed service, unhealthy DB, container probe fail) | Immediate attention required |
| `[🏥💤]` | Coordinator unreachable | Verify dashboard service is running |

### Session Activity Indicators

Sessions use a **graduated color scheme** based on time since last activity. **All sessions are always displayed** — sleeping sessions show as 💤, never hidden. Sessions are only removed when the agent process exits.

The "time since last activity" signal is the project's Claude `.jsonl` transcript mtime — i.e., the time of the last *prompt boundary*. A long-running agent turn (one prompt that takes 25 minutes) writes nothing to the transcript while it's in flight, so a project actively being worked on by an agent looks idle by mtime alone. To capture that, a **heartbeat promotion** rule overrides the transcript-derived band: if the project's ETM heartbeat (`state.lsl[*].lastBeat`) is fresh (< 5 min) and the transcript-derived icon would be anything other than 🟢, the icon is promoted to 🟢. The heartbeat is the canonical "agent/user is here right now" signal. The promotion also handles non-Claude sessions (OpenCode / Copilot) whose `transcriptPath` is not a real file — pure transcript-mtime logic would mis-bucket them.

| Icon | Status | Time Since Activity | Description |
|------|--------|---------------------|-------------|
| 🟢 | Active | < 5 minutes | Active session with recent activity |
| 🟠 | Cooling | 5 - 30 minutes | Session cooling down |
| 🟤 | Fading | 30 min - 6 hours | Session fading, still tracked |
| ⚫ | Inactive | 6 - 24 hours | Session inactive but tracked |
| 💤 | Sleeping | > 24 hours | Long-term dormant session |
| ❌ | Error | Any | Health check failed or service crash |

**Visual progression:** circles fade green → orange → brown → black, then 💤 once the session has been idle over a day.
```
🟢 Active → 🟠 Cooling → 🟤 Fading → ⚫ Inactive → 💤 Sleeping
   <5min      5-30min     30m-6hr     6-24hr       >24hr
```

!!! note "Color choice rationale"
    🟡 (yellow) and 🔴 (red) are intentionally omitted from the lifecycle — they are reserved as health-state indicators (warning / critical) in the `[🏥]`, `[LSL]`, `[📚]` and `[🧠]` badges. Lifecycle icons must be distinguishable from health icons at a glance, so the lifecycle uses green → orange → brown → black exclusively.

!!! info "Agent Age Cap"
    When an agent process (Claude, Copilot, OpenCode) is running, the displayed age is capped at the transcript monitor's uptime. This prevents a freshly started session in a project with old transcripts from immediately showing as dormant — the session starts green and naturally progresses through the cooling scheme based on how long the current session has been idle.

!!! warning "Not-Found Transcript Guard"
    Agents that don't produce Claude-compatible transcripts (e.g., OpenCode) have `transcriptInfo.status: 'not_found'`. The age cap logic skips these sessions — they correctly display as ⚫ inactive instead of falsely showing as 🟢 active.

### Knowledge Pipeline Indicators

The badge reflects the freshness of the **observation → digest → insight** pipeline (the `obs_api` service backed by `.observations/observations.db`). Verdict is driven by *observation* freshness only — digest and insight cadences are intentionally slower and don't gate the badge. Source: `state.knowledge_pipeline` at the coordinator's `/health/state` (populated by `pollKnowledgePipeline`, which calls `obs_api`'s `/api/consolidation/status`).

| Status | Icon | Meaning |
|--------|------|---------|
| Healthy | `[📚✅]` | Last observation written within 15 minutes — pipeline is ingesting |
| Stale | `[📚🟡]` | Last observation 15 min – 6 h ago AND a Claude session is actively heartbeating — anomalous |
| Stalled | `[📚🔴]` | Last observation > 6 h ago AND a Claude session is actively heartbeating — pipeline appears dead |
| **Idle** | **`[📚⚫]`** | **No Claude session heartbeating in the last 5 min — "no recent observations" is expected, not anomalous** |
| Disabled | `[📚🔇]` | obs_api reachable but no rows in any pipeline table |
| Unknown | `[📚❓]` | Coordinator just started, slice not yet populated |
| Unreachable | `[📚❌]` | obs_api unreachable, returning non-OK, or returning unparseable JSON |

**Idle suppression** is applied via `CombinedStatusLine.isUserActive()`, which checks `state.lsl` for any session whose `lastBeat` is within 5 min. When no session is heartbeating, the freshness-derived warnings (`stale`, `stalled`) collapse to a single `⚫` (idle) — the same rule applies to the proxy badge (`degraded`, `cooling` → `[🧠⚫]`). True error states (`disabled`, `unknown`, `unreachable`) are NOT suppressed.

Tooltip details (visible in the verbose status output) include observation/digest/insight ages, totals, and any in-flight consolidation.

### Coordinator Health Endpoint

The statusline pulls all health-related signals live from the coordinator. Inspect raw state with:

```bash
curl -fs http://localhost:3034/health/state | jq .
```

| Top-level key | Meaning |
|--------------|---------|
| `container.healthcheck` | Docker `coding-services` container probe result |
| `services` | List of probed services with `status`, `last_seen`, `latency_ms`, `probe_error` |
| `databases` | LevelDB / Qdrant / Memgraph availability + lock state |
| `lsl` | Per-session ETM heartbeats (sessionId, projectName, transcriptPath, lastBeat) |
| `lsl_by_project` | 3-state rollup per project: `healthy` / `degraded` / `stopped` |
| `processes` | Stale-PID / uptime / CPU / memory / zombie checks |
| `files` | Disk space, log file size, services-running file freshness |
| `generated_at` | Coordinator's last refresh — drives the `[🏥⏰]` staleness check |

Phase 33 retired the `.logs/statusline-health-status.txt` rollup and the `.health/verification-status.json` file; do not write or read those paths in new code.

### Transcript Discovery Auto-Heal

The ETM (`enhanced-transcript-monitor.js`) detects **broken transcript discovery** — monitor running but unable to locate its project's transcript JSONL.

- **Detection**: ETM heartbeat reports `transcriptPath: null` while uptime exceeds the discovery grace period
- **Remediation**: ETM exits with non-zero status; the launcher / supervisor restarts it
- **Display**: Project rolls up as `degraded`, surfaces as `🟡` in the sessions block
- **Path encoding**: Claude Code replaces both `/` and `_` with `-` (e.g. `/_work/` → `--work-`)

---

## Architecture

### 6-Layer Health System

![Health System Classes](../images/health-system-classes.png)

The StatusLineHealthMonitor (Layer 4) aggregates health from all other layers and outputs to the Combined Status Line display.

![StatusLine Architecture](../images/statusline-architecture.png)

### Tmux-Based Rendering

All coding agents are wrapped in tmux sessions via `scripts/tmux-session-wrapper.sh`. The wrapper:

- Creates a tmux session named `coding-{agent}-{PID}`
- Configures `status-right` to invoke `status-line-fast.cjs` (CJS fast-path cache reader, ~60ms)
- Handles nesting guard (reuses existing tmux if already inside one)
- Propagates environment variables (`CODING_REPO`, `SESSION_ID`, etc.)
- Enables mouse forwarding for terminal interaction

This replaces the previous approach of using agent-specific status bar APIs (e.g., Claude's `statusLine` config), providing a unified rendering target that works identically for all agents.

### Cache Fast-Path

`status-line-fast.cjs` is the primary entry point invoked by tmux `status-right`. It's a CommonJS reader (no ESM module-load penalty under load) that serves the per-pane pre-rendered cache in ~60 ms:

- Cache file: `.logs/combined-status-line-cache-<project>-w<paneWidth>.txt` (one per (project, pane-width) tuple — width key prevents cross-pane contamination)
- Cache TTL: 60 s in fast.cjs (a separate 30 s TTL inside CSL itself when CSL re-enters via its own cache check)
- Fresh (<60 s): serves immediately, optionally patches lifecycle icons against current transcript mtimes, triggers background refresh if cache >20 s old or transcript activity is newer than cache
- Stale or missing: spawns the full `combined-status-line.js` synchronously
- **Critical detail**: fast.cjs calls `child.stdin.end()` immediately after spawning CSL. CSL's `readStdinInput()` (used by `getRedirectStatus()`) iterates over `process.stdin` and would otherwise hang the full 8 s SYS:TIMEOUT window waiting for EOF on any pane whose `TRANSCRIPT_SOURCE_PROJECT` falls outside the coding repo.
- `combined-status-line-wrapper.js` is retained as a backup but is no longer the primary path.

### Shared coordinator probe

Every render needs five different slices of `state` from the health coordinator (`knowledge_pipeline`, `proxy`, `services` rollup, `lsl_by_project`, generated_at staleness). Each was previously a separate synchronous probe via `execSync('curl …')`; five identical localhost HTTP calls per render added up to ~3 s under load and tripped the 8 s SYS:TIMEOUT during tmux refresh bursts.

The renderer now exposes a single `getCoordinatorState()` method memoized on the `CombinedStatusLine` instance (one instance per render):

- Uses native `fetch` instead of `execSync(curl)` to skip subprocess-spawn overhead
- 1.5 s per-attempt budget with one retry (150 ms gap)
- All five `getXxxStatus()` methods await the shared result; one HTTP call serves the whole render
- A single transient slow response no longer cascades every coordinator-derived badge (`🏥` `LSL` `📚` `🧠`) to its unreachable state simultaneously

### Right-edge stability (cell-width consistency)

The recurring trailing-digit residue at the right edge (`07:538`, `12:411`, `07:158`) traces to disagreement between the script's `visibleCellWidth()`, tmux's wcwidth, and the rendered font glyph. The fix is to only emit codepoints where all three measurements agree:

- **Warning states use `🟡` (U+1F7E1, EAW=Wide), not `⚠️` (U+26A0 + U+FE0F, EAW=Ambiguous).** Earlier attempts to "promote" `⚠️` to 2 cells via a VS16 lookahead in `visibleCellWidth()` matched the font glyph width but disagreed with tmux's wcwidth (which doesn't honor VS16 for Ambiguous codepoints in non-CJK locales). The disagreement left 1 cell of the previous render exposed on every transition that involved `⚠️`, and the font glyph visibly overlapped the closing `]`. The VS16 lookahead logic is retained for the `⚠️ SYS:TIMEOUT` / `SYS:ERR` fallback markers — error visibility there outweighs cell-perfect padding.
- Padding is **leading-spaces only** to TMUX_PANE_WIDTH (or 200 if unset). Trailing characters get stripped by tmux's `#(shell-cmd)` substitution, so any trailing terminator (NBSP, space, etc.) doesn't survive the round-trip.
- The earlier NBSP-terminator + 220-codepoint approach has been retired in favour of correct per-codepoint cell counting.

### Status Line Update Flow

![Status Line Hook Timing](../images/status-line-hook-timing.png)

**Cache fast-path (normal operation):**

1. **tmux status-interval**: `status-right` fires every 5 s → `status-line-fast.cjs`
2. **Cache check**: read `.logs/combined-status-line-cache-<project>-w<paneWidth>.txt`
3. Fresh (<30 s): pass through to tmux (with lifecycle-icon patching against current transcript mtimes), trigger background refresh if cache age >10 s or any tracked transcript is newer than cache
4. Stale or missing: spawn `combined-status-line.js` synchronously and `child.stdin.end()` immediately so CSL's `readStdinInput()` doesn't hang waiting for EOF

**Full refresh:**

1. **Shared coordinator probe**: a single memoized `fetch(:3034/health/state)` per render (with one retry @ 1.5 s) feeds five `getXxxStatus()` methods — replaces the previous pattern of 5 independent `execSync(curl)` calls per render
2. **Per-project activity age**: stat each `lsl[*].transcriptPath` mtime → bucket into the lifecycle (🟢 / 🟠 / 🟤 / ⚫ / 💤). A fresh ETM heartbeat (< 5 min) promotes a non-Active band to 🟢 (captures long-running agent turns and non-Claude sessions).
3. **Constraint compliance**: separate call to constraint-monitor API (port 3031)
4. **Render**: assemble parts, pad to paneWidth cells via `leftPadToStableCellWidth()` using VS16-aware `visibleCellWidth()` — see [Right-edge stability](#right-edge-stability-vs16-aware-cell-counting) above
5. **Cache write**: save to `.logs/combined-status-line-cache-<project>-w<paneWidth>.txt`
6. **Failure logging**: any 8 s SYS:TIMEOUT or fast.cjs spawn failure appends a JSON record to `.logs/csl-failures.jsonl` with per-step timings so future Claude sessions can see which sub-step blocked

### Caching

| Data | Cache Duration |
|------|----------------|
| Pre-rendered status (fast-path) | 60s TTL, 20s background refresh |
| Health status | 5 minutes |
| Constraint compliance | 1 minute |
| LSL status | Read on every update |

### Spawn Storm Prevention

The supervision architecture includes guards to prevent runaway process spawning:

| Guard | Component | Mechanism |
|-------|-----------|-----------|
| GPS heartbeat gate | CombinedStatusLine | ensure* functions skip when GPS heartbeat <60s old |
| OS-level dup check | GlobalServiceCoordinator | `findRunningProcessesByScript()` before every spawn |
| Orphan kill | GlobalServiceCoordinator | Kills spawned process if post-spawn health check fails |
| Cooldown | GPS (5min), Coordinator (2min) | Per-service cooldown between restart attempts |
| Rate limiting | GPS (10/hr), Coordinator (6/hr) | Maximum restarts per service per hour |
| OS-level re-registration | GlobalProcessSupervisor | Re-registers alive services instead of respawning |

---

## Service Lifecycle States

![Service Lifecycle State](../images/service-lifecycle-state.png)

### State Transitions

**Health States** (for `[🏥...]` indicator):
- Coordinator reachable + 0 critical issues → Healthy (✅)
- Coordinator reachable + ≥1 service `degraded` / GCM warning → Warning (🟡)
- Coordinator reachable + critical failure (downed service, unhealthy DB, container probe fail) → Critical (❌)
- Coordinator `generated_at` >3 min old → Stale (⏰)
- Coordinator unreachable → Offline (💤)

**Session States** (graduated cooling scheme):
- Driven by `transcriptPath` mtime in coordinator state, bucketed: 🟢 (<5 m) → 🟠 (<30 m) → 🟤 (<6 h) → ⚫ (<24 h) → 💤 (≥24 h)
- **Heartbeat-promotion override:** if `lsl[*].lastBeat` is < 5 min, any non-🟢 band is overridden to 🟢. Captures long-running agent turns (one prompt that takes >5 min) and non-Claude sessions whose `transcriptPath` is not a real file
- Sessions only removed when the project's ETM stops heartbeating, never hidden while alive

---

## Session Discovery

### Discovery Methods

1. **Running Monitor Detection**: Checks `ps aux` for running `enhanced-transcript-monitor.js` processes
2. **Agent Process Detection**: Scans for `claude`, `copilot`, and `opencode` processes via `ps -eo pid,comm` and resolves project from working directory via `lsof`
3. **Registry-based Discovery**: Uses Global LSL Registry for registered sessions
4. **Dynamic Discovery**: Scans Claude transcript directories for unregistered sessions
5. **Health File Validation**: Uses centralized health files from `.health/` directory

### Key Behavior

- Sessions with a **running agent process** use age capped at monitor uptime (graduated cooling from session start)
- Sessions with running transcript monitors but no active agent use transcript-based activity icons
- Sessions are **only removed** when the agent process has exited — never hidden
- The Global Process Supervisor automatically restarts dead monitors within 30 seconds

### Multi-Agent Support

| Agent | Binary | Detection Method |
|-------|--------|-----------------|
| Claude | `claude` | Exact match on `ps -eo comm` |
| Copilot | `copilot` | Path-ending match `/copilot$` |
| OpenCode | `opencode` | Path-ending match `/opencode$` |

New agents can be added to the detection loop in `statusline-health-monitor.js` → `getRunningAgentSessions()`.

### Smart Abbreviation Engine

Project names are automatically abbreviated:

| Project Name | Abbreviation |
|--------------|--------------|
| coding | C |
| curriculum-alignment | CA |
| nano-degree | ND |
| project-management | PM |
| user-interface | UI |

**Algorithm Handles:**
- Single words: First letter (coding → C)
- Hyphenated words: First letter of each part (curriculum-alignment → CA)
- Camel case: Capital letters (projectManagement → PM)

---

## Configuration

### Status Line Configuration

The renderer reads a small set of environment variables and the coordinator endpoint; legacy `config/status-line-config.json` `health_source` / `lsl_registry` keys are no longer consulted.

| Env var | Purpose | Default |
|---------|---------|---------|
| `HEALTH_COORDINATOR_URL` | Coordinator base URL | `http://localhost:3034` |
| `TMUX_PANE_PATH` | Per-pane current path (set by tmux) | — |
| `TRANSCRIPT_SOURCE_PROJECT` | Override project path resolution | — |
| `CODING_REPO` | Repo root for cache file location | script's `__dirname/..` |
| `CLAUDE_SESSION_ID` / `SESSION_ID` | Session identifier for per-pane lookups | — |

| Tunable | Where | Default |
|---------|-------|---------|
| Cache TTL (fast-path) | `status-line-fast.cjs` `CACHE_TTL_MS` | 30 s |
| Background refresh threshold | `status-line-fast.cjs` `BG_REFRESH_THRESHOLD_MS` | 10 s |
| Tmux refresh interval | `~/.tmux.conf` `status-interval` | 5 s |
| `status-right-length` | `~/.tmux.conf` | 200 |
| `codepoint-widths` | `~/.tmux.conf` | `U+26A0=2,U+FE0F=0` |

**`codepoint-widths` is required** for residue-free rendering: tmux's default wcwidth disagrees with xterm.js on `⚠` (U+26A0) and `U+FE0F` (VS16). The override anchors tmux's count to what xterm.js renders. If you see trailing-digit residue after badge transitions, this is the first thing to check.

---

## Terminal Title Broadcasting

### How It Works

Every 15 seconds, the statusline-health-monitor broadcasts status to all Claude session terminals via ANSI escape codes:

```
Terminal Tab: "C🟢 | UT🟤 CA🟠"
              ↑          ↑
        Current     Other active sessions
        project     (all sessions shown)
```

### Terminal Compatibility

| Terminal | Status | Notes |
|----------|--------|-------|
| iTerm2 | ✅ Works | Full OSC 0 support |
| Terminal.app | ✅ Works | Native macOS terminal |
| VS Code Terminal | ❌ Limited | Does not process OSC 0 from external TTY writes |
| tmux | ✅ Works | Primary rendering target — all agents run inside tmux |

---

## Troubleshooting

### Status bar completely blank?

```bash
# Check cache file freshness
ls -la .logs/combined-status-line-cache.txt

# Test fast-path directly (should complete in <100ms)
time node scripts/status-line-fast.cjs

# Force full refresh
node scripts/combined-status-line.js

# Check for process spawn storm (should be <80 Node processes)
ps aux | grep node | wc -l

# If >100 processes, kill the coordinator and let GPS restart cleanly
ps aux | grep global-service-coordinator | grep -v grep
```

### Status line not updating?

```bash
# Check the coordinator (Phase 33 SoT)
curl -fs http://localhost:3034/health/state | jq '.generated_at, .lsl_by_project'

# Trigger an explicit one-shot verifier run (writes a verify_run signal to coordinator)
node scripts/health-verifier.js verify

# Force a fresh render (clears the per-project cache)
rm -f .logs/combined-status-line-cache-*.txt
node scripts/combined-status-line.js
```

Note: there is no longer a host-side `health-verifier` daemon. `verify`, `status`, and `report` are the only supported subcommands; `start` was removed in plan 33-04 when the coordinator at :3034 took over lifecycle. If you still see a `monitoring:health-verifier STOPPED` line on the dashboard, your supervisord config is pre-Phase-33 — the program block was retired alongside `browser-access`.

### Wrong project showing as active?

```bash
# Check LSL registry
cat .lsl/global-registry.json | jq '.'

# Verify activity timestamps
cat .lsl/global-registry.json | jq '.sessions[] | {project, last_activity}'
```

### Session not showing that should be?

```bash
# Check if agent process is detected (claude, copilot, opencode)
ps -eo pid,comm | awk '/claude$|copilot$|opencode$/ {print}'

# Check if the agent's cwd resolves to the right project
lsof -p <PID> 2>/dev/null | grep cwd

# Check if transcript monitor is running for that project
ps aux | grep enhanced-transcript-monitor | grep PROJECT_NAME

# Sessions show if: agent process running OR transcript monitor running
```

### Right edge shows residual chars (e.g. `12:411`, `13:0656`)?

This was the symptom of two stacked bugs that have been fixed; if you still see it, your installed code is pre-Phase-33 or pre-`914c69423`. Verify:

```bash
# Wrapper preserves trailing whitespace (must NOT do .trim())
grep -n 'rstrip\|trim()' scripts/combined-status-line-wrapper.js

# Producer pads to 220 codepoints + NBSP terminator
grep -n 'STATUS_LINE_TARGET_CODEPOINTS\|ANTI_STRIP_TERMINATOR' scripts/combined-status-line.js

# Cache file ends with NBSP (UTF-8 c2 a0)
xxd .logs/combined-status-line-cache-coding.txt | tail -1
# Expect the last 2 non-newline bytes to be: c2 a0
```

---

## Key Files

**Core System:**

| File | Purpose |
|------|---------|
| `scripts/tmux-session-wrapper.sh` | Wraps all agents in a tmux session with unified status bar |
| `scripts/combined-status-line-wrapper.js` | Cache fast-path reader invoked by tmux `status-right` |
| `scripts/combined-status-line.js` | Full status line renderer; writes per-project cache |
| `scripts/health-coordinator.js` | Phase 33 SoT — collects signals at :3034, exposes `/health/state` |
| `scripts/health-verifier.js` | Reporter-mode CLI: `verify`, `status`, `report` (no daemon) |
| `scripts/enhanced-transcript-monitor.js` | Per-project ETM; POSTs `lsl_heartbeat` signals to coordinator |
| `.logs/combined-status-line-cache-<project>-w<paneWidth>.txt` | Per-(pane, width) pre-rendered status cache |

**Retired (do not write/read):**

| File | Replaced by |
|------|-------------|
| `.health/verification-status.json` | Coordinator `/health/state` |
| `.logs/statusline-health-status.txt` | Coordinator `/health/state` (sessions block) |
| `.lsl/global-registry.json` | Coordinator `lsl` map |
| `[program:health-verifier]` supervisord block | Removed in 33-04 — `start` subcommand no longer exists |
| `[program:browser-access]` supervisord block | Removed; replaced by Playwright-via-CLI (`/gsd-browser`) |

**Configuration:**

| File | Purpose |
|------|---------|
| `~/.tmux.conf` | `status-right-length`, `status-interval`, `status-right` invocation |
| `config/live-logging-config.json` | Provider config |
