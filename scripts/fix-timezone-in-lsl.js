#!/usr/bin/env node

/**
 * Fix Timezone Display in LSL Files
 * Converts UTC timestamps to dual format (UTC + local time)
 */

import fs from 'fs';
import path from 'path';

// Function to format timestamp with both UTC and local time
function formatTimestamp(utcTimestamp) {
  const date = new Date(utcTimestamp);
  const utcTime = date.toISOString();
  const localTime = date.toLocaleString('sv-SE'); // ISO-like format in local time
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${utcTime} (${localTime} ${timezone})`;
}

// Fix LSL file timestamps
function fixLslTimestamps(filePath) {
  console.log(`📝 Processing: ${path.basename(filePath)}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changeCount = 0;
  
  // Pattern to match UTC timestamps in LSL entries: ### ToolName - 2025-09-04T15:21:48.549Z
  const timestampPattern = /^(### .+ - )(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/gm;
  
  content = content.replace(timestampPattern, (match, prefix, utcTimestamp) => {
    const newTimestamp = formatTimestamp(utcTimestamp);
    changeCount++;
    return prefix + newTimestamp;
  });
  
  // Also fix "Generated:" timestamps in headers
  const generatedPattern = /^(\*\*Generated:\*\* )(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/gm;
  
  content = content.replace(generatedPattern, (match, prefix, utcTimestamp) => {
    const newTimestamp = formatTimestamp(utcTimestamp);
    changeCount++;
    return prefix + newTimestamp;
  });
  
  if (changeCount > 0) {
    fs.writeFileSync(filePath, content);
    console.log(`   ✅ Updated ${changeCount} timestamps`);
  } else {
    console.log(`   ⏭️  No timestamps to fix`);
  }
  
  return changeCount;
}

// Main function
async function main() {
  const historyDir = '.specstory/history';
  const today = '2025-09-04';
  
  console.log('🕒 Fixing timezone display in LSL files from today...\n');
  
  // Find all LSL files from today
  const files = fs.readdirSync(historyDir)
    .filter(file => file.includes(today) && file.endsWith('-session.md'))
    .map(file => path.join(historyDir, file));
  
  console.log(`📁 Found ${files.length} LSL files from ${today}:`);
  files.forEach(file => console.log(`   - ${path.basename(file)}`));
  console.log();
  
  let totalChanges = 0;
  
  for (const file of files) {
    const changes = fixLslTimestamps(file);
    totalChanges += changes;
  }
  
  console.log(`\n🎉 Timezone fix complete!`);
  console.log(`   📊 Files processed: ${files.length}`);
  console.log(`   🔄 Total timestamps updated: ${totalChanges}`);
  console.log(`   📅 All timestamps now show: UTC (Local Timezone)`);
}

// Run the script
main().catch(console.error);