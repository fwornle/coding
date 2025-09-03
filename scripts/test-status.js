#!/usr/bin/env node

/**
 * Minimal test for status line functionality
 */

console.log("📝 Test status line");

// Test basic functionality without dependencies
try {
  const os = require('os');
  const homeDir = os.homedir();
  console.log(`✅ Home directory: ${homeDir}`);
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}