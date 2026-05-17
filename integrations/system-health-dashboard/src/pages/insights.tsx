import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { RefreshCw, Brain, TrendingUp, Search, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownText } from '@/components/markdown-text'
import { ConsolidationProgress, type InflightInfo } from '@/components/consolidation-progress'
import { ClipboardButton } from '@/components/clipboard-button'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

interface StaleClaim {
  raw: string
  type: 'PATH' | 'FUNCTION' | 'SYMBOL' | 'ROUTE' | 'PACKAGE'
}

interface CodeVerification {
  verifiedAt?: string
  totalClaims?: number
  verifiedClaims?: number
  verificationRatio?: number
  staleClaims?: StaleClaim[]
  referencedFiles?: string[]
}

interface InsightMetadata {
  codeVerification?: CodeVerification
  parentTopic?: string
  relatedInsightIds?: string[]
  consolidationReason?: string
}

interface Insight {
  id: string
  topic: string
  summary: string
  confidence: number
  digestIds: string[]
  lastUpdated: string
  createdAt: string
  project?: string | null
  metadata?: InsightMetadata
}

interface InsightResponse {
  data: Insight[]
  total: number
}

function confidenceColor(c: number): string {
  if (c >= 0.9) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (c >= 0.8) return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  if (c >= 0.7) return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
}

function confidenceBar(c: number): string {
  if (c >= 0.9) return 'bg-emerald-500'
  if (c >= 0.8) return 'bg-blue-500'
  if (c >= 0.7) return 'bg-amber-500'
  return 'bg-orange-500'
}

/**
 * Freshness pill — surfaces metadata.codeVerification.verificationRatio.
 *
 *   ratio >= 0.7  → FRESH   (emerald)
 *   0.5–0.7       → PARTIAL (amber)
 *   < 0.5         → STALE   (rose)
 *   undefined     → not rendered (insight has never been verified)
 */
function freshnessClass(ratio: number): string {
  if (ratio >= 0.7) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (ratio >= 0.5) return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  return 'bg-rose-500/20 text-rose-400 border-rose-500/30'
}

function freshnessLabel(ratio: number): string {
  if (ratio >= 0.7) return 'FRESH'
  if (ratio >= 0.5) return 'PARTIAL'
  return 'STALE'
}

function formatVerifiedAgo(iso?: string): string {
  if (!iso) return 'never verified'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'verified just now'
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'verified today'
  if (days === 1) return 'verified yesterday'
  return `verified ${days}d ago`
}

function FreshnessBadge({ cv }: { cv?: CodeVerification }) {
  if (!cv || typeof cv.verificationRatio !== 'number') return null
  const ratio = cv.verificationRatio
  const verified = cv.verifiedClaims ?? 0
  const total = cv.totalClaims ?? 0
  const stale = total - verified
  const ago = formatVerifiedAgo(cv.verifiedAt)
  // Browser tooltip — appears on hover. Explains the metric concretely so a
  // user encountering the badge for the first time understands what 60%
  // means (60% of the backticked file paths / function names / env vars
  // mentioned in this insight still exist in the codebase).
  const tooltip =
    `Truthfulness: ${verified} of ${total} code claims in this insight still ` +
    `exist in the codebase (${stale} stale). ` +
    `A "claim" is anything in backticks — a file path, function name, env var, ` +
    `route, or package. The verifier checks them against the live repo + ` +
    `submodules + sibling _work/* repos every 7 days. ${ago}.`
  return (
    <Badge
      variant="outline"
      className={`text-xs ${freshnessClass(ratio)}`}
      title={tooltip}
    >
      {freshnessLabel(ratio)} {Math.round(ratio * 100)}%
    </Badge>
  )
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  // Confidence is the OLDER, separate metric — set initially by the LLM
  // during synthesis (reflects how many digests supported the insight at
  // birth), then decayed over time:
  //   - Age drag:           −0.05 per full week without an update
  //   - Truthfulness drag:  if verificationRatio < 0.5, additional one-shot
  //                         penalty up to −0.20
  //   - Floor:              0.30
  // Higher = more trustworthy by the LLM-and-decay heuristic; the freshness
  // badge is the orthogonal "is the content still factually current" signal.
  const tooltip =
    `Confidence: how strongly this insight was supported by source digests at ` +
    `synthesis time, decayed since. Base value was set by the LLM (more ` +
    `corroborating digests → higher start); it loses 0.05 per week of ` +
    `inactivity and up to 0.20 more if truthfulness drops below 50%. ` +
    `Floor is 0.30. Independent of the FRESH / PARTIAL / STALE badge.`
  return (
    <Badge
      variant="outline"
      className={`text-xs ${confidenceColor(confidence)}`}
      title={tooltip}
    >
      {Math.round(confidence * 100)}%
    </Badge>
  )
}

function TruthfulnessPanel({ cv }: { cv?: CodeVerification }) {
  if (!cv || typeof cv.verificationRatio !== 'number') return null
  const ratio = cv.verificationRatio
  const verified = cv.verifiedClaims ?? 0
  const total = cv.totalClaims ?? 0
  const stale = cv.staleClaims ?? []
  // Methodology tooltip on the Info icon — fuller version of the badge
  // tooltip with the band thresholds and consequences for retrieval/decay.
  const methodologyTooltip =
    `What this measures: fraction of backticked code claims in the summary ` +
    `(file paths, function names like funcName(), env vars like LLM_TIMEOUT, ` +
    `HTTP routes like "GET /api/...", scoped packages like @scope/name) that ` +
    `still resolve against the codebase.

` +
    `How it's checked: filesystem existence for paths (with submodule + ` +
    `path-suffix fallbacks); git grep -F for symbols, routes, env vars. ` +
    `Search roots: the project repo, every submodule of it, and sibling ` +
    `_work/* repos. Re-runs every 7 days on a cadence guard.

` +
    `Bands: FRESH ≥ 70%, PARTIAL 50–70%, STALE < 50%.

` +
    `Consequences: retrieval scales rrfScore by (0.3 + 0.7 × ratio) for ` +
    `insight-tier results, so stale insights drop in rank. When ratio < 50%, ` +
    `confidence loses up to 0.20 (one-shot, cleared on recovery).`
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Truthfulness
          <span title={methodologyTooltip} className="inline-flex cursor-help opacity-60 hover:opacity-100">
            <Info className="w-3 h-3" />
          </span>
        </div>
        <div className="text-xs text-muted-foreground">{formatVerifiedAgo(cv.verifiedAt)}</div>
      </div>
      <div className="flex items-center gap-3 text-sm mb-2">
        <div className={`font-mono ${ratio >= 0.7 ? 'text-emerald-500' : ratio >= 0.5 ? 'text-amber-500' : 'text-rose-500'}`}>
          {Math.round(ratio * 100)}%
        </div>
        <div className="text-muted-foreground text-xs">
          {verified} of {total} code claims verify against the codebase
        </div>
      </div>
      {stale.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {stale.length} stale claim{stale.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-1 font-mono">
            {stale.map((s, i) => (
              <li key={i} className="text-rose-400/80">
                <span className="text-rose-500/60 mr-2">[{s.type}]</span>
                {s.raw}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const updated = new Date(insight.lastUpdated)
  const daysAgo = Math.floor((Date.now() - updated.getTime()) / 86400000)
  const clipboardText = `# ${insight.topic}\n\nConfidence: ${Math.round(insight.confidence * 100)}%\n\n${insight.summary}`
  const cv = insight.metadata?.codeVerification

  return (
    <Card id={`insight-${insight.id}`} className="hover:bg-accent/20 transition-colors scroll-mt-24">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-tight">{insight.topic}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <FreshnessBadge cv={cv} />
            <ConfidenceBadge confidence={insight.confidence} />
            <ClipboardButton text={clipboardText} title="Copy insight" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{insight.digestIds.length} source digests</span>
          <span>Updated {daysAgo === 0 ? 'today' : `${daysAgo}d ago`}</span>
        </div>
        {/* Confidence bar */}
        <div className="w-full h-1 bg-muted rounded-full mt-1">
          <div className={`h-1 rounded-full ${confidenceBar(insight.confidence)}`} style={{ width: `${insight.confidence * 100}%` }} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <MarkdownText text={insight.summary} />
        <TruthfulnessPanel cv={cv} />
      </CardContent>
    </Card>
  )
}

export function InsightsPage() {
  const location = useLocation()
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<{ totalInsights: number; totalDigests: number; undigested: number; inflight?: InflightInfo | null } | null>(null)
  const [consolidating, setConsolidating] = useState(false)
  const [consolidationResult, setConsolidationResult] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [projectFilter, setProjectFilter] = useState<string>('')

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/insights/projects`)
      if (res.ok) setProjects(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchInsights = useCallback(async (q = '', project = '') => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (q) qs.set('q', q)
      if (project) qs.set('project', project)
      const queryStr = qs.toString()
      const res = await fetch(`${API_BASE_URL}/api/insights${queryStr ? `?${queryStr}` : ''}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: InsightResponse = await res.json()
      setInsights(data.data || [])
    } catch {
      setInsights([])
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
      } else {
        const parts = []
        if (data.digests > 0) parts.push(`${data.digests} digests`)
        if (data.created > 0) parts.push(`${data.created} new insights`)
        if (data.updated > 0) parts.push(`${data.updated} insights updated`)
        setConsolidationResult(parts.length > 0 ? parts.join(', ') : 'No new content to consolidate')
      }
    } catch (err) {
      setConsolidationError(err instanceof Error ? err.message : 'Network error')
    }
    await fetchInsights(query, projectFilter)
    await fetchStatus()
    setConsolidating(false)
  }, [fetchInsights, fetchStatus, query, projectFilter])

  useEffect(() => {
    fetchInsights('', projectFilter)
  }, [fetchInsights, projectFilter])

  useEffect(() => {
    fetchProjects()
    fetchStatus()
  }, [fetchProjects, fetchStatus])

  // Hash-anchored scroll-into-view. Coverage tab tiles deep-link via
  // /insights#insight-<uuid>; React Router doesn't auto-scroll, so we
  // wait for the insights list to render then scroll the target card
  // into view and pulse it briefly. Also clears any active project
  // filter — a tile is always for an insight that should be visible
  // regardless of the user's previous filter state.
  useEffect(() => {
    if (loading || insights.length === 0) return
    const hash = location.hash
    if (!hash || !hash.startsWith('#insight-')) return
    const targetId = hash.slice(1)
    // Defer one tick so card refs are mounted in the DOM.
    const handle = window.requestAnimationFrame(() => {
      const el = document.getElementById(targetId)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
      window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
      }, 2400)
    })
    return () => window.cancelAnimationFrame(handle)
  }, [loading, insights, location.hash])

  // When arriving with a deep-link hash, force the project filter to ""
  // so the targeted insight is in the rendered set even if the user had
  // previously filtered to a different project.
  useEffect(() => {
    if (location.hash.startsWith('#insight-') && projectFilter !== '') {
      setProjectFilter('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash])

  // Poll heartbeat while a run is alive (or while we just kicked one off).
  // Detect completion via inflight transition so the insight list refreshes
  // even if the original POST response was lost to a network blip / restart.
  useEffect(() => {
    if (!consolidating && !status?.inflight) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/consolidation/status`)
        if (!res.ok) return
        const data = await res.json()
        setStatus(data)
        if (consolidating && !data.inflight) {
          setConsolidating(false)
          fetchInsights(query, projectFilter)
        }
      } catch { /* keep polling */ }
    }, 2000)
    return () => clearInterval(id)
  }, [consolidating, status?.inflight, fetchInsights, query, projectFilter])

  const handleSearch = () => fetchInsights(query, projectFilter)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-6 h-6" />
            Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Persistent project knowledge synthesized from daily digests
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
              <option value="">All projects ({insights.length})</option>
              {projects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          {status && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{status.totalInsights} insights from {status.totalDigests} digests</div>
            </div>
          )}
          {status && (status.undigested > 0 || status.inflight) && (
            <Button size="sm" onClick={runConsolidation} disabled={consolidating || !!status.inflight || loading}>
              {(consolidating || status.inflight) ? (
                <><RefreshCw className="w-4 h-4 mr-1 animate-spin" />Consolidating…</>
              ) : (
                <>Consolidate</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search insights..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="pl-9"
          />
        </div>
        {query && (
          <Button variant="ghost" size="sm" onClick={() => { setQuery(''); fetchInsights() }}>
            Clear
          </Button>
        )}
      </div>

      {status?.inflight && <ConsolidationProgress inflight={status.inflight} />}

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

      {insights.length === 0 && !loading && (
        <Card className="p-8 text-center text-muted-foreground">
          {query
            ? `No insights matching "${query}"`
            : <>No insights yet. Run <code className="px-1 py-0.5 bg-muted rounded text-xs">node scripts/consolidate-observations.js</code> to generate insights from digests.</>
          }
        </Card>
      )}

      <ScrollArea className="h-[calc(100vh-220px)]">
        <div className="grid gap-4">
          {insights.map(ins => (
            <InsightCard key={ins.id} insight={ins} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
