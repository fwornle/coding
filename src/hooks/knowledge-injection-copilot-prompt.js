#!/usr/bin/env node

/**
 * Per-prompt Knowledge Injection for GitHub Copilot CLI (userPromptSubmitted).
 *
 * Parity with the Claude Code UserPromptSubmit hook (knowledge-injection-hook.js):
 * on a substantive prompt it retrieves the ~1000-token KB block and prepends it to
 * the prompt the model sees. The installed Copilot CLI (v1.0.71) rewrites the prompt
 * from this hook's `modifiedPrompt` output field:
 *     prompt = (runHook(userPromptSubmitted, {sessionId,timestamp,cwd,prompt}))?.modifiedPrompt ?? prompt
 * (Newer Copilot builds move this to userPromptTransformed/modifiedTransformedPrompt;
 * this script targets the installed contract and stays a no-op if the field is ignored.)
 *
 * Invoked by lib/agent-api/hooks/copilot-bridge.sh for the userPromptSubmitted event.
 * Reads the Copilot hook payload ({ sessionId?, cwd?, prompt }) on stdin and writes a
 * SINGLE-LINE JSON object to stdout — {"modifiedPrompt": "..."} to inject, or {} to
 * leave the prompt unchanged. Fail-open: any error / short prompt / disabled toggle
 * emits {} so the original prompt is used.
 *
 * STATUS — VERSION-GATED, DORMANT ON Copilot CLI v1.0.71 (verified 2026-07-19).
 * On v1.0.71 the FILESYSTEM hook fires but its stdout is NOT processed for injection:
 * a raw sentinel proved `modifiedPrompt` AND `additionalContext` are ignored for
 * command hooks (on userPromptSubmitted and sessionStart). The binary consumes
 * `modifiedPrompt` only from the in-process SDK callback-hook path; current docs move
 * per-prompt rewrite to a newer `userPromptTransformed` → `modifiedTransformedPrompt`
 * event that v1.0.71 does not expose. This script is a correct, fail-open no-op today;
 * it will start injecting automatically on a Copilot build that honors modifiedPrompt
 * from a filesystem hook. It ALSO requires copilot's `enableFileHooks` setting on and
 * the repo folder trusted (both off by default) before any .github/hooks/* fires.
 */

import { callRetrieval } from './retrieval-client.js';

const MIN_WORDS = 4;
const MAX_QUERY_CHARS = 500;
const MAX_OUTPUT_CHARS = 9500;
// Self-emit the no-op just under Copilot's userPromptSubmitted hook budget
// (timeoutSec: 5 in .github/hooks/hooks.json) so a slow retrieval never gets
// hard-killed mid-write — we fail open to the original prompt instead.
const SAFETY_TIMEOUT_MS = 4000;

// Never let injection hang the CLI — emit the no-op and exit.
const safety = setTimeout(() => { process.stdout.write('{}'); process.exit(0); }, SAFETY_TIMEOUT_MS);
safety.unref();

function injectionEnabled() {
  const raw = process.env.CODING_KNOWLEDGE_INJECTION;
  if (raw == null) return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function emit(obj) {
  // Copilot requires single-line JSON on stdout.
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

async function main() {
  try {
    if (!injectionEnabled()) return emit({});

    // Read the Copilot hook payload from stdin.
    const chunks = [];
    if (!process.stdin.isTTY) {
      for await (const chunk of process.stdin) chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return emit({});

    let input;
    try { input = JSON.parse(raw); } catch { return emit({}); }

    const prompt = String(input.prompt || '').trim();
    if (!prompt) return emit({});
    if (prompt.startsWith('/')) return emit({}); // slash-command
    if (prompt.split(/\s+/).length < MIN_WORDS) return emit({}); // trivial

    // Phase B: key the structured capture by the run id when the launcher set it,
    // else the Copilot session id.
    const task_id = process.env.TASK_ID || input.sessionId || input.session_id || null;

    const result = await callRetrieval({
      query: prompt.slice(0, MAX_QUERY_CHARS),
      budget: 1000,
      threshold: 0.70,
      context: { agent: 'copilot', cwd: input.cwd || process.cwd() },
      task_id,
    });
    if (!result || !result.markdown || result.meta?.results_count === 0) return emit({});

    let block = result.markdown;
    if (block.length > MAX_OUTPUT_CHARS) block = block.slice(0, MAX_OUTPUT_CHARS) + '\n\n[truncated]';

    // Prepend the retrieved knowledge, then the user's actual prompt.
    emit({ modifiedPrompt: `${block}\n\n${prompt}` });
  } catch {
    emit({}); // fail-open
  }
}

main();
