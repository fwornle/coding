#!/usr/bin/env node
/**
 * Retroactive LSL Regeneration Script
 * 
 * Completely rebuilds all historical Live Session Logging (LSL) files using the new 
 * ReliableCodingClassifier to replace previous classifications made by the failed 
 * FastEmbeddingClassifier.
 * 
 * This script provides a complete "do-over" of historical data processing with the
 * reliable classifier, ensuring all past data benefits from the improved accuracy.
 * 
 * Features:
 * - Batch regeneration of all LSL files in .specstory/history/
 * - Progress tracking with ETA calculations
 * - Backup creation before regeneration
 * - Resume capability for interrupted operations
 * - Detailed statistics and quality reports
 * - Verification of regenerated files
 * - Safe rollback mechanism
 * - Performance benchmarking
 * 
 * Usage:
 * node scripts/retroactive-lsl-regenerator.js [options]
 * 
 * Options:
 * --dry-run          Show what would be regenerated without doing it
 * --backup           Create backup before regeneration (default: true)
 * --resume           Resume from last checkpoint
 * --verify           Verify regenerated files after completion
 * --rollback         Rollback to backup files
 * --file-pattern     Glob pattern for files to process (default: "*.md")
 * --max-files        Maximum number of files to process
 * --chunk-size       Number of files to process in each batch (default: 10)
 * --force            Skip safety checks and confirmations
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { promisify } = require('util');
const readline = require('readline');

// Import the reliable classifier
const ReliableCodingClassifier = require('../src/live-logging/ReliableCodingClassifier');

class RetroactiveLslRegenerator {
  constructor(options = {}) {
    this.options = {
      dryRun: options.dryRun || false,
      backup: options.backup !== false, // Default true
      resume: options.resume || false,
      verify: options.verify || false,
      rollback: options.rollback || false,
      filePattern: options.filePattern || '*.md',
      maxFiles: options.maxFiles || Infinity,
      chunkSize: options.chunkSize || 10,
      force: options.force || false,
      ...options
    };

    this.projectPath = process.cwd();
    this.historyPath = path.join(this.projectPath, '.specstory', 'history');
    this.backupPath = path.join(this.projectPath, '.specstory', 'lsl-backup');
    this.checkpointFile = path.join(this.projectPath, '.specstory', 'regeneration-checkpoint.json');
    
    // Initialize classifier
    this.classifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });

    // Progress tracking
    this.state = {
      startTime: null,
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      totalExchanges: 0,
      classifiedExchanges: 0,
      errors: [],
      statistics: {
        codingExchanges: 0,
        nonCodingExchanges: 0,
        avgConfidence: 0,
        avgProcessingTime: 0,
        layerDistribution: {},
        fileTypeDistribution: {}
      }
    };

    // Create readline interface for user interaction
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Main regeneration workflow
   */
  async run() {
    try {
      console.log('🔄 Retroactive LSL Regeneration Starting');
      console.log(`📂 History path: ${this.historyPath}`);
      console.log(`💾 Backup path: ${this.backupPath}`);
      console.log(`⚙️  Options:`, this.options);
      console.log('');

      // Handle special operations first
      if (this.options.rollback) {
        return await this.rollbackFromBackup();
      }

      // Initialize and validate
      await this.initialize();
      await this.validateEnvironment();

      // Get file list for processing
      const filesToProcess = await this.getFilesToProcess();
      
      if (filesToProcess.length === 0) {
        console.log('✅ No files to process');
        return;
      }

      console.log(`📊 Found ${filesToProcess.length} files to process`);
      
      if (!this.options.force && !this.options.dryRun) {
        const confirmed = await this.confirmOperation(filesToProcess.length);
        if (!confirmed) {
          console.log('❌ Operation cancelled by user');
          return;
        }
      }

      // Create backup if requested
      if (this.options.backup && !this.options.dryRun) {
        await this.createBackup(filesToProcess);
      }

      // Process files
      await this.processFiles(filesToProcess);

      // Verify results if requested
      if (this.options.verify && !this.options.dryRun) {
        await this.verifyRegeneration();
      }

      // Generate final report
      this.generateFinalReport();

      console.log('\n✅ Retroactive LSL regeneration completed successfully!');
      
    } catch (error) {
      console.error('\n❌ Regeneration failed:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
      
      // Offer rollback if backup exists
      if (this.options.backup && fs.existsSync(this.backupPath) && !this.options.dryRun) {
        const rollback = await this.promptYesNo('Would you like to rollback to backup?');
        if (rollback) {
          await this.rollbackFromBackup();
        }
      }
      
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  /**
   * Initialize the regenerator
   */
  async initialize() {
    console.log('⚙️ Initializing ReliableCodingClassifier...');
    
    try {
      await this.classifier.initialize();
      console.log('✅ Classifier initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize classifier:', error.message);
      throw error;
    }

    // Load checkpoint if resuming
    if (this.options.resume && fs.existsSync(this.checkpointFile)) {
      const checkpoint = JSON.parse(fs.readFileSync(this.checkpointFile, 'utf8'));
      this.state = { ...this.state, ...checkpoint };
      console.log(`🔄 Resuming from checkpoint: ${this.state.processedFiles} files processed`);
    }

    this.state.startTime = Date.now();
  }

  /**
   * Validate environment before starting
   */
  async validateEnvironment() {
    console.log('🔍 Validating environment...');
    
    // Check history directory exists
    if (!fs.existsSync(this.historyPath)) {
      throw new Error(`History directory not found: ${this.historyPath}`);
    }

    // Check write permissions
    try {
      const testFile = path.join(this.historyPath, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (error) {
      throw new Error(`No write permission to history directory: ${this.historyPath}`);
    }

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupPath)) {
      fs.mkdirSync(this.backupPath, { recursive: true });
    }

    console.log('✅ Environment validation passed');
  }

  /**
   * Get list of files to process
   */
  async getFilesToProcess() {
    console.log('📋 Collecting files for processing...');
    
    if (!fs.existsSync(this.historyPath)) {
      return [];
    }

    let allFiles = fs.readdirSync(this.historyPath)
      .filter(file => {
        // Filter by pattern
        if (this.options.filePattern === '*.md') {
          return file.endsWith('.md');
        }
        // Add more pattern matching logic if needed
        return file.includes(this.options.filePattern.replace('*', ''));
      })
      .map(file => path.join(this.historyPath, file))
      .filter(filePath => {
        // Only process files that actually contain exchanges
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          return this.containsExchanges(content);
        } catch (error) {
          console.warn(`⚠️ Could not read ${filePath}: ${error.message}`);
          return false;
        }
      });

    // Sort files by modification time (oldest first)
    allFiles.sort((a, b) => {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statA.mtime.getTime() - statB.mtime.getTime();
    });

    // Apply max files limit
    if (this.options.maxFiles < allFiles.length) {
      allFiles = allFiles.slice(0, this.options.maxFiles);
      console.log(`📊 Limited to first ${this.options.maxFiles} files`);
    }

    // Filter already processed files if resuming
    if (this.options.resume && this.state.processedFiles > 0) {
      allFiles = allFiles.slice(this.state.processedFiles);
      console.log(`📊 Resuming: ${allFiles.length} files remaining`);
    }

    return allFiles;
  }

  /**
   * Check if file contains exchanges that need classification
   */
  containsExchanges(content) {
    // Look for user/assistant exchange patterns
    return content.includes('# User') || content.includes('# Assistant') || 
           content.includes('**User:**') || content.includes('**Assistant:**');
  }

  /**
   * Confirm operation with user
   */
  async confirmOperation(fileCount) {
    console.log(`\n⚠️  You are about to regenerate ${fileCount} LSL files.`);
    console.log(`📊 This will completely replace existing classifications.`);
    if (this.options.backup) {
      console.log(`💾 Backup will be created in: ${this.backupPath}`);
    }
    console.log('');
    
    return await this.promptYesNo('Do you want to continue?');
  }

  /**
   * Create backup of files before processing
   */
  async createBackup(filesToProcess) {
    console.log(`💾 Creating backup of ${filesToProcess.length} files...`);
    
    // Clear existing backup
    if (fs.existsSync(this.backupPath)) {
      fs.rmSync(this.backupPath, { recursive: true, force: true });
    }
    fs.mkdirSync(this.backupPath, { recursive: true });

    // Copy files to backup
    let backedUp = 0;
    for (const filePath of filesToProcess) {
      try {
        const fileName = path.basename(filePath);
        const backupFilePath = path.join(this.backupPath, fileName);
        fs.copyFileSync(filePath, backupFilePath);
        backedUp++;
      } catch (error) {
        console.warn(`⚠️ Failed to backup ${filePath}: ${error.message}`);
      }
    }

    // Create backup metadata
    const backupMetadata = {
      createdAt: new Date().toISOString(),
      totalFiles: filesToProcess.length,
      backedUpFiles: backedUp,
      originalPath: this.historyPath,
      options: this.options
    };
    
    fs.writeFileSync(
      path.join(this.backupPath, 'backup-metadata.json'),
      JSON.stringify(backupMetadata, null, 2)
    );

    console.log(`✅ Backup completed: ${backedUp}/${filesToProcess.length} files`);
  }

  /**
   * Process all files in chunks
   */
  async processFiles(filesToProcess) {
    console.log(`🔄 Processing ${filesToProcess.length} files in chunks of ${this.options.chunkSize}...`);
    
    this.state.totalFiles = filesToProcess.length;
    
    for (let i = 0; i < filesToProcess.length; i += this.options.chunkSize) {
      const chunk = filesToProcess.slice(i, i + this.options.chunkSize);
      console.log(`\n📦 Processing chunk ${Math.floor(i / this.options.chunkSize) + 1}/${Math.ceil(filesToProcess.length / this.options.chunkSize)}`);
      
      await this.processChunk(chunk);
      
      // Save checkpoint
      this.saveCheckpoint();
      
      // Show progress
      this.showProgress();
      
      // Brief pause between chunks
      if (i + this.options.chunkSize < filesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Process a chunk of files
   */
  async processChunk(files) {
    const chunkPromises = files.map(async (filePath, index) => {
      try {
        await this.processFile(filePath, index);
        this.state.processedFiles++;
      } catch (error) {
        this.state.failedFiles++;
        this.state.errors.push({
          file: filePath,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        console.error(`❌ Failed to process ${path.basename(filePath)}: ${error.message}`);
      }
    });

    await Promise.all(chunkPromises);
  }

  /**
   * Process individual file
   */
  async processFile(filePath, index) {
    const fileName = path.basename(filePath);
    const fileStart = performance.now();
    
    console.log(`📄 [${index + 1}] Processing: ${fileName}`);
    
    if (this.options.dryRun) {
      // Simulate processing in dry run mode
      const content = fs.readFileSync(filePath, 'utf8');
      const exchanges = this.parseExchanges(content);
      console.log(`   📊 Would regenerate ${exchanges.length} exchanges`);
      this.state.totalExchanges += exchanges.length;
      return;
    }

    // Read and parse file
    const content = fs.readFileSync(filePath, 'utf8');
    const exchanges = this.parseExchanges(content);
    
    if (exchanges.length === 0) {
      this.state.skippedFiles++;
      console.log(`   ⏭️  Skipped: No exchanges found`);
      return;
    }

    // Classify each exchange
    const classifiedExchanges = [];
    for (const exchange of exchanges) {
      const classificationStart = performance.now();
      
      try {
        const result = await this.classifier.classifyExchange(exchange);
        const classificationTime = performance.now() - classificationStart;
        
        classifiedExchanges.push({
          ...exchange,
          classification: result,
          processingTime: classificationTime
        });
        
        this.updateStatistics(result, classificationTime);
        this.state.classifiedExchanges++;
        
      } catch (error) {
        console.warn(`   ⚠️ Classification failed for exchange: ${error.message}`);
        // Keep original exchange without classification
        classifiedExchanges.push(exchange);
      }
    }

    // Generate new LSL content
    const newContent = this.generateLslContent(classifiedExchanges, fileName);
    
    // Write updated file
    fs.writeFileSync(filePath, newContent);
    
    const fileTime = performance.now() - fileStart;
    console.log(`   ✅ Regenerated ${exchanges.length} exchanges in ${fileTime.toFixed(2)}ms`);
    
    this.state.totalExchanges += exchanges.length;
    this.updateFileTypeStatistics(fileName);
  }

  /**
   * Parse exchanges from file content
   */
  parseExchanges(content) {
    const exchanges = [];
    const lines = content.split('\n');
    
    let currentExchange = null;
    let currentRole = null;
    let currentContent = [];
    
    for (const line of lines) {
      if (line.startsWith('# User') || line.startsWith('**User:**')) {
        // Save previous exchange
        if (currentExchange && currentExchange.userMessage && currentExchange.assistantResponse) {
          exchanges.push(currentExchange);
        }
        
        // Start new exchange
        currentExchange = {
          userMessage: '',
          assistantResponse: '',
          metadata: {
            originalLine: line,
            timestamp: this.extractTimestamp(line)
          }
        };
        currentRole = 'user';
        currentContent = [];
        
      } else if (line.startsWith('# Assistant') || line.startsWith('**Assistant:**')) {
        // Switch to assistant
        if (currentExchange && currentContent.length > 0) {
          currentExchange.userMessage = currentContent.join('\n').trim();
        }
        currentRole = 'assistant';
        currentContent = [];
        
      } else if (currentRole && line.trim()) {
        currentContent.push(line);
      }
      
      // Handle end of assistant response
      if (currentRole === 'assistant' && currentContent.length > 0 && currentExchange) {
        currentExchange.assistantResponse = currentContent.join('\n').trim();
      }
    }
    
    // Add final exchange
    if (currentExchange && currentExchange.userMessage && currentExchange.assistantResponse) {
      exchanges.push(currentExchange);
    }
    
    return exchanges.filter(ex => 
      ex.userMessage.length > 5 && ex.assistantResponse.length > 5
    );
  }

  /**
   * Extract timestamp from exchange header
   */
  extractTimestamp(line) {
    const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
    return timestampMatch ? timestampMatch[1] : null;
  }

  /**
   * Generate new LSL content with classifications
   */
  generateLslContent(classifiedExchanges, fileName) {
    let content = `# Regenerated LSL File: ${fileName}\n\n`;
    content += `Generated: ${new Date().toISOString()}\n`;
    content += `Total Exchanges: ${classifiedExchanges.length}\n`;
    content += `Classifier: ReliableCodingClassifier\n\n`;
    content += `---\n\n`;
    
    for (let i = 0; i < classifiedExchanges.length; i++) {
      const exchange = classifiedExchanges[i];
      const classification = exchange.classification;
      
      // Exchange header with classification info
      content += `## Exchange ${i + 1}`;
      if (classification) {
        const isCoding = classification.isCoding ? 'CODING' : 'NOT_CODING';
        const confidence = (classification.confidence * 100).toFixed(1);
        const layer = classification.layer || 'unknown';
        content += ` [${isCoding}:${layer}:${confidence}%]`;
      }
      content += `\n\n`;
      
      // User message
      content += `### User\n\n`;
      content += `${exchange.userMessage}\n\n`;
      
      // Assistant response
      content += `### Assistant\n\n`;
      content += `${exchange.assistantResponse}\n\n`;
      
      // Classification details (if available)
      if (classification) {
        content += `### Classification Details\n\n`;
        content += `- **Result**: ${classification.classification}\n`;
        content += `- **Confidence**: ${(classification.confidence * 100).toFixed(2)}%\n`;
        content += `- **Layer**: ${classification.layer}\n`;
        content += `- **Is Coding**: ${classification.isCoding}\n`;
        if (exchange.processingTime) {
          content += `- **Processing Time**: ${exchange.processingTime.toFixed(2)}ms\n`;
        }
        content += `\n`;
      }
      
      content += `---\n\n`;
    }
    
    return content;
  }

  /**
   * Update classification statistics
   */
  updateStatistics(classification, processingTime) {
    const stats = this.state.statistics;
    
    if (classification.isCoding) {
      stats.codingExchanges++;
    } else {
      stats.nonCodingExchanges++;
    }
    
    // Update averages
    const total = stats.codingExchanges + stats.nonCodingExchanges;
    stats.avgConfidence = ((stats.avgConfidence * (total - 1)) + classification.confidence) / total;
    stats.avgProcessingTime = ((stats.avgProcessingTime * (total - 1)) + processingTime) / total;
    
    // Layer distribution
    const layer = classification.layer || 'unknown';
    stats.layerDistribution[layer] = (stats.layerDistribution[layer] || 0) + 1;
  }

  /**
   * Update file type statistics
   */
  updateFileTypeStatistics(fileName) {
    const stats = this.state.statistics;
    
    if (fileName.includes('live-session')) {
      stats.fileTypeDistribution.liveSession = (stats.fileTypeDistribution.liveSession || 0) + 1;
    } else if (fileName.includes('session')) {
      stats.fileTypeDistribution.session = (stats.fileTypeDistribution.session || 0) + 1;
    } else {
      stats.fileTypeDistribution.other = (stats.fileTypeDistribution.other || 0) + 1;
    }
  }

  /**
   * Save checkpoint for resume capability
   */
  saveCheckpoint() {
    const checkpoint = {
      ...this.state,
      savedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(this.checkpointFile, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * Show progress update
   */
  showProgress() {
    const elapsed = (Date.now() - this.state.startTime) / 1000;
    const rate = this.state.processedFiles / elapsed;
    const remaining = this.state.totalFiles - this.state.processedFiles;
    const eta = remaining / rate;
    
    console.log(`\n📊 Progress Update:`);
    console.log(`   Files: ${this.state.processedFiles}/${this.state.totalFiles} (${((this.state.processedFiles / this.state.totalFiles) * 100).toFixed(1)}%)`);
    console.log(`   Exchanges: ${this.state.classifiedExchanges} total, ${this.state.statistics.codingExchanges} coding, ${this.state.statistics.nonCodingExchanges} non-coding`);
    console.log(`   Failed: ${this.state.failedFiles} files`);
    console.log(`   Rate: ${rate.toFixed(2)} files/sec`);
    console.log(`   ETA: ${eta.toFixed(0)}s (${(eta / 60).toFixed(1)} min)`);
    console.log(`   Avg Confidence: ${(this.state.statistics.avgConfidence * 100).toFixed(1)}%`);
    console.log(`   Avg Processing Time: ${this.state.statistics.avgProcessingTime.toFixed(2)}ms`);
  }

  /**
   * Verify regenerated files
   */
  async verifyRegeneration() {
    console.log('\n🔍 Verifying regenerated files...');
    
    const files = fs.readdirSync(this.historyPath)
      .filter(file => file.endsWith('.md'))
      .slice(0, 5); // Verify first 5 files
    
    let verifiedCount = 0;
    let errorCount = 0;
    
    for (const file of files) {
      try {
        const filePath = path.join(this.historyPath, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check for classification markers
        const hasClassifications = content.includes('[CODING:') || content.includes('[NOT_CODING:');
        const hasExchanges = content.includes('### User') && content.includes('### Assistant');
        
        if (hasClassifications && hasExchanges) {
          verifiedCount++;
          console.log(`   ✅ ${file}: Valid regenerated format`);
        } else {
          errorCount++;
          console.log(`   ❌ ${file}: Missing classification markers or exchanges`);
        }
        
      } catch (error) {
        errorCount++;
        console.log(`   ❌ ${file}: Verification failed - ${error.message}`);
      }
    }
    
    console.log(`\n📊 Verification Results: ${verifiedCount}/${files.length} files valid`);
    
    if (errorCount > 0) {
      console.warn(`⚠️ ${errorCount} files had verification issues`);
    }
  }

  /**
   * Rollback from backup
   */
  async rollbackFromBackup() {
    console.log('\n🔄 Rolling back from backup...');
    
    if (!fs.existsSync(this.backupPath)) {
      throw new Error('Backup directory not found. Cannot rollback.');
    }
    
    const metadataPath = path.join(this.backupPath, 'backup-metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('Backup metadata not found. Cannot verify backup integrity.');
    }
    
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    console.log(`📊 Backup from: ${metadata.createdAt}`);
    console.log(`📊 Files to restore: ${metadata.backedUpFiles}`);
    
    if (!this.options.force) {
      const confirmed = await this.promptYesNo('Restore from backup? This will overwrite current files.');
      if (!confirmed) {
        console.log('❌ Rollback cancelled');
        return;
      }
    }
    
    const backupFiles = fs.readdirSync(this.backupPath)
      .filter(file => file.endsWith('.md'));
    
    let restoredCount = 0;
    for (const file of backupFiles) {
      try {
        const backupFilePath = path.join(this.backupPath, file);
        const originalFilePath = path.join(this.historyPath, file);
        
        fs.copyFileSync(backupFilePath, originalFilePath);
        restoredCount++;
        
      } catch (error) {
        console.warn(`⚠️ Failed to restore ${file}: ${error.message}`);
      }
    }
    
    console.log(`✅ Rollback completed: ${restoredCount}/${backupFiles.length} files restored`);
  }

  /**
   * Generate final report
   */
  generateFinalReport() {
    const totalTime = (Date.now() - this.state.startTime) / 1000;
    const codingPercentage = this.state.statistics.codingExchanges / 
      (this.state.statistics.codingExchanges + this.state.statistics.nonCodingExchanges) * 100;
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RETROACTIVE LSL REGENERATION REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`  Total time: ${totalTime.toFixed(2)}s (${(totalTime / 60).toFixed(1)} min)`);
    console.log(`  Files processed: ${this.state.processedFiles}/${this.state.totalFiles}`);
    console.log(`  Files failed: ${this.state.failedFiles}`);
    console.log(`  Files skipped: ${this.state.skippedFiles}`);
    console.log(`  Total exchanges: ${this.state.classifiedExchanges}`);
    console.log(`  Processing rate: ${(this.state.processedFiles / totalTime).toFixed(2)} files/sec`);
    console.log(`  Classification rate: ${(this.state.classifiedExchanges / totalTime).toFixed(2)} exchanges/sec`);
    
    console.log(`\n🎯 CLASSIFICATION RESULTS:`);
    console.log(`  Coding exchanges: ${this.state.statistics.codingExchanges} (${codingPercentage.toFixed(1)}%)`);
    console.log(`  Non-coding exchanges: ${this.state.statistics.nonCodingExchanges} (${(100 - codingPercentage).toFixed(1)}%)`);
    console.log(`  Average confidence: ${(this.state.statistics.avgConfidence * 100).toFixed(2)}%`);
    console.log(`  Average processing time: ${this.state.statistics.avgProcessingTime.toFixed(2)}ms`);
    
    if (Object.keys(this.state.statistics.layerDistribution).length > 0) {
      console.log(`\n📊 LAYER DISTRIBUTION:`);
      Object.entries(this.state.statistics.layerDistribution)
        .sort(([,a], [,b]) => b - a)
        .forEach(([layer, count]) => {
          const percentage = (count / this.state.classifiedExchanges * 100).toFixed(1);
          console.log(`  ${layer}: ${count} (${percentage}%)`);
        });
    }
    
    if (Object.keys(this.state.statistics.fileTypeDistribution).length > 0) {
      console.log(`\n📁 FILE TYPE DISTRIBUTION:`);
      Object.entries(this.state.statistics.fileTypeDistribution)
        .forEach(([type, count]) => {
          console.log(`  ${type}: ${count} files`);
        });
    }
    
    if (this.state.errors.length > 0) {
      console.log(`\n❌ ERRORS (${this.state.errors.length}):`);
      this.state.errors.slice(0, 5).forEach((error, i) => {
        console.log(`  ${i + 1}. ${path.basename(error.file)}: ${error.error}`);
      });
      if (this.state.errors.length > 5) {
        console.log(`  ... and ${this.state.errors.length - 5} more errors`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    
    // Save report to file
    const reportPath = path.join(this.projectPath, '.specstory', `regeneration-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      options: this.options,
      state: this.state,
      totalTime,
      codingPercentage
    }, null, 2));
    
    console.log(`📝 Detailed report saved to: ${reportPath}`);
  }

  /**
   * Prompt user for yes/no confirmation
   */
  async promptYesNo(question) {
    return new Promise((resolve) => {
      this.rl.question(`${question} (y/n): `, (answer) => {
        resolve(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes');
      });
    });
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-backup':
        options.backup = false;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--verify':
        options.verify = true;
        break;
      case '--rollback':
        options.rollback = true;
        break;
      case '--file-pattern':
        options.filePattern = args[++i];
        break;
      case '--max-files':
        options.maxFiles = parseInt(args[++i]);
        break;
      case '--chunk-size':
        options.chunkSize = parseInt(args[++i]);
        break;
      case '--force':
        options.force = true;
        break;
      case '--help':
        console.log(`
Retroactive LSL Regeneration Script

Usage: node scripts/retroactive-lsl-regenerator.js [options]

Options:
  --dry-run          Show what would be regenerated without doing it
  --no-backup        Skip backup creation (default: create backup)
  --resume           Resume from last checkpoint
  --verify           Verify regenerated files after completion
  --rollback         Rollback to backup files
  --file-pattern     Glob pattern for files to process (default: "*.md")
  --max-files        Maximum number of files to process
  --chunk-size       Number of files to process in each batch (default: 10)
  --force            Skip safety checks and confirmations
  --help             Show this help message

Examples:
  # Dry run to see what would be processed
  node scripts/retroactive-lsl-regenerator.js --dry-run

  # Process all files with backup and verification
  node scripts/retroactive-lsl-regenerator.js --verify

  # Process only recent files
  node scripts/retroactive-lsl-regenerator.js --max-files 50

  # Resume interrupted operation
  node scripts/retroactive-lsl-regenerator.js --resume

  # Rollback to backup
  node scripts/retroactive-lsl-regenerator.js --rollback
`);
        process.exit(0);
        break;
    }
  }
  
  const regenerator = new RetroactiveLslRegenerator(options);
  await regenerator.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = RetroactiveLslRegenerator;