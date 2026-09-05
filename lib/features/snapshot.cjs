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

module.exports = { writeSnapshot, readSnapshot };
