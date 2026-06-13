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
// 2026-06-13 (Phase 56-04 fix #3): the strip's onTickClick now needs to
// compute the same ancestry-path the graph-side click does so the
// central-trace renders when a tick click resolves a focal entity.
// Shared with D3GraphCanvas via the extracted helper module.
import { computeAncestryPath } from '@/graph/ancestry'

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

// 2026-06-13 [Phase 56-03 AC #1]: format a single major-tick label for
// the timestamp scale row. Format adapts to the active window's duration
// per CONTEXT.md D-05 ladder:
//   - windowMs <= 60_000     -> HH:MM:SS
//   - windowMs <= 86_400_000 -> HH:MM
//   - else                   -> "Mon DD" via Intl.DateTimeFormat
//
// Hand-rolled in the existing fmtLocalTs `pad()` style to avoid
// introducing a fresh d3-time-format dependency — see PATTERNS.md
// "Available Libraries" + threat_model T-56-03-03.
//
// Exported so vitest can unit-test the format ladder without rendering
// the whole strip.
export function formatScaleLabel(ms: number, windowMs: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (windowMs <= 60_000) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  if (windowMs <= 86_400_000) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  // multi-day — use the runtime's Intl formatter (vetted locale string,
  // not user-supplied content per threat_model T-56-03-03). The output
  // shape is e.g. "Jun 13" / "Aug 3".
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
  // 2026-06-13 (Phase 56-04 fix #1): track the PREVIOUS selectedTs so
  // the deselect-effect can distinguish "transitioned from selected →
  // deselected" (user pressed Esc / bg-clicked the graph) from "mounted
  // with no selection" (the user is just looking at the strip). The
  // original effect fired on every mount where `selectedTs === null`,
  // which meant clicking any window button (24h/30d/all) was instantly
  // snapped back to the LATEST_WINDOW default by the same effect — the
  // operator-reported AC #1 regression. The strip now only fires the
  // restore + LSL-filter clear when prevSelectedTsRef !== null (we WERE
  // selected last render) AND selectedTs === null (we ARE now
  // deselected). On pure initial mount the ref stays null and no
  // cascade fires. This also fixes the pre-existing Test 7 baseline
  // failure (Cmd/Ctrl+click prior-filter wipe) for the same reason.
  const prevSelectedTsRef = useRef<number | null>(null)
  const setLslSessionFilter = useViewerStore((s) => s.setLslSessionFilter)
  const addLslSessionFilter = useViewerStore((s) => s.addLslSessionFilter)
  const clearLslSessionFilter = useViewerStore((s) => s.clearLslSessionFilter)
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
  // 2026-06-13 (Phase 56-04 fix #2): subscribe to selectedSessionId so the
  // strip can clear its local clicked-tick state when ANOTHER pane clears
  // the selection (Esc / bg-click cascade). The ring predicate itself uses
  // the local `clickedTickKey` state instead of `selectedSessionId === s.id`
  // — see continuation-2 fix #D below.
  const selectedSessionId = useViewerStore((s) => s.selectedSessionId)
  const stripRef = useRef<HTMLDivElement | null>(null)
  // 2026-06-13 (Phase 56-04 continuation 2 fix #D): track the SPECIFIC
  // (sessionId, startAt) bucket the user clicked. The previous fix used
  // `isSelectedSession = selectedSessionId === s.id` which fired on EVERY
  // tranche of the same session id — in the live LSL data a session is
  // sliced into many `LslSession` objects sharing `id` but distinct
  // `startAt`, so every tranche rang blue on a single click. The local
  // state below identifies the clicked bucket via the same composite key
  // (`${id}|${startAt}`) the React render uses, so only the actually-
  // clicked tick rings.
  //
  // Reset rule: a graph→timeline cascade (selectedNodeId changes due to a
  // graph node click or a sidebar row click) clears the local bucket key
  // so the direct-click highlight doesn't persist alongside the graph-
  // driven `isSelectedBucket` (timestamp range) ring. clearSelection() in
  // the store nulls `selectedSessionId`; the effect below resets local
  // state whenever the store's session id transitions to null.
  const [clickedTickKey, setClickedTickKey] = useState<string | null>(null)
  useEffect(() => {
    if (selectedSessionId === null) {
      setClickedTickKey(null)
    }
  }, [selectedSessionId])
  // 2026-06-12: reverse mapping — when a node is selected anywhere
  // (graph click, HistorySidebar click, search), we light up the tick
  // for its createdAt hour-bucket. Look up the entity by id from the
  // shared data hook (TanStack Query caches it once across the app, so
  // this is free).
  // 2026-06-13 (Phase 56-04 fix #3): also pull `relations` so the tick-
  // click handler can compute pathToSelected the same way D3GraphCanvas
  // does on node click — without it, the central-trace stays blank when
  // a tick selection resolves to a focal entity.
  const { entities, relations } = useGraphData(apiClient, system)
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
  //
  // 2026-06-13 (Phase 56-04 fix #1): the deselect branch is gated on
  // a real selected → deselected TRANSITION (prevSelectedTsRef !== null
  // AND selectedTs === null). The original code fired the cascade on
  // every mount where `selectedTs === null`, which meant:
  //   (a) clicking 24h/30d/all snapped back to LATEST_WINDOW (the
  //       deselect-effect re-fired on every windowKey change because
  //       windowKey is in the dep list)
  //   (b) any pre-existing `lslSessionFilter` (e.g. the one Test 7's
  //       beforeEach set) got wiped on mount
  // Now we only restore + clear LSL state when the user goes from a
  // real selection back to no-selection (Esc / bg-click on graph).
  useEffect(() => {
    if (selectedTs === null) {
      // Only run the restore + LSL-clear cascade when we WERE selected.
      // First mount (and any selection-less re-render triggered by
      // windowKey changes) leaves state alone.
      const wasSelected = prevSelectedTsRef.current !== null
      prevSelectedTsRef.current = null
      if (!wasSelected) return
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
    // Selection is active — remember it for the next deselect transition.
    prevSelectedTsRef.current = selectedTs
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

  // 2026-06-13 [Phase 56-03 AC #1]: 7 evenly-spaced major-tick labels
  // across the active strip span. 7 is the midpoint of the 5-8 target
  // from CONTEXT.md D-05 — gives readable spacing at default viewport
  // widths without overlapping.
  //
  // Span derivation mirrors pctOfWindow at lines 103-119:
  //   - fixed windows (24h/7d/30d): span = [now - WINDOW_MS, now]
  //   - 'all': span = [allOriginMs, now] (dynamic data-driven origin)
  //
  // For the 'all' window we also widen the ladder using the actual span
  // duration so multi-day labels switch on once the data is wide enough.
  // Until sessions are loaded (allOriginMs === undefined) the ladder
  // falls back to the WINDOW_MS['all'] slot (365d) → "Mon DD" labels.
  const scaleTicks = useMemo<Array<{ ms: number; pct: number; label: string }>>(() => {
    const endMs = Date.now()
    const isAll = windowKey === 'all'
    const startMs = isAll
      ? (allOriginMs ?? endMs - WINDOW_MS['all'])
      : endMs - WINDOW_MS[windowKey]
    const ladderWindowMs = endMs - startMs
    const COUNT = 7
    const result: Array<{ ms: number; pct: number; label: string }> = []
    for (let i = 0; i < COUNT; i++) {
      const ms = startMs + ((endMs - startMs) * i) / (COUNT - 1)
      const pct = pctOfWindow(
        new Date(ms).toISOString(),
        WINDOW_MS[windowKey],
        isAll ? allOriginMs : undefined,
      )
      result.push({ ms, pct, label: formatScaleLabel(ms, ladderWindowMs) })
    }
    return result
  }, [windowKey, allOriginMs])

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
    // 2026-06-13 (Phase 56-04 continuation 2 fix #D): record the clicked
    // bucket via the composite (id, startAt) key. The render predicate
    // for `ring-blue-500` uses this local state to single out the actually-
    // clicked tick (NOT every tranche of the same session id, which was
    // the previous over-fired predicate).
    const tickKey = session ? `${sessionId}|${session.startAt}` : sessionId
    setClickedTickKey(tickKey)
    // 2026-06-13 (Phase 56-04 continuation 2 fix #A): when the clicked
    // session has NO entity ids (entityIds=[]), the broader store cascade
    // (selectedNodeId / pathToSelected / lslFilterEntityIds) has nothing
    // meaningful to write. The previous code unconditionally wrote a fresh
    // `new Set()` for each of those fields on every click — stable content
    // but new reference, which invalidated the D3 graph's `visibleEntities`
    // useMemo and triggered a full SVG rebuild + force-simulation restart
    // on every empty-tick click. Operator complaint: "selecting some
    // timeline items doesn't do anything but redraw the D3 graph (why? is
    // this necessary? annoying)". Early-exit with only the minimal
    // session-scope fields so the ring still fires (via clickedTickKey)
    // and the cross-pane state still reflects the click intent (the
    // selectedSessionId + selectionSource pair the history sidebar's
    // 56-02 contract expects).
    if (ids.length === 0) {
      useViewerStore.setState({
        selectedSessionId: sessionId,
        selectionSource: 'timeline',
        // selectedNodeId / pathToSelected / lslFilterEntityIds / highlightedRowKey
        // are INTENTIONALLY untouched — the store's existing values are
        // preserved by setState's merge semantics, so the D3 graph's
        // useMemo deps remain reference-stable and no re-render fires.
      })
      Logger.info(
        Logger.Categories.PANELS,
        `LslTimelineStrip tick (empty session) → ${sessionId} (minimal write — no D3 re-render)`,
      )
      return
    }
    // 2026-06-13 (Phase 56-04 fix #3): compute the ancestry-path the
    // same way D3GraphCanvas's node click does (lines 564, 573-579 in
    // that file) so the central-trace renders when the focal entity
    // has a parent chain. Without this, `pathToSelected: new Set()`
    // was hardcoded and the trace stayed blank — the operator-reported
    // AC #2 partial-success regression. Returns an empty Set when the
    // focal entity has no relations in the live graph (which is fine —
    // matches D3GraphCanvas's behaviour on an isolated node).
    const firstEntityId = ids[0] ?? null
    const path = firstEntityId !== null
      ? computeAncestryPath(firstEntityId, relations)
      : null
    const pathToSelected: Set<string> = path !== null
      ? new Set<string>(path.nodeDepths.keys())
      : new Set<string>()
    if (e.metaKey || e.ctrlKey) {
      // 2026-06-12: Cmd/Ctrl click — UNION the session's entityIds with
      // the existing filter set. Lets the user assemble a multi-session
      // view (e.g. "show everything from yesterday's three working
      // sessions").
      const prev = useViewerStore.getState().lslFilterEntityIds
      const union = new Set<string>(prev ?? [])
      for (const id of ids) union.add(id)
      // 2026-06-13 [Phase 56-03 AC #4 store side]: also write the three
      // cross-pane sync fields atomically alongside the LSL filter so
      // the history sidebar scrolls and the timeline can stay loop-safe
      // via selectionSource. First-id of the union is the focal point
      // (consistent with the plain-click branch below).
      useViewerStore.setState({
        lslSessionFilter: Array.from(
          new Set<string>([...useViewerStore.getState().lslSessionFilter, sessionId]),
        ),
        lslFilterEntityIds: union,
        highlightedRowKey: ids[0] ?? null,
        selectionSource: 'timeline',
        selectedSessionId: sessionId,
        // 2026-06-13 (Phase 56-04 fix #3): same pathToSelected write as
        // the plain-click branch so a Cmd/Ctrl additive selection also
        // gets the central-trace.
        pathToSelected,
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
    // 2026-06-13 [Phase 56-03 AC #4 store side]: 7-field atomic snapshot.
    // The pre-existing 4 fields (selectedNodeId, pathToSelected,
    // lslSessionFilter, lslFilterEntityIds) ship the graph + LSL filter
    // cascade; the three new Phase 56 fields (highlightedRowKey,
    // selectionSource, selectedSessionId) ship the history-sidebar
    // scroll-target + the loop-safety tag + the aggregate-selection
    // signal (AC #6 partial — selectedSessionId now populated).
    useViewerStore.setState({
      selectedNodeId: firstEntityId,
      // 2026-06-13 (Phase 56-04 fix #3): real ancestry path instead of
      // hardcoded new Set() so the central-trace renders.
      pathToSelected,
      lslSessionFilter: [sessionId],
      lslFilterEntityIds: new Set<string>(ids),
      highlightedRowKey: firstEntityId,
      selectionSource: 'timeline',
      selectedSessionId: sessionId,
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
        // 2026-06-13 [Phase 56-03 AC #1]: h-8 -> h-12 to fit the new
        // timestamp scale row (h-4) above the existing tick row (h-6)
        // with 2px breathing room. Phase 55 UI-SPEC §7 surface change —
        // visual diff captured by Plan 04's Playwright spec.
        className="h-12 border-t border-border bg-card flex items-center px-2 gap-2"
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
        {/*
          2026-06-13 [Phase 56-03 AC #1]: wrapper splits the strip into a
          scale row (top, h-4) + tick row (bottom, h-6) stacked via
          flex-col. The tick row keeps its h-6 + relative positioning so
          pctOfWindow math stays correct verbatim.
        */}
        <div className="flex-1 flex flex-col">
          <div className="relative h-4 text-[10px] text-muted-foreground">
            {scaleTicks.map(({ pct, label }) => (
              <span
                key={`scale-${pct.toFixed(2)}`}
                data-testid={`lsl-scale-label-${pct.toFixed(0)}`}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${pct}%` }}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="relative h-6">
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
              // 2026-06-13 (Phase 56-04 continuation 2 fix #D): the
              // direct-click ring is keyed on the LOCAL `clickedTickKey`
              // composite (id + startAt) — NOT on `selectedSessionId
              // === s.id`. The previous predicate rang EVERY tranche of
              // the same session id; the LSL data is sliced into many
              // `LslSession` objects sharing `id` but distinct `startAt`,
              // so a single click lit up every sibling tranche. With the
              // composite key, only THE clicked bucket rings.
              //
              // Graph→timeline cascade (isSelectedBucket via timestamp
              // range match) continues to handle the case where a node
              // selection drives the ring without a direct tick click.
              const tickKey = `${s.id}|${s.startAt}`
              const isClickedTick = clickedTickKey === tickKey
              const isSelected = isSelectedBucket || isClickedTick
              const ringClass = isSelected
                ? 'ring-2 ring-blue-500'
                : (isRunning && selectedTs === null && clickedTickKey === null)
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
      </div>
    </TooltipProvider>
  )
}
