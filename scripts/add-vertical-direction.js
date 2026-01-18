#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptRoot = path.resolve(__dirname, '..');

// Read the list of files that need direction added
const fileListPath = '/tmp/files_need_direction.txt';
const pumlDir = path.join(scriptRoot, 'docs', 'puml');

const files = fs.readFileSync(fileListPath, 'utf-8')
  .split('\n')
  .filter(f => f.trim());

console.log(`Processing ${files.length} files...`);

let successCount = 0;
let skipCount = 0;

for (const filename of files) {
  const filepath = path.join(pumlDir, filename);

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');

    // Find the title line
    const titleIndex = lines.findIndex(line => line.trim().startsWith('title '));

    if (titleIndex === -1) {
      console.log(`  SKIP: ${filename} - no title found`);
      skipCount++;
      continue;
    }

    // Check if direction already exists right after title
    if (lines[titleIndex + 1]?.includes('direction')) {
      console.log(`  SKIP: ${filename} - already has direction`);
      skipCount++;
      continue;
    }

    // Insert blank line and direction after title
    lines.splice(titleIndex + 1, 0, '', 'top to bottom direction');

    // Write back
    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
    console.log(`  ✓ ${filename}`);
    successCount++;

  } catch (error) {
    console.error(`  ERROR: ${filename} - ${error.message}`);
  }
}

console.log(`\nComplete: ${successCount} updated, ${skipCount} skipped`);
