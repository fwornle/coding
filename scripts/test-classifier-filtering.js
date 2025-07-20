#!/usr/bin/env node

import LightweightEmbeddingClassifier from './lightweight-embedding-classifier.js';

const testContent = `# Session Log

## Exchange 1
**User:** <command-name>/sl</command-name>

## Exchange 2  
**User:** Read session logs for continuity. I'll read the last session log files.

## Exchange 3
**User:** Create an embedding classifier for better session logging classification

## Exchange 4
**Assistant:** I'll implement an embedding-based classification system to improve accuracy`;

async function test() {
  const classifier = new LightweightEmbeddingClassifier();
  
  console.log('Testing content filtering...');
  const filtered = classifier.extractSubstantiveContent(testContent);
  console.log('Filtered content:');
  console.log(filtered);
  console.log('\n---\n');
  
  console.log('Testing classification...');
  const result = await classifier.classifyContent(testContent);
  console.log('Classification result:', result);
}

test().catch(console.error);