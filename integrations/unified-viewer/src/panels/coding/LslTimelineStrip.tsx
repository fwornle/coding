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
// 2026-06-13 (state-flow audit `b29bdb34c` §6.1 / §6.5 / §6.3 / §7 R4):
// `useState` is retained ONLY for the legitimate UI-window toggle (Audit
// §2.5 V1 was deleted in this round). Selection state is now read directly
// from the store via subscriptions; the tick-ring predicate derives the
// composite (sessionId, startAt) bucket key from the store.
//
// 2026-06-13 (Phase 56.1 Plan 05): the inline TanStack Query for LSL
// sessions is extracted to `./useLslSessions`. Both the strip AND the
// reverse-lookup pre-index hook (`useNodeToBucketsIndex`) consume the
// extracted module, so any future query-shape change lives in one place.
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
//
// 2026-06-13 (Phase 56.1 Plan 05 — D-2 forward direction): `pickAllResolvable`
// computes the FULL set of resolved ancestors for the clicked bucket — the
// multi-set selection halo. `pickFirstResolvable` still picks the focal node
// id (insertion-order "first" matches Phase 56 single-selection behavior).
// Locked in 56.1-PATTERNS.md Contract #7 — the canonical forward-direction
// callsite of `pickAllResolvable`.
import {
  computeAncestryPath,
  pickAllResolvable,
  pickFirstResolvable,
} from '@/graph/ancestry'
import { useVisibleEntityIds } from '@/graph/useVisibleEntityIds'
import { useLslSessions, WINDOW_MS, type LslSession, type LslWindow } from './useLslSessions'

// Re-export the extracted types so callers/tests that imported them from
// this file continue to compile without code change.
export type { LslSession, LslWindow } from './useLslSessions'

// 2026-06-12: ESC reset fallback — 7d gives a useful spread of sessions
// without being so zoomed-in that only the running tick is visible.
// (Initial UX used '24h' but the user reported it felt "majorly zoomed".)
const LATEST_WINDOW: LslWindow = '7d'

interface LslTimelineStripProps {
  system: 'coding' | 'okb'
  apiClient: ApiClient
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
  const clearLslSessionFilter = useViewerStore((s) => s.clearLslSessionFilter)
  const setSelection = useViewerStore((s) => s.setSelection)
  // 2026-06-13 (Phase 56.1 Plan 05): the strip drives the FOCAL entity via
  // `focalNodeId` (Phase 56's `selectedNodeId` is gone — Plan 01 removed it).
  // `focalNodeId` is the entity the `selectedTs` memo maps back to a tick
  // range so the graph→tick highlight cascade still works.
  const focalNodeId = useViewerStore((s) => s.focalNodeId)
  // 2026-06-13 (Phase 56.1 Plan 05 — D-4 timeline two-tier): subscribe to the
  // multi-set bucket fields. `selectedBucketKeys` drives the halo (lighter
  // blue) on every NON-focal tick in the set; `focalBucketKey` drives the
  // focal ring (existing ring-blue-500). The Phase 56 single-selection
  // (selectedSessionId, selectedSessionStartAt) fields are GONE — Plan 01
  // promoted them to the composite-key multi-set.
  const selectedBucketKeys = useViewerStore((s) => s.selectedBucketKeys)
  const focalBucketKey = useViewerStore((s) => s.focalBucketKey)
  // 2026-06-13 (Phase 56.1 Plan 05 — WR-03 fix): subscribe to
  // `selectedClasses` so `onTickClick` can gate on `.size > 0`. The 1-render
  // race window between data load and the auto-seed of `selectedClasses`
  // (Phase 56 WR-03) used to let tick clicks enter sidebar-only mode with
  // an empty class filter; the gate closes the race by no-op'ing the click
  // until the class set is seeded.
  const selectedClasses = useViewerStore((s) => s.selectedClasses)
  const stripRef = useRef<HTMLDivElement | null>(null)
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
  // 2026-06-13 (Phase 56-04 round 4 — phantom-id resolution): the SAME
  // visible-entity-id set the D3 graph renders. `onTickClick` walks the
  // bucket's entityIds and resolves each one to its closest graph-visible
  // ancestor before writing `selectedNodeId`. Without this, a bucket
  // whose first entity is a Detail (filtered out of the graph) wrote a
  // phantom id — the round-4 operator-reported bug. The hook returns a
  // Set<string> that's reference-stable across renders with identical
  // content, so subscribing here doesn't introduce a spurious re-render
  // cascade. See `useVisibleEntityIds.ts` for the predicate sharing
  // rationale.
  const visibleIds = useVisibleEntityIds(apiClient, system)
  // 2026-06-12: range-match — slice-by-hour was unreliable because LSL
  // file times (UTC after parser) don't align with entity createdAt
  // UTC hour boundaries. We now expose the selected entity's createdAt
  // as a numeric timestamp; the tick render compares each session's
  // [startAt, endAt) range to it.
  const selectedTs = useMemo<number | null>(() => {
    // 2026-06-13 (Phase 56.1 Plan 05): map the FOCAL entity (Phase 56's
    // single-selection `selectedNodeId` is gone — Plan 01 promoted it to
    // multi-set with a derived focal). The graph→tick highlight cascade
    // is semantically tied to the focal entity, not every halo member.
    if (!focalNodeId) return null
    const ent = entities.find((e) => e.id === focalNodeId)
    const created = (ent?.createdAt as string | undefined)
      ?? ((ent?.metadata as { createdAt?: string } | undefined)?.createdAt)
    if (typeof created !== 'string') return null
    const t = Date.parse(created)
    return Number.isFinite(t) ? t : null
  }, [focalNodeId, entities])

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
      // entities even though no node is selected anymore.
      // 2026-06-13 (audit §6.3 + §7 R4): route through the canonical
      // `clearLslSessionFilter` action so the strip writes nothing via
      // direct `setState` — the source-of-truth rule.
      const current = useViewerStore.getState()
      if (current.lslFilterEntityIds !== null || current.lslSessionFilter.length > 0) {
        clearLslSessionFilter()
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

  // 2026-06-13 (Phase 56.1 Plan 05): the inline useQuery is extracted to
  // `useLslSessions` so the reverse-lookup pre-index hook can share the
  // cache entry without duplicating the queryKey/queryFn surface.
  const { data } = useLslSessions(apiClient, windowKey)

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
    // 2026-06-13 (Phase 56.1 Plan 05 — WR-03 closure): selectedClasses is
    // auto-seeded by an upstream effect on first data load. There is a
    // 1-render race window where a tick click before the seed lands enters
    // sidebar-only mode with no class filter, mis-classifying the bucket.
    // Early-exit the handler with a Logger.warn until the seed fires — the
    // user's click is effectively ignored, but the alternative (incorrect
    // selection state) is worse. CONTEXT.md prior_decisions WR-03.
    if (selectedClasses.size === 0) {
      Logger.warn(
        Logger.Categories.PANELS,
        'LslTimelineStrip tick click blocked: selectedClasses not yet seeded (WR-03 race)',
      )
      return
    }
    // 2026-06-13 (audit §5.4 option B / D-7 contract-4 preserved verbatim):
    // 0-obs ticks are visually greyed out with `pointer-events-none`, but
    // synthetic React events (fireEvent.click in jsdom; programmatic
    // .click() in real browsers) bypass CSS pointer-events. Belt-and-
    // braces — early-exit the handler when the bucket has no observations
    // to record a click against. Phase 56 Locked Contract #4 carries
    // forward unchanged into Phase 56.1.
    if (session && session.observationCount === 0) {
      return
    }
    const ids = session?.entityIds ?? []
    const startAt = session?.startAt ?? null
    // 2026-06-13 (Phase 56.1 Plan 05 — D-2 forward direction + D-4 timeline):
    // every tick-click selection write routes through `setSelection`
    // (audit Locked Contract #5 carries forward — single source of truth).
    // The new multi-set arg shape:
    //   nodeIds:    Set of pickAllResolvable(...) — the halo
    //   bucketKeys: Set containing the clicked bucket's composite key
    //   focal:      { nodeId: pickFirstResolvable(...), bucketKey }
    // The reference-stability guard for `lslFilterEntityIds` (and now also
    // `selectedNodeIds`/`selectedBucketKeys`) lives inside the action body —
    // identical-content writes preserve the existing Set reference so D3's
    // `visibleEntities` useMemo does not invalidate (audit-locked contract).
    if (ids.length === 0) {
      // 2026-06-13 (audit §4.3 + §6.7 viewport-stability): when entityIds=[]
      // the broader cascade has no meaningful payload. Write only the
      // session-scope identity (the bucket key + focal bucket), preserve
      // every other store field. `setSelection` preserves omitted args.
      const bucketKey = startAt !== null ? `${sessionId}|${startAt}` : null
      setSelection({
        bucketKeys: bucketKey !== null ? new Set<string>([bucketKey]) : new Set<string>(),
        focal: { bucketKey },
        source: 'timeline',
        // nodeIds / pathToSelected / lslFilterEntityIds / highlightedRowKey /
        // lslSessionFilter intentionally OMITTED — `setSelection` preserves
        // the existing values when args are absent.
      })
      Logger.info(
        Logger.Categories.PANELS,
        `LslTimelineStrip tick (empty session) → ${sessionId} (bucketKey only — no D3 re-render)`,
      )
      return
    }
    // 2026-06-13 (Phase 56.1 Plan 05 — D-2 forward direction): pre-resolve
    // the bucket's entityIds to the FULL Set of graph-visible ancestors
    // (the halo). `pickAllResolvable` is one of the two canonical callsites
    // (the other is `useNodeToBucketsIndex` reverse pre-index) per Locked
    // Contract #7. The focal is the FIRST resolvable id — keeps Phase 56
    // single-selection behavior intact when only one entity resolves; for
    // a fresh write this is also the "last added" element of resolvedNodeIds
    // (insertion order matches iteration order). Sidebar-only mode fires
    // when no id resolves (resolvedNodeIds.size === 0 → focal = null).
    const resolvedNodeIds = pickAllResolvable(ids, visibleIds, relations)
    const focalNodeIdNext = pickFirstResolvable(ids, visibleIds, relations)
    const bucketKey = startAt !== null ? `${sessionId}|${startAt}` : null
    // 2026-06-13 (Phase 56-04 fix #3 + round 4 — provenance preserved):
    // compute the ancestry-path against the FOCAL id so the central-trace
    // line renders. Add the raw bucket ids to pathToSelected for cross-pane
    // provenance (sigma's trace renderer reads this; D3 skips ids with no
    // `.node` mount). Empty path in sidebar-only mode.
    const path = focalNodeIdNext !== null
      ? computeAncestryPath(focalNodeIdNext, relations)
      : null
    const pathToSelected: Set<string> = path !== null
      ? new Set<string>(path.nodeDepths.keys())
      : new Set<string>()
    if (focalNodeIdNext !== null) {
      for (const rawId of ids) pathToSelected.add(rawId)
    }
    if (e.metaKey || e.ctrlKey) {
      // 2026-06-12 + 2026-06-13 (Phase 56.1 Plan 05 — additive multi-set):
      // Cmd/Ctrl click UNIONs the bucket's entityIds with the existing LSL
      // filter set AND UNIONs the bucket key into selectedBucketKeys AND
      // UNIONs the resolved ancestors into selectedNodeIds. Lets the user
      // assemble multi-session selections (e.g. "show everything from
      // yesterday's three working sessions"). Phase 56 additive behavior
      // preserved verbatim, extended to the new multi-set fields.
      const prevState = useViewerStore.getState()
      const prevSet = prevState.lslFilterEntityIds
      const union = new Set<string>(prevSet ?? [])
      for (const id of ids) union.add(id)
      const nextSessionFilter = Array.from(
        new Set<string>([...prevState.lslSessionFilter, sessionId]),
      )
      const nextNodeIds = new Set<string>(prevState.selectedNodeIds)
      for (const id of resolvedNodeIds) nextNodeIds.add(id)
      const nextBucketKeys = new Set<string>(prevState.selectedBucketKeys)
      if (bucketKey !== null) nextBucketKeys.add(bucketKey)
      setSelection({
        nodeIds: nextNodeIds,
        bucketKeys: nextBucketKeys,
        focal: { nodeId: focalNodeIdNext, bucketKey },
        // Sidebar highlight follows the focal so the row text agrees with
        // the graph red ring. Cross-pane provenance flows through
        // `lslFilterEntityIds` (raw bucket ids).
        highlightedRowKey: focalNodeIdNext,
        source: 'timeline',
        pathToSelected,
        lslSessionFilter: nextSessionFilter,
        // `setSelection` reference-guards this — if `union` has identical
        // membership to prevSet, the existing reference is preserved and
        // D3's `visibleEntities` useMemo does not invalidate.
        lslFilterEntityIds: union,
      })
      Logger.info(
        Logger.Categories.PANELS,
        `LslTimelineStrip tick added: ${sessionId} (halo:${resolvedNodeIds.size}, total:${nextNodeIds.size}, buckets:${nextBucketKeys.size}, bucketKey:${bucketKey ?? 'null'})`,
      )
      return
    }
    // Plain click — REPLACE both selections (halo + bucket halo) with this
    // session's resolved set + single bucket key. The audit-locked deep-
    // equal guards inside `setSelection` preserve Set references on
    // identical-content writes — viewport-stability invariant preserved
    // through the multi-set evolution.
    setSelection({
      nodeIds: resolvedNodeIds,
      bucketKeys: bucketKey !== null ? new Set<string>([bucketKey]) : new Set<string>(),
      focal: { nodeId: focalNodeIdNext, bucketKey },
      highlightedRowKey: focalNodeIdNext,
      source: 'timeline',
      pathToSelected,
      lslSessionFilter: [sessionId],
      lslFilterEntityIds: new Set<string>(ids),
    })
    Logger.info(
      Logger.Categories.PANELS,
      `LslTimelineStrip tick → halo:${resolvedNodeIds.size} ids, focal:${focalNodeIdNext ?? 'sidebar-only'}, bucketKey:${bucketKey ?? 'null'}`,
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
              // 2026-06-13 (Phase 56.1 Plan 05 — D-4 two-tier timeline):
              // pure store-derived bucket render predicate from the multi-set
              // selectedBucketKeys + focal singleton focalBucketKey. The
              // Phase 56 single-selection (selectedSessionId,
              // selectedSessionStartAt) is gone — Plan 01 deleted both fields.
              //   - isFocalBucket: focalBucketKey === tickKey   → ring-blue-500 (existing focal)
              //   - isHaloBucket:  selectedBucketKeys.has(tickKey) && !isFocalBucket
              //                                                  → ring-blue-300/60 + bg-blue-200/40
              // The `isSelectedBucket` fallback (entity.createdAt range over
              // bucket [startAt, endAt)) is preserved — it's the reverse
              // cascade (graph node selected → tick rings via timestamp range).
              const tickKey = `${s.id}|${s.startAt}`
              const isFocalBucket = focalBucketKey === tickKey
              const isHaloBucket = selectedBucketKeys.has(tickKey) && !isFocalBucket
              const isSelected = isFocalBucket || isSelectedBucket
              // 2026-06-13 (audit §5.4 option B / D-7 contract-4): 0-obs
              // ticks render greyed out + pointer-events-none so the operator
              // can still see "I had a session here" but cannot select an
              // empty bucket. The disabled visual state ALSO suppresses the
              // running-ring (a 0-obs running session is anomalous; the
              // visual policy chooses clarity over signalling that edge
              // case). Phase 56 Locked Contract #4 carries forward verbatim.
              const isDisabled = s.observationCount === 0
              const ringClass = isDisabled
                ? ''
                : isFocalBucket
                  ? 'ring-2 ring-blue-500'
                  : isHaloBucket
                    ? 'ring-2 ring-blue-300/60'
                    : isSelected
                      ? 'ring-2 ring-blue-500'
                      : (isRunning && selectedTs === null && focalBucketKey === null && selectedBucketKeys.size === 0)
                        ? 'ring-2 ring-primary'
                        : ''
              const fillClass = isHaloBucket
                ? 'bg-blue-200/40 hover:bg-blue-300/50'
                : 'bg-pink-300 hover:bg-pink-400'
              // 2026-06-13 (audit §5.4 option B): grey-out classes are
              // additive — opacity-40 dims the pink fill + pointer-events-
              // none kills click reactivity + cursor-default removes the
              // hover affordance. ARIA hint provides keyboard parity.
              const disabledClass = isDisabled
                ? 'opacity-40 pointer-events-none cursor-default'
                : ''
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
                      className={`absolute w-2 h-6 ${fillClass} rounded-sm ${ringClass} ${disabledClass}`.trim()}
                      aria-disabled={isDisabled || undefined}
                      aria-label={`LSL session ${s.id.slice(0, 8)} ${s.endAt === null ? '(running)' : ''}${isDisabled ? ' (no observations)' : ''}`}
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
