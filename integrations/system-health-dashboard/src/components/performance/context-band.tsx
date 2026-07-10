import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ContextTurnRow } from '@/store/slices/performanceSlice'
import { scaledBand, SEGMENTS, CACHE_WRITE_NA, type Segment } from './context-cache-explainer'

// ---------------------------------------------------------------------------
// ContextBand (Phase 86 — Timeline v2, D-04/D-05)
// ---------------------------------------------------------------------------
// The ONE shared context-window band, rendered from the SAME `scaledBand`/
// `SEGMENTS` taxonomy the explainer uses (D-05 — one taxonomy across both
// surfaces, never a fork). Two variants:
//
//   • mini       — one turn's category byte-share WITHIN that turn (relative
//                  composition, not absolute window size). h-2 glanceable row.
//   • cumulative — the whole run: per-turn category bytes stacked cumulatively
//                  (history accreting); width = cumulative / final-turn bytes.
//                  h-3/h-4 in modal / fullscreen (taller = hoverable labels).
//
// Cached overlay (D-05): the `usage.cache_read` share of each cache-eligible
// segment is drawn as a 45° hatched `repeating-linear-gradient` (~4px pitch)
// over a ~0.55-opacity fill; solid = fresh, hatched = cache-read. Hatching is
// chosen over pure opacity so the split survives colorblind + greyscale
// (UI-SPEC Q3).
//
// Honesty gate (LOCKED, D-05/D-12): when `usage.cache_write === null` (the
// OpenAI-wire discriminator), we NEVER infer a 0 / amber write segment — the
// band renders the verbatim `CACHE_WRITE_NA` note instead. Copilot / opencode
// runs report no cache-creation counter on the wire, so a 0 would fabricate a
// number. Honest measurement over inference.
//
// Rendering is a flex row of width-`%` `<div>`s — NOT a charting library / vector
// graphic (chart `fill` can't resolve CSS `var()`; see context-cache-explainer.tsx:52).

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

// A 45° hatch that reads as "cache-read" on top of the segment's own fill. The
// stroke colour is the segment's, so each category keeps its identity under the
// hatch (opacity ~0.55 fill + hatched lines at ~4px pitch — UI-SPEC Q3/D-05).
function hatchStyle(stroke: string): React.CSSProperties {
  return {
    backgroundImage: `repeating-linear-gradient(45deg, ${stroke}66 0px, ${stroke}66 1px, transparent 1px, transparent 4px)`,
  }
}

// The cache-read fraction of the WHOLE band, clamped to [0,1]. Bands render the
// hatched overlay only across cache-eligible segments (the cacheable prefix),
// proportional to how much of the transmitted context the provider re-read.
function cacheReadFraction(row: ContextTurnRow): number {
  const read = num(row.usage?.cache_read)
  const input = num(row.usage?.input)
  // cache_write is null on the OpenAI wire → treat as 0 for the denominator, but
  // NEVER surface an inferred write segment (honesty gate handled separately).
  const write = row.usage?.cache_write == null ? 0 : num(row.usage.cache_write)
  const totalPrompt = read + input + write
  if (totalPrompt <= 0) return 0
  return Math.min(1, read / totalPrompt)
}

interface BandView {
  view: Segment[]
  prefixPct: number
}

// Build the scaled per-category segments for a single turn from its real
// `categories[].bytes`. Returns null when the turn carries no measured bytes
// (band renders an empty-state note instead of a fabricated fill).
function bandForTurn(row: ContextTurnRow): BandView | null {
  const cats = Array.isArray(row.categories) ? row.categories : []
  const byKey: Record<string, number> = {}
  let total = 0
  for (const c of cats) {
    const b = num(c.bytes)
    byKey[c.key] = (byKey[c.key] ?? 0) + b
    total += b
  }
  return scaledBand(byKey, total)
}

// Build the cumulative band: sum per-category bytes across ALL turns (history
// accreting), then scale that accumulated make-up. Width still normalises to
// 100 via scaledBand, but the byte map is the run-wide total, so the segment
// shares reflect the whole run's assembled context, not a single turn.
function bandForRun(rows: ContextTurnRow[]): BandView | null {
  const byKey: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    const cats = Array.isArray(row.categories) ? row.categories : []
    for (const c of cats) {
      const b = num(c.bytes)
      byKey[c.key] = (byKey[c.key] ?? 0) + b
      total += b
    }
  }
  return scaledBand(byKey, total)
}

// Whether the cache-write figure is honestly unavailable for this data (the
// OpenAI-wire discriminator). Mini: the single turn's wire. Cumulative: true
// only when EVERY turn is OpenAI-wire (a run with any Anthropic-wire turn keeps
// a real number, so we don't stamp N/A). Branch on `cache_write === null`,
// never `?? 0` (S2 honest-null).
function cacheWriteIsNA(rows: ContextTurnRow[]): boolean {
  if (rows.length === 0) return false
  return rows.every((r) => r.usage?.cache_write === null)
}

export interface ContextBandProps {
  variant: 'mini' | 'cumulative'
  // Mini feeds ONE turn; cumulative feeds the whole run's turns.
  turn?: ContextTurnRow
  turns?: ContextTurnRow[]
  className?: string
}

/**
 * The shared context-window band (D-04/D-05). Imports `scaledBand`/`SEGMENTS`/
 * `CACHE_WRITE_NA` from `context-cache-explainer.tsx` — never forks the palette,
 * byte-math, or honesty string.
 */
export function ContextBand({ variant, turn, turns, className }: ContextBandProps) {
  const rows: ContextTurnRow[] = useMemo(() => {
    if (variant === 'mini') return turn ? [turn] : []
    return Array.isArray(turns) ? turns : []
  }, [variant, turn, turns])

  const band = useMemo(
    () => (variant === 'mini' ? (turn ? bandForTurn(turn) : null) : bandForRun(rows)),
    [variant, turn, rows],
  )

  // Cache-read overlay width across the whole band (mini = this turn; cumulative
  // = the run-wide read fraction). Averaged across turns for the cumulative case
  // so a single warm turn doesn't imply the whole run was cache-read.
  const readFrac = useMemo(() => {
    if (rows.length === 0) return 0
    const sum = rows.reduce((a, r) => a + cacheReadFraction(r), 0)
    return Math.min(1, sum / rows.length)
  }, [rows])

  const writeNA = useMemo(() => cacheWriteIsNA(rows), [rows])

  // Height: mini = h-2 (glanceable row swatch); cumulative = h-3/h-4 in modal.
  const heightClass = variant === 'mini' ? 'h-2' : 'h-4'

  if (!band || band.view.length === 0) {
    return (
      <div
        className={cn('flex items-center text-[10px] text-muted-foreground', className)}
        data-testid={`context-band-${variant}-empty`}
      >
        no measured context
      </div>
    )
  }

  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      data-testid={`context-band-${variant}`}
    >
      {/* The band: a flex row of width-% divs, one per present category. The
          cache-read share is a hatched overlay laid over the cacheable-prefix
          (left) portion of the band. */}
      <div className={cn('relative flex w-full overflow-hidden rounded border', heightClass)}>
        {band.view.map((seg, i) => (
          <div
            key={seg.key}
            className="h-full"
            title={seg.label}
            style={{
              width: `${seg.w}%`,
              background: seg.fill,
              borderLeft: i > 0 ? '1px solid rgba(0,0,0,0.22)' : undefined,
            }}
          />
        ))}
        {/* Cache-read hatched overlay (D-05) — spans the leftmost `readFrac` of
            the band (the re-read prefix). Solid underneath = fresh; hatched
            here = cache-read. pointer-events-none so segment titles still work. */}
        {readFrac > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0"
            data-testid={`context-band-${variant}-cacheread`}
            style={{ width: `${readFrac * 100}%`, opacity: 0.55, ...hatchStyle('#166534') }}
            title="cache-read (re-used prefix)"
          />
        )}
      </div>

      {/* Honesty gate (D-05/D-12): OpenAI-wire runs report no cache-creation
          counter, so render the verbatim N/A string, NEVER an inferred 0 or an
          amber write segment. */}
      {writeNA && (
        <span
          className="text-[10px] text-muted-foreground"
          data-testid={`context-band-${variant}-writena`}
          title="This provider's wire protocol doesn't report cache creation; we show N/A rather than a fabricated 0."
        >
          cache-write: {CACHE_WRITE_NA}
        </span>
      )}
    </div>
  )
}

// Legend helper (solid = fresh, hatched = cache-read) — exported so both the
// modal and fullscreen surfaces render the SAME key beside the band.
export function ContextBandLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground', className)}>
      {SEGMENTS.map((seg) => (
        <span key={seg.key} className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm border" style={{ background: seg.fill, borderColor: seg.stroke }} />
          {seg.label}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-3 rounded-sm border" style={{ ...hatchStyle('#166534'), opacity: 0.55 }} />
        cache-read (hatched)
      </span>
    </div>
  )
}
