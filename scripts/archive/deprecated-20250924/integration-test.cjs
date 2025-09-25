#!/usr/bin/env node
/**
 * Integration Test for ReliableCodingClassifier
 * 
 * Simple integration test that validates the classifier system works end-to-end
 * without dependencies on Jest configuration complexities.
 */

const path = require('path');
const { performance } = require('perf_hooks');

// Import the classifier
const ReliableCodingClassifier = require('../src/live-logging/ReliableCodingClassifier');

class IntegrationTester {
  constructor() {
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: [],
      details: []
    };
  }

  async run() {
    console.log('🔧 ReliableCodingClassifier Integration Test');
    console.log('='.repeat(50));
    
    try {
      // Test 1: Classifier Initialization
      await this.testInitialization();
      
      // Test 2: Basic Classification
      await this.testBasicClassification();
      
      // Test 3: Performance Requirements
      await this.testPerformanceRequirements();
      
      // Test 4: Known Failure Cases
      await this.testKnownFailureCases();
      
      // Test 5: Edge Cases
      await this.testEdgeCases();
      
      this.reportResults();
      
    } catch (error) {
      console.error('❌ Integration test failed:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
      process.exit(1);
    }
  }

  async testInitialization() {
    console.log('\n📋 Test 1: Classifier Initialization');
    
    try {
      const classifier = new ReliableCodingClassifier({
        debug: false,
        enableLogging: false
      });
      
      const startTime = performance.now();
      await classifier.initialize();
      const initTime = performance.now() - startTime;
      
      console.log(`✅ Classifier initialized successfully in ${initTime.toFixed(2)}ms`);
      this.testResults.passed++;
      this.testResults.details.push({
        test: 'Initialization',
        status: 'PASSED',
        time: initTime,
        details: 'Classifier initialized without errors'
      });
      
    } catch (error) {
      console.log(`❌ Initialization failed: ${error.message}`);
      this.testResults.failed++;
      this.testResults.errors.push({
        test: 'Initialization',
        error: error.message
      });
    }
  }

  async testBasicClassification() {
    console.log('\n📋 Test 2: Basic Classification');
    
    const testExchanges = [
      {
        name: 'Coding Exchange - Path Based',
        exchange: {
          userMessage: 'Can you read the file at /Users/q284340/Agentic/coding/CLAUDE.md?',
          assistantResponse: 'I\'ll read the CLAUDE.md file for you. [tool call: Read]'
        },
        expectedCoding: true
      },
      {
        name: 'Non-Coding Exchange',
        exchange: {
          userMessage: 'What\'s the weather like today?',
          assistantResponse: 'I don\'t have access to real-time weather data. You could check a weather website or app for current conditions.'
        },
        expectedCoding: false
      },
      {
        name: 'Coding Exchange - Tool Based',
        exchange: {
          userMessage: 'Help me fix this Node.js error',
          assistantResponse: 'I can help you fix that Node.js error. Let me examine the code using the Read tool to understand the issue better.'
        },
        expectedCoding: true
      }
    ];

    const classifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });
    await classifier.initialize();

    for (const testCase of testExchanges) {
      try {
        const startTime = performance.now();
        const result = await classifier.classifyExchange(testCase.exchange);
        const classificationTime = performance.now() - startTime;

        const isCorrect = result.isCoding === testCase.expectedCoding;
        
        if (isCorrect) {
          console.log(`✅ ${testCase.name}: ${result.classification} (${(result.confidence * 100).toFixed(1)}%) - ${classificationTime.toFixed(2)}ms`);
          this.testResults.passed++;
        } else {
          console.log(`❌ ${testCase.name}: Expected ${testCase.expectedCoding ? 'CODING' : 'NOT_CODING'}, got ${result.classification}`);
          this.testResults.failed++;
          this.testResults.errors.push({
            test: `Basic Classification - ${testCase.name}`,
            error: `Expected ${testCase.expectedCoding ? 'CODING' : 'NOT_CODING'}, got ${result.classification}`
          });
        }

        this.testResults.details.push({
          test: `Basic Classification - ${testCase.name}`,
          status: isCorrect ? 'PASSED' : 'FAILED',
          time: classificationTime,
          details: `Classification: ${result.classification}, Confidence: ${(result.confidence * 100).toFixed(1)}%, Layer: ${result.layer}`
        });

      } catch (error) {
        console.log(`❌ ${testCase.name}: Error - ${error.message}`);
        this.testResults.failed++;
        this.testResults.errors.push({
          test: `Basic Classification - ${testCase.name}`,
          error: error.message
        });
      }
    }
  }

  async testPerformanceRequirements() {
    console.log('\n📋 Test 3: Performance Requirements (<10ms)');

    const classifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });
    await classifier.initialize();

    const testExchange = {
      userMessage: 'Performance test message',
      assistantResponse: 'Performance test response'
    };

    const iterations = 20;
    const times = [];

    console.log(`⏱️  Running ${iterations} iterations...`);

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      await classifier.classifyExchange(testExchange);
      const time = performance.now() - startTime;
      times.push(time);
    }

    const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const maxTime = Math.max(...times);
    const withinTarget = times.filter(time => time < 10).length;
    const targetPercentage = (withinTarget / times.length) * 100;

    console.log(`📊 Average time: ${avgTime.toFixed(2)}ms`);
    console.log(`📊 Maximum time: ${maxTime.toFixed(2)}ms`);
    console.log(`🎯 Within target (<10ms): ${withinTarget}/${times.length} (${targetPercentage.toFixed(1)}%)`);

    if (avgTime < 10 && targetPercentage >= 90) {
      console.log(`✅ Performance requirements met`);
      this.testResults.passed++;
    } else {
      console.log(`❌ Performance requirements not met`);
      this.testResults.failed++;
      this.testResults.errors.push({
        test: 'Performance Requirements',
        error: `Average time: ${avgTime.toFixed(2)}ms, Target percentage: ${targetPercentage.toFixed(1)}%`
      });
    }

    this.testResults.details.push({
      test: 'Performance Requirements',
      status: (avgTime < 10 && targetPercentage >= 90) ? 'PASSED' : 'FAILED',
      time: avgTime,
      details: `Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms, Within target: ${targetPercentage.toFixed(1)}%`
    });
  }

  async testKnownFailureCases() {
    console.log('\n📋 Test 4: Known Failure Cases (FastEmbeddingClassifier Issues)');

    const classifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });
    await classifier.initialize();

    // The known statusLine exchange that FastEmbeddingClassifier failed on
    const statusLineExchange = {
      userMessage: 'Can you help me with the status line configuration?',
      assistantResponse: 'I can help you configure the status line. The status line shows important information about your current session and project state.'
    };

    try {
      const result = await classifier.classifyExchange(statusLineExchange);
      
      // This should NOT classify as coding (it's about UI/configuration, not coding infrastructure)
      const isCorrect = !result.isCoding; // We expect this to be non-coding
      
      if (isCorrect) {
        console.log(`✅ StatusLine case: Correctly classified as ${result.classification}`);
        this.testResults.passed++;
      } else {
        console.log(`❌ StatusLine case: Incorrectly classified as ${result.classification}`);
        this.testResults.failed++;
        this.testResults.errors.push({
          test: 'Known Failure Case - StatusLine',
          error: `Incorrectly classified as ${result.classification} (should be NOT_CODING)`
        });
      }

      this.testResults.details.push({
        test: 'Known Failure Case - StatusLine',
        status: isCorrect ? 'PASSED' : 'FAILED',
        time: 0,
        details: `Classification: ${result.classification}, Expected: NOT_CODING`
      });

    } catch (error) {
      console.log(`❌ StatusLine case: Error - ${error.message}`);
      this.testResults.failed++;
      this.testResults.errors.push({
        test: 'Known Failure Case - StatusLine',
        error: error.message
      });
    }
  }

  async testEdgeCases() {
    console.log('\n📋 Test 5: Edge Cases');

    const classifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });
    await classifier.initialize();

    const edgeCases = [
      {
        name: 'Empty Exchange',
        exchange: { userMessage: '', assistantResponse: '' },
        expectError: false
      },
      {
        name: 'Very Long Exchange',
        exchange: {
          userMessage: 'A'.repeat(10000),
          assistantResponse: 'B'.repeat(10000)
        },
        expectError: false
      },
      {
        name: 'Special Characters',
        exchange: {
          userMessage: '🚀 Test with emojis and symbols: @#$%^&*()',
          assistantResponse: 'Response with ñ, é, ü, and other unicode: 中文测试'
        },
        expectError: false
      }
    ];

    for (const testCase of edgeCases) {
      try {
        const startTime = performance.now();
        const result = await classifier.classifyExchange(testCase.exchange);
        const time = performance.now() - startTime;

        if (testCase.expectError) {
          console.log(`❌ ${testCase.name}: Expected error but got result: ${result.classification}`);
          this.testResults.failed++;
        } else {
          console.log(`✅ ${testCase.name}: Handled gracefully - ${result.classification} (${time.toFixed(2)}ms)`);
          this.testResults.passed++;
        }

        this.testResults.details.push({
          test: `Edge Case - ${testCase.name}`,
          status: testCase.expectError ? 'FAILED' : 'PASSED',
          time: time,
          details: `Classification: ${result.classification}`
        });

      } catch (error) {
        if (testCase.expectError) {
          console.log(`✅ ${testCase.name}: Expected error occurred: ${error.message}`);
          this.testResults.passed++;
        } else {
          console.log(`❌ ${testCase.name}: Unexpected error: ${error.message}`);
          this.testResults.failed++;
          this.testResults.errors.push({
            test: `Edge Case - ${testCase.name}`,
            error: error.message
          });
        }
      }
    }
  }

  reportResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 INTEGRATION TEST RESULTS');
    console.log('='.repeat(60));

    console.log(`\n📈 SUMMARY:`);
    console.log(`  Total Tests: ${this.testResults.passed + this.testResults.failed}`);
    console.log(`  Passed: ${this.testResults.passed}`);
    console.log(`  Failed: ${this.testResults.failed}`);
    console.log(`  Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);

    if (this.testResults.errors.length > 0) {
      console.log(`\n❌ ERRORS:`);
      this.testResults.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error.test}: ${error.error}`);
      });
    }

    console.log(`\n📋 DETAILED RESULTS:`);
    this.testResults.details.forEach(detail => {
      const status = detail.status === 'PASSED' ? '✅' : '❌';
      console.log(`  ${status} ${detail.test}: ${detail.details}`);
      if (detail.time > 0) {
        console.log(`     Time: ${detail.time.toFixed(2)}ms`);
      }
    });

    console.log('\n' + '='.repeat(60));

    const overallSuccess = this.testResults.failed === 0;
    if (overallSuccess) {
      console.log('🎉 ALL TESTS PASSED - ReliableCodingClassifier is ready for deployment!');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed - Review issues before deployment');
      process.exit(1);
    }
  }
}

// Run integration test if called directly
if (require.main === module) {
  const tester = new IntegrationTester();
  tester.run().catch(console.error);
}

module.exports = IntegrationTester;