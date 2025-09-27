/**
 * EmbeddingClassifier Unit Tests
 * 
 * Comprehensive unit tests for EmbeddingClassifier covering:
 * - Performance requirements (<3ms response time)
 * - Similarity calculations and confidence scoring  
 * - Error handling and fallback mechanisms
 * - Mock Qdrant client and EmbeddingGenerator integration
 * - Edge cases and boundary conditions
 * 
 * Requirements: 2.1 (functionality), 2.2 (performance), 2.3 (error handling)
 */

const fs = require('fs');
const path = require('path');

// Mock dependencies
const mockQdrantClient = {
  search: jest.fn(),
  scroll: jest.fn(),
  close: jest.fn()
};

const mockEmbeddingGenerator = {
  generateEmbedding: jest.fn(),
  initialize: jest.fn(),
  destroy: jest.fn()
};

const mockConfig = {
  embedding_classifier: {
    enabled: true,
    qdrant: {
      host: 'localhost',
      port: 6333,
      collection_name: 'test_coding_infrastructure',
      timeout: 5000
    },
    classification: {
      similarity_threshold: 0.7,
      confidence_threshold: 0.8,
      max_response_time: 3,
      fallback_to_semantic: true,
      max_candidates: 10
    },
    performance: {
      cache_embeddings: true,
      cache_size: 100,
      cache_ttl: 3600000
    },
    debug: {
      enabled: false
    }
  }
};

// Mock modules before requiring the actual implementation
jest.mock('../../../integrations/mcp-constraint-monitor/src/qdrant-client.js', () => ({
  createQdrantClient: () => mockQdrantClient
}));

const EmbeddingClassifier = require('../../src/live-logging/EmbeddingClassifier.js');

class EmbeddingClassifierTest {
  constructor() {
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: []
    };
    
    this.testDir = path.join(__dirname, 'test-data');
    this.setupTestEnvironment();
  }
  
  setupTestEnvironment() {
    // Create test directory
    if (!fs.existsSync(this.testDir)) {
      fs.mkdirSync(this.testDir, { recursive: true });
    }
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup default mock implementations
    this.setupDefaultMocks();
  }
  
  setupDefaultMocks() {
    // Mock embedding generation with realistic vectors
    mockEmbeddingGenerator.generateEmbedding.mockImplementation(async (text) => {
      // Simulate realistic 384-dimensional embedding
      const vector = new Array(384).fill(0).map(() => Math.random() * 2 - 1);
      return Promise.resolve(vector);
    });
    
    mockEmbeddingGenerator.initialize.mockResolvedValue();
    mockEmbeddingGenerator.destroy.mockResolvedValue();
    
    // Mock Qdrant search with coding infrastructure results
    mockQdrantClient.search.mockImplementation(async () => {
      return {
        matches: [
          {
            id: 'doc1',
            score: 0.85,
            payload: {
              text: 'LSL transcript monitoring system',
              file_path: 'src/live-logging/TranscriptAnalyzer.js',
              content_type: 'source_code'
            }
          },
          {
            id: 'doc2', 
            score: 0.72,
            payload: {
              text: 'Semantic analysis and classification',
              file_path: 'src/live-logging/SemanticAnalyzer.js',
              content_type: 'source_code'
            }
          }
        ]
      };
    });
  }
  
  async runAllTests() {
    console.log('=== EmbeddingClassifier Unit Tests ===\n');
    
    try {
      await this.testInitialization();
      await this.testPerformanceRequirements();
      await this.testSimilarityCalculations();
      await this.testConfidenceScoring();
      await this.testErrorHandling();
      await this.testCachingMechanism();
      await this.testFallbackBehavior();
      await this.testEdgeCases();
      await this.testIntegrationPoints();
      await this.testMemoryManagement();
      
      this.printResults();
      return this.testResults.failed === 0;
      
    } catch (error) {
      console.error('Fatal test error:', error);
      return false;
    } finally {
      this.cleanup();
    }
  }
  
  async testInitialization() {
    console.log('1. Testing initialization...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Verify initialization calls
      this.assert(mockEmbeddingGenerator.initialize.mock.calls.length === 1, 
        'Should initialize embedding generator');
      
      // Verify configuration
      this.assert(classifier.isInitialized === true, 'Should be marked as initialized');
      this.assert(classifier.config !== undefined, 'Should have configuration');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Initialization works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Initialization: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testPerformanceRequirements() {
    console.log('2. Testing performance requirements (<3ms)...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      const testExchange = {
        userMessage: 'Fix the LSL transcript monitoring issue',
        claudeResponse: 'I will analyze the transcript monitoring system',
        toolCalls: [{ name: 'Read', input: { file_path: 'src/live-logging/' } }],
        fileOperations: ['src/live-logging/TranscriptAnalyzer.js']
      };
      
      // Test multiple classifications to ensure consistent performance
      const performanceResults = [];
      
      for (let i = 0; i < 10; i++) {
        const startTime = process.hrtime.bigint();
        
        const result = await classifier.classifyByEmbedding(testExchange);
        
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        
        performanceResults.push(durationMs);
        
        // Verify result structure
        this.assert(result.classification !== undefined, 'Should have classification');
        this.assert(result.confidence !== undefined, 'Should have confidence score');
        this.assert(result.processingTimeMs !== undefined, 'Should track processing time');
      }
      
      const avgTime = performanceResults.reduce((a, b) => a + b, 0) / performanceResults.length;
      const maxTime = Math.max(...performanceResults);
      
      this.assert(avgTime < 3, `Average processing time should be <3ms, got ${avgTime.toFixed(2)}ms`);
      this.assert(maxTime < 5, `Max processing time should be <5ms, got ${maxTime.toFixed(2)}ms`);
      
      console.log(`     Average: ${avgTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`);
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Performance requirements met');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Performance: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testSimilarityCalculations() {
    console.log('3. Testing similarity calculations...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test high similarity case (should classify as CODING_INFRASTRUCTURE)
      const codingExchange = {
        userMessage: 'Debug the LSL transcript monitoring and fix classification issues',
        claudeResponse: 'I will examine the ReliableCodingClassifier and semantic analysis',
        toolCalls: [{ name: 'Edit', input: { file_path: 'src/live-logging/ReliableCodingClassifier.js' } }],
        fileOperations: ['src/live-logging/', 'config/live-logging-config.json']
      };
      
      const codingResult = await classifier.classifyByEmbedding(codingExchange);
      
      this.assert(codingResult.classification === 'CODING_INFRASTRUCTURE', 
        'High similarity should classify as CODING_INFRASTRUCTURE');
      this.assert(parseFloat(codingResult.codingSimilarity) >= 0.7, 
        'Should have high coding similarity score');
      this.assert(codingResult.reason.includes('similarity'), 
        'Should explain similarity-based reasoning');
      
      // Test low similarity case with non-coding content
      mockQdrantClient.search.mockResolvedValueOnce({
        matches: [
          {
            id: 'doc1',
            score: 0.3, // Low similarity
            payload: {
              text: 'General software development',
              file_path: 'user/project/readme.md', 
              content_type: 'documentation'
            }
          }
        ]
      });
      
      const projectExchange = {
        userMessage: 'Create a simple calculator application',
        claudeResponse: 'I will create a basic calculator with add, subtract, multiply, divide',
        toolCalls: [{ name: 'Write', input: { file_path: 'calculator.js' } }],
        fileOperations: ['calculator.js']
      };
      
      const projectResult = await classifier.classifyByEmbedding(projectExchange);
      
      this.assert(projectResult.classification === 'NOT_CODING_INFRASTRUCTURE',
        'Low similarity should classify as NOT_CODING_INFRASTRUCTURE');
      this.assert(parseFloat(projectResult.codingSimilarity) < 0.7,
        'Should have low coding similarity score');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Similarity calculations work correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Similarity calculations: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testConfidenceScoring() {
    console.log('4. Testing confidence scoring...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test high confidence scenario
      mockQdrantClient.search.mockResolvedValueOnce({
        matches: [
          {
            id: 'doc1',
            score: 0.95, // Very high similarity
            payload: {
              text: 'LSL live session logging transcript monitor',
              file_path: 'src/live-logging/TranscriptMonitor.js',
              content_type: 'source_code'
            }
          },
          {
            id: 'doc2',
            score: 0.92, // Also high
            payload: {
              text: 'Reliable coding classifier semantic analysis',
              file_path: 'src/live-logging/ReliableCodingClassifier.js',
              content_type: 'source_code'
            }
          }
        ]
      });
      
      const highConfidenceExchange = {
        userMessage: 'Fix the LSL transcript monitoring system',
        fileOperations: ['src/live-logging/TranscriptMonitor.js']
      };
      
      const highConfidenceResult = await classifier.classifyByEmbedding(highConfidenceExchange);
      
      this.assert(parseFloat(highConfidenceResult.confidence) >= 0.8,
        'High similarity should result in high confidence');
      this.assert(highConfidenceResult.classification === 'CODING_INFRASTRUCTURE',
        'High confidence should classify as coding infrastructure');
      
      // Test medium confidence scenario
      mockQdrantClient.search.mockResolvedValueOnce({
        matches: [
          {
            id: 'doc1',
            score: 0.75, // Medium similarity
            payload: {
              text: 'Development tools and utilities',
              file_path: 'src/utils/helper.js',
              content_type: 'source_code'
            }
          }
        ]
      });
      
      const mediumConfidenceExchange = {
        userMessage: 'Update some utilities',
        fileOperations: ['src/utils/helper.js']
      };
      
      const mediumConfidenceResult = await classifier.classifyByEmbedding(mediumConfidenceExchange);
      
      this.assert(parseFloat(mediumConfidenceResult.confidence) >= 0.6 && 
                  parseFloat(mediumConfidenceResult.confidence) < 0.8,
        'Medium similarity should result in medium confidence');
      
      // Test low confidence scenario
      mockQdrantClient.search.mockResolvedValueOnce({
        matches: [
          {
            id: 'doc1',
            score: 0.4, // Low similarity
            payload: {
              text: 'Random documentation',
              file_path: 'docs/readme.md',
              content_type: 'documentation'
            }
          }
        ]
      });
      
      const lowConfidenceExchange = {
        userMessage: 'General question about programming',
        fileOperations: []
      };
      
      const lowConfidenceResult = await classifier.classifyByEmbedding(lowConfidenceExchange);
      
      this.assert(parseFloat(lowConfidenceResult.confidence) < 0.6,
        'Low similarity should result in low confidence');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Confidence scoring works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Confidence scoring: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testErrorHandling() {
    console.log('5. Testing error handling and fallback mechanisms...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test Qdrant connection failure
      mockQdrantClient.search.mockRejectedValueOnce(new Error('Connection timeout'));
      
      const testExchange = {
        userMessage: 'Test message',
        claudeResponse: 'Test response'
      };
      
      const result1 = await classifier.classifyByEmbedding(testExchange);
      
      this.assert(result1.classification === 'NOT_CODING_INFRASTRUCTURE',
        'Should fallback to safe classification on Qdrant error');
      this.assert(result1.reason.includes('error') || result1.reason.includes('fallback'),
        'Should explain fallback reasoning');
      
      // Test embedding generation failure
      mockEmbeddingGenerator.generateEmbedding.mockRejectedValueOnce(new Error('Embedding failed'));
      
      const result2 = await classifier.classifyByEmbedding(testExchange);
      
      this.assert(result2.classification !== undefined,
        'Should handle embedding generation failure gracefully');
      
      // Test empty Qdrant results
      mockQdrantClient.search.mockResolvedValueOnce({ matches: [] });
      
      const result3 = await classifier.classifyByEmbedding(testExchange);
      
      this.assert(result3.classification === 'NOT_CODING_INFRASTRUCTURE',
        'Should handle empty search results');
      this.assert(result3.reason.includes('no matches') || result3.reason.includes('insufficient'),
        'Should explain no matches scenario');
      
      // Test malformed search results
      mockQdrantClient.search.mockResolvedValueOnce({ matches: [{ invalid: 'data' }] });
      
      const result4 = await classifier.classifyByEmbedding(testExchange);
      
      this.assert(result4.classification !== undefined,
        'Should handle malformed search results');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Error handling works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Error handling: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testCachingMechanism() {
    console.log('6. Testing embedding caching mechanism...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      const testExchange = {
        userMessage: 'Same message for caching test',
        claudeResponse: 'Same response'
      };
      
      // First call should generate embedding
      await classifier.classifyByEmbedding(testExchange);
      const firstCallCount = mockEmbeddingGenerator.generateEmbedding.mock.calls.length;
      
      // Second call with same content should use cache
      await classifier.classifyByEmbedding(testExchange);
      const secondCallCount = mockEmbeddingGenerator.generateEmbedding.mock.calls.length;
      
      this.assert(secondCallCount === firstCallCount,
        'Second call should use cached embedding');
      
      // Different content should generate new embedding
      const differentExchange = {
        userMessage: 'Different message',
        claudeResponse: 'Different response'
      };
      
      await classifier.classifyByEmbedding(differentExchange);
      const thirdCallCount = mockEmbeddingGenerator.generateEmbedding.mock.calls.length;
      
      this.assert(thirdCallCount > secondCallCount,
        'Different content should generate new embedding');
      
      // Test cache statistics
      const stats = classifier.getStats();
      this.assert(stats.cacheHits !== undefined, 'Should track cache hits');
      this.assert(stats.cacheMisses !== undefined, 'Should track cache misses');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Caching mechanism works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Caching: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testFallbackBehavior() {
    console.log('7. Testing fallback behavior...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: {
          ...mockConfig,
          embedding_classifier: {
            ...mockConfig.embedding_classifier,
            classification: {
              ...mockConfig.embedding_classifier.classification,
              fallback_to_semantic: false // Disable fallback for this test
            }
          }
        },
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test behavior when fallback is disabled and embedding fails
      mockEmbeddingGenerator.generateEmbedding.mockRejectedValueOnce(new Error('Embedding service down'));
      
      const testExchange = {
        userMessage: 'Test fallback behavior',
        claudeResponse: 'Test response'
      };
      
      const result = await classifier.classifyByEmbedding(testExchange);
      
      this.assert(result.classification === 'NOT_CODING_INFRASTRUCTURE',
        'Should default to safe classification when fallback disabled');
      this.assert(result.reason.includes('error') || result.reason.includes('failed'),
        'Should explain why classification failed');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Fallback behavior works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Fallback behavior: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testEdgeCases() {
    console.log('8. Testing edge cases...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test empty exchange
      const emptyResult = await classifier.classifyByEmbedding({});
      this.assert(emptyResult.classification !== undefined, 'Should handle empty exchange');
      
      // Test null/undefined exchange
      const nullResult = await classifier.classifyByEmbedding(null);
      this.assert(nullResult.classification !== undefined, 'Should handle null exchange');
      
      // Test very long content
      const longExchange = {
        userMessage: 'x'.repeat(10000),
        claudeResponse: 'y'.repeat(10000)
      };
      
      const longResult = await classifier.classifyByEmbedding(longExchange);
      this.assert(longResult.classification !== undefined, 'Should handle very long content');
      this.assert(longResult.processingTimeMs < 10, 'Should still be fast with long content');
      
      // Test special characters
      const specialExchange = {
        userMessage: '🚀 Fix the LSL 💻 transcript monitoring! @#$%^&*()',
        claudeResponse: 'I will help with émojis and spéciál characters'
      };
      
      const specialResult = await classifier.classifyByEmbedding(specialExchange);
      this.assert(specialResult.classification !== undefined, 'Should handle special characters');
      
      // Test classification with missing Qdrant collection
      mockQdrantClient.search.mockRejectedValueOnce(new Error('Collection not found'));
      
      const missingCollectionResult = await classifier.classifyByEmbedding({
        userMessage: 'Test missing collection'
      });
      
      this.assert(missingCollectionResult.classification !== undefined,
        'Should handle missing collection gracefully');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Edge cases handled correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Edge cases: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testIntegrationPoints() {
    console.log('9. Testing integration points...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: mockConfig,
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test ReliableCodingClassifier integration format
      const exchange = {
        userMessage: 'Debug LSL issues',
        claudeResponse: 'Analyzing transcript monitoring',
        toolCalls: [{ name: 'Edit', input: {} }],
        fileOperations: ['src/live-logging/']
      };
      
      const result = await classifier.classifyByEmbedding(exchange);
      
      // Verify result format matches ReliableCodingClassifier expectations
      this.assert(typeof result.classification === 'string', 'Classification should be string');
      this.assert(['CODING_INFRASTRUCTURE', 'NOT_CODING_INFRASTRUCTURE'].includes(result.classification),
        'Classification should be valid value');
      this.assert(typeof result.confidence === 'string', 'Confidence should be string');
      this.assert(typeof result.reason === 'string', 'Reason should be string');
      this.assert(typeof result.processingTimeMs === 'number', 'Processing time should be number');
      this.assert(typeof result.codingSimilarity === 'string', 'Coding similarity should be string');
      this.assert(typeof result.projectSimilarity === 'string', 'Project similarity should be string');
      
      // Test that confidence is in valid range
      const confidenceNum = parseFloat(result.confidence);
      this.assert(confidenceNum >= 0 && confidenceNum <= 1, 'Confidence should be between 0 and 1');
      
      // Test that similarity scores are valid
      const codingSim = parseFloat(result.codingSimilarity);
      const projectSim = parseFloat(result.projectSimilarity);
      this.assert(codingSim >= 0 && codingSim <= 1, 'Coding similarity should be between 0 and 1');
      this.assert(projectSim >= 0 && projectSim <= 1, 'Project similarity should be between 0 and 1');
      
      await classifier.destroy();
      
      this.testResults.passed++;
      console.log('   ✓ Integration points work correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Integration points: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  async testMemoryManagement() {
    console.log('10. Testing memory management...');
    
    try {
      const classifier = new EmbeddingClassifier({
        config: {
          ...mockConfig,
          embedding_classifier: {
            ...mockConfig.embedding_classifier,
            performance: {
              cache_size: 5, // Small cache for testing
              cache_ttl: 100 // Short TTL for testing
            }
          }
        },
        embeddingGenerator: mockEmbeddingGenerator
      });
      
      await classifier.initialize();
      
      // Test cache size limits
      for (let i = 0; i < 10; i++) {
        await classifier.classifyByEmbedding({
          userMessage: `Test message ${i}`,
          claudeResponse: `Response ${i}`
        });
      }
      
      const stats = classifier.getStats();
      this.assert(stats.cacheSize <= 5, 'Cache should respect size limits');
      
      // Test TTL expiration
      await new Promise(resolve => setTimeout(resolve, 150)); // Wait for TTL
      
      const result = await classifier.classifyByEmbedding({
        userMessage: 'Test message 0', // Same as first message
        claudeResponse: 'Response 0'
      });
      
      // Should generate new embedding due to TTL expiration
      this.assert(result !== undefined, 'Should handle TTL expiration gracefully');
      
      // Test cleanup on destroy
      await classifier.destroy();
      
      this.assert(mockEmbeddingGenerator.destroy.mock.calls.length === 1,
        'Should cleanup embedding generator');
      this.assert(mockQdrantClient.close.mock.calls.length === 1,
        'Should cleanup Qdrant client');
      
      this.testResults.passed++;
      console.log('   ✓ Memory management works correctly');
      
    } catch (error) {
      this.testResults.failed++;
      this.testResults.errors.push(`Memory management: ${error.message}`);
      console.log('   ✗ Failed:', error.message);
    }
  }
  
  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
  
  cleanup() {
    // Remove test directory
    try {
      if (fs.existsSync(this.testDir)) {
        this.removeDirectoryRecursive(this.testDir);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  
  removeDirectoryRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          this.removeDirectoryRecursive(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      }
      
      fs.rmdirSync(dirPath);
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
module.exports = EmbeddingClassifierTest;

// Run tests if this file is executed directly
if (require.main === module) {
  const test = new EmbeddingClassifierTest();
  test.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}