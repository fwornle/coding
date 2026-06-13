import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Map, RefreshCw, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

interface PerInsightSummary {
  id: string
  topic: string
  confidence: number
  ratio: number | null
  totalClaims: number | null
  verifiedClaims: number | null
  staleClaimCount: number
  verifiedAt: string | null
  lastUpdated: string
  parentTopic: string | null
  relatedInsightIds: string[]
  referencedFiles: string[]
}

interface CoverageResponse {
  project: string
  computedAt: string
  insights: {
    total: number
    fresh: number
    partial: number
    stale: number
    unverified: number
    avgRatio: number
  }
  coverage: {
    filesReferenced: number
    componentsMentioned: string[]
    componentsMissing: string[]
  }
  perInsight: PerInsightSummary[]
}

function tileColor(ratio: number | null): string {
  // Single text colour (white) across all bands; vary saturation/opacity of
  // the background to encode the band. The earlier pastel-on-pastel scheme
  // (text-emerald-100 on bg-emerald-500/40, text-emerald-50 on /70 etc.)
  // produced unreadable tiles in the 70–89% and 50–69% ranges. Each
  // background here is opaque enough that white text reaches WCAG AA on
  // the dark dashboard surface AND on lighter system themes.
  if (ratio === null) return 'bg-slate-500/80 border-slate-400/60 text-white'
  if (ratio >= 0.9) return 'bg-emerald-700/80 border-emerald-500/60 text-white'
  if (ratio >= 0.7) return 'bg-emerald-600/75 border-emerald-500/50 text-white'
  if (ratio >= 0.5) return 'bg-amber-600/80 border-amber-500/50 text-white'
  return 'bg-rose-600/80 border-rose-500/50 text-white'
}

function tileLabel(p: PerInsightSummary): string {
  if (p.ratio === null) return 'N/A'
  return `${Math.round(p.ratio * 100)}%`
}

/**
 * Truncate a topic to its informative head — the LLM tends to attach long
 * dash-separated descriptors. For tile labels we want the first 24 chars
 * after stripping common project prefixes.
 */
function shortTopic(t: string): string {
  if (!t) return ''
  const stripped = t.replace(/^(Knowledge Context Injection|System Health Dashboard|LLM CLI Proxy|Observations? (?:API|Pipeline|Dashboard))\s*[—-]\s*/i, '')
  return stripped.length > 28 ? stripped.slice(0, 26) + '…' : stripped
}

function ProjectCoverageCard({ data }: { data: CoverageResponse }) {
  const i = data.insights
  const c = data.coverage
  // Sort tiles: stalest first, then unverified, then fresh. Lets gaps catch the eye.
  const sortedTiles = useMemo(() => {
    return [...data.perInsight].sort((a, b) => {
      const aR = a.ratio ?? 1.001
      const bR = b.ratio ?? 1.001
      return aR - bR
    })
  }, [data.perInsight])

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Map className="w-5 h-5" />
            {data.project}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              {i.fresh} fresh
            </Badge>
            {i.partial > 0 && (
              <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                {i.partial} partial
              </Badge>
            )}
            {i.stale > 0 && (
              <Badge variant="outline" className="bg-rose-500/20 text-rose-400 border-rose-500/30">
                {i.stale} stale
              </Badge>
            )}
            {i.unverified > 0 && (
              <Badge variant="outline" className="bg-slate-500/30 text-slate-100 border-slate-400/40">
                {i.unverified} unverified
              </Badge>
            )}
            <span className="text-muted-foreground ml-2">
              avg <span className="font-mono">{Math.round(i.avgRatio * 100)}%</span>
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Insight tile grid — one tile per insight, color = freshness, click → detail */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          {sortedTiles.map(t => (
            <Link
              key={t.id}
              to={`/insights#insight-${t.id}`}
              className={`group relative h-16 rounded border ${tileColor(t.ratio)} px-2 py-1 flex flex-col justify-between text-left transition hover:brightness-110 hover:scale-[1.02]`}
              title={
                `${t.topic}\n\n` +
                `Truthfulness: ${t.ratio === null ? 'not yet verified' : `${Math.round(t.ratio * 100)}% — ${t.verifiedClaims ?? 0} of ${t.totalClaims ?? 0} code claims still exist in the repo`}` +
                `${t.staleClaimCount > 0 ? ` (${t.staleClaimCount} stale)` : ''}\n` +
                `Confidence: ${Math.round(t.confidence * 100)}% (LLM synthesis support, decayed by age + truthfulness)\n\n` +
                `Tile color = truthfulness band:\n` +
                `  green   ≥ 70% (FRESH)\n` +
                `  amber 50–70% (PARTIAL)\n` +
                `  rose   < 50% (STALE)\n` +
                `  gray   not yet verified\n\n` +
                `Click to jump to the full insight.`
              }
            >
              <div className="text-[10px] leading-tight font-medium line-clamp-2">
                {shortTopic(t.topic)}
              </div>
              <div className="flex items-center justify-between text-[10px] opacity-90">
                <span className="font-mono">{tileLabel(t)}</span>
                {t.staleClaimCount > 0 && (
                  <span className="font-mono">×{t.staleClaimCount}</span>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* Coverage stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              File coverage
            </div>
            <div className="text-2xl font-semibold">{c.filesReferenced}</div>
            <div className="text-xs text-muted-foreground">
              distinct files referenced across insights
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Component coverage
            </div>
            <div className="text-2xl font-semibold">
              {c.componentsMentioned.length}<span className="text-muted-foreground">/{c.componentsMentioned.length + c.componentsMissing.length}</span>
            </div>
            {c.componentsMentioned.length + c.componentsMissing.length === 0 ? (
              <div className="text-xs flex items-start gap-1 text-muted-foreground">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>no taxonomy defined for this project</span>
              </div>
            ) : c.componentsMissing.length > 0 ? (
              <div className="text-xs flex items-start gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>missing: {c.componentsMissing.join(', ')}</span>
              </div>
            ) : (
              <div className="text-xs flex items-center gap-1 text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                <span>all taxonomy components mentioned</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CoveragePage() {
  const [projects, setProjects] = useState<string[]>([])
  const [data, setData] = useState<Record<string, CoverageResponse>>({})
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE_URL}/api/insights/projects`)
      const list: string[] = r.ok ? await r.json() : []
      setProjects(list)
      const collected: Record<string, CoverageResponse> = {}
      await Promise.all(list.map(async p => {
        try {
          const cr = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(p)}/coverage`)
          if (cr.ok) collected[p] = await cr.json()
        } catch { /* skip on failure */ }
      }))
      setData(collected)
    } catch {
      setProjects([])
      setData({})
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Sort: largest projects first so the eye lands on coding/rapid-automations.
  const ordered = useMemo(() => {
    return projects
      .map(p => data[p])
      .filter((x): x is CoverageResponse => !!x)
      .sort((a, b) => b.insights.total - a.insights.total)
  }, [projects, data])

  // Corpus totals across all projects.
  const totals = useMemo(() => {
    return ordered.reduce(
      (acc, p) => ({
        insights: acc.insights + p.insights.total,
        fresh: acc.fresh + p.insights.fresh,
        partial: acc.partial + p.insights.partial,
        stale: acc.stale + p.insights.stale,
        files: acc.files + p.coverage.filesReferenced,
      }),
      { insights: 0, fresh: 0, partial: 0, stale: 0, files: 0 }
    )
  }, [ordered])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="w-6 h-6" />
            Project Coverage
            <span
              className="inline-flex cursor-help opacity-50 hover:opacity-100"
              title={
                `Two metrics per project:\n\n` +
                `1) TRUTHFULNESS — for each insight, the verifier extracts backticked ` +
                `code claims (file paths, function names, env vars, routes, packages) ` +
                `from the summary and checks each against the live codebase (filesystem + ` +
                `git grep across the project repo, its submodules, and sibling _work/* repos). ` +
                `The ratio is verified/total claims. Bands: FRESH ≥ 70%, PARTIAL 50–70%, STALE < 50%. ` +
                `Re-runs every 7 days on a cadence guard.\n\n` +
                `2) COVERAGE — distinct files referenced across all insights in the project ` +
                `(numerator) versus the project's component taxonomy (denominator). ` +
                `"Components mentioned" matches taxonomy names + aliases against ` +
                `insight topic+summary, so e.g. LiveLoggingSystem matches ` +
                `"LSL"/"transcript monitor"/"specstory".\n\n` +
                `Per-insight tile: color = truthfulness band, ×N badge = stale-claim count, ` +
                `click jumps to the full insight on the Insights tab.`
              }
            >
              <Info className="w-4 h-4" />
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            How well each project is represented by its insights — and how truthful those insights still are against the codebase. Hover the <Info className="w-3 h-3 inline" /> for methodology.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={loadAll} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Corpus totals strip */}
      {ordered.length > 0 && (
        <div className="grid grid-cols-5 gap-3 mb-6 text-sm">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Insights total</div>
            <div className="text-xl font-semibold">{totals.insights}</div>
          </Card>
          <Card className="p-3 border-emerald-500/30">
            <div className="text-xs text-emerald-500">Fresh ≥0.7</div>
            <div className="text-xl font-semibold text-emerald-400">{totals.fresh}</div>
          </Card>
          <Card className="p-3 border-amber-500/30">
            <div className="text-xs text-amber-500">Partial 0.5–0.7</div>
            <div className="text-xl font-semibold text-amber-400">{totals.partial}</div>
          </Card>
          <Card className="p-3 border-rose-500/30">
            <div className="text-xs text-rose-500">Stale &lt;0.5</div>
            <div className="text-xl font-semibold text-rose-400">{totals.stale}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Files referenced</div>
            <div className="text-xl font-semibold">{totals.files}</div>
          </Card>
        </div>
      )}

      {loading && ordered.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">Loading project coverage…</Card>
      )}

      {!loading && ordered.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          No projects found. Run the verifier first:{' '}
          <code className="px-1 py-0.5 bg-muted rounded text-xs">node scripts/verify-insight-claims.mjs</code>
        </Card>
      )}

      {ordered.map(p => (
        <ProjectCoverageCard key={p.project} data={p} />
      ))}
    </div>
  )
}
