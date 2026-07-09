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
//         DIRECTLY with its documented non-interactive flag. We do NOT use the
//         AgentRegistry interactive-adapter lookup (interactive MCP/HTTP shims) and NOT
//         the interactive MCP launcher wrapper for claude (that boots an interactive MCP
//         session) — claude uses the `claude` binary + `-p`.
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
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

// Agent name → config/agents/<file>.sh (the registry file whose AGENT_COMMAND we read).
const AGENT_CONFIG_FILE = Object.freeze({
  claude: 'claude.sh',
  opencode: 'opencode.sh',
  mastracode: 'mastra.sh',
  copilot: 'copilot.sh',
});

// Headless binary overrides. claude's registry AGENT_COMMAND points at the INTERACTIVE
// MCP launcher wrapper (boots an MCP session); the -p headless path needs the raw
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
  // WR-03 (Phase 85 REVIEW): every branch below emits `--model <model>` / `-m <model>`. A
  // missing model would push `undefined` into the fixed argv, and child_process.spawn throws a
  // raw TypeError [ERR_INVALID_ARG_TYPE] on a non-string argv element — OUTSIDE the D-12
  // best-effort record path. Fail fast with a clear error instead (the throw is caught by the
  // runMatrix wrapper and recorded as a cell abort with a diagnosable reason).
  if (!model || typeof model !== 'string') {
    throw new Error(`argvForAgent: model required for ${agentName}`);
  }
  switch (agentName) {
    case 'claude':
      // headless edits REQUIRE --permission-mode acceptEdits (Pitfall 6)
      return ['-p', goal, '--model', model, '--permission-mode', 'acceptEdits'];
    case 'opencode':
      // --dangerously-skip-permissions is REQUIRED for non-interactive `run` (Pitfall 6, the
      // opencode analogue of claude's --permission-mode acceptEdits / copilot's --allow-all-tools).
      // Without it opencode `run` blocks on a tool-permission prompt it cannot answer headlessly and
      // hangs until the wall-clock SIGKILL (observed: 20-min timeout, 112 retry calls, Phase-78 fizzbuzz run).
      return ['run', goal, '-m', model, '--dangerously-skip-permissions'];
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
 * Canonical absolute opencode binary (85-06 A2). The host has TWO opencode builds:
 *   • ~/.opencode/bin/opencode   — the v1.15.x yargs build whose `run` accepts `-m <model>`
 *                                  and `--dangerously-skip-permissions` (argvForAgent's contract).
 *   • /opt/homebrew/bin/opencode — an OLDER Cobra build whose `run` has NO `-m` flag; it fails
 *                                  with `unknown shorthand flag: 'm' in -m` and aborts the cell.
 * The registry AGENT_COMMAND is the bare `opencode`, resolved by PATH — but the DETACHED runner
 * inherits the launchd coordinator's PATH, which finds the WRONG homebrew build first (an
 * interactive shell finds ~/.opencode/bin first, masking the bug). Pin the canonical absolute
 * path when it exists so the cell always runs the `-m`-capable build regardless of PATH order.
 * CLAUDE.md documents this host layout ("opencode resolves to ~/.opencode/bin/opencode").
 */
function resolveOpencodeBinary(registryBinary) {
  const canonical = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  try {
    fs.accessSync(canonical, fs.constants.X_OK);
    return canonical;
  } catch {
    // No canonical build — fall back to the registry/PATH binary (may be the homebrew one; the
    // runner.log + progress reason (A1) then makes the `-m` failure diagnosable rather than silent).
    return registryBinary;
  }
}

/**
 * Resolve the launch binary for `agentName` from the config/agents/*.sh registry, applying
 * the headless override table (claude → `claude`, NOT the interactive MCP wrapper) and the
 * opencode canonical-path pin (85-06 A2 — the PATH-ambiguous bare `opencode` resolves to a
 * `-m`-incapable build under the launchd runner).
 * @param {string} agentName
 * @param {string} agentsDir  path to config/agents/
 * @returns {string}
 */
export function resolveAgentBinary(agentName, agentsDir) {
  const file = AGENT_CONFIG_FILE[agentName];
  if (!file) throw new Error(`resolveAgentBinary: unknown agent '${agentName}'`);
  const registryBinary = parseAgentCommand(path.join(agentsDir, file));
  // headless override wins over the (possibly interactive) registry binary
  if (HEADLESS_BINARY_OVERRIDE[agentName]) return HEADLESS_BINARY_OVERRIDE[agentName];
  // opencode: pin the canonical `-m`-capable build (A2) — the bare `opencode` is PATH-ambiguous.
  if (agentName === 'opencode') return resolveOpencodeBinary(registryBinary);
  return registryBinary;
}

// The one-turn probe prompt — a trivial capability check (D-07), NOT a full drive.
const COPILOT_PROBE_PROMPT = 'Reply with the single word OK and nothing else.';
// Short bounded timeout so a hung probe returns false rather than blocking the matrix
// (T-78-02-03). 90s matches the RESEARCH Unknown-2 probe shape.
const COPILOT_PROBE_TIMEOUT_MS = 90_000;

/**
 * Trivial one-turn Copilot headless drivability probe (RUN-04, D-07). Runs a fixed-argv
 * `copilot -p '<trivial prompt>' --allow-all-tools` with a short bounded timeout and
 * returns `!r.error && r.status === 0`. FAIL-SOFT: any spawn error (ENOENT / timeout,
 * surfaced as res.error) or non-zero exit → false; NEVER throws (mirrors runTestCommand).
 * Caching is the runner's responsibility (78-03 calls this once per matrix), not here.
 * The `spawn` seam is injectable so tests exercise pass/fail/error without invoking the
 * real copilot binary.
 * @param {{ spawn?: typeof spawnSync }} [opts]
 * @returns {boolean}
 */
export function probeCopilotHeadless({ spawn = spawnSync } = {}) {
  try {
    const r = spawn(
      'copilot',
      ['-p', COPILOT_PROBE_PROMPT, '--allow-all-tools'],
      { timeout: COPILOT_PROBE_TIMEOUT_MS, encoding: 'utf8' },
    );
    if (!r || r.error) {
      // ENOENT / timeout / injected error — copilot is not headless-drivable here
      process.stderr.write('[agent-headless] copilot probe: spawn error → false\n');
      return false;
    }
    return r.status === 0;
  } catch {
    // Defensive: a spawn implementation that throws must still fail-soft to false.
    process.stderr.write('[agent-headless] copilot probe: threw → false\n');
    return false;
  }
}
