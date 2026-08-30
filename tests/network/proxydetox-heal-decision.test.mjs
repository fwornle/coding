/**
 * Unit suite for lib/network/proxydetox-heal-decision.mjs.
 *
 * These rules decide whether to run `launchctl bootout` on the local adaptive
 * proxy that EVERY agent session is pinned to. Getting them wrong does not
 * degrade one feature — it drops every live connection through :3128, which
 * makes the next probe fail too and self-reinforces into a heal loop.
 *
 * The 2026-08-30 incident is replayed verbatim at the bottom of this file.
 *
 * Run: node --test tests/network/proxydetox-heal-decision.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideProxydetoxHeal, neededProbes, CAUSES }
  from '../../lib/network/proxydetox-heal-decision.mjs';

/** The steady state: bound socket, working egress. */
const healthy = { portListening: true, proxiedExternalOk: true };

describe('decideProxydetoxHeal — the unambiguous daemon faults', () => {
  it('heals when nothing is listening on :3128', () => {
    const d = decideProxydetoxHeal({ portListening: false, proxiedExternalOk: false });
    assert.equal(d.heal, true);
    assert.equal(d.cause, CAUSES.DAEMON);
  });

  it('does NOT debounce a dead port — no network condition un-binds a local socket', () => {
    // consecutiveFailures is 0, i.e. nowhere near the threshold, and it still heals.
    const d = decideProxydetoxHeal({
      portListening: false, proxiedExternalOk: false, consecutiveFailures: 0,
    });
    assert.equal(d.heal, true);
  });

  it('heals when the launchd job is not loaded, whatever the socket says', () => {
    const d = decideProxydetoxHeal({
      portListening: false, launchdLoaded: false, proxiedExternalOk: false,
    });
    assert.equal(d.heal, true);
    assert.match(d.reason, /not loaded/);
  });
});

describe('decideProxydetoxHeal — healthy', () => {
  it('never heals when a request through the proxy reached the internet', () => {
    const d = decideProxydetoxHeal(healthy);
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.HEALTHY);
  });

  it('ignores every other signal once the proxied request succeeded', () => {
    // A stale `location`, a failed internal probe and a big failure count must
    // not override direct evidence that the thing works right now.
    const d = decideProxydetoxHeal({
      ...healthy, location: 'open', proxiedInternalOk: false, consecutiveFailures: 99,
    });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.HEALTHY);
  });
});

describe('decideProxydetoxHeal — failures that are NOT proxydetox', () => {
  it('does not heal when the host has no internet with or without the proxy', () => {
    const d = decideProxydetoxHeal({
      portListening: true, proxiedExternalOk: false, directExternalOk: false,
      consecutiveFailures: 10,   // well past the threshold, and still no heal
    });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.OFFLINE);
  });

  it('does not heal when the proxy still reaches internal hosts', () => {
    // It is accepting connections, resolving and forwarding. Only egress past
    // it is down, and a bootout would drop working corporate traffic.
    const d = decideProxydetoxHeal({
      portListening: true, proxiedExternalOk: false,
      directExternalOk: true, proxiedInternalOk: true,
      location: 'corporate', consecutiveFailures: 10,
    });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.UPSTREAM);
  });

  it('offline outranks the internal probe — an unreachable corporate host off-corp proves nothing', () => {
    const d = decideProxydetoxHeal({
      portListening: true, proxiedExternalOk: false,
      directExternalOk: false, proxiedInternalOk: false, location: 'open',
    });
    assert.equal(d.cause, CAUSES.OFFLINE);
  });
});

describe('decideProxydetoxHeal — the ambiguous middle is debounced, not guessed', () => {
  const ambiguous = {
    portListening: true, proxiedExternalOk: false,
    directExternalOk: true, proxiedInternalOk: false, location: 'vpn',
  };

  it('holds off while the failure count is below the threshold', () => {
    const d = decideProxydetoxHeal({ ...ambiguous, consecutiveFailures: 1 });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.INDETERMINATE);
  });

  it('acts once the failure is confirmed over several consecutive probes', () => {
    const d = decideProxydetoxHeal({ ...ambiguous, consecutiveFailures: 3 });
    assert.equal(d.heal, true);
    assert.equal(d.cause, CAUSES.DAEMON);
  });

  it('honours a caller-supplied threshold — the launcher may be more patient', () => {
    const d = decideProxydetoxHeal({ ...ambiguous, consecutiveFailures: 3, failureThreshold: 5 });
    assert.equal(d.heal, false);
  });

  it('names the network in the reason so the log states a cause, not a question mark', () => {
    const d = decideProxydetoxHeal({ ...ambiguous, consecutiveFailures: 1 });
    assert.match(d.reason, /network=vpn/);
  });

  it('un-probed extra signals fall through to the debounce rather than to a heal', () => {
    // directExternalOk/proxiedInternalOk default to null ("not probed"). A
    // caller that skips them must get the OLD debounced behaviour, never a
    // more aggressive one.
    const d = decideProxydetoxHeal({
      portListening: true, proxiedExternalOk: false, consecutiveFailures: 1,
    });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.INDETERMINATE);
  });
});

describe('neededProbes — the steady state stays free', () => {
  it('runs no extra probes while the proxy is working', () => {
    assert.deepEqual(neededProbes(healthy), { direct: false, internal: false });
  });

  it('runs no extra probes when the port is dead — the answer is already known', () => {
    assert.deepEqual(
      neededProbes({ portListening: false, proxiedExternalOk: false }),
      { direct: false, internal: false },
    );
  });

  it('runs both only in the ambiguous case they exist to resolve', () => {
    assert.deepEqual(
      neededProbes({ portListening: true, proxiedExternalOk: false }),
      { direct: true, internal: true },
    );
  });
});

describe('the 2026-08-30 incident, replayed', () => {
  // .logs/health-coordinator.log, 09:35:04 -> 09:36:21. The VPN was in
  // transition. Every line in that window logged "port alive"/"port listening",
  // so the socket was bound throughout and the daemon was never at fault —
  // yet the coordinator kickstarted it repeatedly and three `coding --pi`
  // launches each ran their own triple bootout+bootstrap on top.
  //
  // What the old code saw: one failing probe to captive.apple.com.
  // What was also true and never consulted: the socket was bound, the host had
  // internet, and the corporate side was unreachable because the VPN was moving.
  const window = {
    portListening: true,        // "port alive" / "port listening", every line
    launchdLoaded: true,
    proxiedExternalOk: false,   // the only signal the old code had
    directExternalOk: true,     // the laptop itself was online
    proxiedInternalOk: false,   // corporate unreachable mid-transition
    location: 'vpn',            // coordinator still said vpn for ~6 more minutes
  };

  it('does not bootout a bound socket on the first failing probe', () => {
    const d = decideProxydetoxHeal({ ...window, consecutiveFailures: 1 });
    assert.equal(d.heal, false, 'the launcher had no debounce and tore down 3x');
    assert.equal(d.cause, CAUSES.INDETERMINATE);
  });

  it('still does not heal at 09:36:21, when it recovered on its own', () => {
    // The recovery was the network coming back, not the heal working. Once the
    // proxied request succeeds the verdict is HEALTHY regardless of history.
    const d = decideProxydetoxHeal({ ...window, proxiedExternalOk: true, consecutiveFailures: 8 });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.HEALTHY);
  });

  it('had the internal probe answered, it would have named the cause outright', () => {
    // The counterfactual worth pinning: with proxydetox forwarding to corporate
    // successfully, this is UPSTREAM and provably not a heal candidate, at any
    // failure count.
    const d = decideProxydetoxHeal({
      ...window, proxiedInternalOk: true, consecutiveFailures: 8,
    });
    assert.equal(d.heal, false);
    assert.equal(d.cause, CAUSES.UPSTREAM);
  });

  it('the negative control: a genuinely dead daemon in the same window still heals', () => {
    // Proves this is cause-classification, not "healing disabled".
    const d = decideProxydetoxHeal({ ...window, portListening: false });
    assert.equal(d.heal, true);
    assert.equal(d.cause, CAUSES.DAEMON);
  });
});
