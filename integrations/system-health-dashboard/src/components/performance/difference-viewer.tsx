import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronRight } from 'lucide-react'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchContextTurns,
  selectContextTurnsFor,
  selectCompareA,
  selectCompareB,
  selectRuns,
  type ContextTurnRow,
  type Run,
} from '@/store/slices/performanceSlice'
import { normalizeModel } from './models'
import { scrubSecrets } from './context-cache-explainer'
import { ContextBand } from './context-band'
import { alignRuns, type AlignResult } from './run-align'
import { loopFlags } from './loop-heuristic'

// ---------------------------------------------------------------------------
// DifferenceViewer (Phase 86 — Timeline v2, D-07/D-08) — the user's north-star.
// ---------------------------------------------------------------------------
// "See where two runs differ and how the different decisions lead to more or
// fewer tokens, more or fewer loops."
//
// Reads the two paired runs' per-request `ContextTurnRow[]` from the store,
// aligns them with the PURE `run-align.ts` (common-prefix + LCS tail — D-07),
// collapses the identical prefix, renders the divergent tail side-by-side with
// per-aligned-pair cumulative token deltas, and flags looped signatures via the
// PURE `loop-heuristic.ts` (D-09). Alignment runs on ContextTurnRow[] ONLY —
// never TimelineRow / timestamps — and fires NO network call beyond the two
// fetchContextTurns dispatches (S4 / Pitfall 4).
//
// Honest-null contract (S2, ATTR-02 anchor): the header reads
// `run.canonical_model` VERBATIM — null → italic "unmeasured". It NEVER
// recomputes a per-surface model (the per-surface recompute is exactly how
// finding-B's dominant-vs-first-row divergence arose — T-86-04-02).
//
// Experiment-cell guard (S4 / Pitfall 4, T-86-04-03): we align on the per-cell-
// correct ContextTurnRow stream and never re-run an observation time-window join
// for cells — so an experiment cell's narrative can't bleed across sessions.

// Byte-total of a single context-turn (input+output prompt weight), used for the
// per-aligned-pair cumulative delta. Reads the honest usage fields; cache_write
// is null on the OpenAI wire → treated as 0 for the SUM only (never surfaced as a
// fabricated write figure — that honesty gate lives in ContextBand).
function turnTokens(row: ContextTurnRow | undefined): number {
  if (!row) return 0
  const u = row.usage
  if (!u) return 0
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return n(u.input) + n(u.output) + n(u.cache_read) + (u.cache_write == null ? 0 : n(u.cache_write))
}

// Signed cumulative token delta (B − A) up to and including this aligned pair.
// Q5 palette: a DECREASE (B spent fewer tokens) is the good direction →
// text-status-success; an increase (or zero) → text-muted-foreground. Always an
// explicit +/− (U+2212 minus for the negative so it aligns in a mono column).
function CumulativeDelta({ value }: { value: number }): ReactNode {
  if (value === 0) return <span className="font-mono text-muted-foreground">0</span>
  const decrease = value < 0
  const sign = decrease ? '−' : '+'
  const color = decrease ? 'text-status-success' : 'text-muted-foreground'
  return (
    <span className={`font-mono ${color}`} title="Cumulative token delta (B − A) through this aligned pair">
      {sign}
      {Math.abs(value).toLocaleString()}
    </span>
  )
}

// The canonical-model header cell (S2 honest-null, ATTR-02). Reads
// `run.canonical_model` VERBATIM — null → italic "unmeasured". NEVER recomputed.
function ModelHeader({ run, label, taskId }: { run: Run | null; label: string; taskId: string | null }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-sm" title={taskId ?? ''}>
        {taskId ?? '—'}
      </span>
      {run?.canonical_model != null ? (
        <span className="font-mono text-xs text-muted-foreground">{normalizeModel(run.canonical_model)}</span>
      ) : (
        <span className="text-xs italic text-muted-foreground">unmeasured</span>
      )}
      {/* Run.loop_count is the "hard" strict-adjacent backend count, surfaced
          beside the advisory badges below. null → em-dash (S2), never coerced. */}
      <span className="text-[11px] text-muted-foreground">
        strict loops: {run?.loop_count != null ? run.loop_count : '—'}
      </span>
    </div>
  )
}

// A compact one-sided turn cell for the divergent tail. Renders the mini band
// plus the loop badge when this turn's signature repeats within LOOP_WINDOW. Kept
// deliberately lightweight (an inline row, NOT the full TurnRow from Plan 03) so
// this component takes no Plan-03 file dependency.
function TurnCell({
  row,
  index,
  looped,
  dimmed,
}: {
  row: ContextTurnRow | undefined
  index: number | null
  looped: boolean
  dimmed: boolean
}): ReactNode {
  if (!row || index == null) {
    return <div className="min-h-[2.5rem] rounded border border-dashed border-muted px-2 py-1.5 opacity-40" aria-hidden="true" />
  }
  // Prefer rendering the tool name + size over raw args (T-86-04-01); the preview
  // is passed through scrubSecrets so any secret in a tool/preview string never
  // reaches the DOM.
  const firstTool = row.messages?.find((m) => m.tool && m.tool.name)?.tool ?? null
  const preview = firstTool
    ? `${firstTool.name} · ${firstTool.size}B`
    : scrubSecrets((row.messages?.[0]?.preview ?? '').slice(0, 120))
  return (
    <div className={`rounded border px-2 py-1.5 ${dimmed ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">#{index}</span>
        {looped && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-help text-[10px]">
                possible loop
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              This turn repeats a recent signature (advisory, fuzzy, non-adjacent — distinct from the strict backend loop_count).
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <ContextBand variant="mini" turn={row} />
      <div className="mt-1 truncate text-[11px] text-muted-foreground" title={preview}>
        {preview || '—'}
      </div>
    </div>
  )
}

export function DifferenceViewer() {
  const dispatch = useAppDispatch()
  const runs = useAppSelector(selectRuns)
  const aId = useAppSelector(selectCompareA)
  const bId = useAppSelector(selectCompareB)
  // Read the two runs' per-request context-turns (NOT the timeline — alignment is
  // on the ContextTurnRow stream, never timestamps — key_link / S4).
  const aTurns = useAppSelector(selectContextTurnsFor(aId))
  const bTurns = useAppSelector(selectContextTurnsFor(bId))

  useEffect(() => { if (aId) dispatch(fetchContextTurns(aId)) }, [aId, dispatch])
  useEffect(() => { if (bId) dispatch(fetchContextTurns(bId)) }, [bId, dispatch])

  const runA = runs.find((r) => r.task_id === aId) ?? null
  const runB = runs.find((r) => r.task_id === bId) ?? null

  // The pure alignment — common-prefix + LCS tail (D-07). No network, no side
  // effects. `pairs` are ABSOLUTE run indices; [0, prefixLen) is the collapsible
  // identical prefix; firstDivergence === null ⇒ the two runs are identical.
  const align: AlignResult = useMemo(() => alignRuns(aTurns, bTurns), [aTurns, bTurns])
  const aLoops = useMemo(() => loopFlags(aTurns), [aTurns])
  const bLoops = useMemo(() => loopFlags(bTurns), [bTurns])

  const [prefixOpen, setPrefixOpen] = useState(false)

  // Per-aligned-pair CUMULATIVE token delta (B − A), accreting through the tail.
  const cumulativeDeltas = useMemo(() => {
    let cum = 0
    return align.pairs.map((pair) => {
      const aTok = pair.a != null ? turnTokens(aTurns[pair.a]) : 0
      const bTok = pair.b != null ? turnTokens(bTurns[pair.b]) : 0
      cum += bTok - aTok
      return cum
    })
  }, [align.pairs, aTurns, bTurns])

  return (
    <Card data-testid="difference-viewer">
      <CardHeader>
        <CardTitle className="text-base">Difference viewer</CardTitle>
        <p className="text-sm text-muted-foreground">
          Where two runs diverge, and how the different decisions cost more or fewer tokens and loops. Aligned by
          request signature (D-07); the identical prefix is collapsed, the view starts at the first divergence.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <ModelHeader run={runA} label="Run A" taskId={aId} />
          <ModelHeader run={runB} label="Run B" taskId={bId} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!aId ? (
          <p className="text-sm text-muted-foreground">Select a run to compare.</p>
        ) : !bId ? (
          <p className="text-sm text-muted-foreground">Select a second run to compare.</p>
        ) : align.firstDivergence === null ? (
          // Identical runs — DON'T render a broken/empty diff table.
          <p className="text-sm text-muted-foreground" data-testid="difference-viewer-identical">
            These two runs are identical — no divergence to show.
          </p>
        ) : (
          <TooltipProvider delayDuration={200}>
            {/* Identical prefix [0, prefixLen) collapsed by default (S5). */}
            {align.prefixLen > 0 && (
              <Collapsible open={prefixOpen} onOpenChange={setPrefixOpen} className="rounded-md border">
                <CollapsibleTrigger
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground"
                  data-testid="difference-viewer-prefix-trigger"
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${prefixOpen ? 'rotate-90' : ''}`} />
                  Show {align.prefixLen} identical {align.prefixLen === 1 ? 'turn' : 'turns'}
                </CollapsibleTrigger>
                <CollapsibleContent className="grid grid-cols-2 gap-3 px-3 pb-3">
                  {Array.from({ length: align.prefixLen }, (_, i) => (
                    <div key={`prefix-${i}`} className="contents">
                      <TurnCell row={aTurns[i]} index={i} looped={!!aLoops[i]} dimmed={false} />
                      <TurnCell row={bTurns[i]} index={i} looped={!!bLoops[i]} dimmed={false} />
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Divergent tail — the view starts here (D-07). Each aligned pair
                renders A-side + B-side; one-sided pairs dim the empty column;
                the cumulative signed delta (B − A) accretes down the column. */}
            <div className="overflow-hidden rounded-md border" data-testid="difference-viewer-tail">
              <div className="grid grid-cols-[1fr_1fr_auto] items-stretch gap-x-3 gap-y-2 px-3 py-2">
                <div className="text-xs font-medium text-muted-foreground">Run A</div>
                <div className="text-xs font-medium text-muted-foreground">Run B</div>
                <div className="text-right text-xs font-medium text-muted-foreground">Δ tokens (B−A)</div>
                {align.pairs.map((pair, i) => (
                  <div key={`pair-${i}`} className="contents">
                    <TurnCell
                      row={pair.a != null ? aTurns[pair.a] : undefined}
                      index={pair.a}
                      looped={pair.a != null && !!aLoops[pair.a]}
                      dimmed={pair.a == null}
                    />
                    <TurnCell
                      row={pair.b != null ? bTurns[pair.b] : undefined}
                      index={pair.b}
                      looped={pair.b != null && !!bLoops[pair.b]}
                      dimmed={pair.b == null}
                    />
                    <div className="flex items-center justify-end text-right text-sm">
                      <CumulativeDelta value={cumulativeDeltas[i]} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  )
}
