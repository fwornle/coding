// lib/agents/proxy-routing.mjs
//
// How an agent's LLM traffic is pointed at the rapid-llm-proxy so it is measured
// (Route 1) — the ONE implementation, used by:
//   - the shell launcher: scripts/launch-agent-common.sh (configure_proxy_routing)
//     and config/agents/<agent>.sh (agent_pre_launch) eval the shell this file's
//     CLI prints;
//   - the experiment runner (lib/experiments/experiment-runner.mjs), which applies
//     the same wiring to each cell's env;
//   - glass, which ships this file without coding.
// It used to live in bash + python3 (and a drifted Node copy for experiments);
// the bash behaviour is the contract, pinned by
// tests/agents/proxy-routing-parity.test.mjs.
//
// Two phases, in launch order:
//   preLaunchWiring  — per-agent config built before the agent starts: opencode's
//                      OPENCODE_CONFIG_CONTENT, pi's models.json/settings.json
//                      merge and env, copilot clearing inherited BYOK vars.
//   proxyRouting     — health-gated: base URLs, headers, BYOK env. Runs last so
//                      it has the final say on the routing env.
// Both return { set, unset, log } (plus `abort` from proxyRouting) and never
// mutate the env they are given; applyWiring folds a result into an env copy.
//
// No dependencies beyond node: — no python3, no curl — so it runs on native
// Windows too.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Every env var the wiring may set or unset — the tmux wrapper passes exactly these through. */
export const ROUTING_ENV_VARS = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_ADMIN_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_MODEL', 'COPILOT_AUTO_UPDATE',
  'OPENCODE_CONFIG_CONTENT',
  'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'PI_OFFLINE', 'PI_TELEMETRY', 'PI_SKIP_VERSION_CHECK',
  'CODING_PROJECT_ID',
];

/** The env the wiring reads. The shell bridge exports exactly these to the CLI. */
export const WIRING_INPUT_VARS = [
  'CODING_REPO', 'TARGET_PROJECT_DIR', 'TASK_ID', 'CODING_PROJECT_ID', 'CODING_AGENT_SCOPE',
  'CODING_PROXY_ROUTE', 'LLM_PROXY_PORT', 'LLM_CLI_PROXY_PORT',
  'CODING_COPILOT_BAND', 'COPILOT_AMBIENT_ROUTE', 'COPILOT_MODEL',
  'CODING_OPENCODE_MODEL', 'OPENCODE_ANTHROPIC_NATIVE', 'QWEN_LAPTOP_API_BASE_URL',
];

// bash `${VAR:-default}`: unset and empty both take the default.
const val = (env, k, dflt = '') => (env[k] === undefined || env[k] === '' ? dflt : String(env[k]));

/**
 * One path-safe segment, or '' — the rule the launcher applies to
 * CODING_PROJECT_ID and the proxy applies to x-project / `/p/<id>`.
 */
export function sanitizeProjectId(id) {
  const s = id == null ? '' : String(id);
  return /^[A-Za-z0-9._~@+-]+$/.test(s) && s !== '.' && s !== '..' ? s : '';
}

/**
 * Wrapper vs global scope for config an agent reads from its own dirs:
 * CODING_AGENT_SCOPE, else the first `CODING_AGENT_SCOPE=` line of
 * $CODING_REPO/.env, else '' (callers default it to `wrapper`).
 */
export function agentScope(env) {
  const scope = val(env, 'CODING_AGENT_SCOPE');
  if (scope || !val(env, 'CODING_REPO')) return scope;
  try {
    const line = fs.readFileSync(path.join(val(env, 'CODING_REPO'), '.env'), 'utf8')
      .split('\n').find((l) => l.startsWith('CODING_AGENT_SCOPE='));
    return line ? line.slice('CODING_AGENT_SCOPE='.length) : '';
  } catch {
    return '';
  }
}

// ── opencode ────────────────────────────────────────────────────────────────

/**
 * OPENCODE_CONFIG_CONTENT for one launch — merged by opencode on top of its
 * file config, so this is the place for per-launch values only:
 *
 *   - `provider.rapid-proxy`: the x-project header and the per-turn band
 *     variants. opencode's only per-turn complexity seam is `--variant`: verified
 *     on a capture endpoint 2026-08-30, `--variant cheap` put
 *     `reasoning_effort: "low"` on the wire and a bare run put none. The proxy
 *     reads effort as the caller's band. The model list mirrors the file config's
 *     rapid-proxy models; a model missing here simply has no variants.
 *   - `provider.github-copilot`: points the provider at the proxy's opencode shim
 *     (`/v1/opencode`, or `/v1/opencode/t/<task>` for a measured span — a URL is
 *     the only per-request binding this provider has), with x-agent so its rows
 *     stamp agent='opencode'.
 *   - `provider.anthropic` (OPENCODE_ANTHROPIC_NATIVE=1, opt-in): opencode's
 *     native anthropic wire through the /v1/messages tap.
 *   - `command.sl`: the /sl session-log command, in every scope.
 *   - `enabled_providers`: only the providers above, so nothing routes around
 *     the proxy.
 *   - wrapper scope: the coding plugins (compaction guard, knowledge injection)
 *     and the compaction reserve they need, for this session only.
 *
 * Key order is the launcher's historical one (each fragment was prepended):
 * plugin, compaction, enabled_providers, command, provider, model.
 */
export function opencodeConfigContent(env) {
  const port = val(env, 'LLM_CLI_PROXY_PORT', '12435');
  const taskId = val(env, 'TASK_ID');
  const project = val(env, 'CODING_PROJECT_ID');
  const native = val(env, 'OPENCODE_ANTHROPIC_NATIVE', '0') === '1';
  const codingRepo = val(env, 'CODING_REPO');

  const variants = { cheap: { reasoningEffort: 'low' }, standard: { reasoningEffort: 'medium' }, deep: { reasoningEffort: 'high' } };
  const models = Object.fromEntries(['claude-sonnet-5', 'claude-haiku-4.5', 'gpt-4o', 'gpt-4o-mini'].map((m) => [m, { variants }]));
  const shimBase = `http://127.0.0.1:${port}/v1/opencode${taskId ? `/t/${taskId}` : ''}`;
  const provider = {
    'rapid-proxy': { options: { headers: { 'x-project': project } }, models },
    'github-copilot': { options: { baseURL: shimBase, headers: { 'x-agent': 'opencode', 'x-project': project } } },
  };
  if (native) {
    provider.anthropic = {
      options: { baseURL: `http://127.0.0.1:${port}/v1`, headers: { 'x-task-id': taskId, 'x-agent': 'opencode', 'x-project': project } },
    };
  }

  const cfg = {};
  const scope = agentScope(env);
  if ((scope || 'wrapper') !== 'global' && codingRepo) {
    const plugins = ['compaction-guard', 'knowledge-injection']
      .map((p) => `${codingRepo}/plugins/opencode/${p}.js`)
      .filter((p) => fs.existsSync(p));
    if (plugins.length) {
      cfg.plugin = plugins;
      cfg.compaction = { reserved: 40000 };
    }
  }
  cfg.enabled_providers = native ? ['rapid-proxy', 'github-copilot', 'anthropic'] : ['rapid-proxy', 'github-copilot'];
  cfg.command = { sl: { description: 'Load recent session logs for continuity', template: 'Read and follow .claude/commands/sl.md. The user supplied these optional arguments: $ARGUMENTS' } };
  cfg.provider = provider;
  if (val(env, 'CODING_OPENCODE_MODEL')) cfg.model = val(env, 'CODING_OPENCODE_MODEL');
  return { content: JSON.stringify(cfg), pluginsInjected: Boolean(cfg.plugin) };
}

// ── pi ──────────────────────────────────────────────────────────────────────

// Python's json.dump(indent=2): same layout as JSON.stringify(…, 2), but
// non-ASCII is written as \uXXXX (ensure_ascii) — kept so a rewrite of a file
// the launcher wrote before is byte-identical.
function pyJsonDump(doc) {
  return JSON.stringify(doc, null, 2).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function readJsonObject(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  } catch {
    return {};
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * pi's two providers in <cfgDir>/models.json, merged into whatever is there.
 *
 * `rapid-proxy-pi` routes through the proxy's OpenAI shim. pi interpolates
 * `$VAR` in header values from its own process env at config load, so the file
 * holds the literals `$CODING_PROJECT_ID` / `$TASK_ID`, not their values. An
 * interactive launch OMITS x-task-id: pi treats an empty value as missing and a
 * declared-but-unresolvable header aborts the provider, so the proxy binds the
 * ambient span instead. `thinkingLevelMap` turns pi's per-turn --thinking level
 * into the band the proxy routes on.
 *
 * `qwen-laptop` is the local llama.cpp server (QWEN_LAPTOP_API_BASE_URL).
 *
 * Merge, not overwrite: providers the user added are kept, ours replace their
 * previous versions, and the first rewrite of a pre-existing file keeps the
 * original as models.json.coding-orig. A file that is not a JSON object is
 * replaced.
 *
 * @returns {{ file: string, preserved: string[], taskBound: boolean }}
 */
export function writePiModelsJson(cfgDir, env) {
  const port = val(env, 'LLM_CLI_PROXY_PORT', '12435');
  const taskBound = Boolean(val(env, 'TASK_ID'));
  const headers = { 'x-agent': 'pi', 'x-project': '$CODING_PROJECT_ID', ...(taskBound ? { 'x-task-id': '$TASK_ID' } : {}) };
  const ours = {
    'rapid-proxy-pi': {
      api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'coding-local-proxy-no-auth',
      headers,
      models: [{
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5 (routed by the coding proxy)',
        input: ['text', 'image'],
        contextWindow: 200000,
        reasoning: true,
        thinkingLevelMap: { off: 'small', minimal: 'small', low: 'small', medium: 'medium', high: 'high', xhigh: null, max: null },
      }],
    },
    'qwen-laptop': {
      api: 'openai-completions',
      baseUrl: val(env, 'QWEN_LAPTOP_API_BASE_URL', 'http://127.0.0.1:8081/v1'),
      apiKey: 'local-no-auth-placeholder',
      models: [{ id: 'qwen3.8-27b-local', name: 'Qwen3.8-27B (this laptop, llama.cpp / Metal)', input: ['text'], contextWindow: 32768, reasoning: false }],
    },
  };

  fs.mkdirSync(cfgDir, { recursive: true });
  const file = path.join(cfgDir, 'models.json');
  const doc = readJsonObject(file);
  const providers = doc.providers && typeof doc.providers === 'object' && !Array.isArray(doc.providers) ? doc.providers : {};
  const backup = `${file}.coding-orig`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    try { fs.writeFileSync(backup, fs.readFileSync(file, 'utf8')); } catch { /* a backup we could not take must not stop the launch */ }
  }
  const preserved = Object.keys(providers).filter((k) => !(k in ours));
  Object.assign(providers, ours);
  doc.providers = providers;
  writeAtomic(file, `${pyJsonDump(doc)}\n`);
  return { file, preserved, taskBound };
}

/** Pin pi's default provider/model in <cfgDir>/settings.json, keeping every other setting. */
export function writePiSettings(cfgDir) {
  fs.mkdirSync(cfgDir, { recursive: true });
  const file = path.join(cfgDir, 'settings.json');
  const settings = readJsonObject(file);
  settings.defaultProvider = 'rapid-proxy-pi';
  settings.defaultModel = 'claude-sonnet-5';
  settings.enabledModels = ['claude-sonnet-5', 'qwen3.8-27b-local'];
  writeAtomic(file, `${pyJsonDump(settings)}\n`);
  return { file };
}

/**
 * pi's config dir for this launch: $CODING_REPO/.pi-agent in wrapper scope
 * (exported as PI_CODING_AGENT_DIR, so a bare `pi` keeps ~/.pi/agent), the
 * default $HOME/.pi/agent in global scope.
 */
export function piConfigDir(env, override) {
  const scope = agentScope(env) || 'wrapper';
  if (override) return { scope, wrapper: true, dir: override };
  const codingRepo = val(env, 'CODING_REPO');
  const wrapper = scope !== 'global' && Boolean(codingRepo);
  return { scope, wrapper, dir: wrapper ? `${codingRepo}/.pi-agent` : `${val(env, 'HOME')}/.pi/agent` };
}

// ── phase 1: before the agent starts ────────────────────────────────────────

async function httpOk(url, timeoutMs) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await r.arrayBuffer().catch(() => {});
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Per-agent wiring that config/agents/<agent>.sh runs in agent_pre_launch.
 * Writes pi's config files; everything else is returned.
 *
 * @param {string} agent
 * @param {object} env  the launch env (read only)
 * @param {object} [opts]
 * @param {(url: string, timeoutMs: number) => Promise<boolean>} [opts.probe]
 * @param {string} [opts.piConfigDir]  pi's config dir instead of the scope's
 *   (an experiment cell keeps its own, in its sandbox)
 * @returns {Promise<{ set: object, unset: string[], log: string[], vars: object }>}
 *   `vars` are shell locals for the rest of the hook (not exported).
 */
export async function preLaunchWiring(agent, env, { probe = httpOk, piConfigDir: piDirOverride } = {}) {
  const set = {}; const unset = []; const log = []; const vars = {};
  switch (agent) {
    case 'opencode': {
      if (val(env, 'CODING_OPENCODE_MODEL')) log.push(`📌 Model override → ${val(env, 'CODING_OPENCODE_MODEL')}`);
      else log.push('🔀 Model from ~/.config/opencode/opencode.json; provider+model per call from llm-routing.yaml (fg-chat/opencode)');
      const port = val(env, 'LLM_CLI_PROXY_PORT', '12435');
      if (val(env, 'OPENCODE_ANTHROPIC_NATIVE', '0') === '1') {
        log.push(`🧪 opencode ANTHROPIC-NATIVE (opt-in) → proxy http://127.0.0.1:${port}/v1/messages (x-agent=opencode; x-task-id=${val(env, 'TASK_ID', '<ambient>')})`);
      }
      log.push('🎚  Per-turn band variants available: --variant cheap|standard|deep (cheap → small → offload-eligible)');
      const { content, pluginsInjected } = opencodeConfigContent(env);
      if (pluginsInjected) log.push('🔒 Wrapper-scoped: opencode plugins injected for this session only');
      set.OPENCODE_CONFIG_CONTENT = content;
      break;
    }
    case 'copilot': {
      // Inherited BYOK vars must not leak in; configure_proxy_routing sets them
      // behind its health gate, for measured and ambient launches alike.
      unset.push('COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_API_KEY');
      set.COPILOT_AUTO_UPDATE = 'false';
      log.push(`🔌 copilot: cleared inherited COPILOT_PROVIDER_* (proxy port ${val(env, 'LLM_CLI_PROXY_PORT', '12435')}); BYOK is set by the health-gated wiring in configure_proxy_routing — measured AND ambient interactive (opt out with COPILOT_AMBIENT_ROUTE=0)`);
      break;
    }
    case 'pi': {
      const port = val(env, 'LLM_CLI_PROXY_PORT', '12435');
      log.push(await probe(`http://127.0.0.1:${port}/health`, 5000)
        ? `LLM proxy reachable on port ${port}`
        : `WARNING: LLM proxy not reachable on port ${port} -- pi may not have LLM access`);
      const { scope, wrapper, dir } = piConfigDir(env, piDirOverride);
      if (wrapper) {
        set.PI_CODING_AGENT_DIR = dir;
        log.push(`🔒 Wrapper-scoped: pi config dir is ${dir} (bare \`pi\` still uses ~/.pi/agent)`);
      } else {
        log.push(`🌐 Global scope: using pi's default config dir ${dir}`);
      }
      const models = writePiModelsJson(dir, env);
      log.push(models.taskBound
        ? `Task-bound launch: models.json carries x-task-id (TASK_ID=${val(env, 'TASK_ID')})`
        : 'Interactive launch: x-task-id omitted (proxy binds the ambient span)');
      log.push(models.preserved.length
        ? `Merged pi provider config into ${models.file} (rapid-proxy-pi + qwen-laptop; preserved: ${models.preserved.join(',')})`
        : `Wrote pi provider config: ${models.file} (rapid-proxy-pi + qwen-laptop)`);
      // An inherited ANTHROPIC_API_KEY makes pi prefer direct Anthropic over the
      // proxy provider pinned below.
      unset.push('ANTHROPIC_API_KEY');
      const settings = writePiSettings(dir);
      log.push(`Pinned pi provider/model in ${settings.file} (rapid-proxy-pi/claude-sonnet-5)`);
      // Session transcripts in the project, where the token adapter looks.
      const sessions = path.join(path.resolve(val(env, 'TARGET_PROJECT_DIR', val(env, 'CODING_REPO', '.'))), '.observations', 'pi-sessions');
      fs.mkdirSync(sessions, { recursive: true });
      set.PI_CODING_AGENT_SESSION_DIR = sessions;
      log.push(`Session transcripts: ${sessions}`);
      set.PI_OFFLINE = '1';
      set.PI_TELEMETRY = '0';
      set.PI_SKIP_VERSION_CHECK = '1';
      vars._pi_cfg_dir = dir;
      vars._pi_scope = scope;
      break;
    }
    default:
      break;
  }
  return { set, unset, log, vars };
}

// ── phase 2: route through the proxy ────────────────────────────────────────

/** The model the proxy's routing config gives `fg-chat/<agent>` (head of the chain), or ''. */
export async function resolveRoutedModel(base, agent) {
  try {
    const r = await fetch(`${base}/api/llm/routing/resolve?job=fg-chat&agent=${agent}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return '';
    const head = JSON.parse(await r.text()).chain?.[0];
    return head?.model ? String(head.model) : '';
  } catch {
    return ''; // unresolvable -> caller keeps its own default
  }
}

const OPT_OUT = new Set(['0', 'false', 'no', 'off']);

/**
 * Point the agent at the proxy, behind a health gate.
 *
 * Policy: a launcher-driven agent is MEASURED or does not start. When the proxy
 * is unreachable the result carries `abort` (the launcher exits 1 with
 * remediation hints) — no silent direct, unmeasured fallback. Experiment cells
 * pass `onUnreachable: 'unrouted'` instead: a cell launches unrouted and the
 * run records it. CODING_PROXY_ROUTE=0|false|no|off is the explicit opt-out.
 *
 * Per agent:
 *   claude   — ANTHROPIC_BASE_URL → the /v1/messages tap. The API-key vars are
 *              removed so the Max OAuth login is used (they take precedence over
 *              it); the passthrough re-injects the Max bearer when the caller
 *              sends none. ANTHROPIC_CUSTOM_HEADERS binds each request:
 *              x-task-id (blank when interactive — the tap then stamps a neutral
 *              row, never the ambient span) and x-project.
 *   opencode — ANTHROPIC_BASE_URL for its anthropic path; it keeps its own key.
 *              The rest is in its OPENCODE_CONFIG_CONTENT (preLaunchWiring).
 *   pi       — self-routed through the models.json provider preLaunchWiring
 *              writes; nothing to export.
 *   copilot  — BYOK: the CLI can set no request headers, so the base URL path
 *              carries the binding: /v1/copilot[/p/<project>][/b/<band>][/t/<task>].
 *              CODING_COPILOT_BAND declares a band for the whole session (its BYOK
 *              body carries no effort field). Without a task the shim stamps
 *              agent='copilot' and takes the task id from the reconciler's
 *              ambient slot. COPILOT_MODEL defaults to the head of the proxy's
 *              `fg-chat/copilot` route, so launcher and proxy agree on the model.
 *              COPILOT_AMBIENT_ROUTE=0 keeps an interactive launch copadt-only.
 *
 * @param {string} agent
 * @param {object} env  the launch env (read only)
 * @param {object} [opts]
 * @param {'abort'|'unrouted'} [opts.onUnreachable='abort']
 * @param {(url: string, timeoutMs: number) => Promise<boolean>} [opts.probe]
 * @param {(base: string, agent: string) => Promise<string>} [opts.resolveModel]
 * @param {number} [opts.tries=5]          health attempts (the daemon may be mid-restart)
 * @param {number} [opts.retryDelayMs=2000]
 * @param {string} [opts.platform=process.platform]  picks the remediation hint
 * @returns {Promise<{ set: object, unset: string[], log: string[], abort?: true, unrouted?: true }>}
 */
export async function proxyRouting(agent, env, {
  onUnreachable = 'abort',
  probe = httpOk,
  resolveModel = resolveRoutedModel,
  tries = 5,
  retryDelayMs = 2000,
  platform = process.platform,
} = {}) {
  const set = {}; const unset = []; const log = [];
  const route = val(env, 'CODING_PROXY_ROUTE', '1');
  if (OPT_OUT.has(route)) {
    log.push(`ℹ️  CODING_PROXY_ROUTE=${val(env, 'CODING_PROXY_ROUTE')} — proxy routing disabled; ${agent} launches direct (unmeasured).`);
    return { set, unset, log };
  }

  const base = `http://127.0.0.1:${val(env, 'LLM_PROXY_PORT', '12435')}`;
  let up = false;
  for (let i = 0; i < tries && !up; i++) {
    up = await probe(`${base}/health`, 2000);
    if (!up && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  if (!up) {
    if (onUnreachable === 'unrouted') {
      log.push(`LLM proxy unreachable at ${base} — ${agent} launched unrouted`);
      return { set, unset, log, unrouted: true };
    }
    const coding = val(env, 'CODING_REPO', '<coding>');
    log.push(`🚫 LLM proxy unreachable at ${base} — ABORTING ${agent} launch (fail-closed: no unmeasured direct fallback).`);
    if (platform === 'darwin') log.push('    Fix:      launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy   then relaunch.');
    else if (platform === 'linux') log.push(`    Fix:      systemctl --user restart llm-cli-proxy   (no unit: bash ${coding}/scripts/llm-proxy-service.sh &)   then relaunch.`);
    else log.push(`    Fix:      bash ${coding}/scripts/llm-proxy-service.sh &   then relaunch.`);
    log.push('    Override: CODING_PROXY_ROUTE=0 launches direct (unmeasured) — explicit opt-out only.');
    return { set, unset, log, abort: true };
  }

  const taskId = val(env, 'TASK_ID');
  const project = val(env, 'CODING_PROJECT_ID');
  switch (agent) {
    case 'claude':
      set.ANTHROPIC_BASE_URL = base;
      unset.push('ANTHROPIC_API_KEY', 'ANTHROPIC_ADMIN_API_KEY', 'ANTHROPIC_AUTH_TOKEN');
      set.ANTHROPIC_CUSTOM_HEADERS = `x-task-id: ${taskId}\nx-project: ${project}`;
      log.push(`🔌 claude → proxy ${base}/v1/messages (Max-OAuth forwarded; token_usage agent='claude'; x-task-id=${taskId || '<ambient>'}; project=${project || '<none>'})`);
      break;
    case 'opencode':
      set.ANTHROPIC_BASE_URL = base;
      log.push(`🔌 opencode → proxy ${base}/v1/messages (anthropic path; best-effort — validate live)`);
      break;
    case 'pi':
      log.push(`🔌 pi → proxy ${base}/v1/chat/completions (models.json provider rapid-proxy-pi; x-agent=pi; x-task-id=${taskId || '<ambient>'})`);
      break;
    case 'copilot': {
      // Validated here as well as in the proxy so a typo fails at launch with a
      // readable message, not as a URL the proxy declines to match.
      let bandSeg = '';
      const band = val(env, 'CODING_COPILOT_BAND');
      if (band) {
        if (['small', 'medium', 'high'].includes(band)) bandSeg = `/b/${band}`;
        else log.push(`⚠️  CODING_COPILOT_BAND='${band}' is not one of small|medium|high — ignoring it.`);
      }
      // The project segment comes first: copilot can send no x-project header.
      const projectSeg = project ? `/p/${project}` : '';
      const ambient = val(env, 'COPILOT_AMBIENT_ROUTE', '1') !== '0';
      if (taskId || ambient) {
        set.COPILOT_PROVIDER_BASE_URL = `${base}/v1/copilot${projectSeg}${bandSeg}${taskId ? `/t/${taskId}` : ''}`;
        set.COPILOT_PROVIDER_TYPE = 'openai';
        // A literal, non-secret placeholder: the localhost proxy needs no auth.
        set.COPILOT_PROVIDER_API_KEY = 'rapid-proxy-no-auth-placeholder';
        set.COPILOT_MODEL = val(env, 'COPILOT_MODEL') || await resolveModel(base, 'copilot');
        set.COPILOT_AUTO_UPDATE = 'false';
        log.push(taskId
          ? `🔌 copilot → proxy ${set.COPILOT_PROVIDER_BASE_URL} (BYOK openai; measured span; token_usage agent='copilot'; model=${set.COPILOT_MODEL})`
          : `🔌 copilot → proxy ${set.COPILOT_PROVIDER_BASE_URL} (BYOK openai; AMBIENT — task_id from reconciler slot; model=${set.COPILOT_MODEL}; opt-out COPILOT_AMBIENT_ROUTE=0)`);
      } else {
        unset.push('COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_TYPE', 'COPILOT_PROVIDER_API_KEY');
        log.push('ℹ️  copilot: COPILOT_AMBIENT_ROUTE=0 — interactive launch stays copadt-only (unmeasured wire; no context capture).');
      }
      break;
    }
    default:
      log.push(`ℹ️  ${agent}: no proxy-routing rule; launching as configured (traffic may be unmeasured).`);
      break;
  }
  return { set, unset, log };
}

/** A copy of env with a wiring result applied (unsets first, then sets). */
export function applyWiring(env, { set = {}, unset = [] }) {
  const out = { ...env };
  for (const k of unset) delete out[k];
  return Object.assign(out, set);
}

/**
 * Both phases for an agent started from Node (experiment cells, kgbench), with
 * the launcher's rules. The inputs a cell has that an interactive launch gets
 * from its shell are passed explicitly:
 *   taskId      → TASK_ID, the binding every agent's seam reads
 *   model       → COPILOT_MODEL (a preset model wins over the routing lookup)
 *   port        → LLM_PROXY_PORT and LLM_CLI_PROXY_PORT
 *   targetProjectDir, piConfigDir → where pi keeps its session log and config
 *   route       → CODING_PROXY_ROUTE for this decision only (not put in the agent's env)
 * CODING_PROJECT_ID is sanitized on the way in, as the launcher's _resolve_project_id does.
 * Fail-soft by default: when the proxy is unreachable the agent gets its env
 * back untouched (`unrouted: true`) — half-wired, it would point at a dead
 * proxy instead of running unmeasured.
 *
 * @returns {Promise<{ env: object, log: string[], unrouted: boolean }>}
 */
export async function wireAgentEnv(agent, baseEnv, {
  taskId, model, port, targetProjectDir, piConfigDir: piDir, route,
  onUnreachable = 'unrouted', probe = httpOk, tries, retryDelayMs, resolveModel,
} = {}) {
  const env = { ...baseEnv };
  if ('CODING_PROJECT_ID' in env) env.CODING_PROJECT_ID = sanitizeProjectId(env.CODING_PROJECT_ID);
  if (taskId) env.TASK_ID = taskId;
  if (model && agent === 'copilot') env.COPILOT_MODEL = model;
  if (port) { env.LLM_PROXY_PORT = String(port); env.LLM_CLI_PROXY_PORT = String(port); }
  if (targetProjectDir) env.TARGET_PROJECT_DIR = targetProjectDir;
  const pre = await preLaunchWiring(agent, env, { probe, piConfigDir: piDir });
  const wired = applyWiring(env, pre);
  const decide = route === undefined ? wired : { ...wired, CODING_PROXY_ROUTE: String(route) };
  const routed = await proxyRouting(agent, decide, {
    onUnreachable, probe,
    ...(tries !== undefined ? { tries } : {}),
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    ...(resolveModel ? { resolveModel } : {}),
  });
  if (routed.unrouted) return { env: { ...baseEnv }, log: [...pre.log, ...routed.log], unrouted: true };
  return { env: applyWiring(wired, routed), log: [...pre.log, ...routed.log], unrouted: false };
}

// ── CLI: the shell bridge ───────────────────────────────────────────────────
//
//   node lib/agents/proxy-routing.mjs pre-launch <agent>
//   node lib/agents/proxy-routing.mjs route <agent>
//
// Prints shell for the launcher to eval: `_agent_log` lines (so messages keep
// the launcher's own prefix), `unset`/`export`, shell locals, and `exit 1` when
// the launch must abort. Always exits 0 itself; a non-zero exit means the
// bridge itself failed.

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function toShell({ set = {}, unset = [], log = [], vars = {}, abort = false }) {
  const lines = log.map((l) => `_agent_log ${shq(l)}`);
  if (unset.length) lines.push(`unset ${unset.join(' ')}`);
  for (const [k, v] of Object.entries(set)) lines.push(`export ${k}=${shq(v)}`);
  for (const [k, v] of Object.entries(vars)) lines.push(`${k}=${shq(v)}`);
  if (abort) lines.push('exit 1');
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [phase, agent] = process.argv.slice(2);
  if (!['pre-launch', 'route'].includes(phase) || !agent) {
    process.stderr.write('usage: node lib/agents/proxy-routing.mjs pre-launch|route <agent>\n');
    process.exit(2);
  }
  const result = phase === 'route'
    ? await proxyRouting(agent, process.env)
    : await preLaunchWiring(agent, process.env);
  process.stdout.write(toShell(result));
}
