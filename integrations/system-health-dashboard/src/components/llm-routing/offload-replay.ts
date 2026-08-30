/**
 * Recorded traffic, replayed through the ladder on a different network.
 *
 * ── This was cut from the design, and the reason it was cut is half right ───
 * "History has no counterfactual network" — true of the ROWS. `token_usage` does
 * not carry a network column, so there is nothing to filter on and no honest way
 * to show "the calls you made on corporate". A selector that pretended to do
 * that would be inventing a field.
 *
 * But that is not the only question worth asking. The useful one is "this
 * traffic, had I been on VPN, where would it have gone" — and that IS
 * computable, because `evaluateOffload` reproduces the proxy's decision from
 * (route, band, network) and is held to the proxy's own answers by a contract
 * test. The band comes from the recorded row, and band resolution does not depend
 * on the network, so nothing here is guessed.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is not an observation, and the difference is not cosmetic. Two things make
 * it derived rather than recorded, and both must reach the reader:
 *
 *   1. It replays against TODAY's routes and TODAY's policy. A call made before
 *      a target was switched on is replayed as though it had been.
 *   2. It answers where the call would have been SENT, not what would have come
 *      back. A local endpoint that would have timed out still counts as moved.
 *
 * So the caller badges these numbers and never merges them into the observed
 * series. `offloadSkips` remains the only source for "what actually happened".
 */

import { GATES, RUNG_OFFLOADED, evaluateOffload, pickTarget } from './offload-gates'
import type { OffloadPolicy, RouteEntry } from './offload-gates'

/** One recorded route's totals for the window — `behaviour.perRoute`, summed. */
export interface RecordedRouteTotals {
  route_key: string
  route_band: string
  calls: number
  tokens: number
}

export interface Replay {
  callsByRung: number[]
  tokensByRung: number[]
  /** What would move, and where to. */
  moved: { calls: number; tokens: number; to: string | null }
  /**
   * Traffic whose route no longer exists in the config, so it cannot be
   * replayed. Surfaced rather than dropped: a window that is mostly unmatched
   * makes every number above it a statement about a slice, and silently
   * excluding it would read as "nothing would have changed".
   */
  unmatched: { calls: number; tokens: number; keys: string[] }
}

/** `defaults.background` addresses the defaults table, not the routes table. */
function entryFor(
  key: string,
  routes: Record<string, RouteEntry>,
  defaults: Record<string, RouteEntry>,
): RouteEntry | null {
  if (key.startsWith('defaults.')) return defaults[key.slice('defaults.'.length)] ?? null
  return routes[key] ?? null
}

export function replayRecorded(
  rows: RecordedRouteTotals[],
  routes: Record<string, RouteEntry>,
  defaults: Record<string, RouteEntry>,
  policy: OffloadPolicy | null,
  network: string,
  providerHasFgTransport: (id: string) => boolean,
): Replay {
  const callsByRung = new Array(GATES.length).fill(0)
  const tokensByRung = new Array(GATES.length).fill(0)
  const unmatchedKeys = new Set<string>()
  let unmatchedCalls = 0
  let unmatchedTokens = 0

  for (const r of rows) {
    const entry = entryFor(r.route_key, routes, defaults)
    if (!entry || !r.route_band) {
      // A row with no band cannot be replayed either: the band gate is the second
      // thing the proxy checks, and inventing one would decide the outcome.
      unmatchedKeys.add(r.route_key || '(no route)')
      unmatchedCalls += r.calls
      unmatchedTokens += r.tokens
      continue
    }
    const v = evaluateOffload(policy, entry, r.route_key, r.route_band, network, providerHasFgTransport)
    callsByRung[v.rung] += r.calls
    tokensByRung[v.rung] += r.tokens
  }

  const target = policy?.enabled ? pickTarget(policy, network) : null

  return {
    callsByRung,
    tokensByRung,
    moved: {
      calls: callsByRung[RUNG_OFFLOADED],
      tokens: tokensByRung[RUNG_OFFLOADED],
      to: target?.provider ?? null,
    },
    unmatched: { calls: unmatchedCalls, tokens: unmatchedTokens, keys: [...unmatchedKeys].sort() },
  }
}

/** Aggregate `behaviour.perRoute` down to one row per (route, band). */
export function totalsByRoute(
  perRoute: Array<{ route_key: string; route_band: string; calls: number; tokens: number }>,
): RecordedRouteTotals[] {
  const out = new Map<string, RecordedRouteTotals>()
  for (const r of perRoute) {
    const k = `${r.route_key}|${r.route_band}`
    const cur = out.get(k) ?? { route_key: r.route_key, route_band: r.route_band, calls: 0, tokens: 0 }
    cur.calls += r.calls
    cur.tokens += r.tokens
    out.set(k, cur)
  }
  return [...out.values()]
}
