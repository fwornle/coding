'use client'

import React, { useMemo, useState } from 'react'
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
  outputs?: Record<string, any>
  error?: string
  startOffset: number // ms from workflow start
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

  // Convert steps to trace events with timing
  const { events, totalDuration, stats } = useMemo(() => {
    let offset = 0
    const traceEvents: TraceEventUI[] = []
    let totalTokens = 0
    let llmCalls = 0
    let completedCount = 0
    let failedCount = 0

    for (const step of steps) {
      const event: TraceEventUI = {
        id: step.name,
        name: step.name.replace(/_/g, ' '),
        status: step.status,
        duration: step.duration,
        tokensUsed: step.tokensUsed,
        llmProvider: step.llmProvider,
        outputs: step.outputs,
        error: step.error,
        startOffset: offset,
      }
      traceEvents.push(event)

      if (step.duration) {
        offset += step.duration
      }
      if (step.tokensUsed) {
        totalTokens += step.tokensUsed
        llmCalls++
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
    } else {
      newSet.add(id)
    }
    setExpandedIds(newSet)
  }

  const formatDuration = (ms?: number): string => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.round((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

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
                        onClick={() => setSelectedId(event.id)}
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

                        {/* Duration Bar - Waterfall style */}
                        <div className="flex-1 flex items-center gap-2">
                          {/* Offset spacer */}
                          <div
                            style={{
                              width: totalDuration > 0
                                ? `${(event.startOffset / totalDuration) * 100}%`
                                : '0%',
                            }}
                          />
                          {/* Duration bar */}
                          <div
                            className={`h-4 rounded ${getStatusColor(event.status)} opacity-80`}
                            style={{ width: `${barWidth}%`, minWidth: '4px' }}
                          />
                        </div>

                        {/* Duration text */}
                        <div className="w-20 text-right text-xs text-muted-foreground">
                          {formatDuration(event.duration)}
                        </div>

                        {/* LLM indicator */}
                        <div className="w-16 text-right">
                          {event.llmProvider && (
                            <Badge variant="outline" className="text-[10px] h-5">
                              {event.llmProvider === 'anthropic' ? 'Claude' : event.llmProvider}
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
