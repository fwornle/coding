#!/usr/bin/env node

/**
 * Knowledge Injection Hook for Claude Code (UserPromptSubmit)
 *
 * Calls the retrieval service on substantive prompts and injects
 * returned knowledge as system-reminder context via additionalContext.
 *
 * Fail-open: any error or timeout exits 0 with no stdout.
 * Uses shared retrieval-client.js for HTTP calls.
 */

import { callRetrieval } from './retrieval-client.js';

// Absolute safety ceiling -- never let the hook hang Claude Code
const SAFETY_TIMEOUT_MS = 5000;
const safetyTimer = setTimeout(() => process.exit(0), SAFETY_TIMEOUT_MS);
safetyTimer.unref();

const MIN_WORDS = 4;
const MAX_QUERY_CHARS = 500;
const MAX_OUTPUT_CHARS = 9500;

async function main() {
  try {
    // 1. Read stdin (Claude Code pipes JSON to hook process)
    const chunks = [];
    if (!process.stdin.isTTY) {
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return;

    // 2. Parse input JSON
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return; // Fail-open on parse error
    }

    const prompt = (input.prompt || '').trim();

    // 3. Filter: empty prompt
    if (!prompt) return;

    // 4. Filter: slash commands
    if (prompt.startsWith('/')) return;

    // 5. Filter: short prompts (< MIN_WORDS words)
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount < MIN_WORDS) return;

    // 6. Build project context for relevance boosting (D-10)
    const context = {
      project: process.env.CODING_PROJECT_DIR
        ? process.env.CODING_PROJECT_DIR.split('/').pop()
        : process.cwd().split('/').pop(),
      cwd: process.env.CODING_PROJECT_DIR || process.cwd(),
    };

    // 7. Truncate query for retrieval (server rejects > 500 chars)
    const query = prompt.slice(0, MAX_QUERY_CHARS);

    // 8. Call retrieval service with context
    const result = await callRetrieval({
      query,
      budget: 1000,
      threshold: 0.75,
      context,
    });
    if (!result || !result.markdown || result.meta?.results_count === 0) return;

    // 9. Safety truncation (stay under 10K char hook output limit)
    let markdown = result.markdown;
    if (markdown.length > MAX_OUTPUT_CHARS) {
      markdown = markdown.slice(0, MAX_OUTPUT_CHARS) + '\n\n[truncated]';
    }

    // 10. Write JSON to stdout for Claude Code context injection
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: markdown,
      },
    }));
  } catch (err) {
    process.stderr.write('[knowledge-hook] Error: ' + err.message + '\n');
  }
}

main().then(() => process.exit(0));
