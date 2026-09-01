/**
 * Unit suite for lib/network/kickstart-gate.mjs.
 *
 * Replays the 2026-08-31 cascade, from the coordinator's own log:
 *
 *   07:02:52.046  proxy auto-heal: dispatching restart (consecutive_failures=1, kickstart_count=1)
 *   07:02:52.063  proxy auto-heal: dispatching restart (consecutive_failures=2, kickstart_count=2)
 *   07:02:52.114  proxy strong-probe escalation: dispatching restart (kickstart_count=3)
 *   07:04:34      proxy auto-heal cooldown engaged — 3 kickstarts in last 300s
 *
 * One failure, three restarts in 68ms, the whole 3-per-5-minutes budget spent
 * before the first restart finished — so a genuine fault in the following five
 * minutes had no remediation left. At 07:04:33 a kickstart errored outright,
 * because the service was still coming up from 100ms earlier.
 *
 * Run: node --test tests/network/kickstart-gate.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideKickstart, isFreshProbeOutcome, pruneWindow,
  KICKSTART_WINDOW_MS, KICKSTART_MAX_IN_WINDOW, KICKSTART_DEBOUNCE_MS,
} from '../../lib/network/kickstart-gate.mjs';

const T0 = 1_756_000_000_000;  // fixed epoch; the module never reads a clock

describe('one incident spends one kickstart, not three', () => {
  it('replays the 68ms cascade and allows exactly one', () => {
    // The three historical dispatches, at their real offsets.
    const offsets = [0, 17, 68];
    let timestamps = [];
    let lastDispatchAt = null;
    const allowed = [];

    for (const ms of offsets) {
      const now = T0 + ms;
      const d = decideKickstart({ now, timestamps, lastDispatchAt });
      if (d.allowed) {
        allowed.push(ms);
        timestamps = [...d.recent, now];
        lastDispatchAt = now;
      }
    }

    assert.deepEqual(allowed, [0], 'only the first of the three may dispatch');
    assert.equal(timestamps.length, 1, 'the window must carry one kickstart of debt, not three');
  });

  it('leaves the budget intact for a real fault minutes later', () => {
    // The point of the fix. After the cascade, the old code was at 3/3 and
    // suppressed everything for five minutes.
    const afterCascade = { timestamps: [T0], lastDispatchAt: T0 };
    const later = decideKickstart({ now: T0 + 2 * 60_000, ...afterCascade });
    assert.equal(later.allowed, true, 'a genuine fault 2 minutes later must still be actionable');
  });
});

describe('the debounce measures time, which the count cap never did', () => {
  it('refuses a second dispatch inside the debounce window', () => {
    const d = decideKickstart({ now: T0 + 5_000, timestamps: [T0], lastDispatchAt: T0 });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'debounced');
    assert.equal(d.waitMs, KICKSTART_DEBOUNCE_MS - 5_000);
  });

  it('allows it once the debounce has elapsed', () => {
    const d = decideKickstart({
      now: T0 + KICKSTART_DEBOUNCE_MS, timestamps: [T0], lastDispatchAt: T0,
    });
    assert.equal(d.allowed, true, 'exactly at the boundary the gap has been served');
  });

  it('covers the restart itself — the case that produced an errored kickstart', () => {
    // A restart takes 3-8s to come back. Every instant in that range must be
    // refused; on 2026-08-31 one was not, and launchctl failed on a service
    // that was already mid-restart.
    for (const ms of [100, 1_000, 3_000, 8_000, 30_000]) {
      const d = decideKickstart({ now: T0 + ms, timestamps: [T0], lastDispatchAt: T0 });
      assert.equal(d.allowed, false, `a dispatch ${ms}ms into a restart must be refused`);
    }
  });

  it('does not gate the FIRST dispatch — nothing has restarted yet', () => {
    const d = decideKickstart({ now: T0, timestamps: [], lastDispatchAt: null });
    assert.equal(d.allowed, true);
    assert.equal(d.reason, 'ok');
  });
});

describe('the cooldown cap still means what it always meant', () => {
  const spaced = [T0, T0 + 60_000, T0 + 120_000];

  it('suppresses a fourth restart when three did not fix it', () => {
    const d = decideKickstart({
      now: T0 + 180_000, timestamps: spaced, lastDispatchAt: spaced[2],
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'cooldown');
  });

  it('reopens once the oldest slides out of the window', () => {
    const now = T0 + KICKSTART_WINDOW_MS + 1;
    const d = decideKickstart({ now, timestamps: spaced, lastDispatchAt: spaced[2] });
    assert.equal(d.allowed, true);
    assert.equal(d.recent.length, KICKSTART_MAX_IN_WINDOW - 1, 'the expired entry is dropped');
  });

  it('reports debounced before cooldown when both apply', () => {
    // Ordering matters for the operator: "something just restarted it" is a
    // different instruction from "three restarts did not help, look at this".
    const d = decideKickstart({ now: T0 + 120_001, timestamps: spaced, lastDispatchAt: spaced[2] });
    assert.equal(d.reason, 'debounced');
  });
});

describe('a user action does not spend the failure budget, but is still debounced', () => {
  const full = [T0, T0 + 60_000, T0 + 120_000];

  it('a networkMode flip dispatches even at the cap', () => {
    // The network changed; that is not evidence the proxy is failing, and the
    // failure cooldown has never gated it.
    const d = decideKickstart({
      now: T0 + 180_000, timestamps: full, lastDispatchAt: full[2], countsTowardCap: false,
    });
    assert.equal(d.allowed, true);
  });

  it('but not while a restart is already in flight', () => {
    // If something restarted the proxy 2s ago, the fresh network detection the
    // flip wants has already happened.
    const d = decideKickstart({
      now: T0 + 2_000, timestamps: [T0], lastDispatchAt: T0, countsTowardCap: false,
    });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'debounced');
  });
});

describe('the FSM must count probe outcomes, not the callers that read them', () => {
  it('the same probe result is fresh exactly once', () => {
    const stamp = '2026-08-31T07:02:52.046Z';
    assert.equal(isFreshProbeOutcome(null, stamp), true, 'first sight of a result');
    assert.equal(isFreshProbeOutcome(stamp, stamp), false, 'the tick re-reading the same result');
  });

  it('a genuinely new probe result is fresh again', () => {
    assert.equal(
      isFreshProbeOutcome('2026-08-31T07:02:52.046Z', '2026-08-31T07:03:52.046Z'),
      true,
    );
  });

  it('no probe yet is not an outcome — it must never drive a restart at boot', () => {
    assert.equal(isFreshProbeOutcome(null, null), false);
    assert.equal(isFreshProbeOutcome(null, undefined), false);
    assert.equal(isFreshProbeOutcome('2026-08-31T07:02:52.046Z', null), false);
  });

  it('three callers reading one failed probe produce one count', () => {
    // pollProxySemantic, the real-traffic shortcut, and the /health/refresh
    // tick — the exact shape of the cascade.
    const stamp = '2026-08-31T07:02:52.046Z';
    let evaluated = null;
    let counted = 0;
    for (let caller = 0; caller < 3; caller += 1) {
      if (isFreshProbeOutcome(evaluated, stamp)) { counted += 1; evaluated = stamp; }
    }
    assert.equal(counted, 1);
  });
});

describe('pruneWindow', () => {
  it('drops what has expired and keeps what has not, without mutating', () => {
    const input = [T0, T0 + 299_000];
    const out = pruneWindow(input, T0 + KICKSTART_WINDOW_MS);
    assert.deepEqual(out, [T0 + 299_000]);
    assert.deepEqual(input, [T0, T0 + 299_000], 'input untouched');
  });

  it('tolerates an absent list', () => {
    assert.deepEqual(pruneWindow(undefined, T0), []);
    assert.deepEqual(pruneWindow(null, T0), []);
  });
});
