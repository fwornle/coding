/**
 * lib/network/location-hysteresis.mjs — settle a per-tick network verdict.
 *
 * The coordinator decides `corporate` / `vpn` / `open` from three signals, and
 * the corporate half of that rests on ONE DNS lookup for the PAC host. Lose
 * that packet and `pacResolved` goes false; the latency probe that separates
 * on-site from VPN never runs, because it is gated on pacResolved; and the
 * chain falls past `corporate` and past `vpn` to the final else — `open`.
 *
 * That verdict is not cosmetic. It is served by /health/state, rendered in the
 * statusline as N:CN, and re-read by the LLM proxy every 30s — which drops its
 * corporate proxy pin the moment it reads `public`, by design. So a single lost
 * UDP packet takes egress DIRECT on a corporate network, and every off-prem
 * provider call fails with `fetch failed` until the next probe restores it.
 *
 * Measured in .logs/health-coordinator.log before this existed: `open` episodes
 * lasting 3s, 19s, 20s and 25s. Nobody leaves a building for three seconds.
 *
 * ── Why asymmetric ──────────────────────────────────────────────────────────
 * Demotion off the corporate network is debounced; promotion onto it is
 * immediate. The two errors are not symmetric:
 *
 *   * Holding `corporate` too long is already covered elsewhere. The proxy
 *     un-pins any proxy that stops answering its own reachability probe, so a
 *     network you have genuinely left self-corrects there.
 *   * Holding `open` too long is covered by nothing. Nothing else re-pins the
 *     proxy, so the machine sits on corporate with direct egress — the exact
 *     failure this whole mechanism exists to prevent.
 *
 * Failing toward "still corporate" is therefore the safe direction, and the
 * only one with a second line of defence behind it.
 *
 * ── Why a module ────────────────────────────────────────────────────────────
 * Same reason as proxydetox-heal-decision.mjs and egress-decision.mjs in the
 * proxy: the rule is pure, so the blip sequence that caused the outage is a
 * unit test instead of something you reproduce by unplugging a laptop. The
 * caller owns the counter — it lives in the coordinator's network state, so a
 * pending demotion is visible in /health/state rather than hidden in a module
 * global that no reader can reach.
 */

/**
 * Consecutive `open` readings required before we publish it over a corporate
 * verdict. At the coordinator's 15s cadence this covers ~45s, comfortably more
 * than every transient episode observed.
 */
export const OPEN_DEMOTION_CONFIRM_TICKS = 3;

/** Locations that mean "the corporate network is reachable from here". */
const ON_CORPORATE_NET = new Set(['corporate', 'vpn']);

/**
 * Settle this tick's raw verdict into the one to publish.
 *
 * @param {object} input
 * @param {'corporate'|'vpn'|'open'} input.observed  this tick's signals
 * @param {string|null|undefined} input.previous     last PUBLISHED location
 * @param {number} [input.pending=0]                 consecutive `open` readings so far
 * @returns {{ location: string, held: boolean, pending: number }}
 *   `location` to publish, `held` when a demotion was suppressed this tick, and
 *   the `pending` count to carry into the next call.
 */
export function settleLocation({ observed, previous, pending = 0 }) {
  const count = Number.isFinite(pending) && pending > 0 ? pending : 0;

  if (observed === 'open' && ON_CORPORATE_NET.has(previous)) {
    const next = count + 1;
    if (next < OPEN_DEMOTION_CONFIRM_TICKS) {
      return { location: previous, held: true, pending: next };
    }
    // Confirmed — publish it, and reset so the NEXT demotion counts from zero
    // rather than tripping on its first tick.
    return { location: observed, held: false, pending: 0 };
  }

  // Everything else clears the count, including a single good probe arriving
  // mid-demotion. That is precisely what makes a blip cost nothing: the run has
  // to be uninterrupted, not merely frequent.
  return { location: observed, held: false, pending: 0 };
}
