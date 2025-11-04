#!/usr/bin/env node

/**
 * LSL File Manager
 * 
 * Provides advanced file size monitoring, rotation, and compression management
 * for Live Session Logging files. Ensures efficient storage management as the
 * system scales across multiple projects and extended usage periods.
 */

import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';

class LSLFileManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // File size limits (in bytes)
      maxFileSize: options.maxFileSize || (50 * 1024 * 1024), // 50MB default
      rotationThreshold: options.rotationThreshold || (40 * 1024 * 1024), // 40MB rotation trigger
      
      // Compression settings
      enableCompression: options.enableCompression !== false, // Default enabled
      compressionLevel: options.compressionLevel || 6, // Balanced compression
      keepOriginalAfterCompression: options.keepOriginalAfterCompression || false,
      
      // Retention settings
      maxArchivedFiles: options.maxArchivedFiles || 50, // Keep up to 50 archived files
      archiveDirectory: options.archiveDirectory || '.specstory/archive',
      
      // Monitoring settings
      monitoringInterval: options.monitoringInterval || (5 * 60 * 1000), // 5 minutes
      enableRealTimeMonitoring: options.enableRealTimeMonitoring !== false,
      
      // Performance settings
      bufferSize: options.bufferSize || (64 * 1024), // 64KB buffer for file operations
      
      // Debug settings
      debug: options.debug || false
    };
    
    this.stats = {
      totalRotations: 0,
      totalCompressions: 0,
      bytesCompressed: 0,
      compressionRatio: 0,
      lastRotation: null,
      lastCompression: null
    };
    
    this.monitoringTimer = null;
    this.watchedFiles = new Map(); // file path -> stats
    
    if (this.config.enableRealTimeMonitoring) {
      this.startMonitoring();
    }
  }
  
  /**
   * Start real-time file size monitoring
   */
  startMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }
    
    this.monitoringTimer = setInterval(() => {
      this.checkAllWatchedFiles();
    }, this.config.monitoringInterval);
    
    this.debug('File size monitoring started');
    this.emit('monitoringStarted');
  }
  
  /**
   * Stop real-time file size monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    this.debug('File size monitoring stopped');
    this.emit('monitoringStopped');
  }
  
  /**
   * Add a file to size monitoring
   */
  watchFile(filePath, metadata = {}) {
    const absolutePath = path.resolve(filePath);
    
    // Get initial file stats
    let initialStats = null;
    try {
      if (fs.existsSync(absolutePath)) {
        const stats = fs.statSync(absolutePath);
        initialStats = {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          isFile: stats.isFile()
        };
      }
    } catch (error) {
      this.debug(`Failed to get initial stats for ${filePath}: ${error.message}`);
    }
    
    this.watchedFiles.set(absolutePath, {
      filePath: absolutePath,
      metadata,
      initialStats,
      lastCheckedSize: initialStats?.size || 0,
      rotationCount: 0,
      compressionCount: 0,
      addedAt: new Date()
    });
    
    this.debug(`Now watching file: ${filePath} (${this.watchedFiles.size} total watched files)`);
    this.emit('fileWatched', { filePath: absolutePath, metadata });
    
    return absolutePath;
  }
  
  /**
   * Remove a file from monitoring
   */
  unwatchFile(filePath) {
    const absolutePath = path.resolve(filePath);
    const removed = this.watchedFiles.delete(absolutePath);
    
    if (removed) {
      this.debug(`Stopped watching file: ${filePath}`);
      this.emit('fileUnwatched', { filePath: absolutePath });
    }
    
    return removed;
  }
  
  /**
   * Check all watched files for rotation needs
   */
  async checkAllWatchedFiles() {
    for (const [filePath, fileInfo] of this.watchedFiles.entries()) {
      try {
        await this.checkFileRotation(filePath, fileInfo);
      } catch (error) {
        this.debug(`Error checking file ${filePath}: ${error.message}`);
        this.emit('rotationError', { filePath, error: error.message });
      }
    }
  }
  
  /**
   * Check if a specific file needs rotation
   */
  async checkFileRotation(filePath, fileInfo = null) {
    if (!fs.existsSync(filePath)) {
      return { needsRotation: false, reason: 'File does not exist' };
    }
    
    const stats = fs.statSync(filePath);
    const currentSize = stats.size;
    
    // Update file info if provided
    if (fileInfo) {
      fileInfo.lastCheckedSize = currentSize;
    }
    
    const needsRotation = currentSize >= this.config.rotationThreshold;
    
    if (needsRotation) {
      this.debug(`File ${path.basename(filePath)} needs rotation: ${this.formatBytes(currentSize)} >= ${this.formatBytes(this.config.rotationThreshold)}`);
      
      const rotationResult = await this.rotateFile(filePath);
      return { needsRotation: true, rotationResult, currentSize };
    }
    
    return { needsRotation: false, currentSize, threshold: this.config.rotationThreshold };
  }
  
  /**
   * Rotate a file when it exceeds the size threshold
   */
  async rotateFile(filePath) {
    const startTime = Date.now();
    const originalSize = fs.statSync(filePath).size;
    
    try {
      // Create archive directory if it doesn't exist
      const archiveDir = this.getArchiveDirectory(filePath);
      this.ensureDirectoryExists(archiveDir);
      
      // Extract session info from filename (e.g., 2025-09-28_0900-1000_g9b30a.md)
      const fileName = path.basename(filePath, path.extname(filePath));
      const fileExt = path.extname(filePath);
      
      // For session files, use session name without timestamp to consolidate
      // This prevents multiple archives for the same session
      let archiveFileName;
      if (fileName.match(/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_\w+$/)) {
        // Session file pattern - use base session name for archiving
        archiveFileName = `${fileName}${fileExt}`;
      } else {
        // Non-session files - use timestamp as before
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        archiveFileName = `${fileName}-${timestamp}${fileExt}`;
      }
      
      const archivePath = path.join(archiveDir, archiveFileName);
      
      // If archive already exists, append content instead of creating new file
      if (fs.existsSync(archivePath)) {
        // Append current file content to existing archive
        const currentContent = fs.readFileSync(filePath, 'utf8');
        const appendContent = `\n\n--- ROTATION ${new Date().toISOString()} ---\n${currentContent}`;
        fs.appendFileSync(archivePath, appendContent);
        
        // Remove the current file since content was appended
        fs.unlinkSync(filePath);
        
        this.debug(`File content appended to existing archive: ${archiveFileName}`);
      } else {
        // Move current file to archive location (first rotation)
        fs.renameSync(filePath, archivePath);
        this.debug(`File rotated to new archive: ${archiveFileName}`);
      }
      
      // Update stats
      this.stats.totalRotations++;
      this.stats.lastRotation = new Date();
      
      const rotationTime = Date.now() - startTime;
      
      this.emit('fileRotated', {
        originalPath: filePath,
        rotatedPath: archivePath,
        originalSize,
        rotationTime,
        wasAppended: fs.existsSync(archivePath)
      });
      
      // Compress the archive file if compression is enabled
      let compressionResult = null;
      if (this.config.enableCompression) {
        compressionResult = await this.compressFile(archivePath);
      }
      
      // Clean up old archived files if needed
      await this.cleanupOldArchives(archiveDir);
      
      return {
        success: true,
        rotatedPath: archivePath,
        compressionResult,
        originalSize,
        rotationTime
      };
      
    } catch (error) {
      this.debug(`File rotation failed for ${filePath}: ${error.message}`);
      this.emit('rotationError', { filePath, error: error.message });
      
      return {
        success: false,
        error: error.message,
        originalSize
      };
    }
  }
  
  /**
   * Compress a file using gzip
   */
  async compressFile(filePath) {
    const startTime = Date.now();
    const originalSize = fs.statSync(filePath).size;
    
    try {
      const compressedPath = `${filePath}.gz`;
      
      // Create compression pipeline
      const readStream = fs.createReadStream(filePath, { 
        highWaterMark: this.config.bufferSize 
      });
      const gzipStream = createGzip({ 
        level: this.config.compressionLevel,
        chunkSize: this.config.bufferSize
      });
      const writeStream = fs.createWriteStream(compressedPath);
      
      // Execute compression pipeline
      await pipeline(readStream, gzipStream, writeStream);
      
      const compressedSize = fs.statSync(compressedPath).size;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100);
      const compressionTime = Date.now() - startTime;
      
      // Update stats
      this.stats.totalCompressions++;
      this.stats.bytesCompressed += originalSize;
      this.stats.compressionRatio = (this.stats.compressionRatio + compressionRatio) / 2; // Running average
      this.stats.lastCompression = new Date();
      
      // Remove original file if configured to do so
      if (!this.config.keepOriginalAfterCompression) {
        fs.unlinkSync(filePath);
        this.debug(`Original file deleted after compression: ${path.basename(filePath)}`);
      }
      
      this.debug(`File compressed: ${path.basename(filePath)} -> ${path.basename(compressedPath)}`);
      this.debug(`Compression: ${this.formatBytes(originalSize)} -> ${this.formatBytes(compressedSize)} (${compressionRatio.toFixed(1)}% reduction, ${compressionTime}ms)`);
      
      this.emit('fileCompressed', {
        originalPath: filePath,
        compressedPath,
        originalSize,
        compressedSize,
        compressionRatio,
        compressionTime,
        originalKept: this.config.keepOriginalAfterCompression
      });
      
      return {
        success: true,
        compressedPath,
        originalSize,
        compressedSize,
        compressionRatio,
        compressionTime
      };
      
    } catch (error) {
      this.debug(`File compression failed for ${filePath}: ${error.message}`);
      this.emit('compressionError', { filePath, error: error.message });
      
      return {
        success: false,
        error: error.message,
        originalSize
      };
    }
  }
  
  /**
   * Clean up old archived files to maintain retention limits
   */
  async cleanupOldArchives(archiveDir) {
    try {
      if (!fs.existsSync(archiveDir)) {
        return { cleaned: 0, reason: 'Archive directory does not exist' };
      }
      
      const files = fs.readdirSync(archiveDir)
        .map(fileName => ({
          name: fileName,
          path: path.join(archiveDir, fileName),
          stats: fs.statSync(path.join(archiveDir, fileName))
        }))
        .filter(file => file.stats.isFile())
        .sort((a, b) => b.stats.mtime - a.stats.mtime); // Newest first
      
      const filesToDelete = files.slice(this.config.maxArchivedFiles);
      
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          this.debug(`Deleted old archive: ${file.name}`);
        } catch (error) {
          this.debug(`Failed to delete old archive ${file.name}: ${error.message}`);
        }
      }
      
      if (filesToDelete.length > 0) {
        this.emit('archiveCleaned', {
          archiveDir,
          filesDeleted: filesToDelete.length,
          filesKept: files.length - filesToDelete.length
        });
      }
      
      return { cleaned: filesToDelete.length, total: files.length };
      
    } catch (error) {
      this.debug(`Archive cleanup failed for ${archiveDir}: ${error.message}`);
      return { cleaned: 0, error: error.message };
    }
  }
  
  /**
   * Get archive directory for a given file
   */
  getArchiveDirectory(filePath) {
    const fileDir = path.dirname(filePath);
    
    // If file is already in a .specstory directory, use its archive subdirectory
    if (fileDir.includes('.specstory')) {
      const specstoryRoot = fileDir.substring(0, fileDir.indexOf('.specstory') + '.specstory'.length);
      return path.join(specstoryRoot, 'archive');
    }
    
    // Otherwise, create archive directory alongside the file
    return path.join(fileDir, this.config.archiveDirectory);
  }
  
  /**
   * Ensure directory exists, creating it if necessary
   */
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      this.debug(`Created directory: ${dirPath}`);
    }
  }
  
  /**
   * Get comprehensive file management statistics
   */
  getStats() {
    const watchedFileStats = Array.from(this.watchedFiles.entries()).map(([filePath, info]) => {
      let currentSize = 0;
      let exists = false;
      
      try {
        if (fs.existsSync(filePath)) {
          currentSize = fs.statSync(filePath).size;
          exists = true;
        }
      } catch (error) {
        // File might be inaccessible
      }
      
      return {
        filePath,
        currentSize,
        exists,
        rotationCount: info.rotationCount || 0,
        compressionCount: info.compressionCount || 0,
        watchedSince: info.addedAt
      };
    });
    
    const totalWatchedSize = watchedFileStats
      .filter(f => f.exists)
      .reduce((sum, f) => sum + f.currentSize, 0);
    
    return {
      ...this.stats,
      watchedFiles: {
        count: this.watchedFiles.size,
        totalSize: totalWatchedSize,
        files: watchedFileStats
      },
      configuration: {
        maxFileSize: this.config.maxFileSize,
        rotationThreshold: this.config.rotationThreshold,
        compressionEnabled: this.config.enableCompression,
        maxArchivedFiles: this.config.maxArchivedFiles
      }
    };
  }
  
  /**
   * Format bytes into human-readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
  
  /**
   * Debug logging
   */
  debug(message) {
    if (this.config.debug) {
      console.log(`[LSLFileManager] ${message}`);
    }
  }
  
  /**
   * Analyze LSL file to determine if it contains useful information
   * Returns true if file should be kept, false if it should be removed
   *
   * A file is considered worthless ONLY if it contains EXCLUSIVELY:
   * - "Warmup" messages
   * - "[Request interrupted by user]" messages
   */
  isValueableLSLFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf8');

      // Count all exchanges (lines with "### Text Exchange")
      const exchangeMatches = content.match(/### Text Exchange/g) || [];
      const totalExchanges = exchangeMatches.length;

      if (totalExchanges === 0) {
        // No exchanges at all - empty file
        this.debug(`No exchanges found: ${path.basename(filePath)}`);
        return false;
      }

      // Count warmup exchanges
      const warmupMatches = content.match(/\*\*User Message:\*\* Warmup/gi) || [];
      const warmupCount = warmupMatches.length;

      // Count interrupted exchanges
      const interruptedMatches = content.match(/\*\*User Message:\*\* \[Request interrupted by user\]/gi) || [];
      const interruptedCount = interruptedMatches.length;

      // Calculate worthless exchange count
      const worthlessCount = warmupCount + interruptedCount;

      // File is worthless ONLY if ALL exchanges are warmup or interrupted
      if (worthlessCount === totalExchanges && worthlessCount > 0) {
        this.debug(`All ${totalExchanges} exchanges are worthless (${warmupCount} warmups, ${interruptedCount} interruptions): ${path.basename(filePath)}`);
        return false;
      }

      // File has at least one non-worthless exchange - keep it
      this.debug(`File has ${totalExchanges - worthlessCount}/${totalExchanges} valuable exchanges: ${path.basename(filePath)}`);
      return true;

    } catch (error) {
      this.debug(`Error analyzing LSL file ${filePath}: ${error.message}`);
      return true; // Keep file if we can't analyze it (fail safe)
    }
  }

  /**
   * Check if a file is tracked by git
   * @param {string} filePath - Absolute path to the file
   * @returns {boolean} - True if file is tracked by git, false otherwise
   */
  isGitTracked(filePath) {
    try {
      // Get the directory containing the file
      const fileDir = path.dirname(filePath);
      const fileName = path.basename(filePath);

      // Run git ls-files to check if file is tracked
      // This command returns the file name if tracked, empty if not
      const result = execSync(`git ls-files "${fileName}"`, {
        cwd: fileDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']  // Suppress stderr
      }).trim();

      return result.length > 0;
    } catch (error) {
      // If git command fails (not a git repo, etc.), assume file is not tracked
      this.debug(`Git check failed for ${filePath}: ${error.message}`);
      return false;
    }
  }

  /**
   * Clean up low-value LSL files in a directory
   * Removes files that only contain warmups, interruptions, or no meaningful content
   * SAFETY: Only removes files that are NOT tracked by git
   */
  async cleanupLowValueLSLFiles(directory) {
    try {
      if (!fs.existsSync(directory)) {
        return { removed: 0, reason: 'Directory does not exist' };
      }

      const files = fs.readdirSync(directory)
        .filter(f => f.endsWith('.md') && f.match(/^\d{4}-\d{2}-\d{2}_\d{4}-\d{4}_/))
        .map(f => path.join(directory, f));

      let removedCount = 0;
      const removedFiles = [];

      let skippedGitTracked = 0;
      const skippedFiles = [];

      for (const filePath of files) {
        if (!this.isValueableLSLFile(filePath)) {
          // SAFETY CHECK: Never delete git-tracked files
          if (this.isGitTracked(filePath)) {
            skippedGitTracked++;
            skippedFiles.push(path.basename(filePath));
            this.debug(`⚠️  Skipped git-tracked low-value LSL: ${path.basename(filePath)}`);
            continue;
          }

          try {
            fs.unlinkSync(filePath);
            removedCount++;
            removedFiles.push(path.basename(filePath));
            this.debug(`🗑️  Removed low-value LSL: ${path.basename(filePath)}`);
          } catch (error) {
            this.debug(`Failed to remove low-value LSL ${filePath}: ${error.message}`);
          }
        }
      }

      if (skippedGitTracked > 0) {
        console.log(`⚠️  Skipped ${skippedGitTracked} git-tracked low-value LSL file(s) - manual cleanup required`);
        this.emit('gitTrackedFilesSkipped', {
          directory,
          skippedCount: skippedGitTracked,
          skippedFiles
        });
      }

      if (removedCount > 0) {
        console.log(`🧹 Cleaned up ${removedCount} low-value LSL file(s)`);
        this.emit('lowValueFilesRemoved', {
          directory,
          removedCount,
          removedFiles
        });
      }

      return {
        removed: removedCount,
        files: removedFiles,
        skipped: skippedGitTracked,
        skippedFiles
      };

    } catch (error) {
      this.debug(`Low-value LSL cleanup failed for ${directory}: ${error.message}`);
      return { removed: 0, skipped: 0, error: error.message };
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.debug('Shutting down LSL File Manager...');

    this.stopMonitoring();

    // Perform final check and rotation for all watched files
    try {
      await this.checkAllWatchedFiles();
    } catch (error) {
      this.debug(`Error during final file check: ${error.message}`);
    }

    // Clean up low-value LSL files before shutdown
    try {
      // Get unique directories from watched files
      const directories = new Set();
      for (const [filePath] of this.watchedFiles.entries()) {
        const dir = path.dirname(filePath);
        if (dir.includes('.specstory/history')) {
          directories.add(dir);
        }
      }

      // Clean up each directory
      for (const dir of directories) {
        await this.cleanupLowValueLSLFiles(dir);
      }
    } catch (error) {
      this.debug(`Error during low-value file cleanup: ${error.message}`);
    }

    this.watchedFiles.clear();
    this.emit('shutdown');
    this.debug('LSL File Manager shutdown complete');
  }
}

export default LSLFileManager;