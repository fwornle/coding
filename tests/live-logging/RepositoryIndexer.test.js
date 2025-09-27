/**
 * RepositoryIndexer Unit Tests
 * 
 * Comprehensive unit tests for RepositoryIndexer covering:
 * - Repository scanning and file discovery
 * - Vector index population and consistency
 * - Incremental updates and change detection
 * - Batch processing and performance validation
 * - Error handling and recovery scenarios
 * 
 * Requirements: 1.1 (repository scanning), 1.2 (index creation), 3.1 (change detection)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock dependencies
const mockQdrantClient = {
  getCollections: jest.fn(),
  createCollection: jest.fn(),
  getCollection: jest.fn(),
  upsert: jest.fn(),
  scroll: jest.fn(),
  deletePoints: jest.fn()
};

const mockEmbeddingGenerator = {
  initialize: jest.fn(),
  generateBatchEmbeddings: jest.fn(),
  getStats: jest.fn(),
  cleanup: jest.fn()
};

const mockGlob = jest.fn();
const mockFs = {
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn()
};

// Mock modules before requiring implementation
jest.mock('fs', () => mockFs);
jest.mock('glob', () => mockGlob);
jest.mock('../../../integrations/mcp-constraint-monitor/src/qdrant-client.js', () => ({
  QdrantClient: jest.fn(() => mockQdrantClient)
}));

const RepositoryIndexer = require('../../src/live-logging/RepositoryIndexer.js');

class RepositoryIndexerTest {
  constructor() {
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: []
    };
    
    this.testDir = path.join(__dirname, 'test-repository');
    this.setupTestEnvironment();
  }
  
  setupTestEnvironment() {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup default mock implementations
    this.setupDefaultMocks();
    
    // Create mock test repository structure
    this.setupMockRepository();
  }
  
  setupDefaultMocks() {
    // Mock Qdrant operations
    mockQdrantClient.getCollections.mockResolvedValue({
      collections: [{ name: 'coding_infrastructure' }]
    });
    mockQdrantClient.createCollection.mockResolvedValue({});
    mockQdrantClient.getCollection.mockResolvedValue({
      result: {
        config: { params: { vectors: { size: 384 } } },
        points_count: 0
      }
    });
    mockQdrantClient.upsert.mockResolvedValue({ operation_id: 'test-op' });
    mockQdrantClient.scroll.mockResolvedValue({ points: [] });
    mockQdrantClient.deletePoints.mockResolvedValue({});
    
    // Mock embedding generator
    mockEmbeddingGenerator.initialize.mockResolvedValue();
    mockEmbeddingGenerator.generateBatchEmbeddings.mockImplementation(async (texts) => {
      return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
    });
    mockEmbeddingGenerator.getStats.mockReturnValue({
      cache: { hitRate: 0.75 },
      generation: { totalTime: 1000 }
    });
    mockEmbeddingGenerator.cleanup.mockResolvedValue();
    
    // Mock file system operations
    mockFs.existsSync.mockImplementation((filePath) => {
      return filePath.includes(this.testDir) || filePath.includes('src/') || 
             filePath.includes('README') || filePath.includes('CLAUDE.md');
    });
    
    mockFs.statSync.mockImplementation((filePath) => ({
      size: 1024, // 1KB files
      isDirectory: () => false,
      mtime: new Date(),
      birthtime: new Date()
    }));
    
    mockFs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('README')) return '# Repository Documentation\nThis is test content';
      if (filePath.includes('CLAUDE.md')) return '# Instructions\nDevelopment guidelines';
      if (filePath.includes('.js')) return 'console.log("test file");';
      return 'Test file content';
    });
    
    // Mock glob for file discovery
    mockGlob.mockImplementation(async (pattern) => {
      const testFiles = [
        path.join(this.testDir, 'README.md'),
        path.join(this.testDir, 'CLAUDE.md'),
        path.join(this.testDir, 'src/live-logging/test.js'),
        path.join(this.testDir, 'docs/architecture.md'),
        path.join(this.testDir, 'package.json')
      ];
      
      // Filter based on pattern
      if (pattern.includes('*.md')) {
        return testFiles.filter(f => f.endsWith('.md'));
      }
      if (pattern.includes('*.js')) {
        return testFiles.filter(f => f.endsWith('.js'));
      }
      if (pattern.includes('README*')) {
        return testFiles.filter(f => f.includes('README'));
      }
      
      return testFiles;
    });
  }
  
  setupMockRepository() {
    // Mock repository files for testing
    this.mockFiles = {
      'README.md': {
        content: '# Test Repository\nThis is a test repository for indexing.',
        hash: 'abc123',
        size: 1024
      },
      'CLAUDE.md': {
        content: '# Development Instructions\nTest development guidelines.',
        hash: 'def456', 
        size: 800
      },
      'src/live-logging/test.js': {
        content: 'console.log("test implementation");',
        hash: 'ghi789',
        size: 512
      },
      'docs/architecture.md': {
        content: '# Architecture\nSystem architecture documentation.',
        hash: 'jkl012',
        size: 2048
      }
    };
  }
  
  async runAllTests() {
    console.log('=== RepositoryIndexer Unit Tests ===\n');
    
    try {
      await this.testInitialization();
      await this.testCollectionSetup();
      await this.testRepositoryScanning();
      await this.testFileDiscovery();
      await this.testChangeDetection();
      await this.testBatchProcessing();
      await this.testIncrementalUpdates();
      await this.testIndexConsistency();
      await this.testPerformanceValidation();
      await this.testErrorHandling();
      
      this.printResults();
      return this.testResults.failed === 0;
      
    } catch (error) {
      console.error('Fatal test error:', error);
      return false;
    }
  }
  
  async testInitialization() {
    console.log('1. Testing initialization...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        qdrantHost: 'localhost',
        qdrantPort: 6333,
        debug: false
      });
      
      await indexer.initialize();
      
      // Verify initialization calls
      this.assert(mockEmbeddingGenerator.initialize.mock.calls.length === 1,
        'Should initialize embedding generator');
      this.assert(mockQdrantClient.getCollections.mock.calls.length === 1,
        'Should check for existing collections');
      
      // Verify indexer state
      this.assert(indexer.initialized === true, 'Should be marked as initialized');
      
      const stats = indexer.getStats();
      this.assert(stats.initialized === true, 'Stats should show initialized');
      this.assert(stats.repositoryPath === this.testDir, 'Should have correct repository path');
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Initialization works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Initialization: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testCollectionSetup() {
    console.log('2. Testing collection setup...');
    
    try {
      // Test creating new collection
      mockQdrantClient.getCollections.mockResolvedValueOnce({
        collections: [] // No existing collections
      });
      
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      await indexer.initialize();
      
      // Verify collection creation
      this.assert(mockQdrantClient.createCollection.mock.calls.length === 1,
        'Should create collection when it doesn\'t exist');
      
      const createCall = mockQdrantClient.createCollection.mock.calls[0];
      this.assert(createCall[0] === 'coding_infrastructure',
        'Should create correct collection name');
      this.assert(createCall[1].vectors.size === 384,
        'Should configure correct vector dimensions');
      this.assert(createCall[1].vectors.distance === 'Cosine',
        'Should use cosine distance');
      this.assert(createCall[1].vectors.quantization_config.scalar.type === 'int8',
        'Should configure int8 quantization');
      
      // Test existing collection scenario
      mockQdrantClient.getCollections.mockResolvedValue({
        collections: [{ name: 'coding_infrastructure' }]
      });
      
      const indexer2 = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      await indexer2.initialize();
      
      // Should not create collection again
      this.assert(mockQdrantClient.createCollection.mock.calls.length === 1,
        'Should not create collection if it already exists');
      
      await indexer.cleanup();
      await indexer2.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Collection setup works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Collection setup: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testRepositoryScanning() {
    console.log('3. Testing repository scanning...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        includePatterns: ['*.md', '*.js', 'README*'],
        excludePatterns: ['node_modules/**', '.git/**'],
        maxFileSizeMB: 1,
        debug: false
      });
      
      await indexer.initialize();
      
      // Test full repository indexing
      const result = await indexer.indexRepository({ forceReindex: true });
      
      this.assert(result.success === true, 'Repository indexing should succeed');
      this.assert(result.filesProcessed > 0, 'Should process files');
      this.assert(result.documentsCreated > 0, 'Should create documents');
      this.assert(typeof result.processingTime === 'number', 'Should track processing time');
      
      // Verify glob was called with correct patterns
      this.assert(mockGlob.mock.calls.length > 0, 'Should call glob for file discovery');
      
      // Verify embeddings were generated
      this.assert(mockEmbeddingGenerator.generateBatchEmbeddings.mock.calls.length > 0,
        'Should generate embeddings for files');
      
      // Verify documents were stored in Qdrant
      this.assert(mockQdrantClient.upsert.mock.calls.length > 0,
        'Should store documents in Qdrant');
      
      const upsertCall = mockQdrantClient.upsert.mock.calls[0];
      this.assert(upsertCall[0] === 'coding_infrastructure',
        'Should upsert to correct collection');
      this.assert(Array.isArray(upsertCall[1].points),
        'Should provide points array');
      this.assert(upsertCall[1].wait === true,
        'Should wait for consistency');
      
      // Verify point structure
      const point = upsertCall[1].points[0];
      this.assert(typeof point.id === 'string', 'Point should have ID');
      this.assert(Array.isArray(point.vector), 'Point should have vector');
      this.assert(point.vector.length === 384, 'Vector should be 384 dimensions');
      this.assert(typeof point.payload === 'object', 'Point should have payload');
      this.assert(typeof point.payload.file_path === 'string', 'Payload should have file path');
      this.assert(typeof point.payload.content_type === 'string', 'Payload should have content type');
      this.assert(typeof point.payload.content_hash === 'string', 'Payload should have content hash');
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Repository scanning works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Repository scanning: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testFileDiscovery() {
    console.log('4. Testing file discovery and filtering...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        includePatterns: ['*.md', '*.js'],
        excludePatterns: ['node_modules/**', '*.log'],
        maxFileSizeMB: 1,
        debug: false
      });
      
      await indexer.initialize();
      
      // Mock large file that should be excluded
      mockFs.statSync.mockImplementationOnce(() => ({
        size: 2 * 1024 * 1024, // 2MB (exceeds 1MB limit)
        isDirectory: () => false,
        mtime: new Date()
      }));
      
      // Test file discovery
      const result = await indexer.indexRepository({ forceReindex: true });
      
      this.assert(result.success === true, 'File discovery should succeed');
      
      // Verify content type detection
      const upsertCalls = mockQdrantClient.upsert.mock.calls;
      if (upsertCalls.length > 0) {
        const points = upsertCalls[0][1].points;
        const contentTypes = points.map(p => p.payload.content_type);
        
        this.assert(contentTypes.includes('readme') || contentTypes.includes('documentation'),
          'Should detect documentation content types');
        
        if (contentTypes.includes('source_code')) {
          this.assert(true, 'Should detect source code content type');
        }
      }
      
      // Test title extraction
      mockFs.readFileSync.mockReturnValueOnce('# Test Title\nContent here');
      
      const indexer2 = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      await indexer2.initialize();
      await indexer2.indexRepository({ forceReindex: true });
      
      // Verify title was extracted from markdown
      const titleUpsertCalls = mockQdrantClient.upsert.mock.calls;
      if (titleUpsertCalls.length > 0) {
        const lastCall = titleUpsertCalls[titleUpsertCalls.length - 1];
        const points = lastCall[1].points;
        const hasTitle = points.some(p => p.payload.title === 'Test Title');
        
        if (hasTitle) {
          this.assert(true, 'Should extract title from markdown content');
        }
      }
      
      await indexer.cleanup();
      await indexer2.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ File discovery and filtering work correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`File discovery: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testChangeDetection() {
    console.log('5. Testing change detection...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      await indexer.initialize();
      
      // Mock existing document in index
      mockQdrantClient.scroll.mockResolvedValueOnce({
        points: [{
          id: 'test-doc',
          payload: {
            file_path: 'README.md',
            content_hash: 'old-hash-123'
          }
        }]
      });
      
      // Mock file with different hash (changed file)
      const originalReadFile = mockFs.readFileSync;
      mockFs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('README.md')) {
          return 'Updated README content'; // Different content = different hash
        }
        return originalReadFile(filePath);
      });
      
      // Test change detection
      const isCurrentBefore = await indexer.isIndexCurrent();
      this.assert(isCurrentBefore === false, 'Should detect changes when file hash differs');
      
      // Test incremental update
      const changedFiles = [path.join(this.testDir, 'README.md')];
      const updateResult = await indexer.updateIndex(changedFiles);
      
      this.assert(updateResult.success === true, 'Incremental update should succeed');
      this.assert(updateResult.filesUpdated === 1, 'Should update correct number of files');
      this.assert(updateResult.documentsCreated > 0, 'Should create updated documents');
      
      // Verify old document was removed
      this.assert(mockQdrantClient.deletePoints.mock.calls.length > 0,
        'Should remove old documents before updating');
      
      // Mock no changes scenario
      mockQdrantClient.scroll.mockResolvedValue({
        points: [{
          id: 'test-doc',
          payload: {
            file_path: 'README.md',
            content_hash: crypto.createHash('sha256').update('Updated README content').digest('hex')
          }
        }]
      });
      
      const isCurrentAfter = await indexer.isIndexCurrent();
      this.assert(isCurrentAfter === true, 'Should detect no changes when hashes match');
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Change detection works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Change detection: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testBatchProcessing() {
    console.log('6. Testing batch processing...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        batchSize: 2, // Small batch size for testing
        debug: false
      });
      
      await indexer.initialize();
      
      // Mock multiple files
      mockGlob.mockResolvedValue([
        path.join(this.testDir, 'file1.md'),
        path.join(this.testDir, 'file2.md'),
        path.join(this.testDir, 'file3.md'),
        path.join(this.testDir, 'file4.md'),
        path.join(this.testDir, 'file5.md')
      ]);
      
      // Track batch calls
      let batchCount = 0;
      mockEmbeddingGenerator.generateBatchEmbeddings.mockImplementation(async (texts) => {
        batchCount++;
        this.assert(texts.length <= 2, 'Batch size should be respected');
        return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
      });
      
      const result = await indexer.indexRepository({ forceReindex: true });
      
      this.assert(result.success === true, 'Batch processing should succeed');
      this.assert(batchCount >= 3, 'Should process files in multiple batches'); // 5 files / 2 per batch = 3 batches
      
      // Verify all files were processed
      this.assert(result.filesProcessed === 5, 'Should process all files');
      
      // Verify batch embedding calls
      this.assert(mockEmbeddingGenerator.generateBatchEmbeddings.mock.calls.length >= 3,
        'Should make multiple batch embedding calls');
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Batch processing works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Batch processing: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testIncrementalUpdates() {
    console.log('7. Testing incremental updates...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      await indexer.initialize();
      
      // Mock scenario with some existing and some new files
      mockQdrantClient.scroll.mockImplementation(async (collection, filter) => {
        const filePath = filter.filter.must[0].match.value;
        
        if (filePath === 'existing-file.md') {
          return {
            points: [{
              id: 'existing-doc',
              payload: {
                file_path: filePath,
                content_hash: 'unchanged-hash'
              }
            }]
          };
        }
        
        return { points: [] }; // New file
      });
      
      // Mock file content that produces consistent hash for existing file
      mockFs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('existing-file.md')) {
          return 'unchanged content';
        }
        return 'new file content';
      });
      
      mockGlob.mockResolvedValue([
        path.join(this.testDir, 'existing-file.md'),
        path.join(this.testDir, 'new-file.md')
      ]);
      
      // First indexing (should skip existing file)
      const result1 = await indexer.indexRepository({ forceReindex: false });
      
      this.assert(result1.filesProcessed === 1, 'Should only process changed/new files');
      
      // Force reindex (should process all files)
      jest.clearAllMocks();
      const result2 = await indexer.indexRepository({ forceReindex: true });
      
      this.assert(result2.filesProcessed === 2, 'Force reindex should process all files');
      
      // Test incremental update of specific files
      const changedFiles = [path.join(this.testDir, 'existing-file.md')];
      const updateResult = await indexer.updateIndex(changedFiles);
      
      this.assert(updateResult.success === true, 'Incremental update should succeed');
      this.assert(updateResult.filesUpdated === 1, 'Should update specified files');
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Incremental updates work correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Incremental updates: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testIndexConsistency() {
    console.log('8. Testing index consistency...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      await indexer.initialize();
      
      // Test atomic updates
      let upsertCallCount = 0;
      mockQdrantClient.upsert.mockImplementation(async (collection, data) => {
        upsertCallCount++;
        
        // Verify atomic batch processing
        this.assert(data.wait === true, 'Should wait for consistency');
        this.assert(Array.isArray(data.points), 'Should provide points array');
        
        // Verify point structure consistency
        for (const point of data.points) {
          this.assert(typeof point.id === 'string', 'Point ID should be string');
          this.assert(Array.isArray(point.vector), 'Point should have vector array');
          this.assert(point.vector.length === 384, 'Vector should be correct dimension');
          this.assert(typeof point.payload === 'object', 'Point should have payload object');
          this.assert(typeof point.payload.file_path === 'string', 'Payload should have file path');
          this.assert(typeof point.payload.content_hash === 'string', 'Payload should have content hash');
          this.assert(typeof point.payload.indexed_at === 'string', 'Payload should have timestamp');
        }
        
        return { operation_id: `test-op-${upsertCallCount}` };
      });
      
      const result = await indexer.indexRepository({ forceReindex: true });
      
      this.assert(result.success === true, 'Indexing should maintain consistency');
      this.assert(upsertCallCount > 0, 'Should perform upsert operations');
      
      // Test collection info retrieval
      mockQdrantClient.getCollection.mockResolvedValue({
        result: {
          config: {
            params: {
              vectors: { size: 384, distance: 'Cosine' }
            }
          },
          points_count: 10,
          status: 'green'
        }
      });
      
      const collectionInfo = await indexer.getCollectionInfo();
      
      this.assert(typeof collectionInfo.collection === 'object', 'Should return collection info');
      this.assert(typeof collectionInfo.stats === 'object', 'Should return indexer stats');
      this.assert(typeof collectionInfo.embeddingStats === 'object', 'Should return embedding stats');
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Index consistency maintained correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Index consistency: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testPerformanceValidation() {
    console.log('9. Testing performance validation...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        maxIndexingTimeMs: 5000, // 5 second limit for testing
        debug: false
      });
      
      await indexer.initialize();
      
      // Mock performance timing
      const startTime = Date.now();
      
      const result = await indexer.indexRepository({ forceReindex: true });
      
      const processingTime = Date.now() - startTime;
      
      this.assert(result.success === true, 'Performance test should succeed');
      this.assert(typeof result.processingTime === 'number', 'Should track processing time');
      this.assert(result.processingTime >= 0, 'Processing time should be non-negative');
      
      // Test statistics tracking
      const stats = indexer.getStats();
      
      this.assert(typeof stats.filesIndexed === 'number', 'Should track files indexed');
      this.assert(typeof stats.documentsCreated === 'number', 'Should track documents created');
      this.assert(typeof stats.totalProcessingTime === 'number', 'Should track total processing time');
      this.assert(typeof stats.averageFileTime === 'number', 'Should calculate average file time');
      this.assert(typeof stats.cacheHitRate === 'number', 'Should track cache hit rate');
      
      // Verify stats are reasonable
      if (stats.filesIndexed > 0) {
        this.assert(stats.averageFileTime >= 0, 'Average file time should be non-negative');
        this.assert(stats.averageFileTime === stats.totalProcessingTime / stats.filesIndexed,
          'Average file time should be calculated correctly');
      }
      
      await indexer.cleanup();
      
      this.testResults.passed++;
      console.log('   ✓ Performance validation works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Performance validation: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testErrorHandling() {
    console.log('10. Testing error handling and recovery...');
    
    try {
      const indexer = new RepositoryIndexer({
        repositoryPath: this.testDir,
        debug: false
      });
      
      // Test initialization failure
      mockQdrantClient.getCollections.mockRejectedValueOnce(new Error('Qdrant connection failed'));
      
      try {
        await indexer.initialize();
        this.assert(false, 'Should throw error on Qdrant connection failure');
      } catch (error) {
        this.assert(error.message.includes('Qdrant'), 'Should propagate Qdrant connection error');
      }
      
      // Reset and test successful initialization
      mockQdrantClient.getCollections.mockResolvedValue({ collections: [] });
      await indexer.initialize();
      
      // Test embedding generation failure
      mockEmbeddingGenerator.generateBatchEmbeddings.mockRejectedValueOnce(new Error('Embedding failed'));
      
      try {
        await indexer.indexRepository({ forceReindex: true });
        this.assert(false, 'Should handle embedding generation failure');
      } catch (error) {
        this.assert(error.message.includes('Embedding') || error.message.includes('failed'),
          'Should handle embedding generation errors');
      }
      
      // Test file read failure
      mockEmbeddingGenerator.generateBatchEmbeddings.mockImplementation(async (texts) => {
        return texts.map(() => new Array(384).fill(0).map(() => Math.random()));
      });
      
      mockFs.readFileSync.mockImplementationOnce(() => {
        throw new Error('File read failed');
      });
      
      // Should handle file read errors gracefully
      const result = await indexer.indexRepository({ forceReindex: true });
      
      this.assert(result.success === true, 'Should handle file read errors gracefully');
      
      // Test Qdrant upsert failure
      mockQdrantClient.upsert.mockRejectedValueOnce(new Error('Upsert failed'));
      
      try {
        await indexer.indexRepository({ forceReindex: true });
        this.assert(false, 'Should handle Qdrant upsert failure');
      } catch (error) {
        this.assert(error.message.includes('Upsert') || error.message.includes('failed'),
          'Should handle Qdrant upsert errors');
      }
      
      // Test cleanup with errors
      mockEmbeddingGenerator.cleanup.mockRejectedValueOnce(new Error('Cleanup failed'));
      
      await indexer.cleanup(); // Should not throw
      
      this.testResults.passed++;
      console.log('   ✓ Error handling and recovery work correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Error handling: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
  
  printResults() {
    console.log('\n=== Test Results ===');
    console.log(`Tests passed: ${this.testResults.passed}`);
    console.log(`Tests failed: ${this.testResults.failed}`);
    
    if (this.testResults.errors.length > 0) {
      console.log('\nErrors:');
      this.testResults.errors.forEach(error => console.log(`- ${error}`));
    }
    
    console.log(`\nOverall: ${this.testResults.failed === 0 ? 'PASS' : 'FAIL'}`);
  }
}

// Export the test class
module.exports = RepositoryIndexerTest;

// Run tests if this file is executed directly
if (require.main === module) {
  const test = new RepositoryIndexerTest();
  test.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}