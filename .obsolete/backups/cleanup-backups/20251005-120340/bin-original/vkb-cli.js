#!/usr/bin/env node
/**
 * VKB CLI Wrapper - Delegates to the VKB Server CLI
 * 
 * Simple wrapper that calls the proper VKB Server CLI implementation
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the actual CLI implementation
const cliPath = path.join(__dirname, '..', 'lib', 'vkb-server', 'cli.js');

// Forward all arguments to the real CLI
const args = process.argv.slice(2);

// Spawn the actual CLI process
const child = spawn('node', [cliPath, ...args], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')  // Run from coding directory
});

// Forward exit code
child.on('exit', (code) => {
  process.exit(code || 0);
});

// Handle errors
child.on('error', (error) => {
  console.error('Failed to start VKB CLI:', error.message);
  process.exit(1);
});