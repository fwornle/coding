// tests/experiments/_fixtures/stub-agent.mjs
//
// Phase 78, Plan 78-03 — a tiny controllable stub "agent" for the runner's
// terminal-state machine tests. It stands in for a real headless agent CLI so the
// SIGTERM→SIGKILL / exit-code → terminal-state mapping is exercised without spawning
// claude/copilot/opencode/mastra.
//
// Behaviour is driven by STUB_MODE (env) or the first positional argv token:
//   exit0  → print cwd + LLM_PROXY_DATA_DIR, exit 0   (runner maps → terminal_state 'complete')
//   exitN  → print cwd + LLM_PROXY_DATA_DIR, exit 3   (runner maps → 'abort')
//   hang   → print, then stay alive until a signal    (runner SIGTERM-kills → 'timeout')
//
// The two echo lines let a test that spawns the real stub (stdio piped) assert the child
// was launched with cwd = sandbox worktree and env.LLM_PROXY_DATA_DIR = sandbox .data.
//
// Diagnostics via process.stdout/stderr writes only (no console.* — no-console-log).
import process from 'node:process';

const mode = process.env.STUB_MODE || process.argv[2] || 'exit0';

process.stdout.write(`cwd=${process.cwd()}\n`);
process.stdout.write(`LLM_PROXY_DATA_DIR=${process.env.LLM_PROXY_DATA_DIR || ''}\n`);

if (mode === 'hang') {
  // Keep the event loop alive indefinitely. No SIGTERM handler is installed, so Node's
  // DEFAULT signal disposition terminates us on the runner's child.kill('SIGTERM') — the
  // nested SIGKILL grace timer is only reached if a real agent traps SIGTERM.
  setInterval(() => {}, 1 << 30);
} else if (mode === 'exitN') {
  process.exit(3);
} else {
  process.exit(0);
}
