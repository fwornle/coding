#!/usr/bin/env node

/**
 * Per-turn Knowledge Injection for GitHub Copilot CLI — postToolUse channel.
 *
 * WHY postToolUse: on Copilot CLI (verified v1.0.71 AND v1.0.72-1) a filesystem
 * command hook can only inject context the model actually reads via
 * `postToolUse` → `additionalContext` (appended to the tool result, ≤10 KB,
 * multiple hooks joined). `userPromptSubmitted` output is NOT processed, and
 * `modifiedPrompt` is honored only on the in-process SDK path — so per-prompt
 * prompt-rewrite is impossible from a filesystem hook. `postToolUse` injection
 * DOES reach the model (neutral-token sentinel confirmed on both versions; an
 * earlier "doesn't work" reading was a test-design artifact — a suspicious fake
 * fact the model distrusted, not a dropped payload).
 *
 * postToolUse has no user prompt, but userPromptSubmitted does (it fires yet can't
 * inject) — so two modes, invoked from copilot-bridge.sh:
 *   stash  (userPromptSubmitted) — persist the prompt keyed by sessionId; emit {}.
 *   inject (postToolUse)         — on the FIRST tool of that turn, retrieve KB
 *                                  against the stashed prompt and emit
 *                                  {"additionalContext":"<KB>"}; then mark the
 *                                  prompt consumed so later tools don't re-inject
 *                                  (once-per-turn — avoids context bloat). Emits {}
 *                                  otherwise.
 *
 * Reuses the agent-agnostic retrieval-client. Fail-open: any error / disabled
 * toggle / short prompt emits {} (or the no-op), never blocking a request. Output
 * is SINGLE-LINE JSON (Copilot requirement). A prompt that triggers no tools gets
 * no injection (rare for a tool-heavy coding agent); baseline context still comes
 * from the session-start adapter (knowledge-injection-copilot.js) + custom
 * instructions.
 *
 * Requires Copilot's `enableFileHooks` on + the repo folder trusted (both off by
 * default) before ANY .github/hooks/* fires — see install.sh install_copilot_file_hooks().
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callRetrieval } from './retrieval-client.js';

const MIN_WORDS = 4;
const MAX_QUERY_CHARS = 500;
const MAX_INJECT_CHARS = 9000; // under Copilot's 10 KB additionalContext cap
const SAFETY_TIMEOUT_MS = 4000; // under Copilot's hook timeoutSec
const STASH_DIR = path.join(os.tmpdir(), 'coding-copilot-kb');
const STASH_TTL_MS = 60 * 60 * 1000; // ignore stale stashes older than 1h

const safety = setTimeout(() => { process.stdout.write('{}'); process.exit(0); }, SAFETY_TIMEOUT_MS);
safety.unref();

function injectionEnabled() {
  const raw = process.env.CODING_KNOWLEDGE_INJECTION;
  if (raw == null) return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function stashPath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
  return path.join(STASH_DIR, `${safe}.json`);
}

async function readInput() {
  const chunks = [];
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function main() {
  try {
    const mode = process.argv[2]; // 'stash' | 'inject'
    if (!injectionEnabled()) return emit({});
    const input = await readInput();
    if (!input) return emit({});
    const sessionId = input.sessionId || input.session_id || 'unknown';

    if (mode === 'stash') {
      const prompt = String(input.prompt || '').trim();
      if (!prompt || prompt.startsWith('/')) return emit({});
      if (prompt.split(/\s+/).length < MIN_WORDS) return emit({});
      try {
        fs.mkdirSync(STASH_DIR, { recursive: true });
        fs.writeFileSync(stashPath(sessionId), JSON.stringify({ prompt, ts: Date.now(), consumed: false }), 'utf8');
      } catch { /* fail-open */ }
      return emit({}); // userPromptSubmitted output is ignored anyway
    }

    if (mode === 'inject') {
      const p = stashPath(sessionId);
      let stash;
      try { stash = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return emit({}); }
      if (!stash || stash.consumed) return emit({});
      if (typeof stash.ts === 'number' && Date.now() - stash.ts > STASH_TTL_MS) return emit({});

      const result = await callRetrieval({
        query: String(stash.prompt).slice(0, MAX_QUERY_CHARS),
        budget: 1000,
        threshold: 0.70,
        context: { agent: 'copilot', cwd: input.cwd || process.cwd() },
        task_id: process.env.TASK_ID || sessionId,
      });
      // Mark consumed regardless of retrieval outcome — one attempt per turn.
      try { fs.writeFileSync(p, JSON.stringify({ ...stash, consumed: true }), 'utf8'); } catch { /* noop */ }

      if (!result || !result.markdown || result.meta?.results_count === 0) return emit({});
      let block = result.markdown;
      if (block.length > MAX_INJECT_CHARS) block = block.slice(0, MAX_INJECT_CHARS) + '\n\n[truncated]';
      // Frame as reference context so the model treats it as provided knowledge.
      const additionalContext =
        'Retrieved project knowledge (reference context for the current task, provided by project tooling):\n\n' + block;
      return emit({ additionalContext });
    }

    return emit({});
  } catch {
    emit({});
  }
}

main();
