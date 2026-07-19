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

/**
 * Per-avenue knowledge-injection toggle (Phase 87, AVN-04).
 *
 * A comparison avenue may declare `env: kb-off`; the runner (Plan 03) maps that to
 * `CODING_KNOWLEDGE_INJECTION=0` in the SPAWNED agent's child env. When that env var is
 * disabled, this hook must NOT retrieve or inject anything for that avenue's turns.
 *
 * CRITICAL (Pitfall 4 — scope): this reads process.env, so it only affects a process whose
 * env carries the disable value. The operator's interactive session leaves the var unset →
 * injection stays ON. Default is ON; only the literal `0` / `false` / `off` (case-insensitive,
 * trimmed) disables — any other value (including unset/empty) keeps injection enabled.
 *
 * @returns {boolean} true when injection is enabled, false when explicitly disabled.
 */
function isInjectionEnabled() {
  const raw = process.env.CODING_KNOWLEDGE_INJECTION;
  if (raw == null) return true; // unset → default ON (interactive session unaffected)
  const v = String(raw).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

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

    // Parse JSONL lines, collect recent human/assistant text.
    // IMPORTANT: Skip system-reminder content to avoid feedback loops —
    // previously injected insights/digests would contaminate the query
    // context, causing the same results to be re-retrieved every turn.
    const snippets = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Helper: extract text, filtering out system-reminder blocks
        const extractText = (content) => {
          if (typeof content === 'string') {
            // Skip if it's a system-reminder injection
            if (content.includes('<system-reminder>') || content.includes('## Insights') || content.includes('## Digests')) return null;
            return content.slice(0, 200);
          }
          if (Array.isArray(content)) {
            const parts = [];
            for (const block of content) {
              if (block.type !== 'text' || !block.text) continue;
              // Skip system-reminder content blocks
              if (block.text.includes('<system-reminder>') || block.text.includes('## Insights') || block.text.includes('## Digests')) continue;
              parts.push(block.text.slice(0, 200));
            }
            return parts.length > 0 ? parts.join(' ') : null;
          }
          return null;
        };

        if (msg.role === 'user' || msg.role === 'assistant') {
          const text = extractText(msg.content);
          if (text) snippets.push(text);
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
    // 0. Per-avenue injection toggle (AVN-04). When an avenue declares kb-off, the runner
    //    sets CODING_KNOWLEDGE_INJECTION=0 in this hook process's env — early-return BEFORE
    //    any retrieval so no working-memory prefix / additionalContext is emitted. Scoped to
    //    this process only (Pitfall 4): the operator's interactive session leaves it unset.
    if (!isInjectionEnabled()) return;

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

    // 10. Call retrieval service with context.
    // threshold=0.70: MiniLM-L6-v2 same-project cosine similarities cluster
    // at 0.75-0.82 (see retrieval-service.js _applyTopicRelevance), so a
    // higher floor silently filtered out almost every legitimate insight or
    // digest. The retrieval-service's topic-relevance pass (substring + exact-
    // token overlap) does the actual ranking; the threshold's job is just to
    // let the candidates in.
    // Phase B: forward the run id so the retrieval server persists a structured
    // per-item capture keyed by it. TASK_ID is set for experiment runs (the slug
    // the runs table shows); interactive sessions fall back to the Claude Code
    // hook's session_id (the UUID the auto-measure reconciler keys captures by).
    const task_id = process.env.TASK_ID || input.session_id || null;

    const result = await callRetrieval({
      query,
      budget: 1000,
      threshold: 0.70,
      context,
      task_id,
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
