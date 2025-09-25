#!/usr/bin/env node

/**
 * Enhanced LSL Generation Script with Proper Parallel Processing
 * 
 * This script implements the correct 5-step approach:
 * 1. Determine requested range (default: -24h... configurable up to "everything") 
 * 2. Scan for (true) user prompts to make a list of "prompt sets" (chat chunks)
 * 3. Divide the list of chunk sets into sections for parallel processors
 * 4. Classify each chat chunk and produce LSL output snippets
 * 5. Write snippets to corresponding LSL files, honoring timestamps
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import EnhancedTranscriptMonitor from './enhanced-transcript-monitor.js';

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const cleanMode = args.includes('--clean');
  const parallelMode = args.includes('--parallel') || args.includes('--fast');
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'all';
  const fileArg = args.find(arg => arg.startsWith('--file='));
  const specificFile = fileArg ? fileArg.split('=')[1] : null;
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Enhanced LSL Generation Script

Usage: node generate-proper-lsl-from-transcripts-fixed.js [options]

Options:
  --mode=MODE        Processing mode: 'all' or 'foreign' (default: all)
  --clean           Remove existing LSL files before generating new ones
  --parallel        Enable parallel processing for faster execution
  --fast            Alias for --parallel
  --help, -h        Show this help message

Environment Variables:
  TRANSCRIPT_SOURCE_PROJECT  Path to source project containing transcripts
  CODING_TOOLS_PATH         Path to coding tools directory

Examples:
  node generate-proper-lsl-from-transcripts-fixed.js --mode=foreign --parallel --clean
  TRANSCRIPT_SOURCE_PROJECT="/path/to/nano-degree" node generate-proper-lsl-from-transcripts-fixed.js --fast
`);
    process.exit(0);
  }

  // Validate environment
  const sourceProject = process.env.TRANSCRIPT_SOURCE_PROJECT;
  const codingPath = process.env.CODING_TOOLS_PATH;
  
  if (!sourceProject || !codingPath) {
    console.error(`❌ Missing required environment variables:
  TRANSCRIPT_SOURCE_PROJECT (current: ${sourceProject || 'not set'})
  CODING_TOOLS_PATH (current: ${codingPath || 'not set'})
  
Set these variables and try again.`);
    process.exit(1);
  }

  // Validate modes
  if (!['all', 'foreign'].includes(mode)) {
    console.error(`❌ Invalid mode: ${mode}. Must be 'all' or 'foreign'`);
    process.exit(1);
  }

  console.log('🚀 Starting enhanced LSL generation...');
  console.log(`📂 Source project: ${sourceProject}`);
  console.log(`🔧 Coding tools: ${codingPath}`);
  console.log(`📋 Mode: ${mode.toUpperCase()} | Clean: ${cleanMode ? 'YES' : 'NO'} | Parallel: ${parallelMode ? 'YES' : 'NO'}`);

  // Step 1: Determine requested range - find transcript files or use specific file
  console.log('\n📋 Step 1: Finding transcript files...');
  
  let transcriptFiles;
  if (specificFile) {
    if (fs.existsSync(specificFile)) {
      const stats = fs.statSync(specificFile);
      transcriptFiles = [{
        path: specificFile,
        filename: path.basename(specificFile),
        size: stats.size
      }];
      console.log(`Using specific file: ${specificFile}`);
    } else {
      console.error(`❌ Specified file not found: ${specificFile}`);
      process.exit(1);
    }
  } else {
    transcriptFiles = findTranscriptFiles(sourceProject);
    console.log(`Found ${transcriptFiles.length} transcript files`);
  }
  
  if (transcriptFiles.length === 0) {
    console.log('No transcript files found. Exiting.');
    return;
  }

  // Step 2-5: Use the enhanced transcript monitor for proper processing
  console.log('\n🧠 Step 2-5: Processing with EnhancedTranscriptMonitor...');
  
  const monitor = new EnhancedTranscriptMonitor({ 
    projectPath: sourceProject,  // Use source project for proper filename generation
    skipSemanticAnalysis: parallelMode,  // Skip semantic analysis in fast mode
    mode: mode  // Pass the mode (all/foreign) to the monitor
  });

  // Wait for classifier to be ready
  let retries = 0;
  while (!monitor.reliableCodingClassifierReady && retries < 30) {
    console.log(`⏳ Waiting for classifier initialization... (${retries + 1}/30)`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    retries++;
  }

  if (!monitor.reliableCodingClassifierReady) {
    console.error('❌ Failed to initialize classifier after 30 seconds');
    process.exit(1);
  }

  console.log('✅ Classifier ready');

  // Clean old files if requested
  if (cleanMode) {
    console.log('\n🧹 Cleaning old LSL files...');
    await cleanOldFiles(mode, sourceProject, codingPath);
  }

  // Process files using the proper parallel processing
  const startTime = Date.now();
  let totalExchanges = 0;
  
  if (parallelMode) {
    console.log(`\n🚀 Processing ${transcriptFiles.length} files in parallel (max 8 concurrent)...`);
    const results = await monitor.processTranscriptsInParallel(transcriptFiles, 8);
    
    // Aggregate results
    let successCount = 0;
    let errorCount = 0;
    
    for (const result of results) {
      totalExchanges += result.exchanges || 0;
      if (result.status === 'success') {
        successCount++;
        console.log(`✅ ${result.file}: ${result.exchanges} exchanges (${(result.duration / 1000).toFixed(1)}s)`);
      } else {
        errorCount++;
        console.log(`❌ ${result.file}: ${result.error || 'Unknown error'}`);
      }
    }
    
    console.log(`\n📊 Parallel processing completed:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    
  } else {
    console.log(`\n🔄 Processing ${transcriptFiles.length} files sequentially...`);
    let successCount = 0;
    let errorCount = 0;
    
    for (const transcriptFile of transcriptFiles) {
      console.log(`Processing: ${transcriptFile}`);
      const result = await monitor.processSingleTranscript(transcriptFile, true); // Force streaming
      totalExchanges += result.exchanges || 0;
      
      if (result.status === 'success') {
        successCount++;
        console.log(`✅ ${result.file}: ${result.exchanges} exchanges (${(result.duration / 1000).toFixed(1)}s)`);
      } else {
        errorCount++;
        console.log(`❌ ${result.file}: ${result.error || 'Unknown error'}`);
      }
    }
    
    console.log(`\n📊 Sequential processing completed:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 LSL generation completed in ${elapsed}s`);
  console.log(`   Total exchanges processed: ${totalExchanges}`);
  
  // Show classifier stats if available
  if (monitor.reliableCodingClassifier) {
    const stats = monitor.reliableCodingClassifier.getStats();
    console.log(`   Classification stats: ${stats.totalClassifications} total, avg ${stats.avgClassificationTime?.toFixed(1)}ms`);
  }
  
  // Force exit to prevent hanging
  process.exit(0);
}

/**
 * Find all transcript files in the source project
 */
function findTranscriptFiles(sourceProject) {
  const transcriptFiles = [];
  
  try {
    // Look in .claude/projects directories
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    
    if (fs.existsSync(claudeDir)) {
      const projectDirs = fs.readdirSync(claudeDir);
      
      for (const dir of projectDirs) {
        if (dir.includes(path.basename(sourceProject))) {
          const projectDir = path.join(claudeDir, dir);
          const files = fs.readdirSync(projectDir);
          
          for (const file of files) {
            if (file.endsWith('.jsonl')) {
              const filePath = path.join(projectDir, file);
              const stats = fs.statSync(filePath);
              
              transcriptFiles.push({
                path: filePath,
                filename: file,
                size: stats.size
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error finding transcript files: ${error.message}`);
  }
  
  // Sort by modification time (newest first)
  return transcriptFiles.sort((a, b) => {
    try {
      const statA = fs.statSync(a.path);
      const statB = fs.statSync(b.path);
      return statB.mtime.getTime() - statA.mtime.getTime();
    } catch (error) {
      return 0;
    }
  });
}

/**
 * Clean old LSL files
 */
async function cleanOldFiles(mode, sourceProject, codingPath) {
  const projectsToClean = [];
  
  if (mode === 'all') {
    projectsToClean.push(sourceProject);
  } else if (mode === 'foreign') {
    projectsToClean.push(codingPath); // Only clean coding project in foreign mode
  }
  
  for (const projectPath of projectsToClean) {
    const historyDir = path.join(projectPath, '.specstory', 'history');
    
    if (fs.existsSync(historyDir)) {
      try {
        const files = fs.readdirSync(historyDir);
        let removedCount = 0;
        
        for (const file of files) {
          if (file.endsWith('.md')) {
            fs.unlinkSync(path.join(historyDir, file));
            removedCount++;
          }
        }
        
        console.log(`   Removed ${removedCount} LSL files from ${path.basename(projectPath)}`);
      } catch (error) {
        console.error(`   Error cleaning ${projectPath}: ${error.message}`);
      }
    }
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ LSL generation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}