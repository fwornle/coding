#!/usr/bin/env node

/**
 * Performance Monitor - Classification Performance Tracking and Alerting
 * 
 * Advanced performance monitoring for ReliableCodingClassifier with per-layer
 * tracking, performance degradation detection, and actionable alerting system.
 * 
 * Features:
 * - Per-layer performance tracking (Path, Semantic, Keyword)
 * - Real-time performance threshold monitoring
 * - Performance degradation alerts with root cause analysis
 * - Historical performance trending
 * - Zero-overhead monitoring design
 * - Integration with existing ReliableCodingClassifier stats
 * 
 * Performance Targets:
 * - PathAnalyzer: <1ms (critical path)
 * - SemanticAnalyzer: <10ms (when used)
 * - KeywordMatcher: <10ms (fallback)
 * - Overall classification: <15ms
 */

import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enableAlerts: true,
      enableTrending: true,
      enableLogging: true,
      alertThreshold: 0.8, // 80% of target before alert
      historyWindow: 100, // Keep last 100 measurements per layer
      trendingWindow: 20, // Trending analysis window
      logPath: options.logPath || null,
      ...options
    };
    
    // Performance targets (in milliseconds)
    this.targets = {
      pathAnalyzer: 1.0,      // <1ms critical target
      semanticAnalyzer: 10.0, // <10ms when used
      keywordMatcher: 10.0,   // <10ms fallback
      embeddingClassifier: 3.0, // <3ms embedding layer
      overall: 30.0,          // <30ms total pipeline
      initialization: 50.0,   // <50ms component init
      // Embedding-specific targets
      embeddingGeneration: 2.0, // <2ms for cached embeddings
      embeddingGenerationCold: 1000.0, // <1s for cold generation
      similaritySearch: 3.0,   // <3ms for Qdrant search
      repositoryIndexing: 300000.0, // <5 minutes initial index
      changeDetection: 5000.0, // <5s change detection
      indexUpdate: 30000.0,    // <30s incremental updates
      batchProcessing: 100.0   // <100ms per batch
    };
    
    // Performance tracking state
    this.metrics = {
      pathAnalyzer: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good' // good, warning, critical
      },
      semanticAnalyzer: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good'
      },
      keywordMatcher: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good'
      },
      embeddingClassifier: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good'
      },
      overall: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good'
      },
      // Embedding-specific metrics
      embeddingGeneration: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good',
        cacheHits: 0,
        cacheMisses: 0,
        batchOperations: 0
      },
      similaritySearch: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good',
        resultsReturned: 0,
        averageScore: 0
      },
      repositoryIndexing: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good',
        filesIndexed: 0,
        indexSize: 0,
        chunksCreated: 0
      },
      changeDetection: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good',
        changesDetected: 0,
        filesScanned: 0
      },
      indexUpdate: {
        measurements: [],
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        violations: 0,
        totalCalls: 0,
        recentPerformance: 'good',
        pointsUpdated: 0,
        pointsDeleted: 0
      }
    };
    
    // Alert tracking
    this.alerts = {
      active: new Map(),
      history: [],
      cooldownPeriod: 60000, // 1 minute cooldown between similar alerts
      maxHistorySize: 1000
    };
    
    // Performance trending
    this.trends = {
      pathAnalyzer: { slope: 0, correlation: 0, status: 'stable' },
      semanticAnalyzer: { slope: 0, correlation: 0, status: 'stable' },
      keywordMatcher: { slope: 0, correlation: 0, status: 'stable' },
      embeddingClassifier: { slope: 0, correlation: 0, status: 'stable' },
      overall: { slope: 0, correlation: 0, status: 'stable' },
      embeddingGeneration: { slope: 0, correlation: 0, status: 'stable' },
      similaritySearch: { slope: 0, correlation: 0, status: 'stable' },
      repositoryIndexing: { slope: 0, correlation: 0, status: 'stable' },
      changeDetection: { slope: 0, correlation: 0, status: 'stable' },
      indexUpdate: { slope: 0, correlation: 0, status: 'stable' }
    };
    
    // Monitoring overhead tracking
    this.monitoringOverhead = {
      measurements: [],
      avgTime: 0,
      maxTime: 0
    };
    
    // Embedding-specific performance state
    this.embeddingMetrics = {
      cacheEfficiency: {
        hitRate: 0,
        missRate: 0,
        totalRequests: 0
      },
      memoryUsage: {
        currentMB: 0,
        peakMB: 0,
        measurementCount: 0
      },
      qdrantMetrics: {
        connectionPool: 0,
        activeConnections: 0,
        queryQueue: 0
      },
      batchPerformance: {
        averageBatchSize: 0,
        totalBatches: 0,
        throughputPerSecond: 0
      }
    };
    
    this.log('PerformanceMonitor initialized with embedding targets:', this.targets);
  }

  /**
   * Record performance measurement for a specific layer
   * @param {string} layer - Layer name (pathAnalyzer, semanticAnalyzer, keywordMatcher, overall)
   * @param {number} duration - Duration in milliseconds
   * @param {object} context - Additional context for analysis
   */
  recordMeasurement(layer, duration, context = {}) {
    const startTime = process.hrtime.bigint();
    
    try {
      const metric = this.metrics[layer];
      if (!metric) {
        console.warn(`Unknown layer: ${layer}`);
        return;
      }
      
      // Update basic statistics
      metric.totalCalls++;
      metric.measurements.push({ 
        duration, 
        timestamp: Date.now(),
        context: { ...context }
      });
      
      // Maintain history window
      if (metric.measurements.length > this.options.historyWindow) {
        metric.measurements.shift();
      }
      
      // Update derived statistics
      this.updateMetricStats(layer, metric, duration);
      
      // Check performance thresholds
      this.checkPerformanceThresholds(layer, duration, context);
      
      // Update performance trends
      if (this.options.enableTrending && metric.measurements.length >= this.options.trendingWindow) {
        this.updatePerformanceTrends(layer);
      }
      
    } finally {
      // Track monitoring overhead
      const endTime = process.hrtime.bigint();
      const overhead = Number(endTime - startTime) / 1000000; // Convert to ms
      this.trackMonitoringOverhead(overhead);
    }
  }

  /**
   * Update metric statistics for a layer
   */
  updateMetricStats(layer, metric, duration) {
    // Update min/max
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);
    
    // Update running average (exponential moving average for recent bias)
    const alpha = 0.1; // Smoothing factor
    if (metric.avgTime === 0) {
      metric.avgTime = duration;
    } else {
      metric.avgTime = alpha * duration + (1 - alpha) * metric.avgTime;
    }
    
    // Check for target violations
    const target = this.targets[layer];
    if (target && duration > target) {
      metric.violations++;
    }
  }

  /**
   * Check performance thresholds and trigger alerts
   */
  checkPerformanceThresholds(layer, duration, context) {
    if (!this.options.enableAlerts) return;
    
    const target = this.targets[layer];
    const metric = this.metrics[layer];
    
    if (!target) return;
    
    const warningThreshold = target * this.options.alertThreshold;
    const criticalThreshold = target;
    
    let alertLevel = null;
    let alertMessage = null;
    
    if (duration > criticalThreshold) {
      alertLevel = 'critical';
      alertMessage = `${layer} exceeded critical threshold: ${duration.toFixed(2)}ms > ${criticalThreshold}ms`;
      metric.recentPerformance = 'critical';
    } else if (duration > warningThreshold) {
      alertLevel = 'warning';
      alertMessage = `${layer} approaching threshold: ${duration.toFixed(2)}ms > ${warningThreshold.toFixed(1)}ms`;
      metric.recentPerformance = 'warning';
    } else {
      metric.recentPerformance = 'good';
    }
    
    if (alertLevel && alertMessage) {
      this.triggerAlert(layer, alertLevel, alertMessage, {
        duration,
        target,
        avgTime: metric.avgTime,
        violationCount: metric.violations,
        context
      });
    }
  }

  /**
   * Trigger performance alert with cooldown management
   */
  triggerAlert(layer, level, message, details) {
    const alertKey = `${layer}-${level}`;
    const now = Date.now();
    
    // Check cooldown period
    if (this.alerts.active.has(alertKey)) {
      const lastAlert = this.alerts.active.get(alertKey);
      if (now - lastAlert.timestamp < this.alerts.cooldownPeriod) {
        return; // Still in cooldown
      }
    }
    
    const alert = {
      id: `perf-${now}-${Math.random().toString(36).substr(2, 6)}`,
      layer,
      level,
      message,
      details,
      timestamp: now,
      resolved: false
    };
    
    // Update active alerts
    this.alerts.active.set(alertKey, alert);
    
    // Add to history
    this.alerts.history.push(alert);
    if (this.alerts.history.length > this.alerts.maxHistorySize) {
      this.alerts.history.shift();
    }
    
    // Emit alert event
    this.emit('alert', alert);
    
    // Log alert
    this.log(`PERFORMANCE ALERT [${level.toUpperCase()}]: ${message}`, details);
    
    // Generate actionable recommendations
    const recommendations = this.generateRecommendations(layer, level, details);
    if (recommendations.length > 0) {
      this.log(`Recommendations: ${recommendations.join('; ')}`);
    }
  }

  /**
   * Generate actionable performance recommendations
   */
  generateRecommendations(layer, level, details) {
    const recommendations = [];
    
    switch (layer) {
      case 'pathAnalyzer':
        if (details.duration > 2) {
          recommendations.push('PathAnalyzer taking >2ms - check file system performance');
        }
        if (details.violationCount > 10) {
          recommendations.push('Frequent PathAnalyzer violations - consider caching file patterns');
        }
        break;
        
      case 'semanticAnalyzer':
        if (details.duration > 20) {
          recommendations.push('SemanticAnalyzer >20ms - check LLM API latency');
        }
        if (details.context?.cacheHit === false) {
          recommendations.push('Consider expanding semantic analysis caching');
        }
        break;
        
      case 'keywordMatcher':
        if (details.duration > 5) {
          recommendations.push('KeywordMatcher >5ms - optimize regex patterns');
        }
        break;
        
      case 'overall':
        if (details.duration > 30) {
          recommendations.push('Overall classification >30ms - investigate layer cascade delays');
        }
        break;
    }
    
    // General recommendations based on trends
    const trend = this.trends[layer];
    if (trend?.status === 'degrading') {
      recommendations.push('Performance degrading over time - investigate memory leaks or resource contention');
    }
    
    return recommendations;
  }

  /**
   * Update performance trends using linear regression
   */
  updatePerformanceTrends(layer) {
    const measurements = this.metrics[layer].measurements.slice(-this.options.trendingWindow);
    if (measurements.length < this.options.trendingWindow) return;
    
    // Simple linear regression on recent measurements
    const n = measurements.length;
    const xValues = measurements.map((_, i) => i);
    const yValues = measurements.map(m => m.duration);
    
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate correlation coefficient
    const yMean = sumY / n;
    const ssRes = yValues.reduce((sum, y, i) => sum + Math.pow(y - (slope * i + intercept), 2), 0);
    const ssTot = yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const correlation = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
    
    // Determine trend status
    let status = 'stable';
    if (Math.abs(slope) > 0.1 && correlation > 0.3) {
      status = slope > 0 ? 'degrading' : 'improving';
    }
    
    this.trends[layer] = { slope, correlation, status };
  }

  /**
   * Track monitoring overhead to ensure zero-impact monitoring
   */
  trackMonitoringOverhead(overhead) {
    this.monitoringOverhead.measurements.push(overhead);
    
    // Keep last 1000 measurements
    if (this.monitoringOverhead.measurements.length > 1000) {
      this.monitoringOverhead.measurements.shift();
    }
    
    // Update statistics
    const measurements = this.monitoringOverhead.measurements;
    this.monitoringOverhead.avgTime = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    this.monitoringOverhead.maxTime = Math.max(...measurements);
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport() {
    const report = {
      timestamp: new Date().toISOString(),
      targets: this.targets,
      metrics: {},
      trends: this.trends,
      alerts: {
        active: Object.fromEntries(this.alerts.active),
        recentCount: this.alerts.history.filter(a => Date.now() - a.timestamp < 3600000).length
      },
      monitoring: {
        overhead: this.monitoringOverhead,
        impactPercent: this.calculateMonitoringImpact()
      }
    };
    
    // Process metrics for report
    Object.keys(this.metrics).forEach(layer => {
      const metric = this.metrics[layer];
      const target = this.targets[layer];
      
      report.metrics[layer] = {
        avgTime: Number(metric.avgTime.toFixed(3)),
        minTime: metric.minTime === Infinity ? 0 : Number(metric.minTime.toFixed(3)),
        maxTime: Number(metric.maxTime.toFixed(3)),
        totalCalls: metric.totalCalls,
        violations: metric.violations,
        violationRate: metric.totalCalls > 0 ? (metric.violations / metric.totalCalls * 100).toFixed(1) : 0,
        targetCompliance: target ? ((1 - metric.violations / Math.max(metric.totalCalls, 1)) * 100).toFixed(1) : 'N/A',
        recentPerformance: metric.recentPerformance,
        trend: this.trends[layer]?.status || 'unknown'
      };
    });
    
    return report;
  }

  /**
   * Calculate monitoring system impact
   */
  calculateMonitoringImpact() {
    if (this.monitoringOverhead.measurements.length === 0) return 0;
    
    const avgOverhead = this.monitoringOverhead.avgTime;
    const avgClassificationTime = this.metrics.overall.avgTime || 10; // Default estimate
    
    return ((avgOverhead / avgClassificationTime) * 100).toFixed(2);
  }

  /**
   * Reset performance metrics (useful for testing)
   */
  resetMetrics(layer = null) {
    const resetMetric = (metric) => {
      metric.measurements = [];
      metric.avgTime = 0;
      metric.minTime = Infinity;
      metric.maxTime = 0;
      metric.violations = 0;
      metric.totalCalls = 0;
      metric.recentPerformance = 'good';
    };
    
    if (layer && this.metrics[layer]) {
      resetMetric(this.metrics[layer]);
      this.trends[layer] = { slope: 0, correlation: 0, status: 'stable' };
    } else {
      Object.values(this.metrics).forEach(resetMetric);
      Object.keys(this.trends).forEach(layer => {
        this.trends[layer] = { slope: 0, correlation: 0, status: 'stable' };
      });
    }
    
    this.alerts.active.clear();
    this.alerts.history = [];
    this.log('Performance metrics reset');
  }

  /**
   * Export performance data for analysis
   */
  exportData(format = 'json') {
    const data = {
      exportTime: new Date().toISOString(),
      targets: this.targets,
      metrics: this.metrics,
      trends: this.trends,
      alerts: {
        active: Array.from(this.alerts.active.values()),
        history: this.alerts.history.slice(-100) // Last 100 alerts
      },
      monitoring: this.monitoringOverhead
    };
    
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'csv':
        return this.convertToCSV(data);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Convert performance data to CSV format
   */
  convertToCSV(data) {
    const lines = [];
    lines.push('layer,timestamp,duration,target,violation');
    
    Object.keys(data.metrics).forEach(layer => {
      const measurements = data.metrics[layer].measurements || [];
      const target = data.targets[layer] || 0;
      
      measurements.forEach(measurement => {
        lines.push([
          layer,
          new Date(measurement.timestamp).toISOString(),
          measurement.duration,
          target,
          measurement.duration > target ? 'true' : 'false'
        ].join(','));
      });
    });
    
    return lines.join('\n');
  }

  /**
   * Resolve active alert
   */
  resolveAlert(alertId) {
    const alert = this.alerts.history.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      
      // Remove from active if present
      for (const [key, activeAlert] of this.alerts.active) {
        if (activeAlert.id === alertId) {
          this.alerts.active.delete(key);
          break;
        }
      }
      
      this.log(`Alert resolved: ${alertId}`);
      this.emit('alertResolved', alert);
    }
  }

  /**
   * Debug logging
   */
  log(message, data = null) {
    if (this.options.enableLogging) {
      const logMessage = `[PerformanceMonitor] ${message}`;
      console.log(logMessage);
      
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
      
      // Write to log file if configured
      if (this.options.logPath) {
        const logEntry = {
          timestamp: new Date().toISOString(),
          message,
          data
        };
        
        try {
          fs.appendFileSync(this.options.logPath, JSON.stringify(logEntry) + '\n');
        } catch (error) {
          console.warn('Failed to write to log file:', error.message);
        }
      }
    }
  }

  /**
   * Health check for monitoring system
   */
  healthCheck() {
    const health = {
      status: 'healthy',
      issues: [],
      recommendations: []
    };
    
    // Check monitoring overhead
    const impactPercent = parseFloat(this.calculateMonitoringImpact());
    if (impactPercent > 5) {
      health.issues.push(`High monitoring overhead: ${impactPercent}%`);
      health.recommendations.push('Consider reducing measurement frequency');
      health.status = 'warning';
    }
    
    // Check for persistent alerts
    const persistentAlerts = this.alerts.history.filter(a => 
      !a.resolved && Date.now() - a.timestamp > 300000 // 5 minutes
    );
    
    if (persistentAlerts.length > 0) {
      health.issues.push(`${persistentAlerts.length} unresolved performance alerts`);
      health.recommendations.push('Investigate persistent performance issues');
      health.status = 'warning';
    }
    
    // Check for degrading trends
    const degradingLayers = Object.keys(this.trends).filter(layer => 
      this.trends[layer].status === 'degrading'
    );
    
    if (degradingLayers.length > 0) {
      health.issues.push(`Performance degrading in: ${degradingLayers.join(', ')}`);
      health.recommendations.push('Monitor resource usage and optimize hot paths');
      health.status = 'warning';
    }
    
    return health;
  }

  /**
   * Get metrics summary for all layers
   * @returns {object} Metrics summary
   */
  getMetricsSummary() {
    const summary = {};
    
    for (const [layer, metric] of Object.entries(this.metrics)) {
      summary[layer] = {
        totalCalls: metric.totalCalls,
        avgTime: metric.avgTime,
        minTime: metric.minTime === Infinity ? 0 : metric.minTime,
        maxTime: metric.maxTime,
        violations: metric.violations,
        recentPerformance: metric.recentPerformance,
        target: this.targets[layer] || null
      };
    }
    
    return summary;
  }

  /**
   * Record embedding generation performance
   * @param {number} duration - Generation time in milliseconds
   * @param {boolean} cacheHit - Whether this was a cache hit
   * @param {number} batchSize - Size of batch if applicable
   */
  recordEmbeddingGeneration(duration, cacheHit = false, batchSize = 1) {
    const layer = 'embeddingGeneration';
    const metric = this.metrics[layer];
    
    // Record basic measurement
    this.recordMeasurement(layer, duration, { cacheHit, batchSize });
    
    // Update embedding-specific metrics
    if (cacheHit) {
      metric.cacheHits++;
    } else {
      metric.cacheMisses++;
    }
    
    if (batchSize > 1) {
      metric.batchOperations++;
    }
    
    // Update cache efficiency
    this.updateCacheEfficiency();
    
    // Update batch performance if applicable
    if (batchSize > 1) {
      this.updateBatchPerformance(batchSize, duration);
    }
  }

  /**
   * Record similarity search performance
   * @param {number} duration - Search time in milliseconds
   * @param {number} resultsCount - Number of results returned
   * @param {number} topScore - Highest similarity score
   */
  recordSimilaritySearch(duration, resultsCount = 0, topScore = 0) {
    const layer = 'similaritySearch';
    const metric = this.metrics[layer];
    
    this.recordMeasurement(layer, duration, { resultsCount, topScore });
    
    // Update similarity-specific metrics
    metric.resultsReturned += resultsCount;
    
    // Update average score (exponential moving average)
    const alpha = 0.1;
    if (metric.averageScore === 0) {
      metric.averageScore = topScore;
    } else {
      metric.averageScore = alpha * topScore + (1 - alpha) * metric.averageScore;
    }
  }

  /**
   * Record repository indexing performance
   * @param {number} duration - Indexing time in milliseconds
   * @param {number} filesCount - Number of files indexed
   * @param {number} chunksCount - Number of chunks created
   * @param {number} indexSize - Size of index in bytes
   */
  recordRepositoryIndexing(duration, filesCount = 0, chunksCount = 0, indexSize = 0) {
    const layer = 'repositoryIndexing';
    const metric = this.metrics[layer];
    
    this.recordMeasurement(layer, duration, { filesCount, chunksCount, indexSize });
    
    // Update indexing-specific metrics
    metric.filesIndexed += filesCount;
    metric.chunksCreated += chunksCount;
    metric.indexSize = indexSize; // Current size, not cumulative
  }

  /**
   * Record change detection performance
   * @param {number} duration - Detection time in milliseconds
   * @param {number} filesScanned - Number of files scanned
   * @param {number} changesFound - Number of changes detected
   */
  recordChangeDetection(duration, filesScanned = 0, changesFound = 0) {
    const layer = 'changeDetection';
    const metric = this.metrics[layer];
    
    this.recordMeasurement(layer, duration, { filesScanned, changesFound });
    
    // Update change detection metrics
    metric.filesScanned += filesScanned;
    metric.changesDetected += changesFound;
  }

  /**
   * Record index update performance
   * @param {number} duration - Update time in milliseconds
   * @param {number} pointsUpdated - Number of points updated
   * @param {number} pointsDeleted - Number of points deleted
   */
  recordIndexUpdate(duration, pointsUpdated = 0, pointsDeleted = 0) {
    const layer = 'indexUpdate';
    const metric = this.metrics[layer];
    
    this.recordMeasurement(layer, duration, { pointsUpdated, pointsDeleted });
    
    // Update index update metrics
    metric.pointsUpdated += pointsUpdated;
    metric.pointsDeleted += pointsDeleted;
  }

  /**
   * Update cache efficiency metrics
   */
  updateCacheEfficiency() {
    const metric = this.metrics.embeddingGeneration;
    const totalRequests = metric.cacheHits + metric.cacheMisses;
    
    if (totalRequests > 0) {
      this.embeddingMetrics.cacheEfficiency = {
        hitRate: (metric.cacheHits / totalRequests * 100).toFixed(1),
        missRate: (metric.cacheMisses / totalRequests * 100).toFixed(1),
        totalRequests: totalRequests
      };
    }
  }

  /**
   * Update batch performance metrics
   * @param {number} batchSize - Size of the batch
   * @param {number} duration - Time taken for batch
   */
  updateBatchPerformance(batchSize, duration) {
    const batchMetrics = this.embeddingMetrics.batchPerformance;
    
    batchMetrics.totalBatches++;
    
    // Update average batch size (exponential moving average)
    const alpha = 0.1;
    if (batchMetrics.averageBatchSize === 0) {
      batchMetrics.averageBatchSize = batchSize;
    } else {
      batchMetrics.averageBatchSize = alpha * batchSize + (1 - alpha) * batchMetrics.averageBatchSize;
    }
    
    // Calculate throughput (items per second)
    const throughput = batchSize / (duration / 1000);
    if (batchMetrics.throughputPerSecond === 0) {
      batchMetrics.throughputPerSecond = throughput;
    } else {
      batchMetrics.throughputPerSecond = alpha * throughput + (1 - alpha) * batchMetrics.throughputPerSecond;
    }
  }

  /**
   * Record memory usage for embedding operations
   * @param {number} memoryMB - Current memory usage in MB
   */
  recordMemoryUsage(memoryMB) {
    const memoryMetrics = this.embeddingMetrics.memoryUsage;
    
    memoryMetrics.currentMB = memoryMB;
    memoryMetrics.peakMB = Math.max(memoryMetrics.peakMB, memoryMB);
    memoryMetrics.measurementCount++;
    
    // Alert if memory usage is too high
    if (memoryMB > 500) { // 500MB threshold
      this.triggerAlert('embedding', 'warning', `High memory usage: ${memoryMB}MB`, {
        currentMB: memoryMB,
        peakMB: memoryMetrics.peakMB,
        threshold: 500
      });
    }
  }

  /**
   * Record Qdrant connection metrics
   * @param {number} activeConnections - Number of active connections
   * @param {number} queueSize - Size of query queue
   */
  recordQdrantMetrics(activeConnections, queueSize) {
    this.embeddingMetrics.qdrantMetrics = {
      activeConnections,
      queryQueue: queueSize,
      timestamp: Date.now()
    };
    
    // Alert if queue is backing up
    if (queueSize > 10) {
      this.triggerAlert('qdrant', 'warning', `Qdrant queue backing up: ${queueSize} queries`, {
        queueSize,
        activeConnections
      });
    }
  }

  /**
   * Get embedding-specific performance metrics
   * @returns {object} Embedding metrics summary
   */
  getEmbeddingMetrics() {
    const embeddingLayers = [
      'embeddingGeneration', 'similaritySearch', 'repositoryIndexing',
      'changeDetection', 'indexUpdate', 'embeddingClassifier'
    ];
    
    const metrics = {};
    
    embeddingLayers.forEach(layer => {
      const metric = this.metrics[layer];
      if (metric) {
        metrics[layer] = {
          avgTime: Number(metric.avgTime.toFixed(3)),
          totalCalls: metric.totalCalls,
          violations: metric.violations,
          recentPerformance: metric.recentPerformance,
          target: this.targets[layer]
        };
        
        // Add layer-specific metrics
        if (layer === 'embeddingGeneration') {
          metrics[layer].cacheHitRate = this.embeddingMetrics.cacheEfficiency.hitRate;
          metrics[layer].batchOperations = metric.batchOperations;
        } else if (layer === 'similaritySearch') {
          metrics[layer].averageScore = Number(metric.averageScore.toFixed(3));
          metrics[layer].resultsReturned = metric.resultsReturned;
        } else if (layer === 'repositoryIndexing') {
          metrics[layer].filesIndexed = metric.filesIndexed;
          metrics[layer].chunksCreated = metric.chunksCreated;
          metrics[layer].indexSizeMB = (metric.indexSize / 1024 / 1024).toFixed(2);
        } else if (layer === 'changeDetection') {
          metrics[layer].changesDetected = metric.changesDetected;
          metrics[layer].filesScanned = metric.filesScanned;
        } else if (layer === 'indexUpdate') {
          metrics[layer].pointsUpdated = metric.pointsUpdated;
          metrics[layer].pointsDeleted = metric.pointsDeleted;
        }
      }
    });
    
    return {
      layers: metrics,
      cacheEfficiency: this.embeddingMetrics.cacheEfficiency,
      memoryUsage: this.embeddingMetrics.memoryUsage,
      qdrantMetrics: this.embeddingMetrics.qdrantMetrics,
      batchPerformance: this.embeddingMetrics.batchPerformance
    };
  }

  /**
   * Check embedding system health
   * @returns {object} Health status for embedding components
   */
  checkEmbeddingHealth() {
    const health = {
      status: 'healthy',
      issues: [],
      recommendations: []
    };
    
    // Check cache efficiency
    const cacheHitRate = parseFloat(this.embeddingMetrics.cacheEfficiency.hitRate);
    if (cacheHitRate < 30 && this.embeddingMetrics.cacheEfficiency.totalRequests > 50) {
      health.issues.push(`Low cache hit rate: ${cacheHitRate}%`);
      health.recommendations.push('Optimize caching strategy or increase cache size');
      health.status = 'warning';
    }
    
    // Check memory usage
    const memoryMB = this.embeddingMetrics.memoryUsage.currentMB;
    if (memoryMB > 400) {
      health.issues.push(`High memory usage: ${memoryMB}MB`);
      health.recommendations.push('Monitor for memory leaks or reduce batch sizes');
      health.status = 'warning';
    }
    
    // Check Qdrant queue
    const queueSize = this.embeddingMetrics.qdrantMetrics.queryQueue;
    if (queueSize > 5) {
      health.issues.push(`Qdrant query queue backing up: ${queueSize}`);
      health.recommendations.push('Increase connection pool or optimize queries');
      health.status = 'warning';
    }
    
    // Check performance violations
    const embeddingMetric = this.metrics.embeddingClassifier;
    if (embeddingMetric && embeddingMetric.violations > 10) {
      health.issues.push(`Frequent embedding classification violations: ${embeddingMetric.violations}`);
      health.recommendations.push('Optimize embedding search or increase performance targets');
      health.status = 'warning';
    }
    
    // Check batch performance
    const throughput = this.embeddingMetrics.batchPerformance.throughputPerSecond;
    if (throughput < 10 && this.embeddingMetrics.batchPerformance.totalBatches > 5) {
      health.issues.push(`Low batch throughput: ${throughput.toFixed(1)} items/sec`);
      health.recommendations.push('Optimize batch processing or increase batch sizes');
      health.status = 'warning';
    }
    
    return health;
  }
}

// Convenience method for integration with ReliableCodingClassifier
PerformanceMonitor.integrateWithClassifier = function(classifier, monitorOptions = {}) {
  const monitor = new PerformanceMonitor(monitorOptions);
  
  // Wrap the classify method to add performance monitoring
  const originalClassify = classifier.classify.bind(classifier);
  classifier.classify = async function(content, options = {}) {
    const startTime = Date.now();
    
    try {
      const result = await originalClassify(content, options);
      
      const totalTime = Date.now() - startTime;
      monitor.recordMeasurement('overall', totalTime, {
        contentLength: content?.length || 0,
        classification: result?.classification,
        layer: result?.metadata?.layer
      });
      
      return result;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      monitor.recordMeasurement('overall', totalTime, {
        contentLength: content?.length || 0,
        error: error.message
      });
      throw error;
    }
  };
  
  // Add monitor to classifier for access to monitoring methods
  classifier.performanceMonitor = monitor;
  
  return monitor;
};

export default PerformanceMonitor;