'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { MultiAgentGraph as UKBWorkflowGraph, WorkflowLegend, TraceModal, AGENT_SUBSTEPS, useWorkflowDefinitions } from './workflow'
import type { SubStep } from './workflow'
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
  // Single-step mode actions (MVI)
  setSingleStepMode,
  syncStepPauseFromServer,
  syncSingleStepFromServer,
  resetSingleStepExplicit,
  setExpandedSubStepsAgent,
  setSelectedSubStep,
  // LLM Mock mode actions (MVI)
  setMockLLM,
  syncMockLLMFromServer,
  // Single-step mode selectors (MVI)
  selectSingleStepMode,
  selectSingleStepModeExplicit,
  selectStepPaused,
  selectPausedAtStep,
  selectExpandedSubStepsAgent,
  selectSelectedSubStep,
  // LLM Mock mode selectors (MVI)
  selectMockLLM,
  selectMockLLMExplicit,
  type HistoricalWorkflow,
  type UKBProcess,
  type StepTimingStatistics,
  type StepInfo,
  type WorkflowTimingStats,
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

// Get step median duration from historical stats
function getStepMedianDuration(
  stepName: string,
  workflowStats: WorkflowTimingStats | null
): number {
  if (!workflowStats?.steps?.[stepName]) return 0
  const step = workflowStats.steps[stepName]
  return step.recentDurations?.length
    ? calculateMedian(step.recentDurations)
    : step.avgDurationMs || 0
}

/**
 * Calculate ETA using DYNAMIC LEARNING from actual batch durations in this run.
 *
 * This is more accurate than historical-only estimation because it:
 * 1. Uses actual batch durations from THIS workflow run (dynamic learning)
 * 2. Properly accounts for remaining batches + finalization time
 * 3. Falls back to linear interpolation as a sanity check
 *
 * Algorithm:
 * - During batch phase: ETA = (remaining batches × learned avg) + median finalization
 * - During finalization: ETA = (remaining finalization steps × historical avg)
 * - Sanity check: ETA should be at least linearETA × 0.5 (can't be faster than half of linear estimate)
 */
function calculateDynamicEta(
  process: UKBProcess,
  workflowStats: WorkflowTimingStats | null,
  totalElapsedMs: number,
  progressPercent: number
): number {
  const currentBatch = process.batchProgress?.currentBatch || 0
  const totalBatches = process.batchProgress?.totalBatches || 0
  const batchIterations = process.batchIterations || []

  // Calculate linear ETA as sanity check baseline
  // If we're at X%, we've taken Y time, so total = Y / (X/100)
  // Remaining = total - elapsed = elapsed * (100/X - 1)
  const linearEtaMs = progressPercent > 0 && progressPercent < 100
    ? totalElapsedMs * ((100 - progressPercent) / progressPercent)
    : 0

  // ============================================
  // DYNAMIC LEARNING: Use actual batch durations from this run
  // ============================================

  // Calculate average batch duration from COMPLETED batches in this run
  let learnedAvgBatchMs = 0
  let completedBatchCount = 0

  for (const batch of batchIterations) {
    // A batch is complete if all its steps are completed
    const allStepsComplete = batch.steps.every(s => s.status === 'completed' || s.status === 'skipped')
    if (allStepsComplete) {
      // Sum up actual step durations
      const batchDuration = batch.steps.reduce((sum, step) => sum + (step.duration || 0), 0)
      if (batchDuration > 0) {
        learnedAvgBatchMs += batchDuration
        completedBatchCount++
      }
    }
  }

  // Calculate learned average (use at least 2 completed batches for reliable average)
  if (completedBatchCount >= 2) {
    learnedAvgBatchMs = learnedAvgBatchMs / completedBatchCount
  } else if (completedBatchCount === 1) {
    // With only 1 batch, be conservative - multiply by 1.2
    learnedAvgBatchMs = (learnedAvgBatchMs / completedBatchCount) * 1.2
  } else {
    // No completed batches yet - use historical or estimate from elapsed
    learnedAvgBatchMs = workflowStats?.avgBatchDurationMs || 0
    if (learnedAvgBatchMs === 0 && currentBatch > 0 && totalElapsedMs > 0) {
      // Rough estimate: elapsed / current batch
      learnedAvgBatchMs = totalElapsedMs / currentBatch
    }
  }

  // ============================================
  // CALCULATE REMAINING TIME
  // ============================================

  let etaMs = 0
  const remainingBatches = Math.max(0, totalBatches - currentBatch)
  const isInFinalization = currentBatch >= totalBatches && totalBatches > 0

  if (!isInFinalization && remainingBatches > 0) {
    // BATCH PHASE: Remaining batches + finalization
    const remainingBatchTimeMs = remainingBatches * learnedAvgBatchMs
    const finalizationMs = workflowStats?.avgFinalizationDurationMs || 60000 // Default 1 min
    etaMs = remainingBatchTimeMs + finalizationMs

    // If we're IN the middle of a batch, estimate time left in current batch
    if (batchIterations.length > 0) {
      const currentBatchData = batchIterations[batchIterations.length - 1]
      if (currentBatchData) {
        const completedInCurrentBatch = currentBatchData.steps.filter(
          s => s.status === 'completed' || s.status === 'skipped'
        ).length
        const totalInCurrentBatch = currentBatchData.steps.length
        if (totalInCurrentBatch > 0 && completedInCurrentBatch < totalInCurrentBatch) {
          // Fraction of current batch remaining
          const currentBatchProgress = completedInCurrentBatch / totalInCurrentBatch
          etaMs += learnedAvgBatchMs * (1 - currentBatchProgress)
        }
      }
    }
  } else if (isInFinalization) {
    // FINALIZATION PHASE: Use step-by-step historical estimates
    const pendingSteps = (process.steps || []).filter(s => s.status === 'pending' || s.status === 'running')
    for (const step of pendingSteps) {
      const stepDuration = getStepMedianDuration(step.name, workflowStats)
      // For running steps, assume 50% done
      if (step.status === 'running') {
        etaMs += stepDuration * 0.5
      } else {
        etaMs += stepDuration
      }
    }

    // Fallback if no step estimates
    if (etaMs === 0 && workflowStats?.avgFinalizationDurationMs) {
      const finProgress = (process.completedSteps - (process.batchProgress?.totalBatches || 0) * 8) /
                         Math.max(1, process.totalSteps - (process.batchProgress?.totalBatches || 0) * 8)
      etaMs = workflowStats.avgFinalizationDurationMs * (1 - Math.min(1, finProgress))
    }
  } else {
    // FALLBACK: Use linear interpolation
    etaMs = linearEtaMs
  }

  // ============================================
  // SANITY CHECKS
  // ============================================

  // ETA shouldn't be less than 50% of linear estimate (can't go THAT much faster than linear)
  // But also shouldn't be more than 200% of linear (historical shouldn't inflate too much)
  if (linearEtaMs > 0) {
    etaMs = Math.max(linearEtaMs * 0.3, Math.min(linearEtaMs * 2.0, etaMs))
  }

  // Minimum 1 second (not 5 seconds like before - let it show accurate small numbers)
  // Maximum 30 minutes
  const MIN_ETA_MS = 1000
  const MAX_ETA_MS = 30 * 60 * 1000
  return Math.min(MAX_ETA_MS, Math.max(MIN_ETA_MS, etaMs))
}

/**
 * Legacy function - now delegates to calculateDynamicEta
 * Kept for compatibility with existing call sites
 */
function calculateStepAwareEta(
  process: UKBProcess,
  workflowStats: WorkflowTimingStats | null,
  totalElapsedMs: number
): number {
  // Calculate progress percent for sanity check
  const currentBatch = process.batchProgress?.currentBatch || 0
  const totalBatches = process.batchProgress?.totalBatches || 0
  let progressPercent = 0

  if (totalBatches > 0) {
    progressPercent = Math.round((currentBatch / totalBatches) * 85) // Batch phase is 85%
  } else if (process.totalSteps > 0) {
    progressPercent = Math.round((process.completedSteps / process.totalSteps) * 100)
  }

  return calculateDynamicEta(process, workflowStats, totalElapsedMs, progressPercent)
}

export default function UKBWorkflowModal({ open, onOpenChange, processes, apiBaseUrl = 'http://localhost:3033' }: UKBWorkflowModalProps) {
  const dispatch = useDispatch()

  // Workflow config from Redux (populated from API with fallback to constants)
  const { stepToAgent } = useWorkflowDefinitions()

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

  // Single-step debugging mode state (MVI: from Redux store)
  const singleStepMode = useSelector(selectSingleStepMode)
  const singleStepModeExplicit = useSelector(selectSingleStepModeExplicit)
  const stepPaused = useSelector(selectStepPaused)
  const pausedAtStep = useSelector(selectPausedAtStep)
  const [stepAdvanceLoading, setStepAdvanceLoading] = useState(false)  // Local UI state only

  // LLM Mock mode state (MVI: from Redux store)
  const mockLLM = useSelector(selectMockLLM)
  const mockLLMExplicit = useSelector(selectMockLLMExplicit)

  // Trace modal state
  const [traceModalOpen, setTraceModalOpen] = useState(false)

  // Selected substep state (MVI: from Redux store)
  const selectedSubStepRedux = useSelector(selectSelectedSubStep)
  // Map Redux state to SubStep type used by component
  const selectedSubStep: SubStep | null = useMemo(() => {
    if (!selectedSubStepRedux) return null
    const agent = AGENT_SUBSTEPS[selectedSubStepRedux.agentId as keyof typeof AGENT_SUBSTEPS]
    if (!agent) return null
    return agent.find(s => s.id === selectedSubStepRedux.substepId) || null
  }, [selectedSubStepRedux])

  // Helper to dispatch setSelectedSubStep action (converts SubStep to Redux format)
  const dispatchSetSelectedSubStep = useCallback((substep: SubStep | null, agentId?: string) => {
    if (substep && agentId) {
      dispatch(setSelectedSubStep({ agentId, substepId: substep.id }))
    } else {
      dispatch(setSelectedSubStep(null))
    }
  }, [dispatch])

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

  // Toggle single-step debugging mode (MVI: dispatches Redux action)
  const handleToggleSingleStepMode = async (enabled: boolean) => {
    try {
      Logger.info(LogCategories.UKB, `Setting single-step mode: ${enabled}`)

      // CRITICAL: Mark that user has explicitly set this value via Redux
      // This prevents server polling from overwriting user's choice
      dispatch(setSingleStepMode({ enabled, explicit: true }))

      const response = await fetch(`${apiBaseUrl}/api/ukb/single-step-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
      const data = await response.json()
      if (data.status === 'success') {
        // State already set optimistically above
        if (!enabled) {
          dispatch(syncStepPauseFromServer({ paused: false, pausedAt: null }))
        }
        Logger.info(LogCategories.UKB, `Single-step mode ${enabled ? 'enabled' : 'disabled'}`)
      } else {
        // Revert on failure
        dispatch(setSingleStepMode({ enabled: !enabled, explicit: false }))
        Logger.error(LogCategories.UKB, 'Failed to toggle single-step mode', data)
      }
    } catch (error) {
      // Revert on error
      dispatch(setSingleStepMode({ enabled: !enabled, explicit: false }))
      Logger.error(LogCategories.UKB, 'Error toggling single-step mode', error)
    }
  }

  // Advance to next step when paused (MVI: dispatches Redux action)
  // After advancing, poll rapidly to catch the new pause state faster
  const handleStepAdvance = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    setStepAdvanceLoading(true)
    try {
      Logger.info(LogCategories.UKB, 'Advancing to next step')
      const response = await fetch(`${apiBaseUrl}/api/ukb/step-advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await response.json()
      if (data.status === 'success') {
        dispatch(syncStepPauseFromServer({ paused: false, pausedAt: null }))
        Logger.info(LogCategories.UKB, 'Step advanced', data.data)

        // Rapidly poll for new pause state (every 500ms, up to 8 times = 4 seconds)
        // This catches the new pause state much faster than waiting for the 5s polling interval
        const pollForNewPause = async (attempts: number = 0) => {
          if (attempts >= 8) {
            Logger.trace(LogCategories.UKB, 'Step advance poll timeout, regular polling will continue')
            return
          }
          try {
            await new Promise(resolve => setTimeout(resolve, 500))
            const progressResponse = await fetch(`${apiBaseUrl}/api/ukb/processes`)
            const progressData = await progressResponse.json()
            if (progressData.status === 'success' && progressData.data?.processes?.length > 0) {
              const activeProcess = progressData.data.processes.find((p: any) => p.status === 'running')
              if (activeProcess?.stepPaused && activeProcess?.pausedAtStep) {
                Logger.info(LogCategories.UKB, 'Detected new pause state', {
                  pausedAt: activeProcess.pausedAtStep,
                  attempts: attempts + 1
                })
                dispatch(syncStepPauseFromServer({
                  paused: true,
                  pausedAt: activeProcess.pausedAtStep
                }))
                return // Found new pause state
              }
            }
            // Continue polling if not yet paused
            pollForNewPause(attempts + 1)
          } catch (pollError) {
            Logger.trace(LogCategories.UKB, 'Step advance poll error', pollError)
            pollForNewPause(attempts + 1)
          }
        }
        // Start rapid polling in background (don't await)
        pollForNewPause()
      } else {
        Logger.error(LogCategories.UKB, 'Failed to advance step', data)
      }
    } catch (error) {
      Logger.error(LogCategories.UKB, 'Error advancing step', error)
    } finally {
      setStepAdvanceLoading(false)
    }
  }

  // Toggle LLM mock mode (MVI: dispatches Redux action)
  const handleToggleMockLLM = async (enabled: boolean) => {
    try {
      Logger.info(LogCategories.UKB, `Setting LLM mock mode: ${enabled}`)

      // CRITICAL: Mark that user has explicitly set this value via Redux
      // This prevents server polling from overwriting user's choice
      dispatch(setMockLLM({ enabled, explicit: true }))

      const response = await fetch(`${apiBaseUrl}/api/ukb/mock-llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
      const data = await response.json()
      if (data.status === 'success') {
        Logger.info(LogCategories.UKB, `LLM mock mode ${enabled ? 'enabled' : 'disabled'}`)
      } else {
        // Revert on failure
        dispatch(setMockLLM({ enabled: !enabled, explicit: false }))
        Logger.error(LogCategories.UKB, 'Failed to toggle LLM mock mode', data)
      }
    } catch (error) {
      // Revert on error
      dispatch(setMockLLM({ enabled: !enabled, explicit: false }))
      Logger.error(LogCategories.UKB, 'Error toggling LLM mock mode', error)
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

  // Filter processes for the Active tab
  // ONLY show workflows that are actually running - cancelled/completed/failed go to History
  // FIX: Previously included ALL isInlineMCP workflows regardless of status, causing "zombie" workflows
  const activeProcesses = useMemo(() => {
    return processes.filter(p => {
      // Only consider truly active states
      const isActiveStatus = p.status === 'running' || p.status === 'starting' || p.status === 'cancelling'
      // For non-inline processes, also check isAlive flag
      const isAlive = p.isAlive && p.status !== 'completed' && p.status !== 'failed' && p.status !== 'cancelled'
      return isActiveStatus || isAlive
    })
    // Include processesSignature to ensure recalculation when any process data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processes, processesSignature])

  // Sync single-step state from server process data (MVI: dispatches Redux actions)
  // CRITICAL: Only sync singleStepMode from server if user hasn't explicitly set it
  // stepPaused and pausedAtStep ARE server state and should always sync
  useEffect(() => {
    const activeProcess = activeProcesses[selectedProcessIndex]
    if (activeProcess) {
      // Read single-step state from process (populated from progress file)
      const processSingleStep = (activeProcess as any).singleStepMode
      const processStepPaused = (activeProcess as any).stepPaused
      const processPausedAt = (activeProcess as any).pausedAtStep

      // ONLY sync singleStepMode if user hasn't explicitly changed it in this session
      // singleStepModeExplicit is from Redux store
      if (!singleStepModeExplicit && processSingleStep !== undefined) {
        dispatch(syncSingleStepFromServer(processSingleStep))
      }
      // stepPaused and pausedAtStep are server-controlled state, always sync via Redux
      if (processStepPaused !== undefined || processPausedAt !== undefined) {
        dispatch(syncStepPauseFromServer({
          paused: processStepPaused ?? false,
          pausedAt: processPausedAt ?? null
        }))
      }

      // Sync mockLLM state from server (similar logic)
      const processMockLLM = (activeProcess as any).mockLLM
      const processMockLLMDelay = (activeProcess as any).mockLLMDelay
      if (!mockLLMExplicit && processMockLLM !== undefined) {
        dispatch(syncMockLLMFromServer({
          enabled: processMockLLM,
          delay: processMockLLMDelay ?? 500
        }))
      }
    }
  }, [activeProcesses, selectedProcessIndex, singleStepModeExplicit, mockLLMExplicit, dispatch])

  // Active process at selected index (component-level for TraceModal access)
  // Bounded to valid range to handle when processes complete and list shrinks
  const activeIndex = Math.min(selectedProcessIndex, Math.max(0, activeProcesses.length - 1))
  const activeCurrentProcess = activeProcesses.length > 0 ? activeProcesses[activeIndex] : null

  // Transform process for graph: use CURRENT BATCH status for batch-phase steps
  // This prevents showing cumulative "all green" status from previous batches
  // Also handles single-step mode by marking paused step as 'running' for visual feedback
  const processForGraph = useMemo(() => {
    if (!activeCurrentProcess) return null

    // Get current batch's steps (last batch in array) if available
    const batchIterations = activeCurrentProcess.batchIterations
    const currentBatch = batchIterations && batchIterations.length > 0
      ? batchIterations[batchIterations.length - 1]
      : null

    // Batch-phase step names that should use current batch status
    // These repeat per-batch and should NOT show green from previous batches
    const batchPhaseStepNames = new Set([
      'extract_batch_commits', 'extract_batch_sessions',
      'batch_semantic_analysis', 'generate_batch_observations',
      'classify_with_ontology',
      'operator_conv', 'operator_aggr', 'operator_embed',
      'operator_dedup', 'operator_pred', 'operator_merge',
      'batch_qa', 'save_batch_checkpoint',
    ])

    // Build step status from current batch
    const currentBatchStepStatus = new Map<string, { name: string; status: string; duration?: number; outputs?: Record<string, any> }>()
    if (currentBatch?.steps) {
      for (const step of currentBatch.steps) {
        currentBatchStepStatus.set(step.name, step)
      }
    }

    // Transform steps array: use current batch status for batch-phase steps
    // Also mark paused step as 'running' in single-step mode for visual feedback
    const transformedSteps = (activeCurrentProcess.steps || []).map(step => {
      // In single-step mode, mark the paused step as 'running' for visual feedback
      if (singleStepMode && stepPaused && pausedAtStep === step.name) {
        return { ...step, status: 'running' as StepInfo['status'] }
      }

      // Special case: pausedAtStep='kg_operators' but steps are individual operator_* steps
      // Mark operator_conv as 'running' to ensure kg_operators agent shows as active
      if (singleStepMode && stepPaused && pausedAtStep === 'kg_operators' && step.name === 'operator_conv') {
        return { ...step, status: 'running' as StepInfo['status'] }
      }

      if (currentBatch?.steps && batchPhaseStepNames.has(step.name)) {
        // Use current batch status, or 'pending' if not in current batch yet
        // NOTE: Operator steps (operator_conv, etc.) are aggregated as 'kg_operators' in batch steps
        // So we need to check both the individual step name AND the parent agent name
        let currentStatus = currentBatchStepStatus.get(step.name)

        // For operator_* steps, also check kg_operators (aggregated in batch)
        if (!currentStatus && step.name.startsWith('operator_')) {
          currentStatus = currentBatchStepStatus.get('kg_operators')
        }

        if (currentStatus) {
          return { ...step, status: currentStatus.status as StepInfo['status'] }
        }
        // Step not yet reached in current batch - mark as pending
        return { ...step, status: 'pending' as StepInfo['status'] }
      }
      // Non-batch steps (pre-batch, post-batch): keep original status
      return step
    })

    // Also set currentStep to pausedAtStep in single-step mode for arrow animation
    const effectiveCurrentStep = (singleStepMode && stepPaused && pausedAtStep)
      ? pausedAtStep
      : activeCurrentProcess.currentStep

    return {
      ...activeCurrentProcess,
      steps: transformedSteps,
      currentStep: effectiveCurrentStep,
    }
  }, [activeCurrentProcess, singleStepMode, stepPaused, pausedAtStep])

  // Fetch historical workflows when history tab is selected
  useEffect(() => {
    if (open && activeTab === 'history') {
      loadHistoricalWorkflows()
    }
  }, [open, activeTab])

  // Auto-select orchestrator/coordinator when modal opens with active workflows
  // This ensures the sidebar is visible immediately showing workflow overview
  useEffect(() => {
    if (open && activeTab === 'active' && activeProcesses.length > 0 && selectedNode === null) {
      Logger.info(LogCategories.UI, 'Auto-selecting orchestrator node on modal open')
      dispatch(setSelectedNode('orchestrator'))
    }
  }, [open, activeTab, activeProcesses.length, selectedNode, dispatch])

  // Track previous step to detect step changes for auto-switching sidebar
  const previousStepRef = useRef<string | null>(null)
  const previousAgentRef = useRef<string | null>(null)

  // Get expanded sub-steps agent from Redux
  const expandedSubStepsAgent = useSelector(selectExpandedSubStepsAgent)

  // Auto-switch sidebar to currently running/paused step when workflow progresses
  // In single-step mode, use pausedAtStep as the source of truth
  // Users can still manually click to view other steps, but the next step change
  // will switch the sidebar back to the new running step
  useEffect(() => {
    if (!open || activeTab !== 'active' || !activeCurrentProcess) return

    // In single-step mode, prefer pausedAtStep over currentStep
    const effectiveStep = (singleStepMode && pausedAtStep)
      ? pausedAtStep
      : activeCurrentProcess.currentStep

    if (!effectiveStep) return

    // Only switch if step actually changed
    if (effectiveStep !== previousStepRef.current) {
      const previousStep = previousStepRef.current
      previousStepRef.current = effectiveStep

      // Find the agent for the current step
      const agentId = stepToAgent[effectiveStep] || effectiveStep
      if (agentId) {
        Logger.info(LogCategories.UI, 'Auto-switching sidebar to running/paused step', {
          previousStep,
          currentStep: effectiveStep,
          agentId,
          singleStepMode,
          pausedAtStep,
        })
        dispatch(setSelectedNode(agentId))

        // Auto-close sub-steps if we moved to a different agent
        const previousAgentId = previousStep ? (stepToAgent[previousStep] || previousStep) : null
        if (previousAgentId && previousAgentId !== agentId && expandedSubStepsAgent === previousAgentId) {
          Logger.info(LogCategories.UI, 'Auto-closing sub-steps from previous agent', {
            previousAgent: previousAgentId,
            newAgent: agentId,
          })
          dispatch(setExpandedSubStepsAgent(null))
        }
        previousAgentRef.current = agentId
      }
    }
  }, [open, activeTab, activeCurrentProcess?.currentStep, singleStepMode, pausedAtStep, expandedSubStepsAgent, dispatch])

  // Reset step tracking ref when modal closes
  useEffect(() => {
    if (!open) {
      previousStepRef.current = null
    }
  }, [open])

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
  // Auto-select orchestrator to show the workflow overview sidebar
  useEffect(() => {
    if (selectedHistoricalWorkflowState) {
      loadHistoricalWorkflowDetail(selectedHistoricalWorkflowState.id)
      dispatch(setSelectedNode('orchestrator'))
      dispatchSetSelectedSubStep(null)
    }
  }, [selectedHistoricalWorkflowState, dispatchSetSelectedSubStep])

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
    // Clear substep selection when clicking a node
    dispatchSetSelectedSubStep(null)
  }

  // Handler for substep arc selection (MVI: dispatches to Redux)
  const handleSubStepSelect = useCallback((agentId: string, substep: SubStep | null) => {
    Logger.info(LogCategories.AGENT, `Substep ${substep ? 'selected' : 'cleared'}: ${substep?.name || 'none'}`, {
      agentId,
      substepId: substep?.id,
      substepName: substep?.name,
    })
    dispatchSetSelectedSubStep(substep, agentId)
    // Also select the agent node to show sidebar
    if (substep) {
      dispatch(setSelectedNode(agentId))
    }
  }, [dispatch, dispatchSetSelectedSubStep])

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

    // NOTE: activeIndex and activeCurrentProcess are now defined at component level
    // for TraceModal access (line ~285-286)

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
        // If using step-based as floor, use STEP-AWARE ETA instead of linear interpolation
        if (stepBasedProgress > timeBasedProgress && elapsedMs > 0 && stepBasedProgress < 99) {
          // STEP-AWARE ETA: Calculate based on individual step historical durations
          etaMs = calculateStepAwareEta(
            activeCurrentProcess,
            workflowStats,
            elapsedMs
          )
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
              {/* Use processForGraph which has current-batch-only status for batch-phase steps */}
              <div className="flex-1 min-w-0 h-full">
                <UKBWorkflowGraph
                  key={`${activeCurrentProcess.pid}-${activeCurrentProcess.workflowName || 'workflow'}`}
                  process={processForGraph || activeCurrentProcess}
                  onNodeClick={handleNodeClick}
                  onSubStepSelect={handleSubStepSelect}
                  selectedNode={selectedNode}
                  selectedSubStepId={selectedSubStep?.id || null}
                  hideLegend
                />
              </div>

              {/* Right: Details Sidebar */}
              {showSidebar && selectedNode && (
                <div className="flex-shrink-0 overflow-auto">
                  {selectedSubStep ? (
                    (() => {
                      // Find step info for this agent to get runtime data
                      // First check batchIterations for detailed outputs (most detailed for batch steps)
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      let agentStepInfo: any = undefined
                      let combinedOutputs: Record<string, unknown> = {}

                      // Search in batchIterations first (has detailed outputs for batch-phase steps)
                      if (activeCurrentProcess?.batchIterations) {
                        for (const batch of activeCurrentProcess.batchIterations) {
                          const batchStep = batch.steps.find(
                            s => stepToAgent[s.name] === selectedNode || s.name === selectedNode
                          )
                          if (batchStep) {
                            // Merge outputs from all batches for this agent (accumulate counts)
                            if (batchStep.outputs) {
                              Object.entries(batchStep.outputs).forEach(([key, value]) => {
                                const existing = combinedOutputs[key]
                                if (typeof value === 'number' && typeof existing === 'number') {
                                  combinedOutputs[key] = existing + value  // Sum numeric values across batches
                                } else {
                                  combinedOutputs[key] = value  // Use latest value for non-numeric
                                }
                              })
                            }
                            // Use the last matching step for status/duration (most recent)
                            agentStepInfo = batchStep as any
                          }
                        }
                      }

                      // Fall back to stepsDetail (has finalization step outputs)
                      if (!agentStepInfo || Object.keys(combinedOutputs).length === 0) {
                        const stepsDetailInfo = activeCurrentProcess?.steps?.find(
                          s => stepToAgent[s.name] === selectedNode || s.name === selectedNode
                        )
                        if (stepsDetailInfo) {
                          agentStepInfo = stepsDetailInfo
                          if (stepsDetailInfo.outputs) {
                            combinedOutputs = { ...combinedOutputs, ...stepsDetailInfo.outputs }
                          }
                        }
                      }

                      return (
                        <SubStepDetailsSidebar
                          agentId={selectedNode}
                          substep={selectedSubStep}
                          onClose={() => {
                            dispatchSetSelectedSubStep(null)
                          }}
                          onBackToAgent={() => {
                            dispatchSetSelectedSubStep(null)
                          }}
                          stepOutputs={Object.keys(combinedOutputs).length > 0 ? combinedOutputs : agentStepInfo?.outputs}
                          stepStatus={agentStepInfo?.status}
                          stepDuration={agentStepInfo?.duration}
                          llmInfo={{
                            provider: agentStepInfo?.llmProvider,
                            tokensUsed: agentStepInfo?.tokensUsed,
                            llmCalls: agentStepInfo?.llmCalls,
                          }}
                        />
                      )
                    })()
                  ) : (
                    <UKBNodeDetailsSidebar
                      agentId={selectedNode}
                      process={activeCurrentProcess}
                      onClose={handleCloseSidebar}
                    />
                  )}
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
          {/* Compact Info Row - no separate header bar, info moved to main header */}
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
                    onSubStepSelect={handleSubStepSelect}
                    selectedNode={selectedNode}
                    selectedSubStepId={selectedSubStep?.id || null}
                    hideLegend
                  />
                </div>

                {/* Right: Details Sidebar */}
                {showHistoricalSidebar && selectedNode && (
                  <div className="w-80 flex-shrink-0 overflow-auto border rounded-lg bg-background">
                    {selectedSubStep ? (
                      (() => {
                        // Find step info for this agent from historical data
                        const agentStepInfo = historicalProcessInfo?.steps?.find(
                          s => stepToAgent[s.name] === selectedNode || s.name === selectedNode
                        )
                        return (
                          <SubStepDetailsSidebar
                            agentId={selectedNode}
                            substep={selectedSubStep}
                            onClose={() => {
                              dispatchSetSelectedSubStep(null)
                            }}
                            onBackToAgent={() => {
                              dispatchSetSelectedSubStep(null)
                            }}
                            stepOutputs={agentStepInfo?.outputs}
                            stepStatus={agentStepInfo?.status}
                            stepDuration={agentStepInfo?.duration}
                            llmInfo={{
                              provider: agentStepInfo?.llmProvider,
                              tokensUsed: agentStepInfo?.tokensUsed,
                              llmCalls: agentStepInfo?.llmCalls,
                            }}
                          />
                        )
                      })()
                    ) : (
                      <UKBNodeDetailsSidebar
                        agentId={selectedNode}
                        process={historicalProcessInfo}
                        onClose={handleCloseHistoricalSidebar}
                        aggregatedSteps={batchSummary?.aggregatedSteps}
                      />
                    )}
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
      <DialogContent className="max-w-[95vw] w-[1400px] h-[85vh] grid grid-rows-[auto_1fr] gap-3 overflow-hidden">
        <DialogHeader className="pb-0">
          <div className="flex items-center justify-between gap-4">
            {/* Left side: Title + Tabs inline */}
            <div className="flex items-center gap-4">
              <DialogTitle className="flex items-center gap-2 shrink-0">
                <Brain className="h-5 w-5" />
                UKB Workflow Monitor
              </DialogTitle>
              <Tabs value={activeTab} onValueChange={(v) => {
                const newTab = v as 'active' | 'history'
                Logger.info(LogCategories.UKB, `Switching to ${newTab} tab`, {
                  from: activeTab,
                  to: newTab,
                  activeProcessCount: activeProcesses.length,
                  historicalWorkflowCount: historicalWorkflows.length,
                })
                dispatch(setActiveTab(newTab))
                dispatchSetSelectedSubStep(null)
                if (newTab === 'active' && activeProcesses.length > 0) {
                  dispatch(setSelectedNode('orchestrator'))
                }
              }} className="contents">
                <TabsList className="h-8">
                  <TabsTrigger value="active" className="flex items-center gap-1.5 text-xs px-3 h-7">
                    <Loader2 className={`h-3 w-3 ${activeProcesses.length > 0 ? 'animate-spin' : ''}`} />
                    Active
                    {activeProcesses.length > 0 && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {activeProcesses.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="history" className="flex items-center gap-1.5 text-xs px-3 h-7">
                    <History className="h-3 w-3" />
                    History
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {/* Center: Historical workflow context when viewing details */}
            {activeTab === 'history' && selectedHistoricalWorkflowState && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dispatch(selectHistoricalWorkflow(null))}
                  className="h-7 px-2"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
                <Separator orientation="vertical" className="h-5" />
                <span className="text-xs font-medium text-muted-foreground truncate max-w-[200px]">
                  {selectedHistoricalWorkflowState.executionId}
                </span>
                {getStatusBadge(selectedHistoricalWorkflowState.status)}
              </div>
            )}

            {/* Right side: Buttons */}
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
                <>
                  {/* LLM Mock mode control */}
                  <div className="flex items-center gap-2 border-r pr-3 mr-1">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Use mock LLM responses for testing without API calls">
                      <input
                        type="checkbox"
                        checked={mockLLM}
                        onChange={(e) => handleToggleMockLLM(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-orange-500 focus:ring-orange-400 cursor-pointer"
                      />
                      Mock LLM
                    </label>
                    {mockLLM && (
                      <span className="text-xs text-orange-500 font-medium">(active)</span>
                    )}
                  </div>
                  {/* Single-step debugging controls */}
                  <div className="flex items-center gap-2 border-r pr-3 mr-1">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={singleStepMode}
                        onChange={(e) => handleToggleSingleStepMode(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-400 accent-blue-500 cursor-pointer"
                      />
                      Single-step
                    </label>
                    {stepPaused && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStepAdvance}
                        disabled={stepAdvanceLoading}
                        className="flex items-center gap-1 h-7 px-2 text-xs bg-yellow-50 border-yellow-300 hover:bg-yellow-100"
                        title={`Paused at: ${pausedAtStep || 'unknown'}`}
                      >
                        {stepAdvanceLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        Step
                      </Button>
                    )}
                    {singleStepMode && !stepPaused && (
                      <span className="text-xs text-muted-foreground">(waiting)</span>
                    )}
                  </div>
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
                </>
              )}
            </div>
          </div>
        </DialogHeader>

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

                // CRITICAL: Use activeCurrentProcess (displayed process) NOT currentProcess (selector)
                // The selector uses ukb.processes[selectedProcessIndex] which may differ from
                // activeProcesses[activeIndex] when there are completed processes in the list.
                // This mismatch caused the trace to show wrong/empty batchIterations data.

                // Check if this is a batch workflow (has batchIterations data)
                const isBatchWorkflow = activeCurrentProcess?.batchIterations && activeCurrentProcess.batchIterations.length > 0

                if (isBatchWorkflow) {
                  // BATCH WORKFLOW: Build steps as pre-batch → ALL batch iterations → post-batch
                  //
                  // CRITICAL: The 'steps' array (from stepsDetail) contains FLATTENED batch steps
                  // which are ALSO in batchIterations. We must EXCLUDE these to avoid duplicates
                  // and show the proper itemized trace with [batch-XXX] prefixes.

                  // Pre-batch steps: Only initialization steps that run ONCE before batches
                  const preBatchStepNames = new Set([
                    'plan_batches', 'batch_scheduler',
                  ])

                  // Batch-phase steps: These appear in stepsDetail but belong to batchIterations
                  // We EXCLUDE these from stepsDetail and use batchIterations instead
                  const batchPhaseStepNames = new Set([
                    // Extraction
                    'extract_batch_commits', 'extract_batch_sessions',
                    // Analysis
                    'batch_semantic_analysis', 'generate_batch_observations',
                    'classify_with_ontology',
                    // Tree-KG operators
                    'operator_conv', 'operator_aggr', 'operator_embed',
                    'operator_dedup', 'operator_pred', 'operator_merge',
                    // Batch checkpoint
                    'batch_qa', 'save_batch_checkpoint',
                    // Alternative names used in some workflows
                    'kg_operators',
                  ])

                  // Post-batch steps: Finalization that runs ONCE after all batches
                  const finalizationStepNames = new Set([
                    'index_codebase', 'link_documentation', 'synthesize_code_insights',
                    'transform_code_entities', 'final_persist', 'generate_insights',
                    'web_search', 'final_dedup', 'final_validation',
                    // Legacy names
                    'persist_results', 'persist_incremental',
                    'deduplicate_insights', 'deduplicate_incremental',
                    'validate_content', 'validate_content_incremental',
                  ])

                  const preBatchSteps: StepInfo[] = []
                  const postBatchSteps: StepInfo[] = []

                  // Categorize stepsDetail: pre-batch OR post-batch only
                  // Skip batch-phase steps since they're already in batchIterations
                  if (activeCurrentProcess?.steps && activeCurrentProcess.steps.length > 0) {
                    for (const step of activeCurrentProcess.steps) {
                      const stepNameLower = step.name.toLowerCase()

                      // Skip batch-phase steps - they're in batchIterations
                      if (batchPhaseStepNames.has(step.name)) {
                        continue
                      }

                      const stepInfo = {
                        ...step,
                        name: stepToAgent[step.name] || step.name,
                      }

                      if (preBatchStepNames.has(step.name)) {
                        preBatchSteps.push(stepInfo)
                      } else if (finalizationStepNames.has(stepNameLower)) {
                        postBatchSteps.push(stepInfo)
                      }
                      // Any other steps not explicitly categorized are skipped
                      // (they should be in batchIterations if they're batch-phase)
                    }
                  }

                  // 1. Add pre-batch steps first (e.g., plan_batches)
                  allSteps.push(...preBatchSteps)

                  // 2. Add ALL batch iteration steps with [batch-XXX] prefix
                  // This is the ITEMIZED view showing each batch's steps
                  for (const batch of activeCurrentProcess.batchIterations!) {
                    for (const step of batch.steps) {
                      allSteps.push({
                        name: `[${batch.batchId}] ${stepToAgent[step.name] || step.name}`,
                        status: step.status,
                        duration: step.duration,
                        outputs: step.outputs,
                        tokensUsed: step.tokensUsed,
                        llmProvider: step.llmProvider,
                        llmCalls: step.llmCalls,
                      })
                    }
                  }

                  // 3. Add post-batch steps last (finalization: persistence, dedup, validation)
                  allSteps.push(...postBatchSteps)
                } else {
                  // STANDARD WORKFLOW: Show steps in their natural execution order
                  // No reordering needed - persistence runs after its dependencies complete
                  if (activeCurrentProcess?.steps && activeCurrentProcess.steps.length > 0) {
                    for (const step of activeCurrentProcess.steps) {
                      allSteps.push({
                        ...step,
                        name: stepToAgent[step.name] || step.name,
                      })
                    }
                  }
                }

                return allSteps
              })()
            : (() => {
                // HISTORY MODE: Build steps with batch iteration grouping
                const allSteps: StepInfo[] = []

                // Check if this historical workflow has completed batches data
                const hasCompletedBatches = historicalWorkflowDetail?.completedBatches &&
                                           historicalWorkflowDetail.completedBatches.length > 0

                if (hasCompletedBatches && historicalWorkflowDetail?.steps) {
                  // BATCH WORKFLOW: Build steps as pre-batch → ALL batch iterations → post-batch
                  // Similar logic to active mode, but using completedBatches for iteration grouping

                  // Pre-batch step names
                  const preBatchStepNames = new Set(['batch_scheduler', 'plan_batches'])

                  // Batch-phase agent names (these repeat per batch)
                  const batchPhaseAgentNames = new Set([
                    'git_history', 'vibe_history', 'semantic_analysis',
                    'observation_generation', 'ontology_classification',
                    'kg_operators', 'context_convolution', 'entity_aggregation',
                    'node_embedding', 'deduplication_operator', 'edge_prediction',
                    'structure_merge', 'quality_assurance', 'batch_checkpoint_manager'
                  ])

                  // Post-batch step names (finalization)
                  const postBatchStepNames = new Set([
                    'code_graph', 'code_intelligence', 'documentation_linker',
                    'persistence', 'deduplication', 'content_validation',
                    'insight_generation', 'web_search', 'final_persist',
                    'final_dedup', 'final_validation', 'persist_results',
                    'deduplicate_insights', 'validate_content'
                  ])

                  const preBatchSteps: StepInfo[] = []
                  const postBatchSteps: StepInfo[] = []

                  // Categorize historical steps
                  for (const step of historicalWorkflowDetail.steps) {
                    const agentName = step.agent || step.name
                    const stepInfo: StepInfo = {
                      name: agentName,
                      status: step.status === 'success' ? 'completed' : step.status as any,
                      duration: step.duration ? parseFloat(String(step.duration).replace(/s$/i, '')) * 1000 : undefined,
                      llmProvider: (step as any).llmProvider,
                      tokensUsed: (step as any).tokensUsed,
                      llmCalls: (step as any).llmCalls,
                      error: step.errors?.join('\n'),
                      outputs: step.outputs,
                    }

                    if (preBatchStepNames.has(agentName)) {
                      preBatchSteps.push(stepInfo)
                    } else if (postBatchStepNames.has(agentName)) {
                      postBatchSteps.push(stepInfo)
                    }
                    // Skip batch-phase steps - we'll create them from completedBatches
                  }

                  // 1. Add pre-batch steps first
                  allSteps.push(...preBatchSteps)

                  // 2. Add batch iteration steps with [batch-XXX] prefix
                  // Use detailed stepOutputs when available (new format), otherwise fall back to summary stats
                  for (const batch of historicalWorkflowDetail.completedBatches!) {
                    const batchDuration = batch.stats?.duration || 0
                    const batchStats = batch.stats

                    // Check if we have detailed step outputs (new format with arrays of commits, sessions, etc.)
                    if (batch.stepOutputs && batch.stepOutputs.length > 0) {
                      // Use detailed step outputs - includes actual commit arrays, session arrays, etc.
                      for (const step of batch.stepOutputs) {
                        allSteps.push({
                          name: `[${batch.batchId}] ${step.name}`,
                          status: step.status as any,
                          duration: step.duration,
                          outputs: step.outputs,  // Full outputs with arrays (commits, sessions, etc.)
                          tokensUsed: step.tokensUsed,
                          llmProvider: step.llmProvider,
                          llmCalls: step.llmCalls,
                        })
                      }
                    } else {
                      // Fallback: Create summary steps from batch stats (old format, backwards compatible)
                      allSteps.push({
                        name: `[${batch.batchId}] git history`,
                        status: 'completed',
                        duration: batchStats?.operatorResults?.conv?.duration,
                        outputs: { commits: batchStats?.commits || 0 },
                      })

                      if ((batchStats?.sessions || 0) > 0) {
                        allSteps.push({
                          name: `[${batch.batchId}] vibe history`,
                          status: 'completed',
                          outputs: { sessions: batchStats?.sessions || 0 },
                        })
                      }

                      allSteps.push({
                        name: `[${batch.batchId}] semantic analysis`,
                        status: 'completed',
                        outputs: {
                          entities: batchStats?.entitiesCreated || 0,
                          relations: batchStats?.relationsAdded || 0
                        },
                      })

                      allSteps.push({
                        name: `[${batch.batchId}] kg operators`,
                        status: 'completed',
                        duration: Object.values(batchStats?.operatorResults || {}).reduce(
                          (sum, op) => sum + (op.duration || 0), 0
                        ),
                        outputs: {
                          processed: batchStats?.operatorResults?.conv?.processed || 0,
                          merged: batchStats?.operatorResults?.dedup?.merged || 0,
                        },
                      })

                      allSteps.push({
                        name: `[${batch.batchId}] batch checkpoint`,
                        status: 'completed',
                        duration: batchDuration,
                        outputs: {
                          batchNumber: batch.batchNumber,
                          dateRange: batch.dateRange?.start ?
                            `${new Date(batch.dateRange.start).toLocaleDateString()} - ${new Date(batch.dateRange.end || '').toLocaleDateString()}`
                            : undefined
                        },
                      })
                    }
                  }

                  // 3. Add post-batch steps last
                  allSteps.push(...postBatchSteps)
                } else {
                  // No batch data - show flat list (fallback)
                  for (const step of historicalWorkflowDetail?.steps || []) {
                    allSteps.push({
                      name: step.agent || step.name,
                      status: step.status === 'success' ? 'completed' : step.status as any,
                      duration: step.duration ? parseFloat(String(step.duration).replace(/s$/i, '')) * 1000 : undefined,
                      llmProvider: (step as any).llmProvider,
                      tokensUsed: (step as any).tokensUsed,
                      llmCalls: (step as any).llmCalls,
                      error: step.errors?.join('\n'),
                      outputs: step.outputs,
                    })
                  }
                }

                return allSteps
              })()
        }
        workflowName={
          activeTab === 'active'
            ? activeCurrentProcess?.workflowName || 'Unknown'
            : selectedHistoricalWorkflowState?.workflowName || 'Unknown'
        }
        startTime={
          activeTab === 'active'
            ? activeCurrentProcess?.startTime
            : selectedHistoricalWorkflowState?.startTime || undefined
        }
      />
    </Dialog>
  )
}

// Mapping from agent+substep to output field names for runtime data display
// This maps substep IDs to the actual output fields from workflow-progress.json
// Fields use dot notation for nested values (e.g., 'codeGraphStats.totalEntities')
const SUBSTEP_OUTPUT_MAPPINGS: Record<string, Record<string, { inputFields?: string[]; outputFields?: string[] }>> = {
  'git_history': {
    // extract_batch_commits outputs: { commitsCount }
    'fetch': { outputFields: ['commitsCount'] },
    'diff': { inputFields: ['commitsCount'], outputFields: ['commitsCount'] },  // Reuse commitsCount for visibility
    'extract': { inputFields: ['commitsCount'], outputFields: ['commitsCount'] },
  },
  'vibe_history': {
    // extract_batch_sessions outputs: { sessionsCount }
    'fetch': { outputFields: ['sessionsCount'] },
    'parse': { inputFields: ['sessionsCount'], outputFields: ['sessionsCount'] },
    'extract': { inputFields: ['sessionsCount'], outputFields: ['sessionsCount'] },
  },
  'semantic_analysis': {
    // batch_semantic_analysis outputs: { batchEntities, batchRelations }
    'parse': { outputFields: ['batchEntities'] },
    'extract': { outputFields: ['batchEntities'] },
    'relate': { inputFields: ['batchEntities'], outputFields: ['batchRelations'] },
    'enrich': { inputFields: ['batchEntities'], outputFields: ['batchEntities', 'batchRelations'] },
  },
  'ontology_classification': {
    // classify_with_ontology outputs: { classified, llmCalls, byClass, byMethod }
    'match': { inputFields: ['batchEntities'], outputFields: ['classified'] },
    'validate': { inputFields: ['classified'], outputFields: ['classified', 'llmCalls'] },
    'extend': { outputFields: ['byClass'] },
  },
  'kg_operators': {
    // kg_operators outputs: { entitiesAfter, relationsAfter }
    'conv': { outputFields: ['entitiesAfter'] },
    'aggr': { outputFields: ['entitiesAfter'] },
    'embed': { outputFields: ['entitiesAfter'] },
    'dedup': { outputFields: ['entitiesAfter'] },
    'pred': { outputFields: ['relationsAfter'] },
    'merge': { inputFields: ['entitiesAfter', 'relationsAfter'], outputFields: ['entitiesAfter', 'relationsAfter'] },
  },
  'quality_assurance': {
    // batch_qa outputs: { entitiesCreated, relationsAdded }
    'validate': { inputFields: ['entitiesAfter'], outputFields: ['entitiesCreated'] },
    'score': { outputFields: ['entitiesCreated', 'relationsAdded'] },
    'report': { outputFields: ['entitiesCreated', 'relationsAdded'] },
  },
  'batch_scheduler': {
    // plan_batches has no rich outputs in batch progress, but we can show batch progress
    'plan': { outputFields: ['totalBatches'] },
    'track': { outputFields: ['currentBatch', 'totalBatches'] },
    'resume': { outputFields: ['totalBatches'] },
  },
  'observation_generation': {  // Fixed: was 'observation_generator'
    // generate_batch_observations outputs: { observationsCount }
    'extract': { outputFields: ['observationsCount'] },
    'format': { inputFields: ['observationsCount'], outputFields: ['observationsCount'] },
  },
  'code_graph': {
    // index_codebase outputs: { codeGraphStats: { totalEntities, totalRelationships, ... } }
    'index': { outputFields: ['codeGraphStats.totalEntities', 'codeGraphStats.totalRelationships'] },
    'query': { inputFields: ['codeGraphStats.totalEntities'], outputFields: ['codeGraphStats.totalEntities'] },
    'analyze': { inputFields: ['codeGraphStats.totalEntities'], outputFields: ['codeGraphStats.totalEntities', 'codeGraphStats.totalRelationships'] },
  },
  'insight_generation': {
    // generate_insights outputs: { totalInsights, insightDocuments, totalPatterns }
    'patterns': { outputFields: ['totalPatterns'] },
    'arch': { outputFields: ['totalInsights'] },
    'docs': { outputFields: ['insightDocuments'] },
    'synth': { outputFields: ['totalInsights', 'totalPatterns'] },
  },
}

// Helper to get nested property values via dot notation (e.g., 'codeGraphStats.totalEntities')
function getNestedValue(obj: Record<string, any> | undefined, path: string): any {
  if (!obj) return undefined
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

// Helper to format field name for display (handles dot notation)
function formatFieldLabel(field: string): string {
  // For nested fields like 'codeGraphStats.totalEntities', use only the last part
  const displayName = field.includes('.') ? field.split('.').pop() || field : field
  return displayName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
}

// Helper to format output values for display
function formatOutputValue(_key: string, value: any): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return value.toLocaleString()
  if (Array.isArray(value)) return `${value.length} items`
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 50) + '...'
  return String(value)
}

// Sidebar component for substep details
function SubStepDetailsSidebar({
  agentId,
  substep,
  onClose: _onClose, // Kept for API compatibility, using onBackToAgent instead
  onBackToAgent,
  stepOutputs,
  stepStatus,
  stepDuration,
  llmInfo,
}: {
  agentId: string
  substep: SubStep
  onClose: () => void
  onBackToAgent: () => void
  stepOutputs?: Record<string, any>
  stepStatus?: string
  stepDuration?: number
  llmInfo?: { provider?: string; tokensUsed?: number; llmCalls?: number }
}) {
  // Get agent info for context
  const agentSubsteps = AGENT_SUBSTEPS[agentId]
  const substepIndex = agentSubsteps?.findIndex(s => s.id === substep.id) ?? -1

  // Get substep-specific output mapping
  const substepMapping = SUBSTEP_OUTPUT_MAPPINGS[agentId]?.[substep.id]

  // Extract actual runtime values for this substep (supports dot notation for nested fields)
  const getRuntimeInputs = (): Array<{ label: string; value: string }> => {
    if (!stepOutputs || !substepMapping?.inputFields) return []
    return substepMapping.inputFields
      .filter(field => getNestedValue(stepOutputs, field) !== undefined)
      .map(field => ({
        label: formatFieldLabel(field),
        value: formatOutputValue(field, getNestedValue(stepOutputs, field))
      }))
  }

  const getRuntimeOutputs = (): Array<{ label: string; value: string }> => {
    if (!stepOutputs || !substepMapping?.outputFields) return []
    return substepMapping.outputFields
      .filter(field => getNestedValue(stepOutputs, field) !== undefined)
      .map(field => ({
        label: formatFieldLabel(field),
        value: formatOutputValue(field, getNestedValue(stepOutputs, field))
      }))
  }

  const runtimeInputs = getRuntimeInputs()
  const runtimeOutputs = getRuntimeOutputs()

  // LLM usage badge color
  const getLlmUsageBadge = (usage?: string) => {
    switch (usage) {
      case 'none':
        return <Badge variant="outline" className="text-gray-500">No LLM</Badge>
      case 'fast':
        return <Badge className="bg-green-500 text-white">Fast LLM</Badge>
      case 'standard':
        return <Badge className="bg-blue-500 text-white">Standard LLM</Badge>
      case 'premium':
        return <Badge className="bg-purple-500 text-white">Premium LLM</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  return (
    <Card className="w-80 h-full overflow-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={onBackToAgent}
              title="Back to agent details"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-lg">{substep.name}</CardTitle>
          </div>
          {getLlmUsageBadge(substep.llmUsage)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Sub-step {substepIndex + 1} of {agentSubsteps?.length || 0} in {agentId.replace(/_/g, ' ')}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Description */}
        <div>
          <div className="text-sm text-muted-foreground">{substep.description}</div>
        </div>

        <Separator />

        {/* Runtime Execution Info - only show if we have data */}
        {(stepStatus || stepDuration || llmInfo?.tokensUsed) && (
          <>
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Timer className="h-4 w-4 text-orange-500" />
                Execution
              </h4>
              <div className="text-sm space-y-1 bg-muted/50 rounded p-2">
                {stepStatus && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={
                      stepStatus === 'completed' ? 'text-green-600 font-medium' :
                      stepStatus === 'running' ? 'text-blue-600 font-medium' :
                      stepStatus === 'failed' ? 'text-red-600 font-medium' :
                      'text-muted-foreground'
                    }>
                      {stepStatus.charAt(0).toUpperCase() + stepStatus.slice(1)}
                    </span>
                  </div>
                )}
                {stepDuration !== undefined && stepDuration > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span>{stepDuration < 1000 ? `${stepDuration}ms` : `${(stepDuration / 1000).toFixed(1)}s`}</span>
                  </div>
                )}
                {llmInfo?.tokensUsed !== undefined && llmInfo.tokensUsed > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tokens</span>
                    <span>{llmInfo.tokensUsed.toLocaleString()}</span>
                  </div>
                )}
                {llmInfo?.provider && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider</span>
                    <span className="text-xs font-mono">{llmInfo.provider}</span>
                  </div>
                )}
                {llmInfo?.llmCalls !== undefined && llmInfo.llmCalls > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">LLM Calls</span>
                    <span>{llmInfo.llmCalls}</span>
                  </div>
                )}
              </div>
            </div>
            <Separator />
          </>
        )}

        {/* Inputs - show runtime values if available, otherwise static descriptions */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-blue-500" />
            Inputs
            {runtimeInputs.length > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 bg-blue-50 text-blue-600">Live</Badge>
            )}
          </h4>
          {runtimeInputs.length > 0 ? (
            <div className="text-sm space-y-1 bg-blue-50/50 rounded p-2">
              {runtimeInputs.map((input, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="text-muted-foreground">{input.label}</span>
                  <span className="font-medium text-blue-700">{input.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <ul className="text-sm space-y-1 pl-4">
              {substep.inputs.map((input, idx) => (
                <li key={idx} className="text-muted-foreground flex items-start gap-1">
                  <span className="text-blue-400">•</span>
                  {input}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Outputs - show runtime values if available, otherwise static descriptions */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Outputs
            {runtimeOutputs.length > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 bg-green-50 text-green-600">Live</Badge>
            )}
          </h4>
          {runtimeOutputs.length > 0 ? (
            <div className="text-sm space-y-1 bg-green-50/50 rounded p-2">
              {runtimeOutputs.map((output, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="text-muted-foreground">{output.label}</span>
                  <span className="font-medium text-green-700">{output.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <ul className="text-sm space-y-1 pl-4">
              {substep.outputs.map((output, idx) => (
                <li key={idx} className="text-muted-foreground flex items-start gap-1">
                  <span className="text-green-400">•</span>
                  {output}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Technical Note */}
        {substep.techNote && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-500" />
                Technical Note
              </h4>
              <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
                {substep.techNote}
              </p>
            </div>
          </>
        )}

        {/* Short Name for identification */}
        <Separator />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>ID: {substep.id}</span>
          <span>Short: {substep.shortName}</span>
        </div>
      </CardContent>
    </Card>
  )
}
