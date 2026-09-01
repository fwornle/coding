/**
 * Replaying recorded traffic through the ladder on another network.
 *
 * The claim this makes is narrow and the tests exist to keep it narrow: given a
 * route and the band a call actually resolved to, say where the proxy WOULD have
 * sent it on a different network. It is not an observation, it does not know
 * whether the call would have succeeded there, and it replays against today's
 * config. Each of those is a way the number could be over-read, so each has a
 * test that pins the behaviour rather than a comment that asks nicely.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingModules } from '../helpers/dashboard-ts.mjs';


const m = await loadRoutingModules({
  names: ['offload-gates', 'offload-replay'],
  entry: 'offload-replay',
  prefix: 'replay-',
});

const PASS = 6;

/** The live policy on 2026-08-30: corporate cluster on, laptop declared but off. */
const POLICY = {
  enabled: true,
  offloadBands: ['small'],
  targets: [
    { provider: 'qwen-local', requireNetwork: 'corporate', enabled: true, scope: ['fg', 'bg'] },
    { provider: 'qwen-laptop', requireNetwork: 'public', enabled: false, scope: ['fg'] },
  ],
};

const ROUTES = {
  'bg-observation-writer': { provider: 'gh-copilot', complexity: 'small' },
  'bg-consolidator-insight': { provider: 'gh-copilot', complexity: 'medium' },
  'bg-kgbench-judge': { provider: 'gh-copilot', complexity: 'high', offload: false },
  'fg-chat/claude': { provider: 'claude-code-max', complexity: 'high' },
};
const DEFAULTS = { 'fg-chat': { provider: 'gh-copilot', complexity: 'high' }, background: { provider: 'claude-code-max', complexity: 'medium' } };
const noFg = () => false;

const replay = (rows, network, policy = POLICY, fg = noFg) =>
  m.replayRecorded(rows, ROUTES, DEFAULTS, policy, network, fg);

describe('replay', () => {
  test('small-band background traffic moves on corporate and stays on public', () => {
    const rows = [{ route_key: 'bg-observation-writer', route_band: 'small', calls: 100, tokens: 5000 }];

    const pub = replay(rows, 'public');
    assert.equal(pub.moved.calls, 0);
    assert.equal(pub.callsByRung[3], 100, 'no target serves public, so it stops at the target gate');

    const corp = replay(rows, 'corporate');
    assert.equal(corp.moved.calls, 100);
    assert.equal(corp.moved.tokens, 5000);
    assert.equal(corp.moved.to, 'qwen-local');
    assert.equal(corp.callsByRung[PASS], 100);
  });

  test('the band gate still bites on the other network', () => {
    // A network override does not make ineligible work eligible. `medium` is not
    // in offload_bands, so corporate changes nothing for it.
    const rows = [{ route_key: 'bg-consolidator-insight', route_band: 'medium', calls: 40, tokens: 900 }];
    for (const net of ['public', 'corporate']) {
      const r = replay(rows, net);
      assert.equal(r.callsByRung[2], 40, `band gate must hold on ${net}`);
      assert.equal(r.moved.calls, 0);
    }
  });

  test('a route pinned with offload:false never moves, on any network', () => {
    const rows = [{ route_key: 'bg-kgbench-judge', route_band: 'small', calls: 12, tokens: 300 }];
    const r = replay(rows, 'corporate');
    assert.equal(r.callsByRung[1], 12, 'the pin is checked before the band and before the target');
    assert.equal(r.moved.calls, 0);
  });

  test('foreground claude cannot be offloaded even where a target serves', () => {
    // fg_transport: it arrives on the Anthropic wire and no local provider carries
    // it. The replay must not promise a move the proxy would refuse.
    const rows = [{ route_key: 'fg-chat/claude', route_band: 'small', calls: 7, tokens: 90 }];
    const fgCapable = id => id === 'claude-code-max';
    const r = replay(rows, 'corporate', POLICY, fgCapable);
    assert.equal(r.callsByRung[5], 7, 'stops at the wire-protocol gate');
    assert.equal(r.moved.calls, 0);
  });

  test('tokens follow calls onto the same rung', () => {
    const rows = [
      { route_key: 'bg-observation-writer', route_band: 'small', calls: 10, tokens: 1000 },
      { route_key: 'bg-consolidator-insight', route_band: 'medium', calls: 20, tokens: 2000 },
    ];
    const r = replay(rows, 'corporate');
    assert.equal(r.tokensByRung[PASS], 1000);
    assert.equal(r.tokensByRung[2], 2000);
    assert.equal(r.callsByRung.reduce((a, b) => a + b, 0), 30, 'every call lands on exactly one rung');
  });
});

describe('what cannot be replayed is reported, not dropped', () => {
  test('a route that no longer exists in the config is counted as unmatched', () => {
    const rows = [
      { route_key: 'bg-deleted-service', route_band: 'small', calls: 50, tokens: 400 },
      { route_key: 'bg-observation-writer', route_band: 'small', calls: 10, tokens: 100 },
    ];
    const r = replay(rows, 'corporate');
    assert.deepEqual(r.unmatched, { calls: 50, tokens: 400, keys: ['bg-deleted-service'] });
    assert.equal(r.moved.calls, 10, 'the replayable half is still replayed');
    assert.equal(r.callsByRung.reduce((a, b) => a + b, 0), 10,
      'unmatched traffic must not be counted on any rung');
  });

  test('a row with no recorded band is unmatched rather than guessed', () => {
    // The band gate is the second thing the proxy checks. Inventing a band would
    // decide the outcome rather than report it.
    const rows = [{ route_key: 'bg-observation-writer', route_band: '', calls: 8, tokens: 80 }];
    const r = replay(rows, 'corporate');
    assert.equal(r.unmatched.calls, 8);
    assert.equal(r.moved.calls, 0);
  });
});

describe('policy state', () => {
  test('a switched-off target moves nothing, which is the whole public story', () => {
    const rows = [{ route_key: 'bg-observation-writer', route_band: 'small', calls: 100, tokens: 1 }];
    assert.equal(replay(rows, 'public').moved.to, null);
    // ...and switching it on is what the preview is for.
    const on = { ...POLICY, targets: POLICY.targets.map(t => ({ ...t, enabled: true })) };
    const r = replay(rows, 'public', on);
    assert.equal(r.moved.to, 'qwen-laptop');
    assert.equal(r.callsByRung[4], 100, 'but bg work still fails the fg-only scope gate');
    assert.equal(r.moved.calls, 0);
  });

  test('policy off parks everything on rung 0 regardless of network', () => {
    const rows = [{ route_key: 'bg-observation-writer', route_band: 'small', calls: 9, tokens: 9 }];
    const r = replay(rows, 'corporate', { ...POLICY, enabled: false });
    assert.equal(r.callsByRung[0], 9);
  });
});

describe('totalsByRoute', () => {
  test('folds the per-model rows down to one per route and band', () => {
    const totals = m.totalsByRoute([
      { route_key: 'fg-chat/claude', route_band: 'high', calls: 605, tokens: 100 },
      { route_key: 'fg-chat/claude', route_band: 'high', calls: 247, tokens: 50 },
      { route_key: 'fg-chat/claude', route_band: 'small', calls: 1, tokens: 5 },
    ]);
    assert.equal(totals.length, 2, 'same route, different band, stays two rows — the band decides');
    assert.deepEqual(totals.find(t => t.route_band === 'high'),
      { route_key: 'fg-chat/claude', route_band: 'high', calls: 852, tokens: 150 });
  });
});
