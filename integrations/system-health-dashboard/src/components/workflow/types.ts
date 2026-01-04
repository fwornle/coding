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
  duration?: number
  outputs?: Record<string, unknown>
  // LLM metrics
  tokensUsed?: number
  llmProvider?: string
  llmCalls?: number
  error?: string
}

// Process info from Redux store - compatible with UKBProcess
export interface ProcessInfo {
  workflowName?: string
  status: string
  completedSteps: number
  totalSteps: number
  currentStep?: string | null
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
    workflows: Array<{
      name: string
      workflow: { name: string; version: string; description: string }
      edges: EdgeDefinitionAPI[]
    }>
  }
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
