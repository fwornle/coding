import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, FileJson, FileText, Layers, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`
const REFRESH_INTERVAL = 30_000

/**
 * One row is a CHAIN — an hourly tranche including its rotation parts — not a
 * file. A legacy `-N_` markdown part is a headerless fragment split mid-token
 * and is meaningless on its own; a pi-format part is chained to its
 * predecessor. Listing files would show fragments.
 */
interface LslSession {
  id: string
  project: string
  key: string
  date: string | null
  window: string | null
  from: string | null
  subAgent?: boolean
  parts: number
  format: 'pi' | 'markdown' | 'mixed'
  bytes: number
  mtime: number
  agent: string | null
  promptSets: number | null
}

const fmtBytes = (n: number) =>
  n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

function FormatBadge({ format }: { format: LslSession['format'] }) {
  // The corpus is mixed until the backfill has run everywhere, so the format is
  // worth surfacing rather than hiding: a `markdown` row is rendered by
  // converting it in memory, which is a live preview of what the backfill does.
  const map = {
    pi: { label: 'pi', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', Icon: FileJson },
    markdown: { label: 'markdown', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', Icon: FileText },
    mixed: { label: 'mixed', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30', Icon: Layers },
  }[format]
  const Icon = map.Icon
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${map.cls}`}>
      <Icon className="h-3 w-3" />{map.label}
    </span>
  )
}

export function LslSessionsPage() {
  const [sessions, setSessions] = useState<LslSession[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [project, setProject] = useState<string>('')
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '200', months: '3' })
      if (project) qs.set('project', project)
      const res = await fetch(`${API_BASE_URL}/api/lsl/sessions?${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setSessions(json.sessions ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/lsl/projects`)
      .then(r => r.json())
      .then(d => setProjects(d.projects ?? []))
      .catch(() => setProjects([]))
  }, [])

  // Two refresh paths, as on the Observations page: a timer, plus an immediate
  // refetch on tab re-focus. Browsers throttle timers in hidden tabs, so the
  // interval alone leaves a staleness gap after sleep or backgrounding.
  useEffect(() => {
    const t = setInterval(fetchSessions, REFRESH_INTERVAL)
    const onVis = () => { if (document.visibilityState === 'visible') fetchSessions() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [fetchSessions])

  useEffect(() => {
    if (selected || sessions.length === 0) return
    // Skip straight to the newest session that actually has content. The very
    // newest tranche is often mid-flush: the ETM removes a prompt set before
    // re-appending it, so a file read in that window is briefly header-only and
    // would render as an empty transcript.
    setSelected((sessions.find(s => (s.promptSets ?? 0) > 0) ?? sessions[0]).id)
  }, [sessions, selected])

  const grouped = useMemo(() => {
    const out: Record<string, LslSession[]> = {}
    for (const s of sessions) (out[s.date ?? 'unknown'] ??= []).push(s)
    return out
  }, [sessions])

  const viewerSrc = selected
    ? `${API_BASE_URL}/api/lsl/sessions/${selected}/export.html`
    : null

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4 p-6" data-testid="lsl-sessions-page">
      <div className="flex w-[380px] shrink-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Sessions</h2>
          <span className="text-xs text-muted-foreground" data-testid="lsl-session-count">
            {sessions.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <select
              className="h-8 rounded border border-border bg-background px-2 text-xs"
              value={project}
              onChange={e => { setProject(e.target.value); setSelected(null) }}
              data-testid="lsl-project-filter"
            >
              <option value="">All projects</option>
              {projects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={fetchSessions} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <ScrollArea className="flex-1 rounded border border-border">
          {loading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
          {!loading && sessions.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No sessions found.</div>
          )}
          {Object.entries(grouped).map(([date, rows]) => (
            <div key={date}>
              <div className="sticky top-0 bg-muted/80 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                {date}
              </div>
              {rows.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  data-testid="lsl-session-row"
                  className={`flex w-full flex-col gap-1 border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                    selected === s.id ? 'bg-muted' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{s.window ?? s.key}</span>
                    <FormatBadge format={s.format} />
                    {s.parts > 1 && (
                      <span className="text-[10px] text-muted-foreground">{s.parts} parts</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{s.project}</span>
                    {s.agent && <span>· {s.agent}</span>}
                    {s.promptSets != null && <span>· {s.promptSets} sets</span>}
                    <span className="ml-auto">{fmtBytes(s.bytes)}</span>
                  </div>
                  {(s.from || s.subAgent) && (
                    <div className="text-[10px] text-muted-foreground">
                      {s.from && <span>redirected from {s.from}</span>}
                      {s.subAgent && <span>sub-agent</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </ScrollArea>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-muted-foreground">
            {selected ?? 'no session selected'}
          </span>
          {viewerSrc && (
            <a
              href={viewerSrc}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> open
            </a>
          )}
        </div>
        {viewerSrc ? (
          // The transcript body is pi's own renderer, served from the API. We
          // own navigation; pi owns rendering — reimplementing its tool
          // renderers would be re-derived work that rots as pi evolves.
          <iframe
            key={viewerSrc}
            src={viewerSrc}
            title="Session transcript"
            data-testid="lsl-session-viewer"
            className="h-full w-full rounded border border-border bg-background"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-border text-sm text-muted-foreground">
            Select a session
          </div>
        )}
      </div>
    </div>
  )
}
