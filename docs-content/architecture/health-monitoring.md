# Health Monitoring

4-layer monitoring architecture for system reliability.

![4-Layer Monitoring Architecture](../images/4-layer-monitoring-architecture.png)

## Architecture Overview

The health monitoring system uses progressive escalation across four layers, each with distinct responsibilities.

## Layer 1: System Watchdog

**Component**: `monitoring/global-monitor-watchdog.js`

**Function**: Top-level supervisor monitoring all monitors

- Restarts failed monitoring processes
- Logs health status every 60 seconds
- Acts as last line of defense

**Health Check**:

```bash
ps aux | grep global-monitor-watchdog
```

## Layer 2: System Coordinator

**Component**: `monitoring/global-transcript-monitor-coordinator.js`

**Function**: Manages monitoring across all projects

- Ensures exactly one monitor per project
- Coordinates monitor lifecycle
- Aggregates health metrics

**Health Check**:

```bash
cat .health/coordinator-status.json | jq '{status, activeProjects}'
```

## Layer 3: System Verifier

**Component**: `monitoring/transcript-monitor-verifier.js`

**Function**: Verifies monitor health for all active projects

- Health checks every 30 seconds
- Detects suspicious activity (stuck processes)
- Reports anomalies to coordinator

**Suspicious Activity Detection**:

- Stale monitors (no activity for extended period)
- Stuck processes (exchange count not increasing)
- High memory usage
- Processing issues

## Layer 4: Service-Level Self-Monitoring

**Component**: Enhanced Transcript Monitor

**Function**: Per-service health reporting

- Generates `.transcript-monitor-health` file
- Real-time process metrics
- Exchange count and activity tracking

**Health File Format**:

```json
{
  "status": "healthy",
  "metrics": {
    "memoryMB": 9,
    "cpuUser": 7481974,
    "uptimeSeconds": 925,
    "processId": 78406
  },
  "activity": {
    "lastExchange": "82da8b2a-6a30-45eb-b0c7-5e1e2b2d54ee",
    "exchangeCount": 10,
    "isSuspicious": false
  }
}
```

## Health Dashboard

**URL**: `http://localhost:3032`

**Features**:

- Real-time service status
- Health metrics visualization
- Alert history
- Service restart controls

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
| `.health/coding-transcript-monitor-health.json` | LSL monitor health |
| `.health/coordinator-status.json` | Coordinator status |
| `.health/service-health.json` | Aggregated service health |

## Monitoring Commands

```bash
# Check overall health
cat .health/coding-transcript-monitor-health.json | jq '{status, activity}'

# Verify all monitors
node monitoring/transcript-monitor-verifier.js --check

# Restart coordinator
pkill -f global-transcript-monitor-coordinator
node monitoring/global-transcript-monitor-coordinator.js &

# Full system restart
./bin/restart-monitoring.sh
```

## Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Memory Usage | >500MB | >1GB |
| CPU Usage | >50% | >80% |
| Stale Monitor | >5 min | >15 min |
| Processing Delay | >30s | >60s |

## Troubleshooting

### Monitor not updating

```bash
# Check if process is running
ps aux | grep enhanced-transcript-monitor

# Check health file timestamp
ls -la .health/coding-transcript-monitor-health.json

# Restart monitor
pkill -f enhanced-transcript-monitor
TRANSCRIPT_SOURCE_PROJECT="/path/to/project" node scripts/enhanced-transcript-monitor.js &
```

### Coordinator issues

```bash
# Check coordinator status
cat .health/coordinator-status.json

# View coordinator logs
tail -100 .logs/coordinator.log

# Restart coordinator
node monitoring/global-transcript-monitor-coordinator.js &
```

### Health dashboard not loading

```bash
# Check if server is running
lsof -i :3032

# Start health dashboard
node integrations/system-health-dashboard/server.js &
```
