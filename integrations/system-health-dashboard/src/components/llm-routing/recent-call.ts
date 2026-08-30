/**
 * One recorded call, and what is worth saying about it.
 *
 * Pure: no React, no fetch. The scrubber's whole difficulty is choosing WHICH
 * calls to show, and that decision is worth testing directly rather than through
 * a slider.
 */

import { RUNG_OFFLOADED, rungOfReason } from './offload-gates'

export interface RecentCall {
  timestamp: string
  process: string
  agent: string
  provider: string
  model: string
  total_tokens: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  route_key: string
  route_band: string
  route_step: number
  offloaded_from: string
  chain_position: number
  attempt_trail: string
  routing_source: string
}

export interface AttemptTrail {
  /** Providers that were TRIED and did not answer. Empty/absent is the norm. */
  attempts?: Array<{ provider: string; model?: string; error?: string; ms?: number }>
  /** Candidates never tried. A property of the config, not of this call. */
  skipped?: Array<{ provider: string; reason: string; kind: string }>
  /** The proxy's verbatim reason the offload declined. Also config-shaped. */
  offloadSkipped?: string | null
}

/** Tolerant parse — one malformed trail must not blank the strip. */
export function parseTrail(raw: string | null | undefined): AttemptTrail | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as AttemptTrail) : null
  } catch {
    return null
  }
}

/**
 * What happened to this call, most severe first.
 *
 * `deviated` fuses "took a fallback" with "something was tried and failed",
 * because both mean the same thing to a reader scanning the strip: the account
 * the route named did not serve it. Which of the two it was is spelled out in
 * the detail panel, where there is room to be precise. Fusing them here keeps
 * the strip on the three-value outcome palette, which is the number of hues that
 * can actually be told apart.
 */
export type CallOutcome = 'deviated' | 'offloaded' | 'routed'

export function classifyCall(row: RecentCall): CallOutcome {
  if (row.chain_position > 0) return 'deviated'
  if (parseTrail(row.attempt_trail)?.attempts?.length) return 'deviated'
  if (row.offloaded_from) return 'offloaded'
  return 'routed'
}

/** Severity order for collapsing a bin down to one colour. */
const SEVERITY: Record<CallOutcome, number> = { deviated: 3, offloaded: 2, routed: 1 }

export function worstOutcome(rows: RecentCall[]): CallOutcome {
  let worst: CallOutcome = 'routed'
  for (const r of rows) {
    const o = classifyCall(r)
    if (SEVERITY[o] > SEVERITY[worst]) worst = o
  }
  return worst
}

/**
 * Which ladder rung a RECORDED call stopped at, or null when the row does not say.
 *
 * Never guesses. A backfilled row, or one written before the decision was
 * recorded, carries no verdict, and inferring one from today's config would
 * describe today rather than the moment the call was made.
 */
export function rungOfCall(row: RecentCall): number | null {
  if (row.offloaded_from) return RUNG_OFFLOADED
  const reason = parseTrail(row.attempt_trail)?.offloadSkipped
  if (!reason) return null
  const rung = rungOfReason(reason)
  return rung === 'unclassified' ? null : rung
}

/**
 * The default view: every call that did something, plus one ordinary exemplar
 * per route so normal behaviour is still represented.
 *
 * ── Why the obvious predicate does not work ─────────────────────────────────
 * "Has an attempt_trail" looks like the right test for `did something` and is
 * not. Measured against a live 500-row window on 2026-08-30, it keeps 388 rows —
 * and ALL 388 owe it to a trail that is identical across the window: one
 * `skipped: groq not reachable` entry and one of only three `offloadSkipped`
 * strings. Zero rows had a real `attempts[]`.
 *
 * `skipped` and `offloadSkipped` describe the CONFIG, not the call. They are the
 * same on every row the config produced, the ladder above already counts them,
 * and letting them mark a row interesting means the filter keeps 78% of the tail
 * and the scrubber still scrubs through whichever process dominates it — the
 * exact problem the filter exists to solve.
 *
 * So only `attempts[]` — a provider that was tried and did not answer — counts as
 * something happening TO this call.
 *
 * ── The exemplars ───────────────────────────────────────────────────────────
 * Deviations alone can be zero, and an empty strip reads as "no data" when it
 * means "nothing went wrong". One newest call per route key is kept so the strip
 * always shows the shape of the window, and so an ordinary call remains
 * inspectable without switching to the raw tail.
 */
export function selectInteresting(rows: RecentCall[]): RecentCall[] {
  const kept = new Set<RecentCall>()
  const exemplarFor = new Set<string>()

  // Scanned from the END so the exemplar is each route's NEWEST ordinary call,
  // not its oldest. Taking the first seen in a chronological array pins every
  // exemplar to the start of the window: measured live, the strip's own end
  // labels read 18:13 → 18:38 inside a 24-hour window, which says the traffic
  // stopped twelve hours ago. It had not — those were simply the first calls
  // each route happened to make.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (classifyCall(r) !== 'routed') {
      kept.add(r)
    } else if (!exemplarFor.has(r.route_key)) {
      exemplarFor.add(r.route_key)
      kept.add(r)
    }
  }
  // Preserve the caller's ordering rather than the scan order, so the strip's
  // index axis matches the table below it.
  return rows.filter(r => kept.has(r))
}

export interface StripBin {
  rows: RecentCall[]
  outcome: CallOutcome
  /** True when any row in the bin is a reconstruction rather than an observation. */
  reconstructed: boolean
}

/**
 * Group rows into at most `columns` bins, preserving order.
 *
 * A bin takes the colour of its WORST member, never an average: the one
 * fallback in a thousand ordinary calls is the entire reason to look at this
 * strip, and averaging is how it disappears.
 */
export function binRows(rows: RecentCall[], columns: number): StripBin[] {
  if (rows.length === 0) return []
  const n = Math.max(1, Math.min(columns, rows.length))
  const bins: StripBin[] = []
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * rows.length) / n)
    const to = Math.floor(((i + 1) * rows.length) / n)
    const slice = rows.slice(from, Math.max(to, from + 1))
    bins.push({
      rows: slice,
      outcome: worstOutcome(slice),
      reconstructed: slice.some(r => r.routing_source === 'backfill'),
    })
  }
  return bins
}

/**
 * Index positions where the wall-clock hour changes, so burstiness stays visible
 * on an axis that is deliberately NOT time.
 *
 * The axis is index-uniform because calls are bursty: on a time axis a window
 * with a 400-call burst puts those 400 in one pixel and spreads three across
 * half the track, making most of the data unreachable by the thumb. Uniform
 * spacing makes every call selectable; these gridlines put the time back as
 * annotation rather than as geometry.
 */
export function hourBoundaries(rows: RecentCall[]): number[] {
  const out: number[] = []
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].timestamp.slice(0, 13) !== rows[i - 1].timestamp.slice(0, 13)) out.push(i)
  }
  return out
}
