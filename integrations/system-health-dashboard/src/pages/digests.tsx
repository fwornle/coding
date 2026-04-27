import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, Calendar, Users, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownText, renderWithRedactionStyling } from '@/components/markdown-text'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

interface Digest {
  id: string
  date: string
  theme: string
  summary: string
  observationIds: string[]
  agents: string[]
  filesTouched: string[]
  quality: string
  createdAt: string
  project?: string | null
}

interface DigestResponse {
  data: Digest[]
  total: number
  limit: number
  offset: number
}

const AGENT_COLORS: Record<string, string> = {
  claude: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  copilot: 'bg-green-500/20 text-green-400 border-green-500/30',
  opencode: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  mastra: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
}

function DigestCard({ digest, isExpanded, onToggle }: { digest: Digest; isExpanded: boolean; onToggle: () => void }) {
  return (
    <Card
      className={`border-l-4 ${digest.quality === 'high' ? 'border-l-amber-500' : 'border-l-border'} cursor-pointer hover:bg-accent/30 transition-colors`}
      onClick={onToggle}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-2">
          {isExpanded ? <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{digest.theme}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                {digest.observationIds.length} obs
              </Badge>
              {digest.agents.map(a => (
                <Badge key={a} variant="outline" className={`text-xs ${AGENT_COLORS[a] || ''}`}>
                  {a}
                </Badge>
              ))}
            </div>

            {isExpanded && (
              <div className="mt-3 space-y-2">
                <MarkdownText text={digest.summary} />
                {digest.filesTouched.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="font-mono">
                      {renderWithRedactionStyling(
                        digest.filesTouched.slice(0, 5).join(', ') +
                          (digest.filesTouched.length > 5 ? ` +${digest.filesTouched.length - 5} more` : ''),
                        `files-${digest.id}`
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function DigestsPage() {
  const [digests, setDigests] = useState<Digest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [status, setStatus] = useState<{ totalDigests: number; undigested: number; pendingPast?: number; pendingToday?: number; totalInsights: number } | null>(null)
  const [consolidating, setConsolidating] = useState(false)
  const [consolidationResult, setConsolidationResult] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [projectFilter, setProjectFilter] = useState<string>('')

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/digests/projects`)
      if (res.ok) setProjects(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchDigests = useCallback(async (project: string = '') => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '200' })
      if (project) qs.set('project', project)
      const res = await fetch(`${API_BASE_URL}/api/digests?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: DigestResponse = await res.json()
      setDigests(data.data || [])
      setTotal(data.total || 0)
    } catch {
      setDigests([])
      setTotal(0)
    }
    setLoading(false)
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/consolidation/status`)
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  const [consolidationError, setConsolidationError] = useState<string | null>(null)

  const runConsolidation = useCallback(async () => {
    setConsolidating(true)
    setConsolidationError(null)
    setConsolidationResult(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/consolidation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setConsolidationError(data.error || `HTTP ${res.status}`)
      } else if (data.digests === 0) {
        setConsolidationResult('No new digests — observations may already be consolidated or too few to group')
      } else {
        setConsolidationResult(`Created ${data.digests} digests from ${data.observations} observations across ${data.days} days`)
      }
    } catch (err) {
      setConsolidationError(err instanceof Error ? err.message : 'Network error')
    }
    await fetchDigests(projectFilter)
    await fetchStatus()
    setConsolidating(false)
  }, [fetchDigests, fetchStatus, projectFilter])

  useEffect(() => {
    fetchDigests(projectFilter)
  }, [fetchDigests, projectFilter])

  useEffect(() => {
    fetchProjects()
    fetchStatus()
  }, [fetchProjects, fetchStatus])

  // Group digests by date
  const byDate = digests.reduce<Record<string, Digest[]>>((acc, d) => {
    if (!acc[d.date]) acc[d.date] = []
    acc[d.date].push(d)
    return acc
  }, {})
  const sortedDates = Object.keys(byDate).sort().reverse()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Digests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Daily thematic summaries consolidated from observations
          </p>
        </div>
        <div className="flex items-center gap-3">
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-sm rounded border border-border bg-background px-2 py-1"
              aria-label="Filter by project"
            >
              <option value="">All projects ({total})</option>
              {projects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          {status && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{status.totalDigests} digests</div>
            </div>
          )}
          {status && status.undigested > 0 && (
            <Button size="sm" onClick={runConsolidation} disabled={consolidating || loading}>
              {consolidating ? (
                <><RefreshCw className="w-4 h-4 mr-1 animate-spin" />Consolidating...</>
              ) : (
                <>Consolidate {status.undigested} obs</>
              )}
            </Button>
          )}
        </div>
      </div>

      {consolidationError && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          Consolidation failed: {consolidationError}
        </div>
      )}
      {consolidationResult && !consolidationError && (
        <div className="mb-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm">
          {consolidationResult}
        </div>
      )}

      {total === 0 && !loading && (
        <Card className="p-8 text-center text-muted-foreground">
          No digests yet. Run <code className="px-1 py-0.5 bg-muted rounded text-xs">node scripts/consolidate-observations.js</code> to consolidate observations.
        </Card>
      )}

      <ScrollArea className="h-[calc(100vh-160px)]">
        <div className="space-y-6">
          {sortedDates.map(date => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-3 sticky top-0 bg-background z-10 py-1">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">{new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
                <Badge variant="secondary" className="text-xs">{byDate[date].length}</Badge>
              </div>
              <div className="space-y-2 pl-6">
                {byDate[date].map(d => (
                  <DigestCard
                    key={d.id}
                    digest={d}
                    isExpanded={expandedId === d.id}
                    onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
