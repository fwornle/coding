# Robust Startup System

## Overview

The Robust Startup System implements **retry-with-timeout** and **graceful degradation** patterns to prevent endless loops and ensure coding infrastructure starts reliably even when some services fail.

## Problem Statement

### Original Issues

Before the robust startup system, `coding/bin/coding` had several critical reliability problems:

1. **Endless Loops**: When VKB server failed to start, the health monitor would wait indefinitely without retry limits
2. **No Timeout Protection**: Services could hang during startup without any timeout mechanism
3. **All-or-Nothing**: If any service failed, the entire startup would block or fail ambiguously
4. **Port Checks Only**: Health verification only checked if ports were listening, not if services were actually functional
5. **No Degraded Mode**: Optional services that failed would block Claude startup unnecessarily

### Impact

Users experienced:
- Waiting indefinitely for coding to start when VKB server had issues
- Claude sessions blocked by non-critical service failures
- No clear visibility into which services failed and why
- Unable to use coding tools while waiting for optional services

## Solution Architecture

### Core Components

#### 1. **Service Starter Module** (`lib/service-starter.js`)

Reusable module providing:

```javascript
import { startServiceWithRetry } from '../lib/service-starter.js';

const result = await startServiceWithRetry(
  'VKB Server',
  async () => startVKBServer(),  // Start function
  async () => checkHealth(),      // Health check function
  {
    required: false,    // Optional service - degrade gracefully
    maxRetries: 3,      // Try 3 times then give up
    timeout: 30000,     // 30 second timeout per attempt
    exponentialBackoff: true  // 2s, 4s, 8s delays
  }
);
```

**Features**:
- Configurable retry limits (default: 3 attempts)
- Timeout protection per attempt (default: 30 seconds)
- Exponential backoff between retries (2s → 4s → 8s)
- Actual health verification (HTTP endpoints, not just ports)
- Service classification (required vs optional)
- Graceful degradation for optional services

#### 2. **Robust Service Starter** (`scripts/start-services-robust.js`)

Service orchestrator that:
- Starts services in logical order (required first, then optional)
- Applies retry logic independently per service
- Kills unhealthy processes before retry
- Reports clear status for each service
- Exits with proper codes (0 = success, 1 = critical failure)

#### 3. **Updated Start Script** (`start-services.sh`)

Entry point that:
- Defaults to robust mode (`ROBUST_MODE=true`)
- Allows fallback to legacy mode if needed
- Provides clear user feedback

### Service Classification

#### Required Services (Block startup if failed)

1. **Transcript Monitor** - Essential for LSL system
2. **Live Logging Coordinator** - Essential for session tracking

If these fail after all retries → **Claude startup blocked with clear error**

#### Optional Services (Degrade gracefully if failed)

1. **VKB Server** - Knowledge visualization (port 8080)
2. **Constraint Monitor** - Live guardrails system
3. **Semantic Analysis** - MCP semantic analysis server

If these fail after all retries → **Continue in DEGRADED mode with warning**

## Retry Strategy

### Algorithm

```
For each service attempt (1 to maxRetries):
  1. Start service with timeout protection
  2. Wait 2 seconds for initialization
  3. Run health check with timeout
  4. If healthy → SUCCESS
  5. If unhealthy:
     - Kill the unhealthy process
     - Wait with exponential backoff (2^attempt seconds)
     - Retry

If all retries exhausted:
  - Required service → THROW ERROR (blocks startup)
  - Optional service → RETURN DEGRADED STATUS (continue)
```

### Backoff Schedule

| Attempt | Delay Before Retry |
|---------|-------------------|
| 1       | 0s (immediate)    |
| 2       | 2s                |
| 3       | 4s                |
| 4       | 8s                |

### Timeout Protection

Each service startup attempt has two timeouts:

1. **Startup Timeout**: Process must start within timeout (default: 30s)
2. **Health Check Timeout**: Health verification must complete within 10s

If either timeout expires → Attempt fails, retry or degrade

## Health Verification

### Port-Based Health (Old Approach)

```bash
# PROBLEM: Port open ≠ server working
if lsof -i :8080 > /dev/null; then
    echo "✅ VKB running"  # FALSE POSITIVE!
fi
```

### HTTP Health Checks (Robust Approach)

```javascript
// SOLUTION: Actual HTTP health endpoint verification
const healthCheck = createHttpHealthCheck(8080, '/health');

const healthy = await healthCheck(); // true only if HTTP 200 OK
```

**VKB Server Health Endpoint** (`/health`):
```json
{
  "status": "healthy",
  "timestamp": 1729764523.456,
  "server": {
    "port": 8080,
    "pid": 12345,
    "uptime": 45.2
  }
}
```

### Process-Based Health (PID verification)

For background processes without HTTP endpoints:

```javascript
const healthCheck = createPidHealthCheck();

const serviceInfo = await startService();
const healthy = await healthCheck(serviceInfo);  // Checks if PID is running
```

## Usage

### Normal Startup (Robust Mode - Default)

```bash
./start-services.sh
```

Output example:
```
🚀 Starting Coding Services (Robust Mode)...
✨ Using robust startup mode with retry logic and graceful degradation

═══════════════════════════════════════════════════════════════════════
🚀 STARTING CODING SERVICES (ROBUST MODE)
═══════════════════════════════════════════════════════════════════════

📋 Starting REQUIRED services (Live Logging System)...

[ServiceStarter] ✅ Transcript Monitor started successfully on attempt 1/3
[ServiceStarter] ✅ Live Logging Coordinator started successfully on attempt 1/3

🔵 Starting OPTIONAL services (graceful degradation enabled)...

[ServiceStarter] ✅ VKB Server started successfully on attempt 1/3
[ServiceStarter] ⚠️  Constraint Monitor failed after 2 attempts - continuing in DEGRADED mode

═══════════════════════════════════════════════════════════════════════
📊 SERVICES STATUS SUMMARY
═══════════════════════════════════════════════════════════════════════

✅ Successfully started: 3 services
   - Transcript Monitor
   - Live Logging Coordinator
   - VKB Server

⚠️  Degraded (optional failed): 1 services
   - Constraint Monitor: Docker not running - required for Constraint Monitor

🎉 Startup complete in DEGRADED mode!

ℹ️  Some optional services are unavailable:
   - Constraint Monitor will not be available this session
═══════════════════════════════════════════════════════════════════════
```

### Legacy Mode (No Retry Logic)

```bash
ROBUST_MODE=false ./start-services.sh
```

Use only for debugging or if robust mode has issues.

## Failure Scenarios

### Scenario 1: VKB Server Fails (Optional Service)

**Before Robust System**:
- Would wait indefinitely or block startup
- User couldn't use coding tools
- No clear error message

**With Robust System**:
```
[ServiceStarter] 📍 Attempt 1/3 for VKB Server...
[ServiceStarter] ❌ VKB Server attempt 1/3 failed: Startup timeout
[ServiceStarter]    Waiting 2000ms before retry...
[ServiceStarter] 📍 Attempt 2/3 for VKB Server...
[ServiceStarter] ❌ VKB Server attempt 2/3 failed: Health check failed
[ServiceStarter]    Waiting 4000ms before retry...
[ServiceStarter] 📍 Attempt 3/3 for VKB Server...
[ServiceStarter] ❌ VKB Server attempt 3/3 failed: Port not listening
[ServiceStarter] ⚠️  VKB Server failed after 3 attempts - continuing in DEGRADED mode

🎉 Startup complete in DEGRADED mode!

ℹ️  VKB Server will not be available this session
```

Result: **Claude starts successfully** without VKB visualization

### Scenario 2: Transcript Monitor Fails (Required Service)

```
[ServiceStarter] 📍 Attempt 1/3 for Transcript Monitor...
[ServiceStarter] ❌ Transcript Monitor attempt 1/3 failed
[ServiceStarter] 📍 Attempt 2/3 for Transcript Monitor...
[ServiceStarter] ❌ Transcript Monitor attempt 2/3 failed
[ServiceStarter] 📍 Attempt 3/3 for Transcript Monitor...
[ServiceStarter] ❌ Transcript Monitor attempt 3/3 failed

💥 CRITICAL: Transcript Monitor failed after 3 attempts - BLOCKING startup

═══════════════════════════════════════════════════════════════════════
❌ Failed (required): 1 services
   - Transcript Monitor: Process failed to start

💥 CRITICAL: Required services failed - BLOCKING startup
═══════════════════════════════════════════════════════════════════════
```

Result: **Claude startup blocked** with clear error message

### Scenario 3: All Services Start Successfully

```
✅ Successfully started: 4 services
   - Transcript Monitor
   - Live Logging Coordinator
   - VKB Server
   - Constraint Monitor

🎉 Startup complete in FULL mode!
```

Result: **All features available**

## Configuration

### Service Retry Configuration

Edit `scripts/start-services-robust.js`:

```javascript
const SERVICE_CONFIGS = {
  vkbServer: {
    name: 'VKB Server',
    required: false,      // Optional - degrade gracefully
    maxRetries: 3,        // Try 3 times
    timeout: 30000,       // 30 second timeout per attempt
    startFn: async () => { /* ... */ },
    healthCheckFn: createHttpHealthCheck(8080, '/health')
  }
};
```

### Environment Variables

- `ROBUST_MODE=true` - Enable robust startup (default)
- `ROBUST_MODE=false` - Use legacy startup mode
- `VKB_DATA_SOURCE=combined` - Data source for VKB server

## Benefits

### 1. **No More Endless Loops**
- Clear retry limits prevent indefinite waiting
- Timeouts protect against hanging services

### 2. **Graceful Degradation**
- Optional services don't block Claude startup
- Clear communication about what's available/unavailable

### 3. **Better User Experience**
- Fast startup even when some services fail
- Clear status reporting
- Can use coding tools immediately

### 4. **Improved Reliability**
- Exponential backoff prevents overwhelming failing services
- Health verification ensures services actually work
- Process cleanup prevents zombie processes

### 5. **Easier Debugging**
- Detailed logs for each retry attempt
- Clear failure reasons
- Distinct exit codes

## Exit Codes

| Code | Meaning | Example |
|------|---------|---------|
| 0 | Success - all services started (FULL or DEGRADED mode) | VKB failed but optional |
| 1 | Critical failure - required service failed | Transcript Monitor failed |

## Troubleshooting

### VKB Server Won't Start

```bash
# Check VKB logs
tail -f /tmp/vkb-server.log

# Test VKB health endpoint
curl http://localhost:8080/health

# Check if port is blocked
lsof -i :8080
```

### Constraint Monitor Won't Start

```bash
# Check Docker status
docker info

# Check constraint monitor containers
docker ps --filter "name=constraint-monitor"

# Check docker-compose logs
cd integrations/mcp-constraint-monitor
docker-compose logs
```

### Services Keep Failing

1. **Check retry limits**: Increase `maxRetries` if needed
2. **Check timeout**: Increase `timeout` for slow-starting services
3. **Check health endpoint**: Verify `/health` returns 200 OK
4. **Check dependencies**: Ensure Docker, Node.js, Python are available

## Future Enhancements

- [ ] Add parallel service startup (currently sequential)
- [ ] Add service dependency management (start A before B)
- [ ] Add automatic service recovery/restart on crash
- [ ] Add metrics collection for startup times
- [ ] Add circuit breaker pattern for repeatedly failing services
- [ ] Add health monitoring dashboard

## References

- `lib/service-starter.js` - Core retry logic module
- `scripts/start-services-robust.js` - Service orchestrator
- `start-services.sh` - Entry point script
- `memory-visualizer/api-server.py` - VKB health endpoint implementation
