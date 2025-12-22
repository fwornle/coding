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
    this.launchdPlistPath = `${process.env.HOME}/Library/LaunchAgents/com.coding.system-watchdog.plist`;
    // Legacy registry path for cleanup (now using PSM instead)
    this.registryPath = path.join(this.codingRepoPath, '.global-service-registry.json');

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
   * Check if Global Service Coordinator is actually running
   */
  async isCoordinatorAlive() {
    try {
      // Use PSM to check coordinator status
      const isRunning = await this.psm.isServiceRunning('global-service-coordinator', 'global');

      if (!isRunning) {
        // Check if coordinator is running at OS level but not registered in PSM
        try {
          const { stdout } = await execAsync('pgrep -f "global-service-coordinator.js"', { timeout: 5000 });
          const pids = stdout.trim().split('\n').filter(p => p).map(p => parseInt(p, 10));

          if (pids.length > 0) {
            const pid = pids[0];
            this.log(`Found coordinator running at OS level (PID: ${pid}) but not in PSM - registering...`);

            // Register the orphaned coordinator
            await this.psm.registerService({
              name: 'global-service-coordinator',
              pid: pid,
              type: 'global',
              script: 'scripts/global-service-coordinator.js',
              metadata: { managedBy: 'watchdog-recovery', recoveredAt: new Date().toISOString() }
            });

            return { alive: true, pid: pid, healthAge: 0, recovered: true };
          }
        } catch (pgrepError) {
          // No coordinator running at OS level
        }

        this.warn('Coordinator not running according to PSM');
        return { alive: false, reason: 'not_in_psm' };
      }

      // Get detailed service info from PSM
      const service = await this.psm.getService('global-service-coordinator', 'global');

      if (!service) {
        this.warn('Coordinator not found in PSM registry');
        return { alive: false, reason: 'not_found_in_psm' };
      }

      const coordinatorPid = service.pid;

      // Test if PID is actually alive
      try {
        process.kill(coordinatorPid, 0); // Signal 0 tests existence without killing

        // Additional check: ensure process is actually our coordinator
        const { stdout } = await execAsync(`ps -p ${coordinatorPid} -o command=`);
        if (!stdout.includes('global-service-coordinator')) {
          this.warn(`PID ${coordinatorPid} exists but is not coordinator: ${stdout.trim()}`);
          return { alive: false, reason: 'wrong_process' };
        }

        // Check health timestamp - should be updated recently
        const healthAge = Date.now() - service.lastHealthCheck;
        if (healthAge > 120000) { // 2 minutes
          this.warn(`Health check stale (${healthAge}ms old) - coordinator may be frozen`);
          return { alive: false, reason: 'stale_health_check' };
        }

        return { alive: true, pid: coordinatorPid, healthAge };

      } catch (error) {
        this.warn(`Coordinator PID ${coordinatorPid} not found: ${error.message}`);
        return { alive: false, reason: 'pid_dead', pid: coordinatorPid };
      }

    } catch (error) {
      this.error(`Error checking coordinator: ${error.message}`);
      return { alive: false, reason: 'check_error', error: error.message };
    }
  }

  /**
   * Start the Global Service Coordinator
   */
  async startCoordinator() {
    try {
      this.log('Starting Global Service Coordinator...');

      // Ensure coordinator script exists
      if (!fs.existsSync(this.coordinatorScript)) {
        this.error(`Coordinator script not found: ${this.coordinatorScript}`);
        return false;
      }

      // Clean up stale registry first
      if (fs.existsSync(this.registryPath)) {
        fs.unlinkSync(this.registryPath);
        this.log('Cleaned up stale registry');
      }

      // Start coordinator as detached process
      const child = spawn('node', [this.coordinatorScript, '--daemon'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: this.codingRepoPath
      });

      child.unref(); // Allow parent to exit

      // Wait for coordinator to fully start and self-register with PSM
      // The coordinator registers itself, so we don't need to do it here
      this.log(`Waiting for coordinator to self-register (PID: ${child.pid})...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Retry the alive check a few times to handle startup timing
      let status = { alive: false, reason: 'not_checked' };
      for (let attempt = 1; attempt <= 3; attempt++) {
        status = await this.isCoordinatorAlive();
        if (status.alive) {
          break;
        }
        if (attempt < 3) {
          this.log(`Attempt ${attempt}/3: Coordinator not ready yet, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Only register if coordinator didn't self-register
      if (!status.alive && status.reason === 'not_in_psm') {
        try {
          await this.psm.registerService({
            name: 'global-service-coordinator',
            pid: child.pid,
            type: 'global',
            script: 'scripts/global-service-coordinator.js',
            metadata: {
              managedBy: 'watchdog',
              restartedBy: 'system-monitor-watchdog'
            }
          });
          this.log(`Fallback: Registered coordinator with PSM (PID: ${child.pid})`);
          // Re-check after fallback registration
          status = await this.isCoordinatorAlive();
        } catch (error) {
          this.warn(`Failed to register with PSM: ${error.message}`);
        }
      }
      if (status.alive) {
        this.log(`✅ Global Service Coordinator started successfully (PID: ${status.pid})`);
        return true;
      } else {
        this.error(`❌ Failed to start coordinator: ${status.reason}`);
        return false;
      }

    } catch (error) {
      this.error(`Error starting coordinator: ${error.message}`);
      return false;
    }
  }

  /**
   * Kill stale coordinator process
   */
  async killStaleCoordinator(pid) {
    try {
      this.log(`Killing stale coordinator process ${pid}`);
      
      // Try graceful shutdown first
      process.kill(pid, 'SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Force kill if still running
      try {
        process.kill(pid, 'SIGKILL');
        this.log(`Force killed coordinator ${pid}`);
      } catch (error) {
        // Process already gone
      }
      
    } catch (error) {
      // Process probably already gone
      this.log(`Coordinator ${pid} already terminated`);
    }
  }

  /**
   * Generate health report
   */
  async generateHealthReport() {
    const status = await this.isCoordinatorAlive();
    const timestamp = new Date().toISOString();

    // Get PSM health status
    let psmHealth = null;
    try {
      psmHealth = await this.psm.getHealthStatus();
    } catch (error) {
      // PSM might not be accessible
    }

    const report = {
      timestamp,
      watchdog: {
        version: '2.0.0', // Updated to reflect PSM integration
        logPath: this.watchdogLogPath,
        lastCheck: timestamp
      },
      coordinator: {
        alive: status.alive,
        reason: status.reason,
        pid: status.pid,
        healthAge: status.healthAge,
        registryPath: this.registryPath // Legacy, kept for backward compatibility
      },
      psm: psmHealth, // Include PSM health status
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
   * Main watchdog execution
   */
  async run() {
    this.log('🔍 System Watchdog: Checking Global Service Coordinator...');

    try {
      const status = await this.isCoordinatorAlive();
      const report = await this.generateHealthReport();

      if (status.alive) {
        this.log(`✅ Coordinator healthy (PID: ${status.pid}, health age: ${status.healthAge}ms)`);
        return { success: true, action: 'verified_healthy', report };
      } else {
        this.warn(`❌ Coordinator failed: ${status.reason}`);
        
        // Kill stale process if PID exists but wrong
        if (status.pid && status.reason === 'wrong_process') {
          await this.killStaleCoordinator(status.pid);
        }

        // Attempt restart
        const started = await this.startCoordinator();
        if (started) {
          this.log('🚀 Coordinator restart successful');
          return { success: true, action: 'restarted', report };
        } else {
          this.error('💥 Coordinator restart FAILED');
          return { success: false, action: 'restart_failed', report };
        }
      }

    } catch (error) {
      this.error(`Watchdog execution failed: ${error.message}`);
      const report = { error: error.message, timestamp: new Date().toISOString() };
      return { success: false, action: 'watchdog_error', report };
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
        <string>node</string>
        <string>${this.codingRepoPath}/scripts/system-monitor-watchdog.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${this.codingRepoPath}</string>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${this.watchdogLogPath}</string>
    <key>StandardErrorPath</key>
    <string>${this.watchdogLogPath}</string>
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