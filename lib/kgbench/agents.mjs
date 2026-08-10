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
  if (agent === 'copilot') {
    // NOT 'ungated' — that would understate what copilot can do, and an enforcement
    // descriptor that is wrong in the safe direction is still wrong. copilot ships
    // `--available-tools` ("only these tools will be available to the model"), plus
    // `--deny-tool`, `--disable-builtin-mcps` and `--disable-mcp-server`. It is gateable.
    //
    // It is not gated HERE yet, for a reason worth stating rather than hiding in a TODO:
    // copilot names tools differently from claude — `shell(git:*)`, `write`,
    // `MyMCP(tool)` — and this harness has no verified mapping from an arm's claude tool
    // names to copilot's. Passing a name copilot does not recognise fails in one of two
    // silent ways: the model ends up with no tools and returns empty answers, or the flag
    // is ignored and the cell runs ungated while labelled otherwise. Both are exactly the
    // defect class this benchmark keeps finding, so the mapping gets established
    // empirically before it is trusted, not guessed at now.
    return {
      mcp_servers: 'enforced',
      builtins: 'not_enforced',
      gateable: true,
      // NOT 'post-hoc audit only', which is what this said until the first copilot cell ran
      // through runCell. A post-hoc audit needs a tool trace, and the answer-file elicitation
      // these agents require produces none — `tools_executed` is null, so there is nothing to
      // compare against the grant. Claiming an audit that cannot be performed is worse than
      // claiming none: it presents an unchecked cell as a checked one.
      verified_by: 'nothing — the CLI emits no tool trace, so no audit is possible',
      note: 'copilot supports --available-tools/--deny-tool; this harness does not yet map '
        + 'arm tool names onto copilot\'s naming, so built-ins are left open rather than '
        + 'restricted with unverified names.',
    };
  }
  // opencode / mastracode: `run` exposes only --agent and --dangerously-skip-permissions.
  // There is no tool allowlist to use, so this one really is a capability limit.
  return {
    mcp_servers: 'enforced',
    builtins: 'ungated',
    gateable: false,
    verified_by: 'nothing — no tool allowlist to enforce with, and no tool trace to audit',
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
     *
     * `--format json` is here for the SESSION ID, not for the output. opencode's headless
     * `run` ends its loop at the first assistant step with text and no tool call, and on this
     * question set that step is frequently the one where it has finished investigating and is
     * about to write — 84 of 96 cells in run coding-v1-x2 ended that way, and 36 of those had
     * a complete answer sitting in stdout that was never written to the file. The recovery is
     * a second turn in the SAME session (see continueArgv), which needs the session's id, and
     * the JSON event stream is where opencode publishes it.
     */
    argv({ prompt, model, answerFile }) {
      return [
        'run', `${prompt}${answerFileDirective(answerFile)}`,
        '-m', model,
        '--dangerously-skip-permissions',
        '--format', 'json',
      ];
    },

    /**
     * The id of the session `argv` just created, read from its JSON event stream.
     *
     * Every event carries `sessionID`; the first is enough. Returns null when the stream has
     * none, which is the case that matters — see continueArgv.
     */
    sessionIdFrom(stdout) {
      const m = /"sessionID"\s*:\s*"(ses_[A-Za-z0-9]+)"/.exec(String(stdout ?? ''));
      return m ? m[1] : null;
    },

    /**
     * A continuation turn, targeted at an EXPLICIT session id.
     *
     * `-s <id>`, never `-c`. `-c` means "continue the last session", and kgbench cells run
     * serially in one shared worktree — so a cell whose first turn exited without ever
     * reaching the model (auth failure, a provider 4xx) has no session of its own, and `-c`
     * would hand it the PREVIOUS cell's. That cell's answer would then be written to the
     * answer file and graded against this cell's question: exactly the shape of defect 15,
     * where one opencode answer was scored against eleven different questions. An explicit id
     * cannot do that, and when there is no id there is no continuation.
     */
    continueArgv({ sessionId, model, answerFile }) {
      return [
        'run', '-s', sessionId,
        `Write your complete answer to the file \`${answerFile}\` in the current working`
        + ' directory now, using your file-writing tool. Answer from what you have already'
        + ' found in this session. Do NOT modify any other file.',
        '-m', model,
        '--dangerously-skip-permissions',
        '--format', 'json',
      ];
    },

    /**
     * Human-readable tail from the JSON event stream, for diagnostics.
     *
     * Without this, switching to `--format json` would cost the `stdout_tail` that made the
     * x2 failures legible — it is how the 36 already-answered-but-unwritten cells were found,
     * and how opencode's prompt-injection refusals surfaced at all.
     */
    textFrom(stdout) {
      const out = [];
      for (const line of String(stdout ?? '').split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const e = JSON.parse(line);
          const t = e?.part?.text ?? e?.text;
          if (typeof t === 'string' && t.trim()) out.push(t);
        } catch { /* a partial line at the buffer edge — skip it */ }
      }
      return out.join('\n');
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
  // Why refused differs by agent, and the distinction is worth keeping: on opencode this is
  // a hard capability limit, on copilot it is unfinished work. Collapsing them would make a
  // fixable gap look permanent.
  const because = agent === 'copilot'
    ? 'copilot CAN gate tools (--available-tools), but this harness has no verified mapping '
      + 'from arm tool names to copilot\'s naming, so the restriction is not applied'
    : `${agent} exposes no tool allowlist, so built-ins cannot be withheld`;
  return {
    faithful: false,
    reason: `arm "${arm.id}" is defined by WITHHOLDING built-in search (it grants Read without `
      + `Glob/Grep), and ${because}. The cell would run with more capability than its label claims.`,
  };
}

/**
 * The coordinates that identify one cell, as a resume key.
 *
 * Lives here rather than inline in the runner because getting it wrong fails SILENTLY in
 * both directions: too coarse and a resume skips cells that never ran, too fine and it
 * re-runs cells that did. Adding the agent and model axes made it both — every row written
 * before those axes existed carries neither field, so a naive key would have orphaned the
 * whole of runs r6/r7 and re-run them from scratch.
 *
 * The defaults encode what was true when those rows were written: no `agent` meant claude,
 * and no `model` meant the arm's own configured model, which the caller supplies since a
 * row does not record it.
 */
export function cellKey({ arm, agent, model, question, rep, armModel }) {
  return [arm, agent ?? 'claude', model ?? armModel ?? '', question, rep].join('|');
}

export { ADAPTERS as _ADAPTERS };
