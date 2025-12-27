'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Network,
  Database,
  GitBranch,
  Zap,
  Hash,
  Timer,
  ChevronRight,
  Layers,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react'

// API port for the system health API
const API_PORT = 3033

// Types for batch progress data
interface OperatorStatus {
  status: 'pending' | 'running' | 'completed' | 'failed'
  duration?: number
  progress?: number
}

interface CurrentBatch {
  id: string
  batchNumber: number
  commitRange: { start: string; end: string }
  startDate: string
  endDate: string
  startedAt?: string
  operators: Record<string, OperatorStatus>
}

interface AccumulatedStats {
  entities: number
  relations: number
  tokensUsed: number
}

interface BatchProgressData {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
  currentBatch: CurrentBatch | null
  completedBatches: number
  totalBatches: number
  accumulatedStats: AccumulatedStats
  pauseRequested?: boolean
  health?: string
  ageMs?: number
  lastUpdate?: string
  startedAt?: string
}

interface BatchCheckpoint {
  batchId: string
  batchNumber: number
  completedAt: string
  commitRange: { start: string; end: string }
  dateRange: { start: string; end: string }
  stats: {
    entitiesCreated: number
    entitiesUpdated: number
    relationsAdded: number
    tokenUsage: number
  }
}

interface OperatorDAGNode {
  id: string
  name: string
  shortName: string
  description: string
  tier: string
  status: string
  duration?: number
  progress?: number
  position: { row: number; col: number }
}

interface BatchProgressProps {
  onStatusChange?: (status: string) => void
}

// Operator definitions with icons
const OPERATORS = [
  { id: 'conv', name: 'Context Convolution', shortName: 'Conv', icon: Layers, tier: 'premium' },
  { id: 'aggr', name: 'Entity Aggregation', shortName: 'Aggr', icon: Network, tier: 'standard' },
  { id: 'embed', name: 'Node Embedding', shortName: 'Embed', icon: Hash, tier: 'fast' },
  { id: 'dedup', name: 'Deduplication', shortName: 'Dedup', icon: Database, tier: 'standard' },
  { id: 'pred', name: 'Edge Prediction', shortName: 'Pred', icon: TrendingUp, tier: 'premium' },
  { id: 'merge', name: 'Structure Merge', shortName: 'Merge', icon: GitBranch, tier: 'standard' },
]

// Tier colors
const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  fast: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  standard: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  premium: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
}

export default function BatchProgress({ onStatusChange }: BatchProgressProps) {
  const [progress, setProgress] = useState<BatchProgressData | null>(null)
  const [history, setHistory] = useState<BatchCheckpoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPausing, setIsPausing] = useState(false)
  const [isResuming, setIsResuming] = useState(false)

  // Fetch batch progress data
  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:${API_PORT}/api/batch/progress`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (data.status === 'success') {
        setProgress(data.data)
        onStatusChange?.(data.data.status)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [onStatusChange])

  // Fetch batch history
  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:${API_PORT}/api/batch/history?limit=10`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (data.status === 'success') {
        setHistory(data.data.checkpoints || [])
      }
    } catch (err) {
      console.warn('Failed to fetch batch history:', err)
    }
  }, [])

  // Polling for real-time updates
  useEffect(() => {
    fetchProgress()
    fetchHistory()

    const progressInterval = setInterval(fetchProgress, 3000)
    const historyInterval = setInterval(fetchHistory, 10000)

    return () => {
      clearInterval(progressInterval)
      clearInterval(historyInterval)
    }
  }, [fetchProgress, fetchHistory])

  // Handle pause
  const handlePause = async () => {
    setIsPausing(true)
    try {
      const response = await fetch(`http://localhost:${API_PORT}/api/batch/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (data.status === 'success') {
        fetchProgress()
      }
    } catch (err) {
      console.error('Failed to pause:', err)
    } finally {
      setIsPausing(false)
    }
  }

  // Handle resume
  const handleResume = async () => {
    setIsResuming(true)
    try {
      const response = await fetch(`http://localhost:${API_PORT}/api/batch/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (data.status === 'success') {
        fetchProgress()
      }
    } catch (err) {
      console.error('Failed to resume:', err)
    } finally {
      setIsResuming(false)
    }
  }

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'paused':
        return <Pause className="h-4 w-4 text-yellow-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  // Get status badge variant
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'paused':
        return <Badge className="bg-yellow-500">Paused</Badge>
      default:
        return <Badge variant="outline">Idle</Badge>
    }
  }

  // Format duration
  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${seconds % 60}s`
  }

  // Format tokens
  const formatTokens = (tokens: number) => {
    if (tokens < 1000) return `${tokens}`
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
    return `${(tokens / 1000000).toFixed(2)}M`
  }

  // Render operator node
  const renderOperatorNode = (op: typeof OPERATORS[0], operatorStatus?: OperatorStatus) => {
    const status = operatorStatus?.status || 'pending'
    const tierColors = TIER_COLORS[op.tier] || TIER_COLORS.standard
    const Icon = op.icon

    return (
      <Tooltip key={op.id}>
        <TooltipTrigger asChild>
          <div
            className={`
              relative flex flex-col items-center p-3 rounded-lg border-2 transition-all
              ${status === 'running' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : ''}
              ${status === 'completed' ? 'border-green-500 bg-green-50' : ''}
              ${status === 'failed' ? 'border-red-500 bg-red-50' : ''}
              ${status === 'pending' ? 'border-gray-200 bg-gray-50' : ''}
            `}
          >
            {/* Status indicator */}
            <div className="absolute -top-1 -right-1">
              {status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
              {status === 'completed' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
              {status === 'failed' && <XCircle className="h-3 w-3 text-red-500" />}
            </div>

            {/* Icon */}
            <Icon className={`h-5 w-5 mb-1 ${status === 'completed' ? 'text-green-600' : status === 'running' ? 'text-blue-600' : 'text-gray-500'}`} />

            {/* Name */}
            <span className="text-xs font-medium">{op.shortName}</span>

            {/* Tier badge */}
            <Badge className={`text-[8px] h-4 mt-1 ${tierColors.bg} ${tierColors.text} ${tierColors.border}`}>
              {op.tier}
            </Badge>

            {/* Duration */}
            {operatorStatus?.duration && (
              <span className="text-[10px] text-muted-foreground mt-0.5">
                {formatDuration(operatorStatus.duration)}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-medium">{op.name}</div>
            <div className="text-xs text-muted-foreground">
              {op.id === 'conv' && 'Enriches entity descriptions with temporal context from commits and sessions'}
              {op.id === 'aggr' && 'Assigns core/non-core roles based on significance scoring'}
              {op.id === 'embed' && 'Generates vector embeddings for similarity comparison'}
              {op.id === 'dedup' && 'Merges equivalent entities with role consistency'}
              {op.id === 'pred' && 'Predicts relationships using weighted scoring (α·cos + β·AA + γ·CA)'}
              {op.id === 'merge' && 'Fuses batch results into accumulated knowledge graph'}
            </div>
            <Separator className="my-1" />
            <div className="text-xs flex justify-between">
              <span>Tier:</span>
              <Badge className={`text-[8px] h-4 ${tierColors.bg} ${tierColors.text}`}>{op.tier}</Badge>
            </div>
            <div className="text-xs flex justify-between">
              <span>Status:</span>
              <span className="font-medium">{status}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          <span className="ml-2 text-muted-foreground">Loading batch progress...</span>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />
            <span>Error loading batch progress: {error}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  const overallProgress = progress?.totalBatches
    ? Math.round((progress.completedBatches / progress.totalBatches) * 100)
    : 0

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              <CardTitle className="text-lg">Batch Processing</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(progress?.status || 'idle')}
              {progress?.pauseRequested && (
                <Badge variant="outline" className="text-yellow-600 border-yellow-300">
                  Pause Requested
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Overall Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Batch Progress</span>
              <span className="font-medium">
                {progress?.completedBatches || 0} / {progress?.totalBatches || 0} batches
              </span>
            </div>
            <Progress value={overallProgress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{overallProgress}% complete</span>
              {progress?.lastUpdate && (
                <span>Updated {new Date(progress.lastUpdate).toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          <Separator />

          {/* Current Batch & Operator Pipeline */}
          {progress?.currentBatch && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm flex items-center gap-1">
                  <GitBranch className="h-4 w-4" />
                  Current Batch: {progress.currentBatch.id}
                </h4>
                <Badge variant="outline" className="text-xs">
                  #{progress.currentBatch.batchNumber}
                </Badge>
              </div>

              {/* Commit Range */}
              <div className="text-xs bg-slate-50 rounded p-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commits:</span>
                  <span className="font-mono">
                    {progress.currentBatch.commitRange.start.slice(0, 7)}...
                    {progress.currentBatch.commitRange.end.slice(0, 7)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date Range:</span>
                  <span>
                    {new Date(progress.currentBatch.startDate).toLocaleDateString()} -
                    {new Date(progress.currentBatch.endDate).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Operator Pipeline DAG */}
              <div className="space-y-2">
                <h5 className="text-xs font-medium text-muted-foreground">Tree-KG Operator Pipeline</h5>
                <div className="flex items-center justify-between gap-1 overflow-x-auto py-2">
                  {OPERATORS.map((op, idx) => (
                    <React.Fragment key={op.id}>
                      {renderOperatorNode(op, progress.currentBatch?.operators?.[op.id])}
                      {idx < OPERATORS.length - 1 && (
                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Idle State */}
          {(!progress?.currentBatch && progress?.status === 'idle') && (
            <div className="text-center py-4 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No batch processing in progress</p>
              <p className="text-xs">Start a batch workflow to see progress here</p>
            </div>
          )}

          <Separator />

          {/* Accumulated Stats */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm flex items-center gap-1">
              <Database className="h-4 w-4" />
              Accumulated Knowledge Graph
            </h4>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="bg-blue-50 rounded p-2 text-center">
                <div className="text-lg font-bold text-blue-700">
                  {progress?.accumulatedStats?.entities || 0}
                </div>
                <div className="text-xs text-blue-600">Entities</div>
              </div>
              <div className="bg-green-50 rounded p-2 text-center">
                <div className="text-lg font-bold text-green-700">
                  {progress?.accumulatedStats?.relations || 0}
                </div>
                <div className="text-xs text-green-600">Relations</div>
              </div>
              <div className="bg-purple-50 rounded p-2 text-center">
                <div className="text-lg font-bold text-purple-700">
                  {formatTokens(progress?.accumulatedStats?.tokensUsed || 0)}
                </div>
                <div className="text-xs text-purple-600">Tokens Used</div>
              </div>
            </div>
          </div>

          {/* Controls */}
          {(progress?.status === 'running' || progress?.status === 'paused') && (
            <>
              <Separator />
              <div className="flex gap-2">
                {progress.status === 'running' && !progress.pauseRequested && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePause}
                    disabled={isPausing}
                    className="flex-1"
                  >
                    {isPausing ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Pause className="h-4 w-4 mr-1" />
                    )}
                    Pause After Batch
                  </Button>
                )}
                {(progress.status === 'paused' || progress.pauseRequested) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResume}
                    disabled={isResuming}
                    className="flex-1"
                  >
                    {isResuming ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    Resume
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Recent Batch History */}
          {history.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-1">
                  <Timer className="h-4 w-4" />
                  Recent Batches
                </h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {history.slice(0, 5).map((batch) => (
                    <div
                      key={batch.batchId}
                      className="flex items-center justify-between text-xs bg-slate-50 rounded p-2"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        <span className="font-mono">{batch.batchId}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>{batch.stats.entitiesCreated} entities</span>
                        <span>|</span>
                        <span>{new Date(batch.completedAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}

// Compact batch progress indicator for use in other components
export function BatchProgressIndicator({ compact = false }: { compact?: boolean }) {
  const [progress, setProgress] = useState<BatchProgressData | null>(null)

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const response = await fetch(`http://localhost:${API_PORT}/api/batch/progress`)
        if (response.ok) {
          const data = await response.json()
          if (data.status === 'success') {
            setProgress(data.data)
          }
        }
      } catch (err) {
        // Silently fail for indicator
      }
    }

    fetchProgress()
    const interval = setInterval(fetchProgress, 5000)
    return () => clearInterval(interval)
  }, [])

  if (!progress || progress.status === 'idle') {
    return null
  }

  const percent = progress.totalBatches
    ? Math.round((progress.completedBatches / progress.totalBatches) * 100)
    : 0

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
        <span className="text-muted-foreground">
          Batch {progress.completedBatches}/{progress.totalBatches}
        </span>
        <Progress value={percent} className="w-16 h-1.5" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 p-2 bg-blue-50 rounded border border-blue-200">
      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      <div className="flex-1">
        <div className="text-xs font-medium">Batch Processing</div>
        <div className="text-[10px] text-muted-foreground">
          {progress.completedBatches}/{progress.totalBatches} batches ({percent}%)
        </div>
      </div>
      <Progress value={percent} className="w-20 h-2" />
    </div>
  )
}
