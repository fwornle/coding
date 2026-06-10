// PATTERN SOURCE: 55-PATTERNS.md § WorkflowStatusPanel.tsx (poll-with-stop +
//   render pattern) + 55-UI-SPEC.md §13.4 (Workflow Execution Status UX)
//   + 55-12-PLAN.md Task 2 (full behavior contract)
//
// Surface #16 — coding-only inline UKB-Ops workflow status panel.
//
// DATA SOURCE:
//   GET http://localhost:3033/api/ukb/status — Health API (NOT obs-api, NOT
//   the LLM proxy on :12435). This is the same endpoint the dashboard's
//   ukb-workflow-modal.tsx consumes; the panel shape is mirrored inline
//   to avoid coupling to the dashboard module.
//
// POLLING:
//   setInterval(5000) once mounted. When status === 'idle' for >5min, polling
//   is paused via the idleSinceRef sentinel; resumes on user click of the
//   trigger row (UI-SPEC §13.4 / 55-PATTERNS.md guidance).
//
// COLLAPSE/EXPAND BEHAVIOUR (UI-SPEC §13.4):
//   - h-10 trigger chip when collapsed
//   - <Collapsible> expanded → <Card> with per-step <Progress> bars
//   - Auto-expand on idle→running transition
//   - Auto-collapse 30s after status hits 'idle' (or 'completed')
//   - Failed step row: text-destructive + "Retry" anchor link to localhost:3032/ukb
//
// CLICK SEMANTICS:
//   Clicking a step row whose `referencedEntities` is non-empty calls
//   setSelectedNode(referencedEntities[0]).
//
// LOGGER DISCIPLINE:
//   ZERO raw console.*; polling errors and state transitions log via
//   Logger.warn(Logger.Categories.API, …) / Logger.info(Logger.Categories.PANELS, …).
//   (No NETWORK category exists in loggingConfig — see EtmTailSheet.tsx note.)

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Logger } from '@/lib/logging'
import { useViewerStore } from '@/store/viewer-store'

const HEALTH_API_BASE = 'http://localhost:3033'
const STATUS_PATH = '/api/ukb/status'
const POLL_INTERVAL_MS = 5000
const IDLE_SKIP_THRESHOLD_MS = 5 * 60_000
const AUTO_COLLAPSE_DELAY_MS = 30_000
const DASHBOARD_UKB_URL = 'http://localhost:3032/ukb'

type StepStatus = 'idle' | 'running' | 'done' | 'failed'
type WorkflowStatus = 'idle' | 'running' | 'completed' | 'failed'

interface StepDetail {
  name: string
  label: string
  status: StepStatus
  progressPercent: number
  referencedEntities?: string[]
}

interface WorkflowStatusPayload {
  status: WorkflowStatus
  workflowName?: string
  progressPercent?: number
  currentPhase?: string
  stepsDetail?: StepDetail[]
}

interface WorkflowStatusPanelProps {
  system: 'coding' | 'okb'
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-label="running" />
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-label="done" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="failed" />
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-label="idle" />
}

/**
 * Coding-only inline UKB-Ops workflow status panel.
 *
 * Defense-in-depth gating: component-level `system === 'coding'` AND the
 * UnifiedViewer mount line additionally gates on `system === 'coding'`.
 */
export default function WorkflowStatusPanel({ system }: WorkflowStatusPanelProps) {
  if (system !== 'coding') return null

  const [data, setData] = useState<WorkflowStatusPayload | null>(null)
  const [expanded, setExpanded] = useState(false)
  const idleSinceRef = useRef<number>(0)
  const prevStatusRef = useRef<WorkflowStatus | null>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setSelectedNode = useViewerStore((s) => s.setSelectedNode)

  // --- Polling effect --------------------------------------------------------
  useEffect(() => {
    let mounted = true

    async function fetchOnce(): Promise<void> {
      const url = `${HEALTH_API_BASE}${STATUS_PATH}`
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) {
          throw new Error(`${url} → HTTP ${res.status}`)
        }
        const json = (await res.json()) as WorkflowStatusPayload
        if (!mounted) return
        setData(json)
      } catch (err) {
        Logger.warn(
          Logger.Categories.API,
          `WorkflowStatusPanel poll failed: ${(err as Error).message}`,
        )
      }
    }

    void fetchOnce()
    const interval = setInterval(() => {
      // Skip polling when idle for >5min — resumed when the user clicks the
      // collapsed trigger (handled via setExpanded → onPokeRefresh below).
      const now = Date.now()
      if (
        idleSinceRef.current > 0 &&
        now - idleSinceRef.current > IDLE_SKIP_THRESHOLD_MS
      ) {
        return
      }
      void fetchOnce()
    }, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  // --- Idle-since tracking + auto-expand / auto-collapse logic --------------
  useEffect(() => {
    if (!data) return
    const now = Date.now()
    const prev = prevStatusRef.current
    const next = data.status

    if (next === 'idle') {
      if (idleSinceRef.current === 0) idleSinceRef.current = now
    } else {
      idleSinceRef.current = 0
    }

    // Auto-expand on idle→running transition (any non-running→running counts
    // because the user wants to see freshly-started work).
    if (next === 'running' && prev !== 'running') {
      setExpanded(true)
      if (collapseTimerRef.current !== null) {
        clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = null
      }
    }

    // Auto-collapse 30s after the workflow returns to a terminal state.
    if ((next === 'idle' || next === 'completed') && prev === 'running') {
      if (collapseTimerRef.current !== null) {
        clearTimeout(collapseTimerRef.current)
      }
      collapseTimerRef.current = setTimeout(() => {
        setExpanded(false)
        collapseTimerRef.current = null
      }, AUTO_COLLAPSE_DELAY_MS)
    }

    prevStatusRef.current = next
  }, [data])

  // Cleanup the collapse timer on unmount.
  useEffect(() => {
    return () => {
      if (collapseTimerRef.current !== null) {
        clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = null
      }
    }
  }, [])

  function onTriggerClick(): void {
    // Clicking the trigger resumes polling (resets idleSinceRef) regardless
    // of whether it was being skipped — the user has indicated they want to
    // see fresh data.
    idleSinceRef.current = 0
    Logger.debug(Logger.Categories.PANELS, 'WorkflowStatusPanel trigger clicked — polling resumed')
  }

  function onStepClick(step: StepDetail): void {
    const refs = step.referencedEntities
    if (Array.isArray(refs) && refs.length > 0 && typeof refs[0] === 'string') {
      setSelectedNode(refs[0])
      Logger.info(Logger.Categories.PANELS, `WorkflowStatusPanel step → ${refs[0]}`)
    }
  }

  const triggerText = (() => {
    if (!data || data.status === 'idle') return 'No workflows running.'
    if (data.status === 'running') {
      const wf = data.workflowName ?? 'workflow'
      const pct = data.progressPercent ?? 0
      const phase = data.currentPhase ?? ''
      return `${wf} ${pct}% — ${phase}`
    }
    if (data.status === 'completed') {
      return `${data.workflowName ?? 'workflow'} completed`
    }
    if (data.status === 'failed') {
      return `${data.workflowName ?? 'workflow'} failed`
    }
    return 'No workflows running.'
  })()

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-testid="workflow-status-panel"
      className="border-t border-border bg-card"
    >
      <CollapsibleTrigger
        onClick={onTriggerClick}
        className="h-10 w-full px-6 flex items-center justify-between text-xs hover:bg-accent transition-colors"
        data-testid="workflow-status-trigger"
      >
        <span className="text-foreground/90">{triggerText}</span>
        <span className="text-muted-foreground tabular-nums">
          {expanded ? '▾' : '▸'}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="rounded-none border-0 border-t border-border bg-card">
          <CardContent className="p-3 space-y-1">
            {(data?.stepsDetail ?? []).length === 0 ? (
              <div className="text-xs italic text-muted-foreground px-1 py-2">
                No step detail available.
              </div>
            ) : (
              data!.stepsDetail!.map((step) => {
                const isFailed = step.status === 'failed'
                const baseClass = isFailed ? 'text-destructive' : 'text-foreground/90'
                return (
                  <button
                    type="button"
                    key={step.name}
                    data-testid={`workflow-step-row-${step.name}`}
                    onClick={() => onStepClick(step)}
                    className={`w-full text-left flex items-center gap-2 py-1 px-1 rounded-sm hover:bg-accent transition-colors text-xs ${baseClass}`}
                  >
                    <StatusIcon status={step.status} />
                    <span className="flex-1 truncate">{step.label}</span>
                    <Progress value={step.progressPercent} className="w-32 h-1.5" />
                    <span className="tabular-nums text-[10px] text-muted-foreground w-8 text-right">
                      {step.progressPercent}%
                    </span>
                    {isFailed && (
                      <a
                        data-testid={`workflow-step-retry-${step.name}`}
                        href={DASHBOARD_UKB_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-destructive underline ml-1"
                      >
                        Retry
                      </a>
                    )}
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  )
}
