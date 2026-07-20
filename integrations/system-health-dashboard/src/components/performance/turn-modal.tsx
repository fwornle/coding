import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  closeTurnModal,
  selectModalTurn,
  selectContextTurnsFor,
  type ContextTurnRow,
  type ContextTurnMessage,
} from '@/store/slices/performanceSlice'
import { scrubSecrets, CACHE_WRITE_NA } from './context-cache-explainer'
import { ContextBand, ContextBandLegend } from './context-band'

// ---------------------------------------------------------------------------
// TurnModal (Phase 86 — Timeline v2, D-01/D-03)
// ---------------------------------------------------------------------------
// The single-turn drill-down modal. Mirrors KbDetailDialog
// (context-cache-explainer.tsx:352) — Radix `Dialog` with focus-trap / ESC /
// scroll-lock (NEVER hand-rolled). Open-state is driven ENTIRELY by the slice
// (openTurnModal/closeTurnModal + selectModalTurn, Plan 02 frozen contract) so
// it mounts once and any row can open it.
//
// Contents (UI-SPEC §2):
//   • full message list, per-message byte size (font-mono)
//   • per tool_use: name + arg-size + ETM observation intent line (D-03
//     semantic-first) — NEVER raw args unless capture_raw_bodies was ON
//   • cache-breakpoint indices
//   • the cumulative context band for the whole run (context-growth story)
//
// Security (T-86-03-01/02): EVERY preview/intent/arg string passes through
// `scrubSecrets` before render; all strings are React-escaped text — never
// injected as raw HTML. Cache-write honesty (T-86-03-04): usage.cache_write
// === null → CACHE_WRITE_NA, never a fabricated 0.

// The semantic-first "what this turn is doing" line (D-03), mirroring
// context-cache-explainer.tsx turnNote: correlated ETM observation intent first,
// else the fresh user-input preview. Always scrubbed.
function turnIntent(turn: ContextTurnRow): { text: string; source: 'observation' | 'preview' } | null {
  const ref = turn.observation_ref
  if (ref && typeof ref === 'object' && typeof ref.intent === 'string' && ref.intent.trim()) {
    return { text: scrubSecrets(ref.intent.trim()), source: 'observation' }
  }
  if (typeof ref === 'string' && ref.trim()) {
    return { text: scrubSecrets(ref.trim()), source: 'observation' }
  }
  const msgs = Array.isArray(turn.messages) ? turn.messages : []
  let lastUser = ''
  for (const m of msgs) if (m?.role === 'user' && typeof m.preview === 'string') lastUser = m.preview
  const preview = lastUser.trim()
  if (!preview) return null
  return { text: scrubSecrets(preview), source: 'preview' }
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function MessageEntry({ msg, isBreakpoint, captureRawBodies }: {
  msg: ContextTurnMessage
  isBreakpoint: boolean
  captureRawBodies: boolean
}) {
  const tool = msg.tool
  // D-03 semantic-first: tool NAME + arg SIZE + (raw arg text ONLY when capture
  // was on; else nothing fabricated). The preview digest is always scrubbed.
  const rawPreview = typeof msg.preview === 'string' ? msg.preview.trim() : ''
  const preview = rawPreview ? scrubSecrets(rawPreview) : ''
  return (
    <div className="rounded border px-3 py-2 text-sm" data-testid="turn-message">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-mono">{msg.role ?? 'unknown'}</Badge>
        {tool?.name && (
          <Badge variant="secondary" className="text-xs" data-testid="turn-tool-use">
            {tool.name} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{fmtBytes(tool.size)}</span>
          </Badge>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{fmtBytes(msg.bytes)}</span>
        {isBreakpoint && (
          <Badge variant="outline" className="text-[10px]" title="cache_control breakpoint at this message index (D-08)">
            cache breakpoint
          </Badge>
        )}
      </div>
      {preview && (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {captureRawBodies ? preview : preview.slice(0, 120)}
        </p>
      )}
    </div>
  )
}

export interface TurnModalProps {
  // Whether raw request bodies were captured for THIS span (ExperimentOverrides
  // capture_raw_bodies). Full preview text renders only when true; else the
  // ≤120-char digest — never fabricated arg text.
  captureRawBodies?: boolean
}

/**
 * The single-turn drill-down modal (D-01/D-03). Reads open-state from the slice
 * (selectModalTurn) + the run's context-turns; renders the focused turn's full
 * message list, scrubbed, semantic-first, with cache-breakpoint markers.
 */
export function TurnModal({ captureRawBodies = false }: TurnModalProps) {
  const dispatch = useAppDispatch()
  const { taskId, index, open } = useAppSelector(selectModalTurn)
  const turns = useAppSelector(selectContextTurnsFor(taskId))
  const turn = index != null ? turns[index] : undefined

  const intent = turn ? turnIntent(turn) : null
  const breakpoints = new Set(
    turn && Array.isArray(turn.cache_breakpoints) ? turn.cache_breakpoints : [],
  )
  const writeNA = turn?.usage?.cache_write === null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dispatch(closeTurnModal()) }}>
      <DialogContent
        className="max-w-[760px] w-[90vw] max-h-[85vh] overflow-y-auto"
        data-testid="turn-modal"
      >
        <DialogHeader>
          <DialogTitle>
            {index != null ? `Turn ${index + 1}` : 'Turn'} — request detail
          </DialogTitle>
          <DialogDescription>
            {intent
              ? <>
                  <span className="text-muted-foreground">
                    {intent.source === 'observation' ? 'Intent (observation):' : 'Intent (prompt):'}
                  </span>{' '}
                  {intent.text}
                </>
              : 'The full per-request message list, tool calls, and cache breakpoints for this turn.'}
          </DialogDescription>
        </DialogHeader>

        {!turn ? (
          <p className="text-sm text-muted-foreground">No captured request detail for this turn.</p>
        ) : (
          <div className="space-y-3">
            {/* Per-turn measured summary + honest N/A cache-write */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono">
                {(turn.usage?.input ?? 0).toLocaleString()} in ·{' '}
                {(turn.usage?.output ?? 0).toLocaleString()} out ·{' '}
                {(turn.usage?.cache_read ?? 0).toLocaleString()} cache r
              </span>
              <span className="font-mono text-xs text-muted-foreground" data-testid="turn-modal-cachewrite">
                cache w:{' '}
                {writeNA
                  ? <span title="This provider's wire protocol doesn't report cache creation; we show N/A rather than a fabricated 0.">{CACHE_WRITE_NA}</span>
                  : (turn.usage?.cache_write ?? 0).toLocaleString()}
              </span>
              <Badge variant="outline" className="text-[10px] font-mono">{turn.wire}</Badge>
            </div>

            {/* THIS turn's own context composition — the primary band, matching the
                timeline row's mini band (bandForTurn on the clicked turn). Previously
                this showed the whole-run cumulative band, which is identical for every
                turn and so never reflected the clicked turn's real per-category sizes. */}
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">This turn’s context composition</p>
              <ContextBand variant="mini" turn={turn} />
            </div>

            {/* The whole-run cumulative growth story, kept as a clearly-labelled
                secondary band (the original intent — how context accretes over the run). */}
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Whole-run growth (cumulative)</p>
              <ContextBand variant="cumulative" turns={turns} />
            </div>

            <ContextBandLegend />

            {/* Full message list — every preview scrubbed, byte sizes shown. */}
            <div className="space-y-1.5" data-testid="turn-message-list">
              {(Array.isArray(turn.messages) ? turn.messages : []).map((m) => (
                <MessageEntry
                  key={m.i}
                  msg={m}
                  isBreakpoint={breakpoints.has(m.i)}
                  captureRawBodies={captureRawBodies}
                />
              ))}
            </div>

            {!captureRawBodies && (
              <p className="text-[10px] text-muted-foreground">
                Raw request bodies were not captured for this run — tool calls show name + size + intent
                only (previews are truncated digests, not full arguments).
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
