/**
 * kgbench runner: executes one (arm, question, rep) and returns a result record.
 *
 * Three things it does that the graphify-vs-grep harness did not:
 *
 *  1. Kills the PROCESS GROUP on timeout. `claude` spawns MCP subprocesses; killing
 *     only the direct child leaks them, and leaked servers poison later runs.
 *  2. Records failures as outcomes instead of dropping them. The old report filtered
 *     error rows out of every median, so two graph-arm stalls vanished from the
 *     numbers and survived only in hand-written prose.
 *  3. Measures a per-arm token BASELINE, so content tokens can be separated from the
 *     ~140k fixed floor of system prompt + tool schemas. That floor is what flattened
 *     the previous comparison into "rough parity".
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cellTaskId, bindCellEnv, resolveCellTokens } from './tokens.mjs';

/** Closed outcome set. Everything that happens is exactly one of these. */
export const OUTCOMES = ['ok', 'timeout', 'no_result', 'spawn_error', 'api_error', 'tool_escape', 'host_stalled'];

/**
 * How far past its deadline a timer must fire before we conclude the HOST stalled
 * rather than the arm running long. Node timers do not fire early, so overshoot is the
 * only signal available, and 1.5x is well outside normal scheduling jitter.
 */
const HOST_STALL_FACTOR = 1.5;

/**
 * Only these are worth a second attempt. An api_error (credit exhausted, auth,
 * model unavailable) reproduces on retry, so retrying just doubles the wasted time
 * and the wall-clock numbers.
 */
const RETRYABLE = new Set(['timeout', 'no_result']);

export const PROXY_PORT = process.env.LLM_PROXY_PORT || '12435';
export const PROXY_BASE = `http://127.0.0.1:${PROXY_PORT}`;

/**
 * Environment for a benchmark child — mirrors configure_proxy_routing()'s `claude`
 * branch in scripts/launch-agent-common.sh, which is the project's single definition
 * of how an agent reaches a model.
 *
 * All cognitive work goes through the LLM proxy on :12435, which selects the
 * subscription provider for the current network (claude-code Max outside the VPN,
 * GH Copilot inside it). Two things enforce that here:
 *
 *   - ANTHROPIC_BASE_URL is PINNED to the proxy, not merely inherited. Inheriting it
 *     meant a shell without it would send the benchmark straight to api.anthropic.com,
 *     unmeasured and on the wrong billing path.
 *   - The API-key envs are unset. Claude Code prefers a key over the Max OAuth login,
 *     so a key present in the environment silently bypasses the measured path. This is
 *     not hypothetical: .env sets ANTHROPIC_API_KEY, and inheriting it is what made
 *     every pilot cell fail with "Credit balance is too low".
 */
export function agentEnv(env = process.env) {
  const e = { ...env };
  e.ANTHROPIC_BASE_URL = PROXY_BASE;
  delete e.ANTHROPIC_API_KEY;
  delete e.ANTHROPIC_ADMIN_API_KEY;
  delete e.ANTHROPIC_AUTH_TOKEN;
  // THE LEAK CHANNEL THAT DEFEATS THE SANDBOX ENTIRELY.
  //
  // `knowledge-injection-hook.js` is registered as a USER-LEVEL UserPromptSubmit hook, so it
  // fires for every claude session in every working directory — including a throwaway
  // worktree with no project context. It semantically retrieves this project's knowledge base
  // against the PROMPT and prepends what it finds. For a retrieval benchmark that is not bias,
  // it is the answer:
  //
  //   prompt   "Which file defines the shell variable MANAGED_MCP_KEYS?"
  //   injected "## Digests — Smoke Test Execution: MANAGED_MCP_KEYS Answer File Written
  //             Located definition via grep in install.sh at line 1180"
  //
  // Reproduced from an empty temp directory. Worse, it is self-reinforcing: running the
  // benchmark creates observations recording the answers, and the next run is handed them.
  //
  // Containment cannot see this. The sandbox controls what is in the TREE; this channel never
  // touches the tree. The `/experiment` harness already knew to set this variable; kgbench was
  // written later and did not inherit the lesson.
  //
  // Set here rather than at the call sites so it covers every path that spawns an agent —
  // cells, baseline probes and tool discovery alike.
  e.CODING_KNOWLEDGE_INJECTION = '0';
  return e;
}

/**
 * Fail-closed proxy gate, matching the launcher's stance: if the proxy is down we
 * abort rather than let the run proceed direct-and-unmeasured. A benchmark that
 * silently bypassed the proxy would report numbers for a path nobody actually uses.
 */
export async function assertProxyReachable({ timeoutMs = 3000, attempts = 3 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${PROXY_BASE}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return { ok: true, base: PROXY_BASE, detail: await res.json().catch(() => ({})) };
    } catch { /* retry: the daemon is launchd-managed and may be mid-restart */ }
    if (i < attempts) await new Promise((r) => setTimeout(r, 1500));
  }
  return {
    ok: false,
    base: PROXY_BASE,
    detail: `LLM proxy unreachable at ${PROXY_BASE}. Fix: launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy`,
  };
}

/**
 * Built-in tools that must be denied explicitly.
 *
 * `--allowedTools` DOES NOT RESTRICT ANYTHING under --dangerously-skip-permissions.
 * It is a permission-prompt allowlist, and skipping permissions skips consulting it,
 * so every arm silently received the full default tool surface.
 *
 * This was not theoretical. In the first coding-v1 matrix the "agentic grep" arm
 * called Bash 59 times, plus Agent, SendMessage and TaskStop; the graphify arm called
 * Bash 27 times and did not call a single graphify MCP tool. The arms were therefore
 * the same agent wearing different labels, and every number comparing them — including
 * the earlier replication run where both arms scored 1.00 on every class and "could
 * not be told apart" — was measuring one configuration against itself.
 *
 * It also breached the sandbox: an arm ran `git submodule update --init` inside the
 * run tree, checking out thousands of files that the containment scan never saw.
 *
 * `--disallowedTools` IS enforced under skip-permissions (verified: the model attempts
 * the call and gets "Bash is disabled for this session"), so the deny list is what
 * actually constrains an arm.
 */
/**
 * Fallback list, used only if tool discovery fails. HAND-MAINTAINED LISTS ROT: this one
 * was written from the tools I knew about and missed `Skill`, which the graphify arm
 * promptly used to invoke this project's own /graphify skill — a second escape, found
 * the same way as the first. The CLI reports its real tool surface at session init, so
 * discoverBuiltinTools() is the source of truth and this is only a floor.
 */
export const DENYABLE_BUILTINS = [
  // As reported by `claude` at session init.
  'Task', 'Bash', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync', 'Edit',
  'EnterWorktree', 'ExitWorktree', 'Glob', 'Grep', 'Monitor', 'NotebookEdit',
  'PushNotification', 'Read', 'RemoteTrigger', 'ReportFindings', 'ScheduleWakeup',
  'SendMessage', 'Skill', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput',
  'TaskStop', 'TaskUpdate', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
  // Names seen in real transcripts but absent from the current init list — `Agent`
  // was called twice by the grep arm in the voided run. Denying a name that does not
  // exist costs nothing; omitting one that does is how both escapes happened.
  'Agent', 'MultiEdit', 'BashOutput', 'KillBash', 'SlashCommand', 'ExitPlanMode', 'TodoWrite',
  // MCP meta-tools. They enumerate and read MCP resources, which is a capability
  // outside any arm's declared grant even when that arm has MCP tools of its own.
  'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool',
];

/**
 * Ask the CLI what tools it actually has, by reading the `system`/`init` event of a
 * throwaway session. Version-proof: a tool added upstream is denied automatically
 * instead of silently becoming an escape hatch nobody notices until a benchmark run
 * has already been published.
 */
export async function discoverBuiltinTools({ model, cwd, env = process.env }) {
  const probe = {
    id: '_probe', model, timeoutMs: 120000, maxAttempts: 1,
    allowedTools: [], mcpConfig: { mcpServers: {} },
  };
  const r = await runAgent({ prompt: 'Reply with the single word OK.', arm: probe, cwd, env, noDeny: true });
  if (!r.available_tools?.length) return null;
  // UNION, not replacement. What the CLI reports depends on the probe's own flags: with
  // `--allowedTools ""` it omits Glob and Grep, and trusting that verbatim left the
  // graph arms holding Grep — which would have made "graph vs grep" a comparison of
  // grep against grep. Discovery adds tools the static list has never heard of; the
  // static list guarantees the ones we already know can never go missing.
  return [...new Set([...r.available_tools, ...DENYABLE_BUILTINS])];
}

/**
 * Everything built-in that this arm is not allowed to use.
 * `builtins` comes from discovery; omitting it falls back to the static floor.
 */
export function denyListFor(arm, builtins = DENYABLE_BUILTINS) {
  const allowed = new Set(arm.allowedTools ?? []);
  // MCP tools are governed by --strict-mcp-config, not by this list.
  return builtins.filter((t) => !t.startsWith('mcp__') && !allowed.has(t));
}

/**
 * Tools an arm used that it was never granted.
 *
 * The deny list is the mechanism; this is the guarantee. A flag can be wrong, a tool
 * can be renamed, and a new built-in can appear — and each of those failures is silent,
 * producing a run that looks fine and compares nothing. Checking what the arm ACTUALLY
 * called against what it was granted is what makes an escape impossible to publish.
 */
export function toolViolations(arm, tools) {
  // `?? []` rather than a default parameter: an answer-file cell passes null EXPLICITLY
  // (no tool trace exists), and a default only fires on undefined.
  tools = tools ?? [];
  const allowed = new Set(arm.allowedTools ?? []);
  // Which MCP SERVERS an arm may reach is the thing that defines its retrieval
  // strategy, and that is enforced by --strict-mcp-config + an explicit --mcp-config.
  // Which of that server's tools it picks is the arm's own business: graphify's server
  // advertises ten tools while config/code-graph.json names six, so flagging per-tool
  // would void a cell for using get_community — a graph query — as if it had grepped.
  // Crossing to a DIFFERENT strategy is what must never happen.
  const servers = new Set(Object.keys(arm.mcpConfig?.mcpServers ?? {}));
  const fromOwnServer = (t) => t.startsWith('mcp__') && servers.has(t.split('__')[1]);
  return [...new Set(tools.filter((t) => !allowed.has(t) && !fromOwnServer(t)))];
}

/**
 * Run one headless agent invocation.
 * Never throws — a failure is a result record with an `outcome`, not an exception.
 *
 * `agent` defaults to the claude adapter so every existing caller — and every cell in runs
 * r6/r7 — keeps byte-identical argv and the stream-json parse path. Cross-agent cells pass
 * a resolved adapter from lib/kgbench/agents.mjs, which also carries how the answer must be
 * elicited: claude streams it, the others write it to a file because an analysis-shaped
 * prompt makes them exit before answering.
 */
export function runAgent({ prompt, arm, cwd, env = process.env, builtins, noDeny = false, agent = null }) {
  env = agentEnv(env);
  // Pin the inherited PWD to the sandbox. spawn({cwd}) changes the child's working directory
  // but leaves PWD/OLDPWD pointing at the RUNNER's cwd — the real repository — and an agent
  // that reads $PWD to find its project root will happily work there instead.
  //
  // This is not hypothetical. The first cross-agent smoke run had opencode grep correctly,
  // then write its answer to /Users/.../coding/.kgbench-answer.md: the live repo, not the
  // worktree it was given. Same escape the experiment harness hit and fixed the same way
  // (lib/experiments/experiment-runner.mjs:671). Every cell after such a write would be
  // measuring a tree the benchmark had contaminated itself.
  if (cwd) {
    env = { ...env, PWD: cwd };
    delete env.OLDPWD;
  }
  const mcpArg = JSON.stringify(arm.mcpConfig);
  const denyList = noDeny ? [] : denyListFor(arm, builtins ?? DENYABLE_BUILTINS);
  const adapter = agent ?? {
    id: 'claude',
    binary: 'claude',
    model: arm.model,
    elicitation: 'stream-json',
    answerFile: null,
    argv: ({ prompt: p, arm: a, model, mcpArg: m, denyList: d }) => [
      '-p', p,
      '--model', model,
      '--output-format', 'stream-json', '--verbose',
      '--allowedTools', a.allowedTools.join(','),
      ...(d?.length ? ['--disallowedTools', d.join(',')] : []),
      '--strict-mcp-config', '--mcp-config', m,
      '--dangerously-skip-permissions',
    ],
  };
  const args = adapter.argv({
    prompt, arm, model: adapter.model ?? arm.model, mcpArg, denyList, answerFile: adapter.answerFile,
  });

  return new Promise((resolve) => {
    const t0 = Date.now();
    let child;
    try {
      // detached so we own a process group and can take the MCP children with us.
      child = spawn(adapter.binary, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ outcome: 'spawn_error', error: err.message, wall_s: 0 });
    }

    let stdout = '', stderr = '', settled = false;
    // The spawn/exit wall-clock instants, recorded as ISO so a cell can be joined against the
    // proxy's token_usage rows by time when no task_id binding was possible (tokens.mjs).
    // Without these the only recoverable token source for copilot/opencode is unavailable.
    const startedAt = new Date(t0).toISOString();
    const finish = (rec) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...rec,
        wall_s: +((Date.now() - t0) / 1000).toFixed(1),
        started_at: startedAt,
        ended_at: new Date().toISOString(),
      });
    };

    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
      // A timer that fires far later than it was set for means THIS process was starved,
      // not that the arm was slow. Recording that as a timeout blames the arm for the
      // host: on the first clean run, three cells were logged as 300s timeouts with
      // wall_s ~950s, because corporate AV was saturating the machine scanning the
      // 5,000-file worktrees this harness creates. `timeout` is a fact about the arm and
      // belongs in hard_fail_rate; `host_stalled` is a fact about the machine and must
      // not be scored or counted against anything.
      const elapsed = Date.now() - t0;
      const starved = elapsed > arm.timeoutMs * HOST_STALL_FACTOR;
      finish({
        outcome: starved ? 'host_stalled' : 'timeout',
        error: starved
          ? `host starved: ${arm.timeoutMs}ms timer fired after ${Math.round(elapsed / 1000)}s `
            + '— the measurement is void, not a slow arm. Check machine load and re-run these cells.'
          : `exceeded ${arm.timeoutMs}ms`,
        stderr: stderr.slice(-300),
      });
    }, arm.timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish({ outcome: 'spawn_error', error: err.message }));
    child.on('close', () => finish(
      adapter.elicitation === 'answer-file'
        ? readAnswerFile({ cwd, answerFile: adapter.answerFile, stdout, stderr })
        : parseStream(stdout, stderr),
    ));
  });
}

/**
 * Collect a non-claude cell's result from the answer file it was told to write.
 *
 * These CLIs have no stream-json equivalent, so tool calls and token usage are NOT
 * recoverable from stdout. Rather than fabricate zeros — which would render as "this agent
 * used no tools and cost nothing", a plausible and completely false row — the fields are
 * left null and filled in later from the proxy's token database, keyed by task id
 * (lib/experiments/token-aggregate.mjs). A null says "not measured here"; a zero would lie.
 *
 * `no_result` when the file is absent is the honest outcome: the agent ran and produced no
 * answer, which is exactly the copilot/opencode early-exit failure mode this elicitation is
 * meant to avoid, and it must stay visible when it still happens.
 */
function readAnswerFile({ cwd, answerFile, stdout, stderr }) {
  const file = path.join(cwd, answerFile);
  let answer = null;
  try {
    if (existsSync(file)) answer = readFileSync(file, 'utf8').trim();
  } catch { /* unreadable is the same as absent for scoring purposes */ }

  if (!answer) {
    return {
      outcome: 'no_result',
      error: `agent wrote no ${answerFile} (early exit before answering is the known failure mode here)`,
      stderr: stderr.slice(-300),
      stdout_tail: String(stdout).slice(-300),
      available_tools: null,
    };
  }
  return {
    outcome: 'ok',
    answer,
    // Unmeasurable on this CLI, not zero. Backfilled from the proxy token DB.
    tool_calls: null,
    tools: null,
    tools_executed: null,
    tools_denied: null,
    available_tools: null,
    in_tokens: null,
    out_tokens: null,
    total_tokens: null,
    num_turns: null,
  };
}

/**
 * Did this tool_result represent a refusal rather than an execution?
 *
 * Claude Code reports a blocked tool as an error result whose text says the tool is
 * disabled. Matching on that text is admittedly brittle, which is why it fails SAFE:
 * anything not recognised as a denial counts as executed, so an unrecognised refusal
 * voids a cell (visible, re-runnable) rather than letting a real escape score.
 */
function isDenial(block, text) {
  if (block.is_error !== true) return false;
  return /\b(disabled|not allowed|no access|denied|permission)\b/i.test(text);
}

/** Parse claude's stream-json into metrics + the final answer. */
function parseStream(stdout, stderr) {
  let toolCalls = 0;
  const tools = [];
  let final = null;
  let toolResultChars = 0;
  // tool_use id -> name, so a call can be matched to its result and we can tell a tool
  // that RAN from one that was refused.
  const pending = new Map();
  const executed = [];
  const denied = [];
  // The CLI announces its actual tool surface at init. Recording it per cell means
  // "was this arm isolated?" is answered by evidence from the session itself, not by
  // trusting that a flag did what it says.
  let availableTools = null;

  for (const line of stdout.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let e;
    try { e = JSON.parse(s); } catch { continue; }

    if (e.type === 'system' && Array.isArray(e.tools)) {
      availableTools = e.tools;
    } else if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b && b.type === 'tool_use') { toolCalls++; tools.push(b.name); pending.set(b.id, b.name); }
      }
    } else if (e.type === 'user') {
      // Tool results come back as user-role blocks; their size is the retrieval
      // payload the arm actually pulled into context.
      for (const b of e.message?.content ?? []) {
        if (b && b.type === 'tool_result') {
          const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
          toolResultChars += text.length;
          const name = pending.get(b.tool_use_id);
          if (name) {
            pending.delete(b.tool_use_id);
            // A denied tool still emits a tool_use block, so counting ATTEMPTS as
            // escapes would void almost every cell — models routinely try Bash and
            // fall back. Only a call that actually ran is an escape.
            (isDenial(b, text) ? denied : executed).push(name);
          }
        }
      }
    } else if (e.type === 'result') {
      final = e;
    }
  }

  if (!final) return { outcome: 'no_result', error: 'no result event', stderr: stderr.slice(-300), available_tools: availableTools };

  // A result event is NOT proof of success. `claude` reports API-level failures
  // (credit exhausted, auth, model unavailable) as a result with is_error set and
  // the message in `result`. Treating those as `ok` scores them like a wrong answer,
  // so a billing outage would silently render as "every arm scored 0" — a plausible
  // looking table built entirely from failures.
  if (final.is_error) {
    return {
      outcome: 'api_error',
      error: String(final.result ?? 'unknown API error').slice(0, 300),
      num_turns: final.num_turns ?? null,
    };
  }

  const u = final.usage ?? {};
  const inTok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const outTok = u.output_tokens ?? 0;

  return {
    outcome: 'ok',
    tool_calls: toolCalls,
    tools,
    tools_executed: executed,
    tools_denied: denied,
    available_tools: availableTools,
    in_tokens: inTok,
    out_tokens: outTok,
    total_tokens: inTok + outTok,
    // Approximate: chars/4. Labelled approximate wherever it is reported.
    tool_result_tokens_est: Math.round(toolResultChars / 4),
    cost_usd: final.total_cost_usd ?? null,
    num_turns: final.num_turns ?? null,
    duration_ms: final.duration_ms ?? null,
    is_error: final.is_error ?? false,
    answer: String(final.result ?? '').trim(),
  };
}

/**
 * Token floor for one (arm, agent, model): what a session costs before any retrieval.
 * content_tokens = total_tokens - baseline, which is the number that actually
 * distinguishes retrieval strategies.
 *
 * THE BASELINE MUST BE MEASURED THE SAME WAY THE CELLS ARE, or subtracting it is
 * meaningless. A claude cell's in_tokens comes from stream-json; a copilot cell's comes from
 * the proxy DB, where cache is accounted differently. Subtracting a stream-json baseline from
 * a DB-derived total would produce a `content_tokens` that is not a difference of anything —
 * so a non-claude baseline is resolved through the SAME path its cells use, and the source is
 * returned alongside so the caller can refuse to mix them.
 *
 * The probe deliberately does NOT use the answer-file elicitation. A baseline wants the floor
 * of starting a session, not an answer, and copilot/opencode exiting immediately on a trivial
 * prompt is exactly the shape being measured — `no_result` is the expected outcome there, and
 * the tokens are still real.
 */
export async function measureBaseline({
  arm, cwd, env, reps = 3, builtins, agent = null, runId = null, tokenOpts = {},
}) {
  const prompt = 'Reply with the single word OK. Do not use any tools.';
  const agentId = agent?.id ?? 'claude';
  const model = agent?.model ?? arm.model;
  const samples = [];
  let available = null;
  let source = null;

  // Same env treatment a cell gets, so the floor is measured under the cell's conditions.
  const bind = bindCellEnv({ agent: agentId, env: env ?? process.env, model });

  for (let i = 0; i < reps; i++) {
    const taskId = runId
      ? cellTaskId({ runId, agent: agentId, model, arm: arm.id, question: 'baseline', rep: i + 1 })
      : null;
    const boundEnv = taskId
      ? bindCellEnv({ agent: agentId, env: env ?? process.env, taskId, model }).env
      : bind.env;
    const r = await runAgent({ prompt, arm, cwd, env: boundEnv, builtins, agent });
    available ??= r.available_tools;

    if (r.in_tokens != null) {
      samples.push(r.in_tokens);
      source ??= 'stream-json';
      continue;
    }
    // No first-party number: recover it the way a cell does. Not gated on outcome — a
    // non-claude probe legitimately ends `no_result` (it was never asked for an answer file)
    // and its tokens are still exactly the floor we are after.
    const t = await resolveCellTokens({
      result: r, agent: agentId, taskId,
      startedAt: r.started_at, endedAt: r.ended_at,
      ...tokenOpts,
    });
    if (t.in_tokens != null) { samples.push(t.in_tokens); source ??= t.token_source; }
  }

  if (!samples.length) {
    return { baseline_in_tokens: null, samples: 0, available_tools: available, source: null };
  }
  samples.sort((a, b) => a - b);
  return {
    baseline_in_tokens: samples[Math.floor(samples.length / 2)],
    samples: samples.length,
    available_tools: available,
    source,
  };
}

/**
 * Run one cell with bounded retries. Both attempts are recorded: retry_rate and
 * hard_fail_rate are separate signals, and collapsing them hides an arm that only
 * works on the second try.
 *
 * `agent` is the resolved adapter (lib/kgbench/agents.mjs); omitting it keeps the claude
 * default and byte-identical argv, so r6/r7 cells stay comparable.
 *
 * TOKENS. The cell owns a composite task_id and both wall-clock instants, and resolves its
 * token fields from them after the agent exits (lib/kgbench/tokens.mjs). Doing it here rather
 * than in runAgent is deliberate: the task_id is per CELL, so one aggregation at the end
 * covers a retried cell's attempts together — which is what the cell actually cost.
 */
export async function runCell({
  arm, question, rep, cwd, env, builtins,
  agent = null, runId = null, wireBind, tokenOpts = {},
}) {
  const prompt = arm.promptPrefix ? `${arm.promptPrefix}\n\n${question.prompt}` : question.prompt;
  const attempts = [];
  const agentId = agent?.id ?? 'claude';
  const model = agent?.model ?? arm.model;

  // A run without a runId (ad-hoc callers, tests) gets no task_id and therefore no bound
  // attribution — the window join still applies, so such a cell is measured, just not tagged.
  const taskId = runId
    ? cellTaskId({ runId, agent: agentId, model, arm: arm.id, question: question.id, rep })
    : null;
  const bind = bindCellEnv({
    agent: agentId, env: env ?? process.env, taskId, model,
    ...(wireBind ? { wireBind } : {}),
  });
  const cellEnv = bind.env;
  let firstStartedAt = null;

  for (let attempt = 1; attempt <= arm.maxAttempts; attempt++) {
    const r = await runAgent({ prompt, arm, cwd, env: cellEnv, builtins, agent });

    // An arm that used a tool it was not granted did not run the strategy this cell
    // claims to measure. Score it and the comparison is between two things that are
    // not what their labels say.
    //
    // `tools_executed` is NULL, not empty, on an answer-file cell: those CLIs emit no tool
    // trace, so there is nothing to audit. The distinction matters twice over. Passing null
    // here used to crash the cell outright — the first copilot and opencode cells ever routed
    // through runCell both died on `Cannot read properties of null (reading 'filter')`, a path
    // no unit test reached because non-claude agents had only ever gone through runAgent. And
    // an empty violation list would read as "audited, clean", which is a stronger claim than
    // "could not be audited". The cell records which one it is.
    if (r.outcome === 'ok') {
      if (r.tools_executed == null) {
        r.tool_audit = 'unavailable';
      } else {
        r.tool_audit = 'audited';
        const escaped = toolViolations(arm, r.tools_executed);
        if (escaped.length) {
          r.outcome = 'tool_escape';
          r.error = `used ungranted tool(s): ${escaped.join(', ')}`;
          r.tool_violations = escaped;
        }
      }
    }

    attempts.push({ attempt, outcome: r.outcome, wall_s: r.wall_s });
    firstStartedAt ??= r.started_at;

    if (r.outcome === 'ok') {
      return finalize(r, { retried: attempt > 1 });
    }
    if (!RETRYABLE.has(r.outcome) || attempt === arm.maxAttempts) {
      return finalize(r, { retried: attempt > 1, hard_fail: true });
    }
  }

  /**
   * Stamp the cell's identity and resolve its tokens.
   *
   * The token window spans the FIRST attempt's start to the LAST attempt's end, so a retried
   * cell is charged for everything it burned — a cell that timed out and succeeded on the
   * second try did not cost only the second try, and reporting it that way would make the
   * least reliable arm look the cheapest.
   *
   * Tokens are resolved for failed cells too. A timeout that consumed 90k tokens producing
   * nothing is exactly the number that should not go missing.
   */
  async function finalize(r, extra) {
    const identity = {
      id: question.id, cls: question.cls, arm: arm.id, rep, attempts,
      agent: agentId,
      model,
      elicitation: agent?.elicitation ?? 'stream-json',
      enforcement: agent?.enforcement ?? null,
      task_id: taskId,
      token_seam: bind.seam,
      ...extra,
    };
    const tokens = await resolveCellTokens({
      result: r,
      agent: agentId,
      taskId,
      startedAt: firstStartedAt ?? r.started_at,
      endedAt: r.ended_at,
      bound: bind.bound,
      ...tokenOpts,
    });
    return { ...r, ...identity, ...tokens };
  }
}
