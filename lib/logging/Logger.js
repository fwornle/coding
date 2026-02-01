/**
 * Unified Backend Logger for Coding Infrastructure
 *
 * A structured logging system for Node.js backend code.
 * For frontend (React) code, use: integrations/system-health-dashboard/src/utils/logging/Logger.ts
 *
 * Features:
 * - Configurable log levels (error, warn, info, debug, trace)
 * - Category-based filtering
 * - Console and file output
 * - Colored terminal output
 * - Timestamps and structured metadata
 * - Performance timing utilities
 * - Express middleware support
 *
 * Usage:
 *   import { Logger, createLogger } from '../lib/logging/Logger.js';
 *
 *   // Option 1: Use shared logger with category
 *   const logger = createLogger('my-component');
 *   logger.info('Starting up');
 *   logger.error('Something failed', { error: err.message });
 *
 *   // Option 2: Create custom logger
 *   const logger = new Logger({ level: 'debug', category: 'custom' });
 *
 * Configuration:
 *   Loads from config/logging-config.json if available.
 *   Falls back to sensible defaults.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve coding repo root
const CODING_REPO = process.env.CODING_REPO || path.resolve(__dirname, '../..');

// Log levels with numeric priority
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

// ANSI color codes for terminal output
const COLORS = {
  error: '\x1b[31m',    // Red
  warn: '\x1b[33m',     // Yellow
  info: '\x1b[36m',     // Cyan
  debug: '\x1b[37m',    // White
  trace: '\x1b[90m',    // Gray
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Category colors for visual distinction
const CATEGORY_COLORS = {
  health: '\x1b[32m',       // Green
  billing: '\x1b[35m',      // Magenta
  transcript: '\x1b[34m',   // Blue
  knowledge: '\x1b[36m',    // Cyan
  workflow: '\x1b[33m',     // Yellow
  database: '\x1b[95m',     // Light magenta
  api: '\x1b[94m',          // Light blue
  mcp: '\x1b[92m',          // Light green
  default: '\x1b[37m'       // White
};

/**
 * Load logging configuration from file
 */
function loadConfig() {
  const configPath = path.join(CODING_REPO, 'config', 'logging-config.json');

  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    // Fall through to defaults
  }

  // Default configuration
  return {
    level: 'info',
    console: true,
    file: false,
    filePath: path.join(CODING_REPO, 'logs', 'app.log'),
    colors: true,
    timestamp: true,
    categories: {}
  };
}

// Shared configuration (loaded once)
let sharedConfig = null;

function getSharedConfig() {
  if (!sharedConfig) {
    sharedConfig = loadConfig();
  }
  return sharedConfig;
}

/**
 * Reload configuration from file
 * Useful after config changes
 */
export function reloadConfig() {
  sharedConfig = loadConfig();
  return sharedConfig;
}

/**
 * Logger class for structured backend logging
 */
export class Logger {
  constructor(options = {}) {
    const globalConfig = getSharedConfig();

    // Merge options with global config
    this.config = {
      level: options.level || globalConfig.level || 'info',
      console: options.console ?? globalConfig.console ?? true,
      file: options.file ?? globalConfig.file ?? false,
      filePath: options.filePath || globalConfig.filePath,
      colors: options.colors ?? globalConfig.colors ?? true,
      timestamp: options.timestamp ?? globalConfig.timestamp ?? true,
      category: options.category || 'default'
    };

    // Check for category-specific level override
    const categoryConfig = globalConfig.categories?.[this.config.category];
    if (categoryConfig?.level) {
      this.config.level = categoryConfig.level;
    }

    this.context = options.context || {};
  }

  /**
   * Check if a level is enabled
   */
  isLevelEnabled(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.config.level];
  }

  /**
   * Core logging method
   */
  _log(level, message, meta = {}) {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const entry = this._createEntry(level, message, meta);

    if (this.config.console) {
      this._writeToConsole(entry);
    }

    if (this.config.file && this.config.filePath) {
      this._writeToFile(entry);
    }
  }

  /**
   * Create a log entry object
   */
  _createEntry(level, message, meta = {}) {
    return {
      timestamp: new Date().toISOString(),
      level,
      category: this.config.category,
      message,
      ...this.context,
      ...meta
    };
  }

  /**
   * Write to console with formatting
   */
  _writeToConsole(entry) {
    const { level, category, message, timestamp, ...meta } = entry;

    let output = '';

    // Timestamp
    if (this.config.timestamp) {
      if (this.config.colors) {
        output += `${COLORS.dim}[${timestamp}]${COLORS.reset} `;
      } else {
        output += `[${timestamp}] `;
      }
    }

    // Level badge
    const levelStr = level.toUpperCase().padEnd(5);
    if (this.config.colors) {
      output += `${COLORS[level]}${COLORS.bold}${levelStr}${COLORS.reset} `;
    } else {
      output += `${levelStr} `;
    }

    // Category
    if (category && category !== 'default') {
      const catColor = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
      if (this.config.colors) {
        output += `${catColor}[${category}]${COLORS.reset} `;
      } else {
        output += `[${category}] `;
      }
    }

    // Message
    output += message;

    // Metadata
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      if (this.config.colors) {
        output += ` ${COLORS.dim}${JSON.stringify(meta)}${COLORS.reset}`;
      } else {
        output += ` ${JSON.stringify(meta)}`;
      }
    }

    // Write to appropriate stream
    if (level === 'error') {
      process.stderr.write(output + '\n');
    } else if (level === 'warn') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  /**
   * Write to file (JSON lines format)
   */
  _writeToFile(entry) {
    try {
      const dir = path.dirname(this.config.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.config.filePath, line, 'utf8');
    } catch (error) {
      // Write to stderr if file logging fails
      process.stderr.write(`[Logger] File write failed: ${error.message}\n`);
    }
  }

  // Convenience methods

  error(message, meta = {}) {
    this._log('error', message, meta);
  }

  warn(message, meta = {}) {
    this._log('warn', message, meta);
  }

  info(message, meta = {}) {
    this._log('info', message, meta);
  }

  debug(message, meta = {}) {
    this._log('debug', message, meta);
  }

  trace(message, meta = {}) {
    this._log('trace', message, meta);
  }

  /**
   * Create a child logger with additional context
   */
  child(context = {}) {
    const childLogger = new Logger({
      ...this.config,
      context: { ...this.context, ...context }
    });
    return childLogger;
  }

  /**
   * Set logging level dynamically
   */
  setLevel(level) {
    if (level in LOG_LEVELS) {
      this.config.level = level;
    }
  }

  /**
   * Performance timing utility
   */
  time(label) {
    const startTime = process.hrtime.bigint();

    return {
      end: (message = null) => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1e6; // milliseconds

        const logMessage = message || `Timer "${label}" completed`;
        this.debug(logMessage, {
          timer: label,
          duration: `${duration.toFixed(2)}ms`
        });

        return duration;
      }
    };
  }

  /**
   * Log memory usage
   */
  logMemoryUsage(label = 'Memory usage') {
    const usage = process.memoryUsage();

    this.debug(label, {
      memory: {
        rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`
      }
    });
  }

  /**
   * Log an operation with status
   */
  logOperation(operation, status, meta = {}) {
    const level = status === 'success' ? 'info' :
                  status === 'error' ? 'error' : 'warn';

    this._log(level, `${operation}: ${status}`, { operation, status, ...meta });
  }

  /**
   * Express middleware for request logging
   */
  createMiddleware() {
    const self = this;
    return (req, res, next) => {
      const start = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 400 ? 'error' :
                      res.statusCode >= 300 ? 'warn' : 'info';

        self._log(level, `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`, {
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          duration: `${duration}ms`
        });
      });

      next();
    };
  }

  // Static constants

  static get LEVELS() {
    return { ...LOG_LEVELS };
  }

  static get CATEGORIES() {
    return Object.keys(CATEGORY_COLORS);
  }
}

/**
 * Create a logger for a specific category
 * Uses shared configuration
 */
export function createLogger(category, options = {}) {
  return new Logger({ ...options, category });
}

/**
 * Get or create a singleton logger for a category
 * Useful for modules that want consistent logging
 */
const loggerCache = new Map();

export function getLogger(category) {
  if (!loggerCache.has(category)) {
    loggerCache.set(category, createLogger(category));
  }
  return loggerCache.get(category);
}

/**
 * Quick logging functions (use default category)
 */
const defaultLogger = new Logger({ category: 'app' });

export const log = {
  error: (msg, meta) => defaultLogger.error(msg, meta),
  warn: (msg, meta) => defaultLogger.warn(msg, meta),
  info: (msg, meta) => defaultLogger.info(msg, meta),
  debug: (msg, meta) => defaultLogger.debug(msg, meta),
  trace: (msg, meta) => defaultLogger.trace(msg, meta)
};

export default Logger;
