# Status Line Complete Guide

Real-time visual indicators of system health and development activity rendered via the unified tmux status bar. All coding agents (Claude, CoPilot, etc.) are wrapped in tmux sessions by `tmux-session-wrapper.sh`, which configures `status-right` to invoke `combined-status-line.js` every 5 seconds.

![Status Line Display](../images/status-line-display.png)

## Reading the Status Line

### Example Display

**Native Mode:**
```
[🏥✅] [Gq$2JAN A$18 O○ X$25] [C🟢 UT🫒] [🛡️ 67% 🔍EX] [📚✅] 📋17-18
```

**Docker Mode:**
```
[🐳] [🐳MCP:SA✅CM✅CGR✅] [🏥✅] [Gq$2JAN A$18 O○ X$25] [C🟢 UT🫒] [🛡️ 67% 🔍EX] [📚✅] 📋17-18
```

### Component Breakdown

| Component | Example | Description |
|-----------|---------|-------------|
| Docker Mode | `[🐳]` | Indicator that system is running in Docker mode |
| Docker MCP Health | `[🐳MCP:SA✅CM✅CGR✅]` | Health of containerized MCP SSE servers |
| System Health | `[🏥✅]` | Unified health (infrastructure + services) |
| API Quota | `[Gq$2JAN A$18 O○ X$25]` | LLM provider availability |
| Active Sessions | `[C🟢 UT🫒]` | Project abbreviations with activity icons |
| Constraint Compliance | `🛡️ 67%` | Code quality compliance percentage |
| Trajectory State | `🔍 EX` | Current development activity |
| Knowledge System | `[📚✅]` | Knowledge extraction status |
| LSL Time Window | `📋17-18` | Session time range (HHMM-HHMM) |

---

## Complete Emoji Reference

### System Health Indicators

| Display | Meaning | Action |
|---------|---------|--------|
| `[🏥✅]` | All systems healthy | None needed |
| `[🏥⚠️]` | Issues detected | Check dashboard for details |
| `[🏥⏰]` | **Stale** - verification data >2 minutes old | Health verifier may have crashed |
| `[🏥❌]` | Critical issues or error | Immediate attention required |
| `[🏥💤]` | Health verifier offline | Start health verifier |

### Session Activity Indicators

Sessions use a **graduated color scheme** based on time since last activity. Only sessions active within 24 hours are displayed.

| Icon | Status | Time Since Activity | Description |
|------|--------|---------------------|-------------|
| 🟢 | Active | < 5 minutes | Active session with recent activity |
| 🌲 | Cooling | 5 - 15 minutes | Session cooling down |
| 🫒 | Fading | 15 min - 1 hour | Session fading, still tracked |
| 🪨 | Dormant | 1 - 6 hours | Session dormant but alive |
| ⚫ | Inactive | 6 - 24 hours | Session inactive (last shown before filtering) |
| 💤 | Sleeping | > 24 hours | **Hidden from display** |
| ❌ | Error | Any | Health check failed or service crash |

**Visual progression:**
```
🟢 Active → 🌲 Cooling → 🫒 Fading → 🪨 Dormant → ⚫ Inactive → [hidden]
   <5min      5-15min     15m-1hr     1-6hr        6-24hr       >24hr
```

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
| Paused/Disabled | `[📚⏸️ ]` | Knowledge extraction disabled in config |
| Offline | `[📚❌]` | System offline or initialization failed |

### Internal Health Components

The statusline-health-monitor writes detailed health to `.logs/statusline-health-status.txt`:

```
[GCM:✅] [Sessions: C:🟢] [Guards:✅] [DB:✅] [VKB:✅] [Browser:✅] [Dash:✅]
```

| Label | Ports | Service | Description |
|-------|-------|---------|-------------|
| `GCM` | - | Global Process Supervisor | Session coordinator and auto-restart |
| `Sessions` | - | Transcript Monitors | Per-project Claude session health |
| `Guards` | 3030/3031 | Constraint Monitor | Dashboard and API for code quality |
| `DB` | - | Databases | LevelDB, SQLite, Qdrant, Memgraph |
| `VKB` | 8080 | Knowledge Visualization | Graph visualization server |
| `Browser` | 3847 | Browser Automation | SSE server for parallel sessions |
| `Dash` | 3032/3033 | System Health Dashboard | UI and API for health monitoring |

---

## API Quota Monitoring

### Format

`[Provider$X ...]` or `[Provider● ...]`

### Provider Abbreviations

| Abbreviation | Provider | Notes |
|--------------|----------|-------|
| `Gq` | Groq | Free tier or monthly billing |
| `Ggl` | Google Gemini | Free tier: 15 RPM, 1M TPD |
| `A` | Anthropic Claude | Requires Admin API key for usage data |
| `O` | OpenAI | Requires Admin API key for usage data |
| `X` | X.AI Grok | Free credits: $25 |

### Display Logic

| Scenario | Display | Meaning |
|----------|---------|---------|
| Monthly billing (Groq) | `Gq$2JAN` | $2 spent in January |
| Prepaid credits configured | `A$18` | $18 remaining of prepaid amount |
| Free tier (Groq, Google) | `Gq●` | Available (rate-limited only) |
| No admin key | `O○` | Cannot get usage data |

### Pie Chart Symbols

| Symbol | Name | Remaining |
|--------|------|-----------|
| `●` | Full | >87.5% |
| `◕` | Three-quarters | 62.5-87.5% |
| `◐` | Half | 37.5-62.5% |
| `◔` | Quarter | 12.5-37.5% |
| `○` | Empty | <12.5% or no data |

### Configuration

Configure provider credits in `config/live-logging-config.json`:

```json
{
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
}
```

**Groq Billing Types:**

- `"billingType": "free"` - Free tier, shows pie symbol (`Gq●`)
- `"billingType": "monthly"` - Monthly billing, shows spend + month (`Gq$2JAN`)
  - `monthlySpend` - Current month spend (update from console.groq.com)
  - `billingMonth` - 3-letter month abbreviation (JAN, FEB, etc.)
  - `spendLimit` - Optional spend limit for warnings

**Admin API Keys** (required for real-time usage tracking):

- **Anthropic**: `ANTHROPIC_ADMIN_API_KEY` - Get at console.anthropic.com → Settings → Admin API Keys
- **OpenAI**: `OPENAI_ADMIN_API_KEY` - Get at platform.openai.com/settings/organization/admin-keys
- **Groq**: No public billing API yet - update `monthlySpend` manually from console.groq.com

---

## Docker Mode Indicators

### Detection

Docker mode is detected when:
- The `.docker-mode` marker file exists in the coding repository
- OR the `CODING_DOCKER_MODE=true` environment variable is set

### Docker MCP Health Display

| Abbreviation | Service | Port | Health Check |
|--------------|---------|------|--------------|
| `SA` | Semantic Analysis | 3848 | `http://localhost:3848/health` |
| `CM` | Constraint Monitor | 3849 | `http://localhost:3849/health` |
| `CGR` | Code Graph RAG | 3850 | `http://localhost:3850/health` |

### Status Icons

- `✅` - Service healthy and responding
- `❌` - Service down or not responding
- `⚠️` - Service responding but with issues

### Examples

| Display | Meaning |
|---------|---------|
| `[🐳MCP:SA✅CM✅CGR✅]` | All Docker MCP services healthy |
| `[🐳MCP:SA✅CM❌CGR✅]` | Constraint Monitor is down |
| `[🐳MCP:SA⚠️CM✅CGR✅]` | Semantic Analysis has issues |

---

## Architecture

### 6-Layer Health System

![Health System Classes](../images/health-system-classes.png)

The StatusLineHealthMonitor (Layer 4) aggregates health from all other layers and outputs to the Combined Status Line display.

![StatusLine Architecture](../images/statusline-architecture.png)

### Tmux-Based Rendering

All coding agents are wrapped in tmux sessions via `scripts/tmux-session-wrapper.sh`. The wrapper:

- Creates a tmux session named `coding-{agent}-{PID}`
- Configures `status-right` to invoke `combined-status-line.js` every 5 seconds
- Handles nesting guard (reuses existing tmux if already inside one)
- Propagates environment variables (`CODING_REPO`, `SESSION_ID`, etc.)
- Enables mouse forwarding for terminal interaction

This replaces the previous approach of using agent-specific status bar APIs (e.g., Claude's `statusLine` config), providing a unified rendering target that works identically for all agents.

### Status Line Update Flow

![Status Line Hook Timing](../images/status-line-hook-timing.png)

**Update Sequence:**

1. **Tmux Timer**: `status-right` fires every 5 seconds
2. **Status Collection**:
   - Read health verification status
   - Query constraint monitor API
   - Read trajectory state file
   - Check API quota for all providers
   - Scan LSL registry
3. **Status Aggregation**: Combine all indicators
4. **Display Update**: Render to tmux status bar (supports tmux formatting codes: `#[underscore]`, `#[bold]`, colors)
5. **Cache**: Store for next check

### Caching

| Data | Cache Duration |
|------|----------------|
| Health status | 5 minutes |
| Constraint compliance | 1 minute |
| API quota (real-time) | 30 seconds |
| API quota (estimated) | 5 minutes |
| Trajectory state | Read on every update |
| LSL status | Read on every update |

---

## Service Lifecycle States

![Service Lifecycle State](../images/service-lifecycle-state.png)

### State Transitions

**Health States** (for `[🏥...]` indicator):
- Health check success → Healthy (✅)
- GCM or Health Verifier issues → Warning (⚠️)
- Critical failures → Critical (❌)

**Session States** (graduated cooling scheme):
- Time passage → 🟢 → 🌲 → 🫒 → 🪨 → ⚫ → [hidden]
- Sessions >24 hours are filtered from display

---

## Session Discovery

### Discovery Methods

1. **Running Monitor Detection**: Checks `ps aux` for running `enhanced-transcript-monitor.js` processes
2. **Registry-based Discovery**: Uses Global LSL Registry for registered sessions
3. **Dynamic Discovery**: Scans Claude transcript directories for unregistered sessions
4. **Health File Validation**: Uses centralized health files from `.health/` directory

### Key Behavior

- Sessions WITH running transcript monitors are shown with full activity status
- Sessions WITHOUT running monitors BUT with recent transcripts (within 48h) are shown as 💤
- Sessions older than 48 hours without a monitor are hidden
- The Global Process Supervisor automatically restarts dead monitors within 30 seconds

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

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `enabled` | Toggle status line on/off | `true` |
| `update_interval_ms` | How often to check for updates | 5000ms |
| `cache_duration_ms` | How long to cache health status | 5 minutes |
| `abbreviation_style` | `smart` \| `first-letter` \| `full-name` | `smart` |
| `multi_session_display` | Show multiple sessions or just active one | `true` |
| `max_sessions_displayed` | Maximum sessions to show | 5 |

---

## Terminal Title Broadcasting

### How It Works

Every 15 seconds, the statusline-health-monitor broadcasts status to all Claude session terminals via ANSI escape codes:

```
Terminal Tab: "C🟢 | UT🫒 CA🌲"
              ↑          ↑
        Current     Other active sessions
        project     (sleeping sessions hidden)
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

### Status line not updating?

```bash
# Check if health verifier is running
ps aux | grep health-verifier

# Manually trigger health check
node scripts/health-verifier.js

# Check status files exist
ls -la .health/verification-status.json
ls -la .specstory/trajectory/live-state.json
```

### Wrong project showing as active?

```bash
# Check LSL registry
cat .lsl/global-registry.json | jq '.'

# Verify activity timestamps
cat .lsl/global-registry.json | jq '.sessions[] | {project, last_activity}'
```

### Session not showing that should be?

```bash
# Check if transcript monitor is running for that project
ps aux | grep enhanced-transcript-monitor | grep PROJECT_NAME

# Only sessions with running monitors are shown
```

### Docker MCP services showing unhealthy?

```bash
# Check if Docker containers are running
docker compose -f docker/docker-compose.yml ps

# Test individual health endpoints
curl http://localhost:3848/health  # Semantic Analysis
curl http://localhost:3849/health  # Constraint Monitor
curl http://localhost:3850/health  # Code Graph RAG

# Check container logs for errors
docker compose -f docker/docker-compose.yml logs coding-services
```

---

## Key Files

**Core System:**

| File | Purpose |
|------|---------|
| `scripts/tmux-session-wrapper.sh` | Tmux session wrapper — wraps all agents with unified status bar |
| `scripts/combined-status-line.js` | Main status line script (invoked by tmux `status-right`) |
| `scripts/statusline-health-monitor.js` | Session health monitor daemon |
| `scripts/health-verifier.js` | Health status provider |
| `lib/api-quota-checker.js` | API quota provider |
| `.lsl/global-registry.json` | LSL session registry |
| `.health/verification-status.json` | Health status cache |
| `.logs/statusline-health-status.txt` | Rendered status line output |

**Configuration:**

| File | Purpose |
|------|---------|
| `config/status-line-config.json` | Status line configuration |
| `config/live-logging-config.json` | API quota and provider config |
