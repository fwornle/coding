// tests/experiments/agent-routing.test.mjs
//
// Phase 88, Plan 88-01 (ALIGN-01) — the model-resolution + canonical env-map contract for
// lib/experiments/agent-routing.mjs, the SINGLE source of truth shared by the experiment
// cell path (experiment-runner.mjs runCell) and the interactive shell launcher
// (scripts/launch-agent-common.sh configure_proxy_routing()).
//
// Task 1: resolveCellModel (dash→dot opencode normalization KEEPING the rapid-proxy/ prefix;
//         copilot `auto`→measured-default; claude/mastracode passthrough) + buildAgentRoutingEnv
//         (the per-agent env map lifted verbatim from configureProxyRoutingEnv's switch).
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
  buildAgentRoutingEnv,
  COPILOT_MEASURED_DEFAULT_MODEL,
} from '../../lib/experiments/agent-routing.mjs';
import { runCell, cellName, composeTaskId, configureProxyRoutingEnv } from '../../lib/experiments/experiment-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'config', 'agents');
void runCell; void cellName; void composeTaskId; void configureProxyRoutingEnv; // Task 2 wiring tests (added below)

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

test('resolveCellModel: claude/mastracode aliases pass through untouched', () => {
  assert.equal(resolveCellModel('claude', 'opus'), 'opus');
  assert.equal(resolveCellModel('claude', 'sonnet'), 'sonnet');
  assert.equal(resolveCellModel('mastracode', 'rapid-proxy-mastra'), 'rapid-proxy-mastra');
});

// ---------------------------------------------------------------------------
// Task 1: buildAgentRoutingEnv — the per-agent env map (lifted verbatim)
// ---------------------------------------------------------------------------

test('buildAgentRoutingEnv: copilot sets the task-scoped BYOK env with the passed model', () => {
  const base = { ANTHROPIC_API_KEY: 'k' };
  const env = buildAgentRoutingEnv('copilot', base, { taskId: 't1', model: 'claude-haiku-4-5', port: 12435 });
  assert.equal(env.COPILOT_PROVIDER_BASE_URL, 'http://127.0.0.1:12435/v1/copilot/t/t1');
  assert.equal(env.COPILOT_PROVIDER_TYPE, 'openai');
  assert.equal(env.COPILOT_PROVIDER_API_KEY, 'rapid-proxy-no-auth-placeholder');
  assert.equal(env.COPILOT_MODEL, 'claude-haiku-4-5');
  assert.equal(env.COPILOT_AUTO_UPDATE, 'false');
});

test('buildAgentRoutingEnv: opencode sets ANTHROPIC_BASE_URL + splices the provider config (both wires)', () => {
  const base = { ANTHROPIC_API_KEY: 'k' };
  const env = buildAgentRoutingEnv('opencode', base, { taskId: 't1', model: 'rapid-proxy/claude-haiku-4.5', port: 12435 });
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12435');
  assert.equal(env.ANTHROPIC_API_KEY, 'k', 'opencode keeps its own credential');
  const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(cfg.provider.anthropic.options.baseURL, 'http://127.0.0.1:12435/v1');
  assert.equal(cfg.provider.anthropic.options.headers['x-task-id'], 't1');
  assert.equal(cfg.provider.anthropic.options.headers['x-agent'], 'opencode');
  assert.equal(cfg.provider.openai.options.baseURL, 'http://127.0.0.1:12435/v1/opencode/t/t1');
  assert.equal(cfg.provider['github-copilot'].options.baseURL, 'http://127.0.0.1:12435/v1/opencode/t/t1');
});

test('buildAgentRoutingEnv: opencode without taskId is byte-identical to ANTHROPIC_BASE_URL only', () => {
  const env = buildAgentRoutingEnv('opencode', {}, { model: 'rapid-proxy/claude-haiku-4.5', port: 12435 });
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12435');
  assert.ok(!('OPENCODE_CONFIG_CONTENT' in env), 'no taskId → no provider splice');
});

test('buildAgentRoutingEnv: claude sets ANTHROPIC_BASE_URL + x-task-id header', () => {
  const env = buildAgentRoutingEnv('claude', { ANTHROPIC_API_KEY: 'k' }, { taskId: 't1', port: 12435 });
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12435');
  assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, 'x-task-id: t1');
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
});

test('buildAgentRoutingEnv: returns a COPY — never mutates baseEnv, never touches LLM_PROXY_DATA_DIR', () => {
  const base = { ANTHROPIC_API_KEY: 'k', LLM_PROXY_DATA_DIR: '/wt/.data' };
  const env = buildAgentRoutingEnv('claude', base, { taskId: 't1', port: 12435 });
  assert.notEqual(env, base, 'returns a new object');
  assert.ok(!('ANTHROPIC_BASE_URL' in base), 'baseEnv untouched');
  assert.equal(env.LLM_PROXY_DATA_DIR, '/wt/.data', 'sandbox data dir preserved verbatim');
});

// Task 2 runCell-wiring tests are appended by Plan 88-01 Task 2 (they require the runner to
// resolve the launch model once and pass it to both argvForAgent and configureRouting).
