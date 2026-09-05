/**
 * Unit suite for lib/network/post-kickstart-recovery.mjs.
 *
 * Replays the 2026-09-05 VPN transition from the coordinator's own log:
 *
 *   13:36:19  network: location=vpn
 *   13:36:29  proxy stale: host=corporate but proxy frozen at public:
 *             dispatching restart_llm_cli_proxy
 *   13:36:29  proxy semantic_strong_ok flip -> false (network_fetch failed)
 *   13:41:38  proxy semantic_strong_ok flip -> true (1345ms)
 *
 * 309 seconds of amber — almost exactly one PROXY_STRONG_PROBE_INTERVAL_MS —
 * against a proxy the kickstart had already repaired. The synthetic probe is
 * kept slow on purpose (it bills ~14-22K cache_creation tokens under 429
 * fallback), so the fast path may only spend the FREE proof: a real
 * observation-writer call that succeeded SINCE the restart.
 *
 * Run: node --test tests/network/post-kickstart-recovery.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decidePostKickstartRecovery, DECLINE } from '../../lib/network/post-kickstart-recovery.mjs';

const INTERVAL = 5 * 60_000;
const WINDOW = 5 * 60_000;
const NOW = 1_788_608_500_000;
const DISPATCHED = NOW - 120_000;   // kickstart 2 min ago

/** The incident's shape, with only the field under test varied. */
const base = (over = {}) => ({
  awaiting: true,
  strongOk: false,
  strongAgeMs: 120_000,        // inside the interval: scheduled probe not due
  intervalMs: INTERVAL,
  lastCallAgeMs: 30_000,       // a success 30s ago, i.e. 90s AFTER the restart
  dispatchedAt: DISPATCHED,
  now: NOW,
  realTrafficMaxAgeMs: WINDOW,
  ...over,
});

describe('post-kickstart recovery clears the badge without paying for a probe', () => {
  it('accepts a success that post-dates the kickstart', () => {
    const v = decidePostKickstartRecovery(base());
    assert.equal(v.recovered, true);
    assert.equal(v.reason, 'post-kickstart-real-traffic');
  });

  it('REFUSES a success from before the kickstart', () => {
    // The rule the module exists for. This call is 90s old — comfortably
    // inside the 5-minute real-traffic window — but it happened 30s BEFORE
    // the restart. Judging on age alone would declare the restart a success
    // using evidence from the broken era.
    const v = decidePostKickstartRecovery(base({ lastCallAgeMs: 150_000 }));
    assert.equal(v.recovered, false);
    assert.equal(v.reason, DECLINE.PRE_RESTART);
  });

  it('refuses a call exactly at the dispatch instant', () => {
    // Ties go to "not proven" — the call may have been in flight when the
    // proxy went down.
    const v = decidePostKickstartRecovery(base({ lastCallAgeMs: NOW - DISPATCHED }));
    assert.equal(v.recovered, false);
    assert.equal(v.reason, DECLINE.PRE_RESTART);
  });

  it('refuses when no writer call is recorded at all', () => {
    for (const empty of [null, undefined]) {
      assert.equal(decidePostKickstartRecovery(base({ lastCallAgeMs: empty })).reason, DECLINE.NO_TRAFFIC);
    }
  });

  it('refuses traffic older than the real-traffic window', () => {
    const v = decidePostKickstartRecovery(base({ lastCallAgeMs: WINDOW + 1, dispatchedAt: NOW - WINDOW - 10_000 }));
    assert.equal(v.recovered, false);
    assert.equal(v.reason, DECLINE.STALE);
  });

  it('stands down once the scheduled probe is due', () => {
    // Past the interval the real probe runs anyway; a second path would only
    // race it.
    const v = decidePostKickstartRecovery(base({ strongAgeMs: INTERVAL }));
    assert.equal(v.recovered, false);
    assert.equal(v.reason, DECLINE.PROBE_DUE);
  });

  it('never fires without an outstanding kickstart', () => {
    assert.equal(decidePostKickstartRecovery(base({ awaiting: false })).reason, DECLINE.NOT_AWAITING);
  });

  it('only ever RESCUES a failing badge — never downgrades or pre-empts', () => {
    // A fast path that could act on a healthy or unknown badge would be able
    // to overwrite a real probe result.
    for (const strongOk of [true, null]) {
      assert.equal(decidePostKickstartRecovery(base({ strongOk })).reason, DECLINE.ALREADY_OK);
    }
  });
});
