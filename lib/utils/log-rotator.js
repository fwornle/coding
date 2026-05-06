/**
 * Rotating logger helper — extracted from health-verifier.js:171-188 and
 * statusline-health-monitor.js:129-146 (identical inline blocks).
 *
 * Phase 33: shared by health-coordinator + reduced reporters.
 * No new dependencies — Node built-ins only.
 *
 * @module lib/utils/log-rotator
 */
import fs from 'node:fs';

/**
 * Build a rotating logger function bound to a single log file.
 *
 * The returned function appends to `logPath`. When the file exceeds
 * `maxBytes`, it is renamed to `<logPath>.1` and a new file begins.
 * Errors writing the log are surfaced on stderr but never thrown.
 *
 * @param {Object} opts
 * @param {string} opts.logPath - Absolute path to the log file
 * @param {string} opts.prefix  - Class-name prefix used in log lines (e.g. 'HealthCoordinator')
 * @param {number} [opts.maxBytes=10485760] - Rotation threshold in bytes (default 10 MB)
 * @param {boolean} [opts.debug=false] - When true, also mirror lines to stderr
 * @returns {(message: string, level?: string) => void}
 */
export function createRotatingLogger({ logPath, prefix, maxBytes = 10 * 1024 * 1024, debug = false }) {
  if (!logPath) throw new Error('createRotatingLogger requires logPath');
  if (!prefix) throw new Error('createRotatingLogger requires prefix');
  return function log(message, level = 'INFO') {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] [${prefix}] ${message}\n`;
    if (debug || level === 'ERROR') process.stderr.write(line);
    try {
      try {
        const sz = fs.statSync(logPath).size;
        if (sz > maxBytes) fs.renameSync(logPath, logPath + '.1');
      } catch { /* missing/unwritable on first call is fine */ }
      fs.appendFileSync(logPath, line);
    } catch (err) {
      process.stderr.write(`Failed to write log to ${logPath}: ${err.message}\n`);
    }
  };
}
