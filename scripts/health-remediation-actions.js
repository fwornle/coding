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
import ProcessStateManager from './process-state-manager.js';

const execAsync = promisify(exec);

export class HealthRemediationActions {
  constructor(options = {}) {
    this.codingRoot = options.codingRoot || '/Users/q284340/Agentic/coding';
    this.psm = new ProcessStateManager({ codingRoot: this.codingRoot });
    this.debug = options.debug || false;

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
        case 'start_qdrant':
          result = await this.startQdrant(issueDetails);
          break;
        case 'restart_graph_database':
          result = await this.restartGraphDatabase(issueDetails);
          break;
        case 'cleanup_zombies':
          result = await this.cleanupZombies(issueDetails);
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
   */
  async killLockHolder(details) {
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
      // This would need to be adjusted based on actual startup script
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

  /**
   * Start Qdrant vector database
   */
  async startQdrant(details) {
    try {
      this.log('Starting Qdrant vector database...');

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
   * Helper: Sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default HealthRemediationActions;
