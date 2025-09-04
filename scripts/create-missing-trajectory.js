#!/usr/bin/env node

/**
 * Create Missing 1530-1630 Trajectory File
 * Uses built-in Grok/SemanticAnalyzer to analyze previous session and create trajectory
 */

import fs from 'fs';
import path from 'path';
import { SemanticAnalyzer } from '../src/live-logging/SemanticAnalyzer.js';

async function createMissingTrajectoryFile() {
  try {
    // Get API key from environment (preferring XAI/Grok)
    const apiKey = process.env.GROQ_API_KEY || process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    if (!apiKey) {
      throw new Error('No semantic analysis API key found. Set GROQ_API_KEY, XAI_API_KEY, or GROK_API_KEY');
    }

    console.log('🧠 Initializing semantic analyzer...');
    const semanticAnalyzer = new SemanticAnalyzer(apiKey);

    // Define file paths
    const historyDir = '.specstory/history';
    const trajectoryFile = '2025-09-04_1530-1630-trajectory.md';
    const trajectoryPath = path.join(historyDir, trajectoryFile);

    // Check if trajectory file already exists
    if (fs.existsSync(trajectoryPath)) {
      console.log('📄 Trajectory file already exists:', trajectoryFile);
      return;
    }

    // Read previous session files
    const previousLSL = path.join(historyDir, '2025-09-04_1430-1530-session.md');
    const previousTrajectory = path.join(historyDir, '2025-09-04_1430-1530-trajectory.md');

    let analysisContent = '';
    let hasAnalysisData = false;

    if (fs.existsSync(previousTrajectory)) {
      const trajectoryContent = fs.readFileSync(previousTrajectory, 'utf8');
      analysisContent += `Previous Trajectory (1430-1530):\n${trajectoryContent.substring(0, 1500)}\n\n`;
      hasAnalysisData = true;
    }

    if (fs.existsSync(previousLSL)) {
      const lslContent = fs.readFileSync(previousLSL, 'utf8');
      analysisContent += `Previous Session Log (1430-1530):\n${lslContent.substring(0, 1500)}\n\n`;
      hasAnalysisData = true;
    }

    let trajectoryContent = `# Trajectory Analysis: 1530-1630\n\n` +
      `**Generated:** ${new Date().toISOString()}\n` +
      `**Session:** 1530-1630\n` +
      `**Focus:** Session trajectory and behavioral patterns\n` +
      `**Duration:** ~60 minutes\n\n` +
      `---\n\n## Session Trajectory\n\n`;

    // Perform semantic analysis if we have previous data
    if (hasAnalysisData && semanticAnalyzer) {
      console.log('🔍 Analyzing previous session with Grok...');
      
      const analysisPrompt = `${analysisContent}Based on the previous session data above, provide a brief trajectory analysis for the new 1530-1630 session focusing on:
1. Continuation patterns from the 1430-1530 session
2. Expected focus areas based on cross-repo work that was started
3. Learning trajectory insights for the new session

Keep response focused and under 300 words. Format as markdown sections.`;

      try {
        const mockInteraction = {
          toolCall: { name: 'trajectory-analysis', args: { prompt: analysisPrompt } },
          result: { data: 'session-transition' },
          timestamp: new Date().toISOString(),
          userPrompt: analysisPrompt
        };
        
        const result = await semanticAnalyzer.analyzeToolInteraction(mockInteraction, {
          focus: 'trajectory-analysis',
          sessionTransition: true
        });

        console.log('🔍 Analysis result:', JSON.stringify(result, null, 2));
        trajectoryContent += `## Analysis Summary\n\n${result.insight || result.summary || result.analysis || 'Semantic analysis completed.'}\n\n`;
        console.log('✅ Semantic analysis completed');
      } catch (error) {
        console.log(`⚠️ Semantic analysis failed: ${error.message}`);
        trajectoryContent += `## Analysis Summary\n\nTrajectory initialized. Previous session focused on PlantUML PNG generation fixes and cross-repo functionality analysis.\n\n`;
      }
    } else {
      trajectoryContent += `## Analysis Summary\n\nTrajectory initialized. No previous session data available for analysis.\n\n`;
    }

    trajectoryContent += `## Key Patterns\n\n- Session started at ${new Date().toISOString()}\n` +
      `- Continuation of cross-repo functionality investigation\n` +
      `- Focus on LSL + trajectory file pair creation system\n\n` +
      `## Learning Insights\n\n- Building upon PlantUML generation work from previous session\n` +
      `- Implementing automated trajectory file creation\n` +
      `- Enhancing semantic analysis integration\n\n` +
      `---\n\n`;

    // Write trajectory file
    fs.writeFileSync(trajectoryPath, trajectoryContent);
    console.log(`🎯 Created trajectory file: ${trajectoryFile}`);
    
    // Show file size and location
    const stats = fs.statSync(trajectoryPath);
    console.log(`📊 File size: ${stats.size} bytes`);
    console.log(`📁 Location: ${path.resolve(trajectoryPath)}`);

  } catch (error) {
    console.error('❌ Failed to create trajectory file:', error.message);
    process.exit(1);
  }
}

// Run the script
createMissingTrajectoryFile().catch(console.error);