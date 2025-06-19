/**
 * Logging Utility - Structured logging for the Knowledge API
 */

export class Logger {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'info',
      console: config.console !== false,
      file: config.file || false,
      filePath: config.filePath,
      colors: config.colors !== false,
      timestamp: config.timestamp !== false,
      ...config
    };
    
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    this.colors = {
      error: '\x1b[31m',   // Red
      warn: '\x1b[33m',    // Yellow
      info: '\x1b[36m',    // Cyan
      debug: '\x1b[37m',   // White
      trace: '\x1b[90m',   // Gray
      reset: '\x1b[0m'
    };
  }

  /**
   * Log error message
   */
  error(message, meta = {}) {
    this._log('error', message, meta);
  }

  /**
   * Log warning message
   */
  warn(message, meta = {}) {
    this._log('warn', message, meta);
  }

  /**
   * Log info message
   */
  info(message, meta = {}) {
    this._log('info', message, meta);
  }

  /**
   * Log debug message
   */
  debug(message, meta = {}) {
    this._log('debug', message, meta);
  }

  /**
   * Log trace message
   */
  trace(message, meta = {}) {
    this._log('trace', message, meta);
  }

  /**
   * Create a child logger with additional context
   */
  child(context = {}) {
    const childLogger = new Logger(this.config);
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }

  /**
   * Set logging level
   */
  setLevel(level) {
    if (level in this.levels) {
      this.config.level = level;
    } else {
      throw new Error(`Invalid log level: ${level}`);
    }
  }

  /**
   * Check if level is enabled
   */
  isLevelEnabled(level) {
    return this.levels[level] <= this.levels[this.config.level];
  }

  // Private methods

  _log(level, message, meta = {}) {
    if (!this.isLevelEnabled(level)) {
      return;
    }
    
    const logEntry = this._createLogEntry(level, message, meta);
    
    if (this.config.console) {
      this._logToConsole(logEntry);
    }
    
    if (this.config.file && this.config.filePath) {
      this._logToFile(logEntry);
    }
  }

  _createLogEntry(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    
    const entry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...meta
    };
    
    return entry;
  }

  _logToConsole(entry) {
    const { level, message, timestamp, ...meta } = entry;
    
    let output = '';
    
    // Add color if enabled
    if (this.config.colors && this.colors[level]) {
      output += this.colors[level];
    }
    
    // Add timestamp if enabled
    if (this.config.timestamp) {
      output += `[${timestamp}] `;
    }
    
    // Add level
    output += `${level.toUpperCase().padEnd(5)} `;
    
    // Add message
    output += message;
    
    // Add metadata if present
    const metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      output += ' ' + JSON.stringify(meta);
    }
    
    // Reset color if enabled
    if (this.config.colors && this.colors[level]) {
      output += this.colors.reset;
    }
    
    // Output to appropriate stream
    if (level === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  async _logToFile(entry) {
    if (!this.config.filePath) {
      return;
    }
    
    try {
      const { promises: fs } = await import('fs');
      const path = await import('path');
      
      // Ensure directory exists
      const dir = path.dirname(this.config.filePath);
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
      
      // Format as JSON lines
      const line = JSON.stringify(entry) + '\n';
      
      // Append to file
      await fs.appendFile(this.config.filePath, line, 'utf8');
      
    } catch (error) {
      // Fallback to console if file logging fails
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Performance timing utilities
   */
  time(label) {
    const startTime = process.hrtime.bigint();
    
    return {
      end: (message = null) => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1e6; // Convert to milliseconds
        
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
   * Memory usage logging
   */
  logMemoryUsage(label = 'Memory usage') {
    const usage = process.memoryUsage();
    
    this.debug(label, {
      memory: {
        rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(usage.external / 1024 / 1024)}MB`
      }
    });
  }

  /**
   * Log with structured data
   */
  logOperation(operation, status, meta = {}) {
    const level = status === 'success' ? 'info' : 
                  status === 'error' ? 'error' : 'warn';
    
    this._log(level, `Operation ${operation} ${status}`, {
      operation,
      status,
      ...meta
    });
  }

  /**
   * Log API requests/responses
   */
  logApiCall(method, endpoint, status, duration = null, meta = {}) {
    const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info';
    
    this._log(level, `${method} ${endpoint} ${status}`, {
      api: {
        method,
        endpoint,
        status,
        duration: duration ? `${duration}ms` : undefined
      },
      ...meta
    });
  }

  /**
   * Create logger middleware for express-like frameworks
   */
  createMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      
      const originalSend = res.send;
      res.send = function(data) {
        const duration = Date.now() - start;
        this.logApiCall(
          req.method,
          req.originalUrl || req.url,
          res.statusCode,
          duration,
          {
            userAgent: req.get('User-Agent'),
            ip: req.ip
          }
        );
        return originalSend.call(res, data);
      }.bind(this);
      
      next();
    };
  }

  /**
   * Static factory methods
   */
  static createConsoleLogger(level = 'info') {
    return new Logger({
      level,
      console: true,
      colors: true,
      timestamp: true
    });
  }

  static createFileLogger(filePath, level = 'info') {
    return new Logger({
      level,
      console: false,
      file: true,
      filePath,
      timestamp: true
    });
  }

  static createCombinedLogger(filePath, level = 'info') {
    return new Logger({
      level,
      console: true,
      file: true,
      filePath,
      colors: true,
      timestamp: true
    });
  }

  /**
   * Log level constants
   */
  static get LEVELS() {
    return {
      ERROR: 'error',
      WARN: 'warn',
      INFO: 'info',
      DEBUG: 'debug',
      TRACE: 'trace'
    };
  }
}