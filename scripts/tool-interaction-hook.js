#!/usr/bin/env node

/**
 * Tool Interaction Hook for Claude Code
 * This script is called after each tool execution to capture interactions for live logging
 */

import { readFileSync } from 'fs';

// Read tool interaction data from stdin or process arguments
async function processToolInteraction() {
  try {
    let interactionData;
    
    // Try to read from stdin first
    if (process.stdin.isTTY === false) {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks).toString('utf8').trim();
      if (input) {
        interactionData = JSON.parse(input);
      }
    }
    
    // If no stdin data, try process arguments
    if (!interactionData && process.argv.length > 2) {
      const jsonArg = process.argv[2];
      interactionData = JSON.parse(jsonArg);
    }
    
    if (!interactionData) {
      console.error('No tool interaction data received');
      process.exit(1);
    }
    
    // Import and call the hook function
    const { captureToolInteraction } = await import('../.mcp-sync/tool-interaction-hook.js');
    
    await captureToolInteraction(
      interactionData.toolCall || { name: interactionData.tool, args: interactionData.args },
      interactionData.result || interactionData.output,
      { 
        timestamp: Date.now(),
        source: 'claude-code-hook',
        workingDirectory: process.cwd(),
        sessionId: interactionData.sessionId || 'unknown'
      }
    );
    
    console.log('Tool interaction captured successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('Error processing tool interaction:', error);
    process.exit(1);
  }
}

processToolInteraction();