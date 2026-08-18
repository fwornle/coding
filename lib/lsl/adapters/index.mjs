/**
 * lib/lsl/adapters/index.mjs — adapter loader + per-agent searchPaths config.
 *
 * Phase 51 Plan 01 Task 1 (CONTEXT.md Must #1 + D-LSL-Filename + D-Reuse).
 *
 * Locks the contract that downstream plans 51-02..51-05 each implement as a
 * single file in this directory (named `<agentId>-<storage>.mjs`):
 *
 *   export const adapter = {
 *     agentId: 'claude'|'opencode'|'copilot',
 *     storageType: 'jsonl-tree'|'sqlite'|'events-jsonl',
 *     async discover({ searchPaths, project, since }) { ... },
 *     async convertToObservations(rows, { dryRun, tag }) { ... },
 *   };
 *
 * The locked tuple of supported agent ids is `['claude', 'opencode', 'copilot']`
 * in that canonical order — the AGENTS frozen export is the source of truth.
 *
 * This is a 3-tuple, not 4: mastra was removed with the agent, and pi was
 * deliberately NOT added. This registry drives the SUB-AGENT sweep, and pi has
 * no sub-agent concept in core (it suggests tmux for that). A pi adapter would
 * be an empty stub whose discover() always returns [] — exactly what the mastra
 * one was, by its own admission. Revisit if a pi extension ever emits sub-agent
 * lifecycle events.
 *
 * Per CONTEXT.md D-Reuse: this module does NOT import Phase 50 primitives
 * (lib/lsl/window.mjs or lib/lsl/scan-and-convert.mjs). The sweep dispatcher
 * (scripts/sweep-sub-agents.mjs) composes adapters + Phase 50 primitives at
 * the orchestration layer.
 *
 * Test override: set LSL_ADAPTERS_DIR to point at a tmpdir holding fixture
 * adapter files; loadAdapter() then resolves from that directory.
 *
 * Pure ESM (no build step). Zero new package installs (T-51-01-SC mitigation).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Locked tuple of agent ids that have a real sub-agent sweep adapter.
 * Frozen so a downstream caller cannot quietly mutate the list.
 */
export const AGENTS = Object.freeze(['claude', 'opencode', 'copilot']);

/**
 * Resolve the directory containing per-agent adapter modules.
 *  - Production: the directory containing this file (lib/lsl/adapters/).
 *  - Tests: override via LSL_ADAPTERS_DIR env var.
 */
function resolveAdaptersDir() {
  if (process.env.LSL_ADAPTERS_DIR) return process.env.LSL_ADAPTERS_DIR;
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Dynamically load the adapter for a given agent id.
 *
 * Scans the adapters directory for a file matching `<agentId>-*.mjs` (the
 * suffix encodes storage variant — e.g. `claude-jsonl.mjs`, `opencode-sqlite.mjs`).
 * If multiple files match, the lexicographically first is loaded — but in
 * practice each plan ships exactly one per agent.
 *
 * Returns the module's `adapter` named export (preferred) or its default
 * export (fallback). Returns `null` AND writes a stderr notice when no
 * adapter file is present — does NOT throw so the dispatcher can continue
 * to the next agent.
 *
 * @param {string} agentId
 * @returns {Promise<object|null>}
 */
export async function loadAdapter(agentId) {
  if (!AGENTS.includes(agentId)) {
    process.stderr.write(`[adapters] unknown agent id "${agentId}"; expected one of ${AGENTS.join(', ')}\n`);
    return null;
  }
  const dir = resolveAdaptersDir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    process.stderr.write(`[adapters] adapters dir not readable (${dir}): ${err.message}\n`);
    return null;
  }
  const prefix = `${agentId}-`;
  const match = entries
    .filter((f) => f.startsWith(prefix) && f.endsWith('.mjs'))
    .sort()[0];
  if (!match) {
    process.stderr.write(`[adapters] no adapter found for "${agentId}" — adapter not yet implemented (looked under ${dir})\n`);
    return null;
  }
  const fileUrl = pathToFileURL(path.join(dir, match)).href;
  const mod = await import(fileUrl);
  // Prefer named `adapter` export; fall back to default.
  if (mod && mod.adapter) return mod.adapter;
  if (mod && mod.default) return mod.default;
  process.stderr.write(`[adapters] ${match} loaded but exports neither 'adapter' nor 'default'\n`);
  return null;
}

/**
 * Per-agent searchPaths config. Honors env-var overrides for test isolation.
 *
 * Shape divergence is intentional:
 *  - claude, copilot         → Array<string>           (filesystem directories)
 *  - opencode                → Array<{ type: 'sqlite', dbPath: string }>
 *
 * Per CONTEXT.md D-LSL-Filename + Phase 51 RESEARCH-opencode.md: OpenCode
 * uses an SQLite session DB, not flat transcript files. Plan 51-03 consumes
 * the sqlite-shaped entry; the other three plans walk filesystem trees.
 *
 * Defaults:
 *  - claude    ~/.claude/projects/
 *  - opencode  ~/.local/share/opencode/opencode.db
 *  - copilot   ~/.copilot/session-state/
 *
 * @param {string} agentId
 * @returns {Array<string> | Array<{type:'sqlite', dbPath:string}>}
 */
export function getAgentSearchPaths(agentId) {
  if (!AGENTS.includes(agentId)) {
    process.stderr.write(`[adapters] unknown agent id "${agentId}"; getAgentSearchPaths returning []\n`);
    return [];
  }
  switch (agentId) {
    case 'claude': {
      const dir = process.env.LSL_CLAUDE_PROJECTS_DIR
        || path.join(os.homedir(), '.claude', 'projects');
      return [dir];
    }
    case 'opencode': {
      const dbPath = process.env.LSL_OPENCODE_DB
        || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
      return [{ type: 'sqlite', dbPath }];
    }
    case 'copilot': {
      const dir = process.env.LSL_COPILOT_SESSIONS_DIR
        || path.join(os.homedir(), '.copilot', 'session-state');
      return [dir];
    }
    default:
      // Unreachable given the includes() guard above, but keep TS-friendly.
      return [];
  }
}
