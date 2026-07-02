// lib/repro/env-allowlist.mjs
//
// Phase 67, Plan 67-03 (Wave 1) — REPRO-01 internal-state capture, primitive #2:
// the agent-affecting env-var allowlist. Snapshots ONLY the environment variables
// that actually change agent behaviour (proxy routing, repo root, CI flags, node
// options) so a repeat run reproduces the same conditions — WITHOUT ever capturing
// the whole `process.env`, which would leak proxy keys, OAuth tokens, and gho_*
// GitHub tokens into the snapshot dir (T-67-03-01, RESEARCH Pitfall 4 / ASVS V9).
//
// Two layers of defence:
//   1. ALLOWLIST — only names in ENV_ALLOWLIST are ever considered.
//   2. DENY-REGEX — SECRET_DENY_RE (/KEY|TOKEN|SECRET|PASSWORD/i) is applied to the
//      NAME even after allowlisting (belt-and-suspenders): if a secret-shaped name
//      were ever mistakenly added to the allowlist, it is still dropped.
//
// PURE (no I/O, no spawn, no network) — a deterministic transform over a plain env
// object. Env-resolution style follows scripts/backfill-raw-observations.mjs:38-42.

/**
 * Agent-affecting env vars worth capturing (RESEARCH §Internal-State Capture,
 * env-allowlist row). Intentionally excludes anything secret-shaped — see
 * SECRET_DENY_RE, which is enforced on top of this list.
 * @type {string[]}
 */
export const ENV_ALLOWLIST = [
  // rapid-llm-proxy data / runtime paths
  'LLM_PROXY_DATA_DIR',
  'LLM_PROXY_DIST_DIR',
  'LLM_PROXY_SETTINGS_PATH',
  'LLM_PROXY_TOKEN_DB_PATH',
  'LLM_PROXY_PORT',
  // proxy URL resolution precedence (CLAUDE.md km-core LLM proxy endpoint)
  'LLM_CLI_PROXY_URL',
  'RAPID_LLM_PROXY_URL',
  'LLM_PROXY_URL',
  // corp-vs-public HTTP(S) proxy routing
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  // repo + environment context
  'CODING_REPO',
  'CI',
  'LSL_CLAUDE_PROJECTS_DIR',
  'NODE_OPTIONS',
];

/**
 * Secret-shaped name matcher. Any env var whose NAME matches is excluded from
 * capture even if it is present in the allowlist (T-67-03-01, Security V9).
 * @type {RegExp}
 */
export const SECRET_DENY_RE = /KEY|TOKEN|SECRET|PASSWORD/i;

/**
 * Capture the agent-affecting env-var subset, secret-safe.
 *
 * @param {Record<string,string|undefined>} [env=process.env] source environment
 * @param {string[]} [allowlist=ENV_ALLOWLIST] names to consider (overridable for tests)
 * @returns {Record<string,string>} only allowlisted, present, non-secret-shaped vars
 */
export function captureEnvAllowlist(env = process.env, allowlist = ENV_ALLOWLIST) {
  const out = {};
  for (const name of allowlist) {
    // Layer 2 deny-regex applied to the NAME even for allowlisted entries.
    if (SECRET_DENY_RE.test(name)) continue;
    const value = env[name];
    if (value === undefined || value === null) continue;
    out[name] = value;
  }
  return out;
}
