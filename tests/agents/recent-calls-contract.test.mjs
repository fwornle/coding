/**
 * The dashboard unwraps `/api/token-usage/recent` in exactly one place, and the
 * thing being pinned here is that it cannot hand a non-array to a consumer.
 *
 * What happened: the workflow view's shared store said
 * `_recentCalls = json.calls ?? json ?? []`. `calls` is not a key the proxy has
 * ever emitted — the envelope is `{ data, scope }` — so the `?? json` arm stored
 * the response OBJECT. `useLLMBadgeForProcess` then called `.filter` on it and
 * threw `TypeError: s.filter is not a function` from inside render, which React
 * answers by unmounting the tree. The whole dashboard went white the moment a
 * running workflow opened the node sidebar, and the console named
 * node-details-sidebar.tsx — three files away from the mistake.
 *
 * So the invariant is stronger than "reads the right key": for ANY input, the
 * unwrapper returns an array. A key rename on the proxy then costs an empty
 * badge, which is a cosmetic bug, instead of a blank page, which is an outage.
 *
 * Pure — no proxy, no browser, never skips.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingModules, WORKFLOW_SRC } from '../helpers/dashboard-ts.mjs';

// Top-level await, not a `before` hook — see the note in dashboard-ts.mjs: a
// root-level async `before` under `describe` reports every test as `cancelled`,
// which counts as neither pass nor fail and goes green while running nothing.
const { rowsFromRecentResponse } = await loadRoutingModules({
  names: ['recent-calls-contract'],
  entry: 'recent-calls-contract',
  prefix: 'recent-calls-contract-',
  srcDir: WORKFLOW_SRC,
});

/** One row, trimmed to the fields the badge reads. */
const ROW = {
  id: 253681,
  provider: 'claude-code-max',
  model: 'claude-sonnet-5',
  process: 'token-adapter-claude',
};

describe('rowsFromRecentResponse', () => {
  test('reads `data` — the key rapid-llm-proxy actually emits', () => {
    // Verbatim envelope shape from GET :12435/api/token-usage/recent?limit=3.
    // `scope` rides along; it must not be mistaken for the payload.
    const rows = rowsFromRecentResponse({ data: [ROW], scope: 'both' });
    assert.deepEqual(rows, [ROW]);
  });

  test('a response with rows still yields rows after .filter', () => {
    // The exact call site that threw. Kept as an assertion rather than prose
    // because the bug was never that the badge was empty — it was that this
    // line was reached with a non-array.
    const rows = rowsFromRecentResponse({ data: [ROW], scope: 'both' });
    assert.deepEqual(rows.filter(c => c.process === 'token-adapter-claude'), [ROW]);
  });

  test('accepts `calls`, the key the broken reader believed in', () => {
    assert.deepEqual(rowsFromRecentResponse({ calls: [ROW] }), [ROW]);
  });

  test('accepts a bare array, in case the envelope is ever dropped', () => {
    assert.deepEqual(rowsFromRecentResponse([ROW]), [ROW]);
  });

  /**
   * The regression itself. Each of these used to reach the store as-is; the
   * first is the live envelope with the payload key renamed, which is the
   * realistic future break.
   */
  for (const [label, input] of [
    ['an envelope whose payload key was renamed', { rows: [ROW], scope: 'both' }],
    ['an error envelope', { error: 'proxy unreachable' }],
    ['an empty object', {}],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not json'],
    ['a number', 0],
    ['a data field that is not an array', { data: { 0: ROW } }],
  ]) {
    test(`returns [] for ${label}, never the input`, () => {
      const rows = rowsFromRecentResponse(input);
      assert.ok(Array.isArray(rows), `expected an array, got ${typeof rows}`);
      assert.equal(rows.length, 0);
      // The property that actually prevents the white screen.
      assert.doesNotThrow(() => rows.filter(c => c.process === 'x'));
    });
  }
});
