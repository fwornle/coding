/**
 * Scrub through the recorded calls.
 *
 * ── Native range, on purpose ────────────────────────────────────────────────
 * `<input type="range">` rather than a custom track: it brings ←/→, Home/End,
 * PgUp/PgDn, touch and screen-reader semantics for free, and no Radix slider
 * exists in this project to reuse. A hand-rolled pointer handler would cost all
 * of that and buy nothing but styling. The settings dialog already uses bare
 * `<input type="checkbox" className="accent-primary">`, so a bare range is house
 * style rather than an exception.
 *
 * The range has no shape of its own, so a filmstrip is drawn behind it and the
 * input rides on top, transparent, owning the interaction.
 *
 * ── The axis is index, not time ─────────────────────────────────────────────
 * See `hourBoundaries` in recent-call.ts. Time survives as end labels, a thumb
 * label, and gridlines at each hour change.
 */

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { getOutcomeColor } from '@/lib/providers'
import { localClock } from '@/lib/utils'
import type { OutcomeKind } from '@/lib/providers'
import { binRows, classifyCall, hourBoundaries, selectInteresting } from './recent-call'
import type { CallOutcome, RecentCall } from './recent-call'

const STRIP_H = 34
const TRACK_W = 1000          // viewBox units; the SVG scales to its container
const MIN_TICK_W = 3          // 2px mark + 1px gap, before binning kicks in

/** The strip speaks the three-value outcome palette; `deviated` is its `failed`. */
const PALETTE: Record<CallOutcome, OutcomeKind> = {
  deviated: 'failed',
  offloaded: 'offloaded',
  routed: 'routed',
}

export type StripFilter = 'interesting' | 'all'

interface Props {
  /** The raw tail, newest first, as `/api/token-usage/recent` returns it. */
  rows: RecentCall[]
  filter: StripFilter
  onFilterChange: (f: StripFilter) => void
  routeFilter: string
  onRouteFilterChange: (r: string) => void
  selectedIndex: number | null
  onSelect: (i: number | null) => void
  isDark: boolean
  /** The window the numbers above the strip are computed over. */
  windowHours: number
}

const hhmm = (ts: string) => localClock(ts, { seconds: false })

export function CallStrip({
  rows, filter, onFilterChange, routeFilter, onRouteFilterChange,
  selectedIndex, onSelect, isDark, windowHours,
}: Props) {
  // Oldest first, so the strip reads left-to-right like every other time axis on
  // the page. The endpoint hands them back newest first.
  const chronological = useMemo(() => [...rows].reverse(), [rows])

  const routeKeys = useMemo(
    () => [...new Set(chronological.map(r => r.route_key).filter(Boolean))].sort(),
    [chronological],
  )

  const shown = useMemo(() => {
    let out = chronological
    if (routeFilter !== 'all') out = out.filter(r => r.route_key === routeFilter)
    if (filter === 'interesting') out = selectInteresting(out)
    return out
  }, [chronological, filter, routeFilter])

  const interestingCount = useMemo(
    () => selectInteresting(chronological).length,
    [chronological],
  )

  const columns = Math.floor(TRACK_W / MIN_TICK_W)
  const bins = useMemo(() => binRows(shown, columns), [shown, columns])
  const binned = bins.length < shown.length
  const boundaries = useMemo(() => hourBoundaries(shown), [shown])

  const selected = selectedIndex != null ? shown[selectedIndex] ?? null : null

  // Which COLUMN the selected row lives in. When every row has its own tick this
  // is the row index; once rows are binned it is the bin that contains it.
  // Without the second case the thumb has no visible position exactly when the
  // strip is densest — the mode where you most need to see where you are.
  const selectedBin = selectedIndex == null || shown.length === 0
    ? null
    : Math.min(Math.floor((selectedIndex * bins.length) / shown.length), bins.length - 1)

  // Honesty about the denominator. The tail is capped at 500 rows server-side,
  // so a busy window is a SLICE of the hours every stat above is computed over,
  // and without saying so the strip silently disagrees with all of them.
  const oldest = chronological[0]
  const newest = chronological[chronological.length - 1]
  const spanHours = oldest && newest
    ? (Date.parse(newest.timestamp) - Date.parse(oldest.timestamp)) / 3_600_000
    : 0
  const isSlice = chronological.length >= 500 && spanHours < windowHours - 0.5

  if (chronological.length === 0) {
    return <div className="text-xs text-muted-foreground py-3">No calls with a recorded decision yet.</div>
  }

  const binW = TRACK_W / Math.max(bins.length, 1)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <button
          onClick={() => { onFilterChange('interesting'); onSelect(null) }}
          className={`px-1.5 py-0.5 rounded border ${filter === 'interesting'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border text-muted-foreground hover:bg-muted'}`}
        >
          Interesting only ({interestingCount})
        </button>
        <button
          onClick={() => { onFilterChange('all'); onSelect(null) }}
          className={`px-1.5 py-0.5 rounded border ${filter === 'all'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border text-muted-foreground hover:bg-muted'}`}
        >
          Everything ({chronological.length})
        </button>

        <select
          className="bg-background border rounded px-1 py-0.5 font-mono text-[11px]"
          value={routeFilter}
          onChange={e => { onRouteFilterChange(e.target.value); onSelect(null) }}
        >
          <option value="all">all routes</option>
          {routeKeys.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        <span className="ml-auto text-muted-foreground font-mono">
          {shown.length} shown
          {filter === 'interesting' && shown.length < chronological.length
            && ` · ${chronological.length - shown.length} ordinary calls folded`}
        </span>
      </div>

      {isSlice && (
        <div className="text-[11px] text-muted-foreground border-l-2 border-muted pl-2">
          the last {chronological.length} calls ({hhmm(oldest.timestamp)} → {hhmm(newest.timestamp)}) —
          not the full {windowHours}h window the numbers above use
        </div>
      )}

      <div className="relative">
        <svg viewBox={`0 0 ${TRACK_W} ${STRIP_H}`} width="100%" height={STRIP_H}
          preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden="true">
          <rect x={0} y={0} width={TRACK_W} height={STRIP_H} className="fill-muted/30" rx={3} />

          {/* Hour changes — time as annotation, since the axis is index. */}
          {!binned && boundaries.map(i => (
            <line key={i} x1={i * binW} y1={2} x2={i * binW} y2={STRIP_H - 2}
              className="stroke-border" strokeWidth={1} />
          ))}

          {bins.map((b, i) => {
            const isSel = selectedBin === i
            return (
              <g key={i}>
                <rect
                  x={i * binW} y={6}
                  width={Math.max(binW - (binned ? 0 : 1), 0.6)} height={STRIP_H - 12}
                  fill={getOutcomeColor(PALETTE[b.outcome], isDark)}
                  opacity={isSel ? 1 : 0.75}
                />
                {/* A reconstructed row is hatched: its rung was resolved against
                    TODAY's config, so it describes today, not when it was made. */}
                {b.reconstructed && (
                  <rect x={i * binW} y={6} width={Math.max(binW - 1, 0.6)} height={STRIP_H - 12}
                    fill="url(#recon-hatch)" />
                )}
                {/* Anomalies must never average away: a bin holding anything that
                    did not go as routed is flagged above the strip, however many
                    ordinary calls it also holds. */}
                {b.outcome !== 'routed' && (
                  <text x={i * binW + binW / 2} y={5} textAnchor="middle" fontSize={5}
                    fill={getOutcomeColor(PALETTE[b.outcome], isDark)}>▲</text>
                )}
                {isSel && (
                  <rect x={i * binW - 0.5} y={3} width={Math.max(binW, 1.5)} height={STRIP_H - 6}
                    fill="none" className="stroke-foreground" strokeWidth={binned ? 2 : 1} />
                )}
              </g>
            )
          })}

          <defs>
            <pattern id="recon-hatch" width={4} height={4} patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={4} className="stroke-background" strokeWidth={1.5} />
            </pattern>
          </defs>
        </svg>

        <input
          type="range"
          className="absolute inset-0 w-full accent-primary opacity-0 cursor-pointer"
          style={{ height: STRIP_H }}
          min={0}
          max={Math.max(shown.length - 1, 0)}
          step={1}
          value={selectedIndex ?? 0}
          onChange={e => onSelect(Number(e.target.value))}
          aria-label={`Recorded call ${(selectedIndex ?? 0) + 1} of ${shown.length}`}
        />
      </div>

      <div className="flex items-baseline text-[10px] font-mono text-muted-foreground">
        <span>{hhmm(shown[0]?.timestamp ?? '')}</span>
        <span className="mx-auto">
          {selected
            ? (
              <span className="text-foreground">
                {hhmm(selected.timestamp)} · {selected.route_key || '—'}
                <Badge variant="outline" className="ml-1.5 text-[9px] py-0">
                  {classifyCall(selected)}
                </Badge>
              </span>
            )
            : binned
              ? `${shown.length} calls in ${bins.length} columns — each column is the worst outcome it holds`
              : 'drag, or use ← → , to inspect one call'}
        </span>
        <span>{hhmm(shown[shown.length - 1]?.timestamp ?? '')}</span>
      </div>
    </div>
  )
}

/** The rows the strip is currently showing, in the order it shows them. */
export function stripRows(rows: RecentCall[], filter: StripFilter, routeFilter: string): RecentCall[] {
  let out = [...rows].reverse()
  if (routeFilter !== 'all') out = out.filter(r => r.route_key === routeFilter)
  if (filter === 'interesting') out = selectInteresting(out)
  return out
}
