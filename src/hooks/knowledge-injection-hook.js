#!/usr/bin/env node

/**
 * Knowledge Injection Hook for Claude Code (UserPromptSubmit)
 *
 * Calls the retrieval service on substantive prompts and injects
 * returned knowledge as system-reminder context via additionalContext.
 *
 * Conversation-aware: reads the last N assistant messages from the
 * session transcript to build a topic-enriched query, so the retrieval
 * service can discriminate relevant knowledge from project-wide noise.
 *
 * Fail-open: any error or timeout exits 0 with no stdout.
 * Uses shared retrieval-client.js for HTTP calls.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import { callRetrieval } from './retrieval-client.js';

// Absolute safety ceiling -- never let the hook hang Claude Code
const SAFETY_TIMEOUT_MS = 5000;
const safetyTimer = setTimeout(() => process.exit(0), SAFETY_TIMEOUT_MS);
safetyTimer.unref();

const MIN_WORDS = 4;
const MAX_QUERY_CHARS = 500;
const MAX_OUTPUT_CHARS = 9500;
const TRANSCRIPT_TAIL_BYTES = 50000; // Read last ~50KB of transcript
const MAX_CONTEXT_CHARS = 300;       // Context summary for query enrichment

/**
 * Extract conversation topics from the session transcript JSONL.
 * Reads the tail of the file to get recent messages, extracts user
 * and assistant text to build a topic summary for query enrichment.
 *
 * @param {string} transcriptPath - Path to the .jsonl transcript file
 * @returns {string} Topic summary (max MAX_CONTEXT_CHARS chars)
 */
function extractConversationTopics(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';

    const stat = fs.statSync(transcriptPath);
    const start = Math.max(0, stat.size - TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, TRANSCRIPT_TAIL_BYTES));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);

    const tail = buf.toString('utf8');
    // If we started mid-line, skip the first partial line
    const lines = tail.split('\n');
    if (start > 0) lines.shift();

    // Parse JSONL lines, collect recent human/assistant text
    const snippets = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Claude Code transcript format: { role, content, ... }
        if (msg.role === 'user' && typeof msg.content === 'string') {
          snippets.push(msg.content.slice(0, 200));
        } else if (msg.role === 'user' && Array.isArray(msg.content)) {
          // content blocks: [{ type: "text", text: "..." }, ...]
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              snippets.push(block.text.slice(0, 200));
            }
          }
        } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
          snippets.push(msg.content.slice(0, 200));
        } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              snippets.push(block.text.slice(0, 200));
            }
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    // Take last 5 snippets as topic context
    const recent = snippets.slice(-5).join(' ');
    return recent.slice(0, MAX_CONTEXT_CHARS);
  } catch {
    return ''; // Fail-open
  }
}

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
      agent: 'claude',
    };

    // 7. Extract conversation topics from transcript for query enrichment
    const conversationContext = extractConversationTopics(input.transcript_path);

    // 8. Build enriched query: prompt + conversation topic context
    //    This gives the embedding model actual semantic signal about what
    //    the conversation is about, not just the current short prompt.
    let enrichedQuery = prompt;
    if (conversationContext) {
      enrichedQuery = `${prompt} [context: ${conversationContext}]`;
    }

    // 9. Truncate query for retrieval (server rejects > 500 chars)
    const query = enrichedQuery.slice(0, MAX_QUERY_CHARS);

    // 10. Call retrieval service with context
    const result = await callRetrieval({
      query,
      budget: 1000,
      threshold: 0.82,
      context,
    });
    if (!result || !result.markdown || result.meta?.results_count === 0) return;

    // 11. Safety truncation (stay under 10K char hook output limit)
    let markdown = result.markdown;
    if (markdown.length > MAX_OUTPUT_CHARS) {
      markdown = markdown.slice(0, MAX_OUTPUT_CHARS) + '\n\n[truncated]';
    }

    // 12. Write JSON to stdout for Claude Code context injection
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
