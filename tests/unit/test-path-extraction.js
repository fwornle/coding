#!/usr/bin/env node

/**
 * Test script to verify relative path extraction works correctly
 * Tests the fix for detecting paths like "integrations/memory-visualizer/docs/images/component-structure.png"
 */

// Test the regex pattern from PathAnalyzer.extractPathsFromText
const relativePathRegex = /\b([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+(?:\.[a-zA-Z0-9]+)?)\b/g;

const testCases = [
  {
    text: 'make a presentation version of this one: integrations/memory-visualizer/docs/images/component-structure.png',
    expected: ['integrations/memory-visualizer/docs/images/component-structure.png']
  },
  {
    text: 'Edit the file src/components/Button.tsx please',
    expected: ['src/components/Button.tsx']
  },
  {
    text: 'Check docs/README.md and tests/unit/parser.test.js',
    expected: ['docs/README.md', 'tests/unit/parser.test.js']
  },
  {
    text: 'Visit https://example.com/path/to/page should not match',
    expected: []  // URLs should not be extracted
  },
  {
    text: 'Just a filename.txt without path',
    expected: []  // Simple filenames without slash should not match
  }
];

console.log('🧪 Testing relative path extraction...\n');

let allPassed = true;

for (const testCase of testCases) {
  const operations = new Set();
  let relPathMatch;

  while ((relPathMatch = relativePathRegex.exec(testCase.text)) !== null) {
    const relPath = relPathMatch[1].trim();
    const commonTLDs = /^(com|org|net|edu|gov|io|co|dev|app|xyz)\//;
    if (relPath.includes('/') && !relPath.includes('://') && relPath.length > 3 && !commonTLDs.test(relPath)) {
      operations.add(relPath);
    }
  }

  const extracted = Array.from(operations);
  const passed = JSON.stringify(extracted.sort()) === JSON.stringify(testCase.expected.sort());

  console.log(`${passed ? '✅' : '❌'} Test: "${testCase.text.substring(0, 60)}..."`);
  console.log(`   Expected: [${testCase.expected.join(', ')}]`);
  console.log(`   Got:      [${extracted.join(', ')}]`);
  console.log();

  if (!passed) allPassed = false;

  // Reset regex lastIndex for next test
  relativePathRegex.lastIndex = 0;
}

if (allPassed) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}
