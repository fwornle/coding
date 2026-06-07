// PATTERN SOURCE: 45-PATTERNS.md § RcaOpsPanel.tsx + 45-UI-SPEC.md § RcaOpsPanel
// CONTRACT: 45-05-PLAN.md Task 2 + <interfaces> block (Option A — verbatim port
//           of VOKB's RcaOperationsPanel ingestion-ops semantic, NOT a node-walker)
//
// C-system signature panel. Visible only on /viewer/cap (the SidePanel below
// hides this tab for system !== 'cap'). Architecture:
//
//   1. Construct one OkmRcaClient per mount, targeting SYSTEM_ENDPOINTS.cap.
//   2. useQuery({queryKey: ['rca-dirs','cap']}) for the three grouped dir lists.
//   3. useEffect on mount subscribes to SSE; cleanup CLOSES the EventSource.
//   4. A second useEffect runs an interval-based 120s STALE watchdog on
//      runningPipeline + lastEventAt — if the gap since the last SSE event
//      exceeds 120_000 ms while a pipeline is active, the panel marks the
//      run STALE, surfaces the destructive Card, and re-enables Ingest.
//   5. Ingest button click → setRunningPipeline(key) THEN call rcaIngest.
//      runningPipeline !== null disables ALL Ingest buttons (T-45-05-05 —
//      no double-click race, no parallel ingestions).
//
// Threat-model anchors:
//   T-45-05-01 (CORS/SSO) → caught by useQuery `error`; we render
//     ErrorUnreachableState or ErrorCorsState from lib-domain/states.
//   T-45-05-02 (SSE leak) → useEffect cleanup calls es.close(); the 120s
//     watchdog also closes-and-reopens on stale to flush stuck sockets.
//   T-45-05-04 (force-reingest accidental click) → ACCEPTED per D-45-04;
//     the checkbox label says "Re-ingest existing" so intent is explicit.
//   T-45-05-05 (double-click race) → runningPipeline state gate.
//
// Styling: shadcn-semantic tokens REPLACE VOKB's raw tier colors (the
//   green/blue/purple Tailwind classes at TIER_COLORS in VOKB:59-63) per
//   UI-SPEC § Reference Port-Specs RCA panel. Tier mapping is collapsed
//   to a single state-driven scheme:
//     pending => bg-muted/40  text-muted-foreground
//     active  => bg-primary   text-primary-foreground animate-pulse
//     done    => bg-muted     text-foreground

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Circle, Loader2 } from 'lucide-react'
import {
  OkmRcaClient,
  type Pipeline,
  type PipelineEvent,
  type RcaDir,
  type RcaDirGroups,
} from '@/api/OkmRcaClient'
import { SYSTEM_ENDPOINTS, type System } from '@/config/system-endpoints'
import type { ApiClient } from '@/api/ApiClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { ErrorCorsState, ErrorUnreachableState } from '@/lib-domain/states'
import { Logger } from '@/lib/logging'

// VOKB:44-72 — PipelineStage[] + STAGE_TO_TIER_KEY port. We keep the keys
// verbatim so SSE `stage` payloads from OKM match without translation.
export const PIPELINE_STAGES: readonly { key: string; label: string }[] = [
  { key: 'extract',    label: 'Extract' },
  { key: 'dedup',      label: 'Dedup' },
  { key: 'store',      label: 'Store' },
  { key: 'synthesize', label: 'Synthesize' },
  { key: 'resolve',    label: 'Resolve' },
] as const

export type StageState = 'pending' | 'active' | 'done'

// 120s stale watchdog window — PORT verbatim from VOKB:225-236.
// Literal 120000 retained for the verification grep gate (PLAN.md Task 2 done
// criterion: `grep -c "120000" src/panels/RcaOpsPanel.tsx` >= 1).
const WATCHDOG_MS = 120000
const WATCHDOG_TICK_MS = 5000

/**
 * Resolve the visual state of a stage pill given the currentStage from the
 * SSE stream. Earlier stages (by index) are `done`; the active one pulses;
 * later stages are `pending`. Mirrors VOKB's STAGE_TO_TIER_KEY semantics.
 */
function stageStateOf(stageKey: string, currentStage: string | null): StageState {
  if (!currentStage) return 'pending'
  const currentIdx = PIPELINE_STAGES.findIndex((s) => s.key === currentStage)
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === stageKey)
  if (currentIdx < 0 || idx < 0) return 'pending'
  if (idx < currentIdx) return 'done'
  if (idx === currentIdx) return 'active'
  return 'pending'
}

/** Tailwind classes for a stage pill, per UI-SPEC tier→shadcn mapping. */
function stageClass(state: StageState): string {
  switch (state) {
    case 'pending':
      return 'bg-muted/40 text-muted-foreground border-border'
    case 'active':
      return 'bg-primary text-primary-foreground border-primary animate-pulse'
    case 'done':
      return 'bg-muted text-foreground border-border'
  }
}

export interface RcaOpsPanelProps {
  /** Kept for API symmetry with the other panels; not strictly needed here. */
  apiClient: ApiClient
  system: System
}

interface Completion {
  success: boolean
  message?: string
}

/** Map a finding-row-level click to ingest call args. */
interface RowClickContext {
  pipeline: Pipeline
  dirPath: string
}

export function RcaOpsPanel({ system }: RcaOpsPanelProps) {
  // The panel is system-locked to 'cap' by the SidePanel tab visibility,
  // but defending in depth: read SYSTEM_ENDPOINTS.cap directly.
  const baseUrl = SYSTEM_ENDPOINTS.cap
  const rcaClient = useMemo(() => new OkmRcaClient(baseUrl), [baseUrl])

  const [runningPipeline, setRunningPipeline] = useState<Pipeline | null>(null)
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [progress, setProgress] = useState<number>(0)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [forceReingest, setForceReingest] = useState<boolean>(false)
  // lastEventAt is read by the watchdog — store in a ref so we don't
  // re-create the SSE-subscription effect on every event tick.
  const lastEventAtRef = useRef<number>(Date.now())

  const dirsQ = useQuery<RcaDirGroups, Error>({
    queryKey: ['rca-dirs', 'cap'],
    queryFn: () => rcaClient.listDirs(),
    staleTime: 30_000,
  })

  // ---- SSE subscription (T-45-05-02 cleanup discipline) ----------------
  useEffect(() => {
    const es = rcaClient.subscribeProgress((event: PipelineEvent) => {
      lastEventAtRef.current = Date.now()
      Logger.info(Logger.Categories.PANELS, 'RCA SSE event', event.type, event.stage ?? '')
      if (event.type === 'connected') {
        // VOKB:117-124 — bootstrap handshake; no UI side-effect.
        return
      }
      if (event.type === 'stage' && event.stage) {
        setCurrentStage(event.stage)
        return
      }
      if (event.type === 'progress' && typeof event.progress === 'number') {
        setProgress(event.progress)
        return
      }
      if (event.type === 'complete') {
        setRunningPipeline(null)
        setCurrentStage(null)
        setCompletion({ success: true, message: event.message })
        return
      }
      if (event.type === 'error') {
        setRunningPipeline(null)
        setCurrentStage(null)
        setCompletion({ success: false, message: event.message })
      }
    })
    return () => {
      // MANDATORY — T-45-05-02 leak mitigation.
      es.close()
    }
  }, [rcaClient])

  // ---- 120s stale-ingestion watchdog (T-45-05-02) ----------------------
  useEffect(() => {
    if (!runningPipeline) return
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - lastEventAtRef.current
      if (elapsed > WATCHDOG_MS) {
        Logger.warn(Logger.Categories.PANELS, 'RCA STALE — no SSE for >120s', {
          elapsed,
          runningPipeline,
        })
        setRunningPipeline(null)
        setCurrentStage(null)
        setCompletion({
          success: false,
          message: `Pipeline appears STALE — no progress for ${Math.round(
            elapsed / 1000,
          )}s.`,
        })
      }
    }, WATCHDOG_TICK_MS)
    return () => window.clearInterval(interval)
  }, [runningPipeline])

  // ---- Ingest trigger ----------------------------------------------------
  function onIngest(ctx: RowClickContext) {
    if (runningPipeline) return // gate — T-45-05-05
    setRunningPipeline(ctx.pipeline)
    setCurrentStage(null)
    setProgress(0)
    setCompletion(null)
    lastEventAtRef.current = Date.now()
    Logger.info(Logger.Categories.PANELS, 'RCA Ingest →', ctx.pipeline, ctx.dirPath, {
      force: forceReingest,
    })
    void rcaClient
      .rcaIngest(ctx.pipeline, ctx.dirPath, { force: forceReingest })
      .catch((err: unknown) => {
        Logger.error(Logger.Categories.API, 'RCA ingest call failed', err)
        setRunningPipeline(null)
        setCompletion({
          success: false,
          message: err instanceof Error ? err.message : 'Ingest call failed',
        })
      })
  }

  // ---- Error gates -------------------------------------------------------
  if (dirsQ.error) {
    const msg = dirsQ.error.message ?? ''
    // CORS errors in fetch surface as a generic TypeError with messages
    // like "Failed to fetch" — we can't distinguish reliably without the
    // browser's NetworkError message, so we default to Unreachable but
    // switch to Cors if the message explicitly mentions CORS.
    const isCors = /cors/i.test(msg)
    return (
      <div className="p-md">
        {isCors ? (
          <ErrorCorsState system={system} baseUrl={baseUrl} onRetry={() => dirsQ.refetch()} />
        ) : (
          <ErrorUnreachableState system={system} baseUrl={baseUrl} onRetry={() => dirsQ.refetch()} />
        )}
      </div>
    )
  }

  if (dirsQ.isLoading || !dirsQ.data) {
    return (
      <div
        data-testid="rca-loading"
        className="flex items-center gap-2 p-md text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading RCA data...
      </div>
    )
  }

  const dirs = dirsQ.data
  const allEmpty =
    dirs.kpifw.length === 0 && dirs.raas.length === 0 && dirs.e2e.length === 0

  if (allEmpty) {
    return (
      <div data-testid="rca-empty" className="p-md text-sm text-muted-foreground">
        No RCA pipeline runs available.
      </div>
    )
  }

  const statusLabel = runningPipeline
    ? 'Ingesting'
    : completion?.success === false
      ? 'Idle'
      : 'Connected'

  return (
    <div data-testid="rca-ops-panel" className="space-y-md p-2">
      {/* Header */}
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">RCA</h2>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Circle
            className={
              runningPipeline
                ? 'h-2 w-2 fill-primary text-primary'
                : 'h-2 w-2 fill-muted-foreground text-muted-foreground'
            }
            aria-hidden
          />
          <span data-testid="rca-status-label">{statusLabel}</span>
        </div>
      </header>

      {/* Three grouped dir lists */}
      <DirGroup
        label="KPI-FW"
        pipeline="kpifw"
        rows={dirs.kpifw}
        runningPipeline={runningPipeline}
        onIngest={onIngest}
      />
      <DirGroup
        label="RaaS"
        pipeline="raas"
        rows={dirs.raas}
        runningPipeline={runningPipeline}
        onIngest={onIngest}
      />
      <DirGroup
        label="E2E"
        pipeline="e2e"
        rows={dirs.e2e}
        runningPipeline={runningPipeline}
        onIngest={onIngest}
      />

      {/* Force-reingest toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          data-testid="rca-force-checkbox"
          checked={forceReingest}
          onCheckedChange={(next) => setForceReingest(next === true)}
        />
        <label className="text-xs text-muted-foreground select-none">
          Re-ingest existing
        </label>
      </div>

      {/* Five stage pills */}
      <div className="flex items-center gap-1">
        {PIPELINE_STAGES.map((stage) => {
          const state = stageStateOf(stage.key, currentStage)
          return (
            <Badge
              key={stage.key}
              data-testid={`stage-pill-${stage.key}`}
              variant="outline"
              className={`px-2 py-0.5 text-[10px] ${stageClass(state)}`}
            >
              {stage.label}
            </Badge>
          )
        })}
      </div>

      {/* Progress bar */}
      <Progress
        data-testid="rca-progress"
        value={progress}
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />

      {/* Completion / error card */}
      {completion && (
        <Card
          data-testid="rca-completion-card"
          className={
            completion.success
              ? 'border-l-4 border-l-emerald-500'
              : 'border-l-4 border-l-destructive'
          }
        >
          <CardContent className="p-3 text-sm">
            {completion.message ??
              (completion.success ? 'Ingestion complete' : 'Ingestion failed')}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---- DirGroup subcomponent ----------------------------------------------

interface DirGroupProps {
  label: string
  pipeline: Pipeline
  rows: RcaDir[]
  runningPipeline: Pipeline | null
  onIngest: (ctx: RowClickContext) => void
}

function DirGroup({ label, pipeline, rows, runningPipeline, onIngest }: DirGroupProps) {
  return (
    <section data-testid={`rca-group-${pipeline}`}>
      <h3 className="text-xs font-medium text-muted-foreground mb-1">{label}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No runs</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row, idx) => (
            <li
              key={row.path}
              data-testid={`rca-row-${pipeline}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-sm bg-card px-2 py-1 text-xs"
            >
              <span className="font-mono text-muted-foreground truncate" title={row.path}>
                {row.timestamp}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {row.findingCount} findings
              </Badge>
              <Button
                size="sm"
                variant="default"
                disabled={runningPipeline !== null}
                onClick={() => onIngest({ pipeline, dirPath: row.path })}
              >
                Ingest
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
