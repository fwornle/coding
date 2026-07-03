// lib/experiments/agent-headless.mjs
//
// Phase 78, Plan 78-02 (Wave 1) — RUN-02 / RUN-04: the thin per-agent headless adapter.
//
// This is a PURE transform/utility module — no orchestration. The runner engine (78-03)
// imports it. It encodes the confirmed non-interactive one-shot invocation for each agent
// as a FIXED-ARGV ARRAY, resolves each agent's launch binary from the config/agents/*.sh
// registry, and offers a trivial one-turn Copilot drivability probe:
//
//   argvForAgent(agentName, goal, {model})   → string[]   fixed argv for a headless turn (D-01)
//   resolveAgentBinary(agentName, agentsDir) → string     launch binary (AGENT_COMMAND registry)
//   probeCopilotHeadless({ spawn })          → boolean     one-turn copilot capability check (D-07)
//
// DECISIONS:
//   D-01: thin per-agent headless adapter OVER the config/agents/*.sh registry — the .sh
//         files are INTERACTIVE tmux launchers (RESEARCH Risk R1); we reuse them ONLY as
//         the agent→binary registry (the AGENT_COMMAND line), then spawn each binary
//         DIRECTLY with its documented non-interactive flag. We do NOT use
//         AgentRegistry.getAdapter(...) (interactive MCP/HTTP shims) and NOT bin/claude-mcp
//         for claude (that boots an interactive MCP session) — claude uses the `claude`
//         binary + `-p`.
//   D-02: claude `--permission-mode acceptEdits` and copilot `--allow-all-tools` grant
//         autonomous edits. This is acceptable ONLY because 78-03 spawns each agent with
//         cwd = a THROWAWAY sandbox worktree (T-78-02-02). This module only EMITS the flag;
//         it never chooses cwd.
//   D-07: the minimal one-turn Copilot drivability probe — a trivial one-turn check, NOT a
//         full drive, fail-soft, injectable spawn seam. Caching is the runner's job.
//
// SECURITY:
//   • T-78-02-01 (command injection): argvForAgent returns a fixed-argv ARRAY (goal/model
//     are single elements) — NEVER a shell string; the child_process `shell` option is
//     never set anywhere in this module.
//   • T-78-02-03 (probe DoS): probeCopilotHeadless uses a short bounded timeout and is
//     fail-soft on res.error — a hung probe returns false, it never blocks the matrix.
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';

// Agent name → config/agents/<file>.sh (the registry file whose AGENT_COMMAND we read).
const AGENT_CONFIG_FILE = Object.freeze({
  claude: 'claude.sh',
  opencode: 'opencode.sh',
  mastracode: 'mastra.sh',
  copilot: 'copilot.sh',
});

// Headless binary overrides. claude's registry AGENT_COMMAND points at the INTERACTIVE
// bin/claude-mcp wrapper (boots an MCP session); the -p headless path needs the raw
// `claude` binary instead (D-01). Other agents use their registry binary verbatim.
const HEADLESS_BINARY_OVERRIDE = Object.freeze({
  claude: 'claude',
});

/**
 * Re-exposed AGENT_COMMAND parse (module-private analog of lib/agent-detector.js:23-39's
 * parseAgentConfig — we do NOT import that private symbol). Reads the shell registry file
 * and extracts the AGENT_COMMAND value with the same ~10-line regex.
 * @param {string} configPath
 * @returns {string|null}
 */
function parseAgentCommand(configPath) {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const m = content.match(/^AGENT_COMMAND="?([^"\n]+)"?/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Emit the confirmed fixed-argv headless invocation for `agentName` against `goal`.
 * Always returns an ARRAY OF STRINGS — the goal is a single element (no shell splitting),
 * so a goal containing spaces/quotes cannot inject additional arguments (T-78-02-01).
 * Per-agent permission flags are encoded exactly (D-02): claude `--permission-mode
 * acceptEdits`, copilot `--allow-all-tools` (both required for autonomous headless edits).
 * @param {string} agentName  one of claude | opencode | mastracode | copilot
 * @param {string} goal       the spec-validated goal sentence
 * @param {{model?: string}} [opts]
 * @returns {string[]}
 */
export function argvForAgent(agentName, goal, { model } = {}) {
  switch (agentName) {
    case 'claude':
      // headless edits REQUIRE --permission-mode acceptEdits (Pitfall 6)
      return ['-p', goal, '--model', model, '--permission-mode', 'acceptEdits'];
    case 'opencode':
      return ['run', goal, '-m', model];
    case 'mastracode':
      // NO --dir; cwd is set via the spawn cwd option by the caller (78-03)
      return ['--prompt', goal, '-m', model];
    case 'copilot':
      // --allow-all-tools REQUIRED for non-interactive
      return ['-p', goal, '--allow-all-tools', '--model', model];
    default:
      throw new Error(`argvForAgent: unknown agent '${agentName}'`);
  }
}

/**
 * Resolve the launch binary for `agentName` from the config/agents/*.sh registry, applying
 * the headless override table (claude → `claude`, NOT the interactive bin/claude-mcp).
 * @param {string} agentName
 * @param {string} agentsDir  path to config/agents/
 * @returns {string}
 */
export function resolveAgentBinary(agentName, agentsDir) {
  const file = AGENT_CONFIG_FILE[agentName];
  if (!file) throw new Error(`resolveAgentBinary: unknown agent '${agentName}'`);
  const registryBinary = parseAgentCommand(path.join(agentsDir, file));
  // headless override wins over the (possibly interactive) registry binary
  return HEADLESS_BINARY_OVERRIDE[agentName] ?? registryBinary;
}
