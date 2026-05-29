// Workflow visualization types
import type { LucideIcon } from 'lucide-react'
import type { AggregatedSteps } from '@/store/slices/ukbSlice'

// Agent definition for visualization
export interface AgentDefinition {
  id: string
  name: string
  shortName: string
  icon: LucideIcon
  description: string
  usesLLM: boolean
  /**
   * Phase 52 D-08 — Process tag for live LLM badge resolution.
   * Imported from the frozen registry (process-tags.ts via the
   * semantic-analysis submodule's compiled dist). When set, the trace-modal
   * renders the live provider/model from the most-recent N=10 rows of
   * token_usage.db where process = this tag. Falls back to the static
   * `llmModel` string when no rows match (D-03 empty-bucket case).
   */
  processTag?: string
  llmModel: string | null
  techStack: string
  row: number
  col: number
  phase?: number
  // Multi-agent system properties
  isOrchestrator?: boolean  // Can start/stop other agents (only the main Orchestrator)
  canRetry?: string[]       // IDs of agents the orchestrator can retry
  reportsTo?: string        // ID of agent this one reports to (for feedback loops)
}

// Edge definition for workflow connections
export interface EdgeDefinition {
  from: string
  to: string
  type?: 'dependency' | 'dataflow' | 'control' | 'retry' | 'self'
  label?: string
}

// Step status in workflow execution
export interface StepInfo {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startTime?: string
  endTime?: string
  duration?: number
  outputs?: Record<string, unknown>
  // LLM metrics
  tokensUsed?: number
  llmProvider?: string
  llmCalls?: number
  error?: string
  // Trace extension fields for wave-analysis 3-level nested view
  wave?: number
  subSteps?: StepInfo[]
  /**
   * Phase 52 D-15 — per-item progress fields written by wave-controller's
   * throttled emission inside wave1/2/3/4 loops. Optional + backward-compat:
   * when itemsTotal is missing the dashboard falls back to the legacy
   * arrow-style render. Field lives under `outputs.*` on the disk JSON; this
   * declaration documents the public contract. Plan 52-03 wires the
   * wave-controller emission; field is typed here for cohesion so the
   * trace-modal in Plan 52-03 has the type immediately.
   */
  itemsCompleted?: number
  itemsTotal?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentInstances?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entityFlow?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qaResult?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmCallEvents?: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cgrQueryEvents?: any[]
}

// Process info from Redux store - compatible with UKBProcess
export interface ProcessInfo {
  workflowName?: string
  status: string
  completedSteps: number
  totalSteps: number
  batchPhaseStepCount?: number  // Derived from workflow YAML (replaces hardcoded BATCH_STEP_COUNT)
  currentStep?: string | null
  pausedAtStep?: string | null
  singleStepMode?: boolean
  stepPaused?: boolean
  steps?: StepInfo[]
  // Multi-agent orchestration data - matches UKBProcess structure
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

// API response types
export interface AgentDefinitionAPI {
  id: string
  name: string
  shortName: string
  icon: string
  description: string
  usesLLM: boolean
  /**
   * Phase 52 D-08 — Mirror of `AgentDefinition.processTag` on the API
   * response shape. Optional + back-compat: older API responses without this
   * field continue to work; the trace modal simply falls back to the static
   * `llmModel` string (D-03 empty-bucket fallback).
   */
  processTag?: string
  llmModel: string | null
  techStack: string
  row: number
  col: number
  phase?: number
}

export interface EdgeDefinitionAPI {
  from: string
  to: string
  type?: 'dependency' | 'dataflow' | 'control'
  label?: string
}

export interface WorkflowDefinitionsAPI {
  status: string
  data: {
    orchestrator: AgentDefinitionAPI
    agents: AgentDefinitionAPI[]
    stepMappings: Record<string, string>
    substepIdMappings: Record<string, string>
    agentSubSteps: Record<string, Array<{
      id: string
      name: string
      shortName: string
      description: string
      llmUsage?: string
    }>>
    workflows: Array<{
      name: string
      workflow: { name: string; version: string; description: string }
      edges: EdgeDefinitionAPI[]
    }>
  }
}

// Code Graph RAG query trace (Phase 13 - duplicated from ukbSlice per Phase 12 pattern)
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

// Props for workflow graph component
export interface WorkflowGraphProps {
  process: ProcessInfo
  aggregatedSteps?: AggregatedSteps | null
}

// Props for node details sidebar
export interface NodeDetailsSidebarProps {
  agentId: string
  process: ProcessInfo
  onClose: () => void
  aggregatedSteps?: AggregatedSteps | null
}
