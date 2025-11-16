/**
 * ESM CLI Detection Utility
 * Provides cross-platform detection for when an ESM module is run directly
 *
 * This module solves the Windows path compatibility issue where import.meta.url
 * comparison with process.argv[1] fails due to file:// URL vs Windows path mismatch.
 */

import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Check if this module is being run directly (not imported)
 * Cross-platform compatible version of: import.meta.url === `file://${process.argv[1]}`
 *
 * @param {string} importMetaUrl - The import.meta.url of the calling module
 * @returns {boolean} - True if module is being run directly
 */
export function isMainModule(importMetaUrl) {
  try {
    const scriptPath = fileURLToPath(importMetaUrl);
    const argPath = path.resolve(process.argv[1]);
    return scriptPath === argPath;
  } catch (error) {
    // Fallback for edge cases
    return false;
  }
}

/**
 * Execute a function only if this is the main module
 * Convenience wrapper for common CLI pattern
 *
 * @param {string} importMetaUrl - The import.meta.url of the calling module
 * @param {Function} fn - Function to execute if this is the main module
 */
export function runIfMain(importMetaUrl, fn) {
  if (isMainModule(importMetaUrl)) {
    fn();
  }
}
