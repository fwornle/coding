/**
 * lib/network/location-hysteresis.mjs — the rule that stops one lost DNS packet
 * reading as "left the corporate network".
 *
 * The sequences below are replays of what the coordinator log actually
 * recorded, so the regression they guard is the observed one rather than an
 * imagined one: transient `open` episodes of 3s, 19s, 20s and 25s, each of
 * which un-pinned the LLM proxy's corporate proxy and broke every off-prem
 * provider call until the next probe.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  settleLocation,
  OPEN_DEMOTION_CONFIRM_TICKS,
} from '../../lib/network/location-hysteresis.mjs';

/**
 * Drive a sequence of raw per-tick verdicts through the rule, carrying the
 * counter the way the coordinator does, and return what was PUBLISHED each tick.
 */
function publish(observations, startAt = 'corporate') {
  let previous = startAt;
  let pending;
  return observations.map((observed) => {
    const r = settleLocation({ observed, previous, pending });
    previous = r.location;
    pending = r.pending;
    return r.location;
  });
}

describe('a blip does not demote a corporate verdict', () => {
  it('swallows a single failed probe', () => {
    // The 3-second episode from 2026-09-01T07:58:38Z.
    assert.deepEqual(
      publish(['open', 'corporate', 'corporate']),
      ['corporate', 'corporate', 'corporate'],
    );
  });

  it('swallows a run one short of the threshold', () => {
    const run = Array(OPEN_DEMOTION_CONFIRM_TICKS - 1).fill('open');
    assert.deepEqual(
      publish([...run, 'corporate']),
      [...run.map(() => 'corporate'), 'corporate'],
    );
  });

  it('requires the run to be UNINTERRUPTED, not merely frequent', () => {
    // Alternating probes are a flaky link, not a departure. If the count only
    // ever incremented, this would eventually demote — which is the bug in the
    // shape a naive counter takes.
    assert.deepEqual(
      publish(['open', 'corporate', 'open', 'corporate', 'open', 'corporate']),
      Array(6).fill('corporate'),
    );
  });

  it('holds from a vpn verdict too, not just corporate', () => {
    // vpn and corporate both mean "the corporate network is reachable", and
    // both keep the proxy pinned. Debouncing only `corporate` would leave the
    // identical hole for anyone on VPN.
    assert.deepEqual(
      publish(['open', 'vpn'], 'vpn'),
      ['vpn', 'vpn'],
    );
  });
});

describe('a real departure still lands', () => {
  it('publishes open once the run reaches the threshold', () => {
    const run = Array(OPEN_DEMOTION_CONFIRM_TICKS).fill('open');
    const got = publish(run);
    assert.deepEqual(got.slice(0, -1), Array(OPEN_DEMOTION_CONFIRM_TICKS - 1).fill('corporate'));
    assert.equal(got[got.length - 1], 'open');
  });

  it('does not re-arm: a later demotion needs its own full run', () => {
    // After confirming, the counter resets. Were it left at the threshold, the
    // next corporate->open transition would demote on its FIRST tick, silently
    // undoing the hysteresis for the rest of the process's life.
    const seq = [
      ...Array(OPEN_DEMOTION_CONFIRM_TICKS).fill('open'),  // confirmed departure
      'corporate',                                        // came back
      'open',                                             // one blip
    ];
    const got = publish(seq);
    assert.equal(got[OPEN_DEMOTION_CONFIRM_TICKS - 1], 'open', 'departure confirmed');
    assert.equal(got[OPEN_DEMOTION_CONFIRM_TICKS], 'corporate', 'returned');
    assert.equal(got[got.length - 1], 'corporate', 'the blip after must be held, not published');
  });

  it('stays open once open, without counting', () => {
    assert.deepEqual(publish(['open', 'open'], 'open'), ['open', 'open']);
  });
});

describe('promotion is immediate — the asymmetry is the point', () => {
  it('publishes corporate on the very first good probe', () => {
    // Debouncing this direction would leave the machine on corporate with
    // direct egress and nothing else to correct it. Un-pinning a dead proxy is
    // already handled by the proxy's own reachability probe; re-pinning is not
    // handled anywhere else.
    assert.deepEqual(publish(['corporate'], 'open'), ['corporate']);
    assert.deepEqual(publish(['vpn'], 'open'), ['vpn']);
  });

  it('reports held only while it is actually suppressing something', () => {
    const blip = settleLocation({ observed: 'open', previous: 'corporate', pending: 0 });
    assert.equal(blip.held, true);
    assert.equal(blip.location, 'corporate');

    const normal = settleLocation({ observed: 'corporate', previous: 'corporate', pending: 0 });
    assert.equal(normal.held, false);
  });
});

describe('the counter survives junk without demoting early', () => {
  for (const pending of [undefined, null, -5, NaN, 'three']) {
    it(`treats ${String(pending)} as zero rather than as progress`, () => {
      // The counter round-trips through /health/state, so it can come back
      // absent or malformed. Reading junk as a high count would demote on the
      // first tick — failing toward the unsafe direction.
      const r = settleLocation({ observed: 'open', previous: 'corporate', pending });
      assert.equal(r.location, 'corporate', 'must still hold');
      assert.equal(r.pending, 1, 'must count this as the first, not the last');
    });
  }
});
