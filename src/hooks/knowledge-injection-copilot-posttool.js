#!/usr/bin/env node

/**
 * Per-turn Knowledge Injection for GitHub Copilot CLI — MULTI-CHANNEL.
 *
 * Copilot filesystem command hooks can only inject context the model reads via an
 * `additionalContext` field, and WHICH event's additionalContext is honored changes
 * version to version (postToolUse on v1.0.71; userPromptSubmitted newly on v1.0.72+,
 * where postToolUse also went flaky). A single fixed channel is never upgrade-safe.
 *
 * This injector emits on the channel SET resolved by copilot-channel-capabilities.js
 * for the installed version. That set IS the dedup:
 *   - known single-honored version → emit on one channel  ⇒ injected exactly once;
 *   - unknown/newer version         → fail-safe: emit on both, tolerating one duplicate
 *                                     to guarantee delivery. See that module for the why.
 *
 * Two invocation modes, driven by copilot-bridge.sh (legacy aliases in parens):
 *   prompt  (userPromptSubmitted; alias: stash)
 *        Start a fresh turn. Persist the prompt + resolved plan keyed by sessionId.
 *        If the plan includes userPromptSubmitted, retrieve KB now, cache it in the
 *        stash, mark that channel emitted, and emit {"additionalContext": …}. Else emit {}.
 *   tool    (postToolUse; alias: inject)
 *        Fires after each tool. If the plan includes postToolUse and it hasn't emitted
 *        this turn, reuse the cached block (or retrieve if the prompt channel didn't),
 *        mark postToolUse emitted, and emit {"additionalContext": …}. Else emit {}.
 *        Once-per-channel-per-turn — later tools in the same turn emit nothing.
 *
 * Retrieval runs AT MOST ONCE per turn (block cached in the stash; the second channel,
 * when the fail-safe plan uses both, reuses it — no second HTTP call).
 *
 * Fail-open throughout: disabled toggle / short prompt / no plan / any error emits {}
 * (never blocks a request). Output is SINGLE-LINE JSON (Copilot requirement).
 *
 * Baseline (non-per-turn) context still comes from the session-start adapter
 * (knowledge-injection-copilot.js → .github/copilot-instructions.md) + custom instructions.
 *
 * Requires Copilot's `enableFileHooks` on + the repo folder trusted (both off by default)
 * before ANY .github/hooks/* fires — see install.sh install_copilot_file_hooks().
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callRetrieval } from './retrieval-client.js';
import { resolvePlan } from './copilot-channel-capabilities.js';

const MIN_WORDS = 4;
const MAX_QUERY_CHARS = 500;
const MAX_INJECT_CHARS = 9000; // under Copilot's 10 KB additionalContext cap
const SAFETY_TIMEOUT_MS = 4000; // under Copilot's hook timeoutSec
const RETRIEVAL_TIMEOUT_MS = 2500; // keep the prompt-submit path snappy
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

function readStash(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeStash(p, obj) {
  try {
    fs.mkdirSync(STASH_DIR, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
  } catch { /* fail-open */ }
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

/** Frame a KB markdown block as reference context for the model. */
function frame(markdown) {
  let block = markdown;
  if (block.length > MAX_INJECT_CHARS) block = block.slice(0, MAX_INJECT_CHARS) + '\n\n[truncated]';
  return 'Retrieved project knowledge (reference context for the current task, provided by project tooling):\n\n' + block;
}

/** Retrieve KB for the stashed prompt. Returns the raw markdown string, or null. */
async function retrieve(prompt, sessionId, cwd) {
  const result = await callRetrieval({
    query: String(prompt).slice(0, MAX_QUERY_CHARS),
    budget: 1000,
    threshold: 0.70,
    context: { agent: 'copilot', cwd: cwd || process.cwd() },
    task_id: process.env.CODING_EXPERIMENT_TASK_ID || process.env.TASK_ID || sessionId,
    timeout: RETRIEVAL_TIMEOUT_MS,
    // Defaults to 3033 (the retrieval service). Overridable for tests / non-standard ports.
    ...(process.env.CODING_RETRIEVAL_PORT ? { port: Number(process.env.CODING_RETRIEVAL_PORT) } : {}),
  });
  if (!result || !result.markdown || result.meta?.results_count === 0) return null;
  return result.markdown;
}

/** Normalize CLI mode, accepting legacy aliases. */
function resolveMode(arg) {
  if (arg === 'prompt' || arg === 'stash') return 'prompt';
  if (arg === 'tool' || arg === 'inject') return 'tool';
  return null;
}

async function main() {
  try {
    if (!injectionEnabled()) return emit({});
    const mode = resolveMode(process.argv[2]);
    if (!mode) return emit({});
    const input = await readInput();
    if (!input) return emit({});
    const sessionId = input.sessionId || input.session_id || 'unknown';
    const p = stashPath(sessionId);

    // ---- prompt mode (userPromptSubmitted): start a fresh turn ----------------
    if (mode === 'prompt') {
      const prompt = String(input.prompt || '').trim();
      const valid = prompt && !prompt.startsWith('/') && prompt.split(/\s+/).length >= MIN_WORDS;

      const plan = resolvePlan();
      const stash = {
        prompt,
        cwd: input.cwd || process.cwd(),
        ts: Date.now(),
        valid: Boolean(valid),
        channels: plan.channels,          // the dedup set for this turn
        block: null,                      // cached KB markdown (retrieve-once)
        retrieved: false,                 // retrieval attempted?
        emitted: {},                      // channel → true once emitted this turn
      };

      if (!valid) { writeStash(p, stash); return emit({}); }

      // Retrieve here only if this channel actually delivers on this version; otherwise
      // defer the (latency-bearing) retrieval to the tool channel that will deliver.
      if (plan.channels.includes('userPromptSubmitted')) {
        const md = await retrieve(prompt, sessionId, stash.cwd);
        stash.retrieved = true;
        stash.block = md;
        stash.emitted.userPromptSubmitted = true;
        writeStash(p, stash);
        return emit(md ? { additionalContext: frame(md) } : {});
      }

      writeStash(p, stash);
      return emit({});
    }

    // ---- tool mode (postToolUse): inject on the first tool if planned ---------
    if (mode === 'tool') {
      const stash = readStash(p);
      if (!stash || !stash.valid) return emit({});
      if (typeof stash.ts === 'number' && Date.now() - stash.ts > STASH_TTL_MS) return emit({});
      const channels = Array.isArray(stash.channels) ? stash.channels : [];
      if (!channels.includes('postToolUse')) return emit({}); // uPS owns this turn
      if (stash.emitted && stash.emitted.postToolUse) return emit({}); // already injected this turn

      let md = stash.retrieved ? stash.block : await retrieve(stash.prompt, sessionId, stash.cwd);
      // Mark postToolUse emitted (and persist any freshly-retrieved block) regardless of
      // outcome — one attempt per turn on this channel.
      stash.retrieved = true;
      stash.block = md ?? null;
      stash.emitted = { ...(stash.emitted || {}), postToolUse: true };
      writeStash(p, stash);

      return emit(md ? { additionalContext: frame(md) } : {});
    }

    return emit({});
  } catch {
    emit({});
  }
}

main();
