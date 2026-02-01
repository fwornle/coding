/**
 * Simple logging utility for VKB Server
 *
 * @deprecated Use createLogger from lib/logging/Logger.js instead.
 * This wrapper is kept for backwards compatibility with existing VKB code.
 */

import { createLogger as createUnifiedLogger } from '../../logging/Logger.js';

export class Logger {
  constructor(name) {
    this.name = name;
    this._logger = createUnifiedLogger(name);
  }

  info(message) {
    this._logger.info(message);
  }

  warn(message) {
    this._logger.warn(message);
  }

  error(message) {
    this._logger.error(message);
  }

  success(message) {
    // Map success to info with a success indicator
    this._logger.info(`✓ ${message}`);
  }
}