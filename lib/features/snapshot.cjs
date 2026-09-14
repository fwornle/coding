'use strict';

/**
 * Write the derived feature snapshot to <repo>/.coding/runtime/features.json.
 *
 * WHY A SNAPSHOT. The resolver is Node. Three consumers are not: the shell
 * launchers (`scripts/launch-agent-common.sh`), the container entrypoint
 * (`docker/entrypoint.sh`, which cannot see ~/.coding at all) and graphify's
 * Python. Re-implementing four-layer YAML precedence in each of them is how
 * gates end up disagreeing. Instead every non-Node consumer reads one flat JSON
 * that the resolver produced.
 *
 * Written on every launch (alongside .coding/runtime/claude-settings.json) and
 * on every apply, so it can never be staler than the last thing that acted on
 * the config.
 */

const fs = require('node:fs');
const path = require('node:path');

const { loadFeatures } = require('./resolve.cjs');

/**
 * @param {Object} [opts]
 * @param {string} [opts.repoPath]
 * @returns {{path: string, snapshot: Object, changed: boolean}}
 */
function writeSnapshot(opts = {}) {
  const repo = opts.repoPath || process.env.CODING_REPO || path.resolve(__dirname, '..', '..');
  const resolved = loadFeatures(opts);

  // Flat and boring on purpose: `jq -r '.features.lsl'` and a grep both work.
  const snapshot = {
    _comment: 'DERIVED — do not edit. Regenerated on every launch and apply. Source: config/features.yaml, ~/.coding/features.yaml, CODING_FEATURE_* env.',
    generatedAt: resolved.generatedAt,
    profile: resolved.profile,
    features: Object.fromEntries(
      Object.entries(resolved.features).map(([id, f]) => [id, f.enabled]),
    ),
    enabled: resolved.enabled,
    disabled: resolved.disabled,
    needsDocker: resolved.needsDocker,
    reasons: Object.fromEntries(
      Object.entries(resolved.features).map(([id, f]) => [id, f.reason]),
    ),
    warnings: resolved.warnings,
  };

  const outDir = path.join(repo, '.coding', 'runtime');
  const outFile = path.join(outDir, 'features.json');
  const next = `${JSON.stringify(snapshot, null, 2)}\n`;

  let current = null;
  try {
    current = fs.readFileSync(outFile, 'utf8');
  } catch { /* absent */ }

  // Compare ignoring generatedAt, so a launch that changed nothing does not
  // churn the file (and the mtime it carries) on every single start.
  const changed = current === null || stripTimestamp(current) !== stripTimestamp(next);
  if (changed) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, next);
  }

  return { path: outFile, snapshot, changed };
}

function stripTimestamp(json) {
  return json.replace(/"generatedAt": "[^"]*",?\n/, '');
}

/**
 * Read the snapshot without resolving. For Node callers inside the container,
 * where ~/.coding is not mounted and the snapshot is the only truth available.
 * Returns null when absent — the caller decides whether that means all-on.
 */
function readSnapshot(opts = {}) {
  const repo = opts.repoPath || process.env.CODING_REPO || path.resolve(__dirname, '..', '..');
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, '.coding', 'runtime', 'features.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Is the on-disk snapshot still what the config resolves to?
 *
 * WHY THIS EXISTS. The header above promises the snapshot "can never be staler
 * than the last thing that acted on the config". That holds only while every
 * config change goes through a launch or an apply. Edit ~/.coding/features.yaml
 * by hand, or launch once with CODING_FEATURE_* set and once without, and the
 * promise quietly breaks: the file keeps yesterday's answer and the container
 * keeps acting on it.
 *
 * That failure is silent by construction. The container cannot resolve, so it
 * cannot notice it disagrees with anyone; it just disables programs and the
 * only trace is whatever ECONNREFUSED loop the missing service provokes in a
 * log nobody is reading. A snapshot that says logging-only against a config
 * that says all-on looks, from inside, exactly like a correct logging-only run.
 *
 * Compares the `features` map only — that is the sole field any consumer acts
 * on. Profile and reasons are presentation, and a snapshot rewritten with an
 * identical feature set but a differently-spelled reason is not stale.
 *
 * FAILS OPEN in both directions that matter. An unresolvable config reports
 * 'unknown', never 'stale': a YAML typo must not also manufacture a drift
 * warning pointing at the wrong thing. An absent snapshot reports 'missing',
 * which is the pre-first-launch state, not a fault.
 *
 * Does NOT cover the sibling case — a container still running on an older
 * snapshot than the one now on disk. Detecting that needs to ask Docker when
 * the container started, which does not belong in a module three non-Node
 * consumers read. `scripts/apply-features.mjs` is what reconciles it.
 *
 * @param {Object} [opts]
 * @param {string} [opts.repoPath]
 * @returns {{state: 'fresh'|'stale'|'missing'|'unknown', generatedAt: string|null,
 *            differences: Array<{id: string, snapshot: boolean, live: boolean}>,
 *            error: string|null, remedy: string|null}}
 */
function checkSnapshot(opts = {}) {
  const base = { state: 'fresh', generatedAt: null, differences: [], error: null, remedy: null };
  const remedy = 'regenerate with `coding-features apply` (or any launch), then restart the container';

  const snapshot = readSnapshot(opts);
  if (!snapshot) {
    return { ...base, state: 'missing', remedy };
  }
  base.generatedAt = snapshot.generatedAt || null;

  let resolved;
  try {
    // force: the cache keys on config mtimes, and this check exists precisely
    // for the case where something changed under a long-lived process.
    resolved = loadFeatures({ ...opts, force: true });
  } catch (err) {
    return { ...base, state: 'unknown', error: err.message };
  }

  const snapFeatures = snapshot.features || {};
  const differences = [];
  for (const [id, f] of Object.entries(resolved.features)) {
    const live = f.enabled;
    const snap = snapFeatures[id];
    // A feature absent from the snapshot is drift too — it means the snapshot
    // predates the feature existing, and the container has no opinion to act on.
    if (snap !== live) differences.push({ id, snapshot: snap ?? null, live });
  }

  if (differences.length) {
    return { ...base, state: 'stale', differences, remedy };
  }
  return base;
}

module.exports = { writeSnapshot, readSnapshot, checkSnapshot };
