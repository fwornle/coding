# 4-Layer Health Monitoring Architecture - Implementation Plan

## Current State Assessment

**What's Implemented (Layer 4):**
- ✅ ProcessStateManager with PID tracking and service registry
- ✅ Database health monitoring (Level DB lock detection, Qdrant availability)
- ✅ Enhanced Transcript Monitor (per-session monitoring)
- ✅ StatusLine Health Monitor (session discovery and display)
- ✅ VKB server PSM integration
- ✅ Fail-fast database initialization

**What's Missing (Layers 1-3):**
- ❌ Layer 1: Watchdog (global service monitoring and recovery)
- ❌ Layer 2: Coordinator (active multi-project coordination)
- ❌ Layer 3: Verifier (comprehensive health verification)

---

## Layer 4: Monitor (IMPLEMENTED ✅)

**Purpose**: Individual session monitoring at the lowest level

**Components:**
- Enhanced Transcript Monitor (`scripts/enhanced-transcript-monitor.js`)
- ProcessStateManager (`scripts/process-state-manager.js`)
- Database health checks

**Responsibilities:**
1. Monitor individual Claude Code session transcripts
2. Track process PIDs and health status
3. Detect database locks and conflicts
4. Provide real-time health metrics
5. Register/unregister services (global, per-project, per-session)

**Data Flow:**
```
Session Activity → Transcript Monitor → ProcessStateManager → Health Status
Database Operations → Lock Detection → Health Report
```

---

## Layer 3: Verifier (PLANNED ❌)

**Purpose**: Comprehensive health verification and proactive issue detection

**Components to Build:**
- `scripts/health-verifier.js` - Main verification engine
- `scripts/health-rules-engine.js` - Configurable health rules
- `scripts/health-reporter.js` - Health report generation

**Responsibilities:**
1. **Periodic Health Verification**
   - Run comprehensive health checks every N seconds (configurable)
   - Verify Layer 4 data integrity and consistency
   - Cross-validate ProcessStateManager registry with actual processes

2. **Proactive Issue Detection**
   - Detect stale PIDs (processes no longer running)
   - Identify resource exhaustion (disk space, memory, CPU)
   - Find orphaned processes not in PSM registry
   - Detect zombie transcript monitors

3. **Health Rule Evaluation**
   - Configurable rules for what constitutes "healthy"
   - Thresholds for warnings vs errors
   - Service-specific health criteria (e.g., VKB must be accessible, databases must be unlocked)

4. **Health Reporting**
   - Generate structured health reports (JSON format)
   - Categorize issues by severity (info, warning, error, critical)
   - Provide actionable remediation steps
   - Store health history for trend analysis

**Key Health Checks:**
```javascript
// Health verification checklist
const healthChecks = {
  // Database health
  levelDB: {
    check: () => checkDatabaseLock(),
    severity: 'critical',
    remediation: 'Stop VKB server or kill lock holder'
  },

  // Process health
  registeredServices: {
    check: () => verifyAllRegisteredProcessesAlive(),
    severity: 'warning',
    remediation: 'Clean up dead processes from registry'
  },

  // Resource health
  diskSpace: {
    check: () => checkDiskSpace('.data'),
    threshold: '90%',
    severity: 'error',
    remediation: 'Clear old logs or expand storage'
  },

  // Service health
  vkbServer: {
    check: () => testHTTPConnectivity('http://localhost:8080'),
    severity: 'warning',
    remediation: 'Restart VKB server'
  }
};
```

**Data Flow:**
```
Layer 4 Data → Health Verifier → Rules Engine → Health Report
                                             ↓
                                    Issue Detection
                                             ↓
                               Layer 2 (Coordinator)
```

**Output Format:**
```json
{
  "timestamp": "2025-11-08T10:30:00Z",
  "overallStatus": "degraded",
  "issues": [
    {
      "type": "database_lock",
      "severity": "critical",
      "component": "levelDB",
      "message": "Level DB locked by unregistered process (PID: 12345)",
      "remediation": "kill 12345 && ukb restart",
      "affectedServices": ["ukb", "graph-database"]
    }
  ],
  "healthMetrics": {
    "services": {
      "total": 5,
      "healthy": 3,
      "unhealthy": 2
    },
    "databases": {
      "levelDB": { "status": "locked", "lockedBy": 12345 },
      "qdrant": { "status": "unavailable" }
    }
  }
}
```

---

## Layer 2: Coordinator (PLANNED ❌)

**Purpose**: Active coordination and remediation across multiple projects

**Components to Build:**
- `scripts/health-coordinator.js` - Main coordination engine
- `scripts/remediation-actions.js` - Automated remediation library
- `scripts/coordination-strategies.js` - Multi-project coordination

**Responsibilities:**
1. **Consume Health Reports from Layer 3**
   - Subscribe to health verification results
   - Prioritize issues by severity
   - Track issue resolution progress

2. **Automated Remediation**
   - Execute remediation actions for known issues
   - Clean up stale PIDs from registry
   - Restart failed services automatically
   - Resolve database lock conflicts
   - Free orphaned resources

3. **Multi-Project Coordination**
   - Coordinate database access across projects
   - Prevent VKB/UKB conflicts (enforce mutual exclusion)
   - Manage shared resource allocation
   - Balance health monitoring load across projects

4. **Recovery Orchestration**
   - Implement recovery workflows for common failure scenarios
   - Coordinate service restarts in dependency order
   - Validate successful recovery
   - Escalate to Layer 1 if recovery fails

**Remediation Actions:**
```javascript
const remediationActions = {
  // Database conflicts
  'database_lock': async (issue) => {
    const pid = issue.details.lockedBy;
    const service = await psm.getServiceByPid(pid);

    if (service?.name === 'vkb-server') {
      // Graceful shutdown
      await vkb.stop();
    } else {
      // Force kill unregistered process
      process.kill(pid, 'SIGTERM');
    }

    // Wait and verify lock released
    await waitForLockRelease();
    return { success: true, action: 'killed_lock_holder' };
  },

  // Dead process cleanup
  'stale_pid': async (issue) => {
    await psm.cleanupDeadProcesses();
    return { success: true, action: 'cleaned_registry' };
  },

  // Service restart
  'service_down': async (issue) => {
    const serviceName = issue.details.service;
    await restartService(serviceName);
    await verifyServiceHealthy(serviceName);
    return { success: true, action: 'restarted_service' };
  }
};
```

**Coordination Strategies:**
```javascript
// VKB/UKB mutual exclusion
class DatabaseAccessCoordinator {
  async requestDatabaseAccess(requester, operation) {
    // Check if VKB server is running
    if (await psm.isServiceRunning('vkb-server', 'global')) {
      if (operation === 'write') {
        // UKB needs write access - stop VKB first
        await vkb.stop();
        await waitForLockRelease();
        return { granted: true, stoppedVKB: true };
      } else {
        // Read-only operations can coexist
        return { granted: true, stoppedVKB: false };
      }
    }

    return { granted: true, stoppedVKB: false };
  }

  async releaseDatabaseAccess(requester, options) {
    if (options.stoppedVKB && options.autoRestart) {
      // Restart VKB if we stopped it
      await vkb.start({ foreground: false });
    }
  }
}
```

**Data Flow:**
```
Layer 3 Health Report → Coordinator → Remediation Actions
                                   ↓
                          Recovery Workflows
                                   ↓
                    Verify Success (back to Layer 3)
                                   ↓
                 Escalate to Layer 1 if failed
```

---

## Layer 1: Watchdog (PARTIALLY IMPLEMENTED ⚠️)

**Purpose**: Ultimate failsafe monitoring - "Who watches the watchmen?"

**Existing Component:**
- `scripts/system-monitor-watchdog.js` (EXISTS but not integrated with launchd)

**What's Missing:**
1. launchd/cron integration for automatic startup
2. Self-recovery mechanisms
3. Alert/notification system
4. Integration with Layer 2 Coordinator

**Enhanced Responsibilities:**
1. **Monitor Layer 2 Coordinator**
   - Detect if Coordinator process crashes or hangs
   - Restart Coordinator automatically
   - Track restart count and prevent infinite restart loops

2. **System-Level Health Checks**
   - Verify entire monitoring stack is operational
   - Detect system-wide issues (out of disk, out of memory)
   - Monitor system resources (CPU, RAM, disk I/O)

3. **Escalation and Alerting**
   - Send notifications when automatic recovery fails
   - Create incident reports for manual intervention
   - Provide system administrator dashboard

4. **Cannot Be Killed**
   - Run as system service (launchd on macOS)
   - Restart automatically on system reboot
   - Protected from user process termination

**launchd Integration:**
```xml
<!-- ~/Library/LaunchAgents/com.coding.system-watchdog.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.coding.system-watchdog</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/q284340/Agentic/coding/scripts/system-monitor-watchdog.js</string>
    <string>--daemon</string>
  </array>

  <key>StartInterval</key>
  <integer>60</integer> <!-- Run every 60 seconds -->

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/q284340/Agentic/coding/.logs/watchdog-stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/q284340/Agentic/coding/.logs/watchdog-stderr.log</string>
</dict>
</plist>
```

**Installation Commands:**
```bash
# Install watchdog
launchctl load ~/Library/LaunchAgents/com.coding.system-watchdog.plist

# Check status
launchctl list | grep com.coding.system-watchdog

# Uninstall
launchctl unload ~/Library/LaunchAgents/com.coding.system-watchdog.plist
```

**Enhanced Watchdog Logic:**
```javascript
class SystemMonitorWatchdog {
  async run() {
    // 1. Check Layer 2 Coordinator health
    const coordinatorHealthy = await this.checkCoordinatorHealth();

    if (!coordinatorHealthy) {
      this.warn('Layer 2 Coordinator is unhealthy or missing');

      // Attempt restart (with backoff)
      const restarted = await this.restartCoordinator();

      if (!restarted) {
        this.error('Failed to restart Coordinator after 3 attempts');
        await this.sendAlert('CRITICAL: Coordinator restart failed');
        return;
      }
    }

    // 2. Check system resources
    const resources = await this.checkSystemResources();

    if (resources.diskUsage > 95) {
      this.error('Disk usage critical: ' + resources.diskUsage + '%');
      await this.sendAlert('CRITICAL: Disk space low');
    }

    // 3. Verify entire stack health
    const stackHealth = await this.verifyStackHealth();

    if (stackHealth.status !== 'healthy') {
      this.warn('Health monitoring stack degraded: ' + JSON.stringify(stackHealth));
    }

    // 4. Log success
    this.log('Watchdog check completed - system healthy');
  }

  async sendAlert(message) {
    // TODO: Implement notification system
    // - Email
    // - Slack webhook
    // - macOS notification center
    console.error(`ALERT: ${message}`);
  }
}
```

**Data Flow:**
```
System Timer (every 60s) → Watchdog
                              ↓
                  Check Layer 2 Coordinator
                              ↓
                       Restart if dead
                              ↓
                  Check system resources
                              ↓
                    Send alerts if critical
```

---

## Implementation Priority

### Phase 1: Layer 3 - Verifier (HIGHEST PRIORITY)
**Why First**: Provides comprehensive health visibility that Layer 2 needs

**Tasks:**
1. Create `scripts/health-verifier.js`
2. Implement health check registry with configurable rules
3. Add comprehensive database health checks
4. Generate structured health reports (JSON)
5. Integrate with ProcessStateManager
6. Test health verification accuracy

**Estimated Effort**: 2-3 sessions

### Phase 2: Layer 2 - Coordinator (MEDIUM PRIORITY)
**Why Second**: Enables automated remediation based on Layer 3 reports

**Tasks:**
1. Create `scripts/health-coordinator.js`
2. Implement remediation action library
3. Add database access coordination (VKB/UKB mutual exclusion)
4. Create recovery workflows for common failures
5. Add escalation logic to Layer 1
6. Test automated remediation

**Estimated Effort**: 3-4 sessions

### Phase 3: Layer 1 - Watchdog (LOWER PRIORITY)
**Why Last**: Only needed when Layers 2-4 are fully operational

**Tasks:**
1. Complete `scripts/system-monitor-watchdog.js`
2. Create launchd plist configuration
3. Add alert/notification system
4. Implement restart backoff logic
5. Add system resource monitoring
6. Test launchd integration

**Estimated Effort**: 2-3 sessions

---

## Success Metrics

**Layer 3 Success Criteria:**
- ✅ Detects all database lock conflicts within 5 seconds
- ✅ Identifies stale PIDs with 100% accuracy
- ✅ Generates actionable remediation steps
- ✅ Health reports are structured and machine-parseable

**Layer 2 Success Criteria:**
- ✅ Automatically resolves 80%+ of database conflicts
- ✅ Prevents VKB/UKB conflicts through coordination
- ✅ Restarts failed services within 10 seconds
- ✅ Escalates unresolvable issues to Layer 1

**Layer 1 Success Criteria:**
- ✅ Detects Coordinator failures within 60 seconds
- ✅ Restarts Coordinator automatically with 95%+ success rate
- ✅ Sends alerts for critical failures
- ✅ Survives system reboots and resumes monitoring

---

## Architecture Benefits

**With Full 4-Layer Implementation:**
1. **Self-Healing**: System automatically recovers from most failures
2. **No Silent Failures**: Every issue is detected and reported
3. **Actionable Errors**: Clear instructions for manual intervention when needed
4. **High Availability**: Multiple layers of redundancy prevent downtime
5. **Observability**: Complete visibility into system health at all times

**The Stack:**
```
Layer 1: Watchdog (System-level monitoring)
   ↓
Layer 2: Coordinator (Automated remediation)
   ↓
Layer 3: Verifier (Health verification)
   ↓
Layer 4: Monitor (Process/database monitoring)
   ↓
Actual Services (VKB, UKB, GraphDB, etc.)
```

---

## Current Recommendation

**START WITH LAYER 3** - The Verifier is the missing link that will:
1. Give visibility into what's actually broken
2. Provide structured data for Layer 2 to act on
3. Replace manual debugging with automated health checks
4. Prevent the "Level DB unavailable" silent failures you experienced

Once Layer 3 is operational, you'll have clear, actionable health reports that make implementing Layer 2 (automated remediation) straightforward.
