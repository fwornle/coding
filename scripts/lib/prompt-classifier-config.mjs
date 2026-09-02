// scripts/lib/prompt-classifier-config.mjs
//
// Parse and validate config/prompt-classifier.yaml.
//
// ── Why this is its own module ──────────────────────────────────────────────
// prompt-classifier-service.mjs binds an HTTP server the moment it is imported,
// so a test that wants to assert "this config is refused, naming the offending
// key" cannot import it. The same reasoning already split classifier-client.mjs
// out of the proxy's server.mjs: the part worth testing is the part with no I/O.
//
// PURE — no fs, no network, no clock, no env read except through `readKey`,
// which is injected. Given the same document it returns the same object or
// throws the same error.
//
// ── The contract it copies ──────────────────────────────────────────────────
// parseRoutingConfig() in rapid-llm-proxy/proxy-bridge/routing-config.mjs is a
// pure function of a plain object that fail()s NAMING THE KEY. That property is
// what makes validate-before-write cheap: a PATCH handler can re-parse its own
// candidate between `doc.toString()` and `fs.writeFileSync` and reject it with a
// message that points at the field. Everything here follows that, including the
// habit of refusing near-miss key names rather than silently ignoring them — a
// typo that parses as "absent" is the failure mode this whole style exists to
// prevent.

/** Networks a backend may be guarded to. Mirrors the proxy's normalised set. */
export const NETWORKS = ['corporate', 'public'];

/**
 * Keys a backend entry may carry. Anything else is a typo or a feature someone
 * assumed existed; both are worth a boot failure rather than a silent default.
 */
const BACKEND_KEYS = new Set([
  'id', 'base_url', 'model', 'api_key_env', 'require_network', 'enabled', 'timeout_ms',
]);

/** Top-level keys. Same reasoning. */
const TOP_KEYS = new Set(['backends', 'rubric']);

/**
 * The lowest timeout that can possibly be meant in milliseconds. A `timeout_ms:
 * 15` is someone writing seconds, and honouring it would abort every request
 * before it left the socket — which reads as "the backend is broken", not as
 * "the config is wrong".
 */
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120_000;

class PromptClassifierConfigError extends Error {
  constructor(key, problem) {
    super(`prompt-classifier.yaml ${key}: ${problem}`);
    this.name = 'PromptClassifierConfigError';
    this.key = key;
  }
}

const fail = (key, problem) => { throw new PromptClassifierConfigError(key, problem); };

/**
 * @typedef {object} ClassifierBackend
 * @property {string}      id
 * @property {string}      baseUrl
 * @property {string}      model
 * @property {string|null} apiKeyEnv        env var holding the bearer, or null
 * @property {string|null} requireNetwork   'corporate' | 'public' | null (any)
 * @property {boolean}     enabled
 * @property {number}      timeoutMs
 */

/**
 * @param {object} doc  the parsed YAML document (a plain object)
 * @returns {{backends: ClassifierBackend[], rubric: string}}
 * @throws {PromptClassifierConfigError} naming the offending key
 */
export function parsePromptClassifierConfig(doc) {
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail('(root)', 'must be a mapping with `backends` and `rubric`');
  }

  for (const k of Object.keys(doc)) {
    if (!TOP_KEYS.has(k)) {
      fail(k, `unknown key (expected one of ${[...TOP_KEYS].join(', ')})`);
    }
  }

  // ── rubric ────────────────────────────────────────────────────────────────
  // Refused when empty rather than defaulted to something. A judge asked
  // nothing answers unpredictably, and an empty string is far more likely to be
  // a truncated edit than a deliberate choice.
  const rubric = doc.rubric;
  if (typeof rubric !== 'string' || !rubric.trim()) {
    fail('rubric', 'must be a non-empty string — it is the entire prompt the judge is sent');
  }

  // ── backends ──────────────────────────────────────────────────────────────
  const raw = doc.backends;
  if (!Array.isArray(raw)) {
    fail('backends', 'must be a list of backends (ordered; first enabled network match wins)');
  }
  if (raw.length === 0) {
    fail('backends', 'is empty — there would be nobody to ask. Remove the file to fall back to env, or declare a backend');
  }

  const backends = [];
  const seenIds = new Set();
  const seenNetworks = new Set();

  raw.forEach((b, i) => {
    const where = `backends[${i}]`;
    if (b == null || typeof b !== 'object' || Array.isArray(b)) {
      fail(where, 'must be a mapping');
    }
    for (const k of Object.keys(b)) {
      if (!BACKEND_KEYS.has(k)) {
        fail(`${where}.${k}`, `unknown key (expected one of ${[...BACKEND_KEYS].join(', ')})`);
      }
    }

    const id = b.id;
    if (typeof id !== 'string' || !id.trim()) fail(`${where}.id`, 'must be a non-empty string');
    if (seenIds.has(id)) fail(`${where}.id`, `"${id}" is already declared above`);
    seenIds.add(id);

    const baseUrl = b.base_url;
    if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
      fail(`${where}.base_url`, 'must be an http(s) URL of an OpenAI-compatible endpoint');
    }

    const model = b.model;
    if (typeof model !== 'string' || !model.trim()) {
      fail(`${where}.model`, 'must be a non-empty model id the endpoint serves');
    }

    if (b.api_key_env != null && (typeof b.api_key_env !== 'string' || !b.api_key_env.trim())) {
      // The NAME of an env var, never the secret. Same policy/secrets split every
      // provider in llm-routing.yaml follows.
      fail(`${where}.api_key_env`, 'must be the NAME of an environment variable holding the bearer token, never the token itself');
    }
    const apiKeyEnv = b.api_key_env ? String(b.api_key_env) : null;

    // No coercion. `enabled: "false"` is a string and truthy, and quietly
    // reading it as ON would be the exact opposite of what was written.
    if (b.enabled != null && typeof b.enabled !== 'boolean') {
      fail(`${where}.enabled`, 'must be true or false');
    }
    const enabled = b.enabled !== false;

    let requireNetwork = null;
    if (b.require_network != null) {
      requireNetwork = String(b.require_network);
      if (!NETWORKS.includes(requireNetwork)) {
        fail(`${where}.require_network`, `unknown network "${requireNetwork}" (expected one of ${NETWORKS.join(', ')})`);
      }
    }

    // Ordering guards. First match wins, so a duplicate claim or an unguarded
    // entry above a guarded one declares something that can never be reached —
    // which is worse than an error, because it reads as configured.
    const netKey = requireNetwork || '*';
    if (seenNetworks.has('*')) {
      fail(where, 'an unguarded backend (no require_network) is declared above and matches every network, so this one can never be reached');
    }
    if (seenNetworks.has(netKey)) {
      fail(where, `a backend for network "${netKey}" is already declared above — the first match wins, so this one can never be reached`);
    }
    seenNetworks.add(netKey);

    let timeoutMs = 15_000;
    if (b.timeout_ms != null) {
      if (typeof b.timeout_ms !== 'number' || !Number.isFinite(b.timeout_ms)) {
        fail(`${where}.timeout_ms`, 'must be a number of milliseconds');
      }
      if (b.timeout_ms < MIN_TIMEOUT_MS) {
        fail(`${where}.timeout_ms`, `${b.timeout_ms} is below ${MIN_TIMEOUT_MS} — that looks like seconds, and would abort every request before it left the socket`);
      }
      if (b.timeout_ms > MAX_TIMEOUT_MS) {
        fail(`${where}.timeout_ms`, `${b.timeout_ms} exceeds ${MAX_TIMEOUT_MS} — the judge sits in front of the call it is making cheaper, so waiting longer than the call itself defeats it`);
      }
      timeoutMs = b.timeout_ms;
    }

    backends.push({ id, baseUrl, model, apiKeyEnv, requireNetwork, enabled, timeoutMs });
  });

  return { backends, rubric };
}

/**
 * The backends that could serve `network`, in declaration order.
 *
 * Returns a LIST rather than one winner because the caller retries down it: the
 * first entry is what should serve this network, and anything after it is an
 * unguarded catch-all that also matches. A disabled backend is not a candidate —
 * "switched off" and "not answering" are different states with opposite fixes,
 * and only the second is worth retrying past.
 *
 * @param {ClassifierBackend[]} backends
 * @param {string} network  'corporate' | 'public'
 * @returns {ClassifierBackend[]}
 */
export function candidatesForNetwork(backends, network) {
  const net = normalizeNetwork(network);
  return (backends || []).filter(b => b.enabled && (b.requireNetwork == null || b.requireNetwork === net));
}

/**
 * The proxy reports 'vpn' and 'corporate' as separate live states; for the
 * purpose of "can this box be reached", they are the same place. Anything
 * unrecognised is 'public', which is the safe direction: it declines to use a
 * LAN-only endpoint rather than opening a connection to 10/8 from an unknown
 * network with a corporate bearer attached.
 *
 * @param {string} network
 * @returns {'corporate'|'public'}
 */
export function normalizeNetwork(network) {
  const n = String(network || '').toLowerCase();
  return (n === 'corporate' || n === 'vpn') ? 'corporate' : 'public';
}

/** Human-readable backend list, for a reason string nobody has to decode. */
export function describeBackends(backends) {
  if (!backends?.length) return 'none declared';
  return backends
    .map(b => `${b.id}[${b.requireNetwork ?? 'any'}]${b.enabled ? '' : ' (off)'}`)
    .join(', ');
}

export { PromptClassifierConfigError };
