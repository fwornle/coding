#!/usr/bin/env node
/**
 * Simple Classifier Test
 * 
 * Basic test to verify the ReliableCodingClassifier works without 
 * getting into complex import/export issues.
 */

const { performance } = require('perf_hooks');

// Since we have ES modules but need CommonJS, let's use a dynamic import approach
async function testClassifier() {
  console.log('🔧 Simple ReliableCodingClassifier Test');
  console.log('='.repeat(40));
  
  try {
    // Dynamic import for ES module
    const { default: ReliableCodingClassifier } = await import('../src/live-logging/ReliableCodingClassifier.js');
    
    console.log('✅ Successfully imported ReliableCodingClassifier');
    
    // Test 1: Initialization
    console.log('\n📋 Test 1: Initialization');
    const classifier = new ReliableCodingClassifier({
      debug: false,
      enableLogging: false
    });
    
    const initStart = performance.now();
    await classifier.initialize();
    const initTime = performance.now() - initStart;
    
    console.log(`✅ Classifier initialized in ${initTime.toFixed(2)}ms`);
    
    // Test 2: Basic Classification
    console.log('\n📋 Test 2: Basic Classification');
    
    const testCases = [
      {
        name: 'Coding Path',
        exchange: {
          userMessage: 'Read /Users/q284340/Agentic/coding/CLAUDE.md',
          assistantResponse: 'I\'ll read that file for you.'
        },
        expectedCoding: true
      },
      {
        name: 'Non-coding',
        exchange: {
          userMessage: 'What\'s the weather?',
          assistantResponse: 'I don\'t have weather data.'
        },
        expectedCoding: false
      }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const testCase of testCases) {
      try {
        const classifyStart = performance.now();
        const result = await classifier.classify(testCase.exchange);
        const classifyTime = performance.now() - classifyStart;
        
        const isCorrect = result.isCoding === testCase.expectedCoding;
        const status = isCorrect ? '✅' : '❌';
        
        console.log(`${status} ${testCase.name}: ${result.classification} (${(result.confidence * 100).toFixed(1)}%) - ${classifyTime.toFixed(2)}ms`);
        
        if (isCorrect) {
          passed++;
        } else {
          failed++;
        }
        
        // Performance check
        if (classifyTime > 10) {
          console.log(`  ⚠️  Slow classification: ${classifyTime.toFixed(2)}ms > 10ms target`);
        }
        
      } catch (error) {
        console.log(`❌ ${testCase.name}: Error - ${error.message}`);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(40));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
      console.log('🎉 All basic tests passed - Classifier is working!');
      return true;
    } else {
      console.log('❌ Some tests failed');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    return false;
  }
}

// Run test if called directly
if (require.main === module) {
  testClassifier()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testClassifier };