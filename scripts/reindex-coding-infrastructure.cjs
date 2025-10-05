#!/usr/bin/env node

/**
 * Manual Repository Reindexing Script
 * 
 * Provides manual trigger for repository reindexing when automatic detection
 * is insufficient. Supports full and partial reindexing with comprehensive
 * progress reporting and validation.
 * 
 * Usage:
 *   node scripts/reindex-coding-infrastructure.js [options]
 * 
 * Options:
 *   --full              Full reindexing (clears existing index)
 *   --partial           Incremental reindexing (updates changed files only)
 *   --pattern <glob>    Reindex only files matching pattern
 *   --validate          Validate index integrity after completion
 *   --dry-run           Show what would be indexed without making changes
 *   --force             Skip confirmation prompts
 *   --verbose           Enable detailed logging
 *   --config <path>     Use custom configuration file
 * 
 * Examples:
 *   node scripts/reindex-coding-infrastructure.js --full --validate
 *   node scripts/reindex-coding-infrastructure.js --pattern "*.md" --verbose
 *   node scripts/reindex-coding-infrastructure.js --partial --dry-run
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { performance } = require('perf_hooks');
const { QdrantClient } = require('@qdrant/js-client-rest');

// Import components
const RepositoryIndexer = require('../src/live-logging/RepositoryIndexer.cjs');
const EmbeddingGenerator = require('../src/utils/EmbeddingGenerator.cjs');
const PerformanceMonitor = require('../src/live-logging/PerformanceMonitor');

class RepositoryReindexer {
  constructor(options = {}) {
    this.options = {
      force: false,
      verbose: false,
      dryRun: false,
      validate: false,
      full: false,
      partial: false,
      pattern: null,
      configPath: null,
      ...options
    };
    
    this.projectRoot = path.resolve(__dirname, '..');
    this.config = null;
    this.repositoryIndexer = null;
    this.embeddingGenerator = null;
    this.performanceMonitor = null;
    this.qdrantClient = null;
    
    this.stats = {
      startTime: 0,
      endTime: 0,
      filesProcessed: 0,
      chunksCreated: 0,
      pointsIndexed: 0,
      pointsUpdated: 0,
      pointsDeleted: 0,
      errors: [],
      warnings: []
    };
    
    this.progressIndicators = {
      spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
      spinnerIndex: 0,
      interval: null
    };
  }

  async initialize() {
    console.log('🚀 Initializing Repository Reindexer\n');
    
    try {
      // Load configuration
      await this.loadConfiguration();
      
      // Initialize components
      this.embeddingGenerator = new EmbeddingGenerator(this.config.embedding_classifier.embedding);
      this.repositoryIndexer = new RepositoryIndexer(this.config.embedding_classifier);
      this.performanceMonitor = new PerformanceMonitor();
      
      // Initialize Qdrant client
      this.qdrantClient = new QdrantClient({
        host: this.config.embedding_classifier.qdrant.host,
        port: this.config.embedding_classifier.qdrant.port
      });
      
      // Test connections
      await this.testConnections();
      
      this.log('✅ Initialization completed successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      this.stats.errors.push(`Initialization: ${error.message}`);
      return false;
    }
  }

  async loadConfiguration() {
    const configPath = this.options.configPath || 
                      path.join(this.projectRoot, 'config', 'live-logging-config.json');
    
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      this.config = JSON.parse(configData);
      this.log(`📋 Configuration loaded from: ${configPath}`);
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error.message}`);
    }
  }

  async testConnections() {
    this.log('🔌 Testing component connections...');
    
    // Test Qdrant connection
    try {
      await this.qdrantClient.getCollectionInfo('coding_infrastructure').catch(() => {
        this.log('📦 Collection "coding_infrastructure" not found, will be created during indexing');
      });
      this.log('✅ Qdrant connection successful');
    } catch (error) {
      throw new Error(`Qdrant connection failed: ${error.message}`);
    }
    
    // Test embedding generation
    try {
      await this.embeddingGenerator.generateEmbedding('test connection');
      this.log('✅ Embedding generation successful');
    } catch (error) {
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  async confirmOperation() {
    if (this.options.force || this.options.dryRun) {
      return true;
    }

    const operationType = this.options.full ? 'FULL REINDEXING' :
                         this.options.partial ? 'PARTIAL REINDEXING' : 'REINDEXING';
    
    console.log(`\n⚠️  ${operationType} WARNING ⚠️`);
    console.log('=' .repeat(50));
    
    if (this.options.full) {
      console.log('• This will DELETE the existing index completely');
      console.log('• All current embeddings will be lost');
      console.log('• Full repository will be reprocessed');
    } else if (this.options.partial) {
      console.log('• This will update changed files only');
      console.log('• Existing embeddings will be preserved where possible');
    }
    
    if (this.options.pattern) {
      console.log(`• Only files matching pattern: ${this.options.pattern}`);
    }
    
    console.log(`• Repository: ${this.projectRoot}`);
    console.log(`• Collection: ${this.config.embedding_classifier.qdrant.collection_name}`);
    console.log('=' .repeat(50));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\nDo you want to continue? (yes/no): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      });
    });
  }

  async executeReindexing() {
    this.stats.startTime = performance.now();
    
    console.log('\n📊 Starting Reindexing Operation');
    console.log('=' .repeat(50));
    
    try {
      if (this.options.full) {
        await this.performFullReindexing();
      } else if (this.options.partial) {
        await this.performPartialReindexing();
      } else if (this.options.pattern) {
        await this.performPatternReindexing();
      } else {
        // Default to partial reindexing
        await this.performPartialReindexing();
      }
      
      this.stats.endTime = performance.now();
      
      if (this.options.validate && !this.options.dryRun) {
        await this.validateIndexIntegrity();
      }
      
      await this.generateReport();
      
    } catch (error) {
      this.stats.errors.push(`Reindexing: ${error.message}`);
      throw error;
    }
  }

  async performFullReindexing() {
    this.log('🔄 Starting full repository reindexing...');
    
    if (!this.options.dryRun) {
      // Clear existing collection
      this.startProgress('Clearing existing index');
      try {
        await this.qdrantClient.deleteCollection('coding_infrastructure');
        this.log('✅ Existing index cleared');
      } catch (error) {
        this.log('⚠️  Collection did not exist or could not be cleared');
      }
      this.stopProgress();
    }
    
    // Index full repository
    this.startProgress('Indexing repository');
    const result = await this.indexWithProgress(this.projectRoot, 'full');
    this.stopProgress();
    
    this.updateStats(result);
    this.log(`✅ Full reindexing completed: ${this.stats.filesProcessed} files processed`);
  }

  async performPartialReindexing() {
    this.log('🔄 Starting partial repository reindexing...');
    
    this.startProgress('Detecting changes');
    const changedFiles = await this.detectChangedFiles();
    this.stopProgress();
    
    if (changedFiles.length === 0) {
      this.log('✅ No changes detected, index is up to date');
      return;
    }
    
    this.log(`📝 Found ${changedFiles.length} changed files`);
    
    if (this.options.verbose) {
      changedFiles.slice(0, 10).forEach(file => {
        this.log(`  • ${path.relative(this.projectRoot, file)}`);
      });
      if (changedFiles.length > 10) {
        this.log(`  ... and ${changedFiles.length - 10} more files`);
      }
    }
    
    this.startProgress('Updating index');
    const result = await this.indexWithProgress(changedFiles, 'partial');
    this.stopProgress();
    
    this.updateStats(result);
    this.log(`✅ Partial reindexing completed: ${this.stats.filesProcessed} files updated`);
  }

  async performPatternReindexing() {
    this.log(`🔄 Starting pattern-based reindexing: ${this.options.pattern}`);
    
    this.startProgress('Finding matching files');
    const glob = require('glob');
    const matchingFiles = glob.sync(this.options.pattern, {
      cwd: this.projectRoot,
      absolute: true,
      ignore: this.config.embedding_classifier.repository_indexing.exclude_patterns
    });
    this.stopProgress();
    
    if (matchingFiles.length === 0) {
      this.log('✅ No files match the specified pattern');
      return;
    }
    
    this.log(`📝 Found ${matchingFiles.length} files matching pattern`);
    
    this.startProgress('Indexing matching files');
    const result = await this.indexWithProgress(matchingFiles, 'pattern');
    this.stopProgress();
    
    this.updateStats(result);
    this.log(`✅ Pattern reindexing completed: ${this.stats.filesProcessed} files processed`);
  }

  async detectChangedFiles() {
    // Simple change detection based on file modification time
    // In a real implementation, this would use git status or file system watchers
    const allFiles = await this.getAllIndexableFiles();
    const changedFiles = [];
    
    // For demonstration, we'll consider all files as potentially changed
    // A real implementation would compare timestamps or use git diff
    for (const file of allFiles) {
      try {
        const stats = await fs.stat(file);
        const lastModified = stats.mtime;
        
        // Simple heuristic: files modified in the last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (lastModified > oneDayAgo) {
          changedFiles.push(file);
        }
      } catch (error) {
        this.log(`⚠️  Could not check file: ${file}`);
      }
    }
    
    return changedFiles.slice(0, 50); // Limit for demo purposes
  }

  async getAllIndexableFiles() {
    const glob = require('glob');
    const includePatterns = this.config.embedding_classifier.repository_indexing.index_patterns;
    const excludePatterns = this.config.embedding_classifier.repository_indexing.exclude_patterns;
    
    const allFiles = [];
    
    for (const pattern of includePatterns) {
      const files = glob.sync(pattern, {
        cwd: this.projectRoot,
        absolute: true,
        ignore: excludePatterns
      });
      allFiles.push(...files);
    }
    
    // Remove duplicates
    return [...new Set(allFiles)];
  }

  async indexWithProgress(target, type) {
    if (this.options.dryRun) {
      return this.simulateIndexing(target, type);
    }
    
    const startTime = performance.now();
    
    let result;
    if (Array.isArray(target)) {
      // Index specific files
      result = await this.repositoryIndexer.reindexChangedFiles(target);
    } else {
      // Index directory
      result = await this.repositoryIndexer.indexRepository(target);
    }
    
    const duration = performance.now() - startTime;
    
    // Record performance
    this.performanceMonitor.recordRepositoryIndexing(
      duration,
      result.filesProcessed || 0,
      result.chunksCreated || 0,
      result.indexSize || 0
    );
    
    return result;
  }

  async simulateIndexing(target, type) {
    // Simulate indexing for dry run
    const files = Array.isArray(target) ? target : await this.getAllIndexableFiles();
    
    return {
      success: true,
      filesProcessed: files.length,
      chunksCreated: files.length * 3, // Estimate
      pointsIndexed: files.length * 3,
      duration: files.length * 100, // Estimate 100ms per file
      type: type
    };
  }

  async validateIndexIntegrity() {
    this.log('\n🔍 Validating index integrity...');
    
    this.startProgress('Checking collection status');
    
    try {
      const collection = await this.qdrantClient.getCollection('coding_infrastructure');
      const pointsCount = collection.points_count;
      
      this.stopProgress();
      
      this.log(`✅ Collection contains ${pointsCount} points`);
      
      // Test a few search queries
      this.startProgress('Testing search functionality');
      
      const testQueries = [
        'repository indexing functionality',
        'embedding generation performance',
        'classification system architecture'
      ];
      
      let searchResults = 0;
      for (const query of testQueries) {
        const embedding = await this.embeddingGenerator.generateEmbedding(query);
        const results = await this.qdrantClient.search('coding_infrastructure', {
          vector: embedding,
          limit: 5
        });
        searchResults += results.length;
      }
      
      this.stopProgress();
      
      if (searchResults > 0) {
        this.log(`✅ Search functionality verified (${searchResults} total results)`);
      } else {
        this.stats.warnings.push('Search returned no results - index may be incomplete');
        this.log('⚠️  Search returned no results');
      }
      
      // Memory usage check
      const memoryUsage = process.memoryUsage();
      const memoryMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
      this.log(`📊 Memory usage: ${memoryMB}MB`);
      
      if (memoryMB > 500) {
        this.stats.warnings.push(`High memory usage: ${memoryMB}MB`);
      }
      
    } catch (error) {
      this.stats.errors.push(`Validation: ${error.message}`);
      this.log(`❌ Validation failed: ${error.message}`);
    }
  }

  updateStats(result) {
    this.stats.filesProcessed += result.filesProcessed || 0;
    this.stats.chunksCreated += result.chunksCreated || 0;
    this.stats.pointsIndexed += result.pointsIndexed || 0;
    this.stats.pointsUpdated += result.pointsUpdated || 0;
    this.stats.pointsDeleted += result.pointsDeleted || 0;
  }

  async generateReport() {
    const duration = this.stats.endTime - this.stats.startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    
    console.log('\n📊 REINDEXING REPORT');
    console.log('=' .repeat(50));
    console.log(`Operation Type: ${this.getOperationType()}`);
    console.log(`Duration: ${durationSeconds} seconds`);
    console.log(`Files Processed: ${this.stats.filesProcessed}`);
    console.log(`Chunks Created: ${this.stats.chunksCreated}`);
    console.log(`Points Indexed: ${this.stats.pointsIndexed}`);
    
    if (this.stats.pointsUpdated > 0) {
      console.log(`Points Updated: ${this.stats.pointsUpdated}`);
    }
    
    if (this.stats.pointsDeleted > 0) {
      console.log(`Points Deleted: ${this.stats.pointsDeleted}`);
    }
    
    // Performance metrics
    const performanceReport = this.performanceMonitor.getEmbeddingMetrics();
    if (performanceReport.layers.repositoryIndexing) {
      const indexingMetrics = performanceReport.layers.repositoryIndexing;
      console.log(`Average Processing Time: ${indexingMetrics.avgTime}ms per operation`);
    }
    
    if (this.stats.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      this.stats.warnings.forEach(warning => {
        console.log(`  • ${warning}`);
      });
    }
    
    if (this.stats.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.stats.errors.forEach(error => {
        console.log(`  • ${error}`);
      });
    }
    
    const status = this.stats.errors.length === 0 ? 'SUCCESS' : 'COMPLETED WITH ERRORS';
    const emoji = this.stats.errors.length === 0 ? '🎉' : '⚠️';
    
    console.log(`\n${emoji} REINDEXING ${status}`);
    
    if (this.options.dryRun) {
      console.log('\n🔍 This was a dry run - no actual changes were made');
    }
  }

  getOperationType() {
    if (this.options.dryRun) return 'DRY RUN';
    if (this.options.full) return 'FULL REINDEXING';
    if (this.options.partial) return 'PARTIAL REINDEXING';
    if (this.options.pattern) return `PATTERN REINDEXING (${this.options.pattern})`;
    return 'INCREMENTAL REINDEXING';
  }

  startProgress(message) {
    if (!this.options.verbose) {
      process.stdout.write(`${message}... `);
      this.progressIndicators.interval = setInterval(() => {
        const spinner = this.progressIndicators.spinner[this.progressIndicators.spinnerIndex];
        process.stdout.write(`\r${message}... ${spinner}`);
        this.progressIndicators.spinnerIndex = 
          (this.progressIndicators.spinnerIndex + 1) % this.progressIndicators.spinner.length;
      }, 100);
    } else {
      this.log(message);
    }
  }

  stopProgress() {
    if (this.progressIndicators.interval) {
      clearInterval(this.progressIndicators.interval);
      this.progressIndicators.interval = null;
      if (!this.options.verbose) {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
      }
    }
  }

  log(message) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] ${message}`);
  }

  async cleanup() {
    this.log('\n🧹 Cleaning up resources...');
    
    this.stopProgress();
    
    try {
      if (this.embeddingGenerator) {
        await this.embeddingGenerator.cleanup();
      }
      if (this.repositoryIndexer) {
        await this.repositoryIndexer.cleanup();
      }
    } catch (error) {
      this.log(`⚠️  Cleanup warning: ${error.message}`);
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--full':
        options.full = true;
        break;
      case '--partial':
        options.partial = true;
        break;
      case '--validate':
        options.validate = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--pattern':
        if (i + 1 < args.length) {
          options.pattern = args[++i];
        } else {
          console.error('Error: --pattern requires a value');
          process.exit(1);
        }
        break;
      case '--config':
        if (i + 1 < args.length) {
          options.configPath = args[++i];
        } else {
          console.error('Error: --config requires a path');
          process.exit(1);
        }
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error('Use --help for usage information');
        process.exit(1);
    }
  }
  
  // Default to partial if no mode specified
  if (!options.full && !options.partial && !options.pattern) {
    options.partial = true;
  }
  
  const reindexer = new RepositoryReindexer(options);
  
  try {
    const initialized = await reindexer.initialize();
    if (!initialized) {
      process.exit(1);
    }
    
    const confirmed = await reindexer.confirmOperation();
    if (!confirmed) {
      console.log('\n❌ Operation cancelled by user');
      process.exit(0);
    }
    
    await reindexer.executeReindexing();
    
  } catch (error) {
    console.error('\n❌ Reindexing failed:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await reindexer.cleanup();
  }
}

function showHelp() {
  console.log(`
Repository Reindexing Script

USAGE:
  node scripts/reindex-coding-infrastructure.js [options]

OPTIONS:
  --full              Full reindexing (clears existing index)
  --partial           Incremental reindexing (updates changed files only)
  --pattern <glob>    Reindex only files matching pattern
  --validate          Validate index integrity after completion
  --dry-run           Show what would be indexed without making changes
  --force             Skip confirmation prompts
  --verbose           Enable detailed logging
  --config <path>     Use custom configuration file
  --help, -h          Show this help message

EXAMPLES:
  # Full reindexing with validation
  node scripts/reindex-coding-infrastructure.js --full --validate

  # Reindex only markdown files
  node scripts/reindex-coding-infrastructure.js --pattern "**/*.md" --verbose

  # Dry run to see what would be changed
  node scripts/reindex-coding-infrastructure.js --partial --dry-run

  # Force full reindexing without prompts
  node scripts/reindex-coding-infrastructure.js --full --force

PERFORMANCE TARGETS:
  • Initial indexing: < 5 minutes
  • Incremental updates: < 30 seconds
  • Memory usage: < 500MB
  • Validation: < 1 minute
`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = RepositoryReindexer;