/**
 * lib/lsl/token/vscode-token-rows.mjs
 *
 * Token rows for VS Code's built-in GitHub Copilot Chat, read from the chat
 * sessions VS Code keeps on disk. Nothing in VS Code's path changes: no proxy, no
 * certificate, no extension — the files are read after the fact, the way the
 * Copilot CLI adapter reads `events.jsonl`.
 *
 * Where: <User>/workspaceStorage/<id>/chatSessions/<session>.jsonl (a window with
 * a folder) and <User>/globalStorage/emptyWindowChatSessions/ (one without). A
 * `.jsonl` is an operation log replayed onto the initial state:
 *
 *   {kind:0, v}           the session's initial state
 *   {kind:1, k, v}        set the value at path k
 *   {kind:2, k, v, i?}    append v (an array) at path k, after truncating it to i
 *
 * Older builds wrote the state whole as `.json`; both are read.
 *
 * What a request records, and what it does not: `result.usage` (or
 * `result.metadata`) carries promptTokens and completionTokens for the WHOLE
 * request, but an agent-mode request is several model calls
 * (`metadata.toolCallRounds`), and promptTokens is only the last one's prompt.
 * There is no cache split either. The row is therefore an estimate, flagged
 * `tokens_estimated: 1`: fresh input is what the prompt grew by since the
 * session's previous request (the conversation before it is re-sent and cached;
 * the whole prompt when it shrank, i.e. the history was summarised), the rest of
 * it a cache read, and each earlier round re-reads the prompt once more.
 *
 * Checked against what Copilot charged: newer VS Code builds print the credits
 * of a request in `result.details` ("GPT-6 Luna • 0.3 credits"), and on
 * 2026-10-05 eight requests summed to n credits — the itemized bill's $x
 * for that day to the cent. This estimate gave $x (-21%); the whole prompt
 * as fresh input gave $x (+71%). GitHub's own month-to-date figure (glass's
 * quota read) is what bounds it.
 *
 * Only Copilot's models count (`modelId` "copilot/<model>"): a model from the
 * user's own key in VS Code is not on the Copilot bill.
 *
 * Pure ESM, stderr only, never throws.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ADAPTER_USER_HASH_VSCODE, insertTokenRowDeduped, openTokenDb } from './token-db.mjs';
import { projectOfCwd } from './project-of.mjs';

export const VSCODE_PROCESS = 'token-adapter-vscode';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v) => (typeof v === 'string' ? v : '');

/** VS Code's User directories on this machine (stable + Insiders; desktop + remote server). */
export function vscodeUserDirs({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const flavours = ['Code', 'Code - Insiders'];
  let bases;
  if (platform === 'darwin') bases = flavours.map((f) => path.join(home, 'Library', 'Application Support', f, 'User'));
  else if (platform === 'win32') bases = flavours.map((f) => path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), f, 'User'));
  else bases = flavours.map((f) => path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), f, 'User'));
  bases.push(path.join(home, '.vscode-server', 'data', 'User'));
  return bases;
}

/**
 * Chat-session files under the given User directories, with the workspace folder
 * each belongs to ('' for an empty window). Files older than `sinceMs` are skipped.
 */
export function findVscodeChatSessions(userDirs = vscodeUserDirs(), { sinceMs = 0 } = {}) {
  const out = [];
  const add = (dir, folder) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (!n.endsWith('.json') && !n.endsWith('.jsonl')) continue;
      const file = path.join(dir, n);
      try { if (fs.statSync(file).mtimeMs < sinceMs) continue; } catch { continue; }
      out.push({ file, folder });
    }
  };
  for (const user of userDirs) {
    const ws = path.join(user, 'workspaceStorage');
    let ids = [];
    try { ids = fs.readdirSync(ws); } catch { /* no VS Code here */ }
    for (const id of ids) {
      const chat = path.join(ws, id, 'chatSessions');
      if (!fs.existsSync(chat)) continue;
      add(chat, workspaceFolder(path.join(ws, id, 'workspace.json')));
    }
    add(path.join(user, 'globalStorage', 'emptyWindowChatSessions'), '');
  }
  return out;
}

/** The local folder a workspaceStorage entry belongs to, or '' (remote, multi-root, unreadable). */
function workspaceFolder(workspaceJson) {
  try {
    const { folder } = JSON.parse(fs.readFileSync(workspaceJson, 'utf8'));
    return typeof folder === 'string' && folder.startsWith('file:') ? fileURLToPath(folder) : '';
  } catch {
    return '';
  }
}

/** The session state a chat-session file describes (the `.jsonl` log replayed), or null. */
export function readChatSessionState(file) {
  let raw;
  try {
    const st = fs.statSync(file);
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null;
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`[token-adapter-vscode] read failed: ${file}: ${err.message}\n`);
    return null;
  }
  if (file.endsWith('.json')) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  let state = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let op;
    try { op = JSON.parse(line); } catch { continue; }
    if (!op || typeof op !== 'object') continue;
    if (op.kind === 0) { state = op.v; continue; }
    if (!state || !Array.isArray(op.k) || op.k.length === 0) continue;
    const parent = op.k.slice(0, -1).reduce((o, key) => (o == null ? o : o[key]), state);
    const last = op.k[op.k.length - 1];
    if (parent == null || typeof parent !== 'object') continue;
    if (op.kind === 1) parent[last] = op.v;
    else if (op.kind === 2) {
      if (!Array.isArray(parent[last])) parent[last] = [];
      if (typeof op.i === 'number') parent[last].length = Math.min(parent[last].length, op.i);
      if (Array.isArray(op.v)) parent[last].push(...op.v);
    }
  }
  return state;
}

/** "copilot/claude-sonnet-4.5" → "claude-sonnet-4.5"; null for a model not served by Copilot. */
export function copilotModelOf(modelId) {
  const m = /^copilot\/(.+)$/.exec(str(modelId));
  return m ? m[1].toLowerCase() : null;
}

/**
 * The model that answered. "copilot/auto" names a router, not a model: the one it
 * picked is in `metadata.resolvedModel` (newer builds), on each tool-call round,
 * or on the response part (older ones).
 */
function resolvedModelOf(req, meta) {
  const rounds = Array.isArray(meta.toolCallRounds) ? meta.toolCallRounds : [];
  const parts = Array.isArray(req.response) ? req.response : [];
  const candidates = [
    meta.resolvedModel,
    rounds.length ? rounds[rounds.length - 1]?.modelId : '',
    ...parts.map((p) => p?.resolvedModel),
  ];
  const hit = candidates.find((c) => typeof c === 'string' && c && c !== 'auto');
  return hit ? hit.toLowerCase() : '';
}

/**
 * The credits Copilot charged for a request, when VS Code shows them
 * (`result.details` "GPT-6 Luna • 0.3 credits"); null when it does not.
 */
export function chargedCreditsOf(result) {
  const m = /([\d.]+)\s*credits?\b/i.exec(str(result?.details));
  return m ? Number(m[1]) : null;
}

/**
 * One estimated token row per finished Copilot request in a chat-session file.
 *
 * @param {string} file a chatSessions/*.json(l) file
 * @param {{ folder?: string, projectOf?: (cwd: string) => string }} [ctx]
 */
export function buildVscodeTokenRows(file, ctx = {}) {
  const state = readChatSessionState(file);
  if (!state || !Array.isArray(state.requests)) return [];
  const project = ctx.folder ? (ctx.projectOf || projectOfCwd)(ctx.folder) : '';
  const rows = [];
  let previousPrompt = 0;
  for (const req of state.requests) {
    if (!req || typeof req !== 'object') continue;
    const result = req.result && typeof req.result === 'object' ? req.result : null;
    const picked = copilotModelOf(req.modelId);
    if (!picked || !result || !str(req.requestId)) continue;
    const meta = result.metadata && typeof result.metadata === 'object' ? result.metadata : {};
    const model = resolvedModelOf(req, meta) || picked;
    const usage = result.usage && typeof result.usage === 'object' ? result.usage : {};
    const prompt = num(usage.promptTokens) || num(meta.promptTokens);
    const output = num(usage.completionTokens) || num(meta.outputTokens);
    if (!prompt && !output) continue;
    const rounds = Math.max(1, Array.isArray(meta.toolCallRounds) ? meta.toolCallRounds.length : 1);
    const reused = prompt >= previousPrompt ? previousPrompt : 0;
    const fresh = prompt - reused;
    if (prompt) previousPrompt = prompt;
    const at = num(req.timestamp);
    rows.push({
      timestamp: new Date(at || Date.now()).toISOString(),
      agent: 'vscode',
      provider: 'github-copilot',
      process: VSCODE_PROCESS,
      subscription: '',
      model,
      model_raw: str(req.modelId),
      input_tokens: fresh,
      output_tokens: output,
      total_tokens: fresh + output,
      latency_ms: num(result.timings?.totalElapsed),
      overhead_ms: null,
      prompt_preview: '',
      tokens_estimated: 1,
      cache_read_tokens: reused + (rounds - 1) * prompt,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      user_hash: ADAPTER_USER_HASH_VSCODE,
      task_id: '',
      tool_call_id: `vscode:${req.requestId}`,
      parent_call_id: '',
      granularity_tier: 'per-request-estimate',
      project,
    });
  }
  return rows;
}

/**
 * Write every VS Code Copilot request not yet in the token DB. Idempotent: rows
 * dedup on (user_hash, tool_call_id), and a file unchanged since the last sweep in
 * this process is not re-read.
 *
 * @param {{ dbPath: string, userDirs?: string[], sinceMs?: number, seen?: Map<string, number> }} opts
 * @returns {{ files: number, inserted: number }}
 */
export function sweepVscodeTokenRows({ dbPath, userDirs, sinceMs = 0, seen = new Map() }) {
  const files = findVscodeChatSessions(userDirs, { sinceMs });
  if (files.length === 0) return { files: 0, inserted: 0 };
  let db;
  try {
    db = openTokenDb(dbPath);
  } catch (err) {
    process.stderr.write(`[token-adapter-vscode] token DB unavailable: ${err.message}\n`);
    return { files: files.length, inserted: 0 };
  }
  let inserted = 0;
  try {
    for (const { file, folder } of files) {
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
      if (seen.get(file) === mtime) continue;
      for (const row of buildVscodeTokenRows(file, { folder })) if (insertTokenRowDeduped(db, row)) inserted += 1;
      seen.set(file, mtime);
    }
  } finally {
    db.close();
  }
  return { files: files.length, inserted };
}
