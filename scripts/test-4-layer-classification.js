#!/usr/bin/env node

/**
 * Quick test of 4-layer classification with Qdrant
 */

import { getReliableClassifier } from './reliable-classifier.js';

async function test() {
  console.log('🧪 Testing 4-Layer Classification with Qdrant\n');

  const classifier = getReliableClassifier();

  // Test case 1: Coding-related content
  const codingTest = {
    userMessage: 'Can you help me fix the enhanced-transcript-monitor.js file? It seems to have an issue with the classification system.',
    assistantMessage: 'Let me read the file and analyze the issue.',
    fileOperations: ['scripts/enhanced-transcript-monitor.js'],
    exchanges: [{
      userMessage: 'Can you help me fix the enhanced-transcript-monitor.js file?',
      assistantMessage: 'Let me read the file and analyze the issue.'
    }]
  };

  console.log('Test 1: Coding-related content');
  console.log('Input: "Can you help me fix the enhanced-transcript-monitor.js file?"');
  const result1 = await classifier.classify(codingTest);
  console.log(`Result: ${result1.isCoding ? '✅ CODING' : '❌ LOCAL'} (confidence: ${result1.confidence})`);
  console.log(`Final layer: ${result1.layer}`);
  console.log(`Decision path: ${result1.decisionPath.map(d => d.layer).join(' → ')}\n`);

  // Test case 2: Non-coding content
  const nonCodingTest = {
    userMessage: '[Request interrupted by user]',
    assistantMessage: '',
    fileOperations: [],
    exchanges: [{
      userMessage: '[Request interrupted by user]',
      assistantMessage: ''
    }]
  };

  console.log('Test 2: Interrupted request (non-coding)');
  console.log('Input: "[Request interrupted by user]"');
  const result2 = await classifier.classify(nonCodingTest);
  console.log(`Result: ${result2.isCoding ? '✅ CODING' : '❌ LOCAL'} (confidence: ${result2.confidence})`);
  console.log(`Final layer: ${result2.layer}`);
  console.log(`Decision path: ${result2.decisionPath.map(d => d.layer).join(' → ')}\n`);

  // Show stats
  console.log('📊 Classification Stats:');
  console.log(JSON.stringify(classifier.getStats(), null, 2));
}

test().catch(error => {
  console.error('Test failed:', error.message);
  process.exit(1);
});
