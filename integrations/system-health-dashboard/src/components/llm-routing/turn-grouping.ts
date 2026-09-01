/**
 * Recorded calls, grouped into the turns that produced them.
 *
 * ── Why this is a module and not a `reduce` in the tab ──────────────────────
 * The grouping has one rule that is easy to get subtly wrong and impossible to
 * see once it is wrong: rows with NO recorded turn must never be grouped. They
 * are the overwhelming majority of history (337,936 rows at the time the proxy
 * columns landed) plus every background call — the proxy stamps turn identity
 * for fg-chat routes only, because a one-shot service has no conversation and
 * keying it merges separate jobs into a turn that never happened. All of them
 * carry conversation_key '' and turn_index 0, and keying on those values
 * directly would collapse them into one enormous fake turn that looks
 * authoritative. So they go to an explicitly-labelled bucket instead, and the
 * caller renders that bucket as "no turn recorded" rather than as a turn.
 *
 * Pure, no React, no fetch — same reason `selectInteresting` in recent-call.ts
 * is: the decision about WHICH rows belong together is worth testing directly
 * rather than through a table.
 */

import { classifyCall, parseTrail } from './recent-call'
import type { CallOutcome, RecentCall } from './recent-call'

export interface Turn {
  /** `${conversation_key}:${turn_index}`, or '' for the unrecorded bucket. */
  id: string
  /** False for the unrecorded bucket — the caller must not label it a turn. */
  recorded: boolean
  conversationKey: string
  turnIndex: number
  /** Calls in the order they were made, oldest first. */
  calls: RecentCall[]
  /** ISO timestamp of the first call — what the turn is sorted and shown by. */
  startedAt: string
  /** The route every call in the turn shares, or '' when they differ. */
  routeKey: string
  /** What the turn asked, from prompt_preview; '' when the row predates it. */
  prompt: string
  totalTokens: number
  /** Worst outcome across the turn — a turn is as interesting as its worst call. */
  outcome: CallOutcome
  /** Distinct providers with a count, in first-seen order: `qwen-local ×1`. */
  servedBy: Array<{ provider: string; calls: number }>
  /** True when any call in the turn was moved by the semantic offload. */
  offloaded: boolean
}

/** A row carries turn identity only when BOTH fields were recorded. */
export function hasTurnIdentity(row: RecentCall): boolean {
  return !!row.conversation_key && (row.turn_index ?? 0) > 0
}

/**
 * Group rows into turns, newest turn first.
 *
 * Rows are expected newest-first (as `/api/token-usage/recent` returns them);
 * calls WITHIN a turn are re-sorted oldest-first, because the whole point of the
 * view is reading a turn forwards — call 1 chose the tools, call 2 answered.
 *
 * Every unrecorded row lands in a single trailing bucket with `recorded: false`.
 * It is deliberately last and deliberately not sorted among the real turns: it
 * spans the entire window and has no meaningful start time of its own.
 */
export function groupIntoTurns(rows: RecentCall[]): Turn[] {
  const byId = new Map<string, RecentCall[]>()
  const unrecorded: RecentCall[] = []

  for (const r of rows || []) {
    if (!hasTurnIdentity(r)) {
      unrecorded.push(r)
      continue
    }
    const id = `${r.conversation_key}:${r.turn_index}`
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id)!.push(r)
  }

  const turns = [...byId.entries()]
    .map(([id, calls]) => buildTurn(id, calls, true))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  if (unrecorded.length) turns.push(buildTurn('', unrecorded, false))
  return turns
}

function buildTurn(id: string, calls: RecentCall[], recorded: boolean): Turn {
  const ordered = [...calls].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const first = ordered[0]

  // One route per turn is the norm; '' when a turn somehow spans two, so the
  // header states a fact rather than picking a winner.
  const routes = new Set(ordered.map(c => c.route_key).filter(Boolean))
  const prompts = ordered.map(c => c.prompt_preview)

  const counts = new Map<string, number>()
  for (const c of ordered) counts.set(c.provider, (counts.get(c.provider) ?? 0) + 1)

  return {
    id,
    recorded,
    conversationKey: first?.conversation_key ?? '',
    turnIndex: first?.turn_index ?? 0,
    calls: ordered,
    startedAt: first?.timestamp ?? '',
    routeKey: routes.size === 1 ? [...routes][0] : '',
    prompt: prompts.find(p => !!p) ?? '',
    totalTokens: ordered.reduce(
      (s, c) => s + c.total_tokens + (c.cache_read_tokens || 0) + (c.cache_write_tokens || 0),
      0
    ),
    outcome: worstOf(ordered),
    servedBy: [...counts.entries()].map(([provider, n]) => ({ provider, calls: n })),
    offloaded: ordered.some(c => !!c.offloaded_from),
  }
}

/** Severity order, mirroring recent-call.ts — a turn is as bad as its worst call. */
const SEVERITY: Record<CallOutcome, number> = { deviated: 3, offloaded: 2, routed: 1 }

function worstOf(calls: RecentCall[]): CallOutcome {
  let worst: CallOutcome = 'routed'
  for (const c of calls) {
    const o = classifyCall(c)
    if (SEVERITY[o] > SEVERITY[worst]) worst = o
  }
  return worst
}

/**
 * How this call's band was arrived at, in one short phrase.
 *
 * Two independent records feed it and neither is sufficient alone:
 *   • `band_source` is on every row written since the columns landed, and is the
 *     only thing that distinguishes 'caller' from a `defaults.<cls>` fallback —
 *     the difference between "pi asked for medium" and "pi said nothing usable".
 *   • the trail's `classifier` note is the only thing that says what the
 *     classifier DID, including when it declined and why.
 *
 * Returns '' when the row predates both, so the caller can omit the line rather
 * than print a confident-looking "unknown".
 */
export function describeBandSource(row: RecentCall): string {
  const src = (row.band_source || '').trim()
  const note = (parseTrail(row.attempt_trail)?.classifier || '').trim()

  // The classifier moved the band: its own note is the more informative half
  // ('classified medium -> small' says both who and what).
  if (src === 'classifier') return note || 'classifier'

  // It did not move it. Say who did, and — when the classifier looked and
  // declined — why it did not, because "the caller asked for medium" and "the
  // classifier was not allowed to look at this one" are different fixes.
  const who = src.startsWith('defaults.')
    // The proxy spells this 'defaults.fg-chat (route asked for from-caller,
    // caller supplied nothing)'. Keep the head; the parenthetical is detail for
    // the panel, not for a table cell.
    ? src.split(' (')[0]
    : src
  if (who && note) return `${who} · ${note}`
  return who || note || ''
}
