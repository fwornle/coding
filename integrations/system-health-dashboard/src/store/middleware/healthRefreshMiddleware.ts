import { Middleware } from '@reduxjs/toolkit'
import {
  fetchHealthStatusStart,
  fetchHealthStatusSuccess,
  fetchHealthStatusFailure,
} from '../slices/healthStatusSlice'
import {
  fetchHealthReportStart,
  fetchHealthReportSuccess,
  fetchHealthReportFailure,
} from '../slices/healthReportSlice'
import {
  fetchAPIQuotaStart,
  fetchAPIQuotaSuccess,
  fetchAPIQuotaFailure,
} from '../slices/apiQuotaSlice'
import {
  fetchUKBStatusStart,
  fetchUKBStatusSuccess,
  fetchUKBStatusFailure,
  syncStepPauseFromServer,
} from '../slices/ukbSlice'
import { Logger, LogCategories } from '../../utils/logging'

const API_PORT = process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'
const API_BASE_URL = `http://localhost:${API_PORT}/api/health-verifier`
const UKB_API_URL = `http://localhost:${API_PORT}/api/ukb`

// Singleton manager for auto-refresh
class HealthRefreshManager {
  private refreshInterval: NodeJS.Timeout | null = null
  private store: any = null
  private refreshCount = 0
  private sseConnection: EventSource | null = null
  private lastSSEUpdate: number = 0

  initialize(store: any) {
    this.store = store
    Logger.info(LogCategories.REFRESH, 'HealthRefreshManager initialized')
    this.startAutoRefresh()
    this.connectSSE()
  }

  /**
   * Connect to SSE stream for real-time UKB workflow updates
   * This supplements the polling with instant state change notifications
   */
  private connectSSE() {
    if (typeof window === 'undefined') return // SSR check

    try {
      const sseUrl = `http://localhost:${process.env.NEXT_PUBLIC_SYSTEM_HEALTH_API_PORT || process.env.SYSTEM_HEALTH_API_PORT || '3033'}/api/ukb/stream`
      this.sseConnection = new EventSource(sseUrl)

      this.sseConnection.onopen = () => {
        Logger.info(LogCategories.REFRESH, 'SSE connection established for real-time workflow updates')
      }

      this.sseConnection.onmessage = (event) => {
        try {
          const workflowProgress = JSON.parse(event.data)
          this.lastSSEUpdate = Date.now()

          if (workflowProgress) {
            Logger.trace(LogCategories.REFRESH, `SSE update: step=${workflowProgress.currentStep} details=${workflowProgress.stepsDetail?.length || 0}`)
            // Transform SSE data to match the expected format and dispatch update
            this.handleSSEWorkflowUpdate(workflowProgress)
          }
        } catch (error) {
          // Ignore parse errors - could be heartbeat
        }
      }

      this.sseConnection.onerror = (error) => {
        Logger.warn(LogCategories.REFRESH, 'SSE connection error, reconnecting in 2s...', error)
        // Close the failed connection
        if (this.sseConnection) {
          this.sseConnection.close()
          this.sseConnection = null
        }
        // Reconnect after a delay
        setTimeout(() => {
          Logger.info(LogCategories.REFRESH, 'Attempting SSE reconnection...')
          this.connectSSE()
        }, 2000)
      }
    } catch (error) {
      Logger.warn(LogCategories.REFRESH, 'Failed to establish SSE connection', error)
    }
  }

  /**
   * Handle real-time workflow progress from SSE
   * Transforms the raw progress data and dispatches Redux action
   */
  private handleSSEWorkflowUpdate(progress: any) {
    if (!this.store || !progress) return

    // Build a synthetic process object similar to what the REST API returns
    // This allows the Redux slice to handle it the same way
    const isTerminalState = ['cancelled', 'completed', 'failed'].includes(progress.status)

    if (isTerminalState) {
      // Terminal state - let normal polling handle cleanup
      return
    }

    // Calculate step counts from stepsDetail
    let completedSteps = progress.completedSteps || 0
    let totalSteps = progress.totalSteps || 0

    if ((completedSteps === 0 || totalSteps === 0) && progress.stepsDetail?.length > 0) {
      totalSteps = progress.stepsDetail.length
      completedSteps = progress.stepsDetail.filter((s: any) => s.status === 'completed').length
    }

    const inlineProcess = {
      pid: 'mcp-inline',
      workflowName: progress.workflowName,
      team: progress.team || 'unknown',
      repositoryPath: progress.repositoryPath,
      startTime: progress.startTime,
      lastHeartbeat: progress.lastUpdate,
      status: progress.status,
      completedSteps,
      totalSteps,
      currentStep: progress.currentStep,
      stepsCompleted: progress.stepsCompleted || [],
      stepsFailed: progress.stepsFailed || [],
      elapsedSeconds: progress.elapsedSeconds || 0,
      logFile: null,
      isAlive: progress.status === 'running',
      health: 'healthy',
      heartbeatAgeSeconds: 0,
      progressPercent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      steps: progress.stepsDetail || [],
      isInlineMCP: true,
      batchProgress: progress.batchProgress || null,
      batchIterations: progress.batchIterations || null,
      singleStepMode: progress.singleStepMode === true,
      stepPaused: progress.stepPaused === true,
      pausedAtStep: progress.pausedAtStep || null,
      mockLLM: progress.mockLLM === true,
      mockLLMDelay: progress.mockLLMDelay || 500,
      _refreshKey: `mcp-inline-${Date.now()}`, // Force React re-render
    }

    // Dispatch update with fresh data
    this.store.dispatch(fetchUKBStatusSuccess({
      summary: { total: 1, running: 1, stale: 0, frozen: 0, dead: 0 },
      processes: [inlineProcess],
      _lastRefresh: Date.now(),
      _fromSSE: true, // Flag to indicate this came from SSE
    }))

    // CRITICAL: Also sync pausedAtStep to top-level state for auto-selection effect
    // The auto-selection in ukb-workflow-modal depends on selectPausedAtStep (top-level state),
    // not on process.pausedAtStep, so we must sync them
    this.store.dispatch(syncStepPauseFromServer({
      paused: progress.stepPaused === true,
      pausedAt: progress.pausedAtStep || null
    }))

    Logger.trace(LogCategories.UKB, `SSE update: ${progress.workflowName} [${completedSteps}/${totalSteps}]`)
  }

  disconnectSSE() {
    if (this.sseConnection) {
      this.sseConnection.close()
      this.sseConnection = null
      Logger.info(LogCategories.REFRESH, 'SSE connection closed')
    }
  }

  startAutoRefresh() {
    if (this.refreshInterval) return

    Logger.info(LogCategories.REFRESH, 'Starting auto-refresh cycle (500ms interval for smooth workflow updates)')

    // Initial fetch
    this.fetchAllData()

    // Auto-refresh every 500ms for smooth workflow visualization
    this.refreshInterval = setInterval(() => {
      this.fetchAllData()
    }, 500)
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
      Logger.info(LogCategories.REFRESH, 'Auto-refresh stopped')
    }
    this.disconnectSSE()
  }

  async fetchAllData() {
    if (!this.store) return

    this.refreshCount++
    // Only log every 10th refresh cycle to reduce noise
    if (this.refreshCount % 10 === 0) {
      Logger.trace(LogCategories.REFRESH, `Refresh cycle #${this.refreshCount}`)
    }

    // Fetch health status
    await this.fetchHealthStatus()
    // Fetch health report
    await this.fetchHealthReport()
    // Fetch API quota data
    await this.fetchAPIQuota()
    // Fetch UKB process status
    await this.fetchUKBStatus()
  }

  private async fetchHealthStatus() {
    if (!this.store) return

    try {
      const response = await fetch(`${API_BASE_URL}/status`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        // Use getState/dispatch from store API
        this.store.dispatch(fetchHealthStatusSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      this.store.dispatch(fetchHealthStatusFailure(error.message))
      Logger.error(LogCategories.HEALTH, 'Failed to fetch health status:', error)
    }
  }

  private async fetchHealthReport() {
    if (!this.store) return

    try {
      const response = await fetch(`${API_BASE_URL}/report`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data && result.data.summary) {
        this.store.dispatch(fetchHealthReportSuccess(result.data))
      } else if (result.status === 'success') {
        // No full report available (health verifier not running) - leave report as null
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      this.store.dispatch(fetchHealthReportFailure(error.message))
      Logger.error(LogCategories.HEALTH, 'Failed to fetch health report:', error)
    }
  }

  private async fetchAPIQuota() {
    if (!this.store) return

    try {
      const response = await fetch(`${API_BASE_URL}/api-quota`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        this.store.dispatch(fetchAPIQuotaSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      this.store.dispatch(fetchAPIQuotaFailure(error.message))
      Logger.error(LogCategories.API, 'Failed to fetch API quota:', error)
    }
  }

  private async fetchUKBStatus() {
    if (!this.store) return

    try {
      const response = await fetch(`${UKB_API_URL}/processes`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (result.status === 'success' && result.data) {
        const processes = result.data.processes || []

        // Enhanced logging for multi-agent visibility - ONLY for running workflows
        if (processes.length > 0) {
          processes.forEach((p: any) => {
            // Skip logging for completed/idle workflows to avoid console spam
            if (p.status !== 'running') {
              return
            }

            // Basic process info
            const workflowName = p.workflowName || '(initializing)'
            const batchInfo = p.batchProgress
              ? `Batch ${p.batchProgress.currentBatch}/${p.batchProgress.totalBatches}`
              : ''

            // Current step/agent info
            const currentStep = p.currentStep || p.steps?.find((s: any) => s.status === 'running')?.name
            const stepAgent = currentStep ? this.getAgentName(currentStep) : 'waiting'

            // Log main workflow status
            Logger.info(
              LogCategories.UKB,
              `📊 ${workflowName} [${p.completedSteps || 0}/${p.totalSteps || 0}] ${batchInfo}`,
              { pid: p.pid, status: p.status, health: p.health, elapsed: `${p.elapsedSeconds || 0}s` }
            )

            // Log current agent activity
            if (currentStep && p.status === 'running') {
              Logger.info(
                LogCategories.AGENT,
                `▶️ ${stepAgent}: ${this.formatStepDescription(currentStep)}`,
                { step: currentStep }
              )
            }

            // Log batch iteration details if available
            if (p.batchIterations?.length > 0) {
              const currentBatch = p.batchIterations[p.batchIterations.length - 1]
              if (currentBatch) {
                const runningSteps = currentBatch.steps?.filter((s: any) => s.status === 'running') || []
                const completedSteps = currentBatch.steps?.filter((s: any) => s.status === 'completed') || []

                // Log running steps
                runningSteps.forEach((step: any) => {
                  const agent = this.getAgentName(step.name)
                  Logger.trace(
                    LogCategories.BATCH,
                    `  ⏳ [${currentBatch.batchId}] ${agent} running...`,
                    { step: step.name, duration: step.duration }
                  )
                })

                // Log recently completed steps with outputs
                const recentCompleted = completedSteps.slice(-2)
                recentCompleted.forEach((step: any) => {
                  const agent = this.getAgentName(step.name)
                  const outputs = this.summarizeOutputs(step.outputs)
                  if (outputs) {
                    Logger.trace(
                      LogCategories.BATCH,
                      `  ✅ [${currentBatch.batchId}] ${agent} → ${outputs}`,
                      { step: step.name, duration: step.duration }
                    )
                  }
                })
              }
            }

            // Log accumulated stats if available
            if (p.accumulatedStats) {
              const stats = p.accumulatedStats
              Logger.debug(
                LogCategories.TRACE,
                `📈 Stats: ${stats.totalEntities || 0} entities, ${stats.totalRelations || 0} relations, ${stats.tokensUsed || 0} tokens`
              )
            }
          })
        }

        this.store.dispatch(fetchUKBStatusSuccess(result.data))
      } else {
        throw new Error(result.message || 'Invalid response format')
      }
    } catch (error: any) {
      Logger.warn(LogCategories.UKB, 'Failed to fetch UKB status:', error.message)
      this.store.dispatch(fetchUKBStatusFailure(error.message))
    }
  }

  // Map step names to friendly agent names
  private getAgentName(stepName: string): string {
    const agentMap: Record<string, string> = {
      'git_history_analysis': 'Git History',
      'vibe_history_analysis': 'Vibe History',
      'semantic_analysis': 'Semantic Analyzer',
      'code_graph_analysis': 'Code Graph (CGR)',
      'ontology_classification': 'Ontology Classifier',
      'observation_generation': 'Observation Gen',
      'deduplication': 'Deduplication',
      'quality_assurance': 'QA Agent',
      'content_validation': 'Content Validator',
      'documentation_linking': 'Doc Linker',
      'insight_generation': 'Insight Gen',
      'persistence': 'Persistence',
      'checkpoint_save': 'Checkpoint',
      'generate_batch_observations': 'Observation Gen',
      'persist_knowledge': 'Persistence',
      'refresh_stale_entities': 'Entity Refresh',
    }
    return agentMap[stepName] || stepName.replace(/_/g, ' ')
  }

  // Format step description
  private formatStepDescription(stepName: string): string {
    const descriptions: Record<string, string> = {
      'git_history_analysis': 'Analyzing git commits for code changes...',
      'vibe_history_analysis': 'Processing session logs for insights...',
      'semantic_analysis': 'Running LLM semantic analysis...',
      'code_graph_analysis': 'Building AST-based code graph...',
      'ontology_classification': 'Classifying entities against ontology...',
      'observation_generation': 'Generating knowledge observations...',
      'deduplication': 'Removing duplicate entities...',
      'quality_assurance': 'Validating entity quality...',
      'content_validation': 'Checking content accuracy...',
      'documentation_linking': 'Linking to documentation...',
      'insight_generation': 'Creating insights and diagrams...',
      'persistence': 'Saving to knowledge graph...',
      'checkpoint_save': 'Saving workflow checkpoint...',
      'generate_batch_observations': 'Generating batch observations...',
      'persist_knowledge': 'Persisting to knowledge base...',
      'refresh_stale_entities': 'Refreshing outdated entities...',
    }
    return descriptions[stepName] || `Processing ${stepName.replace(/_/g, ' ')}...`
  }

  // Summarize step outputs for logging
  private summarizeOutputs(outputs: any): string {
    if (!outputs) return ''
    const parts: string[] = []

    if (outputs.entitiesExtracted) parts.push(`${outputs.entitiesExtracted} entities`)
    if (outputs.relationsExtracted) parts.push(`${outputs.relationsExtracted} relations`)
    if (outputs.tokensUsed) parts.push(`${outputs.tokensUsed} tokens`)
    if (outputs.classified) parts.push(`${outputs.classified} classified`)
    if (outputs.unclassified) parts.push(`${outputs.unclassified} unclassified`)
    if (outputs.llmCalls) parts.push(`${outputs.llmCalls} LLM calls`)
    if (outputs.persisted) parts.push(`${outputs.persisted} persisted`)
    if (outputs.commits) parts.push(`${outputs.commits} commits`)
    if (outputs.sessions) parts.push(`${outputs.sessions} sessions`)

    return parts.join(', ')
  }
}

export const healthRefreshManager = new HealthRefreshManager()

export const healthRefreshMiddleware: Middleware = (store) => {
  // Initialize the manager with the store
  healthRefreshManager.initialize(store)

  return (next) => (action) => {
    return next(action)
  }
}
