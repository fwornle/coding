/**
 * Which recorded calls the scrubber shows, and how it colours them.
 *
 * The strip's only hard problem is selection. `/api/token-usage/recent` caps at
 * 500 rows and one background process routinely owns most of them, so a scrubber
 * over the raw tail is a scrubber through that one process. Everything here is
 * pure, so unlike the offload contract test it needs no running proxy and never
 * skips.
 *
 * The case that matters most is the FIRST one: the obvious predicate is wrong,
 * it was wrong against live data, and nothing about it looks wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingModules } from '../helpers/dashboard-ts.mjs';


/**
 * Transpile recent-call.ts and the module it imports into one temp dir.
 *
 * The bare `./offload-gates` specifier is rewritten to `.mjs`: TypeScript
 * resolves extensionless imports, node's ESM loader does not.
 *
 * Top-level await rather than a `before` hook. With `describe`, a root-level
 * async `before` does not gate the suites in this node version: they completed
 * in ~0.02ms and all 15 tests reported `cancelled` — which run-node-tests counts
 * as neither pass nor fail, so the file would have gone green in CI while
 * executing nothing. An import that the module graph itself waits on cannot do
 * that.
 */
const m = await loadRoutingModules({
  names: ['offload-gates', 'recent-call'],
  entry: 'recent-call',
  prefix: 'recent-call-',
});

/** A row as the endpoint actually returns one. */
function row(over = {}) {
  return {
    timestamp: '2026-08-30T06:00:00.000Z',
    process: 'x', agent: 'x', provider: 'gh-copilot', model: 'claude-haiku-4.5',
    total_tokens: 100, route_key: 'bg-observation-writer', route_band: 'small',
    route_step: 2, offloaded_from: '', chain_position: 0, attempt_trail: '',
    routing_source: 'live',
    ...over,
  };
}

/**
 * The trail that is on ~78% of live rows and means nothing about the call: one
 * unreachable candidate that was never tried, and the config's standing reason
 * for declining the offload. Captured verbatim from a 2026-08-30 window.
 */
const AMBIENT_TRAIL = JSON.stringify({
  skipped: [{ provider: 'groq', reason: 'not reachable', kind: 'runtime' }],
  offloadSkipped: 'no offload target for network=public (targets: qwen-local[corporate/fg+bg], qwen-laptop[public/fg] (off))',
});

describe('recorded-call selection', () => {
  test('an ambient trail does not make a call interesting', () => {
    // The predicate this replaces was `chain_position > 0 || offloaded_from ||
    // attempt_trail !== ''`. Measured on a live 500-row window it kept 388, and
    // every one of the 388 owed it to exactly this string — so the filter kept
    // 78% of the tail and the scrubber still scrubbed through whichever process
    // dominated it. `skipped` and `offloadSkipped` describe the CONFIG; only
    // `attempts[]` describes what happened to this call.
    const rows = Array.from({ length: 50 }, (_, i) => row({
      route_key: i < 45 ? 'bg-consolidator-mentions' : 'bg-health-coordinator',
      attempt_trail: AMBIENT_TRAIL,
    }));

    const kept = m.selectInteresting(rows);

    assert.equal(kept.length, 2, 'only one exemplar per route should survive, not 50');
    assert.deepEqual(kept.map(r => r.route_key), ['bg-consolidator-mentions', 'bg-health-coordinator']);
    // And the naive predicate would indeed have kept everything — asserted so
    // this test fails loudly if someone "simplifies" back to it.
    assert.equal(rows.filter(r => r.chain_position > 0 || r.offloaded_from || r.attempt_trail).length, 50);
  });

  test('a provider that was tried and failed does make a call interesting', () => {
    const attempted = row({
      route_key: 'bg-consolidator-mentions',
      attempt_trail: JSON.stringify({
        attempts: [{ provider: 'qwen-laptop', model: 'qwen3.8-27b-local', error: 'timeout', ms: 20000 }],
      }),
    });
    const rows = [...Array.from({ length: 20 }, () => row({ route_key: 'bg-consolidator-mentions' })), attempted];

    const kept = m.selectInteresting(rows);
    assert.ok(kept.includes(attempted), 'a real attempt must always survive the filter');
    assert.equal(kept.length, 2, 'the deviation, plus one ordinary exemplar for the route');
  });

  test('every route keeps an exemplar, so an all-quiet window is not an empty strip', () => {
    const rows = ['a', 'b', 'c'].flatMap(k =>
      Array.from({ length: 10 }, () => row({ route_key: k })));
    const kept = m.selectInteresting(rows);
    assert.deepEqual(kept.map(r => r.route_key), ['a', 'b', 'c']);
  });

  test('the exemplar is each route\'s NEWEST ordinary call, not its oldest', () => {
    // Keeping the oldest pins every exemplar to the start of the window. Live,
    // that made the strip's end labels read 18:13 -> 18:38 inside a 24h window —
    // a strip that claims traffic stopped 12 hours ago when it had not.
    const rows = [
      row({ route_key: 'a', timestamp: '2026-08-30T01:00:00.000Z' }),
      row({ route_key: 'b', timestamp: '2026-08-30T02:00:00.000Z' }),
      row({ route_key: 'a', timestamp: '2026-08-30T05:00:00.000Z' }),
      row({ route_key: 'b', timestamp: '2026-08-30T06:00:00.000Z' }),
    ];
    assert.deepEqual(
      m.selectInteresting(rows).map(r => r.timestamp.slice(11, 16)),
      ['05:00', '06:00'],
    );
  });

  test('selection preserves the caller ordering, so slider index matches the strip', () => {
    const rows = [
      row({ route_key: 'a', timestamp: '2026-08-30T01:00:00.000Z' }),
      row({ route_key: 'b', timestamp: '2026-08-30T02:00:00.000Z' }),
      row({ route_key: 'a', timestamp: '2026-08-30T03:00:00.000Z', chain_position: 1 }),
    ];
    const kept = m.selectInteresting(rows);
    assert.deepEqual(kept.map(r => r.timestamp.slice(11, 16)), ['01:00', '02:00', '03:00']);
  });
});

describe('outcome classification', () => {
  test('a fallback and a failed attempt both read as deviated', () => {
    assert.equal(m.classifyCall(row({ chain_position: 1 })), 'deviated');
    assert.equal(m.classifyCall(row({
      attempt_trail: JSON.stringify({ attempts: [{ provider: 'qwen-laptop', error: 'timeout' }] }),
    })), 'deviated');
  });

  test('an offloaded call is offloaded, an ordinary one is routed', () => {
    assert.equal(m.classifyCall(row({ offloaded_from: 'gh-copilot' })), 'offloaded');
    assert.equal(m.classifyCall(row({ attempt_trail: AMBIENT_TRAIL })), 'routed');
  });

  test('a malformed trail degrades to routed rather than throwing', () => {
    assert.equal(m.classifyCall(row({ attempt_trail: '{not json' })), 'routed');
    assert.equal(m.parseTrail('{not json'), null);
  });
});

describe('binning', () => {
  test('a bin takes its worst member, never an average', () => {
    // The one fallback in a thousand ordinary calls is the entire reason to look
    // at the strip. If binning can average it away the strip is decorative.
    const rows = Array.from({ length: 1000 }, (_, i) => row(i === 500 ? { chain_position: 1 } : {}));
    const bins = m.binRows(rows, 10);
    assert.equal(bins.length, 10);
    assert.equal(bins.filter(b => b.outcome === 'deviated').length, 1,
      'exactly the bin holding the fallback must be flagged');
    assert.equal(bins.filter(b => b.outcome === 'routed').length, 9);
  });

  test('fewer rows than columns bins one row each, and never drops one', () => {
    const rows = Array.from({ length: 3 }, (_, i) => row({ timestamp: `2026-08-30T0${i}:00:00.000Z` }));
    const bins = m.binRows(rows, 300);
    assert.equal(bins.length, 3);
    assert.equal(bins.reduce((n, b) => n + b.rows.length, 0), 3);
  });

  test('an empty window bins to nothing rather than throwing', () => {
    assert.deepEqual(m.binRows([], 100), []);
  });

  test('a reconstructed row marks its bin, so it can be hatched', () => {
    const bins = m.binRows([row({ routing_source: 'backfill' }), row()], 1);
    assert.equal(bins[0].reconstructed, true);
  });
});

describe('rung attribution', () => {
  test('an offloaded call lands on the PASS rung', () => {
    assert.equal(m.rungOfCall(row({ offloaded_from: 'gh-copilot' })), 6);
  });

  test('a recorded reason maps to the rung that emitted it', () => {
    assert.equal(m.rungOfCall(row({ attempt_trail: AMBIENT_TRAIL })), 3);
    assert.equal(m.rungOfCall(row({
      attempt_trail: JSON.stringify({ offloadSkipped: 'band "medium" is not in offload_bands [small]' }),
    })), 2);
  });

  test('a call with no recorded verdict returns null rather than a guess', () => {
    // Backfilled and pre-instrumentation rows carry nothing. Resolving them
    // against today's config would describe today, not the moment of the call.
    assert.equal(m.rungOfCall(row({ attempt_trail: '' })), null);
    assert.equal(m.rungOfCall(row({ attempt_trail: JSON.stringify({ skipped: [] }) })), null);
    assert.equal(m.rungOfCall(row({
      attempt_trail: JSON.stringify({ offloadSkipped: 'a reason a newer proxy invented' }),
    })), null, 'an unclassifiable reason must not be pinned to a rung');
  });
});

describe('hour boundaries', () => {
  test('marks each index where the wall-clock hour changes', () => {
    const rows = ['05:58', '05:59', '06:00', '06:30', '07:01'].map(t =>
      row({ timestamp: `2026-08-30T${t}:00.000Z` }));
    assert.deepEqual(m.hourBoundaries(rows), [2, 4]);
  });
});
