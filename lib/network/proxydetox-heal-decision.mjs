// lib/network/proxydetox-heal-decision.mjs
//
// Whether a failing proxy probe means PROXYDETOX is broken — the only thing a
// heal can fix — or means the network behind it is unreachable, which a heal
// cannot fix and actively makes worse.
//
// ── Why this is a module and not an `if` in two scripts ──────────────────────
// Two independent healers exist today and they decide from ONE signal: a
// proxied HTTPS request to an external host (`captive.apple.com`).
//
//   scripts/health-coordinator.js  pollNetworkStatus()  — 1 kickstart, after
//                                  3 consecutive debounced failures
//   scripts/detect-network.sh      ensure_proxydetox_up() — 3x bootout +
//                                  bootstrap + kickstart, on EVERY launch,
//                                  with no debounce at all
//
// That single signal is false whenever proxydetox is perfectly healthy and the
// corporate upstream or the internet beyond it is not. The response —
// `launchctl bootout` + `bootstrap`, three times, dropping every live
// connection — cannot fix a network-side cause and takes ~6s to fail at it.
//
// Measured, 2026-08-30 (.logs/health-coordinator.log):
//
//   09:35:04  network: proxy intent=ON but PORT ALIVE but proxy not functional
//             (network change?) — kickstarting proxydetox
//   09:35:09  proxydetox kickstart error: Command failed ...
//   09:35:14  proxydetox kickstarted — port listening but still not functional
//   09:36:21  proxydetox auto-healed — port 3128 listening and functional
//
// "port alive" and "port listening" throughout: the socket was bound the whole
// time and the daemon was never the problem. During that 77-second window three
// `coding --pi` launches failed, each running its own triple teardown on top of
// the coordinator's heal. The `?` in "(network change?)" is doing real work —
// it is the module's whole reason to exist.
//
// The discriminating signals were all being computed nearby and never consulted
// at the decision: `netState.location` about 100 lines further down the SAME
// function, and `launchctl print` state/pid, which proxydetoxctl already reads.
//
// PURE — every input is an argument. No env, no I/O, no clock. So the sequence
// above is replayed in tests/network/proxydetox-heal-decision.test.mjs rather
// than reproduced by disconnecting a laptop.

/**
 * What the evidence says is wrong. Exposed so callers can LOG the cause instead
 * of a question mark, which is most of the value here even when `heal` agrees
 * with what the old code would have done.
 */
export const CAUSES = Object.freeze({
  HEALTHY: 'healthy',
  DAEMON: 'daemon',
  UPSTREAM: 'upstream',
  OFFLINE: 'offline',
  INDETERMINATE: 'indeterminate',
});

/**
 * Decide whether to heal proxydetox.
 *
 * The rules are ordered cheapest-and-most-certain first, and they are asymmetric
 * on purpose, because the costs are:
 *
 *   • A missed heal costs one more poll cycle (30s) before the next attempt, and
 *     the port-dead case below catches the unambiguous failure immediately.
 *   • A wrongly-fired heal drops every live connection through :3128, which
 *     makes the NEXT probe fail too. That self-reinforces — it is the documented
 *     origin of the ON/OFF/ON oscillation the hysteresis block was added to
 *     stop, and of the 2026-08-16 incident where the LLM proxy was restarted
 *     seven times in four minutes off-corp.
 *
 * So: heal only on evidence that implicates the DAEMON, and treat "I cannot
 * tell" as "do not touch it".
 *
 * @param {object} input
 * @param {boolean} input.portListening        TCP connect to 127.0.0.1:3128 succeeded
 * @param {boolean} [input.launchdLoaded]      `launchctl print <label>` succeeded
 * @param {boolean} input.proxiedExternalOk    request THROUGH :3128 to an external host succeeded
 * @param {boolean|null} [input.directExternalOk]   same host BYPASSING the proxy; null = not probed
 * @param {boolean|null} [input.proxiedInternalOk]  request THROUGH :3128 to a corporate host; null = not probed
 * @param {'corporate'|'vpn'|'open'|null} [input.location]  coordinator's network verdict
 * @param {number} [input.consecutiveFailures] consecutive raw functional failures so far
 * @param {number} [input.failureThreshold]    how many before an ambiguous failure is acted on
 * @returns {{heal: boolean, cause: string, reason: string}}
 */
export function decideProxydetoxHeal({
  portListening,
  launchdLoaded = true,
  proxiedExternalOk,
  directExternalOk = null,
  proxiedInternalOk = null,
  location = null,
  consecutiveFailures = 0,
  failureThreshold = 3,
}) {
  const verdict = (heal, cause, reason) => ({ heal, cause, reason });

  // 1. The happy path. One request through the proxy reached the internet;
  //    nothing else needs establishing.
  if (proxiedExternalOk === true) {
    return verdict(false, CAUSES.HEALTHY, 'a request through :3128 reached the internet');
  }

  // 2. The job is not registered with launchd at all. Nothing else can be true
  //    of a daemon that does not exist, so this outranks every network signal.
  if (!launchdLoaded) {
    return verdict(true, CAUSES.DAEMON, 'launchd job is not loaded — bootstrap it');
  }

  // 3. Nothing is bound to :3128. Unambiguous and NOT debounced: no network
  //    condition can un-bind a local socket, so this is always the daemon. This
  //    is the one case the old single-signal check got right, and it is the case
  //    the socket-activation comment in detect-network.sh describes.
  if (!portListening) {
    return verdict(true, CAUSES.DAEMON, 'nothing is listening on :3128 — stale socket');
  }

  // ── The socket is bound and the proxied request still failed. ──────────────
  // Everything below separates "the daemon is wedged" from "there is nothing
  // working behind it". Until 2026-08-30 all of it collapsed into one branch.

  // 4. The machine has no internet even WITHOUT the proxy. proxydetox cannot be
  //    the cause of that and restarting it cannot be the cure. This is the
  //    single most useful probe because it is valid on every network — on
  //    corporate, on VPN and at a cafe alike.
  if (directExternalOk === false) {
    return verdict(false, CAUSES.OFFLINE,
      'the host has no internet with or without the proxy — not a proxydetox fault');
  }

  // 5. The daemon proxied a request to a corporate host successfully, so it is
  //    accepting connections, resolving, and forwarding. What failed is egress
  //    beyond it. A bootout would drop working corporate traffic to fix nothing.
  if (proxiedInternalOk === true) {
    return verdict(false, CAUSES.UPSTREAM,
      'the proxy still reaches internal hosts — egress past it is what is down');
  }

  // 6. Genuinely ambiguous: the socket is bound, we could not prove the daemon
  //    is forwarding anything, and we could not prove the host is offline. This
  //    is the VPN-transition shape, where `location` is briefly stale and the
  //    corporate side is unreachable through no fault of the daemon.
  //
  //    Debounce rather than guess. The coordinator already had this threshold
  //    and it is the launcher — which had none — that this rule exists for.
  if (consecutiveFailures >= failureThreshold) {
    return verdict(true, CAUSES.DAEMON,
      `no path through :3128 could be proven over ${consecutiveFailures} consecutive probes`);
  }

  return verdict(false, CAUSES.INDETERMINATE,
    `cannot yet attribute the failure (${consecutiveFailures}/${failureThreshold} consecutive)`
    + `${location ? ` on network=${location}` : ''} — not touching a bound socket`);
}

/**
 * Which extra probes are worth running before calling {@link decideProxydetoxHeal}.
 *
 * Both extra probes cost a few seconds of curl, and on the happy path neither is
 * needed — so they run only once the cheap signals have already failed. Mirrors
 * needsReachabilityProbe() in rapid-llm-proxy's egress-decision.mjs, and exists
 * for the same reason: the steady state must stay free.
 *
 * @param {{portListening: boolean, proxiedExternalOk: boolean}} input
 * @returns {{direct: boolean, internal: boolean}}
 */
export function neededProbes({ portListening, proxiedExternalOk }) {
  const ambiguous = portListening === true && proxiedExternalOk !== true;
  return { direct: ambiguous, internal: ambiguous };
}
