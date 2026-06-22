/**
 * lib/lsl/token/task-id.mjs
 *
 * Phase 69, Plan 69-02, Task 2 — the live `task_id` resolver. A thin,
 * best-effort wrapper over the Phase-68 SINGLE span reader.
 *
 * Design (locked decisions):
 *   - D-03 (single span reader): the ONLY way an adapter resolves the live
 *     task_id is by dynamic-importing `resolveLiveTaskId` from the proxy dist
 *     (`measurement-span.js`). This module adds NO second parser of the active
 *     measurement span file — it only calls `resolveLiveTaskId`.
 *   - best-effort (D-08 discipline): on ANY failure (dist import fails, the
 *     reader throws) `resolveLiveTaskIdSafe` returns '' and NEVER throws, so
 *     an unresolved task_id can never break ingestion.
 *
 * Analog: scripts/measurement-start.mjs:29-52 (host-side dist import via
 * pathToFileURL). The dist module exports `resolveLiveTaskId(overrideDataDir?)`
 * which itself returns '' / never throws (measurement-span.ts:256-265) — this
 * wrapper additionally tolerates the IMPORT failing.
 */

import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DIST = '/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist';

/**
 * Memoize the imported dist module keyed by its resolved file URL, so repeated
 * calls don't re-import. Keying on the URL (not a single slot) means a changed
 * LLM_PROXY_DIST_DIR resolves to its own module rather than a stale one.
 * @type {Map<string, Promise<unknown>>}
 */
const moduleCache = new Map();

/** Resolve the proxy dist directory (env override → locked default). */
function distDir() {
  return process.env.LLM_PROXY_DIST_DIR ?? DEFAULT_DIST;
}

/** Import (memoized) the measurement-span module from the resolved dist dir. */
function importSpanModule() {
  const modUrl = pathToFileURL(
    path.join(distDir(), 'measurement-span.js'),
  ).href;
  let pending = moduleCache.get(modUrl);
  if (!pending) {
    pending = import(modUrl);
    moduleCache.set(modUrl, pending);
  }
  return pending;
}

/**
 * Resolve the live `task_id` via the single span reader (D-03).
 *
 * Returns the reader's string value (the open span's task_id, or '' when no
 * span is open). On ANY failure — the dist import fails OR the reader throws —
 * returns '' and never throws (best-effort).
 *
 * @param {string} [overrideDataDir] forwarded to resolveLiveTaskId (test seam)
 * @returns {Promise<string>} the live task_id, or '' on no-span / any failure
 */
export async function resolveLiveTaskIdSafe(overrideDataDir) {
  try {
    const mod = await importSpanModule();
    // The real proxy dist is true ESM (named export). Fall back to the
    // CJS-interop default slot so the resolver works whether the module is
    // loaded as ESM or via CJS default interop — never re-implement the read.
    const reader = mod.resolveLiveTaskId ?? mod.default?.resolveLiveTaskId;
    const value = reader(overrideDataDir);
    return value ?? '';
  } catch (err) {
    process.stderr.write(
      `[token-adapter] task_id resolve failed (non-fatal): ${err.message}\n`,
    );
    return '';
  }
}
