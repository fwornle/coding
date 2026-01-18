#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptRoot = path.resolve(__dirname, '..');
const insightsDir = path.join(scriptRoot, 'knowledge-management', 'insights');

// Read all markdown files
const mdFiles = fs.readdirSync(insightsDir)
  .filter(f => f.endsWith('.md'))
  .map(f => path.join(insightsDir, f));

console.log(`Processing ${mdFiles.length} markdown files...`);

let filesModified = 0;
let pathsNormalized = 0;

for (const filepath of mdFiles) {
  let content = fs.readFileSync(filepath, 'utf-8');
  let modified = false;

  // Normalize ./images/ to images/ (keep ../../docs/images/ as is)
  const pattern = /!\[([^\]]*)\]\(\.\/images\//g;
  const matches = content.match(pattern);

  if (matches && matches.length > 0) {
    content = content.replace(pattern, '![$1](images/');
    modified = true;
    pathsNormalized += matches.length;
    console.log(`  Normalized ${matches.length} path(s) in ${path.basename(filepath)}`);
  }

  if (modified) {
    fs.writeFileSync(filepath, content, 'utf-8');
    filesModified++;
  }
}

console.log(`\nComplete:`);
console.log(`  Files modified: ${filesModified}`);
console.log(`  Paths normalized: ${pathsNormalized}`);
