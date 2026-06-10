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

export type LslWindow = '24h' | '7d' | '30d'

const WINDOW_MS: Record<LslWindow, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
}

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

function pctOfWindow(iso: string, windowMs: number): number {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return 0
  const age = Date.now() - ts
  const pct = (1 - age / windowMs) * 100
  return Math.max(0, Math.min(100, pct))
}

function formatTooltipText(s: LslSession): string {
  const idShort = s.id.slice(0, 8)
  const end = s.endAt ?? 'running'
  return `${idShort} · ${s.startAt} → ${end} · ${s.observationCount} obs · ${s.entityIds.length} entities`
}

export default function LslTimelineStrip({ system, apiClient }: LslTimelineStripProps) {
  // Defense-in-depth gate.
  if (system !== 'coding') return null

  const [windowKey, setWindowKey] = useState<LslWindow>('7d')
  const setLslSessionFilter = useViewerStore((s) => s.setLslSessionFilter)
  const addLslSessionFilter = useViewerStore((s) => s.addLslSessionFilter)
  const clearLslSessionFilter = useViewerStore((s) => s.clearLslSessionFilter)
  const stripRef = useRef<HTMLDivElement | null>(null)

  const { data } = useQuery({
    queryKey: ['lsl-sessions', apiClient.base, windowKey],
    queryFn: () => fetchSessions(apiClient, WINDOW_MS[windowKey]),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const sessions: LslSession[] = useMemo(() => {
    const arr = data ?? []
    return [...arr].sort((a, b) => a.startAt.localeCompare(b.startAt))
  }, [data])

  function onWindowChange(next: string) {
    if (next === '24h' || next === '7d' || next === '30d') {
      setWindowKey(next)
      Logger.info(Logger.Categories.PANELS, `LslTimelineStrip window → ${next}`)
    }
  }

  function onTickClick(e: React.MouseEvent<HTMLButtonElement>, sessionId: string) {
    if (e.metaKey || e.ctrlKey) {
      addLslSessionFilter(sessionId)
      Logger.info(Logger.Categories.PANELS, `LslTimelineStrip tick added: ${sessionId}`)
    } else {
      setLslSessionFilter([sessionId])
      Logger.info(Logger.Categories.PANELS, `LslTimelineStrip tick selected: ${sessionId}`)
    }
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
              const left = pctOfWindow(s.startAt, WINDOW_MS[windowKey])
              const ringClass = s.endAt === null ? 'ring-2 ring-primary' : ''
              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      tabIndex={0}
                      data-testid={`lsl-tick-${s.id}`}
                      data-session-id={s.id}
                      onClick={(e) => onTickClick(e, s.id)}
                      style={{ left: `${left}%` }}
                      className={`absolute w-2 h-6 bg-blue-400 hover:bg-blue-500 rounded-sm ${ringClass}`}
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
