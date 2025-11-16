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
import ProcessStateManager from './process-state-manager.js';
import { runIfMain } from '../lib/utils/esm-cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_DIR = __dirname;
const CODING_DIR = path.resolve(SCRIPT_DIR, '..');

const execAsync = promisify(exec);
const psm = new ProcessStateManager();

// Service configurations
const SERVICE_CONFIGS = {
  transcriptMonitor: {
    name: 'Transcript Monitor',
    required: true,
    maxRetries: 3,
    timeout: 20000,
    startFn: async () => {
      console.log('[TranscriptMonitor] Starting enhanced transcript monitor...');

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('transcript-monitor', 'global');
      if (isRunning) {
        console.log('[TranscriptMonitor] Already running globally - using existing instance');
        return { pid: 'already-running', service: 'transcript-monitor', skipRegistration: true };
      }

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

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('live-logging-coordinator', 'global');
      if (isRunning) {
        console.log('[LiveLogging] Already running globally - using existing instance');
        return { pid: 'already-running', service: 'live-logging-coordinator', skipRegistration: true };
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
    timeout: 30000, // VKB can take longer to start
    startFn: async () => {
      console.log('[VKB] Starting VKB server on port 8080...');

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('vkb-server', 'global');
      if (isRunning) {
        console.log('[VKB] Already running globally - using existing instance');
        // Check if port is listening
        if (await isPortListening(8080)) {
          return { pid: 'already-running', port: 8080, service: 'vkb-server', skipRegistration: true };
        } else {
          console.log('[VKB] Warning: PSM shows running but port 8080 not listening - cleaning up PSM entry');
          // PSM will clean this up automatically on next status check
        }
      }

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
    healthCheckFn: async (result) => {
      if (result.skipRegistration) return true;
      return createHttpHealthCheck(8080, '/health')(result);
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

      // Check if already running globally (parallel session detection)
      const isRunning = await psm.isServiceRunning('statusline-health-monitor', 'global');
      if (isRunning) {
        console.log('[StatusLineHealth] Already running globally - skipping startup');
        return { pid: 'already-running', service: 'statusline-health-monitor', skipRegistration: true };
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
  }
};

/**
 * Register service with PSM after successful start
 */
async function registerWithPSM(result, scriptPath) {
  if (result.skipRegistration || result.pid === 'already-running') {
    return; // Service already registered or using existing instance
  }

  if (!result.pid || !result.service) {
    console.log(`[PSM] Warning: Cannot register service - missing pid or service name`);
    return;
  }

  try {
    await psm.registerService({
      name: result.service,
      pid: result.pid,
      type: 'global',
      script: scriptPath
    });
    console.log(`[PSM] Registered ${result.service} (PID: ${result.pid})`);
  } catch (error) {
    console.log(`[PSM] Warning: Failed to register ${result.service}: ${error.message}`);
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
      dashboard_port: 3030,
      api_port: 3031,
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
      port: 8080,
      health: results.successful.some(r => r.serviceName === 'VKB Server')
        ? 'healthy'
        : 'degraded'
    },
    transcript_monitor: {
      status: '✅ OPERATIONAL',
      health: 'healthy'
    }
  };

  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  console.log(`[Status] Created ${statusFile}`);
}

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
