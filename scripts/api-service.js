#!/usr/bin/env node

/**
 * API Service Wrapper
 *
 * Wraps the constraint monitoring API server for Global Service Coordinator
 * Starts the Express.js API backend on port 3031
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CODING_REPO = process.env.CODING_REPO || join(__dirname, '..');
const CONSTRAINT_DIR = join(CODING_REPO, 'integrations/mcp-constraint-monitor');
const API_SERVER_PATH = join(CONSTRAINT_DIR, 'src/dashboard-server.js');
const PORT = process.env.CONSTRAINT_API_PORT || 3031;

console.log(`[API Service] Starting on port ${PORT}...`);
console.log(`[API Service] Server: ${API_SERVER_PATH}`);

// Verify API server exists
if (!fs.existsSync(API_SERVER_PATH)) {
  console.error(`[API Service] ERROR: API server not found: ${API_SERVER_PATH}`);
  process.exit(1);
}

// Start the API server directly with node
const child = spawn('node', [API_SERVER_PATH], {
  cwd: CONSTRAINT_DIR,
  env: {
    ...process.env,
    PORT: PORT.toString(),
    NODE_ENV: process.env.NODE_ENV || 'production',
    DASHBOARD_PORT: process.env.CONSTRAINT_DASHBOARD_PORT || '3030'
  },
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error(`[API Service] Failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', async (code) => {
  console.log(`[API Service] Exited with code ${code}`);

  // Unregister from PSM on exit
  try {
    const ProcessStateManager = (await import('./process-state-manager.js')).default;
    const psm = new ProcessStateManager();
    await psm.initialize();
    await psm.unregisterService('constraint-api-child', 'global');
  } catch (error) {
    // Ignore cleanup errors
  }

  process.exit(code || 0);
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('[API Service] Received SIGTERM, shutting down...');
  child.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('[API Service] Received SIGINT, shutting down...');
  child.kill('SIGINT');
});

console.log(`[API Service] Started (PID: ${child.pid})`);

// Register child process with PSM
(async () => {
  try {
    const ProcessStateManager = (await import('./process-state-manager.js')).default;
    const psm = new ProcessStateManager();
    await psm.initialize();

    await psm.registerService({
      name: 'constraint-api-child',
      pid: child.pid,
      type: 'global',
      script: 'dashboard-server.js',
      metadata: {
        parentWrapper: process.pid,
        port: PORT,
        service: 'constraint-monitor-api'
      }
    });

    console.log(`[API Service] Registered child with PSM (PID: ${child.pid})`);
  } catch (error) {
    console.error(`[API Service] Failed to register with PSM: ${error.message}`);
    // Continue anyway - not critical
  }
})();
