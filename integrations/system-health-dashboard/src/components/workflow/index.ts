// Workflow visualization components
export * from './types'
export * from './constants'
export * from './hooks'
export { MultiAgentGraph, WorkflowLegend } from './multi-agent-graph'
export { TraceModal } from './trace-modal'

// Re-export for backward compatibility
export { MultiAgentGraph as UKBWorkflowGraph } from './multi-agent-graph'
