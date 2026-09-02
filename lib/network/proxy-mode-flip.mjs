/**
 * lib/network/proxy-mode-flip.mjs — decide when the proxy's self-reported
 * network mode has really CHANGED, as opposed to being spelled differently.
 *
 * The coordinator restarts the LLM proxy when the network underneath it
 * changes, because the proxy pins HTTPS_PROXY at startup and a stale pin makes
 * every off-prem call fail with `fetch failed` while the proxy itself stays
 * happily alive. Detecting that transition is this module's whole job.
 *
 * ── Why a module, and why classes ───────────────────────────────────────────
 * Two vocabularies describe one physical state, and they do not agree on
 * spelling:
 *
 *   the coordinator's host location   corporate | vpn | open
 *   the proxy's self-reported mode    corporate | public
 *
 * On VPN the host says `vpn` and the proxy says `corporate`. Those are the SAME
 * network. Until 2026-09-02 the detector compared the two raw strings, so it
 * read `vpn -> corporate` as a genuine flip — on every single poll. Each one
 * dispatched a kickstart, the replacement proxy correctly reported `corporate`
 * again, and the next poll saw the same "flip". The result was a restart every
 * 60s (the dispatch debounce), indefinitely, for as long as the laptop stayed
 * on the VPN: 1463 SIGTERM cycles in one proxy log. Restarts landed on
 * in-flight requests, so a pi turn on corporate showed `Error: Connection
 * error.` for no reason a user could act on.
 *
 * The collapse that fixes it already existed twice in this codebase — as
 * `classifyNetClass` inside the coordinator's staleness detector, and as
 * `ON_CORPORATE_NET` in location-hysteresis.mjs. The flip detector was the one
 * place that compared before collapsing. `classifyNetClass` now lives here so
 * there is ONE definition of "same network", and both detectors read it.
 *
 * ── `previous` is the last SETTLED class, not the last reading ──────────────
 * This distinction is the whole hysteresis, and getting it wrong is how the old
 * code carried a second, opposite bug underneath the first. It compared against
 * the previous READING, which it had already overwritten with the current one.
 * So on a real one-shot switch:
 *
 *   tick 1  prev=corporate observed=public  -> differ, count 1
 *   tick 2  prev=public    observed=public  -> identical, no transition at all
 *
 * the counter could never reach 2 and a genuine flip NEVER dispatched. The only
 * way to reach the threshold was for the same (from, to) pair to recur — which
 * is exactly what the `vpn`/`corporate` ping-pong did. The detector fired only
 * when it was wrong and stayed silent when it was right.
 *
 * Holding `previous` at the last settled class fixes both halves: a run has to
 * be uninterrupted to confirm, and once confirmed the caller advances the
 * settled value so the next flip counts from zero. Same contract as
 * `settleLocation` in location-hysteresis.mjs — carry `settled` forward, not
 * the raw observation.
 *
 * The stale-pin restart this detector guards is ALSO covered by
 * `evaluateProxyStaleness()` (host location vs proxy mode, 3-tick), so the
 * silent half above degraded a belt-and-braces pair to one brace rather than
 * losing the protection outright.
 *
 * Pure, like its neighbours: every input is an argument, no env, no I/O, no
 * clock. health-coordinator.js binds port 3103 on import and cannot be imported
 * by a test, so a rule that is not extracted is a rule that is not tested. The
 * caller owns the counter — a pending flip lives in coordinator state where
 * /health/state can show it, not in a module global no reader can reach.
 */

/**
 * Consecutive readings of the new class required before we dispatch. The
 * proxy's mode can oscillate around a threshold (PAC TCP latency hovering at
 * ~47ms against a 30ms cut), and on 2026-05-20 every oscillation dispatched:
 * ~30 kickstarts in 30 minutes.
 */
export const NETWORK_MODE_FLIP_CONFIRM_TICKS = 2;

/**
 * Collapse both network vocabularies onto two comparable classes.
 *
 * Returns null for anything not confidently classifiable — `unknown`, a probe
 * error, an unrecognised value. Null is never comparable to anything, including
 * another null: "we don't know" is not evidence of a change, and a restart on
 * no evidence is the failure this whole module exists to prevent.
 *
 * @param {unknown} v a host location or a proxy networkMode
 * @returns {'corporate'|'public'|null}
 */
export function classifyNetClass(v) {
  if (v === 'corporate' || v === 'vpn') return 'corporate';
  if (v === 'open' || v === 'home' || v === 'public' || v === 'direct') return 'public';
  return null;
}

/**
 * Settle this tick's observation into a dispatch verdict.
 *
 * @param {object} input
 * @param {unknown} input.observed    the mode read from the proxy this tick
 * @param {unknown} input.previous    the last SETTLED mode (carry `settled` back in)
 * @param {number}  [input.pending=0] consecutive confirmations so far
 * @returns {{ dispatch: boolean, settled: unknown, pending: number,
 *             from: 'corporate'|'public'|null, to: 'corporate'|'public'|null,
 *             reason: string }}
 *   `dispatch` true exactly once per confirmed class change. `settled` is what
 *   to hold as `previous` next tick — it advances ONLY on a confirmed flip, so
 *   a run has to be uninterrupted to count. `reason` names the verdict, for the
 *   log line.
 */
export function settleModeFlip({ observed, previous, pending = 0 }) {
  const count = Number.isFinite(pending) && pending > 0 ? pending : 0;

  const from = classifyNetClass(previous);
  const to = classifyNetClass(observed);

  // An unreadable OBSERVATION is not evidence of anything. Clears any pending
  // run — a confirmation sequence interrupted by an unknown is no longer the
  // uninterrupted run the threshold is asking for — and holds the baseline, so
  // a probe error cannot become the thing the next real reading is compared
  // against.
  if (to === null) {
    return {
      dispatch: false, settled: previous, pending: 0, from, to,
      reason: 'observation not classifiable',
    };
  }

  // No baseline yet: first poll after coordinator start, or the first good read
  // after a run of errors. Adopt this reading and dispatch nothing. Having
  // nothing to compare against is not a transition, and restarting the proxy
  // because we have just started watching it would make every coordinator
  // restart cost a proxy restart.
  if (from === null) {
    return {
      dispatch: false, settled: observed, pending: 0, from, to,
      reason: 'baseline adopted',
    };
  }

  // Same class, however it is spelled. This is the `vpn` -> `corporate` case
  // that used to dispatch forever.
  if (from === to) {
    return {
      dispatch: false, settled: previous, pending: 0, from, to,
      reason: 'same network class',
    };
  }

  const next = count + 1;
  if (next < NETWORK_MODE_FLIP_CONFIRM_TICKS) {
    return {
      dispatch: false, settled: previous, pending: next, from, to,
      reason: `pending (${next}/${NETWORK_MODE_FLIP_CONFIRM_TICKS})`,
    };
  }

  // Confirmed. Advance the baseline and reset the count, so the NEXT flip
  // counts from zero rather than tripping on its first tick.
  return {
    dispatch: true, settled: observed, pending: 0, from, to,
    reason: `${NETWORK_MODE_FLIP_CONFIRM_TICKS} consecutive ticks`,
  };
}
