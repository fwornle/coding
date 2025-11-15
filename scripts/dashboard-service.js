#!/usr/bin/env node

/**
 * Dashboard Service Wrapper
 *
 * Wraps the constraint monitoring dashboard for Global Service Coordinator
 * Starts the Next.js dashboard on port 3030
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CODING_REPO = process.env.CODING_REPO || join(__dirname, '..');
const DASHBOARD_DIR = join(CODING_REPO, 'integrations/mcp-constraint-monitor/dashboard');
const PORT = process.env.CONSTRAINT_DASHBOARD_PORT || 3030;

console.log(`[Dashboard Service] Starting on port ${PORT}...`);
console.log(`[Dashboard Service] Directory: ${DASHBOARD_DIR}`);

// Verify dashboard directory exists
if (!fs.existsSync(DASHBOARD_DIR)) {
  console.error(`[Dashboard Service] ERROR: Dashboard directory not found: ${DASHBOARD_DIR}`);
  process.exit(1);
}

// Start the dashboard with npm run dev
const child = spawn('npm', ['run', 'dev'], {
  cwd: DASHBOARD_DIR,
  env: {
    ...process.env,
    PORT: PORT.toString(),
    NODE_ENV: 'development',
    NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3031'
  },
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error(`[Dashboard Service] Failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', async (code) => {
  console.log(`[Dashboard Service] Exited with code ${code}`);

  // Unregister from PSM on exit
  try {
    const ProcessStateManager = (await import('./process-state-manager.js')).default;
    const psm = new ProcessStateManager();
    await psm.initialize();
    await psm.unregisterService('constraint-dashboard-child', 'global');
  } catch (error) {
    // Ignore cleanup errors
  }

  process.exit(code || 0);
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('[Dashboard Service] Received SIGTERM, shutting down...');
  child.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('[Dashboard Service] Received SIGINT, shutting down...');
  child.kill('SIGINT');
});

console.log(`[Dashboard Service] Started (PID: ${child.pid})`);

// Register child process with PSM
(async () => {
  try {
    const ProcessStateManager = (await import('./process-state-manager.js')).default;
    const psm = new ProcessStateManager();
    await psm.initialize();

    await psm.registerService({
      name: 'constraint-dashboard-child',
      pid: child.pid,
      type: 'global',
      script: 'npm run dev (Next.js)',
      metadata: {
        parentWrapper: process.pid,
        port: PORT,
        service: 'constraint-monitor-dashboard'
      }
    });

    console.log(`[Dashboard Service] Registered child with PSM (PID: ${child.pid})`);
  } catch (error) {
    console.error(`[Dashboard Service] Failed to register with PSM: ${error.message}`);
    // Continue anyway - not critical
  }
})();
