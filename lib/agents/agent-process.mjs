/**
 * Which process command lines are a live coding agent.
 *
 * The health coordinator walks each tmux pane's process tree with this to tell a
 * live session from a husk (scripts/health-coordinator.js, paneHasLiveAgent).
 *
 * Two shapes count:
 *
 *   • The agent itself — `claude …`, `opencode`, `pi`, `copilot`. The trailing
 *     `(\s|$)` keeps the launcher script out: `.../scripts/claude-mcp-launcher.sh`
 *     contains `/claude`, but followed by `-`.
 *
 *   • The agent box launcher — `node …/scripts/agent-box.mjs run <agent> …`. A
 *     boxed agent runs inside Docker, so no host process in the pane is ever named
 *     `claude`: the pane holds this launcher and its `docker run` child, and the
 *     launcher lives exactly as long as the box. Without this shape every boxed
 *     session read as a husk, and the reaper stopped its LSL monitor five seconds
 *     after each spawn — a permanently red [LSL] badge for every boxed session.
 */
const AGENTS = '(claude|opencode|pi|copilot)';

export const AGENT_PROCESS_RE = new RegExp(`(^|/)${AGENTS}(\\s|$)`);
export const BOX_LAUNCHER_RE = new RegExp(`(^|/)agent-box\\.mjs\\s+run\\s+${AGENTS}(\\s|$)`);

export function isAgentProcess(cmd) {
  return typeof cmd === 'string' && (AGENT_PROCESS_RE.test(cmd) || BOX_LAUNCHER_RE.test(cmd));
}
