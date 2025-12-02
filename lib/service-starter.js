#!/usr/bin/env node

/**
 * Service Starter - Robust service startup with retry, timeout, and graceful degradation
 *
 * Implements retry-with-backoff pattern to prevent endless loops and provide
 * graceful degradation when optional services fail.
 *
 * Features:
 * - Configurable retry limits (default: 3 attempts)
 * - Timeout protection (default: 30 seconds per attempt)
 * - Exponential backoff between retries
 * - Health verification (not just port checks)
 * - Service classification (required vs optional)
 * - Graceful degradation for optional services
 *
 * Usage:
 *   import { startServiceWithRetry } from './lib/service-starter.js';
 *
 *   const result = await startServiceWithRetry(
 *     'VKB Server',
 *     () => startVKBServer(),
 *     () => checkVKBHealth(),
 *     { required: false, maxRetries: 3, timeout: 30000 }
 *   );
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import http from 'http';

const execAsync = promisify(exec);

/**
 * Check if a port is listening
 */
async function isPortListening(port, timeout = 5000) {
  return new Promise((resolve) => {
    const client = http.request({
      host: 'localhost',
      port: port,
      method: 'GET',
      path: '/health',
      timeout: timeout
    }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    client.on('error', () => resolve(false));
    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });

    client.end();
  });
}

/**
 * Check if process is running by PID
 */
function isProcessRunning(pid) {
  try {
    // Signal 0 checks if process exists without sending actual signal
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start a service with retry logic and graceful degradation
 *
 * @param {string} serviceName - Human-readable service name
 * @param {Function} startFn - Async function to start the service, returns { pid, port? }
 * @param {Function} healthCheckFn - Async function to verify service health, returns boolean
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.timeout - Timeout per attempt in ms (default: 30000)
 * @param {number} options.retryDelay - Base delay between retries in ms (default: 2000)
 * @param {boolean} options.required - Whether service is required (default: true)
 * @param {boolean} options.exponentialBackoff - Use exponential backoff (default: true)
 * @param {boolean} options.verbose - Log detailed progress (default: true)
 *
 * @returns {Promise<Object>} Result object with status, pid, mode, attempts
 */
async function startServiceWithRetry(serviceName, startFn, healthCheckFn, options = {}) {
  const {
    maxRetries = 3,
    timeout = 30000,
    retryDelay = 2000,
    required = true,
    exponentialBackoff = true,
    verbose = true
  } = options;

  const log = (message) => {
    if (verbose) {
      console.log(`[ServiceStarter] ${message}`);
    }
  };

  log(`🚀 Starting ${serviceName}...`);
  log(`   Max retries: ${maxRetries}, Timeout: ${timeout}ms, Required: ${required}`);

  let lastError = null;
  let serviceInfo = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`📍 Attempt ${attempt}/${maxRetries} for ${serviceName}...`);

      // Start service with timeout protection
      serviceInfo = await Promise.race([
        startFn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Startup timeout after ${timeout}ms`)), timeout)
        )
      ]);

      log(`   Started with PID: ${serviceInfo.pid || 'unknown'}`);

      // Brief wait for service to initialize
      await sleep(2000);

      // Verify the service is actually healthy
      log(`   Running health check...`);
      const healthy = await Promise.race([
        healthCheckFn(serviceInfo),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 10000)
        )
      ]);

      if (healthy) {
        log(`✅ ${serviceName} started successfully on attempt ${attempt}/${maxRetries}`);
        return {
          status: 'success',
          serviceName,
          pid: serviceInfo.pid,
          port: serviceInfo.port,
          attempt,
          required,
          healthy: true
        };
      }

      lastError = new Error('Health check failed - service started but not responding correctly');
      log(`⚠️  ${serviceName} started but health check failed (attempt ${attempt}/${maxRetries})`);

      // Kill the unhealthy process before retrying
      if (serviceInfo.pid && isProcessRunning(serviceInfo.pid)) {
        log(`   Killing unhealthy process ${serviceInfo.pid}...`);
        try {
          process.kill(serviceInfo.pid, 'SIGTERM');
          await sleep(1000);
          if (isProcessRunning(serviceInfo.pid)) {
            process.kill(serviceInfo.pid, 'SIGKILL');
          }
        } catch (killError) {
          log(`   Warning: Failed to kill process ${serviceInfo.pid}: ${killError.message}`);
        }
      }

    } catch (error) {
      lastError = error;
      log(`❌ ${serviceName} attempt ${attempt}/${maxRetries} failed: ${error.message}`);
    }

    // Wait before retry (except on last attempt)
    if (attempt < maxRetries) {
      const delay = exponentialBackoff ? retryDelay * Math.pow(2, attempt - 1) : retryDelay;
      log(`   Waiting ${delay}ms before retry...`);
      await sleep(delay);
    }
  }

  // All retries exhausted
  const errorMessage = lastError
    ? `${serviceName} failed after ${maxRetries} attempts: ${lastError.message}`
    : `${serviceName} failed after ${maxRetries} attempts`;

  if (required) {
    log(`💥 CRITICAL: ${errorMessage} - BLOCKING startup`);
    throw new Error(errorMessage);
  } else {
    log(`⚠️  ${errorMessage} - continuing in DEGRADED mode`);
    return {
      status: 'degraded',
      serviceName,
      required: false,
      healthy: false,
      error: lastError?.message || 'Unknown error',
      attempts: maxRetries
    };
  }
}

/**
 * Start multiple services in parallel with individual retry logic
 *
 * @param {Array<Object>} services - Array of service configurations
 * @returns {Promise<Object>} Results with success, degraded, and failed services
 */
async function startServicesParallel(services) {
  console.log(`[ServiceStarter] 🚀 Starting ${services.length} services in parallel...`);

  const results = await Promise.allSettled(
    services.map(service =>
      startServiceWithRetry(
        service.name,
        service.startFn,
        service.healthCheckFn,
        service.options || {}
      )
    )
  );

  const successful = [];
  const degraded = [];
  const failed = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const serviceResult = result.value;
      if (serviceResult.status === 'success') {
        successful.push(serviceResult);
      } else if (serviceResult.status === 'degraded') {
        degraded.push(serviceResult);
      }
    } else {
      failed.push({
        serviceName: services[index].name,
        error: result.reason.message,
        required: services[index].options?.required !== false
      });
    }
  });

  console.log(`[ServiceStarter] ✅ Successfully started: ${successful.length}`);
  console.log(`[ServiceStarter] ⚠️  Degraded (optional failed): ${degraded.length}`);
  console.log(`[ServiceStarter] ❌ Failed (required): ${failed.length}`);

  return {
    successful,
    degraded,
    failed,
    allSuccess: failed.length === 0 && degraded.length === 0,
    partialSuccess: successful.length > 0 && failed.length === 0,
    criticalFailure: failed.length > 0
  };
}

/**
 * Create a simple HTTP health checker for port-based services
 */
function createHttpHealthCheck(port, path = '/health') {
  return async () => {
    return new Promise((resolve) => {
      const client = http.request({
        host: 'localhost',
        port: port,
        method: 'GET',
        path: path,
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Accept 2xx status codes
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            console.log(`[ServiceStarter] Health check failed: HTTP ${res.statusCode}`);
            resolve(false);
          }
        });
      });

      client.on('error', (error) => {
        const errorMsg = error.message || error.code || 'Unknown error';
        const errorDetails = error.code ? ` (${error.code})` : '';
        console.log(`[ServiceStarter] Health check error: ${errorMsg}${errorDetails}`);
        console.log(`[ServiceStarter]    This usually means the service is not running or not listening on port ${port}`);
        resolve(false);
      });

      client.on('timeout', () => {
        console.log(`[ServiceStarter] Health check timeout on port ${port}`);
        console.log(`[ServiceStarter]    Service may be starting slowly or stuck in initialization`);
        client.destroy();
        resolve(false);
      });

      client.end();
    });
  };
}

/**
 * Create a PID-based health checker for background processes
 * Now includes retry logic for detached processes that may take time to register
 */
function createPidHealthCheck(options = {}) {
  const { maxRetries = 5, retryDelay = 500 } = options;

  return async (serviceInfo) => {
    if (!serviceInfo || !serviceInfo.pid) {
      return false;
    }

    // For detached processes, the PID might not be immediately registered
    // Retry a few times with small delays
    for (let i = 0; i < maxRetries; i++) {
      if (isProcessRunning(serviceInfo.pid)) {
        return true;
      }

      // Only wait if we have more retries left
      if (i < maxRetries - 1) {
        await sleep(retryDelay);
      }
    }

    return false;
  };
}

export {
  startServiceWithRetry,
  startServicesParallel,
  createHttpHealthCheck,
  createPidHealthCheck,
  isPortListening,
  isProcessRunning,
  sleep
};
