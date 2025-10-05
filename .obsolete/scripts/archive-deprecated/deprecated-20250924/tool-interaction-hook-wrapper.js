#!/usr/bin/env node

/**
 * Wrapper script for tool-interaction-hook.js
 * Sets CODING_REPO environment variable before executing the main script
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingRepo = process.env.CODING_REPO || join(__dirname, '..');

// Set the environment variable for the child process
const env = { ...process.env, CODING_REPO: codingRepo };

// Execute the main hook script with proper environment and pass through all arguments
const child = spawn('node', [join(__dirname, 'tool-interaction-hook.js'), ...process.argv.slice(2)], {
  env,
  stdio: ['pipe', 'inherit', 'inherit']  // Allow stdin piping for hook data
});

// Forward stdin to child process for hook data
if (process.stdin.isTTY === false) {
  process.stdin.pipe(child.stdin);
} else {
  child.stdin.end();
}

child.on('exit', (code) => {
  process.exit(code || 0);
});