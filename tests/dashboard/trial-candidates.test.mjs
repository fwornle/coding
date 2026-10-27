/**
 * Trial candidates in the dashboard's cost model: which cheaper models a model
 * trial can try for a background process, what each would cost on the
 * process's own tokens, and what an automatic trial tries.
 *
 * The rules worth a suite, because each fails quietly:
 *
 *   - a downgrade stays on the incumbent's account or moves to own hardware;
 *     another metered account is a different bill and is never offered
 *   - a provider the proxy cannot reach right now is not offered (an offline
 *     cluster would sit in a trial collecting nothing until it ends)
 *   - candidates are priced on the process's tokens, cheapest first
 *   - a model a finished trial already found wanting is not tried again
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COST_SRC, loadRoutingModules } from '../helpers/dashboard-ts.mjs';

const {
  DEFAULT_COST_CONFIG, trialCandidates, autoTrialCandidates, failedTrialModels, buildSuggestions, catalogueFromRouting,
} = await loadRoutingModules({
  names: ['cost-model'],
  entry: 'cost-model',
  prefix: 'trial-candidates-',
  srcDir: COST_SRC,
});

const NOW = new Date('2026-10-27T12:00:00Z');
const MONTH = '2026-10';
const cfg = {
  ...DEFAULT_COST_CONFIG,
  currency: { display: 'USD', usdPerEur: 1 },
  copilotPrices: {
    'claude-sonnet-5': { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'gpt-5.6-luna': { in: 0.25, out: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
    'gpt-4o-mini': { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  },
};

const routing = {
  providers: [
    { id: 'gh-copilot', account: 'copilot-subscription', enabled: true, impl: 'copilot',
      availableModels: ['claude-haiku-4.5', 'claude-sonnet-5', 'gpt-5.6-luna', 'gpt-4o-mini', 'unpriced-model'],
      models: { small: 'claude-haiku-4.5', medium: 'claude-sonnet-5' } },
    { id: 'openai', account: 'openai-api', enabled: true, impl: 'openai',
      availableModels: ['gpt-4o-mini'], models: { small: 'gpt-4o-mini' } },
    { id: 'qwen-local', account: 'on-prem', enabled: true, impl: 'qwen-local',
      availableModels: ['qwen3.8-27b-dual-normal'], models: { medium: 'qwen3.8-27b-dual-normal' } },
  ],
  routes: { 'bg-consolidator-insight': { provider: 'gh-copilot', complexity: 'medium' } },
  runtime: { availableImpls: ['copilot', 'openai', 'qwen-local'] },
};

/** One process, a week of Sonnet calls: 1M fresh input + 200k output per day. */
const rows = Array.from({ length: 7 }, (_, i) => ({
  month: MONTH, day: `2026-10-${String(20 + i).padStart(2, '0')}`,
  provider: 'gh-copilot', model: 'claude-sonnet-5', process: 'consolidator-insight',
  input_tokens: 1_000_000, output_tokens: 200_000, cache_read_tokens: 0, cache_write_tokens: 0, calls: 10,
}));

test('the catalogue comes from GET /api/llm/routing, with what can answer now', () => {
  const c = catalogueFromRouting(routing);
  assert.deepEqual(c.availableImpls, ['copilot', 'openai', 'qwen-local']);
  assert.equal(catalogueFromRouting({ providers: [] }), null);
  assert.equal(catalogueFromRouting(null), null);
});

test('candidates: the same account and own hardware, cheapest first, never another bill', () => {
  const [pc] = trialCandidates(rows, cfg, catalogueFromRouting(routing), MONTH, NOW);
  assert.equal(pc.process, 'consolidator-insight');
  assert.deepEqual(pc.incumbent, { provider: 'gh-copilot', model: 'claude-sonnet-5' });
  const ids = pc.candidates.map((c) => `${c.provider}/${c.model}`);
  assert.ok(!ids.some((id) => id.startsWith('openai/')), 'a private OpenAI key is a different bill');
  assert.ok(!ids.includes('gh-copilot/claude-sonnet-5'), 'not the incumbent');
  assert.ok(!ids.includes('gh-copilot/unpriced-model'), 'a model with no price is left out');
  // $0 first (own hardware and an included model), then by price.
  assert.deepEqual(ids, ['qwen-local/qwen3.8-27b-dual-normal', 'gh-copilot/gpt-4o-mini', 'gh-copilot/gpt-5.6-luna', 'gh-copilot/claude-haiku-4.5']);
  const luna = pc.candidates.find((c) => c.model === 'gpt-5.6-luna');
  // A week of 7M in + 1.4M out on luna: 7 × 0.25 + 1.4 × 1.2 = 3.43, scaled to 30 days.
  assert.ok(Math.abs(luna.monthlyEur - 3.43 * 30 / 7) < 1e-6);
  assert.equal(luna.estimate, false);
  assert.equal(pc.candidates[0].local, true);
});

test('a provider that cannot answer now is not offered', () => {
  const offline = catalogueFromRouting({ ...routing, runtime: { availableImpls: ['copilot'] } });
  const [pc] = trialCandidates(rows, cfg, offline, MONTH, NOW);
  assert.ok(!pc.candidates.some((c) => c.provider === 'qwen-local'));
});

test('an automatic trial tries at most four, leaving out what a finished trial found wanting', () => {
  const [pc] = trialCandidates(rows, cfg, catalogueFromRouting(routing), MONTH, NOW);
  const trials = [
    { process: 'consolidator-insight', status: 'complete', candidates: [{ provider: 'gh-copilot', model: 'gpt-4o-mini' }, { provider: 'gh-copilot', model: 'gpt-5.6-luna' }],
      summary: { verdict: 'pass', candidates: [{ state: 'out' }, { state: 'passed' }] } },
    { process: 'consolidator-insight', status: 'rejected', candidate: { provider: 'gh-copilot', model: 'claude-haiku-4.5' }, summary: { verdict: 'pending' } },
    { process: 'other', status: 'complete', candidate: { provider: 'gh-copilot', model: 'gpt-5.6-luna' }, summary: { verdict: 'fail' } },
  ];
  const failed = failedTrialModels(trials, 'consolidator-insight');
  assert.deepEqual([...failed].sort(), ['gh-copilot/claude-haiku-4.5', 'gh-copilot/gpt-4o-mini']);
  assert.deepEqual(autoTrialCandidates(pc, failed).map((c) => c.model), ['qwen3.8-27b-dual-normal', 'gpt-5.6-luna']);
});

test('the suggestion offers an automatic trial of the candidates, its saving a range', () => {
  const s = buildSuggestions(rows, cfg, MONTH, NOW, catalogueFromRouting(routing)).find((x) => x.action?.type === 'trial');
  assert.equal(s.title, 'Try cheaper models for "consolidator-insight"');
  assert.equal(s.action.candidates.length, 4);
  assert.ok(s.estSavingsMaxEur > s.estSavingsEur, 'cheapest saves most');
  assert.match(s.detail, /cheapest first/);
});

test('without the catalogue (glass) the one candidate is Haiku 5.5 on Copilot', () => {
  const s = buildSuggestions(rows, cfg, MONTH, NOW, null).find((x) => x.action?.type === 'trial');
  assert.equal(s.title, 'Try claude-haiku-5.5 for "consolidator-insight"');
  assert.deepEqual(s.action.candidates.map((c) => `${c.provider}/${c.model}`), ['gh-copilot/claude-haiku-5.5']);
});
