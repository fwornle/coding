#!/usr/bin/env node

/**
 * Wrapper script for combined-status-line.js
 * Sets CODING_REPO environment variable before executing the main script
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRepo = process.env.CODING_REPO || join(__dirname, '..');

// Set the environment variable for the child process
const env = { ...process.env, CODING_REPO: codingRepo };

// Execute the main status line script with proper environment
const child = spawn('node', [join(__dirname, 'combined-status-line.js')], {
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});