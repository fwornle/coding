// tests/measurement/reconciler.test.mjs
//
// Behavior (auto-measure Plan B, Phase 3): the standalone reconciler keeps each
// per-agent slot active-measurement.<agent>.json in sync with that agent's live
// foreground session, WITHOUT ever touching the global slot or operator-owned
// per-agent slots. Decision logic is exercised via an in-memory span mock and
// an injected "detected session" (reconcileAgent's `found` param).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileAgent,
  loadBehaviorConfig,
} from '../../scripts/measurement-reconciler.mjs';

const NOW = 1_800_000_000_000;
const FRESH = { enabled: true, freshnessMs: 120_000, pollMs: 5000, agents: {} };

/** In-memory stand-in for the proxy span surface (single reader/writer). */
function makeSpan(initial = {}) {
  const slots = { ...initial };
  return {
    slots,
    getActiveMeasurement: (_dir, agent) => slots[agent] || null,
    startMeasurement: (opts) => {
      slots[opts.agent] = { task_id: opts.task_id, agent: opts.agent, meta: opts.meta };
      return slots[opts.agent];
    },
    clearAgentSpan: (agent) => {
      const had = Boolean(slots[agent]);
      delete slots[agent];
      return had;
    },
  };
}

const own = (taskId) => ({ task_id: taskId, agent: 'opencode', meta: { source: 'reconciler' } });
const fresh = (sessionId) => ({ sessionId, lastActivityMs: NOW - 10_000 });

test('binds a fresh foreground session when no slot exists', () => {
  const span = makeSpan();
  const action = reconcileAgent('opencode', span, FRESH, fresh('ses_A'), NOW);
  assert.equal(action, 'started ses_A');
  assert.equal(span.slots.opencode.task_id, 'ses_A');
  assert.equal(span.slots.opencode.meta.source, 'reconciler');
});

test('no-op when already bound to the same session', () => {
  const span = makeSpan({ opencode: own('ses_A') });
  const action = reconcileAgent('opencode', span, FRESH, fresh('ses_A'), NOW);
  assert.equal(action, 'bound');
  assert.equal(span.slots.opencode.task_id, 'ses_A');
});

test('rebinds when the foreground session rotates', () => {
  const span = makeSpan({ opencode: own('ses_OLD') });
  const action = reconcileAgent('opencode', span, FRESH, fresh('ses_NEW'), NOW);
  assert.equal(action, 'started ses_NEW');
  assert.equal(span.slots.opencode.task_id, 'ses_NEW');
});

test('clears an owned slot when the session goes stale (no fresh detection)', () => {
  const span = makeSpan({ opencode: own('ses_A') });
  const stale = { sessionId: 'ses_A', lastActivityMs: NOW - 5_000_000 };
  const action = reconcileAgent('opencode', span, FRESH, stale, NOW);
  assert.equal(action, 'cleared(stale)');
  assert.equal(span.slots.opencode, undefined);
});

test('clears an owned slot when detection returns null', () => {
  const span = makeSpan({ opencode: own('ses_A') });
  const action = reconcileAgent('opencode', span, FRESH, null, NOW);
  assert.equal(action, 'cleared(stale)');
  assert.equal(span.slots.opencode, undefined);
});

test('idle no-op when nothing detected and no slot owned', () => {
  const span = makeSpan();
  const action = reconcileAgent('opencode', span, FRESH, null, NOW);
  assert.equal(action, 'idle');
});

test('NEVER touches an operator-authored per-agent slot', () => {
  const manual = { task_id: 'ses_MANUAL', agent: 'opencode', meta: { source: 'manual' } };
  const span = makeSpan({ opencode: manual });
  const action = reconcileAgent('opencode', span, FRESH, fresh('ses_NEW'), NOW);
  assert.equal(action, 'skip(operator-owned)');
  assert.equal(span.slots.opencode.task_id, 'ses_MANUAL');
});

test('disabled agent has its owned slot cleared', () => {
  const span = makeSpan({ opencode: own('ses_A') });
  const cfg = { ...FRESH, agents: { opencode: false } };
  const action = reconcileAgent('opencode', span, cfg, fresh('ses_A'), NOW);
  assert.equal(action, 'cleared(disabled)');
  assert.equal(span.slots.opencode, undefined);
});

test('globally disabled auto-measure clears owned slots', () => {
  const span = makeSpan({ opencode: own('ses_A') });
  const cfg = { ...FRESH, enabled: false };
  const action = reconcileAgent('opencode', span, cfg, fresh('ses_A'), NOW);
  assert.equal(action, 'cleared(disabled)');
});

test('disabled agent leaves an operator-owned slot untouched', () => {
  const manual = { task_id: 'ses_M', agent: 'opencode', meta: { source: 'manual' } };
  const span = makeSpan({ opencode: manual });
  const cfg = { ...FRESH, agents: { opencode: false } };
  const action = reconcileAgent('opencode', span, cfg, null, NOW);
  assert.equal(action, 'skip');
  assert.equal(span.slots.opencode.task_id, 'ses_M');
});

test('loadBehaviorConfig returns safe defaults for a missing file', () => {
  const cfg = loadBehaviorConfig('/no/such/behavior.json');
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.freshnessMs, 120_000);
  assert.equal(cfg.pollMs, 5000);
  assert.deepEqual(cfg.agents, {});
});

// OVERLAP (2026-10-03): two sessions of one agent active at once. The proxy has
// one slot per agent, so binding the newest flipped the slot between them every
// poll and booked each session's traffic to the other half the time.
const withRival = (sessionId, rivalAgoMs) => ({
  sessionId, lastActivityMs: NOW - 10_000, runnerUpMs: NOW - rivalAgoMs,
});

test('two fresh sessions: binds neither', () => {
  const span = makeSpan();
  const action = reconcileAgent('claude', span, FRESH, withRival('ses_A', 20_000), NOW);
  assert.equal(action, 'overlap');
  assert.equal(span.slots.claude, undefined);
});

test('two fresh sessions: clears the slot it had bound before the overlap began', () => {
  const span = makeSpan({ claude: own('ses_A') });
  const action = reconcileAgent('claude', span, FRESH, withRival('ses_B', 5_000), NOW);
  assert.equal(action, 'cleared(overlap)');
  assert.equal(span.slots.claude, undefined);
});

test('the overlap ends when the runner-up goes stale, and measurement resumes', () => {
  const span = makeSpan();
  const action = reconcileAgent('claude', span, FRESH, withRival('ses_A', 300_000), NOW);
  assert.equal(action, 'started ses_A');
  assert.equal(span.slots.claude.task_id, 'ses_A');
});

test('an overlap never touches an operator-authored slot', () => {
  const operator = { task_id: 'manual', agent: 'claude', meta: { source: 'operator' } };
  const span = makeSpan({ claude: operator });
  const action = reconcileAgent('claude', span, FRESH, withRival('ses_A', 5_000), NOW);
  assert.equal(action, 'overlap');
  assert.equal(span.slots.claude, operator);
});
