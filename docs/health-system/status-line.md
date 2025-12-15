# Status Line System

Real-time visual indicators of system health and development activity in the Claude Code status bar.

## What It Shows

The Status Line provides a **compact, real-time view** of all system activity across multiple Claude Code sessions.

![Status Line Display](../images/status-line-display.png)

### Example Display

```
[🏥 95% | 🛡️ 94% ⚙️ IMP | [Gq● A$18 O○ X$25] | 📋🟠2130-2230(3min) →coding]
```

### Reading the Status Line

**Format**: `[🏥 health | 🛡️ compliance trajectory | [api-quota] | 📋 lsl-status]`

**Components**:
- `🏥 95%` - **System Health**: Overall health score (0-100%)
- `🛡️ 94%` - **Constraint Compliance**: Code quality compliance percentage
- `⚙️ IMP` - **Trajectory State**: Current development activity
- `[Gq● A$18 O○ X$25]` - **API Quota**: LLM provider availability (see below)
- `📋🟠2130-2230(3min)` - **LSL Status**: Logging window and activity
- `→coding` - **Active Project**: Project with recent activity

### API Quota Monitoring

The status line displays LLM provider availability using a simple, consistent format.

**Format**: `[Provider$X ...]` or `[Provider● ...]`

**Provider Abbreviations**:
- `Gq` - Groq (free tier: 7.2M tokens/day, 14.4K RPM)
- `Ggl` - Google Gemini (free tier: 15 RPM, 1M TPD)
- `A` - Anthropic Claude (requires Admin API key for usage data)
- `O` - OpenAI (requires Admin API key for usage data)
- `X` - X.AI Grok (free credits: $25)

**Display Logic**:

| Scenario | Display | Meaning |
|----------|---------|---------|
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
- `[Gq● A$18 O○ X$25]` - Groq free/available, Anthropic $18 left, OpenAI no key, xAI $25 left
- `[Gq● A$5 X$2]` - Low credits on Anthropic and xAI
- `[A◐ O◔]` - Anthropic at ~50%, OpenAI at ~25% (percentage mode)

**Configuration**:

To show remaining dollars, set `prepaidCredits` in `config/live-logging-config.json`:
```json
"provider_credits": {
  "anthropic": { "prepaidCredits": 20 },
  "openai": { "prepaidCredits": 50 },
  "xai": { "prepaidCredits": 25 }
}
```

**Admin API Keys** (required for usage tracking):
- Anthropic: `ANTHROPIC_ADMIN_API_KEY` - Get at console.anthropic.com → Settings → Admin API Keys
- OpenAI: `OPENAI_ADMIN_API_KEY` - Get at platform.openai.com/settings/organization/admin-keys

### Health Verifier Status Indicators

The `[🏥...]` section shows the health verifier system status:

| Display | Meaning | Action |
|---------|---------|--------|
| `[🏥✅]` | Health verifier operational, no violations | None needed |
| `[🏥🟡]` | Degraded - some issues detected | Review health dashboard |
| `[🏥⏰]` | **Stale** - verification data >2 minutes old | Health verifier may have crashed/stuck |
| `[🏥❌]` | Error reading health status | Check health verifier process |
| `[🏥⚠️X]` | X violations detected | Review violations in dashboard |

**Common Causes of `[🏥⏰]` (Stale)**:
- Health verifier process crashed or was killed
- System under heavy load (verifier couldn't run)
- Health status file locked by another process

**To Fix Stale Status**:
```bash
# Check if health verifier is running
ps aux | grep health-verifier

# Manually trigger verification
node scripts/health-verifier.js

# Or restart all services
coding --restart-services
```

The health verifier runs every 60 seconds. If the status file is older than 2 minutes, it's considered stale.

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

Session activity uses a **unified graduated color scheme** that transitions smoothly from active to inactive, avoiding jarring orange/red colors that imply errors:

| Icon | Status | Time Since Activity | Description |
|------|--------|---------------------|-------------|
| 🟢 | Active | < 5 minutes | Active session with recent activity |
| 🌲 | Cooling | 5 - 15 minutes | Session cooling down |
| 🫒 | Fading | 15 min - 1 hour | Session fading, still tracked |
| 🪨 | Dormant | 1 - 6 hours | Session dormant but alive |
| ⚫ | Inactive | 6 - 24 hours | Session inactive, may be orphaned |
| 💤 | Sleeping | > 24 hours | Session sleeping, consider cleanup |
| 🟡 | Warning | Any | Trajectory file missing or stale |
| ❌ | Error | Any | Health check failed or service crash |

**Activity Age Calculation**:
- Uses `transcriptInfo.ageMs` from health file (actual transcript inactivity)
- Falls back to health file timestamp if transcript age unavailable
- For stale health files (>5 min old), uses health file age as minimum to ensure closed sessions aren't falsely shown as active

**Design Rationale**: Projects that aren't actively being worked on should show gradual "cooling" colors rather than alarming red/orange. Red is reserved for actual errors, not inactive sessions.

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
- **Only sessions with running transcript monitors are displayed** - closed sessions with stale health files are automatically hidden
- Sessions are shown regardless of their activity age (dormant, sleeping, etc.) as long as a monitor is running
- The running transcript monitor IS the signal that a session is active/open

**Example**:
- `[C🟢 ND💤 UT🟢]` - Shows coding (active), nano-degree (sleeping but monitor running), ui-template (active)
- Closed sessions like `budapest` or `curriculum-alignment` are NOT shown, even if their health files still exist

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

The status line displays information for **multiple active Claude Code sessions** simultaneously.

### Session Consolidation

**Single Session Display**:
```
[🏥 95% | 🛡️ 94% ⚙️ IMP | [Gq● A$18 O○ X$25] | 📋🟠2130-2230(3min) →coding]
```

**Multi-Session Display**:
```
[🏥 95% | 🛡️ 94% ⚙️ IMP | [Gq● A$18 X$25] | 📋C:🟢1400-1500(2m) CA:🟠2130-2230(15m)]
```

Where:
- `C:` - coding project
- `CA:` - curriculum-alignment project
- Each with its own LSL status

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

**Service Health States** (for system services like GCM, Guards, DB, VKB):
- **Healthy** (✅) - Service operational
- **Warning** (🟡) - Service degraded but functional
- **Unhealthy** (🔴) - Service failing
- **Unknown** (❓) - Cannot determine status

**Session Activity States** (for project sessions - graduated green scheme):
- **Active** (🟢) - Currently active (< 5 min)
- **Cooling** (🌲) - Recently active (5-15 min)
- **Fading** (🫒) - Activity fading (15 min - 1 hr)
- **Dormant** (🪨) - Dormant but trackable (1-6 hr)
- **Inactive** (⚫) - Session idle (6-24 hr)
- **Sleeping** (💤) - Long-term dormant (> 24 hr)

**Transitions**:
- Health check success → Healthy/Active
- Partial failure → Warning
- Complete failure → Unhealthy
- Time passage → Cooling → Fading → Dormant → Inactive → Sleeping

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
# [🏥 95% | 🛡️ 94% ⚙️ IMP | [Gq● A$18 O○ X$25] | 📋🟠2130-2230(3min) →coding]
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
