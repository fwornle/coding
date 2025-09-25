#!/usr/bin/env node

import ReliableCodingClassifier from '../src/live-logging/ReliableCodingClassifier.js';

// Test the exact exchange that was misclassified
const testExchange = {
  userMessage: `This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:
Analysis:
Looking at this conversation chronologically:

1. **Initial Context**: This session continued from a previous conversation that ran out of context, focused on fixing critical bugs in the Live Session Logging (LSL) system and creating comprehensive requirements documentation.

2. **User's Primary Complaints**: The user discovered that batch mode LSL system was showing significant problems...`,
  timestamp: "2025-09-14T11:15:35.769Z",
  isUserPrompt: true,
  content: `Live Session Logging (LSL) system batch mode LSL system`
};

async function debugClassification() {
  console.log('🔍 DEBUGGING SPECIFIC CLASSIFICATION FAILURE');
  console.log('='.repeat(60));
  
  const classifier = new ReliableCodingClassifier({
    projectPath: '/Users/q284340/Agentic/nano-degree',
    codingRepo: '/Users/q284340/Agentic/coding',
    debug: true
  });
  
  await classifier.initialize();
  
  console.log('\n📝 TEST EXCHANGE:');
  console.log('Timestamp:', testExchange.timestamp);
  console.log('Content preview:', testExchange.userMessage.substring(0, 200) + '...');
  console.log('\n🧪 TESTING PATH ANALYSIS:');
  const pathResult = await classifier.pathAnalyzer.analyzePaths(testExchange);
  console.log('Path result:', JSON.stringify(pathResult, null, 2));
  
  console.log('\n🔤 TESTING KEYWORD ANALYSIS:');
  const keywordResult = await classifier.keywordMatcher.matchKeywords(testExchange);
  console.log('Keyword result:', JSON.stringify(keywordResult, null, 2));
  
  console.log('\n🎯 FULL CLASSIFICATION:');
  const fullResult = await classifier.classify(testExchange);
  console.log('Full result:', JSON.stringify(fullResult, null, 2));
  
  console.log('\n🎯 EXPECTED: CODING_INFRASTRUCTURE (contains "LSL system", "batch mode LSL")');
  console.log('🎯 ACTUAL:', fullResult.classification);
  console.log('🎯 REASON:', fullResult.reason);
  
  if (fullResult.classification !== 'CODING_INFRASTRUCTURE') {
    console.log('\n❌ CLASSIFICATION FAILED!');
    console.log('This exchange should be classified as coding but was not.');
    
    // Test just the LSL keywords directly
    console.log('\n🔍 TESTING INDIVIDUAL KEYWORDS:');
    const testText = testExchange.content.toLowerCase();
    const keywords = ['lsl', 'live session logging', 'batch mode', 'coding infrastructure'];
    for (const keyword of keywords) {
      const found = testText.includes(keyword);
      console.log(`   "${keyword}": ${found ? '✅ FOUND' : '❌ NOT FOUND'}`);
    }
  } else {
    console.log('\n✅ CLASSIFICATION CORRECT!');
  }
}

debugClassification().catch(console.error);