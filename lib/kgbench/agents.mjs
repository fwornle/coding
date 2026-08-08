/**
 * Per-agent adapters for kgbench cells.
 *
 * kgbench's arms differ by TOOL SURFACE; this module is the orthogonal axis — which coding
 * agent drives the cell. The two axes are not equally measurable, and that asymmetry is the
 * whole reason this file carries so much prose:
 *
 * ONLY CLAUDE CAN BE GATED. `--allowedTools`, `--disallowedTools` and
 * `--strict-mcp-config` are claude flags. copilot, opencode and mastracode have no
 * equivalent, so an arm's tool surface CANNOT be enforced on them. What can be restricted
 * is which MCP servers they are configured with; their built-in file tools stay open. Every
 * adapter therefore publishes an `enforcement` descriptor and every cell records it, so a
 * "grep arm" running on copilot is never presented as though its tool surface was enforced.
 *
 * ELICITATION DIFFERS TOO, and not by choice. An analysis-shaped goal makes copilot exit in
 * ~6s and opencode yield on its first toolless step — both "succeed" having answered
 * nothing (see memory reference_experiment_headless_termination_rootcause). kgbench
 * questions are analysis-shaped by construction. The fix is to give those agents something
 * to DO on turn one: write the answer to a file. That keeps the task execution-shaped
 * without asking any agent to modify the repository under test, and it yields a uniform
 * answer path that does not depend on each CLI's output format.
 *
 * claude keeps its existing stream-json path UNCHANGED, so cells stay comparable with runs
 * r6/r7. That means claude and non-claude cells are elicited differently, which is a
 * confound — recorded per cell as `elicitation`, not hidden.
 *
 * WHY NOT lib/experiments/agent-headless.mjs argvForAgent(): it appends a file-EDITING
 * directive to every prompt ("implement this change directly on disk"), which is correct
 * for that harness and actively wrong here — kgbench asks questions about a read-only
 * sandbox. Its binary resolution and model-id mapping ARE reused; only the argv is ours.
 */

import path from 'node:path';
import { resolveAgentBinary } from '../experiments/agent-headless.mjs';
import { resolveModelForAgent } from '../experiments/model-resolve.mjs';

/** Where a non-claude agent is told to leave its answer, relative to the sandbox root. */
export const ANSWER_FILE = '.kgbench-answer.md';

export const KNOWN_AGENTS = ['claude', 'copilot', 'opencode', 'mastracode'];

/**
 * The directive that turns a question into an executable task for agents that quit on a
 * toolless turn. Deliberately explicit that the ONLY write permitted is the answer file:
 * an agent that "helpfully" edits the repository would corrupt a later cell in the same
 * worktree and make the run unreproducible.
 */
function answerFileDirective(answerFile) {
  return `\n\nIMPORTANT — HOW TO ANSWER: Write your complete answer to the file \`${answerFile}\``
    + ' in the current working directory, using your file-writing tool, right now.'
    + ' Investigate first using your read/search tools, then write the answer file.'
    + ` The task is complete ONLY once \`${answerFile}\` exists and contains your full answer.`
    + ' Do NOT modify any other file in this repository — it is under measurement.';
}

/**
 * Enforcement descriptor. Structured rather than a boolean because the honest answer has
 * two parts that differ: MCP servers can be restricted for every agent, built-in tools
 * only for claude. A single `tool_enforced: true|false` would have to lie about one of them.
 */
function enforcementFor(agent) {
  if (agent === 'claude') {
    return {
      mcp_servers: 'enforced',   // --strict-mcp-config + explicit --mcp-config
      builtins: 'enforced',      // --allowedTools + --disallowedTools deny list
      verified_by: 'deny-list plus post-hoc audit of executed tools',
    };
  }
  return {
    mcp_servers: 'enforced',     // per-cell MCP config file; see sandbox wiring
    builtins: 'ungated',         // no --disallowedTools equivalent exists on this CLI
    verified_by: 'post-hoc audit only; built-in tool use cannot be prevented',
  };
}

const ADAPTERS = {
  claude: {
    id: 'claude',
    elicitation: 'stream-json',
    /**
     * Unchanged from the single-agent runner, so r6/r7 cells remain comparable. The deny
     * list, not the allow list, is what actually confines the arm: `--allowedTools` alone
     * leaves un-named built-ins reachable.
     */
    argv({ prompt, arm, model, mcpArg, denyList }) {
      return [
        '-p', prompt,
        '--model', model,
        '--output-format', 'stream-json', '--verbose',
        '--allowedTools', arm.allowedTools.join(','),
        ...(denyList?.length ? ['--disallowedTools', denyList.join(',')] : []),
        '--strict-mcp-config', '--mcp-config', mcpArg,
        '--dangerously-skip-permissions',
      ];
    },
  },

  copilot: {
    id: 'copilot',
    elicitation: 'answer-file',
    /**
     * `--allow-all-tools` is required for non-interactive use. Plain `-p` is single-turn and
     * exits on a toolless first turn, so autopilot is required for the loop to continue;
     * `--no-ask-user` stops it blocking on a tool it cannot answer headlessly.
     * MCP servers come from `.vscode/mcp.json` in the working directory — repo-level, so the
     * sandbox worktree isolates it per cell for free. There is no tool-gating flag.
     */
    argv({ prompt, model, answerFile }) {
      return [
        '-p', `${prompt}${answerFileDirective(answerFile)}`,
        '--allow-all-tools', '--no-ask-user',
        '--mode', 'autopilot', '--max-autopilot-continues', '20',
        '--model', model,
      ];
    },
  },

  opencode: {
    id: 'opencode',
    elicitation: 'answer-file',
    /**
     * `--dangerously-skip-permissions` is required for non-interactive `run`, otherwise it
     * blocks on a permission prompt it cannot answer and hangs until the wall-clock kill.
     * Its `run` is still single-turn, so the answer-file directive is what drives it to act.
     * MCP config lives at $XDG_CONFIG_HOME/opencode/opencode.json — pinned per run, not
     * per cell, so cells sharing a run share one config.
     */
    argv({ prompt, model, answerFile }) {
      return ['run', `${prompt}${answerFileDirective(answerFile)}`, '-m', model, '--dangerously-skip-permissions'];
    },
  },

  mastracode: {
    id: 'mastracode',
    elicitation: 'answer-file',
    // No --dir: the caller sets cwd via the spawn option.
    argv({ prompt, model, answerFile }) {
      return ['--prompt', `${prompt}${answerFileDirective(answerFile)}`, '-m', model];
    },
  },
};

/**
 * Resolve everything a cell needs to run one (agent, model) pair.
 *
 * `modelRef` is the benchmark's canonical spelling (e.g. `claude-sonnet-5`); each agent
 * wants it differently — claude hyphenated, opencode as `rapid-proxy/<dotted>`, copilot
 * dotted — so the mapping is delegated to lib/experiments/model-resolve.mjs rather than
 * duplicated here.
 */
export function resolveAgent(agent, { modelRef, agentsDir, repoRoot } = {}) {
  const adapter = ADAPTERS[agent];
  if (!adapter) throw new Error(`kgbench: unknown agent "${agent}" (known: ${KNOWN_AGENTS.join(', ')})`);
  const dir = agentsDir ?? path.join(repoRoot ?? process.cwd(), 'config', 'agents');
  return {
    ...adapter,
    binary: resolveAgentBinary(agent, dir),
    model: modelRef ? resolveModelForAgent(agent, modelRef) : null,
    modelRef: modelRef ?? null,
    enforcement: enforcementFor(agent),
    answerFile: adapter.elicitation === 'answer-file' ? ANSWER_FILE : null,
  };
}

/**
 * Is this (arm, agent) combination measurable as the arm's label claims?
 *
 * An arm whose identity is a RESTRICTED built-in surface (grep: Glob+Grep+Read; codegraph:
 * Read plus one MCP tool) cannot be reproduced on an agent whose built-ins are ungated —
 * the cell would run with more capability than the label states. `hybrid` is the exception
 * and the only honest cross-agent arm: it grants everything, so "ungated" IS its surface.
 */
export function armIsFaithful(arm, agent) {
  if (agent === 'claude') return { faithful: true };
  // The question is NOT "does this arm grant a lot of tools" — it is "does this arm's
  // identity depend on WITHHOLDING built-in search". `grep` withholds only MCP servers,
  // which every agent can be restricted from, so it survives. `graphify` and `codegraph`
  // are defined by having Read but NOT Glob/Grep, and that exclusion is exactly what an
  // ungated agent cannot honour — such a cell would quietly grep while labelled otherwise.
  const tools = arm.allowedTools ?? [];
  const withholdsBuiltinSearch = !(tools.includes('Glob') && tools.includes('Grep'));
  if (!withholdsBuiltinSearch) return { faithful: true };
  return {
    faithful: false,
    reason: `arm "${arm.id}" is defined by WITHHOLDING built-in search (it grants Read without `
      + `Glob/Grep), and ${agent} cannot gate built-ins. The cell would run with more capability `
      + 'than its label claims.',
  };
}

export { ADAPTERS as _ADAPTERS };
