#!/usr/bin/env node

/**
 * Enhanced Constraint Endpoint
 *
 * Provides violation storage and retrieval for the constraint monitoring dashboard.
 * This was missing and causing dashboard to show 0 violations.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory storage for violations (will be persisted to file)
let violationsStorage = [];
const STORAGE_FILE = path.join(__dirname, '.constraint-violations.json');

// Initialize storage from file if it exists
function initializeStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf8');
      violationsStorage = JSON.parse(data);
    }
  } catch (error) {
    console.warn('Could not load violations storage:', error.message);
    violationsStorage = [];
  }
}

// Persist storage to file
function persistStorage() {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(violationsStorage, null, 2));
  } catch (error) {
    console.warn('Could not persist violations storage:', error.message);
  }
}

// Clean up old violations (older than 7 days)
function cleanupOldViolations() {
  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const initialCount = violationsStorage.length;

  violationsStorage = violationsStorage.filter(violation => {
    const violationTime = new Date(violation.timestamp).getTime();
    return violationTime > weekAgo;
  });

  if (violationsStorage.length !== initialCount) {
    console.log(`Cleaned up ${initialCount - violationsStorage.length} old violations`);
    persistStorage();
  }
}

// Initialize on import
initializeStorage();
cleanupOldViolations();

/**
 * Get current live session violations
 */
export async function getLiveSessionViolations() {
  // Return violations from the last hour
  const hourAgo = Date.now() - (60 * 60 * 1000);

  return violationsStorage.filter(violation => {
    const violationTime = new Date(violation.timestamp).getTime();
    return violationTime > hourAgo;
  });
}

/**
 * Get enhanced violation history
 */
export async function getEnhancedViolationHistory(limit = 50) {
  // Sort by timestamp descending and limit results
  const sortedViolations = [...violationsStorage]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return {
    violations: sortedViolations,
    total: violationsStorage.length,
    metadata: {
      oldest: violationsStorage.length > 0 ?
        Math.min(...violationsStorage.map(v => new Date(v.timestamp).getTime())) : null,
      newest: violationsStorage.length > 0 ?
        Math.max(...violationsStorage.map(v => new Date(v.timestamp).getTime())) : null,
      storage_file: STORAGE_FILE
    }
  };
}

/**
 * Store violations
 */
export function storeViolations(violations) {
  if (!Array.isArray(violations)) {
    console.warn('storeViolations expects an array');
    return;
  }

  const timestamp = new Date().toISOString();

  // Add violations with enhanced metadata
  violations.forEach(violation => {
    const enhancedViolation = {
      id: violation.id || `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      constraint_id: violation.constraint_id,
      message: violation.message,
      severity: violation.severity,
      timestamp: violation.timestamp || timestamp,
      tool: violation.tool || 'api',
      session_id: violation.session_id || 'unknown',
      context: violation.context || violation.project || 'unknown',
      repository: violation.context || violation.project || 'unknown',
      file_path: violation.file_path || 'unknown',
      matches: violation.matches || 1,
      source: violation.source || 'constraint_test'
    };

    violationsStorage.push(enhancedViolation);
  });

  // Persist to file
  persistStorage();

  console.log(`Stored ${violations.length} violations. Total: ${violationsStorage.length}`);

  return {
    stored: violations.length,
    total: violationsStorage.length
  };
}

/**
 * Clear all violations (for testing)
 */
export function clearAllViolations() {
  violationsStorage = [];
  persistStorage();
  console.log('Cleared all violations');
}

/**
 * Get storage statistics
 */
export function getStorageStats() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  return {
    total: violationsStorage.length,
    last_hour: violationsStorage.filter(v =>
      (now - new Date(v.timestamp).getTime()) < hour
    ).length,
    last_24h: violationsStorage.filter(v =>
      (now - new Date(v.timestamp).getTime()) < day
    ).length,
    by_severity: violationsStorage.reduce((acc, v) => {
      acc[v.severity] = (acc[v.severity] || 0) + 1;
      return acc;
    }, {}),
    storage_file: STORAGE_FILE
  };
}

// Auto-cleanup old violations every hour
setInterval(cleanupOldViolations, 60 * 60 * 1000);