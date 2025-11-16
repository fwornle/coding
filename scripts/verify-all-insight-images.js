#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const insightsDir = '/Users/q284340/Agentic/coding/knowledge-management/insights';
const referencedFile = '/tmp/referenced_images_final.txt';

const references = fs.readFileSync(referencedFile, 'utf-8')
  .split('\n')
  .filter(line => line.trim());

console.log(`Verifying ${references.length} image references...\n`);

const missing = [];
const found = [];

for (const ref of references) {
  // Resolve relative path from insights directory
  const fullPath = path.join(insightsDir, ref);

  if (!fs.existsSync(fullPath)) {
    missing.push({ ref, fullPath });
    console.log(`❌ MISSING: ${ref}`);
    console.log(`   Expected at: ${fullPath}\n`);
  } else {
    found.push(ref);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`✅ Found: ${found.length}`);
console.log(`❌ Missing: ${missing.length}`);

if (missing.length === 0) {
  console.log(`\n🎉 All image references are valid!`);
} else {
  console.log(`\n⚠️  Fix needed for ${missing.length} image(s)`);
}
