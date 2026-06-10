// PATTERN SOURCE: 55-PATTERNS.md § EtmTailSheet.tsx (SSE pattern with backoff
//   + Sheet pattern) + 55-UI-SPEC.md §13.3 (ETM Live Tail Sheet UX) + §15 (aria-live)
//   + 55-12-PLAN.md Task 1 (full behavior contract)
//
// Surface #15 — coding-only ETM Live Tail Sheet.
//
// CONSUMES:
//   /api/coding/observations/stream — SSE shipped by Plan 55-06 (ObservationWriter
//   event-bus fanned out via res.write(`data: <json>\n\n`)).
//
// SSE LIFECYCLE:
//   onopen   → setEtmStreamConnected(true), reset attempt counter
//   onmessage→ JSON.parse → batched-flush into pushObservation (Zustand ring buffer max 100)
//   onerror  → setEtmStreamConnected(false), sse.close(), schedule reconnect
//             with exponential backoff 1s,2s,4s,8s,16s capped
//   unmount  → sse.close()
//
// BURST DEBOUNCE (UI-SPEC §13.3 perf carve-out):
//   Accumulate inbound observations in a ref; every flush burst is bounded
//   by setTimeout(flush, 250ms) — single message bypasses the debounce
//   so the normal case is zero-overhead. Bursts >10/sec coalesce into the
//   next 250ms tick.
//
// AGENT COLOR MAP (UI-SPEC §13.3):
//   claude   → text-violet-500
//   copilot  → text-blue-500
//   opencode → text-teal-500
//   mastra   → text-amber-500
//
// KEYBOARD `t` (UI-SPEC §10):
//   Document-level keydown handler toggles etmSheetOpen. Skipped when
//   <input>/<textarea>/contenteditable has focus.
//
// LOGGER DISCIPLINE:
//   ZERO raw console.* per feedback_logger_class.md.
//   (Phase 55 Plan 07 / Plan 11 established Logger.Categories.API for
//   network-state changes — no NETWORK category exists in the unified-viewer's
//   logging config; the plan's NETWORK reference is mapped to API to align
//   with the established convention. See SUMMARY.md deviations.)

import { useEffect, useMemo, useRef } from 'react'
import { Radio } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Logger } from '@/lib/logging'
import { useViewerStore } from '@/store/viewer-store'
import type { ApiClient } from '@/api/ApiClient'
import type { Observation } from '@/api/schemas'

const AGENT_COLOR: Record<string, string> = {
  claude: 'text-violet-500',
  copilot: 'text-blue-500',
  opencode: 'text-teal-500',
  mastra: 'text-amber-500',
}
const DEFAULT_AGENT_COLOR = 'text-muted-foreground'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const
const MAX_BACKOFF_MS = 16000
const BURST_FLUSH_MS = 250
const SUMMARY_TRUNCATE_CHARS = 80

/**
 * Compute the next reconnect delay using exponential backoff capped at 16s.
 * Exposed as a pure helper so the backoff schedule is asserted directly
 * (same pattern as Plan 55-07 StatsBar's backoffDelay export).
 */
export function reconnectDelay(attempt: number): number {
  if (attempt < 0) return RECONNECT_DELAYS_MS[0]
  if (attempt >= RECONNECT_DELAYS_MS.length) return MAX_BACKOFF_MS
  return RECONNECT_DELAYS_MS[attempt]
}

function truncateSummary(text: string): string {
  if (text.length <= SUMMARY_TRUNCATE_CHARS) return text
  return text.slice(0, SUMMARY_TRUNCATE_CHARS - 1) + '…'
}

function formatTimestamp(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Render HH:MM:SS in tabular-nums for stable row width.
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

interface EtmTailSheetProps {
  system: 'coding' | 'okb'
  apiClient: ApiClient
}

/**
 * Coding-only SSE-consuming Live Tail Sheet.
 *
 * Defense-in-depth gating: component-level `system === 'coding'` AND the
 * UnifiedViewer mount line additionally gates on `system === 'coding'`.
 */
export default function EtmTailSheet({ system, apiClient }: EtmTailSheetProps) {
  if (system !== 'coding') return null

  const etmSheetOpen = useViewerStore((s) => s.etmSheetOpen)
  const setEtmSheetOpen = useViewerStore((s) => s.setEtmSheetOpen)
  const etmStreamConnected = useViewerStore((s) => s.etmStreamConnected)
  const etmObservations = useViewerStore((s) => s.etmObservations)

  // --- SSE consumer with exponential-backoff reconnect ----------------------
  const sseRef = useRef<EventSource | null>(null)
  const attemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingObsRef = useRef<Observation[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Use the canonical getState() accessor for setters so the effect body
    // does not re-run when an unrelated slice changes.
    const store = useViewerStore.getState

    function flushPending(): void {
      const items = pendingObsRef.current
      pendingObsRef.current = []
      flushTimerRef.current = null
      if (items.length === 0) return
      const push = store().pushObservation
      for (const obs of items) {
        push(obs)
      }
    }

    function scheduleFlush(): void {
      if (flushTimerRef.current !== null) return
      flushTimerRef.current = setTimeout(flushPending, BURST_FLUSH_MS)
    }

    function connect(): void {
      const url = `${apiClient.base}/api/coding/observations/stream`
      const sse = new EventSource(url)
      sseRef.current = sse

      sse.onopen = () => {
        attemptRef.current = 0
        store().setEtmStreamConnected(true)
        Logger.info(Logger.Categories.API, `EtmTailSheet SSE connection opened: ${url}`)
      }

      sse.onmessage = (event: MessageEvent) => {
        let obs: Observation | null = null
        try {
          obs = JSON.parse(event.data) as Observation
        } catch {
          // Swallow per UI-SPEC §13.3 — malformed frames are operational noise,
          // not crashes (T-55-12-02 mitigation).
          return
        }
        if (!obs || typeof obs.id !== 'string') return
        pendingObsRef.current.push(obs)
        if (pendingObsRef.current.length >= 2) {
          // Real burst — debounce into the next 250ms tick.
          scheduleFlush()
        } else {
          // Single message: flush asynchronously but with no debounce delay
          // so the common case has minimal lag.
          if (flushTimerRef.current === null) {
            flushTimerRef.current = setTimeout(flushPending, 0)
          }
        }
      }

      sse.onerror = () => {
        store().setEtmStreamConnected(false)
        try {
          sse.close()
        } catch {
          // ignore — already closed
        }
        const delay = reconnectDelay(attemptRef.current)
        attemptRef.current++
        Logger.warn(
          Logger.Categories.API,
          `EtmTailSheet SSE error — reconnect in ${delay}ms (attempt ${attemptRef.current})`,
        )
        if (reconnectTimerRef.current !== null) {
          clearTimeout(reconnectTimerRef.current)
        }
        reconnectTimerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      const sse = sseRef.current
      sseRef.current = null
      if (sse) {
        try {
          sse.close()
        } catch {
          // ignore — already closed
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClient])

  // --- Keyboard `t` toggle (UI-SPEC §10) -------------------------------------
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 't' && event.key !== 'T') return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const open = useViewerStore.getState().etmSheetOpen
      useViewerStore.getState().setEtmSheetOpen(!open)
      Logger.debug(
        Logger.Categories.PANELS,
        `EtmTailSheet keyboard toggle → ${!open ? 'open' : 'closed'}`,
      )
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // --- Click handler — referencedEntities[0] → setSelectedNode ---------------
  const setSelectedNode = useViewerStore((s) => s.setSelectedNode)
  const onRowClick = useMemo(
    () => (obs: Observation) => {
      const refs = (obs as { referencedEntities?: unknown }).referencedEntities
      if (Array.isArray(refs) && refs.length > 0 && typeof refs[0] === 'string') {
        setSelectedNode(refs[0])
        Logger.info(Logger.Categories.PANELS, `EtmTailSheet row → ${refs[0]}`)
        // Small-screen close per UI-SPEC §13.3: dismiss after navigation so
        // the user can see the canvas under the sheet.
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          useViewerStore.getState().setEtmSheetOpen(false)
        }
      }
    },
    [setSelectedNode],
  )

  // --- Live indicator dot classes -------------------------------------------
  const dotClass = etmStreamConnected
    ? 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse'
    : 'w-2 h-2 rounded-full bg-muted-foreground'
  const dotLabel = etmStreamConnected ? 'LIVE' : 'Connecting…'

  return (
    <Sheet open={etmSheetOpen} onOpenChange={setEtmSheetOpen}>
      <SheetContent
        side="right"
        className="w-96 sm:w-[480px] flex flex-col gap-0 p-0"
        data-testid="etm-tail-sheet"
      >
        <SheetHeader className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" aria-hidden="true" />
            <span>ETM Live Tail</span>
            <span
              data-testid="etm-live-indicator-dot"
              className={dotClass}
              aria-label={dotLabel}
            />
            <span className="text-xs text-muted-foreground ml-1 tabular-nums">{dotLabel}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Streaming observations from the ETM observation writer.
          </SheetDescription>
        </SheetHeader>
        <div
          data-testid="etm-observations-body"
          aria-live="polite"
          aria-atomic="false"
          className="flex-1 overflow-y-auto px-3 py-2"
        >
          {etmObservations.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-2 py-3">
              No observations received yet.
            </div>
          ) : (
            etmObservations.map((obs) => {
              const agentClass = AGENT_COLOR[obs.agent] ?? DEFAULT_AGENT_COLOR
              return (
                <button
                  key={obs.id}
                  type="button"
                  data-testid={`etm-row-${obs.id}`}
                  onClick={() => onRowClick(obs)}
                  className="w-full text-left flex items-center gap-2 px-1 py-1.5 hover:bg-accent rounded-sm transition-colors"
                >
                  <span
                    data-testid={`etm-row-${obs.id}-timestamp`}
                    className="tabular-nums text-[10px] text-muted-foreground shrink-0"
                  >
                    {formatTimestamp(obs.timestamp)}
                  </span>
                  <span
                    data-testid={`etm-row-${obs.id}-agent`}
                    className={`text-[10px] uppercase tracking-wide shrink-0 ${agentClass}`}
                  >
                    {obs.agent}
                  </span>
                  <span
                    data-testid={`etm-row-${obs.id}-summary`}
                    className="text-xs text-foreground/90 truncate"
                  >
                    {truncateSummary(obs.content ?? '')}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
