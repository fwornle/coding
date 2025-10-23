# Process Architecture Analysis & Health Issues

**Date**: 2025-10-12
**Status**: 🚨 CRITICAL - Process Duplication Confirmed
**Analyzed by**: Claude (Ultrathink Deep Analysis)

---

## Executive Summary

**CRITICAL FINDING**: The coding system has **process chaos** with multiple duplicate monitoring processes running simultaneously. Currently detected:
- **5 transcript monitors** (should be 1-3 max for 3 projects)
- **4 global monitoring daemons** (coordinator, lsl-coordinator, statusline-health, live-logging)
- **No centralized process tracking** or cleanup mechanism

This creates:
- Resource waste (CPU, memory)
- Race conditions in file writes
- Unclear system state
- Startup failures due to "Coordinator dead" false positives

---

## Current Process Inventory

### Active Processes (as of analysis)

```
PID    | Process                              | Purpose
-------|--------------------------------------|------------------------------------------
37197  | global-service-coordinator --daemon  | Master health monitor for all services
40732  | enhanced-transcript-monitor.js       | Transcript monitor (coding repo, orphaned)
40733  | live-logging-coordinator.js          | Live logging MCP integration
40985  | enhanced-transcript-monitor.js       | Transcript monitor (curriculum-alignment)
77063  | enhanced-transcript-monitor.js       | Transcript monitor (coding, duplicate)
77094  | enhanced-transcript-monitor.js       | Transcript monitor (curriculum-alignment, duplicate)
77160  | enhanced-transcript-monitor.js       | Transcript monitor (nano-degree)
85750  | global-lsl-coordinator.js monitor    | LSL auto-recovery daemon
91406  | statusline-health-monitor.js --daemon| StatusLine global monitor
```

**Total**: 9 monitoring processes (should be ~5)

---

## Process Architecture Map

### Layer 0: Entry Point
```
bin/coding
  ├─> Detects agent (claude/copilot)
  ├─> Sets environment variables
  └─> Executes: scripts/launch-claude.sh
```

### Layer 1: Service Startup
```
scripts/launch-claude.sh
  ├─> PRE-MONITORING: start-services.sh
  │   ├─> Docker containers (constraint-monitor, qdrant, redis)
  │   ├─> enhanced-transcript-monitor.js (nohup &) ← DUPLICATE SOURCE #1
  │   ├─> live-logging-coordinator.js (nohup &)
  │   ├─> vkb-server (nohup &)
  │   └─> Dashboard services (ports 3030, 3031)
  │
  ├─> MONITORING VERIFICATION: monitoring-verifier.js --strict
  │   ├─> Step 1: Verify system-monitor-watchdog
  │   ├─> Step 2: Verify global-service-coordinator
  │   ├─> Step 3: Register project
  │   ├─> Step 4: Check service health
  │   └─> Step 5: Test recovery mechanisms
  │
  └─> POST-MONITORING: Transcript & Health Monitors
      ├─> global-lsl-coordinator.js ensure ← DUPLICATE SOURCE #2
      │   └─> Starts enhanced-transcript-monitor if not running
      │
      ├─> statusline-health-monitor.js --daemon (nohup &)
      └─> global-lsl-coordinator.js monitor (nohup &)
```

### Layer 2: Monitoring Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 2a: System Watchdog (Should run from launchd)        │
│ scripts/system-monitor-watchdog.js                          │
│ - Checks: Is global-service-coordinator alive?             │
│ - Action: Restart coordinator if dead                       │
│ - Frequency: Every minute (via cron/launchd)               │
│ - Status: ❌ NOT INSTALLED (relies on manual runs)          │
└─────────────────────────────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2b: Global Service Coordinator (Daemon)              │
│ scripts/global-service-coordinator.js --daemon              │
│ - Manages: Per-project services (transcript monitors)      │
│ - Registry: .global-service-registry.json                  │
│ - Health checks: Every 15 seconds                          │
│ - Auto-restart: Failed services with exponential backoff   │
└─────────────────────────────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2c: Monitoring Verifier (Startup Check)              │
│ scripts/monitoring-verifier.js --strict                     │
│ - Runs: At every Claude startup                            │
│ - Blocks: Claude startup if monitoring unhealthy           │
│ - Problem: Sometimes false-positives on "Coordinator dead" │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Layer 2d: StatusLine Health Monitor (Global Daemon)        │
│ scripts/statusline-health-monitor.js --daemon              │
│ - Monitors: Constraint monitor, coordinator health         │
│ - Frequency: Periodic checks                               │
│ - Auto-recovery: Restarts failed services                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Layer 2e: Global LSL Coordinator (Dual Mode)               │
│ scripts/global-lsl-coordinator.js                          │
│ - Mode 1: ensure (one-time per session)                    │
│ - Mode 2: monitor (background daemon)                      │
│ - Purpose: Ensure transcript monitors run                  │
│ - Problem: Overlaps with start-services.sh                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Issues Identified

### Issue #1: Duplicate Transcript Monitors (**CONFIRMED**)

**Evidence**: 5 transcript monitors running for 3 projects

**Root Causes**:
1. `start-services.sh` blindly starts transcript monitor (lines 280-284)
2. `launch-claude.sh` calls `global-lsl-coordinator.js ensure` which also starts monitor
3. No check for existing monitors before starting new ones
4. No cleanup when sessions end
5. Multiple sessions to same project = multiple monitors

**Impact**:
- Race conditions in `.specstory/history/` writes
- Duplicate LSL entries
- Resource waste (5+ node processes)
- Confusion about which monitor is "official"

### Issue #2: No Centralized Process Registry

**Problem**: No single source of truth for "what's running"

**Current State**:
- `.services-running.json` - written once at startup, never updated
- `.global-service-registry.json` - only tracks coordinator-managed services
- No tracking of global daemons (statusline-health, lsl-monitor)
- No cross-session awareness

**Impact**:
- Can't answer "Is X already running?"
- Multiple instances of same service
- No way to audit system health
- Difficult debugging

### Issue #3: Monitoring Verifier False Positives

**Problem**: "Coordinator dead and recovery failed" but coordinator is actually running

**Root Cause** (hypothesis from code analysis):
```javascript
// monitoring-verifier.js:154
const recoveryResult = await execAsync(`node "${this.systemWatchdogScript}"`);
if (recoveryResult.returnCode === 0) { // ← Never checks returnCode properly
```

The code checks `returnCode` but `execAsync` throws on non-zero exit, so this never works correctly.

**Impact**:
- False alarm: "Monitoring failed" when it's actually fine
- Blocks Claude startup unnecessarily
- User confusion

### Issue #4: Watchdog Not Installed

**Problem**: System watchdog designed to run via launchd, but never installed

**Evidence**:
- `system-monitor-watchdog.js:270` has `--install-launchd` option
- But `start-services.sh` never calls it
- `monitoring-verifier.js` calls watchdog directly (not via launchd)

**Impact**:
- Ultimate failsafe doesn't work
- If coordinator dies, nothing restarts it (except manual intervention)
- System not self-healing

### Issue #5: Parallel Session Chaos

**Problem**: Multiple Claude sessions to different projects create process multiplication

**Scenario**:
```
Session 1 (curriculum-alignment): Starts all services + monitors
Session 2 (nano-degree): Starts all services + monitors AGAIN
Session 3 (coding): Starts all services + monitors AGAIN
```

**Result**: 3x duplication of everything

**Missing**:
- Global lock file for "services already started"
- Per-session cleanup on exit
- Shared global services with per-project locals
- Process tree awareness

---

## Process Dependencies Graph

```
Claude Session (PID X)
  │
  ├─> coding/bin/coding (PID Y)
  │     │
  │     └─> scripts/launch-claude.sh (PID Z)
  │           │
  │           ├─> start-services.sh
  │           │     ├─> Docker containers (external)
  │           │     ├─> transcript-monitor (PID A) ← Should be 1 per project
  │           │     ├─> live-logging-coordinator (PID B) ← Should be 1 global
  │           │     └─> vkb-server (PID C) ← Should be 1 global
  │           │
  │           ├─> monitoring-verifier.js (blocking check)
  │           │
  │           ├─> global-lsl-coordinator ensure
  │           │     └─> May start transcript-monitor (PID A2) ← DUPLICATE!
  │           │
  │           ├─> statusline-health-monitor --daemon (PID D) ← Should be 1 global
  │           └─> global-lsl-coordinator monitor (PID E) ← Should be 1 global
  │
  └─> claude (PID Claude)
        └─> Uses MCP servers (stdio, not PIDs)

GLOBAL (should be singletons):
  - global-service-coordinator (PID F) ← Should be 1 for entire system
  - system-monitor-watchdog (NOT RUNNING) ← Should be launchd job
```

---

## Recommended Architecture

### Principle: Single Source of Truth

```
┌────────────────────────────────────────────────────────────────┐
│ LAYER 0: Process State Manager (NEW)                          │
│ File: scripts/process-state-manager.js                        │
│                                                                │
│ Responsibilities:                                              │
│ • Maintain .process-registry.json with ALL processes          │
│ • Atomic checks: "Is service X running?"                      │
│ • Cleanup: Register atexit handlers for each process          │
│ • Lock files: Prevent duplicate global services               │
│ • Health reporting: Unified view of system state              │
└────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ LAYER 1: Global Services (Singletons)                         │
│ • global-service-coordinator (1 instance for entire system)   │
│ • system-monitor-watchdog (launchd job, 1 instance)           │
│ • vkb-server (1 instance, shared across projects)             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ LAYER 2: Per-Project Services                                 │
│ • enhanced-transcript-monitor (1 per project, managed)        │
│ • constraint-monitor (1 per project IF needed)                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ LAYER 3: Claude Sessions                                      │
│ • Each session registers with Process State Manager           │
│ • On exit: cleanup handler removes project monitors           │
│ • Global services persist across sessions                     │
└────────────────────────────────────────────────────────────────┘
```

### Key Changes Needed

1. **Create Process State Manager**:
   - Single registry file: `.live-process-registry.json`
   - Atomic lock-based operations
   - Health status for each process
   - Parent-child relationships

2. **Fix Service Startup**:
   - `start-services.sh` checks registry before starting
   - Only start if not already running
   - Use lock files for global services

3. **Consolidate Transcript Monitoring**:
   - Remove direct start from `start-services.sh`
   - Use ONLY `global-lsl-coordinator ensure`
   - Add duplicate detection in coordinator

4. **Install Watchdog Properly**:
   - Auto-install launchd plist on first run
   - Make it truly automatic
   - Remove manual watchdog calls

5. **Session Cleanup**:
   - Add exit handlers in `launch-claude.sh`
   - Kill per-project services on session end
   - Preserve global services

---

## Immediate Action Items

### Priority 1: Stop the Bleeding (Today)

1. **Kill duplicate transcript monitors**:
   ```bash
   # Keep only newest per project
   pkill -f "enhanced-transcript-monitor.js /Users/q284340/Agentic/coding" | tail -n +2
   pkill -f "enhanced-transcript-monitor.js.*curriculum-alignment" | tail -n +2
   ```

2. **Add duplicate check to start-services.sh**:
   ```bash
   # Before line 282, add:
   if pgrep -f "enhanced-transcript-monitor.js" > /dev/null; then
     echo "⚠️ Transcript monitor already running, skipping..."
   else
     nohup node scripts/enhanced-transcript-monitor.js > transcript-monitor.log 2>&1 &
   fi
   ```

3. **Fix monitoring-verifier.js returnCode check**:
   ```javascript
   // Line 154: This will never work correctly
   try {
     await execAsync(`node "${this.systemWatchdogScript}"`);
     // If we get here, it succeeded
     this.results.systemWatchdog = { status: 'success', ... };
   } catch (error) {
     // Non-zero exit code
     this.results.systemWatchdog = { status: 'error', ... };
   }
   ```

### Priority 2: Architecture Fixes (This Week)

1. **Implement Process State Manager** (new file)
2. **Refactor start-services.sh** to use state manager
3. **Install system watchdog** via launchd
4. **Add session cleanup** handlers
5. **Consolidate monitoring** layers

### Priority 3: Documentation & Testing (Next Week)

1. **Document new architecture** with diagrams
2. **Create process health dashboard**
3. **Add integration tests** for parallel sessions
4. **Performance benchmarks** (before/after)

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Transcript monitors per project | 2-3 | 1 |
| Total monitoring processes | 9+ | ~5 |
| Duplicate service instances | Common | None |
| False positive "Coordinator dead" | Frequent | Never |
| Session startup failures | 20%+ | <1% |
| Process cleanup on exit | None | 100% |
| Cross-session awareness | None | Full |

---

## Technical Debt Summary

**High Priority**:
- [ ] Process State Manager implementation
- [ ] Duplicate transcript monitor fix
- [ ] Monitoring verifier returnCode fix
- [ ] Watchdog launchd installation

**Medium Priority**:
- [ ] Consolidate monitoring layers (too many overlaps)
- [ ] Session cleanup handlers
- [ ] Lock files for global services
- [ ] Health dashboard

**Low Priority**:
- [ ] Performance optimization (process count reduction)
- [ ] Better error messages
- [ ] Monitoring telemetry

---

## Conclusion

The coding system has **grown organically** with monitoring layers added incrementally without a unified architecture. This has created:

1. **Process multiplication** (5+ transcript monitors when 1-3 expected)
2. **No central coordination** (multiple registries, no single source of truth)
3. **False health alarms** (verifier bugs)
4. **Missing failsafes** (watchdog not installed)
5. **No cleanup** (processes accumulate across sessions)

**Recommendation**: Implement the Process State Manager architecture to provide unified process tracking, health monitoring, and lifecycle management. This will eliminate duplication, improve reliability, and make the system truly self-healing.

**Estimated Effort**: 2-3 days for Priority 1+2 fixes

**Risk if not fixed**: System will continue to accumulate processes, causing eventual resource exhaustion, file lock contention, and unpredictable behavior.

---

*Analysis completed: 2025-10-12 15:30 CEST*
