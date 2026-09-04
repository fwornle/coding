# Status Line System

> **Phase 33 architecture (current).** This document describes the historical multi-layer rendering pipeline. The current model is documented in [`docs-content/guides/status-line.md`](../../docs-content/guides/status-line.md). Key changes since this doc was last fully reviewed:
>
> - The `[🐳MCP:...]` Docker MCP block has been removed from the rendered output.
> - The `[🏥...]` health badge reads live from the coordinator at `:3034/health/state`; the `.health/verification-status.json` file is no longer written.
> - Per-pane LSL status comes from the coordinator's `lsl_by_project` rollup + `lsl[*].transcriptPath` mtime; the `.logs/statusline-health-status.txt` file is no longer written.
> - The right edge is anchored with codepoint-floor padding (≥220 codepoints, after stripping zero-width tmux markup) plus a non-breaking-space terminator (U+00A0) to survive tmux's `#(shell-cmd)` trailing-whitespace strip.
> - The graduated cooling lifecycle (a single `●` ramped colour41 → colour34 → colour28 → colour22 → colour238) is preserved and is now driven by the newest timestamped record in `lsl[*].transcriptPath` — NOT its mtime, instead of in-memory monitor state.
> - `[program:health-verifier]` and `[program:browser-access]` supervisord blocks are gone.
> - Two routing counters were added, both read from the coordinator and neither colouring the bar: `[D:]` (turns the prompt classifier moved to a cheaper band) and `[L:]` (completions served on hardware we own, hidden at zero). They are **not** the same set — see the published guide.

Real-time visual indicators of system health and development activity, rendered in the **tmux status bar** for all coding agents (Claude Code, CoPilot, and future agents).

## Tmux-Based Rendering

All agents are wrapped in tmux sessions via the shared `scripts/tmux-session-wrapper.sh`. The status line is rendered using tmux's `status-right` directive, which invokes `scripts/status-line-fast.cjs` every 5 seconds. This CJS (CommonJS) fast-path reads a pre-rendered cache file in ~60ms, eliminating the 2-18 second ESM module loading penalty that occurs under system load. When the cache is stale, it triggers a background refresh via `combined-status-line.js`.

**Key benefits:**
- Unified rendering across all agents (no agent-specific status line code)
- Full support for tmux formatting codes (underline, bold, colors)
- Consistent status bar positioning at the bottom of the terminal
- Mouse support forwarded to the agent running inside tmux
- Ultra-fast cache-based rendering (~60ms) — never blanks under load

## What It Shows

The Status Line provides a **compact, real-time view** of all system activity across multiple coding agent sessions.

![Status Line Display](../images/status-line-display.png)

### Example Display

**Native Mode:**
```
[🏥●] [Gq$0FEB A$0 O$0 X$25] [C● UT●] [🔒67% 🔍EX] [📚●] ████░░░░░░  42% 📋17-18
```

**Docker Mode:**
```
[🐳] [🐳MCP:SA✅CM✅GF✅] [🏥●] [C● UT●] [🔒67% 🔍EX] [📚●] 📋17-18
```

### Reading the Status Line

**Format**: `[🐳] [🐳MCP:health] [🏥 health] [sessions] [LSL health] [🔒compliance] [📚 knowledge] <context gauge> 📋time`

**Components**:
- `[🐳]` - **Docker Mode**: Indicator that system is running in Docker mode (only shown in Docker mode)
- `[🐳MCP:SA✅CM✅GF✅]` - **Docker MCP Health**: Health of containerized MCP SSE servers (Docker mode only)
- `[🏥●]` green - **System Health**: Unified health (infrastructure + services)
- `[C● UT●]` - **Active Sessions**: Project abbreviations with activity icons
- `🔒67%` - **Constraint Compliance**: Code quality compliance percentage (with optional `●N` (amber) violations sub-segment when non-zero)
- `[📚●]` green - **Knowledge Pipeline**: Observation/digest/insight pipeline freshness — driven by observation write age (healthy <15 min · stale 15 min–6 h · stalled >6 h · disabled empty · unreachable obs_api down). Source: `state.knowledge_pipeline` at `:3034/health/state`.
- `[LSL●]` - **LSL Health**: Whether an ETM is watching THIS pane's project. Hidden when healthy; grey = starting (session < 60 s old), bold amber = degraded or stale, bold red = stopped or absent.
- `████░░░░░░  42%` - **Context Window Gauge**: How full this pane's agent conversation is — all four agents, not just Claude.
- `📋17-18` - **LSL Time Window**: Session time range (HHMM-HHMM)

### Internal Health Status (Raw Output)

The statusline-health-monitor writes detailed health to `.logs/statusline-health-status.txt`:

```
[GCM:✅] [Sessions: C:🟢] [Guards:✅] [DB:✅] [VKB:✅] [Dash:✅]
```

**Internal Components**:
| Label | Ports | Service | Description |
|-------|-------|---------|-------------|
| `GCM` | - | Global Process Supervisor | Session coordinator and auto-restart |
| `Sessions` | - | Transcript Monitors | Per-project Claude session health |
| `Guards` | 3030/3031 | Constraint Monitor | Dashboard and API for code quality |
| `DB` | - | Databases | LevelDB, SQLite, Qdrant (+ graphify graph freshness) |
| `VKB` | 8080 | Knowledge Visualization | Graph visualization server |
| `Dash` | 3032/3033 | System Health Dashboard | UI and API for health monitoring |

**Icons**: all states are a one-cell `●` tinted by tmux — green healthy (`colour41`), **bold** amber warning (`colour214,bold`, with reason), **bold** red unhealthy (`colour196,bold`, with reason). `❓` unknown stays a pictogram: it says *why* there is no verdict, which a severity colour cannot express.

### Docker Mode Indicator

When running in Docker mode, the status line displays additional indicators for containerized services.

**Docker Mode Detection:**
Docker mode is detected when:
- The `.docker-mode` marker file exists in the coding repository
- OR the `CODING_DOCKER_MODE=true` environment variable is set

**Docker MCP Health Display** (`[🐳MCP:...]`):

| Abbreviation | Service | Port | Health Check |
|--------------|---------|------|--------------|
| `SA` | Semantic Analysis | 3848 | `http://localhost:3848/health` |
| `CM` | Constraint Monitor | 3849 | `http://localhost:3849/health` |
| `GF` | Graphify | 3851 | `http://localhost:3851/mcp` |

**Status Icons:**
- `✅` - Service healthy and responding
- `❌` - Service down or not responding
- `⚠️` - Service responding but with issues

**Examples:**
- `[🐳MCP:SA✅CM✅GF✅]` - All Docker MCP services healthy
- `[🐳MCP:SA✅CM❌GF✅]` - Constraint Monitor is down
- `[🐳MCP:SA⚠️CM✅GF✅]` - Semantic Analysis has issues

### Unified Health Status Indicator

The `[🏥...]` section shows **unified system health** combining:
- **GCM (Global Coding Monitor)**: Session coordinator health
- **Health Verifier**: Service, database, and process health
- **Constraint Enforcement**: Whether constraints are actively enforced

| Display | Meaning | Action |
|---------|---------|--------|
| `[🏥●]` green | All systems healthy | None needed |
| `[🏥●]` amber | Issues detected | Check dashboard for details |
| `[🏥⏰]` | **Stale** - verification data >2 minutes old | Health verifier may have crashed |
| `[🏥●]` red | Critical issues or error | Immediate attention required |
| `[🏥●]` grey | Health verifier offline | Start health verifier |

**Note**: Violation counts are no longer shown in the status line. Details are available on the health dashboard at http://localhost:3033.

**Common Causes of `[🏥●]` amber (Issues)**:
- Constraint enforcement disabled
- Service health check failures
- Database connectivity issues
- Stale PIDs in process registry

**To Fix Issues**:
```bash
# Check health details
node scripts/health-verifier.js status

# Manually trigger verification with auto-heal
node scripts/health-verifier.js --auto-heal

# Or restart all services
coding --restart-services
```

The health verifier runs every 60 seconds with auto-healing enabled.

### Transcript Discovery Auto-Heal

The statusline-health-monitor detects **broken transcript monitors** — monitors that are running but cannot find their project's Claude JSONL transcript file (e.g., due to path encoding mismatches).

**Detection**: If a monitor has been running >2 minutes with `transcriptPath: null`, the health monitor identifies it as a broken state.

**Remediation**: The broken monitor is killed via `SIGTERM`. The Global Process Supervisor automatically restarts it, picking up any fixes to the transcript discovery logic.

**Status Line**: Affected sessions show a bold amber `●` (`ALARM_DOTS.WARN`) with "Transcript discovery failed — restarting monitor" instead of silently disappearing.

**Path Encoding**: Claude Code encodes project paths by replacing both `/` and `_` with `-`. For example, `/Users/foo/Agentic/_work/my-project` becomes `-Users-foo-Agentic--work-my-project`. The transcript monitor's `getProjectDirName()` must match this encoding exactly.

### LSL Status Indicators

**Color Coding** (thresholds are MINUTES, not hours — `calculateTimeRemaining()`):
- *no dot* - Window open, more than 5 minutes remaining (the common case; the badge is just the range)
- ● bold amber - Window closing soon, 5 minutes or less remaining (`ALARM_DOTS.WARN`)
- ● bold red - Window closed or expired (`ALARM_DOTS.CRIT`)

**Format**: `HHMM-HHMM`, gaining a leading dot and `(Xmin)` only in the closing window:
- `HHMM-HHMM` - Session time window
- `(Xmin)` - Minutes since last activity
- `→project` - Project with activity

### LSL Health Badge

Distinct from the time window above: `[LSL●]` reports whether an enhanced-transcript-monitor
(ETM) is actually watching **this pane's** project. `getLSLHealthStatus()` resolves it
per-pane, then per-project, from `state.lsl` at `:3034/health/state`.

| Verdict | Badge | Condition |
|---------|-------|-----------|
| `healthy` | *(hidden)* | A heartbeat for this project within 120 s |
| `starting` | `[LSL●]` grey (`STATE_DOTS.IDLE`) | No entry yet AND this tmux session is < 60 s old |
| `stale` | `[LSL●]` bold amber (`ALARM_DOTS.WARN`) | ETM `degraded` (0 exchanges in > 30 min uptime), or heartbeat > 120 s old |
| `down` | `[LSL●]` bold red (`ALARM_DOTS.CRIT`) | ETM stopped, coordinator unreachable, or no entry and the session is not new |

**Why `starting` exists.** `reapEtmsForClosedSessions()` kills a project's ETM within one
5 s tick when its tmux session closes, but the respawn came only from
`ensureEtmForActiveProjects()`, rate-limited by `ETM_SPAWN_INTERVAL_MS = 30_000`. Every
newly opened session therefore showed red for up to thirty seconds — accurately, because
nothing was logging it yet.

Both halves are fixed:

- `scripts/tmux-session-wrapper.sh` POSTs an `etm_ensure` signal to the coordinator at
  launch. A targeted request bypasses the 30 s gate and the startup grace for that one
  project, does **not** advance the shared rate-limit clock (a burst of launches must not
  postpone the sweep covering every other project), and still passes the
  `looksLikeProjectDir` / `agenticDir` qualification. Measured: **106 ms** from signal to
  spawn.
- The badge separates "warming up" from "broken". Grey does not drag the line's overall
  colour. The 60 s window is bounded and an unknown session age falls back to "old", so a
  genuinely failed launch still goes red. Session age is read from
  `.data/agent-sessions/<tmux-session>.json`, written by the launcher.

### Context Window Gauge

How full this pane's agent conversation is, for **all four agents** — previously this
existed only inside Claude's own statusline.

```
████░░░░░░  42%
```

Rendered by `lib/statusline/context-gauge.cjs`, which is CommonJS so both
`combined-status-line.js` (ESM, full render) and `status-line-fast.cjs` (CJS, 5 s tick)
load the *same* file rather than keeping two copies in step.

| Used | Fill | Background |
|------|------|------------|
| < 50% | `colour46` | `colour22` |
| 50 – 64% | `colour226` | `colour58` |
| 65 – 79% | `colour208` | `colour94` |
| ≥ 80% | `colour196` bold | `colour52` |

**Fixed 15 cells in every band**, measured against tmux rather than assumed. The fast path
substitutes a freshly rendered gauge into a line the full renderer has already truncated
and left-padded, so a width that varied by severity would push the payload past the pane
edge — the trailing-residue artifact (`15:322`). This is why the ≥ 80% band carries no 💀
prefix: severity is colour and bold, as everywhere else on this bar.

**Sources** (all exact, none estimated):

| Agent | Source | Field |
|-------|--------|-------|
| `claude` | `$TMPDIR/claude-ctx-<sessionId>.json` | `remaining_percentage`, normalised against the autocompact reserve |
| `opencode` | `~/.local/share/opencode/opencode.db` → newest assistant `message` rows | `tokens.input` + `tokens.cache.read` |
| `copilot` | `~/.copilot/session-store.db` → `assistant_usage_events` | `input_tokens` only |
| `pi` | `<piCfgDir>/sessions/<encoded-cwd>/*.jsonl` → last `usage` | `usage.input` + `usage.cacheRead` |

⚠️ **The two wires disagree.** Copilot is OpenAI-wire: `input_tokens` already includes
cache reads, so adding `cache_read_tokens` there would roughly double a cache-heavy
reading with nothing erroring. OpenCode and pi are Anthropic-wire, where they add. Same
distinction documented for token accounting in `CLAUDE.md`. OpenCode's
`session.tokens_input` is deliberately unused — it is cumulative spend, not occupancy.

The opencode query **must** filter by `session_id` so it rides
`message_session_time_created_id_idx`; unfiltered it takes ~1.5 s on a 2.2 GB database and
would be visible as statusline lag. Measured cost with the filter: ~10 ms (copilot ~9 ms).

`pi`'s agent directory follows `CODING_AGENT_SCOPE` — `$CODING_REPO/.pi-agent` in wrapper
scope, `~/.pi/agent` in global — never "whichever directory exists". Switching an install
to global leaves the old `.pi-agent` behind, and an existence check would read that frozen
snapshot forever.

**Which Claude session the gauge reads.** The bridge file is keyed on Claude Code's own
session id, so the renderers have to know *which* session owns the pane before they can
read anything. That id is recorded by `scripts/claude-statusline.cjs`, the shim Claude Code
runs as its status line — the one place that sees the session id (handed to it on stdin)
and the tmux session together. It writes
`$TMPDIR/claude-tmux-session-<tmux-session-name>.json` on every render, and both renderers
look the pane up there first.

The key is the **tmux session name**, not the pane: tmux runs `status-right` in the server
rather than in a pane, so the renderers never receive `TMUX_PANE` — what the format string
passes them is `#{session_name}` as `TMUX_SESSION_NAME`. It is also the right granularity,
since `status-right` is drawn once per tmux session and these agent launches are one tmux
session apiece.

Without a record the renderers fall back to their older project-keyed lookups — the
newest-beating coordinator LSL entry in the full render, the single transcript path per
project in the fast path's sidecar. Those name a *project*, not a session, so on a project
that has hosted more than one they can name the wrong one, and the per-pane tie-break meant
to disambiguate them never fires (coordinator entries take their pane from the ETM
heartbeat, and ETMs are project singletons carrying only the launcher's pane, so
`tmuxPane` is null in practice). The symptom was a first-turn session rendering the context
of the session the user had just closed until its own ETM registered and out-beat the old
one's remaining heartbeats — measured at 66%, which is exactly what the previous session's
bridge file normalises to while the fresh one said 13%. The fallback is kept for panes with
no record: an unwrapped `claude`, or the tick before the first render.

Records expire after 24 h. That is not a freshness requirement — a live session rewrites
its record on every render, but an idle one may not render for hours and must keep its
mapping. It bounds the one case where the name alone is ambiguous: tmux session names embed
the launcher pid, and pids come round again after a reboot.

**Reclaiming the temp files.** Three families accumulate in the system temp directory, one
per session, and until recently nothing removed them: `claude-ctx-<sessionId>.json`,
GSD's `claude-ctx-<sessionId>-warned.json` companion, and the
`claude-tmux-session-<name>.json` records above. `scripts/claude-ctx-sweeper.mjs` deletes
them once they pass `CLAUDE_CTX_RETENTION_DAYS` (default 2), and is run from the agent
launch path in `bin/coding` — backgrounded, and rate-limited via `--if-older-than` so a
burst of launches sweeps once rather than once each. It never throws and always exits 0: a
launch must not be able to fail over housekeeping.

It keys on **the temp file's own mtime**, not on the session transcript's. The transcript
is the tempting signal and the wrong one — transcript mtimes are bulk-touched, and one
session was observed with a transcript modified minutes ago whose ctx file had not moved in
three days. These files are written only by the render loop, so their mtime means exactly
"when this session last drew its status line". Reclaiming one wrongly costs a blank gauge
in that pane until its next render, which rewrites the file.

Only those three prefixes are matched, and only with a `.json` extension. The temp
directory is shared with the OS and with the rest of this repo (`vkb-server.pid`,
`kgbench-needles-*`, the copilot KB stash), so a wildcard sweep there would be a footgun.

**Windows also gets a scheduled task.** macOS purges `/var/folders` and Linux ships
systemd-tmpfiles for `/tmp`, so on those the launch-time sweep plus the OS is enough.
Windows reclaims `%TEMP%` never, so `install.sh` offers an hourly Scheduled Task
(`\coding\claude-ctx-sweeper`, installed by
`scripts/install-claude-ctx-sweeper-schtasks.sh`, removed by `uninstall.sh`). It is the
only system-scope change the sweeper makes on any platform, and declining it loses nothing
but the sweeps that would have happened while no agent was running.

**Absent, not zero**: an unreadable store renders no gauge at all. `CODING_AGENT` is part
of the cache key so two agents on one project cannot show each other's reading, and a line
borrowed from a sibling pane has its gauge blanked (width-identical) first.

![Context Window Gauge](../images/status-line-context-gauge.png)

### Session Activity Indicators

Session activity uses a **unified graduated color scheme** that transitions smoothly from active to dormant. **All sessions are always displayed** - sleeping sessions show as 💤, never hidden.

| Icon | Status | Time Since Activity | Description |
|------|--------|---------------------|-------------|
| ● bright green (`colour41`) | Active | < 5 minutes | Someone is working here now |
| ● mid green (`colour34`) | Cooling | 5 - 30 minutes | Just stepped away |
| ● dark green (`colour28`) | Fading | 30 min - 6 hours | Idle, still tracked |
| ● very dark green (`colour22`) | Inactive | 6 - 24 hours | Dormant but open |
| ● grey (`colour238`) | Sleeping | > 24 hours | Long-term dormant |
| ❌ | Error | Any | Health check failed or service crash |

**Session Lifecycle**:
```
● Active → ● Cooling → ● Fading → ● Inactive → ● Sleeping
(colour41 → colour34 → colour28 → colour22 → colour238)
   <5min      5-15min     15m-1hr     1-6hr        6-24hr       >24hr
```

**Sessions are only removed** when the agent process has exited (session closed). A running agent does NOT pin the session to Active — that was a bug (the file mtime is bumped by timestamp-less bookkeeping records on a merely-open session), fixed by bucketing on the newest timestamped record. Regardless of transcript age.

**No amber for idleness**: the system intentionally avoids the amber alarm dot for session *inactivity*. Amber is reserved for actual warnings (e.g. stale health data). Normal inactivity is shown through the graduated green cooling ramp, which ends in grey — never in an alarm colour.

**Agent Age Cap**: When an agent process (claude, copilot, opencode) is running, the displayed age is capped at the transcript monitor's uptime. This prevents a freshly started session in a project with old transcripts from immediately showing as dormant. The session starts on the brightest green `●` and naturally progresses through the cooling ramp based on how long the current session has been idle.

**Not-Found Transcript Guard**: Agents that don't produce Claude-compatible transcripts (e.g., OpenCode) have `transcriptInfo.status: 'not_found'` with `ageMs: 0`. The age cap logic skips these sessions — they correctly display as ⚫ inactive instead of falsely showing as 🟢 active.

**Activity Age Calculation**:
- Uses `transcriptInfo.ageMs` from health file (actual transcript inactivity)
- Falls back to health file timestamp if transcript age unavailable
- For stale health files (>5 min old), uses health file age as minimum to ensure closed sessions aren't falsely shown as active
- Capped at monitor uptime when agent is running (prevents stale transcript age from showing dormant on fresh sessions)

**Design Rationale**: Projects that aren't actively being worked on should show gradual "cooling" colors rather than alarming red/orange/yellow. These colors are reserved for actual errors and warnings, not normal session lifecycle states.

## Architecture

The Status Line is part of the **6-Layer Health System** with 9 core classes:

![Health System Classes](../images/health-system-classes.png)

The StatusLineHealthMonitor (Layer 4) aggregates health from all other layers and outputs to the Combined Status Line display.

![StatusLine Architecture](../images/statusline-architecture.png)

### Core Components

**1. Status Line Fast-Path** (`scripts/status-line-fast.cjs`)
- Ultra-fast CommonJS cache reader (~60ms) — invoked by tmux `status-right` every 5 seconds
- Reads pre-rendered status from `.logs/combined-status-line-cache.txt`
- If cache <60s old: serves immediately (no Node.js ESM overhead)
- If cache >20s old: triggers background refresh via `combined-status-line.js` (detached)
- Falls back to synchronous full CSL only if cache missing or >60s stale
- Solves the 2-18 second ESM module resolution penalty under high system load

**2. Combined Status Line** (`scripts/combined-status-line.js`)
- Full status display with all segments (health, quota, sessions, compliance, knowledge, LSL)
- Writes cache to `.logs/combined-status-line-cache.txt` after successful generation
- **GPS heartbeat gate**: ensure* supervision functions only run when GPS heartbeat is stale (>60s)
- When GPS is running (normal): display-only, no process spawning
- When GPS is dead: fallback supervisor for GPS, SHM, and transcript monitors
- Smart abbreviations for compact display

**3. Status Line Integration**

**Data Sources**:
- **Health System**: Provides system health scores from `.health/verification-status.json`
- **Constraint Monitor**: Provides compliance percentage from constraint API
- **LSL System**: Provides logging status from Global LSL Registry

### Session Discovery

The system uses multiple discovery methods to find all active sessions:

**Discovery Methods**:
1. **Running Monitor Detection**: Checks `ps aux` for running `enhanced-transcript-monitor.js` processes
2. **Agent Process Detection**: Scans for `claude`, `copilot`, and `opencode` processes via `ps -eo pid,comm` and resolves project from working directory via `lsof`
3. **Registry-based Discovery**: Uses Global LSL Registry for registered sessions
4. **Dynamic Discovery**: Scans Claude transcript directories for unregistered sessions
5. **Health File Validation**: Uses centralized health files from `.health/` directory

**Key Behavior**:
- Sessions with a **running agent process** use age capped at monitor uptime (graduated cooling from session start)
- Sessions with running transcript monitors but no active agent use graduated activity icons
- Sessions WITHOUT running monitors BUT with a running agent are shown as 💤 (no monitor yet)
- Sessions are **only removed** when the agent process has exited — never hidden
- The Global Process Supervisor automatically restarts dead monitors within 30 seconds

**Multi-Agent Support**:
- **Claude**: Detected via `ps -eo pid,comm` with exact match on `claude`
- **Copilot**: Detected via path-ending match `/copilot$` (comm shows full binary path)
- **OpenCode**: Detected via path-ending match `/opencode$` (comm shows full binary path)
- New agents can be added to the detection loop in `getRunningAgentSessions()`

**Example**:
- `[C🟢 UT🟢]` - coding and ui-template both active
- `[C● CA●]` - coding active (bright green), curriculum-alignment cooling (mid green)
- `[C● UT● CA●]` - coding active, ui-template fading (dark green), curriculum-alignment dormant (very dark green)

The distinction is luminance within one hue, so it does not survive being quoted as plain text here — see the ramp table in [the status-line guide](../../docs-content/guides/status-line.md) for the exact `colour` values.
- Sessions only removed when agent process exits (never hidden while running)

### Smart Abbreviation Engine

Project names are automatically abbreviated using intelligent algorithms:

**Examples**:
- **coding** → **C**
- **curriculum-alignment** → **CA**
- **nano-degree** → **ND**
- **project-management** → **PM**
- **user-interface** → **UI**

**Algorithm Handles**:
- Single words: First letter (coding → C)
- Hyphenated words: First letter of each part (curriculum-alignment → CA)
- Camel case: Capital letters (projectManagement → PM)
- Multiple separators: Intelligent parsing

## Multi-Session Support

The status line displays information for **multiple active coding agent sessions** simultaneously. Only sessions active within the last 24 hours are shown.

### Session Display

**Single Active Session**:
```
[🏥●] [Gq$0FEB A$0 O$0 X$25] [C●] [🔒67% 🔍EX] [📚●] 📋17-18
```

**Multiple Active Sessions**:
```
[🏥●] [Gq$0FEB A$0 O$0 X$25] [C● UT● CA●] [🔒67% 🔍EX] [📚●] 📋17-18
```

Where:
- `C` - coding project (active)
- `UT` - ui-template project (fading)
- `CA` - curriculum-alignment project (cooling)
- Current project is underlined in terminal

### Session Prioritization

**Activity-Based Priority**:
1. Most recently active project shown first
2. `→` indicator points to active project
3. Dormant sessions shown with abbreviated status

## How It Works

### Status Line Update Flow

![Status Line Hook Timing](../images/status-line-hook-timing.png)

**Cache Fast-Path (normal operation)**:
1. **Tmux fires** `status-line-fast.cjs` every 5 seconds
2. **Cache check**: Read `.logs/combined-status-line-cache.txt`
3. If cache <60s old → **serve immediately** (~60ms, no further processing)
4. If cache >20s old → trigger **background refresh** (detached `combined-status-line.js`)
5. If cache missing/stale → synchronous fallback to full CSL

**Full Refresh (background or fallback)**:
1. **Status Collection**:
   - Read health verification status
   - Query constraint monitor API
   - Scan LSL registry
2. **Status Aggregation**: Combine all indicators
3. **Display**: Output full status bar
4. **Cache Write**: Save to `.logs/combined-status-line-cache.txt`
5. **GPS Heartbeat Check**: If GPS heartbeat >60s stale, run ensure* functions as fallback supervisor

### Update Frequency

**Triggered By**:
- Tmux `status-right` every 5 seconds (via fast-path cache)
- Background refresh when cache >20s old
- Full CSL fallback when cache missing

**Caching**:
- Pre-rendered status cache (fast-path): 60s TTL, 20s background refresh trigger
- Health status cached for 5 minutes
- Constraint compliance cached for 1 minute
- LSL status read on every update

### Integration Points

**File Locations**:
- Health: `.health/verification-status.json`
- LSL Registry: `.lsl/global-registry.json`
- Constraint API: `http://localhost:3031/api/compliance/:project`

## State Diagrams

### Service Lifecycle States

![Service Lifecycle State](../images/service-lifecycle-state.png)

**Unified Health States** (for `[🏥...]` indicator):
- **Healthy** (✅) - All systems operational (GCM + Health Verifier + Enforcement)
- **Warning** (⚠️) - Issues detected - check dashboard for details
- **Stale** (⏰) - Health data older than 2 minutes
- **Critical** (❌) - Critical issues requiring immediate attention
- **Offline** (💤) - Health verifier not running

**Session Activity States** (for project sessions - graduated cooling scheme):
- **Active** (● colour41) - Currently active (< 5 min)
- **Cooling** (● colour34) - Recently active (5-30 min)
- **Fading** (● colour28) - Activity fading (30 min - 6 hr)

- **Inactive** (● colour22) - Session idle (6-24 hr) - last visible state
- **Sleeping** (● colour238) - Long-term dormant (> 24 hr) - still shown

**Transitions**:
- Health check success → Healthy (✅)
- GCM or Health Verifier issues → Warning (⚠️)
- Critical failures → Critical (❌)
- Time passage → ● colour41 → colour34 → colour28 → colour22 → colour238
- Sessions only removed when agent exits, never hidden while running

### Status Display States

**Color Transitions**:
- Green → Orange: 1 hour until session window closes
- Orange → Red: Session window has closed
- Red → Green: New session window opened

## Configuration

### Status Line Configuration

**File**: `config/status-line-config.json`

```json
{
  "enabled": true,
  "update_interval_ms": 5000,
  "cache_duration_ms": 300000,
  "health_source": ".health/verification-status.json",
  "lsl_registry": ".lsl/global-registry.json",
  "constraint_api": "http://localhost:3031/api/compliance/{project}",
  "abbreviation_style": "smart",
  "multi_session_display": true,
  "max_sessions_displayed": 5
}
```

**Configuration Options**:
- `enabled`: Toggle status line on/off
- `update_interval_ms`: How often to check for updates (default: 5000ms)
- `cache_duration_ms`: How long to cache health status (default: 5 minutes)
- `abbreviation_style`: `smart` | `first-letter` | `full-name`
- `multi_session_display`: Show multiple sessions or just active one
- `max_sessions_displayed`: Maximum sessions to show (default: 5)

## Usage

### Starting the Status Line

The status line is **automatically started** with the `coding` command. All agents are wrapped in tmux, and the tmux `status-right` is configured to run `combined-status-line.js`:

```bash
# Start any agent - tmux wrapping is automatic
coding              # Status line renders in tmux status bar
coding --claude     # Same tmux wrapping
coding --copilot    # Same tmux wrapping
```

The tmux wrapper (`scripts/tmux-session-wrapper.sh`) handles:
- Creating a tmux session named `coding-{agent}-{PID}`
- Configuring `status-right` to invoke `status-line-fast.cjs` (CJS fast-path cache reader)
- Nesting guard: if already in tmux, configures the current session instead
- Mouse forwarding for interactive agent use

### Manual Status Line Check

```bash
# Get current status line output (fast-path from cache)
node scripts/status-line-fast.cjs

# Force full refresh (bypasses cache)
node scripts/combined-status-line.js

# Example output:
# [🏥●] [Gq$0FEB A$0 O$0 X$25] [C● UT●] [🔒67% 🔍EX] [📚●] 📋17-18
```

### Troubleshooting

**Status bar completely blank?**
```bash
# Check if the cache file exists and is recent
ls -la .logs/combined-status-line-cache.txt

# Test the fast-path directly
time node scripts/status-line-fast.cjs

# If cache is stale/missing, force a full refresh
node scripts/combined-status-line.js

# Check for process spawn storm (should be <80 Node processes)
ps aux | grep node | wc -l

# If >100 processes, kill the coordinator and let GPS restart cleanly
ps aux | grep global-service-coordinator | grep -v grep
```

**Status line not updating?**
```bash
# Check if health verifier is running
ps aux | grep health-verifier

# Manually trigger health check
node scripts/health-verifier.js

# Check status files exist
ls -la .health/verification-status.json
```

**Wrong project showing as active?**
```bash
# Check LSL registry
cat .lsl/global-registry.json | jq '.'

# Verify activity timestamps
cat .lsl/global-registry.json | jq '.sessions[] | {project, last_activity}'
```

**Session not showing that should be?**
```bash
# Check if agent process is detected (claude, copilot, opencode)
ps -eo pid,comm | awk '/claude$|copilot$|opencode$/ {print}'

# Check if the agent's cwd resolves to the right project
lsof -p <PID> 2>/dev/null | grep cwd

# Check if transcript monitor is running for that project
ps aux | grep enhanced-transcript-monitor | grep PROJECT_NAME

# Sessions show if: agent process running OR transcript monitor running
```

**Closed session still showing?**

```bash
# This shouldn't happen with the new logic - only sessions with running monitors are shown
# If it does, restart the statusline-health-monitor daemon:
node scripts/statusline-health-monitor.js --daemon --auto-heal --force
```

**Session shows wrong activity age (e.g., showing 🟢 when inactive)?**

```bash
# Check the health file for that project
cat .health/PROJECT-transcript-monitor-health.json | jq '{transcriptAge: .transcriptInfo.ageMs, timestamp}'

# The transcriptAge should be used (actual transcript inactivity)
# If health file is stale (>5 min old), file age is used as minimum
```

**Abbreviations incorrect?**

```bash
# Test abbreviation engine
node scripts/combined-status-line.js --test-abbreviations

# Manual abbreviation override in config
# Edit config/status-line-config.json
```

**Docker MCP services showing unhealthy?**

```bash
# Check if Docker containers are running
docker compose -f docker/docker-compose.yml ps

# Test individual health endpoints
curl http://localhost:3848/health  # Semantic Analysis
curl http://localhost:3849/health  # Constraint Monitor
curl http://localhost:3851/mcp     # Graphify

# Check container logs for errors
docker compose -f docker/docker-compose.yml logs coding-services

# Restart Docker services if needed
docker compose -f docker/docker-compose.yml restart
```

**Docker mode not detected?**

```bash
# Check for Docker mode marker
ls -la .docker-mode

# Or check environment variable
echo $CODING_DOCKER_MODE

# Enable Docker mode
touch .docker-mode
# OR
export CODING_DOCKER_MODE=true
```

## Terminal Title Broadcasting

The status line system now includes **automatic terminal title updates** that work even for idle sessions.

### How It Works

Every 15 seconds, the statusline-health-monitor broadcasts status to all Claude session terminals via ANSI escape codes:

```
Terminal Tab: "C● | UT● CA●"
              ↑          ↑
        Current     Other active sessions
        project     (sleeping sessions hidden)
```

This means you can see the current status of ALL sessions by looking at any terminal's tab or title bar, even if that session is idle.

### Benefits

- **Always visible status**: No need to type to update the status line
- **Cross-session awareness**: Each terminal shows status of all projects
- **Minimal overhead**: Only writes to TTYs when status changes

### Terminal Compatibility

Works with terminals that support ANSI OSC (Operating System Command) escape sequences when written directly to TTY:

| Terminal | Status | Notes |
|----------|--------|-------|
| iTerm2 | ✅ Works | Full OSC 0 support |
| Terminal.app | ✅ Works | Native macOS terminal |
| VS Code Terminal | ❌ Limited | Does not process OSC 0 from external TTY writes |
| tmux | ✅ Works | All agents now run inside tmux (primary rendering target) |

**VSCode Limitation**: VSCode's integrated terminal captures TTY output and does not interpret OSC escape sequences written directly to the TTY device from external processes. The status line within the terminal content still updates on activity.

### Troubleshooting Terminal Titles

**Titles not updating?**
```bash
# Check if statusline-health-monitor is running
ps aux | grep statusline-health-monitor

# Check logs for TTY detection
grep -i tty ~/.logs/statusline-health.log

# Verify Claude processes have TTYs
ps -eo pid,tty,comm | grep claude
```

## Key Files

**Core System**:

- `scripts/tmux-session-wrapper.sh` - Shared tmux wrapper that configures status bar for all agents
- `scripts/status-line-fast.cjs` - Ultra-fast CJS cache reader (~60ms) — invoked by tmux `status-right`
- `scripts/combined-status-line.js` - Full status line renderer + fallback supervisor (writes cache)
- `scripts/combined-status-line-wrapper.js` - ESM wrapper (backup; primary is fast-path CJS)
- `scripts/statusline-health-monitor.js` - Session health monitor daemon (detects running monitors, writes status)
- `scripts/health-verifier.js` - Health status provider
- `.lsl/global-registry.json` - LSL session registry
- `.health/verification-status.json` - Health status cache
- `.health/*-transcript-monitor-health.json` - Per-project health files (centralized in coding project)
- `.logs/statusline-health-status.txt` - Rendered status line output
- `.logs/combined-status-line-cache.txt` - Pre-rendered status cache (served by fast-path)

**Configuration**:

- `config/status-line-config.json` - Status line configuration

**Integration**:

- `scripts/health-prompt-hook.js` - Triggers status line updates
- `integrations/constraint-monitor/` - Provides compliance data

## Related Documentation

- [Health System Overview](./README.md) - Main health system documentation
- [Enhanced Health Monitoring](./enhanced-health-monitoring.md) - Comprehensive health monitoring details
- [LSL System](../lsl/README.md) - Live session logging documentation
- [Constraint Monitoring](../constraints/README.md) - Code quality enforcement
