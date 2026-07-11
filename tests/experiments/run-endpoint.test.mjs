// tests/experiments/run-endpoint.test.mjs
//
// Phase 85-04 (Wave 3) — handleExperimentRun + handleRunCancel on
// lib/vkb-server/api-routes.js (ApiRoutes). D-02 dual-source 409 guard,
// spec+override validation, and delegation of the detached host spawn /
// group-kill to the Plan-03 coordinator seam (host.docker.internal:3034).
//
// Isolation idiom mirrors runs-endpoint.test.mjs: invoke the handler via
// Object.create(ApiRoutes.prototype) with `experimentRepoRoot` pointing at a
// seeded throwaway repo-root, so the route runs WITHOUT the heavy
// DatabaseManager constructor and WITHOUT touching the real store. The
// coordinator fetch is injected (ctx._coordinatorFetch) so NO real HTTP fires
// and the delegate body can be asserted.
//
// Pitfall 6: the live-run 409 check + cancel are pure file/pid reads — this
// test proves the handlers never open the experiment LevelDB store.
//
// node:test + node:assert/strict. Output via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { seedIsolatedStore } from './_fixtures/seed-experiment-store.mjs';

/** Minimal Express res double: captures statusCode + json body, chainable. */
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

/** A fresh throwaway repo-root with a .data dir + a valid config/experiments spec. */
function makeRepoRoot(label) {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), `run-endpoint-${label}-`));
  fsSync.mkdirSync(path.join(root, '.data', 'experiments', 'runs'), { recursive: true });
  const specDir = path.join(root, 'config', 'experiments');
  fsSync.mkdirSync(specDir, { recursive: true });
  const spec = {
    goal_sentence: 'Implement a fizzbuzz function that passes the tests.',
    repeats: 1,
    axes: { agent: ['claude'], model: ['sonnet'] },
  };
  fsSync.writeFileSync(path.join(specDir, 'demo.yaml'), yaml.dump(spec));
  return root;
}

/** A handler `this` with the isolated repo-root + injected coordinator fetch. */
async function makeCtx(repoRoot, coordinatorFetch) {
  const { ApiRoutes } = await import('../../lib/vkb-server/api-routes.js');
  const ctx = Object.create(ApiRoutes.prototype);
  ctx.experimentRepoRoot = repoRoot;
  ctx._coordinatorFetch = coordinatorFetch;
  return ctx;
}

/** A coordinator fetch double that records the last request + returns {success,pid}. */
function fakeCoordinator(response = { ok: true, success: true, pid: 4242 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), init });
    return {
      ok: true,
      status: 200,
      json: async () => response,
    };
  };
  fn.calls = calls;
  return fn;
}

// The resolved single variant name for the demo spec (agent-model-framework-env).
// framework/env default to the DEFAULT_AXIS sentinels.
async function resolvedVariantName(repoRoot) {
  const { resolveExperimentSpec } = await import('../../lib/experiments/experiment-spec.mjs');
  const { cellName } = await import('../../lib/experiments/experiment-runner.mjs');
  const { cells } = resolveExperimentSpec(path.join(repoRoot, 'config', 'experiments', 'demo.yaml'));
  return cellName(cells[0]);
}

test('409 interactive: an active measurement span blocks a launch (names the task_id)', async () => {
  const repoRoot = makeRepoRoot('t1');
  const active = { task_id: 'live-span-77', started_at: new Date().toISOString() };
  await fs.writeFile(path.join(repoRoot, '.data', 'active-measurement.json'), JSON.stringify(active));
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.holder.kind, 'interactive');
  assert.equal(res.body.holder.task_id, 'live-span-77');
  assert.equal(coord.calls.length, 0, 'no spawn delegated when blocked');
});

test('409 live-run: a running progress.json with a live pid blocks a launch', async () => {
  const repoRoot = makeRepoRoot('t2');
  const runDir = path.join(repoRoot, '.data', 'experiments', 'runs', 'abc123');
  await fs.mkdir(runDir, { recursive: true });
  // process.pid is guaranteed alive for the duration of the test.
  await fs.writeFile(path.join(runDir, 'progress.json'),
    JSON.stringify({ run_id: 'abc123', overall: 'running', pid: process.pid, cells: [] }));
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.holder.kind, 'experiment');
  assert.equal(res.body.holder.run_id, 'abc123');
  assert.equal(res.body.holder.pid, process.pid);
  assert.equal(coord.calls.length, 0);
});

test('409 cell-span: an experiment cell span (meta.variant) reports kind=experiment, not interactive (85-06)', async () => {
  const repoRoot = makeRepoRoot('t1b');
  const active = {
    task_id: 'exp-x--claude-sonnet-straight-default--r0',
    started_at: new Date().toISOString(),
    meta: { variant: 'claude-sonnet-straight-default', repeat: 0 },
  };
  await fs.writeFile(path.join(repoRoot, '.data', 'active-measurement.json'), JSON.stringify(active));
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.holder.kind, 'experiment', 'a cell span is the RUN holding the slot');
  assert.match(res.body.message, /experiment cell|cancel/i, 'message points at the run, not Measurement Control');
  assert.ok(!/interactive/i.test(res.body.message), 'never mislabelled interactive');
  assert.equal(coord.calls.length, 0);
});

test('run completes → span closed → slot FREE: a completed run dir + no active span accepts a fresh launch (85-06 regression)', async () => {
  const repoRoot = makeRepoRoot('t3b');
  // The post-completion disk state the runner leaves behind: progress overall=complete
  // (span archived by measurement-stop, active-measurement.json REMOVED).
  const runDir = path.join(repoRoot, '.data', 'experiments', 'runs', 'done1');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'progress.json'), JSON.stringify({
    run_id: 'done1', overall: 'complete', pid: process.pid, done: 1, total: 1,
    cells: [{ variant: 'claude-sonnet-straight-default', rep: 0, state: 'complete', task_id: 'exp--v--r0' }],
  }));
  const measDir = path.join(repoRoot, '.data', 'measurements');
  await fs.mkdir(measDir, { recursive: true });
  await fs.writeFile(path.join(measDir, 'exp--v--r0.json'), JSON.stringify({
    task_id: 'exp--v--r0', started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
  }));
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml' } }, res);
  assert.equal(res.statusCode, 200, 'a COMPLETED run must never hold the slot (even with a live-pid progress.json)');
  assert.equal(coord.calls.length, 1, 'the fresh launch was delegated');
});

test('stale-run does NOT block: overall running but a dead pid is ignored', async () => {
  const repoRoot = makeRepoRoot('t3');
  const runDir = path.join(repoRoot, '.data', 'experiments', 'runs', 'stale1');
  await fs.mkdir(runDir, { recursive: true });
  // A pid that is almost certainly not alive (kernel max + guard).
  await fs.writeFile(path.join(runDir, 'progress.json'),
    JSON.stringify({ run_id: 'stale1', overall: 'running', pid: 2 ** 30, cells: [] }));
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml' } }, res);
  assert.equal(res.statusCode, 200, 'a stale run must not block a fresh launch');
  assert.equal(coord.calls.length, 1, 'the fresh launch was delegated');
});

test('clean launch: delegates to the coordinator with {spec, run_id, run_dir, overrides} and returns {run_id, pid}', async () => {
  const repoRoot = makeRepoRoot('t4');
  const coord = fakeCoordinator({ ok: true, success: true, pid: 5150 });
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.run_id, 'a run_id was minted');
  assert.equal(res.body.pid, 5150, 'the coordinator pid is returned');
  assert.equal(coord.calls.length, 1);
  const { body, url } = coord.calls[0];
  assert.match(url, /3034|host\.docker\.internal/, 'delegates to the coordinator seam');
  assert.match(url, /\/experiments\/run/, 'hits the run endpoint');
  assert.equal(body.spec, 'demo.yaml');
  assert.equal(body.run_id, res.body.run_id, 'the delegated run_id matches the minted one');
  assert.ok(body.run_dir.includes(path.join('experiments', 'runs', res.body.run_id)), 'run_dir under .data/experiments/runs/<run_id>');
});

test('clean launch with variantOverrides: forwards the map WHOLE in the coordinator body', async () => {
  const repoRoot = makeRepoRoot('t5');
  const variant = await resolvedVariantName(repoRoot);
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  const overrides = { repeats: 2, variantOverrides: { [variant]: { model: 'opus', agent: 'copilot' } } };
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml', overrides } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(coord.calls.length, 1);
  const forwarded = coord.calls[0].body.overrides;
  assert.deepEqual(forwarded.variantOverrides, { [variant]: { model: 'opus', agent: 'copilot' } },
    'variantOverrides forwarded whole, key NOT renamed');
  assert.equal(forwarded.repeats, 2);
});

test('WR-01: a top-level rerun_of is folded into overrides.rerun_of in the coordinator body', async () => {
  const repoRoot = makeRepoRoot('t5b');
  const coord = fakeCoordinator({ ok: true, success: true, pid: 5151 });
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml', overrides: { repeats: 2 }, rerun_of: 'r0abc' } }, res);
  assert.equal(res.statusCode, 200, 'launch accepted');
  assert.equal(coord.calls.length, 1);
  const forwarded = coord.calls[0].body.overrides;
  assert.equal(forwarded.rerun_of, 'r0abc', 'top-level rerun_of folded into overrides.rerun_of (D-05)');
  assert.equal(forwarded.repeats, 2, 'existing overrides preserved alongside rerun_of');
});

test('WR-01: rerun_of=null is a no-op (no overrides.rerun_of forwarded)', async () => {
  const repoRoot = makeRepoRoot('t5c');
  const coord = fakeCoordinator({ ok: true, success: true, pid: 5152 });
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml', rerun_of: null } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(coord.calls[0].body.overrides.rerun_of, undefined, 'null rerun_of never forwarded');
});

test('WR-01: an ill-shaped rerun_of (traversal) is rejected 400, never forwarded', async () => {
  const repoRoot = makeRepoRoot('t5d');
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml', rerun_of: '../../etc' } }, res);
  assert.equal(res.statusCode, 400, 'ill-shaped rerun_of rejected');
  assert.match(res.body.error, /rerun_of/i);
  assert.equal(coord.calls.length, 0, 'never delegated to the coordinator');
});

test('bad variantOverrides key: a key that is not a resolved variant name -> 400', async () => {
  const repoRoot = makeRepoRoot('t6');
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  const overrides = { variantOverrides: { 'not-a-real-variant': { model: 'opus' } } };
  await ctx.handleExperimentRun({ body: { spec: 'demo.yaml', overrides } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /variant/i);
  assert.equal(coord.calls.length, 0);
});

test('traversal run_id is never built: a ../ spec/run path is rejected 400', async () => {
  const repoRoot = makeRepoRoot('t7');
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  // A spec name carrying a traversal segment must be rejected as unlisted (V5).
  await ctx.handleExperimentRun({ body: { spec: '../../etc/passwd' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(coord.calls.length, 0);
});

test('unlisted spec: a spec not in config/experiments/*.yaml -> 400', async () => {
  const repoRoot = makeRepoRoot('t8');
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleExperimentRun({ body: { spec: 'nonexistent.yaml' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(coord.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Phase 87-07 (CR-02) — FORK MODE: origin_span_id + forkAxes → synthesize + persist
// the avenue spec, forward origin_span_id/avenue through the coordinator.
// ---------------------------------------------------------------------------

/**
 * Seed an isolated experiment store with one origin Run, then add the config/experiments
 * dir + .data/experiments/runs slot the fork path needs (so the synthesized avenue spec is
 * written into a REAL config/experiments and passes the V5 listing gate). Returns the same
 * repoRoot _resolveOriginRun reads from AND synthesizeToYamlFile writes into.
 */
async function seedForkRepoRoot(originTaskId, spanOverrides = {}) {
  const { repoRoot, cleanup } = await seedIsolatedStore(originTaskId, {
    span: {
      goal_sentence: 'Refactor the auth module for the origin span.',
      ...spanOverrides,
    },
    // snapshot_id is a Run TAG (run-write reads t.snapshot_id), not a span field.
    tags: { agent: 'claude', model: 'sonnet', framework: 'straight', snapshot_id: 'snap-origin-1' },
  });
  fsSync.mkdirSync(path.join(repoRoot, 'config', 'experiments'), { recursive: true });
  fsSync.mkdirSync(path.join(repoRoot, '.data', 'experiments', 'runs'), { recursive: true });
  return { repoRoot, cleanup };
}

test('fork: origin_span_id + forkAxes synthesize+persist an avenue spec and forward origin_span_id/avenue (CR-02)', async () => {
  const { repoRoot, cleanup } = await seedForkRepoRoot('origin-xyz');
  try {
    const coord = fakeCoordinator({ ok: true, success: true, pid: 8080 });
    const ctx = await makeCtx(repoRoot, coord);
    const res = mockRes();
    await ctx.handleExperimentRun({
      body: {
        spec: 'ignored-in-fork.yaml', // fork mode overrides the spec with the synthesized basename
        origin_span_id: 'origin-xyz',
        forkAxes: { agents: ['claude', 'copilot'], models: ['opus'], kbOn: true },
      },
    }, res);
    assert.equal(res.statusCode, 200, 'a valid fork launches');
    assert.equal(coord.calls.length, 1, 'the fork was delegated to the coordinator');
    const body = coord.calls[0].body;
    // The synthesized avenue spec basename was persisted + forwarded (NOT the client spec).
    assert.match(body.spec, /^avenue-.*\.yaml$/, 'the persisted avenue-<origin>.yaml basename is forwarded');
    assert.ok(fsSync.existsSync(path.join(repoRoot, 'config', 'experiments', body.spec)), 'avenue spec persisted on disk');
    // origin_span_id + avenue folded into the forwarded overrides (→ run-launch emits the flags).
    assert.equal(body.overrides.origin_span_id, 'origin-xyz', 'origin_span_id folded into overrides');
    assert.equal(body.overrides.avenue, true, 'avenue:true folded into overrides');
    // The synthesized spec carries the origin prompt + snapshot + the 2 chosen agent cells.
    const spec = yaml.load(fsSync.readFileSync(path.join(repoRoot, 'config', 'experiments', body.spec), 'utf8'));
    assert.match(spec.goal_sentence, /Refactor the auth module/, 'origin prompt becomes goal_sentence');
    assert.equal(spec.snapshot_id, 'snap-origin-1', 'origin snapshot carried onto the avenue spec');
    assert.equal(spec.origin_span_id, 'origin-xyz', 'origin_span_id stamped on the synthesized spec');
    assert.equal(spec.variants.length, 2, 'agents:[claude,copilot] × models:[opus] × kb-on → 2 cells');
  } finally {
    cleanup();
  }
});

test('fork: an ill-shaped origin_span_id (traversal) is rejected 400, never resolved or forwarded (T-87-07-02)', async () => {
  const { repoRoot, cleanup } = await seedForkRepoRoot('origin-xyz');
  try {
    const coord = fakeCoordinator();
    const ctx = await makeCtx(repoRoot, coord);
    const res = mockRes();
    await ctx.handleExperimentRun({
      body: { spec: 'demo.yaml', origin_span_id: '../../etc/passwd', forkAxes: { agents: ['claude'] } },
    }, res);
    assert.equal(res.statusCode, 400, 'a path-navigation origin_span_id is rejected');
    assert.match(res.body.error, /origin_span_id/i);
    assert.equal(coord.calls.length, 0, 'never delegated');
  } finally {
    cleanup();
  }
});

test('fork: an unknown origin_span_id (no matching Run) is 404, never forwarded (T-87-07-02)', async () => {
  const { repoRoot, cleanup } = await seedForkRepoRoot('origin-xyz');
  try {
    const coord = fakeCoordinator();
    const ctx = await makeCtx(repoRoot, coord);
    const res = mockRes();
    await ctx.handleExperimentRun({
      body: { spec: 'demo.yaml', origin_span_id: 'no-such-origin', forkAxes: { agents: ['claude'] } },
    }, res);
    assert.equal(res.statusCode, 404, 'an unresolvable origin span is 404');
    assert.equal(coord.calls.length, 0, 'never delegated');
  } finally {
    cleanup();
  }
});

test('fork: a bare fork with no forkAxes seeds one origin-shaped cell (agents/models from the origin Run)', async () => {
  const { repoRoot, cleanup } = await seedForkRepoRoot('origin-xyz');
  try {
    const coord = fakeCoordinator({ ok: true, success: true, pid: 1 });
    const ctx = await makeCtx(repoRoot, coord);
    const res = mockRes();
    await ctx.handleExperimentRun({ body: { spec: 'demo.yaml', origin_span_id: 'origin-xyz' } }, res);
    assert.equal(res.statusCode, 200);
    const body = coord.calls[0].body;
    const spec = yaml.load(fsSync.readFileSync(path.join(repoRoot, 'config', 'experiments', body.spec), 'utf8'));
    assert.equal(spec.variants.length, 1, 'no axes → exactly one origin-seeded cell');
    assert.equal(spec.variants[0].agent, 'claude', 'seeded from the origin Run agent');
    assert.equal(spec.variants[0].model, 'sonnet', 'seeded from the origin Run model');
  } finally {
    cleanup();
  }
});

test('handleRunCancel: reads run.json and delegates the group-kill to the coordinator', async () => {
  const repoRoot = makeRepoRoot('t9');
  const runDir = path.join(repoRoot, '.data', 'experiments', 'runs', 'cancelme');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'run.json'),
    JSON.stringify({ run_id: 'cancelme', pid: 9988, spec: 'demo.yaml' }));
  const coord = fakeCoordinator({ ok: true, success: true, killed: true });
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleRunCancel({ body: { run_id: 'cancelme' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.killed, true);
  assert.equal(coord.calls.length, 1);
  const { body, url } = coord.calls[0];
  assert.match(url, /\/experiments\/cancel/);
  assert.equal(body.run_id, 'cancelme');
  assert.equal(body.pid, 9988, 'the run.json pid is forwarded');
  assert.ok(body.run_dir.includes(path.join('experiments', 'runs', 'cancelme')));
});

test('handleRunCancel: an unknown run -> 404 (no coordinator call)', async () => {
  const repoRoot = makeRepoRoot('t10');
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleRunCancel({ body: { run_id: 'ghost' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(coord.calls.length, 0);
});

test('handleRunCancel: a ../ run_id -> 400 (never builds the path)', async () => {
  const repoRoot = makeRepoRoot('t11');
  const coord = fakeCoordinator();
  const ctx = await makeCtx(repoRoot, coord);
  const res = mockRes();
  await ctx.handleRunCancel({ body: { run_id: '../../etc' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(coord.calls.length, 0);
});
