/**
 * lib/network/proxy-mode-flip.mjs — the rule that stops "the same network,
 * spelled differently" from reading as a network change.
 *
 * The first sequence below is a replay of what .logs/health-coordinator.log
 * actually recorded on 2026-09-02 from 18:30:47Z: the host said `vpn`, the
 * proxy said `corporate`, and the detector dispatched a proxy restart every
 * 60s for as long as the laptop stayed on the VPN. Restarts landed on in-flight
 * requests, so a pi turn on corporate printed `Error: Connection error.` twice
 * in a row, twice in one run.
 *
 * The second half guards the opposite failure, which the old code also had: a
 * genuine one-shot switch must still dispatch exactly once. A detector that
 * never fires passes a "no spurious restarts" test for entirely the wrong
 * reason.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  settleModeFlip,
  classifyNetClass,
  NETWORK_MODE_FLIP_CONFIRM_TICKS,
} from '../../lib/network/proxy-mode-flip.mjs';

/**
 * Drive a sequence of per-tick observations through the rule, carrying the
 * settled baseline and the counter the way the coordinator does, and return the
 * tick indices on which a kickstart was dispatched.
 */
function dispatches(observations, startAt = 'corporate') {
  let previous = startAt;
  let pending;
  const fired = [];
  observations.forEach((observed, i) => {
    const r = settleModeFlip({ observed, previous, pending });
    previous = r.settled;
    pending = r.pending;
    if (r.dispatch) fired.push(i);
  });
  return fired;
}

describe('the same network, spelled differently, is not a flip', () => {
  it('never dispatches while the host is on the VPN', () => {
    // The observed loop: coordinator writes `vpn`, proxy reports `corporate`,
    // repeat. Ten ticks, zero restarts.
    const ticks = Array.from({ length: 10 }, (_, i) => (i % 2 ? 'corporate' : 'vpn'));
    assert.deepEqual(dispatches(ticks, 'vpn'), []);
  });

  it('treats every corporate spelling as one class', () => {
    assert.deepEqual(dispatches(['corporate', 'vpn', 'corporate', 'vpn'], 'corporate'), []);
  });

  it('treats every public spelling as one class', () => {
    assert.deepEqual(dispatches(['open', 'public', 'direct', 'home'], 'public'), []);
  });
});

describe('a genuine switch still dispatches, exactly once', () => {
  it('confirms after the threshold and not before', () => {
    // corporate -> public, held. Fires on the tick that completes the run.
    const ticks = Array(NETWORK_MODE_FLIP_CONFIRM_TICKS).fill('public');
    assert.deepEqual(dispatches(ticks, 'corporate'), [NETWORK_MODE_FLIP_CONFIRM_TICKS - 1]);
  });

  it('does not fire again once the new mode is settled', () => {
    // This is the regression the old code could not even reach: after
    // confirming, the baseline advances, so holding the new mode is silent.
    assert.deepEqual(
      dispatches(['public', 'public', 'public', 'public', 'public'], 'corporate'),
      [NETWORK_MODE_FLIP_CONFIRM_TICKS - 1],
    );
  });

  it('dispatches once per switch, in both directions', () => {
    assert.deepEqual(
      dispatches(['public', 'public', 'corporate', 'corporate'], 'corporate'),
      [1, 3],
    );
  });

  it('requires the run to be UNINTERRUPTED, not merely frequent', () => {
    // A link flapping across the threshold is not a departure. If the count
    // only ever incremented, this would dispatch — the bug a naive counter has.
    assert.deepEqual(
      dispatches(['public', 'corporate', 'public', 'corporate', 'public'], 'corporate'),
      [],
    );
  });
});

describe('no evidence is not evidence of a change', () => {
  it('never dispatches on an unreadable observation', () => {
    assert.deepEqual(dispatches(['unknown', 'unknown', 'unknown'], 'corporate'), []);
  });

  it('never dispatches from an unreadable baseline', () => {
    assert.deepEqual(dispatches(['public', 'public'], 'unknown'), []);
  });

  it('adopts the first readable observation as the baseline', () => {
    // The coordinator starts with no settled class at all. Having nothing to
    // compare against is not a transition — otherwise every coordinator restart
    // would cost a proxy restart.
    const r = settleModeFlip({ observed: 'corporate', previous: null });
    assert.equal(r.dispatch, false);
    assert.equal(r.settled, 'corporate');
    assert.equal(r.reason, 'baseline adopted');
  });

  it('having adopted a baseline, still catches the next real switch', () => {
    // null -> corporate (adopt), then corporate -> public held for the
    // threshold. A baseline that adopted but never armed would be silent here.
    assert.deepEqual(
      dispatches(['corporate', 'corporate', 'public', 'public'], null),
      [3],
    );
  });

  it('an unknown mid-run clears the pending count', () => {
    // corporate -> public (1/2), then a probe error, then public again. That is
    // not two consecutive confirmations, so nothing fires until a clean run.
    assert.deepEqual(dispatches(['public', 'unknown', 'public'], 'corporate'), []);
  });

  it('holds the baseline across an unreadable tick', () => {
    const r = settleModeFlip({ observed: 'unknown', previous: 'corporate', pending: 1 });
    assert.equal(r.settled, 'corporate', 'an unknown must not become the new baseline');
    assert.equal(r.dispatch, false);
    assert.equal(r.pending, 0);
  });
});

describe('classifyNetClass', () => {
  it('collapses both vocabularies onto two classes', () => {
    for (const v of ['corporate', 'vpn']) assert.equal(classifyNetClass(v), 'corporate');
    for (const v of ['open', 'home', 'public', 'direct']) assert.equal(classifyNetClass(v), 'public');
  });

  it('returns null for anything it cannot place', () => {
    for (const v of ['unknown', '', null, undefined, 0, {}, 'CORPORATE']) {
      assert.equal(classifyNetClass(v), null, `expected null for ${JSON.stringify(v)}`);
    }
  });
});
