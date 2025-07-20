#!/usr/bin/env node

const { AdaptiveEmbeddingClassifier } = require('./adaptive-embedding-classifier.cjs');
const fs = require('fs');
const path = require('path');

async function testRealSessions() {
  console.log('🧪 Testing Classifier with Real Session Files\n');
  
  const codingPath = '/Users/q284340/Agentic/coding';
  const timelinePath = '/Users/q284340/Agentic/timeline';
  
  const classifier = new AdaptiveEmbeddingClassifier(codingPath, [timelinePath]);
  
  // Test files
  const testFiles = [
    {
      path: '/Users/q284340/Agentic/timeline/.specstory/history/2025-06-13_07-25-timeline-metrics-improvements.md',
      expected: 'project',
      description: 'Timeline metrics improvements'
    },
    {
      path: '/Users/q284340/Agentic/coding/.specstory/history/2025-06-13_09-10-mcp-logging-investigation.md',
      expected: 'coding',
      description: 'MCP logging investigation'
    },
    {
      path: '/Users/q284340/Agentic/timeline/.specstory/history/2025-06-27_07-12-05_post-logged-project-session.md',
      expected: 'project',
      description: 'Large timeline project session'
    }
  ];
  
  for (const testFile of testFiles) {
    console.log(`\n=== Testing Real Session: ${testFile.description} ===`);
    
    try {
      if (!fs.existsSync(testFile.path)) {
        console.log(`❌ File not found: ${testFile.path}`);
        continue;
      }
      
      const content = fs.readFileSync(testFile.path, 'utf8');
      const preview = content.substring(0, 200).replace(/\n/g, ' ');
      console.log(`📄 File: ${path.basename(testFile.path)}`);
      console.log(`📝 Preview: ${preview}...\n`);
      
      const result = await classifier.classifyContent(content);
      
      console.log(`🎯 Classification: ${result.classification}`);
      console.log(`🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`📈 Coding Score: ${result.coding_score?.toFixed(3) || 'N/A'}`);
      console.log(`📈 Project Score: ${result.project_score?.toFixed(3) || 'N/A'}`);
      
      const isCorrect = result.classification === testFile.expected;
      console.log(`✅ Expected: ${testFile.expected}, Got: ${result.classification} ${isCorrect ? '✓' : '✗'}`);
      
      if (!isCorrect) {
        console.log(`🔍 Mismatch Details:`);
        console.log(`   Best Coding Match (${result.best_coding_match?.similarity.toFixed(3)}): ${result.best_coding_match?.sample}`);
        console.log(`   Best Project Match (${result.best_project_match?.similarity.toFixed(3)}): ${result.best_project_match?.sample}`);
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${testFile.description}:`, error.message);
    }
    
    console.log('\n' + '─'.repeat(80));
  }
  
  console.log('\n🎯 Real session testing complete!');
}

testRealSessions().catch(console.error);