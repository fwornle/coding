# Health Verification System

Automatic system health verification that runs on every Claude prompt, ensuring a stable and self-healing development environment.

## Overview

The Health Verification System provides **failsafe monitoring** with three key features:
1. **Pre-Prompt Health Checks** - Verifies system health before every Claude prompt
2. **Self-Monitoring** - The health system monitors itself
3. **Auto-Healing** - Automatically restarts failed services

## Architecture

![Health Verification Flow](../images/health-verification-flow.png)

The diagram shows the complete flow from user prompt to health verification:

1. **User types prompt** → Claude Code receives it
2. **UserPromptSubmit hook fires** → Executes health-prompt-hook.js
3. **Hook checks status file** → Reads .health/verification-status.json
4. **If data is fresh** (<5 min) → Returns health context immediately
5. **If data is stale** (>5 min) → Spawns async verification + returns "refreshing" context
6. **Background verification** → Checks all services, auto-heals failures, updates status
7. **Claude receives context** → Prompt processed with health information

## Components

### 1. Pre-Prompt Hook

**File**: `scripts/health-prompt-hook.js`

**Trigger**: Every Claude prompt (via UserPromptSubmit hook)

**Behavior**:
- Checks if `.health/verification-status.json` is fresh (<5 minutes)
- If stale: Spawns async health verification (doesn't wait)
- Provides health status as additional context to Claude
- Blocks prompt only if critical failures are active

**Output Format**:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "✅ System Health: All systems operational (verified 23s ago)\n"
  }
}
```

### 2. Health Verifier

**File**: `scripts/health-verifier.js`

**Checks**:
- **Databases**: LevelDB locks, Qdrant availability, graph integrity
- **Services**: VKB server, constraint monitor, dashboard server, **health API** (self-monitoring)
- **Processes**: Stale PIDs, zombie processes, resource usage

**Self-Monitoring Check**:
```json
{
  "health_dashboard_api": {
    "enabled": true,
    "severity": "error",
    "check_type": "http_health",
    "endpoint": "http://localhost:3033/api/health",
    "auto_heal": true,
    "auto_heal_action": "restart_health_api"
  }
}
```

The health system verifies its own API server is running and auto-heals if down.

### 3. Auto-Healing

**File**: `scripts/health-remediation-actions.js`

**Actions**:
- `restart_vkb_server` - Restart VKB visualization server
- `restart_constraint_monitor` - Restart constraint monitoring API
- `restart_dashboard_server` - Restart constraint dashboard
- `restart_health_api` - Restart health API server (self-healing)
- `start_qdrant` - Start Qdrant Docker container
- `kill_lock_holder` - Kill process holding LevelDB lock
- `cleanup_dead_processes` - Remove stale PID registrations
- `cleanup_zombies` - Clean up zombie processes

### 4. System Health Dashboard

**Location**: `integrations/system-health-dashboard/`

**Ports**:
- Frontend: `http://localhost:3032` (Vite + React)
- Backend API: `http://localhost:3033` (Express)

**Features**:
- Real-time monitoring (5s refresh via WebSocket)
- Database, service, and process health
- Violation history and recommendations
- Manual verification trigger
- Auto-healing status

## Configuration

### Hook Setup

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/q284340/Agentic/coding/scripts/health-prompt-hook.js",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### Verification Rules

Rules are defined in `config/health-verification-rules.json`:

```json
{
  "version": "1.0.0",
  "verification": {
    "interval_seconds": 60,
    "report_retention_days": 7,
    "max_report_history": 1000
  },
  "rules": {
    "databases": { /* ... */ },
    "services": { /* ... */ },
    "processes": { /* ... */ }
  }
}
```

Each rule defines:
- `enabled`: Whether to run this check
- `severity`: `info`, `warning`, `error`, `critical`
- `check_type`: Type of health check to perform
- `auto_heal`: Whether to attempt auto-healing
- `auto_heal_action`: Action to execute if check fails

## Data Files

### Status File
**Path**: `.health/verification-status.json`

Quick status summary:
```json
{
  "overallStatus": "healthy",
  "violationCount": 0,
  "criticalCount": 0,
  "lastUpdate": "2025-11-10T06:11:21.553Z",
  "autoHealingActive": false
}
```

### Report Files
**Path**: `.health/verification-history/report-{timestamp}.json`

Detailed verification reports with:
- All check results
- Violation details
- Auto-healing attempts
- Recommendations
- Performance metrics

## Usage

### Manual Verification

```bash
# Run one-time verification
node scripts/health-verifier.js verify

# Start daemon mode (continuous monitoring)
node scripts/health-verifier.js start

# Check current status
node scripts/health-verifier.js status

# View detailed report
node scripts/health-verifier.js report
```

### Dashboard Access

```bash
# Start API server (port 3033)
cd integrations/system-health-dashboard
npm run api

# Start dashboard (port 3032)
npm run dev
```

Then visit: `http://localhost:3032`

## How It Works

### Typical Flow

1. **User types prompt in Claude Code**
2. **UserPromptSubmit hook fires** (health-prompt-hook.js)
3. **Hook checks** `.health/verification-status.json` age
4. **If fresh (<5 min)**: Adds health context, allows prompt
5. **If stale (>5 min)**: Triggers async verification, adds "refreshing" context
6. **Background verification runs**: Checks all services, databases, processes
7. **Auto-healing activates**: Restarts any failed services
8. **Status updated**: `.health/verification-status.json` written
9. **Next prompt**: Shows fresh health data

### Staleness Detection

Data is considered **stale** if the file modification time is >5 minutes old.

When stale:
- Hook triggers async verification (doesn't wait for it to complete)
- Claude receives: `🔄 System Health: Verification triggered (data was stale)`
- Verification runs in background
- Next prompt gets fresh data

### Critical Failure Blocking

If recent data shows **critical failures**:
- Hook blocks the prompt with error message
- User sees: `🚨 CRITICAL SYSTEM FAILURE DETECTED`
- Prompt is NOT sent to Claude
- User must fix critical issues first

## Benefits

### For Users
- ✅ **No stale monitoring** - Every prompt ensures fresh health data
- ✅ **No manual intervention** - System heals itself automatically
- ✅ **Invisible when working** - <100ms overhead per prompt
- ✅ **Clear feedback** - Health status appears in every response

### For System Reliability
- ✅ **Self-monitoring** - Health system checks itself
- ✅ **Failsafe** - Can't start work with broken system
- ✅ **Auto-recovery** - Failed services restart automatically
- ✅ **No silent failures** - All issues logged and reported

## Troubleshooting

### Health hook not running

Check settings:
```bash
cat ~/.claude/settings.json | jq '.hooks.UserPromptSubmit'
```

Verify hook file exists:
```bash
ls -la scripts/health-prompt-hook.js
```

Test hook manually:
```bash
echo '{"session_id":"test","prompt":"test"}' | node scripts/health-prompt-hook.js
```

### Verification data always stale

Check if verifier is running:
```bash
ps aux | grep health-verifier
```

Run manual verification:
```bash
node scripts/health-verifier.js verify
```

### Health API not responding

Check if running:
```bash
lsof -i :3033
```

Start manually:
```bash
cd integrations/system-health-dashboard
npm run api
```

Test endpoint:
```bash
curl http://localhost:3033/api/health
```

### Auto-healing not working

Check remediation logs:
```bash
cat .health/verification-history/report-*.json | jq '.metadata.auto_healing'
```

Verify rules have `auto_heal: true`:
```bash
cat config/health-verification-rules.json | jq '.rules.services'
```

## Performance

- **Hook overhead**: ~50-100ms per prompt
- **Verification runtime**: ~1-2 seconds for all checks
- **Staleness threshold**: 5 minutes
- **Dashboard refresh**: 5 seconds
- **Auto-heal cooldown**: Configurable per action

## Related Systems

- **[Status Line System](status-line.md)** - Visual health indicators in Claude's status bar
- **[Constraint Monitoring](constraint-monitoring.md)** - Code quality enforcement
- **[Live Session Logging](live-session-logging.md)** - Session activity monitoring

## Future Enhancements

- [ ] Configurable staleness threshold per user
- [ ] Webhook notifications for critical failures
- [ ] Historical trending and anomaly detection
- [ ] Integration with external monitoring (Prometheus, Grafana)
- [ ] Mobile dashboard app
- [ ] Slack/Discord notifications for auto-healing events
