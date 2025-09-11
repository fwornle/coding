/**
 * OperationalLogger - Comprehensive Logging for Reliable Coding Classifier
 * 
 * Enables comprehensive debugging and post-mortem analysis of classification decisions.
 * Provides structured logging for debugging and analysis while maintaining high performance.
 * 
 * Features:
 * - Log all classification decisions with detailed decision paths
 * - Structured JSON logging for easy analysis
 * - Automatic log rotation to prevent disk space issues
 * - Sensitive data redaction for security
 * - High-performance asynchronous logging
 * - Multiple log levels and categories
 * - Log analysis and query capabilities
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class OperationalLogger {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.logDir = options.logDir || path.join(this.projectPath, '.specstory', 'logs');
    this.debug = options.debug || false;
    this.enabled = options.enabled !== false; // Default to enabled
    
    // Log rotation settings
    this.maxLogSizeMB = options.maxLogSizeMB || 10;
    this.maxLogFiles = options.maxLogFiles || 5;
    
    // Performance settings
    this.batchSize = options.batchSize || 100;
    this.flushIntervalMs = options.flushIntervalMs || 5000;
    
    // Log buffer for batching
    this.logBuffer = [];
    this.flushTimer = null;
    
    // Statistics
    this.stats = {
      logsWritten: 0,
      errorsLogged: 0,
      classificationsLogged: 0,
      routingDecisionsLogged: 0,
      performanceMetricsLogged: 0,
      bytesWritten: 0,
      filesRotated: 0
    };
    
    // Initialize logging system
    this.initializeLogging();
    
    this.log('OperationalLogger initialized', 'info', 'system');
  }

  /**
   * Initialize logging system
   */
  initializeLogging() {
    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // Set up log file paths
    this.logFiles = {
      classification: path.join(this.logDir, 'classification.log'),
      routing: path.join(this.logDir, 'routing.log'), 
      performance: path.join(this.logDir, 'performance.log'),
      errors: path.join(this.logDir, 'errors.log'),
      system: path.join(this.logDir, 'system.log')
    };
    
    // Start flush timer
    this.startFlushTimer();
    
    // Handle process exit to flush remaining logs
    process.on('exit', () => this.flush());
    process.on('SIGINT', () => {
      this.flush();
      process.exit(0);
    });
  }

  /**
   * Log a classification decision with detailed decision path
   * @param {Object} exchange - Exchange that was classified
   * @param {Object} classificationResult - Classification result from ReliableCodingClassifier
   * @param {Object} context - Additional context (project, session info, etc.)
   */
  logClassification(exchange, classificationResult, context = {}) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'classification',
      exchangeId: this.generateExchangeId(exchange),
      classification: {
        result: classificationResult.classification || classificationResult.isCoding,
        confidence: classificationResult.confidence || 0,
        layer: classificationResult.layer || 'unknown',
        processingTimeMs: classificationResult.processingTimeMs || 0,
        reason: classificationResult.reason || 'No reason provided'
      },
      decisionPath: classificationResult.decisionPath || [],
      context: this.sanitizeContext(context),
      exchange: this.sanitizeExchange(exchange),
      performance: {
        timestamp: Date.now(),
        processingTime: classificationResult.processingTimeMs || 0,
        layer: classificationResult.layer || 'unknown'
      }
    };
    
    this.addToBuffer('classification', logEntry);
    this.stats.classificationsLogged++;
  }

  /**
   * Log a routing decision
   * @param {Object} exchange - Exchange being routed
   * @param {Object} routingResult - Result from ExchangeRouter
   * @param {Object} context - Additional context
   */
  logRouting(exchange, routingResult, context = {}) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'routing',
      exchangeId: this.generateExchangeId(exchange),
      routing: {
        decision: routingResult.routing || {},
        paths: routingResult.paths || {},
        success: routingResult.success || false,
        processingTimeMs: routingResult.processingTimeMs || 0
      },
      writes: routingResult.writes || {},
      context: this.sanitizeContext(context),
      exchange: this.sanitizeExchange(exchange)
    };
    
    this.addToBuffer('routing', logEntry);
    this.stats.routingDecisionsLogged++;
  }

  /**
   * Log performance metrics
   * @param {string} component - Component name (PathAnalyzer, SemanticAnalyzer, etc.)
   * @param {Object} metrics - Performance metrics
   * @param {Object} context - Additional context
   */
  logPerformance(component, metrics, context = {}) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'performance',
      component,
      metrics: {
        processingTime: metrics.processingTime || 0,
        accuracy: metrics.accuracy || null,
        throughput: metrics.throughput || null,
        errorRate: metrics.errorRate || null,
        ...metrics
      },
      context: this.sanitizeContext(context)
    };
    
    this.addToBuffer('performance', logEntry);
    this.stats.performanceMetricsLogged++;
  }

  /**
   * Log an error with full context
   * @param {Error|string} error - Error to log
   * @param {Object} context - Error context
   * @param {string} severity - Error severity (error, warning, critical)
   */
  logError(error, context = {}, severity = 'error') {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      severity,
      error: {
        message: typeof error === 'string' ? error : error.message,
        stack: error.stack || null,
        name: error.name || 'Error'
      },
      context: this.sanitizeContext(context),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        workingDirectory: process.cwd(),
        projectPath: this.projectPath
      }
    };
    
    this.addToBuffer('errors', logEntry);
    this.stats.errorsLogged++;
  }

  /**
   * Log system events
   * @param {string} message - Log message
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} category - Log category
   * @param {Object} metadata - Additional metadata
   */
  log(message, level = 'info', category = 'general', metadata = {}) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'system',
      level,
      category,
      message,
      metadata: this.sanitizeContext(metadata)
    };
    
    this.addToBuffer('system', logEntry);
    this.stats.logsWritten++;
    
    // Also log to console in debug mode
    if (this.debug && level !== 'debug') {
      console.log(`[OperationalLogger:${category}] ${message}`);
    }
  }

  /**
   * Add log entry to buffer
   * @param {string} logType - Type of log (classification, routing, etc.)
   * @param {Object} logEntry - Log entry to buffer
   */
  addToBuffer(logType, logEntry) {
    this.logBuffer.push({
      logType,
      entry: logEntry,
      size: JSON.stringify(logEntry).length
    });
    
    // Flush if buffer is full
    if (this.logBuffer.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush log buffer to files
   */
  flush() {
    if (this.logBuffer.length === 0) return;
    
    const bufferToFlush = [...this.logBuffer];
    this.logBuffer = [];
    
    // Group logs by type
    const logsByType = {};
    for (const { logType, entry, size } of bufferToFlush) {
      if (!logsByType[logType]) {
        logsByType[logType] = [];
      }
      logsByType[logType].push(entry);
      this.stats.bytesWritten += size;
    }
    
    // Write each log type to its file
    for (const [logType, entries] of Object.entries(logsByType)) {
      this.writeLogEntries(logType, entries);
    }
  }

  /**
   * Write log entries to file
   * @param {string} logType - Type of log
   * @param {Array} entries - Log entries to write
   */
  writeLogEntries(logType, entries) {
    const logFile = this.logFiles[logType];
    if (!logFile) return;
    
    try {
      // Check if log rotation is needed
      this.rotateLogIfNeeded(logFile);
      
      // Write entries as JSONL (one JSON object per line)
      const logLines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      
      fs.appendFileSync(logFile, logLines, 'utf8');
      
    } catch (error) {
      console.error(`Failed to write to log file ${logFile}:`, error.message);
    }
  }

  /**
   * Rotate log file if it exceeds maximum size
   * @param {string} logFile - Log file path
   */
  rotateLogIfNeeded(logFile) {
    if (!fs.existsSync(logFile)) return;
    
    const stats = fs.statSync(logFile);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    if (fileSizeMB > this.maxLogSizeMB) {
      this.rotateLogFile(logFile);
      this.stats.filesRotated++;
    }
  }

  /**
   * Rotate a log file
   * @param {string} logFile - Log file path to rotate
   */
  rotateLogFile(logFile) {
    const ext = path.extname(logFile);
    const base = logFile.slice(0, -ext.length);
    
    // Shift existing rotated files
    for (let i = this.maxLogFiles - 1; i >= 1; i--) {
      const oldFile = `${base}.${i}${ext}`;
      const newFile = `${base}.${i + 1}${ext}`;
      
      if (fs.existsSync(oldFile)) {
        if (i === this.maxLogFiles - 1) {
          fs.unlinkSync(oldFile); // Delete oldest
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }
    
    // Move current file to .1
    fs.renameSync(logFile, `${base}.1${ext}`);
  }

  /**
   * Start flush timer
   */
  startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Generate unique exchange ID
   * @param {Object} exchange - Exchange object
   * @returns {string} Unique ID
   */
  generateExchangeId(exchange) {
    const content = JSON.stringify({
      timestamp: exchange.timestamp || Date.now(),
      userMessage: exchange.userMessage?.substring(0, 100) || '',
      tools: exchange.toolCalls?.map(t => t.name).join(',') || ''
    });
    
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
  }

  /**
   * Sanitize exchange data for logging
   * @param {Object} exchange - Exchange to sanitize
   * @returns {Object} Sanitized exchange
   */
  sanitizeExchange(exchange) {
    return {
      id: this.generateExchangeId(exchange),
      timestamp: exchange.timestamp || Date.now(),
      hasUserMessage: !!exchange.userMessage,
      userMessageLength: exchange.userMessage?.length || 0,
      hasAssistantResponse: !!(exchange.assistantResponse?.content || exchange.claudeResponse),
      assistantResponseLength: (exchange.assistantResponse?.content || exchange.claudeResponse || '').length,
      toolCallCount: (exchange.assistantResponse?.toolCalls || exchange.toolCalls || []).length,
      toolNames: (exchange.assistantResponse?.toolCalls || exchange.toolCalls || []).map(t => t.name)
    };
  }

  /**
   * Sanitize context data for logging
   * @param {Object} context - Context to sanitize
   * @returns {Object} Sanitized context
   */
  sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Remove or redact sensitive data
    const sensitiveKeys = ['apiKey', 'token', 'password', 'secret', 'key', 'auth'];
    
    for (const [key, value] of Object.entries(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 500) + '...[TRUNCATED]';
      }
    }
    
    return sanitized;
  }

  /**
   * Query log entries
   * @param {Object} filters - Query filters
   * @param {Object} options - Query options
   * @returns {Array} Matching log entries
   */
  queryLogs(filters = {}, options = {}) {
    const results = [];
    const limit = options.limit || 100;
    const logTypes = filters.logTypes || Object.keys(this.logFiles);
    
    for (const logType of logTypes) {
      const logFile = this.logFiles[logType];
      if (!fs.existsSync(logFile)) continue;
      
      try {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n');
        
        for (const line of lines.slice(-limit)) {
          if (!line.trim()) continue;
          
          try {
            const entry = JSON.parse(line);
            if (this.matchesFilters(entry, filters)) {
              results.push(entry);
            }
          } catch (parseError) {
            // Skip malformed lines
          }
        }
      } catch (error) {
        this.logError(`Failed to read log file ${logFile}`, { error: error.message });
      }
    }
    
    // Sort by timestamp descending
    return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
  }

  /**
   * Check if log entry matches filters
   * @param {Object} entry - Log entry
   * @param {Object} filters - Filters to apply
   * @returns {boolean} True if entry matches
   */
  matchesFilters(entry, filters) {
    if (filters.type && entry.type !== filters.type) return false;
    if (filters.level && entry.level !== filters.level) return false;
    if (filters.category && entry.category !== filters.category) return false;
    if (filters.component && entry.component !== filters.component) return false;
    if (filters.severity && entry.severity !== filters.severity) return false;
    
    if (filters.since) {
      const entryTime = new Date(entry.timestamp);
      const sinceTime = new Date(filters.since);
      if (entryTime < sinceTime) return false;
    }
    
    if (filters.until) {
      const entryTime = new Date(entry.timestamp);
      const untilTime = new Date(filters.until);
      if (entryTime > untilTime) return false;
    }
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const entryText = JSON.stringify(entry).toLowerCase();
      if (!entryText.includes(searchLower)) return false;
    }
    
    return true;
  }

  /**
   * Get logging statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      bufferSize: this.logBuffer.length,
      logDirectory: this.logDir,
      logFiles: Object.keys(this.logFiles).map(type => ({
        type,
        path: this.logFiles[type],
        exists: fs.existsSync(this.logFiles[type]),
        size: fs.existsSync(this.logFiles[type]) 
          ? (fs.statSync(this.logFiles[type]).size / 1024).toFixed(2) + 'KB'
          : '0KB'
      }))
    };
  }

  /**
   * Enable or disable logging
   * @param {boolean} enabled - Whether to enable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.log(`Logging ${enabled ? 'enabled' : 'disabled'}`, 'info', 'system');
  }

  /**
   * Clean up and stop logger
   */
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    this.flush();
    this.log('OperationalLogger destroyed', 'info', 'system');
  }
}

export default OperationalLogger;