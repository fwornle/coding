const { QdrantClient } = require('@qdrant/js-client-rest');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { glob } = require('glob');
const EmbeddingGenerator = require('../utils/EmbeddingGenerator.cjs');

/**
 * RepositoryIndexer - Repository content scanner and Qdrant index manager
 * 
 * Scans coding repository content and populates Qdrant 'coding_infrastructure' collection
 * with semantic embeddings for use by EmbeddingClassifier Layer 3 similarity search.
 * 
 * Features:
 * - Repository content scanning (*.md, *.js, README*, CLAUDE.md)
 * - Incremental indexing with change detection
 * - Semantic embedding generation via EmbeddingGenerator
 * - Optimized Qdrant storage with HNSW and int8 quantization
 * - Atomic index updates for consistency
 * - Performance monitoring and progress reporting
 */
class RepositoryIndexer {
  constructor(options = {}) {
    this.config = {
      // Qdrant connection settings (reuse existing mcp-constraint-monitor infrastructure)
      qdrant: {
        host: options.qdrantHost || 'localhost',
        port: options.qdrantPort || 6333,
        collection: 'coding_infrastructure'
      },
      
      // Repository indexing configuration
      repository: {
        rootPath: options.repositoryPath || this.detectRepositoryPath(),
        includePatterns: options.includePatterns || ['*.md', '*.js', 'README*', 'CLAUDE.md'],
        excludePatterns: options.excludePatterns || [
          'node_modules/**', 
          '.git/**', 
          '*.log', 
          '.next/**',
          'dist/**',
          'build/**',
          '.spec-workflow/history/**',
          '.specstory/history/**'
        ],
        maxFileSizeMB: options.maxFileSizeMB || 1,
        batchSize: options.batchSize || 10
      },
      
      // Performance settings
      performance: {
        maxIndexingTimeMs: options.maxIndexingTimeMs || 300000, // 5 minutes
        vectorDimensions: 384, // sentence-transformers/all-MiniLM-L6-v2
        similarityThreshold: 0.7
      },
      
      debug: options.debug || false
    };
    
    // Initialize Qdrant client with same settings as mcp-constraint-monitor
    this.qdrant = new QdrantClient({
      url: `http://${this.config.qdrant.host}:${this.config.qdrant.port}`
    });
    
    // Initialize embedding generator
    this.embeddingGenerator = new EmbeddingGenerator({
      debug: this.config.debug,
      batchSize: this.config.repository.batchSize
    });
    
    // Performance and operation statistics
    this.stats = {
      filesIndexed: 0,
      documentsCreated: 0,
      totalProcessingTime: 0,
      averageFileTime: 0,
      indexingErrors: 0,
      lastIndexingTime: null,
      cacheHitRate: 0,
      embeddingGenerationTime: 0
    };
    
    this.initialized = false;
    this.log('RepositoryIndexer initialized', {
      repository: this.config.repository.rootPath,
      collection: this.config.qdrant.collection
    });
  }
  
  /**
   * Initialize the indexer and ensure Qdrant collection exists
   * @returns {Promise<void>}
   */
  async initialize() {
    const startTime = Date.now();
    
    try {
      // Ensure repository path exists
      if (!fs.existsSync(this.config.repository.rootPath)) {
        throw new Error(`Repository path does not exist: ${this.config.repository.rootPath}`);
      }
      
      // Initialize embedding generator
      await this.embeddingGenerator.initialize?.();
      
      // Ensure Qdrant collection exists with optimized settings
      await this.ensureCollection();
      
      this.initialized = true;
      
      const initTime = Date.now() - startTime;
      this.log('RepositoryIndexer initialization completed', { 
        initializationTime: initTime,
        collectionReady: true 
      });
      
    } catch (error) {
      this.log(`Initialization failed: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Ensure the coding_infrastructure collection exists with proper configuration
   * @private
   */
  async ensureCollection() {
    try {
      // Check if collection exists
      const collections = await this.qdrant.getCollections();
      const exists = collections.collections.some(c => c.name === this.config.qdrant.collection);
      
      if (!exists) {
        // Create collection with optimized settings matching mcp-constraint-monitor
        await this.qdrant.createCollection(this.config.qdrant.collection, {
          vectors: {
            size: this.config.performance.vectorDimensions,
            distance: 'Cosine',
            hnsw_config: {
              m: 16,           // Optimized for speed
              ef_construct: 100,
              full_scan_threshold: 10000
            },
            quantization_config: {
              scalar: {
                type: 'int8',    // 4x faster queries
                quantile: 0.99,
                always_ram: true
              }
            }
          }
        });
        
        this.log(`Created Qdrant collection: ${this.config.qdrant.collection}`);
      } else {
        this.log(`Qdrant collection already exists: ${this.config.qdrant.collection}`);
      }
    } catch (error) {
      this.log(`Failed to ensure collection: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Index the entire repository content
   * @param {Object} options - Indexing options
   * @returns {Promise<Object>} Indexing results and statistics
   */
  async indexRepository(options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const startTime = Date.now();
    const forceReindex = options.forceReindex || false;
    
    try {
      this.log('Starting repository indexing', {
        repositoryPath: this.config.repository.rootPath,
        forceReindex
      });
      
      // Discover files to index
      const files = await this.discoverRepositoryFiles();
      this.log(`Discovered ${files.length} files for indexing`);
      
      // Filter files that need indexing (if not force reindex)
      const filesToIndex = forceReindex ? files : await this.filterChangedFiles(files);
      this.log(`${filesToIndex.length} files need indexing`);
      
      if (filesToIndex.length === 0) {
        return {
          success: true,
          filesProcessed: 0,
          documentsCreated: 0,
          processingTime: Date.now() - startTime,
          message: 'Repository index is up to date'
        };
      }
      
      // Process files in batches
      let documentsCreated = 0;
      let totalEmbeddingTime = 0;
      
      for (let i = 0; i < filesToIndex.length; i += this.config.repository.batchSize) {
        const batch = filesToIndex.slice(i, i + this.config.repository.batchSize);
        
        this.log(`Processing batch ${Math.floor(i / this.config.repository.batchSize) + 1}/${Math.ceil(filesToIndex.length / this.config.repository.batchSize)}`);
        
        const batchResults = await this.processBatch(batch);
        documentsCreated += batchResults.documentsCreated;
        totalEmbeddingTime += batchResults.embeddingTime;
        
        // Progress reporting
        const progress = Math.floor(((i + batch.length) / filesToIndex.length) * 100);
        this.log(`Indexing progress: ${progress}%`, {
          filesProcessed: i + batch.length,
          totalFiles: filesToIndex.length
        });
      }
      
      // Update statistics
      const processingTime = Date.now() - startTime;
      this.updateStats({
        filesIndexed: filesToIndex.length,
        documentsCreated,
        processingTime,
        embeddingTime: totalEmbeddingTime
      });
      
      this.log('Repository indexing completed', {
        filesProcessed: filesToIndex.length,
        documentsCreated,
        processingTime,
        averageTimePerFile: processingTime / filesToIndex.length
      });
      
      return {
        success: true,
        filesProcessed: filesToIndex.length,
        documentsCreated,
        processingTime,
        embeddingGenerationTime: totalEmbeddingTime,
        stats: this.getStats()
      };
      
    } catch (error) {
      this.stats.indexingErrors++;
      this.log(`Repository indexing failed: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Discover repository files matching include/exclude patterns
   * @private
   * @returns {Promise<Array<string>>} Array of file paths
   */
  async discoverRepositoryFiles() {
    const allFiles = [];
    
    // Use glob patterns to find matching files
    for (const pattern of this.config.repository.includePatterns) {
      const globPattern = path.join(this.config.repository.rootPath, '**', pattern);
      const files = await glob(globPattern, {
        ignore: this.config.repository.excludePatterns.map(exclude => 
          path.join(this.config.repository.rootPath, exclude)
        ),
        nodir: true,
        follow: false // Don't follow symlinks
      });
      
      allFiles.push(...files);
    }
    
    // Remove duplicates and filter by file size
    const uniqueFiles = [...new Set(allFiles)];
    const validFiles = [];
    
    for (const filePath of uniqueFiles) {
      try {
        const stats = fs.statSync(filePath);
        const sizeMB = stats.size / (1024 * 1024);
        
        if (sizeMB <= this.config.repository.maxFileSizeMB) {
          validFiles.push(filePath);
        } else {
          this.log(`Skipping large file: ${filePath} (${sizeMB.toFixed(2)}MB)`);
        }
      } catch (error) {
        this.log(`Error checking file: ${filePath} - ${error.message}`, { error: true });
      }
    }
    
    return validFiles;
  }
  
  /**
   * Filter files that have changed since last indexing
   * @private
   * @param {Array<string>} files - Array of file paths
   * @returns {Promise<Array<string>>} Files that need reindexing
   */
  async filterChangedFiles(files) {
    const changedFiles = [];
    
    for (const filePath of files) {
      try {
        const stats = fs.statSync(filePath);
        const contentHash = await this.getFileContentHash(filePath);
        
        // Check if file exists in index with same hash
        const existingDoc = await this.findDocumentByPath(filePath);
        
        if (!existingDoc || existingDoc.payload.content_hash !== contentHash) {
          changedFiles.push(filePath);
        }
      } catch (error) {
        // If we can't determine status, include file for indexing
        changedFiles.push(filePath);
        this.log(`Error checking file status: ${filePath} - ${error.message}`);
      }
    }
    
    return changedFiles;
  }
  
  /**
   * Process a batch of files for indexing
   * @private
   * @param {Array<string>} files - Batch of file paths
   * @returns {Promise<Object>} Batch processing results
   */
  async processBatch(files) {
    const documents = [];
    const texts = [];
    const fileData = [];
    
    // Prepare batch data
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const contentType = this.determineContentType(filePath);
        const title = this.extractTitle(content, filePath);
        const excerpt = content.substring(0, 200);
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        
        texts.push(content);
        fileData.push({
          filePath,
          content,
          contentType,
          title,
          excerpt,
          contentHash
        });
        
      } catch (error) {
        this.log(`Error reading file: ${filePath} - ${error.message}`, { error: true });
        this.stats.indexingErrors++;
      }
    }
    
    if (texts.length === 0) {
      return { documentsCreated: 0, embeddingTime: 0 };
    }
    
    // Generate embeddings for batch
    const embeddingStartTime = Date.now();
    const embeddings = await this.embeddingGenerator.generateBatchEmbeddings(texts);
    const embeddingTime = Date.now() - embeddingStartTime;
    
    // Create documents for Qdrant
    for (let i = 0; i < embeddings.length; i++) {
      const embedding = embeddings[i];
      const data = fileData[i];
      
      if (embedding && data) {
        const relativePath = path.relative(this.config.repository.rootPath, data.filePath);
        
        documents.push({
          id: crypto.randomUUID(),
          vector: embedding,
          payload: {
            file_path: relativePath,
            content_type: data.contentType,
            content_hash: data.contentHash,
            title: data.title,
            excerpt: data.excerpt,
            indexed_at: new Date().toISOString(),
            repository: 'coding_infrastructure',
            full_path: data.filePath
          }
        });
      }
    }
    
    // Store in Qdrant
    if (documents.length > 0) {
      await this.qdrant.upsert(this.config.qdrant.collection, {
        wait: true, // Ensure consistency for batch operations
        points: documents
      });
    }
    
    return {
      documentsCreated: documents.length,
      embeddingTime
    };
  }
  
  /**
   * Determine content type from file path
   * @private
   */
  determineContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath).toLowerCase();
    
    if (basename.startsWith('readme')) return 'readme';
    if (basename === 'claude.md') return 'instructions';
    if (basename === 'changelog.md' || basename.includes('changelog')) return 'changelog';
    if (ext === '.md') return 'documentation';
    if (ext === '.js') return 'source_code';
    
    return 'unknown';
  }
  
  /**
   * Extract title from content or use filename
   * @private
   */
  extractTitle(content, filePath) {
    // Try to extract markdown title
    const lines = content.split('\n');
    for (const line of lines.slice(0, 10)) {
      const titleMatch = line.match(/^#\s+(.+)$/);
      if (titleMatch) {
        return titleMatch[1].trim();
      }
    }
    
    // Use filename as fallback
    return path.basename(filePath);
  }
  
  /**
   * Get content hash for file
   * @private
   */
  async getFileContentHash(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  /**
   * Find existing document by file path
   * @private
   */
  async findDocumentByPath(filePath) {
    try {
      const relativePath = path.relative(this.config.repository.rootPath, filePath);
      
      const results = await this.qdrant.scroll(this.config.qdrant.collection, {
        filter: {
          must: [{
            key: "file_path",
            match: { value: relativePath }
          }]
        },
        limit: 1,
        with_payload: true
      });
      
      return results.points.length > 0 ? results.points[0] : null;
    } catch (error) {
      this.log(`Error finding document: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Update incremental index with changed files
   * @param {Array<string>} changedFiles - Array of changed file paths
   * @returns {Promise<Object>} Update results
   */
  async updateIndex(changedFiles) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const startTime = Date.now();
    
    try {
      this.log(`Starting incremental index update for ${changedFiles.length} files`);
      
      // Remove old documents for changed files
      for (const filePath of changedFiles) {
        await this.removeDocumentByPath(filePath);
      }
      
      // Process changed files in batches
      let documentsCreated = 0;
      
      for (let i = 0; i < changedFiles.length; i += this.config.repository.batchSize) {
        const batch = changedFiles.slice(i, i + this.config.repository.batchSize);
        const batchResults = await this.processBatch(batch);
        documentsCreated += batchResults.documentsCreated;
      }
      
      const processingTime = Date.now() - startTime;
      
      this.log('Incremental index update completed', {
        filesUpdated: changedFiles.length,
        documentsCreated,
        processingTime
      });
      
      return {
        success: true,
        filesUpdated: changedFiles.length,
        documentsCreated,
        processingTime
      };
      
    } catch (error) {
      this.log(`Incremental index update failed: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Remove document by file path
   * @private
   */
  async removeDocumentByPath(filePath) {
    try {
      const relativePath = path.relative(this.config.repository.rootPath, filePath);
      
      await this.qdrant.deletePoints(this.config.qdrant.collection, {
        filter: {
          must: [{
            key: "file_path",
            match: { value: relativePath }
          }]
        }
      });
    } catch (error) {
      this.log(`Error removing document: ${filePath} - ${error.message}`);
    }
  }
  
  /**
   * Check if repository index is current
   * @returns {Promise<boolean>} True if index is current
   */
  async isIndexCurrent() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      const files = await this.discoverRepositoryFiles();
      const changedFiles = await this.filterChangedFiles(files);
      
      return changedFiles.length === 0;
    } catch (error) {
      this.log(`Error checking index status: ${error.message}`, { error: true });
      return false;
    }
  }
  
  /**
   * Get collection information and statistics
   * @returns {Promise<Object>} Collection info and stats
   */
  async getCollectionInfo() {
    try {
      const info = await this.qdrant.getCollection(this.config.qdrant.collection);
      return {
        collection: info,
        stats: this.getStats(),
        embeddingStats: this.embeddingGenerator.getStats()
      };
    } catch (error) {
      this.log(`Error getting collection info: ${error.message}`, { error: true });
      throw error;
    }
  }
  
  /**
   * Detect repository path from environment or current directory
   * @private
   */
  detectRepositoryPath() {
    // Try environment variable first (from PathAnalyzer pattern)
    if (process.env.CODING_REPO) {
      return process.env.CODING_REPO;
    }
    
    // Try current working directory
    let currentDir = process.cwd();
    
    // Look for coding repository indicators
    while (currentDir !== path.dirname(currentDir)) {
      if (fs.existsSync(path.join(currentDir, 'package.json')) &&
          fs.existsSync(path.join(currentDir, 'src'))) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    
    // Default fallback
    return process.cwd();
  }
  
  /**
   * Update performance statistics
   * @private
   */
  updateStats(data) {
    this.stats.filesIndexed += data.filesIndexed || 0;
    this.stats.documentsCreated += data.documentsCreated || 0;
    this.stats.totalProcessingTime += data.processingTime || 0;
    this.stats.embeddingGenerationTime += data.embeddingTime || 0;
    this.stats.lastIndexingTime = new Date().toISOString();
    
    if (this.stats.filesIndexed > 0) {
      this.stats.averageFileTime = this.stats.totalProcessingTime / this.stats.filesIndexed;
    }
    
    // Get embedding cache stats
    const embeddingStats = this.embeddingGenerator.getStats();
    this.stats.cacheHitRate = embeddingStats.cache.hitRate;
  }
  
  /**
   * Get current statistics
   * @returns {Object} Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      initialized: this.initialized,
      repositoryPath: this.config.repository.rootPath,
      collection: this.config.qdrant.collection
    };
  }
  
  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.embeddingGenerator && this.embeddingGenerator.cleanup) {
        await this.embeddingGenerator.cleanup();
      }
      
      this.initialized = false;
      this.log('RepositoryIndexer cleanup completed');
    } catch (error) {
      this.log(`Cleanup error: ${error.message}`, { error: true });
    }
  }
  
  /**
   * Debug logging
   * @private
   */
  log(message, data = {}) {
    if (this.config.debug) {
      console.log(`[RepositoryIndexer] ${message}`, data);
    }
  }
}

module.exports = RepositoryIndexer;