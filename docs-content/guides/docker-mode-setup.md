# Docker Mode Setup Guide

Complete guide for transitioning between native and Docker deployment modes.

![Docker Mode Architecture](../images/docker-mode-architecture.png)

## Overview

The coding infrastructure supports two deployment modes for its core services:

| Mode | Description | Use Case |
|------|-------------|----------|
| **Native** | Services run as Node.js processes | Development, debugging, lower resource usage |
| **Docker** | Services run in Docker containers | Isolation, reproducibility, CI/CD environments |

The transition system ensures:

- No data loss during mode switches
- Multi-session support (multiple projects running simultaneously)
- Health monitoring respects transition state
- Automatic rollback on failure

---

## State Machine

![Docker Mode State Machine](../images/docker-mode-state-machine.png)

The system supports these states:

- **Native Mode**: Services running as Node.js processes
- **Docker Mode**: Services running in Docker containers
- **Transition In Progress**: Switching between modes
- **Rolling Back**: Restoring previous mode after failure

---

## Transition Flow

![Docker Mode Transition Sequence](../images/docker-mode-transition-sequence.png)

### Step-by-Step Process

1. **Check Prerequisites**
   - Verify no transition already in progress
   - Determine current mode from `.docker-mode` marker

2. **Create Lock & Pause Monitoring**
   - Create `.transition-in-progress` with metadata
   - Broadcast SIGUSR2 to all health monitors (pause)

3. **Stop Source Services**
   - Native: Send SIGTERM to processes, wait for graceful shutdown
   - Docker: Run `docker compose down`

4. **Start Target Services**
   - Docker: Create `.docker-mode`, run `docker compose up -d`
   - Native: Remove `.docker-mode`, run `start-services.sh`

5. **Health Verification**
   - Poll `/health` endpoint for up to 60 seconds
   - On success: remove lock, resume monitoring
   - On failure: initiate rollback

6. **Rollback (if needed)**
   - Kill partially started services
   - Restore previous mode
   - Remove lock file
   - Resume monitoring

---

## CLI Commands

### Switch to Docker Mode

```bash
coding --switch-to-docker
```

Transitions all services from native Node.js processes to Docker containers.

### Switch to Native Mode

```bash
coding --switch-to-native
```

Transitions all services from Docker containers back to native Node.js processes.

### Check Mode Status

```bash
coding --mode-status
```

Shows current mode and any active transition:

```
Mode Status:
   Current Mode: native
   Transition: None
   Active Sessions: 2
   Sessions:
     - claude-12345-1705934400 (3 services)
     - project-ui-template (1 services)
```

---

## Direct CLI Usage

The transition orchestrator can also be used directly:

```bash
# Transition to Docker
node scripts/docker-mode-transition.js to-docker --verbose

# Transition to Native
node scripts/docker-mode-transition.js to-native --verbose

# Check status
node scripts/docker-mode-transition.js status

# Check if transition is in progress (for scripts)
node scripts/docker-mode-transition.js check

# Force remove lock file (emergency)
node scripts/docker-mode-transition.js unlock
```

---

## Components

### 1. Transition Orchestrator

**Location:** `scripts/docker-mode-transition.js`

- Creates lock file to signal transition in progress
- Broadcasts pause/resume signals to health monitors
- Manages graceful service shutdown and startup
- Implements automatic rollback on failure

### 2. Health Monitors (Modified)

- `health-verifier.js` - Skips verification during transition
- `global-process-supervisor.js` - Skips restarts during transition
- `statusline-health-monitor.js` - Shows transition status, skips auto-healing

### 3. Lock File

**Location:** `.transition-in-progress`

Prevents health monitors from auto-restarting services during transition.

**Format:**

```json
{
  "startTime": "2026-01-22T10:00:00.000Z",
  "fromMode": "native",
  "toMode": "docker",
  "pid": 12345,
  "sessions": ["claude-12345-1705934400", "project-coding"],
  "status": "in_progress",
  "lastUpdate": "2026-01-22T10:00:30.000Z"
}
```

Lock files older than 5 minutes are considered stale and automatically cleaned up.

### 4. Mode Marker

**Location:** `.docker-mode`

- Presence indicates Docker mode
- Absence indicates Native mode

### 5. MCP Config Selection

**Location:** `bin/claude-mcp-launcher.sh`

Centralized MCP configuration selection based on `CODING_DOCKER_MODE`:

- **Docker mode**: Uses `claude-code-mcp-docker.json` (stdio-proxy to SSE)
- **Native mode**: Uses `claude-code-mcp-processed.json` (direct Node.js)

---

## Signal Handling

Health monitors respond to these signals during transitions:

| Signal | Effect |
|--------|--------|
| SIGUSR2 | Pause monitoring and auto-healing |
| SIGUSR1 | Resume normal operation |

The orchestrator broadcasts these signals automatically during transitions.

---

## MCP Communication in Docker Mode

When running in Docker mode, MCP servers use a **stdio-proxy to SSE bridge** architecture:

**Communication flow:**

Claude Code communicates via stdio with stdio-proxy.js (on the host), which then communicates via HTTP/SSE with the SSE Server running in Docker containers.

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `stdio-proxy.js` | Host (Node.js) | Bridges stdio to HTTP/SSE |
| `sse-server.js` | Docker container | Handles SSE connections |
| Port 3847 | Browser Access | Playwright MCP server |
| Port 3848 | Semantic Analysis | Knowledge extraction |
| Port 3849 | Constraint Monitor | Code quality enforcement |
| Port 3850 | Code Graph RAG | AST-based code search |

### Configuration Files

- **Docker config**: `claude-code-mcp-docker.json` - Uses stdio-proxy with SSE URLs
- **Native config**: `claude-code-mcp-processed.json` - Direct Node.js execution

The `CODING_DOCKER_MODE` environment variable is set by `launch-claude.sh` and read by `claude-mcp-launcher.sh` to select the appropriate configuration.

---

## Programmatic API

```javascript
import DockerModeTransition from './scripts/docker-mode-transition.js';
import { isTransitionLocked, getTransitionLockData } from './scripts/docker-mode-transition.js';

// Create instance
const transition = new DockerModeTransition({ verbose: true });

// Check current mode
const mode = await transition.getCurrentMode(); // 'native' or 'docker'

// Check if transition in progress
const locked = await isTransitionLocked();
const lockData = await getTransitionLockData();

// Get full status
const status = await transition.getStatus();

// Perform transition
const result = await transition.transition('docker');
if (result.success) {
  // Transitioned to Docker mode
} else {
  // Transition failed: result.message
}
```

---

## Troubleshooting

### Transition Stuck

If a transition appears stuck:

1. Check lock file age:
   ```bash
   cat .transition-in-progress
   ```

2. If stale (>5 min), force unlock:
   ```bash
   coding --mode-status  # Usually cleans up stale locks
   # Or manually:
   node scripts/docker-mode-transition.js unlock
   ```

### Services Not Starting After Transition

1. Check port availability:
   ```bash
   lsof -i:8080,8081,8083
   ```

2. Check Docker containers (if Docker mode):
   ```bash
   docker ps
   docker compose -f docker/docker-compose.yml logs
   ```

3. Check native processes (if native mode):
   ```bash
   node scripts/process-state-manager.js status
   ```

### Health Monitors Not Resuming

If health monitors remain paused after transition:

1. Manually send resume signal:
   ```bash
   pkill -USR1 -f health-verifier.js
   pkill -USR1 -f global-process-supervisor.js
   pkill -USR1 -f statusline-health-monitor.js
   ```

2. Or restart the monitors:
   ```bash
   node scripts/monitoring-verifier.js --install-all
   ```

### Docker Mode Not Detected

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

### Docker Services Unhealthy

```bash
# Check if Docker containers are running
docker compose -f docker/docker-compose.yml ps

# Test individual health endpoints
curl http://localhost:3848/health  # Semantic Analysis
curl http://localhost:3849/health  # Constraint Monitor
curl http://localhost:3850/health  # Code Graph RAG

# Check container logs for errors
docker compose -f docker/docker-compose.yml logs coding-services

# Restart Docker services if needed
docker compose -f docker/docker-compose.yml restart
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `scripts/docker-mode-transition.js` | Core transition orchestrator |
| `scripts/health-verifier.js` | Modified to respect transition lock |
| `scripts/global-process-supervisor.js` | Modified to respect transition lock |
| `scripts/statusline-health-monitor.js` | Shows transition status, skips healing |
| `scripts/launch-claude.sh` | Waits for transition before startup |
| `bin/coding` | CLI commands for mode switching |
| `bin/claude-mcp-launcher.sh` | MCP config selection based on mode |
| `docker/docker-compose.yml` | Docker service definitions |

---

## System Architecture

![Dockerized System Architecture](../images/dockerized-system-architecture.png)

### Port Mapping Reference

| Service | Native Port | Docker Port | Health Check |
|---------|-------------|-------------|--------------|
| VKB Server | 8080 | 8080 | `/health` |
| Browser Access | 3847 | 3847 | `/health` |
| Semantic Analysis | - | 3848 | `/health` |
| Constraint Monitor | 3030/3031 | 3849 | `/health` |
| Code Graph RAG | - | 3850 | `/health` |
| Health Dashboard | 3032/3033 | 3032/3033 | `/health` |

### Volume Configuration

```yaml
volumes:
  - .data:/app/.data              # Knowledge graph data
  - .health:/app/.health          # Health files
  - .specstory:/app/.specstory    # Session logs
  - .cache:/app/.cache            # Cache data
```

---

## Related Documentation

- [Getting Started: Docker Mode](../getting-started/docker-mode.md) - Quick start guide
- [Architecture: Health Monitoring](../architecture/health-monitoring.md) - Health system overview
- [Status Line Guide](status-line.md) - Docker mode indicators
