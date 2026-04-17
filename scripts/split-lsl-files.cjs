#!/usr/bin/env node
/**
 * Split oversized LSL history files into numbered parts.
 * Splits at "## Prompt Set" boundaries, respecting max file size.
 * 
 * Usage: node scripts/split-lsl-files.js [--dry-run] [--max-kb=200] [--dir=.specstory/history]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const maxKbArg = args.find(a => a.startsWith('--max-kb='));
const dirArg = args.find(a => a.startsWith('--dir='));

const MAX_SIZE_KB = maxKbArg ? parseInt(maxKbArg.split('=')[1]) : 200;
const MAX_SIZE = MAX_SIZE_KB * 1024;
const HISTORY_DIR = dirArg ? dirArg.split('=')[1] : path.join(__dirname, '..', '.specstory', 'history');

// Match base LSL filenames: YYYY-MM-DD_HHMM-HHMM_hash[_from-project].md
const BASE_FILE_RE = /^(\d{4}-\d{2}-\d{2}_\d{4}-\d{4})_([a-z0-9]{6}(?:_from-[a-zA-Z0-9_-]+)?)\.md$/;
// Match already-split files: YYYY-MM-DD_HHMM-HHMM-N_hash[_from-project].md
const SPLIT_FILE_RE = /^(\d{4}-\d{2}-\d{2}_\d{4}-\d{4})-(\d+)_([a-z0-9]{6}(?:_from-[a-zA-Z0-9_-]+)?)\.md$/;

function splitFileContent(content) {
  const firstPromptSet = content.indexOf('\n## Prompt Set');
  const header = firstPromptSet > 0 ? content.substring(0, firstPromptSet + 1) : '';
  const body = firstPromptSet > 0 ? content.substring(firstPromptSet + 1) : content;
  const chunks = body.split(/^(?=## Prompt Set)/gm).filter(s => s.trim());
  if (chunks.length <= 1) return null;

  const headerBytes = Buffer.byteLength(header, 'utf8');
  const parts = [];
  let currentPart = header;
  let currentBytes = headerBytes;
  
  for (const chunk of chunks) {
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    if (currentBytes + chunkBytes > MAX_SIZE && currentBytes > headerBytes) {
      parts.push(currentPart);
      currentPart = header + chunk;
      currentBytes = headerBytes + chunkBytes;
    } else {
      currentPart += chunk;
      currentBytes += chunkBytes;
    }
  }
  if (currentBytes > headerBytes) parts.push(currentPart);
  if (parts.length <= 1) return null;
  return parts;
}

function splitAtLines(content) {
  const lines = content.split('\n');
  const parts = [];
  let currentPart = '';
  let currentBytes = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (currentBytes + lineBytes > MAX_SIZE && currentBytes > 0) {
      parts.push(currentPart);
      currentPart = line + '\n';
      currentBytes = lineBytes;
    } else {
      currentPart += line + '\n';
      currentBytes += lineBytes;
    }
  }
  if (currentPart.length > 0) parts.push(currentPart);
  if (parts.length <= 1) return null;
  return parts;
}

function splitFile(filePath, baseName, suffix, startNum) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') <= MAX_SIZE) return 0;

  let parts = splitFileContent(content);
  if (!parts) {
    // Fallback: split at line boundaries for single-exchange files
    parts = splitAtLines(content);
    if (!parts) {
      console.log(`  SKIP ${path.basename(filePath)} — can't split`);
      return 0;
    }
  }

  // Write part files
  const dir = path.dirname(filePath);
  const partFiles = [];
  for (let i = 0; i < parts.length; i++) {
    const partName = `${baseName}-${startNum + i}_${suffix}.md`;
    const partPath = path.join(dir, partName);
    partFiles.push(partName);
    if (!dryRun) {
      fs.writeFileSync(partPath, parts[i]);
    }
  }

  console.log(`  SPLIT ${path.basename(filePath)} (${(content.length / 1024).toFixed(0)}KB) → ${parts.length} parts`);
  partFiles.forEach((f, i) => {
    const size = dryRun ? '?' : (fs.statSync(path.join(dir, f)).size / 1024).toFixed(0);
    console.log(`    ${f} (${size}KB)`);
  });

  // Remove original
  if (!dryRun) {
    fs.unlinkSync(filePath);
  }

  return parts.length;
}

// Main — process iteratively until no more oversized files
let iteration = 0;
let grandTotalSplit = 0;
let grandTotalParts = 0;

while (true) {
  iteration++;
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.md'));
  let totalSplit = 0;
  let totalParts = 0;

  // Group existing split files by base to find max part number
  const maxPartNum = {};
  for (const file of files) {
    const sm = file.match(SPLIT_FILE_RE);
    if (sm) {
      const key = `${sm[1]}_${sm[3]}`;
      const num = parseInt(sm[2]);
      maxPartNum[key] = Math.max(maxPartNum[key] || 0, num);
    }
  }

  for (const file of files) {
    const filePath = path.join(HISTORY_DIR, file);
    let stat;
    try { stat = fs.statSync(filePath); } catch(e) { continue; }
    if (stat.size <= MAX_SIZE) continue;

    let baseName, suffix, startNum;

    // Try base file match
    const bm = file.match(BASE_FILE_RE);
    if (bm) {
      baseName = bm[1];
      suffix = bm[2];
      startNum = 1;
    } else {
      // Try already-split file match
      const sm = file.match(SPLIT_FILE_RE);
      if (!sm) continue;
      baseName = sm[1];
      suffix = sm[3];
      const key = `${sm[1]}_${sm[3]}`;
      // Use numbers beyond current max to avoid collision
      startNum = (maxPartNum[key] || 0) + 1;
    }

    const parts = splitFile(filePath, baseName, suffix, startNum);
    if (parts > 0) {
      totalSplit++;
      totalParts += parts;
      // Update max part tracking
      const key = `${baseName}_${suffix}`;
      maxPartNum[key] = Math.max(maxPartNum[key] || 0, startNum + parts - 1);
    }
  }

  grandTotalSplit += totalSplit;
  grandTotalParts += totalParts;

  if (totalSplit === 0) break;
  console.log(`\nIteration ${iteration}: Split ${totalSplit} files into ${totalParts} parts`);
}

console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Total: Split ${grandTotalSplit} files into ${grandTotalParts} parts across ${iteration} iterations (max ${MAX_SIZE_KB}KB per part)`);
