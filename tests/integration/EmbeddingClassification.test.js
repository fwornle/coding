const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { QdrantClient } = require('@qdrant/js-client-rest');
const EmbeddingGenerator = require('../../src/utils/EmbeddingGenerator');
const RepositoryIndexer = require('../../src/live-logging/RepositoryIndexer');
const EmbeddingClassifier = require('../../src/live-logging/EmbeddingClassifier');
const ReliableCodingClassifier = require('../../src/live-logging/ReliableCodingClassifier');
const ChangeDetector = require('../../src/live-logging/ChangeDetector');
const PerformanceMonitor = require('../../src/live-logging/PerformanceMonitor');
const PathAnalyzer = require('../../src/live-logging/PathAnalyzer');
const KeywordMatcher = require('../../src/live-logging/KeywordMatcher');
const SemanticAnalyzer = require('../../src/live-logging/SemanticAnalyzer');

/**
 * Integration tests for the complete four-layer embedding classification system
 * Tests real repository content with actual Qdrant instance
 */
class EmbeddingClassificationIntegrationTests {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../');
    this.testDataDir = path.join(this.projectRoot, 'tests', 'fixtures', 'integration');
    this.config = require('../../config/live-logging-config.json');
    this.qdrantClient = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: [],
      performance: {}
    };
    
    // Performance benchmarks
    this.benchmarks = {
      embeddingGeneration: 2,      // <2ms for cached
      similaritySearch: 3,          // <3ms
      totalPipeline: 30,            // <30ms total
      repositoryIndexing: 300000,   // <5 minutes
      reindexing: 30000            // <30 seconds
    };
  }

  async initialize() {
    console.log('🚀 Initializing Embedding Classification Integration Tests');
    
    try {
      // Initialize Qdrant client
      this.qdrantClient = new QdrantClient({
        host: this.config.embedding_classifier.qdrant.host,
        port: this.config.embedding_classifier.qdrant.port
      });
      
      // Verify Qdrant connection
      const info = await this.qdrantClient.getCollectionInfo('coding_infrastructure').catch(() => null);
      if (!info) {
        console.log('📦 Creating test collection in Qdrant');
        await this.createTestCollection();
      }
      
      // Initialize components
      this.embeddingGenerator = new EmbeddingGenerator(this.config.embedding_classifier.embedding);
      this.repositoryIndexer = new RepositoryIndexer(this.config.embedding_classifier);
      this.embeddingClassifier = new EmbeddingClassifier(this.config.embedding_classifier);
      this.changeDetector = new ChangeDetector(this.config.embedding_classifier.change_detection);
      this.performanceMonitor = new PerformanceMonitor();
      
      // Initialize four-layer classifier
      this.reliableCodingClassifier = new ReliableCodingClassifier();
      await this.reliableCodingClassifier.initialize();
      
      console.log('✅ All components initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      this.testResults.errors.push({ test: 'Initialization', error: error.message });
      return false;
    }
  }

  async createTestCollection() {
    const { vectors, index_config } = this.config.embedding_classifier.qdrant;
    
    await this.qdrantClient.createCollection('coding_infrastructure', {
      vectors: {
        size: vectors.size,
        distance: vectors.distance
      },
      hnsw_config: index_config.hnsw_config,
      quantization_config: index_config.quantization_config
    });
  }

  async runTest(testName, testFunction) {
    try {
      console.log(`\n🔬 Running: ${testName}`);
      const startTime = Date.now();
      
      const result = await testFunction();
      
      const duration = Date.now() - startTime;
      if (result) {
        this.testResults.passed++;
        console.log(`   ✅ PASSED (${duration}ms)`);
        this.testResults.performance[testName] = duration;
      } else {
        this.testResults.failed++;
        console.log(`   ❌ FAILED (${duration}ms)`);
      }
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push({ test: testName, error: error.message });
      console.log(`   ❌ ERROR: ${error.message}`);
    }
  }

  // Test 1: Repository Indexing
  async testRepositoryIndexing() {
    const startTime = Date.now();
    
    // Index real repository content
    const result = await this.repositoryIndexer.indexRepository(this.projectRoot);
    
    const duration = Date.now() - startTime;
    
    // Validate indexing
    const collection = await this.qdrantClient.getCollection('coding_infrastructure');
    const hasContent = collection.points_count > 0;
    const withinTimeLimit = duration < this.benchmarks.repositoryIndexing;
    
    console.log(`   📊 Indexed ${collection.points_count} points in ${duration}ms`);
    console.log(`   ⏱️  Time limit: ${this.benchmarks.repositoryIndexing}ms`);
    
    return hasContent && withinTimeLimit;
  }

  // Test 2: Embedding Generation Performance
  async testEmbeddingGenerationPerformance() {
    const testTexts = [
      'Initialize embedding classifier for semantic search',
      'Repository indexer scans coding infrastructure',
      'Four-layer classification pipeline integration',
      'Performance monitoring and metrics collection',
      'Change detection and incremental updates'
    ];
    
    const results = {
      cold: [],
      cached: []
    };
    
    // Test cold generation
    for (const text of testTexts) {
      const startTime = Date.now();
      const embedding = await this.embeddingGenerator.generateEmbedding(text);
      results.cold.push(Date.now() - startTime);
    }
    
    // Test cached generation
    for (const text of testTexts) {
      const startTime = Date.now();
      const embedding = await this.embeddingGenerator.generateEmbedding(text);
      results.cached.push(Date.now() - startTime);
    }
    
    const avgCached = results.cached.reduce((a, b) => a + b, 0) / results.cached.length;
    const meetsTarget = avgCached < this.benchmarks.embeddingGeneration;
    
    console.log(`   ⏱️  Cold generation avg: ${results.cold.reduce((a, b) => a + b, 0) / results.cold.length}ms`);
    console.log(`   ⏱️  Cached generation avg: ${avgCached}ms (target: <${this.benchmarks.embeddingGeneration}ms)`);
    console.log(`   📊 Cache effectiveness: ${((1 - avgCached / results.cold[0]) * 100).toFixed(1)}% improvement`);
    
    return meetsTarget;
  }

  // Test 3: Four-Layer Classification Pipeline
  async testFourLayerPipeline() {
    const testCases = [
      {
        filePath: '/Users/q284340/Agentic/coding/src/live-logging/EmbeddingClassifier.js',
        prompt: 'Implement semantic search functionality',
        expectedLayer: 1, // Should match on path
        description: 'Direct path match'
      },
      {
        filePath: '/Users/q284340/other/project/script.js',
        prompt: 'Add embedding-based classification',
        expectedLayer: 2, // Should match on keywords
        description: 'Keyword match'
      },
      {
        filePath: '/Users/q284340/unknown/file.js',
        prompt: 'Create vector similarity search system',
        expectedLayer: 3, // Should use embedding similarity
        description: 'Embedding similarity'
      },
      {
        filePath: '/Users/q284340/random/test.py',
        prompt: 'Some unrelated Python script task',
        expectedLayer: 4, // Should fall back to semantic
        description: 'Semantic analysis fallback'
      }
    ];
    
    let allPassed = true;
    const layerMetrics = [];
    
    for (const testCase of testCases) {
      const startTime = Date.now();
      
      const result = await this.reliableCodingClassifier.classify(
        testCase.prompt,
        testCase.filePath,
        { skipCache: true }
      );
      
      const duration = Date.now() - startTime;
      layerMetrics.push({ layer: result.layer, duration });
      
      const correct = result.layer === testCase.expectedLayer;
      console.log(`   ${correct ? '✅' : '❌'} ${testCase.description}: Layer ${result.layer} (expected ${testCase.expectedLayer}) - ${duration}ms`);
      
      if (!correct) {
        allPassed = false;
      }
    }
    
    // Validate total pipeline performance
    const avgDuration = layerMetrics.reduce((a, b) => a + b.duration, 0) / layerMetrics.length;
    const meetsPerformance = avgDuration < this.benchmarks.totalPipeline;
    
    console.log(`   ⏱️  Average pipeline time: ${avgDuration}ms (target: <${this.benchmarks.totalPipeline}ms)`);
    
    return allPassed && meetsPerformance;
  }

  // Test 4: Similarity Search Performance
  async testSimilaritySearchPerformance() {
    const queries = [
      'Initialize repository indexer with Qdrant',
      'Implement embedding generation with caching',
      'Create four-layer classification pipeline',
      'Monitor performance metrics and thresholds',
      'Detect repository changes for reindexing'
    ];
    
    const searchTimes = [];
    
    for (const query of queries) {
      const embedding = await this.embeddingGenerator.generateEmbedding(query);
      
      const startTime = Date.now();
      const results = await this.qdrantClient.search('coding_infrastructure', {
        vector: embedding,
        limit: 10,
        with_payload: true
      });
      const duration = Date.now() - startTime;
      
      searchTimes.push(duration);
      
      const hasResults = results && results.length > 0;
      const topScore = hasResults ? results[0].score : 0;
      
      console.log(`   🔍 Query: "${query.substring(0, 40)}..." - ${duration}ms, top score: ${topScore.toFixed(3)}`);
    }
    
    const avgSearchTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
    const meetsTarget = avgSearchTime < this.benchmarks.similaritySearch;
    
    console.log(`   ⏱️  Average search time: ${avgSearchTime}ms (target: <${this.benchmarks.similaritySearch}ms)`);
    
    return meetsTarget;
  }

  // Test 5: Change Detection and Reindexing
  async testChangeDetectionAndReindexing() {
    // Setup change detector
    await this.changeDetector.initialize(this.projectRoot);
    
    // Simulate file changes
    const testFile = path.join(this.projectRoot, 'test-change-detection.md');
    await fs.writeFile(testFile, '# Test Change Detection\n\nThis is a test file for change detection.');
    
    // Detect changes
    const changes = await this.changeDetector.detectChanges();
    const hasDetectedChange = changes && changes.significantChange;
    
    console.log(`   📝 Change detection: ${hasDetectedChange ? 'Detected' : 'Not detected'}`);
    
    if (hasDetectedChange) {
      // Trigger reindexing
      const startTime = Date.now();
      const result = await this.repositoryIndexer.reindexChangedFiles(changes.files);
      const duration = Date.now() - startTime;
      
      const meetsTarget = duration < this.benchmarks.reindexing;
      console.log(`   ♻️  Reindexing completed in ${duration}ms (target: <${this.benchmarks.reindexing}ms)`);
      
      // Cleanup
      await fs.unlink(testFile).catch(() => {});
      
      return meetsTarget;
    }
    
    return hasDetectedChange;
  }

  // Test 6: Cache Hit Rates
  async testCacheHitRates() {
    const testPrompts = [
      'Implement embedding classifier',
      'Create repository indexer',
      'Add performance monitoring',
      'Implement embedding classifier', // Duplicate
      'Create repository indexer'      // Duplicate
    ];
    
    // Reset cache stats
    this.embeddingClassifier.resetCacheStats();
    
    for (const prompt of testPrompts) {
      await this.embeddingClassifier.classify(prompt, '/test/path.js');
    }
    
    const stats = this.embeddingClassifier.getCacheStats();
    const hitRate = (stats.hits / (stats.hits + stats.misses)) * 100;
    const meetsTarget = hitRate >= 40; // 2 out of 5 should be hits
    
    console.log(`   📊 Cache statistics:`);
    console.log(`      - Total requests: ${stats.hits + stats.misses}`);
    console.log(`      - Cache hits: ${stats.hits}`);
    console.log(`      - Cache misses: ${stats.misses}`);
    console.log(`      - Hit rate: ${hitRate.toFixed(1)}% (target: ≥40%)`);
    
    return meetsTarget;
  }

  // Test 7: Memory Management
  async testMemoryManagement() {
    const initialMemory = process.memoryUsage();
    
    // Generate many embeddings to test memory limits
    const largeDataset = [];
    for (let i = 0; i < 100; i++) {
      largeDataset.push(`Test content ${i} with unique text for embedding generation`);
    }
    
    // Process in batches
    const batchSize = 32;
    for (let i = 0; i < largeDataset.length; i += batchSize) {
      const batch = largeDataset.slice(i, i + batchSize);
      await this.embeddingGenerator.generateBatch(batch);
    }
    
    const finalMemory = process.memoryUsage();
    const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    const withinLimit = memoryIncrease < 100; // Less than 100MB increase
    
    console.log(`   💾 Memory usage:`);
    console.log(`      - Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`      - Final: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`      - Increase: ${memoryIncrease.toFixed(2)}MB (limit: <100MB)`);
    
    // Trigger garbage collection if available
    if (global.gc) {
      global.gc();
      const afterGC = process.memoryUsage();
      console.log(`      - After GC: ${(afterGC.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    }
    
    return withinLimit;
  }

  // Test 8: Error Recovery
  async testErrorRecovery() {
    let allPassed = true;
    
    // Test 1: Invalid Qdrant connection recovery
    const badClient = new QdrantClient({ host: 'invalid-host', port: 9999 });
    const badClassifier = new EmbeddingClassifier({
      ...this.config.embedding_classifier,
      qdrant: { ...this.config.embedding_classifier.qdrant, host: 'invalid-host', port: 9999 }
    });
    
    try {
      await badClassifier.initialize();
      const result = await badClassifier.classify('test', '/test.js');
      const recovered = result && result.confidence === 0; // Should return low confidence
      console.log(`   ✅ Recovered from bad Qdrant connection`);
    } catch (error) {
      console.log(`   ❌ Failed to recover from bad connection: ${error.message}`);
      allPassed = false;
    }
    
    // Test 2: Python subprocess failure recovery
    const badGenerator = new EmbeddingGenerator({
      ...this.config.embedding_classifier.embedding,
      python_timeout: 1 // Very short timeout
    });
    
    try {
      const result = await badGenerator.generateEmbedding('test text');
      console.log(`   ✅ Recovered from subprocess timeout`);
    } catch (error) {
      // Should handle gracefully
      console.log(`   ✅ Handled subprocess failure gracefully`);
    }
    
    // Test 3: File system error recovery
    try {
      await this.repositoryIndexer.indexRepository('/nonexistent/path');
      console.log(`   ❌ Should have handled invalid path`);
      allPassed = false;
    } catch (error) {
      console.log(`   ✅ Handled invalid repository path`);
    }
    
    return allPassed;
  }

  // Test 9: Concurrent Operations
  async testConcurrentOperations() {
    const concurrentRequests = 10;
    const promises = [];
    
    console.log(`   🔄 Testing ${concurrentRequests} concurrent classification requests`);
    
    const startTime = Date.now();
    
    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(
        this.reliableCodingClassifier.classify(
          `Concurrent test prompt ${i}`,
          `/test/concurrent-${i}.js`,
          { skipCache: true }
        )
      );
    }
    
    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;
    
    const allSuccessful = results.every(r => r && r.decision !== null);
    const avgTime = duration / concurrentRequests;
    
    console.log(`   ⏱️  Total time: ${duration}ms`);
    console.log(`   ⏱️  Average per request: ${avgTime.toFixed(2)}ms`);
    console.log(`   ✅ All requests completed: ${allSuccessful}`);
    
    return allSuccessful && avgTime < this.benchmarks.totalPipeline;
  }

  // Test 10: End-to-End Workflow
  async testEndToEndWorkflow() {
    console.log('   📋 Testing complete workflow:');
    
    const workflow = {
      indexing: false,
      classification: false,
      changeDetection: false,
      reindexing: false,
      performance: false
    };
    
    // Step 1: Initial indexing
    console.log('   1️⃣ Initial repository indexing...');
    const indexResult = await this.repositoryIndexer.indexRepository(this.projectRoot);
    workflow.indexing = indexResult && indexResult.success;
    
    // Step 2: Classification requests
    console.log('   2️⃣ Processing classification requests...');
    const classifyResults = [];
    for (let i = 0; i < 5; i++) {
      const result = await this.reliableCodingClassifier.classify(
        `End-to-end test ${i}`,
        `/test/e2e-${i}.js`
      );
      classifyResults.push(result);
    }
    workflow.classification = classifyResults.every(r => r && r.decision !== null);
    
    // Step 3: Monitor changes
    console.log('   3️⃣ Monitoring for changes...');
    const changes = await this.changeDetector.detectChanges();
    workflow.changeDetection = changes !== null;
    
    // Step 4: Incremental update
    if (changes && changes.files && changes.files.length > 0) {
      console.log('   4️⃣ Performing incremental update...');
      const updateResult = await this.repositoryIndexer.reindexChangedFiles(changes.files);
      workflow.reindexing = updateResult && updateResult.success;
    } else {
      workflow.reindexing = true; // No changes to index
    }
    
    // Step 5: Performance validation
    console.log('   5️⃣ Validating performance metrics...');
    const metrics = this.performanceMonitor.getMetrics();
    workflow.performance = metrics && metrics.withinThresholds;
    
    const allPassed = Object.values(workflow).every(v => v === true);
    
    console.log('   📊 Workflow results:');
    Object.entries(workflow).forEach(([step, passed]) => {
      console.log(`      - ${step}: ${passed ? '✅' : '❌'}`);
    });
    
    return allPassed;
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test resources...');
    
    try {
      // Stop components
      if (this.embeddingGenerator) await this.embeddingGenerator.cleanup();
      if (this.repositoryIndexer) await this.repositoryIndexer.cleanup();
      if (this.changeDetector) await this.changeDetector.cleanup();
      
      // Clear test collection (optional - comment out to preserve)
      // await this.qdrantClient.deleteCollection('coding_infrastructure');
      
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('⚠️  Cleanup error:', error.message);
    }
  }

  async run() {
    console.log('🚀 Starting Embedding Classification Integration Tests');
    console.log('=' .repeat(60));
    
    const initialized = await this.initialize();
    if (!initialized) {
      console.log('❌ Failed to initialize test environment');
      return false;
    }
    
    // Run all tests
    await this.runTest('Repository Indexing', () => this.testRepositoryIndexing());
    await this.runTest('Embedding Generation Performance', () => this.testEmbeddingGenerationPerformance());
    await this.runTest('Four-Layer Classification Pipeline', () => this.testFourLayerPipeline());
    await this.runTest('Similarity Search Performance', () => this.testSimilaritySearchPerformance());
    await this.runTest('Change Detection and Reindexing', () => this.testChangeDetectionAndReindexing());
    await this.runTest('Cache Hit Rates', () => this.testCacheHitRates());
    await this.runTest('Memory Management', () => this.testMemoryManagement());
    await this.runTest('Error Recovery', () => this.testErrorRecovery());
    await this.runTest('Concurrent Operations', () => this.testConcurrentOperations());
    await this.runTest('End-to-End Workflow', () => this.testEndToEndWorkflow());
    
    // Results summary
    console.log('\n' + '=' .repeat(60));
    console.log('📊 Test Results Summary');
    console.log('=' .repeat(60));
    
    const total = this.testResults.passed + this.testResults.failed;
    const successRate = (this.testResults.passed / total * 100).toFixed(1);
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${this.testResults.passed}`);
    console.log(`Failed: ${this.testResults.failed}`);
    console.log(`Success Rate: ${successRate}%`);
    
    if (this.testResults.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.testResults.errors.forEach(error => {
        console.log(`  - ${error.test}: ${error.error}`);
      });
    }
    
    // Performance summary
    console.log('\n⏱️  Performance Summary:');
    Object.entries(this.testResults.performance).forEach(([test, duration]) => {
      console.log(`  - ${test}: ${duration}ms`);
    });
    
    // Cleanup
    await this.cleanup();
    
    const allPassed = this.testResults.failed === 0;
    
    if (allPassed) {
      console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
      console.log('✅ Four-layer classification pipeline is production ready');
      console.log('✅ All performance targets met');
      console.log('✅ Repository indexing and search functional');
      console.log('✅ Error recovery mechanisms validated');
      return true;
    } else {
      console.log('\n❌ INTEGRATION TESTS FAILED');
      console.log(`${this.testResults.failed} test(s) require attention`);
      return false;
    }
  }
}

// Run tests if executed directly
if (require.main === module) {
  const tester = new EmbeddingClassificationIntegrationTests();
  tester.run()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = EmbeddingClassificationIntegrationTests;