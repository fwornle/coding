import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit'

// Step status type
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

// Step info for each workflow step
export interface StepInfo {
  name: string
  status: StepStatus
  duration?: number
  tokensUsed?: number
  llmProvider?: string
  error?: string
  outputs?: Record<string, any>
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

// Historical workflow with full details
export interface HistoricalWorkflowDetail extends HistoricalWorkflow {
  entitiesCreated: number
  entitiesUpdated: number
  recommendations: string[]
  steps: HistoricalStep[]
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

// Step name to agent ID mapping
export const STEP_TO_AGENT: Record<string, string> = {
  'analyze_git_history': 'git_history',
  'analyze_recent_changes': 'git_history',
  'analyze_vibe_history': 'vibe_history',
  'analyze_recent_vibes': 'vibe_history',
  'index_codebase': 'code_graph',
  'index_recent_code': 'code_graph',
  'transform_code_entities': 'code_graph',
  'transform_code_entities_incremental': 'code_graph',
  'code_intelligence': 'code_intelligence',
  'analyze_code_intelligence': 'code_intelligence',
  'link_documentation': 'documentation_linker',
  'transform_doc_links': 'documentation_linker',
  'semantic_analysis': 'semantic_analysis',
  'analyze_semantics': 'semantic_analysis',
  'web_search': 'web_search',
  'generate_insights': 'insight_generation',
  'generate_pattern_insights': 'insight_generation',
  'generate_observations': 'observation_generation',
  'classify_with_ontology': 'ontology_classification',
  'analyze_documentation_semantics': 'documentation_semantics',
  'analyze_documentation_semantics_incremental': 'documentation_semantics',
  'quality_assurance': 'quality_assurance',
  'validate_incremental_qa': 'quality_assurance',
  'persist_results': 'persistence',
  'persist_incremental': 'persistence',
  'persist_code_entities': 'persistence',
  'deduplicate_insights': 'deduplication',
  'deduplicate_incremental': 'deduplication',
  'validate_content': 'content_validation',
  'validate_content_incremental': 'content_validation',
  'validate_entity_content': 'content_validation',
  'validate_all_entities': 'content_validation',
  'validate_project_entities': 'content_validation',
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

  // Historical workflows
  historicalWorkflows: HistoricalWorkflow[]
  loadingHistory: boolean
  historyError: string | null

  // Historical workflow detail
  selectedHistoricalWorkflow: HistoricalWorkflow | null
  historicalWorkflowDetail: HistoricalWorkflowDetail | null
  loadingDetail: boolean
  detailError: string | null
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

  // Historical workflows
  historicalWorkflows: [],
  loadingHistory: false,
  historyError: null,

  // Historical workflow detail
  selectedHistoricalWorkflow: null,
  historicalWorkflowDetail: null,
  loadingDetail: false,
  detailError: null,
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
      state.processes = action.payload.processes || []
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
} = ukbSlice.actions

// Selectors
const selectUkbState = (state: { ukb: UKBState }) => state.ukb

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

// Convert historical detail to ProcessInfo format for graph
export const selectHistoricalProcessInfo = createSelector(
  [selectHistoricalDetail],
  (detail): UKBProcess | null => {
    if (!detail) return null

    // Parse duration string (e.g., "2.20s") to milliseconds
    const parseDuration = (durationStr: string): number => {
      if (!durationStr) return 0
      const match = durationStr.match(/([\d.]+)s/)
      if (match) {
        return Math.round(parseFloat(match[1]) * 1000)
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
        llmProvider: ['semantic_analysis', 'insight_generation', 'observation_generation',
                      'ontology_classification', 'quality_assurance', 'deduplication',
                      'content_validation', 'documentation_linker', 'code_graph'].includes(step.agent)
                      ? (step.agent === 'code_graph' ? 'code-graph-rag' : 'anthropic')
                      : undefined,
        error: step.errors?.join('\n'),
        outputs: step.outputs,
      }))
    }
  }
)

// Selector to get node status for any agent - single source of truth
export const selectNodeStatus = createSelector(
  [
    selectUkbState,
    (_: any, agentId: string) => agentId,
    (_: any, __: string, isHistorical: boolean) => isHistorical
  ],
  (ukb, agentId, isHistorical): { status: StepStatus; stepInfo: StepInfo | null } => {
    const process = isHistorical
      ? (ukb.historicalWorkflowDetail ? {
          completedSteps: ukb.historicalWorkflowDetail.completedSteps,
          currentStep: null,
          steps: ukb.historicalWorkflowDetail.steps.map(s => ({
            name: s.agent || s.name,
            status: s.status === 'success' ? 'completed' : s.status as StepStatus,
            error: s.errors?.join('\n'),
            outputs: s.outputs,
          }))
        } : null)
      : ukb.processes[ukb.selectedProcessIndex]

    if (!process) {
      return { status: 'pending', stepInfo: null }
    }

    // Find step info for this agent
    const stepInfo = process.steps?.find(
      s => STEP_TO_AGENT[s.name] === agentId || s.name === agentId
    ) as StepInfo | undefined

    if (stepInfo?.status) {
      return { status: stepInfo.status, stepInfo: stepInfo as StepInfo }
    }

    // Fallback: infer from completedSteps
    const agentIndex = WORKFLOW_AGENTS.indexOf(agentId as any)
    if (agentIndex === -1) {
      return { status: 'pending', stepInfo: null }
    }

    if (agentIndex < process.completedSteps) {
      return { status: 'completed', stepInfo: stepInfo as StepInfo || null }
    }
    if (agentIndex === process.completedSteps && process.currentStep) {
      const currentAgentId = STEP_TO_AGENT[process.currentStep] || process.currentStep
      if (currentAgentId === agentId) {
        return { status: 'running', stepInfo: stepInfo as StepInfo || null }
      }
    }

    return { status: 'pending', stepInfo: stepInfo as StepInfo || null }
  }
)

// Selector to build step status map for graph rendering
export const selectStepStatusMap = createSelector(
  [
    selectUkbState,
    (_: any, isHistorical: boolean) => isHistorical
  ],
  (ukb, isHistorical): Record<string, StepInfo> => {
    const process = isHistorical
      ? (ukb.historicalWorkflowDetail ? {
          completedSteps: ukb.historicalWorkflowDetail.completedSteps,
          currentStep: null,
          steps: ukb.historicalWorkflowDetail.steps.map(s => ({
            name: s.agent || s.name,
            status: s.status === 'success' ? 'completed' : s.status as StepStatus,
            duration: undefined,
            error: s.errors?.join('\n'),
            outputs: s.outputs,
          }))
        } : null)
      : ukb.processes[ukb.selectedProcessIndex]

    if (!process) return {}

    const map: Record<string, StepInfo> = {}

    if (process.steps) {
      for (const step of process.steps) {
        const agentId = STEP_TO_AGENT[step.name] || step.name
        if (!map[agentId] || step.status === 'running' ||
            (step.status === 'completed' && map[agentId].status !== 'running')) {
          map[agentId] = { ...step }
        }
      }
    }

    // Infer current step from process.currentStep
    if (process.currentStep) {
      const currentAgentId = STEP_TO_AGENT[process.currentStep] || process.currentStep
      if (map[currentAgentId]) {
        map[currentAgentId] = { ...map[currentAgentId], status: 'running' }
      } else {
        map[currentAgentId] = { name: process.currentStep, status: 'running' }
      }
    }

    return map
  }
)

export default ukbSlice.reducer
