# Process Management System (PSM) Analysis

**Date:** 2025-11-15
**Issue:** Orphaned processes creating LSL files in wrong directories
**Resolution:** PID 78503, 78502, 33998 killed - folder recreation stopped

---

## Executive Summary

The coding infrastructure has a **Process State Manager (PSM)** that tracks running services in `.live-process-registry.json`, but **not all spawned processes are registered**, leading to orphaned processes that cannot be monitored or cleaned up.

### Critical Finding

**Root Cause of coding-tmp Issue:**
- Enhanced-transcript-monitor (PID 78503, 33998) was spawned WITHOUT project path parameter
- Without project path, it used `process.cwd()` which resolved to different directories
- These processes were NOT registered in PSM, making them invisible to monitoring systems
- When parent sessions ended, these orphans continued running and creating files

---

## Process State Manager (PSM) Overview

### Registry Location
```
/Users/q284340/Agentic/coding/.live-process-registry.json
```

### Structure
```json
{
  "version": "3.0.0",
  "lastChange": 1763186615258,
  "sessions": {},
  "services": {
    "global": {
      "service-name": {
        "pid": 12345,
        "script": "path/to/script.js",
        "type": "global",
        "startTime": 1763186615258,
        "lastHealthCheck": 1763186615258,
        "status": "running",
        "metadata": {}
      }
    },
    "projects": {
      "/path/to/project": {
        "service-name": {
          "pid": 67890,
          "script": "script.js",
          "type": "per-project",
          "startTime": 1763186615258,
          "lastHealthCheck": 1763186615258,
          "status": "running",
          "metadata": {}
        }
      }
    }
  }
}
```

---

## Process Spawning Analysis

### ✅ PROPERLY REGISTERED Spawns

These processes correctly register with PSM:

1. **GlobalServiceCoordinator.startService()** (`scripts/global-service-coordinator.js:248`)
   - Spawns services and registers them with PSM
   - Proper cleanup on shutdown
   - Health checking enabled

2. **enhanced-transcript-monitor.js** (`scripts/enhanced-transcript-monitor.js:2130`)
   - Registers itself via `this.processStateManager.registerService()`
   - Unregisters on shutdown (line 2284)

3. **global-lsl-coordinator.js** (`scripts/global-lsl-coordinator.js:309`)
   - Registers itself via `this.processStateManager.registerService()`
   - Unregisters on shutdown (line 355)

4. **system-monitor-watchdog.js** (`scripts/system-monitor-watchdog.js:161`)
   - Registers spawned coordinator via PSM

5. **start-services-robust.js** (`scripts/start-services-robust.js:350`)
   - Registers services via PSM

---

### ⚠️ WRAPPER PROCESSES (Partial Registration)

These wrappers are registered by their parent, but their CHILDREN are not:

1. **dashboard-service.js** (`scripts/dashboard-service.js:32`)
   ```javascript
   const child = spawn('npm', ['run', 'dev'], { ... });
   ```
   - Wrapper PID is registered by GlobalServiceCoordinator
   - **BUT**: npm spawns child processes (Next.js) that are NOT tracked
   - **Gap**: Child process tree invisible to PSM

2. **api-service.js** (`scripts/api-service.js:33`)
   ```javascript
   const child = spawn('node', [API_SERVER_PATH], { ... });
   ```
   - Wrapper PID registered, but spawned API server not explicitly tracked
   - Relies on parent wrapper for lifecycle

3. **combined-status-line-wrapper.js** (`scripts/combined-status-line-wrapper.js:19`)
   ```javascript
   const child = spawn('node', [join(__dirname, 'combined-status-line.js')], { ... });
   ```
   - Wrapper registered, child not explicitly tracked

4. **tool-interaction-hook-wrapper.js** (`scripts/tool-interaction-hook-wrapper.js:19`)
   - Similar wrapper pattern without child registration

---

### ❌ UNREGISTERED Spawns

These spawn processes WITHOUT PSM registration:

1. **combined-status-line.js** (`scripts/combined-status-line.js:1014`)
   ```javascript
   const monitor = spawn('node', [monitorScript], { ... });
   ```
   - Spawns enhanced-transcript-monitor dynamically
   - **CRITICAL**: No PSM registration
   - **Result**: Orphaned processes like PID 78503, 33998

2. **health-prompt-hook.js** (`scripts/health-prompt-hook.js:130`)
   ```javascript
   const child = spawn('node', [VERIFIER_SCRIPT, '--auto-heal'], { ... });
   ```
   - Spawns verifier without registration
   - Short-lived process, but still untracked

3. **process-state-manager.js** (`scripts/process-state-manager.js:466`)
   ```javascript
   const lsof = spawn('lsof', [levelDBLockPath]);
   ```
   - Utility spawn for diagnostics
   - Not a long-running service, acceptable to not register

---

## Critical Gaps Identified

### 1. Dynamic Process Spawning Without Registration
   - `combined-status-line.js` spawns monitors based on runtime detection
   - These spawned processes don't register themselves
   - No parent-child relationship tracking

### 2. Child Process Trees Not Tracked
   - Wrappers like `dashboard-service.js` spawn npm/node
   - Those children spawn more processes (Next.js, webpack, etc.)
   - Only the wrapper PID is tracked
   - When wrapper dies, orphaned children may remain

### 3. Missing Project Path Propagation
   - Processes spawned without explicit project path use `process.cwd()`
   - Can resolve to wrong directories (e.g., coding-tmp instead of coding)
   - LSL files created in wrong locations

### 4. No Cleanup on Abnormal Termination
   - When parent process crashes/exits unexpectedly
   - Children not automatically cleaned up
   - Accumulation of orphaned processes

---

## LSL System Specific Issues

### Global LSL Registry
```
/Users/q284340/Agentic/coding/.global-lsl-registry.json
```

**Current State:**
```json
{
  "version": "1.0.0",
  "lastUpdated": 1763186616057,
  "projects": {
    "coding": {
      "projectPath": "/Users/q284340/Agentic/coding",
      "monitorPid": 51568,
      "startTime": 1763186616056,
      "parentPid": null,
      "lastHealthCheck": 1763186616056,
      "status": "active",
      "exchanges": 0
    }
  },
  "coordinator": {
    "pid": 34855,
    "startTime": 1763186162997,
    "healthCheckInterval": 30000
  }
}
```

**Problem:**
- Dead processes (78503, 33998) were never in this registry
- They were spawned by untracked mechanisms
- No health checking or cleanup possible

---

## Recommendations

### Immediate Actions

1. **Add PSM Registration to All Dynamic Spawns**
   - Modify `combined-status-line.js` to register spawned monitors
   - Add registration wrapper function for all spawn() calls

2. **Implement Child Process Tree Tracking**
   - Track PIDs of all child processes
   - Use `ps` or `/proc` to discover child tree
   - Add cleanup logic for entire process tree

3. **Mandatory Project Path for LSL Monitors**
   - Never allow enhanced-transcript-monitor to run without explicit project path
   - Add validation that fails startup if project path missing
   - Remove fallback to `process.cwd()`

4. **Add Dead Process Cleanup Cron**
   - Regular scan for processes matching coding patterns
   - Cross-reference with PSM registry
   - Kill orphans not in registry (with safety checks)

### Long-term Improvements

1. **Process Manager as Single Source of Truth**
   - All spawns MUST go through PSM
   - No direct spawn() calls outside PSM
   - Centralized process lifecycle management

2. **Health Monitoring for All Services**
   - Regular heartbeat checks
   - Auto-restart on failure
   - Alerting on repeated failures

3. **Graceful Shutdown Protocol**
   - SIGTERM handlers in all services
   - Proper cleanup and unregistration
   - Timeout-based SIGKILL fallback

4. **Process Hierarchy Visualization**
   - Tool to show process tree
   - Identify parent-child relationships
   - Highlight orphans and zombies

---

## Files Requiring Modification

### High Priority
1. `scripts/combined-status-line.js` - Add PSM registration for spawned monitors
2. `scripts/enhanced-transcript-monitor.js` - Enforce project path requirement
3. `scripts/global-service-coordinator.js` - Track child process trees

### Medium Priority
4. `scripts/dashboard-service.js` - Register child PIDs
5. `scripts/api-service.js` - Register child PIDs
6. `scripts/health-prompt-hook.js` - Add short-lived process tracking

### Documentation
7. Create PSM developer guide
8. Document spawn() best practices
9. Add process troubleshooting runbook

---

## Usage of .live-process-registry.json

**Current Purpose:**
- Track running services (global and per-project)
- Enable health checks
- Facilitate graceful shutdown
- Prevent duplicate service instances

**Methods:**
- `registerService(serviceInfo)` - Add service to registry
- `unregisterService(name, type, context)` - Remove service
- `isServiceRunning(name, type, context)` - Check if service alive
- `cleanupDeadProcesses()` - Remove entries for dead PIDs
- `getHealthStatus()` - Get comprehensive system health

**Access Pattern:**
```javascript
import ProcessStateManager from './process-state-manager.js';
const psm = new ProcessStateManager();
await psm.initialize();

// Register service
await psm.registerService({
  name: 'my-service',
  pid: process.pid,
  type: 'global',
  script: 'my-service.js',
  metadata: { custom: 'data' }
});

// Check if running
const running = await psm.isServiceRunning('my-service', 'global');

// Unregister on shutdown
await psm.unregisterService('my-service', 'global');
```

---

## Recent Fixes

### Singleton Check Bug Fix (2025-11-19)

**Issue:**
Duplicate transcript monitor instances were running simultaneously for the same project, bypassing the singleton check that should prevent this.

**Root Cause:**
In `scripts/enhanced-transcript-monitor.js:2123`, the singleton check was calling ProcessStateManager's `getService()` method with incorrect parameters:

```javascript
// BEFORE (BROKEN):
const existingService = await this.processStateManager.getService(serviceName, 'per-project', projectPath);
```

The third parameter was passing `projectPath` as a **string**, but `ProcessStateManager.getService()` expects it as part of a **context object**:

```javascript
// From ProcessStateManager.js:184-200
async getService(name, type, context = {}) {
  if (type === 'per-project' && context.projectPath) {  // ← Expects context.projectPath!
    const projectServices = registry.services.projects[context.projectPath];
    return projectServices ? projectServices[name] || null : null;
  }
}
```

Because `context.projectPath` was always **undefined**, the singleton check always returned `null`, allowing duplicate instances.

**Fix Applied:**
Changed line 2123 to pass an object instead of a string:

```javascript
// AFTER (CORRECT):
const existingService = await this.processStateManager.getService(serviceName, 'per-project', { projectPath });
```

**Verification:**
Tested by attempting to start duplicate instances - now properly rejects with error message:
```
❌ Another instance of enhanced-transcript-monitor is already running for project coding
   PID: 41120, Started: 2025-11-19T05:52:57.324Z
   To fix: Kill the existing instance with: kill 41120
```

**Impact:**
- Prevents duplicate transcript monitor instances per project
- Ensures proper singleton enforcement for per-project services
- Reduces orphaned processes and resource waste

**Related Issue:**
This was identified after user reported duplicate ProcessStateManager instances running from previous day's session still active alongside new session's instance.

---

## Conclusion

The Process State Manager infrastructure exists but is **incompletely implemented**. Critical gaps in process registration led to orphaned processes creating LSL files in incorrect locations.

**Immediate Fix Applied:**
- Killed orphaned PIDs: 78503, 78502, 33998
- Verified folder recreation stopped

**Required Next Steps:**
1. Enforce PSM registration for ALL spawned processes
2. Implement child process tree tracking
3. Add project path validation to LSL monitors
4. Create automated orphan detection and cleanup

**Critical Rule:**

🚨 **NEVER spawn a process without registering it in PSM** 🚨
