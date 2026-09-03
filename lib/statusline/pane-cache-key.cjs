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
 * The key has three components, each earning its place:
 *   project — panes on different projects render different lines.
 *   agent   — the line carries a per-agent context gauge, so a claude pane and
 *             an opencode pane on one project must not share an entry.
 *   width   — cache content is per-render, and a wider pane's render leaking
 *             into a narrow pane is what the width suffix originally fixed.
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

  const suffix = projectName
    ? `-${projectName}${agent ? `-${agent}` : ''}${paneWidth ? `-w${paneWidth}` : ''}`
    : '';

  return { projectPath, projectName, agent, paneWidth, suffix };
}

module.exports = { paneIdentity };
