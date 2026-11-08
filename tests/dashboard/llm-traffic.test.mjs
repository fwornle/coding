/**
 * The "LLM Traffic" health tile (integrations/system-health-dashboard/src/lib/llm-traffic.ts).
 *
 * It replaced "LLM Pool Overhead", which graded a field (overhead_ms) that no
 * current route stamps, so it showed "no recent pool calls" forever. The
 * rules worth pinning are the ones that would quietly mislead:
 *   - one row per answering account, busiest first, with its share of calls
 *   - calls that skipped their first-choice provider are counted and the
 *     skipped providers named with their reason — the signal the old tile hid
 *   - a quiet proxy says "idle", it does not raise an alarm
 *   - the footer says what the numbers rest on (capped sample vs everything)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadRoutingModules } from '../helpers/dashboard-ts.mjs';

const LIB_SRC = path.resolve(import.meta.dirname, '..', '..', 'integrations/system-health-dashboard/src/lib');
const { buildTrafficView, shortModel } = await loadRoutingModules({
  names: ['llm-traffic'], entry: 'llm-traffic', prefix: 'llm-traffic-', srcDir: LIB_SRC,
});

const NOW = Date.parse('2026-11-08T12:00:00Z');
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const trail = (...skipped) => JSON.stringify({ skipped: skipped.map(([provider, reason]) => ({ provider, reason, kind: 'runtime' })) });

test('one row per answering account, busiest first, with call share and median', () => {
  const calls = [
    { timestamp: at(1), provider: 'gh-copilot', model: 'claude-haiku-5.5', latency_ms: 2000 },
    { timestamp: at(2), provider: 'gh-copilot', model: 'claude-sonnet-5', latency_ms: 4000 },
    { timestamp: at(3), provider: 'gh-copilot', model: 'claude-haiku-5.5', latency_ms: 3000 },
    { timestamp: at(4), provider: 'claude-code-max', model: 'claude-opus-5-5', latency_ms: 5200 },
  ];
  const { items } = buildTrafficView(calls, NOW, 500);
  assert.deepEqual(items.slice(0, 2).map((i) => [i.name, i.badgeLabel]), [['GitHub Copilot', '75%'], ['Claude Max', '25%']]);
  assert.equal(items[0].description, '3 calls · median 3.0s · haiku 5.5, sonnet 5');
  assert.equal(items[1].description, '1 call · median 5.2s · opus 5.5');
  assert.ok(items.slice(0, 2).every((i) => i.status === 'operational'));
});

test('skipped first choices surface as a Fallbacks warning naming provider and reason', () => {
  const calls = [
    { timestamp: at(1), provider: 'gh-copilot', model: 'm', latency_ms: 1, attempt_trail: trail(['groq', 'not reachable'], ['anthropic-api', 'not reachable']) },
    { timestamp: at(2), provider: 'gh-copilot', model: 'm', latency_ms: 1, attempt_trail: trail(['groq', 'not reachable']) },
    { timestamp: at(3), provider: 'claude-code-max', model: 'm', latency_ms: 1, attempt_trail: '' },
    { timestamp: at(4), provider: 'claude-code-max', model: 'm', latency_ms: 1, attempt_trail: '{not json' },
  ];
  const fb = buildTrafficView(calls, NOW, 500).items.find((i) => i.name === 'Fallbacks');
  assert.equal(fb.status, 'warning');
  assert.equal(fb.badgeLabel, '50%');
  assert.equal(fb.description, '2 of 4 calls skipped their first choice — Groq not reachable; Anthropic API not reachable');
  assert.match(fb.tooltip, /Groq \(groq\): not reachable ×2/);
});

test('no skips → a green Routing row', () => {
  const { items } = buildTrafficView([{ timestamp: at(1), provider: 'gh-copilot', latency_ms: 10 }], NOW, 500);
  assert.deepEqual(items.at(-1).name, 'Routing');
  assert.equal(items.at(-1).status, 'operational');
});

test('a quiet proxy reads idle, not broken', () => {
  const { items } = buildTrafficView([{ timestamp: at(180), provider: 'gh-copilot', latency_ms: 10 }], NOW, 500);
  assert.equal(items[0].name, 'Idle');
  assert.equal(items[0].status, 'reference');
  assert.equal(items[0].description, 'last call 3 h ago');
  assert.equal(buildTrafficView([], NOW, 500).items[0].badgeLabel, 'idle');
});

test('the footer says whether the sample is capped', () => {
  const calls = [{ timestamp: at(52), provider: 'p', latency_ms: 1 }, { timestamp: at(1), provider: 'p', latency_ms: 1 }];
  assert.equal(buildTrafficView(calls, NOW, 2).basis, 'last 2 calls · past 52 min');
  assert.equal(buildTrafficView(calls, NOW, 500).basis, 'all 2 calls · past 52 min');
});

test('model names shorten without losing the version', () => {
  assert.equal(shortModel('claude-opus-5-5'), 'opus 5.5');
  assert.equal(shortModel('claude-haiku-5.5'), 'haiku 5.5');
  assert.equal(shortModel('claude-sonnet-5'), 'sonnet 5');
  assert.equal(shortModel('gpt-5.4'), 'gpt-5.4');
});
