# System Health Dashboard

Real-time monitoring dashboard for system-level health checks including databases, services, and processes.

## Architecture

- **Frontend**: Next.js 15.5.4 + React 19 + Redux Toolkit (MVI pattern)
- **Backend**: Express.js API server
- **Ports**:
  - Dashboard: 3032 (Next.js)
  - API: 3033 (Express)

## Features

- **Pre-Prompt Health Verification**: Automatic health check on every Claude prompt (via UserPromptSubmit hook)
- **Self-Monitoring**: Health API server monitors itself and auto-heals if down
- **Click-to-Restart Services**: One-click service restart buttons in the dashboard (NEW!)
- **Fast Health Detection**: 15-second verification interval for quick issue detection (improved from 60s)
- Real-time health monitoring (5s dashboard refresh)
- Database health (LevelDB, Qdrant)
- Service availability (VKB, Constraint Monitor, Dashboard, Health API)
- Process health (stale PIDs, zombies)
- Auto-healing status and history
- Manual verification trigger
- Detailed violation reports with actionable restart buttons
- System recommendations
- Staleness detection (triggers verification if data >5 minutes old)

## Quick Start

### Development

```bash
# Install dependencies
pnpm install

# Start API server (port 3033)
node server.js

# Start dashboard (port 3032) - in another terminal
pnpm dev
```

### Production

```bash
# Build dashboard
pnpm build

# Start both services
node server.js & pnpm start
```

## Environment Variables

All ports are configured in `../../.env.ports`:

- `SYSTEM_HEALTH_DASHBOARD_PORT` - Dashboard frontend port (default: 3032)
- `SYSTEM_HEALTH_API_PORT` - API backend port (default: 3033)

## API Endpoints

### GET `/api/health-verifier/status`
Returns current health verification status

```json
{
  "status": "success",
  "data": {
    "overallStatus": "degraded",
    "violationCount": 1,
    "criticalCount": 0,
    "lastUpdate": "2025-11-08T13:00:00.000Z",
    "autoHealingActive": false,
    "status": "operational",
    "ageMs": 5234
  }
}
```

### GET `/api/health-verifier/report`
Returns detailed health verification report with all checks and violations

### POST `/api/health-verifier/verify`
Triggers a manual health verification run

### POST `/api/health-verifier/restart-service`
Restarts a failed service with one click from the dashboard

**Request Body:**
```json
{
  "serviceName": "vkb_server",
  "action": "restart"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Service restart initiated: vkb_server",
  "data": {
    "service": "vkb_server",
    "action": "restart",
    "triggered_at": "2025-11-16T06:47:00.000Z",
    "note": "Health verification will run automatically to confirm service status"
  }
}
```

**Supported Services:**
- `vkb_server` - VKB visualization server (port 8080)
- `constraint_monitor` - Constraint monitor dashboard (port 3031)
- `dashboard_server` - System health dashboard (port 3030)

**Features:**
- ✅ **One-Click Restart**: Click the "Restart" button on any service error in the violations table
- ✅ **Visual Feedback**: Spinning icon during restart, success/error messages
- ✅ **Auto-Verification**: Health check runs automatically after restart (15s interval)
- ✅ **Tooltips**: Hover over restart button for detailed information
- ✅ **Smart Display**: Restart button only appears for service errors, not for warnings or database issues

**UI Behavior:**
1. Service violation appears in the "Active Violations" table
2. "Restart" button displayed in the "Actions" column (only for service errors)
3. Click button → service restarts in background
4. Button shows "Restarting..." with spinning icon
5. Success/error message appears below the issue description
6. Health verification runs automatically to update status
7. If successful, violation disappears within 15-30 seconds

## Redux Store Structure

```
healthStatus/       # Current health status state
  - overallStatus
  - violationCount
  - criticalCount
  - lastUpdate
  - autoHealingActive

healthReport/       # Detailed verification report
  - checks[]
  - violations[]
  - recommendations[]
  - summary

autoHealing/        # Auto-healing control
  - enabled
  - recentAttempts[]
  - triggeringVerification
```

## Integration with Health Verifier

This dashboard consumes data from:
- `scripts/health-verifier.js` - Health verification engine
- `.health/verification-status.json` - Quick status file
- `.health/verification-report.json` - Detailed report

### Pre-Prompt Health Hook

A UserPromptSubmit hook (`scripts/health-prompt-hook.js`) runs before every Claude prompt to ensure system health:

**Behavior:**
- Checks if verification data is stale (>5 minutes)
- Triggers async verification if needed (non-blocking)
- Provides health context to Claude in every response
- Blocks only critical failures (prevents work when system is broken)

**Configuration:**
The hook is configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/coding/scripts/health-prompt-hook.js",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

**Self-Monitoring:**
The health verification system now monitors its own API server at `http://localhost:3033/api/health` and auto-heals if it goes down:
- Check rule: `config/health-verification-rules.json` → `services.health_dashboard_api`
- Auto-heal action: `scripts/health-remediation-actions.js` → `restartHealthAPI()`

This ensures the health system itself is resilient and failsafe.

## Development

The dashboard follows the same architecture patterns as the Constraint Monitor Dashboard:
- Redux Toolkit for state management
- MVI (Model-View-Intent) architecture
- Middleware for auto-refresh and API calls
- TypeScript strict mode
- Tailwind CSS for styling
- Radix UI components

## Links

- Constraint Monitor Dashboard: http://localhost:3030
- System Health Dashboard: http://localhost:3032
- System Health API: http://localhost:3033

## Accessing Dashboards

### Via Browser
Navigate directly to the dashboard URLs listed above to view the health status and use the click-to-restart functionality.

### Via Status Line
The Claude Code status line displays health status emojis (✅/⚠️/❌) for quick visibility:
- The status line is **display-only** and does not support click events
- To access dashboards, you must manually navigate to the URLs above
- This is a limitation of Claude Code's status line system

**Status Line Indicators:**
- 📦🗄️✅ - All databases healthy
- 🔍📊✅ - All services operational
- ⚙️✅ - All processes healthy
- ⚠️ - Warnings detected (1+ violations)
- ❌ - Errors detected (requires attention)

For detailed violation information and one-click restart capabilities, visit the System Health Dashboard at http://localhost:3032
