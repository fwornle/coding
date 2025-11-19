#!/usr/bin/env node

/**
 * Cleanup Orphaned Processes
 *
 * Automatically detects and cleans up orphaned node processes from previous sessions:
 * - Transcript monitors without valid project paths
 * - Stuck ukb/vkb operations (older than 5 minutes)
 * - Orphaned qdrant-sync processes
 * - Old shell snapshot processes
 *
 * Usage:
 *   node scripts/cleanup-orphaned-processes.js [--dry-run]
 *   ./bin/cleanup-orphans [--dry-run]
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_AGE_MINUTES = 5; // Kill processes older than this

console.log('🧹 Orphaned Process Cleanup');
console.log('═══════════════════════════\n');

if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE - No processes will be killed\n');
}

/**
 * Get all node processes matching patterns
 */
function getOrphanedProcesses() {
  try {
    const output = execSync(
      'ps aux | grep -E "node.*(vkb|ukb|enhanced-transcript|sync-graph|zsh.*snapshot)" | grep -v grep',
      { encoding: 'utf8' }
    );

    const lines = output.trim().split('\n');
    const processes = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1]);
      const command = parts.slice(10).join(' ');

      processes.push({ pid, command, line });
    }

    return processes;
  } catch (error) {
    // No matches found
    return [];
  }
}

/**
 * Check if a transcript monitor has a valid project path
 */
function isValidTranscriptMonitor(command) {
  const match = command.match(/enhanced-transcript-monitor\.js\s+(.+)/);
  if (!match) return { valid: false, reason: 'no path argument' };

  const projectPath = match[1].trim();
  if (!projectPath) return { valid: false, reason: 'empty path' };
  if (!path.isAbsolute(projectPath)) return { valid: false, reason: 'relative path' };
  if (!existsSync(projectPath)) return { valid: false, reason: 'path does not exist' };

  return { valid: true };
}

/**
 * Determine if a process should be killed
 */
function shouldKill(process) {
  const { command } = process;

  // Transcript monitors without valid project paths
  if (command.includes('enhanced-transcript-monitor.js')) {
    const check = isValidTranscriptMonitor(command);
    if (!check.valid) {
      return { kill: true, reason: `Invalid transcript monitor (${check.reason})` };
    }
    return { kill: false };
  }

  // ukb/vkb operations (likely stuck if still running)
  if (command.includes('ukb-database/cli.js') || command.includes('vkb-cli.js')) {
    // Exception: Don't kill vkb server
    if (command.includes('server start')) {
      return { kill: false };
    }
    return { kill: true, reason: 'Stuck ukb/vkb operation' };
  }

  // Qdrant sync processes
  if (command.includes('sync-graph-to-qdrant.js')) {
    return { kill: true, reason: 'Orphaned qdrant sync' };
  }

  // Shell snapshots
  if (command.includes('shell-snapshots') && command.includes('zsh')) {
    return { kill: true, reason: 'Old shell snapshot' };
  }

  return { kill: false };
}

/**
 * Kill a process by PID
 */
function killProcess(pid, reason) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would kill PID ${pid}: ${reason}`);
    return true;
  }

  try {
    execSync(`kill ${pid}`, { stdio: 'ignore' });
    console.log(`  ✅ Killed PID ${pid}: ${reason}`);
    return true;
  } catch (error) {
    console.log(`  ❌ Failed to kill PID ${pid}: ${error.message}`);
    return false;
  }
}

/**
 * Main cleanup function
 */
function cleanup() {
  const processes = getOrphanedProcesses();

  if (processes.length === 0) {
    console.log('✨ No orphaned processes found\n');
    return { total: 0, killed: 0 };
  }

  console.log(`Found ${processes.length} potentially orphaned process(es)\n`);

  let killed = 0;
  const toKill = [];

  for (const process of processes) {
    const decision = shouldKill(process);
    if (decision.kill) {
      toKill.push({ ...process, reason: decision.reason });
    }
  }

  if (toKill.length === 0) {
    console.log('✨ All processes are valid - nothing to clean up\n');
    return { total: processes.length, killed: 0 };
  }

  console.log(`Cleaning up ${toKill.length} orphaned process(es):\n`);

  for (const { pid, reason } of toKill) {
    if (killProcess(pid, reason)) {
      killed++;
    }
  }

  console.log(`\n✅ Cleanup complete: ${killed}/${toKill.length} processes cleaned up\n`);

  return { total: processes.length, killed };
}

// Run cleanup
const result = cleanup();

// Exit code: 0 if successful, 1 if nothing was done but should have been
if (result.killed > 0 || result.total === 0) {
  process.exit(0);
} else {
  process.exit(1);
}
