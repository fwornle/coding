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
