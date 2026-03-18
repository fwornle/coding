import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit'
import { STEP_TO_AGENT as FALLBACK_STEP_TO_AGENT } from '@/components/workflow/constants'
import type { WorkflowState } from '@/shared/workflow-types/state'
import type { StepDefinition } from '@/shared/workflow-types/schemas'
import { deriveStepStatuses } from '@/shared/workflow-types/derived'

// LLM Mode types for per-agent control
export type LLMMode = 'mock' | 'local' | 'public'

export interface LLMState {
  globalMode: LLMMode
  perAgentOverrides: Record<string, LLMMode>
  updatedAt?: string
}

// Event-driven workflow types
// Note: These types are copied from workflow-events.ts to avoid cross-package imports
// Keep in sync with the coordinator's event types

export type EventStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface EventStepStatusInfo {
  name: string
  status: EventStepStatus
  agent: string
  duration?: number
  tokensUsed?: number
  llmProvider?: string
  llmCalls?: number
  // LLM mode tracking for visibility
  llmIntendedMode?: 'mock' | 'local' | 'public'
  llmActualMode?: 'mock' | 'local' | 'public'
  llmModeFallback?: boolean  // True if actual differs from intended
  error?: string
  outputs?: Record<string, unknown>
}

export interface EventSubstepStatusInfo {
  substepId: string
  status: EventStepStatus
  duration?: number
  tokensUsed?: number
  llmProvider?: string
}

export interface EventBatchProgress {
  currentBatch: number
  totalBatches: number
  batchId?: string
}

// Event-driven execution state (single source of truth for active workflow)
export interface WorkflowExecutionState {
  workflowId: string | null
  workflowName: string | null
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
  currentStep: string | null
  currentSubstep: string | null
  stepStatuses: Record<string, EventStepStatusInfo>
  substepStatuses: Record<string, Record<string, EventSubstepStatusInfo>>
  batchProgress: EventBatchProgress | null
  batchPhaseSteps: string[]  // Names of steps that repeat per batch (from YAML)
  startTime: string | null
  lastUpdate: string | null
}

// Workflow preferences (shared between polling and event-driven modes)
export interface WorkflowPreferencesState {
  singleStepMode: boolean
  singleStepModeExplicit: boolean
  stepIntoSubsteps: boolean
  mockLLM: boolean
  mockLLMExplicit: boolean
  mockLLMDelay: number
}

// Default execution state
const initialExecutionState: WorkflowExecutionState = {
  workflowId: null,
  workflowName: null,
  status: 'idle',
  currentStep: null,
  currentSubstep: null,
  stepStatuses: {},
  substepStatuses: {},
  batchProgress: null,
  batchPhaseSteps: [],
  startTime: null,
  lastUpdate: null,
}

// Default preferences state
const initialPreferencesState: WorkflowPreferencesState = {
  singleStepMode: false,
  singleStepModeExplicit: false,
  stepIntoSubsteps: false,
  mockLLM: false,
  mockLLMExplicit: false,
  mockLLMDelay: 500,
}

// Step status type
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

// Trace extension types (mirror backend trace-types.ts)
// These types are copied from trace-types.ts to avoid cross-package imports
export interface TraceLLMCall {
  id: string
  model: string
  provider: string
  purpose: string
  durationMs: number
  tokensIn: number
  tokensOut: number
  status: 'success' | 'failed' | 'retried'
  error?: string
  promptPreview?: string
  responsePreview?: string
}

export interface TraceAgentInstance {
  agentId: string
  agentType: string
  parentEntity: string
  startTime: string
  endTime?: string
  status: 'running' | 'completed' | 'failed'
  llmCalls: TraceLLMCall[]
  entityCount: number
  observationCount: number
}

export interface TraceEntityFlow {
  produced: number
  passedQA: number
  persisted: number
  rejectedReasons?: Record<string, number>
}

export interface TraceQAResult {
  passed: boolean
  score: number
  errors?: string[]
  retried?: boolean
}

// Code Graph RAG query trace (Phase 13 - mirrors backend TraceCGRQuery)
export interface TraceCGRQuery {
  id: string
  queryType: 'component_entities' | 'entity_details' | 'call_graph' | 'index_refresh'
  entityName: string
  cypherQuery?: string
  resultCount: number
  durationMs: number
  cacheHit: boolean
  status: 'success' | 'failed' | 'timeout'
  error?: string
}

// Wave group for grouping steps by wave number
export interface WaveGroup {
  waveNumber: number
  steps: StepInfo[]
  totalDuration: number
  totalLLMCalls: number
  totalTokens: number
  entityFlow: TraceEntityFlow
}

// Step info for each workflow step
export interface StepInfo {
  name: string
  status: StepStatus
  duration?: number
  startTime?: string         // ISO timestamp when step started
  endTime?: string           // ISO timestamp when step completed
  tokensUsed?: number
  llmProvider?: string       // Formatted model@provider (e.g. "sonnet@claude-code")
  llmModel?: string          // Raw model name (e.g. "claude-sonnet-4-5")
  llmProviderName?: string   // Raw provider name (e.g. "claude-code", "copilot", "groq")
  llmCalls?: number
  error?: string
  outputs?: Record<string, any>
  // Trace extension fields (Phase 12)
  wave?: number
  agentInstances?: TraceAgentInstance[]
  entityFlow?: TraceEntityFlow
  qaResult?: TraceQAResult
  llmCallEvents?: TraceLLMCall[]
  cgrQueryEvents?: TraceCGRQuery[]  // Phase 13: Code Graph RAG query events
  subSteps?: StepInfo[]            // Nested sub-steps for wave detail view
}

// Active workflow process
export interface UKBProcess {
  pid: number | string  // Can be 'mcp-inline' for inline MCP workflows
  workflowName: string
  team: string
  repositoryPath: string
  startTime: string
  lastHeartbeat: string
  status: string
  completedSteps: number
  totalSteps: number
  batchPhaseStepCount?: number  // Derived from workflow YAML (replaces hardcoded BATCH_STEP_COUNT)
  currentStep: string | null
  logFile: string | null
  isAlive: boolean
  health: 'healthy' | 'stale' | 'frozen' | 'dead'
  heartbeatAgeSeconds: number
  progressPercent: number
  elapsedSeconds?: number  // Elapsed time since workflow started
  steps?: StepInfo[]
  _refreshKey?: string  // Server-generated key to force UI updates
  isInlineMCP?: boolean  // Flag for inline MCP-triggered workflows
  batchProgress?: {  // Batch workflow progress
    currentBatch: number
    totalBatches: number
    batchId?: string
  }
  // Per-batch step tracking for tracer visualization
  batchIterations?: Array<{
    batchId: string
    batchNumber: number
    startTime: string
    endTime?: string
    steps: Array<{
      name: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
      duration?: number
      tokensUsed?: number
      llmProvider?: string
      llmCalls?: number
      outputs?: Record<string, any>
    }>
  }>
  // Multi-agent orchestration data from SmartOrchestrator
  multiAgent?: {
    stepConfidences: Record<string, number>
    routingHistory: Array<{
      action: 'proceed' | 'retry' | 'skip' | 'escalate' | 'terminate'
      affectedSteps: string[]
      reason: string
      confidence: number
      llmAssisted: boolean
      timestamp: string
    }>
    workflowModifications: Array<{
      type: string
      description: string
      timestamp: string
    }>
    retryHistory: Record<string, number>
  }
}

// Historical workflow summary
export interface HistoricalWorkflow {
  id: string
  filename: string
  workflowName: string
  executionId: string
  status: string
  startTime: string | null
  endTime: string | null
  duration: string | null
  completedSteps: number
  totalSteps: number
  team: string
  repositoryPath: string
}

// Historical step with errors and outputs
export interface HistoricalStep {
  index: number
  name: string
  agent: string
  action: string
  status: string
  duration: string
  errors?: string[]
  outputs?: Record<string, any>
}

// Accumulated stats from all batches
export interface AccumulatedStats {
  totalCommits: number
  totalSessions: number
  totalTokensUsed: number
  totalEntitiesCreated: number
  totalEntitiesUpdated: number
  totalRelationsAdded: number
}

// Step timing statistics for learned progress estimation
export interface StepTimingStat {
  avgDurationMs: number
  minDurationMs: number
  maxDurationMs: number
  sampleCount: number
  recentDurations?: number[]
  isBatchStep?: boolean
}

export interface WorkflowTimingStats {
  sampleCount: number
  lastSampleDate: string
  steps: Record<string, StepTimingStat>
  avgBatchDurationMs: number
  avgFinalizationDurationMs: number
  avgTotalBatches: number
}

export interface StepTimingStatistics {
  version: number
  lastUpdated: string
  workflowTypes: Record<string, WorkflowTimingStats>
}

// Aggregated step data across all batches
export interface AggregatedSteps {
  git_history?: {
    totalCommits: number
    batchesProcessed: number
  }
  vibe_history?: {
    totalSessions: number
    batchesWithSessions: number
    batchesProcessed: number
  }
  semantic_analysis?: {
    totalEntities: number
    totalRelations: number
    batchesProcessed: number
  }
  kg_operators?: {
    totalProcessed: number      // conv: entities converted to KG format
    totalCoreEntities: number   // aggr: entities classified as core
    totalEmbedded: number       // embed: entities with embeddings
    totalMerged: number         // dedup: duplicate entities merged
    totalEdgesAdded: number     // pred: predicted edges/relations
    totalEntitiesAdded: number  // merge: final entities added
    batchesProcessed: number
  }
  content_validation?: {
    entitiesValidated: number   // entities that passed validation
    relationsValidated: number  // relations that passed validation
    validationComplete: boolean
  }
}

// Batch summary aggregated from checkpoints
export interface BatchSummary {
  totalBatches: number
  totalCommits: number
  totalSessions: number
  totalEntities: number
  totalRelations: number
  batchesWithSessions: number
  dateRange: {
    start: string | null
    end: string | null
  }
  aggregatedSteps?: AggregatedSteps
}

// Final persisted knowledge stats (after deduplication)
export interface PersistedKnowledge {
  entities: number
  relations: number
  entityTypes: Record<string, number>
  deduplicationRatio: string | null
}

// Detailed step output for history view (includes actual commit arrays, session arrays, etc.)
export interface BatchStepOutput {
  name: string
  status: string
  duration?: number
  outputs?: Record<string, any>  // Full outputs with arrays (commits, sessions, etc.)
  tokensUsed?: number
  llmProvider?: string
  llmCalls?: number
  llmError?: string  // Actual error message when LLM calls fail (e.g., "out of credit")
}

// Completed batch from batch-checkpoints.json (for historical tracer display)
export interface CompletedBatch {
  batchId: string
  batchNumber: number
  completedAt: string
  commitRange?: {
    start: string
    end: string
  }
  dateRange?: {
    start: string
    end: string
  }
  stats?: {
    commits?: number
    sessions?: number
    tokensUsed?: number
    entitiesCreated?: number
    entitiesUpdated?: number
    relationsAdded?: number
    duration?: number
    operatorResults?: Record<string, { processed?: number; duration?: number; core?: number; nonCore?: number; embedded?: number; merged?: number; edgesAdded?: number; entitiesAdded?: number }>
  }
  /** Detailed step outputs for history view - includes arrays of commits, sessions, etc. */
  stepOutputs?: BatchStepOutput[]
}

// Trace event for workflow execution tracing
export interface TraceEvent {
  id: string
  agentName: string
  timestamp: number
  duration?: number
  status: 'started' | 'completed' | 'error'
  input?: unknown
  output?: unknown
  llmMetrics?: {
    model: string
    inputTokens: number
    outputTokens: number
    cost?: number
  }
}

// Trace state for workflow tracing feature
export interface TraceState {
  enabled: boolean
  events: TraceEvent[]
  selectedEventId?: string
}

// Historical workflow with full details
export interface HistoricalWorkflowDetail extends HistoricalWorkflow {
  entitiesCreated: number
  entitiesUpdated: number
  recommendations: string[]
  steps: HistoricalStep[]
  // Aggregated totals from all batches
  accumulatedStats?: AccumulatedStats | null
  batchSummary?: BatchSummary | null
  // Final persisted knowledge (after deduplication)
  persistedKnowledge?: PersistedKnowledge | null
  // Raw completed batches for tracer batch iteration display
  completedBatches?: CompletedBatch[] | null
}

// Workflow agents definition (for status inference)
// 15 agents total - matches ukb-workflow-graph.tsx WORKFLOW_AGENTS
export const WORKFLOW_AGENTS = [
  'git_history', 'vibe_history', 'code_graph', 'code_intelligence',
  'documentation_linker', 'semantic_analysis', 'web_search',
  'insight_generation', 'observation_generation', 'ontology_classification',
  'documentation_semantics', 'quality_assurance',
  'persistence', 'deduplication', 'content_validation'
] as const

// Step name to agent ID mapping - re-export from constants for backward compatibility
// The actual mappings now come from Redux workflowConfig slice (loaded from API)
export { STEP_TO_AGENT } from '@/components/workflow/constants'

// Helper to get step-to-agent mapping with fallback
// Used by selectors that need to access mappings from state
const getStepToAgentMapping = (workflowConfigStepMappings: Record<string, string> | undefined, stepName: string): string => {
  // Use workflowConfig mappings if available and initialized
  if (workflowConfigStepMappings && Object.keys(workflowConfigStepMappings).length > 0) {
    return workflowConfigStepMappings[stepName] || stepName
  }
  // Fallback to constants
  return FALLBACK_STEP_TO_AGENT[stepName] || stepName
}

// Sub-step selection for sidebar display
interface SelectedSubStep {
  agentId: string
  substepId: string
}

interface UKBState {
  // Active workflows
  loading: boolean
  error: string | null
  running: number
  stale: number
  frozen: number
  total: number
  processes: UKBProcess[]
  config: {
    staleThresholdSeconds: number
    frozenThresholdSeconds: number
    maxConcurrent: number
  }
  lastUpdate: string | null

  // Modal state
  modalOpen: boolean
  activeTab: 'active' | 'history'
  selectedProcessIndex: number
  selectedNode: string | null

  // ============================================
  // Typed WorkflowState from SSE pipeline (Phase 18)
  // Single source of truth for active workflow state
  // Set by STATE_SNAPSHOT WebSocket messages
  // ============================================
  workflowState: WorkflowState | null
  lastTransition: string | null

  // ============================================
  // Event-Driven Execution State (LEGACY - backward compat)
  // Synced from workflowState for components not yet migrated
  // ============================================
  execution: WorkflowExecutionState
  preferences: WorkflowPreferencesState

  // Single-step debugging mode (LEGACY - kept for backward compatibility during migration)
  // TODO: Remove after full migration to event-driven execution
  // singleStepMode: User's preference (can only be changed by checkbox toggle)
  // singleStepModeExplicit: True if user explicitly set it this session (prevents server overwrite)
  // stepPaused: Server-reported pause state (from coordinator via progress file)
  // pausedAtStep: The step where workflow is paused (from server)
  singleStepMode: boolean
  singleStepModeExplicit: boolean
  stepPaused: boolean
  pausedAtStep: string | null

  // LLM Mock mode for frontend testing without real API calls
  mockLLM: boolean
  mockLLMExplicit: boolean
  mockLLMDelay: number

  // Sub-step UI state (MVI: Single source of truth for visualization)
  // expandedSubStepsAgent: Which agent's sub-steps arc is expanded (null = none)
  // selectedSubStep: Which sub-step is selected for sidebar display
  expandedSubStepsAgent: string | null
  selectedSubStep: SelectedSubStep | null

  // Historical workflows
  historicalWorkflows: HistoricalWorkflow[]
  loadingHistory: boolean
  historyError: string | null

  // Historical workflow detail
  selectedHistoricalWorkflow: HistoricalWorkflow | null
  historicalWorkflowDetail: HistoricalWorkflowDetail | null
  loadingDetail: boolean

  // Step timing statistics for learned progress estimation
  stepTimingStatistics: StepTimingStatistics | null
  loadingStatistics: boolean
  detailError: string | null

  // Workflow tracing
  trace: TraceState

  // LLM Mode state (per-agent control)
  llmState: LLMState
}

// Default LLM state
const initialLLMState: LLMState = {
  globalMode: 'public',
  perAgentOverrides: {},
  updatedAt: undefined,
}

const initialState: UKBState = {
  // Active workflows
  loading: false,
  error: null,
  running: 0,
  stale: 0,
  frozen: 0,
  total: 0,
  processes: [],
  config: {
    staleThresholdSeconds: 120,
    frozenThresholdSeconds: 300,
    maxConcurrent: 3,
  },
  lastUpdate: null,

  // Modal state
  modalOpen: false,
  activeTab: 'active',
  selectedProcessIndex: 0,
  selectedNode: null,

  // Typed WorkflowState from SSE pipeline (Phase 18)
  workflowState: null,
  lastTransition: null,

  // Event-driven execution state (LEGACY - backward compat)
  execution: { ...initialExecutionState },
  preferences: { ...initialPreferencesState },

  // Single-step debugging mode (LEGACY - kept for backward compatibility)
  singleStepMode: false,
  singleStepModeExplicit: false,
  stepPaused: false,
  pausedAtStep: null,

  // LLM Mock mode (LEGACY - kept for backward compatibility)
  mockLLM: false,
  mockLLMExplicit: false,
  mockLLMDelay: 500,

  // Sub-step UI state
  expandedSubStepsAgent: null,
  selectedSubStep: null,

  // Historical workflows
  historicalWorkflows: [],
  loadingHistory: false,
  historyError: null,

  // Historical workflow detail
  selectedHistoricalWorkflow: null,
  historicalWorkflowDetail: null,
  loadingDetail: false,
  detailError: null,

  // Step timing statistics for learned progress estimation
  stepTimingStatistics: null,
  loadingStatistics: false,

  // Workflow tracing
  trace: {
    enabled: false,
    events: [],
    selectedEventId: undefined,
  },

  // LLM Mode state
  llmState: { ...initialLLMState },
}

const ukbSlice = createSlice({
  name: 'ukb',
  initialState,
  reducers: {
    // Active workflow actions
    fetchUKBStatusStart(state) {
      state.loading = true
      state.error = null
    },
    fetchUKBStatusSuccess(state, action: PayloadAction<any>) {
      state.loading = false
      state.error = null
      state.running = action.payload.summary?.running || action.payload.running || 0
      state.stale = action.payload.summary?.stale || action.payload.stale || 0
      state.frozen = action.payload.summary?.frozen || action.payload.frozen || 0
      state.total = action.payload.summary?.total || action.payload.total || 0

      // Merge new processes with existing ones to preserve valid data during refreshes
      // This prevents flickering when SSE and REST polling race with each other
      const newProcesses = action.payload.processes || []
      const existingProcessMap = new Map(state.processes.map(p => [p.pid, p]))
      const newProcessPids = new Set(newProcesses.map((p: UKBProcess) => p.pid))

      // Preserve existing running processes briefly to prevent flicker during data races.
      // But don't preserve indefinitely — if a process disappears from server for 2+ cycles,
      // it's genuinely gone (completed/failed). Track with _lastSeenFromServer timestamp.
      const now = Date.now()
      const EVICTION_TIMEOUT_MS = 15000 // 15 seconds = ~3 poll cycles
      const existingRunningProcesses = state.processes.filter(p => {
        if (newProcessPids.has(p.pid)) return false // Will be in merged list
        if (p.status !== 'running') return false // Only preserve running
        const lastSeen = (p as any)._lastSeenFromServer || now
        return (now - lastSeen) < EVICTION_TIMEOUT_MS
      })

      const mergedNewProcesses = newProcesses.map((newProcess: UKBProcess) => {
        const existing = existingProcessMap.get(newProcess.pid)
        // Mark as seen from server now
        const withTimestamp = { ...newProcess, _lastSeenFromServer: now }

        // If new data has valid workflowName and totalSteps, use it entirely
        if (newProcess.workflowName && newProcess.totalSteps > 0) {
          return withTimestamp
        }

        // If we have existing valid data and new data is incomplete, merge
        if (existing && existing.workflowName && existing.totalSteps > 0) {
          return {
            ...existing,
            ...newProcess,
            _lastSeenFromServer: now,
            // Preserve these critical fields if new data is incomplete
            workflowName: newProcess.workflowName || existing.workflowName,
            totalSteps: newProcess.totalSteps > 0 ? newProcess.totalSteps : existing.totalSteps,
          }
        }

        // Otherwise use new process as-is
        return withTimestamp
      })

      // Combine: new/merged processes + preserved running processes not in new data
      state.processes = [...mergedNewProcesses, ...existingRunningProcesses]

      // Sync stepPaused from active process to top-level state (REST polling path)
      const activeProcess = state.processes.find(
        (p: UKBProcess) => p.status === 'running' || p.status === 'starting'
      ) as any
      if (activeProcess) {
        if (activeProcess.stepPaused !== undefined) {
          state.stepPaused = activeProcess.stepPaused === true
          state.pausedAtStep = activeProcess.pausedAtStep || null
        }
      } else {
        // No active process — clear pause state
        state.stepPaused = false
        state.pausedAtStep = null
      }

      if (action.payload.config) {
        state.config = action.payload.config
      }
      state.lastUpdate = action.payload.lastUpdate || new Date().toISOString()
    },
    fetchUKBStatusFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
    },

    // Modal state actions
    setModalOpen(state, action: PayloadAction<boolean>) {
      state.modalOpen = action.payload
      if (!action.payload) {
        // Reset state when closing
        state.selectedNode = null
        state.selectedHistoricalWorkflow = null
        state.historicalWorkflowDetail = null
      }
    },
    setActiveTab(state, action: PayloadAction<'active' | 'history'>) {
      state.activeTab = action.payload
      state.selectedNode = null
    },
    setSelectedProcessIndex(state, action: PayloadAction<number>) {
      state.selectedProcessIndex = action.payload
      state.selectedNode = null
    },
    setSelectedNode(state, action: PayloadAction<string | null>) {
      state.selectedNode = action.payload
    },

    // Historical workflows actions
    fetchHistoryStart(state) {
      state.loadingHistory = true
      state.historyError = null
    },
    fetchHistorySuccess(state, action: PayloadAction<HistoricalWorkflow[]>) {
      state.loadingHistory = false
      state.historicalWorkflows = action.payload
    },
    fetchHistoryFailure(state, action: PayloadAction<string>) {
      state.loadingHistory = false
      state.historyError = action.payload
    },

    // Historical workflow detail actions
    selectHistoricalWorkflow(state, action: PayloadAction<HistoricalWorkflow | null>) {
      state.selectedHistoricalWorkflow = action.payload
      state.selectedNode = null
      if (!action.payload) {
        state.historicalWorkflowDetail = null
      }
    },
    fetchDetailStart(state) {
      state.loadingDetail = true
      state.detailError = null
      state.historicalWorkflowDetail = null
    },
    fetchDetailSuccess(state, action: PayloadAction<HistoricalWorkflowDetail>) {
      state.loadingDetail = false
      state.historicalWorkflowDetail = action.payload
    },
    fetchDetailFailure(state, action: PayloadAction<string>) {
      state.loadingDetail = false
      state.detailError = action.payload
    },

    // Step timing statistics actions
    fetchStatisticsStart(state) {
      state.loadingStatistics = true
    },
    fetchStatisticsSuccess(state, action: PayloadAction<StepTimingStatistics | null>) {
      state.loadingStatistics = false
      state.stepTimingStatistics = action.payload
    },
    fetchStatisticsFailure(state) {
      state.loadingStatistics = false
      state.stepTimingStatistics = null
    },

    // Trace actions
    setTracingEnabled(state, action: PayloadAction<boolean>) {
      state.trace.enabled = action.payload
      // Clear events when disabling tracing
      if (!action.payload) {
        state.trace.events = []
        state.trace.selectedEventId = undefined
      }
    },
    addTraceEvent(state, action: PayloadAction<TraceEvent>) {
      state.trace.events.push(action.payload)
    },
    updateTraceEvent(state, action: PayloadAction<Partial<TraceEvent> & { id: string }>) {
      const index = state.trace.events.findIndex(e => e.id === action.payload.id)
      if (index !== -1) {
        state.trace.events[index] = { ...state.trace.events[index], ...action.payload }
      }
    },
    clearTraces(state) {
      state.trace.events = []
      state.trace.selectedEventId = undefined
    },
    selectTraceEvent(state, action: PayloadAction<string | undefined>) {
      state.trace.selectedEventId = action.payload
    },

    // ========================================
    // Single-step mode actions (MVI: ONLY way to change single-step state)
    // ========================================

    // Toggle single-step mode - called ONLY from checkbox or step button
    setSingleStepMode(state, action: PayloadAction<{ enabled: boolean; explicit: boolean }>) {
      state.singleStepMode = action.payload.enabled
      state.singleStepModeExplicit = action.payload.explicit
    },

    // Sync pause state from server (coordinator via progress file)
    // This does NOT change singleStepMode itself - only stepPaused and pausedAtStep
    syncStepPauseFromServer(state, action: PayloadAction<{ paused: boolean; pausedAt: string | null }>) {
      state.stepPaused = action.payload.paused
      state.pausedAtStep = action.payload.pausedAt
    },

    // Sync single-step mode from server ONLY if user hasn't explicitly set it
    syncSingleStepFromServer(state, action: PayloadAction<boolean>) {
      // CRITICAL: Only sync from server if user hasn't explicitly changed it this session
      if (!state.singleStepModeExplicit) {
        state.singleStepMode = action.payload
      }
    },

    // Reset explicit flag (e.g., when modal closes or workflow ends)
    resetSingleStepExplicit(state) {
      state.singleStepModeExplicit = false
    },

    // ========================================
    // LLM Mock mode actions (MVI: ONLY way to change mock state)
    // ========================================

    // Toggle LLM mock mode - called ONLY from checkbox
    setMockLLM(state, action: PayloadAction<{ enabled: boolean; explicit: boolean; delay?: number }>) {
      state.mockLLM = action.payload.enabled
      state.mockLLMExplicit = action.payload.explicit
      if (action.payload.delay !== undefined) {
        state.mockLLMDelay = action.payload.delay
      }
    },

    // Sync mock LLM from server ONLY if user hasn't explicitly set it
    syncMockLLMFromServer(state, action: PayloadAction<{ enabled: boolean; delay: number }>) {
      // CRITICAL: Only sync from server if user hasn't explicitly changed it this session
      if (!state.mockLLMExplicit) {
        state.mockLLM = action.payload.enabled
        state.mockLLMDelay = action.payload.delay
      }
    },

    // Reset explicit flag (e.g., when modal closes or workflow ends)
    resetMockLLMExplicit(state) {
      state.mockLLMExplicit = false
    },

    // ========================================
    // Sub-step UI actions (MVI: Single source of truth for visualization)
    // ========================================

    // Set which agent's sub-steps arc is expanded (null = none)
    setExpandedSubStepsAgent(state, action: PayloadAction<string | null>) {
      state.expandedSubStepsAgent = action.payload
      // Clear selected sub-step when changing expanded agent
      if (action.payload === null) {
        state.selectedSubStep = null
      }
    },

    // Set selected sub-step for sidebar display
    setSelectedSubStep(state, action: PayloadAction<SelectedSubStep | null>) {
      state.selectedSubStep = action.payload
    },

    // ========================================
    // STATE_SNAPSHOT Action (Phase 18)
    // Single action to store typed WorkflowState from SSE pipeline
    // ========================================

    setWorkflowState(state, action: PayloadAction<{ state: WorkflowState; transition?: string }>) {
      const ws = action.payload.state
      state.workflowState = ws as any // Immer draft compatibility
      state.lastTransition = action.payload.transition || null

      // Backward-compat sync: update legacy execution fields so unmigrated components still work
      if (ws.status === 'running') {
        state.execution.status = 'running'
        state.execution.workflowId = ws.workflowId
        state.execution.workflowName = ws.workflowName
        state.execution.currentStep = ws.progress.currentStepName
        state.execution.currentSubstep = ws.progress.currentSubstepId || null
        state.execution.startTime = ws.progress.startTime
        state.execution.lastUpdate = ws.progress.lastUpdate
        state.stepPaused = false
      } else if (ws.status === 'paused') {
        state.execution.status = 'paused'
        state.execution.workflowId = ws.workflowId
        state.execution.workflowName = ws.workflowName
        state.execution.currentStep = ws.pausedAt.step
        state.execution.currentSubstep = ws.pausedAt.substep || null
        state.execution.lastUpdate = ws.progress.lastUpdate
        state.stepPaused = true
        state.pausedAtStep = ws.pausedAt.step
      } else if (ws.status === 'completed') {
        state.execution.status = 'completed'
        state.execution.workflowId = ws.workflowId
        state.execution.workflowName = ws.workflowName
        state.execution.lastUpdate = new Date().toISOString()
        state.stepPaused = false
        // Reset explicit flags when workflow ends
        state.preferences.singleStepModeExplicit = false
        state.preferences.mockLLMExplicit = false
      } else if (ws.status === 'failed') {
        state.execution.status = 'failed'
        state.execution.workflowId = ws.workflowId
        state.execution.workflowName = ws.workflowName
        state.execution.lastUpdate = ws.progress.lastUpdate
        state.stepPaused = false
      } else if (ws.status === 'idle') {
        state.execution.status = 'idle'
        state.execution.workflowId = null
        state.execution.workflowName = null
        state.execution.currentStep = null
        state.execution.currentSubstep = null
        state.stepPaused = false
      } else if (ws.status === 'cancelled') {
        state.execution.status = 'idle'
        state.execution.workflowId = null
        state.execution.workflowName = null
        state.execution.currentStep = null
        state.execution.currentSubstep = null
        state.stepPaused = false
      }
    },

    // Handle PREFERENCES_UPDATED event (confirmation from coordinator)
    handlePreferencesUpdated(state, action: PayloadAction<{
      workflowId: string
      preferences: {
        singleStepMode?: boolean
        stepIntoSubsteps?: boolean
        mockLLM?: boolean
        mockLLMDelay?: number
      }
      timestamp: string
    }>) {
      const { preferences, timestamp } = action.payload
      // Only update if not explicitly set by user
      if (preferences.singleStepMode !== undefined && !state.preferences.singleStepModeExplicit) {
        state.preferences.singleStepMode = preferences.singleStepMode
      }
      if (preferences.stepIntoSubsteps !== undefined && !state.preferences.singleStepModeExplicit) {
        state.preferences.stepIntoSubsteps = preferences.stepIntoSubsteps
      }
      if (preferences.mockLLM !== undefined && !state.preferences.mockLLMExplicit) {
        state.preferences.mockLLM = preferences.mockLLM
      }
      if (preferences.mockLLMDelay !== undefined && !state.preferences.mockLLMExplicit) {
        state.preferences.mockLLMDelay = preferences.mockLLMDelay
      }
      state.execution.lastUpdate = timestamp
    },

    // Reset execution state (when workflow ends or modal closes)
    resetExecutionState(state) {
      state.execution = { ...initialExecutionState }
    },

    // Set preferences from UI (marks as explicit to prevent server overwrite)
    setWorkflowPreferences(state, action: PayloadAction<{
      singleStepMode?: boolean
      stepIntoSubsteps?: boolean
      mockLLM?: boolean
      mockLLMDelay?: number
    }>) {
      const { singleStepMode, stepIntoSubsteps, mockLLM, mockLLMDelay } = action.payload
      if (singleStepMode !== undefined) {
        state.preferences.singleStepMode = singleStepMode
        state.preferences.singleStepModeExplicit = true
        // Also sync to legacy state
        state.singleStepMode = singleStepMode
        state.singleStepModeExplicit = true
      }
      if (stepIntoSubsteps !== undefined) {
        state.preferences.stepIntoSubsteps = stepIntoSubsteps
      }
      if (mockLLM !== undefined) {
        state.preferences.mockLLM = mockLLM
        state.preferences.mockLLMExplicit = true
        // Also sync to legacy state
        state.mockLLM = mockLLM
        state.mockLLMExplicit = true
      }
      if (mockLLMDelay !== undefined) {
        state.preferences.mockLLMDelay = mockLLMDelay
        state.mockLLMDelay = mockLLMDelay
      }
    },

    // ========================================
    // LLM Mode State Actions
    // ========================================

    // Set global LLM mode for all agents
    setGlobalLLMMode(state, action: PayloadAction<{ mode: LLMMode; explicit?: boolean }>) {
      state.llmState.globalMode = action.payload.mode
      state.llmState.updatedAt = new Date().toISOString()
    },

    // Set LLM mode for a specific agent (override)
    setAgentLLMMode(state, action: PayloadAction<{ agentId: string; mode: LLMMode }>) {
      state.llmState.perAgentOverrides[action.payload.agentId] = action.payload.mode
      state.llmState.updatedAt = new Date().toISOString()
    },

    // Clear per-agent override (revert to global mode)
    clearAgentLLMOverride(state, action: PayloadAction<string>) {
      delete state.llmState.perAgentOverrides[action.payload]
      state.llmState.updatedAt = new Date().toISOString()
    },

    // Sync LLM state from server
    syncLLMStateFromServer(state, action: PayloadAction<LLMState>) {
      state.llmState = action.payload
    },
  },
})

export const {
  fetchUKBStatusStart,
  fetchUKBStatusSuccess,
  fetchUKBStatusFailure,
  setModalOpen,
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
  // Statistics actions
  fetchStatisticsStart,
  fetchStatisticsSuccess,
  fetchStatisticsFailure,
  // Trace actions
  setTracingEnabled,
  addTraceEvent,
  updateTraceEvent,
  clearTraces,
  selectTraceEvent,
  // Single-step mode actions (MVI - LEGACY)
  setSingleStepMode,
  syncStepPauseFromServer,
  syncSingleStepFromServer,
  resetSingleStepExplicit,
  // LLM Mock mode actions (MVI - LEGACY)
  setMockLLM,
  syncMockLLMFromServer,
  resetMockLLMExplicit,
  // Sub-step UI actions (MVI)
  setExpandedSubStepsAgent,
  setSelectedSubStep,
  // STATE_SNAPSHOT action (Phase 18)
  setWorkflowState,
  // Preferences sync (still used for LLM mode updates)
  handlePreferencesUpdated,
  resetExecutionState,
  setWorkflowPreferences,
  // LLM Mode actions
  setGlobalLLMMode,
  setAgentLLMMode,
  clearAgentLLMOverride,
  syncLLMStateFromServer,
} = ukbSlice.actions

// Selectors
const selectUkbState = (state: { ukb: UKBState }) => state.ukb

// Phase 18: Typed WorkflowState selectors
export const selectWorkflowState = createSelector(
  [selectUkbState],
  (ukb) => ukb.workflowState
)

export const selectLastTransition = createSelector(
  [selectUkbState],
  (ukb) => ukb.lastTransition
)

// Selector to get stepMappings from workflowConfig slice with fallback
const selectStepMappings = (state: { workflowConfig?: { stepMappings: Record<string, string> } }) =>
  state.workflowConfig?.stepMappings || FALLBACK_STEP_TO_AGENT

export const selectProcesses = createSelector(
  [selectUkbState],
  (ukb) => ukb.processes
)

export const selectCurrentProcess = createSelector(
  [selectUkbState],
  (ukb) => ukb.processes[ukb.selectedProcessIndex] || null
)

export const selectHistoricalWorkflows = createSelector(
  [selectUkbState],
  (ukb) => ukb.historicalWorkflows
)

export const selectSelectedHistoricalWorkflow = createSelector(
  [selectUkbState],
  (ukb) => ukb.selectedHistoricalWorkflow
)

export const selectHistoricalDetail = createSelector(
  [selectUkbState],
  (ukb) => ukb.historicalWorkflowDetail
)

// Step timing statistics for learned progress estimation
export const selectStepTimingStatistics = createSelector(
  [selectUkbState],
  (ukb) => ukb.stepTimingStatistics
)

export const selectLoadingStatistics = createSelector(
  [selectUkbState],
  (ukb) => ukb.loadingStatistics
)

// Select batch summary and accumulated stats for historical workflows
export const selectBatchSummary = createSelector(
  [selectHistoricalDetail],
  (detail) => detail?.batchSummary || null
)

export const selectAccumulatedStats = createSelector(
  [selectHistoricalDetail],
  (detail) => detail?.accumulatedStats || null
)

export const selectPersistedKnowledge = createSelector(
  [selectHistoricalDetail],
  (detail) => detail?.persistedKnowledge || null
)

// Convert historical detail to ProcessInfo format for graph
export const selectHistoricalProcessInfo = createSelector(
  [selectHistoricalDetail],
  (detail): UKBProcess | null => {
    if (!detail) return null

    // Parse duration to milliseconds — handles string ("2.20s") or number (ms)
    const parseDuration = (duration: unknown): number => {
      if (!duration) return 0
      if (typeof duration === 'number') return Math.round(duration)
      if (typeof duration === 'string') {
        const match = duration.match(/([\d.]+)s/)
        if (match) return Math.round(parseFloat(match[1]) * 1000)
      }
      return 0
    }

    return {
      pid: 0,
      workflowName: detail.workflowName,
      team: detail.team,
      repositoryPath: detail.repositoryPath,
      startTime: detail.startTime || '',
      lastHeartbeat: detail.endTime || '',
      status: detail.status,
      completedSteps: detail.completedSteps,
      totalSteps: detail.totalSteps,
      currentStep: null,
      logFile: null,
      isAlive: false,
      health: 'healthy',
      heartbeatAgeSeconds: 0,
      progressPercent: Math.round((detail.completedSteps / detail.totalSteps) * 100),
      steps: detail.steps.map(step => ({
        name: step.agent || step.name,
        status: step.status === 'success' ? 'completed' : step.status as StepStatus,
        duration: parseDuration(step.duration),
        // Use backend llmProvider first, fallback to agent-based inference
        llmProvider: (step as any).llmProvider || (
          ['semantic_analysis', 'insight_generation', 'observation_generation',
           'ontology_classification', 'quality_assurance', 'deduplication',
           'content_validation', 'documentation_linker', 'code_graph'].includes(step.agent)
            ? (step.agent === 'code_graph' ? 'code-graph-rag' : 'anthropic')
            : undefined
        ),
        // Pass through LLM metrics from backend
        tokensUsed: (step as any).tokensUsed,
        llmCalls: (step as any).llmCalls,
        // Pass through LLM mode tracking from backend
        llmIntendedMode: (step as any).llmIntendedMode,
        llmActualMode: (step as any).llmActualMode,
        llmModeFallback: (step as any).llmModeFallback,
        error: step.errors?.join('\n'),
        outputs: step.outputs,
      }))
    }
  }
)

// Build StepDefinition[] from known workflow agents and step mappings
// Used by deriveStepStatuses to compute step statuses from WorkflowState
function buildStepDefinitions(stepMappings: Record<string, string>): StepDefinition[] {
  // Build reverse map: agentId -> stepName(s)
  // WORKFLOW_AGENTS are the canonical agent IDs used in the UI
  return WORKFLOW_AGENTS.map(agentId => ({
    name: agentId,
    description: agentId,
  }))
}

// Build reverse step mapping: agentId -> stepName for looking up in WorkflowState
function buildAgentToStepName(stepMappings: Record<string, string>): Record<string, string> {
  const reverse: Record<string, string> = {}
  for (const [stepName, agentId] of Object.entries(stepMappings)) {
    reverse[agentId] = stepName
  }
  return reverse
}

// Selector to get node status for any agent - uses deriveStepStatuses for live workflows
export const selectNodeStatus = createSelector(
  [
    selectUkbState,
    selectStepMappings,
    (_: any, agentId: string) => agentId,
    (_: any, __: string, isHistorical: boolean) => isHistorical
  ],
  (ukb, stepMappings, agentId, isHistorical): { status: StepStatus; stepInfo: StepInfo | null } => {
    // For historical workflows, use process.steps data directly (no WorkflowState)
    if (isHistorical) {
      const detail = ukb.historicalWorkflowDetail
      if (!detail) return { status: 'pending', stepInfo: null }

      const stepInfo = detail.steps
        .map(s => ({
          name: s.agent || s.name,
          status: (s.status === 'success' ? 'completed' : s.status) as StepStatus,
          llmProvider: (s as any).llmProvider,
          tokensUsed: (s as any).tokensUsed,
          llmCalls: (s as any).llmCalls,
          llmIntendedMode: (s as any).llmIntendedMode,
          llmActualMode: (s as any).llmActualMode,
          llmModeFallback: (s as any).llmModeFallback,
          error: s.errors?.join('\n'),
          outputs: s.outputs,
        }))
        .find(s => (stepMappings[s.name] || s.name) === agentId || s.name === agentId) as StepInfo | undefined

      if (stepInfo?.status) {
        return { status: stepInfo.status, stepInfo }
      }
      return { status: 'pending', stepInfo: null }
    }

    // For live workflows: use deriveStepStatuses if WorkflowState is available
    if (ukb.workflowState) {
      // Build StepDefinitions using step names from stepMappings (reverse mapped to agent IDs)
      const agentToStep = buildAgentToStepName(stepMappings)
      // The step names in WorkflowState.progress use backend step names (keys of stepMappings)
      // deriveStepStatuses needs StepDefinitions with those backend step names
      const backendStepDefs: StepDefinition[] = Object.keys(stepMappings).map(stepName => ({
        name: stepName,
        description: stepName,
      }))

      const derivedStatuses = deriveStepStatuses(ukb.workflowState, backendStepDefs)

      // Find the backend step name for this agent ID
      const backendStepName = agentToStep[agentId] || agentId
      const derivedStatus = derivedStatuses.get(backendStepName) || 'pending'

      // Find step info from process.steps if available
      const process = ukb.processes[ukb.selectedProcessIndex]
      const stepInfo = process?.steps?.find(
        s => (stepMappings[s.name] || s.name) === agentId || s.name === agentId
      ) as StepInfo | undefined

      return {
        status: derivedStatus as StepStatus,
        stepInfo: stepInfo ? { ...stepInfo, status: derivedStatus as StepStatus } : null,
      }
    }

    // No WorkflowState yet: fall back to process.steps data
    const process = ukb.processes[ukb.selectedProcessIndex]
    if (!process) return { status: 'pending', stepInfo: null }

    const stepInfo = process.steps?.find(
      s => (stepMappings[s.name] || s.name) === agentId || s.name === agentId
    ) as StepInfo | undefined

    if (stepInfo?.status) {
      return { status: stepInfo.status, stepInfo }
    }

    return { status: 'pending', stepInfo: null }
  }
)

// Selector to build step status map for graph rendering - uses deriveStepStatuses for live workflows
export const selectStepStatusMap = createSelector(
  [
    selectUkbState,
    selectStepMappings,
    (_: any, isHistorical: boolean) => isHistorical
  ],
  (ukb, stepMappings, isHistorical): Record<string, StepInfo> => {
    // For historical workflows, use process.steps data directly
    if (isHistorical) {
      const detail = ukb.historicalWorkflowDetail
      if (!detail) return {}

      const map: Record<string, StepInfo> = {}
      for (const s of detail.steps) {
        const agentId = stepMappings[s.agent || s.name] || s.agent || s.name
        map[agentId] = {
          name: s.agent || s.name,
          status: (s.status === 'success' ? 'completed' : s.status) as StepStatus,
          llmProvider: (s as any).llmProvider,
          tokensUsed: (s as any).tokensUsed,
          llmCalls: (s as any).llmCalls,
          error: s.errors?.join('\n'),
          outputs: s.outputs,
        }
      }
      return map
    }

    // For live workflows: use deriveStepStatuses if WorkflowState is available
    if (ukb.workflowState) {
      const backendStepDefs: StepDefinition[] = Object.keys(stepMappings).map(stepName => ({
        name: stepName,
        description: stepName,
      }))

      const derivedStatuses = deriveStepStatuses(ukb.workflowState, backendStepDefs)

      const map: Record<string, StepInfo> = {}
      // Build map keyed by agent ID with derived statuses
      for (const [backendStepName, status] of derivedStatuses) {
        const agentId = stepMappings[backendStepName] || backendStepName
        map[agentId] = { name: backendStepName, status: status as StepStatus }
      }

      // Merge any additional step info from process.steps (duration, tokens, etc.)
      const process = ukb.processes[ukb.selectedProcessIndex]
      if (process?.steps) {
        for (const step of process.steps) {
          const agentId = stepMappings[step.name] || step.name
          if (map[agentId]) {
            // Preserve derived status but add step details
            map[agentId] = { ...step, status: map[agentId].status }
          }
        }
      }

      return map
    }

    // No WorkflowState yet: fall back to process.steps data
    const process = ukb.processes[ukb.selectedProcessIndex]
    if (!process) return {}

    const map: Record<string, StepInfo> = {}
    if (process.steps) {
      for (const step of process.steps) {
        const agentId = stepMappings[step.name] || step.name
        if (!map[agentId] || step.status === 'running' ||
            (step.status === 'completed' && map[agentId].status !== 'running')) {
          map[agentId] = { ...step }
        }
      }
    }

    return map
  }
)

// Trace selectors
export const selectTraceEnabled = createSelector(
  [selectUkbState],
  (ukb) => ukb.trace.enabled
)

export const selectTraceEvents = createSelector(
  [selectUkbState],
  (ukb) => ukb.trace.events
)

export const selectSelectedTraceEventId = createSelector(
  [selectUkbState],
  (ukb) => ukb.trace.selectedEventId
)

export const selectSelectedTraceEvent = createSelector(
  [selectUkbState],
  (ukb) => {
    if (!ukb.trace.selectedEventId) return null
    return ukb.trace.events.find(e => e.id === ukb.trace.selectedEventId) || null
  }
)

// Compute trace statistics
export const selectTraceStats = createSelector(
  [selectTraceEvents],
  (events) => {
    if (events.length === 0) return null

    const completedEvents = events.filter(e => e.status === 'completed')
    const totalDuration = completedEvents.reduce((sum, e) => sum + (e.duration || 0), 0)
    const totalInputTokens = completedEvents.reduce((sum, e) => sum + (e.llmMetrics?.inputTokens || 0), 0)
    const totalOutputTokens = completedEvents.reduce((sum, e) => sum + (e.llmMetrics?.outputTokens || 0), 0)
    const totalCost = completedEvents.reduce((sum, e) => sum + (e.llmMetrics?.cost || 0), 0)

    return {
      totalEvents: events.length,
      completedEvents: completedEvents.length,
      totalDuration,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
    }
  }
)

// ========================================
// Single-step mode selectors (MVI)
// ========================================

export const selectSingleStepMode = createSelector(
  [selectUkbState],
  (ukb) => ukb.singleStepMode
)

export const selectSingleStepModeExplicit = createSelector(
  [selectUkbState],
  (ukb) => ukb.singleStepModeExplicit
)

export const selectStepPaused = createSelector(
  [selectUkbState],
  (ukb) => ukb.stepPaused
)

export const selectPausedAtStep = createSelector(
  [selectUkbState],
  (ukb) => ukb.pausedAtStep
)

// Combined selector for single-step debugging state
export const selectSingleStepState = createSelector(
  [selectUkbState],
  (ukb) => ({
    singleStepMode: ukb.singleStepMode,
    singleStepModeExplicit: ukb.singleStepModeExplicit,
    stepPaused: ukb.stepPaused,
    pausedAtStep: ukb.pausedAtStep,
  })
)

// ========================================
// LLM Mock mode selectors (MVI)
// ========================================

export const selectMockLLM = createSelector(
  [selectUkbState],
  (ukb) => ukb.mockLLM
)

export const selectMockLLMExplicit = createSelector(
  [selectUkbState],
  (ukb) => ukb.mockLLMExplicit
)

export const selectMockLLMDelay = createSelector(
  [selectUkbState],
  (ukb) => ukb.mockLLMDelay
)

// Combined selector for LLM mock state
export const selectMockLLMState = createSelector(
  [selectUkbState],
  (ukb) => ({
    mockLLM: ukb.mockLLM,
    mockLLMExplicit: ukb.mockLLMExplicit,
    mockLLMDelay: ukb.mockLLMDelay,
  })
)

// ========================================
// Sub-step UI selectors (MVI)
// ========================================

export const selectExpandedSubStepsAgent = createSelector(
  [selectUkbState],
  (ukb) => ukb.expandedSubStepsAgent
)

export const selectSelectedSubStep = createSelector(
  [selectUkbState],
  (ukb) => ukb.selectedSubStep
)

// ========================================
// Event-Driven Execution Selectors (NEW)
// ========================================

export const selectExecution = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution
)

export const selectExecutionStatus = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.status
)

export const selectExecutionWorkflowId = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.workflowId
)

export const selectExecutionCurrentStep = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.currentStep
)

export const selectExecutionCurrentSubstep = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.currentSubstep
)

export const selectExecutionStepStatuses = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.stepStatuses
)

export const selectExecutionSubstepStatuses = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.substepStatuses
)

export const selectExecutionBatchProgress = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.batchProgress
)

export const selectExecutionBatchPhaseSteps = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.batchPhaseSteps
)

export const selectWorkflowPreferences = createSelector(
  [selectUkbState],
  (ukb) => ukb.preferences
)

// Combined selector for step status by name (event-driven)
export const selectStepStatusByName = createSelector(
  [selectExecutionStepStatuses, (_: any, stepName: string) => stepName],
  (stepStatuses, stepName): EventStepStatusInfo | null => {
    return stepStatuses[stepName] || null
  }
)

// Combined selector for substep statuses of a step (event-driven)
export const selectSubstepStatusesByStep = createSelector(
  [selectExecutionSubstepStatuses, (_: any, stepName: string) => stepName],
  (substepStatuses, stepName): Record<string, EventSubstepStatusInfo> => {
    return substepStatuses[stepName] || {}
  }
)

// Selector to check if using event-driven mode (workflow has started via events)
export const selectIsEventDrivenMode = createSelector(
  [selectUkbState],
  (ukb) => ukb.execution.workflowId !== null
)

// Convert event-driven execution state to UKBProcess format for UI compatibility
export const selectExecutionAsProcess = createSelector(
  [selectUkbState],
  (ukb): UKBProcess | null => {
    const exec = ukb.execution
    if (!exec.workflowId) return null

    const steps: StepInfo[] = Object.values(exec.stepStatuses).map(s => ({
      name: s.name,
      status: s.status,
      duration: s.duration,
      tokensUsed: s.tokensUsed,
      llmProvider: s.llmProvider,
      llmCalls: s.llmCalls,
      error: s.error,
      outputs: s.outputs as Record<string, any>,
    }))

    const completedSteps = steps.filter(s => s.status === 'completed').length

    return {
      pid: exec.workflowId,
      workflowName: exec.workflowName || 'unknown',
      team: 'coding',
      repositoryPath: '',
      startTime: exec.startTime || '',
      lastHeartbeat: exec.lastUpdate || '',
      status: exec.status,
      completedSteps,
      totalSteps: Object.keys(exec.stepStatuses).length,
      currentStep: exec.currentStep,
      logFile: null,
      isAlive: exec.status === 'running' || exec.status === 'paused',
      health: exec.status === 'running' ? 'healthy' : exec.status === 'paused' ? 'stale' : 'dead',
      heartbeatAgeSeconds: 0,
      progressPercent: Object.keys(exec.stepStatuses).length > 0
        ? Math.round((completedSteps / Object.keys(exec.stepStatuses).length) * 100)
        : 0,
      steps,
      batchProgress: exec.batchProgress ? {
        currentBatch: exec.batchProgress.currentBatch,
        totalBatches: exec.batchProgress.totalBatches,
        batchId: exec.batchProgress.batchId,
      } : undefined,
    }
  }
)

// ========================================
// LLM Mode Selectors
// ========================================

export const selectLLMState = createSelector(
  [selectUkbState],
  (ukb) => ukb.llmState
)

export const selectGlobalLLMMode = createSelector(
  [selectUkbState],
  (ukb) => ukb.llmState.globalMode
)

// Get effective LLM mode for a specific agent (override or global)
export const selectAgentLLMMode = createSelector(
  [selectUkbState, (_: any, agentId: string) => agentId],
  (ukb, agentId): LLMMode => {
    return ukb.llmState.perAgentOverrides[agentId] || ukb.llmState.globalMode
  }
)

// Check if agent has a per-agent override
export const selectAgentHasOverride = createSelector(
  [selectUkbState, (_: any, agentId: string) => agentId],
  (ukb, agentId): boolean => {
    return agentId in ukb.llmState.perAgentOverrides
  }
)

// Get all per-agent overrides
export const selectPerAgentOverrides = createSelector(
  [selectUkbState],
  (ukb) => ukb.llmState.perAgentOverrides
)

// Wave grouping selector: groups steps by wave number for trace visualization
export const selectWaveGroups = createSelector(
  [selectCurrentProcess],
  (process): WaveGroup[] => {
    const steps = process?.steps || []
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

      groups.push({
        waveNumber,
        steps: waveSteps,
        totalDuration,
        totalLLMCalls,
        totalTokens,
        entityFlow,
      })
    }

    return groups.sort((a, b) => a.waveNumber - b.waveNumber)
  }
)

export default ukbSlice.reducer
