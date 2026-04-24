#!/usr/bin/env node

/**
 * Knowledge Injection Hook for Claude Code (UserPromptSubmit)
 *
 * Calls the retrieval service on substantive prompts and injects
 * returned knowledge as system-reminder context via additionalContext.
 *
 * Fail-open: any error or timeout exits 0 with no stdout.
 * Zero npm dependencies -- uses only Node.js built-in http module.
 */

import http from 'node:http';

// Absolute safety ceiling -- never let the hook hang Claude Code
const SAFETY_TIMEOUT_MS = 5000;
const safetyTimer = setTimeout(() => process.exit(0), SAFETY_TIMEOUT_MS);
safetyTimer.unref();

const MIN_TOKENS = 20;
const HTTP_TIMEOUT_MS = 2000;
const RETRIEVAL_PORT = 3033;
const MAX_QUERY_CHARS = 500;
const MAX_OUTPUT_CHARS = 9500;

async function main() {
  try {
    // 1. Read stdin (Claude Code pipes JSON to hook process)
    const chunks = [];
    if (process.stdin.isTTY === false) {
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

    // 5. Filter: short prompts (< MIN_TOKENS words)
    const tokenEstimate = prompt.split(/\s+/).length;
    if (tokenEstimate < MIN_TOKENS) return;

    // 6. Truncate query for retrieval (server rejects > 500 chars)
    const query = prompt.slice(0, MAX_QUERY_CHARS);

    // 7. Call retrieval service
    const result = await callRetrieval(query);
    if (!result || !result.markdown || result.meta?.results_count === 0) return;

    // 8. Safety truncation (stay under 10K char hook output limit)
    let markdown = result.markdown;
    if (markdown.length > MAX_OUTPUT_CHARS) {
      markdown = markdown.slice(0, MAX_OUTPUT_CHARS) + '\n\n[truncated]';
    }

    // 9. Write JSON to stdout for Claude Code context injection
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

/**
 * POST to retrieval service. ALWAYS resolves (never rejects) -- fail-open.
 * Returns parsed response JSON or null on any error/timeout.
 */
function callRetrieval(query) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ query, budget: 1000, threshold: 0.75 });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: RETRIEVAL_PORT,
        path: '/api/retrieve',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: HTTP_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

main().then(() => process.exit(0));
