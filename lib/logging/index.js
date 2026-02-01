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

export default Logger;
