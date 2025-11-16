# Health System

Automatic system health monitoring and self-healing that ensures a stable development environment.

## What It Provides

The Health System provides **failsafe monitoring** with automatic verification and recovery:

- **Pre-Prompt Checks** - Verifies system health before every Claude prompt
- **Self-Monitoring** - The health system monitors itself
- **Auto-Healing** - Automatically restarts failed services
- **Status Line** - Real-time indicators in Claude Code status bar
- **Dashboard** - Visual monitoring at `http://localhost:3030`

## Architecture

![Health System Architecture](../images/enhanced-health-monitoring-overview.png)

### 4-Layer Monitoring Architecture

![Multi-Session Health Monitoring](../images/multi-session-health-architecture.png)

**Layer 1: Health Verifier** - Core verification engine
**Layer 2: Pre-Prompt Hook** - Automatic health checks
**Layer 3: Auto-Healing** - Remediation actions
**Layer 4: Dashboard & Status Line** - Visualization

## Core Components

**Health Verifier** (`scripts/health-verifier.js`)
- Checks databases, services, and processes
- Generates health scores (0-100) per service
- Triggers auto-healing when failures detected

**Pre-Prompt Hook** (`scripts/health-prompt-hook.js`)
- Runs automatically before every Claude prompt
- Returns cached status if fresh (<5 minutes)
- Spawns async verification if stale

**Auto-Healing** (`scripts/health-remediation-actions.js`)
- Automatic service restart capabilities
- Database lock cleanup
- Zombie process termination

**Status Line** (`scripts/combined-status-line.js`)
- Real-time indicators in Claude Code status bar
- Multi-session support
- Integrated health, constraint, trajectory, and LSL status

**Dashboard** (`integrations/system-health-dashboard/`)
- React-based real-time visualization at port 3030
- Service status indicators
- Auto-healing history
- Manual restart controls

## What It Monitors

### Databases
- **LevelDB** - Knowledge graph storage
- **Qdrant** - Vector database (port 6333)
- **SQLite** - Analytics database

### Services
- **VKB Server** - Knowledge visualization (port 8080)
- **Constraint Monitor** - Code quality enforcement (port 3031)
- **Dashboard Server** - Health dashboard (port 3030)
- **Health API** - Self-monitoring API (port 3033)

### Processes
- Stale PID detection
- Zombie cleanup
- Resource monitoring

## How It Works

![Health Verification Flow](../images/health-verification-flow.png)

**Quick Flow**:
1. User issues Claude prompt
2. Pre-prompt hook fires
3. Check health status (<5 min old? Use cache : Spawn verification)
4. Background verification checks all systems
5. Auto-healing triggers if failures detected
6. Status updated in dashboard and status line

**Detailed Flow**: See [Enhanced Health Monitoring](./enhanced-health-monitoring.md)

## Quick Start

### View Dashboard

```bash
# Dashboard automatically available at:
http://localhost:3030

# Or start manually:
cd integrations/system-health-dashboard
PORT=3030 npm run dashboard
```

### Check System Health

```bash
# Manual health check
node scripts/health-verifier.js

# View status
cat .health/verification-status.json | jq '.'
```

### Status Line

The status line appears automatically in Claude Code:

```
[🏥 95% | 🛡️ 94% ⚙️ IMP | 📋🟠2130-2230(3min) →coding]
```

See [Status Line System](./status-line.md) for complete documentation.

## Detailed Documentation

### In-Depth Guides

- **[Status Line System](./status-line.md)** - Complete status line documentation including architecture, state diagrams, multi-session support, and configuration
- **[Enhanced Health Monitoring](./enhanced-health-monitoring.md)** - Comprehensive health monitoring system with auto-recovery, plug'n'play behavior, and session management
- **[4-Layer Architecture](./4-layer-architecture-implementation-plan.md)** - Detailed architectural design and implementation plan
- **[Monitoring System](./monitoring-system.md)** - Core monitoring components and integration patterns
- **[Process Management](./process-management-analysis.md)** - Process lifecycle management and recovery mechanisms
- **[Robust Startup System](./robust-startup-system.md)** - Service startup, initialization, and failsafe mechanisms

### Related Systems

- **[System Health Dashboard](../../integrations/system-health-dashboard/)** - Dashboard UI and API documentation
- **[LSL](../lsl/)** - Health events logged in session logs
- **[Constraints](../constraints/)** - Constraint monitor is a monitored service
- **[Knowledge Management](../knowledge-management/)** - Monitors VKB, LevelDB, Qdrant
- **[Trajectories](../trajectories/)** - Trajectory state shown in status line

## Key Files

**Core System**:
- `scripts/health-verifier.js` - Main verification logic
- `scripts/health-prompt-hook.js` - Pre-prompt integration
- `scripts/health-remediation-actions.js` - Auto-healing actions
- `scripts/combined-status-line.js` - Status line display
- `.health/verification-status.json` - Current health status

**Dashboard**:
- `integrations/system-health-dashboard/src/dashboard-server.js` - API server
- `integrations/system-health-dashboard/src/dashboard/` - React UI

## Troubleshooting

**Dashboard not loading?**
```bash
curl http://localhost:3033/api/health
PORT=3030 npm run dashboard
```

**Services stuck unhealthy?**
```bash
node scripts/health-verifier.js
cat .health/verification-status.json | jq '.'
```

**Auto-healing not working?**
```bash
cat logs/health-remediation.log
cat scripts/health-checks-config.json | jq '.vkb_server.auto_heal'
```

For comprehensive troubleshooting, see [Enhanced Health Monitoring](./enhanced-health-monitoring.md#troubleshooting).
