// tests/experiments/experiment-runner.test.mjs
//
// RUN-02/03/04 proof for lib/experiments/experiment-runner.mjs — the sequential,
// idempotent, resumable cross-agent matrix loop.
//
// Task 1: launchCell — the terminal-state machine (spawn + 20-min SIGTERM→SIGKILL timer):
//         exit0→complete, exitN→abort, hang→timeout; cwd=worktree, env.LLM_PROXY_DATA_DIR;
//         async (a hung agent does not block the returned promise before the timer fires).
// Task 2: runCell — restore → measured span → launch → inline score in a finally (no cell
//         dropped on abort/timeout; fixed-argv child processes for start/stop).
// Task 3: runMatrix — strictly-sequential idempotent loop, resume done-set (skip only
//         complete; retry timeout/abort), copilot probe gate + recorded skip-Run, and
//         best-effort agent-failure recording.
//
// Pure unit suite: every side-effecting collaborator (restore, agent spawn, measurement
// start/stop, resume ledger, copilot probe, store) is an INJECTED seam. The one real
// child process is the stub-agent fixture, used only for the terminal-state mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { launchCell, runCell, runMatrix, composeTaskId, cellName, configureProxyRoutingEnv } from '../../lib/experiments/experiment-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.resolve(__dirname, '_fixtures', 'stub-agent.mjs');

// A fake child_process handle: an EventEmitter with a spy .kill(). Tests drive terminal
// states by emitting 'exit'/'error' explicitly, so no real process or timer is needed.
function fakeChild() {
  const child = new EventEmitter();
  child.killed = [];
  child.kill = (sig) => { child.killed.push(sig); return true; };
  return child;
}

// ---------------------------------------------------------------------------
// Task 1: launchCell — terminal-state machine
// ---------------------------------------------------------------------------

test('launchCell: a stub agent exiting 0 resolves terminal_state complete', async () => {
  const state = await launchCell({
    bin: process.execPath,
    argv: [STUB, 'exit0'],
    worktree: process.cwd(),
    sandboxDataDir: path.join(process.cwd(), '.data'),
    stdio: 'ignore',
  });
  assert.equal(state, 'complete');
});

test('launchCell: a stub agent exiting non-zero resolves abort', async () => {
  const state = await launchCell({
    bin: process.execPath,
    argv: [STUB, 'exitN'],
    worktree: process.cwd(),
    sandboxDataDir: path.join(process.cwd(), '.data'),
    stdio: 'ignore',
  });
  assert.equal(state, 'abort');
});

test('launchCell: a hanging stub is SIGTERM-killed after the timeout and resolves timeout', async () => {
  const state = await launchCell({
    bin: process.execPath,
    argv: [STUB, 'hang'],
    worktree: process.cwd(),
    sandboxDataDir: path.join(process.cwd(), '.data'),
    timeoutMs: 150, // test-shortened wall-clock timer
    graceMs: 150,
    stdio: 'ignore',
  });
  assert.equal(state, 'timeout');
});

test('launchCell: child is spawned with cwd=worktree and env.LLM_PROXY_DATA_DIR=sandboxDataDir', async () => {
  let capturedOpts = null;
  const fakeSpawn = (_bin, _argv, opts) => {
    capturedOpts = opts;
    const child = fakeChild();
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  };
  const state = await launchCell({
    bin: 'agent-bin',
    argv: ['-p', 'goal'],
    worktree: '/sandbox/worktree',
    sandboxDataDir: '/sandbox/worktree/.data',
    spawn: fakeSpawn,
  });
  assert.equal(state, 'complete');
  assert.equal(capturedOpts.cwd, '/sandbox/worktree');
  assert.equal(capturedOpts.env.LLM_PROXY_DATA_DIR, '/sandbox/worktree/.data');
});

test('launchCell: uses async spawn — a hanging agent does not block the returned promise', async () => {
  // A fake child that never emits exit: the returned promise must stay pending. Race it
  // against a short sentinel; the sentinel MUST win (the launch promise did not resolve).
  const fakeSpawn = () => fakeChild();
  const launch = launchCell({
    bin: 'agent-bin',
    argv: [],
    worktree: '/w',
    sandboxDataDir: '/w/.data',
    // Longer than the sentinel so the launch promise is provably still pending when the
    // sentinel wins; short + tiny grace so no timer dangles past the test (the fake child
    // never emits exit, so the promise settling is irrelevant — only non-blocking matters).
    timeoutMs: 300,
    graceMs: 5,
    spawn: fakeSpawn,
  });
  const sentinel = new Promise((r) => setTimeout(() => r('pending'), 50));
  const winner = await Promise.race([launch.then(() => 'resolved'), sentinel]);
  assert.equal(winner, 'pending');
});

// ---------------------------------------------------------------------------
// Task 2: runCell — restore → measured span → launch → inline score in a finally
// ---------------------------------------------------------------------------

const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'config', 'agents');
const CELL = { agent: 'claude', model: 'sonnet', framework: 'none', env: 'default' };

// Build a runCell invocation with recording seams; `terminal` sets the fake agent result.
// `configureRouting` defaults to a passthrough so no live proxy is probed; a test may inject
// the real helper (with a fake probe) to assert routing. The span uses an explicit MAIN
// dataDir ('/main/.data') distinct from the sandbox ('/wt/.data') to prove the split.
function runCellWith({ terminal = 'complete', cell = CELL, taskClass, configureRouting } = {}) {
  const calls = [];
  let agentSpawnEnv;
  const restore = async () => ({ worktree: '/wt', sandboxDataDir: '/wt/.data' });
  const runMeasurement = async (phase, argv, o) => {
    calls.push({ phase, argv, env: o?.env });
    return 0;
  };
  const spawnAgent = async ({ env }) => { agentSpawnEnv = env; return terminal; };
  const promise = runCell({
    cell,
    rep: 0,
    expId: 'exp1',
    goal: 'do a thing',
    snapshotId: 'snap-1',
    taskClass,
    agentsDir: AGENTS_DIR,
    dataDir: '/main/.data',
    restore,
    runMeasurement,
    spawnAgent,
    configureRouting: configureRouting || (async (_a, env) => env),
  });
  return { promise, calls, get agentSpawnEnv() { return agentSpawnEnv; } };
}

test('runCell: restores then measurement-start with composite task_id + variant/repeat/agent + span→MAIN dataDir', async () => {
  const { promise, calls } = runCellWith({ terminal: 'complete' });
  const res = await promise;
  const start = calls.find((c) => c.phase === 'start');
  assert.ok(start, 'measurement-start was invoked');
  const a = start.argv;
  assert.ok(Array.isArray(a), 'start argv is a fixed array (no shell string)');
  assert.equal(a[a.indexOf('--task-id') + 1], 'exp1--claude-sonnet-none-default--r0');
  assert.equal(a[a.indexOf('--variant') + 1], 'claude-sonnet-none-default');
  assert.equal(a[a.indexOf('--repeat') + 1], '0');
  assert.equal(a[a.indexOf('--agent') + 1], 'claude');
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
  assert.equal(a[a.indexOf('--framework') + 1], 'none');
  assert.ok(a.includes('--goal'));
  // The span MUST be written to the MAIN data dir (the shared proxy's dir), NOT the sandbox —
  // this is what makes the proxy stamp the run's task_id onto captured token rows.
  assert.equal(start.env.LLM_PROXY_DATA_DIR, '/main/.data');
  assert.equal(res.terminalState, 'complete');
});

test('runCell: on complete, measurement-stop runs once with --headless --terminal-state complete + span→MAIN dataDir', async () => {
  const { promise, calls } = runCellWith({ terminal: 'complete' });
  await promise;
  const stops = calls.filter((c) => c.phase === 'stop');
  assert.equal(stops.length, 1);
  assert.ok(stops[0].argv.includes('--headless'));
  assert.equal(stops[0].argv[stops[0].argv.indexOf('--terminal-state') + 1], 'complete');
  // stop aggregates from the MAIN token-usage.db → span env is the MAIN dir, matching start.
  assert.equal(stops[0].env.LLM_PROXY_DATA_DIR, '/main/.data');
});

test('runCell: on abort, measurement-stop STILL runs (finally) with the mapped --terminal-state abort', async () => {
  const { promise, calls } = runCellWith({ terminal: 'abort' });
  const res = await promise;
  const stops = calls.filter((c) => c.phase === 'stop');
  assert.equal(stops.length, 1, 'no cell dropped — stop runs on abort too');
  assert.equal(stops[0].argv[stops[0].argv.indexOf('--terminal-state') + 1], 'abort');
  assert.equal(res.terminalState, 'abort');
});

test('runCell: on timeout, measurement-stop STILL runs with --terminal-state timeout', async () => {
  const { promise, calls } = runCellWith({ terminal: 'timeout' });
  await promise;
  const stops = calls.filter((c) => c.phase === 'stop');
  assert.equal(stops[0].argv[stops[0].argv.indexOf('--terminal-state') + 1], 'timeout');
});

test('runCell: start + stop are fixed-argv arrays of strings (no shell string) and carry --task-class when set', async () => {
  const { promise, calls } = runCellWith({ terminal: 'complete', taskClass: 'feature' });
  await promise;
  for (const c of calls) {
    assert.ok(Array.isArray(c.argv), `${c.phase} argv is an array`);
    for (const el of c.argv) assert.equal(typeof el, 'string', `${c.phase} argv element is a string`);
  }
  const stop = calls.find((c) => c.phase === 'stop');
  assert.equal(stop.argv[stop.argv.indexOf('--task-class') + 1], 'feature');
});

test('runCell: opencode is spawned with proxy routing (ANTHROPIC_BASE_URL) + sandbox LLM_PROXY_DATA_DIR', async () => {
  // Inject the REAL configureProxyRoutingEnv with a fake probe reporting the proxy up. opencode
  // is the proxy-routed agent (claude/copilot use their own file adapters and are NOT routed).
  const routing = async (agent, env) =>
    configureProxyRoutingEnv(agent, env, { port: 12435, probe: async () => ({ status: 'running' }), route: '1' });
  const cell = { agent: 'opencode', model: 'rapid-proxy/claude-haiku-4-5', framework: 'straight', env: 'default' };
  const handle = runCellWith({ terminal: 'complete', cell, configureRouting: routing });
  await handle.promise;
  const env = handle.agentSpawnEnv;
  assert.ok(env, 'agent spawn env was captured');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12435', 'opencode routed through the proxy');
  assert.equal(env.LLM_PROXY_DATA_DIR, '/wt/.data', 'agent keeps sandbox data dir (isolation preserved)');
});

test('configureProxyRoutingEnv: opencode routes+keeps key; claude is NOT routed (transcript adapter); unreachable/opt-out→unrouted', async () => {
  const up = async () => ({ status: 'running' });
  const down = async () => ({ status: 'stopped', error: 'ECONNREFUSED' });
  const base = { ANTHROPIC_API_KEY: 'k', LLM_PROXY_DATA_DIR: '/wt/.data' };

  const oc = await configureProxyRoutingEnv('opencode', base, { port: 12435, probe: up, route: '1' });
  assert.equal(oc.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12435');
  assert.equal(oc.ANTHROPIC_API_KEY, 'k', 'opencode keeps its own credential');

  // claude is deliberately NOT proxy-routed even when the proxy is up — it is captured via its
  // ~/.claude transcript adapter (which includes cache tokens); routing it would record
  // cache-excluded rows that beat the accurate transcript rows on dedup. The coding session
  // EXPORTS ANTHROPIC_BASE_URL, so an INHERITED value must be actively DELETED, not just left unset.
  const inherited = { ...base, ANTHROPIC_BASE_URL: 'http://127.0.0.1:12435' };
  const cl = await configureProxyRoutingEnv('claude', inherited, { port: 12435, probe: up, route: '1' });
  assert.ok(!('ANTHROPIC_BASE_URL' in cl), 'claude drops the inherited ANTHROPIC_BASE_URL → goes direct, transcript captures it');
  assert.equal(cl.ANTHROPIC_API_KEY, 'k', 'claude keeps its own creds');

  const unreachable = await configureProxyRoutingEnv('opencode', base, { port: 12435, probe: down, route: '1' });
  assert.ok(!('ANTHROPIC_BASE_URL' in unreachable), 'proxy down → launched unrouted (fail-soft)');

  const optOut = await configureProxyRoutingEnv('opencode', base, { port: 12435, probe: up, route: '0' });
  assert.ok(!('ANTHROPIC_BASE_URL' in optOut), 'CODING_PROXY_ROUTE=0 → unrouted');
});

// ---------------------------------------------------------------------------
// Task 3: runMatrix — sequential idempotent loop + copilot probe gate + skip-Run
// ---------------------------------------------------------------------------

// A fake single-owner store that counts open/close so tests prove single-owner discipline.
function fakeStore() {
  const s = { closed: 0, close: async () => { s.closed += 1; } };
  return s;
}

// Base seams for a runMatrix invocation. `cells` is served through an injected resolveSpec
// so tests fully control the matrix (incl. agents real validateCells would reject, e.g.
// mastracode). Every side effect is recorded for assertions.
function matrixHarness({ cells, repeats = 1, done = [], copilotOk = true, spawnImpl } = {}) {
  const rec = { starts: [], stops: [], launched: [], opens: 0 };
  const store = fakeStore();
  const resolveSpec = () => ({ goal_sentence: 'do a thing', repeats, cells });
  const openStore = async () => { rec.opens += 1; return store; };
  const readDone = async () => done;
  const probeCopilot = () => copilotOk;
  const restore = async () => ({ worktree: '/wt', sandboxDataDir: '/wt/.data' });
  const runMeasurement = async (phase, argv) => {
    if (phase === 'start') rec.starts.push(argv);
    else rec.stops.push(argv);
    return 0;
  };
  const defaultSpawn = async ({ argv }) => { rec.launched.push(argv); return 'complete'; };
  const spawnAgent = spawnImpl || defaultSpawn;
  // Passthrough routing seam so runMatrix→runCell never probes a live proxy under test.
  const configureRouting = async (_agent, env) => env;
  return { rec, store, opts: {
    expId: 'exp1', snapshotId: 'snap-1', agentsDir: AGENTS_DIR,
    resolveSpec, openStore, readDone, probeCopilot, restore, runMeasurement, spawnAgent, configureRouting,
  } };
}

test('runMatrix: iterates cells × repeats strictly sequentially (store opened once; no overlap)', async () => {
  let active = 0;
  let maxActive = 0;
  const spawnImpl = async ({ argv }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setImmediate(r));
    active -= 1;
    return 'complete';
  };
  const cells = [
    { agent: 'claude', model: 'm', framework: 'none', env: 'default' },
    { agent: 'opencode', model: 'm', framework: 'none', env: 'default' },
  ];
  const { rec, store, opts } = matrixHarness({ cells, repeats: 2, spawnImpl });
  const summary = await runMatrix({}, opts);
  assert.equal(maxActive, 1, 'cells never overlap (single-owner sequential)');
  assert.equal(rec.opens, 1, 'store opened exactly once');
  assert.equal(store.closed, 1, 'store closed before launching cells');
  assert.equal(summary.length, 4, 'one result per variant×repeat');
});

test('runMatrix: resume skips ONLY completed cells; timeout/abort cells are re-run (Q3)', async () => {
  const cells = [{ agent: 'claude', model: 'm', framework: 'none', env: 'default' }];
  const done = [
    { task_id: 'exp1--claude-m-none-default--r0', terminal_state: 'complete' },
    { task_id: 'exp1--claude-m-none-default--r1', terminal_state: 'timeout' },
  ];
  const { rec, opts } = matrixHarness({ cells, repeats: 2, done });
  const summary = await runMatrix({}, opts);
  const r0 = summary.find((s) => s.task_id.endsWith('--r0'));
  const r1 = summary.find((s) => s.task_id.endsWith('--r1'));
  assert.equal(r0.status, 'skipped');
  assert.equal(r0.reason, 'already-complete');
  assert.equal(r1.status, 'ran', 'a prior timeout cell is retried');
  assert.equal(rec.launched.length, 1, 'only the re-run cell launched an agent');
});

test('runMatrix: probe=false lands a recorded copilot skip-Run (no agent launched)', async () => {
  const cells = [{ agent: 'copilot', model: 'm', framework: 'none', env: 'default' }];
  const { rec, opts } = matrixHarness({ cells, repeats: 1, copilotOk: false });
  const summary = await runMatrix({}, opts);
  assert.equal(rec.launched.length, 0, 'no agent launched for a probe-failed copilot cell');
  // A skip-Run is recorded via start + stop with --skip-reason.
  assert.equal(rec.starts.length, 1);
  const stop = rec.stops[0];
  assert.ok(stop.includes('--skip-reason'));
  assert.equal(stop[stop.indexOf('--skip-reason') + 1], 'copilot-headless-unsupported');
  assert.equal(summary[0].status, 'skipped');
  assert.equal(summary[0].reason, 'copilot-headless-unsupported');
});

test('runMatrix: probe=true runs copilot cells through the normal launch path', async () => {
  const cells = [{ agent: 'copilot', model: 'm', framework: 'none', env: 'default' }];
  const { rec, opts } = matrixHarness({ cells, repeats: 1, copilotOk: true });
  const summary = await runMatrix({}, opts);
  assert.equal(rec.launched.length, 1, 'copilot cell launched an agent when the probe passed');
  assert.equal(summary[0].status, 'ran');
  assert.equal(summary[0].terminal_state, 'complete');
});

test('runMatrix: a cell whose launch throws is recorded best-effort — the matrix does not stall', async () => {
  const cells = [
    { agent: 'mastracode', model: 'm', framework: 'mastra', env: 'default' },
    { agent: 'claude', model: 'm', framework: 'none', env: 'default' },
  ];
  const spawnImpl = async ({ argv }) => {
    if (argv.join(' ').includes('--prompt')) throw new Error('spawn ENOENT: mastra binary missing');
    return 'complete';
  };
  const { opts } = matrixHarness({ cells, repeats: 1, spawnImpl });
  const summary = await runMatrix({}, opts);
  assert.equal(summary.length, 2, 'the matrix continued past the failing cell');
  const mastra = summary.find((s) => s.task_id.includes('mastracode'));
  assert.equal(mastra.status, 'ran');
  assert.equal(mastra.terminal_state, 'abort', 'a launch failure is recorded as abort (best-effort)');
  const claude = summary.find((s) => s.task_id.includes('claude'));
  assert.equal(claude.terminal_state, 'complete');
});

test('runMatrix: summary lists one result per attempted cell with a status', async () => {
  const cells = [
    { agent: 'claude', model: 'm', framework: 'none', env: 'default' },
    { agent: 'opencode', model: 'm', framework: 'none', env: 'default' },
  ];
  const { opts } = matrixHarness({ cells, repeats: 2 });
  const summary = await runMatrix({}, opts);
  assert.equal(summary.length, 4);
  for (const s of summary) {
    assert.ok(['ran', 'skipped'].includes(s.status));
    assert.ok(typeof s.task_id === 'string' && s.task_id.startsWith('exp1--'));
  }
});

test('composeTaskId slugifies path separators so an opencode provider/model task_id stays filesystem-safe (fix B) while the variant keeps the slash', () => {
  const cell = { agent: 'opencode', model: 'rapid-proxy/claude-haiku-4-5', framework: 'straight', env: 'default' };
  const taskId = composeTaskId('exp-abc', cell, 0);
  // task_id must carry NO path separator — it is used as a filesystem key downstream (D-10 resume).
  assert.ok(!taskId.includes('/'), `task_id must not contain '/': ${taskId}`);
  assert.ok(!taskId.includes('\\'), `task_id must not contain '\\': ${taskId}`);
  assert.equal(taskId, 'exp-abc--opencode-rapid-proxy-claude-haiku-4-5-straight-default--r0');
  // The variant tag (cellName) intentionally stays human-readable, slash preserved.
  assert.equal(cellName(cell), 'opencode-rapid-proxy/claude-haiku-4-5-straight-default');
});
