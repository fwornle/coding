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

/** Closed outcome set. Everything that happens is exactly one of these. */
export const OUTCOMES = ['ok', 'timeout', 'no_result', 'spawn_error', 'api_error'];

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
 * Run one headless claude invocation.
 * Never throws — a failure is a result record with an `outcome`, not an exception.
 */
export function runAgent({ prompt, arm, cwd, env = process.env }) {
  env = agentEnv(env);
  const mcpArg = JSON.stringify(arm.mcpConfig);
  const args = [
    '-p', prompt,
    '--model', arm.model,
    '--output-format', 'stream-json', '--verbose',
    '--allowedTools', arm.allowedTools.join(','),
    '--strict-mcp-config', '--mcp-config', mcpArg,
    '--dangerously-skip-permissions',
  ];

  return new Promise((resolve) => {
    const t0 = Date.now();
    let child;
    try {
      // detached so we own a process group and can take the MCP children with us.
      child = spawn('claude', args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ outcome: 'spawn_error', error: err.message, wall_s: 0 });
    }

    let stdout = '', stderr = '', settled = false;
    const finish = (rec) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...rec, wall_s: +((Date.now() - t0) / 1000).toFixed(1) });
    };

    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
      finish({ outcome: 'timeout', error: `exceeded ${arm.timeoutMs}ms`, stderr: stderr.slice(-300) });
    }, arm.timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish({ outcome: 'spawn_error', error: err.message }));
    child.on('close', () => finish(parseStream(stdout, stderr)));
  });
}

/** Parse claude's stream-json into metrics + the final answer. */
function parseStream(stdout, stderr) {
  let toolCalls = 0;
  const tools = [];
  let final = null;
  let toolResultChars = 0;

  for (const line of stdout.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let e;
    try { e = JSON.parse(s); } catch { continue; }

    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b && b.type === 'tool_use') { toolCalls++; tools.push(b.name); }
      }
    } else if (e.type === 'user') {
      // Tool results come back as user-role blocks; their size is the retrieval
      // payload the arm actually pulled into context.
      for (const b of e.message?.content ?? []) {
        if (b && b.type === 'tool_result') {
          toolResultChars += typeof b.content === 'string'
            ? b.content.length
            : JSON.stringify(b.content ?? '').length;
        }
      }
    } else if (e.type === 'result') {
      final = e;
    }
  }

  if (!final) return { outcome: 'no_result', error: 'no result event', stderr: stderr.slice(-300) };

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
 * Per-arm token floor: what a run costs before any retrieval happens.
 * content_tokens = total_tokens - baseline, which is the number that actually
 * distinguishes retrieval strategies.
 */
export async function measureBaseline({ arm, cwd, env, reps = 3 }) {
  const prompt = 'Reply with the single word OK. Do not use any tools.';
  const samples = [];
  for (let i = 0; i < reps; i++) {
    const r = await runAgent({ prompt, arm, cwd, env });
    if (r.outcome === 'ok') samples.push(r.in_tokens);
  }
  if (!samples.length) return { baseline_in_tokens: null, samples: 0 };
  samples.sort((a, b) => a - b);
  return {
    baseline_in_tokens: samples[Math.floor(samples.length / 2)],
    samples: samples.length,
  };
}

/**
 * Run one cell with bounded retries. Both attempts are recorded: retry_rate and
 * hard_fail_rate are separate signals, and collapsing them hides an arm that only
 * works on the second try.
 */
export async function runCell({ arm, question, rep, cwd, env }) {
  const prompt = arm.promptPrefix ? `${arm.promptPrefix}\n\n${question.prompt}` : question.prompt;
  const attempts = [];

  for (let attempt = 1; attempt <= arm.maxAttempts; attempt++) {
    const r = await runAgent({ prompt, arm, cwd, env });
    attempts.push({ attempt, outcome: r.outcome, wall_s: r.wall_s });
    if (r.outcome === 'ok') {
      return { ...r, id: question.id, cls: question.cls, arm: arm.id, rep, attempts, retried: attempt > 1 };
    }
    if (!RETRYABLE.has(r.outcome) || attempt === arm.maxAttempts) {
      return {
        ...r, id: question.id, cls: question.cls, arm: arm.id, rep, attempts,
        retried: attempt > 1, hard_fail: true,
      };
    }
  }
}
