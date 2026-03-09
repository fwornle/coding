'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'

const API_PORT = process.env.SYSTEM_HEALTH_API_PORT || '3033'
const TRACE_API = `http://localhost:${API_PORT}/api/trace-history`
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Loader2,
  ArrowLeft,
  AlertTriangle,
  TrendingDown,
  Clock,
  XCircle,
  GitCompare,
  Database,
} from 'lucide-react'
import { WAVE_DISPLAY_NAMES } from './constants'

// ---------- Types ----------

interface TraceHistorySummary {
  filename: string
  workflowName: string
  startTime: string
  endTime: string
  status: string
  totalLLMCalls: number
  totalTokens: number
  entityCounts: { produced: number; persisted: number }
  // Phase 13: CGR query stats per run
  cgrStats?: { totalQueries: number; cacheHits: number; totalDurationMs: number }
}

interface TraceStepDetail {
  stepName: string
  wave?: number
  durationMs?: number
  llmCalls?: number
  tokensUsed?: number
  entityFlow?: { produced: number; passedQA?: number; persisted: number }
  status?: string
  // Phase 13: CGR queries per step
  cgrQueries?: number
  cgrCacheHits?: number
}

interface TraceDetail {
  workflowName: string
  startTime: string
  endTime: string
  status: string
  totalLLMCalls: number
  totalTokens: number
  entityCounts: { produced: number; persisted: number }
  stepsDetail?: TraceStepDetail[]
  // Phase 13: CGR stats
  cgrStats?: { totalQueries: number; cacheHits: number; totalDurationMs: number }
}

interface WaveComparison {
  waveName: string
  waveNumber: number
  a: { duration: number; llmCalls: number; tokens: number; produced: number; persisted: number; cgrQueries: number }
  b: { duration: number; llmCalls: number; tokens: number; produced: number; persisted: number; cgrQueries: number }
}

type AnomalyType = 'Entity drop' | 'Slow run' | 'Failed steps' | 'High rejection' | 'CGR regression'

interface AnomalyInfo {
  type: AnomalyType
  severity: 'amber' | 'red'
}

// ---------- Helpers ----------

function computeDurationMs(start: string, end: string): number {
  if (!start || !end) return 0
  return new Date(end).getTime() - new Date(start).getTime()
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatTimestamp(iso: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function detectAnomalies(
  trace: TraceHistorySummary,
  averages: { persisted: number; duration: number; rejectionRate: number; avgCgrQueries: number }
): AnomalyInfo[] {
  const anomalies: AnomalyInfo[] = []
  const duration = computeDurationMs(trace.startTime, trace.endTime)

  if (averages.persisted > 0 && trace.entityCounts.persisted < averages.persisted * 0.5) {
    anomalies.push({ type: 'Entity drop', severity: 'red' })
  }

  if (trace.status === 'failed' || trace.status === 'error') {
    anomalies.push({ type: 'Failed steps', severity: 'red' })
  }

  if (averages.duration > 0 && duration > averages.duration * 2) {
    anomalies.push({ type: 'Slow run', severity: 'amber' })
  }

  if (trace.entityCounts.produced > 0) {
    const rejection = (trace.entityCounts.produced - trace.entityCounts.persisted) / trace.entityCounts.produced
    if (rejection > 0.5) {
      anomalies.push({ type: 'High rejection', severity: 'amber' })
    }
  }

  // Phase 13: CGR integration regression detection
  if (averages.avgCgrQueries > 0 && trace.cgrStats) {
    if (trace.cgrStats.totalQueries < averages.avgCgrQueries * 0.5) {
      anomalies.push({ type: 'CGR regression', severity: 'amber' })
    }
  }

  return anomalies
}

function groupStepsByWave(steps: TraceStepDetail[]): Map<number, TraceStepDetail[]> {
  const map = new Map<number, TraceStepDetail[]>()
  for (const step of steps) {
    const wave = step.wave ?? 0
    if (!map.has(wave)) map.set(wave, [])
    map.get(wave)!.push(step)
  }
  return map
}

function aggregateWave(steps: TraceStepDetail[]): {
  duration: number; llmCalls: number; tokens: number; produced: number; persisted: number; cgrQueries: number
} {
  let duration = 0, llmCalls = 0, tokens = 0, produced = 0, persisted = 0, cgrQueries = 0
  for (const s of steps) {
    duration += s.durationMs || 0
    llmCalls += s.llmCalls || 0
    tokens += s.tokensUsed || 0
    cgrQueries += s.cgrQueries || 0
    if (s.entityFlow) {
      produced += s.entityFlow.produced || 0
      persisted += s.entityFlow.persisted || 0
    }
  }
  return { duration, llmCalls, tokens, produced, persisted, cgrQueries }
}

function deltaClass(a: number, b: number, lowerIsBetter: boolean): string {
  if (a === 0 && b === 0) return 'text-gray-400'
  const threshold = 0.1
  const pct = a > 0 ? (b - a) / a : (b > 0 ? 1 : 0)
  if (Math.abs(pct) < threshold) return 'text-gray-400'
  const bIsBetter = lowerIsBetter ? b < a : b > a
  return bIsBetter ? 'text-green-600' : 'text-red-600'
}

// ---------- Component ----------

export default function TraceHistoryPanel() {
  const [traces, setTraces] = useState<TraceHistorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'list' | 'compare'>('list')

  const [compareData, setCompareData] = useState<{ a: TraceDetail; b: TraceDetail } | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(TRACE_API)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: { traces: TraceHistorySummary[] }) => {
        if (!cancelled) {
          setTraces(data.traces || [])
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch trace history')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [])

  const averages = useMemo(() => {
    if (traces.length === 0) return { persisted: 0, duration: 0, rejectionRate: 0, avgCgrQueries: 0 }

    let totalPersisted = 0
    let totalDuration = 0
    let totalRejectionRate = 0
    let rejectionCount = 0
    let totalCgrQueries = 0
    let cgrRunCount = 0

    for (const t of traces) {
      totalPersisted += t.entityCounts.persisted
      totalDuration += computeDurationMs(t.startTime, t.endTime)
      if (t.entityCounts.produced > 0) {
        totalRejectionRate += (t.entityCounts.produced - t.entityCounts.persisted) / t.entityCounts.produced
        rejectionCount++
      }
      if (t.cgrStats && t.cgrStats.totalQueries > 0) {
        totalCgrQueries += t.cgrStats.totalQueries
        cgrRunCount++
      }
    }

    return {
      persisted: totalPersisted / traces.length,
      duration: totalDuration / traces.length,
      rejectionRate: rejectionCount > 0 ? totalRejectionRate / rejectionCount : 0,
      avgCgrQueries: cgrRunCount > 0 ? totalCgrQueries / cgrRunCount : 0,
    }
  }, [traces])

  const toggleSelect = useCallback((filename: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(filename)) {
        next.delete(filename)
      } else if (next.size < 2) {
        next.add(filename)
      }
      return next
    })
  }, [])

  const startCompare = useCallback(async () => {
    const filenames = Array.from(selected)
    if (filenames.length !== 2) return

    setCompareLoading(true)
    setError(null)

    try {
      const [resA, resB] = await Promise.all([
        fetch(`${TRACE_API}?file=${encodeURIComponent(filenames[0])}`),
        fetch(`${TRACE_API}?file=${encodeURIComponent(filenames[1])}`),
      ])

      if (!resA.ok || !resB.ok) throw new Error('Failed to fetch trace details')

      const [dataA, dataB] = await Promise.all([resA.json(), resB.json()])

      const timeA = new Date(dataA.startTime || '').getTime()
      const timeB = new Date(dataB.startTime || '').getTime()
      if (timeA <= timeB) {
        setCompareData({ a: dataA as TraceDetail, b: dataB as TraceDetail })
      } else {
        setCompareData({ a: dataB as TraceDetail, b: dataA as TraceDetail })
      }

      setMode('compare')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comparison')
    } finally {
      setCompareLoading(false)
    }
  }, [selected])

  const waveComparisons = useMemo((): WaveComparison[] => {
    if (!compareData) return []

    const stepsA = compareData.a.stepsDetail || []
    const stepsB = compareData.b.stepsDetail || []
    const wavesA = groupStepsByWave(stepsA)
    const wavesB = groupStepsByWave(stepsB)

    const allWaves = new Set([...wavesA.keys(), ...wavesB.keys()])
    const sorted = Array.from(allWaves).sort((x, y) => x - y)

    return sorted.map(waveNumber => {
      const waveName = WAVE_DISPLAY_NAMES[waveNumber] || `Wave ${waveNumber}`
      const a = aggregateWave(wavesA.get(waveNumber) || [])
      const b = aggregateWave(wavesB.get(waveNumber) || [])
      return { waveName, waveNumber, a, b }
    })
  }, [compareData])

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading trace history...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600">
        <AlertTriangle className="h-5 w-5 mr-2" />
        {error}
      </div>
    )
  }

  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        No trace history yet. Run a pipeline to generate traces.
      </div>
    )
  }

  // ---------- Comparison View ----------

  if (mode === 'compare' && compareData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setMode('list'); setCompareData(null) }}
            className="text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to list
          </Button>
          <span className="text-sm text-gray-500">
            Comparing {formatTimestamp(compareData.a.startTime)} vs {formatTimestamp(compareData.b.startTime)}
          </span>
        </div>

        <Separator />

        {/* Summary row */}
        <div className="grid grid-cols-2 gap-4">
          <CompareHeader label="Trace A (older)" trace={compareData.a} />
          <CompareHeader label="Trace B (newer)" trace={compareData.b} />
        </div>

        <Separator />

        {/* Wave-by-wave comparison */}
        <div>
          <div className="space-y-3">
            {waveComparisons.map(wc => (
              <WaveComparisonRow key={wc.waveNumber} data={wc} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ---------- List View ----------

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">
          {traces.length} trace{traces.length !== 1 ? 's' : ''} available
        </span>
        <Button
          size="sm"
          disabled={selected.size !== 2 || compareLoading}
          onClick={startCompare}
          className="bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
        >
          {compareLoading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <GitCompare className="h-4 w-4 mr-1" />
          )}
          Compare Selected
        </Button>
      </div>

      <div>
        <div className="space-y-1">
          {traces.map((trace, idx) => {
            const anomalies = detectAnomalies(trace, averages)
            const isSelected = selected.has(trace.filename)
            const duration = computeDurationMs(trace.startTime, trace.endTime)

            return (
              <div
                key={trace.filename}
                onClick={() => toggleSelect(trace.filename)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors border
                  ${isSelected
                    ? 'border-blue-400 bg-blue-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:bg-gray-50'}
                `}
              >
                {/* Checkbox */}
                <div className={`
                  w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center
                  ${isSelected ? 'bg-blue-600 border-blue-500' : 'border-gray-400'}
                `}>
                  {isSelected && <span className="text-white text-xs">&#10003;</span>}
                </div>

                {/* Date */}
                <span className="text-sm font-medium text-gray-900 w-32 flex-shrink-0">
                  {formatTimestamp(trace.startTime)}
                </span>

                {/* Status */}
                <Badge
                  variant="outline"
                  className={`text-xs flex-shrink-0 ${
                    trace.status === 'completed'
                      ? 'border-green-500 text-green-700 bg-green-50'
                      : trace.status === 'failed'
                      ? 'border-red-500 text-red-700 bg-red-50'
                      : 'border-gray-400 text-gray-600'
                  }`}
                >
                  {trace.status}
                </Badge>

                {/* Metrics */}
                <div className="flex items-center gap-4 text-xs text-gray-600 flex-1 min-w-0">
                  <span title="Duration">
                    <Clock className="h-3 w-3 inline mr-1 text-gray-400" />
                    {formatDuration(duration)}
                  </span>
                  <span title="LLM Calls">{trace.totalLLMCalls} calls</span>
                  <span title="Tokens">{(trace.totalTokens / 1000).toFixed(1)}k tok</span>
                  <span title="Entities">
                    {trace.entityCounts.persisted}/{trace.entityCounts.produced} entities
                  </span>
                  {trace.cgrStats && trace.cgrStats.totalQueries > 0 && (
                    <span title="CGR Queries" className="flex items-center gap-0.5">
                      <Database className="h-3 w-3 inline text-purple-400" />
                      {trace.cgrStats.totalQueries}q
                      {trace.cgrStats.cacheHits > 0 && (
                        <span className="text-green-600">({trace.cgrStats.cacheHits}h)</span>
                      )}
                    </span>
                  )}
                </div>

                {/* Anomaly badges */}
                <div className="flex gap-1 flex-shrink-0">
                  {anomalies.map((a, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className={`text-xs ${
                        a.severity === 'red'
                          ? 'border-red-400 text-red-700 bg-red-50'
                          : 'border-amber-400 text-amber-700 bg-amber-50'
                      }`}
                    >
                      {a.type === 'Entity drop' && <TrendingDown className="h-3 w-3 mr-1" />}
                      {a.type === 'Slow run' && <Clock className="h-3 w-3 mr-1" />}
                      {a.type === 'Failed steps' && <XCircle className="h-3 w-3 mr-1" />}
                      {a.type === 'CGR regression' && <Database className="h-3 w-3 mr-1" />}
                      {a.type}
                    </Badge>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------- Sub-components ----------

function CompareHeader({ label, trace }: { label: string; trace: TraceDetail }) {
  const duration = computeDurationMs(trace.startTime, trace.endTime)
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
      <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{formatTimestamp(trace.startTime)}</div>
      <div className="flex gap-3 text-xs text-gray-600">
        <span>{formatDuration(duration)}</span>
        <span>{trace.totalLLMCalls} LLM calls</span>
        <span>{(trace.totalTokens / 1000).toFixed(1)}k tokens</span>
        <span>
          {trace.entityCounts?.persisted ?? 0}/{trace.entityCounts?.produced ?? 0} entities
        </span>
        {trace.cgrStats && trace.cgrStats.totalQueries > 0 && (
          <span className="flex items-center gap-0.5">
            <Database className="h-3 w-3 text-purple-400" />
            {trace.cgrStats.totalQueries} CGR
          </span>
        )}
      </div>
      <Badge
        variant="outline"
        className={`text-xs mt-1 ${
          trace.status === 'completed'
            ? 'border-green-500 text-green-700 bg-green-50'
            : 'border-red-500 text-red-700 bg-red-50'
        }`}
      >
        {trace.status}
      </Badge>
    </div>
  )
}

function WaveComparisonRow({ data }: { data: WaveComparison }) {
  const { waveName, a, b } = data

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="text-sm font-semibold text-gray-900 mb-2">{waveName}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-xs">
        {/* Headers */}
        <div className="text-gray-500 text-center font-medium">Trace A</div>
        <div className="text-gray-500 text-center font-medium">Delta</div>
        <div className="text-gray-500 text-center font-medium">Trace B</div>

        {/* Duration */}
        <MetricCell value={formatDuration(a.duration)} />
        <DeltaCell a={a.duration} b={b.duration} suffix="" format={formatDuration} lowerIsBetter />
        <MetricCell value={formatDuration(b.duration)} />

        {/* LLM Calls */}
        <MetricCell value={`${a.llmCalls} calls`} />
        <DeltaCell a={a.llmCalls} b={b.llmCalls} suffix=" calls" lowerIsBetter />
        <MetricCell value={`${b.llmCalls} calls`} />

        {/* Tokens */}
        <MetricCell value={`${(a.tokens / 1000).toFixed(1)}k`} />
        <DeltaCell a={a.tokens} b={b.tokens} suffix="" format={v => `${(v / 1000).toFixed(1)}k`} lowerIsBetter />
        <MetricCell value={`${(b.tokens / 1000).toFixed(1)}k`} />

        {/* Entities produced */}
        <MetricCell value={`${a.produced} produced`} />
        <DeltaCell a={a.produced} b={b.produced} suffix="" lowerIsBetter={false} />
        <MetricCell value={`${b.produced} produced`} />

        {/* Entities persisted */}
        <MetricCell value={`${a.persisted} persisted`} />
        <DeltaCell a={a.persisted} b={b.persisted} suffix="" lowerIsBetter={false} />
        <MetricCell value={`${b.persisted} persisted`} />

        {/* CGR Queries (Phase 13) - only show if either trace has CGR data */}
        {(a.cgrQueries > 0 || b.cgrQueries > 0) && (
          <>
            <MetricCell value={`${a.cgrQueries} CGR`} />
            <DeltaCell a={a.cgrQueries} b={b.cgrQueries} suffix="" lowerIsBetter={false} />
            <MetricCell value={`${b.cgrQueries} CGR`} />
          </>
        )}
      </div>
    </div>
  )
}

function MetricCell({ value }: { value: string }) {
  return <div className="text-gray-700 text-center py-0.5">{value}</div>
}

function DeltaCell({
  a,
  b,
  suffix = '',
  lowerIsBetter,
  format,
}: {
  a: number
  b: number
  suffix?: string
  lowerIsBetter: boolean
  format?: (v: number) => string
}) {
  const diff = b - a
  if (diff === 0) {
    return <div className="text-gray-400 text-center py-0.5">-</div>
  }

  const cls = deltaClass(a, b, lowerIsBetter)
  const sign = diff > 0 ? '+' : ''
  const text = format ? `${sign}${format(Math.abs(diff))}` : `${sign}${diff}${suffix}`

  return (
    <div className={`text-center py-0.5 font-semibold ${cls}`}>
      {text}
    </div>
  )
}
