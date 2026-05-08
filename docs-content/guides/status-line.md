# Status Line Complete Guide

Real-time visual indicators of system health and development activity rendered via the unified tmux status bar. All coding agents (Claude, CoPilot, etc.) are wrapped in tmux sessions; `status-right` invokes `combined-status-line-wrapper.js`, which reads a per-project pre-rendered cache (~60ms warm-path) and falls back to `combined-status-line.js` for full re-renders. The renderer pulls live state from the **health coordinator at :3034** (Phase 33 single source of truth, replacing the retired host-side `health-verifier` daemon and `.health/verification-status.json` file).

![Status Line Display](../images/status-line-display.png)

## Reading the Status Line

### Example Display

```
[🏥✅] [RA⚫C🟢] [🔒 77% ⚙️IMP] [📚❌] [📋18-19] 18:34
```

The current pane's project is rendered with an underline (`#[underscore]…#[nounderscore]`) so each parallel tmux window highlights its own project.

### Component Breakdown

| Component | Example | Description |
|-----------|---------|-------------|
| System Health | `[🏥✅]` | Coordinator-derived health rollup (services + databases + container) |
| Active Sessions | `[RA⚫C🟢]` | Per-project abbreviations with graduated activity icons |
| Constraint + Trajectory | `[🔒 77% ⚙️IMP]` | Code quality % and current trajectory state |
| Knowledge System | `[📚✅]` | Knowledge extraction status |
| LSL Time Window | `[📋18-19]` | Session time range (HHMM-HHMM) |
| Time | `18:34` | Local HH:MM, anchored to the right edge |

---

## Complete Emoji Reference

### System Health Indicators

The badge is derived live from the coordinator at `:3034/health/state`. There is no longer a host-side `health-verifier` daemon; the badge reflects the coordinator's rollup of probed services, database checks, and container healthcheck.

| Display | Meaning | Action |
|---------|---------|--------|
| `[🏥✅]` | All systems healthy | None needed |
| `[🏥⚠️]` | Non-critical issue (e.g. degraded service or GCM warning) | Check dashboard for details |
| `[🏥⏰]` | **Stale** — coordinator's `generated_at` >3 minutes old | Coordinator may be down; check container |
| `[🏥❌]` | Critical issue (downed service, unhealthy DB, container probe fail) | Immediate attention required |
| `[🏥💤]` | Coordinator unreachable | Verify dashboard service is running |

### Session Activity Indicators

Sessions use a **graduated color scheme** based on time since last activity. **All sessions are always displayed** — sleeping sessions show as 💤, never hidden. Sessions are only removed when the agent process exits.

| Icon | Status | Time Since Activity | Description |
|------|--------|---------------------|-------------|
| 🟢 | Active | < 5 minutes | Active session with recent activity |
| 🌲 | Cooling | 5 - 15 minutes | Session cooling down |
| 🫒 | Fading | 15 min - 1 hour | Session fading, still tracked |
| 🪨 | Dormant | 1 - 6 hours | Session dormant but alive |
| ⚫ | Inactive | 6 - 24 hours | Session inactive but tracked |
| 💤 | Sleeping | > 24 hours | Long-term dormant session |
| ❌ | Error | Any | Health check failed or service crash |

**Visual progression:**
```
🟢 Active → 🌲 Cooling → 🫒 Fading → 🪨 Dormant → ⚫ Inactive → 💤 Sleeping
   <5min      5-15min     15m-1hr     1-6hr        6-24hr       >24hr
```

!!! info "Agent Age Cap"
    When an agent process (Claude, Copilot, OpenCode) is running, the displayed age is capped at the transcript monitor's uptime. This prevents a freshly started session in a project with old transcripts from immediately showing as dormant — the session starts green and naturally progresses through the cooling scheme based on how long the current session has been idle.

!!! warning "Not-Found Transcript Guard"
    Agents that don't produce Claude-compatible transcripts (e.g., OpenCode) have `transcriptInfo.status: 'not_found'`. The age cap logic skips these sessions — they correctly display as ⚫ inactive instead of falsely showing as 🟢 active.

### Trajectory States

| Icon | State | Description |
|------|-------|-------------|
| 🔍 | EX (Exploring) | Information gathering and analysis |
| 📈 | ON (On Track) | Productive progression |
| 📉 | OFF (Off Track) | Deviating from optimal path |
| ⚙️ | IMP (Implementing) | Active code modification |
| ✅ | VER (Verifying) | Testing and validation |
| 🚫 | BLK (Blocked) | Intervention preventing action |

### Knowledge System Indicators

| Status | Icon | Meaning |
|--------|------|---------|
| Ready | `[📚✅]` | Knowledge extraction ready and operational |
| Processing | `[📚⏳]` | Actively extracting knowledge from session |
| Idle | `[📚💤]` | Operational but waiting/sleeping |
| Warning | `[📚⚠️ ⚠️N]` | Has N errors but still operational |
| Paused/Disabled | `[📚🔇 ]` | Knowledge extraction disabled in config |
| Offline | `[📚❌]` | System offline or initialization failed |

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

`combined-status-line-wrapper.js` reads a per-project pre-rendered cache to avoid the ~2-18s ESM module load on cold-start:

- Cache file: `.logs/combined-status-line-cache-<project>.txt` (one per tmux pane, keyed by `TMUX_PANE_PATH` basename)
- Cache TTL: 30 s — fresh reads serve in <100 ms
- Cold or stale: spawns the full `combined-status-line.js` (inherits stdio so its output streams to tmux)
- The wrapper preserves trailing whitespace and the NBSP terminator on cached output (see "Right-edge stability" below)

### Right-edge stability (NBSP terminator + codepoint padding)

The status-right truncation pipeline in tmux interacts with emoji widths in a way that can leave residual chars at the right edge ("12:411", "13:0656" — leftover digits from a previous, wider render). Two stacked tactics anchor the right edge:

1. **Codepoint-floor padding**: pad the rendered string to ≥ 220 codepoints (after stripping zero-width tmux `#[…]` markup). Counted via `[...s].length` (codepoints), not `s.length` (UTF-16 units). Every codepoint is at minimum 1 cell in tmux's measurement, so 220 codepoints ≥ 200 cells — comfortably above `status-right-length=200`. Tmux always truncates to exactly 200 cells, fully overwriting prior-render residue.

2. **Anti-strip terminator**: end the line with one **non-breaking space** (U+00A0). tmux's `#(shell-cmd)` substitution strips trailing ASCII whitespace before plugging into the format; without a non-ASCII-whitespace terminator the trailing-space pad would be dropped. NBSP is 1 cell, visually identical to space, but is not ASCII whitespace — the strip stops on it and the pad survives.

The combination is robust across tmux versions despite UAX#11 / VS-16 disagreements on emoji width (tmux counts ⚠️ ⚙️ as 1 cell while terminals render them as 2; predicting tmux's count exactly would mirror its internal table per version).

### Status Line Update Flow

![Status Line Hook Timing](../images/status-line-hook-timing.png)

**Cache fast-path (normal operation):**

1. **tmux status-interval**: `status-right` fires every 5 s → `combined-status-line-wrapper.js`
2. **Cache check**: read `.logs/combined-status-line-cache-<project>.txt`
3. Fresh (<30 s): pass through to tmux (preserving trailing NBSP terminator), done
4. Stale or missing: spawn `combined-status-line.js` inline

**Full refresh:**

1. **State pull**: single `GET http://localhost:3034/health/state` from the coordinator (with curl fallback if the coordinator is unreachable)
2. **Per-project activity age**: stat each `lsl[*].transcriptPath` mtime → bucket into the lifecycle (🟢 / 🌲 / 🫒 / 🪨 / ⚫ / 💤)
3. **Constraint compliance**: cached call to constraint-monitor API (port 3031)
4. **Trajectory state**: read `.specstory/trajectory/live-state.json` for the current pane's project
5. **Render**: assemble parts, pad to ≥ 220 codepoints + NBSP terminator
6. **Cache write**: save to `.logs/combined-status-line-cache-<project>.txt`

### Caching

| Data | Cache Duration |
|------|----------------|
| Pre-rendered status (fast-path) | 60s TTL, 20s background refresh |
| Health status | 5 minutes |
| Constraint compliance | 1 minute |
| Trajectory state | Read on every update |
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
- Coordinator reachable + ≥1 service `degraded` / GCM warning → Warning (⚠️)
- Coordinator reachable + critical failure (downed service, unhealthy DB, container probe fail) → Critical (❌)
- Coordinator `generated_at` >3 min old → Stale (⏰)
- Coordinator unreachable → Offline (💤)

**Session States** (graduated cooling scheme):
- Driven by `transcriptPath` mtime in coordinator state, bucketed: 🟢 (<5 m) → 🌲 (<15 m) → 🫒 (<1 h) → 🪨 (<6 h) → ⚫ (<24 h) → 💤 (≥24 h)
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
| `STATUS_LINE_TARGET_CODEPOINTS` | top of `combined-status-line.js` | 220 |
| Cache TTL | wrapper script | 30 s |
| Tmux refresh interval | `~/.tmux.conf` `status-interval` | 5 s |
| `status-right-length` | `~/.tmux.conf` | 200 |

---

## Terminal Title Broadcasting

### How It Works

Every 15 seconds, the statusline-health-monitor broadcasts status to all Claude session terminals via ANSI escape codes:

```
Terminal Tab: "C🟢 | UT🫒 CA🌲"
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

# Trajectory state exists?
ls -la .specstory/trajectory/live-state.json

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
| `.specstory/trajectory/live-state.json` | Current trajectory state for the pane's project |
| `.logs/combined-status-line-cache-<project>.txt` | Per-pane pre-rendered status cache |

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
