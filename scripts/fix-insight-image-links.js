#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const insightsDir = '/Users/q284340/Agentic/coding/knowledge-management/insights';

// List of broken mermaid PNG references to remove
const brokenMermaidRefs = [
  './images/commandpatternimplementation-integration-mermaid.png',
  './images/commandpatternimplementation-pattern-mermaid.png',
  './images/commandpatternimplementation-workflow-mermaid.png',
  './images/repositorypatternimplementation-architecture-mermaid.png',
  './images/repositorypatternimplementation-integration-mermaid.png',
  './images/repositorypatternimplementation-pattern-mermaid.png',
  './images/repositorypatternimplementation-workflow-mermaid.png'
];

// Read all markdown files
const mdFiles = fs.readdirSync(insightsDir)
  .filter(f => f.endsWith('.md'))
  .map(f => path.join(insightsDir, f));

console.log(`Processing ${mdFiles.length} markdown files...`);

let filesModified = 0;
let referencesRemoved = 0;

for (const filepath of mdFiles) {
  let content = fs.readFileSync(filepath, 'utf-8');
  let modified = false;

  // Remove broken mermaid PNG references
  for (const brokenRef of brokenMermaidRefs) {
    // Match pattern: ![Alt Text](broken-ref)
    const pattern = new RegExp(`!\\[[^\\]]*\\]\\(${brokenRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n*`, 'g');

    if (pattern.test(content)) {
      content = content.replace(pattern, '');
      modified = true;
      referencesRemoved++;
      console.log(`  Removed broken ref from ${path.basename(filepath)}: ${brokenRef}`);
    }
  }

  if (modified) {
    fs.writeFileSync(filepath, content, 'utf-8');
    filesModified++;
  }
}

console.log(`\nComplete:`);
console.log(`  Files modified: ${filesModified}`);
console.log(`  References removed: ${referencesRemoved}`);
