// CellTerminalGrid — the live mini-terminal grid for an experiment run, with a
// hand-rolled FLIP click-to-zoom (no animation library installed by design).
//
// Zoom mechanics: clicking a tile measures its rect, portals a fixed-position clone at
// exactly that rect over a fading backdrop, then transitions transform/size to a
// near-fullscreen inset (320ms ease-out-quint). Esc / backdrop click reverses back to
// the (re-measured) tile rect before unmounting. prefers-reduced-motion → instant swap.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppDispatch } from '@/store'
import { setSelectedTaskId, type RunProgressCell } from '@/store/slices/performanceSlice'
import { Button } from '@/components/ui/button'
import { CellTerminal, isLiveCellState } from './cell-terminal'
import { useCellLogPoll } from './use-cell-log'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const DURATION_MS = 320
const INSET = 'max(24px, 4vh)'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// One tile: owns its cell's log poll so a cell only polls while it is live (or zoomed).
function CellTile({
  cell,
  runId,
  zoomed,
  onZoom,
}: {
  cell: RunProgressCell
  runId: string
  zoomed: boolean
  onZoom: (key: string, rect: DOMRect) => void
}) {
  const key = `${cell.variant}::${cell.rep}`
  const taskId = typeof cell.task_id === 'string' ? cell.task_id : null
  const live = isLiveCellState(String(cell.state))
  const log = useCellLogPoll(runId, taskId, live || zoomed)
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div
      ref={ref}
      className={`h-44 ${zoomed ? 'invisible' : ''}`}
      onClick={() => {
        if (ref.current) onZoom(key, ref.current.getBoundingClientRect())
      }}
    >
      <CellTerminal cell={cell} log={log} />
    </div>
  )
}

export function CellTerminalGrid({
  runId,
  cells,
  parallelMode,
}: {
  runId: string
  cells: RunProgressCell[]
  parallelMode?: boolean
}) {
  const dispatch = useAppDispatch()
  const [zoomKey, setZoomKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>('open')
  const originRect = useRef<DOMRect | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  const zoomedCell = cells.find((c) => `${c.variant}::${c.rep}` === zoomKey) ?? null
  const zoomedTaskId = typeof zoomedCell?.task_id === 'string' ? zoomedCell.task_id : null
  const zoomedLive = isLiveCellState(String(zoomedCell?.state))
  const zoomedLog = useCellLogPoll(zoomKey ? runId : null, zoomedTaskId, !!zoomKey && zoomedLive)

  const openZoom = useCallback((key: string, rect: DOMRect) => {
    originRect.current = rect
    setZoomKey(key)
    setPhase(prefersReducedMotion() ? 'open' : 'opening')
  }, [])

  const closeZoom = useCallback(() => {
    if (prefersReducedMotion()) {
      setZoomKey(null)
      return
    }
    setPhase('closing')
    window.setTimeout(() => setZoomKey(null), DURATION_MS)
  }, [])

  // FLIP: mount at the tile rect, force a reflow, then release to the fullscreen inset.
  useEffect(() => {
    if (phase !== 'opening' || !overlayRef.current) return
    const el = overlayRef.current
    void el.getBoundingClientRect() // commit the start frame
    requestAnimationFrame(() => setPhase('open'))
  }, [phase, zoomKey])

  // Esc closes.
  useEffect(() => {
    if (!zoomKey) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeZoom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomKey, closeZoom])

  const r = originRect.current
  const atOrigin = (phase === 'opening' || phase === 'closing') && r
  const overlayStyle: React.CSSProperties = atOrigin
    ? { top: r.top, left: r.left, width: r.width, height: r.height }
    : { top: INSET, left: INSET, width: `calc(100vw - 2 * ${INSET})`, height: `calc(100vh - 2 * ${INSET})` }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="cell-terminal-grid">
        {cells.map((cell) => (
          <CellTile
            key={`${cell.variant}::${cell.rep}`}
            cell={cell}
            runId={runId}
            zoomed={zoomKey === `${cell.variant}::${cell.rep}`}
            onZoom={openZoom}
          />
        ))}
      </div>

      {zoomKey &&
        zoomedCell &&
        createPortal(
          <div className="fixed inset-0 z-50" data-testid="cell-terminal-overlay">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
              style={{ opacity: phase === 'open' ? 1 : 0, transitionDuration: `${DURATION_MS}ms` }}
              onClick={closeZoom}
            />
            {/* The zooming terminal */}
            <div
              ref={overlayRef}
              className="absolute flex flex-col overflow-hidden rounded-xl shadow-2xl"
              style={{
                ...overlayStyle,
                transitionProperty: 'top, left, width, height',
                transitionDuration: `${DURATION_MS}ms`,
                transitionTimingFunction: EASE,
              }}
            >
              <div className="min-h-0 flex-1">
                <CellTerminal cell={zoomedCell} log={zoomedLog} expanded />
              </div>
              {phase === 'open' && (
                <div className="flex items-center gap-3 border-t border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                  <span className="max-w-[40%] truncate font-mono text-[10px] text-zinc-500" title={zoomedTaskId ?? ''}>
                    {zoomedTaskId ?? '—'}
                  </span>
                  {parallelMode && (
                    <span className="text-[10px] text-amber-400/90">
                      parallel run — background activity is shared across cells (not attributable to this cell)
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {zoomedTaskId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 text-[11px]"
                        onClick={() => {
                          dispatch(setSelectedTaskId(zoomedTaskId))
                          closeZoom()
                        }}
                      >
                        Show in timeline
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={closeZoom}>
                      Close (Esc)
                    </Button>
                  </span>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
