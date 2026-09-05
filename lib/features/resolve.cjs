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
const yaml = require('js-yaml');

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
 * Validate one layer document and reduce it to {profile, features}.
 * Unknown feature ids are an error, not a warning: a typo that silently does
 * nothing is the worst outcome for a config whose whole job is to be obeyed.
 */
function parseLayer(doc, label) {
  if (doc == null) return null;
  const out = { profile: null, features: {} };

  for (const key of Object.keys(doc)) {
    if (key === 'profile' || key === 'features') continue;
    if (key.startsWith('_') || key === '$schema') continue;
    throw new FeatureConfigError(
      `${label}: unknown top-level key '${key}' (expected 'profile' and/or 'features')`,
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
 */
const BUILTIN_PROFILES = {
  full: defaultFeatures(),
  'proxy-only': { 'llm-proxy': true, statusline: true },
  'logging-only': { lsl: true, statusline: true, health: true },
  minimal: { statusline: true },
};

function loadProfiles(profilesPath) {
  const doc = readYamlFile(profilesPath, 'feature-profiles.yaml');
  const profiles = { ...BUILTIN_PROFILES };
  if (!doc) return profiles;

  const declared = doc.profiles;
  if (declared == null) return profiles;
  if (typeof declared !== 'object' || Array.isArray(declared)) {
    throw new FeatureConfigError("feature-profiles.yaml: 'profiles' must be a mapping");
  }

  for (const [name, spec] of Object.entries(declared)) {
    if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new FeatureConfigError(`feature-profiles.yaml: profile '${name}' must be a mapping`);
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

  for (const { name, layer } of layerDocs) {
    if (!layer) continue;
    layersApplied.push(name);

    if (layer.profile) {
      activeProfile = layer.profile;
      const expanded = expandProfile(layer.profile, profiles);
      for (const id of FEATURE_IDS) {
        enabled[id] = expanded[id];
        reasons[id] = {
          source: name,
          reason: `${expanded[id] ? 'on' : 'off'} — profile '${layer.profile}' (${name})`,
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

  const result = {
    profile: activeProfile,
    features,
    enabled: FEATURE_IDS.filter((id) => enabled[id]),
    disabled: FEATURE_IDS.filter((id) => !enabled[id]),
    // Whether anything still requires the coding-services container. This is
    // what lets a proxy-only or logging-only install skip Docker entirely
    // instead of failing on a machine that does not have it.
    needsDocker: FEATURE_IDS.some((id) => enabled[id] && FEATURES[id].needsDocker),
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
  FEATURES,
  FEATURE_IDS,
  envVarFor,
};
