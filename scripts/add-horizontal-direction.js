#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Read the list of files that need direction added
const fileListPath = '/tmp/needs_horizontal.txt';
const pumlDir = '/Users/q284340/Agentic/coding/docs/presentation/puml';

const files = fs.readFileSync(fileListPath, 'utf-8')
  .split('\n')
  .filter(f => f.trim());

console.log(`Processing ${files.length} presentation files...`);

let successCount = 0;
let skipCount = 0;

for (const filename of files) {
  const filepath = path.join(pumlDir, filename);

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');

    // Find the title line or include line
    let titleIndex = lines.findIndex(line => line.trim().startsWith('title '));

    // If no title, find the include line
    if (titleIndex === -1) {
      titleIndex = lines.findIndex(line => line.trim().startsWith('!include '));
    }

    if (titleIndex === -1) {
      console.log(`  SKIP: ${filename} - no title or include found`);
      skipCount++;
      continue;
    }

    // Check if direction already exists right after title/include
    if (lines[titleIndex + 1]?.includes('direction')) {
      console.log(`  SKIP: ${filename} - already has direction`);
      skipCount++;
      continue;
    }

    // Check if this is a sequence diagram (should not add horizontal direction)
    const hasParticipants = /^\s*participant\s/m.test(content);
    const hasActors = /^\s*actor\s/m.test(content);
    const isSequenceDiagram = hasParticipants || hasActors;
    if (isSequenceDiagram) {
      console.log(`  SKIP: ${filename} - sequence diagram (naturally vertical)`);
      skipCount++;
      continue;
    }

    // Insert blank line and direction after title/include
    lines.splice(titleIndex + 1, 0, '', 'left to right direction');

    // Write back
    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
    console.log(`  ✓ ${filename}`);
    successCount++;

  } catch (error) {
    console.error(`  ERROR: ${filename} - ${error.message}`);
  }
}

console.log(`\nComplete: ${successCount} updated, ${skipCount} skipped`);
