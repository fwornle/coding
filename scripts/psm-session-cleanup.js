#!/usr/bin/env node

/**
 * Process State Manager Session Cleanup
 *
 * Cleans up a session and terminates all its associated services
 * Records graceful shutdown in session metadata
 *
 * Usage: psm-session-cleanup.js <sessionId>
 */

import ProcessStateManager from './process-state-manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manager = new ProcessStateManager();
const sessionId = process.argv[2];

if (!sessionId) {
  console.error('Usage: psm-session-cleanup.js <sessionId>');
  process.exit(1);
}

/**
 * Record graceful shutdown for future crash detection
 */
async function recordGracefulShutdown(sessionId) {
  try {
    const shutdownRecordPath = path.join(__dirname, '../.data/session-shutdowns.json');

    // Ensure directory exists
    await fs.mkdir(path.dirname(shutdownRecordPath), { recursive: true });

    // Read existing records
    let records = {};
    try {
      const data = await fs.readFile(shutdownRecordPath, 'utf-8');
      records = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start fresh
    }

    // Add this shutdown record
    records[sessionId] = {
      timestamp: new Date().toISOString(),
      type: 'graceful',
      pid: process.pid
    };

    // Keep only last 100 records to avoid unbounded growth
    const recordKeys = Object.keys(records);
    if (recordKeys.length > 100) {
      const toDelete = recordKeys.slice(0, recordKeys.length - 100);
      toDelete.forEach(key => delete records[key]);
    }

    await fs.writeFile(shutdownRecordPath, JSON.stringify(records, null, 2));
  } catch (error) {
    // Don't fail cleanup if we can't record the shutdown
    console.warn(`⚠️  Could not record graceful shutdown: ${error.message}`);
  }
}

(async () => {
  try {
    console.log(`🧹 Cleaning up session: ${sessionId}`);

    // Record this as a graceful shutdown
    await recordGracefulShutdown(sessionId);

    const result = await manager.cleanupSession(sessionId);

    if (result.cleaned > 0) {
      console.log(`✅ Cleaned up ${result.cleaned} service(s)`);

      if (result.terminated.length > 0) {
        console.log('   Terminated:');
        result.terminated.forEach(({ name, pid }) => {
          console.log(`   - ${name} (PID: ${pid})`);
        });
      }
    } else {
      console.log('ℹ️  No services to clean up');
    }

    console.log('✅ Session shutdown recorded as graceful');
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
})();
