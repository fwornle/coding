// tests/ab.test.mjs — `glass ab`: the schedule, the statistics, the report, the
// working copy, the orchestration with a stubbed trial, and a whole run through
// the CLI with a stand-in agent against a fake model host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import {
  agentArgs, callsByTask, effectiveStatus, experimentId, experimentReport, formatReport, isExperimentId, listExperiments,
  mean, parseVariant, percentile, readExperiment, reportCsv, runExperiment, saveExperiment, schedule, seededRandom, stddev,
} from '../lib/glass/ab.mjs';
import { experimentFromArgs, prepareWorkspace } from '../lib/glass/ab-cli.mjs';
import { abTagOf } from '../lib/glass/ui-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'glass.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-ab-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('variants: provider/model with slashes in the model; claude and copilot take a bare model', () => {
  assert.deepEqual(parseVariant('base=local-llama/Qwen/Qwen3.5-4B', 'pi'), { label: 'base', provider: 'local-llama', model: 'Qwen/Qwen3.5-4B' });
  assert.deepEqual(parseVariant('tuned=cluster/my-adapter', 'opencode'), { label: 'tuned', provider: 'cluster', model: 'my-adapter' });
  assert.deepEqual(parseVariant('fast=claude-haiku-5', 'claude'), { label: 'fast', provider: '', model: 'claude-haiku-5' });
  assert.throws(() => parseVariant('base=Qwen3.5-4B', 'pi'), /needs provider\/model/);
  assert.throws(() => parseVariant('no-equals', 'pi'), /label=provider\/model/);
  assert.throws(() => parseVariant('a b=x/y', 'pi'), /label may use/);
});

test('agent command lines: non-interactive, unattended, the prompt last for pi and opencode', () => {
  const v = { provider: 'local-llama', model: 'Qwen/Qwen3.5-4B' };
  assert.deepEqual(agentArgs('pi', v, 'do it'), ['-p', '--no-session', '--approve', '--provider', 'local-llama', '--model', 'Qwen/Qwen3.5-4B', 'do it']);
  assert.deepEqual(agentArgs('opencode', v, 'do it', ['--agent', 'build']), ['run', '-m', 'local-llama/Qwen/Qwen3.5-4B', '--dangerously-skip-permissions', '--agent', 'build', 'do it']);
  assert.deepEqual(agentArgs('claude', { model: 'm' }, 'do it'), ['-p', 'do it', '--model', 'm', '--permission-mode', 'acceptEdits']);
  assert.throws(() => agentArgs('vim', v, 'x'), /unknown agent/);
});

test('schedule: every round runs each variant once, in an order that varies; a seed repeats it', () => {
  const variants = [{ label: 'a' }, { label: 'b' }, { label: 'c' }];
  const plan = schedule(variants, 20, seededRandom(7));
  assert.equal(plan.length, 60);
  assert.deepEqual(plan.map((p) => p.n), Array.from({ length: 60 }, (_, i) => i + 1));
  for (let r = 1; r <= 20; r++) assert.deepEqual(plan.filter((p) => p.round === r).map((p) => p.variant).sort(), ['a', 'b', 'c']);
  const firsts = new Set(plan.filter((p, i) => i % 3 === 0).map((p) => p.variant));
  assert.ok(firsts.size > 1, 'the first slot is not always the same variant');
  assert.deepEqual(schedule(variants, 20, seededRandom(7)), plan);
});

test('statistics: mean, sample sd, interpolated percentiles; nulls are skipped, not zeros', () => {
  assert.equal(mean([1, 2, 3, null]), 2);
  assert.equal(mean([]), null);
  assert.equal(stddev([5]), null, 'one value has no spread');
  assert.ok(Math.abs(stddev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 1e-3);
  assert.equal(percentile([10, 20, 30, 40], 50), 25);
  assert.equal(percentile([10, 20, 30, 40, null], 100), 40);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], 95), 20);
  assert.equal(percentile([null], 50), null);
});

test('ids and the A/B tag: only well-formed ones pass', () => {
  const id = experimentId(new Date(2026, 10, 15, 9, 5, 7), 'abc123');
  assert.equal(id, 'ab-20261115-090507-abc123');
  assert.ok(isExperimentId(id));
  assert.equal(isExperimentId('../etc'), false);
  assert.deepEqual(abTagOf({ experiment: id, variant: 'base', trial: 2 }), { ab: { experiment: id, variant: 'base', trial: 2 } });
  assert.deepEqual(abTagOf({ experiment: '../x', variant: 'base', trial: 2 }), {});
  assert.deepEqual(abTagOf({ experiment: id, variant: '../x', trial: 2 }), {});
  assert.deepEqual(abTagOf(undefined), {});
});

test('the command line: validated, the plan drawn from the recorded seed', () => {
  const exp = experimentFromArgs([
    '--agent', 'pi', '--variant', 'base=local-llama/Qwen/Qwen3.5-4B', '--variant', 'tuned=cluster/my-adapter',
    '--prompt', 'fix it', '--repeats', '3', '--check', 'node -e 0', '--seed', '42', '--label', 'lora',
  ], { cwd: tmp });
  assert.equal(exp.plan.length, 6);
  assert.equal(exp.seed, 42);
  assert.equal(exp.repo, tmp);
  assert.deepEqual(exp.plan, schedule(exp.variants, 3, seededRandom(42)));
  assert.throws(() => experimentFromArgs(['--agent', 'pi', '--variant', 'a=p/m', '--prompt', 'x'], { cwd: tmp }), /at least twice/);
  assert.throws(() => experimentFromArgs(['--agent', 'pi', '--variant', 'a=p/m', '--variant', 'a=p/n', '--prompt', 'x'], { cwd: tmp }), /own label/);
  assert.throws(() => experimentFromArgs(['--agent', 'pi', '--variant', 'a=p/m', '--variant', 'b=p/n'], { cwd: tmp }), /--prompt/);
  assert.throws(() => experimentFromArgs(['--agent', 'nano', '--variant', 'a=p/m', '--variant', 'b=p/n', '--prompt', 'x'], { cwd: tmp }), /--agent/);
});

test('orchestration: trials in plan order, saved after each; a failing trial is recorded, not dropped; abort stops between trials', async () => {
  const data = path.join(tmp, 'orch');
  const variants = [{ label: 'base', provider: 'p', model: 'm1' }, { label: 'tuned', provider: 'p', model: 'm2' }];
  const exp = { id: 'ab-20261115-100000-000001', agent: 'pi', prompt: 'x', repeats: 2, variants, plan: schedule(variants, 2, seededRandom(1)), trials: [], created_at: '2026-11-15T10:00:00Z' };
  const saves = [];
  const ran = [];
  await runExperiment(exp, {
    save: (e) => { saves.push(e.trials.length); saveExperiment(data, e); },
    runTrial: async (t, v) => {
      ran.push(t.n);
      if (v.label === 'tuned' && t.round === 1) throw new Error('model not loaded');
      return { task_id: `task-${t.n}`, wall_ms: 1000 * t.n, agent_exit: 0, timed_out: false, check: { exit: 0, passed: true } };
    },
  });
  assert.deepEqual(ran, [1, 2, 3, 4]);
  assert.deepEqual(saves, [0, 1, 2, 3, 4, 4]);
  assert.equal(exp.status, 'done');
  const failed = exp.trials.find((t) => t.error);
  assert.equal(failed.error, 'model not loaded');
  assert.equal(failed.variant, 'tuned');
  assert.deepEqual(readExperiment(data, exp.id).trials.length, 4);
  assert.equal(listExperiments(data)[0].id, exp.id);

  const ctl = new AbortController();
  const stopped = { ...exp, id: 'ab-20261115-100000-000002', trials: [] };
  await runExperiment(stopped, { save: () => {}, signal: ctl.signal, runTrial: async (t) => { ctl.abort(); return { task_id: `s-${t.n}` }; } });
  assert.equal(stopped.trials.length, 1);
  assert.equal(stopped.status, 'aborted');
  assert.equal(effectiveStatus({ status: 'running', pid: 0 }), 'interrupted');
  assert.equal(effectiveStatus({ status: 'running', pid: process.pid }), 'running');
});

function tokenDb(withNewColumns) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE token_usage (timestamp TEXT, task_id TEXT, model TEXT, provider TEXT, input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0, latency_ms INTEGER, call_kind TEXT DEFAULT ''
    ${withNewColumns ? ', ttft_ms INTEGER, tool_calls INTEGER' : ''})`);
  return db;
}

test('the report: per variant pass rate, wall mean ± sd, latency p50/p95, TTFT p50, per-trial tokens and what answered', () => {
  const db = tokenDb(true);
  const ins = db.prepare('INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  // trial 1 (base): two calls; trial 2 (tuned): one call; trial 3 (base): one buffered call; trial 4 (tuned): none.
  ins.run('2026-11-15T10:00:01Z', 't1', 'qwen-base', 'local-llama', 100, 10, 50, 0, 400, 'main', 90, 2);
  ins.run('2026-11-15T10:00:02Z', 't1', 'qwen-base', 'local-llama', 120, 20, 60, 5, 600, 'main', 110, 1);
  ins.run('2026-11-15T10:00:03Z', 't2', 'my-adapter', 'cluster', 80, 8, 0, 0, 300, 'main', 40, 0);
  ins.run('2026-11-15T10:00:04Z', 't3', 'qwen-base', 'local-llama', 100, 30, 0, 0, 800, 'side', null, null);
  const variants = [{ label: 'base', provider: 'local-llama', model: 'qwen-base' }, { label: 'tuned', provider: 'cluster', model: 'my-adapter' }];
  const exp = {
    id: 'ab-20261115-100000-00000a', agent: 'pi', prompt: 'fix it', check: 'pytest', repeats: 2, seed: 3, status: 'done', variants,
    plan: [{ n: 1, round: 1, variant: 'base' }, { n: 2, round: 1, variant: 'tuned' }, { n: 3, round: 2, variant: 'base' }, { n: 4, round: 2, variant: 'tuned' }],
    trials: [
      { n: 1, round: 1, variant: 'base', task_id: 't1', wall_ms: 10_000, agent_exit: 0, check: { exit: 0, passed: true } },
      { n: 2, round: 1, variant: 'tuned', task_id: 't2', wall_ms: 4_000, agent_exit: 0, check: { exit: 1, passed: false } },
      { n: 3, round: 2, variant: 'base', task_id: 't3', wall_ms: 14_000, agent_exit: 0, check: { exit: 0, passed: true } },
      { n: 4, round: 2, variant: 'tuned', task_id: 't4', wall_ms: 1_000, agent_exit: 2, check: { exit: 1, passed: false } },
    ],
  };
  const r = experimentReport(exp, callsByTask(db, ['t1', 't2', 't3', 't4']));
  const [base, tuned] = r.variants;
  assert.equal(base.trials, 2);
  assert.equal(base.pass_rate, 1);
  assert.equal(tuned.pass_rate, 0);
  assert.equal(tuned.agent_failures, 1);
  assert.equal(tuned.unmeasured, 1, 'trial 4 recorded no call');
  assert.equal(base.wall_ms.mean, 12_000);
  assert.ok(Math.abs(base.wall_ms.sd - 2828.4) < 0.1);
  assert.equal(base.latency_ms.p50, 600);
  assert.equal(base.ttft_ms.p50, 100);
  assert.equal(base.ttft_ms.n, 2, 'the buffered call has no TTFT');
  assert.deepEqual(base.models, ['qwen-base']);
  assert.equal(base.per_trial.input, 160);
  assert.equal(base.per_trial.reasoning, 2.5);
  assert.equal(base.per_trial.tool_calls, 3, 'trial 3 did not measure tool calls: not a 0 in the mean');
  assert.equal(base.per_trial.turns, 1, 'turns are main-loop calls: 2, then 0');
  assert.equal(r.trials[2].tool_calls, null, 'no call of trial 3 reported tool calls');

  const text = formatReport(r);
  assert.match(text, /pass rate \(--check\)\s+100 % \(2\/2\)\s+0 % \(0\/2\)/);
  assert.match(text, /wall time mean ± sd\s+12\.0 s ± 2828 ms/);
  assert.match(text, /no LLM judge/);
  const csv = reportCsv(r).split('\n');
  assert.equal(csv.length, 5);
  assert.match(csv[0], /^experiment,trial,round,variant,provider,model,/);
  assert.match(csv[1], /^ab-20261115-100000-00000a,1,1,base,local-llama,qwen-base,qwen-base,t1,10000,0,false,,0,true,2,220,30,5,110,3,2,500,100$/);
});

test('the report on a token DB from before ttft_ms / tool_calls: those read as not measured', () => {
  const db = tokenDb(false);
  db.prepare('INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('2026-11-15T10:00:01Z', 't1', 'm', 'p', 1, 2, 0, 0, 50, 'main');
  const [c] = callsByTask(db, ['t1']).get('t1');
  assert.equal(c.ttft_ms, null);
  assert.equal(c.tool_calls, null);
});

const hasGit = spawnSync('git', ['--version']).status === 0;
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test('the working copy: HEAD plus every staged, unstaged, deleted and untracked change — not ignored files', { skip: !hasGit && 'no git' }, () => {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'ab@example.invalid');
  git(repo, 'config', 'user.name', 'ab');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'build/\n');
  fs.writeFileSync(path.join(repo, 'src', 'a.py'), 'a = 1\n');
  fs.writeFileSync(path.join(repo, 'src', 'gone.py'), 'x\n');
  fs.writeFileSync(path.join(repo, 'staged.py'), 'old\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(repo, 'src', 'a.py'), 'a = 2\n'); // unstaged
  fs.writeFileSync(path.join(repo, 'staged.py'), 'new\n');
  git(repo, 'add', 'staged.py'); // staged
  fs.rmSync(path.join(repo, 'src', 'gone.py')); // deleted
  fs.writeFileSync(path.join(repo, 'src', 'fresh.py'), 'f\n'); // untracked
  fs.mkdirSync(path.join(repo, 'build'));
  fs.writeFileSync(path.join(repo, 'build', 'out.bin'), 'x'); // ignored

  const dest = path.join(tmp, 'copy');
  const cwd = prepareWorkspace(path.join(repo, 'src'), dest);
  assert.equal(cwd, path.join(dest, 'src'), 'the agent starts where --repo points inside the checkout');
  assert.equal(fs.readFileSync(path.join(dest, 'src', 'a.py'), 'utf8'), 'a = 2\n');
  assert.equal(fs.readFileSync(path.join(dest, 'staged.py'), 'utf8'), 'new\n');
  assert.equal(fs.existsSync(path.join(dest, 'src', 'gone.py')), false);
  assert.equal(fs.readFileSync(path.join(dest, 'src', 'fresh.py'), 'utf8'), 'f\n');
  assert.equal(fs.existsSync(path.join(dest, 'build')), false);
  assert.equal(git(dest, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.equal(git(dest, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'HEAD'));
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'a.py'), 'utf8'), 'a = 2\n', 'the original is untouched');
});

// ── a whole run through the CLI ──

// A model host: an Anthropic stream that answers with the model it was asked
// for, and (for a model named *tools*) one tool_use block.
let reqSeq = 0;
function fakeAnthropic() {
  return http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body || '{}');
    reqSeq += 1;
    const frame = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': `req_ab_${reqSeq}` });
    res.write(frame({ type: 'message_start', message: { id: `m${reqSeq}`, model: j.model, usage: { input_tokens: 40, output_tokens: 1 } } }));
    await new Promise((r) => setTimeout(r, 20));
    res.write(frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }));
    if (/tools/.test(j.model)) res.write(frame({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'Edit' } }));
    res.end(frame({ type: 'message_delta', usage: { output_tokens: 7 } }) + frame({ type: 'message_stop' }));
  });
}

// A stand-in claude: one streamed call with the --model it was given; writes
// done.txt (the check looks for it) unless the model is named *lazy*.
function standInAgent(dir) {
  const file = path.join(dir, 'stand-in-agent.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
const model = process.argv[process.argv.indexOf('--model') + 1];
const headers = { 'content-type': 'application/json', 'x-api-key': 'sk-user' };
for (const l of (process.env.ANTHROPIC_CUSTOM_HEADERS || '').split('\\n')) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
const r = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST', headers,
  body: JSON.stringify({ model, max_tokens: 8, stream: true, messages: [{ role: 'user', content: 'go' }] }) });
await r.text();
if (!/lazy/.test(model)) fs.writeFileSync('done.txt', 'yes');
process.stdout.write('ran ' + model + ' in ' + process.cwd() + '\\n');
`);
  fs.chmodSync(file, 0o755);
  return file;
}

const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

function runCli(args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { PATH: process.env.PATH, HOME: tmp, HEALTH_COORDINATOR_URL: 'http://127.0.0.1:9', ...env } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI: glass ab run → interleaved measured trials, checked; report and list read them back', { skip: process.platform === 'win32' && 'POSIX stand-in agent' }, async () => {
  const upstream = fakeAnthropic();
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const home = path.join(tmp, 'cli-home');
  const work = path.join(tmp, 'cli-repo');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'task.txt'), 'the task');
  const port = await freePort();
  const env = {
    GLASS_HOME: home, GLASS_PORT: String(port), GLASS_CLAUDE_BIN: standInAgent(tmp),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
  };
  try {
    const run = await runCli([
      'ab', 'run', '--agent', 'claude', '--variant', 'base=model-tools', '--variant', 'tuned=model-lazy',
      '--prompt', 'do the task', '--repeats', '2', '--seed', '5', '--label', 'smoke',
      '--check', `node -e "process.exit(require('fs').existsSync('done.txt') ? 0 : 1)"`,
    ], env, work);
    assert.equal(run.code, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /glass ab ab-\d{8}-\d{6}-[0-9a-f]{6}: claude, base vs tuned, 2 round\(s\), seed 5/);
    assert.match(run.stdout, /pass rate \(--check\)\s+100 % \(2\/2\)\s+0 % \(0\/2\)/);

    const report = JSON.parse((await runCli(['ab', 'report', 'latest', '--json'], env, work)).stdout);
    const [base, tuned] = report.variants;
    assert.deepEqual([base.trials, tuned.trials], [2, 2]);
    assert.deepEqual(base.models, ['model-tools'], 'each variant answered with its own model');
    assert.deepEqual(tuned.models, ['model-lazy']);
    assert.equal(base.totals.calls, 2);
    assert.equal(base.totals.tool_calls, 2);
    assert.equal(tuned.totals.tool_calls, 0);
    assert.equal(base.per_trial.output, 7);
    assert.equal(base.ttft_ms.n, 2, 'both streamed calls were timed to their first token');
    assert.equal(base.agent_failures + tuned.agent_failures, 0);
    assert.deepEqual(report.trials.map((t) => t.round), [1, 1, 2, 2]);
    for (const t of report.trials) assert.match(t.task_id, /^glass-claude-/);
    // The session span says which experiment, variant and trial it was.
    const span = JSON.parse(fs.readFileSync(path.join(home, 'data', 'measurements', `${report.trials[0].task_id}.json`), 'utf8'));
    assert.deepEqual(span.meta.ab, { experiment: report.id, variant: report.trials[0].variant, trial: 1 });
    // Each trial's output is kept; its copy is not.
    const trialDir = path.join(home, 'data', 'ab', report.id, 'trials', `001-${report.trials[0].variant}`);
    assert.match(fs.readFileSync(path.join(trialDir, 'agent.log'), 'utf8'), /^ran model-/);
    assert.equal(fs.existsSync(path.join(trialDir, 'work')), false);
    assert.equal(fs.readFileSync(path.join(work, 'task.txt'), 'utf8'), 'the task');
    assert.equal(fs.existsSync(path.join(work, 'done.txt')), false, 'the agent worked in its copy, not in the repo');

    const csv = (await runCli(['ab', 'report', report.id, '--csv'], env, work)).stdout.trim().split('\n');
    assert.equal(csv.length, 5);
    const list = await runCli(['ab', 'list'], env, work);
    assert.match(list.stdout, new RegExp(`${report.id}\\s+done\\s+claude\\s+4/4 trials\\s+base vs tuned\\s+· smoke`));
    const api = await (await fetch(`http://127.0.0.1:${port}/api/ab/${report.id}`)).json();
    assert.equal(api.report.id, report.id);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/ab/ab-20200101-000000-ffffff`)).status, 404);
  } finally {
    await runCli(['stop'], env, work);
    await new Promise((r) => upstream.close(r));
  }
});
