#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptRoot = path.resolve(__dirname, '..');
const insightsDir = path.join(scriptRoot, 'knowledge-management', 'insights');
const referencedFile = '/tmp/referenced_images.txt';

const references = fs.readFileSync(referencedFile, 'utf-8')
  .split('\n')
  .filter(line => line.trim());

console.log(`Checking ${references.length} image references...`);

const missing = [];
const found = [];

for (const ref of references) {
  // Normalize the path - remove leading ./
  let normalized = ref.replace(/^\.\//, '');

  // Resolve relative path from insights directory
  const fullPath = path.join(insightsDir, normalized);

  if (!fs.existsSync(fullPath)) {
    missing.push(ref);
  } else {
    found.push(ref);
  }
}

console.log(`\n✅ Found: ${found.length}`);
console.log(`❌ Missing: ${missing.length}\n`);

if (missing.length > 0) {
  console.log('Missing files:');
  missing.forEach(m => console.log(`  - ${m}`));
}
