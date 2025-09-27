/**
 * ChangeDetector - Repository Change Detection for Embedding Reindexing
 * 
 * Implements heuristic-based repository change detection that triggers reindexing
 * when significant changes occur. Focuses on documentation files (*.md, README, CHANGELOG)
 * as primary indicators since developers typically update docs after major changes.
 * 
 * Requirements:
 * - 3.1: Trigger reindexing based on documentation changes, new major features, or structural refactoring
 * - 3.2: Use heuristic approach monitoring documentation files as primary triggers
 * - 3.3: Complete reindexing within 30 seconds when triggered
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class ChangeDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Repository monitoring
      repositoryPath: options.repositoryPath || process.cwd(),
      watchedPatterns: options.watchedPatterns || [
        '**/*.md',
        '**/README*',
        '**/CHANGELOG*',
        '**/CLAUDE.md',
        'package.json',
        'src/**/*.js',
        '.spec-workflow/**/*'
      ],
      
      // Heuristic thresholds
      significantChangeThreshold: options.significantChangeThreshold || 0.2, // 20% content change
      minFilesChanged: options.minFilesChanged || 2, // Minimum files changed to trigger
      docChangesWeight: options.docChangesWeight || 3, // Documentation changes have higher weight
      
      // Monitoring intervals
      scanInterval: options.scanInterval || 30000, // 30 seconds
      debounceDelay: options.debounceDelay || 5000, // 5 second debounce
      
      // Performance settings
      hashCacheSize: options.hashCacheSize || 1000, // Max files to track
      reindexTimeout: options.reindexTimeout || 30000, // 30 seconds max reindex time
      
      // Debug settings
      debug: options.debug || false
    };
    
    this.state = {
      isMonitoring: false,
      lastScanTime: null,
      fileHashes: new Map(),
      pendingChanges: new Set(),
      scanTimer: null,
      debounceTimer: null,
      reindexInProgress: false
    };
    
    this.stats = {
      totalScans: 0,
      totalChangesDetected: 0,
      totalReindexTriggered: 0,
      lastSignificantChange: null,
      averageScanTime: 0
    };
    
    // File patterns that indicate significant changes
    this.significantPatterns = [
      /README/i,
      /CLAUDE\.md/i,
      /CHANGELOG/i,
      /package\.json$/,
      /\.spec-workflow\//,
      /docs?\//,
      /src\/.*\.js$/
    ];
    
    // Initialize baseline if monitoring is enabled
    if (options.autoStart !== false) {
      this.initializeBaseline();
    }
  }
  
  /**
   * Initialize baseline file hashes for change detection
   */
  async initializeBaseline() {
    try {
      this.debug('Initializing change detection baseline...');
      const startTime = Date.now();
      
      const files = await this.scanRepositoryFiles();
      let processed = 0;
      
      for (const filePath of files) {
        try {
          const hash = await this.calculateFileHash(filePath);
          this.state.fileHashes.set(filePath, {
            hash,
            size: fs.statSync(filePath).size,
            lastModified: fs.statSync(filePath).mtime.getTime(),
            isSignificant: this.isSignificantFile(filePath)
          });
          processed++;
        } catch (error) {
          this.debug(`Failed to hash file ${filePath}: ${error.message}`);
        }
      }
      
      const initTime = Date.now() - startTime;
      this.debug(`Baseline initialized: ${processed} files processed in ${initTime}ms`);
      
      this.emit('baselineInitialized', {
        filesProcessed: processed,
        initializationTime: initTime,
        significantFiles: Array.from(this.state.fileHashes.values()).filter(f => f.isSignificant).length
      });
      
    } catch (error) {
      this.debug(`Baseline initialization failed: ${error.message}`);
      this.emit('initializationError', { error: error.message });
    }
  }
  
  /**
   * Start continuous change monitoring
   */
  startMonitoring() {
    if (this.state.isMonitoring) {
      this.debug('Change monitoring already active');
      return;
    }
    
    this.state.isMonitoring = true;
    this.state.scanTimer = setInterval(() => {
      this.performChangeDetection();
    }, this.config.scanInterval);
    
    this.debug(`Change monitoring started (interval: ${this.config.scanInterval}ms)`);
    this.emit('monitoringStarted');
  }
  
  /**
   * Stop continuous change monitoring
   */
  stopMonitoring() {
    if (!this.state.isMonitoring) {
      return;
    }
    
    this.state.isMonitoring = false;
    
    if (this.state.scanTimer) {
      clearInterval(this.state.scanTimer);
      this.state.scanTimer = null;
    }
    
    if (this.state.debounceTimer) {
      clearTimeout(this.state.debounceTimer);
      this.state.debounceTimer = null;
    }
    
    this.debug('Change monitoring stopped');
    this.emit('monitoringStopped');
  }
  
  /**
   * Perform change detection scan
   */
  async performChangeDetection() {
    if (this.state.reindexInProgress) {
      this.debug('Skipping change detection - reindex in progress');
      return;
    }
    
    const scanStart = Date.now();
    this.state.lastScanTime = scanStart;
    this.stats.totalScans++;
    
    try {
      this.debug('Starting change detection scan...');
      
      const currentFiles = await this.scanRepositoryFiles();
      const changes = await this.detectChanges(currentFiles);
      
      const scanTime = Date.now() - scanStart;
      this.stats.averageScanTime = (this.stats.averageScanTime + scanTime) / 2;
      
      if (changes.length > 0) {
        this.debug(`Detected ${changes.length} changed files`);
        this.processChanges(changes);
      } else {
        this.debug('No changes detected');
      }
      
      this.emit('scanCompleted', {
        filesScanned: currentFiles.length,
        changesDetected: changes.length,
        scanTime
      });
      
    } catch (error) {
      this.debug(`Change detection scan failed: ${error.message}`);
      this.emit('scanError', { error: error.message });
    }
  }
  
  /**
   * Detect changes between current files and baseline
   */
  async detectChanges(currentFiles) {
    const changes = [];
    const processedFiles = new Set();
    
    // Check for new and modified files
    for (const filePath of currentFiles) {
      processedFiles.add(filePath);
      
      try {
        const stats = fs.statSync(filePath);
        const currentHash = await this.calculateFileHash(filePath);
        const baseline = this.state.fileHashes.get(filePath);
        
        if (!baseline) {
          // New file
          changes.push({
            type: 'added',
            filePath,
            isSignificant: this.isSignificantFile(filePath),
            size: stats.size
          });
          
          this.state.fileHashes.set(filePath, {
            hash: currentHash,
            size: stats.size,
            lastModified: stats.mtime.getTime(),
            isSignificant: this.isSignificantFile(filePath)
          });
          
        } else if (baseline.hash !== currentHash) {
          // Modified file
          const sizeChange = stats.size - baseline.size;
          const changeRatio = Math.abs(sizeChange) / Math.max(baseline.size, 1);
          
          changes.push({
            type: 'modified',
            filePath,
            isSignificant: baseline.isSignificant,
            sizeChange,
            changeRatio,
            oldSize: baseline.size,
            newSize: stats.size
          });
          
          // Update baseline
          baseline.hash = currentHash;
          baseline.size = stats.size;
          baseline.lastModified = stats.mtime.getTime();
        }
        
      } catch (error) {
        this.debug(`Error processing file ${filePath}: ${error.message}`);
      }
    }
    
    // Check for deleted files
    for (const [filePath, baseline] of this.state.fileHashes.entries()) {
      if (!processedFiles.has(filePath) && !fs.existsSync(filePath)) {
        changes.push({
          type: 'deleted',
          filePath,
          isSignificant: baseline.isSignificant,
          size: baseline.size
        });
        
        this.state.fileHashes.delete(filePath);
      }
    }
    
    return changes;
  }
  
  /**
   * Process detected changes and determine if reindexing is needed
   */
  processChanges(changes) {
    this.stats.totalChangesDetected += changes.length;
    
    // Calculate change significance score
    const score = this.calculateChangeSignificance(changes);
    const shouldReindex = this.shouldTriggerReindex(changes, score);
    
    this.debug(`Change significance score: ${score.toFixed(2)} (threshold: ${this.config.significantChangeThreshold})`);
    
    if (shouldReindex) {
      this.debug('Significant changes detected - scheduling reindex');
      this.scheduleReindex(changes, score);
    } else {
      this.debug('Changes below significance threshold - no reindex needed');
    }
    
    this.emit('changesProcessed', {
      changes,
      significanceScore: score,
      reindexTriggered: shouldReindex
    });
  }
  
  /**
   * Calculate significance score for detected changes
   */
  calculateChangeSignificance(changes) {
    let score = 0;
    let totalWeight = 0;
    
    for (const change of changes) {
      let weight = 1;
      
      // Weight based on file significance
      if (change.isSignificant) {
        weight *= this.config.docChangesWeight;
      }
      
      // Weight based on change type
      switch (change.type) {
        case 'added':
          score += 0.8 * weight;
          break;
        case 'deleted':
          score += 0.6 * weight;
          break;
        case 'modified':
          // Weight based on size of change
          const changeWeight = Math.min(change.changeRatio || 0.5, 1.0);
          score += changeWeight * weight;
          break;
      }
      
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? score / totalWeight : 0;
  }
  
  /**
   * Determine if changes should trigger reindexing
   */
  shouldTriggerReindex(changes, significanceScore) {
    // Check significance threshold
    if (significanceScore < this.config.significantChangeThreshold) {
      return false;
    }
    
    // Check minimum files changed
    if (changes.length < this.config.minFilesChanged) {
      return false;
    }
    
    // Check if any significant files changed
    const significantChanges = changes.filter(c => c.isSignificant);
    if (significantChanges.length === 0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Schedule reindexing with debouncing
   */
  scheduleReindex(changes, significanceScore) {
    // Clear existing debounce timer
    if (this.state.debounceTimer) {
      clearTimeout(this.state.debounceTimer);
    }
    
    // Add changes to pending set
    changes.forEach(change => {
      this.state.pendingChanges.add(change.filePath);
    });
    
    // Schedule debounced reindex
    this.state.debounceTimer = setTimeout(() => {
      this.triggerReindex(Array.from(this.state.pendingChanges), significanceScore);
      this.state.pendingChanges.clear();
    }, this.config.debounceDelay);
    
    this.debug(`Reindex scheduled in ${this.config.debounceDelay}ms (${this.state.pendingChanges.size} files pending)`);
  }
  
  /**
   * Trigger repository reindexing
   */
  async triggerReindex(changedFiles, significanceScore) {
    if (this.state.reindexInProgress) {
      this.debug('Reindex already in progress - skipping');
      return;
    }
    
    this.state.reindexInProgress = true;
    this.stats.totalReindexTriggered++;
    this.stats.lastSignificantChange = new Date();
    
    const startTime = Date.now();
    
    try {
      this.debug(`Triggering repository reindex (${changedFiles.length} files changed, score: ${significanceScore.toFixed(2)})`);
      
      this.emit('reindexTriggered', {
        changedFiles,
        significanceScore,
        triggerTime: new Date()
      });
      
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Reindex timeout')), this.config.reindexTimeout);
      });
      
      // Emit reindex request and wait for completion or timeout
      const reindexPromise = new Promise((resolve, reject) => {
        this.once('reindexCompleted', resolve);
        this.once('reindexFailed', reject);
        
        // External systems should listen for this event and call completeReindex()
        this.emit('reindexRequested', {
          changedFiles,
          significanceScore,
          requestTime: new Date()
        });
      });
      
      await Promise.race([reindexPromise, timeoutPromise]);
      
      const reindexTime = Date.now() - startTime;
      this.debug(`Repository reindex completed in ${reindexTime}ms`);
      
    } catch (error) {
      const reindexTime = Date.now() - startTime;
      this.debug(`Repository reindex failed after ${reindexTime}ms: ${error.message}`);
      
      this.emit('reindexFailed', {
        error: error.message,
        changedFiles,
        reindexTime
      });
    } finally {
      this.state.reindexInProgress = false;
    }
  }
  
  /**
   * Mark reindex as completed (called by external reindex handler)
   */
  completeReindex(results = {}) {
    this.emit('reindexCompleted', {
      ...results,
      completedAt: new Date()
    });
  }
  
  /**
   * Mark reindex as failed (called by external reindex handler)
   */
  failReindex(error) {
    this.emit('reindexFailed', {
      error: error.message || error,
      failedAt: new Date()
    });
  }
  
  /**
   * Scan repository for relevant files
   */
  async scanRepositoryFiles() {
    const files = [];
    
    const scanDirectory = (dirPath) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          // Skip hidden directories and node_modules
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              scanDirectory(fullPath);
            }
          } else if (entry.isFile()) {
            const relativePath = path.relative(this.config.repositoryPath, fullPath);
            
            // Check if file matches watched patterns
            if (this.matchesWatchedPatterns(relativePath)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        this.debug(`Error scanning directory ${dirPath}: ${error.message}`);
      }
    };
    
    scanDirectory(this.config.repositoryPath);
    return files;
  }
  
  /**
   * Check if file matches watched patterns
   */
  matchesWatchedPatterns(filePath) {
    return this.config.watchedPatterns.some(pattern => {
      // Simple glob pattern matching
      const regex = new RegExp(
        '^' + pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]') + '$'
      );
      return regex.test(filePath);
    });
  }
  
  /**
   * Check if file is considered significant for change detection
   */
  isSignificantFile(filePath) {
    return this.significantPatterns.some(pattern => pattern.test(filePath));
  }
  
  /**
   * Calculate file hash for change detection
   */
  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
  
  /**
   * Force immediate change detection
   */
  async forceChangeDetection() {
    this.debug('Forcing immediate change detection...');
    await this.performChangeDetection();
  }
  
  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      ...this.stats,
      state: {
        isMonitoring: this.state.isMonitoring,
        lastScanTime: this.state.lastScanTime,
        trackedFiles: this.state.fileHashes.size,
        pendingChanges: this.state.pendingChanges.size,
        reindexInProgress: this.state.reindexInProgress
      },
      config: {
        scanInterval: this.config.scanInterval,
        significantChangeThreshold: this.config.significantChangeThreshold,
        minFilesChanged: this.config.minFilesChanged,
        docChangesWeight: this.config.docChangesWeight
      }
    };
  }
  
  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.log(`[ChangeDetector] ${message}`);
    }
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.debug('Shutting down ChangeDetector...');
    this.stopMonitoring();
    
    // Clear all pending operations
    this.state.pendingChanges.clear();
    this.state.fileHashes.clear();
    
    this.emit('shutdown');
  }
}

module.exports = ChangeDetector;