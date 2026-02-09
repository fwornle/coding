# Health System

Automatic system health monitoring and self-healing that ensures a stable development environment.

![System Health Dashboard](../images/health-monitor.png)

## What It Provides

The Health System provides **failsafe monitoring** with automatic verification and recovery:

- **Pre-Prompt Checks** - Verifies system health before every Claude prompt
- **Self-Monitoring** - The health system monitors itself
- **Auto-Healing** - Automatically restarts failed services
- **Status Line** - Real-time indicators in Claude Code status bar with API quota monitoring
- **Dashboard** - Visual monitoring at `http://localhost:3032` with 4-card system (Databases, Services, Processes, API Quota)

## Architecture

![Health System Architecture](../images/enhanced-health-monitoring-overview.png)

### Core Components

The health system is built on interconnected components with active supervision:

![Health System Classes](../images/health-system-classes.png)

| Component | File | Purpose |
|-----------|------|---------|
| **GlobalProcessSupervisor** | `global-process-supervisor.js` | Active supervision - 30s checks, restarts dead services, OS-level re-registration |
| **GlobalServiceCoordinator** | `global-service-coordinator.js` | Constraint service management with spawn guards and rate limiting |
| **HealthVerifier** | `health-verifier.js` | Core verification engine with dynamic discovery & auto-healing |
| **StatusLineHealthMonitor** | `statusline-health-monitor.js` | Health aggregation for tmux status bar |
| **CombinedStatusLine** | `combined-status-line.js` | Status display + fallback supervisor (GPS heartbeat-gated) |
| **StatusLineFastPath** | `status-line-fast.cjs` | Ultra-fast CJS cache reader (~60ms) for tmux `status-right` |
| **EnhancedTranscriptMonitor** | `enhanced-transcript-monitor.js` | Real-time per-project transcript monitoring |
| **LiveLoggingCoordinator** | `live-logging-coordinator.js` | Logging orchestration with multi-user support |
| **ProcessStateManager** | `process-state-manager.js` | Unified registry with atomic file locking (used by all) |
| **AutoRestartWatcher** | `auto-restart-watcher.js` | File-change detection — daemons exit cleanly on code change, supervision restarts with new code |

### Supervision Architecture

![Health Monitoring Architecture](../images/enhanced-health-monitoring-overview.png)

**Cache Layer** - `status-line-fast.cjs` serves pre-rendered cache in ~60ms (CJS, no ESM overhead)
**Display + Fallback Layer** - CombinedStatusLine renders full status, writes cache; ensure* functions gated by GPS heartbeat
**Active Supervision Layer** - GlobalProcessSupervisor actively monitors and restarts dead services with OS-level fallback discovery
**Service Coordination Layer** - GlobalServiceCoordinator manages constraint services with spawn guards
**Verification Layer** - HealthVerifier runs periodic checks with dynamic project discovery
**Status Aggregation Layer** - StatusLineHealthMonitor + CombinedStatusLine display health
**Per-Project Layer** - EnhancedTranscriptMonitor + LiveLoggingCoordinator per session
**Core Infrastructure** - ProcessStateManager provides unified process registry

### Spawn Storm Prevention

The supervision architecture includes multiple guards to prevent runaway process spawning:

| Guard | Component | Mechanism |
|-------|-----------|-----------|
| **GPS heartbeat gate** | CombinedStatusLine | ensure* functions skip when GPS heartbeat <60s old |
| **OS-level dup check** | GlobalServiceCoordinator | `findRunningProcessesByScript()` before every spawn |
| **Orphan kill** | GlobalServiceCoordinator | Kills spawned process if post-spawn health check fails |
| **Cooldown** | GPS (5min), Coordinator (2min) | Per-service cooldown between restart attempts |
| **Rate limiting** | GPS (10/hr), Coordinator (6/hr) | Maximum restarts per service per hour |
| **OS-level re-registration** | GlobalProcessSupervisor | Re-registers running-but-unregistered services instead of respawning |
| **Health file staleness** | GlobalProcessSupervisor | 120s threshold (2× write interval) prevents false-positive "dead" detection |

### Key Features

- **CJS Fast-Path Cache** - `status-line-fast.cjs` serves status in ~60ms via pre-rendered cache file, eliminating ESM module loading overhead (was 2-18s under load)
- **Dynamic Discovery** - Discovers ALL projects from PSM, health files, and Claude transcript directories
- **Active Supervision** - GlobalProcessSupervisor actively restarts dead monitors within 30 seconds
- **OS-Level Fallback** - GPS re-registers running-but-unregistered services (prevents blind respawn cycles)
- **Auto-Restart on Code Change** - Daemons watch their own source files and exit cleanly when code changes, relying on supervision to restart with updated code
- **Spawn Storm Prevention** - Multi-layered guards: GPS heartbeat gating, OS-level duplicate checks, orphan kill, cooldowns, and rate limiting
- **Cooldown Protection** - GPS: 5-minute cooldown per service; Coordinator: 2-minute cooldown
- **Rate Limiting** - GPS: Max 10 restarts/hour; Coordinator: Max 6 restarts/hour per service
- **Fallback Supervision** - CombinedStatusLine provides backup restart only when GPS heartbeat is stale
- **Active Session Gating** - Transcript monitors only spawned for sessions with transcript activity in the last 2 minutes
- **Multi-Agent Detection** - Detects Claude, Copilot, and OpenCode sessions via process scanning
- **Agent Age Cap** - Running agent's display age capped at monitor uptime; transcripts with `status: 'not_found'` (e.g., OpenCode) correctly show as inactive instead of falsely green
- **Intentional Stop Markers** - Graceful shutdown marks project as stopped, preventing restart loops

## Component Details

### GlobalProcessSupervisor (`scripts/global-process-supervisor.js`) - Active Supervision
- **Active supervision of ALL transcript monitors and global services**
- 30-second supervision loop with dynamic project discovery
- Discovers projects from: PSM registry, health files, Claude transcript directories
- **OS-level fallback**: When PSM says "not registered", checks OS process table via `findRunningProcessesByScript()` — re-registers alive services instead of blind respawn
- Health file staleness threshold: **120 seconds** (2× write interval, prevents false-positive "dead" detection at boundary)
- 5-minute cooldown per service prevents restart storms
- Max 10 restarts per hour per service (safety limit)
- Respects intentional stop markers (skips projects that were gracefully shut down)
- Auto-restarts on code change via AutoRestartWatcher
- Heartbeat file: `.health/supervisor-heartbeat.json`
- Started via: `start-services-robust.js` or manually

### ProcessStateManager (`scripts/process-state-manager.js`) - Core Infrastructure
- Unified registry for all system processes
- Atomic file operations via proper-lockfile
- Session-aware process tracking (global, per-project, per-session)
- Storage: `.live-process-registry.json`

### HealthVerifier (`scripts/health-verifier.js`) - Verification Layer
- Core verification engine with 60-second periodic checks
- **Dynamic discovery of ALL projects** (enabled via `dynamic_discovery: true` in config)
- Checks databases (LevelDB, Qdrant, SQLite, Memgraph), services, processes
- Generates health scores (0-100) per service
- Triggers auto-healing via HealthRemediationActions

### StatusLineHealthMonitor (`scripts/statusline-health-monitor.js`) - Status Aggregation
- Health aggregation for tmux status bar
- 15-second update interval with auto-healing
- Detects all agent types: Claude, Copilot, OpenCode (via process scanning)
- **Agent age cap**: running agent's age capped at monitor uptime — fresh sessions start green and cool naturally
- **not_found transcript guard**: agents without Claude-compatible transcripts (e.g., OpenCode) correctly show as inactive (⚫) instead of falsely active (🟢)
- Sessions removed only when agent process exits, never hidden
- Outputs to: `.logs/statusline-health-status.txt`

### CombinedStatusLine (`scripts/combined-status-line.js`) - Display + Fallback Supervisor
- **Display-first**: renders full status bar with all segments
- **GPS heartbeat gate**: ensure* functions only run when GPS heartbeat is stale (>60s) — eliminates overlapping supervision
- When GPS is running (normal case): CSL is display-only, writes cache to `.logs/combined-status-line-cache.txt`
- When GPS is dead: CSL acts as fallback supervisor for GPS, SHM, and transcript monitors
- 2-minute active session gating — only spawns monitors for projects with transcript activity in last 2 min
- Respects intentional stop markers (prevents restart loops after graceful shutdown)

### StatusLineFastPath (`scripts/status-line-fast.cjs`) - Cache Reader
- **Ultra-fast CJS cache reader** (~60ms) — invoked by tmux `status-right` every 5 seconds
- CommonJS module (no ESM overhead) — eliminates the 2-18 second ESM module resolution penalty under system load
- Reads pre-rendered status from `.logs/combined-status-line-cache.txt`
- If cache <60s old: serves immediately
- If cache >20s old: triggers background CSL refresh (detached, non-blocking)
- If cache missing/stale: falls back to synchronous full CSL execution
- Configured in `tmux-session-wrapper.sh` for all new sessions

### EnhancedTranscriptMonitor (`scripts/enhanced-transcript-monitor.js`) - Per-Project
- Real-time transcript monitoring per project
- 2-second check interval for prompt detection
- Writes health files to centralized `.health/` directory
- Generates LSL files in `.specstory/history/`
- Auto-restarts on code change via AutoRestartWatcher
- Marks project as intentionally stopped on graceful shutdown (prevents restart loops)

### LiveLoggingCoordinator (`scripts/live-logging-coordinator.js`) - Logging
- Orchestrates live logging components
- Manages LSLFileManager and operational logging
- Multi-user support with user hash tracking
- Performance metrics collection

### Supporting Components

**Pre-Prompt Hook** (`scripts/health-prompt-hook.js`)
- Runs automatically before every Claude prompt
- Returns cached status if fresh (<5 minutes)
- Spawns async verification if stale

**Auto-Healing** (`scripts/health-remediation-actions.js`)
- Automatic service restart capabilities
- Database lock cleanup
- Zombie process termination

**Crash Recovery** (`scripts/start-services-robust.js`)
- Pre-startup cleanup of dangling processes
- Automatic cleanup after VSCode/Claude crashes
- Graceful shutdown tracking for crash detection

**Orphan Cleanup** (`bin/cleanup-orphans`)
- Manual cleanup utility for orphaned processes
- Targets stuck ukb/vkb operations, invalid transcript monitors
- Dry-run mode for safe previewing

**Status Line Display** (`scripts/combined-status-line.js`)
- Reads from StatusLineHealthMonitor output
- Real-time indicators in Claude Code status bar
- Multi-session support with smart abbreviations

**API Quota Checker** (`lib/api-quota-checker.js`)
- Shared library for LLM provider quota monitoring
- Multi-provider support with smart caching
- Used by both statusline and dashboard

**Dashboard** (`integrations/system-health-dashboard/`)
- React-based real-time visualization at port 3032
- 4-card monitoring system (Databases, Services, Processes, API Quota)
- UKB Workflow Monitor with visual workflow graph of agent execution
- Service status indicators
- Auto-healing history
- Manual restart controls
- Real-time API quota tracking

![UKB Workflow Monitor](../images/health-monitor-multi-agent-wf.png)

## What It Monitors

### Databases
- **LevelDB** - Knowledge graph storage
- **Qdrant** - Vector database (port 6333)
- **SQLite** - Analytics database
- **Memgraph** - Code graph database (port 7687 Bolt protocol, port 3100 Lab UI)
- **CGR Cache** - Code graph index staleness (commit tracking)

### Services
- **VKB Server** - Knowledge visualization (port 8080)
- **Constraint Monitor Dashboard** - Code quality UI (port 3030)
- **Constraint Monitor API** - Code quality enforcement (port 3031)
- **System Health Dashboard UI** - Health monitoring UI (port 3032)
- **System Health Dashboard API** - Health monitoring API (port 3033)

### Docker MCP Servers (Docker Mode Only)
When running in Docker mode, the health system also monitors MCP SSE servers:
- **Semantic Analysis SSE** - AI analysis server (port 3848)
- **Constraint Monitor SSE** - Constraint enforcement MCP (port 3849)
- **Code Graph RAG SSE** - Code graph analysis MCP (port 3850)
- **Browser Access SSE** - Browser automation MCP (port 3847)

### Processes
- Stale PID detection
- Zombie cleanup
- Resource monitoring

### Transcript Monitor
- **LSL Health** - Verifies transcript monitor is running and processing
- **Exchange Activity** - Tracks exchange count and last processed UUID
- **Suspicious Activity** - Detects stuck or stale monitors

### API Quota
- **Groq** - Free tier (`Gq●`) or monthly billing (`Gq$2JAN`)
- **Google Gemini** - Free tier quota (15 RPM, 1M TPD)
- **Anthropic Claude** - Prepaid credits (`A$18`) or billing-based
- **OpenAI** - Prepaid credits or billing-based
- **X.AI (Grok)** - Free credits monitoring (`X$25`)

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

## Docker Mode Support

The health system is fully Docker-aware and adapts its behavior based on the deployment mode.

### Docker Mode Detection

![Docker Health Detection](../images/docker-health-detection.png)

The system detects Docker mode using a 3-tier priority check:

1. **Environment Variable** (highest priority): `CODING_DOCKER_MODE=true`
2. **Marker File**: `.docker-mode` file in coding repo root
3. **Container Detection**: `/.dockerenv` file (inside containers)

This detection is used by:
- `health-verifier.js` - Adapts CGR cache checks
- `health-remediation-actions.js` - Uses appropriate restart commands
- `statusline-health-monitor.js` - Includes Docker MCP health

### CGR Cache Staleness in Docker

In Docker mode, the `.git` directory is not mounted (for performance), so the CGR cache staleness check cannot count commits behind. Instead:

- **Native Mode**: Runs `cgr-cache-staleness.sh` to count commits since last index
- **Docker Mode**: Reads `cache-metadata.json` directly for cached commit info

The dashboard displays:
- Native: "CGR cache: 5 commits behind" or "Current"
- Docker: "coding @ abc123" (shows cached commit, staleness unknown)

### Service Supervision Hierarchy

![Supervisor Restart Hierarchy](../images/supervisor-restart-hierarchy.png)

The health system uses a **multi-layer resilience architecture** with spawn storm prevention:

| Layer | Component | Trigger | What It Supervises | Spawn Guards |
|-------|-----------|---------|-------------------|--------------|
| Cache | StatusLineFastPath | Every 5s (tmux) | N/A (read-only) | N/A |
| 1 | CombinedStatusLine | Cache miss | GPS, SHM (fallback only) | GPS heartbeat gate |
| 2 | GlobalProcessSupervisor | 30s loop | HealthVerifier, SHM, TranscriptMonitors | OS dup check, re-registration, 120s staleness |
| 2 | GlobalServiceCoordinator | 15s loop | Constraint services (api, dashboard) | OS dup check, orphan kill, 2m cooldown, 6/hr limit |
| 3 | HealthVerifier | 60s loop | Databases, Services, Processes | N/A |

**Key Guarantee**: If any service dies, it will be restarted within:
- 30 seconds (by GlobalProcessSupervisor)
- Or the next cache miss (by CombinedStatusLine as fallback supervisor, only if GPS is also dead)

## Quick Start

### View Dashboard

```bash
# Dashboard automatically available at:
http://localhost:3032

# Or start manually:
cd integrations/system-health-dashboard
npm run dev
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

**Native Mode:**
```
[C🟢 UT🫒] [🛡️ 67% 🔍EX] [Gq$2JAN A$18 X$25] [📚✅] [🏥✅] 📋17-18
```

**Docker Mode:**
```
[🐳] [🐳MCP:✅] [C🟢 UT🫒] [🛡️ 67% 🔍EX] [Gq$2JAN A$18 X$25] [📚✅] [🏥✅] 📋17-18
```

**Components:**
- `[🐳]` - Docker mode indicator (only shown when running in Docker mode)
- `[🐳MCP:✅]` - Docker MCP health: SA=Semantic Analysis, CM=Constraint Monitor, CGR=Code Graph RAG
- `[C🟢 UT🫒]` - Active sessions with activity icons (all sessions shown, 💤 for sleeping)
- `[🛡️ 67% 🔍EX]` - Constraint compliance percentage + trajectory state
- `[Gq$2JAN A$18 X$25]` - API quota status (Groq $2 spent in Jan, etc.)
- `[📚✅]` - Knowledge system status (icons only, no counts)
- `[🏥✅]` - Unified health (GCM + Health Verifier + Enforcement)
- `📋17-18` - LSL time window (HHMM-HHMM)

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

**Core Health Components**:
- `scripts/global-process-supervisor.js` - Active supervision of all services (with OS-level re-registration)
- `scripts/global-service-coordinator.js` - Constraint service management (with spawn guards)
- `scripts/process-state-manager.js` - Unified process registry with atomic locking
- `scripts/health-verifier.js` - Core verification with dynamic discovery & auto-healing
- `scripts/statusline-health-monitor.js` - Health aggregation daemon
- `scripts/combined-status-line.js` - Status display + fallback supervisor
- `scripts/status-line-fast.cjs` - Ultra-fast CJS cache reader (~60ms) for tmux
- `scripts/enhanced-transcript-monitor.js` - Per-project monitoring
- `scripts/live-logging-coordinator.js` - Logging orchestration

**Supporting Scripts**:
- `scripts/auto-restart-watcher.js` - File-change detection for daemon code reloading
- `scripts/health-prompt-hook.js` - Pre-prompt integration
- `scripts/health-remediation-actions.js` - Auto-healing actions
- `scripts/start-services-robust.js` - Service startup with supervisor
- `scripts/tmux-session-wrapper.sh` - Tmux session wrapper (configures status-line-fast.cjs)
- `lib/api-quota-checker.js` - API quota checking (shared library)

**Data Files**:
- `.live-process-registry.json` - ProcessStateManager registry
- `.health/supervisor-heartbeat.json` - GlobalProcessSupervisor heartbeat
- `.health/verification-status.json` - HealthVerifier output
- `.health/*-transcript-monitor-health.json` - Per-project health files
- `.logs/statusline-health-status.txt` - StatusLineHealthMonitor output
- `.logs/combined-status-line-cache.txt` - Pre-rendered status cache (served by fast-path)

**Configuration**:
- `config/health-verification-rules.json` - Health check rules with `dynamic_discovery` flag

**Dashboard**:
- `integrations/system-health-dashboard/server.js` - API server (port 3033)
- `integrations/system-health-dashboard/src/` - React UI (port 3032)
- `integrations/system-health-dashboard/src/store/slices/apiQuotaSlice.ts` - API quota state

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
