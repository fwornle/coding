import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { normalizeModel } from '@/components/performance/models'
import { accountLabel } from '@/lib/providers'
import { cn } from '@/lib/utils'

const POLL_MS = 10_000

type CallKind = 'main' | 'subagent' | 'side' | ''

interface Group {
  model: string
  provider: string
  upstream: string
  call_kind: CallKind
  calls: number
  input: number
  output: number
  cache_read: number
  cache_write: number
}

interface Call {
  timestamp: string
  model: string
  provider: string
  upstream: string
  call_kind: CallKind
  input: number
  output: number
  cache_read: number
  cache_write: number
  latency_ms: number
}

interface Unbound {
  calls: number
  tokens: number
  first: string | null
  last: string | null
}

const fmtTokens = (n: number | null | undefined) => {
  const v = typeof n === 'number' ? n : 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

// In glass `anthropic` is the claude CLI's own login (Max or an API key — glass
// cannot tell), not coding's Max account the shared alias maps it to.
const answeredBy = (provider: string) => (provider === 'anthropic' ? 'Anthropic (own login)' : accountLabel(provider))

const KIND: Record<CallKind, { label: string; title: string; className: string }> = {
  main: { label: 'main', title: 'Sent tool definitions: the agent\'s own loop', className: 'bg-primary/10 text-foreground' },
  subagent: { label: 'subagent', title: 'A claude sub-agent: tools without a spawner tool', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  side: { label: 'side', title: 'No tools: a title, summary or intent call the agent makes on the side', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  '': { label: 'not recorded', title: 'Recorded before glass kept the call kind, or measured from the agent\'s own files', className: 'text-muted-foreground' },
}

function KindBadge({ kind }: { kind: CallKind }) {
  const k = KIND[kind] ?? KIND['']
  return <Badge variant="outline" title={k.title} className={cn('text-xs font-normal border-transparent', k.className)}>{k.label}</Badge>
}

const tokensOf = (r: { input: number; output: number; cache_read: number; cache_write: number }) =>
  r.input + r.output + r.cache_read + r.cache_write

/**
 * Which models one session used and who answered them — read-only. The agent
 * chose every model; glass forwards and measures, it never re-routes a call.
 */
export function SessionModels({ taskId }: { taskId: string }) {
  const [data, setData] = useState<{ groups: Group[]; calls: Call[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => fetch(`/api/experiments/runs/${encodeURIComponent(taskId)}/models`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e) => { if (alive) setError(String(e.message || e)) })
    setData(null)
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [taskId])

  const groups = data?.groups ?? []
  const calls = groups.reduce((n, g) => n + g.calls, 0)
  const models = new Set(groups.map((g) => g.model)).size
  const side = groups.filter((g) => g.call_kind === 'side')
  const sideCalls = side.reduce((n, g) => n + g.calls, 0)
  const sideTokens = side.reduce((n, g) => n + tokensOf(g), 0)
  const allTokens = groups.reduce((n, g) => n + tokensOf(g), 0)

  return (
    <Card data-testid="session-models">
      <CardHeader>
        <CardTitle className="text-base">Models</CardTitle>
        <CardDescription>
          What the agent chose and who answered. glass routes nothing — every call goes to the agent&apos;s own provider.
          {data && calls > 0 && (
            <span className="block mt-1" data-testid="models-headline">
              {calls} call{calls === 1 ? '' : 's'} on {models} model{models === 1 ? '' : 's'}
              {sideCalls > 0 && <> · {sideCalls} side call{sideCalls === 1 ? '' : 's'} ({allTokens ? Math.round((sideTokens / allTokens) * 100) : 0}% of tokens)</>}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">Could not read this session&apos;s calls: {error}</p>}
        {!error && data && calls === 0 && <p className="text-sm text-muted-foreground">No measured calls in this session yet.</p>}
        {groups.length > 0 && (
          <Table data-testid="models-table">
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Answered by</TableHead>
                <TableHead>Via</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Cache write</TableHead>
                <TableHead className="text-right">Output</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={`${g.model}|${g.provider}|${g.upstream}|${g.call_kind}`} data-kind={g.call_kind || 'unrecorded'}>
                  <TableCell className="font-mono text-xs">{normalizeModel(g.model)}</TableCell>
                  <TableCell><KindBadge kind={g.call_kind} /></TableCell>
                  <TableCell className="text-xs">{answeredBy(g.provider)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{g.upstream || '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{g.calls}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtTokens(g.input)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtTokens(g.cache_read)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtTokens(g.cache_write)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtTokens(g.output)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {(data?.calls.length ?? 0) > 0 && (
          <details data-testid="models-calls">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Newest {data!.calls.length} call{data!.calls.length === 1 ? '' : 's'}, one by one
            </summary>
            <Table className="mt-2">
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Answered by</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.calls.map((c, i) => (
                  <TableRow key={`${c.timestamp}-${i}`} className={cn(c.call_kind === 'side' && 'text-muted-foreground')}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(c.timestamp).toLocaleTimeString()}</TableCell>
                    <TableCell className="font-mono text-xs">{normalizeModel(c.model)}</TableCell>
                    <TableCell><KindBadge kind={c.call_kind} /></TableCell>
                    <TableCell className="text-xs">{answeredBy(c.provider)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtTokens(tokensOf(c))}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{c.latency_ms ? `${(c.latency_ms / 1000).toFixed(1)} s` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Calls glass measured but could not bind to a session (see lib/glass/ui-api.mjs
 * unboundCalls). Shown, never dropped: they are in the token totals.
 */
export function UnboundCalls() {
  const [u, setU] = useState<Unbound | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/calls/unbound').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setU(d) }).catch(() => {})
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!u || u.calls === 0) return null
  return (
    <p className="text-sm text-muted-foreground" data-testid="unbound-calls">
      {u.calls} call{u.calls === 1 ? '' : 's'} ({fmtTokens(u.tokens)} tokens) could not be bound to a session
      {u.last && <> — latest {new Date(u.last).toLocaleString()}</>}. They count in Token Usage, not in any row here:
      an intercepted call that names no session is never guessed.
    </p>
  )
}
