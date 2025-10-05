#!/usr/bin/env node
/**
 * Debug Classifier Test
 * 
 * Test with detailed debugging to understand classification logic
 */

const { performance } = require('perf_hooks');

// Since we have ES modules but need CommonJS, let's use a dynamic import approach
async function debugClassifier() {
  console.log('🔧 Debug ReliableCodingClassifier Test');
  console.log('='.repeat(50));
  
  try {
    // Dynamic import for ES module
    const { default: ReliableCodingClassifier } = await import('../src/live-logging/ReliableCodingClassifier.js');
    
    console.log('✅ Successfully imported ReliableCodingClassifier');
    
    // Test with DEBUG enabled
    const classifier = new ReliableCodingClassifier({
      debug: true, // Enable debug logging
      enableLogging: false
    });
    
    console.log('\n📋 Initializing with debug mode...');
    await classifier.initialize();
    console.log('✅ Classifier initialized with debug mode');
    
    // Test the obvious coding case
    const codingExchange = {
      userMessage: 'Can you read the file at /Users/q284340/Agentic/coding/CLAUDE.md?',
      assistantResponse: 'I\'ll read the CLAUDE.md file for you. <tool_use name="Read"><parameter name="file_path">/Users/q284340/Agentic/coding/CLAUDE.md</parameter></tool_use>'
    };
    
    console.log('\n📋 Testing obvious coding case...');
    console.log('User:', codingExchange.userMessage);
    console.log('Assistant:', codingExchange.assistantResponse);
    console.log('\n🔍 Starting classification with debug output:');
    
    const result = await classifier.classify(codingExchange);
    
    console.log('\n📊 Final Result:');
    console.log('  Classification:', result.classification);
    console.log('  Is Coding:', result.isCoding);
    console.log('  Confidence:', (result.confidence * 100).toFixed(1) + '%');
    console.log('  Layer:', result.layer);
    
    // Try to understand why it failed
    if (!result.isCoding) {
      console.log('\n🔍 Debugging why it was classified as NOT_CODING:');
      console.log('  This should definitely be CODING because:');
      console.log('  1. Contains path: /Users/q284340/Agentic/coding/CLAUDE.md');
      console.log('  2. Contains tool call: Read with file_path parameter'); 
      console.log('  3. Target file is in the coding repository');
    }
    
    // Check what the pathAnalyzer sees
    console.log('\n🔍 Testing PathAnalyzer directly:');
    const pathResult = await classifier.pathAnalyzer.analyzePaths(codingExchange);
    console.log('  PathAnalyzer result:', JSON.stringify(pathResult, null, 2));
    
    console.log('\n🔍 Checking classifier stats:');
    console.log('  Stats:', JSON.stringify(classifier.stats, null, 2));
    
  } catch (error) {
    console.error('❌ Debug test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

// Run debug test if called directly
if (require.main === module) {
  debugClassifier().catch(console.error);
}