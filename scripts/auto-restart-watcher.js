/**
 * Auto-Restart Watcher
 *
 * Watches script files on disk and triggers graceful exit when they change.
 * Relies on existing process supervision (combined-status-line, global-process-supervisor)
 * to restart the daemon with the updated code.
 *
 * Usage:
 *   import { enableAutoRestart } from './auto-restart-watcher.js';
 *   enableAutoRestart({
 *     scriptUrl: import.meta.url,
 *     dependencies: ['./process-state-manager.js', './health-remediation-actions.js'],
 *     cleanupFn: async () => { await myDaemon.stop(); },
 *     logger: (msg) => myDaemon.log(msg)
 *   });
 */

import { watchFile, unwatchFile, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Enable auto-restart when script files change on disk.
 *
 * @param {Object} opts
 * @param {string} opts.scriptUrl - import.meta.url of the main script
 * @param {string[]} [opts.dependencies] - relative paths to watch (resolved from script dir)
 * @param {Function} [opts.cleanupFn] - async cleanup before exit
 * @param {Function} [opts.logger] - log function (defaults to console.error)
 * @param {number} [opts.pollInterval=5000] - fs.watchFile poll interval in ms
 * @param {number} [opts.debounceMs=2000] - debounce window for rapid saves
 * @returns {Function} cleanup function to stop watching
 */
export function enableAutoRestart({
  scriptUrl,
  dependencies = [],
  cleanupFn,
  logger,
  pollInterval = 5000,
  debounceMs = 2000
}) {
  const scriptPath = scriptUrl.startsWith('file://') ? fileURLToPath(scriptUrl) : scriptUrl;
  const scriptDir = path.dirname(scriptPath);
  const scriptName = path.basename(scriptPath);

  const watchPaths = [scriptPath];
  for (const dep of dependencies) {
    const depPath = path.isAbsolute(dep) ? dep : path.join(scriptDir, dep);
    try {
      statSync(depPath);
      watchPaths.push(depPath);
    } catch {
      // Dependency doesn't exist on disk, skip
    }
  }

  let restartScheduled = false;
  let debounceTimer = null;

  const log = logger || ((msg) => process.stderr.write(msg + '\n'));

  const triggerRestart = async (changedFile) => {
    if (restartScheduled) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      restartScheduled = true;
      const relPath = path.relative(scriptDir, changedFile);
      log(`[auto-restart] ${scriptName}: ${relPath} changed on disk, exiting for supervised restart...`);

      // Stop watching
      for (const wp of watchPaths) {
        try { unwatchFile(wp); } catch { /* ignore */ }
      }

      // Run cleanup
      if (cleanupFn) {
        try {
          await cleanupFn();
        } catch (err) {
          log(`[auto-restart] cleanup error: ${err.message}`);
        }
      }

      // Exit cleanly — supervision infrastructure will restart us
      process.exit(0);
    }, debounceMs);
  };

  for (const watchPath of watchPaths) {
    watchFile(watchPath, { interval: pollInterval }, (curr, prev) => {
      if (curr.mtimeMs > prev.mtimeMs) {
        triggerRestart(watchPath);
      }
    });
  }

  log(`[auto-restart] ${scriptName}: watching ${watchPaths.length} file(s) for changes`);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const wp of watchPaths) {
      try { unwatchFile(wp); } catch { /* ignore */ }
    }
  };
}
