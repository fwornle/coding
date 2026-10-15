import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { normalizeModel } from '@/components/performance/models'
import { accountLabel } from '@/lib/providers'
import { cn } from '@/lib/utils'
import { ModelFlow } from './flow'
import { OFFLOAD_AGENTS, offloadStatus, useOffload, useTargetLabel } from './offload'

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

// In glass, claude answers with the claude CLI's own login. The daemon records
// its kind (lib/glass/daemon.mjs): `anthropic` = a bearer login, i.e. a Claude
// subscription (Max or Pro — the wire does not say which), `anthropic-api` = an
// x-api-key. An LLM proxy in between names the account (`claude-code-max`), and
// rows from claude's own transcript say `claude-code`: all one subscription.
// Before 0.1.26 an API-key login was recorded as `anthropic` too.
const CLAUDE_SUBSCRIPTION = new Set(['anthropic', 'claude-code', 'claude-code-max'])
const answeredBy = (provider: string) =>
  (CLAUDE_SUBSCRIPTION.has(provider) ? 'Claude subscription' : accountLabel(provider))

// A call the daemon measured but could not tie to a glass session has no agent.
/** answeredBy, plus the offload endpoint's own name for its rows. */
function useAnsweredBy() {
  const target = useTargetLabel()
  return useCallback((provider: string) => target(provider) ?? answeredBy(provider), [target])
}
const agentLabel = (agent: string) => (!agent || agent === 'unknown' ? 'no session' : agent)

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

// A share that is not zero never reads as 0%.
const share = (part: number, whole: number) => {
  if (!whole || !part) return '0%'
  const pct = (part / whole) * 100
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

const tokensOf = (r: { input: number; output: number; cache_read: number; cache_write: number }) =>
  r.input + r.output + r.cache_read + r.cache_write

/**
 * Which models one session used and who answered them — read-only. The agent
 * chose every model; glass forwards and measures, it never re-routes a call.
 */
export function SessionModels({ taskId }: { taskId: string }) {
  const answered = useAnsweredBy()
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
          What the agent chose and who answered — the agent&apos;s own provider, or your offload endpoint where offload is on.
          {data && calls > 0 && (
            <span className="block mt-1" data-testid="models-headline">
              {calls} call{calls === 1 ? '' : 's'} on {models} model{models === 1 ? '' : 's'}
              {sideCalls > 0 && <> · {sideCalls} side call{sideCalls === 1 ? '' : 's'} ({share(sideTokens, allTokens)} of tokens)</>}
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
                  <TableCell className="text-xs">{answered(g.provider)}</TableCell>
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
                    <TableCell className="text-xs">{answered(c.provider)}</TableCell>
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

interface MixGroup extends Group {
  agent: string
  sessions: number
}

const WINDOWS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: '24 h' },
  { hours: 24 * 7, label: '7 days' },
  { hours: 24 * 30, label: '30 days' },
  { hours: 0, label: 'All' },
]

/**
 * The Models tab: every measured call of a time window by agent, model, the
 * account that answered, the host and the call kind. One session's view is the
 * card under Sessions (SessionModels).
 */
export function ModelsPage() {
  const answered = useAnsweredBy()
  const off = useOffload()
  const cfg = off.view?.config
  const [hours, setHours] = useState(24)
  const [groups, setGroups] = useState<MixGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => fetch(`/api/models?hours=${hours}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) { setGroups(d.groups); setError(null) } })
      .catch((e) => { if (alive) setError(String(e.message || e)) })
    setGroups(null)
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [hours])

  const rows = groups ?? []
  const calls = rows.reduce((n, g) => n + g.calls, 0)
  const models = new Set(rows.map((g) => g.model)).size
  const allTokens = rows.reduce((n, g) => n + tokensOf(g), 0)
  const side = rows.filter((g) => g.call_kind === 'side')
  const sideCalls = side.reduce((n, g) => n + g.calls, 0)
  const sideTokens = side.reduce((n, g) => n + tokensOf(g), 0)

  return (
    <div className="p-6 space-y-6" data-testid="models-tab">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Models</h1>
          <p className="text-sm text-muted-foreground">
            Which models your agents used, who answered, and which calls were the agent&apos;s loop or a side call.
            Every call goes to the agent&apos;s own provider unless offload is on for that agent (header, top right).
          </p>
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              data-hours={w.hours}
              className={cn('px-3 py-1.5 text-sm rounded-md whitespace-nowrap', hours === w.hours ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length > 0 && (
        <Card data-testid="models-flow-card">
          <CardHeader>
            <CardTitle className="text-base">Flow</CardTitle>
            <CardDescription>
              The same calls as the table below, drawn from the agent to the model it chose to the account that answered.
              glass forwards every call to the host the agent addressed, with the agent&apos;s own login — unless offload is on
              for that agent: then its easy calls go to your endpoint. Click the endpoint&apos;s node to switch it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ModelFlow
              groups={rows}
              answeredBy={answered}
              agentLabel={agentLabel}
              offload={cfg?.target.url ? {
                label: cfg.target.name,
                enabled: cfg.enabled,
                status: offloadStatus(off.view),
                agentsOn: OFFLOAD_AGENTS.filter((a) => cfg.agents[a]),
                onToggle: () => {
                  // Turning on with nothing chosen would change nothing: open the settings instead.
                  if (!cfg.enabled && !OFFLOAD_AGENTS.some((a) => cfg.agents[a])) off.openSettings()
                  else off.patch({ enabled: !cfg.enabled }).catch(() => off.openSettings())
                },
                onSettings: off.openSettings,
              } : undefined}
            />
          </CardContent>
        </Card>
      )}
      <Card data-testid="models-page">
        <CardHeader>
          <CardTitle className="text-base">Model mix</CardTitle>
          <CardDescription data-testid="models-page-headline">
            {groups === null && !error ? 'loading…' : calls === 0 ? 'No measured calls in this window.' : (
              <>
                {calls} call{calls === 1 ? '' : 's'} on {models} model{models === 1 ? '' : 's'} · {fmtTokens(allTokens)} tokens
                {sideCalls > 0 && <> · {sideCalls} side call{sideCalls === 1 ? '' : 's'} ({share(sideTokens, allTokens)} of tokens)</>}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">Could not read the calls: {error}</p>}
          {rows.length > 0 && (
            <Table data-testid="models-page-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Answered by</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Cache read</TableHead>
                  <TableHead className="text-right">Cache write</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((g) => (
                  <TableRow key={`${g.agent}|${g.model}|${g.provider}|${g.upstream}|${g.call_kind}`} data-kind={g.call_kind || 'unrecorded'}>
                    <TableCell><Badge variant="secondary" className="text-xs" title={agentLabel(g.agent) === 'no session' ? 'Measured, but not tied to a glass session — see the note below the table' : undefined}>{agentLabel(g.agent)}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{normalizeModel(g.model)}</TableCell>
                    <TableCell><KindBadge kind={g.call_kind} /></TableCell>
                    <TableCell className="text-xs">{answered(g.provider)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{g.upstream || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{g.sessions || '—'}</TableCell>
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
          <p className="mt-4 text-xs text-muted-foreground">
            One session&apos;s models: open <span className="font-medium">Sessions</span> and select its row.
            Kind and Via are recorded since glass 0.1.16; older calls show “not recorded” and “—”.
          </p>
        </CardContent>
      </Card>
      <UnboundCalls />
    </div>
  )
}
