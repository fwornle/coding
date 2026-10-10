// lib/glass/wiring.mjs — the session-scoped environment `glass <agent>` runs an
// agent with. Pure: env in, env out. Nothing here edits the user's own config.
//
//   claude    ANTHROPIC_BASE_URL → the daemon; ANTHROPIC_CUSTOM_HEADERS gains
//             x-task-id / x-agent / x-project (and x-glass-upstream when the user
//             already had a base URL, e.g. a corporate gateway — the daemon forwards
//             there instead of api.anthropic.com). The user's keys are untouched.
//   copilot,  HTTPS_PROXY → the daemon with the session token as credential (it
//   opencode, names the session on every CONNECT), NODE_EXTRA_CA_CERTS → glass's CA
//   pi        (plus any CA bundle the user already had). Each keeps its own login,
//             model catalogue and routing; the daemon decrypts only model hosts.
//   opencode  also: providers with a plain-HTTP base URL (a local model server,
//             another tool's proxy) never pass HTTPS_PROXY, so OPENCODE_CONFIG_CONTENT
//             points each at the daemon's /relay/<token>/<provider>, which forwards
//             to the original URL. opencode merges it over its own config.
//
// --no-intercept leaves copilot / opencode / pi unwired: unmeasured by the proxy.
import fs from 'node:fs';
import path from 'node:path';

export const AGENTS = Object.freeze(['claude', 'copilot', 'opencode', 'pi']);
const INTERCEPTED = new Set(['copilot', 'opencode', 'pi']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** True when a URL already points at this glass daemon (a nested `glass` run). */
function pointsAtGlass(raw, port) {
  try {
    const u = new URL(raw);
    return LOOPBACK.has(u.hostname) && Number(u.port) === port;
  } catch {
    return false;
  }
}

/** Header lines in ANTHROPIC_CUSTOM_HEADERS form, replacing any glass-owned ones. */
export function withHeaders(existing, headers) {
  const owned = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  const kept = String(existing || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !owned.has(l.split(':')[0].trim().toLowerCase()));
  for (const [k, v] of Object.entries(headers)) if (v) kept.push(`${k}: ${v}`);
  return kept.join('\n');
}

/**
 * @param {string} agent
 * @param {Record<string, string>} baseEnv   the user's environment
 * @param {object} s
 * @param {number} s.port
 * @param {string} s.taskId
 * @param {string} s.token       session credential
 * @param {string} s.caPath      glass CA (ca.pem)
 * @param {string} s.project
 * @param {boolean} [s.intercept=true]
 * @param {string} [s.bundleDir] where a combined CA bundle may be written
 * @param {Record<string, string>} [s.relays]  opencode: provider id → plain-HTTP base URL
 * @returns {{ env: Record<string, string>, wired: boolean, note: string }}
 */
export function sessionEnv(agent, baseEnv, { port, taskId, token, caPath, project, intercept = true, bundleDir, relays = {} }) {
  const env = { ...baseEnv, GLASS_TASK_ID: taskId };
  const base = `http://127.0.0.1:${port}`;

  if (agent === 'claude') {
    const prior = baseEnv.ANTHROPIC_BASE_URL;
    const upstream = prior && !pointsAtGlass(prior, port) ? prior.replace(/\/+$/, '') : '';
    env.ANTHROPIC_BASE_URL = base;
    env.ANTHROPIC_CUSTOM_HEADERS = withHeaders(baseEnv.ANTHROPIC_CUSTOM_HEADERS, {
      'x-task-id': taskId, 'x-agent': 'claude', 'x-project': project, 'x-glass-upstream': upstream,
    });
    return { env, wired: true, note: upstream ? `claude → glass → ${upstream}` : 'claude → glass → api.anthropic.com' };
  }

  if (!INTERCEPTED.has(agent)) throw new Error(`unknown agent "${agent}" (one of ${AGENTS.join(', ')})`);
  if (!intercept) return { env, wired: false, note: `${agent}: --no-intercept — not measured by the proxy` };

  const proxyUrl = `http://glass:${encodeURIComponent(token)}@127.0.0.1:${port}`;
  env.HTTPS_PROXY = proxyUrl;
  env.https_proxy = proxyUrl;
  // Plain-HTTP traffic (local model servers) is left alone: glass only decrypts
  // HTTPS model hosts, and an HTTP_PROXY pointing here would swallow it.
  const priorCa = baseEnv.NODE_EXTRA_CA_CERTS;
  if (priorCa && fs.existsSync(priorCa) && path.resolve(priorCa) !== path.resolve(caPath)) {
    const bundle = path.join(bundleDir || path.dirname(caPath), `bundle-${taskId}.pem`);
    fs.writeFileSync(bundle, `${fs.readFileSync(priorCa, 'utf8').trimEnd()}\n${fs.readFileSync(caPath, 'utf8')}`);
    env.NODE_EXTRA_CA_CERTS = bundle;
  } else {
    env.NODE_EXTRA_CA_CERTS = caPath;
  }
  const relayed = agent === 'opencode' ? Object.keys(relays) : [];
  if (relayed.length) env.OPENCODE_CONFIG_CONTENT = opencodeRelayContent(baseEnv.OPENCODE_CONFIG_CONTENT, relayed, { port, token });
  return { env, wired: true, note: `${agent} → glass (intercepting model hosts${relayed.length ? `; relaying ${relayed.join(', ')}` : ''})` };
}

/** OPENCODE_CONFIG_CONTENT with each relayed provider's baseURL on the daemon, the rest kept. */
export function opencodeRelayContent(existing, providerIds, { port, token }) {
  let cfg = {};
  try { cfg = existing ? JSON.parse(existing) : {}; } catch { cfg = {}; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
  const provider = { ...cfg.provider };
  for (const id of providerIds) {
    const baseURL = `http://127.0.0.1:${port}/relay/${encodeURIComponent(token)}/${encodeURIComponent(id)}`;
    provider[id] = { ...provider[id], options: { ...provider[id]?.options, baseURL } };
  }
  return JSON.stringify({ ...cfg, provider });
}
