/**
 * Whether a dropped workflow WebSocket reconnects.
 *
 * The old rule was `event.code !== 1000`. Close code 1000 means "clean", and a
 * clean close is exactly what a SERVER sends when it shuts down — so every
 * dashboard restart permanently killed live updates in every open tab. The UKB
 * modal renders Step, Cancel and the LLM chips from state that socket feeds, so
 * the controls silently stopped appearing and a workflow paused at a breakpoint
 * became indistinguishable from a hung one. An hour was spent looking for a bug
 * in a workflow that was doing exactly what was asked.
 *
 * The rule is now keyed on WHO closed the socket, which the close code cannot
 * tell you. These cases pin that, and pin that running out of attempts produces
 * a state the UI can SHOW — silence was the actual defect.
 *
 * Pure — no browser, no React, no server, never skips.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingModules, HOOKS_SRC } from '../helpers/dashboard-ts.mjs';

// Top-level await, not a `before` hook — see dashboard-ts.mjs: under `describe`
// a root-level async `before` reports every test as `cancelled`, which counts as
// neither pass nor fail and goes green while running nothing.
const { decideReconnect, MAX_RECONNECT_DELAY_MS } = await loadRoutingModules({
  names: ['ws-reconnect-policy'],
  entry: 'ws-reconnect-policy',
  prefix: 'ws-reconnect-policy-',
  srcDir: HOOKS_SRC,
});

/** Defaults matching the hook's own options. */
const base = { intentional: false, autoReconnect: true, attempts: 0, maxAttempts: 10, baseDelayMs: 2000 };

describe('decideReconnect', () => {
  test('THE REGRESSION: a clean server-side close still reconnects', () => {
    // This is the case the old `code !== 1000` test got wrong. Nothing about a
    // close code distinguishes "server restarted" from "we closed it".
    const d = decideReconnect({ ...base });
    assert.equal(d.action, 'retry');
    assert.equal(d.attempt, 1);
  });

  test('our own disconnect does NOT reconnect', () => {
    // Unmount / modal close. Reconnecting here would race a dying component.
    const d = decideReconnect({ ...base, intentional: true });
    assert.deepEqual(d, { action: 'stop', reason: 'intentional' });
  });

  test('intentional wins even with attempts left', () => {
    const d = decideReconnect({ ...base, intentional: true, attempts: 3 });
    assert.equal(d.action, 'stop');
  });

  test('autoReconnect:false is honoured', () => {
    const d = decideReconnect({ ...base, autoReconnect: false });
    assert.deepEqual(d, { action: 'stop', reason: 'disabled' });
  });

  test('gives up at the ceiling — and says so, rather than going quiet', () => {
    const d = decideReconnect({ ...base, attempts: 10 });
    assert.deepEqual(d, { action: 'give-up' });
  });

  test('never retries past the ceiling', () => {
    for (const attempts of [10, 11, 50]) {
      assert.equal(decideReconnect({ ...base, attempts }).action, 'give-up');
    }
  });

  test('backs off with the attempt number', () => {
    assert.equal(decideReconnect({ ...base, attempts: 0 }).delayMs, 2000);
    assert.equal(decideReconnect({ ...base, attempts: 1 }).delayMs, 4000);
    assert.equal(decideReconnect({ ...base, attempts: 2 }).delayMs, 6000);
  });

  test('backoff is capped so a long outage keeps retrying', () => {
    const d = decideReconnect({ ...base, attempts: 9 });
    assert.equal(d.delayMs, MAX_RECONNECT_DELAY_MS);
    assert.ok(d.delayMs <= MAX_RECONNECT_DELAY_MS);
  });

  test('ten attempts span about a minute, not twenty seconds', () => {
    // The old fixed 2s delay exhausted all ten attempts in 20s — shorter than a
    // container restart, so the tab gave up before the backend came back.
    let total = 0;
    for (let a = 0; a < 10; a += 1) total += decideReconnect({ ...base, attempts: a }).delayMs;
    assert.ok(total > 60_000, `expected > 60s of retry window, got ${total}ms`);
  });

  test('a successful reconnect resets the window', () => {
    // attempts back to 0 after onopen: the next drop gets the full ladder again.
    assert.equal(decideReconnect({ ...base, attempts: 0 }).attempt, 1);
  });
});
