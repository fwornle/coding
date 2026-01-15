import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../index'
import type { AgentDefinition, EdgeDefinition, AgentDefinitionAPI, WorkflowDefinitionsAPI } from '@/components/workflow/types'
import { ICON_MAP, WORKFLOW_AGENTS, ORCHESTRATOR_NODE, STEP_TO_AGENT, STEP_TO_SUBSTEP, MULTI_AGENT_EDGES } from '@/components/workflow/constants'

// Sub-step definition for agents with multiple operations
export interface SubStep {
  id: string
  name: string
  shortName: string
  description: string
  inputs?: string[]
  outputs?: string[]
  llmUsage?: 'fast' | 'standard' | 'premium' | 'none'
}

// Agent sub-steps - defines the sub-operations for each agent
export interface AgentSubSteps {
  [agentId: string]: SubStep[]
}

// Workflow config state
interface WorkflowConfigState {
  loading: boolean
  error: string | null
  initialized: boolean
  orchestrator: AgentDefinition | null
  agents: AgentDefinition[]
  edges: EdgeDefinition[]
  stepMappings: Record<string, string>      // step name -> agent ID
  stepToSubStep: Record<string, string>     // step name -> substep ID
  agentSubSteps: AgentSubSteps              // agent ID -> sub-steps
  allWorkflows: Array<{ name: string; edges: EdgeDefinition[] }>
}

// Fallback sub-steps (used when API doesn't provide them)
const FALLBACK_AGENT_SUBSTEPS: AgentSubSteps = {
  kg_operators: [
    { id: 'conv', name: 'Context Convolution', shortName: 'Conv', description: 'Aggregates context from neighboring nodes', llmUsage: 'premium' },
    { id: 'aggr', name: 'Entity Aggregation', shortName: 'Aggr', description: 'Merges similar entities', llmUsage: 'standard' },
    { id: 'embed', name: 'Node Embedding', shortName: 'Embed', description: 'Generates vector embeddings', llmUsage: 'fast' },
    { id: 'dedup', name: 'KG Deduplication', shortName: 'Dedup', description: 'Removes duplicate entities', llmUsage: 'standard' },
    { id: 'pred', name: 'Edge Prediction', shortName: 'Pred', description: 'Predicts new relationships', llmUsage: 'premium' },
    { id: 'merge', name: 'Structure Merge', shortName: 'Merge', description: 'Merges into graph structure', llmUsage: 'standard' },
  ],
  code_graph: [
    { id: 'index', name: 'Index Codebase', shortName: 'Index', description: 'AST parsing and indexing', llmUsage: 'none' },
    { id: 'query', name: 'Query Graph', shortName: 'Query', description: 'NL to Cypher queries', llmUsage: 'standard' },
    { id: 'analyze', name: 'Analyze Code', shortName: 'Analyze', description: 'LLM-powered code analysis', llmUsage: 'premium' },
  ],
  semantic_analysis: [
    { id: 'extract', name: 'Extract Patterns', shortName: 'Extract', description: 'Pattern detection and extraction', llmUsage: 'premium' },
  ],
  observation_generation: [
    { id: 'extract', name: 'Generate Observations', shortName: 'Generate', description: 'Create structured observations', llmUsage: 'premium' },
  ],
  ontology_classification: [
    { id: 'classify', name: 'Classify Entities', shortName: 'Classify', description: 'Map to ontology classes', llmUsage: 'standard' },
  ],
  persistence: [
    { id: 'persist', name: 'Persist Entities', shortName: 'Persist', description: 'Write to LevelDB', llmUsage: 'none' },
  ],
}

const initialState: WorkflowConfigState = {
  loading: false,
  error: null,
  initialized: false,
  orchestrator: null,
  agents: [],
  edges: [],
  stepMappings: {},
  stepToSubStep: {},
  agentSubSteps: {},
  allWorkflows: [],
}

// Transform API agent to full agent definition with icon component
function transformAgent(agent: AgentDefinitionAPI): AgentDefinition {
  return {
    ...agent,
    icon: ICON_MAP[agent.icon] || ICON_MAP.Code,
  } as AgentDefinition
}

// Async thunk to fetch workflow definitions from API
export const initializeWorkflowConfig = createAsyncThunk(
  'workflowConfig/initialize',
  async (_, { rejectWithValue }) => {
    try {
      const apiPort = 3033
      const response = await fetch(`http://localhost:${apiPort}/api/workflows/definitions`)

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const data: WorkflowDefinitionsAPI = await response.json()

      if (data.status !== 'success' || !data.data) {
        throw new Error('Invalid API response')
      }

      // Transform agents
      const transformedAgents = data.data.agents.map(transformAgent)

      // Transform orchestrator
      const transformedOrchestrator = {
        ...data.data.orchestrator,
        icon: ICON_MAP[data.data.orchestrator.icon] || ICON_MAP.Play,
      } as AgentDefinition

      // Parse agent sub-steps from YAML if available
      // For now, use fallback - Phase 4 will extend YAML to include these
      const agentSubSteps = FALLBACK_AGENT_SUBSTEPS

      // Store all workflows
      const allWorkflows = data.data.workflows.map(w => ({
        name: w.name,
        edges: w.edges as EdgeDefinition[]
      }))

      return {
        orchestrator: transformedOrchestrator,
        agents: transformedAgents,
        stepMappings: data.data.stepMappings,
        stepToSubStep: STEP_TO_SUBSTEP, // Will come from API in Phase 4
        agentSubSteps,
        allWorkflows,
      }
    } catch (error) {
      console.warn('Failed to fetch workflow definitions, using fallback:', error)
      return rejectWithValue(error instanceof Error ? error.message : 'Unknown error')
    }
  }
)

const workflowConfigSlice = createSlice({
  name: 'workflowConfig',
  initialState,
  reducers: {
    // Set edges for a specific workflow
    setWorkflowEdges(state, action: PayloadAction<{ workflowName: string }>) {
      const workflow = state.allWorkflows.find(w => w.name === action.payload.workflowName)
      if (workflow) {
        state.edges = workflow.edges
      }
    },
    // Force use of fallback config (for testing or when API unavailable)
    useFallbackConfig(state) {
      state.orchestrator = ORCHESTRATOR_NODE
      state.agents = WORKFLOW_AGENTS
      state.edges = MULTI_AGENT_EDGES
      state.stepMappings = STEP_TO_AGENT
      state.stepToSubStep = STEP_TO_SUBSTEP
      state.agentSubSteps = FALLBACK_AGENT_SUBSTEPS
      state.initialized = true
      state.loading = false
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeWorkflowConfig.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(initializeWorkflowConfig.fulfilled, (state, action) => {
        state.orchestrator = action.payload.orchestrator
        state.agents = action.payload.agents
        state.stepMappings = action.payload.stepMappings
        state.stepToSubStep = action.payload.stepToSubStep
        state.agentSubSteps = action.payload.agentSubSteps
        state.allWorkflows = action.payload.allWorkflows
        // Default to multi-agent edges
        state.edges = MULTI_AGENT_EDGES
        state.initialized = true
        state.loading = false
        state.error = null
      })
      .addCase(initializeWorkflowConfig.rejected, (state, action) => {
        // On failure, use fallback constants
        state.orchestrator = ORCHESTRATOR_NODE
        state.agents = WORKFLOW_AGENTS
        state.edges = MULTI_AGENT_EDGES
        state.stepMappings = STEP_TO_AGENT
        state.stepToSubStep = STEP_TO_SUBSTEP
        state.agentSubSteps = FALLBACK_AGENT_SUBSTEPS
        state.initialized = true
        state.loading = false
        state.error = action.payload as string
      })
  },
})

export const { setWorkflowEdges, useFallbackConfig } = workflowConfigSlice.actions

// Selectors
export const selectWorkflowConfigLoading = (state: RootState) => state.workflowConfig.loading
export const selectWorkflowConfigInitialized = (state: RootState) => state.workflowConfig.initialized
export const selectWorkflowConfigError = (state: RootState) => state.workflowConfig.error

export const selectOrchestrator = (state: RootState) => state.workflowConfig.orchestrator
export const selectAgents = (state: RootState) => state.workflowConfig.agents
export const selectEdges = (state: RootState) => state.workflowConfig.edges
export const selectStepMappings = (state: RootState) => state.workflowConfig.stepMappings
export const selectStepToSubStep = (state: RootState) => state.workflowConfig.stepToSubStep
export const selectAgentSubSteps = (state: RootState) => state.workflowConfig.agentSubSteps

// Selector to get agent ID for a step name
export const selectAgentForStep = (stepName: string) => (state: RootState): string => {
  return state.workflowConfig.stepMappings[stepName] || stepName
}

// Selector to get sub-step ID for a step name
export const selectSubStepForStep = (stepName: string) => (state: RootState): string | undefined => {
  return state.workflowConfig.stepToSubStep[stepName]
}

// Selector to get sub-steps for an agent
export const selectSubStepsForAgent = (agentId: string) => (state: RootState): SubStep[] => {
  return state.workflowConfig.agentSubSteps[agentId] || []
}

// Selector to get agent by ID
export const selectAgentById = (agentId: string) => (state: RootState): AgentDefinition | undefined => {
  if (state.workflowConfig.orchestrator?.id === agentId) {
    return state.workflowConfig.orchestrator
  }
  return state.workflowConfig.agents.find(a => a.id === agentId)
}

export default workflowConfigSlice.reducer
