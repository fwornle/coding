import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchRuns,
  fetchTimeline,
  fetchContextTurns,
  fetchReconciliation,
  selectRuns,
  selectTimelineFor,
  selectContextTurnsFor,
  selectReconciliationFor,
  openTurnModal,
  closeTurnModal,
  selectModalTurn,
  type Run,
} from '@/store/slices/performanceSlice'
import { normalizeModel } from './models'
import { loopFlags } from './loop-heuristic'
import { TurnRow } from './turn-row'
import { TurnModal } from './turn-modal'
import { ContextBand, ContextBandLegend } from './context-band'

// ---------------------------------------------------------------------------
// TimelineFullscreen (Phase 86 — Timeline v2, D-02)
// ---------------------------------------------------------------------------
// The routed whole-run view (/performance/timeline/:taskId). Distinct PURPOSE
// from the modal (whole run vs one turn — UI-SPEC §3): more turns visible at
// once, the CUMULATIVE context-growth band (not the mini), keyboard nav
// (↑/↓ move turn focus, Enter opens the modal, Esc/back exits).
//
// The run title reads `run.canonical_model` VERBATIM (ATTR-02 regression
// anchor) — null → italic "unmeasured", NEVER a recomputed dominant fallback.
// The reconciliation note (D-12) is served verbatim from the slice, never
// recomputed client-side.

export function TimelineFullscreen() {
  const { taskId = '' } = useParams<{ taskId: string }>()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  const runs = useAppSelector(selectRuns)
  const rows = useAppSelector(selectTimelineFor(taskId))
  const contextTurns = useAppSelector(selectContextTurnsFor(taskId))
  const reconciliation = useAppSelector(selectReconciliationFor(taskId))
  const { open: modalOpen } = useAppSelector(selectModalTurn)

  const run: Run | null = runs.find((r) => r.task_id === taskId) ?? null
  const captureRawBodies = !!(run && (run as Record<string, unknown>).capture_raw_bodies === true)

  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (runs.length === 0) dispatch(fetchRuns())
    if (taskId) {
      dispatch(fetchTimeline(taskId))
      dispatch(fetchContextTurns(taskId))
      dispatch(fetchReconciliation(taskId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const flags = contextTurns.length > 0 ? loopFlags(contextTurns) : []

  // Keyboard nav (UI-SPEC §3): ↑/↓ move focus between rows, Enter opens the
  // focused turn's modal, Esc exits back to the runs view. Focus is driven off
  // the DOM row order so it stays in sync with the rendered list.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (modalOpen) return // let the modal own the keyboard while it's open
    const container = listRef.current
    if (!container) return
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="timeline-row"]'))
    if (items.length === 0) return
    const activeIdx = items.findIndex((el) => el === document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[Math.min(items.length - 1, activeIdx + 1)] ?? items[0]
      next.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = items[Math.max(0, activeIdx - 1)] ?? items[0]
      prev.focus()
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0) {
        e.preventDefault()
        dispatch(openTurnModal({ taskId, index: activeIdx }))
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      dispatch(closeTurnModal())
      navigate('/performance')
    }
  }

  const backToPerformance = () => navigate('/performance')

  return (
    <div
      className="min-h-screen w-full p-6 focus:outline-none"
      data-testid="timeline-fullscreen"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* Header: back affordance + run title (canonical model VERBATIM). */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={backToPerformance}
          aria-label="Back to performance"
          data-testid="fullscreen-back"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="fullscreen-title">
            {run?.goal_sentence?.trim() || 'Run timeline'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground" data-testid="fullscreen-canonical-model">
            Chat model:{' '}
            {run?.canonical_model
              ? <span className="font-mono">{normalizeModel(run.canonical_model)}</span>
              : <span className="italic">unmeasured</span>}
          </p>
        </div>
      </div>

      {/* Reconciliation note (D-12) — verbatim counts, never client-recomputed. */}
      {reconciliation && (
        <p className="mb-3 text-xs text-muted-foreground" data-testid="fullscreen-reconciliation">
          Reconciliation: {reconciliation.matched} matched · {reconciliation.unmatched_wire} unmatched (wire) ·{' '}
          {reconciliation.unmatched_transcript} unmatched (transcript) · {reconciliation.fallback} fallback ·{' '}
          {reconciliation.flaggedCount} flagged
        </p>
      )}

      {/* Cumulative context-growth band for the whole run + legend. */}
      {contextTurns.length > 0 && (
        <div className="mb-4 rounded-md border p-3">
          <p className="mb-1 text-sm font-medium">Cumulative context growth</p>
          <ContextBand variant="cumulative" turns={contextTurns} />
          <ContextBandLegend className="mt-2" />
        </div>
      )}

      {/* The whole-run v2 turn list. */}
      {contextTurns.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="fullscreen-no-context-note">
          no per-turn context captured
        </p>
      ) : (
        <div ref={listRef} className="space-y-2" data-testid="fullscreen-turn-list">
          {contextTurns.map((turn, i) => (
            <TurnRow
              key={turn.request_id ?? i}
              taskId={taskId}
              index={i}
              turn={turn}
              loopFlag={flags[i] ?? false}
            />
          ))}
        </div>
      )}

      {rows.length === 0 && contextTurns.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No per-turn telemetry recorded for this run.</p>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Keyboard: ↑/↓ move focus between turns, Enter opens a turn, Esc returns to the runs view.
      </p>

      {/* Modal reused verbatim — drives off the same slice open-state. */}
      <TurnModal captureRawBodies={captureRawBodies} />
    </div>
  )
}
