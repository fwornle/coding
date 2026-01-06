'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Brain,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Timer,
  Server,
  GitBranch,
  Folder,
  History,
  FileText,
  RefreshCw,
  Trash2,
  BarChart3,
  MessageSquare,
  Network,
  StopCircle,
  Activity,
} from 'lucide-react'
import { MultiAgentGraph as UKBWorkflowGraph, WorkflowLegend, TraceModal, STEP_TO_AGENT } from './workflow'
import { UKBNodeDetailsSidebar } from './ukb-workflow-graph'
import type { RootState } from '@/store'
import { Logger, LogCategories } from '@/utils/logging'
import {
  setActiveTab,
  setSelectedProcessIndex,
  setSelectedNode,
  fetchHistoryStart,
  fetchHistorySuccess,
  fetchHistoryFailure,
  selectHistoricalWorkflow,
  fetchDetailStart,
  fetchDetailSuccess,
  fetchDetailFailure,
  fetchStatisticsStart,
  fetchStatisticsSuccess,
  fetchStatisticsFailure,
  selectCurrentProcess,
  selectHistoricalProcessInfo,
  selectBatchSummary,
  selectAccumulatedStats,
  selectPersistedKnowledge,
  selectStepTimingStatistics,
  type HistoricalWorkflow,
  type UKBProcess,
  type StepTimingStatistics,
  type StepInfo,
} from '@/store/slices/ukbSlice'

interface UKBWorkflowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  processes: UKBProcess[]
  apiBaseUrl?: string
}

// Helper to calculate median from an array of numbers (more robust than mean for outliers)
function calculateMedian(values: number[]): number {
  if (!values || values.length === 0) return 0
  const sorted = [...values].filter(v => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export default function UKBWorkflowModal({ open, onOpenChange, processes, apiBaseUrl = 'http://localhost:3033' }: UKBWorkflowModalProps) {
  const dispatch = useDispatch()

  // Redux state
  const selectedProcessIndex = useSelector((state: RootState) => state.ukb.selectedProcessIndex)
  const selectedNode = useSelector((state: RootState) => state.ukb.selectedNode)
  const activeTab = useSelector((state: RootState) => state.ukb.activeTab)
  const historicalWorkflows = useSelector((state: RootState) => state.ukb.historicalWorkflows)
  const loadingHistory = useSelector((state: RootState) => state.ukb.loadingHistory)
  const selectedHistoricalWorkflowState = useSelector((state: RootState) => state.ukb.selectedHistoricalWorkflow)
  const historicalWorkflowDetail = useSelector((state: RootState) => state.ukb.historicalWorkflowDetail)
  const loadingDetail = useSelector((state: RootState) => state.ukb.loadingDetail)

  // Memoized selectors
  const currentProcess = useSelector(selectCurrentProcess)
  const historicalProcessInfo = useSelector(selectHistoricalProcessInfo)
  const batchSummary = useSelector(selectBatchSummary)
  const accumulatedStats = useSelector(selectAccumulatedStats)
  const persistedKnowledge = useSelector(selectPersistedKnowledge)
  const stepTimingStatistics = useSelector(selectStepTimingStatistics)

  // Fetch step timing statistics on mount (for learned progress estimation)
  useEffect(() => {
    const fetchStatistics = async () => {
      Logger.debug(LogCategories.API, 'Fetching workflow statistics')
      dispatch(fetchStatisticsStart())
      try {
        const response = await fetch(`${apiBaseUrl}/api/workflows/statistics`)
        if (response.ok) {
          const result = await response.json()
          Logger.debug(LogCategories.API, 'Workflow statistics loaded', { sampleCount: result.data?.workflowTypes })
          dispatch(fetchStatisticsSuccess(result.data))
        } else {
          Logger.warn(LogCategories.API, `Failed to fetch statistics: HTTP ${response.status}`)
          dispatch(fetchStatisticsFailure())
        }
      } catch (error) {
        Logger.error(LogCategories.API, 'Error fetching statistics', error)
        dispatch(fetchStatisticsFailure())
      }
    }
    fetchStatistics()
  }, [dispatch, apiBaseUrl])

  // Derived state
  const showSidebar = selectedNode !== null && activeTab === 'active'
  const showHistoricalSidebar = selectedNode !== null && activeTab === 'history'

  // Cancel workflow state
  const [cancelLoading, setCancelLoading] = useState(false)

  // Trace modal state
  const [traceModalOpen, setTraceModalOpen] = useState(false)

  // Cancel/clear a stuck or frozen workflow
  const handleCancelWorkflow = async (e: React.MouseEvent) => {
    // Prevent event bubbling which could close the modal
    e.stopPropagation()
    e.preventDefault()

    Logger.info(LogCategories.UKB, 'Cancel workflow requested by user')

    // Confirm before cancelling
    if (!window.confirm('Are you sure you want to cancel the workflow? This will kill the running process.')) {
      Logger.debug(LogCategories.UKB, 'Cancel workflow aborted by user')
      return
    }

    setCancelLoading(true)
    try {
      Logger.info(LogCategories.API, 'Cancelling workflow via API', { url: `${apiBaseUrl}/api/ukb/cancel` })
      const response = await fetch(`${apiBaseUrl}/api/ukb/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ killProcesses: true })
      })
      const data = await response.json()
      if (data.status === 'success') {
        Logger.info(LogCategories.UKB, 'Workflow cancelled successfully', data.data)
        // Refresh after short delay to show updated state
        setTimeout(() => window.location.reload(), 1500)
      } else {
        Logger.error(LogCategories.UKB, 'Failed to cancel workflow', { message: data.message })
        alert(`Failed to cancel workflow: ${data.message || 'Unknown error'}`)
      }
    } catch (error) {
      Logger.error(LogCategories.UKB, 'Error cancelling workflow', error)
      alert(`Error cancelling workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setCancelLoading(false)
    }
  }

  // Create a signature for change detection - ensures re-renders when process data changes
  // This captures key fields that affect display: pid, status, completedSteps, _refreshKey
  // Also include steps signature for real-time step status updates
  const processesSignature = useMemo(() => {
    return processes.map(p => {
      const stepsInfo = p.steps?.map(s => `${s.name}:${s.status}`).join(',') || ''
      return `${p.pid}:${p.status}:${p.completedSteps}:${p.currentStep || ''}:${p._refreshKey || ''}:${stepsInfo}`
    }).join('|')
  }, [processes])

  // Filter to only include truly active (running) processes
  // Completed/failed workflows should move to History tab
  const activeProcesses = useMemo(() => {
    return processes.filter(p =>
      p.status === 'running' ||
      (p.isInlineMCP && p.status === 'running') || // Only show running inline MCP processes
      (p.isAlive && p.status !== 'completed' && p.status !== 'failed')
    )
    // Include processesSignature to ensure recalculation when any process data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processes, processesSignature])

  // Fetch historical workflows when history tab is selected
  useEffect(() => {
    if (open && activeTab === 'history') {
      loadHistoricalWorkflows()
    }
  }, [open, activeTab])

  const loadHistoricalWorkflows = async () => {
    Logger.debug(LogCategories.API, 'Loading historical workflows')
    dispatch(fetchHistoryStart())
    try {
      const response = await fetch(`${apiBaseUrl}/api/ukb/history?limit=50`)
      const result = await response.json()
      if (result.status === 'success') {
        Logger.info(LogCategories.UKB, `Loaded ${result.data?.length || 0} historical workflows`)
        dispatch(fetchHistorySuccess(result.data))
      } else {
        Logger.warn(LogCategories.API, 'Failed to load historical workflows', { message: result.message })
        dispatch(fetchHistoryFailure('Failed to load workflows'))
      }
    } catch (error) {
      Logger.error(LogCategories.API, 'Error fetching historical workflows', error)
      dispatch(fetchHistoryFailure(String(error)))
    }
  }

  const loadHistoricalWorkflowDetail = async (workflowId: string) => {
    Logger.debug(LogCategories.API, `Loading workflow detail: ${workflowId}`)
    dispatch(fetchDetailStart())
    try {
      const response = await fetch(`${apiBaseUrl}/api/ukb/history/${workflowId}`)
      const result = await response.json()
      if (result.status === 'success') {
        Logger.info(LogCategories.UKB, `Workflow detail loaded: ${workflowId}`, {
          steps: result.data?.steps?.length || 0,
          status: result.data?.status
        })
        dispatch(fetchDetailSuccess(result.data))
      } else {
        Logger.warn(LogCategories.API, 'Failed to load workflow detail', { workflowId, message: result.message })
        dispatch(fetchDetailFailure('Failed to load workflow detail'))
      }
    } catch (error) {
      Logger.error(LogCategories.API, 'Error fetching workflow detail', { workflowId, error })
      dispatch(fetchDetailFailure(String(error)))
    }
  }

  // Fetch detail when a historical workflow is selected
  useEffect(() => {
    if (selectedHistoricalWorkflowState) {
      loadHistoricalWorkflowDetail(selectedHistoricalWorkflowState.id)
      dispatch(setSelectedNode(null))
    }
  }, [selectedHistoricalWorkflowState])

  const handleNodeClick = (agentId: string) => {
    Logger.info(LogCategories.AGENT, `Agent node clicked: ${agentId}`, {
      agentId,
      isOrchestrator: agentId === 'orchestrator',
      currentTab: activeTab,
      workflowName: activeTab === 'active'
        ? currentProcess?.workflowName
        : selectedHistoricalWorkflowState?.workflowName,
    })
    dispatch(setSelectedNode(agentId))
  }

  const handleCloseSidebar = () => {
    Logger.debug(LogCategories.UI, 'Closing agent details sidebar', {
      previousAgent: selectedNode,
    })
    dispatch(setSelectedNode(null))
  }

  // Both active and historical use the same handler now via Redux
  const handleHistoricalNodeClick = handleNodeClick
  const handleCloseHistoricalSidebar = handleCloseSidebar

  // Handler for selecting a historical workflow from the list
  const handleSelectHistoricalWorkflow = useCallback((workflow: HistoricalWorkflow) => {
    Logger.info(LogCategories.UKB, 'Historical workflow selected', {
      workflowId: workflow.id,
      workflowName: workflow.workflowName,
      status: workflow.status,
      team: workflow.team,
      completedSteps: workflow.completedSteps,
      totalSteps: workflow.totalSteps,
      duration: workflow.duration,
      startTime: workflow.startTime,
      executionId: workflow.executionId,
    })
    dispatch(selectHistoricalWorkflow(workflow))
  }, [dispatch])

  const getHealthBadge = (health: string | undefined | null) => {
    if (!health) return <Badge variant="outline">Unknown</Badge>
    switch (health) {
      case 'healthy':
        return <Badge className="bg-green-500">Healthy</Badge>
      case 'stale':
        return <Badge className="bg-yellow-500">Stale</Badge>
      case 'frozen':
        return <Badge variant="destructive">Frozen</Badge>
      case 'dead':
        return <Badge variant="outline" className="text-gray-500">Dead</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const formatElapsed = (startTime: string | undefined | null, status?: string, fixedElapsedSeconds?: number) => {
    // For completed/failed workflows, use the fixed elapsed time from when they finished
    // For running workflows, calculate dynamically from start time
    let elapsedSeconds: number
    if (status && status !== 'running' && fixedElapsedSeconds !== undefined) {
      elapsedSeconds = fixedElapsedSeconds
    } else if (!startTime) {
      return '-'
    } else {
      const start = new Date(startTime).getTime()
      const now = Date.now()
      elapsedSeconds = Math.floor((now - start) / 1000)
    }

    if (elapsedSeconds < 60) return `${elapsedSeconds}s`
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    if (minutes < 60) return `${minutes}m ${seconds}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  const getWorkflowDisplayName = (name: string | undefined | null) => {
    if (!name) return 'Unknown Workflow'
    switch (name) {
      case 'complete-analysis':
        return 'Complete Analysis'
      case 'incremental-analysis':
        return 'Incremental Analysis'
      default:
        return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }

  const getStatusBadge = (status: string | undefined | null) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>
    switch (status.toLowerCase()) {
      case 'completed':
        return <Badge className="bg-green-500 text-white">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'running':
        return <Badge className="bg-blue-500 text-white">Running</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  // Format duration string (e.g., "1933.59s" or raw seconds) to human readable format
  const formatDuration = (duration: string | number | null | undefined): string => {
    if (!duration) return '-'

    // Parse the duration - could be "1933.59s" or just a number
    let seconds: number
    if (typeof duration === 'string') {
      // Remove 's' suffix and parse
      seconds = parseFloat(duration.replace(/s$/i, ''))
    } else {
      seconds = duration
    }

    if (isNaN(seconds)) return String(duration)

    // Format as human readable
    if (seconds < 60) return `${Math.round(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
  }

  // Render Active Workflows Content
  const renderActiveContent = () => {
    // Only show truly active (running) workflows in the Active tab
    if (activeProcesses.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-4">
            <Clock className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-medium">No Active Workflows</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Start a UKB workflow using the semantic analysis MCP tool to see it here.
              </p>
              {processes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Recently completed workflows can be found in the History tab.
                </p>
              )}
            </div>
            <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg font-mono">
              mcp__semantic-analysis__execute_workflow<br />
              workflow_name: "incremental-analysis"
            </div>
          </div>
        </div>
      )
    }

    // Use the active process at the selected index (bounded to valid range)
    const activeIndex = Math.min(selectedProcessIndex, activeProcesses.length - 1)
    const activeCurrentProcess = activeProcesses[activeIndex] || null

    // Calculate progress based on batch-weighted work distribution:
    // - Batch phase (steps 1-14 running N times) = ~85% of total work
    // - Finalization phase (steps 15-23 running once) = ~15% of total work
    const BATCH_STEP_COUNT = 14
    const BATCH_WEIGHT = 0.85

    // Get workflow-specific timing statistics for time-based progress
    const getWorkflowStats = () => {
      if (!stepTimingStatistics?.workflowTypes || !activeCurrentProcess) return null
      const workflowName = activeCurrentProcess.workflowName || ''
      const statsKey = workflowName.includes('complete') ? 'complete-analysis' :
                       workflowName.includes('incremental') ? 'incremental-analysis' :
                       'batch-analysis'
      return stepTimingStatistics.workflowTypes[statsKey] || null
    }
    const workflowStats = getWorkflowStats()
    const hasReliableStats = workflowStats && workflowStats.sampleCount >= 3

    // Calculate time-based progress and ETA
    let calculatedProgressPercent = 0
    let etaMs = 0
    let usingTimeBased = false

    if (activeCurrentProcess && activeCurrentProcess.totalSteps > 0) {
      // Use actual wall clock elapsed time (not sum of current batch step durations!)
      const elapsedMs = (activeCurrentProcess.elapsedSeconds || 0) * 1000

      const currentBatch = activeCurrentProcess.batchProgress?.currentBatch || 0
      const totalBatches = activeCurrentProcess.batchProgress?.totalBatches || 0
      const completedSteps = activeCurrentProcess.completedSteps || 0
      const totalSteps = activeCurrentProcess.totalSteps

      // STEP-COUNT PROGRESS: Calculate weighted step-based progress as a floor
      // This ensures progress never appears behind what's actually completed
      let stepBasedProgress = 0
      const isInFinalization = completedSteps > BATCH_STEP_COUNT ||
                               (currentBatch === totalBatches && totalBatches > 0)

      if (isInFinalization) {
        // Finalization phase: 85% (all batches) + finalization progress × 15%
        const finSteps = Math.max(0, completedSteps - BATCH_STEP_COUNT)
        const totalFinSteps = Math.max(1, totalSteps - BATCH_STEP_COUNT)
        stepBasedProgress = Math.round(
          (BATCH_WEIGHT + (finSteps / totalFinSteps) * (1 - BATCH_WEIGHT)) * 100
        )
      } else if (totalBatches > 0 && currentBatch > 0) {
        // Batch phase: progress = batch completion × 85%
        stepBasedProgress = Math.round((currentBatch / totalBatches) * BATCH_WEIGHT * 100)
      } else {
        // Fallback: simple step percentage
        stepBasedProgress = Math.round((completedSteps / totalSteps) * 100)
      }

      // TIME-BASED PROGRESS: Use historical statistics when available (3+ samples)
      // Use MEDIAN instead of mean for robustness against outliers
      let timeBasedProgress = 0
      if (hasReliableStats && workflowStats) {
        // Compute median batch duration from individual step medians
        let medianBatchMs = 0
        let medianFinalizationMs = 0

        if (workflowStats.steps) {
          // Sum median durations of batch steps (steps that run per batch)
          const batchStepNames = Object.keys(workflowStats.steps).filter(
            name => workflowStats.steps[name]?.isBatchStep
          )
          medianBatchMs = batchStepNames.reduce((sum, name) => {
            const step = workflowStats.steps[name]
            const median = step?.recentDurations?.length
              ? calculateMedian(step.recentDurations)
              : step?.avgDurationMs || 0
            return sum + median
          }, 0)

          // Sum median durations of finalization steps (non-batch steps)
          const finStepNames = Object.keys(workflowStats.steps).filter(
            name => !workflowStats.steps[name]?.isBatchStep
          )
          medianFinalizationMs = finStepNames.reduce((sum, name) => {
            const step = workflowStats.steps[name]
            const median = step?.recentDurations?.length
              ? calculateMedian(step.recentDurations)
              : step?.avgDurationMs || 0
            return sum + median
          }, 0)
        }

        // Fallback to stored averages if computed medians are 0
        if (medianBatchMs === 0) medianBatchMs = workflowStats.avgBatchDurationMs || 0
        if (medianFinalizationMs === 0) medianFinalizationMs = workflowStats.avgFinalizationDurationMs || 0

        if (medianBatchMs > 0 && totalBatches > 0) {
          // Per-batch learning: estimate total time based on actual batch count
          const estimatedBatchPhaseMs = medianBatchMs * totalBatches
          let estimatedTotalMs = estimatedBatchPhaseMs + medianFinalizationMs

          // SANITY CHECK: Cap estimated total to prevent inflated historical stats
          // from showing unreasonably low progress. If we're in finalization and
          // step-based shows >80%, estimated total shouldn't exceed 1.5x elapsed time.
          if (isInFinalization && stepBasedProgress >= 80 && elapsedMs > 0) {
            const maxReasonableTotal = elapsedMs * 1.5 // Expect completion within 50% more time
            if (estimatedTotalMs > maxReasonableTotal) {
              estimatedTotalMs = maxReasonableTotal
            }
          }

          // Calculate progress based on elapsed time vs estimated total
          const estimatedProgressMs = Math.min(elapsedMs, estimatedTotalMs)
          timeBasedProgress = Math.min(99, Math.round((estimatedProgressMs / estimatedTotalMs) * 100))
          etaMs = Math.max(0, estimatedTotalMs - elapsedMs)
          usingTimeBased = true
        }
      }

      // HYBRID APPROACH: Use maximum of time-based and step-based progress
      // This ensures progress never appears behind actual completion
      if (usingTimeBased) {
        calculatedProgressPercent = Math.max(timeBasedProgress, stepBasedProgress)
        // If using step-based as floor, recalculate ETA based on step progress rate
        if (stepBasedProgress > timeBasedProgress && elapsedMs > 0 && stepBasedProgress < 99) {
          // Estimate remaining time based on how long the completed portion took
          const progressPerMs = stepBasedProgress / elapsedMs
          const remainingProgress = 100 - stepBasedProgress
          etaMs = progressPerMs > 0 ? Math.round(remainingProgress / progressPerMs) : 0
        }
      } else {
        calculatedProgressPercent = stepBasedProgress
      }

      // Cap at 99% until workflow actually completes
      calculatedProgressPercent = Math.min(99, calculatedProgressPercent)
    }

    // Format ETA for display
    const formatEta = (ms: number): string => {
      if (ms <= 0) return ''
      const seconds = Math.round(ms / 1000)
      if (seconds < 60) return `~${seconds}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `~${minutes} min`
      const hours = Math.floor(minutes / 60)
      const remainingMin = minutes % 60
      return `~${hours}h ${remainingMin}m`
    }
    const etaDisplay = formatEta(etaMs)

    return (
      <>
        {/* Process selector */}
        {activeProcesses.length > 1 && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => dispatch(setSelectedProcessIndex(Math.max(0, activeIndex - 1)))}
              disabled={activeIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Process {activeIndex + 1} / {activeProcesses.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => dispatch(setSelectedProcessIndex(Math.min(activeProcesses.length - 1, activeIndex + 1)))}
              disabled={activeIndex === activeProcesses.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Guard: Only render when workflow data is valid (has name and steps) */}
        {activeCurrentProcess && activeCurrentProcess.workflowName && activeCurrentProcess.totalSteps > 0 && (
          <>
            {/* Process Info Header */}
            <Card className="flex-shrink-0">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {/* Workflow Name */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Workflow</div>
                    <div className="font-medium flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {getWorkflowDisplayName(activeCurrentProcess.workflowName)}
                    </div>
                  </div>

                  {/* Team */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Team</div>
                    <div className="font-medium flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      {activeCurrentProcess.team || 'Unknown'}
                    </div>
                  </div>

                  {/* Repository */}
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Repository</div>
                    <div className="font-medium text-sm truncate flex items-center gap-1" title={activeCurrentProcess.repositoryPath || 'Unknown'}>
                      <Folder className="h-3 w-3 flex-shrink-0" />
                      {activeCurrentProcess.repositoryPath?.split('/').slice(-2).join('/') || 'Unknown'}
                    </div>
                  </div>

                  {/* Health Status */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Health</div>
                    <div className="flex items-center gap-2">
                      {getHealthBadge(activeCurrentProcess.health)}
                      {(activeCurrentProcess.health === 'frozen' || activeCurrentProcess.health === 'stale') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={handleCancelWorkflow}
                          disabled={cancelLoading}
                          title="Cancel stuck workflow"
                        >
                          {cancelLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Elapsed Time */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Elapsed</div>
                    <div className="font-medium flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {formatElapsed(activeCurrentProcess.startTime, activeCurrentProcess.status, activeCurrentProcess.elapsedSeconds)}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">
                      {activeCurrentProcess.batchProgress && activeCurrentProcess.batchProgress.totalBatches > 0
                        ? `Batch ${activeCurrentProcess.batchProgress.currentBatch} / ${activeCurrentProcess.batchProgress.totalBatches}`
                        : `Steps: ${activeCurrentProcess.completedSteps} / ${activeCurrentProcess.totalSteps}`
                      }
                      {activeCurrentProcess.currentStep && (
                        <span className="ml-2 text-blue-600">
                          (Currently: {activeCurrentProcess.currentStep.replace(/_/g, ' ')})
                        </span>
                      )}
                    </span>
                    <span className="font-medium flex items-center gap-2">
                      {calculatedProgressPercent}%
                      {/* ETA display - only when using time-based estimation with reliable stats */}
                      {etaDisplay && usingTimeBased && activeCurrentProcess.status === 'running' && (
                        <span className="text-green-600 font-normal">
                          ({etaDisplay} remaining)
                        </span>
                      )}
                    </span>
                  </div>
                  <Progress value={calculatedProgressPercent} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Main Content - 3 column layout: [Left Info | Graph | Details] */}
            <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
              {/* Left Column: Legend */}
              <div className="w-36 flex-shrink-0 flex flex-col gap-3">
                <WorkflowLegend />
              </div>

              {/* Center: Workflow Graph - key only changes on workflow identity, not step updates */}
              <div className="flex-1 min-w-0 h-full">
                <UKBWorkflowGraph
                  key={`${activeCurrentProcess.pid}-${activeCurrentProcess.workflowName || 'workflow'}`}
                  process={activeCurrentProcess}
                  onNodeClick={handleNodeClick}
                  selectedNode={selectedNode}
                  hideLegend
                />
              </div>

              {/* Right: Details Sidebar */}
              {showSidebar && selectedNode && (
                <div className="flex-shrink-0 overflow-auto">
                  <UKBNodeDetailsSidebar
                    agentId={selectedNode}
                    process={activeCurrentProcess}
                    onClose={handleCloseSidebar}
                  />
                </div>
              )}
            </div>

            {/* Footer with PID info */}
            <div className="flex-shrink-0 pt-2 border-t">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span>PID: {activeCurrentProcess.pid}</span>
                  <span>Last heartbeat: {activeCurrentProcess.heartbeatAgeSeconds}s ago</span>
                  {activeCurrentProcess.logFile && (
                    <span className="truncate max-w-xs" title={activeCurrentProcess.logFile}>
                      Log: {activeCurrentProcess.logFile.split('/').pop()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {activeCurrentProcess.health === 'healthy' && activeCurrentProcess.status === 'running' && (
                    <span className="flex items-center gap-1 text-green-600">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing
                    </span>
                  )}
                  {activeCurrentProcess.status === 'completed' && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </span>
                  )}
                  {activeCurrentProcess.status === 'failed' && (
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3 w-3" />
                      Failed
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Show minimal loading indicator when data is still being fetched
            Only show for genuine first-time loads - not during refreshes */}
        {activeCurrentProcess && !activeCurrentProcess.workflowName && !activeCurrentProcess.totalSteps && (
          <Card className="flex-shrink-0">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Connecting to workflow...</span>
                {activeCurrentProcess.pid && (
                  <span className="text-xs font-mono ml-2">PID: {activeCurrentProcess.pid}</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </>
    )
  }

  // Render History Content
  const renderHistoryContent = () => {
    if (loadingHistory) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading workflow history...</p>
          </div>
        </div>
      )
    }

    if (historicalWorkflows.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="space-y-4">
            <History className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-medium">No Workflow History</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Completed workflows will appear here.
              </p>
            </div>
          </div>
        </div>
      )
    }

    // If a workflow is selected, show its details
    if (selectedHistoricalWorkflowState) {
      return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Header Bar - fixed height */}
          <div className="flex-shrink-0 flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatch(selectHistoricalWorkflow(null))
              }}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to list
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <span className="text-sm font-medium truncate">{selectedHistoricalWorkflowState.executionId}</span>
            <div className="ml-auto">{getStatusBadge(selectedHistoricalWorkflowState.status)}</div>
          </div>

          {/* Compact Info Row - fixed height */}
          <div className="flex-shrink-0 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground mb-2 px-1">
            <span><strong>Workflow:</strong> {getWorkflowDisplayName(selectedHistoricalWorkflowState.workflowName)}</span>
            <span><strong>Team:</strong> {selectedHistoricalWorkflowState.team}</span>
            <span><strong>Duration:</strong> {formatDuration(selectedHistoricalWorkflowState.duration)}</span>
            <span><strong>Steps:</strong> {selectedHistoricalWorkflowState.completedSteps}/{selectedHistoricalWorkflowState.totalSteps}</span>
            <span><strong>Started:</strong> {formatDate(selectedHistoricalWorkflowState.startTime)}</span>
          </div>

          {/* Aggregated Totals - Show cumulative results from all batches */}
          {batchSummary && (
            <div className="flex-shrink-0 mb-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 mb-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-blue-600" />
                <span className="text-xs font-medium text-blue-800">
                  Pipeline Totals ({batchSummary.totalBatches} batches)
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3 w-3 text-blue-500" />
                  <span className="text-blue-700">
                    <strong>{batchSummary.totalCommits.toLocaleString()}</strong> commits
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3 text-blue-500" />
                  <span className="text-blue-700">
                    <strong>{batchSummary.totalSessions.toLocaleString()}</strong> sessions
                    {batchSummary.batchesWithSessions < batchSummary.totalBatches && (
                      <span className="text-blue-500 ml-1">
                        ({batchSummary.batchesWithSessions}/{batchSummary.totalBatches} batches)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Brain className="h-3 w-3 text-blue-500" />
                  <span className="text-blue-700">
                    <strong>{batchSummary.totalEntities.toLocaleString()}</strong> candidates
                    {persistedKnowledge && (
                      <span className="text-blue-500 ml-1">
                        → {persistedKnowledge.entities} final
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Network className="h-3 w-3 text-blue-500" />
                  <span className="text-blue-700">
                    <strong>{batchSummary.totalRelations.toLocaleString()}</strong> raw relations
                    {persistedKnowledge && (
                      <span className="text-blue-500 ml-1">
                        → {persistedKnowledge.relations} final
                      </span>
                    )}
                  </span>
                </div>
              </div>
              {batchSummary.dateRange?.start && batchSummary.dateRange?.end && (
                <div className="text-[10px] text-blue-500 mt-1">
                  Coverage: {new Date(batchSummary.dateRange.start).toLocaleDateString()} → {new Date(batchSummary.dateRange.end).toLocaleDateString()}
                </div>
              )}
            </div>
          )}

          {/* Final Persisted Knowledge - Show deduplicated results */}
          {persistedKnowledge && (
            <div className="flex-shrink-0 mb-2 p-2 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs font-medium text-green-800">
                  Knowledge Base (After Deduplication)
                </span>
                {persistedKnowledge.deduplicationRatio && (
                  <Badge variant="outline" className="ml-auto text-[10px] h-4 bg-green-100 text-green-700 border-green-300">
                    {persistedKnowledge.deduplicationRatio}% reduction
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <Brain className="h-3 w-3 text-green-500" />
                  <span className="text-green-700">
                    <strong>{persistedKnowledge.entities}</strong> entities
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Network className="h-3 w-3 text-green-500" />
                  <span className="text-green-700">
                    <strong>{persistedKnowledge.relations}</strong> relations
                  </span>
                </div>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {Object.entries(persistedKnowledge.entityTypes || {}).map(([type, count]) => (
                    <Badge key={type} variant="outline" className="text-[10px] h-4 bg-green-50 text-green-600 border-green-200">
                      {type}: {count}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Main Content - 3 column layout: [Left Info | Graph | Details] */}
          <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">
            {/* Left Column: Legend + Recommendations */}
            <div className="w-36 flex-shrink-0 flex flex-col gap-3">
              <WorkflowLegend />

              {/* Recommendations (if any) */}
              {historicalWorkflowDetail?.recommendations && historicalWorkflowDetail.recommendations.length > 0 && (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded-lg overflow-auto flex-1">
                  <div className="text-xs font-medium text-yellow-800 mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Tips ({historicalWorkflowDetail.recommendations.length})
                  </div>
                  <ul className="text-[10px] text-yellow-700 space-y-0.5">
                    {historicalWorkflowDetail.recommendations.map((rec, i) => (
                      <li key={i}>• {rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Center: Workflow Graph */}
            {loadingDetail ? (
              <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/20">
                <div className="text-center space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Loading workflow details...</p>
                </div>
              </div>
            ) : historicalProcessInfo ? (
              <>
                <div className="flex-1 min-w-0 min-h-0 h-full">
                  <UKBWorkflowGraph
                    process={historicalProcessInfo}
                    onNodeClick={handleHistoricalNodeClick}
                    selectedNode={selectedNode}
                    hideLegend
                  />
                </div>

                {/* Right: Details Sidebar */}
                {showHistoricalSidebar && selectedNode && (
                  <div className="w-80 flex-shrink-0 overflow-auto border rounded-lg bg-background">
                    <UKBNodeDetailsSidebar
                      agentId={selectedNode}
                      process={historicalProcessInfo}
                      onClose={handleCloseHistoricalSidebar}
                      aggregatedSteps={batchSummary?.aggregatedSteps}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/20">
                <div className="text-center space-y-2">
                  <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Unable to load workflow details</p>
                  <p className="text-xs text-muted-foreground">Report ID: {selectedHistoricalWorkflowState.id}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }

    // Show list of historical workflows
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground">
            {historicalWorkflows.length} workflow{historicalWorkflows.length !== 1 ? 's' : ''} found
          </div>
          <Button variant="outline" size="sm" onClick={loadHistoricalWorkflows}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-4">
            {historicalWorkflows.map((workflow) => (
              <Card
                key={workflow.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleSelectHistoricalWorkflow(workflow)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-sm">
                          {getWorkflowDisplayName(workflow.workflowName)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {workflow.team} • {formatDate(workflow.startTime)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{workflow.completedSteps}/{workflow.totalSteps} steps</div>
                        <div>{formatDuration(workflow.duration)}</div>
                      </div>
                      {getStatusBadge(workflow.status)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] grid grid-rows-[auto_auto_1fr] gap-4 overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              UKB Workflow Monitor
            </DialogTitle>
            <div className="flex items-center gap-2">
              {/* View Trace button - show when there are steps to trace */}
              {(currentProcess?.steps?.length || historicalWorkflowDetail?.steps?.length) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const stepsToTrace = activeTab === 'active'
                      ? currentProcess?.steps
                      : historicalWorkflowDetail?.steps
                    Logger.info(LogCategories.TRACE, 'Opening trace modal', {
                      tab: activeTab,
                      workflowName: activeTab === 'active'
                        ? currentProcess?.workflowName
                        : historicalWorkflowDetail?.workflowName,
                      totalSteps: stepsToTrace?.length || 0,
                      completedSteps: stepsToTrace?.filter(s => s.status === 'completed').length || 0,
                      runningSteps: stepsToTrace?.filter(s => s.status === 'running').length || 0,
                      failedSteps: stepsToTrace?.filter(s => s.status === 'failed').length || 0,
                    })
                    setTraceModalOpen(true)
                  }}
                  className="flex items-center gap-2"
                >
                  <Activity className="h-4 w-4" />
                  View Trace
                </Button>
              )}
              {activeProcesses.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelWorkflow}
                  disabled={cancelLoading}
                  className="flex items-center gap-2"
                >
                  {cancelLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <StopCircle className="h-4 w-4" />
                  )}
                  Cancel Workflow
                </Button>
              )}
            </div>
          </div>
          <DialogDescription>
            Monitor active and historical UKB semantic analysis workflows
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => {
          const newTab = v as 'active' | 'history'
          Logger.info(LogCategories.UKB, `Switching to ${newTab} tab`, {
            from: activeTab,
            to: newTab,
            activeProcessCount: activeProcesses.length,
            historicalWorkflowCount: historicalWorkflows.length,
          })
          dispatch(setActiveTab(newTab))
        }} className="contents">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Loader2 className={`h-4 w-4 ${activeProcesses.length > 0 ? 'animate-spin' : ''}`} />
              Active
              {activeProcesses.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {activeProcesses.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeTab === 'active' ? renderActiveContent() : renderHistoryContent()}
        </div>
      </DialogContent>

      {/* Trace Modal */}
      <TraceModal
        open={traceModalOpen}
        onOpenChange={setTraceModalOpen}
        steps={
          activeTab === 'active'
            ? (() => {
                const allSteps: StepInfo[] = []

                // Check if this is a batch workflow (has batchIterations data)
                const isBatchWorkflow = currentProcess?.batchIterations && currentProcess.batchIterations.length > 0

                if (isBatchWorkflow) {
                  // BATCH WORKFLOW: Reorder steps into pre-batch → batch iterations → post-batch
                  // NOTE: Be specific with patterns to avoid matching batch steps like 'operator_dedup'
                  const finalizationStepNames = new Set([
                    // Batch workflow finalization steps (from batch-analysis.yaml)
                    'index_codebase', 'link_documentation', 'synthesize_code_insights',
                    'transform_code_entities', 'final_persist', 'generate_insights',
                    'web_search', 'final_dedup', 'final_validation',
                    // Legacy workflow finalization steps
                    'persist_results', 'persist_incremental',
                    'deduplicate_insights', 'deduplicate_incremental',
                    'validate_content', 'validate_content_incremental',
                  ])
                  const isPostBatchStep = (name: string) =>
                    finalizationStepNames.has(name.toLowerCase())

                  const preBatchSteps: StepInfo[] = []
                  const postBatchSteps: StepInfo[] = []

                  if (currentProcess?.steps && currentProcess.steps.length > 0) {
                    for (const step of currentProcess.steps) {
                      const stepInfo = {
                        ...step,
                        name: STEP_TO_AGENT[step.name] || step.name,
                      }
                      if (isPostBatchStep(step.name)) {
                        postBatchSteps.push(stepInfo)
                      } else {
                        preBatchSteps.push(stepInfo)
                      }
                    }
                  }

                  // 1. Add pre-batch steps first
                  allSteps.push(...preBatchSteps)

                  // 2. Add batch iteration steps (already checked isBatchWorkflow above)
                  for (const batch of currentProcess.batchIterations!) {
                    for (const step of batch.steps) {
                      allSteps.push({
                        name: `[${batch.batchId}] ${STEP_TO_AGENT[step.name] || step.name}`,
                        status: step.status,
                        duration: step.duration,
                        outputs: step.outputs,
                        tokensUsed: step.tokensUsed,
                        llmProvider: step.llmProvider,
                        llmCalls: step.llmCalls,
                      })
                    }
                  }

                  // 3. Add post-batch steps last (persistence, dedup, validation)
                  allSteps.push(...postBatchSteps)
                } else {
                  // STANDARD WORKFLOW: Show steps in their natural execution order
                  // No reordering needed - persistence runs after its dependencies complete
                  if (currentProcess?.steps && currentProcess.steps.length > 0) {
                    for (const step of currentProcess.steps) {
                      allSteps.push({
                        ...step,
                        name: STEP_TO_AGENT[step.name] || step.name,
                      })
                    }
                  }
                }

                return allSteps
              })()
            : historicalWorkflowDetail?.steps?.map(s => ({
                name: s.agent || s.name,
                status: s.status === 'success' ? 'completed' : s.status as any,
                duration: s.duration ? parseFloat(String(s.duration).replace(/s$/i, '')) * 1000 : undefined,
                llmProvider: (s as any).llmProvider,
                tokensUsed: (s as any).tokensUsed,
                llmCalls: (s as any).llmCalls,
                error: s.errors?.join('\n'),
                outputs: s.outputs,
              })) || []
        }
        workflowName={
          activeTab === 'active'
            ? currentProcess?.workflowName || 'Unknown'
            : selectedHistoricalWorkflowState?.workflowName || 'Unknown'
        }
        startTime={
          activeTab === 'active'
            ? currentProcess?.startTime
            : selectedHistoricalWorkflowState?.startTime || undefined
        }
      />
    </Dialog>
  )
}
