/**
 * Claude Code sub-agent transcript paths — the pure, dependency-free part of the
 * Claude adapter. Split out of claude-jsonl-tree.mjs so the token adapters can
 * reuse the linkage without importing the LSL conversion pipeline.
 *
 * Pure ESM (no build step). No imports.
 */

/**
 * Matches a Claude sub-agent transcript path:
 *   .../.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl
 *
 * Either separator matches. The encoded-cwd starts with '-' on POSIX
 * ('/Users/you' → '-Users-you') and with a drive letter on Windows
 * ('C:\Users\you' → 'C--Users-you').
 *
 * Capture groups:
 *   $1 — encoded-cwd (e.g. '-Users-you-Agentic-coding')
 *   $2 — parent session UUID (36-char canonical UUID format)
 *   $3 — agent hex id (lowercase hex)
 */
export const SUBAGENT_PATH_RE = /[\\/]\.claude[\\/]projects[\\/](-[^\\/]+|[A-Za-z]--[^\\/]*)[\\/]([0-9a-f-]{36})[\\/]subagents[\\/]agent-([a-f0-9]+)\.jsonl$/;

/**
 * Parent session UUID from a sub-agent transcript path. Null if no match.
 */
export function parentSessionFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(SUBAGENT_PATH_RE);
  return m ? m[2] : null;
}

/**
 * Full 17-char agent hex id from a transcript path. Null if no match.
 */
export function agentIdFromClaudeSubagentPath(transcriptPath) {
  const m = transcriptPath.match(SUBAGENT_PATH_RE);
  return m ? m[3] : null;
}
