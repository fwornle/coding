// lib/glass/coexist.mjs — another local LLM proxy on the same machine (coding's
// on 12435, a gateway shim, …), which glass cannot see through.
//
//   claude    an ANTHROPIC_BASE_URL on loopback that is not glass: glass forwards
//             there, so the call is recorded twice (both counts are right, the
//             sum is not) and the other tool files it under glass's session id
//   opencode  the default provider has a plain-HTTP base URL: glass relays it for
//             the run (measured); another tool's proxy there records the calls too
//   pi        the default provider has a plain-HTTP base URL: glass only decrypts
//             HTTPS model hosts, so that traffic is not measured
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

/** opencode's default model and its provider's base URL. */
export function opencodeDefault(env = process.env, home = os.homedir()) {
  const { model, providers } = opencodeConfig(env, home);
  if (!model || !model.includes('/')) return null;
  const provider = model.slice(0, model.indexOf('/'));
  return { model, provider, baseURL: providers[provider]?.options?.baseURL || null };
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

/** pi's default provider and its base URL (PI_CODING_AGENT_DIR, else ~/.pi/agent). */
export function piDefault(env = process.env, home = os.homedir()) {
  const dir = env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
  const settings = readJson(path.join(dir, 'settings.json'));
  const provider = settings?.defaultProvider;
  if (!provider) return null;
  const models = readJson(path.join(dir, 'models.json'));
  return { provider, model: settings.defaultModel || null, baseURL: models?.providers?.[provider]?.baseUrl || null };
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
  const oc = opencodeDefault(env, home);
  if (oc?.baseURL && /^http:/i.test(oc.baseURL)) {
    lines.push(`opencode: default provider ${oc.provider} (${oc.model}) is plain HTTP at ${oc.baseURL} — glass opencode relays and measures it; if that is another tool's proxy, it records the calls too.`);
  }
  const pi = piDefault(env, home);
  if (pi?.baseURL && /^http:/i.test(pi.baseURL)) {
    const what = pi.model ? `${pi.provider} (${pi.model})` : pi.provider;
    lines.push(`pi: default provider ${what} is plain HTTP at ${pi.baseURL} — glass cannot measure it. Pick a provider of pi's own: glass pi --model <provider>/<model>.`);
  }
  if (env.TMUX && !glassTmux) {
    lines.push('tmux: inside an existing tmux session — glass <agent> shows its status bar there for the run and restores yours afterwards. --no-tmux leaves it alone.');
  }
  return lines;
}
