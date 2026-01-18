#!/usr/bin/env node

/**
 * Integration test for PathAnalyzer with the relative path extraction fix
 */

import PathAnalyzer from './src/live-logging/PathAnalyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Derive paths dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// This file is at: tests/unit/test-path-analyzer-integration.js
// Coding root is 2 levels up
const codingRepo = process.env.CODING_TOOLS_PATH || process.env.CODING_REPO || path.resolve(__dirname, '../..');
// Default test project path (sibling of coding in ~/Agentic)
const projectPath = process.env.TEST_PROJECT_PATH || path.resolve(path.dirname(codingRepo), 'curriculum-alignment');

console.log('🧪 Testing PathAnalyzer integration...\n');

const analyzer = new PathAnalyzer({
  projectPath,
  codingRepo,
  debug: (msg) => console.log(`   [DEBUG] ${msg}`)
});

// Test case: User message that references a file existing in coding but not in curriculum-alignment
const testExchange = {
  userMessage: 'make a presentation version of this one: integrations/memory-visualizer/docs/images/component-structure.png'
};

async function runTest() {
  try {
    console.log('📝 Test Exchange:');
    console.log(`   User: "${testExchange.userMessage}"\n`);

    const result = await analyzer.analyzePaths(testExchange);

    console.log('📊 Analysis Result:');
    console.log(`   isCoding: ${result.isCoding}`);
    console.log(`   Reason: ${result.reason}`);
    console.log(`   File Operations: [${result.fileOperations.join(', ')}]`);
    console.log();

    // Verify the result
    const expected = {
      isCoding: true,
      hasFileOperations: true,
      pathExtracted: 'integrations/memory-visualizer/docs/images/component-structure.png'
    };

    const pathFound = result.fileOperations.includes(expected.pathExtracted);
    const correctClassification = result.isCoding === expected.isCoding;

    if (pathFound && correctClassification) {
      console.log('✅ Integration test PASSED!');
      console.log('   ✓ Relative path extracted from user message');
      console.log('   ✓ File correctly identified as existing in coding repo');
      console.log('   ✓ Classified as coding infrastructure');
      process.exit(0);
    } else {
      console.log('❌ Integration test FAILED!');
      if (!pathFound) {
        console.log(`   ✗ Expected path not found: ${expected.pathExtracted}`);
      }
      if (!correctClassification) {
        console.log(`   ✗ Expected isCoding=${expected.isCoding}, got ${result.isCoding}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
