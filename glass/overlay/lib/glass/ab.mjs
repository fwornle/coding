// lib/glass/ab.mjs — `glass ab`: one coding agent, one prompt, two or more models.
//
// An experiment is a list of variants (a label and the provider/model the agent
// is pointed at) run `repeats` times each. Every round runs each variant once, in
// a fresh random order, so drift over the run (a warming cache, a busy server,
// the network) falls on every variant alike rather than on whichever ran last.
//
// Each trial is a glass session of its own: its calls are rows of the token DB
// under the session's task id, which the experiment file records — that is the
// join. The file lives at <data>/ab/<id>/experiment.json and is rewritten after
// every trial, so the UI and `glass ab report` read a running experiment too.
//
// Result quality is whatever the `--check` command says (its exit code). There is
// no LLM judge: a pass rate is only as good as the check.
//
// This module is the part without side effects on the machine (apart from the
// experiment files): the schedule, the store, the orchestration loop with the
// trial runner injected, and the report. ab-cli.mjs runs real agents.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const AB_AGENTS = Object.freeze(['pi', 'opencode', 'claude', 'copilot']);
const ID = /^ab-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
const LABEL = /^[A-Za-z0-9._-]{1,40}$/;

// ── variants and the agents' command lines ──

/**
 * `label=provider/model`. The model may hold slashes of its own
 * (`local-llama/Qwen/Qwen3.5-4B` → provider local-llama, model Qwen/Qwen3.5-4B).
 * claude and copilot take a bare model (`label=model`): they have no providers.
 */
export function parseVariant(spec, agent) {
  const m = /^([^=]+)=(.+)$/.exec(String(spec || ''));
  if (!m) throw new Error(`--variant ${spec}: expected label=provider/model`);
  const label = m[1].trim();
  if (!LABEL.test(label)) throw new Error(`--variant ${spec}: the label may use letters, digits, '.', '_' and '-' (at most 40)`);
  const target = m[2].trim();
  if (agent === 'claude' || agent === 'copilot') return { label, provider: '', model: target };
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) throw new Error(`--variant ${spec}: ${agent} needs provider/model`);
  return { label, provider: target.slice(0, slash), model: target.slice(slash + 1) };
}

/**
 * The agent's non-interactive command line for one trial. Each runs unattended
 * in a throwaway copy of the repository, so each is given the permission flag
 * it needs to act without asking: a prompt nobody can answer would hang the run.
 */
export function agentArgs(agent, { provider, model }, prompt, extra = []) {
  switch (agent) {
    case 'pi': return ['-p', '--no-session', '--approve', '--provider', provider, '--model', model, ...extra, prompt];
    case 'opencode': return ['run', '-m', `${provider}/${model}`, '--dangerously-skip-permissions', ...extra, prompt];
    case 'claude': return ['-p', prompt, '--model', model, '--permission-mode', 'acceptEdits', ...extra];
    case 'copilot': return ['-p', prompt, '--model', model, '--allow-all-tools', '--no-ask-user', ...extra];
    default: throw new Error(`glass ab: unknown agent "${agent}" (one of ${AB_AGENTS.join(', ')})`);
  }
}

// ── schedule ──

/** A small seeded PRNG (mulberry32): the same seed, the same order. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rounds × variants, each round in its own shuffled order; trial numbers from 1. */
export function schedule(variants, repeats, random = Math.random) {
  const plan = [];
  for (let round = 1; round <= repeats; round++) {
    const order = variants.map((v) => v.label);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const variant of order) plan.push({ n: plan.length + 1, round, variant });
  }
  return plan;
}

// ── the experiment store ──

export const abDir = (dataDir) => path.join(dataDir, 'ab');
export const isExperimentId = (id) => typeof id === 'string' && ID.test(id);

export function experimentId(now = new Date(), rand = crypto.randomBytes(3).toString('hex')) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `ab-${day}-${time}-${rand}`;
}

/** The trial's own directory (agent and check output, its working copy while it runs). */
export function trialDir(dataDir, id, trial) {
  return path.join(abDir(dataDir), id, 'trials', `${String(trial.n).padStart(3, '0')}-${trial.variant}`);
}

/** Written whole and renamed into place: a reader never sees half a file. */
export function saveExperiment(dataDir, exp) {
  const dir = path.join(abDir(dataDir), exp.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'experiment.json');
  const tmp = `${file}.${process.pid}.part`;
  fs.writeFileSync(tmp, `${JSON.stringify(exp, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

export function readExperiment(dataDir, id) {
  if (!isExperimentId(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(abDir(dataDir), id, 'experiment.json'), 'utf8')); } catch { return null; }
}

/** Every experiment, newest first. */
export function listExperiments(dataDir) {
  let names = [];
  try { names = fs.readdirSync(abDir(dataDir)).filter(isExperimentId); } catch { return []; }
  return names.map((id) => readExperiment(dataDir, id)).filter(Boolean)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

const pidAlive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

/** 'running' only while the `glass ab run` that writes it is alive; else 'interrupted'. */
export function effectiveStatus(exp, alive = pidAlive) {
  return exp.status === 'running' && !alive(exp.pid) ? 'interrupted' : exp.status;
}

// ── orchestration ──

/**
 * Run every planned trial in order. `runTrial(trial, variant, exp)` does one —
 * workspace, session, agent, check — and resolves to its result; what it throws
 * is recorded on the trial as `error` (and logged), never dropped: a variant
 * whose agent cannot start must show up as failures, not as fewer trials.
 * The experiment is saved after every trial. An aborted signal stops the loop
 * between trials (the running one is the runner's to stop).
 */
export async function runExperiment(exp, { runTrial, save, signal = null, log = () => {}, now = () => new Date() }) {
  const byLabel = new Map(exp.variants.map((v) => [v.label, v]));
  exp.status = 'running';
  save(exp);
  for (const planned of exp.plan) {
    if (signal?.aborted) break;
    if (exp.trials.some((t) => t.n === planned.n)) continue;
    const variant = byLabel.get(planned.variant);
    const started = now().toISOString();
    log(`trial ${planned.n}/${exp.plan.length} · round ${planned.round} · ${variant.label} (${variant.provider ? `${variant.provider}/` : ''}${variant.model})`);
    let result;
    try {
      result = await runTrial(planned, variant, exp);
    } catch (err) {
      result = { error: String(err?.message || err) };
      log(`  ✗ ${result.error}`);
    }
    exp.trials.push({ ...planned, started_at: started, ended_at: now().toISOString(), ...result });
    save(exp);
  }
  exp.status = signal?.aborted ? 'aborted' : 'done';
  exp.finished_at = now().toISOString();
  save(exp);
  return exp;
}

// ── statistics ──

const nums = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x));

export function mean(xs) {
  const v = nums(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Sample standard deviation (n − 1): repeats are few, and a sample. null below 2 values. */
export function stddev(xs) {
  const v = nums(xs);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** Percentile by linear interpolation between closest ranks (p in 0..100). */
export function percentile(xs, p) {
  const v = nums(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (p / 100) * (v.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return v[lo] + (v[hi] - v[lo]) * (at - lo);
}

// ── the report ──

const has = (db, col) => db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name = ?").get(col).c === 1;

/**
 * The calls of the given sessions, by task id. Columns a token DB from before
 * them does not have read as null (not measured), never 0.
 */
export function callsByTask(db, taskIds) {
  const out = new Map(taskIds.map((t) => [t, []]));
  if (!db || !taskIds.length) return out;
  const col = (name, fallback = 'NULL') => (has(db, name) ? name : fallback);
  const marks = taskIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT task_id, model, provider, input_tokens AS input, output_tokens AS output,
           ${col('cache_read_tokens', '0')} AS cache_read, ${col('reasoning_tokens', '0')} AS reasoning,
           latency_ms, ${col('ttft_ms')} AS ttft_ms, ${col('tool_calls')} AS tool_calls,
           ${col('call_kind', "''")} AS call_kind
    FROM token_usage WHERE task_id IN (${marks}) ORDER BY timestamp
  `).all(...taskIds);
  for (const r of rows) out.get(r.task_id)?.push(r);
  return out;
}

const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
// null when no call reported the value at all (an older daemon, a buffered body).
const sumMeasured = (rows, k) => (rows.some((r) => r[k] !== null && r[k] !== undefined) ? sum(rows, k) : null);
const agentFailed = (t) => Boolean(t.error) || t.timed_out === true || (typeof t.agent_exit === 'number' && t.agent_exit !== 0);

/** One trial with its measured facts — a row of the per-trial table. */
export function trialFacts(t, calls = []) {
  return {
    n: t.n, round: t.round, variant: t.variant, task_id: t.task_id || null,
    started_at: t.started_at || null, wall_ms: t.wall_ms ?? null,
    agent_exit: t.agent_exit ?? null, timed_out: Boolean(t.timed_out), error: t.error || null,
    agent_failed: agentFailed(t),
    check: t.check ? { exit: t.check.exit ?? null, passed: t.check.passed === true, wall_ms: t.check.wall_ms ?? null, timed_out: Boolean(t.check.timed_out) } : null,
    calls: calls.length,
    models: [...new Set(calls.map((c) => c.model))],
    input: sum(calls, 'input'), output: sum(calls, 'output'), reasoning: sum(calls, 'reasoning'), cache_read: sum(calls, 'cache_read'),
    tool_calls: sumMeasured(calls, 'tool_calls'),
    turns: calls.filter((c) => c.call_kind === 'main').length,
    latency_p50_ms: percentile(calls.map((c) => c.latency_ms), 50),
    ttft_p50_ms: percentile(calls.map((c) => c.ttft_ms), 50),
  };
}

/**
 * Per variant: trials, agent failures, the check's pass rate, wall time
 * mean ± sd, call latency p50/p95 and TTFT p50 over all its calls, and the
 * per-trial means of tokens, calls, tool calls and turns. `models` is what the
 * rows say answered — the check that a variant really ran on its model.
 */
export function experimentReport(exp, callsOf = new Map()) {
  const trials = exp.trials.map((t) => trialFacts(t, callsOf.get(t.task_id) || []));
  const variants = exp.variants.map((v) => {
    const mine = trials.filter((t) => t.variant === v.label);
    const calls = mine.flatMap((t) => callsOf.get(t.task_id) || []);
    const checked = mine.filter((t) => t.check);
    const passed = checked.filter((t) => t.check.passed).length;
    const per = (k) => mean(mine.map((t) => t[k]));
    return {
      label: v.label, provider: v.provider, model: v.model,
      models: [...new Set(calls.map((c) => c.model))],
      trials: mine.length,
      planned: exp.plan.filter((p) => p.variant === v.label).length,
      agent_failures: mine.filter((t) => t.agent_failed).length,
      unmeasured: mine.filter((t) => !t.calls).length,
      checked: checked.length, passed,
      pass_rate: checked.length ? passed / checked.length : null,
      wall_ms: { mean: mean(mine.map((t) => t.wall_ms)), sd: stddev(mine.map((t) => t.wall_ms)) },
      latency_ms: { p50: percentile(calls.map((c) => c.latency_ms), 50), p95: percentile(calls.map((c) => c.latency_ms), 95) },
      ttft_ms: { p50: percentile(calls.map((c) => c.ttft_ms), 50), n: nums(calls.map((c) => c.ttft_ms)).length },
      per_trial: {
        input: per('input'), output: per('output'), reasoning: per('reasoning'), cache_read: per('cache_read'),
        calls: per('calls'), tool_calls: per('tool_calls'), turns: per('turns'),
      },
      totals: {
        calls: calls.length, input: sum(calls, 'input'), output: sum(calls, 'output'),
        reasoning: sum(calls, 'reasoning'), cache_read: sum(calls, 'cache_read'), tool_calls: sumMeasured(calls, 'tool_calls'),
      },
    };
  });
  return {
    id: exp.id, label: exp.label || '', agent: exp.agent, prompt: exp.prompt, check: exp.check || null,
    repo: exp.repo, repeats: exp.repeats, seed: exp.seed, status: exp.status,
    created_at: exp.created_at, finished_at: exp.finished_at || null,
    variants, trials,
  };
}

/** One line of the experiment list. */
export function experimentSummary(exp) {
  return {
    id: exp.id, label: exp.label || '', agent: exp.agent, status: exp.status, created_at: exp.created_at,
    finished_at: exp.finished_at || null, repeats: exp.repeats, check: Boolean(exp.check),
    variants: exp.variants.map((v) => ({ label: v.label, provider: v.provider, model: v.model })),
    trials: exp.trials.length, planned: exp.plan.length,
  };
}

// ── formatting ──

const dash = '—';
const fmtMs = (ms) => (ms === null || ms === undefined ? dash : ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const fmtN = (x, digits = 0) => (x === null || x === undefined ? dash : Number(x).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const fmtPct = (x) => (x === null || x === undefined ? dash : `${Math.round(x * 100)} %`);

/** The metric rows of the comparison table: [label, value of a variant]. */
export const METRICS = Object.freeze([
  ['model', (v) => `${v.provider ? `${v.provider}/` : ''}${v.model}`],
  ['answered by', (v) => (v.models.length ? v.models.join(', ') : dash)],
  ['trials', (v) => `${v.trials}${v.trials < v.planned ? ` of ${v.planned}` : ''}`],
  ['agent failures', (v) => String(v.agent_failures)],
  ['unmeasured trials', (v) => String(v.unmeasured)],
  ['pass rate (--check)', (v) => (v.checked ? `${fmtPct(v.pass_rate)} (${v.passed}/${v.checked})` : dash)],
  ['wall time mean ± sd', (v) => (v.wall_ms.mean === null ? dash : `${fmtMs(v.wall_ms.mean)}${v.wall_ms.sd === null ? '' : ` ± ${fmtMs(v.wall_ms.sd)}`}`)],
  ['call latency p50 / p95', (v) => `${fmtMs(v.latency_ms.p50)} / ${fmtMs(v.latency_ms.p95)}`],
  ['TTFT p50', (v) => (v.ttft_ms.n ? `${fmtMs(v.ttft_ms.p50)} (${v.ttft_ms.n} streamed)` : dash)],
  ['tokens in / trial', (v) => fmtN(v.per_trial.input)],
  ['cache read / trial', (v) => fmtN(v.per_trial.cache_read)],
  ['tokens out / trial', (v) => fmtN(v.per_trial.output)],
  ['  of which reasoning', (v) => fmtN(v.per_trial.reasoning)],
  ['calls / trial', (v) => fmtN(v.per_trial.calls, 1)],
  ['tool calls / trial', (v) => fmtN(v.per_trial.tool_calls, 1)],
  ['turns / trial', (v) => fmtN(v.per_trial.turns, 1)],
]);

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

/** The report as text: the header, metrics × variants, then one line per trial. */
export function formatReport(r) {
  const lines = [
    `${r.id}${r.label ? ` · ${r.label}` : ''} · ${r.agent} · ${r.status} · ${r.repeats} round(s)${r.seed !== undefined ? ` · seed ${r.seed}` : ''}`,
    `prompt: ${r.prompt.length > 100 ? `${r.prompt.slice(0, 97)}…` : r.prompt}`,
    `check:  ${r.check || '(none — no pass rate)'}`,
    '',
    table([['', ...r.variants.map((v) => v.label)], ...METRICS.map(([name, f]) => [name, ...r.variants.map(f)])]),
    '',
    table([
      ['trial', 'round', 'variant', 'agent', 'check', 'wall', 'calls', 'in', 'out', 'tools', 'task'],
      ...r.trials.map((t) => [
        t.n, t.round, t.variant,
        t.error ? 'error' : t.timed_out ? 'timeout' : t.agent_exit === null ? dash : `exit ${t.agent_exit}`,
        t.check ? (t.check.passed ? 'pass' : t.check.timed_out ? 'timeout' : `fail ${t.check.exit}`) : dash,
        fmtMs(t.wall_ms), t.calls, fmtN(t.input), fmtN(t.output), t.tool_calls ?? dash, t.task_id || dash,
      ]),
    ]),
  ];
  for (const t of r.trials.filter((x) => x.error)) lines.push(`  trial ${t.n}: ${t.error}`);
  lines.push('', 'Quality is the --check exit code only (no LLM judge). Means are per trial; latency and TTFT over all calls.');
  return lines.join('\n');
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One CSV row per trial, with its variant's model: the shape a spreadsheet or pandas wants. */
export function reportCsv(r) {
  const head = ['experiment', 'trial', 'round', 'variant', 'provider', 'model', 'answered_by', 'task_id', 'wall_ms', 'agent_exit',
    'timed_out', 'error', 'check_exit', 'check_passed', 'calls', 'input', 'output', 'reasoning', 'cache_read', 'tool_calls',
    'turns', 'latency_p50_ms', 'ttft_p50_ms'];
  const byLabel = new Map(r.variants.map((v) => [v.label, v]));
  const rows = r.trials.map((t) => {
    const v = byLabel.get(t.variant) || {};
    return [r.id, t.n, t.round, t.variant, v.provider, v.model, t.models.join(' '), t.task_id, t.wall_ms, t.agent_exit,
      t.timed_out, t.error, t.check?.exit, t.check ? t.check.passed : '', t.calls, t.input, t.output, t.reasoning,
      t.cache_read, t.tool_calls, t.turns, t.latency_p50_ms, t.ttft_p50_ms];
  });
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
