#!/usr/bin/env node

/**
 * Claude Bridge - Bridge script for Claude Code native hooks
 *
 * This script is called by Claude Code's native hook system and translates
 * the event to the unified hook format, then calls the shared hook manager.
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "command": "node",
 *       "args": ["/path/to/coding/lib/agent-api/hooks/claude-bridge.js"]
 *     }]
 *   }
 * }
 *
 * The bridge:
 * 1. Reads hook context from stdin (JSON)
 * 2. Translates Claude-native event to unified format
 * 3. Executes unified hooks via hook-manager
 * 4. Returns response in Claude-expected format (JSON to stdout)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger } from '../../logging/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('claude-bridge');

/**
 * Map Claude native events to unified events
 */
const EVENT_MAP = {
  'PreToolUse': 'pre-tool',
  'PostToolUse': 'post-tool',
  'Startup': 'startup',
  'Shutdown': 'shutdown',
  'PrePrompt': 'pre-prompt',
  'PostPrompt': 'post-prompt',
  'Error': 'error'
};

/**
 * Read JSON from stdin
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      try {
        const parsed = data.trim() ? JSON.parse(data) : {};
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Failed to parse stdin JSON: ${error.message}`));
      }
    });

    process.stdin.on('error', reject);

    // Set a timeout for stdin
    setTimeout(() => {
      if (!data) {
        resolve({});
      }
    }, 1000);
  });
}

/**
 * Transform Claude-native context to unified format
 */
function transformContext(claudeContext, nativeEvent) {
  const unifiedEvent = EVENT_MAP[nativeEvent] || nativeEvent.toLowerCase();

  return {
    event: unifiedEvent,
    agentEvent: nativeEvent,
    agentType: 'claude',
    sessionId: claudeContext.session_id ||
      process.env.CLAUDE_SESSION_ID ||
      `claude-${process.pid}`,
    timestamp: Date.now(),

    // Tool information (for tool events)
    tool: claudeContext.tool_name ? {
      name: claudeContext.tool_name,
      input: claudeContext.tool_input || {},
      output: claudeContext.tool_output
    } : undefined,

    // Additional Claude-specific context
    metadata: {
      workingDirectory: claudeContext.cwd || process.cwd(),
      projectPath: process.env.TRANSCRIPT_SOURCE_PROJECT || claudeContext.project_path,
      ...claudeContext
    }
  };
}

/**
 * Transform unified response to Claude-expected format
 */
function transformResponse(unifiedResult) {
  // Claude expects: { decision: 'allow'|'block', message?: string }
  return {
    decision: unifiedResult.allow ? 'allow' : 'block',
    message: unifiedResult.messages?.join('\n') || undefined
  };
}

/**
 * Main bridge execution
 */
async function main() {
  try {
    // Get the native event from environment or command line
    const nativeEvent = process.env.HOOK_EVENT ||
      process.argv[2] ||
      'PreToolUse'; // Default for testing

    // Read context from stdin
    const claudeContext = await readStdin();

    logger.debug(`Bridge received event: ${nativeEvent}`, { context: claudeContext });

    // Transform to unified context
    const unifiedContext = transformContext(claudeContext, nativeEvent);

    // Load and execute unified hooks
    const { getHookManager } = await import('./hook-manager.js');
    const manager = getHookManager();

    // Initialize manager if not already done
    if (!manager.initialized) {
      const projectPath = unifiedContext.metadata?.projectPath || process.cwd();
      await manager.initialize(projectPath);
    }

    // Execute hooks
    const result = await manager.executeHooks(unifiedContext.event, unifiedContext, 'claude');

    logger.debug(`Bridge execution complete`, { result });

    // Transform and output response
    const response = transformResponse(result);
    process.stdout.write(JSON.stringify(response));

    process.exit(0);
  } catch (error) {
    logger.error('Bridge execution failed', { error: error.message });

    // On error, allow the operation to continue (fail-open)
    const errorResponse = {
      decision: 'allow',
      message: `Hook bridge error: ${error.message}`
    };

    process.stdout.write(JSON.stringify(errorResponse));
    process.exit(0); // Exit 0 to not block Claude
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { main, transformContext, transformResponse, EVENT_MAP };
