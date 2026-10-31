// lib/glass/coexist.mjs — another local LLM proxy on the same machine (coding's
// on 12435, a gateway shim, …), which glass cannot see through.
//
//   claude    an ANTHROPIC_BASE_URL on loopback that is not glass: glass forwards
//             there, so the call is recorded twice (both counts are right, the
//             sum is not) and the other tool files it under glass's session id
//   opencode, providers with a plain-HTTP base URL (a local model server, another
//   pi        tool's proxy) are relayed through the daemon for the run: measured, and
//             named with the glass session, so a proxy there files its copy under
//             glass's task id and the combined usage view counts the call once. No
//             warning: nothing is left to fix.
//   tmux      started inside an existing tmux session, glass takes over its status
//             bar for the run (and puts it back afterwards)
//
// Pure apart from reading the agents' config files. Never edits them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function loopbackUrl(raw) {
  try {
    const u = new URL(raw);
    return LOOPBACK.has(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/** JSON (or JSONC: // and /* comments, trailing commas) → object, else null. */
export function parseLoose(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return JSON.parse(text); } catch { /* try JSONC */ }
  const stripped = text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
    .replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(stripped); } catch { return null; }
}

function readJson(file) {
  try { return parseLoose(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** opencode's merged config (model + providers) — global file, OPENCODE_CONFIG, then OPENCODE_CONFIG_CONTENT. */
export function opencodeConfig(env = process.env, home = os.homedir()) {
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const layers = [
    readJson(path.join(xdg, 'opencode', 'opencode.json')) || readJson(path.join(xdg, 'opencode', 'opencode.jsonc')),
    env.OPENCODE_CONFIG ? readJson(env.OPENCODE_CONFIG) : null,
    parseLoose(env.OPENCODE_CONFIG_CONTENT),
  ].filter((c) => c && typeof c === 'object');
  let model = null;
  const providers = {};
  for (const c of layers) {
    if (typeof c.model === 'string') model = c.model;
    for (const [id, p] of Object.entries(c.provider || {})) {
      providers[id] = { ...providers[id], ...p, options: { ...providers[id]?.options, ...p?.options } };
    }
  }
  return { model, providers };
}

/** opencode providers with a plain-HTTP base URL: id → URL. glass relays these for a run. */
export function opencodeHttpProviders(env = process.env, home = os.homedir()) {
  const out = {};
  for (const [id, p] of Object.entries(opencodeConfig(env, home).providers)) {
    const url = p?.options?.baseURL;
    if (typeof url === 'string' && /^http:\/\//i.test(url)) out[id] = url;
  }
  return out;
}

/**
 * Where opencode's built-in github-copilot provider sends its calls: copilot-api.<tenant>
 * for an enterprise login, else the public Copilot API. glass relays it there by
 * configuration, so opencode's own login reaches the daemon without interception.
 * Reads only the login's `enterpriseUrl`, never its tokens. null when opencode has no
 * github-copilot login, or its config already gives the provider a base URL (plain
 * HTTP is relayed as such; an HTTPS one is the user's choice and is left alone).
 */
export function opencodeCopilotUpstream(env = process.env, home = os.homedir()) {
  if (opencodeConfig(env, home).providers['github-copilot']?.options?.baseURL) return null;
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const login = readJson(path.join(dataHome, 'opencode', 'auth.json'))?.['github-copilot'];
  if (!login || typeof login !== 'object') return null;
  const domain = String(login.enterpriseUrl || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return domain ? `https://copilot-api.${domain}` : 'https://api.githubcopilot.com';
}

/** pi providers (models.json) with a plain-HTTP base URL: id → URL. glass relays these for a run. */
export function piHttpProviders(env = process.env, home = os.homedir()) {
  const dir = env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
  const out = {};
  for (const [id, p] of Object.entries(readJson(path.join(dir, 'models.json'))?.providers || {})) {
    const url = p?.baseUrl;
    if (typeof url === 'string' && /^http:\/\//i.test(url)) out[id] = url;
  }
  return out;
}

/**
 * What `glass doctor` warns about when glass shares the machine with another proxy.
 * @returns {string[]} one line per finding, empty when there is nothing to say
 */
export function coexistWarnings({ env = process.env, home = os.homedir(), port, glassTmux = Boolean(env.GLASS_TMUX_OWNED) } = {}) {
  const lines = [];
  const base = env.ANTHROPIC_BASE_URL && loopbackUrl(env.ANTHROPIC_BASE_URL);
  if (base && Number(base.port) !== port) {
    lines.push(`claude: ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL} is another local proxy — glass claude forwards through it and both record each call. Start glass from a terminal that tool's launcher did not set up.`);
  }
  if (env.TMUX && !glassTmux) {
    lines.push('tmux: inside an existing tmux session — glass <agent> shows its status bar there for the run and restores yours afterwards. --no-tmux leaves it alone.');
  }
  return lines;
}
