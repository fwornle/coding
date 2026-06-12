// PATTERN SOURCE: 55-PATTERNS.md § LslTimelineStrip.tsx (data shape + render layout)
//   + 55-UI-SPEC.md §13.2 (LSL Timeline Strip full UX)
//   + 55-UI-SPEC.md §10 (click semantics for LSL ticks)
//   + 55-11-PLAN.md Task 2
//
// Surface #14 — coding-only horizontal session timeline.
//
// Backend endpoint shipped by 55-06: GET /api/coding/lsl/sessions?since=<iso>&limit=200
// Response envelope: { success: true, data: { sessions: LslSession[] } }
//
// GATING:
//   Renders null unless `system === 'coding'`. UnifiedViewer.tsx ALSO gates
//   this at the mount level — defense in depth.
//
// WINDOW TOGGLES (UI-SPEC §13.2):
//   24h / 7d / 30d via shadcn ToggleGroup; default 7d. Changing the window
//   re-fetches with the new `since` and TanStack Query caches per window key.
//
// TICK POSITIONING:
//   pctOfWindow(iso) = (1 - (now - new Date(iso).getTime()) / windowMs) * 100
//   Newest sessions render on the right; oldest on the left.
//
// CLICK SEMANTICS:
//   click       → setLslSessionFilter([id])  // replace
//   Cmd/Ctrl+click → addLslSessionFilter(id) // additive
//
// KEYBOARD (UI-SPEC §13.2):
//   ← / →  : move focus between ticks (browser default tabindex-0 ordering)
//   Enter  : setLslSessionFilter([focused])
//   Esc    : clearLslSessionFilter()
//
// CURRENTLY-RUNNING SESSIONS:
//   endAt === null → ring-2 ring-primary outline
//
// LOGGER DISCIPLINE: ZERO raw console.*

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Logger } from '@/lib/logging'
import { useViewerStore } from '@/store/viewer-store'
import type { ApiClient } from '@/api/ApiClient'
import { useGraphData } from '@/graph/useGraphData'

export type LslWindow = '24h' | '7d' | '30d' | 'all'

// 2026-06-12: 'all' = 365d cap. Sessions older than that are extremely
// rare in practice and the backing API already enforces `limit=200`, so
// a huge effective window doesn't blow up the strip. The fetched `since`
// is computed from this — the backend returns whatever falls in range.
const WINDOW_MS: Record<LslWindow, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  'all': 365 * 24 * 3600_000,
}

// 2026-06-12: ESC reset fallback — 7d gives a useful spread of sessions
// without being so zoomed-in that only the running tick is visible.
// (Initial UX used '24h' but the user reported it felt "majorly zoomed".)
const LATEST_WINDOW: LslWindow = '7d'

export interface LslSession {
  id: string
  startAt: string // ISO
  endAt: string | null
  observationCount: number
  entityIds: string[]
}

interface LslTimelineStripProps {
  system: 'coding' | 'okb'
  apiClient: ApiClient
}

async function fetchSessions(
  apiClient: ApiClient,
  windowMs: number,
): Promise<LslSession[]> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const url = `${apiClient.base}/api/coding/lsl/sessions?since=${encodeURIComponent(since)}&limit=200`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`)
  }
  const body = (await res.json()) as
    | { success: true; data: { sessions: LslSession[] } | LslSession[] }
    | { success: false; error: string }
  if (!body.success) {
    throw new Error(body.error || 'malformed /api/coding/lsl/sessions response')
  }
  const data = body.data
  if (Array.isArray(data)) return data
  return data?.sessions ?? []
}

function pctOfWindow(iso: string, windowMs: number, originMs?: number): number {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return 0
  // 2026-06-12: with an explicit `originMs` (used by the 'all' window),
  // position is measured against [originMs, now] instead of [now-windowMs, now].
  // This is what stops the 'all' view from squashing every recent tick
  // into the rightmost 2% of the strip when there's only 30d of data
  // but the window slot says 365d.
  if (typeof originMs === 'number') {
    const span = Math.max(Date.now() - originMs, 1)
    const pct = ((ts - originMs) / span) * 100
    return Math.max(0, Math.min(100, pct))
  }
  const age = Date.now() - ts
  const pct = (1 - age / windowMs) * 100
  return Math.max(0, Math.min(100, pct))
}

// 2026-06-12: render timestamps in local timezone so the tooltip lines
// up with the History panel's "created" line (also local) and the
// user's wall clock. The server returns UTC ISO strings.
function fmtLocalTs(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatTooltipText(s: LslSession): string {
  const idShort = s.id.slice(0, 8)
  const start = fmtLocalTs(s.startAt)
  const end = s.endAt ? fmtLocalTs(s.endAt) : 'running'
  return `${idShort} · ${start} → ${end} · ${s.observationCount} obs · ${s.entityIds.length} entities`
}

export default function LslTimelineStrip({ system, apiClient }: LslTimelineStripProps) {
  // Defense-in-depth gate.
  if (system !== 'coding') return null

  const [windowKey, setWindowKey] = useState<LslWindow>('7d')
  // 2026-06-12: remember the windowKey BEFORE the auto-slide effect
  // bumped it for an old selection. When the user deselects (ESC / bg
  // click), we restore this so the strip snaps back to the latest view
  // instead of being stuck on 30d.
  const preSlideWindowRef = useRef<LslWindow | null>(null)
  const setLslSessionFilter = useViewerStore((s) => s.setLslSessionFilter)
  const addLslSessionFilter = useViewerStore((s) => s.addLslSessionFilter)
  const clearLslSessionFilter = useViewerStore((s) => s.clearLslSessionFilter)
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
  const stripRef = useRef<HTMLDivElement | null>(null)
  // 2026-06-12: reverse mapping — when a node is selected anywhere
  // (graph click, HistorySidebar click, search), we light up the tick
  // for its createdAt hour-bucket. Look up the entity by id from the
  // shared data hook (TanStack Query caches it once across the app, so
  // this is free).
  const { entities } = useGraphData(apiClient, system)
  // 2026-06-12: range-match — slice-by-hour was unreliable because LSL
  // file times (UTC after parser) don't align with entity createdAt
  // UTC hour boundaries. We now expose the selected entity's createdAt
  // as a numeric timestamp; the tick render compares each session's
  // [startAt, endAt) range to it.
  const selectedTs = useMemo<number | null>(() => {
    if (!selectedNodeId) return null
    const ent = entities.find((e) => e.id === selectedNodeId)
    const created = (ent?.createdAt as string | undefined)
      ?? ((ent?.metadata as { createdAt?: string } | undefined)?.createdAt)
    if (typeof created !== 'string') return null
    const t = Date.parse(created)
    return Number.isFinite(t) ? t : null
  }, [selectedNodeId, entities])

  // 2026-06-12: auto-slide the window if the selected node's bucket
  // falls OUTSIDE the current window. e.g. user picks an 18-day-old
  // node while window=7d — we bump to 30d. If even 30d isn't enough,
  // we stay at 30d (the strip will just clip the tick on the left).
  useEffect(() => {
    // 2026-06-12: when selection clears, restore the pre-slide window
    // (if we slid it) or fall back to the LATEST_WINDOW default. This
    // is the "ESC resets the timeline window to the latest span" UX —
    // ESC clears selectedNodeId via the global shortcut, our effect
    // fires here.
    if (selectedTs === null) {
      const restoreTo = preSlideWindowRef.current ?? LATEST_WINDOW
      preSlideWindowRef.current = null
      // 2026-06-12: deselect (ESC / bg click) ALSO clears the LSL
      // session filter the tick click installed. Without this, ESC
      // would leave the graph stuck filtered to the prior session's
      // entities even though no node is selected anymore — that's
      // the "timeline filter no longer working" UX failure (the
      // filter never clears, so the user can't return to the full
      // graph without manually unchecking something).
      const current = useViewerStore.getState()
      if (current.lslFilterEntityIds !== null || current.lslSessionFilter.length > 0) {
        useViewerStore.setState({
          lslFilterEntityIds: null,
          lslSessionFilter: [],
        })
      }
      if (restoreTo !== windowKey) {
        setWindowKey(restoreTo)
        Logger.info(
          Logger.Categories.PANELS,
          `LslTimelineStrip restore window → ${restoreTo} on deselect`,
        )
      }
      return
    }
    const ageMs = Date.now() - selectedTs
    if (ageMs <= WINDOW_MS[windowKey]) return
    const next: LslWindow | null =
      ageMs <= WINDOW_MS['7d'] ? '7d'
      : ageMs <= WINDOW_MS['30d'] ? '30d'
      : 'all'
    if (next && next !== windowKey) {
      // Remember the prior window only once per selection — subsequent
      // auto-slides within the same selection chain shouldn't overwrite.
      if (preSlideWindowRef.current === null) {
        preSlideWindowRef.current = windowKey
      }
      setWindowKey(next)
      Logger.info(
        Logger.Categories.PANELS,
        `LslTimelineStrip auto-slide window → ${next} for selection`,
      )
    }
  }, [selectedTs, windowKey])

  const { data } = useQuery({
    queryKey: ['lsl-sessions', apiClient.base, windowKey],
    queryFn: () => fetchSessions(apiClient, WINDOW_MS[windowKey]),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const sessions: LslSession[] = useMemo(() => {
    const arr = data ?? []
    // 2026-06-12: dedup by (id + startAt) — NOT id alone. The API
    // returns one entry per LSL tranche file (`2026-06-10_2200-2300_
    // c197ef.md` etc.), and every tranche from the SAME session shares
    // the session-prefix as its `id`. Deduping by id alone collapsed
    // every hour-bucket of every session down to a single tick — the
    // user's "timeline only shows one item" symptom. The composite key
    // preserves every hour-bucket while still preventing duplicate
    // React keys when the API genuinely returns the same tranche twice.
    const seen = new Set<string>()
    const deduped: LslSession[] = []
    for (const s of arr) {
      const k = `${s.id}|${s.startAt}`
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push(s)
    }
    return deduped.sort((a, b) => a.startAt.localeCompare(b.startAt))
  }, [data])

  // 2026-06-12: dynamic origin for the 'all' window — span from the
  // EARLIEST session's startAt to now. Without this, 'all' (= 365d slot)
  // pushed every real session into the rightmost few percent of the
  // strip (the "squashed to the right" symptom). With the data-driven
  // origin, all ticks distribute evenly across the full strip width.
  const allOriginMs = useMemo<number | undefined>(() => {
    if (windowKey !== 'all') return undefined
    if (sessions.length === 0) return undefined
    let min = Infinity
    for (const s of sessions) {
      const t = Date.parse(s.startAt)
      if (Number.isFinite(t) && t < min) min = t
    }
    return Number.isFinite(min) ? min : undefined
  }, [windowKey, sessions])

  function onWindowChange(next: string) {
    if (next === '24h' || next === '7d' || next === '30d' || next === 'all') {
      // Manual change drops the auto-slide memory: if the user explicitly
      // picks a window they want it to STICK across the next deselect.
      preSlideWindowRef.current = null
      setWindowKey(next)
      Logger.info(Logger.Categories.PANELS, `LslTimelineStrip window → ${next}`)
    }
  }

  function onTickClick(
    e: React.MouseEvent<HTMLButtonElement>,
    sessionId: string,
    session?: LslSession,
  ) {
    e.stopPropagation()
    const ids = session?.entityIds ?? []
    if (e.metaKey || e.ctrlKey) {
      // 2026-06-12: Cmd/Ctrl click — UNION the session's entityIds with
      // the existing filter set. Lets the user assemble a multi-session
      // view (e.g. "show everything from yesterday's three working
      // sessions").
      const prev = useViewerStore.getState().lslFilterEntityIds
      const union = new Set<string>(prev ?? [])
      for (const id of ids) union.add(id)
      useViewerStore.setState({
        lslSessionFilter: Array.from(
          new Set<string>([...useViewerStore.getState().lslSessionFilter, sessionId]),
        ),
        lslFilterEntityIds: union,
      })
      Logger.info(
        Logger.Categories.PANELS,
        `LslTimelineStrip tick added: ${sessionId} (${ids.length} ids, total ${union.size})`,
      )
      return
    }
    // Plain click — REPLACE the filter with this session's entity set.
    // Also select the first entity as the focal point so the right panel
    // shows its content and the graph's path-trace centers on it. The
    // server sorts visible-first (Insight → other → Observation), so the
    // first id is the best click target.
    const firstEntityId = ids[0] ?? null
    useViewerStore.setState({
      selectedNodeId: firstEntityId,
      pathToSelected: new Set<string>(),
      lslSessionFilter: [sessionId],
      lslFilterEntityIds: new Set<string>(ids),
    })
    Logger.info(
      Logger.Categories.PANELS,
      `LslTimelineStrip tick → filter:${ids.length} ids, select:${firstEntityId ?? 'none'}`,
    )
  }

  function onStripKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      clearLslSessionFilter()
      e.preventDefault()
      Logger.info(Logger.Categories.PANELS, 'LslTimelineStrip filter cleared (Esc)')
      return
    }
    const focused = document.activeElement as HTMLElement | null
    if (!focused || !stripRef.current?.contains(focused)) return
    const tickButtons = Array.from(
      stripRef.current.querySelectorAll<HTMLButtonElement>('button[data-testid^="lsl-tick-"]'),
    )
    const idx = tickButtons.indexOf(focused as HTMLButtonElement)
    if (idx === -1) return
    if (e.key === 'ArrowRight') {
      const next = tickButtons[Math.min(tickButtons.length - 1, idx + 1)]
      next?.focus()
      e.preventDefault()
    } else if (e.key === 'ArrowLeft') {
      const next = tickButtons[Math.max(0, idx - 1)]
      next?.focus()
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const id = focused.getAttribute('data-session-id')
      if (id) {
        setLslSessionFilter([id])
        Logger.info(Logger.Categories.PANELS, `LslTimelineStrip Enter → ${id}`)
        e.preventDefault()
      }
    }
  }

  // Ensure the tooltip provider is mounted — UnifiedViewer also mounts a
  // provider higher in the tree, so this is a fallback only.
  useEffect(() => {
    return () => {
      // no-op cleanup placeholder; the ToggleGroup + Tooltip components
      // handle their own listeners.
    }
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={stripRef}
        data-testid="lsl-strip"
        tabIndex={-1}
        onKeyDown={onStripKeyDown}
        className="h-8 border-t border-border bg-card flex items-center px-2 gap-2"
        role="region"
        aria-label="LSL session timeline"
      >
        <ToggleGroup
          type="single"
          value={windowKey}
          onValueChange={(v) => v && onWindowChange(v)}
          aria-label="Time window"
          className="h-6"
        >
          <ToggleGroupItem value="24h" aria-label="24 hours" className="text-[10px] h-6 px-1.5">
            24h
          </ToggleGroupItem>
          <ToggleGroupItem value="7d" aria-label="7 days" className="text-[10px] h-6 px-1.5">
            7d
          </ToggleGroupItem>
          <ToggleGroupItem value="30d" aria-label="30 days" className="text-[10px] h-6 px-1.5">
            30d
          </ToggleGroupItem>
          <ToggleGroupItem value="all" aria-label="All time" className="text-[10px] h-6 px-1.5">
            all
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1 relative h-6">
          {sessions.length === 0 ? (
            <div
              data-testid="lsl-empty-state"
              className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground italic"
            >
              No sessions recorded in this time window.
            </div>
          ) : (
            sessions.map((s) => {
              const left = pctOfWindow(s.startAt, WINDOW_MS[windowKey], allOriginMs)
              const isRunning = s.endAt === null
              // 2026-06-12: tri-state ring. Selected node's createdAt
              // is matched by [startAt, endAt) range — NOT slice-by-hour
              // (LSL filenames are converted local→UTC by the parser so
              // hour-bucket equality fails when entity UTC hour ≠ session
              // UTC start hour). Selection wins; the live ring shows on
              // the running tick only when nothing is selected.
              const startMs = Date.parse(s.startAt)
              const endMs = s.endAt
                ? Date.parse(s.endAt)
                : Date.now() + 1
              const isSelectedBucket =
                selectedTs !== null
                && Number.isFinite(startMs)
                && selectedTs >= startMs
                && selectedTs < endMs
              const ringClass = isSelectedBucket
                ? 'ring-2 ring-blue-500'
                : (isRunning && selectedTs === null)
                  ? 'ring-2 ring-primary'
                  : ''
              const fillClass = 'bg-pink-300 hover:bg-pink-400'
              return (
                <Tooltip key={`${s.id}|${s.startAt}`}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      tabIndex={0}
                      data-testid={`lsl-tick-${s.id}`}
                      data-session-id={s.id}
                      onClick={(e) => onTickClick(e, s.id, s)}
                      style={{ left: `${left}%` }}
                      // 2026-06-12: LSL sessions are by definition online /
                      // auto-captured learning (claude-code / sub-agent
                      // transcripts streamed through ObservationWriter).
                      // Use the same pink (#FFB6C1 → tailwind pink-300) the
                      // graph viewer uses for `metadata.source==='auto'`
                      // entities so the visual language is consistent.
                      className={`absolute w-2 h-6 ${fillClass} rounded-sm ${ringClass}`}
                      aria-label={`LSL session ${s.id.slice(0, 8)} ${s.endAt === null ? '(running)' : ''}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{formatTooltipText(s)}</TooltipContent>
                </Tooltip>
              )
            })
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
