import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Re-run a fetch on an interval, and say when the next one is due.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The Token Usage page polls every 30s (token-usage.tsx REFRESH_INTERVAL) but
 * that loop only feeds the Overview and Recent Calls tabs. Routing, Flow and
 * Cost each fetch once in a mount effect and never again, so a tab left open
 * shows the moment it was opened — indefinitely, with nothing on screen saying
 * so. On Routing that is actively misleading: the whole tab is a live record of
 * what the router just did.
 *
 * The behaviour mirrors HealthRefreshManager
 * (store/middleware/healthRefreshMiddleware.ts), which already solved this for
 * the health dashboard, including the part everyone forgets:
 *
 * ── The tab-hidden pause is not an optimisation ─────────────────────────────
 * Browsers keep backgrounded tabs alive. HealthRefreshManager's own comment
 * measures the cost — a 500ms idle poll burns ~9% sustained CPU per
 * backgrounded tab — and the dashboard is a tab people leave open for days. So
 * polling stops on `visibilitychange` and resumes with an IMMEDIATE refresh, so
 * coming back to the tab never shows a stale frame while waiting out the rest
 * of an interval.
 *
 * ── `enabled` is a real safety seam, not a convenience ──────────────────────
 * The Routing tab lets an operator edit the offload policy in place, and an
 * unsaved draft is destroyed by a refetch that adopts server state on top of
 * it. The caller passes `enabled: !draftDirty` so traffic keeps refreshing
 * while config does not. Flipping it off never fires a poll mid-edit; flipping
 * it back on refreshes at once, because the draft is now resolved and the
 * screen should stop lying.
 */

export interface PolledFetch {
  /** Whole seconds until the next scheduled refresh; null while paused. */
  countdown: number | null
  /** Refresh now and restart the interval. Safe to call from a click. */
  refreshNow: () => void
  /** True when polling is suspended — tab hidden, or `enabled` is false. */
  paused: boolean
}

export interface PolledFetchOptions {
  intervalMs?: number
  /**
   * Poll only while true. False suspends the loop WITHOUT unmounting it, and
   * without firing a trailing poll — see the note above about unsaved drafts.
   */
  enabled?: boolean
}

/**
 * @param fetcher Called with `true` for an automatic refresh and `false` for an
 *   explicit one, so a caller can show a spinner on the manual path only —
 *   the same `isAuto` convention token-usage.tsx's fetchData already uses.
 *   Must be stable (useCallback) or the interval restarts on every render.
 */
export function usePolledFetch(
  fetcher: (isAuto: boolean) => void | Promise<void>,
  { intervalMs = 30_000, enabled = true }: PolledFetchOptions = {}
): PolledFetch {
  const [countdown, setCountdown] = useState<number | null>(null)
  const [visible, setVisible] = useState(
    () => (typeof document === 'undefined' ? true : !document.hidden)
  )

  // The fetcher is read through a ref inside the tick so that a caller who
  // cannot memoise theirs does not restart the interval — and, more importantly,
  // does not reset the countdown to full on every parent render, which reads as
  // a timer that never reaches zero.
  const fetcherRef = useRef(fetcher)
  useEffect(() => { fetcherRef.current = fetcher }, [fetcher])

  const paused = !enabled || !visible

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // `nonce` restarts the loop for an explicit refresh: the caller asked for
  // fresh data now, so the next automatic one is a full interval away rather
  // than however much happened to be left on the clock.
  const [nonce, setNonce] = useState(0)
  const refreshNow = useCallback(() => {
    void fetcherRef.current(false)
    setNonce(n => n + 1)
  }, [])

  useEffect(() => {
    if (paused) {
      setCountdown(null)
      return
    }
    const ticks = Math.max(1, Math.round(intervalMs / 1000))
    setCountdown(ticks)
    let left = ticks
    const id = setInterval(() => {
      left -= 1
      if (left <= 0) {
        void fetcherRef.current(true)
        left = ticks
      }
      setCountdown(left)
    }, 1000)
    return () => clearInterval(id)
  }, [paused, intervalMs, nonce])

  // Coming back to a hidden tab refreshes immediately rather than showing a
  // stale frame for the remainder of an interval. Deliberately not merged into
  // the interval effect: that one re-runs on `nonce` too, and refetching on an
  // explicit refresh would double every manual click.
  const wasPaused = useRef(paused)
  useEffect(() => {
    if (wasPaused.current && !paused) void fetcherRef.current(true)
    wasPaused.current = paused
  }, [paused])

  return { countdown, refreshNow, paused }
}
