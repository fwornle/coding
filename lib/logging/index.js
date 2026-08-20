/**
 * Logging Module Index
 *
 * Backend Logger for Node.js code in the coding infrastructure.
 *
 * Usage:
 *   import { createLogger, getLogger, Logger } from '../lib/logging/index.js';
 *
 *   // Create logger for a category
 *   const logger = createLogger('my-component');
 *   logger.info('Starting');
 *   logger.error('Failed', { error: err.message });
 *
 *   // Get singleton logger (cached)
 *   const logger = getLogger('health');
 *
 *   // Quick logging
 *   import { log } from '../lib/logging/index.js';
 *   log.info('Quick message');
 *
 * For frontend React code, use:
 *   import { Logger } from '../utils/logging/Logger';
 */

export {
  Logger,
  createLogger,
  getLogger,
  reloadConfig,
  log
} from './Logger.js';

// `export { X } from '...'` re-exports X WITHOUT binding it in this module's
// scope, so the previous `export default Logger;` referenced an undefined
// identifier. That threw ReferenceError while the module was being evaluated,
// which broke EVERY import of this file — the named ones documented at the top
// included, not just the default. Nothing imports this barrel today, which is the
// only reason it went unnoticed. Logger.js already has a default export (:423);
// forward it rather than re-deriving it here.
export { default } from './Logger.js';
