/**
 * Comprehensive Test Suite for ReliableCodingClassifier
 * 
 * Tests all classifier components including unit tests, integration tests,
 * performance benchmarks, and known failure case validation.
 */

const path = require('path');
const fs = require('fs');

// Test imports - use require for CommonJS compatibility
const ReliableCodingClassifier = require('../../src/live-logging/ReliableCodingClassifier');
const PathAnalyzer = require('../../src/live-logging/PathAnalyzer');
const SemanticAnalyzerAdapter = require('../../src/live-logging/SemanticAnalyzerAdapter');
const KeywordMatcher = require('../../src/live-logging/KeywordMatcher');
const ExchangeRouter = require('../../src/live-logging/ExchangeRouter');
const OperationalLogger = require('../../src/live-logging/OperationalLogger');
const StatusLineIntegrator = require('../../src/live-logging/StatusLineIntegrator');

const testDataDir = path.join(__dirname, '../fixtures');

// Test configuration
const TEST_CONFIG = {
  projectPath: '/Users/q284340/test/project',
  codingRepo: '/Users/q284340/Agentic/coding',
  performanceThresholdMs: 10,
  apiKey: 'test-api-key'
};

// Mock exchanges for testing
const TEST_EXCHANGES = {
  coding: {
    pathBased: {
      userMessage: "Read the file at /Users/q284340/Agentic/coding/CLAUDE.md",
      assistantResponse: {
        content: "I'll read that file for you.",
        toolCalls: [
          {
            name: "Read",
            parameters: {
              file_path: "/Users/q284340/Agentic/coding/CLAUDE.md"
            }
          }
        ]
      },
      timestamp: Date.now()
    },
    semantic: {
      userMessage: "Help me debug the enhanced transcript monitor's semantic analysis integration",
      assistantResponse: {
        content: "I'll help you debug the semantic analysis integration in the transcript monitor."
      },
      timestamp: Date.now()
    },
    keyword: {
      userMessage: "Update the ukb knowledge base with this insight",
      assistantResponse: {
        content: "I'll update the UKB knowledge base."
      },
      timestamp: Date.now()
    },
    statusLine: {
      userMessage: "Show me the status line",
      assistantResponse: {
        content: "Here's the current status line information."
      },
      timestamp: Date.now()
    }
  },
  nonCoding: {
    general: {
      userMessage: "What's the weather like today?",
      assistantResponse: {
        content: "I don't have access to current weather data."
      },
      timestamp: Date.now()
    },
    business: {
      userMessage: "Draft a business proposal for our new product",
      assistantResponse: {
        content: "I'll help you draft a business proposal."
      },
      timestamp: Date.now()
    }
  }
};

describe('ReliableCodingClassifier System Tests', () => {
  let classifier;
  let pathAnalyzer;
  let semanticAnalyzer;
  let keywordMatcher;
  let exchangeRouter;
  let operationalLogger;
  let statusLineIntegrator;

  beforeAll(() => {
    // Ensure test directories exist
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Initialize components for testing
    classifier = new ReliableCodingClassifier({
      ...TEST_CONFIG,
      debug: false
    });

    pathAnalyzer = new PathAnalyzer({
      codingRepo: TEST_CONFIG.codingRepo,
      debug: false
    });

    semanticAnalyzer = new SemanticAnalyzerAdapter({
      apiKey: null, // Disable for unit tests
      debug: false
    });

    keywordMatcher = new KeywordMatcher({
      debug: false
    });

    exchangeRouter = new ExchangeRouter({
      projectPath: TEST_CONFIG.projectPath,
      codingProjectPath: TEST_CONFIG.codingRepo,
      debug: false
    });

    operationalLogger = new OperationalLogger({
      projectPath: TEST_CONFIG.projectPath,
      enabled: false, // Disable for tests
      debug: false
    });

    statusLineIntegrator = new StatusLineIntegrator({
      projectPath: TEST_CONFIG.projectPath,
      codingProjectPath: TEST_CONFIG.codingRepo,
      debug: false
    });
  });

  afterEach(() => {
    // Clean up
    if (operationalLogger) {
      operationalLogger.destroy();
    }
    if (statusLineIntegrator) {
      statusLineIntegrator.destroy();
    }
  });

  // ===== UNIT TESTS =====

  describe('PathAnalyzer Unit Tests', () => {
    test('should detect coding project paths correctly', async () => {
      const testCases = [
        {
          path: '/Users/q284340/Agentic/coding/CLAUDE.md',
          expected: true,
          description: 'direct coding repo file'
        },
        {
          path: '/Users/q284340/Agentic/coding/src/live-logging/ReliableCodingClassifier.js',
          expected: true,
          description: 'nested coding repo file'
        },
        {
          path: '/Users/q284340/other/project/file.js',
          expected: false,
          description: 'non-coding repo file'
        },
        {
          path: '~/Documents/notes.txt',
          expected: false,
          description: 'home directory file'
        }
      ];

      for (const testCase of testCases) {
        const result = pathAnalyzer.isCodingPath(testCase.path);
        expect(result).toBe(testCase.expected);
      }
    });

    test('should extract file operations from exchanges', async () => {
      const exchange = TEST_EXCHANGES.coding.pathBased;
      const result = await pathAnalyzer.analyzePaths(exchange);

      expect(result.fileOperations).toContain('/Users/q284340/Agentic/coding/CLAUDE.md');
      expect(result.isCoding).toBe(true);
      expect(result.reason).toContain('coding repo');
    });

    test('should handle malformed paths gracefully', async () => {
      const exchange = {
        userMessage: 'Test message',
        assistantResponse: {
          toolCalls: [
            {
              name: 'Read',
              parameters: {
                file_path: null
              }
            }
          ]
        }
      };

      const result = await pathAnalyzer.analyzePaths(exchange);
      expect(result.isCoding).toBe(false);
      expect(result.fileOperations).toEqual([]);
    });

    test('should handle performance requirements', async () => {
      const startTime = Date.now();
      await pathAnalyzer.analyzePaths(TEST_EXCHANGES.coding.pathBased);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(5); // Path analysis should be very fast
    });
  });

  describe('KeywordMatcher Unit Tests', () => {
    test('should match coding infrastructure keywords', async () => {
      const testCases = [
        {
          exchange: TEST_EXCHANGES.coding.keyword,
          expected: true,
          description: 'UKB keyword match'
        },
        {
          exchange: TEST_EXCHANGES.coding.semantic,
          expected: true,
          description: 'semantic analysis keyword match'
        },
        {
          exchange: TEST_EXCHANGES.nonCoding.general,
          expected: false,
          description: 'no coding keywords'
        }
      ];

      for (const testCase of testCases) {
        const result = await keywordMatcher.matchKeywords(testCase.exchange);
        expect(result.isCoding).toBe(testCase.expected);
        expect(result.processingTimeMs).toBeLessThan(1); // Sub-1ms requirement
      }
    });

    test('should apply exclusion patterns correctly', async () => {
      const exchange = {
        userMessage: 'Help me with Three.js timeline visualization',
        assistantResponse: {
          content: 'I can help you with Three.js development.'
        }
      };

      const result = await keywordMatcher.matchKeywords(exchange);
      expect(result.isCoding).toBe(false); // Should be excluded
    });

    test('should handle empty exchanges', async () => {
      const exchange = {
        userMessage: '',
        assistantResponse: { content: '' }
      };

      const result = await keywordMatcher.matchKeywords(exchange);
      expect(result.isCoding).toBe(false);
      expect(result.confidence).toBe(0.1);
    });
  });

  describe('SemanticAnalyzerAdapter Unit Tests', () => {
    test('should handle missing API key gracefully', async () => {
      const adapter = new SemanticAnalyzerAdapter({
        apiKey: null,
        debug: false
      });

      const result = await adapter.analyzeSemantics(TEST_EXCHANGES.coding.semantic);
      expect(result.isCoding).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain('no API key');
    });

    test('should handle API timeout correctly', async () => {
      const adapter = new SemanticAnalyzerAdapter({
        apiKey: 'test-key',
        timeout: 10, // Very short timeout
        debug: false
      });

      const startTime = Date.now();
      const result = await adapter.analyzeSemantics(TEST_EXCHANGES.coding.semantic);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThanOrEqual(50); // Should timeout quickly
      expect(result.isCoding).toBe(false); // Should fall back to false
    });

    test('should provide capability information', () => {
      const capabilities = semanticAnalyzer.getCapabilities();
      expect(capabilities).toHaveProperty('available');
      expect(capabilities).toHaveProperty('provider');
      expect(capabilities).toHaveProperty('timeout');
    });
  });

  describe('ExchangeRouter Unit Tests', () => {
    test('should generate correct session file paths', () => {
      const timestamp = new Date('2025-09-11T10:15:30Z').getTime();
      const timeWindow = exchangeRouter.calculateTimeWindow(timestamp);

      expect(timeWindow.dateString).toBe('2025-09-11');
      expect(timeWindow.windowString).toMatch(/\d{4}-\d{4}/);
    });

    test('should route coding content correctly', async () => {
      const classification = {
        classification: 'CODING_INFRASTRUCTURE',
        isCoding: true,
        confidence: 0.9
      };

      const result = await exchangeRouter.route(TEST_EXCHANGES.coding.pathBased, classification);
      expect(result.success).toBe(true);
      expect(result.routing.shouldRedirect).toBeDefined();
    });

    test('should handle time window boundaries', () => {
      const testTimes = [
        new Date('2025-09-11T00:00:00Z').getTime(), // Midnight
        new Date('2025-09-11T23:59:59Z').getTime(), // End of day
        new Date('2025-09-11T12:30:00Z').getTime()  // Noon
      ];

      for (const timestamp of testTimes) {
        const window = exchangeRouter.calculateTimeWindow(timestamp);
        expect(window.dateString).toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(window.windowString).toMatch(/\d{4}-\d{4}/);
      }
    });
  });

  describe('OperationalLogger Unit Tests', () => {
    test('should sanitize sensitive data', () => {
      const logger = new OperationalLogger({
        projectPath: TEST_CONFIG.projectPath,
        enabled: false
      });

      const exchange = {
        userMessage: 'Here is my API key: sk-1234567890abcdef',
        assistantResponse: { content: 'Thanks for the key!' }
      };

      const sanitized = logger.sanitizeExchange(exchange);
      expect(sanitized.hasUserMessage).toBe(true);
      expect(sanitized.userMessageLength).toBe(exchange.userMessage.length);
    });

    test('should generate unique exchange IDs', () => {
      const logger = new OperationalLogger({
        enabled: false
      });

      const id1 = logger.generateExchangeId(TEST_EXCHANGES.coding.pathBased);
      const id2 = logger.generateExchangeId(TEST_EXCHANGES.nonCoding.general);

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/[a-f0-9]{8}/);
    });
  });

  describe('StatusLineIntegrator Unit Tests', () => {
    test('should build status indicators correctly', () => {
      const classification = {
        classification: 'CODING_INFRASTRUCTURE',
        layer: 'path',
        confidence: 0.95
      };

      const routing = { shouldRedirect: true };

      const indicator = statusLineIntegrator.buildStatusIndicator(classification, routing);
      expect(indicator).toContain('→coding');
      expect(indicator).toContain('path');
      expect(indicator).toContain('95%');
    });

    test('should test integration capabilities', async () => {
      const results = await statusLineIntegrator.testIntegration();
      expect(results).toHaveProperty('environmentAccess');
      expect(results).toHaveProperty('statusUpdateTest');
      expect(results).toHaveProperty('redirectTest');
    });
  });

  // ===== INTEGRATION TESTS =====

  describe('ReliableCodingClassifier Integration Tests', () => {
    test('should initialize all components correctly', async () => {
      await classifier.initialize();

      expect(classifier.pathAnalyzer).toBeDefined();
      expect(classifier.keywordMatcher).toBeDefined();
      // SemanticAnalyzer may be undefined if no API key
    });

    test('should classify coding content through multiple layers', async () => {
      const testCases = [
        {
          exchange: TEST_EXCHANGES.coding.pathBased,
          expectedResult: true,
          expectedLayer: 'path',
          description: 'path-based detection'
        },
        {
          exchange: TEST_EXCHANGES.coding.keyword,
          expectedResult: true,
          expectedLayer: 'keyword',
          description: 'keyword-based detection'
        },
        {
          exchange: TEST_EXCHANGES.nonCoding.general,
          expectedResult: false,
          expectedLayer: 'keyword',
          description: 'non-coding content'
        }
      ];

      for (const testCase of testCases) {
        const result = await classifier.classify(testCase.exchange);

        expect(result.classification === 'CODING_INFRASTRUCTURE' || result.isCoding).toBe(testCase.expectedResult);
        expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
        expect(result.layer).toBeDefined();
        expect(result.reason).toBeDefined();
      }
    });

    test('should handle known failure case: statusLine exchange', async () => {
      // This is the specific case that was failing with FastEmbeddingClassifier
      const result = await classifier.classify(TEST_EXCHANGES.coding.statusLine);

      // Should correctly classify as coding content
      expect(result.classification === 'CODING_INFRASTRUCTURE' || result.isCoding).toBe(true);
      expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should maintain consistent results across multiple runs', async () => {
      const exchange = TEST_EXCHANGES.coding.semantic;
      const results = [];

      // Run classification multiple times
      for (let i = 0; i < 5; i++) {
        const result = await classifier.classify(exchange);
        results.push(result);
      }

      // Results should be consistent
      const firstResult = results[0];
      for (const result of results) {
        expect(result.classification).toBe(firstResult.classification);
        expect(result.layer).toBe(firstResult.layer);
      }
    });

    test('should fall back through layers correctly', async () => {
      // Create classifier with limited capabilities to test fallback
      const limitedClassifier = new ReliableCodingClassifier({
        ...TEST_CONFIG,
        apiKey: null // No semantic analysis
      });

      await limitedClassifier.initialize();

      const result = await limitedClassifier.classify(TEST_EXCHANGES.coding.semantic);

      // Should fall back to keyword layer
      expect(result.layer).toBe('keyword');
      expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
    });
  });

  // ===== PERFORMANCE BENCHMARKS =====

  describe('Performance Benchmarks', () => {
    test('should meet <10ms classification requirement', async () => {
      const testExchanges = Object.values(TEST_EXCHANGES.coding).concat(
        Object.values(TEST_EXCHANGES.nonCoding)
      );

      const results = [];

      for (const exchange of testExchanges) {
        const startTime = Date.now();
        const result = await classifier.classify(exchange);
        const elapsed = Date.now() - startTime;

        results.push({
          elapsed,
          processingTime: result.processingTimeMs,
          layer: result.layer
        });

        // Individual requirement check
        expect(elapsed).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
        expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
      }

      // Calculate average performance
      const avgElapsed = results.reduce((sum, r) => sum + r.elapsed, 0) / results.length;
      const avgProcessing = results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;

      console.log(`Average elapsed time: ${avgElapsed.toFixed(2)}ms`);
      console.log(`Average processing time: ${avgProcessing.toFixed(2)}ms`);

      expect(avgElapsed).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
    });

    test('should scale with exchange complexity', async () => {
      const simpleExchange = {
        userMessage: 'ukb',
        assistantResponse: { content: 'OK' }
      };

      const complexExchange = {
        userMessage: 'Help me debug the enhanced transcript monitor semantic analysis integration with comprehensive logging',
        assistantResponse: {
          content: 'I\'ll analyze the semantic analysis integration issues...'.repeat(10),
          toolCalls: Array(5).fill(null).map((_, i) => ({
            name: 'Read',
            parameters: {
              file_path: `/Users/q284340/Agentic/coding/src/file${i}.js`
            }
          }))
        }
      };

      const simpleResult = await classifier.classify(simpleExchange);
      const complexResult = await classifier.classify(complexExchange);

      // Both should be fast, complex shouldn't be significantly slower
      expect(simpleResult.processingTimeMs).toBeLessThan(5);
      expect(complexResult.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
    });

    test('should handle batch processing performance', async () => {
      const batchSize = 10;
      const exchanges = Array(batchSize).fill(null).map((_, i) => ({
        ...TEST_EXCHANGES.coding.semantic,
        userMessage: `Test message ${i}`
      }));

      const startTime = Date.now();
      const results = [];

      for (const exchange of exchanges) {
        const result = await classifier.classify(exchange);
        results.push(result);
      }

      const totalTime = Date.now() - startTime;
      const avgTimePerClassification = totalTime / batchSize;

      expect(avgTimePerClassification).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
      expect(results).toHaveLength(batchSize);
    });
  });

  // ===== ERROR HANDLING TESTS =====

  describe('Error Handling and Edge Cases', () => {
    test('should handle null/undefined exchanges', async () => {
      const testCases = [null, undefined, {}, { userMessage: null }];

      for (const testCase of testCases) {
        const result = await classifier.classify(testCase);
        expect(result).toBeDefined();
        expect(result.processingTimeMs).toBeDefined();
      }
    });

    test('should handle malformed tool calls', async () => {
      const malformedExchange = {
        userMessage: 'Test',
        assistantResponse: {
          toolCalls: [
            { name: null, parameters: null },
            { name: 'Read', parameters: { file_path: 123 } },
            null
          ]
        }
      };

      const result = await classifier.classify(malformedExchange);
      expect(result).toBeDefined();
      expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
    });

    test('should handle very long content', async () => {
      const longContent = 'x'.repeat(10000);
      const longExchange = {
        userMessage: longContent,
        assistantResponse: {
          content: longContent
        }
      };

      const result = await classifier.classify(longExchange);
      expect(result).toBeDefined();
      expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs * 2); // Allow some extra time
    });

    test('should maintain statistics correctly', async () => {
      const initialStats = classifier.getStats();

      await classifier.classify(TEST_EXCHANGES.coding.pathBased);
      await classifier.classify(TEST_EXCHANGES.nonCoding.general);

      const finalStats = classifier.getStats();

      expect(finalStats.totalClassifications).toBe(initialStats.totalClassifications + 2);
      expect(finalStats.avgClassificationTime).toBeDefined();
    });
  });

  // ===== REGRESSION TESTS =====

  describe('Regression Tests', () => {
    test('should fix FastEmbeddingClassifier accuracy issues', async () => {
      // Test cases that were failing with FastEmbeddingClassifier
      const problemCases = [
        TEST_EXCHANGES.coding.statusLine,
        {
          userMessage: 'show status',
          assistantResponse: { content: 'Current system status...' }
        },
        {
          userMessage: 'Help with LSL system debugging',
          assistantResponse: { content: 'I\'ll help debug the LSL system.' }
        }
      ];

      for (const testCase of problemCases) {
        const result = await classifier.classify(testCase);

        // These should now be correctly classified as coding content
        expect(result.classification === 'CODING_INFRASTRUCTURE' || result.isCoding).toBe(true);
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.processingTimeMs).toBeLessThan(TEST_CONFIG.performanceThresholdMs);
      }
    });

    test('should maintain backward compatibility', async () => {
      // Test that the interface matches FastEmbeddingClassifier
      const result = await classifier.classify(TEST_EXCHANGES.coding.pathBased);

      // Check required properties for compatibility
      expect(result).toHaveProperty('classification');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('processingTimeMs');
      expect(result).toHaveProperty('reason');

      // Convert to old format for compatibility testing
      const oldFormat = {
        classification: result.classification,
        confidence: result.confidence.toString(),
        codingSimilarity: '0',
        projectSimilarity: '0',
        processingTimeMs: result.processingTimeMs,
        reason: result.reason
      };

      expect(oldFormat.classification).toBeDefined();
      expect(typeof oldFormat.confidence).toBe('string');
    });
  });
});

// Test utilities
function createTestExchange(userMessage, toolCalls = [], isRedirected = false) {
  return {
    userMessage,
    assistantResponse: {
      content: 'Test response',
      toolCalls
    },
    timestamp: Date.now(),
    isRedirected
  };
}

function measurePerformance(fn) {
  return async function(...args) {
    const start = Date.now();
    const result = await fn.apply(this, args);
    const elapsed = Date.now() - start;
    return { result, elapsed };
  };
}