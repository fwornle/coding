'use strict';
/**
 * Is the status line switched on?
 *
 * The `statusline` feature is declared in lib/features/catalogue.cjs with
 * applyTier 'live', which promises the toggle takes effect on the next render
 * with no relaunch. Four programs render a status line — the full renderer, the
 * two tmux fast paths, and the Claude Code shim — so the check lives here once
 * rather than four times.
 *
 * CommonJS because two of those four are CJS and the other two can require it.
 *
 * FAIL-OPEN, deliberately. If the resolver throws — an unreadable config, a
 * moved repo, a partially-installed checkout — this answers "on" and the line
 * renders. That is the documented asymmetry: anything that STARTS a process
 * fails closed, anything that DISPLAYS fails open, because a surface that
 * silently blanks itself is indistinguishable from an outage and sends the
 * reader hunting for one. The user who actually turned it off will have a
 * readable config, so the honest answer and the safe answer agree.
 */

const path = require('node:path');

/**
 * @param {object} [env=process.env] environment to resolve against
 * @returns {boolean} false only when the resolver says so unambiguously
 */
function statuslineEnabled(env = process.env) {
  try {
    const root = env.CODING_REPO || path.resolve(__dirname, '..', '..');
    // Required lazily and by path, for the same reason featureFingerprint does
    // it: this file is loaded by two runtimes and must stay usable standalone.
    // eslint-disable-next-line global-require
    const { loadFeatures } = require(path.join(root, 'lib', 'features', 'resolve.cjs'));
    // loadFeatures marks any call carrying explicit paths as uncacheable, so the
    // production path (env === process.env) must stay on the mtime-cached
    // branch — this runs on every tmux tick.
    const resolved = env === process.env
      ? loadFeatures()
      : loadFeatures({ repoPath: root, homeDir: env.CODING_HOME, env });
    return resolved.features.statusline.enabled !== false;
  } catch {
    return true;
  }
}

module.exports = { statuslineEnabled };
