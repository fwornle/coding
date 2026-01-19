# Status Line System

Real-time visual indicators of system health and development activity in the Claude Code status bar.

## What It Shows

The Status Line provides a **compact, real-time view** of all system activity across multiple Claude Code sessions.

![Status Line Display](../images/status-line-display.png)

### Example Display

```
[🏥✅] [Gq$2JAN A$18 O○ X$25] [C🟢 UT🫒] [🛡️ 67% 🔍EX] [📚✅] 📋17-18
```

### Reading the Status Line

**Format**: `[🏥 health] [api-quota] [sessions] [🛡️ compliance trajectory] [📚 knowledge] 📋time`

**Components**:
- `[🏥✅]` - **System Health**: Unified health (infrastructure + services)
- `[Gq$2JAN A$18 O○ X$25]` - **API Quota**: LLM provider availability (see below)
- `[C🟢 UT🫒]` - **Active Sessions**: Project abbreviations with activity icons
- `🛡️ 67%` - **Constraint Compliance**: Code quality compliance percentage
- `🔍 EX` - **Trajectory State**: Current development activity
- `[📚✅]` - **Knowledge System**: Knowledge extraction status
- `📋17-18` - **LSL Time Window**: Session time range (HHMM-HHMM)

### API Quota Monitoring

The status line displays LLM provider availability using a simple, consistent format.

**Format**: `[Provider$X ...]` or `[Provider● ...]`

**Provider Abbreviations**:
- `Gq` - Groq (free tier or monthly billing)
- `Ggl` - Google Gemini (free tier: 15 RPM, 1M TPD)
- `A` - Anthropic Claude (requires Admin API key for usage data)
- `O` - OpenAI (requires Admin API key for usage data)
- `X` - X.AI Grok (free credits: $25)

**Display Logic**:

| Scenario | Display | Meaning |
|----------|---------|---------|
| Monthly billing (Groq) | `Gq$2JAN` | $2 spent in January |
| Prepaid credits configured | `A$18` | $18 remaining of prepaid amount |
| Free tier (Groq, Google) | `Gq●` | Available (rate-limited only) |
| No admin key | `O○` | Cannot get usage data |

**Pie Chart Symbols** (for availability):
- `●` (full) - Fully available / >87.5% remaining
- `◕` (¾) - 62.5-87.5% remaining
- `◐` (½) - 37.5-62.5% remaining
- `◔` (¼) - 12.5-37.5% remaining
- `○` (empty) - <12.5% remaining or no data

**Examples**:
- `[Gq$2JAN A$18 O○ X$25]` - Groq $2 spent in Jan, Anthropic $18 left, OpenAI no key, xAI $25 left
- `[Gq● A$5 X$2]` - Groq free tier, low credits on Anthropic and xAI
- `[A◐ O◔]` - Anthropic at ~50%, OpenAI at ~25% (percentage mode)

**Configuration**:

Configure provider credits in `config/live-logging-config.json`:

```json
"provider_credits": {
  "groq": {
    "billingType": "monthly",
    "monthlySpend": 2,
    "billingMonth": "JAN",
    "spendLimit": null
  },
  "anthropic": { "prepaidCredits": 20 },
  "openai": { "prepaidCredits": 50 },
  "xai": { "prepaidCredits": 25 }
}
```

**Groq Billing Types**:
- `"billingType": "free"` - Free tier, shows pie symbol (`Gq●`)
- `"billingType": "monthly"` - Monthly billing, shows spend + month (`Gq$2JAN`)
  - `monthlySpend` - Current month spend (update from console.groq.com)
  - `billingMonth` - 3-letter month abbreviation (JAN, FEB, etc.)
  - `spendLimit` - Optional spend limit for warnings

**Admin API Keys** (required for real-time usage tracking):
- Anthropic: `ANTHROPIC_ADMIN_API_KEY` - Get at console.anthropic.com → Settings → Admin API Keys
- OpenAI: `OPENAI_ADMIN_API_KEY` - Get at platform.openai.com/settings/organization/admin-keys
- Groq: No public billing API yet - update `monthlySpend` manually from console.groq.com

### Unified Health Status Indicator

The `[🏥...]` section shows **unified system health** combining:
- **GCM (Global Coding Monitor)**: Session coordinator health
- **Health Verifier**: Service, database, and process health
- **Constraint Enforcement**: Whether constraints are actively enforced

| Display | Meaning | Action |
|---------|---------|--------|
| `[🏥✅]` | All systems healthy | None needed |
| `[🏥⚠️]` | Issues detected | Check dashboard for details |
| `[🏥⏰]` | **Stale** - verification data >2 minutes old | Health verifier may have crashed |
| `[🏥❌]` | Critical issues or error | Immediate attention required |
| `[🏥💤]` | Health verifier offline | Start health verifier |

**Note**: Violation counts are no longer shown in the status line. Details are available on the health dashboard at http://localhost:3033.

**Common Causes of `[🏥⚠️]` (Issues)**:
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

### Trajectory States

- `🔍 EX` (Exploring) - Information gathering and analysis
- `📈 ON` (On Track) - Productive progression
- `📉 OFF` (Off Track) - Deviating from optimal path
- `⚙️ IMP` (Implementing) - Active code modification
- `✅ VER` (Verifying) - Testing and validation
- `🚫 BLK` (Blocked) - Intervention preventing action

### LSL Status Indicators

**Color Coding**:
- 🟢 Green - Session window open (>1 hour remaining)
- 🟠 Orange - Window closing soon (<1 hour)
- 🔴 Red - Window closed or expired

**Format**: `🟢HHMM-HHMM(Xmin)` where:
- `HHMM-HHMM` - Session time window
- `(Xmin)` - Minutes since last activity
- `→project` - Project with activity

### Session Activity Indicators

Session activity uses a **unified graduated color scheme** that transitions smoothly from active to dormant. **Only active sessions (< 24 hours) are displayed** - sleeping/inactive sessions are automatically filtered out to reduce clutter.

| Icon | Status | Time Since Activity | Description |
|------|--------|---------------------|-------------|
| 🟢 | Active | < 5 minutes | Active session with recent activity |
| 🌲 | Cooling | 5 - 15 minutes | Session cooling down |
| 🫒 | Fading | 15 min - 1 hour | Session fading, still tracked |
| 🪨 | Dormant | 1 - 6 hours | Session dormant but alive |
| ⚫ | Inactive | 6 - 24 hours | Session inactive (last shown before filtering) |
| 💤 | Sleeping | > 24 hours | **Hidden from display** |
| ❌ | Error | Any | Health check failed or service crash |

**Displayed Sessions** (Active within 24 hours):
```
🟢 Active → 🌲 Cooling → 🫒 Fading → 🪨 Dormant → ⚫ Inactive → [hidden]
   <5min      5-15min     15m-1hr     1-6hr        6-24hr       >24hr
```

**Hidden Sessions**: Sessions inactive for more than 24 hours (💤 sleeping) are automatically filtered from the status line display. This keeps the status line focused on actively used projects.

**No Yellow Status**: The system intentionally avoids yellow (🟡) for session inactivity. Yellow is reserved for actual warnings like missing trajectory files or stale health data. Normal session inactivity is shown through the graduated cooling sequence.

**Activity Age Calculation**:
- Uses `transcriptInfo.ageMs` from health file (actual transcript inactivity)
- Falls back to health file timestamp if transcript age unavailable
- For stale health files (>5 min old), uses health file age as minimum to ensure closed sessions aren't falsely shown as active
- Virgin sessions (no transcript exchanges) are detected by `exchangeCount === 0`

**Design Rationale**: Projects that aren't actively being worked on should show gradual "cooling" colors rather than alarming red/orange/yellow. These colors are reserved for actual errors and warnings, not normal session lifecycle states.

## Architecture

The Status Line is part of the **6-Layer Health System** with 9 core classes:

![Health System Classes](../images/health-system-classes.png)

The StatusLineHealthMonitor (Layer 4) aggregates health from all other layers and outputs to the Combined Status Line display.

![StatusLine Architecture](../images/statusline-architecture.png)

### Core Components

**1. Combined Status Line** (`scripts/combined-status-line.js`)
- Unified status display across all Claude Code sessions
- Integration with health monitoring, constraint monitoring, and trajectory analysis
- Real-time updates via health check integration
- Smart abbreviations for compact display

**2. Status Line Integration**

![Status Line Integration](../images/status-line-trajectory-integration.png)

**Data Sources**:
- **Health System**: Provides system health scores from `.health/verification-status.json`
- **Constraint Monitor**: Provides compliance percentage from constraint API
- **Trajectory Analyzer**: Provides current development state from `.specstory/trajectory/live-state.json`
- **API Quota Checker**: Provides LLM provider usage from `lib/api-quota-checker.js`
- **LSL System**: Provides logging status from Global LSL Registry

### Session Discovery

The system uses multiple discovery methods to ensure **only active sessions** (with running transcript monitors) are displayed:

**Discovery Methods**:
1. **Running Monitor Detection**: Checks `ps aux` for running `enhanced-transcript-monitor.js` processes
2. **Registry-based Discovery**: Uses Global LSL Registry for registered sessions
3. **Dynamic Discovery**: Scans Claude transcript directories for unregistered sessions
4. **Health File Validation**: Uses centralized health files from `.health/` directory

**Key Behavior**:
- Sessions WITH running transcript monitors are shown with full activity status (🟢, 🌲, 🫒, 🪨, ⚫)
- Sessions WITHOUT running monitors BUT with recent transcripts (within 48h) are shown as 💤 (dormant/no monitor)
- Sessions older than 48 hours without a monitor are hidden
- The Global Process Supervisor automatically restarts dead monitors within 30 seconds

**Example**:
- `[C🟢 UT🟢]` - coding and ui-template both active
- `[C🟢 CA🌲]` - coding active, curriculum-alignment cooling
- `[C🟢 UT🫒 CA🪨]` - coding active, ui-template fading, curriculum-alignment dormant
- Sessions inactive >24 hours (💤 sleeping) are automatically hidden from display

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

The status line displays information for **multiple active Claude Code sessions** simultaneously. Only sessions active within the last 24 hours are shown.

### Session Display

**Single Active Session**:
```
[🏥✅] [Gq$2JAN A$18] [C🟢] [🛡️ 67% 🔍EX] [📚✅] 📋17-18
```

**Multiple Active Sessions**:
```
[🏥⚠️] [Gq$2JAN A$18 X$25] [C🟢 UT🫒 CA🌲] [🛡️ 67% 🔍EX] [📚✅] 📋17-18
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

**Update Sequence**:
1. **Health Check Trigger**: Pre-prompt hook fires
2. **Status Collection**:
   - Read health verification status
   - Query constraint monitor API
   - Read trajectory state file
   - Check API quota for all providers
   - Scan LSL registry
3. **Status Aggregation**: Combine all indicators
4. **Display Update**: Update Claude Code status bar
5. **Cache**: Store for next check

### Update Frequency

**Triggered By**:
- User prompts (via pre-prompt hook)
- Health verification completion
- Trajectory state changes
- LSL activity events

**Caching**:
- Health status cached for 5 minutes
- Constraint compliance cached for 1 minute
- API quota cached for 30 seconds (real-time) or 5 minutes (estimated)
- Trajectory state read on every update
- LSL status read on every update

### Integration Points

**File Locations**:
- Health: `.health/verification-status.json`
- Trajectory: `.specstory/trajectory/live-state.json`
- API Quota: `lib/api-quota-checker.js` (shared library)
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
- **Active** (🟢) - Currently active (< 5 min)
- **Cooling** (🌲) - Recently active (5-15 min)
- **Fading** (🫒) - Activity fading (15 min - 1 hr)
- **Dormant** (🪨) - Dormant but trackable (1-6 hr)
- **Inactive** (⚫) - Session idle (6-24 hr) - last visible state
- **Sleeping** (💤) - Long-term dormant (> 24 hr) - **hidden from display**

**Transitions**:
- Health check success → Healthy (✅)
- GCM or Health Verifier issues → Warning (⚠️)
- Critical failures → Critical (❌)
- Time passage → 🟢 → 🌲 → 🫒 → 🪨 → ⚫ → [hidden]
- Sessions >24 hours are filtered from display

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
  "trajectory_source": ".specstory/trajectory/live-state.json",
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

The status line is **automatically started** with the `coding` command:

```bash
# Start Claude Code with status line
coding

# Status line updates appear in Claude Code status bar
```

### Manual Status Line Check

```bash
# Get current status line output
node scripts/combined-status-line.js

# Example output:
# [🏥⚠️] [Gq$2JAN A$18 X$25] [C🟢 UT🫒] [🛡️ 67% 🔍EX] [📚✅] 📋17-18
```

### Troubleshooting

**Status line not updating?**
```bash
# Check if health verifier is running
ps aux | grep health-verifier

# Manually trigger health check
node scripts/health-verifier.js

# Check status files exist
ls -la .health/verification-status.json
ls -la .specstory/trajectory/live-state.json
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
# Check if transcript monitor is running for that project
ps aux | grep enhanced-transcript-monitor | grep PROJECT_NAME

# Only sessions with running monitors are shown
# If no monitor is running, the session won't appear in the status line
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

## Terminal Title Broadcasting

The status line system now includes **automatic terminal title updates** that work even for idle sessions.

### How It Works

Every 15 seconds, the statusline-health-monitor broadcasts status to all Claude session terminals via ANSI escape codes:

```
Terminal Tab: "C🟢 | UT🫒 CA🌲"
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
| tmux | ⚠️ Partial | Requires `set -g set-titles on` |

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

- `scripts/combined-status-line.js` - Main status line script (reads from statusline-health-status.txt)
- `scripts/statusline-health-monitor.js` - Session health monitor daemon (detects running monitors, writes status)
- `scripts/health-verifier.js` - Health status provider
- `src/live-logging/RealTimeTrajectoryAnalyzer.js` - Trajectory state provider
- `lib/api-quota-checker.js` - API quota provider (shared library)
- `.lsl/global-registry.json` - LSL session registry
- `.health/verification-status.json` - Health status cache
- `.health/*-transcript-monitor-health.json` - Per-project health files (centralized in coding project)
- `.logs/statusline-health-status.txt` - Rendered status line output
- `.specstory/trajectory/live-state.json` - Trajectory state

**Configuration**:

- `config/status-line-config.json` - Status line configuration

**Integration**:

- `scripts/health-prompt-hook.js` - Triggers status line updates
- `integrations/mcp-constraint-monitor/` - Provides compliance data

## Related Documentation

- [Health System Overview](./README.md) - Main health system documentation
- [Enhanced Health Monitoring](./enhanced-health-monitoring.md) - Comprehensive health monitoring details
- [Trajectory System](../trajectories/README.md) - Trajectory analysis documentation
- [LSL System](../lsl/README.md) - Live session logging documentation
- [Constraint Monitoring](../constraints/README.md) - Code quality enforcement
