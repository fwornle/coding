/**
 * Per-agent adapters for kgbench cells.
 *
 * kgbench's arms differ by TOOL SURFACE; this module is the orthogonal axis — which coding
 * agent drives the cell. The two axes are not equally measurable, and that asymmetry is the
 * whole reason this file carries so much prose:
 *
 * ONLY CLAUDE CAN BE GATED. `--allowedTools`, `--disallowedTools` and
 * `--strict-mcp-config` are claude flags. copilot, opencode and pi have no
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

export const KNOWN_AGENTS = ['claude', 'copilot', 'opencode', 'pi'];

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
 * copilot's autopilot sentinel: the tool it calls to declare the task finished. Counted as
 * a tool call (it is one) but reported separately so a tool-COUNT comparison against claude,
 * which has no equivalent, is not skewed by exactly one call per cell.
 */
const COPILOT_CONTROL_TOOLS = new Set(['task_complete']);

/**
 * Parse copilot's `--output-format json` JSONL into the same trace shape parseStream()
 * produces for claude, so a row means the same thing whichever agent wrote it.
 *
 * Returns null when the stream carries no events at all — that is "not measured", and it
 * must stay distinguishable from a cell that genuinely ran zero tools.
 */
function parseCopilotEvents(stdout) {
  const tools = [];
  const executed = [];
  const denied = [];
  const controlTools = [];
  // toolCallId -> name, so a completion can be matched back to the call that started it.
  const pending = new Map();
  let toolResultChars = 0;
  let turns = 0;
  let sawEvent = false;

  for (const line of String(stdout ?? '').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let e;
    try { e = JSON.parse(s); } catch { continue; }
    sawEvent = true;
    const d = e.data ?? {};

    if (e.type === 'tool.execution_start' && d.toolName) {
      pending.set(d.toolCallId, d.toolName);
      tools.push(d.toolName);
      if (COPILOT_CONTROL_TOOLS.has(d.toolName)) controlTools.push(d.toolName);
    } else if (e.type === 'tool.execution_complete') {
      const name = pending.get(d.toolCallId);
      if (name) {
        pending.delete(d.toolCallId);
        // `success: false` is copilot's refusal/failure signal — the call was billed but
        // the tool did not run, which is the same distinction claude's tool_result denial
        // check draws. Only `true` was observed in the reference capture.
        (d.success === false ? denied : executed).push(name);
      }
      const r = d.result;
      const text = typeof r === 'string' ? r : String(r?.content ?? '');
      toolResultChars += text.length;
    } else if (e.type === 'assistant.turn_end') {
      turns += 1;
    }
  }

  if (!sawEvent) return null;
  return {
    tool_calls: tools.length,
    tools,
    tools_executed: executed,
    tools_denied: denied,
    tool_control_calls: controlTools.length,
    tool_result_tokens_est: Math.round(toolResultChars / 4),
    num_turns: turns || null,
  };
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
  if (agent === 'pi') {
    // Like copilot and UNLIKE the mastracode it replaces, pi is gateable: it ships
    // `--tools <allowlist>`, `--exclude-tools <denylist>`, `--no-tools` and
    // `--no-builtin-tools`. Letting it fall through to the opencode branch below would
    // record it as 'ungated', understating what pi can do — and an enforcement descriptor
    // that is wrong in the safe direction is still wrong.
    //
    // It is not gated HERE yet for exactly copilot's reason: pi names its tools its own
    // way (read, bash, edit, write, …) and this harness has no verified mapping from an
    // arm's claude tool names onto them. An unrecognised name fails silently in one of two
    // directions — the model gets no tools and returns empty answers, or the flag is
    // ignored and the cell runs ungated while labelled otherwise. Both are the defect class
    // this benchmark exists to catch, so the mapping is established empirically first.
    //
    // MCP is deliberately NOT in pi's core (extension-only), so a default pi cell has no
    // MCP server surface to enforce at all — hence 'n/a' rather than a claimed 'enforced'.
    return {
      mcp_servers: 'n/a',
      builtins: 'not_enforced',
      gateable: true,
      verified_by: 'nothing — the answer-file elicitation produces no tool trace to audit',
      note: 'pi supports --tools/--exclude-tools; this harness does not yet map arm tool '
        + "names onto pi's naming, so built-ins are left open rather than restricted with "
        + 'unverified names. MCP is extension-only in pi, so there is no MCP surface here.',
    };
  }
  // opencode: `run` exposes only --agent and --dangerously-skip-permissions. There is no
  // tool allowlist to use, so this one really is a capability limit.
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
    // Its tool names ARE the names arms are written in (`Grep`, `Read`, `mcp__x__y`), so a
    // trace can be checked against `arm.allowedTools` directly. See toolVocabulary below.
    toolVocabulary: 'arm',
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
    // `view`/`create`/`bash`/`task_complete` — NOT the names arms are written in. A
    // trace is still recorded; it just cannot be scored against `arm.allowedTools`.
    toolVocabulary: 'native',
    /**
     * `--allow-all-tools` is required for non-interactive use. Plain `-p` is single-turn and
     * exits on a toolless first turn, so autopilot is required for the loop to continue;
     * `--no-ask-user` stops it blocking on a tool it cannot answer headlessly.
     * MCP servers come from `.vscode/mcp.json` in the working directory — repo-level, so the
     * sandbox worktree isolates it per cell for free. There is no tool-gating flag.
     */
    /**
     * `--output-format json` is what makes the cell auditable. Without it copilot prints
     * prose and the tool trace does not exist at all — `tools_executed` was null for every
     * copilot cell ever run, so `tool_audit` recorded 'unavailable'. It is a pure addition:
     * the flag changes stdout only, and the answer still arrives via the answer file, so
     * cells run before and after remain comparable on everything except the new fields.
     */
    argv({ prompt, model, answerFile }) {
      return [
        '-p', `${prompt}${answerFileDirective(answerFile)}`,
        '--allow-all-tools', '--no-ask-user',
        '--mode', 'autopilot', '--max-autopilot-continues', '20',
        '--model', model,
        '--output-format', 'json',
      ];
    },

    /**
     * Tool trace from copilot's JSONL event stream.
     *
     * EVERY name and field below was read off a real run (2026-08-19, claude-sonnet-5,
     * a goal that reads one file and writes another) — not inferred from the docs. The
     * envelope is `{type, data, ephemeral, id, timestamp, parentId}`; the two events that
     * matter are:
     *
     *   tool.execution_start     data: {toolCallId, toolName, arguments, turnId, model}
     *   tool.execution_complete  data: {toolCallId, success, result:{content,detailedContent}}
     *
     * `success` is what separates a tool that RAN from one that was refused, matching the
     * executed/denied split parseStream() derives for claude from tool_result blocks.
     *
     * `task_complete` is copilot's autopilot sentinel — the tool it calls to declare itself
     * finished. It is a real tool call and is counted as one, but it is flagged so analysis
     * can exclude it: leaving it in silently inflates every copilot cell's tool count by
     * exactly one relative to claude, which has no such tool, and the grep-vs-graph
     * comparison is a comparison of tool COUNTS.
     */
    toolTraceFrom(stdout) {
      return parseCopilotEvents(stdout);
    },

    /** Human-readable tail — the JSONL stream's raw last 300 chars are a truncated object. */
    textFrom(stdout) {
      const out = [];
      for (const line of String(stdout ?? '').split('\n')) {
        const s = line.trim();
        if (!s.startsWith('{')) continue;
        try {
          const e = JSON.parse(s);
          const t = e?.data?.text ?? (e?.type === 'assistant.message' ? e?.data?.content : null);
          if (typeof t === 'string' && t.trim()) out.push(t);
        } catch { /* partial line at the buffer edge */ }
      }
      return out.join('\n');
    },
  },

  opencode: {
    id: 'opencode',
    elicitation: 'answer-file',
    // `read`/`write`/`bash`/`grep` — lowercase natives, not arm names. As copilot.
    toolVocabulary: 'native',
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
     * Tool trace from opencode's `--format json` event stream.
     *
     * Read off a real run (2026-08-19, rapid-proxy/claude-sonnet-5, same two-tool goal as
     * the copilot capture). Shape differs from copilot's in a way that matters:
     *
     *   tool_use     part: {type:'tool', tool, callID, state:{status, input, output, time}}
     *   step_finish  part: {reason, tokens:{input,output,total,reasoning,cache:{read,write}}}
     *   text         part: {text}
     *
     * opencode emits ONE `tool_use` per call carrying its TERMINAL state, rather than
     * copilot's start/complete pair — so a call is counted once and its status read
     * directly. Only `status: 'completed'` was observed in the capture; anything else is
     * therefore recorded as attempted-but-not-executed rather than mapped to a specific
     * failure mode that has not been seen. That asymmetry is deliberate: inventing a
     * status name would put an unverified claim in the audit column.
     *
     * Tokens come from `step_finish` and are SUMMED across steps — a cell is many steps and
     * the last one alone is not the cell's cost.
     */
    toolTraceFrom(stdout) {
      const tools = [];
      const executed = [];
      const denied = [];
      let toolResultChars = 0;
      let inTok = 0;
      let outTok = 0;
      let steps = 0;
      let sawEvent = false;

      for (const line of String(stdout ?? '').split('\n')) {
        const s = line.trim();
        if (!s.startsWith('{')) continue;
        let e;
        try { e = JSON.parse(s); } catch { continue; }
        sawEvent = true;
        const part = e.part ?? {};

        if (e.type === 'tool_use' && part.tool) {
          tools.push(part.tool);
          const st = part.state ?? {};
          if (st.status === 'completed') executed.push(part.tool);
          else denied.push(part.tool);
          const out = typeof st.output === 'string' ? st.output : JSON.stringify(st.output ?? '');
          toolResultChars += out.length;
        } else if (e.type === 'step_finish') {
          steps += 1;
          const t = part.tokens ?? {};
          // cache reads are input the model was billed for seeing, same as claude's
          // cache_read_input_tokens — excluding them would understate the arm's context.
          inTok += (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
          outTok += t.output ?? 0;
        }
      }

      if (!sawEvent) return null;
      return {
        tool_calls: tools.length,
        tools,
        tools_executed: executed,
        tools_denied: denied,
        tool_result_tokens_est: Math.round(toolResultChars / 4),
        in_tokens: inTok || null,
        out_tokens: outTok || null,
        total_tokens: (inTok + outTok) || null,
        num_turns: steps || null,
      };
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

  pi: {
    id: 'pi',
    elicitation: 'answer-file',
    // pi names its tools its own way too, and no trace parser has been written for it
    // yet — so it stays 'unavailable' rather than gaining an unverified audit.
    toolVocabulary: 'native',
    // No --dir: the caller sets cwd via the spawn option.
    // --approve is REQUIRED headlessly — without it pi blocks on a project-trust prompt it
    // cannot answer and hangs until the wall-clock kill (observed: a full 120s timeout with
    // no output and no LLM call made). --provider pins the proxy-routed provider so a cell
    // cannot silently fall through to whatever pi found its own credential for.
    argv({ prompt, model, answerFile }) {
      return ['-p', `${prompt}${answerFileDirective(answerFile)}`,
        '--provider', 'rapid-proxy-pi', '--model', model, '--approve'];
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
