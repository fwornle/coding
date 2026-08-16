// lib/experiments/agent-routing.mjs
//
// Phase 88, Plan 88-01 (ALIGN-01) — the SINGLE source of truth for per-agent experiment-cell
// launch MODEL resolution + the canonical proxy-routing ENV map. Both the experiment cell path
// (lib/experiments/experiment-runner.mjs → runCell/configureProxyRoutingEnv) and the interactive
// shell launcher (scripts/launch-agent-common.sh → configure_proxy_routing()) consult this module
// so the copilot measured-span default + the per-agent env strings live in exactly ONE place —
// killing the drift that made a 3-way experiment degenerate to a one-horse race.
//
// PURE + side-effect-free: no fs/network/spawn at import. The only runtime effect is the optional
// CLI block at the bottom, which fires ONLY when the file is executed directly (`node
// agent-routing.mjs default copilot`) — the shell consumes its stdout.
//
// WHY the two fixes this module encodes:
//   • opencode's spec model `rapid-proxy/claude-haiku-4-5` was a DASH-vs-DOT TYPO. `rapid-proxy`
//     is a REAL working provider (~/.config/opencode/opencode.json → baseURL localhost:12435/v1)
//     and the live `opencode models` catalog lists the DOTTED id `rapid-proxy/claude-haiku-4.5`.
//     resolveCellModel normalizes ONLY the trailing dash-version to a dot-version while KEEPING
//     the full `rapid-proxy/` provider prefix — it is NOT a provider swap.
//   • copilot's `auto` is not a proxy-copilot catalog id (live: {provider:copilot, model:auto} →
//     HTTP 500 "model is not supported"). It maps to the same measured-span default the
//     interactive path uses (COPILOT_MEASURED_DEFAULT_MODEL).
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * The copilot default for an EXPERIMENT CELL whose spec says `auto`.
 *
 * ── Why this is NOT read from the routing config ────────────────────────────
 * Interactive launches now take their model from rapid-llm-proxy's
 * config/llm-routing.yaml (`fg-chat/copilot`), via the launcher's
 * `_resolve_routed_model` — that is the single source of truth for real work,
 * and this module is no longer consulted for it.
 *
 * Experiment cells deliberately do NOT follow it. A cell's model is part of its
 * identity: the variant name and composite task_id are keyed off the ORIGINAL
 * spec model so task_hash stays constant and runs stay comparable (D-05). If
 * this resolver consulted the live config, editing a routing rule mid-campaign
 * would silently change which model a cell launches on while its recorded
 * identity stayed the same — producing two runs that claim to be the same
 * variant and are not. Reproducibility beats config-unification here.
 *
 * So: this module stays PURE and side-effect-free, and a spec that wants a
 * specific model must say so rather than writing `auto`.
 *
 * The proxy's copilot client maps the dash alias → `claude-haiku-4.5` on the
 * send path (COPILOT_MODEL_MAP), so this dash form is the correct wire value.
 * @type {string}
 */
export const COPILOT_MEASURED_DEFAULT_MODEL = 'claude-haiku-4-5';

// opencode trailing dash-version → dot-version (e.g. `-4-5` → `-4.5`). Anchored to the END so it
// only touches the model's version suffix and never the `rapid-proxy/` provider prefix.
const OPENCODE_DASH_VERSION = /-(\d+)-(\d+)$/;

/**
 * Resolve a spec's cell model to the catalog-valid LAUNCH model per agent (single source of truth).
 * The resolver NEVER changes the recorded variant name / composite task_id — the caller keys those
 * off the ORIGINAL cell.model so task_hash stays constant for comparability (D-05).
 *
 *   • opencode  → normalize ONLY the trailing dash-version to a dot-version, KEEPING the full
 *                 provider prefix: `rapid-proxy/claude-haiku-4-5` → `rapid-proxy/claude-haiku-4.5`
 *                 (already-dotted ids pass through unchanged — idempotent). NOT a provider swap.
 *   • copilot   → `auto` (and empty) → COPILOT_MEASURED_DEFAULT_MODEL; any other id passes through.
 *   • claude / mastracode / unknown → passthrough (CLI aliases like `opus`/`sonnet` are valid).
 *
 * @param {string} agent      cell.agent ('claude'|'opencode'|'copilot'|'mastracode').
 * @param {string} specModel  the spec-authored model string.
 * @returns {string} the catalog-valid launch model.
 */
export function resolveCellModel(agent, specModel) {
  const model = specModel == null ? '' : String(specModel);
  switch (agent) {
    case 'opencode':
      // dash-version → dot-version; the `rapid-proxy/` provider prefix is untouched.
      return model.replace(OPENCODE_DASH_VERSION, '-$1.$2');
    case 'copilot':
      // `auto`/empty is not a catalog id → the measured-span default; else passthrough.
      return (model === '' || model === 'auto') ? COPILOT_MEASURED_DEFAULT_MODEL : model;
    default:
      // claude/mastracode CLI aliases (opus/sonnet/…) are valid as-is.
      return model;
  }
}

/**
 * Build the per-agent proxy-routing ENV map (lifted VERBATIM from experiment-runner.mjs
 * configureProxyRoutingEnv's switch body). This is the SINGLE definition of the per-agent env
 * strings — configureProxyRoutingEnv keeps its opt-out + /health gating and DELEGATES the routed
 * env map here. Callers pass the ALREADY-RESOLVED model (this does not call resolveCellModel).
 *
 *   • opencode  → ANTHROPIC_BASE_URL (KEEP the key) + (when taskId given) an OPENCODE_CONFIG_CONTENT
 *                 provider splice binding BOTH wires: anthropic → /v1 + x-task-id/x-agent headers;
 *                 openai/github-copilot → task-scoped path /v1/opencode/t/<taskId>. It does NOT
 *                 redefine the rapid-proxy provider (the file config supplies it; the cell's
 *                 rapid-proxy traffic attributes via the sequential global span, D-09).
 *   • claude    → ANTHROPIC_BASE_URL + (when taskId given) ANTHROPIC_CUSTOM_HEADERS 'x-task-id: <id>'.
 *   • copilot   → BYOK env: COPILOT_PROVIDER_BASE_URL=/v1/copilot/t/<taskId> (or /v1/copilot without
 *                 a taskId), type openai, placeholder key, COPILOT_MODEL=<model>, auto-update off.
 *   • mastracode / unknown → no change (self-routed / ambient-bound this phase).
 *
 * Returns a COPY of baseEnv; NEVER mutates baseEnv, NEVER touches LLM_PROXY_DATA_DIR. It does NOT do
 * health/route/opt-out gating (that stays in configureProxyRoutingEnv).
 *
 * @param {string} agent    cell.agent.
 * @param {object} baseEnv  the agent's base env (already carries sandbox LLM_PROXY_DATA_DIR).
 * @param {object} [opts]
 * @param {string} [opts.taskId]  the cell's composite task_id → x-task-id header / task-scoped path.
 * @param {string} [opts.model]   the RESOLVED cell model → COPILOT_MODEL for the BYOK seam.
 * @param {number} [opts.port]    proxy port (default LLM_PROXY_PORT ?? 12435).
 * @returns {object} a new env object.
 */
export function buildAgentRoutingEnv(agent, baseEnv, {
  taskId,
  model,
  port = Number(process.env.LLM_PROXY_PORT) || 12435,
} = {}) {
  const env = { ...baseEnv };
  const base = `http://127.0.0.1:${port}`;

  switch (agent) {
    case 'opencode': {
      env.ANTHROPIC_BASE_URL = base; // best-effort; opencode keeps its own credential
      if (taskId) {
        const scoped = `${base}/v1/opencode/t/${encodeURIComponent(taskId)}`;
        const hdr = { 'x-task-id': taskId, 'x-agent': 'opencode' };
        const provider = {
          anthropic: { options: { baseURL: `${base}/v1`, headers: hdr } },        // seam A
          'github-copilot-enterprise': { options: { baseURL: scoped, headers: hdr } }, // seam B
          'github-copilot': { options: { baseURL: scoped, headers: hdr } },       // seam B
          openai: { options: { baseURL: scoped, headers: hdr } },                 // seam B
        };
        let cfg = {};
        if (typeof env.OPENCODE_CONFIG_CONTENT === 'string' && env.OPENCODE_CONFIG_CONTENT.trim()) {
          try { cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT); } catch { cfg = {}; }
        }
        cfg.provider = { ...(cfg.provider || {}), ...provider };
        env.OPENCODE_CONFIG_CONTENT = JSON.stringify(cfg);
      }
      break;
    }
    case 'claude':
      env.ANTHROPIC_BASE_URL = base;
      if (taskId) env.ANTHROPIC_CUSTOM_HEADERS = `x-task-id: ${taskId}`;
      break;
    case 'copilot': {
      env.COPILOT_PROVIDER_BASE_URL = taskId
        ? `${base}/v1/copilot/t/${encodeURIComponent(taskId)}`
        : `${base}/v1/copilot`;
      env.COPILOT_PROVIDER_TYPE = 'openai';
      env.COPILOT_PROVIDER_API_KEY = 'rapid-proxy-no-auth-placeholder';
      if (model) env.COPILOT_MODEL = model;
      env.COPILOT_AUTO_UPDATE = 'false';
      break;
    }
    default:
      // mastracode (and any future agent) is self-routed with no launcher-controlled base-URL
      // seam → ambient-bound this phase (documented deviation). No env change here.
      break;
  }
  return env;
}

// ---------------------------------------------------------------------------
// CLI entry (side-effect ONLY when executed directly). Prints the EXPERIMENT-CELL
// copilot default. Unknown args exit 2. Never fires on import (the isMain guard).
//
// scripts/launch-agent-common.sh no longer calls this: an interactive launch takes
// its model from the proxy's routing config instead
// (`GET /api/llm/routing/resolve?job=fg-chat&agent=copilot`). Kept for the
// experiment path and for inspecting what a spec's `auto` resolves to.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [sub, arg] = process.argv.slice(2);
  if (sub === 'default' && arg === 'copilot') {
    process.stdout.write(`${COPILOT_MEASURED_DEFAULT_MODEL}\n`);
    process.exit(0);
  }
  process.stderr.write('usage: node lib/experiments/agent-routing.mjs default copilot\n');
  process.exit(2);
}
