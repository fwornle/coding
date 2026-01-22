#!/usr/bin/env node

/**
 * Robust Service Starter for Coding Infrastructure
 *
 * Implements retry-with-timeout and graceful degradation for all services.
 * Prevents endless loops and provides clear status reporting.
 *
 * Services Classification:
 * - REQUIRED: Must start successfully or block coding startup
 *   - Live Logging System (Transcript Monitor + Coordinator)
 * - OPTIONAL: Start with retry, degrade gracefully if failed
 *   - VKB Server (knowledge visualization)
 *   - Constraint Monitor (live guardrails)
 *   - Semantic Analysis (MCP)
 */

import path from 'path';
import fs from 'fs';
import { spawn, exec, execSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import http from 'http';
import {
  startServiceWithRetry,
  createHttpHealthCheck,
  createPidHealthCheck,
  isPortListening,
  isTcpPortListening,
  isProcessRunning,
  sleep
} from '../lib/service-starter.js';
import ProcessStateManager from './process-state-manager.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_DIR = __dirname;
const CODING_DIR = path.resolve(SCRIPT_DIR, '..');

const execAsync = promisify(exec);
const psm = new ProcessStateManager();

/**
 * Check if any process matching the script pattern is running at OS level
 * This catches orphaned processes that PSM doesn't know about
 */
async function isProcessRunningByScript(scriptPattern) {
  try {
    const { stdout } = await execAsync(`pgrep -lf "${scriptPattern}" 2>/dev/null || true`, {
      timeout: 5000
    });

    const lines = stdout.trim().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const command = match[2];

        // Skip self, grep/pgrep processes
        if (pid === process.pid) continue;
        if (command.includes('pgrep') || command.includes('grep')) continue;

        // Found a running process
        return { running: true, pid, command };
      }
    }
    return { running: false };
  } catch (error) {
    // If pgrep fails, assume not running (fail open)
    return { running: false };
  }
}

/**
 * Kill process on a port and wait for it to actually be released
 * Prevents race conditions where port is still in use after kill
 *
 * @param {number} port - Port number to free
 * @param {Object} options - Configuration options
 * @param {number} options.maxWaitMs - Maximum time to wait for port release (default: 5000)
 * @param {number} options.pollIntervalMs - Polling interval (default: 200)
 * @param {string} options.label - Label for logging (default: port number)
 * @returns {Promise<boolean>} - true if port is free, false if timeout
 */
async function killProcessOnPortAndWait(port, options = {}) {
  const { maxWaitMs = 5000, pollIntervalMs = 200, label = `port ${port}` } = options;

  // Check if port is in use
  const checkPortInUse = async () => {
    try {
      const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || true`, { timeout: 3000 });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  };

  // If port is already free, nothing to do
  if (!(await checkPortInUse())) {
    return true;
  }

  // Get PID(s) on the port
  let pids = [];
  try {
    const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || true`, { timeout: 3000 });
    pids = stdout.trim().split('\n').filter(p => p).map(p => parseInt(p, 10));
  } catch {
    // Ignore
  }

  if (pids.length === 0) {
    return true; // No processes found
  }

  console.log(`[Cleanup] Killing ${pids.length} process(es) on ${label}: ${pids.join(', ')}`);

  // First try SIGTERM (graceful)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may have already exited
    }
  }

  // Wait for port to be released (with polling)
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollIntervalMs);

    if (!(await checkPortInUse())) {
      console.log(`[Cleanup] Port ${port} is now free`);
      return true;
    }

    // After half the timeout, escalate to SIGKILL
    if (Date.now() - startTime > maxWaitMs / 2) {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may have already exited
        }
      }
    }
  }

  // Final check
  if (!(await checkPortInUse())) {
    console.log(`[Cleanup] Port ${port} is now free`);
    return true;
  }

  console.log(`[Cleanup] Warning: Port ${port} still in use after ${maxWaitMs}ms timeout`);
  return false;
}

// Get target project path from environment (set by bin/coding)
const TARGET_PROJECT_PATH = process.env.CODING_PROJECT_DIR || CODING_DIR;

// Port configurations from .env.ports (with defaults)
const PORTS = {
  VKB: parseInt(process.env.VKB_PORT || '8080', 10),
  CONSTRAINT_DASHBOARD: parseInt(process.env.CONSTRAINT_DASHBOARD_PORT || '3030', 10),
  CONSTRAINT_API: parseInt(process.env.CONSTRAINT_API_PORT || '3031', 10),
  SYSTEM_HEALTH_DASHBOARD: parseInt(process.env.SYSTEM_HEALTH_DASHBOARD_PORT || '3032', 10),
  SYSTEM_HEALTH_API: parseInt(process.env.SYSTEM_HEALTH_API_PORT || '3033', 10),
  MEMGRAPH_BOLT: parseInt(process.env.MEMGRAPH_BOLT_PORT || '7687', 10),
  MEMGRAPH_HTTPS: parseInt(process.env.MEMGRAPH_HTTPS_PORT || '7444', 10),
  MEMGRAPH_LAB: parseInt(process.env.MEMGRAPH_LAB_PORT || '3100', 10),
};

// Service configurations
const SERVICE_CONFIGS = {
  transcriptMonitor: {
    name: 'Transcript Monitor',
    required: true,
    maxRetries: 3,
    timeout: 20000,
    startFn: async () => {
      console.log('[TranscriptMonitor] Starting enhanced transcript monitor...');
      console.log(`[TranscriptMonitor] Target project: ${TARGET_PROJECT_PATH}`);

      // Check if already running globally (parallel session detection) via PSM
      const isRunningGlobally = await psm.isServiceRunning('transcript-monitor', 'global');
      if (isRunningGlobally) {
        console.log('[TranscriptMonitor] Already running globally (PSM) - using existing instance');
        return { pid: 'already-running', service: 'transcript-monitor', skipRegistration: true };
      }

      // CRITICAL: Check if a per-project monitor is already running for this project via PSM
      // This handles the case where global-lsl-coordinator spawned one
      const isRunningPerProject = await psm.isServiceRunning('enhanced-transcript-monitor', 'per-project', { projectPath: TARGET_PROJECT_PATH });
      if (isRunningPerProject) {
        console.log(`[TranscriptMonitor] Already running for project ${path.basename(TARGET_PROJECT_PATH)} (PSM) - using existing instance`);
        return { pid: 'already-running', service: 'transcript-monitor', skipRegistration: true };
      }

      // ALSO check OS-level to catch orphaned processes PSM doesn't know about
      const osCheck = await isProcessRunningByScript('enhanced-transcript-monitor.js');
      if (osCheck.running) {
        console.log(`[TranscriptMonitor] Already running at OS level (PID: ${osCheck.pid}) - using existing instance`);
        console.log(`[TranscriptMonitor] Note: Re-registering orphaned process with PSM`);
        // Re-register this orphan with PSM so future checks work
        try {
          await psm.registerService({
            name: 'transcript-monitor',
            pid: osCheck.pid,
            type: 'global',
            script: 'scripts/enhanced-transcript-monitor.js'
          });
        } catch (e) {
          console.log(`[TranscriptMonitor] Warning: Could not re-register with PSM: ${e.message}`);
        }
        return { pid: osCheck.pid, service: 'transcript-monitor', skipRegistration: true };
      }

      const child = spawn('node', [
        path.join(SCRIPT_DIR, 'enhanced-transcript-monitor.js'),
        TARGET_PROJECT_PATH  // Pass target project path as argument
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      return { pid: child.pid, service: 'transcript-monitor' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      return createPidHealthCheck()(result);
    }
  },

  liveLoggingCoordinator: {
    name: 'Live Logging Coordinator',
    required: true,
    maxRetries: 3,
    timeout: 20000,
    startFn: async () => {
      console.log('[LiveLogging] Starting live logging coordinator...');

      // Check if already running globally (parallel session detection) via PSM
      const isRunning = await psm.isServiceRunning('live-logging-coordinator', 'global');
      if (isRunning) {
        console.log('[LiveLogging] Already running globally (PSM) - using existing instance');
        return { pid: 'already-running', service: 'live-logging-coordinator', skipRegistration: true };
      }

      // ALSO check OS-level to catch orphaned processes PSM doesn't know about
      const osCheck = await isProcessRunningByScript('live-logging-coordinator.js');
      if (osCheck.running) {
        console.log(`[LiveLogging] Already running at OS level (PID: ${osCheck.pid}) - using existing instance`);
        console.log(`[LiveLogging] Note: Re-registering orphaned process with PSM`);
        // Re-register this orphan with PSM so future checks work
        try {
          await psm.registerService({
            name: 'live-logging-coordinator',
            pid: osCheck.pid,
            type: 'global',
            script: 'scripts/live-logging-coordinator.js'
          });
        } catch (e) {
          console.log(`[LiveLogging] Warning: Could not re-register with PSM: ${e.message}`);
        }
        return { pid: osCheck.pid, service: 'live-logging-coordinator', skipRegistration: true };
      }

      const child = spawn('node', [
        path.join(SCRIPT_DIR, 'live-logging-coordinator.js')
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      return { pid: child.pid, service: 'live-logging-coordinator' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      return createPidHealthCheck()(result);
    }
  },

  vkbServer: {
    name: 'VKB Server',
    required: true, // REQUIRED - must start successfully
    maxRetries: 3,
    timeout: 30000, // VKB server uses LAZY INITIALIZATION - Express starts immediately
    // The server responds to /health within 1-2 seconds, then initializes DB/data in background
    startFn: async () => {
      console.log(`[VKB] Starting VKB server on port ${PORTS.VKB} (lazy initialization)...`);

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('vkb-server', 'global');
      if (isRunning) {
        console.log('[VKB] Already running globally - using existing instance');
        // Check if port is listening
        if (await isPortListening(PORTS.VKB)) {
          return { pid: 'already-running', port: PORTS.VKB, service: 'vkb-server', skipRegistration: true };
        } else {
          console.log(`[VKB] Warning: PSM shows running but port ${PORTS.VKB} not listening - cleaning up PSM entry`);
          // PSM will clean this up automatically on next status check
        }
      }

      // Kill any existing process on VKB port
      try {
        await new Promise((resolve) => {
          exec(`lsof -ti:${PORTS.VKB} | xargs kill -9 2>/dev/null`, () => resolve());
        });
        await sleep(1000);
      } catch (error) {
        // Ignore errors
      }

      // Use GraphDB as the primary data source (no knowledge-export files needed)
      const env = { ...process.env, VKB_DATA_SOURCE: 'online' };

      // Create log file path
      const logPath = path.join(CODING_DIR, 'vkb-server.log');

      console.log(`[VKB] Logging to: ${logPath}`);

      // Open log file and get file descriptor
      const logFd = fs.openSync(logPath, 'a');

      const child = spawn('node', [
        path.join(CODING_DIR, 'lib/vkb-server/cli.js'),
        'server',
        'start',
        '--foreground'
      ], {
        detached: true,
        stdio: ['ignore', logFd, logFd], // Use file descriptor for stdout and stderr
        cwd: CODING_DIR,
        env: env
      });

      child.unref();

      // Close our copy of the file descriptor (child process has its own)
      fs.close(logFd, (err) => {
        if (err) console.log('[VKB] Warning: Failed to close log fd:', err.message);
      });

      // Brief wait for process to start
      await sleep(500);

      // Check if process is still running
      if (!isProcessRunning(child.pid)) {
        throw new Error(`VKB server process died immediately. Check ${logPath} for errors.`);
      }

      return { pid: child.pid, port: PORTS.VKB, service: 'vkb-server', logPath };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;

      // VKB uses lazy initialization - /health returns immediately with status
      // We accept both 'starting' and 'ready' states as healthy (server is alive)
      return new Promise((resolve) => {
        const client = http.request({
          host: 'localhost',
          port: PORTS.VKB,
          method: 'GET',
          path: '/health',
          timeout: 5000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const healthData = JSON.parse(data);
                const status = healthData.status || 'unknown';
                const ready = healthData.ready ? 'ready' : 'initializing';
                console.log(`[VKB] Health check passed (status: ${status}, ${ready})`);
              } catch {
                console.log('[VKB] Health check passed');
              }
              resolve(true);
            } else {
              console.log(`[VKB] Health check failed: HTTP ${res.statusCode}`);
              resolve(false);
            }
          });
        });

        client.on('error', (error) => {
          console.log(`[VKB] Health check error: ${error.message}`);
          resolve(false);
        });

        client.on('timeout', () => {
          console.log('[VKB] Health check timeout');
          client.destroy();
          resolve(false);
        });

        client.end();
      });
    }
  },

  constraintMonitor: {
    name: 'Constraint Monitor',
    required: false, // OPTIONAL - degrade gracefully
    maxRetries: 2,
    timeout: 30000,
    startFn: async () => {
      console.log('[ConstraintMonitor] Starting Docker containers...');

      // Check if Docker is running
      try {
        await execAsync('docker info', { timeout: 5000 });
      } catch (error) {
        throw new Error('Docker not running - required for Constraint Monitor');
      }

      // Start docker-compose services (Redis + Qdrant)
      const constraintDir = path.join(CODING_DIR, 'integrations', 'mcp-constraint-monitor');

      if (!fs.existsSync(constraintDir)) {
        throw new Error('Constraint Monitor not installed in integrations/');
      }

      try {
        await execAsync('docker-compose up -d', {
          cwd: constraintDir,
          timeout: 60000
        });
      } catch (error) {
        throw new Error(`Docker compose failed: ${error.message}`);
      }

      console.log('[ConstraintMonitor] Docker containers started successfully');
      console.log('[ConstraintMonitor] Web services (API + Dashboard) managed by Global Service Coordinator');

      return {
        service: 'constraint-monitor-docker',
        mode: 'docker-compose',
        containers: ['redis', 'qdrant']
      };
    },
    healthCheckFn: async () => {
      // Check Docker containers only - web services checked by coordinator
      try {
        const { stdout } = await execAsync(
          'docker ps --filter "name=constraint-monitor" --format "{{.Names}}" | wc -l',
          { timeout: 5000 }
        );

        const containerCount = parseInt(stdout.trim(), 10);
        if (containerCount < 2) {
          console.log('[ConstraintMonitor] Health check failed: insufficient Docker containers');
          return false;
        }

        console.log('[ConstraintMonitor] Docker containers healthy');
        return true;
      } catch (error) {
        console.log('[ConstraintMonitor] Health check error:', error.message);
        return false;
      }
    }
  },

  healthVerifier: {
    name: 'Health Verifier',
    required: false, // OPTIONAL - Layer 3 monitoring
    maxRetries: 2,
    timeout: 15000,
    startFn: async () => {
      console.log('[HealthVerifier] Starting health verification daemon...');

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('health-verifier', 'global');
      if (isRunning) {
        console.log('[HealthVerifier] Already running globally - skipping startup');
        return { pid: 'already-running', service: 'health-verifier', skipRegistration: true };
      }

      const child = spawn('node', [
        path.join(SCRIPT_DIR, 'health-verifier.js'),
        'start'
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      // Brief wait for process to start
      await sleep(500);

      // Check if process is still running
      if (!isProcessRunning(child.pid)) {
        throw new Error('Health verifier process died immediately');
      }

      return { pid: child.pid, service: 'health-verifier' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      return createPidHealthCheck()(result);
    }
  },

  statuslineHealthMonitor: {
    name: 'StatusLine Health Monitor',
    required: false, // OPTIONAL - status line monitoring
    maxRetries: 2,
    timeout: 15000,
    startFn: async () => {
      console.log('[StatusLineHealth] Starting statusline health monitor...');

      // Check if already running globally (parallel session detection via PSM)
      const isRunning = await psm.isServiceRunning('statusline-health-monitor', 'global');
      if (isRunning) {
        console.log('[StatusLineHealth] Already running globally (PSM) - skipping startup');
        return { pid: 'already-running', service: 'statusline-health-monitor', skipRegistration: true };
      }

      // Fallback: Check PID file (process may be running but not registered in PSM)
      const pidFile = path.join(CODING_DIR, '.pids', 'statusline-health-monitor.pid');
      try {
        if (fs.existsSync(pidFile)) {
          const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          if (existingPid && isProcessRunning(existingPid)) {
            // Verify it's actually the health monitor
            try {
              const psOutput = execSync(`ps -p ${existingPid} -o args=`, { encoding: 'utf8', timeout: 3000 });
              if (psOutput.includes('statusline-health-monitor')) {
                console.log(`[StatusLineHealth] Already running (PID file: ${existingPid}) - registering with PSM`);
                // Register with PSM for future checks
                await psm.registerService({
                  name: 'statusline-health-monitor',
                  type: 'global',
                  pid: existingPid,
                  script: 'scripts/statusline-health-monitor.js'
                });
                return { pid: existingPid, service: 'statusline-health-monitor', skipRegistration: true };
              }
            } catch (psError) {
              // Process may have exited, continue with startup
            }
          }
        }
      } catch (pidCheckError) {
        // PID file check failed, continue with startup
      }

      // Final fallback: Check via pgrep
      try {
        const pgrepOutput = execSync('pgrep -f "statusline-health-monitor.js.*--daemon"', { encoding: 'utf8', timeout: 3000 }).trim();
        if (pgrepOutput) {
          const runningPid = parseInt(pgrepOutput.split('\n')[0], 10);
          console.log(`[StatusLineHealth] Already running (pgrep: ${runningPid}) - registering with PSM`);
          // Register with PSM for future checks
          await psm.registerService({
            name: 'statusline-health-monitor',
            type: 'global',
            pid: runningPid,
            script: 'scripts/statusline-health-monitor.js'
          });
          return { pid: runningPid, service: 'statusline-health-monitor', skipRegistration: true };
        }
      } catch (pgrepError) {
        // pgrep returns exit code 1 when no matches - this is normal
      }

      const child = spawn('node', [
        path.join(SCRIPT_DIR, 'statusline-health-monitor.js'),
        '--daemon',
        '--auto-heal'
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      // Brief wait for process to start
      await sleep(500);

      // Check if process is still running
      if (!isProcessRunning(child.pid)) {
        throw new Error('StatusLine health monitor process died immediately');
      }

      return { pid: child.pid, service: 'statusline-health-monitor' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      return createPidHealthCheck()(result);
    }
  },

  globalProcessSupervisor: {
    name: 'Global Process Supervisor',
    required: false, // OPTIONAL - active supervision of all monitors
    maxRetries: 2,
    timeout: 10000,
    startFn: async () => {
      console.log('[GlobalSupervisor] Starting global process supervisor...');

      // Check if already running globally (singleton pattern)
      const isRunning = await psm.isServiceRunning('global-process-supervisor', 'global');
      if (isRunning) {
        console.log('[GlobalSupervisor] Already running globally - skipping startup');
        return { pid: 'already-running', service: 'global-process-supervisor', skipRegistration: true };
      }

      // ALSO check OS-level to catch orphaned processes PSM doesn't know about
      const osCheck = await isProcessRunningByScript('global-process-supervisor.js');
      if (osCheck.running) {
        console.log(`[GlobalSupervisor] Already running at OS level (PID: ${osCheck.pid}) - reusing`);
        // Re-register this orphan with PSM so future checks work
        try {
          await psm.registerService({
            name: 'global-process-supervisor',
            pid: osCheck.pid,
            type: 'global',
            script: 'scripts/global-process-supervisor.js'
          });
        } catch (e) {
          console.log(`[GlobalSupervisor] Warning: Could not re-register with PSM: ${e.message}`);
        }
        return { pid: osCheck.pid, service: 'global-process-supervisor', skipRegistration: true };
      }

      const child = spawn('node', [
        path.join(SCRIPT_DIR, 'global-process-supervisor.js'),
        '--daemon'
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      // Brief wait for process to start
      await sleep(500);

      // Check if process is still running
      if (!isProcessRunning(child.pid)) {
        throw new Error('Global process supervisor died immediately');
      }

      return { pid: child.pid, service: 'global-process-supervisor' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;

      // Check heartbeat file freshness
      const heartbeatPath = path.join(CODING_DIR, '.health', 'supervisor-heartbeat.json');
      if (!fs.existsSync(heartbeatPath)) {
        // Give it time to create first heartbeat
        return createPidHealthCheck()(result);
      }

      try {
        const stats = fs.statSync(heartbeatPath);
        const ageMs = Date.now() - stats.mtime.getTime();
        // Heartbeat should be updated within 60 seconds
        if (ageMs > 60000) {
          console.log(`[GlobalSupervisor] Warning: Heartbeat file is ${Math.round(ageMs/1000)}s old`);
          return false;
        }
        return true;
      } catch (err) {
        return createPidHealthCheck()(result);
      }
    }
  },

  memgraph: {
    name: 'Memgraph (Code Graph RAG)',
    required: false, // OPTIONAL - for code-graph-rag AST analysis
    maxRetries: 2,
    timeout: 45000, // Memgraph can take time to start
    startFn: async () => {
      console.log('[Memgraph] Starting Memgraph Docker container for code-graph-rag...');

      // Check if Docker is running
      try {
        await execAsync('docker info', { timeout: 5000 });
      } catch (error) {
        throw new Error('Docker not running - required for Memgraph');
      }

      // Check if code-graph-rag is installed
      const codeGraphRagDir = path.join(CODING_DIR, 'integrations', 'code-graph-rag');
      if (!fs.existsSync(codeGraphRagDir)) {
        throw new Error('code-graph-rag not installed in integrations/ - run install.sh first');
      }

      // Check for docker-compose.yaml
      const dockerComposePath = path.join(codeGraphRagDir, 'docker-compose.yaml');
      if (!fs.existsSync(dockerComposePath)) {
        throw new Error('docker-compose.yaml not found in code-graph-rag/ - run install.sh to create it');
      }

      // Pass port configuration via env vars (upstream docker-compose uses MEMGRAPH_PORT, LAB_PORT)
      // We map from our .env.ports naming to upstream's expected env var names
      const composeEnv = {
        ...process.env,
        MEMGRAPH_PORT: String(PORTS.MEMGRAPH_BOLT),
        MEMGRAPH_HTTP_PORT: String(PORTS.MEMGRAPH_HTTPS),
        LAB_PORT: String(PORTS.MEMGRAPH_LAB)
      };

      try {
        await execAsync('docker-compose up -d', {
          cwd: codeGraphRagDir,
          timeout: 60000,
          env: composeEnv
        });
      } catch (error) {
        throw new Error(`Docker compose failed for Memgraph: ${error.message}`);
      }

      console.log('[Memgraph] Docker container started successfully');
      console.log(`[Memgraph] Bolt port: ${PORTS.MEMGRAPH_BOLT}, Lab UI: http://localhost:${PORTS.MEMGRAPH_LAB}`);

      return {
        service: 'memgraph-docker',
        mode: 'docker-compose',
        ports: { bolt: PORTS.MEMGRAPH_BOLT, https: PORTS.MEMGRAPH_HTTPS, lab: PORTS.MEMGRAPH_LAB }
      };
    },
    healthCheckFn: async () => {
      // Check if Memgraph is listening on Bolt port using TCP (not HTTP)
      // Memgraph uses Bolt protocol, not HTTP, so we need raw TCP socket check
      try {
        const isListening = await isTcpPortListening(PORTS.MEMGRAPH_BOLT);
        if (!isListening) {
          console.log(`[Memgraph] Health check failed: Bolt port ${PORTS.MEMGRAPH_BOLT} not listening`);
          return false;
        }
        console.log(`[Memgraph] Container healthy (Bolt port ${PORTS.MEMGRAPH_BOLT} listening)`);
        return true;
      } catch (error) {
        console.log('[Memgraph] Health check error:', error.message);
        return false;
      }
    }
  },

  systemHealthDashboardAPI: {
    name: 'System Health Dashboard API',
    required: false, // OPTIONAL - system health dashboard
    maxRetries: 2,
    timeout: 15000,
    startFn: async () => {
      console.log(`[SystemHealthAPI] Starting system health dashboard API on port ${PORTS.SYSTEM_HEALTH_API}...`);

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('system-health-dashboard-api', 'global');
      if (isRunning) {
        console.log('[SystemHealthAPI] Already running globally - using existing instance');
        // Check if port is listening
        if (await isPortListening(PORTS.SYSTEM_HEALTH_API)) {
          return { pid: 'already-running', port: PORTS.SYSTEM_HEALTH_API, service: 'system-health-dashboard-api', skipRegistration: true };
        } else {
          console.log(`[SystemHealthAPI] Warning: PSM shows running but port ${PORTS.SYSTEM_HEALTH_API} not listening - cleaning up PSM entry`);
        }
      }

      // Kill any existing process on System Health API port
      try {
        await new Promise((resolve) => {
          exec(`lsof -ti:${PORTS.SYSTEM_HEALTH_API} | xargs kill -9 2>/dev/null`, () => resolve());
        });
        await sleep(500);
      } catch (error) {
        // Ignore errors
      }

      const child = spawn('node', [
        path.join(CODING_DIR, 'integrations/system-health-dashboard/server.js')
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      // API server needs time to initialize Express, connect to dependencies, and bind to port
      // Without sufficient delay, the health check runs before the port is listening
      // causing the first attempt to fail and require a retry
      await sleep(1500);

      // Non-blocking check - warn but don't fail
      try {
        if (!isProcessRunning(child.pid)) {
          console.log('[SystemHealthAPI] Warning: Initial process check failed - server may still be starting');
        }
      } catch (error) {
        console.log(`[SystemHealthAPI] Warning: Process check error: ${error.message}`);
      }

      return { pid: child.pid, port: PORTS.SYSTEM_HEALTH_API, service: 'system-health-dashboard-api' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      return createHttpHealthCheck(PORTS.SYSTEM_HEALTH_API, '/api/health')(result);
    }
  },

  systemHealthDashboardFrontend: {
    name: 'System Health Dashboard Frontend',
    required: false, // OPTIONAL - frontend dashboard
    maxRetries: 2,
    timeout: 20000,
    startFn: async () => {
      // Allow skipping via environment variable (useful if causing startup issues)
      if (process.env.SKIP_DASHBOARD_FRONTEND === 'true') {
        console.log('[SystemHealthFrontend] Skipped via SKIP_DASHBOARD_FRONTEND=true');
        return { pid: 'skipped', port: PORTS.SYSTEM_HEALTH_DASHBOARD, service: 'system-health-dashboard-frontend', skipRegistration: true };
      }

      console.log(`[SystemHealthFrontend] Starting system health dashboard frontend on port ${PORTS.SYSTEM_HEALTH_DASHBOARD}...`);

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('system-health-dashboard-frontend', 'global');
      if (isRunning) {
        console.log('[SystemHealthFrontend] Already running globally - using existing instance');
        // Check if port is listening
        if (await isPortListening(PORTS.SYSTEM_HEALTH_DASHBOARD)) {
          return { pid: 'already-running', port: PORTS.SYSTEM_HEALTH_DASHBOARD, service: 'system-health-dashboard-frontend', skipRegistration: true };
        } else {
          console.log(`[SystemHealthFrontend] Warning: PSM shows running but port ${PORTS.SYSTEM_HEALTH_DASHBOARD} not listening - cleaning up PSM entry`);
        }
      }

      // Kill any existing process on the frontend port and wait for it to be released
      // This prevents "Port already in use" errors from orphaned vite processes
      const portFreed = await killProcessOnPortAndWait(PORTS.SYSTEM_HEALTH_DASHBOARD, {
        maxWaitMs: 5000,
        label: 'frontend port'
      });

      if (!portFreed) {
        throw new Error(`Port ${PORTS.SYSTEM_HEALTH_DASHBOARD} still in use after cleanup`);
      }

      // Also kill any orphaned Vite processes on the API port (prevents JSON parse errors)
      try {
        const { stdout } = await execAsync(`lsof -ti:${PORTS.SYSTEM_HEALTH_API} 2>/dev/null || true`, { timeout: 5000 });
        const pids = stdout.trim().split('\n').filter(p => p);
        for (const pid of pids) {
          try {
            const { stdout: cmdline } = await execAsync(`ps -p ${pid} -o args= 2>/dev/null || true`);
            if (cmdline.includes('vite')) {
              console.log(`[SystemHealthFrontend] Killing orphaned Vite on API port ${PORTS.SYSTEM_HEALTH_API}`);
              await killProcessOnPortAndWait(PORTS.SYSTEM_HEALTH_API, { maxWaitMs: 3000, label: 'API port' });
              break;
            }
          } catch (e) {
            // Ignore
          }
        }
      } catch (error) {
        // Best-effort cleanup
      }

      const dashboardDir = path.join(CODING_DIR, 'integrations/system-health-dashboard');

      // Check if node_modules exists, if not skip this service
      if (!fs.existsSync(path.join(dashboardDir, 'node_modules'))) {
        console.log('[SystemHealthFrontend] Warning: node_modules not found - run npm install in integrations/system-health-dashboard');
        throw new Error('node_modules not found - npm install required');
      }

      const child = spawn('npm', ['run', 'dev'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: dashboardDir,
        env: {
          ...process.env,
          SYSTEM_HEALTH_DASHBOARD_PORT: String(PORTS.SYSTEM_HEALTH_DASHBOARD),
          SYSTEM_HEALTH_API_PORT: String(PORTS.SYSTEM_HEALTH_API)
        }
      });

      child.unref();

      // Vite needs more time to initialize and bind to port than other services
      // Without sufficient delay, the health check runs before the port is listening
      // causing the first attempt to fail and require a retry
      await sleep(1500);

      // Non-blocking check - warn but don't fail if process check fails
      // Vite spawns child processes so PID might not be directly trackable
      try {
        if (!isProcessRunning(child.pid)) {
          console.log('[SystemHealthFrontend] Warning: Initial process check failed - vite may still be starting');
        }
      } catch (error) {
        console.log(`[SystemHealthFrontend] Warning: Process check error: ${error.message}`);
      }

      return { pid: child.pid, port: PORTS.SYSTEM_HEALTH_DASHBOARD, service: 'system-health-dashboard-frontend' };
    },
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      // Vite dev server responds on the port
      return isPortListening(PORTS.SYSTEM_HEALTH_DASHBOARD);
    }
  }
};

/**
 * Register service with PSM after successful start
 */
async function registerWithPSM(result, scriptPath) {
  if (result.skipRegistration || result.pid === 'already-running') {
    return; // Service already registered or using existing instance
  }

  // Support both 'service' (from startFn) and 'serviceName' (from startServiceWithRetry)
  const serviceName = result.service || result.serviceName;

  if (!result.pid || !serviceName) {
    console.log(`[PSM] Warning: Cannot register service - missing pid or service name`);
    return;
  }

  try {
    await psm.registerService({
      name: serviceName,
      pid: result.pid,
      type: 'global',
      script: scriptPath
    });
    console.log(`[PSM] Registered ${serviceName} (PID: ${result.pid})`);
  } catch (error) {
    console.log(`[PSM] Warning: Failed to register ${serviceName}: ${error.message}`);
  }
}

/**
 * Create .services-running.json status file for status line
 */
async function createServicesStatusFile(results) {
  const statusFile = path.join(CODING_DIR, '.services-running.json');

  const servicesRunning = results.successful
    .filter(r => r.status === 'success')
    .map(r => r.serviceName.toLowerCase().replace(/\s+/g, '-'));

  const status = {
    timestamp: new Date().toISOString(),
    services: servicesRunning,
    services_running: servicesRunning.length,
    constraint_monitor: {
      status: results.successful.some(r => r.serviceName === 'Constraint Monitor')
        ? '✅ FULLY OPERATIONAL'
        : '⚠️ DEGRADED MODE',
      dashboard_port: PORTS.CONSTRAINT_DASHBOARD,
      api_port: PORTS.CONSTRAINT_API,
      health: results.successful.some(r => r.serviceName === 'Constraint Monitor')
        ? 'healthy'
        : 'degraded',
      last_check: new Date().toISOString()
    },
    semantic_analysis: {
      status: '✅ OPERATIONAL',
      health: 'healthy'
    },
    vkb_server: {
      status: results.successful.some(r => r.serviceName === 'VKB Server')
        ? '✅ OPERATIONAL'
        : '⚠️ DEGRADED',
      port: PORTS.VKB,
      health: results.successful.some(r => r.serviceName === 'VKB Server')
        ? 'healthy'
        : 'degraded'
    },
    transcript_monitor: {
      status: '✅ OPERATIONAL',
      health: 'healthy'
    },
    system_health_api: {
      status: results.successful.some(r => r.serviceName === 'System Health Dashboard API')
        ? '✅ OPERATIONAL'
        : '⚠️ DEGRADED',
      port: PORTS.SYSTEM_HEALTH_API,
      dashboard_port: PORTS.SYSTEM_HEALTH_DASHBOARD,
      health: results.successful.some(r => r.serviceName === 'System Health Dashboard API')
        ? 'healthy'
        : 'degraded'
    },
    memgraph: {
      status: results.successful.some(r => r.serviceName === 'Memgraph (Code Graph RAG)')
        ? '✅ OPERATIONAL'
        : '⚠️ DEGRADED',
      bolt_port: PORTS.MEMGRAPH_BOLT,
      lab_port: PORTS.MEMGRAPH_LAB,
      health: results.successful.some(r => r.serviceName === 'Memgraph (Code Graph RAG)')
        ? 'healthy'
        : 'degraded',
      purpose: 'AST-based code knowledge graph (code-graph-rag)'
    }
  };

  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  console.log(`[Status] Created ${statusFile}`);
}

/**
 * Pre-startup cleanup to remove dangling processes from crashed sessions
 *
 * IMPORTANT: We no longer kill ALL transcript monitors globally because:
 * 1. Other Claude sessions may have their own monitors running
 * 2. The global-lsl-coordinator spawns per-project monitors
 * 3. Killing them all causes a race condition where they get respawned
 *
 * Instead, we only clean up truly orphaned processes (not registered in PSM)
 * and rely on the startup logic to reuse existing monitors.
 */
async function cleanupDanglingProcesses() {
  console.log('🧹 Pre-startup cleanup: Checking for orphaned processes...');
  console.log('');

  try {
    // Clean up stale PSM entries FIRST - this removes dead PIDs from registry
    console.log('   Cleaning up stale Process State Manager entries...');
    try {
      const cleanupStats = await psm.cleanupDeadProcesses();
      if (cleanupStats && cleanupStats.total > 0) {
        console.log(`   ✅ PSM cleanup: Removed ${cleanupStats.total} dead process entries`);
      } else {
        console.log('   ✅ PSM cleanup complete - no stale entries');
      }
    } catch (error) {
      console.log(`   ⚠️  PSM cleanup warning: ${error.message}`);
    }

    // Check if a transcript monitor is already running for THIS project
    // If so, we'll reuse it during startup (no need to kill it)
    const isRunningPerProject = await psm.isServiceRunning('enhanced-transcript-monitor', 'per-project', { projectPath: TARGET_PROJECT_PATH });
    if (isRunningPerProject) {
      console.log(`   ℹ️  Transcript monitor already running for ${path.basename(TARGET_PROJECT_PATH)} - will reuse`);
    }

    // Check for live-logging coordinator
    const isCoordinatorRunning = await psm.isServiceRunning('live-logging-coordinator', 'global');
    if (isCoordinatorRunning) {
      console.log('   ℹ️  Live-logging coordinator already running globally - will reuse');
    }

    console.log('');
    console.log('✅ Pre-startup cleanup complete - system ready');
    console.log('');
  } catch (error) {
    console.log(`⚠️  Pre-startup cleanup warning: ${error.message}`);
    console.log('   Continuing with startup...');
    console.log('');
  }
}

/**
 * Main startup function
 */
async function startAllServices() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🚀 STARTING CODING SERVICES (ROBUST MODE)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('');

  // Clean up any dangling processes from crashed sessions before starting
  await cleanupDanglingProcesses();

  const results = {
    successful: [],
    degraded: [],
    failed: []
  };

  // Start services sequentially for better error tracking
  // (Could be parallel, but sequential provides clearer output)

  // 1. REQUIRED: Live Logging System
  console.log('📋 Starting REQUIRED services (Live Logging System)...');
  console.log('');

  try {
    const transcriptResult = await startServiceWithRetry(
      SERVICE_CONFIGS.transcriptMonitor.name,
      SERVICE_CONFIGS.transcriptMonitor.startFn,
      SERVICE_CONFIGS.transcriptMonitor.healthCheckFn,
      {
        required: SERVICE_CONFIGS.transcriptMonitor.required,
        maxRetries: SERVICE_CONFIGS.transcriptMonitor.maxRetries,
        timeout: SERVICE_CONFIGS.transcriptMonitor.timeout
      }
    );
    results.successful.push(transcriptResult);
    await registerWithPSM(transcriptResult, 'scripts/enhanced-transcript-monitor.js');
  } catch (error) {
    results.failed.push({
      serviceName: SERVICE_CONFIGS.transcriptMonitor.name,
      error: error.message,
      required: true
    });
  }

  try {
    const coordinatorResult = await startServiceWithRetry(
      SERVICE_CONFIGS.liveLoggingCoordinator.name,
      SERVICE_CONFIGS.liveLoggingCoordinator.startFn,
      SERVICE_CONFIGS.liveLoggingCoordinator.healthCheckFn,
      {
        required: SERVICE_CONFIGS.liveLoggingCoordinator.required,
        maxRetries: SERVICE_CONFIGS.liveLoggingCoordinator.maxRetries,
        timeout: SERVICE_CONFIGS.liveLoggingCoordinator.timeout
      }
    );
    results.successful.push(coordinatorResult);
    await registerWithPSM(coordinatorResult, 'scripts/live-logging-coordinator.js');
  } catch (error) {
    results.failed.push({
      serviceName: SERVICE_CONFIGS.liveLoggingCoordinator.name,
      error: error.message,
      required: true
    });
  }

  console.log('');

  // 2. OPTIONAL: VKB Server
  console.log('🔵 Starting OPTIONAL services (graceful degradation enabled)...');
  console.log('');

  const vkbResult = await startServiceWithRetry(
    SERVICE_CONFIGS.vkbServer.name,
    SERVICE_CONFIGS.vkbServer.startFn,
    SERVICE_CONFIGS.vkbServer.healthCheckFn,
    {
      required: SERVICE_CONFIGS.vkbServer.required,
      maxRetries: SERVICE_CONFIGS.vkbServer.maxRetries,
      timeout: SERVICE_CONFIGS.vkbServer.timeout
    }
  );

  if (vkbResult.status === 'success') {
    results.successful.push(vkbResult);
    await registerWithPSM(vkbResult, 'lib/vkb-server/cli.js');
  } else {
    results.degraded.push(vkbResult);
  }

  console.log('');

  // 3. OPTIONAL: Constraint Monitor
  const constraintResult = await startServiceWithRetry(
    SERVICE_CONFIGS.constraintMonitor.name,
    SERVICE_CONFIGS.constraintMonitor.startFn,
    SERVICE_CONFIGS.constraintMonitor.healthCheckFn,
    {
      required: SERVICE_CONFIGS.constraintMonitor.required,
      maxRetries: SERVICE_CONFIGS.constraintMonitor.maxRetries,
      timeout: SERVICE_CONFIGS.constraintMonitor.timeout
    }
  );

  if (constraintResult.status === 'success') {
    results.successful.push(constraintResult);
    // No PSM registration for Docker-based service
  } else {
    results.degraded.push(constraintResult);
  }

  console.log('');

  // 4. OPTIONAL: Health Verifier
  const healthVerifierResult = await startServiceWithRetry(
    SERVICE_CONFIGS.healthVerifier.name,
    SERVICE_CONFIGS.healthVerifier.startFn,
    SERVICE_CONFIGS.healthVerifier.healthCheckFn,
    {
      required: SERVICE_CONFIGS.healthVerifier.required,
      maxRetries: SERVICE_CONFIGS.healthVerifier.maxRetries,
      timeout: SERVICE_CONFIGS.healthVerifier.timeout
    }
  );

  if (healthVerifierResult.status === 'success') {
    results.successful.push(healthVerifierResult);
    await registerWithPSM(healthVerifierResult, 'scripts/health-verifier.js');
  } else {
    results.degraded.push(healthVerifierResult);
  }

  console.log('');

  // 5. OPTIONAL: StatusLine Health Monitor
  const statuslineHealthResult = await startServiceWithRetry(
    SERVICE_CONFIGS.statuslineHealthMonitor.name,
    SERVICE_CONFIGS.statuslineHealthMonitor.startFn,
    SERVICE_CONFIGS.statuslineHealthMonitor.healthCheckFn,
    {
      required: SERVICE_CONFIGS.statuslineHealthMonitor.required,
      maxRetries: SERVICE_CONFIGS.statuslineHealthMonitor.maxRetries,
      timeout: SERVICE_CONFIGS.statuslineHealthMonitor.timeout
    }
  );

  if (statuslineHealthResult.status === 'success') {
    results.successful.push(statuslineHealthResult);
    await registerWithPSM(statuslineHealthResult, 'scripts/statusline-health-monitor.js');
  } else {
    results.degraded.push(statuslineHealthResult);
  }

  console.log('');

  // 6. OPTIONAL: Global Process Supervisor (active supervision of all monitors)
  const globalSupervisorResult = await startServiceWithRetry(
    SERVICE_CONFIGS.globalProcessSupervisor.name,
    SERVICE_CONFIGS.globalProcessSupervisor.startFn,
    SERVICE_CONFIGS.globalProcessSupervisor.healthCheckFn,
    {
      required: SERVICE_CONFIGS.globalProcessSupervisor.required,
      maxRetries: SERVICE_CONFIGS.globalProcessSupervisor.maxRetries,
      timeout: SERVICE_CONFIGS.globalProcessSupervisor.timeout
    }
  );

  if (globalSupervisorResult.status === 'success') {
    results.successful.push(globalSupervisorResult);
    await registerWithPSM(globalSupervisorResult, 'scripts/global-process-supervisor.js');
  } else {
    results.degraded.push(globalSupervisorResult);
  }

  console.log('');

  // 7. OPTIONAL: System Health Dashboard API (renumbered from 6)
  const systemHealthAPIResult = await startServiceWithRetry(
    SERVICE_CONFIGS.systemHealthDashboardAPI.name,
    SERVICE_CONFIGS.systemHealthDashboardAPI.startFn,
    SERVICE_CONFIGS.systemHealthDashboardAPI.healthCheckFn,
    {
      required: SERVICE_CONFIGS.systemHealthDashboardAPI.required,
      maxRetries: SERVICE_CONFIGS.systemHealthDashboardAPI.maxRetries,
      timeout: SERVICE_CONFIGS.systemHealthDashboardAPI.timeout
    }
  );

  if (systemHealthAPIResult.status === 'success') {
    results.successful.push(systemHealthAPIResult);
    await registerWithPSM(systemHealthAPIResult, 'integrations/system-health-dashboard/server.js');
  } else {
    results.degraded.push(systemHealthAPIResult);
  }

  console.log('');

  // 7b. OPTIONAL: System Health Dashboard Frontend (depends on API being available)
  const systemHealthFrontendResult = await startServiceWithRetry(
    SERVICE_CONFIGS.systemHealthDashboardFrontend.name,
    SERVICE_CONFIGS.systemHealthDashboardFrontend.startFn,
    SERVICE_CONFIGS.systemHealthDashboardFrontend.healthCheckFn,
    {
      required: SERVICE_CONFIGS.systemHealthDashboardFrontend.required,
      maxRetries: SERVICE_CONFIGS.systemHealthDashboardFrontend.maxRetries,
      timeout: SERVICE_CONFIGS.systemHealthDashboardFrontend.timeout
    }
  );

  if (systemHealthFrontendResult.status === 'success') {
    results.successful.push(systemHealthFrontendResult);
    await registerWithPSM(systemHealthFrontendResult, 'integrations/system-health-dashboard/vite-frontend');
  } else {
    results.degraded.push(systemHealthFrontendResult);
  }

  console.log('');

  // 8. OPTIONAL: Memgraph (Code Graph RAG)
  const memgraphResult = await startServiceWithRetry(
    SERVICE_CONFIGS.memgraph.name,
    SERVICE_CONFIGS.memgraph.startFn,
    SERVICE_CONFIGS.memgraph.healthCheckFn,
    {
      required: SERVICE_CONFIGS.memgraph.required,
      maxRetries: SERVICE_CONFIGS.memgraph.maxRetries,
      timeout: SERVICE_CONFIGS.memgraph.timeout
    }
  );

  if (memgraphResult.status === 'success') {
    results.successful.push(memgraphResult);
    // No PSM registration for Docker-based service
  } else {
    results.degraded.push(memgraphResult);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('📊 SERVICES STATUS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('');

  // Print summary
  console.log(`✅ Successfully started: ${results.successful.length} services`);
  results.successful.forEach(service => {
    console.log(`   - ${service.serviceName}`);
  });
  console.log('');

  if (results.degraded.length > 0) {
    console.log(`⚠️  Degraded (optional failed): ${results.degraded.length} services`);
    results.degraded.forEach(service => {
      console.log(`   - ${service.serviceName}: ${service.error}`);
    });
    console.log('');
  }

  if (results.failed.length > 0) {
    console.log(`❌ Failed (required): ${results.failed.length} services`);
    results.failed.forEach(service => {
      console.log(`   - ${service.serviceName}: ${service.error}`);
    });
    console.log('');
    console.log('💥 CRITICAL: Required services failed - BLOCKING startup');
    console.log('═══════════════════════════════════════════════════════════════════════');
    process.exit(1);
  }

  // Create .services-running.json status file for status line
  try {
    await createServicesStatusFile(results);
  } catch (error) {
    console.log(`⚠️  Warning: Failed to create services status file: ${error.message}`);
  }

  console.log('');

  // Success
  const mode = results.degraded.length > 0 ? 'DEGRADED' : 'FULL';
  console.log(`🎉 Startup complete in ${mode} mode!`);

  if (results.degraded.length > 0) {
    console.log('');
    console.log('ℹ️  Some optional services are unavailable:');
    results.degraded.forEach(service => {
      console.log(`   - ${service.serviceName} will not be available this session`);
    });
  }

  console.log('═══════════════════════════════════════════════════════════════════════');

  process.exit(0);
}

// Run if called directly
runIfMain(import.meta.url, () => {
  startAllServices().catch(error => {
    console.error('💥 FATAL ERROR during service startup:');
    console.error(error);
    process.exit(1);
  });
});

export { startAllServices, SERVICE_CONFIGS };
