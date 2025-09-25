#!/usr/bin/env node

import ReliableCodingClassifier from '../src/live-logging/ReliableCodingClassifier.js';

// Test exchange from the misclassified session
const testExchange = {
  userMessage: "Re-create all files (local and foreign) from nano-degree transcripts",
  assistantResponse: {
    toolCalls: [{
      name: "TodoWrite",
      parameters: {
        todos: [
          {
            content: "Fix missing '_from-nano-degree' postfix in foreign mode files",
            status: "completed"
          },
          {
            content: "Re-create all files (local and foreign) from nano-degree transcripts",
            status: "completed"
          }
        ]
      }
    }]
  },
  content: "Working on LSL file creation issue in foreign mode. Testing fix in both batch and live modes."
};

async function test() {
  console.log('Testing classification of LSL-related session...\n');
  
  const classifier = new ReliableCodingClassifier({
    projectPath: '/Users/q284340/Agentic/nano-degree',
    codingRepo: '/Users/q284340/Agentic/coding',
    debug: true
  });
  
  await classifier.initialize();
  
  console.log('\n=== Testing Exchange ===');
  console.log('User:', testExchange.userMessage);
  console.log('Content:', testExchange.content);
  
  const result = await classifier.classify(testExchange);
  
  console.log('\n=== Classification Result ===');
  console.log('Classification:', result.classification);
  console.log('Layer:', result.layer);
  console.log('Confidence:', result.confidence);
  console.log('Reason:', result.reason);
  console.log('Decision Path:', JSON.stringify(result.decisionPath, null, 2));
}

test().catch(console.error);