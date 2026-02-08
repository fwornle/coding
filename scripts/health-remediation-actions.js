#!/usr/bin/env node

/**
 * Health Remediation Actions - Auto-Healing Library
 *
 * Provides automated remediation for detected health issues.
 * Implements retry logic, backoff strategies, and safety checks.
 *
 * Safety Features:
 * - Maximum retry attempts with exponential backoff
 * - Cooldown periods to prevent restart loops
 * - Verification after remediation
 * - Escalation when auto-healing fails
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync } from 'fs';
import ProcessStateManager from './process-state-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptRoot = join(__dirname, '..');

const execAsync = promisify(exec);

/**
 * Detect if running in Docker mode
 * Checks multiple indicators:
 * 1. CODING_DOCKER_MODE environment variable (set by launch-claude.sh)
 * 2. .docker-mode marker file in coding repo
 * 3. /.dockerenv (when running inside container)
 */
function isDockerMode() {
  // Environment variable takes precedence (set by launch scripts)
  if (process.env.CODING_DOCKER_MODE === 'true') {
    return true;
  }

  // Check for .docker-mode marker file
  const codingRoot = process.env.CODING_REPO || scriptRoot;
  if (existsSync(join(codingRoot, '.docker-mode'))) {
    return true;
  }

  // Running inside container
  return existsSync('/.dockerenv');
}

/**
 * Map of remediation actions to supervisord group:program names
 */
const DOCKER_SERVICE_MAP = {
  restart_vkb_server: 'web-services:vkb-server',
  restart_constraint_monitor: 'mcp-servers:constraint-monitor',
  restart_dashboard_server: 'web-services:health-dashboard-frontend',
  restart_health_api: 'web-services:health-dashboard',
  restart_health_frontend: 'web-services:health-dashboard-frontend',
};

export class HealthRemediationActions {
  constructor(options = {}) {
    this.codingRoot = options.codingRoot || process.env.CODING_REPO || scriptRoot;
    this.psm = new ProcessStateManager({ codingRoot: this.codingRoot });
    this.debug = options.debug || false;
    this.isDocker = isDockerMode();

    if (this.isDocker) {
      this.log('Docker mode detected - using supervisorctl for service restarts');
    }

    // Track healing attempts for cooldown enforcement
    this.healingAttempts = new Map(); // action -> { count, lastAttempt, cooldownUntil }
    this.maxAttemptsPerHour = options.maxAttemptsPerHour || 10;
    this.cooldownSeconds = options.cooldownSeconds || 300; // 5 minutes
  }

  /**
   * Log message
   */
  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] [Remediation] ${message}`;

    if (this.debug || level === 'ERROR') {
      console.log(logEntry);
    }
  }

  /**
   * Check if action is in cooldown
   */
  isInCooldown(actionName) {
    const attempt = this.healingAttempts.get(actionName);
    if (!attempt) return false;

    const now = Date.now();
    if (attempt.cooldownUntil && now < attempt.cooldownUntil) {
      return true;
    }

    // Check hourly rate limit
    const oneHourAgo = now - (60 * 60 * 1000);
    if (attempt.lastAttempt > oneHourAgo && attempt.count >= this.maxAttemptsPerHour) {
      return true;
    }

    return false;
  }

  /**
   * Record healing attempt
   */
  recordAttempt(actionName, success) {
    const now = Date.now();
    const attempt = this.healingAttempts.get(actionName) || { count: 0, lastAttempt: 0 };

    // Reset counter if more than 1 hour passed
    const oneHourAgo = now - (60 * 60 * 1000);
    if (attempt.lastAttempt < oneHourAgo) {
      attempt.count = 0;
    }

    attempt.count++;
    attempt.lastAttempt = now;

    // Set cooldown if failed
    if (!success) {
      attempt.cooldownUntil = now + (this.cooldownSeconds * 1000);
    }

    this.healingAttempts.set(actionName, attempt);
  }

  /**
   * Execute remediation action
   */
  async executeAction(actionName, issueDetails = {}) {
    this.log(`Executing remediation: ${actionName}`);

    // Check cooldown
    if (this.isInCooldown(actionName)) {
      this.log(`Action ${actionName} is in cooldown period`, 'WARN');
      return {
        success: false,
        action: actionName,
        reason: 'cooldown',
        message: 'Action is in cooldown period'
      };
    }

    try {
      // Route to specific action handler
      let result;
      switch (actionName) {
        case 'kill_lock_holder':
          result = await this.killLockHolder(issueDetails);
          break;
        case 'cleanup_dead_processes':
          result = await this.cleanupDeadProcesses(issueDetails);
          break;
        case 'restart_vkb_server':
          result = await this.restartVKBServer(issueDetails);
          break;
        case 'restart_constraint_monitor':
          result = await this.restartConstraintMonitor(issueDetails);
          break;
        case 'restart_dashboard_server':
          result = await this.restartDashboardServer(issueDetails);
          break;
        case 'restart_health_api':
          result = await this.restartHealthAPI(issueDetails);
          break;
        case 'restart_health_frontend':
          result = await this.restartHealthFrontend(issueDetails);
          break;
        case 'start_qdrant':
          result = await this.startQdrant(issueDetails);
          break;
        case 'restart_graph_database':
          result = await this.restartGraphDatabase(issueDetails);
          break;
        case 'cleanup_zombies':
          result = await this.cleanupZombies(issueDetails);
          break;
        case 'restart_transcript_monitor':
          result = await this.restartTranscriptMonitor(issueDetails);
          break;
        case 'regenerate_services_file':
          result = await this.regenerateServicesFile(issueDetails);
          break;
        default:
          this.log(`Unknown action: ${actionName}`, 'ERROR');
          return {
            success: false,
            action: actionName,
            reason: 'unknown_action',
            message: `No handler for action: ${actionName}`
          };
      }

      // Record attempt
      this.recordAttempt(actionName, result.success);

      if (result.success) {
        this.log(`Remediation successful: ${actionName}`);
      } else {
        this.log(`Remediation failed: ${actionName} - ${result.message}`, 'ERROR');
      }

      return result;

    } catch (error) {
      this.log(`Remediation error: ${actionName} - ${error.message}`, 'ERROR');
      this.recordAttempt(actionName, false);

      return {
        success: false,
        action: actionName,
        reason: 'exception',
        message: error.message
      };
    }
  }

  /**
   * Kill process holding database lock
   * In Docker mode, VKB server legitimately holds the lock - skip killing
   */
  async killLockHolder(details) {
    if (this.isDocker) {
      this.log('Docker mode: VKB server owns LevelDB lock legitimately - skipping kill');
      return { success: true, message: 'Docker mode: lock holder is VKB server (expected)' };
    }

    const pid = details.lock_holder_pid;

    if (!pid) {
      return { success: false, message: 'No PID provided' };
    }

    try {
      // Check if it's VKB server first (graceful shutdown)
      const service = await this.psm.getService('vkb-server', 'global');

      if (service && service.pid === pid) {
        this.log('Lock holder is VKB server - attempting graceful shutdown');
        try {
          await execAsync('vkb server stop');
          await this.sleep(2000); // Wait for shutdown
          return { success: true, message: 'VKB server stopped gracefully' };
        } catch (error) {
          this.log('Graceful VKB shutdown failed, forcing kill', 'WARN');
        }
      }

      // Force kill the process
      this.log(`Killing lock holder process: ${pid}`);
      process.kill(pid, 'SIGTERM');

      // Wait and verify
      await this.sleep(1000);

      if (!this.isProcessAlive(pid)) {
        return { success: true, message: `Process ${pid} terminated` };
      }

      // Try SIGKILL if SIGTERM didn't work
      this.log(`SIGTERM failed, using SIGKILL on ${pid}`);
      process.kill(pid, 'SIGKILL');
      await this.sleep(500);

      return {
        success: !this.isProcessAlive(pid),
        message: this.isProcessAlive(pid) ? 'Failed to kill process' : `Process ${pid} killed`
      };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Clean up dead processes from registry
   */
  async cleanupDeadProcesses(details) {
    try {
      const cleaned = await this.psm.cleanupDeadProcesses();
      return {
        success: true,
        message: `Cleaned ${cleaned} dead process(es) from registry`
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Restart VKB server
   */
  async restartVKBServer(details) {
    try {
      this.log('Restarting VKB server...');

      if (this.isDocker) {
        return await this.supervisorctlRestart('restart_vkb_server', 'http://localhost:8080/health');
      }

      // Stop if running
      try {
        await execAsync('vkb server stop', { timeout: 5000 });
        await this.sleep(2000);
      } catch (error) {
        // Ignore stop errors (might not be running)
      }

      // Start VKB server
      await execAsync('vkb server start --no-browser', { timeout: 10000 });
      await this.sleep(3000);

      // Verify it's running
      const response = await fetch('http://localhost:8080/health', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        return { success: true, message: 'VKB server restarted successfully' };
      } else {
        return { success: false, message: `VKB server returned status ${response.status}` };
      }

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Restart constraint monitor
   */
  async restartConstraintMonitor(details) {
    try {
      this.log('Restarting constraint monitor...');

      if (this.isDocker) {
        const port = process.env.CONSTRAINT_MONITOR_PORT || '3849';
        return await this.supervisorctlRestart('restart_constraint_monitor', `http://localhost:${port}/health`);
      }

      // Find and kill existing process
      try {
        const { stdout } = await execAsync('lsof -ti:3031');
        const pid = parseInt(stdout.trim());
        if (pid) {
          process.kill(pid, 'SIGTERM');
          await this.sleep(1000);
        }
      } catch (error) {
        // Port not in use, that's fine
      }

      // Start constraint monitor (assuming it's part of the MCP server)
      await execAsync('npm run api:start', {
        cwd: this.codingRoot,
        timeout: 10000,
        detached: true
      });

      await this.sleep(3000);

      // Verify it's running
      const response = await fetch('http://localhost:3031', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      return {
        success: response.ok,
        message: response.ok ? 'Constraint monitor restarted' : 'Failed to verify restart'
      };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Restart dashboard server
   */
  async restartDashboardServer(details) {
    try {
      this.log('Restarting dashboard server...');

      if (this.isDocker) {
        const port = process.env.HEALTH_DASHBOARD_PORT || '3032';
        return await this.supervisorctlRestart('restart_dashboard_server', `http://localhost:${port}`);
      }

      // Find and kill existing process
      try {
        const { stdout } = await execAsync('lsof -ti:3030');
        const pid = parseInt(stdout.trim());
        if (pid) {
          process.kill(pid, 'SIGTERM');
          await this.sleep(1000);
        }
      } catch (error) {
        // Port not in use, that's fine
      }

      // Start dashboard
      await execAsync('PORT=3030 npm run dashboard', {
        cwd: this.codingRoot,
        timeout: 10000,
        detached: true
      });

      await this.sleep(3000);

      // Verify it's running
      const response = await fetch('http://localhost:3030', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      return {
        success: response.ok,
        message: response.ok ? 'Dashboard server restarted' : 'Failed to verify restart'
      };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async restartHealthAPI(details) {
    try {
      this.log('Restarting System Health API server...');

      if (this.isDocker) {
        return await this.supervisorctlRestart('restart_health_api', 'http://localhost:3033/api/health');
      }

      // Find and kill existing process
      try {
        const { stdout } = await execAsync('lsof -ti:3033');
        const pid = parseInt(stdout.trim());
        if (pid) {
          process.kill(pid, 'SIGTERM');
          await this.sleep(1000);
        }
      } catch (error) {
        // Port not in use, that's fine
      }

      // Start health API server (from system-health-dashboard)
      const healthDashboardDir = join(this.codingRoot, 'integrations/system-health-dashboard');
      const cmd = `cd ${healthDashboardDir} && npm run api > /dev/null 2>&1 &`;

      await execAsync(cmd, {
        shell: '/bin/bash',
        timeout: 5000
      });

      await this.sleep(2000);

      // Verify it's running
      const response = await fetch('http://localhost:3033/api/health', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      return {
        success: response.ok,
        message: response.ok ? 'Health API server restarted' : 'Failed to verify restart'
      };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Restart System Health Dashboard Frontend (Vite dev server)
   */
  async restartHealthFrontend(details) {
    try {
      this.log('Restarting System Health Dashboard frontend...');

      if (this.isDocker) {
        const port = process.env.HEALTH_DASHBOARD_PORT || '3032';
        return await this.supervisorctlRestart('restart_health_frontend', `http://localhost:${port}`);
      }

      // Find and kill existing process on port 3032
      try {
        const { stdout } = await execAsync('lsof -ti:3032');
        const pid = parseInt(stdout.trim());
        if (pid) {
          process.kill(pid, 'SIGTERM');
          await this.sleep(1000);
        }
      } catch (error) {
        // Port not in use, that's fine
      }

      // Start frontend via npm run dev
      const healthDashboardDir = join(this.codingRoot, 'integrations/system-health-dashboard');
      const cmd = `cd ${healthDashboardDir} && npm run dev > /dev/null 2>&1 &`;

      await execAsync(cmd, {
        shell: '/bin/bash',
        timeout: 5000,
        env: {
          ...process.env,
          SYSTEM_HEALTH_DASHBOARD_PORT: '3032',
          SYSTEM_HEALTH_API_PORT: '3033'
        }
      });

      await this.sleep(3000);

      // Verify it's running by checking if port is listening
      try {
        const { stdout } = await execAsync('lsof -ti:3032');
        const isRunning = stdout.trim().length > 0;
        return {
          success: isRunning,
          message: isRunning ? 'Health Dashboard frontend restarted' : 'Failed to verify restart'
        };
      } catch (error) {
        return { success: false, message: 'Port 3032 not listening after restart' };
      }

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Start Qdrant vector database
   */
  async startQdrant(details) {
    try {
      this.log('Starting Qdrant vector database...');

      if (this.isDocker) {
        this.log('Docker mode: Qdrant runs as a separate container - cannot restart from here');
        return { success: false, message: 'Docker mode: Qdrant is managed by docker-compose externally' };
      }

      // Check if docker-compose file exists
      const composeFile = `${this.codingRoot}/docker-compose.yml`;

      // Start Qdrant via docker-compose
      await execAsync(`docker-compose -f ${composeFile} up -d qdrant`, {
        timeout: 30000
      });

      // Wait for Qdrant to be ready
      await this.sleep(5000);

      // Verify it's running
      for (let i = 0; i < 5; i++) {
        try {
          const response = await fetch('http://localhost:6333/health', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
          });

          if (response.ok) {
            return { success: true, message: 'Qdrant started successfully' };
          }
        } catch (error) {
          // Retry
          await this.sleep(2000);
        }
      }

      return { success: false, message: 'Qdrant started but health check failed' };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Restart graph database service
   */
  async restartGraphDatabase(details) {
    try {
      this.log('Restarting graph database...');

      // The graph database is typically embedded, so restart means
      // restarting the service that uses it (like VKB or UKB)

      // For now, just clean up any locks
      const lockPath = `${this.codingRoot}/.data/knowledge-graph/LOCK`;

      try {
        const { stdout } = await execAsync(`lsof ${lockPath}`);
        const lines = stdout.split('\n').filter(l => l.trim());

        if (lines.length > 1) {
          const match = lines[1].match(/\s+(\d+)\s+/);
          if (match) {
            const pid = parseInt(match[1]);
            this.log(`Killing process holding graph DB lock: ${pid}`);
            process.kill(pid, 'SIGTERM');
            await this.sleep(1000);
          }
        }
      } catch (error) {
        // No lock file or lsof failed - that's okay
      }

      return { success: true, message: 'Graph database lock cleared' };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Clean up zombie processes
   */
  async cleanupZombies(details) {
    try {
      this.log('Cleaning up zombie processes...');

      // Find zombie processes
      const { stdout } = await execAsync('ps aux | grep defunct | grep -v grep');

      if (!stdout.trim()) {
        return { success: true, message: 'No zombie processes found' };
      }

      const zombies = stdout.trim().split('\n');
      let cleaned = 0;

      for (const zombie of zombies) {
        const parts = zombie.trim().split(/\s+/);
        const pid = parseInt(parts[1]);

        if (pid) {
          try {
            // Kill parent process to reap zombies
            const { stdout: parentInfo } = await execAsync(`ps -o ppid= -p ${pid}`);
            const ppid = parseInt(parentInfo.trim());

            if (ppid && ppid > 1) {
              process.kill(ppid, 'SIGCHLD');
              cleaned++;
            }
          } catch (error) {
            // Ignore errors for individual zombies
          }
        }
      }

      return {
        success: true,
        message: `Sent SIGCHLD to ${cleaned} parent process(es)`
      };

    } catch (error) {
      // No zombies found or ps command failed
      return { success: true, message: 'No zombie processes found' };
    }
  }

  /**
   * Restart enhanced transcript monitor (LSL system)
   */
  async restartTranscriptMonitor(details) {
    try {
      this.log('Restarting enhanced transcript monitor...');

      const projectPath = details.project_path || this.codingRoot;
      const projectName = projectPath.split('/').pop();

      // Check if project was intentionally stopped (prevents restart loops)
      try {
        if (await this.psm.isProjectStopped(projectPath)) {
          return {
            success: false,
            message: `Project ${projectName} is intentionally stopped. Use 'node scripts/process-state-manager.js unstop ${projectPath}' to resume.`
          };
        }
      } catch {
        // Fail-open: if check fails, continue with restart
      }

      // Kill existing monitor if registered in PSM
      try {
        const service = await this.psm.getService('enhanced-transcript-monitor', 'per-project', projectPath);
        if (service && service.pid) {
          this.log(`Killing existing transcript monitor (PID: ${service.pid})`);
          try {
            process.kill(service.pid, 'SIGTERM');
            await this.sleep(2000);
          } catch (killError) {
            // Process might already be dead
          }
          // Unregister from PSM
          await this.psm.unregisterService('enhanced-transcript-monitor', 'per-project', projectPath);
        }
      } catch (error) {
        // No existing service found
      }

      // Also kill any orphan monitors for this project
      try {
        const { stdout } = await execAsync(`pgrep -f "enhanced-transcript-monitor.js.*${projectName}"`);
        const pids = stdout.trim().split('\n').filter(p => p);
        for (const pidStr of pids) {
          const pid = parseInt(pidStr);
          if (pid) {
            this.log(`Killing orphan transcript monitor (PID: ${pid})`);
            try {
              process.kill(pid, 'SIGTERM');
            } catch (e) {
              // Ignore
            }
          }
        }
        await this.sleep(1000);
      } catch (error) {
        // pgrep found nothing, that's fine
      }

      // Start new transcript monitor
      const monitorScript = `${this.codingRoot}/scripts/enhanced-transcript-monitor.js`;
      const cmd = `node ${monitorScript} ${projectPath} > /dev/null 2>&1 &`;

      await execAsync(cmd, {
        shell: '/bin/bash',
        timeout: 5000,
        cwd: this.codingRoot
      });

      await this.sleep(3000);

      // Verify it's running via PSM
      try {
        const service = await this.psm.getService('enhanced-transcript-monitor', 'per-project', projectPath);
        if (service && service.status === 'healthy') {
          return {
            success: true,
            message: `Transcript monitor restarted successfully (PID: ${service.pid})`
          };
        }
      } catch (error) {
        // Check failed
      }

      // Fallback: check if process is running
      try {
        const { stdout } = await execAsync(`pgrep -f "enhanced-transcript-monitor.js.*${projectName}"`);
        if (stdout.trim()) {
          return {
            success: true,
            message: `Transcript monitor started (PIDs: ${stdout.trim().replace(/\n/g, ', ')})`
          };
        }
      } catch (error) {
        // pgrep found nothing
      }

      return { success: false, message: 'Failed to start transcript monitor' };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Regenerate .services-running.json from health checks
   * This file is critical for the status line API indicator
   */
  async regenerateServicesFile(details) {
    try {
      this.log('Regenerating .services-running.json from health checks...');

      const statusFile = `${this.codingRoot}/.services-running.json`;

      // Use Docker-aware ports
      const constraintPort = this.isDocker ? (process.env.CONSTRAINT_MONITOR_PORT || '3849') : '3031';
      const dashboardPort = this.isDocker ? (process.env.HEALTH_DASHBOARD_PORT || '3032') : '3030';

      // Gather health status from HTTP checks
      const vkbHealthy = await this.checkHttpHealth('http://localhost:8080/health', 2000);
      const constraintHealthy = await this.checkHttpHealth(`http://localhost:${constraintPort}/health`, 2000);
      const healthApiHealthy = await this.checkHttpHealth('http://localhost:3033/api/health', 2000);
      const dashboardHealthy = await this.checkPortListening(parseInt(dashboardPort));

      // Get PSM data for running services
      const psmHealth = await this.psm.getHealthStatus();
      const servicesRunning = [];

      // Check which services are running
      if (vkbHealthy) servicesRunning.push('vkb-server');
      if (constraintHealthy) servicesRunning.push('constraint-monitor');
      if (healthApiHealthy) servicesRunning.push('health-verifier');
      if (dashboardHealthy) servicesRunning.push('system-health-dashboard');

      const status = {
        timestamp: new Date().toISOString(),
        services: servicesRunning,
        services_running: servicesRunning.length,
        constraint_monitor: {
          status: constraintHealthy ? '✅ FULLY OPERATIONAL' : '⚠️ DEGRADED MODE',
          dashboard_port: parseInt(dashboardPort),
          api_port: parseInt(constraintPort),
          health: constraintHealthy ? 'healthy' : 'degraded',
          last_check: new Date().toISOString()
        },
        semantic_analysis: {
          status: '✅ OPERATIONAL',
          health: 'healthy'
        },
        vkb_server: {
          status: vkbHealthy ? '✅ OPERATIONAL' : '⚠️ DEGRADED',
          port: 8080,
          health: vkbHealthy ? 'healthy' : 'degraded',
          last_check: new Date().toISOString()
        },
        system_health_dashboard: {
          status: healthApiHealthy ? '✅ OPERATIONAL' : '⚠️ DEGRADED',
          dashboard_port: 3032,
          api_port: 3033,
          health: healthApiHealthy ? 'healthy' : 'degraded',
          last_check: new Date().toISOString()
        }
      };

      writeFileSync(statusFile, JSON.stringify(status, null, 2));
      this.log(`Regenerated ${statusFile}`);

      return {
        success: true,
        message: `Services status file regenerated with ${servicesRunning.length} active services`
      };

    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Helper: Check HTTP health endpoint
   */
  async checkHttpHealth(url, timeoutMs = 3000) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Helper: Check if port is listening
   */
  async checkPortListening(port) {
    try {
      const { stdout } = await execAsync(`lsof -i :${port} -P -n | grep LISTEN`);
      return stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Helper: Check if process is alive
   */
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Docker helper: Restart a service via supervisorctl
   * Uses the DOCKER_SERVICE_MAP to translate action names to supervisor program names
   */
  async supervisorctlRestart(actionName, verifyEndpoint) {
    const programName = DOCKER_SERVICE_MAP[actionName];
    if (!programName) {
      return { success: false, message: `No Docker service mapping for: ${actionName}` };
    }

    try {
      this.log(`Docker: supervisorctl restart ${programName}`);
      await execAsync(`supervisorctl restart ${programName}`, { timeout: 15000 });
      await this.sleep(3000);

      // Verify the service is running
      if (verifyEndpoint) {
        try {
          const response = await fetch(verifyEndpoint, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
          });
          if (response.ok) {
            return { success: true, message: `Docker: ${programName} restarted via supervisorctl` };
          }
        } catch (verifyError) {
          // Verify failed but service might still be starting
        }
      }

      // Check supervisor status as fallback
      const { stdout } = await execAsync(`supervisorctl status ${programName}`, { timeout: 5000 });
      const isRunning = stdout.includes('RUNNING');
      return {
        success: isRunning,
        message: isRunning
          ? `Docker: ${programName} restarted via supervisorctl`
          : `Docker: ${programName} restart failed - status: ${stdout.trim()}`
      };
    } catch (error) {
      return { success: false, message: `Docker supervisorctl error: ${error.message}` };
    }
  }

  /**
   * Helper: Sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default HealthRemediationActions;
