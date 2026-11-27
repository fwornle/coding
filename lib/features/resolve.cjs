'use strict';

/**
 * Feature resolver — the one place that decides which features are on.
 *
 * WHY COMMONJS. The status line is the hottest consumer and is CommonJS
 * (`scripts/status-line-fast.cjs`, `scripts/claude-statusline.cjs`); it renders
 * on every prompt and must not pay an ESM bridge to read a cached object.
 * `lib/features/index.mjs` re-exports this for ESM callers, so there is exactly
 * one implementation.
 *
 * CACHING. Modelled on _work/rapid-llm-proxy/proxy-bridge/routing-config.mjs:
 * stamp the inputs (config file mtimes + the env overrides), re-parse only when
 * the stamp changes, and THROW rather than fall back to defaults on malformed
 * input. Falling back would silently run a configuration nobody chose, which is
 * precisely the ambiguity this design exists to remove.
 *
 * LAYERS (last wins):
 *   1. built-in defaults          — all on
 *   2. <repo>/config/features.yaml     — committed team/project default
 *   3. ~/.coding/features.yaml         — this machine; what the dashboard writes
 *   4. CODING_FEATURE_<ID>=on|off      — env, for CI and the test matrix
 *
 * Within a layer, a `profile:` key resets the baseline to a named preset and an
 * explicit `features:` map then refines it. A later layer's profile replaces an
 * earlier layer's wholesale — otherwise "profile: minimal" in the home file
 * would not be able to undo a repo default.
 *
 * See docs/architecture/features.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Vendored, not resolved from node_modules: this module runs before npm install
// on a fresh clone. See lib/features/vendor/README.md.
const yaml = require('./vendor/js-yaml.cjs');

const { FEATURES, FEATURE_IDS, defaultFeatures, envVarFor } = require('./catalogue.cjs');

class FeatureConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeatureConfigError';
  }
}

// ── paths ────────────────────────────────────────────────────────────────────

function repoRoot() {
  return process.env.CODING_REPO || path.resolve(__dirname, '..', '..');
}

/**
 * The three file inputs. Exposed as a function rather than module constants so
 * tests can point CODING_REPO / HOME elsewhere without reloading the module.
 */
function configPaths(opts = {}) {
  const repo = opts.repoPath || repoRoot();
  const home = opts.homeDir || process.env.CODING_HOME || os.homedir();
  return {
    repo: opts.repoConfigPath || path.join(repo, 'config', 'features.yaml'),
    home: opts.homeConfigPath || path.join(home, '.coding', 'features.yaml'),
    profiles: opts.profilesPath || path.join(repo, 'config', 'feature-profiles.yaml'),
  };
}

// ── settings: where agents run, which agents are offered ────────────────────
//
// Not features: a feature is on or off, these are choices. They live in the
// same layered files so there is still one place a machine's composition is
// written down, and the dashboard edits them through the same writer.

/** Top-level keys a layer may carry. */
const LAYER_KEYS = ['profile', 'features', 'run', 'agents'];

/**
 * Where an agent runs.
 *   auto        — the box when `constraints` is on, else the host (the rule
 *                 bin/coding hard-coded before this setting existed)
 *   box         — the agent box (docker/agent-box/), under the guard
 *   strict-box  — the box, and the host's web UIs stay hidden from it
 *   host        — directly on this machine
 */
const RUN_MODES = ['auto', 'box', 'strict-box', 'host'];

/** Agents the box can run. Any other config/agents/<name>.sh runs on the host. */
const BOX_AGENTS = ['claude', 'copilot', 'opencode', 'pi'];

/** The agent plain `coding` launches, when it is enabled. */
const DEFAULT_AGENT = 'claude';

/** Every agent this checkout can launch: one config/agents/<name>.sh each. */
function availableAgents(repo = repoRoot()) {
  try {
    return fs.readdirSync(path.join(repo, 'config', 'agents'))
      .filter((f) => f.endsWith('.sh'))
      .map((f) => f.slice(0, -3))
      .sort((a, b) => (a === DEFAULT_AGENT ? -1 : b === DEFAULT_AGENT ? 1 : a.localeCompare(b)));
  } catch {
    return [];
  }
}

/**
 * Resolve `run` against the resolved features. The box IS how `constraints` is
 * enforced — it runs under the guard and reaches it through its gate — so with
 * `constraints` off an explicit box falls back to the host, with the reason
 * recorded. Same rule as features: a dependency is never switched back on.
 */
function resolveRun(value, source, constraintsOn) {
  if (value === 'auto') {
    return constraintsOn
      ? { effective: 'box', reason: `box — auto: Constraint Monitoring is on (${source})` }
      : { effective: 'host', reason: `host — auto: Constraint Monitoring is off, so there is no guard for a box (${source})` };
  }
  if (value !== 'host' && !constraintsOn) {
    return {
      effective: 'host',
      reason: `host — '${value}' needs Constraint Monitoring (the box runs under its guard), which is off`,
    };
  }
  return { effective: value, reason: `${value} — set in ${source}` };
}

// ── parsing helpers ──────────────────────────────────────────────────────────

/**
 * Accept the spellings a human would reasonably write in YAML.
 *
 * Note that bare `on`/`off`/`yes`/`no` are already booleans under YAML 1.1,
 * which js-yaml implements — so those arrive here as `true`/`false`. The string
 * cases are for quoted values and for the env layer, where everything is text.
 */
function toBool(value, where) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['on', 'true', 'yes', '1', 'enabled'].includes(v)) return true;
    if (['off', 'false', 'no', '0', 'disabled'].includes(v)) return false;
  }
  throw new FeatureConfigError(
    `${where}: expected on/off, got ${JSON.stringify(value)}`,
  );
}

function readYamlFile(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new FeatureConfigError(`cannot read ${label} at ${file} (${err.code})`);
  }
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    throw new FeatureConfigError(`${label} is not valid YAML: ${err.message}`);
  }
  if (doc == null) return {};
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new FeatureConfigError(`${label} must be a YAML mapping, got ${Array.isArray(doc) ? 'a list' : typeof doc}`);
  }
  return doc;
}

/**
 * Validate one layer document and reduce it to {profile, features}, or null
 * when it contributes nothing.
 *
 * Unknown feature ids are an error, not a warning: a typo that silently does
 * nothing is the worst outcome for a config whose whole job is to be obeyed.
 *
 * A file that EXISTS but states no opinion — the shipped config/features.yaml
 * is entirely comments — returns null rather than an empty layer, so it does
 * not appear in `layers`. "layers applied" has to mean "layers that decided
 * something"; listing a file that changed nothing sends whoever is debugging a
 * feature to read the wrong file.
 */
function parseLayer(doc, label) {
  if (doc == null) return null;
  const out = { profile: null, features: {}, run: null, agents: null };

  for (const key of Object.keys(doc)) {
    if (LAYER_KEYS.includes(key)) continue;
    if (key.startsWith('_') || key === '$schema') continue;
    throw new FeatureConfigError(
      `${label}: unknown top-level key '${key}' (expected one of ${LAYER_KEYS.join(', ')})`,
    );
  }

  if (doc.profile != null) {
    if (typeof doc.profile !== 'string') {
      throw new FeatureConfigError(`${label}: 'profile' must be a string`);
    }
    out.profile = doc.profile.trim();
  }

  if (doc.features != null) {
    if (typeof doc.features !== 'object' || Array.isArray(doc.features)) {
      throw new FeatureConfigError(`${label}: 'features' must be a mapping of id -> on/off`);
    }
    for (const [id, value] of Object.entries(doc.features)) {
      if (!FEATURES[id]) {
        throw new FeatureConfigError(
          `${label}: unknown feature '${id}'. Known features: ${FEATURE_IDS.join(', ')}`,
        );
      }
      out.features[id] = toBool(value, `${label}: features.${id}`);
    }
  }

  if (doc.run != null) {
    const run = typeof doc.run === 'string' ? doc.run.trim() : doc.run;
    if (!RUN_MODES.includes(run)) {
      throw new FeatureConfigError(
        `${label}: 'run' must be one of ${RUN_MODES.join(', ')}, got ${JSON.stringify(doc.run)}`,
      );
    }
    out.run = run;
  }

  if (doc.agents != null) {
    if (!Array.isArray(doc.agents) || doc.agents.some((a) => typeof a !== 'string' || !a.trim())) {
      throw new FeatureConfigError(`${label}: 'agents' must be a list of agent names`);
    }
    // Checked against config/agents/ in loadFeatures, which knows the repo.
    out.agents = [...new Set(doc.agents.map((a) => a.trim()))];
  }

  // Validated, but inert. Note the ORDER: validation ran first, so a typo in an
  // otherwise-empty file is still a loud error rather than being skipped along
  // with the file.
  if (!out.profile && Object.keys(out.features).length === 0 && !out.run && !out.agents) return null;

  return out;
}

/** Read the env layer. Absent vars contribute nothing. */
function parseEnvLayer(env) {
  const features = {};
  for (const id of FEATURE_IDS) {
    const name = envVarFor(id);
    const raw = env[name];
    if (raw == null || raw === '') continue;
    features[id] = toBool(raw, `env ${name}`);
  }
  const profileRaw = env.CODING_FEATURE_PROFILE;
  const profile = profileRaw && profileRaw.trim() ? profileRaw.trim() : null;
  if (!profile && Object.keys(features).length === 0) return null;
  return { profile, features };
}

// ── profiles ─────────────────────────────────────────────────────────────────

/**
 * Built-in profiles. Shipped in code as well as in
 * config/feature-profiles.yaml so a repo with a missing or trimmed profiles
 * file still resolves `full` — the default — rather than failing to launch.
 *
 * The four install tiers (harness → learning → learning-perf → everything) are
 * what the installer offers. `full` is the DEVELOPER profile: everything plus
 * `lsl-redirect`, which files toolchain turns into the tools repo and is wrong
 * for anyone not developing the toolchain. `minimal` is the empty baseline the
 * comma-separated `--features=a,b` form builds on.
 */
const HARNESS = { 'llm-proxy': true, health: true, statusline: true };
const LEARNING = { ...HARNESS, lsl: true, observations: true, knowledge: true, teams: true };
const LEARNING_PERF = { ...LEARNING, performance: true };
const EVERYTHING = { ...LEARNING_PERF, constraints: true, codegraph: true, cluster: true };
const BUILTIN_PROFILES = {
  full: defaultFeatures(),
  harness: HARNESS,
  learning: LEARNING,
  'learning-perf': LEARNING_PERF,
  everything: EVERYTHING,
  minimal: { statusline: true },
};

/**
 * Retired profile names, kept resolvable so an existing features.yaml or CI
 * job naming one keeps working. An alias takes its target's feature set; it is
 * never listed as a choice (`profileAliases()` is how listers hide them).
 */
const BUILTIN_ALIASES = {
  km: 'learning',
  'km-perf': 'learning-perf',
  'proxy-only': 'harness',
  'logging-only': 'learning',
};

/** Read the YAML's `alias:` entries on top of the built-in ones. */
function profileAliases(profilesPath) {
  const doc = readYamlFile(profilesPath, 'feature-profiles.yaml');
  const aliases = { ...BUILTIN_ALIASES };
  const declared = doc && doc.profiles;
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    for (const [name, spec] of Object.entries(declared)) {
      if (spec && typeof spec === 'object' && typeof spec.alias === 'string') {
        aliases[name] = spec.alias.trim();
      } else {
        delete aliases[name];
      }
    }
  }
  return aliases;
}

/**
 * Every resolvable profile name -> its feature set, aliases included (an alias
 * maps to its target's set). Listers that offer a CHOICE filter out
 * `profileAliases()`.
 */
function loadProfiles(profilesPath) {
  const doc = readYamlFile(profilesPath, 'feature-profiles.yaml');
  const profiles = { ...BUILTIN_PROFILES };

  const declared = doc ? doc.profiles : null;
  if (declared != null) {
    if (typeof declared !== 'object' || Array.isArray(declared)) {
      throw new FeatureConfigError("feature-profiles.yaml: 'profiles' must be a mapping");
    }
    for (const [name, spec] of Object.entries(declared)) {
      if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new FeatureConfigError(`feature-profiles.yaml: profile '${name}' must be a mapping`);
      }
      if (spec.alias != null) {
        if (typeof spec.alias !== 'string') {
          throw new FeatureConfigError(`feature-profiles.yaml: profile '${name}'.alias must be a string`);
        }
        continue;
      }
      const set = {};
      const features = spec.features != null ? spec.features : spec;
      for (const [id, value] of Object.entries(features)) {
        if (id === 'description') continue;
        if (!FEATURES[id]) {
          throw new FeatureConfigError(
            `feature-profiles.yaml: profile '${name}' names unknown feature '${id}'`,
          );
        }
        set[id] = toBool(value, `feature-profiles.yaml: ${name}.${id}`);
      }
      profiles[name] = set;
    }
  }

  // Aliases resolve one hop, to a real profile. A chain would make "what does
  // km mean" depend on reading several entries; refusing it keeps one answer.
  const aliases = profileAliases(profilesPath);
  for (const [alias, target] of Object.entries(aliases)) {
    if (!profiles[target] || Object.prototype.hasOwnProperty.call(aliases, target)) {
      throw new FeatureConfigError(
        `feature-profiles.yaml: alias '${alias}' points at '${target}', which is not a profile`,
      );
    }
    profiles[alias] = profiles[target];
  }
  return profiles;
}

/**
 * A profile names what is ON; everything it omits is OFF. Stating only the
 * positives is what makes a profile readable ("proxy-only: llm-proxy,
 * statusline") — the alternative is nine lines of `off` per preset, where a
 * newly added feature would silently default to on in every profile.
 */
function expandProfile(name, profiles) {
  const set = profiles[name];
  if (!set) {
    throw new FeatureConfigError(
      `unknown profile '${name}'. Known profiles: ${Object.keys(profiles).sort().join(', ')}`,
    );
  }
  const out = {};
  for (const id of FEATURE_IDS) out[id] = set[id] === true;
  return out;
}

// ── dependency closure ───────────────────────────────────────────────────────

/**
 * Turn off anything whose dependency is off, transitively, and record why.
 *
 * Iterates to a fixpoint rather than assuming a topological order, so the
 * catalogue can grow a longer chain without this needing to know about it.
 * Dependencies are never auto-enabled: switching `lsl` back on because
 * `observations` is on would undo an explicit choice, which is the one
 * behaviour the user ruled out.
 */
function applyDependencies(enabled, reasons) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of FEATURE_IDS) {
      if (!enabled[id]) continue;
      for (const dep of FEATURES[id].requires) {
        if (enabled[dep]) continue;
        enabled[id] = false;
        reasons[id] = {
          source: 'dependency',
          reason: `off — requires '${dep}' (${FEATURES[dep].label}), which is off`,
        };
        changed = true;
        break;
      }
    }
  }
}

// ── cache ────────────────────────────────────────────────────────────────────

let _cached = null;
let _cachedStamp = null;

function mtimeOrAbsent(file) {
  try {
    return String(fs.statSync(file).mtimeMs);
  } catch {
    return 'absent';
  }
}

function stampOf(paths, env) {
  const envPart = FEATURE_IDS
    .map((id) => `${id}=${env[envVarFor(id)] ?? ''}`)
    .concat(`profile=${env.CODING_FEATURE_PROFILE ?? ''}`)
    .join(',');
  return [
    mtimeOrAbsent(paths.repo),
    mtimeOrAbsent(paths.home),
    mtimeOrAbsent(paths.profiles),
    envPart,
  ].join('|');
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the active feature set.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.force]  Bypass the mtime cache.
 * @param {string}  [opts.repoPath]
 * @param {string}  [opts.homeDir]
 * @param {Object}  [opts.env]    Defaults to process.env.
 * @returns {{
 *   profile: string|null,
 *   features: Record<string, {enabled: boolean, reason: string, source: string, label: string, description: string, requires: string[], applyTier: string, needsDocker: boolean}>,
 *   enabled: string[],
 *   disabled: string[],
 *   needsDocker: boolean,
 *   warnings: string[],
 *   paths: {repo: string, home: string, profiles: string},
 *   layers: string[]
 * }}
 * @throws {FeatureConfigError} on malformed or contradictory configuration.
 */
function loadFeatures(opts = {}) {
  const env = opts.env || process.env;
  const paths = configPaths(opts);
  const stamp = stampOf(paths, env);

  const cacheable = !opts.repoPath && !opts.homeDir && !opts.repoConfigPath
    && !opts.homeConfigPath && !opts.profilesPath && !opts.env;
  if (!opts.force && cacheable && _cached && _cachedStamp === stamp) return _cached;

  const profiles = loadProfiles(paths.profiles);
  const aliases = profileAliases(paths.profiles);

  const layerDocs = [
    { name: 'config/features.yaml', layer: parseLayer(readYamlFile(paths.repo, 'config/features.yaml'), 'config/features.yaml') },
    { name: '~/.coding/features.yaml', layer: parseLayer(readYamlFile(paths.home, '~/.coding/features.yaml'), '~/.coding/features.yaml') },
    { name: 'env', layer: parseEnvLayer(env) },
  ];

  const enabled = defaultFeatures();
  /** @type {Record<string, {source: string, reason: string}>} */
  const reasons = {};
  for (const id of FEATURE_IDS) {
    reasons[id] = { source: 'default', reason: 'on — default (no configuration found)' };
  }

  let activeProfile = null;
  const layersApplied = [];
  let run = { value: 'auto', source: 'default' };
  let agents = null; // { value: string[], source }

  for (const { name, layer } of layerDocs) {
    if (!layer) continue;
    layersApplied.push(name);

    if (layer.profile) {
      activeProfile = layer.profile;
      const expanded = expandProfile(layer.profile, profiles);
      const target = aliases[layer.profile];
      const label = target ? `'${layer.profile}' (alias of '${target}')` : `'${layer.profile}'`;
      for (const id of FEATURE_IDS) {
        enabled[id] = expanded[id];
        reasons[id] = {
          source: name,
          reason: `${expanded[id] ? 'on' : 'off'} — profile ${label} (${name})`,
        };
      }
    }

    for (const [id, value] of Object.entries(layer.features)) {
      enabled[id] = value;
      reasons[id] = {
        source: name,
        reason: `${value ? 'on' : 'off'} — set explicitly in ${name}`,
      };
    }

    if (layer.run) run = { value: layer.run, source: name };
    if (layer.agents) agents = { value: layer.agents, source: name };
  }

  applyDependencies(enabled, reasons);

  const warnings = [];
  for (const id of FEATURE_IDS) {
    if (reasons[id].source === 'dependency') {
      warnings.push(`feature '${id}' auto-disabled: ${reasons[id].reason}`);
    }
  }
  if (!enabled.health) {
    warnings.push(
      "feature 'health' is off — the dashboard is unavailable, so features are "
      + 'configurable only via ~/.coding/features.yaml or `coding-features`.',
    );
  }

  const features = {};
  for (const id of FEATURE_IDS) {
    const def = FEATURES[id];
    features[id] = {
      enabled: enabled[id],
      reason: reasons[id].reason,
      source: reasons[id].source,
      label: def.label,
      description: def.description,
      requires: def.requires,
      applyTier: def.applyTier,
      needsDocker: def.needsDocker,
    };
  }

  // ── settings ──
  const repo = opts.repoPath || repoRoot();
  const available = availableAgents(repo);
  if (agents) {
    const unknown = agents.value.filter((a) => !available.includes(a));
    if (unknown.length) {
      throw new FeatureConfigError(
        `${agents.source}: unknown agent${unknown.length > 1 ? 's' : ''} ${unknown.map((a) => `'${a}'`).join(', ')}. `
        + `Known agents (config/agents/*.sh): ${available.join(', ')}`,
      );
    }
    if (!agents.value.length) {
      throw new FeatureConfigError(`${agents.source}: 'agents' lists no agent — at least one must be enabled`);
    }
  }
  const agentsEnabled = agents ? available.filter((a) => agents.value.includes(a)) : available;
  const runResolved = resolveRun(run.value, run.source === 'default' ? 'default' : run.source, enabled.constraints);
  const settings = {
    run: {
      value: run.value,
      effective: runResolved.effective,
      source: run.source,
      reason: runResolved.reason,
      choices: RUN_MODES,
      boxAgents: BOX_AGENTS,
      applyTier: 'session',
    },
    agents: {
      enabled: agentsEnabled,
      available,
      source: agents ? agents.source : 'default',
      reason: agents ? `set in ${agents.source}` : 'all agents — default (no configuration found)',
      // What plain `coding` launches: claude while it is enabled, else the
      // first enabled agent. Chosen by configuration, never by what happens
      // to be installed.
      default: agentsEnabled.includes(DEFAULT_AGENT) ? DEFAULT_AGENT : (agentsEnabled[0] || null),
      applyTier: 'session',
    },
  };
  if (run.value !== 'auto' && runResolved.effective !== run.value) {
    warnings.push(`run mode '${run.value}' falls back to host: ${runResolved.reason}`);
  }

  const result = {
    profile: activeProfile,
    features,
    enabled: FEATURE_IDS.filter((id) => enabled[id]),
    disabled: FEATURE_IDS.filter((id) => !enabled[id]),
    // Whether anything still requires the coding-services container. This is
    // what lets a proxy-only or logging-only install skip Docker entirely
    // instead of failing on a machine that does not have it.
    needsDocker: FEATURE_IDS.some((id) => enabled[id] && FEATURES[id].needsDocker),
    settings,
    warnings,
    paths,
    layers: layersApplied,
    generatedAt: new Date().toISOString(),
  };

  if (cacheable) {
    _cached = result;
    _cachedStamp = stamp;
  }
  return result;
}

/**
 * Is one feature on? The hot path — status line, CLIs, hook builder.
 *
 * Never throws: a broken config must not take out a status-line render or a
 * shell gate. It resolves closed (returns false) and leaves the loud failure to
 * `loadFeatures()`, which the CLI and the services starter call directly.
 */
function isEnabled(id, opts = {}) {
  try {
    const resolved = loadFeatures(opts);
    return resolved.features[id]?.enabled === true;
  } catch {
    return false;
  }
}

/** Human-readable explanation of a feature's current state. */
function explain(id, opts = {}) {
  const resolved = loadFeatures(opts);
  const f = resolved.features[id];
  if (!f) {
    throw new FeatureConfigError(
      `unknown feature '${id}'. Known features: ${FEATURE_IDS.join(', ')}`,
    );
  }
  return f.reason;
}

/** Drop the cache. Called by the write API after a validated save, and by tests. */
function invalidateFeatures() {
  _cached = null;
  _cachedStamp = null;
}

module.exports = {
  FeatureConfigError,
  loadFeatures,
  isEnabled,
  explain,
  invalidateFeatures,
  configPaths,
  loadProfiles,
  profileAliases,
  FEATURES,
  FEATURE_IDS,
  envVarFor,
  RUN_MODES,
  BOX_AGENTS,
  DEFAULT_AGENT,
  availableAgents,
};
