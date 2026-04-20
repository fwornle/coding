#!/usr/bin/env node

/**
 * System-Level Watchdog - Ultimate Failsafe Monitor
 * 
 * Ensures the Global Service Coordinator always runs. This is the "monitor monitoring the monitor"
 * system that prevents single points of failure in the monitoring architecture.
 * 
 * Design:
 * - Run by system cron/launchd every minute
 * - Checks if Global Service Coordinator is alive
 * - Automatically restarts coordinator if dead
 * - Creates health reports for system administrators
 * - Cannot be killed by user processes (runs as system job)
 * 
 * Usage:
 *   node scripts/system-monitor-watchdog.js
 *   node scripts/system-monitor-watchdog.js --install-launchd
 *   node scripts/system-monitor-watchdog.js --status
 */

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import ProcessStateManager from './process-state-manager.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

class SystemMonitorWatchdog {
  constructor(options = {}) {
    this.codingRepoPath = options.codingRepoPath || path.resolve(__dirname, '..');
    this.watchdogLogPath = path.join(this.codingRepoPath, '.logs', 'system-watchdog.log');
    this.coordinatorScript = path.join(this.codingRepoPath, 'scripts', 'global-service-coordinator.js');
    this.supervisorScript = path.join(this.codingRepoPath, 'scripts', 'global-process-supervisor.js');
    this.launchdPlistPath = `${process.env.HOME}/Library/LaunchAgents/com.coding.system-watchdog.plist`;
    // Legacy registry path for cleanup (now using PSM instead)
    this.registryPath = path.join(this.codingRepoPath, '.global-service-registry.json');

    // Critical services that MUST always be running
    this.criticalServices = [
      {
        name: 'global-service-coordinator',
        script: this.coordinatorScript,
        psmType: 'global',
        pgrepPattern: 'global-service-coordinator.js',
        description: 'Manages constraint-api and constraint-dashboard'
      },
      {
        name: 'global-process-supervisor',
        script: this.supervisorScript,
        psmType: 'global',
        pgrepPattern: 'global-process-supervisor.js',
        description: 'Manages transcript monitors, health monitors, LLM proxy'
      }
    ];

    // Initialize Process State Manager for unified tracking
    this.psm = new ProcessStateManager(this.codingRepoPath);

    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.watchdogLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [SystemWatchdog] ${message}\n`;
    
    console.log(logEntry.trim());
    
    try {
      fs.appendFileSync(this.watchdogLogPath, logEntry);
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  error(message) {
    this.log(message, 'ERROR');
  }

  warn(message) {
    this.log(message, 'WARN');
  }

  /**
   * Check if a critical service is alive (generic — works for any service)
   */
  async isServiceAlive(service) {
    try {
      // Use PSM to check service status
      const isRunning = await this.psm.isServiceRunning(service.name, service.psmType);

      if (!isRunning) {
        // Check at OS level (PSM might be stale)
        let osPids = [];
        try {
          const { stdout } = await execAsync(`pgrep -f "${service.pgrepPattern}"`, { timeout: 5000 });
          osPids = stdout.trim().split('\n').filter(p => p).map(p => parseInt(p, 10));
        } catch (pgrepError) {
          // No process running at OS level
        }

        if (osPids.length > 0) {
          const pid = osPids[0];
          this.log(`Found ${service.name} at OS level (PID: ${pid}) but not in PSM - registering...`);

          try {
            await this.psm.registerService({
              name: service.name,
              pid: pid,
              type: service.psmType,
              script: path.relative(this.codingRepoPath, service.script),
              metadata: { managedBy: 'watchdog-recovery', recoveredAt: new Date().toISOString() }
            });
          } catch (registerError) {
            this.warn(`PSM registration for ${service.name} failed (non-fatal): ${registerError.message}`);
          }

          return { alive: true, pid, healthAge: 0, recovered: true };
        }

        this.warn(`${service.name} not running`);
        return { alive: false, reason: 'not_running' };
      }

      // Get detailed service info from PSM
      const svcInfo = await this.psm.getService(service.name, service.psmType);

      if (!svcInfo) {
        this.warn(`${service.name} not found in PSM registry`);
        return { alive: false, reason: 'not_found_in_psm' };
      }

      const svcPid = svcInfo.pid;

      // Test if PID is actually alive and correct
      try {
        process.kill(svcPid, 0); // Signal 0 tests existence

        const { stdout } = await execAsync(`ps -p ${svcPid} -o command=`);
        if (!stdout.includes(service.pgrepPattern.replace('.js', ''))) {
          this.warn(`PID ${svcPid} exists but is not ${service.name}: ${stdout.trim()}`);
          return { alive: false, reason: 'wrong_process', pid: svcPid };
        }

        // Check health timestamp freshness
        const healthAge = Date.now() - (svcInfo.lastHealthCheck || 0);
        if (healthAge > 120000) { // 2 minutes
          this.warn(`${service.name} health stale (${healthAge}ms old) - may be frozen`);
          return { alive: false, reason: 'stale_health_check', pid: svcPid };
        }

        return { alive: true, pid: svcPid, healthAge };

      } catch (error) {
        this.warn(`${service.name} PID ${svcPid} not found: ${error.message}`);
        return { alive: false, reason: 'pid_dead', pid: svcPid };
      }

    } catch (error) {
      this.error(`Error checking ${service.name}: ${error.message}`);
      return { alive: false, reason: 'check_error', error: error.message };
    }
  }

  /**
   * Start a critical service (generic — works for any service)
   */
  async startService(service) {
    try {
      this.log(`Starting ${service.name} (${service.description})...`);

      if (!fs.existsSync(service.script)) {
        this.error(`Script not found: ${service.script}`);
        return false;
      }

      // Kill any stale processes first
      try {
        const { stdout } = await execAsync(`pgrep -f "${service.pgrepPattern}"`, { timeout: 5000 });
        const stalePids = stdout.trim().split('\n').filter(p => p).map(p => parseInt(p, 10));
        for (const stalePid of stalePids) {
          this.log(`Killing stale ${service.name} process ${stalePid}`);
          try { process.kill(stalePid, 'SIGTERM'); } catch (e) { /* already gone */ }
        }
        if (stalePids.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          for (const stalePid of stalePids) {
            try { process.kill(stalePid, 'SIGKILL'); } catch (e) { /* already gone */ }
          }
        }
      } catch (pgrepError) {
        // No existing processes — good
      }

      // Start as detached process
      const nodePath = process.execPath || '/opt/homebrew/bin/node';
      const child = spawn(nodePath, [service.script, '--daemon'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: this.codingRepoPath
      });

      child.unref();

      this.log(`Waiting for ${service.name} to start (PID: ${child.pid})...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Retry alive check
      let status = { alive: false, reason: 'not_checked' };
      for (let attempt = 1; attempt <= 3; attempt++) {
        status = await this.isServiceAlive(service);
        if (status.alive) break;
        if (attempt < 3) {
          this.log(`Attempt ${attempt}/3: ${service.name} not ready yet, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Fallback PSM registration
      if (!status.alive && status.reason === 'not_running') {
        try {
          await this.psm.registerService({
            name: service.name,
            pid: child.pid,
            type: service.psmType,
            script: path.relative(this.codingRepoPath, service.script),
            metadata: { managedBy: 'watchdog', restartedBy: 'system-monitor-watchdog' }
          });
          this.log(`Fallback: Registered ${service.name} with PSM (PID: ${child.pid})`);
          status = await this.isServiceAlive(service);
        } catch (error) {
          this.warn(`Failed to register ${service.name} with PSM: ${error.message}`);
        }
      }

      if (status.alive) {
        this.log(`Restarted ${service.name} successfully (PID: ${status.pid})`);
        return true;
      } else {
        this.error(`Failed to start ${service.name}: ${status.reason}`);
        return false;
      }

    } catch (error) {
      this.error(`Error starting ${service.name}: ${error.message}`);
      return false;
    }
  }

  /**
   * Kill a stale service process
   */
  async killStaleService(serviceName, pid) {
    try {
      this.log(`Killing stale ${serviceName} process ${pid}`);
      process.kill(pid, 'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        process.kill(pid, 'SIGKILL');
        this.log(`Force killed ${serviceName} ${pid}`);
      } catch (error) {
        // Already gone
      }
    } catch (error) {
      this.log(`${serviceName} ${pid} already terminated`);
    }
  }

  // Backward-compatible aliases
  async isCoordinatorAlive() {
    return this.isServiceAlive(this.criticalServices[0]);
  }
  async startCoordinator() {
    return this.startService(this.criticalServices[0]);
  }

  /**
   * Generate health report for ALL critical services
   */
  async generateHealthReport() {
    const timestamp = new Date().toISOString();
    const serviceStatuses = {};

    for (const service of this.criticalServices) {
      serviceStatuses[service.name] = await this.isServiceAlive(service);
    }

    // Get PSM health status
    let psmHealth = null;
    try {
      psmHealth = await this.psm.getHealthStatus();
    } catch (error) {
      // PSM might not be accessible
    }

    const allHealthy = Object.values(serviceStatuses).every(s => s.alive);

    const report = {
      timestamp,
      watchdog: {
        version: '3.0.0', // v3: watches ALL critical services, not just coordinator
        logPath: this.watchdogLogPath,
        lastCheck: timestamp,
        criticalServiceCount: this.criticalServices.length
      },
      services: serviceStatuses,
      allHealthy,
      // Legacy field for backward compatibility
      coordinator: serviceStatuses['global-service-coordinator'],
      psm: psmHealth,
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        uptime: process.uptime(),
        workingDirectory: process.cwd()
      }
    };

    // Save report
    const reportPath = path.join(this.codingRepoPath, '.logs', 'system-health.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Main watchdog execution — checks ALL critical services
   */
  async run() {
    this.log(`System Watchdog: Checking ${this.criticalServices.length} critical services...`);

    const results = [];
    let anyFailure = false;

    try {
      for (const service of this.criticalServices) {
        const status = await this.isServiceAlive(service);

        if (status.alive) {
          this.log(`[OK] ${service.name} healthy (PID: ${status.pid}, age: ${status.healthAge}ms)`);
          results.push({ service: service.name, action: 'verified_healthy', status });
        } else {
          this.warn(`[FAIL] ${service.name}: ${status.reason}`);

          // Kill stale process if wrong
          if (status.pid && status.reason === 'wrong_process') {
            await this.killStaleService(service.name, status.pid);
          }

          // Attempt restart
          const started = await this.startService(service);
          if (started) {
            this.log(`[RESTARTED] ${service.name}`);
            results.push({ service: service.name, action: 'restarted' });
          } else {
            this.error(`[FAILED] ${service.name} restart FAILED`);
            results.push({ service: service.name, action: 'restart_failed' });
            anyFailure = true;
          }
        }
      }

      const report = await this.generateHealthReport();
      return { success: !anyFailure, results, report };

    } catch (error) {
      this.error(`Watchdog execution failed: ${error.message}`);
      return { success: false, action: 'watchdog_error', error: error.message };
    }
  }

  /**
   * Install launchd plist for automatic execution
   */
  installLaunchd() {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.coding.system-watchdog</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>${this.codingRepoPath}/scripts/system-monitor-watchdog.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${this.codingRepoPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin</string>
    </dict>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${this.codingRepoPath}/.logs/system-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>${this.codingRepoPath}/.logs/system-watchdog.log</string>
    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>`;

    try {
      fs.writeFileSync(this.launchdPlistPath, plistContent);
      console.log(`✅ Installed launchd plist: ${this.launchdPlistPath}`);
      console.log('To load: launchctl load ~/Library/LaunchAgents/com.coding.system-watchdog.plist');
      console.log('To unload: launchctl unload ~/Library/LaunchAgents/com.coding.system-watchdog.plist');
    } catch (error) {
      console.error(`Failed to install launchd plist: ${error.message}`);
    }
  }

  /**
   * Show current status
   */
  async showStatus() {
    const report = await this.generateHealthReport();
    console.log('📊 System Monitor Watchdog Status:');
    console.log(JSON.stringify(report, null, 2));
  }
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  const watchdog = new SystemMonitorWatchdog();

  if (args.includes('--install-launchd')) {
    watchdog.installLaunchd();
  } else if (args.includes('--status')) {
    await watchdog.showStatus();
  } else {
    // Default: run watchdog check
    const result = await watchdog.run();
    process.exit(result.success ? 0 : 1);
  }
}

runIfMain(import.meta.url, () => {
  main().catch(error => {
    console.error(`System Watchdog error: ${error.message}`);
    process.exit(1);
  });
});

export default SystemMonitorWatchdog;