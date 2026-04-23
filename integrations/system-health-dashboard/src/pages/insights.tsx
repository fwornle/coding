import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Brain, TrendingUp, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownText } from '@/components/markdown-text'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}`

interface Insight {
  id: string
  topic: string
  summary: string
  confidence: number
  digestIds: string[]
  lastUpdated: string
  createdAt: string
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

function InsightCard({ insight }: { insight: Insight }) {
  const updated = new Date(insight.lastUpdated)
  const daysAgo = Math.floor((Date.now() - updated.getTime()) / 86400000)

  return (
    <Card className="hover:bg-accent/20 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-tight">{insight.topic}</CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className={`text-xs ${confidenceColor(insight.confidence)}`}>
              {Math.round(insight.confidence * 100)}%
            </Badge>
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
      </CardContent>
    </Card>
  )
}

export function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<{ totalInsights: number; totalDigests: number; undigested: number } | null>(null)
  const [consolidating, setConsolidating] = useState(false)

  const fetchInsights = useCallback(async (q = '') => {
    setLoading(true)
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : ''
      const res = await fetch(`${API_BASE_URL}/api/insights${params}`)
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
    try {
      const res = await fetch(`${API_BASE_URL}/api/consolidation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setConsolidationError(data.error || `HTTP ${res.status}`)
      }
    } catch (err) {
      setConsolidationError(err instanceof Error ? err.message : 'Network error')
    }
    await fetchInsights(query)
    await fetchStatus()
    setConsolidating(false)
  }, [fetchInsights, fetchStatus, query])

  useEffect(() => {
    fetchInsights()
    fetchStatus()
  }, [fetchInsights, fetchStatus])

  const handleSearch = () => fetchInsights(query)

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
          {status && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{status.totalInsights} insights from {status.totalDigests} digests</div>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => { fetchInsights(query); fetchStatus() }} disabled={loading || consolidating}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {status && status.undigested > 0 && (
            <Button size="sm" onClick={runConsolidation} disabled={consolidating || loading}>
              {consolidating ? (
                <><RefreshCw className="w-4 h-4 mr-1 animate-spin" />Consolidating...</>
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

      {consolidationError && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          Consolidation failed: {consolidationError}
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
