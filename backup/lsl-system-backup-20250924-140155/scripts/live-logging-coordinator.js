#!/usr/bin/env node

/**
 * Live Logging Coordinator (Enhanced v2.0)
 * Integrates all LSL system enhancements for comprehensive session logging
 * Features: LSL File Manager, Enhanced Operational Logger, User Hash System, 
 * Configurable Redaction, Performance Monitoring, Multi-User Support
 */

import { promises as fs } from 'fs';
import { existsSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// LSL File Manager - Advanced file lifecycle management
class LSLFileManager {
  constructor(options = {}) {
    this.options = {
      maxFileSize: options.maxFileSize || 50 * 1024 * 1024, // 50MB
      rotationThreshold: options.rotationThreshold || 40 * 1024 * 1024, // 40MB
      enableCompression: options.enableCompression !== false,
      compressionLevel: options.compressionLevel || 6,
      maxArchivedFiles: options.maxArchivedFiles || 50,
      monitoringInterval: options.monitoringInterval || 5 * 60 * 1000, // 5 minutes
      enableRealTimeMonitoring: options.enableRealTimeMonitoring !== false,
      retentionDays: options.retentionDays || 90,
      ...options
    };
    
    this.activeFiles = new Map();
    this.compressionQueue = [];
    this.monitoringTimer = null;
    this.isMonitoring = false;
    
    this.setupMonitoring();
  }

  async setupMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.monitoringTimer = setInterval(async () => {
      await this.performMaintenance();
    }, this.options.monitoringInterval);
  }

  async registerFile(filePath, metadata = {}) {
    const stats = await this.getFileStats(filePath);
    const fileInfo = {
      path: filePath,
      size: stats.size,
      created: stats.birthtime,
      lastModified: stats.mtime,
      metadata: { ...metadata, registered: new Date() },
      compressionEligible: this.isCompressionEligible(stats.size)
    };
    
    this.activeFiles.set(filePath, fileInfo);
    
    // Check if rotation is needed
    if (stats.size >= this.options.rotationThreshold) {
      await this.rotateFile(filePath);
    }
    
    return fileInfo;
  }

  async getFileStats(filePath) {
    try {
      return await fs.stat(filePath);
    } catch (error) {
      return {
        size: 0,
        birthtime: new Date(),
        mtime: new Date()
      };
    }
  }

  isCompressionEligible(size) {
    return this.options.enableCompression && size > 1024; // > 1KB
  }

  async rotateFile(filePath) {
    try {
      if (!existsSync(filePath)) return;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveDir = join(dirname(filePath), 'archived');
      await fs.mkdir(archiveDir, { recursive: true });
      
      const basename = filePath.split('/').pop().replace('.md', '');
      const archiveName = `${basename}_${timestamp}.md`;
      const archivePath = join(archiveDir, archiveName);

      // Copy to archive
      await fs.copyFile(filePath, archivePath);
      
      // Compress if enabled
      if (this.options.enableCompression) {
        await this.compressFile(archivePath);
      }
      
      // Truncate original file
      await fs.writeFile(filePath, '');
      
      // Update tracking
      const fileInfo = this.activeFiles.get(filePath);
      if (fileInfo) {
        fileInfo.size = 0;
        fileInfo.lastRotation = new Date();
        fileInfo.archiveCount = (fileInfo.archiveCount || 0) + 1;
      }
      
      console.log(`🔄 File rotated: ${filePath} -> ${archiveName}`);
      
      // Clean old archives
      await this.cleanOldArchives(archiveDir);
      
    } catch (error) {
      console.error('File rotation error:', error);
      throw error;
    }
  }

  async compressFile(filePath) {
    try {
      const data = await fs.readFile(filePath);
      const compressed = await gzip(data, { level: this.options.compressionLevel });
      const compressedPath = `${filePath}.gz`;
      
      await fs.writeFile(compressedPath, compressed);
      await fs.unlink(filePath); // Remove uncompressed version
      
      const originalSize = data.length;
      const compressedSize = compressed.length;
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      
      console.log(`📦 Compressed: ${filePath} (${ratio}% reduction)`);
      
    } catch (error) {
      console.error('Compression error:', error);
    }
  }

  async cleanOldArchives(archiveDir) {
    try {
      const files = await fs.readdir(archiveDir);
      const archiveFiles = files
        .filter(f => f.endsWith('.md') || f.endsWith('.md.gz'))
        .map(f => ({
          name: f,
          path: join(archiveDir, f),
          stat: null
        }));

      // Get stats for all files
      for (const file of archiveFiles) {
        try {
          file.stat = await fs.stat(file.path);
        } catch (e) {
          continue;
        }
      }

      // Sort by modification time (newest first)
      archiveFiles
        .filter(f => f.stat)
        .sort((a, b) => b.stat.mtime - a.stat.mtime);

      // Remove excess files (keep maxArchivedFiles)
      const excessFiles = archiveFiles.slice(this.options.maxArchivedFiles);
      for (const file of excessFiles) {
        await fs.unlink(file.path);
        console.log(`🗑️  Removed old archive: ${file.name}`);
      }

      // Remove files older than retention period
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.options.retentionDays);
      
      const filesToClean = archiveFiles.filter(f => f.stat && f.stat.mtime < cutoffDate);
      for (const file of filesToClean) {
        await fs.unlink(file.path);
        console.log(`⏰ Removed expired archive: ${file.name}`);
      }

    } catch (error) {
      console.error('Archive cleanup error:', error);
    }
  }

  async performMaintenance() {
    try {
      const tasks = [];
      
      for (const [filePath, fileInfo] of this.activeFiles) {
        if (existsSync(filePath)) {
          const stats = await this.getFileStats(filePath);
          fileInfo.size = stats.size;
          fileInfo.lastModified = stats.mtime;
          
          // Check rotation
          if (stats.size >= this.options.rotationThreshold) {
            tasks.push(this.rotateFile(filePath));
          }
          
          // Check compression eligibility for archives
          if (fileInfo.compressionEligible && !fileInfo.compressed) {
            const archiveDir = join(dirname(filePath), 'archived');
            if (existsSync(archiveDir)) {
              tasks.push(this.compressArchives(archiveDir));
            }
          }
        }
      }
      
      await Promise.allSettled(tasks);
      
    } catch (error) {
      console.error('Maintenance error:', error);
    }
  }

  async compressArchives(archiveDir) {
    try {
      const files = await fs.readdir(archiveDir);
      const uncompressed = files.filter(f => f.endsWith('.md') && !f.endsWith('.gz'));
      
      for (const file of uncompressed) {
        const filePath = join(archiveDir, file);
        const stats = await fs.stat(filePath);
        
        // Compress files older than 1 hour
        if (Date.now() - stats.mtime.getTime() > 3600000) {
          await this.compressFile(filePath);
        }
      }
    } catch (error) {
      console.error('Archive compression error:', error);
    }
  }

  async getSystemMetrics() {
    const metrics = {
      activeFiles: this.activeFiles.size,
      totalSize: 0,
      compressionRatio: 0,
      rotationEvents: 0,
      archiveCount: 0
    };

    for (const fileInfo of this.activeFiles.values()) {
      metrics.totalSize += fileInfo.size;
      metrics.rotationEvents += fileInfo.archiveCount || 0;
    }

    // Calculate archive metrics
    try {
      const archiveDirs = Array.from(this.activeFiles.keys())
        .map(path => join(dirname(path), 'archived'))
        .filter((dir, index, arr) => arr.indexOf(dir) === index); // unique

      for (const archiveDir of archiveDirs) {
        if (existsSync(archiveDir)) {
          const files = await fs.readdir(archiveDir);
          metrics.archiveCount += files.length;
        }
      }
    } catch (error) {
      console.debug('Archive metrics error:', error);
    }

    return metrics;
  }

  destroy() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    this.isMonitoring = false;
    this.activeFiles.clear();
  }
}

// Enhanced Operational Logger - Structured logging with alerting
class EnhancedOperationalLogger {
  constructor(options = {}) {
    this.options = {
      logDir: options.logDir || join(process.cwd(), '.specstory', 'logs'),
      enableMetrics: options.enableMetrics !== false,
      enableAlerts: options.enableAlerts !== false,
      metricsInterval: options.metricsInterval || 60000, // 1 minute
      alertThresholds: {
        fileSize: 45 * 1024 * 1024, // 45MB
        errorRate: 0.1, // 10%
        processingDelay: 30000, // 30 seconds
        ...options.alertThresholds
      },
      retentionDays: options.retentionDays || 30,
      ...options
    };
    
    this.metrics = {
      events: { total: 0, errors: 0, warnings: 0, info: 0 },
      performance: { avgProcessingTime: 0, maxProcessingTime: 0 },
      files: { created: 0, rotated: 0, compressed: 0 },
      alerts: { triggered: 0, resolved: 0 }
    };
    
    this.recentEvents = [];
    this.maxRecentEvents = 100;
    this.metricsTimer = null;
    
    this.setupLogging();
  }

  async setupLogging() {
    await fs.mkdir(this.options.logDir, { recursive: true });
    
    if (this.options.enableMetrics) {
      this.metricsTimer = setInterval(() => {
        this.collectMetrics();
      }, this.options.metricsInterval);
    }
  }

  async log(level, message, context = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      context: {
        ...context,
        pid: process.pid,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    // Add to recent events
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }

    // Update metrics
    this.metrics.events.total++;
    this.metrics.events[level.toLowerCase()] = (this.metrics.events[level.toLowerCase()] || 0) + 1;

    // Write to log file
    const logFile = join(this.options.logDir, `operational-${this.getDateString()}.log`);
    const logEntry = JSON.stringify(event) + '\n';
    
    try {
      appendFileSync(logFile, logEntry);
    } catch (error) {
      console.error('Logging error:', error);
    }

    // Check for alerts
    if (this.options.enableAlerts && (level === 'error' || level === 'warn')) {
      await this.checkAlerts(event);
    }

    // Console output for errors and warnings
    if (level === 'error' || level === 'warn') {
      const emoji = level === 'error' ? '❌' : '⚠️';
      console.log(`${emoji} ${message}`, context.summary || '');
    }
  }

  async logInfo(message, context = {}) {
    await this.log('info', message, context);
  }

  async logWarning(message, context = {}) {
    await this.log('warn', message, context);
  }

  async logError(message, context = {}) {
    await this.log('error', message, context);
  }

  async logSuccess(message, context = {}) {
    await this.log('info', `✅ ${message}`, context);
  }

  async logPerformance(operation, duration, context = {}) {
    await this.log('info', `⏱️  Performance: ${operation} took ${duration}ms`, {
      ...context,
      operation,
      duration,
      type: 'performance'
    });

    // Update performance metrics
    this.metrics.performance.avgProcessingTime = 
      (this.metrics.performance.avgProcessingTime + duration) / 2;
    this.metrics.performance.maxProcessingTime = 
      Math.max(this.metrics.performance.maxProcessingTime, duration);
  }

  async checkAlerts(event) {
    const alerts = [];

    // High error rate
    const recentErrors = this.recentEvents.filter(e => 
      e.level === 'ERROR' && 
      Date.now() - new Date(e.timestamp).getTime() < 300000 // Last 5 minutes
    ).length;
    
    const errorRate = recentErrors / Math.min(this.recentEvents.length, 50);
    if (errorRate > this.options.alertThresholds.errorRate) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'critical',
        message: `High error rate detected: ${(errorRate * 100).toFixed(1)}%`,
        context: { errorRate, recentErrors }
      });
    }

    // Large file size (if file info available)
    if (event.context.fileSize && event.context.fileSize > this.options.alertThresholds.fileSize) {
      alerts.push({
        type: 'LARGE_FILE_SIZE',
        severity: 'warning',
        message: `Large file detected: ${Math.round(event.context.fileSize / 1024 / 1024)}MB`,
        context: { fileSize: event.context.fileSize }
      });
    }

    // Processing delays
    if (event.context.duration && event.context.duration > this.options.alertThresholds.processingDelay) {
      alerts.push({
        type: 'PROCESSING_DELAY',
        severity: 'warning',
        message: `Slow processing detected: ${event.context.duration}ms`,
        context: { duration: event.context.duration }
      });
    }

    // Process alerts
    for (const alert of alerts) {
      await this.processAlert(alert);
    }
  }

  async processAlert(alert) {
    this.metrics.alerts.triggered++;
    
    const alertEvent = {
      timestamp: new Date().toISOString(),
      type: 'ALERT',
      alert: alert,
      resolved: false
    };

    // Log the alert
    await this.log('warn', `🚨 ALERT: ${alert.message}`, alertEvent);

    // Additional alert handling could go here
    // (email notifications, webhooks, etc.)
  }

  async collectMetrics() {
    const systemMetrics = {
      timestamp: new Date().toISOString(),
      events: { ...this.metrics.events },
      performance: { ...this.metrics.performance },
      files: { ...this.metrics.files },
      alerts: { ...this.metrics.alerts },
      system: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        cpu: process.cpuUsage()
      }
    };

    // Write metrics to file
    const metricsFile = join(this.options.logDir, `metrics-${this.getDateString()}.json`);
    try {
      const existing = existsSync(metricsFile) ? 
        JSON.parse(readFileSync(metricsFile, 'utf8')) : { metrics: [] };
      
      existing.metrics.push(systemMetrics);
      
      // Keep only last 1440 entries (24 hours of minute data)
      if (existing.metrics.length > 1440) {
        existing.metrics = existing.metrics.slice(-1440);
      }
      
      writeFileSync(metricsFile, JSON.stringify(existing, null, 2));
    } catch (error) {
      console.error('Metrics collection error:', error);
    }
  }

  getDateString() {
    return new Date().toISOString().split('T')[0];
  }

  async getHealthStatus() {
    const recent = this.recentEvents.slice(-10);
    const errorCount = recent.filter(e => e.level === 'ERROR').length;
    const warningCount = recent.filter(e => e.level === 'WARN').length;

    return {
      status: errorCount === 0 ? 'healthy' : errorCount < 3 ? 'degraded' : 'unhealthy',
      metrics: this.metrics,
      recentEvents: recent,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }

  async cleanup() {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    
    // Clean old log files
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.options.retentionDays);
      
      const files = await fs.readdir(this.options.logDir);
      for (const file of files) {
        const filePath = join(this.options.logDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          console.log(`🧹 Cleaned old log: ${file}`);
        }
      }
    } catch (error) {
      console.error('Log cleanup error:', error);
    }
  }

  destroy() {
    this.cleanup();
  }
}

// User Hash Generator - Multi-user identification
class UserHashGenerator {
  static generateHash(options = {}) {
    const user = process.env.USER || process.env.USERNAME || 'unknown';
    const hash = crypto.createHash('sha256').update(user).digest('hex').substring(0, 6);
    
    if (options.debug) {
      console.log(`👤 User hash generated: ${user} -> ${hash}`);
    }
    
    return hash;
  }

  static getSystemInfo(options = {}) {
    const user = process.env.USER || process.env.USERNAME || 'unknown';
    const hash = this.generateHash(options);
    
    return {
      userIdentifier: user,
      userHash: hash,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid
    };
  }
}

// Main Live Logging Coordinator
class LiveLoggingCoordinator {
  constructor(options = {}) {
    this.options = {
      enableFileManager: options.enableFileManager !== false,
      enableOperationalLogging: options.enableOperationalLogging !== false,
      enablePerformanceMonitoring: options.enablePerformanceMonitoring !== false,
      enableMultiUserSupport: options.enableMultiUserSupport !== false,
      redactionConfig: options.redactionConfig || {},
      ...options
    };

    // Core components
    this.fileManager = null;
    this.operationalLogger = null;
    
    // State management
    this.isActive = false;
    this.sessionId = this.generateSessionId();
    this.toolCallBuffer = [];
    this.maxBufferSize = options.maxBufferSize || 100;
    
    // User identification
    this.userHash = UserHashGenerator.generateHash({ debug: options.debug });
    this.userInfo = UserHashGenerator.getSystemInfo({ debug: options.debug });
    
    // Performance monitoring
    this.performanceMetrics = {
      sessionStart: Date.now(),
      totalExchanges: 0,
      avgProcessingTime: 0,
      errors: 0
    };

    // Integration tracking
    this.constraintMonitorIntegrated = false;
    this.statusFilePath = join(process.cwd(), '.services-running.json');
    
    this.initialize();
  }

  generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6);
    return `live-${timestamp}-${this.userHash}-${random}`;
  }

  async initialize() {
    try {
      console.log(`🚀 Initializing Live Logging Coordinator v2.0`);
      console.log(`   User: ${this.userInfo.userIdentifier} (${this.userHash})`);
      console.log(`   Session: ${this.sessionId}`);
      
      // Initialize LSL File Manager
      if (this.options.enableFileManager) {
        await this.initializeFileManager();
      }
      
      // Initialize Operational Logger
      if (this.options.enableOperationalLogging) {
        await this.initializeOperationalLogger();
      }
      
      // Check constraint monitor integration
      this.checkConstraintMonitorIntegration();
      
      // Set up monitoring hooks
      await this.setupMonitoringHooks();
      
      // Start performance monitoring
      if (this.options.enablePerformanceMonitoring) {
        this.setupPerformanceMonitoring();
      }
      
      this.isActive = true;
      
      if (this.operationalLogger) {
        await this.operationalLogger.logSuccess('Live Logging Coordinator initialized', {
          sessionId: this.sessionId,
          userHash: this.userHash,
          features: {
            fileManager: !!this.fileManager,
            operationalLogging: !!this.operationalLogger,
            performanceMonitoring: this.options.enablePerformanceMonitoring,
            multiUserSupport: this.options.enableMultiUserSupport
          }
        });
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize live logging coordinator:', error);
      if (this.operationalLogger) {
        await this.operationalLogger.logError('Initialization failed', { error: error.message });
      }
    }
  }

  async initializeFileManager() {
    try {
      this.fileManager = new LSLFileManager({
        maxFileSize: 50 * 1024 * 1024,
        rotationThreshold: 40 * 1024 * 1024,
        enableCompression: true,
        compressionLevel: 6,
        maxArchivedFiles: 50,
        monitoringInterval: 5 * 60 * 1000,
        enableRealTimeMonitoring: true,
        retentionDays: 90
      });
      
      console.log('📁 LSL File Manager initialized');
    } catch (error) {
      console.error('File manager initialization error:', error);
      throw error;
    }
  }

  async initializeOperationalLogger() {
    try {
      this.operationalLogger = new EnhancedOperationalLogger({
        logDir: join(process.cwd(), '.specstory', 'logs'),
        enableMetrics: true,
        enableAlerts: true,
        metricsInterval: 60000,
        retentionDays: 30
      });
      
      console.log('📊 Enhanced Operational Logger initialized');
    } catch (error) {
      console.error('Operational logger initialization error:', error);
      throw error;
    }
  }

  checkConstraintMonitorIntegration() {
    if (existsSync(this.statusFilePath)) {
      try {
        const services = JSON.parse(readFileSync(this.statusFilePath, 'utf8'));
        this.constraintMonitorIntegrated = services.constraint_monitor && 
          services.constraint_monitor.status === '✅ FULLY OPERATIONAL';
          
        if (this.constraintMonitorIntegrated) {
          console.log('🔗 Constraint Monitor integration detected');
        }
      } catch (error) {
        console.debug('Could not read services status:', error.message);
      }
    }
  }

  async setupMonitoringHooks() {
    try {
      await this.createHookInterface();
      
      // Set up periodic buffer processing
      setInterval(async () => {
        await this.processBufferedInteractions();
      }, 5000); // Process every 5 seconds
      
      console.log('🔧 Monitoring hooks configured');
    } catch (error) {
      console.error('Hook setup error:', error);
      if (this.operationalLogger) {
        await this.operationalLogger.logError('Hook setup failed', { error: error.message });
      }
    }
  }

  async createHookInterface() {
    const hookDir = join(process.cwd(), '.mcp-sync');
    await fs.mkdir(hookDir, { recursive: true });
    
    const hookPath = join(hookDir, 'tool-interaction-hook.js');
    
    const hookContent = `
// Enhanced Tool Interaction Hook for Live Logging v2.0
// User: ${this.userHash}, Session: ${this.sessionId}

const { existsSync, appendFileSync } = require('fs');
const path = require('path');

function captureToolInteraction(toolCall, result, context = {}) {
  const interaction = {
    timestamp: new Date().toISOString(),
    sessionId: '${this.sessionId}',
    userHash: '${this.userHash}',
    userIdentifier: '${this.userInfo.userIdentifier}',
    toolCall: toolCall,
    result: result,
    context: {
      ...context,
      multiUser: true,
      coordinatorVersion: '2.0',
      features: {
        fileManager: ${!!this.fileManager},
        operationalLogging: ${!!this.operationalLogger},
        performanceMonitoring: ${this.options.enablePerformanceMonitoring}
      }
    }
  };
  
  // User-specific buffer file
  const bufferPath = path.join(process.cwd(), '.mcp-sync/tool-interaction-buffer-${this.userHash}.jsonl');
  
  try {
    appendFileSync(bufferPath, JSON.stringify(interaction) + '\\n');
  } catch (error) {
    console.error('Hook capture error:', error);
  }
}

module.exports = { captureToolInteraction };
`;
    
    writeFileSync(hookPath, hookContent);
  }

  setupPerformanceMonitoring() {
    // Monitor system resources
    setInterval(() => {
      const memory = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      if (memory.heapUsed > 500 * 1024 * 1024) { // 500MB
        if (this.operationalLogger) {
          this.operationalLogger.logWarning('High memory usage detected', {
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
          });
        }
      }
    }, 30000); // Every 30 seconds
    
    console.log('📈 Performance monitoring enabled');
  }

  async processBufferedInteractions() {
    const bufferPath = join(process.cwd(), `.mcp-sync/tool-interaction-buffer-${this.userHash}.jsonl`);
    
    if (!existsSync(bufferPath)) {
      return;
    }
    
    try {
      const startTime = Date.now();
      const bufferContent = readFileSync(bufferPath, 'utf8').trim();
      if (!bufferContent) {
        return;
      }
      
      const interactions = bufferContent.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(interaction => {
          // Only process interactions from this user
          return !interaction.userHash || interaction.userHash === this.userHash;
        });
      
      // Process each interaction
      for (const interaction of interactions) {
        await this.processToolInteraction(interaction);
      }
      
      // Clear the buffer
      writeFileSync(bufferPath, '');
      
      // Log performance
      const processingTime = Date.now() - startTime;
      if (this.operationalLogger && processingTime > 1000) {
        await this.operationalLogger.logPerformance('buffer_processing', processingTime, {
          interactionCount: interactions.length
        });
      }
      
    } catch (error) {
      console.error('Buffer processing error:', error);
      if (this.operationalLogger) {
        await this.operationalLogger.logError('Buffer processing failed', { error: error.message });
      }
    }
  }

  async processToolInteraction(interaction) {
    try {
      const startTime = Date.now();
      
      if (!this.isActive) {
        return;
      }
      
      // Add to buffer for analysis
      this.toolCallBuffer.push(interaction);
      if (this.toolCallBuffer.length > this.maxBufferSize) {
        this.toolCallBuffer.shift();
      }
      
      // Update performance metrics
      this.performanceMetrics.totalExchanges++;
      
      // Enhanced context with all integrations
      const enhancedContext = {
        ...interaction.context,
        sessionId: this.sessionId,
        userHash: this.userHash,
        userIdentifier: this.userInfo.userIdentifier,
        workingDirectory: process.cwd(),
        multiUserCoordination: true,
        coordinatorVersion: '2.0',
        fileManagerEnabled: !!this.fileManager,
        operationalLoggingEnabled: !!this.operationalLogger
      };
      
      // File management integration
      if (this.fileManager && interaction.result && interaction.result.filePath) {
        await this.fileManager.registerFile(interaction.result.filePath, {
          toolCall: interaction.toolCall.name,
          timestamp: interaction.timestamp,
          userHash: this.userHash
        });
      }
      
      // Process with enhanced logging
      const processingTime = Date.now() - startTime;
      
      if (this.operationalLogger) {
        await this.operationalLogger.logInfo(`Tool interaction processed: ${interaction.toolCall.name}`, {
          sessionId: this.sessionId,
          toolName: interaction.toolCall.name,
          processingTime,
          userHash: this.userHash
        });
        
        if (processingTime > 5000) {
          await this.operationalLogger.logWarning('Slow tool interaction processing', {
            toolName: interaction.toolCall.name,
            processingTime,
            context: enhancedContext
          });
        }
      }
      
      // Update average processing time
      this.performanceMetrics.avgProcessingTime = 
        (this.performanceMetrics.avgProcessingTime + processingTime) / 2;
        
    } catch (error) {
      console.error('Tool interaction processing error:', error);
      this.performanceMetrics.errors++;
      
      if (this.operationalLogger) {
        await this.operationalLogger.logError('Tool interaction processing failed', {
          error: error.message,
          toolCall: interaction.toolCall?.name,
          userHash: this.userHash
        });
      }
    }
  }

  // Manual tool interaction capture for testing
  async captureManualInteraction(toolName, params, result, context = {}) {
    const toolCall = { name: toolName, params };
    
    return await this.processToolInteraction({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userHash: this.userHash,
      toolCall: toolCall,
      result: result,
      context: {
        ...context,
        manual: true,
        workingDirectory: process.cwd()
      }
    });
  }

  // Session finalization with comprehensive reporting
  async finalizeSession() {
    try {
      console.log(`📋 Finalizing enhanced logging session: ${this.sessionId}`);
      
      // Process any remaining buffered interactions
      await this.processBufferedInteractions();
      
      // Generate comprehensive session summary
      const sessionDuration = Date.now() - this.performanceMetrics.sessionStart;
      const fileMetrics = this.fileManager ? await this.fileManager.getSystemMetrics() : null;
      const healthStatus = this.operationalLogger ? await this.operationalLogger.getHealthStatus() : null;
      
      const summary = {
        sessionId: this.sessionId,
        userHash: this.userHash,
        userIdentifier: this.userInfo.userIdentifier,
        duration: sessionDuration,
        performance: this.performanceMetrics,
        fileManagement: fileMetrics,
        operationalHealth: healthStatus,
        features: {
          fileManager: !!this.fileManager,
          operationalLogging: !!this.operationalLogger,
          performanceMonitoring: this.options.enablePerformanceMonitoring,
          multiUserSupport: this.options.enableMultiUserSupport,
          constraintMonitorIntegration: this.constraintMonitorIntegrated
        },
        timestamp: new Date().toISOString()
      };
      
      if (this.operationalLogger) {
        await this.operationalLogger.logSuccess('Session finalized successfully', summary);
      }
      
      console.log(`✅ Enhanced session finalized:`);
      console.log(`   Duration: ${Math.round(sessionDuration / 1000)}s`);
      console.log(`   Exchanges: ${this.performanceMetrics.totalExchanges}`);
      console.log(`   Avg Processing: ${Math.round(this.performanceMetrics.avgProcessingTime)}ms`);
      console.log(`   Errors: ${this.performanceMetrics.errors}`);
      if (fileMetrics) {
        console.log(`   Files Managed: ${fileMetrics.activeFiles}`);
        console.log(`   Total Size: ${Math.round(fileMetrics.totalSize / 1024 / 1024)}MB`);
      }
      
      this.isActive = false;
      return summary;
      
    } catch (error) {
      console.error('Session finalization error:', error);
      if (this.operationalLogger) {
        await this.operationalLogger.logError('Session finalization failed', { error: error.message });
      }
      return null;
    }
  }

  // Enhanced statistics and monitoring
  getSessionStats() {
    const fileMetrics = this.fileManager ? {
      activeFiles: this.fileManager.activeFiles.size,
      compressionEnabled: this.fileManager.options.enableCompression
    } : null;

    return {
      sessionId: this.sessionId,
      userHash: this.userHash,
      userIdentifier: this.userInfo.userIdentifier,
      isActive: this.isActive,
      bufferSize: this.toolCallBuffer.length,
      performance: this.performanceMetrics,
      features: {
        fileManager: !!this.fileManager,
        operationalLogging: !!this.operationalLogger,
        performanceMonitoring: this.options.enablePerformanceMonitoring,
        constraintMonitorIntegrated: this.constraintMonitorIntegrated
      },
      fileManagement: fileMetrics,
      recentInteractions: this.toolCallBuffer.slice(-5).map(i => ({
        tool: i.toolCall.name,
        timestamp: i.timestamp,
        userHash: i.userHash || this.userHash
      })),
      bufferFilePath: `.mcp-sync/tool-interaction-buffer-${this.userHash}.jsonl`,
      coordinatorVersion: '2.0'
    };
  }

  async getSystemHealth() {
    const stats = this.getSessionStats();
    const operationalHealth = this.operationalLogger ? 
      await this.operationalLogger.getHealthStatus() : null;
    const fileMetrics = this.fileManager ? 
      await this.fileManager.getSystemMetrics() : null;

    return {
      ...stats,
      systemHealth: {
        status: operationalHealth?.status || 'unknown',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        errors: this.performanceMetrics.errors,
        timestamp: new Date().toISOString()
      },
      operationalHealth,
      fileMetrics
    };
  }

  // Cleanup with comprehensive component shutdown
  async cleanup() {
    try {
      console.log('🧹 Cleaning up Live Logging Coordinator...');
      
      // Finalize session
      await this.finalizeSession();
      
      // Cleanup file manager
      if (this.fileManager) {
        this.fileManager.destroy();
        console.log('📁 File Manager cleaned up');
      }
      
      // Cleanup operational logger
      if (this.operationalLogger) {
        await this.operationalLogger.cleanup();
        console.log('📊 Operational Logger cleaned up');
      }
      
      // Clean up user-specific hook files
      const hookFiles = [
        '.mcp-sync/tool-interaction-hook.js',
        `.mcp-sync/tool-interaction-buffer-${this.userHash}.jsonl`
      ].map(f => join(process.cwd(), f));
      
      for (const file of hookFiles) {
        if (existsSync(file)) {
          try {
            await fs.unlink(file);
          } catch (error) {
            console.warn(`Could not clean up ${file}:`, error.message);
          }
        }
      }
      
      console.log('✅ Cleanup completed');
      
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

// Global coordinator management
let globalCoordinator = null;

export function getGlobalCoordinator(options = {}) {
  if (!globalCoordinator) {
    globalCoordinator = new LiveLoggingCoordinator(options);
  }
  return globalCoordinator;
}

export function destroyGlobalCoordinator() {
  if (globalCoordinator) {
    globalCoordinator.cleanup();
    globalCoordinator = null;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const coordinator = new LiveLoggingCoordinator({
    debug: process.argv.includes('--debug'),
    enableFileManager: !process.argv.includes('--no-file-manager'),
    enableOperationalLogging: !process.argv.includes('--no-operational-logging'),
    enablePerformanceMonitoring: !process.argv.includes('--no-performance-monitoring'),
    enableMultiUserSupport: !process.argv.includes('--no-multi-user')
  });
  
  // Graceful shutdown handlers
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    await coordinator.cleanup();
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Keep alive with status updates
  setInterval(async () => {
    const stats = coordinator.getSessionStats();
    if (stats.bufferSize > 0 || stats.performance.totalExchanges % 10 === 0) {
      console.log(`📊 Session stats: ${stats.bufferSize} buffered, ${stats.performance.totalExchanges} total exchanges`);
    }
    
    // Health check every 5 minutes
    if (Date.now() % 300000 < 30000) { // Roughly every 5 minutes
      const health = await coordinator.getSystemHealth();
      console.log(`🏥 System health: ${health.systemHealth.status}`);
    }
  }, 30000); // Every 30 seconds
  
  console.log('🚀 Enhanced Live Logging Coordinator running...');
  console.log('   Press Ctrl+C to gracefully shutdown');
}

export default LiveLoggingCoordinator;
export { LSLFileManager, EnhancedOperationalLogger, UserHashGenerator };