#!/usr/bin/env node

/**
 * Comprehensive Event Logging System
 * 
 * Single source of truth for all live logging system events
 * Logs significant events to coding/logs for traceability
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class EventLogger {
  constructor() {
    // Use environment variables for paths (not hardcoded)
    this.codingPath = process.env.CODING_TOOLS_PATH || path.join(__dirname, '..');
    this.logsDir = path.join(this.codingPath, 'logs');
    this.logFile = path.join(this.logsDir, 'live-logging-events.log');
    
    this.ensureLogsDir();
  }

  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  formatTimestamp() {
    return new Date().toISOString();
  }

  formatLogEntry(level, category, message, context = null) {
    const timestamp = this.formatTimestamp();
    const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${contextStr}\n`;
  }

  writeLog(entry) {
    try {
      fs.appendFileSync(this.logFile, entry);
    } catch (error) {
      // Fallback to console if file logging fails
      console.error('Log write failed:', error.message);
      console.error('Log entry:', entry.trim());
    }
  }

  // Core logging methods
  info(category, message, context = null) {
    const entry = this.formatLogEntry('info', category, message, context);
    this.writeLog(entry);
  }

  warn(category, message, context = null) {
    const entry = this.formatLogEntry('warn', category, message, context);
    this.writeLog(entry);
  }

  error(category, message, context = null) {
    const entry = this.formatLogEntry('error', category, message, context);
    this.writeLog(entry);
  }

  debug(category, message, context = null) {
    if (process.env.DEBUG_STATUS || process.env.TRANSCRIPT_DEBUG) {
      const entry = this.formatLogEntry('debug', category, message, context);
      this.writeLog(entry);
    }
  }

  // Specific event logging methods for live logging system
  transcriptMonitorStarted(projectPath, transcriptFile) {
    this.info('TRANSCRIPT_MONITOR', 'Monitor started', {
      project_path: projectPath,
      transcript_file: transcriptFile,
      pid: process.pid
    });
  }

  transcriptMonitorStopped(reason = 'normal') {
    this.info('TRANSCRIPT_MONITOR', 'Monitor stopped', {
      reason,
      pid: process.pid
    });
  }

  promptDetected(userMessage, sessionWindow) {
    this.info('PROMPT_DETECTION', 'User prompt detected', {
      message_preview: userMessage.substring(0, 100),
      session_window: sessionWindow,
      timestamp: new Date().toISOString()
    });
  }

  lslCreated(filename, exchangeCount, projectPath) {
    this.info('LSL_CREATION', 'Live Session Log created', {
      filename,
      exchange_count: exchangeCount,
      project_path: projectPath
    });
  }

  codingRedirectDetected(fromProject, toProject) {
    this.info('CODING_REDIRECT', 'Coding directory operations detected', {
      from_project: fromProject,
      to_project: toProject,
      redirect_type: 'file_operations'
    });
  }

  trajectoryGenerated(projectPath, lslCount, analysisType) {
    this.info('TRAJECTORY', 'Project trajectory generated', {
      project_path: projectPath,
      lsl_count: lslCount,
      analysis_type: analysisType
    });
  }

  trajectoryFailed(projectPath, error) {
    this.error('TRAJECTORY', 'Trajectory generation failed', {
      project_path: projectPath,
      error_message: error.message,
      error_stack: error.stack
    });
  }

  statusLineUpdate(statusText, compliance, apiUsage) {
    this.debug('STATUS_LINE', 'Status updated', {
      status_text: statusText,
      compliance_score: compliance,
      api_usage: apiUsage
    });
  }

  healthCheck(component, status, details = null) {
    const level = status === 'operational' ? 'info' : (status === 'degraded' ? 'warn' : 'error');
    this[level]('HEALTH_CHECK', `Component health: ${component}`, {
      status,
      details
    });
  }

  systemError(component, error, recoverable = false) {
    this.error('SYSTEM_ERROR', `${component} error`, {
      error_message: error.message,
      error_stack: error.stack,
      recoverable,
      pid: process.pid
    });
  }

  // Cleanup and maintenance
  rotateLogs() {
    try {
      const stats = fs.statSync(this.logFile);
      const maxSize = 10 * 1024 * 1024; // 10MB
      
      if (stats.size > maxSize) {
        const backupFile = this.logFile.replace('.log', `-${Date.now()}.log.bak`);
        fs.renameSync(this.logFile, backupFile);
        this.info('LOG_ROTATION', 'Log file rotated', {
          backup_file: backupFile,
          original_size: stats.size
        });
      }
    } catch (error) {
      // Don't log rotation failures to avoid infinite loops
      console.error('Log rotation failed:', error.message);
    }
  }

  // Get recent logs (for debugging)
  getRecentLogs(lines = 50) {
    try {
      if (!fs.existsSync(this.logFile)) {
        return [];
      }
      
      const content = fs.readFileSync(this.logFile, 'utf8');
      const logLines = content.trim().split('\n');
      return logLines.slice(-lines);
    } catch (error) {
      console.error('Failed to read recent logs:', error.message);
      return [];
    }
  }
}

// Create singleton instance
const eventLogger = new EventLogger();

// Auto-rotate logs on startup
eventLogger.rotateLogs();

// Export both the instance and class
export default eventLogger;
export { EventLogger };

// CLI interface for testing and manual logging
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Event Logger System');
    console.log('Usage: node event-logger.js <command>');
    console.log('Commands:');
    console.log('  test           - Run test logging');
    console.log('  recent [n]     - Show recent n log entries (default: 20)');
    console.log('  rotate         - Force log rotation');
    process.exit(0);
  }

  const command = args[0];
  
  switch (command) {
    case 'test':
      eventLogger.info('TEST', 'Event logging system test');
      eventLogger.warn('TEST', 'Warning message test');
      eventLogger.error('TEST', 'Error message test', { test_data: 'example' });
      eventLogger.debug('TEST', 'Debug message test');
      console.log('Test logging completed. Check:', eventLogger.logFile);
      break;
      
    case 'recent':
      const count = parseInt(args[1]) || 20;
      const recentLogs = eventLogger.getRecentLogs(count);
      console.log(`\nRecent ${count} log entries:\n`);
      recentLogs.forEach(line => console.log(line));
      break;
      
    case 'rotate':
      eventLogger.rotateLogs();
      console.log('Log rotation completed');
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}