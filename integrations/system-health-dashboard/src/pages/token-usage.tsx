import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Zap, TrendingUp, Clock, ArrowUpDown, Settings } from 'lucide-react'
import { TokenUsageSettingsDialog } from './token-usage-settings-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Treemap, AreaChart, Area
} from 'recharts'

const PROXY_PORT = '12435'
const PROXY_BASE = `http://localhost:${PROXY_PORT}`
const REFRESH_INTERVAL = 30_000

// Colors for process categories
const PROCESS_COLORS: Record<string, string> = {
  'observation-writer': '#3b82f6',     // blue
  'observation-classifier': '#60a5fa', // lighter blue
  'digest-consolidator': '#8b5cf6',    // purple
  'insight-synthesizer': '#a78bfa',    // lighter purple
  'wave1-project-agent': '#f59e0b',    // amber
  'wave1-topic-agent': '#fbbf24',      // lighter amber
  'content-validation': '#ef4444',     // red
  'entity-refresh': '#f87171',         // lighter red
  'backfill-raw': '#10b981',           // emerald
  'general': '#6b7280',               // gray
}

const PROVIDER_COLORS: Record<string, string> = {
  'copilot': '#2563eb',
  'claude-code': '#7c3aed',
  'anthropic': '#d97706',
}

const SUBSCRIPTION_LABELS: Record<string, string> = {
  'copilot-subscription': 'GitHub Copilot',
  'max-subscription': 'Claude Max',
  'api-key': 'API Key',
}

interface TokenSummary {
  total_calls: number
  total_input: number
  total_output: number
  total_tokens: number
  avg_latency_ms: number
  by_process: Array<{
    process: string
    calls: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
    avg_latency: number
  }>
  by_provider: Array<{
    provider: string
    calls: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }>
  by_model: Array<{
    model: string
    calls: number
    total_tokens: number
  }>
  by_subscription: Array<{
    subscription: string
    calls: number
    total_tokens: number
  }>
  by_hour: Array<{
    hour: string
    calls: number
    input_tokens: number
    output_tokens: number
  }>
}

interface RecentCall {
  id: number
  timestamp: string
  provider: string
  model: string
  process: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  latency_ms: number
  subscription: string
  prompt_preview: string
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// observation-writer (and similar callers) wrap prompts in XML-like tags
// (`<project>`, `<exchange>`, `<user>`, `<assistant>` …) so the LLM can parse
// structure. The tags are intentional in the prompt body but pure noise in the
// 200px-wide dashboard preview column. Strip simple tag tokens and collapse
// resulting whitespace — leave bracketed content like `[Image: ...]` intact.
function stripPromptPreview(s: string): string {
  if (!s) return ''
  return s.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function getProcessColor(process: string): string {
  return PROCESS_COLORS[process] || '#6b7280'
}

function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider] || '#6b7280'
}

// Custom treemap content for process breakdown
function TreemapContent(props: {
  x: number; y: number; width: number; height: number;
  name: string; value: number; fill: string
}) {
  const { x, y, width, height, name, value, fill } = props
  if (width < 40 || height < 30) return null
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#1e1e2e" strokeWidth={2} rx={4} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={12} fontWeight={600}>
            {name.replace(/-/g, ' ')}
          </text>
          <text x={x + 8} y={y + 34} fill="rgba(255,255,255,0.7)" fontSize={11}>
            {formatTokens(value)} tokens
          </text>
        </>
      )}
    </g>
  )
}

export function TokenUsagePage() {
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [recent, setRecent] = useState<RecentCall[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<'total_tokens' | 'calls'>('total_tokens')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (isAuto = false) => {
    if (!isAuto) setLoading(true)
    setError(null)
    try {
      const [sumRes, recRes] = await Promise.all([
        fetch(`${PROXY_BASE}/api/token-usage/summary`),
        fetch(`${PROXY_BASE}/api/token-usage/recent?limit=50`)
      ])
      if (!sumRes.ok || !recRes.ok) throw new Error(`HTTP ${sumRes.status}/${recRes.status}`)
      const sumData = await sumRes.json()
      const recData = await recRes.json()
      setSummary(sumData)
      setRecent(recData.data || [])
    } catch (err) {
      setError('Failed to load token usage. Check that the LLM proxy is running on port 12435.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    intervalRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchData])

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!summary) return null

  // Prepare treemap data for process breakdown
  const treemapData = summary.by_process
    .filter(p => p.total_tokens > 0)
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .map(p => ({
      name: p.process,
      value: p.total_tokens,
      fill: getProcessColor(p.process),
      calls: p.calls,
      avgLatency: p.avg_latency,
    }))

  // Prepare timeline data (2-minute buckets, zero-filled by the backend).
  // The `hour` field arrives as full UTC ISO (e.g. 2026-05-15T12:06:00.000Z);
  // convert to the viewer's local time zone before stripping to HH:MM.
  const hourlyData = (summary.by_hour || []).map(h => ({
    hour: new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    input: h.input_tokens,
    output: h.output_tokens,
    calls: h.calls,
  }))

  // Sort process table
  const sortedProcesses = [...summary.by_process].sort((a, b) =>
    sortField === 'total_tokens' ? b.total_tokens - a.total_tokens : b.calls - a.calls
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Token Usage</h1>
          <p className="text-sm text-muted-foreground">
            LLM token consumption across all cognitive processes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            title="Provider/model routing per service"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            disabled={loading}
            aria-busy={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <TokenUsageSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        proxyBase={PROXY_BASE}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tokens</CardDescription>
            <CardTitle className="text-3xl">{formatTokens(summary.total_tokens)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground flex gap-3">
              <span className="text-blue-400">{formatTokens(summary.total_input)} in</span>
              <span className="text-emerald-400">{formatTokens(summary.total_output)} out</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Calls</CardDescription>
            <CardTitle className="text-3xl">{summary.total_calls}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {summary.by_provider.map(p => (
                <span key={p.provider} className="mr-3">
                  <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: getProviderColor(p.provider) }} />
                  {p.provider}: {p.calls}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Latency</CardDescription>
            <CardTitle className="text-3xl">{formatLatency(summary.avg_latency_ms)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              per LLM call
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Subscription</CardDescription>
            <CardTitle className="text-lg">
              {summary.by_subscription.map(s => (
                <div key={s.subscription} className="flex justify-between items-center">
                  <span className="text-sm">{SUBSCRIPTION_LABELS[s.subscription] || s.subscription}</span>
                  <Badge variant="secondary" className="text-xs">{formatTokens(s.total_tokens)}</Badge>
                </div>
              ))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Main content */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="processes">By Process</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="recent">Recent Calls</TabsTrigger>
        </TabsList>

        {/* Overview Tab - Treemap + Provider pie */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-3 gap-4">
            {/* Treemap - biggest consumers */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Token Consumption by Process
                </CardTitle>
                <CardDescription>
                  Larger area = more tokens consumed. Hover for details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <Treemap
                    data={treemapData}
                    dataKey="value"
                    aspectRatio={4 / 3}
                    content={<TreemapContent x={0} y={0} width={0} height={0} name="" value={0} fill="" />}
                  />
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Provider/Subscription pie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Provider</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={summary.by_provider.map(p => ({
                        name: p.provider,
                        value: p.total_tokens,
                        fill: getProviderColor(p.provider)
                      }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {summary.by_provider.map(p => (
                        <Cell key={p.provider} fill={getProviderColor(p.provider)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val: number) => formatTokens(val)} />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">By Model</h4>
                  {summary.by_model.map(m => (
                    <div key={m.model} className="flex justify-between items-center text-sm py-1">
                      <span className="text-muted-foreground truncate mr-2">{m.model}</span>
                      <span className="font-mono text-xs">{formatTokens(m.total_tokens)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Processes Tab - detailed table */}
        <TabsContent value="processes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Process Breakdown
              </CardTitle>
              <CardDescription>
                Cognitive processes ranked by token consumption
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => setSortField('calls')}>
                      <span className="flex items-center justify-end gap-1">
                        Calls <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => setSortField('total_tokens')}>
                      <span className="flex items-center justify-end gap-1">
                        Total <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">Avg Latency</TableHead>
                    <TableHead className="w-[200px]">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedProcesses.map(p => {
                    const pct = summary.total_tokens > 0
                      ? (p.total_tokens / summary.total_tokens * 100)
                      : 0
                    return (
                      <TableRow key={p.process}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-sm shrink-0"
                              style={{ backgroundColor: getProcessColor(p.process) }}
                            />
                            <span className="font-medium">{p.process}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{p.calls}</TableCell>
                        <TableCell className="text-right font-mono text-blue-400">{formatTokens(p.input_tokens)}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-400">{formatTokens(p.output_tokens)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatTokens(p.total_tokens)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatLatency(p.avg_latency)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: getProcessColor(p.process)
                                }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline Tab - hourly area chart */}
        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Token Usage Over Time</CardTitle>
              <CardDescription>2-minute input/output token consumption (gaps render as zero)</CardDescription>
            </CardHeader>
            <CardContent>
              {hourlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatTokens} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: number, name: string) => [formatTokens(val), name]}
                      labelStyle={{ color: '#999' }}
                      contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333' }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="input" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} name="Input Tokens" />
                    <Area type="monotone" dataKey="output" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} name="Output Tokens" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground py-12">
                  No timeline data available yet. Token usage will appear here as LLM calls are made.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recent Calls Tab */}
        <TabsContent value="recent" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent LLM Calls</CardTitle>
              <CardDescription>Last 50 calls across all processes</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map(call => (
                    <TableRow key={call.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(call.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={{ borderLeft: `3px solid ${getProcessColor(call.process)}` }}
                        >
                          {call.process}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs" style={{ color: getProviderColor(call.provider) }}>
                          {call.provider}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{call.model}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-blue-400">{formatTokens(call.input_tokens)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-400">{formatTokens(call.output_tokens)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatLatency(call.latency_ms)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {stripPromptPreview(call.prompt_preview)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
