// tests/experiments/agent-routing.test.mjs
//
// Phase 88, Plan 88-01 (ALIGN-01) — the model-resolution contract for
// lib/experiments/agent-routing.mjs. (The routing env a cell gets is the launcher's —
// lib/agents/proxy-routing.mjs, pinned by tests/agents/proxy-routing-parity.test.mjs.)
//
// Task 1: resolveCellModel (dash→dot opencode normalization KEEPING the rapid-proxy/ prefix;
//         copilot `auto`→measured-default; claude/pi passthrough).
// Task 2: the runCell wiring — a copilot 'auto' cell spawns with the RESOLVED launch model while
//         its recorded task_id/variant keep the ORIGINAL model (task_hash comparability, D-05).
//
// Pure unit suite: agent-routing.mjs is side-effect-free; runCell's collaborators are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveCellModel,
  COPILOT_MEASURED_DEFAULT_MODEL,
} from '../../lib/experiments/agent-routing.mjs';
import { runCell, cellName, composeTaskId, configureProxyRoutingEnv } from '../../lib/experiments/experiment-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'config', 'agents');

// ---------------------------------------------------------------------------
// Task 1: resolveCellModel — the behavior table
// ---------------------------------------------------------------------------

test('resolveCellModel: opencode dash-version → dot-version, KEEPING the rapid-proxy/ prefix', () => {
  // The dogfood "Model not found: rapid-proxy/claude-haiku-4-5" was a dash-vs-dot TYPO; the
  // rapid-proxy provider is REAL (~/.config/opencode/opencode.json). Fix is 4-5→4.5, prefix kept.
  assert.equal(resolveCellModel('opencode', 'rapid-proxy/claude-haiku-4-5'), 'rapid-proxy/claude-haiku-4.5');
  assert.equal(resolveCellModel('opencode', 'rapid-proxy/claude-opus-4-6'), 'rapid-proxy/claude-opus-4.6');
});

test('resolveCellModel: opencode already-dotted id is an idempotent passthrough', () => {
  assert.equal(resolveCellModel('opencode', 'rapid-proxy/claude-haiku-4.5'), 'rapid-proxy/claude-haiku-4.5');
});

test('resolveCellModel: opencode KEEPS the rapid-proxy/ provider prefix (no anthropic/ swap)', () => {
  assert.ok(resolveCellModel('opencode', 'rapid-proxy/claude-haiku-4-5').startsWith('rapid-proxy/'));
});

test('resolveCellModel: copilot auto (and empty) → the copilot measured default', () => {
  assert.equal(resolveCellModel('copilot', 'auto'), COPILOT_MEASURED_DEFAULT_MODEL);
  assert.equal(resolveCellModel('copilot', ''), COPILOT_MEASURED_DEFAULT_MODEL);
  assert.equal(COPILOT_MEASURED_DEFAULT_MODEL, 'claude-haiku-4-5'); // matches launch-agent-common.sh:478
});

test('resolveCellModel: copilot already-valid id is a passthrough', () => {
  assert.equal(resolveCellModel('copilot', 'claude-opus-4.8'), 'claude-opus-4.8');
});

test('resolveCellModel: claude/pi aliases pass through untouched', () => {
  assert.equal(resolveCellModel('claude', 'opus'), 'opus');
  assert.equal(resolveCellModel('claude', 'sonnet'), 'sonnet');
  assert.equal(resolveCellModel('pi', 'rapid-proxy-pi'), 'rapid-proxy-pi');
});

// ---------------------------------------------------------------------------
// Task 2: runCell wiring — resolved launch model vs original identity
// ---------------------------------------------------------------------------

// Build a runCell invocation capturing the spawned argv/env + the measurement-start argv.
function runCellCapturing(cell) {
  const calls = [];
  let spawnArgv;
  let spawnEnv;
  const restore = async () => ({ worktree: '/wt', sandboxDataDir: '/wt/.data' });
  const runMeasurement = async (phase, argv) => { calls.push({ phase, argv }); return 0; };
  const spawnAgent = async ({ argv, env }) => { spawnArgv = argv; spawnEnv = env; return 'complete'; };
  // Inject the REAL routing helper with a fake probe reporting the proxy up so COPILOT_MODEL
  // reflects the resolved launch model that runCell passes through.
  const configureRouting = (agent, env, opts) =>
    configureProxyRoutingEnv(agent, env, { ...opts, probe: async () => ({ status: 'running' }), route: '1' });
  const promise = runCell({
    cell, rep: 0, expId: 'exp1', goal: 'do a thing', snapshotId: 'snap-1',
    agentsDir: AGENTS_DIR, dataDir: '/main/.data',
    restore, runMeasurement, spawnAgent, configureRouting,
  });
  return { promise, calls, get spawnArgv() { return spawnArgv; }, get spawnEnv() { return spawnEnv; } };
}

test('runCell: a copilot auto cell spawns with the RESOLVED model; task_id/variant keep the ORIGINAL', async () => {
  const cell = { agent: 'copilot', model: 'auto', framework: 'straight', env: 'default' };
  const h = runCellCapturing(cell);
  const res = await h.promise;
  // Spawned argv + COPILOT_MODEL use the resolved catalog default, NOT 'auto'.
  assert.ok(h.spawnArgv.includes('claude-haiku-4-5'), 'argv carries the resolved model');
  assert.ok(!h.spawnArgv.includes('auto'), 'argv does not carry the raw alias');
  assert.equal(h.spawnEnv.COPILOT_MODEL, 'claude-haiku-4-5', 'COPILOT_MODEL is the resolved model');
  // Identity fields (task_id + variant + measurement-start --model) keep the ORIGINAL alias.
  assert.equal(res.variant, cellName(cell));
  assert.ok(res.variant.includes('auto'), 'recorded variant keeps the original alias');
  assert.equal(res.taskId, composeTaskId('exp1', cell, 0));
  const start = h.calls.find((c) => c.phase === 'start');
  assert.equal(start.argv[start.argv.indexOf('--model') + 1], 'auto', 'measurement-start --model is the ORIGINAL alias');
});

test('runCell: an opencode dash-typo cell spawns with -m rapid-proxy/claude-haiku-4.5', async () => {
  const cell = { agent: 'opencode', model: 'rapid-proxy/claude-haiku-4-5', framework: 'straight', env: 'default' };
  const h = runCellCapturing(cell);
  const res = await h.promise;
  const mIdx = h.spawnArgv.indexOf('-m');
  assert.notEqual(mIdx, -1, 'opencode argv carries -m');
  assert.equal(h.spawnArgv[mIdx + 1], 'rapid-proxy/claude-haiku-4.5', 'resolved dotted catalog id');
  // task_id/variant keep the ORIGINAL dash string for comparability.
  assert.ok(res.variant.includes('rapid-proxy/claude-haiku-4-5'), 'variant keeps original dash string');
  const start = h.calls.find((c) => c.phase === 'start');
  assert.equal(start.argv[start.argv.indexOf('--model') + 1], 'rapid-proxy/claude-haiku-4-5', 'start --model is original');
});
