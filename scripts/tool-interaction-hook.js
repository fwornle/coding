#!/usr/bin/env node

/**
 * Tool Interaction Hook for Claude Code
 * This script is called after each tool execution to capture interactions for live logging
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptRoot = join(__dirname, '..');

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
      // Gracefully handle missing data - this is normal for many tool calls
      process.exit(0);
    }

    // Check if we're in a coding environment with required services
    const codingRepo = process.env.CODING_REPO || scriptRoot;
    const hookFilePath = join(codingRepo, '.mcp-sync/tool-interaction-hook.js');

    // Fail gracefully if hook file doesn't exist (running outside coding environment)
    if (!existsSync(hookFilePath)) {
      // Not an error - just means we're running plain Claude without coding services
      process.exit(0);
    }

    // Import and call the hook function
    const { captureToolInteraction } = await import(hookFilePath);

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
    // Fail open - don't block Claude on hook errors
    // console.error('Tool interaction hook error:', error.message);
    process.exit(0);
  }
}

processToolInteraction();