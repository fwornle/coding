'use client'

import React, { useMemo, useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
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
  AlertTriangle,
  RotateCcw,
  Users,
  ArrowRight,
  FileCode,
  Shield,
} from 'lucide-react'
import type {
  StepInfo,
  WaveGroup,
  TraceLLMCall,
  TraceAgentInstance,
  TraceEntityFlow,
  TraceQAResult,
} from '@/store/slices/ukbSlice'
import { Logger, LogCategories } from '@/utils/logging'
import {
  TIER_COLORS,
  AGENT_TYPE_COLORS,
  WAVE_DISPLAY_NAMES,
  STEP_CATEGORIES,
  STEP_DISPLAY_NAMES,
  shortenModel,
} from './constants'

// ---------- Props ----------

interface TraceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  steps: StepInfo[]
  workflowName: string
  startTime?: string
}

// ---------- Helpers ----------

const formatDuration = (ms?: number): string => {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

const getStatusIcon = (status: string, size = 'h-4 w-4') => {
  switch (status) {
    case 'completed':
    case 'success':
      return <CheckCircle2 className={`${size} text-green-500`} />
    case 'failed':
      return <XCircle className={`${size} text-red-500`} />
    case 'running':
      return <Loader2 className={`${size} text-blue-500 animate-spin`} />
    case 'retried':
      return <RotateCcw className={`${size} text-amber-500`} />
    case 'skipped':
      return <ChevronRight className={`${size} text-gray-400`} />
    default:
      return <Clock className={`${size} text-gray-400`} />
  }
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed': return 'bg-green-500'
    case 'failed': return 'bg-red-500'
    case 'running': return 'bg-blue-500'
    case 'skipped': return 'bg-gray-300'
    default: return 'bg-gray-200'
  }
}

/** Detect code evidence references in text and wrap them in <code> tags */
const renderWithCodeEvidence = (text: string): React.ReactNode => {
  if (!text) return null
  // Match file paths (containing / and ending in common extensions) and PascalCase identifiers
  const codePattern = /(\b[A-Za-z0-9_/.@-]*\/[A-Za-z0-9_/.@-]*\.(?:ts|tsx|js|jsx|py|rs|go|java|yaml|yml|json|md)\b|(?<![a-z])[A-Z][a-zA-Z0-9]{2,}(?:[A-Z][a-z][a-zA-Z0-9]*)+\b)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <code key={match.index} className="bg-zinc-800 px-1 rounded text-xs font-mono text-zinc-200">
        {match[0]}
      </code>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length > 0 ? <>{parts}</> : text
}

// ---------- Memoized sub-components ----------

/** Entity flow inline badge: "9 > 7 > 6" */
const EntityFlowBadge = React.memo(function EntityFlowBadge({ flow }: { flow: TraceEntityFlow }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span className="text-blue-400">{flow.produced}</span>
      <ArrowRight className="h-2.5 w-2.5 text-zinc-500" />
      <span className="text-amber-400">{flow.passedQA}</span>
      <ArrowRight className="h-2.5 w-2.5 text-zinc-500" />
      <span className="text-green-400">{flow.persisted}</span>
    </span>
  )
})

/** QA result badge */
const QABadge = React.memo(function QABadge({ qa }: { qa: TraceQAResult }) {
  const bgColor = qa.passed ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
  const textColor = qa.passed ? 'text-green-400' : 'text-red-400'
  return (
    <Badge variant="outline" className={`${bgColor} ${textColor} text-[10px] h-5`}>
      {qa.retried && <RotateCcw className="h-3 w-3 mr-1" />}
      {qa.passed ? 'PASS' : 'FAIL'} {qa.score.toFixed(1)}
    </Badge>
  )
})

/** LLM call row with expand-to-detail */
const LLMCallRow = React.memo(function LLMCallRow({
  call,
  isExpanded,
  onToggle,
}: {
  call: TraceLLMCall
  isExpanded: boolean
  onToggle: () => void
}) {
  const shortModel = shortenModel(call.model)
  const tierEntry = Object.entries(TIER_COLORS).find(([, v]) => {
    // Match by model name heuristic
    return false
  })
  // Default tier color based on model
  const modelColor = call.model.includes('sonnet') || call.model.includes('premium')
    ? TIER_COLORS.premium
    : call.model.includes('llama') && call.model.includes('70b')
      ? TIER_COLORS.standard
      : call.model.includes('llama') && call.model.includes('8b')
        ? TIER_COLORS.fast
        : TIER_COLORS.standard

  return (
    <div className="border border-zinc-700/50 rounded mb-1">
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-800/50 text-xs"
        onClick={onToggle}
      >
        {getStatusIcon(call.status, 'h-3.5 w-3.5')}
        <Badge className={`${modelColor.bg} ${modelColor.text} text-[10px] h-4 px-1.5`}>
          {shortModel}
        </Badge>
        <span className="text-zinc-400 truncate flex-1" title={call.purpose}>
          {call.purpose}
        </span>
        <span className="text-zinc-500 tabular-nums">{call.durationMs}ms</span>
        <span className="text-zinc-500 tabular-nums">{(call.tokensIn + call.tokensOut).toLocaleString()}t</span>
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </div>
      {isExpanded && (
        <div className="px-3 py-2 border-t border-zinc-700/50 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-400">
            <div>Provider: <span className="text-zinc-300">{call.provider}</span></div>
            <div>Model: <span className="text-zinc-300">{call.model}</span></div>
            <div>Tokens in: <span className="text-zinc-300">{call.tokensIn.toLocaleString()}</span></div>
            <div>Tokens out: <span className="text-zinc-300">{call.tokensOut.toLocaleString()}</span></div>
            <div>Duration: <span className="text-zinc-300">{call.durationMs}ms</span></div>
            <div>Status: <span className="text-zinc-300">{call.status}</span></div>
          </div>
          {call.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-red-400">
              {call.error}
            </div>
          )}
          {call.promptPreview && (
            <div>
              <div className="text-zinc-500 mb-1">Prompt preview:</div>
              <div className="bg-zinc-900 rounded p-2 font-mono text-[11px] text-zinc-300 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {renderWithCodeEvidence(call.promptPreview.slice(0, 500))}
              </div>
            </div>
          )}
          {call.responsePreview && (
            <div>
              <div className="text-zinc-500 mb-1">Response preview:</div>
              <div className="bg-zinc-900 rounded p-2 font-mono text-[11px] text-zinc-300 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {renderWithCodeEvidence(call.responsePreview.slice(0, 500))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/** Agent instance row */
const AgentInstanceRow = React.memo(function AgentInstanceRow({
  agent,
  isExpanded,
  onToggle,
  expandedLLMCalls,
  onToggleLLMCall,
  waveStart,
  waveDuration,
}: {
  agent: TraceAgentInstance
  isExpanded: boolean
  onToggle: () => void
  expandedLLMCalls: Set<string>
  onToggleLLMCall: (id: string) => void
  waveStart: number
  waveDuration: number
}) {
  const colors = AGENT_TYPE_COLORS[agent.agentType] || { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/30' }
  const agentStart = agent.startTime ? new Date(agent.startTime).getTime() : 0
  const agentEnd = agent.endTime ? new Date(agent.endTime).getTime() : agentStart
  const duration = agentEnd - agentStart
  const offsetPct = waveDuration > 0 ? Math.max(0, ((agentStart - waveStart) / waveDuration) * 100) : 0
  const widthPct = waveDuration > 0 ? Math.max(3, (duration / waveDuration) * 100) : 5

  return (
    <div className={`border ${colors.border} rounded mb-1`}>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-800/30 text-xs ${colors.bg}`}
        onClick={onToggle}
      >
        {getStatusIcon(agent.status, 'h-3.5 w-3.5')}
        <Badge variant="outline" className={`${colors.text} ${colors.border} text-[10px] h-4 px-1.5`}>
          {agent.agentType}
        </Badge>
        <span className={`truncate flex-1 ${colors.text}`} title={agent.parentEntity}>
          {agent.parentEntity}
        </span>
        <span className="text-zinc-500 text-[10px]">{agent.entityCount}e {agent.observationCount}o</span>
        <span className="text-zinc-500 tabular-nums text-[10px]">{formatDuration(duration)}</span>
        {agent.llmCalls.length > 0 && (
          <span className="text-zinc-500 text-[10px]">{agent.llmCalls.length} LLM</span>
        )}
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </div>
      {/* Waterfall bar for parallel visualization */}
      <div className="h-1.5 relative mx-2 mb-1">
        <div
          className={`absolute h-full rounded ${getStatusColor(agent.status)} opacity-60`}
          style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
        />
      </div>
      {isExpanded && (
        <div className="px-3 py-2 border-t border-zinc-700/30 space-y-1">
          {agent.llmCalls.length === 0 && (
            <div className="text-xs text-zinc-500 italic">No LLM calls (non-LLM agent)</div>
          )}
          {agent.llmCalls.map((call) => (
            <LLMCallRow
              key={call.id}
              call={call}
              isExpanded={expandedLLMCalls.has(call.id)}
              onToggle={() => onToggleLLMCall(call.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
})

// ---------- Main Component ----------

export function TraceModal({
  open,
  onOpenChange,
  steps,
  workflowName,
  startTime,
}: TraceModalProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedLevel, setSelectedLevel] = useState<{
    type: 'wave' | 'step' | 'agent'
    waveNumber?: number
    stepName?: string
    agentId?: string
  } | null>(null)

  // Log when trace modal opens
  useEffect(() => {
    if (open) {
      Logger.info(LogCategories.TRACE, `Trace modal opened for workflow: ${workflowName}`, {
        totalSteps: steps.length,
        hasTraceData: steps.some(s => s.wave !== undefined),
      })
    }
  }, [open, workflowName, steps])

  // Detect if new trace format is available
  const hasTraceData = useMemo(() => steps.some(s => s.wave !== undefined), [steps])

  // Compute wave groups from steps
  const waveGroups = useMemo((): WaveGroup[] => {
    if (!hasTraceData) return []

    const waveMap = new Map<number, StepInfo[]>()
    for (const step of steps) {
      const waveNum = step.wave ?? 0
      if (!waveMap.has(waveNum)) {
        waveMap.set(waveNum, [])
      }
      waveMap.get(waveNum)!.push(step)
    }

    const groups: WaveGroup[] = []
    for (const [waveNumber, waveSteps] of waveMap) {
      let totalDuration = 0
      let totalLLMCalls = 0
      let totalTokens = 0
      const entityFlow: TraceEntityFlow = { produced: 0, passedQA: 0, persisted: 0 }

      for (const step of waveSteps) {
        totalDuration += step.duration ?? 0
        totalLLMCalls += step.llmCalls ?? 0
        totalTokens += step.tokensUsed ?? 0
        if (step.entityFlow) {
          entityFlow.produced += step.entityFlow.produced
          entityFlow.passedQA += step.entityFlow.passedQA
          entityFlow.persisted += step.entityFlow.persisted
        }
      }

      groups.push({ waveNumber, steps: waveSteps, totalDuration, totalLLMCalls, totalTokens, entityFlow })
    }

    return groups.sort((a, b) => a.waveNumber - b.waveNumber)
  }, [steps, hasTraceData])

  // Aggregate stats
  const stats = useMemo(() => {
    let totalTokens = 0
    let llmCalls = 0
    let completedCount = 0
    let failedCount = 0

    for (const step of steps) {
      totalTokens += step.tokensUsed ?? 0
      llmCalls += step.llmCalls ?? 0
      if (step.status === 'completed') completedCount++
      if (step.status === 'failed') failedCount++
    }

    let totalDuration = 0
    if (hasTraceData) {
      for (const wg of waveGroups) {
        totalDuration += wg.totalDuration
      }
    } else {
      // Flat mode: sum durations
      for (const s of steps) {
        totalDuration += s.duration ?? 0
      }
    }

    return { totalTokens, llmCalls, completedCount, failedCount, totalSteps: steps.length, totalDuration }
  }, [steps, waveGroups, hasTraceData])

  // Expand/collapse handling
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        // Collapse this and all children
        for (const key of next) {
          if (key.startsWith(id)) next.delete(key)
        }
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Compute workflow start time for waterfall
  const workflowStartMs = useMemo(() => {
    if (startTime) return new Date(startTime).getTime()
    return steps.reduce((earliest, s) => {
      if (s.startTime) {
        const t = new Date(s.startTime).getTime()
        return t < earliest ? t : earliest
      }
      return earliest
    }, Infinity)
  }, [steps, startTime])

  // ---------- Render: Flat fallback for old data ----------

  if (!hasTraceData) {
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
              <span>Total: <strong>{formatDuration(stats.totalDuration)}</strong></span>
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

          {/* Flat step list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-1 pr-4">
              {steps.map((step, index) => {
                const displayName = STEP_DISPLAY_NAMES[step.name] || step.name.replace(/_/g, ' ')
                return (
                  <div key={`${index}-${step.name}`} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                    <div className="w-6 text-xs text-muted-foreground text-right">{index + 1}</div>
                    {getStatusIcon(step.status)}
                    <div className="w-48 truncate text-sm font-medium">{displayName}</div>
                    <div className="flex-1">
                      <div
                        className={`h-4 rounded opacity-80 ${getStatusColor(step.status)}`}
                        style={{ width: `${stats.totalDuration > 0 && step.duration ? Math.max(5, (step.duration / stats.totalDuration) * 100) : 5}%` }}
                      />
                    </div>
                    <div className="w-20 text-right text-xs text-muted-foreground">
                      {formatDuration(step.duration)}
                    </div>
                    {step.llmProvider && step.llmProvider !== 'none' && step.llmProvider !== 'pending' && (
                      <Badge variant="outline" className="text-[10px] h-5 truncate max-w-[90px]">
                        {shortenModel(step.llmProvider)}
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    )
  }

  // ---------- Render: 3-level nested trace ----------

  // Compute wave start times for waterfall positioning
  const getWaveStartMs = (wg: WaveGroup): number => {
    let earliest = Infinity
    for (const s of wg.steps) {
      if (s.startTime) {
        const t = new Date(s.startTime).getTime()
        if (t < earliest) earliest = t
      }
    }
    return earliest === Infinity ? 0 : earliest
  }

  // Selected detail context
  const selectedWave = selectedLevel?.type === 'wave'
    ? waveGroups.find(wg => wg.waveNumber === selectedLevel.waveNumber)
    : null
  const selectedStep = selectedLevel?.type === 'step'
    ? steps.find(s => s.name === selectedLevel.stepName)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1200px] h-[80vh] grid grid-rows-[auto_auto_1fr] gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Workflow Trace: {workflowName.replace(/-/g, ' ')}
          </DialogTitle>
          <DialogDescription>
            Hierarchical trace: Wave &gt; Step &gt; Agent with LLM call detail
          </DialogDescription>
        </DialogHeader>

        {/* Summary Stats Bar - enhanced with wave breakdown */}
        <div className="flex-shrink-0 space-y-2 border-b pb-3">
          {/* Wave-level breakdown */}
          <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
            {waveGroups.map((wg) => (
              <span key={wg.waveNumber} className="flex items-center gap-1">
                <span className="text-zinc-300 font-medium">
                  {WAVE_DISPLAY_NAMES[wg.waveNumber]?.split(':')[0] || `Wave ${wg.waveNumber}`}:
                </span>
                {wg.totalLLMCalls} calls, {formatDuration(wg.totalDuration)}
                {wg.waveNumber < waveGroups.length - 1 && <span className="text-zinc-600 ml-2">|</span>}
              </span>
            ))}
          </div>
          {/* Totals */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span>Total: <strong>{formatDuration(stats.totalDuration)}</strong></span>
            </div>
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
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{stats.completedCount}/{stats.totalSteps} steps</span>
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
          </div>
        </div>

        {/* Main Content: Tree + Detail Panel */}
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Left: 3-level tree */}
          <div className="flex-1 min-w-0">
            <ScrollArea className="h-full">
              <div className="space-y-1 pr-4">
                {waveGroups.map((wg) => {
                  const waveId = `wave-${wg.waveNumber}`
                  const isWaveExpanded = expandedIds.has(waveId)
                  const waveName = WAVE_DISPLAY_NAMES[wg.waveNumber] || `Wave ${wg.waveNumber}`
                  const waveStartMs = getWaveStartMs(wg)

                  return (
                    <div key={waveId}>
                      {/* Level 1: Wave row */}
                      <div
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                          selectedLevel?.type === 'wave' && selectedLevel.waveNumber === wg.waveNumber
                            ? 'bg-blue-500/10 border border-blue-500/30'
                            : 'hover:bg-zinc-800/30'
                        }`}
                        onClick={() => {
                          toggleExpand(waveId)
                          setSelectedLevel({ type: 'wave', waveNumber: wg.waveNumber })
                        }}
                      >
                        {isWaveExpanded
                          ? <ChevronDown className="h-4 w-4 text-zinc-400" />
                          : <ChevronRight className="h-4 w-4 text-zinc-400" />
                        }
                        <span className="font-medium text-sm flex-1">{waveName}</span>
                        {/* Wave metrics */}
                        <span className="text-xs text-zinc-500 tabular-nums">{formatDuration(wg.totalDuration)}</span>
                        <Badge variant="outline" className="text-[10px] h-5">
                          <Cpu className="h-3 w-3 mr-1" />{wg.totalLLMCalls}
                        </Badge>
                        {wg.totalTokens > 0 && (
                          <span className="text-[10px] text-zinc-500 tabular-nums">{wg.totalTokens.toLocaleString()}t</span>
                        )}
                        {/* Entity flow mini-badge */}
                        {(wg.entityFlow.produced > 0 || wg.entityFlow.persisted > 0) && (
                          <EntityFlowBadge flow={wg.entityFlow} />
                        )}
                      </div>

                      {/* Level 2: Steps within wave */}
                      {isWaveExpanded && (
                        <div className="ml-6 space-y-0.5">
                          {wg.steps.map((step) => {
                            const stepId = `${waveId}/step-${step.name}`
                            const isStepExpanded = expandedIds.has(stepId)
                            const displayName = STEP_DISPLAY_NAMES[step.name] || step.name.replace(/_/g, ' ')
                            const category = STEP_CATEGORIES[step.name]
                            const agentCount = step.agentInstances?.length ?? 0
                            const stepLabel = category === 'analyze' && agentCount > 0
                              ? `${displayName} (${agentCount} agents)`
                              : displayName

                            return (
                              <div key={stepId}>
                                <div
                                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-sm ${
                                    selectedLevel?.type === 'step' && selectedLevel.stepName === step.name
                                      ? 'bg-blue-500/10 border border-blue-500/30'
                                      : 'hover:bg-zinc-800/30'
                                  }`}
                                  onClick={() => {
                                    toggleExpand(stepId)
                                    setSelectedLevel({ type: 'step', stepName: step.name, waveNumber: wg.waveNumber })
                                  }}
                                >
                                  {(step.agentInstances && step.agentInstances.length > 0) || (step.llmCallEvents && step.llmCallEvents.length > 0) ? (
                                    isStepExpanded
                                      ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                                      : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                                  ) : (
                                    <span className="w-3.5" />
                                  )}
                                  {getStatusIcon(step.status, 'h-3.5 w-3.5')}
                                  <span className="flex-1 truncate">{stepLabel}</span>
                                  {step.llmCalls != null && step.llmCalls > 0 && (
                                    <span className="text-[10px] text-zinc-500">{step.llmCalls} LLM</span>
                                  )}
                                  <span className="text-xs text-zinc-500 tabular-nums w-16 text-right">
                                    {formatDuration(step.duration)}
                                  </span>
                                  {/* Entity flow on persist steps */}
                                  {category === 'persist' && step.entityFlow && (
                                    <EntityFlowBadge flow={step.entityFlow} />
                                  )}
                                  {/* QA badge */}
                                  {category === 'qa' && step.qaResult && (
                                    <QABadge qa={step.qaResult} />
                                  )}
                                  {step.error && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                                </div>

                                {/* Level 3: Agent instances or LLM calls */}
                                {isStepExpanded && (
                                  <div className="ml-6 py-1 space-y-0.5">
                                    {/* Agent instances */}
                                    {step.agentInstances && step.agentInstances.length > 0 && (
                                      step.agentInstances.map((agent) => {
                                        const agentNodeId = `${stepId}/agent-${agent.agentId}`
                                        return (
                                          <AgentInstanceRow
                                            key={agentNodeId}
                                            agent={agent}
                                            isExpanded={expandedIds.has(agentNodeId)}
                                            onToggle={() => toggleExpand(agentNodeId)}
                                            expandedLLMCalls={expandedIds}
                                            onToggleLLMCall={(callId) => toggleExpand(`${agentNodeId}/llm-${callId}`)}
                                            waveStart={waveStartMs}
                                            waveDuration={wg.totalDuration}
                                          />
                                        )
                                      })
                                    )}
                                    {/* Direct LLM calls (steps without agent instances) */}
                                    {(!step.agentInstances || step.agentInstances.length === 0) &&
                                      step.llmCallEvents && step.llmCallEvents.length > 0 && (
                                      step.llmCallEvents.map((call) => {
                                        const callNodeId = `${stepId}/llm-${call.id}`
                                        return (
                                          <LLMCallRow
                                            key={callNodeId}
                                            call={call}
                                            isExpanded={expandedIds.has(callNodeId)}
                                            onToggle={() => toggleExpand(callNodeId)}
                                          />
                                        )
                                      })
                                    )}
                                    {/* Non-LLM step with no agents */}
                                    {(!step.agentInstances || step.agentInstances.length === 0) &&
                                      (!step.llmCallEvents || step.llmCallEvents.length === 0) && (
                                      <div className="text-xs text-zinc-500 italic px-2 py-1">
                                        No LLM calls or agent instances
                                      </div>
                                    )}
                                    {/* Entity flow detail for persist steps */}
                                    {category === 'persist' && step.entityFlow && (
                                      <div className="px-2 py-1.5 bg-zinc-800/30 rounded text-xs space-y-1">
                                        <div className="flex items-center gap-3">
                                          <span className="text-blue-400">{step.entityFlow.produced} produced</span>
                                          <ArrowRight className="h-3 w-3 text-zinc-600" />
                                          <span className="text-amber-400">{step.entityFlow.passedQA} QA passed</span>
                                          <ArrowRight className="h-3 w-3 text-zinc-600" />
                                          <span className="text-green-400">{step.entityFlow.persisted} persisted</span>
                                        </div>
                                        {step.entityFlow.rejectedReasons && Object.keys(step.entityFlow.rejectedReasons).length > 0 && (
                                          <div className="text-red-400/80">
                                            Rejected: {Object.entries(step.entityFlow.rejectedReasons).map(([reason, count]) => (
                                              <span key={reason} className="mr-2">{count} {reason}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* QA detail */}
                                    {category === 'qa' && step.qaResult && (
                                      <div className={`px-2 py-1.5 rounded text-xs space-y-1 ${
                                        step.qaResult.passed ? 'bg-green-500/5 border border-green-500/20' : 'bg-red-500/5 border border-red-500/20'
                                      }`}>
                                        <div className="flex items-center gap-2">
                                          <Shield className="h-3.5 w-3.5" />
                                          <span className="font-medium">{step.qaResult.passed ? 'QA Passed' : 'QA Failed'}</span>
                                          <span className="text-zinc-500">Score: {step.qaResult.score.toFixed(2)}</span>
                                          {step.qaResult.retried && <Badge variant="outline" className="text-[9px] h-4"><RotateCcw className="h-2.5 w-2.5 mr-0.5" />retried</Badge>}
                                        </div>
                                        {step.qaResult.errors && step.qaResult.errors.length > 0 && (
                                          <ul className="list-disc list-inside text-red-400/80">
                                            {step.qaResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                                          </ul>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right: Context-aware detail panel */}
          <div className="w-80 flex-shrink-0 border-l pl-4">
            <ScrollArea className="h-full">
              {!selectedLevel && (
                <div className="text-sm text-zinc-500 italic pt-4">
                  Click a wave, step, or agent to see details
                </div>
              )}

              {/* Wave-level detail */}
              {selectedLevel?.type === 'wave' && selectedWave && (
                <div className="space-y-4">
                  <h3 className="font-medium text-sm">
                    {WAVE_DISPLAY_NAMES[selectedWave.waveNumber] || `Wave ${selectedWave.waveNumber}`}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-zinc-500">Duration</div>
                    <div>{formatDuration(selectedWave.totalDuration)}</div>
                    <div className="text-zinc-500">LLM Calls</div>
                    <div>{selectedWave.totalLLMCalls}</div>
                    <div className="text-zinc-500">Tokens</div>
                    <div>{selectedWave.totalTokens.toLocaleString()}</div>
                    <div className="text-zinc-500">Steps</div>
                    <div>{selectedWave.steps.length}</div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Entity Flow</h4>
                    <div className="flex items-center gap-2 text-sm">
                      <div className="flex flex-col items-center px-3 py-2 bg-blue-500/10 rounded">
                        <span className="text-lg font-bold text-blue-400">{selectedWave.entityFlow.produced}</span>
                        <span className="text-[10px] text-zinc-500">produced</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-zinc-600" />
                      <div className="flex flex-col items-center px-3 py-2 bg-amber-500/10 rounded">
                        <span className="text-lg font-bold text-amber-400">{selectedWave.entityFlow.passedQA}</span>
                        <span className="text-[10px] text-zinc-500">QA passed</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-zinc-600" />
                      <div className="flex flex-col items-center px-3 py-2 bg-green-500/10 rounded">
                        <span className="text-lg font-bold text-green-400">{selectedWave.entityFlow.persisted}</span>
                        <span className="text-[10px] text-zinc-500">persisted</span>
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Steps</h4>
                    {selectedWave.steps.map((s) => (
                      <div key={s.name} className="flex items-center gap-2 text-xs py-1">
                        {getStatusIcon(s.status, 'h-3 w-3')}
                        <span className="flex-1">{STEP_DISPLAY_NAMES[s.name] || s.name}</span>
                        <span className="text-zinc-500">{formatDuration(s.duration)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step-level detail */}
              {selectedLevel?.type === 'step' && selectedStep && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium text-sm flex items-center gap-2">
                      {getStatusIcon(selectedStep.status)}
                      {STEP_DISPLAY_NAMES[selectedStep.name] || selectedStep.name}
                    </h3>
                    <Badge variant={selectedStep.status === 'completed' ? 'default' : 'secondary'} className="mt-1">
                      {selectedStep.status}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-zinc-500">Duration</div>
                    <div>{formatDuration(selectedStep.duration)}</div>
                    {selectedStep.llmCalls != null && (
                      <>
                        <div className="text-zinc-500">LLM Calls</div>
                        <div>{selectedStep.llmCalls}</div>
                      </>
                    )}
                    {selectedStep.tokensUsed != null && selectedStep.tokensUsed > 0 && (
                      <>
                        <div className="text-zinc-500">Tokens</div>
                        <div>{selectedStep.tokensUsed.toLocaleString()}</div>
                      </>
                    )}
                    {selectedStep.llmProvider && selectedStep.llmProvider !== 'none' && (
                      <>
                        <div className="text-zinc-500">Provider</div>
                        <div>{selectedStep.llmProvider}</div>
                      </>
                    )}
                  </div>
                  {/* Agent list */}
                  {selectedStep.agentInstances && selectedStep.agentInstances.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-1">
                        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                          <Users className="h-3 w-3" /> Agents ({selectedStep.agentInstances.length})
                        </h4>
                        {selectedStep.agentInstances.map((agent) => {
                          const colors = AGENT_TYPE_COLORS[agent.agentType] || { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/30' }
                          return (
                            <div key={agent.agentId} className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${colors.bg}`}>
                              {getStatusIcon(agent.status, 'h-3 w-3')}
                              <span className={`flex-1 truncate ${colors.text}`}>{agent.parentEntity}</span>
                              <span className="text-zinc-500">{agent.entityCount}e</span>
                              <span className="text-zinc-500">{agent.llmCalls.length} LLM</span>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                  {/* Entity flow for persist steps */}
                  {selectedStep.entityFlow && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Entity Flow</h4>
                        <div className="flex items-center gap-2 text-sm">
                          <div className="flex flex-col items-center px-2 py-1.5 bg-blue-500/10 rounded">
                            <span className="font-bold text-blue-400">{selectedStep.entityFlow.produced}</span>
                            <span className="text-[9px] text-zinc-500">produced</span>
                          </div>
                          <ArrowRight className="h-3 w-3 text-zinc-600" />
                          <div className="flex flex-col items-center px-2 py-1.5 bg-amber-500/10 rounded">
                            <span className="font-bold text-amber-400">{selectedStep.entityFlow.passedQA}</span>
                            <span className="text-[9px] text-zinc-500">QA'd</span>
                          </div>
                          <ArrowRight className="h-3 w-3 text-zinc-600" />
                          <div className="flex flex-col items-center px-2 py-1.5 bg-green-500/10 rounded">
                            <span className="font-bold text-green-400">{selectedStep.entityFlow.persisted}</span>
                            <span className="text-[9px] text-zinc-500">persisted</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {/* QA result */}
                  {selectedStep.qaResult && (
                    <>
                      <Separator />
                      <div className={`p-2 rounded text-xs space-y-1 ${
                        selectedStep.qaResult.passed ? 'bg-green-500/5 border border-green-500/20' : 'bg-red-500/5 border border-red-500/20'
                      }`}>
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          <span className="font-medium">{selectedStep.qaResult.passed ? 'QA Passed' : 'QA Failed'}</span>
                          <span>Score: {selectedStep.qaResult.score.toFixed(2)}</span>
                        </div>
                        {selectedStep.qaResult.errors && selectedStep.qaResult.errors.length > 0 && (
                          <ul className="list-disc list-inside text-red-400/80 mt-1">
                            {selectedStep.qaResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                  {/* Error */}
                  {selectedStep.error && (
                    <>
                      <Separator />
                      <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                        {selectedStep.error}
                      </div>
                    </>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
