#!/usr/bin/env node

/**
 * UKB Process Manager
 *
 * Manages background UKB (Update Knowledge Base) workflow processes.
 * Features:
 * - Spawns workflows as background processes with logging
 * - Maintains process registry for monitoring
 * - Detects stale/frozen processes via heartbeat
 * - Provides cleanup mechanism for orphaned processes
 * - Integrates with status line and health dashboard
 */

import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRoot = process.env.CODING_REPO || join(__dirname, '..');

// Configuration
const CONFIG = {
  registryPath: join(codingRoot, '.data', 'ukb-processes.json'),
  logsDir: join(codingRoot, '.data', 'ukb-logs'),
  progressPath: join(codingRoot, '.data', 'workflow-progress.json'),
  heartbeatInterval: 10000,  // 10 seconds
  staleThreshold: 120000,    // 2 minutes without heartbeat = stale
  frozenThreshold: 300000,   // 5 minutes without progress = frozen
  maxLogAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxConcurrentProcesses: 3,
};

/**
 * Process registry entry
 */
class UKBProcessEntry {
  constructor(pid, workflowName, team, repositoryPath) {
    this.pid = pid;
    this.workflowName = workflowName;
    this.team = team;
    this.repositoryPath = repositoryPath;
    this.startTime = new Date().toISOString();
    this.lastHeartbeat = new Date().toISOString();
    this.lastProgress = null;
    this.status = 'running';
    this.completedSteps = 0;
    this.totalSteps = 0;
    this.currentStep = null;
    this.logFile = null;
  }
}

/**
 * UKB Process Manager
 */
class UKBProcessManager {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dataDir = join(codingRoot, '.data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    if (!existsSync(CONFIG.logsDir)) mkdirSync(CONFIG.logsDir, { recursive: true });
  }

  /**
   * Load process registry
   */
  loadRegistry() {
    try {
      if (existsSync(CONFIG.registryPath)) {
        return JSON.parse(readFileSync(CONFIG.registryPath, 'utf8'));
      }
    } catch (error) {
      console.error(`Error loading registry: ${error.message}`);
    }
    return { processes: [], lastUpdate: null };
  }

  /**
   * Save process registry
   */
  saveRegistry(registry) {
    registry.lastUpdate = new Date().toISOString();
    writeFileSync(CONFIG.registryPath, JSON.stringify(registry, null, 2));
  }

  /**
   * Check if a process is still running
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get active UKB processes count
   */
  getActiveCount() {
    const registry = this.loadRegistry();
    return registry.processes.filter(p =>
      p.status === 'running' && this.isProcessRunning(p.pid)
    ).length;
  }

  /**
   * Get process status summary for status line
   */
  getStatusSummary() {
    const registry = this.loadRegistry();
    const now = Date.now();

    let running = 0;
    let stale = 0;
    let frozen = 0;

    for (const proc of registry.processes) {
      if (!this.isProcessRunning(proc.pid)) {
        continue; // Dead process
      }

      const lastHeartbeat = new Date(proc.lastHeartbeat).getTime();
      const heartbeatAge = now - lastHeartbeat;

      if (heartbeatAge > CONFIG.frozenThreshold) {
        frozen++;
      } else if (heartbeatAge > CONFIG.staleThreshold) {
        stale++;
      } else {
        running++;
      }
    }

    return { running, stale, frozen, total: running + stale + frozen };
  }

  /**
   * Start a new UKB workflow process
   */
  async startWorkflow(workflowName, team, repositoryPath) {
    const registry = this.loadRegistry();

    // Check concurrent limit
    const activeCount = this.getActiveCount();
    if (activeCount >= CONFIG.maxConcurrentProcesses) {
      throw new Error(`Max concurrent UKB processes reached (${CONFIG.maxConcurrentProcesses}). Wait for current processes to complete.`);
    }

    // Create log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = join(CONFIG.logsDir, `ukb-${workflowName}-${team}-${timestamp}.log`);

    // Log header
    appendFileSync(logFile, `=== UKB Workflow: ${workflowName} ===\n`);
    appendFileSync(logFile, `Team: ${team}\n`);
    appendFileSync(logFile, `Repository: ${repositoryPath}\n`);
    appendFileSync(logFile, `Started: ${new Date().toISOString()}\n`);
    appendFileSync(logFile, `${'='.repeat(50)}\n\n`);

    // Spawn the workflow process
    const mcpServerPath = join(codingRoot, 'integrations', 'mcp-server-semantic-analysis', 'dist', 'cli.js');

    // Create a wrapper script that calls the MCP tool
    // Note: Both executeWorkflow() and executeBatchWorkflow() handle initialization internally via initializeAgents()
    // For batch workflows (batch-analysis, complete-analysis, incremental-analysis), use executeBatchWorkflow()
    const batchWorkflows = ['batch-analysis', 'complete-analysis', 'incremental-analysis'];
    const isBatchWorkflow = batchWorkflows.includes(workflowName);

    const wrapperScript = `
      import { CoordinatorAgent } from '${join(codingRoot, 'integrations', 'mcp-server-semantic-analysis', 'dist', 'agents', 'coordinator.js')}';

      const coordinator = new CoordinatorAgent('${repositoryPath}', '${team}');
      // Use executeBatchWorkflow for batch workflows, executeWorkflow for standard workflows
      const isBatch = ${isBatchWorkflow};
      const result = isBatch
        ? await coordinator.executeBatchWorkflow('${workflowName}', {
            repositoryPath: '${repositoryPath}',
            team: '${team}'
          })
        : await coordinator.executeWorkflow('${workflowName}', {
            repositoryPath: '${repositoryPath}',
            team: '${team}'
          });
      console.log(JSON.stringify(result, null, 2));
    `;

    const child = spawn('node', ['--input-type=module', '-e', wrapperScript], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CODING_REPO: codingRoot,
        UKB_LOG_FILE: logFile,
        UKB_REGISTRY_PATH: CONFIG.registryPath,
      }
    });

    // Create process entry
    const entry = new UKBProcessEntry(child.pid, workflowName, team, repositoryPath);
    entry.logFile = logFile;
    registry.processes.push(entry);
    this.saveRegistry(registry);

    // Pipe output to log file
    child.stdout.on('data', (data) => {
      appendFileSync(logFile, `[STDOUT] ${data}`);
      this.updateHeartbeat(child.pid);
    });

    child.stderr.on('data', (data) => {
      appendFileSync(logFile, `[STDERR] ${data}`);
      this.updateHeartbeat(child.pid);
    });

    child.on('close', (code) => {
      appendFileSync(logFile, `\n${'='.repeat(50)}\n`);
      appendFileSync(logFile, `Process exited with code: ${code}\n`);
      appendFileSync(logFile, `Completed: ${new Date().toISOString()}\n`);
      this.markCompleted(child.pid, code === 0 ? 'completed' : 'failed');
    });

    // Detach the child
    child.unref();

    return {
      pid: child.pid,
      logFile,
      message: `Started UKB workflow '${workflowName}' for team '${team}' (PID: ${child.pid})`
    };
  }

  /**
   * Update heartbeat for a process
   */
  updateHeartbeat(pid) {
    const registry = this.loadRegistry();
    const proc = registry.processes.find(p => p.pid === pid);
    if (proc) {
      proc.lastHeartbeat = new Date().toISOString();

      // Also update progress if available
      if (existsSync(CONFIG.progressPath)) {
        try {
          const progress = JSON.parse(readFileSync(CONFIG.progressPath, 'utf8'));
          // Only update if valid values (avoid 0/0 glitch from partial reads)
          const newCompletedSteps = progress.completedSteps || 0;
          const newTotalSteps = progress.totalSteps || 0;
          // Keep previous values if new read returns 0/0 (race condition during file write)
          if (newTotalSteps > 0 || !proc.totalSteps) {
            proc.completedSteps = newCompletedSteps;
            proc.totalSteps = newTotalSteps;
          }
          proc.currentStep = progress.currentStep || proc.currentStep || null;
          proc.lastProgress = new Date().toISOString();
        } catch (e) {
          // Ignore progress read errors - keep previous values
        }
      }

      this.saveRegistry(registry);
    }
  }

  /**
   * Mark process as completed
   */
  markCompleted(pid, status) {
    const registry = this.loadRegistry();
    const proc = registry.processes.find(p => p.pid === pid);
    if (proc) {
      proc.status = status;
      proc.endTime = new Date().toISOString();
      this.saveRegistry(registry);
    }
  }

  /**
   * Detect and clean up stale/frozen processes
   */
  cleanupStaleProcesses(dryRun = false) {
    const registry = this.loadRegistry();
    const now = Date.now();
    const cleaned = [];

    for (const proc of registry.processes) {
      if (proc.status !== 'running') continue;

      const lastHeartbeat = new Date(proc.lastHeartbeat).getTime();
      const heartbeatAge = now - lastHeartbeat;

      // Check if process is actually dead
      if (!this.isProcessRunning(proc.pid)) {
        if (!dryRun) {
          proc.status = 'orphaned';
          proc.endTime = new Date().toISOString();
        }
        cleaned.push({ pid: proc.pid, reason: 'process_dead', action: 'marked_orphaned' });
        continue;
      }

      // Check for frozen processes
      if (heartbeatAge > CONFIG.frozenThreshold) {
        if (!dryRun) {
          try {
            process.kill(proc.pid, 'SIGTERM');
            proc.status = 'killed_frozen';
            proc.endTime = new Date().toISOString();
            cleaned.push({ pid: proc.pid, reason: 'frozen', action: 'killed' });
          } catch (e) {
            cleaned.push({ pid: proc.pid, reason: 'frozen', action: 'kill_failed', error: e.message });
          }
        } else {
          cleaned.push({ pid: proc.pid, reason: 'frozen', action: 'would_kill' });
        }
      }
      // Check for stale processes (warning only)
      else if (heartbeatAge > CONFIG.staleThreshold) {
        cleaned.push({ pid: proc.pid, reason: 'stale', action: 'warning' });
      }
    }

    if (!dryRun && cleaned.length > 0) {
      this.saveRegistry(registry);
    }

    return cleaned;
  }

  /**
   * Clean up old log files
   */
  cleanupOldLogs() {
    const now = Date.now();
    const cleaned = [];

    try {
      const files = readdirSync(CONFIG.logsDir);
      for (const file of files) {
        const filePath = join(CONFIG.logsDir, file);
        const stat = statSync(filePath);
        const age = now - stat.mtime.getTime();

        if (age > CONFIG.maxLogAge) {
          unlinkSync(filePath);
          cleaned.push(file);
        }
      }
    } catch (error) {
      console.error(`Error cleaning logs: ${error.message}`);
    }

    return cleaned;
  }

  /**
   * Remove completed/failed processes from registry (keep last N)
   */
  pruneRegistry(keepLast = 20) {
    const registry = this.loadRegistry();

    // Separate running and completed
    const running = registry.processes.filter(p => p.status === 'running');
    const completed = registry.processes
      .filter(p => p.status !== 'running')
      .sort((a, b) => new Date(b.endTime || b.startTime) - new Date(a.endTime || a.startTime))
      .slice(0, keepLast);

    registry.processes = [...running, ...completed];
    this.saveRegistry(registry);

    return registry.processes.length;
  }

  /**
   * Get detailed status for health dashboard
   */
  getDetailedStatus() {
    const registry = this.loadRegistry();
    const now = Date.now();

    const processes = registry.processes.map(proc => {
      const lastHeartbeat = new Date(proc.lastHeartbeat).getTime();
      const heartbeatAge = now - lastHeartbeat;
      const isAlive = this.isProcessRunning(proc.pid);

      let health = 'healthy';
      if (!isAlive && proc.status === 'running') {
        health = 'dead';
      } else if (heartbeatAge > CONFIG.frozenThreshold) {
        health = 'frozen';
      } else if (heartbeatAge > CONFIG.staleThreshold) {
        health = 'stale';
      }

      return {
        ...proc,
        isAlive,
        health,
        heartbeatAgeSeconds: Math.round(heartbeatAge / 1000),
        progressPercent: proc.totalSteps > 0
          ? Math.round((proc.completedSteps / proc.totalSteps) * 100)
          : 0,
        // Force React to detect changes on each poll
        _refreshKey: now
      };
    });

    const summary = this.getStatusSummary();

    return {
      processes,
      summary,
      config: {
        staleThresholdSeconds: CONFIG.staleThreshold / 1000,
        frozenThresholdSeconds: CONFIG.frozenThreshold / 1000,
        maxConcurrent: CONFIG.maxConcurrentProcesses
      },
      lastUpdate: registry.lastUpdate
    };
  }
}

// CLI interface
async function main() {
  const manager = new UKBProcessManager();
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start': {
      const workflow = args[1] || 'complete-analysis';
      const team = args[2] || 'coding';
      const repoPath = args[3] || codingRoot;
      try {
        const result = await manager.startWorkflow(workflow, team, repoPath);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
      }
      break;
    }

    case 'status':
      console.log(JSON.stringify(manager.getDetailedStatus(), null, 2));
      break;

    case 'summary': {
      const summary = manager.getStatusSummary();
      console.log(`UKB Processes: ${summary.running} running, ${summary.stale} stale, ${summary.frozen} frozen`);
      break;
    }

    case 'cleanup': {
      const dryRun = args[1] === '--dry-run';
      const cleaned = manager.cleanupStaleProcesses(dryRun);
      console.log(JSON.stringify({ dryRun, cleaned }, null, 2));
      break;
    }

    case 'cleanup-logs': {
      const cleaned = manager.cleanupOldLogs();
      console.log(`Cleaned ${cleaned.length} old log files`);
      break;
    }

    case 'prune': {
      const keepLast = parseInt(args[1]) || 20;
      const count = manager.pruneRegistry(keepLast);
      console.log(`Registry pruned to ${count} entries`);
      break;
    }

    case 'count':
      console.log(manager.getActiveCount());
      break;

    default:
      console.log(`
UKB Process Manager

Usage:
  node ukb-process-manager.js <command> [options]

Commands:
  start [workflow] [team] [repo]  Start a new UKB workflow
  status                          Get detailed process status (JSON)
  summary                         Get process count summary
  count                           Get active process count only
  cleanup [--dry-run]             Clean up stale/frozen processes
  cleanup-logs                    Remove old log files
  prune [keepLast]                Prune completed processes from registry

Examples:
  node ukb-process-manager.js start complete-analysis coding /path/to/repo
  node ukb-process-manager.js status
  node ukb-process-manager.js cleanup --dry-run
`);
  }
}

// Export for use as module
export { UKBProcessManager, CONFIG };

// Run CLI if executed directly (not when imported as module)
if (process.argv[1] && process.argv[1].endsWith('ukb-process-manager.js')) {
  main().catch(console.error);
}
