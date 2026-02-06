#!/usr/bin/env node

/**
 * Copilot Bridge Handler - Node.js handler for Copilot hook bridge
 *
 * This is called by copilot-bridge.sh to execute unified hooks.
 * It reads the unified context from stdin and outputs the result as JSON.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createLogger } from '../../logging/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('copilot-bridge-handler');

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
 * Transform the unified context from the shell bridge
 */
function enrichContext(context) {
  // Extract tool information from native context if present
  const nativeContext = context.nativeContext || {};

  return {
    ...context,
    tool: nativeContext.tool ? {
      name: nativeContext.tool.name,
      input: nativeContext.tool.input,
      output: nativeContext.tool.output
    } : undefined,
    prompt: nativeContext.prompt ? {
      text: nativeContext.prompt.text,
      role: nativeContext.prompt.role
    } : undefined,
    error: nativeContext.error ? {
      message: nativeContext.error.message,
      stack: nativeContext.error.stack
    } : undefined,
    metadata: {
      workingDirectory: nativeContext.cwd || process.cwd(),
      projectPath: process.env.TRANSCRIPT_SOURCE_PROJECT || nativeContext.projectPath,
      ...nativeContext
    }
  };
}

/**
 * Main handler execution
 */
async function main() {
  try {
    // Read unified context from stdin
    const rawContext = await readStdin();

    logger.debug('Handler received context', { context: rawContext });

    // Enrich context with additional data
    const context = enrichContext(rawContext);

    // Load and execute unified hooks
    const { getHookManager } = await import('./hook-manager.js');
    const manager = getHookManager();

    // Initialize manager if not already done
    if (!manager.initialized) {
      const projectPath = context.metadata?.projectPath || process.cwd();
      await manager.initialize(projectPath);
    }

    // Execute hooks
    const result = await manager.executeHooks(context.event, context, 'copilot');

    logger.debug('Handler execution complete', { result });

    // Output result as JSON
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    logger.error('Handler execution failed', { error: error.message });

    // On error, allow the operation to continue (fail-open)
    const errorResult = {
      allow: true,
      messages: [`Hook handler error: ${error.message}`],
      results: []
    };

    process.stdout.write(JSON.stringify(errorResult));
    process.exit(0);
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { main, enrichContext };
