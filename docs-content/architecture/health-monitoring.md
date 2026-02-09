# Health Monitoring

Multi-layer supervision architecture for system reliability with multi-agent support and spawn storm prevention.

![Health System Architecture](../images/enhanced-health-monitoring-overview.png)

## Architecture Overview

The health monitoring system uses a **multi-layer resilience architecture** with spawn storm prevention to ensure services stay running, with automatic recovery at each level.

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

## Cache Layer: Fast-Path

**Component**: `scripts/status-line-fast.cjs`

**Function**: Ultra-fast CJS cache reader (~60ms) — invoked by tmux `status-right` every 5 seconds

- CommonJS module (no ESM overhead) — eliminates 2-18s ESM module resolution under system load
- Reads pre-rendered status from `.logs/combined-status-line-cache.txt`
- If cache <60s old: serves immediately
- If cache >20s old: triggers background refresh via `combined-status-line.js` (detached, non-blocking)
- Falls back to synchronous full CSL only if cache missing or >60s stale

## Layer 1: Display + Fallback Supervisor

**Component**: `scripts/combined-status-line.js`

**Function**: Full status display + fallback supervisor (GPS heartbeat-gated)

- Renders full status bar with all segments (health, quota, sessions, compliance, knowledge, LSL)
- Writes pre-rendered output to `.logs/combined-status-line-cache.txt`
- **GPS heartbeat gate**: ensure* supervision functions only run when GPS heartbeat is stale (>60s)
- When GPS is running (normal): display-only, no process spawning
- When GPS is dead: fallback supervisor for GPS, SHM, and transcript monitors
- 2-minute active session gating (only spawns monitors for actively-written transcripts)
- Respects intentional stop markers (prevents restart loops)

## Layer 2: Active Supervision

### GlobalProcessSupervisor

**Component**: `scripts/global-process-supervisor.js`

**Function**: Continuous supervision of all services with OS-level fallback

- 30-second supervision loop with dynamic project discovery
- Discovers projects from: PSM registry, health files, Claude transcript directories
- **OS-level fallback**: When PSM says "not registered", checks OS process table via `findRunningProcessesByScript()` — re-registers alive services instead of blind respawn
- Health file staleness threshold: **120 seconds** (2× write interval, prevents false-positive "dead" detection at boundary)
- 5-minute cooldown per service prevents restart storms
- Max 10 restarts per hour per service (safety limit)
- Respects intentional stop markers
- Auto-restarts on own code change via AutoRestartWatcher
- Heartbeat file: `.health/supervisor-heartbeat.json`

### GlobalServiceCoordinator

**Component**: `scripts/global-service-coordinator.js`

**Function**: Manages constraint services (api-service port 3031, dashboard-service port 3030)

- 15-second health check loop with port-based liveness checks
- **OS-level duplicate check** via `findRunningProcessesByScript()` before every spawn
- **Orphan kill**: Kills spawned process if post-spawn health check fails (prevents accumulation)
- **Cooldown**: 2-minute per-service cooldown between restart attempts
- **Rate limiting**: Max 6 restarts per service per hour

## Layer 3: Verification & Auto-Healing

**Component**: `scripts/health-verifier.js`

**Function**: Periodic health verification with auto-healing

- 60-second periodic checks
- Dynamic discovery of ALL projects
- Checks databases (LevelDB, Qdrant, SQLite, Memgraph), services, processes
- Generates health scores (0-100) per service
- Triggers auto-healing via HealthRemediationActions

## Status Aggregation

**Component**: `scripts/statusline-health-monitor.js`

**Function**: Aggregates health from all layers for display

- 15-second update interval with auto-healing
- Multi-agent detection: Claude, Copilot, OpenCode (via process scanning)
- Agent age cap: running agent's display age capped at monitor uptime
- **Not-found transcript guard**: agents without Claude-compatible transcripts (e.g., OpenCode) correctly show as ⚫ inactive instead of falsely 🟢 active
- Sessions only removed when agent process exits, never hidden
- Outputs to: `.logs/statusline-health-status.txt`

### Multi-Agent Detection

The health monitor detects all coding agent types by scanning process tables:

| Agent | Binary | Detection |
|-------|--------|-----------|
| Claude | `claude` | `ps -eo pid,comm` exact match |
| Copilot | `copilot` | Path-ending match `/copilot$` |
| OpenCode | `opencode` | Path-ending match `/opencode$` |

Agent project association is resolved via `lsof -p <PID> | grep cwd` → extracts project name from `/Agentic/<project>` path.

### Session Lifecycle

Sessions use a graduated cooling scheme based on idle time:

```
🟢 Active → 🌲 Cooling → 🫒 Fading → 🪨 Dormant → ⚫ Inactive → 💤 Sleeping
   <5min      5-15min     15m-1hr     1-6hr        6-24hr       >24hr
```

- **Agent running**: Age capped at monitor uptime (fresh sessions start green, cool naturally)
- **No agent**: Removed from display (session closed)
- **Never hidden**: All states are visible, including 💤 sleeping

## Per-Project Monitoring

**Component**: `scripts/enhanced-transcript-monitor.js`

**Function**: Real-time transcript monitoring per project

- 2-second check interval for prompt detection
- Writes health files to centralized `.health/` directory
- Generates LSL files in `.specstory/history/`
- Auto-restarts on code change via AutoRestartWatcher
- Marks project as intentionally stopped on graceful shutdown

## Auto-Restart on Code Change

**Component**: `scripts/auto-restart-watcher.js`

**Function**: Watches script files on disk for changes

- Uses `fs.watchFile` with 5-second poll interval
- 2-second debounce for rapid saves
- Triggers graceful exit on change — supervision restarts with new code
- Used by: GlobalProcessSupervisor, StatusLineHealthMonitor, EnhancedTranscriptMonitor

## Health Dashboard

**URL**: `http://localhost:3032`

**Features**:

- Real-time service status (4-card system: Databases, Services, Processes, API Quota)
- UKB Workflow Monitor with visual workflow graph
- Service restart controls
- Auto-healing history

### API Endpoints (Port 3033)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Overall system health |
| `/api/services` | GET | Individual service status |
| `/api/metrics` | GET | Health metrics history |
| `/api/alerts` | GET | Recent alerts |

## Health Files

| File | Purpose |
|------|---------|
| `.health/verification-status.json` | HealthVerifier output |
| `.health/supervisor-heartbeat.json` | GlobalProcessSupervisor heartbeat |
| `.health/*-transcript-monitor-health.json` | Per-project health files (centralized) |
| `.logs/statusline-health-status.txt` | StatusLineHealthMonitor rendered output |
| `.logs/combined-status-line-cache.txt` | Pre-rendered status cache (served by fast-path) |
| `.live-process-registry.json` | ProcessStateManager registry |

## Troubleshooting

### Status bar blank

```bash
# Check cache file freshness
ls -la .logs/combined-status-line-cache.txt

# Test fast-path directly (should complete in <100ms)
time node scripts/status-line-fast.cjs

# Force full refresh
node scripts/combined-status-line.js

# Check for process spawn storm (should be <80 Node processes)
ps aux | grep node | wc -l
```

## Troubleshooting

### Monitor not updating

```bash
# Check if process is running
ps aux | grep enhanced-transcript-monitor

# Check health file timestamp
ls -la .health/coding-transcript-monitor-health.json

# Force restart (supervisor will restart automatically)
kill $(pgrep -f "enhanced-transcript-monitor.*coding")
```

### Session not showing

```bash
# Check if agent process is detected
ps -eo pid,comm | awk '/claude$|copilot$|opencode$/ {print}'

# Check agent's working directory
lsof -p <PID> 2>/dev/null | grep cwd

# Check health monitor status
cat .logs/statusline-health-status.txt
```

### Health dashboard not loading

```bash
# Check if server is running
lsof -i :3032

# Check health API
curl http://localhost:3033/api/health
```

### Services stuck unhealthy

```bash
# Manual health check with auto-heal
node scripts/health-verifier.js --auto-heal

# View health status
cat .health/verification-status.json | jq '.'
```
