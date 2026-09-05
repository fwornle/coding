'use strict';
/**
 * The status-line cache key, defined once.
 *
 * `scripts/combined-status-line.js` WRITES the per-pane render cache and
 * `scripts/status-line-fast.cjs` READS it on every tmux tick. They are only
 * useful to each other if they agree on the filename, and until this file
 * existed each built the suffix from its own copy of the rule. A silent
 * disagreement there does not error — the fast path simply never finds a cache,
 * so every 5s tick pays for a full CSL render instead of a file read, and the
 * only symptom is a status line that feels sluggish. That is precisely the kind
 * of drift the LIFECYCLE_ICONS "keep them in step" comment warns about, so this
 * one is shared rather than mirrored.
 *
 * CommonJS so the ESM renderer can default-import it and the CJS one can
 * require it.
 *
 * The key has four components, each earning its place:
 *   project  — panes on different projects render different lines.
 *   agent    — the line carries a per-agent context gauge, so a claude pane and
 *              an opencode pane on one project must not share an entry.
 *   width    — cache content is per-render, and a wider pane's render leaking
 *              into a narrow pane is what the width suffix originally fixed.
 *   features — which badges the line contains at all. Without it, switching a
 *              feature off leaves its badge on screen for up to the 30s cache
 *              lifetime, and the change reads as "the toggle did not work".
 *              The status line is the one surface documented as taking effect
 *              on the next read, so the key has to carry it.
 */

/**
 * @param {object} [env=process.env] environment to read pane identity from
 * @returns {{projectPath:string, projectName:string, agent:string, paneWidth:string, suffix:string}}
 *   `suffix` is '' when the project is unknown, which keeps the historical
 *   single shared cache file for panes that carry no pane identity at all
 *   (the global tmux status-right, outside any agent session).
 */
function paneIdentity(env = process.env) {
  // TRANSCRIPT_SOURCE_PROJECT first: it is the project the session was launched
  // FOR, which can differ from the pane's cwd when a session is redirected.
  const projectPath = env.TRANSCRIPT_SOURCE_PROJECT || env.TMUX_PANE_PATH || '';
  const projectName = projectPath ? projectPath.replace(/\/+$/, '').split('/').pop() || '' : '';
  const agent = env.CODING_AGENT || '';
  const paneWidth = env.TMUX_PANE_WIDTH || '';
  const features = featureFingerprint(env);

  const suffix = projectName
    ? `-${projectName}${agent ? `-${agent}` : ''}${paneWidth ? `-w${paneWidth}` : ''}${features ? `-f${features}` : ''}`
    : '';

  return { projectPath, projectName, agent, paneWidth, features, suffix };
}

/**
 * A short, stable fingerprint of the enabled feature set.
 *
 * Both the writer and the fast reader call this, so it must be cheap and must
 * never throw: a fingerprint failure has to degrade to "no fingerprint" — one
 * shared cache entry, i.e. exactly the historical behaviour — rather than take
 * out the status line.
 *
 * Empty string when every feature is on, so the default install keeps the
 * filenames it has always had.
 */
function featureFingerprint(env = process.env) {
  try {
    // Required lazily and by path so this file stays usable standalone (it is
    // imported by two different runtimes) and costs nothing when unused.
    const path = require('node:path');
    const root = env.CODING_REPO || path.resolve(__dirname, '..', '..');
    // eslint-disable-next-line global-require
    const { loadFeatures, FEATURE_IDS } = require(path.join(root, 'lib', 'features', 'resolve.cjs'));
    // Overrides are passed ONLY when the caller handed us an env that is not the
    // process's own. loadFeatures marks any call carrying explicit paths as
    // uncacheable, and this function runs on every status-line render — so the
    // production path (env === process.env) must stay on the cached branch,
    // while paneIdentity(customEnv) has to actually honour that env rather than
    // silently resolving against the process's.
    const resolved = env === process.env
      ? loadFeatures()
      : loadFeatures({ repoPath: root, homeDir: env.CODING_HOME, env });
    const bits = FEATURE_IDS.map((id) => (resolved.features[id].enabled ? '1' : '0')).join('');
    if (!bits.includes('0')) return '';
    // Base36 of the bitmask: 9 features fit in three characters.
    return parseInt(bits, 2).toString(36);
  } catch {
    return '';
  }
}

/**
 * The filename tail a pane may borrow another pane's cached render from.
 *
 * status-line-fast.cjs serves a cold key by adopting a fresh sibling cache and
 * re-underlining it for this project. That is only sound across the components
 * the borrow can fix up — project and agent — and never across the ones it
 * cannot: pane width (a line sized for a wider pane renders as "shifted left
 * plus leftover characters") and the feature fingerprint (a line carrying
 * badges for features this pane has switched off).
 *
 * So the tail is every key component AFTER the borrowable ones, in the order
 * paneIdentity() emits them. It lives beside the key builder because it is the
 * same rule read backwards, and the two silently disagreeing is exactly the
 * drift this file exists to prevent — the width half of it was correct while
 * the feature half was missing, which made `-w220.txt` match no `-w220-f7.txt`
 * sibling at all and disabled borrowing outright on any pared-down install.
 *
 * @param {{paneWidth?: string, features?: string}} [parts={}]
 * @returns {string} suffix to test candidate filenames with `endsWith`
 */
function borrowTail({ paneWidth = '', features = '' } = {}) {
  return `${paneWidth ? `-w${paneWidth}` : ''}${features ? `-f${features}` : ''}.txt`;
}

module.exports = { paneIdentity, featureFingerprint, borrowTail };
