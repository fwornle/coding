import { useEffect, useRef, useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

export interface InflightInfo {
  pid: number
  alive: boolean
  ageMs: number
  // stderrAgeMs is the time since the worker last wrote a log line. Distinct
  // from ageMs (which ticks every 2s regardless) — this is what we key the
  // amber/red "stuck" signal off. Older servers don't send it; we fall back
  // to ageMs in that case (see ConsolidationProgress).
  stderrAgeMs?: number
  startedAt?: string
  lastMessage?: string
}

export interface ConsolidationStatusBase {
  totalDigests: number
  totalInsights: number
  undigested: number
  pendingPast?: number
  pendingToday?: number
  inflight?: InflightInfo | null
}

interface NMatch {
  current: number
  total: number
  label: string
}

interface ParsedProgress {
  outer?: NMatch    // Stage S/T — coarse phase
  inner?: NMatch    // Day / Project / chunk — work loop within a stage
  finishing?: boolean    // wrapper-script summary line emitted post-pipeline
  // overallPct combines outer + inner monotonically across the whole run:
  //   Stage 1/2 + Day 3/5 → ~30%
  //   Stage 2/2 + chunk 2/4 → ~75%
  // null means "no progress info, render an indeterminate pulse".
  overallPct: number | null
}

// The CLI emits these patterns (in roughly this order):
//   [Consolidator] Stage 1/2: consolidating 5 day(s) of observations
//   [Consolidator] Day 2/5: 2026-04-26 — grouping observations          (day START)
//   [Consolidator] Day 2/5: 2026-04-26 — 3 digest(s) from 12 obs        (day END)
//   [Consolidator] Stage 2/2: synthesizing N digests into insights — 3 project(s)
//   [Consolidator] Project 1/3: coding — synthesizing 12 digest(s)      (project START)
//   [Consolidator] Insight synthesis coding chunk 1/2 (30 digests)      (chunk START)
// And finally the wrapper script (scripts/consolidate-observations.js) emits
// these post-pipeline summary lines (no [Consolidator] prefix):
//   Consolidation complete:
//     Days processed: N / Digests created: N / Observations digested: N
//     Insights created: N / Insights updated: N
// We treat those as "finishing" — the worker is done synthesizing and the
// process is just printing summary stats before exiting.
const FINISHING_RE = /^\s*(Consolidation complete:|Days processed:|Digests created:|Observations digested:|Insights created:|Insights updated:)/

// Convert an inner-loop match to a fraction-complete in [0, 1]. Most messages
// signal "starting item N of total" with no per-item progress signal — we use
// (N - 0.5)/total so chunk 1/1 reads as ~50%, not 100%. Day messages carry an
// explicit completion suffix ("digest(s) from"); when seen we credit the full
// N/total. Without this, the bar lies — chunk 1/1 hit 100% the moment the
// (potentially multi-minute) LLM call started.
function innerFraction(current: number, total: number, completed: boolean): number {
  if (total <= 0) return 0
  if (completed) return Math.min(1, current / total)
  return Math.max(0, Math.min(1, (current - 0.5) / total))
}

function parseProgress(lastMessage?: string): ParsedProgress {
  if (!lastMessage) return { overallPct: null }

  if (FINISHING_RE.test(lastMessage)) {
    return { finishing: true, overallPct: 100 }
  }

  let outer: NMatch | undefined
  let inner: NMatch | undefined
  let innerCompleted = false

  const stage = lastMessage.match(/Stage (\d+)\/(\d+)/)
  if (stage) outer = { current: +stage[1], total: +stage[2], label: `Stage ${stage[1]}/${stage[2]}` }

  const day = lastMessage.match(/Day (\d+)\/(\d+)/)
  if (day) {
    inner = { current: +day[1], total: +day[2], label: `Day ${day[1]}/${day[2]}` }
    // Day end messages contain "digest(s) from" or "obs"; start messages say
    // "grouping observations".
    innerCompleted = /digest\(s\) from|\d+ obs\b/.test(lastMessage)
  } else {
    const proj = lastMessage.match(/Project (\d+)\/(\d+)/)
    if (proj) inner = { current: +proj[1], total: +proj[2], label: `Project ${proj[1]}/${proj[2]}` }
    else {
      const chunk = lastMessage.match(/chunk (\d+)\/(\d+)/)
      if (chunk) inner = { current: +chunk[1], total: +chunk[2], label: `Chunk ${chunk[1]}/${chunk[2]}` }
    }
  }

  // Combined progress. Each stage owns 1/T of the bar. Within a stage, the
  // inner fraction (see innerFraction) fills that slice. Without an inner we
  // use (S-1)/T as the floor — Stage 2/2 alone means "stage 1 finished,
  // stage 2 starting" → 50%.
  let overallPct: number | null = null
  if (outer && inner) {
    const stageWidth = 1 / outer.total
    const stageFloor = (outer.current - 1) * stageWidth
    overallPct = Math.min(99, Math.round((stageFloor + innerFraction(inner.current, inner.total, innerCompleted) * stageWidth) * 100))
  } else if (outer) {
    overallPct = Math.round(((outer.current - 1) / outer.total) * 100)
  } else if (inner) {
    overallPct = Math.min(99, Math.round(innerFraction(inner.current, inner.total, innerCompleted) * 100))
  }

  return { outer, inner, overallPct }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

// Strip the "[Consolidator] " prefix and any "Day N/M:" / "Stage N/M:" / "Project N/M:"
// — we render the parsed progress separately, so the message line just shows
// the descriptive tail.
function stripProgressTokens(msg: string): string {
  return msg
    .replace(/^\[Consolidator\]\s*/, '')
    .replace(/^(Stage|Day|Project)\s*\d+\/\d+:?\s*/, '')
    .replace(/\s*chunk\s*\d+\/\d+/, '')
    .trim()
}

// Wrapper-summary lines look like "  Insights updated: 0" — keep them as-is
// (they're already user-readable), just trim the leading whitespace.
function formatFinishingLine(msg: string): string {
  return msg.trim()
}

/**
 * Polls /api/consolidation/status every 2s while the consolidator is alive,
 * or until the caller stops needing it. Returns the latest status and a
 * `done` callback that fires once when an inflight run finishes (so callers
 * can refresh their lists).
 */
export function useConsolidationStatus<T extends ConsolidationStatusBase>(opts: {
  active: boolean
  onComplete?: () => void
}): T | null {
  const { active, onComplete } = opts
  const [status, setStatus] = useState<T | null>(null)
  const wasInflight = useRef(false)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/consolidation/status`)
        if (!res.ok || cancelled) return
        const data = (await res.json()) as T
        setStatus(data)
        if (wasInflight.current && !data.inflight) {
          wasInflight.current = false
          onComplete?.()
        }
        if (data.inflight) wasInflight.current = true
      } catch { /* keep polling */ }
    }
    fetchOnce()
    if (!active && !wasInflight.current) return
    const id = setInterval(fetchOnce, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [active, onComplete])

  return status
}

interface Props {
  inflight: InflightInfo
}

/**
 * Banner-style progress strip rendered while a consolidation run is alive.
 * Combines: a single overall bar (Stage + Day/Project/chunk merged so it
 * advances monotonically across the whole pipeline), elapsed time, time
 * since the worker last spoke (amber >30s, red >60s as a "likely stuck"
 * signal), and the latest stderr message so the user sees what's happening.
 */
export function ConsolidationProgress({ inflight }: Props) {
  // Tick every second so elapsed/staleness render updates between heartbeat fetches
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const { outer, inner, finishing, overallPct } = parseProgress(inflight.lastMessage)
  const rawMessage = inflight.lastMessage
  const message = rawMessage
    ? (finishing ? formatFinishingLine(rawMessage) : stripProgressTokens(rawMessage))
    : 'starting…'
  const startedAt = inflight.startedAt ? new Date(inflight.startedAt).getTime() : Date.now()
  const elapsedMs = Math.max(0, Date.now() - startedAt)
  // Prefer stderrAgeMs (time since the worker last actually spoke) over ageMs
  // (which ticks every 2s regardless and is therefore useless for staleness).
  // Fall back to ageMs for older servers that don't send stderrAgeMs yet.
  const activityMs = inflight.stderrAgeMs ?? inflight.ageMs ?? 0
  // Suppress staleness during the "finishing" phase — the wrapper script is
  // just printing summary lines before exit; the heartbeat will disappear in
  // a moment. Don't alarm the user.
  const stuckLevel: 'ok' | 'slow' | 'stuck' =
    finishing ? 'ok'
    : activityMs > 60_000 ? 'stuck'
    : activityMs > 30_000 ? 'slow'
    : 'ok'
  const ageColor =
    stuckLevel === 'stuck' ? 'text-red-500'
    : stuckLevel === 'slow' ? 'text-amber-500'
    : 'text-muted-foreground'

  // Header label — finishing wins, then combined Stage+inner, then either alone.
  const headerLabel = finishing
    ? 'Wrapping up…'
    : (outer && inner) ? `${outer.label} · ${inner.label}`
    : (inner?.label ?? outer?.label ?? 'Consolidating…')

  return (
    <div className="mb-4 p-3 rounded-md border border-blue-500/30 bg-blue-500/5">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCw className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
        <div className="text-sm font-medium flex-1 min-w-0">
          <span>{headerLabel}</span>
          {overallPct !== null && (
            <span className="text-muted-foreground ml-2 tabular-nums">{overallPct}%</span>
          )}
        </div>
        <div className={`text-xs tabular-nums ${ageColor} flex items-center gap-1 shrink-0`}>
          {stuckLevel !== 'ok' && <AlertTriangle className="w-3 h-3" />}
          <span>elapsed {formatDuration(elapsedMs)}</span>
          <span>·</span>
          <span title="time since the worker last wrote a log line">
            last activity {formatDuration(activityMs)} ago
          </span>
        </div>
      </div>

      {overallPct !== null ? (
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-2 rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      ) : (
        // Indeterminate bar — pulses when we don't yet have any N/M to anchor to
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-2 w-1/3 rounded-full bg-blue-500/60 animate-pulse" />
        </div>
      )}

      {message && (
        <div className="mt-2 text-xs text-muted-foreground truncate font-mono" title={rawMessage}>
          {message}
        </div>
      )}

      {stuckLevel === 'stuck' && (
        <div className="mt-2 text-xs text-red-500">
          No log activity for {formatDuration(activityMs)}. The worker may be stuck —
          consider checking <code className="font-mono">.observations/consolidation-heartbeat.json</code>
          {inflight.pid ? <> or <code className="font-mono">ps -p {inflight.pid}</code></> : null}.
        </div>
      )}
    </div>
  )
}
