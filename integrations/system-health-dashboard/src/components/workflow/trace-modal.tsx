'use client'

import React, { useMemo, useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Clock,
  Cpu,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  Zap,
  FileJson,
} from 'lucide-react'
import type { StepInfo } from '@/store/slices/ukbSlice'
import { Logger, LogCategories } from '@/utils/logging'
import { TIER_COLORS, TIER_MODELS, AGENT_SUBSTEPS, STEP_TO_AGENT, shortenModel } from './constants'

interface TraceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  steps: StepInfo[]
  workflowName: string
  startTime?: string
}

interface TraceEventUI {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  duration?: number
  tokensUsed?: number
  llmProvider?: string
  llmCalls?: number
  outputs?: Record<string, any>
  error?: string
  startOffset: number // ms from workflow start
  llmTier?: string    // fast/standard/premium/none — for bar coloring
}

export function TraceModal({
  open,
  onOpenChange,
  steps,
  workflowName,
  startTime,
}: TraceModalProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Log when trace modal opens
  useEffect(() => {
    if (open) {
      Logger.info(LogCategories.TRACE, `Trace modal opened for workflow: ${workflowName}`, {
        totalSteps: steps.length,
        completed: steps.filter(s => s.status === 'completed').length,
        running: steps.filter(s => s.status === 'running').length,
        failed: steps.filter(s => s.status === 'failed').length,
      })
    }
  }, [open, workflowName, steps])

  // Resolve LLM tier for a step name from AGENT_SUBSTEPS definitions
  const resolveStepTier = (stepName: string): string | undefined => {
    // Check if stepName maps to an agent+substep
    const agentId = STEP_TO_AGENT[stepName]
    if (!agentId) return undefined
    const substeps = AGENT_SUBSTEPS[agentId]
    if (!substeps) return undefined
    // Find the matching substep by checking substep IDs in STEP_TO_SUBSTEP-style patterns
    // The step name often contains the substep id as a suffix
    for (const sub of substeps) {
      if (stepName.includes(sub.id) || stepName === agentId) {
        return sub.llmUsage || 'none'
      }
    }
    // If step maps to an agent but not a specific substep, check if ALL substeps use same tier
    const tiers = new Set(substeps.map(s => s.llmUsage || 'none'))
    if (tiers.size === 1) return substeps[0].llmUsage || 'none'
    return 'standard' // Mixed tiers, default to standard
  }

  // Convert steps to trace events with timing
  const { events, totalDuration, stats } = useMemo(() => {
    let offset = 0
    const traceEvents: TraceEventUI[] = []
    let totalTokens = 0
    let llmCalls = 0
    let completedCount = 0
    let failedCount = 0

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const event: TraceEventUI = {
        id: `${i}-${step.name}`, // Unique ID combining index and name to handle batch duplicates
        name: step.name.replace(/_/g, ' '),
        status: step.status,
        duration: step.duration,
        tokensUsed: step.tokensUsed,
        llmProvider: step.llmProvider,
        llmCalls: step.llmCalls,
        outputs: step.outputs,
        error: step.error,
        startOffset: offset,
        llmTier: resolveStepTier(step.name),
      }
      traceEvents.push(event)

      if (step.duration) {
        offset += step.duration
      }
      if (step.tokensUsed) {
        totalTokens += step.tokensUsed
        // Use actual LLM call count from backend if available, otherwise count step as 1 call
        llmCalls += step.llmCalls || 1
      }
      if (step.status === 'completed') completedCount++
      if (step.status === 'failed') failedCount++
    }

    return {
      events: traceEvents,
      totalDuration: offset,
      stats: {
        totalTokens,
        llmCalls,
        completedCount,
        failedCount,
        totalSteps: steps.length,
      },
    }
  }, [steps])

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
      Logger.debug(LogCategories.TRACE, `Collapsed step details: ${id}`)
    } else {
      newSet.add(id)
      const event = events.find(e => e.id === id)
      Logger.debug(LogCategories.TRACE, `Expanded step details: ${id}`, {
        status: event?.status,
        duration: event?.duration,
        outputs: event?.outputs ? Object.keys(event.outputs) : [],
      })
    }
    setExpandedIds(newSet)
  }

  const handleSelectStep = (id: string) => {
    const event = events.find(e => e.id === id)
    Logger.info(LogCategories.TRACE, `Selected step: ${id}`, {
      status: event?.status,
      duration: event?.duration ? `${event.duration}ms` : '-',
      llmProvider: event?.llmProvider || 'none',
      tokensUsed: event?.tokensUsed || 0,
      hasOutputs: event?.outputs ? Object.keys(event.outputs).length > 0 : false,
      hasError: !!event?.error,
    })
    setSelectedId(id)
  }

  const formatDuration = (ms?: number): string => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.round((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  // Format model name for display - show model@provider when possible
  const formatModelName = (modelOrProvider: string): string => {
    // Already formatted as model@provider from backend
    if (modelOrProvider.includes('@')) {
      // Shorten model part: claude-sonnet-4-5@claude-code → sonnet@claude-code
      const [model, provider] = modelOrProvider.split('@', 2)
      const shortModel = shortenModel(model)
      const result = `${shortModel}@${provider}`
      return result.length > 18 ? result.slice(0, 18) : result
    }

    // Handle aggregated provider lists like "groq, ollama"
    if (modelOrProvider.includes(', ')) return 'multi-llm'

    // Single model or provider name — shorten
    return shortenModel(modelOrProvider)
  }

  // shortenModel is now imported from constants

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case 'skipped':
        return <ChevronRight className="h-4 w-4 text-gray-400" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
        return 'bg-green-500'
      case 'failed':
        return 'bg-red-500'
      case 'running':
        return 'bg-blue-500'
      case 'skipped':
        return 'bg-gray-300'
      default:
        return 'bg-gray-200'
    }
  }

  const selectedEvent = selectedId ? events.find((e) => e.id === selectedId) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1200px] h-[80vh] grid grid-rows-[auto_1fr] gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Workflow Trace: {workflowName.replace(/-/g, ' ')}
          </DialogTitle>
          <DialogDescription>
            Timeline view of agent execution with timing and LLM metrics
          </DialogDescription>
        </DialogHeader>

        {/* Stats Bar */}
        <div className="flex-shrink-0 flex items-center gap-6 text-sm border-b pb-3">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <span>Total: <strong>{formatDuration(totalDuration)}</strong></span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>{stats.completedCount} completed</span>
          </div>
          {stats.failedCount > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>{stats.failedCount} failed</span>
              </div>
            </>
          )}
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-purple-500" />
            <span>{stats.llmCalls} LLM calls</span>
          </div>
          {stats.totalTokens > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <span>{stats.totalTokens.toLocaleString()} tokens</span>
              </div>
            </>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Timeline Panel */}
          <div className="flex-1 min-w-0">
            <ScrollArea className="h-full">
              <div className="space-y-1 pr-4">
                {events.map((event, index) => {
                  const isExpanded = expandedIds.has(event.id)
                  const isSelected = selectedId === event.id
                  // Calculate bar width based on duration relative to total
                  const barWidth = totalDuration > 0 && event.duration
                    ? Math.max(5, (event.duration / totalDuration) * 100)
                    : 5

                  return (
                    <div key={event.id} className="group">
                      {/* Timeline Row */}
                      <div
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50 border border-blue-200'
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => handleSelectStep(event.id)}
                      >
                        {/* Index */}
                        <div className="w-6 text-xs text-muted-foreground text-right">
                          {index + 1}
                        </div>

                        {/* Status Icon */}
                        {getStatusIcon(event.status)}

                        {/* Name */}
                        <div className="w-48 truncate text-sm font-medium" title={event.name}>
                          {event.name}
                        </div>

                        {/* Duration Bar - Waterfall style, tier-colored for completed steps */}
                        <div className="flex-1 flex items-center gap-2">
                          {/* Offset spacer */}
                          <div
                            style={{
                              width: totalDuration > 0
                                ? `${(event.startOffset / totalDuration) * 100}%`
                                : '0%',
                            }}
                          />
                          {/* Duration bar: use tier color for completed steps, status color otherwise */}
                          <div
                            className={`h-4 rounded opacity-80 ${
                              event.status === 'completed' && event.llmTier
                                ? (TIER_COLORS[event.llmTier]?.bar || 'bg-green-500')
                                : getStatusColor(event.status)
                            }`}
                            style={{ width: `${barWidth}%`, minWidth: '4px' }}
                            title={event.llmTier ? `${event.llmTier} tier` : undefined}
                          />
                        </div>

                        {/* Duration text */}
                        <div className="w-20 text-right text-xs text-muted-foreground">
                          {formatDuration(event.duration)}
                        </div>

                        {/* LLM indicator - show specific model name with fallback warning */}
                        <div className="w-24 text-right">
                          {(event.llmProvider || event.llmTier) && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] h-5 truncate max-w-[90px] ${
                                (event as any).llmModeFallback ? 'border-orange-400 text-orange-600' : ''
                              }`}
                              title={
                                (event as any).llmModeFallback
                                  ? `Fallback: intended ${(event as any).llmIntendedMode}, actual ${(event as any).llmActualMode} (${event.llmProvider})`
                                  : event.llmProvider || (event.llmTier ? `${event.llmTier} tier` : '')
                              }
                            >
                              {(event as any).llmModeFallback && '⚠️ '}
                              {event.llmProvider
                                ? formatModelName(event.llmProvider)
                                : TIER_MODELS[event.llmTier || ''] || event.llmTier}
                            </Badge>
                          )}
                        </div>

                        {/* Expand button */}
                        {event.outputs && Object.keys(event.outputs).length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpand(event.id)
                            }}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Expanded Output */}
                      {isExpanded && event.outputs && (
                        <div className="ml-10 p-3 bg-muted/30 rounded text-xs font-mono overflow-x-auto">
                          <pre className="whitespace-pre-wrap">
                            {JSON.stringify(event.outputs, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Error message */}
                      {event.error && (
                        <div className="ml-10 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                          {event.error}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Details Panel */}
          {selectedEvent && (
            <div className="w-80 flex-shrink-0 border-l pl-4">
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium flex items-center gap-2">
                    {getStatusIcon(selectedEvent.status)}
                    {selectedEvent.name}
                  </h3>
                  <Badge
                    variant={selectedEvent.status === 'completed' ? 'default' : 'secondary'}
                    className="mt-1"
                  >
                    {selectedEvent.status}
                  </Badge>
                </div>

                <Separator />

                {/* Timing */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Timer className="h-4 w-4" />
                    Timing
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted-foreground">Duration</div>
                    <div>{formatDuration(selectedEvent.duration)}</div>
                    <div className="text-muted-foreground">Start Offset</div>
                    <div>{formatDuration(selectedEvent.startOffset)}</div>
                  </div>
                </div>

                {/* LLM Metrics */}
                {selectedEvent.llmProvider && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Cpu className="h-4 w-4" />
                        LLM Metrics
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-muted-foreground">Provider</div>
                        <div>{selectedEvent.llmProvider}</div>
                        {selectedEvent.tokensUsed && (
                          <>
                            <div className="text-muted-foreground">Tokens Used</div>
                            <div>{selectedEvent.tokensUsed.toLocaleString()}</div>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Output Preview */}
                {selectedEvent.outputs && Object.keys(selectedEvent.outputs).length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <FileJson className="h-4 w-4" />
                        Output
                      </h4>
                      <ScrollArea className="h-48">
                        <pre className="text-xs font-mono bg-muted/50 p-2 rounded whitespace-pre-wrap">
                          {JSON.stringify(selectedEvent.outputs, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                  </>
                )}

                {/* Error */}
                {selectedEvent.error && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2 text-red-600">
                        <XCircle className="h-4 w-4" />
                        Error
                      </h4>
                      <div className="text-sm text-red-700 bg-red-50 p-2 rounded">
                        {selectedEvent.error}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
