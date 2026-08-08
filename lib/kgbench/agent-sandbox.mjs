/**
 * Per-cell MCP restriction for non-claude agents.
 *
 * claude takes its server list on the command line (`--strict-mcp-config --mcp-config`),
 * so nothing here applies to it. copilot and opencode read theirs from FILES, in different
 * places, and neither has a flag — so restricting them means writing the right file in the
 * right location before the cell spawns.
 *
 *   copilot  -> <cwd>/.vscode/mcp.json          repo-level, so the sandbox worktree
 *                                                isolates it per cell for free
 *   opencode -> $XDG_CONFIG_HOME/opencode/opencode.json
 *
 * WHAT THIS DOES NOT BUY YOU. Restricting MCP servers is not the same as enforcing an
 * arm's tool surface: the built-in file tools (read, search, edit) stay reachable on both
 * agents, and no configuration can withhold them. That is why arms defined by WITHHOLDING
 * built-in search are refused on these agents entirely (agents.mjs armIsFaithful) and why
 * every cell records a two-part `enforcement` descriptor rather than a boolean.
 *
 * CREDENTIALS ARE NOT AT RISK, which is worth stating because the obvious implementation —
 * pinning HOME — would break them. opencode keeps auth under XDG_DATA_HOME
 * (~/.local/share/opencode/auth.json) and only its CONFIG under XDG_CONFIG_HOME, so
 * overriding the config home alone restricts MCP and leaves the token exactly where
 * opencode expects it. copilot needs no env override at all.
 *
 * BUT THE CONFIG IS NOT ONLY MCP, and assuming it was cost a smoke run. opencode's
 * opencode.json also declares `provider` — the rapid-proxy provider block that makes
 * `rapid-proxy/*` models exist at all. Writing a fresh file containing just `{mcp:{}}`
 * therefore deleted the provider, and the cell died on
 * `Model not found: rapid-proxy/claude-sonnet-4.6` for a model that is in the catalog.
 * The user's config is now COPIED and only its `mcp` key replaced.
 *
 * The useful side effect survives that change: AGENTS.md is a separate FILE, so pinning the
 * config home still removes ~/.config/opencode/AGENTS.md from the cell. That is a global
 * instruction layer no other agent receives, and a known cross-agent parity leak.
 */

import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The user's real opencode config, used as the base for the pinned one.
 *
 * Read from the ORIGINAL config home, not the pinned one — resolving this against the
 * override would read the file we are about to write. Missing or unparseable is not fatal:
 * an empty base still restricts MCP, it just also loses the providers, which is loud
 * (`Model not found`) rather than silent.
 */
function readUserOpencodeConfig(env = {}) {
  const base = env.KGBENCH_OPENCODE_CONFIG_HOME
    || process.env.KGBENCH_OPENCODE_CONFIG_HOME
    || path.join(os.homedir(), '.config');
  const file = path.join(base, 'opencode', 'opencode.json');
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch { /* fall through to empty */ }
  return {};
}

/**
 * claude's `{mcpServers: {...}}` -> copilot's `{servers: {...}}`.
 * Shapes follow install.sh's setup_copilot_mcp_config so a restricted cell sees servers
 * described exactly the way production describes them.
 */
export function toCopilotMcp(mcpConfig = {}) {
  const servers = {};
  for (const [name, s] of Object.entries(mcpConfig.mcpServers ?? {})) {
    servers[name] = (s.type === 'http' || s.type === 'sse' || s.url)
      ? { type: 'http', url: s.url ?? '' }
      : { type: 'stdio', command: s.command ?? '', args: s.args ?? [] };
    if (s.env && Object.keys(s.env).length) servers[name].env = s.env;
  }
  return { servers };
}

/** claude's `{mcpServers: {...}}` -> opencode's `{mcp: {...}}`. */
export function toOpencodeMcp(mcpConfig = {}) {
  const mcp = {};
  for (const [name, s] of Object.entries(mcpConfig.mcpServers ?? {})) {
    mcp[name] = (s.type === 'http' || s.type === 'sse' || s.url)
      ? { type: 'remote', url: s.url ?? '', enabled: true }
      : { type: 'local', command: [s.command ?? '', ...(s.args ?? [])], enabled: true };
    if (s.env && Object.keys(s.env).length) mcp[name].environment = s.env;
  }
  // `$schema` is omitted deliberately: opencode tolerates its absence, and pointing at a
  // schema URL would make a sandboxed cell reach the network before it starts.
  return { mcp };
}

/**
 * Write the MCP configuration this (agent, arm) cell is allowed to see, and return any env
 * the spawn needs.
 *
 * Cells run serially, so writing copilot's repo-level file per cell is safe; if the matrix
 * is ever parallelised within one worktree, that file becomes shared mutable state and this
 * is the thing that has to change first.
 *
 * @returns {{env: Record<string,string>, wrote: string[], enforcement: object, cleanup: Function}}
 */
export function prepareAgentMcp({ agent, arm, cwd, runDir, env = {} }) {
  const wrote = [];
  const extraEnv = {};

  if (agent === 'copilot') {
    const dir = path.join(cwd, '.vscode');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify(toCopilotMcp(arm.mcpConfig), null, 2) + '\n');
    wrote.push(file);
  } else if (agent === 'opencode') {
    // Per ARM, not per cell: the config home is an env var, and reusing one directory per
    // arm keeps the number of temporary trees bounded on a large matrix.
    const home = path.join(runDir, 'agent-config', arm.id);
    const dir = path.join(home, 'opencode');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'opencode.json');
    // Start from the user's real config and replace ONLY `mcp`. Everything else in that
    // file — notably `provider`, which is what makes `rapid-proxy/*` models resolvable —
    // must survive, or the cell fails with "Model not found" for a model that exists.
    const base = readUserOpencodeConfig(env);
    writeFileSync(file, JSON.stringify({ ...base, ...toOpencodeMcp(arm.mcpConfig) }, null, 2) + '\n');
    wrote.push(file);
    extraEnv.XDG_CONFIG_HOME = home;
  }

  return {
    env: { ...env, ...extraEnv },
    wrote,
    enforcement: {
      mcp_servers: 'enforced',
      builtins: agent === 'claude' ? 'enforced' : 'ungated',
      // Naming the mechanism matters: a reader auditing a surprising cell needs to know
      // whether to look at a flag, a file, or nothing at all.
      mechanism: agent === 'claude' ? '--strict-mcp-config'
        : agent === 'copilot' ? '.vscode/mcp.json in the sandbox worktree'
        : agent === 'opencode' ? 'XDG_CONFIG_HOME pin' : 'none',
      allowed_servers: Object.keys(arm.mcpConfig?.mcpServers ?? {}),
    },
    cleanup() {
      // copilot's file lives INSIDE the measured tree, so leaving it behind would make the
      // next cell's containment check see a file the run itself created.
      for (const f of wrote) { try { rmSync(f, { force: true }); } catch { /* best effort */ } }
    },
  };
}
