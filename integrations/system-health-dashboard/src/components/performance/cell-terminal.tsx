// CellTerminal — a live "mini terminal" card for one experiment cell (variant × rep).
//
// The peek-into-the-machine view: a stylized scaled-down terminal streaming the cell's
// own log (<runDir>/cells/<taskId>.log via useCellLogPoll), with an identity header
// (agent accent, model/env chips, state badge, elapsed timer) and a heartbeat footer
// (live tokens, tool-call count, lines/min sparkline). Clicking the card zooms it into
// a near-fullscreen overlay (FLIP animation owned by CellTerminalGrid).
//
// All log content renders as React TEXT (auto-escaped) — never dangerouslySetInnerHTML.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { RunProgressCell, CellLogState } from '@/store/slices/performanceSlice'

// ── Cell/state helpers ────────────────────────────────────────────────────────

const LIVE_STATES = new Set(['restoring', 'running', 'scoring'])

export function isLiveCellState(state: string | undefined | null): boolean {
  return !!state && LIVE_STATES.has(state)
}

// Stable per-agent accent (deliberately distinct from the role palette in roles.ts,
// which colors WHAT a call did — this colors WHO the cell is).
const AGENT_ACCENTS: Record<string, { text: string; ring: string; dot: string }> = {
  claude: { text: 'text-amber-500', ring: 'ring-amber-500/30', dot: 'bg-amber-500' },
  opencode: { text: 'text-teal-500', ring: 'ring-teal-500/30', dot: 'bg-teal-500' },
  copilot: { text: 'text-sky-500', ring: 'ring-sky-500/30', dot: 'bg-sky-500' },
  mastracode: { text: 'text-fuchsia-500', ring: 'ring-fuchsia-500/30', dot: 'bg-fuchsia-500' },
}

export function agentAccent(agent: string | null | undefined) {
  return AGENT_ACCENTS[agent ?? ''] ?? { text: 'text-zinc-400', ring: 'ring-zinc-500/30', dot: 'bg-zinc-500' }
}

// The variant slug is `agent-model-framework-env`; the agent is the first segment.
export function agentFromVariant(variant: string): string {
  return variant.split('-')[0] ?? variant
}

function badgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'complete') return 'default'
  if (state === 'running' || state === 'restoring' || state === 'scoring') return 'secondary'
  if (state === 'timeout' || state === 'abort') return 'destructive'
  return 'outline'
}

// ── Log line colorization (regex on the rendered text, no HTML) ───────────────

const ERROR_RE = /error|fatal|FAIL|Traceback|SANDBOX ESCAPE/i
const TOOL_RE = /^(\$|⏺)|(\[experiment)|tool_use|Running |Write\(|Edit\(|Bash\(/
const INFRA_RE = /^\[(measurement|experiment-runner|experiment-run)\]|^(started|stopped|archived|captured) /

export function lineClass(line: string): string {
  if (ERROR_RE.test(line)) return 'text-red-400'
  if (INFRA_RE.test(line)) return 'text-zinc-500'
  if (TOOL_RE.test(line)) return 'text-cyan-300'
  return 'text-zinc-300'
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function fmtCompact(n: number | null | undefined): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function useElapsed(startedAt: string | null | undefined, live: boolean): string {
  const [, force] = useState(0)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

// Lines/min activity sparkline: 10 × 6s buckets over the last minute of line arrivals.
// A pulse dot glows when a line landed < 3s ago — the terminal's heartbeat.
function ActivitySparkline({ lineTimestamps, live }: { lineTimestamps: number[]; live: boolean }) {
  const now = Date.now()
  const buckets = useMemo(() => {
    const b = new Array<number>(10).fill(0)
    for (const t of lineTimestamps) {
      const age = now - t
      if (age < 0 || age >= 60_000) continue
      b[9 - Math.floor(age / 6_000)] += 1
    }
    return b
  }, [lineTimestamps, now])
  const max = Math.max(1, ...buckets)
  const recent = lineTimestamps.length > 0 && now - lineTimestamps[lineTimestamps.length - 1] < 3_000
  return (
    <span className="flex items-center gap-1" title="log activity (lines/min)">
      <svg width="48" height="12" viewBox="0 0 48 12" className="opacity-80">
        {buckets.map((v, i) => {
          const h = Math.max(1, Math.round((v / max) * 11))
          return <rect key={i} x={i * 5} y={12 - h} width="3.5" height={h} rx="1" className="fill-emerald-400/70" />
        })}
      </svg>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          recent && live ? 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.6)]' : 'bg-zinc-600'
        }`}
      />
    </span>
  )
}

// ── The terminal card ─────────────────────────────────────────────────────────

export interface CellTerminalProps {
  cell: RunProgressCell
  log: CellLogState | undefined
  // Compact grid tile vs the expanded overlay body (same component, two densities).
  expanded?: boolean
  onClick?: () => void
}

export function CellTerminal({ cell, log, expanded = false, onClick }: CellTerminalProps) {
  const state = String(cell.state ?? 'pending')
  const live = isLiveCellState(state)
  const agent = agentFromVariant(cell.variant)
  const accent = agentAccent(agent)
  const elapsed = useElapsed(cell.started_at, live)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const lines = useMemo(() => {
    const all = (log?.text ?? '').split('\n')
    // Compact tile shows a short tail; the expanded view shows the whole kept buffer.
    return expanded ? all : all.slice(-14)
  }, [log?.text, expanded])

  const toolCalls = useMemo(
    () => (log?.text ? log.text.split('\n').filter((l) => TOOL_RE.test(l)).length : 0),
    [log?.text]
  )

  // Stick to the bottom while streaming (unless the user scrolled up in expanded view).
  const stickRef = useRef(true)
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [log?.text])

  const edgeGlow =
    state === 'complete'
      ? 'animate-term-glow-green'
      : state === 'timeout' || state === 'abort'
        ? 'shadow-[0_0_10px_1px_rgba(248,113,113,0.35)] border-red-500/40'
        : ''

  const dimmed = !live && state !== 'pending'

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-lg border bg-[#0a0f1a] ring-1 ${accent.ring} ${edgeGlow} ${
        expanded ? '' : 'cursor-zoom-in transition-transform duration-150 hover:scale-[1.02]'
      }`}
      onClick={expanded ? undefined : onClick}
      data-testid={`cell-terminal-${cell.variant}-${cell.rep}`}
      role={expanded ? undefined : 'button'}
    >
      {/* Header: identity + liveness */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-zinc-900/90 px-2 py-1">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-red-500/80" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/80" />
          <span className="h-2 w-2 rounded-full bg-green-500/80" />
        </span>
        <span className={`ml-1 flex items-center gap-1 text-xs font-semibold ${accent.text}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${accent.dot}`} />
          {agent}
        </span>
        <span className="max-w-[10rem] truncate font-mono text-[10px] text-zinc-400" title={cell.variant}>
          {cell.variant.slice(agent.length + 1) || cell.variant}
        </span>
        {cell.variant.endsWith('kb-on') && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" title="knowledge injection ON" />
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-zinc-400" data-testid="cell-elapsed">
            {elapsed}
          </span>
          <Badge variant={badgeVariant(state)} className="h-4 px-1.5 text-[9px]">
            {state === 'scoring' ? (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                scoring
              </span>
            ) : (
              state
            )}
          </Badge>
        </span>
      </div>

      {/* Body: the log peek (CRT-flavored, motion-safe) */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={bodyRef}
          onScroll={
            expanded
              ? (e) => {
                  const el = e.currentTarget
                  stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
                }
              : undefined
          }
          className={`h-full overflow-y-auto px-2 py-1 font-mono leading-tight ${
            expanded ? 'text-xs' : 'pointer-events-none text-[9px]'
          } ${dimmed ? 'opacity-50 saturate-50' : ''} ${state === 'restoring' ? 'animate-pulse' : ''}`}
          data-testid="cell-terminal-body"
        >
          {lines.length === 1 && lines[0] === '' ? (
            <div className="italic text-zinc-600">{state === 'pending' ? 'waiting for slot…' : 'no output yet…'}</div>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={`whitespace-pre-wrap break-all ${lineClass(l)}`}>
                {l}
              </div>
            ))
          )}
          {live && <span className="inline-block h-3 w-[6px] animate-cursor-blink bg-zinc-300 align-text-bottom" />}
        </div>
        {/* CRT vignette + scanlines (decorative, never intercept clicks) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%), repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)',
          }}
        />
      </div>

      {/* Footer: the heartbeat */}
      <div className="flex items-center gap-3 border-t border-white/5 bg-zinc-900/90 px-2 py-1 text-[10px] text-zinc-400">
        <span className="font-mono tabular-nums" title="tokens in / out (live)">
          ⇄ {fmtCompact(log?.tokens?.input_tokens as number | undefined)}/
          {fmtCompact(log?.tokens?.output_tokens as number | undefined)}
        </span>
        <span className="font-mono tabular-nums" title="tool-call-ish log lines">
          ⚒ {toolCalls}
        </span>
        <span className="ml-auto">
          <ActivitySparkline lineTimestamps={log?.lineTimestamps ?? []} live={live} />
        </span>
      </div>

      {/* Failure reason pinned for terminal failures */}
      {(state === 'timeout' || state === 'abort' || state === 'skipped') && cell.reason && (
        <div className="border-t border-red-500/20 bg-red-950/40 px-2 py-1 text-[10px] text-red-300" data-testid="cell-reason">
          {cell.reason}
        </div>
      )}
    </div>
  )
}
