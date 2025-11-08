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
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import {
  startServiceWithRetry,
  createHttpHealthCheck,
  createPidHealthCheck,
  isPortListening,
  isProcessRunning,
  sleep
} from '../lib/service-starter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_DIR = __dirname;
const CODING_DIR = path.resolve(SCRIPT_DIR, '..');

const execAsync = promisify(exec);

// Service configurations
const SERVICE_CONFIGS = {
  transcriptMonitor: {
    name: 'Transcript Monitor',
    required: true,
    maxRetries: 3,
    timeout: 20000,
    startFn: async () => {
      console.log('[TranscriptMonitor] Starting enhanced transcript monitor...');

      const child = spawn('node', [
        path.join(SCRIPT_DIR, 'enhanced-transcript-monitor.js')
      ], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: CODING_DIR
      });

      child.unref();

      return { pid: child.pid, service: 'transcript-monitor' };
    },
    healthCheckFn: createPidHealthCheck()
  },

  liveLoggingCoordinator: {
    name: 'Live Logging Coordinator',
    required: true,
    maxRetries: 3,
    timeout: 20000,
    startFn: async () => {
      console.log('[LiveLogging] Starting live logging coordinator...');

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
    healthCheckFn: createPidHealthCheck()
  },

  vkbServer: {
    name: 'VKB Server',
    required: true, // REQUIRED - must start successfully
    maxRetries: 3,
    timeout: 30000, // VKB can take longer to start
    startFn: async () => {
      console.log('[VKB] Starting VKB server on port 8080...');

      // Kill any existing process on port 8080
      try {
        await new Promise((resolve) => {
          exec('lsof -ti:8080 | xargs kill -9 2>/dev/null', () => resolve());
        });
        await sleep(1000);
      } catch (error) {
        // Ignore errors
      }

      // Use GraphDB as the primary data source (no shared-memory files needed)
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

      return { pid: child.pid, port: 8080, service: 'vkb-server', logPath };
    },
    healthCheckFn: createHttpHealthCheck(8080, '/health')
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
  }
};

/**
 * Main startup function
 */
async function startAllServices() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🚀 STARTING CODING SERVICES (ROBUST MODE)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('');

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
  } else {
    results.degraded.push(constraintResult);
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
if (import.meta.url === `file://${process.argv[1]}`) {
  startAllServices().catch(error => {
    console.error('💥 FATAL ERROR during service startup:');
    console.error(error);
    process.exit(1);
  });
}

export { startAllServices, SERVICE_CONFIGS };
