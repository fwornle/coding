/**
 * When may an outstanding auto-heal kickstart be declared recovered, for free?
 *
 * The [🧠] badge reads `semantic_strong_ok`, which is refreshed by a SYNTHETIC
 * probe on a deliberately slow 5-minute cadence: under per-model 429s that
 * probe falls through to the CLI path and bills ~14-22K cache_creation tokens,
 * so firing it more often is a real cost, not a free win.
 *
 * The consequence is a badge that lags reality after an auto-heal. Observed
 * 2026-09-05: connecting to the VPN left the bridge frozen on its `public`
 * egress decision, the coordinator kickstarted it at 13:36:29, and the badge
 * stayed amber until 13:41:38 — 309s, almost exactly one probe interval,
 * against a proxy that was healthy within seconds.
 *
 * There is already a FREE proof available: the proxy's own token-usage DB
 * records when an observation-writer LLM call last succeeded. This module
 * decides whether that proof licenses clearing the badge early.
 *
 * The load-bearing rule is `callAt > dispatchedAt`. A successful call from
 * BEFORE the kickstart still sits inside the 5-minute real-traffic window, so
 * a decision made on AGE ALONE would clear the badge on the strength of
 * traffic from the broken era — declaring a restart successful using evidence
 * that predates it.
 */

/** Reasons the fast path declines, kept distinct so callers can log them. */
export const DECLINE = {
  NOT_AWAITING: 'no kickstart outstanding',
  ALREADY_OK: 'strong probe is not failing',
  PROBE_DUE: 'scheduled probe is due anyway',
  NO_TRAFFIC: 'no observation-writer call recorded',
  PRE_RESTART: 'last success predates the kickstart',
  STALE: 'last success is outside the real-traffic window',
};

/**
 * @param {object} o
 * @param {boolean} o.awaiting              a kickstart is outstanding
 * @param {boolean|null} o.strongOk         current semantic_strong_ok
 * @param {number} o.strongAgeMs            age of the last strong-probe result
 * @param {number} o.intervalMs             PROXY_STRONG_PROBE_INTERVAL_MS
 * @param {number|null} o.lastCallAgeMs     age of the last successful writer call
 * @param {number} o.dispatchedAt           epoch ms of the kickstart dispatch
 * @param {number} o.now                    epoch ms
 * @param {number} o.realTrafficMaxAgeMs    PROXY_STRONG_PROBE_REAL_TRAFFIC_MAX_AGE_MS
 * @returns {{recovered: boolean, reason: string}}
 */
export function decidePostKickstartRecovery({
  awaiting, strongOk, strongAgeMs, intervalMs,
  lastCallAgeMs, dispatchedAt, now, realTrafficMaxAgeMs,
}) {
  if (!awaiting) return { recovered: false, reason: DECLINE.NOT_AWAITING };
  // Only ever RESCUES a failing badge. Never downgrades, never pre-empts.
  if (strongOk !== false) return { recovered: false, reason: DECLINE.ALREADY_OK };
  // Past the interval the scheduled probe runs on its own; adding a second
  // path there would race it for no benefit.
  if (strongAgeMs >= intervalMs) return { recovered: false, reason: DECLINE.PROBE_DUE };
  if (lastCallAgeMs === null || lastCallAgeMs === undefined) {
    return { recovered: false, reason: DECLINE.NO_TRAFFIC };
  }
  if (lastCallAgeMs >= realTrafficMaxAgeMs) return { recovered: false, reason: DECLINE.STALE };
  // The rule this module exists for.
  if ((now - lastCallAgeMs) <= dispatchedAt) {
    return { recovered: false, reason: DECLINE.PRE_RESTART };
  }
  return { recovered: true, reason: 'post-kickstart-real-traffic' };
}
