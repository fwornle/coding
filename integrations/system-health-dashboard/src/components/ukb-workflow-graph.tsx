'use client'

import React, { useState, useMemo, useCallback, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  GitBranch,
  MessageSquare,
  Brain,
  Search,
  Lightbulb,
  Eye,
  Tags,
  Code,
  FileText,
  Shield,
  Database,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronRight,
  Zap,
  Timer,
  Hash,
} from 'lucide-react'

// Agent definitions for the 13-agent workflow
// LLM info verified via Serena analysis of mcp-server-semantic-analysis
// Priority: Groq > Gemini > Anthropic > OpenAI (auto-fallback based on API key availability)
const WORKFLOW_AGENTS = [
  {
    id: 'git_history',
    name: 'Git History',
    shortName: 'Git',
    icon: GitBranch,
    description: 'Analyzes git commit history using native git commands',
    usesLLM: false,
    llmModel: null,
    techStack: 'Git CLI',
    row: 0,
    col: 0,
  },
  {
    id: 'vibe_history',
    name: 'Vibe History',
    shortName: 'Vibe',
    icon: MessageSquare,
    description: 'Analyzes LSL conversation history for pattern extraction',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 0,
    col: 1,
  },
  {
    id: 'semantic_analysis',
    name: 'Semantic Analysis',
    shortName: 'Semantic',
    icon: Brain,
    description: 'Deep semantic analysis for code understanding and insights',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Direct LLM clients',
    row: 1,
    col: 0.5,
  },
  {
    id: 'web_search',
    name: 'Web Search',
    shortName: 'Web',
    icon: Search,
    description: 'Searches for similar patterns using LLM-generated queries',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 2,
    col: 0.5,
  },
  {
    id: 'insight_generation',
    name: 'Insight Generation',
    shortName: 'Insights',
    icon: Lightbulb,
    description: 'Generates comprehensive knowledge insights from analysis',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 3,
    col: 0,
  },
  {
    id: 'observation_generation',
    name: 'Observation Generation',
    shortName: 'Observations',
    icon: Eye,
    description: 'Creates structured observations for knowledge base entities',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 4,
    col: 0,
  },
  {
    id: 'ontology_classification',
    name: 'Ontology Classification',
    shortName: 'Ontology',
    icon: Tags,
    description: 'Classifies entities using keyword heuristics (no LLM)',
    usesLLM: false,
    llmModel: null,
    techStack: 'OntologyClassifier (Heuristics)',
    row: 5,
    col: 0,
  },
  {
    id: 'code_graph',
    name: 'Code Graph',
    shortName: 'Code',
    icon: Code,
    description: 'AST parsing via Tree-sitter, stores in Memgraph',
    usesLLM: false,
    llmModel: null,
    techStack: 'Tree-sitter + Memgraph',
    row: 3,
    col: 1,
  },
  {
    id: 'documentation_linker',
    name: 'Documentation Linker',
    shortName: 'Docs',
    icon: FileText,
    description: 'Links docs to code entities via pattern matching',
    usesLLM: false,
    llmModel: null,
    techStack: 'Regex + glob patterns',
    row: 4,
    col: 1,
  },
  {
    id: 'quality_assurance',
    name: 'Quality Assurance',
    shortName: 'QA',
    icon: Shield,
    description: 'Validates entity quality and coherence',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 6,
    col: 0.5,
  },
  {
    id: 'persistence',
    name: 'Persistence',
    shortName: 'Persist',
    icon: Database,
    description: 'Persists entities to knowledge graph',
    usesLLM: false,
    llmModel: null,
    techStack: 'LevelDB + Graphology',
    row: 7,
    col: 0.5,
  },
  {
    id: 'deduplication',
    name: 'Deduplication',
    shortName: 'Dedup',
    icon: Copy,
    description: 'Detects duplicates using embedding similarity',
    usesLLM: false,
    llmModel: null,
    techStack: 'OpenAI text-embedding-3-small',
    row: 8,
    col: 0.5,
  },
  {
    id: 'content_validation',
    name: 'Content Validation',
    shortName: 'Validate',
    icon: CheckCircle2,
    description: 'Validates and refreshes stale entities',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 9,
    col: 0.5,
  },
]

// Step name to agent ID mapping
const STEP_TO_AGENT: Record<string, string> = {
  'analyze_git_history': 'git_history',
  'analyze_recent_changes': 'git_history',
  'analyze_vibe_history': 'vibe_history',
  'analyze_recent_vibes': 'vibe_history',
  'semantic_analysis': 'semantic_analysis',
  'analyze_semantics': 'semantic_analysis',
  'web_search': 'web_search',
  'generate_insights': 'insight_generation',
  'generate_observations': 'observation_generation',
  'classify_with_ontology': 'ontology_classification',
  'index_codebase': 'code_graph',
  'index_recent_code': 'code_graph',
  'transform_code_entities': 'code_graph',
  'transform_code_entities_incremental': 'code_graph',
  'link_documentation': 'documentation_linker',
  'quality_assurance': 'quality_assurance',
  'validate_incremental_qa': 'quality_assurance',
  'persist_results': 'persistence',
  'persist_incremental': 'persistence',
  'persist_code_entities': 'persistence',
  'deduplicate_insights': 'deduplication',
  'deduplicate_incremental': 'deduplication',
  'validate_content': 'content_validation',
  'validate_content_incremental': 'content_validation',
}

// Edge definitions showing data flow between agents
const WORKFLOW_EDGES = [
  { from: 'git_history', to: 'semantic_analysis' },
  { from: 'vibe_history', to: 'semantic_analysis' },
  { from: 'semantic_analysis', to: 'web_search' },
  { from: 'web_search', to: 'insight_generation' },
  { from: 'semantic_analysis', to: 'insight_generation' },
  { from: 'insight_generation', to: 'observation_generation' },
  { from: 'observation_generation', to: 'ontology_classification' },
  { from: 'semantic_analysis', to: 'code_graph' },
  { from: 'code_graph', to: 'documentation_linker' },
  { from: 'ontology_classification', to: 'quality_assurance' },
  { from: 'documentation_linker', to: 'quality_assurance' },
  { from: 'quality_assurance', to: 'persistence' },
  { from: 'persistence', to: 'deduplication' },
  { from: 'deduplication', to: 'content_validation' },
]

interface StepInfo {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  duration?: number
  tokensUsed?: number
  llmProvider?: string
  error?: string
  outputs?: Record<string, any>
}

interface ProcessInfo {
  pid: number
  workflowName: string
  team: string
  repositoryPath: string
  startTime: string
  lastHeartbeat: string
  status: string
  completedSteps: number
  totalSteps: number
  currentStep: string | null
  health: 'healthy' | 'stale' | 'frozen' | 'dead'
  progressPercent: number
  steps?: StepInfo[]
}

interface UKBWorkflowGraphProps {
  process: ProcessInfo
  onNodeClick?: (agentId: string) => void
  selectedNode?: string | null
}

export default function UKBWorkflowGraph({ process, onNodeClick, selectedNode }: UKBWorkflowGraphProps) {
  // Track which node is currently wiggling
  const [wigglingNode, setWigglingNode] = useState<string | null>(null)
  const wiggleTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleNodeMouseEnter = useCallback((agentId: string) => {
    // Clear any existing timeout
    if (wiggleTimeoutRef.current) {
      clearTimeout(wiggleTimeoutRef.current)
    }
    // Start wiggling
    setWigglingNode(agentId)
    // Stop after 2 wiggles (0.3s × 2 = 0.6s)
    wiggleTimeoutRef.current = setTimeout(() => {
      setWigglingNode(null)
    }, 600)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    // Clear timeout and stop wiggling
    if (wiggleTimeoutRef.current) {
      clearTimeout(wiggleTimeoutRef.current)
    }
    setWigglingNode(null)
  }, [])

  // Build step status map from process data
  const stepStatusMap = useMemo(() => {
    const map: Record<string, StepInfo> = {}

    if (process.steps) {
      for (const step of process.steps) {
        const agentId = STEP_TO_AGENT[step.name] || step.name
        // If multiple steps map to same agent, prefer the latest status
        // Create a shallow copy to avoid mutating Redux state
        if (!map[agentId] || step.status === 'running' || (step.status === 'completed' && map[agentId].status !== 'running')) {
          map[agentId] = { ...step }
        }
      }
    }

    // Infer current step from process.currentStep
    if (process.currentStep) {
      const currentAgentId = STEP_TO_AGENT[process.currentStep] || process.currentStep
      if (map[currentAgentId]) {
        // Create a new object with updated status to avoid mutating frozen state
        map[currentAgentId] = { ...map[currentAgentId], status: 'running' }
      } else {
        map[currentAgentId] = { name: process.currentStep, status: 'running' }
      }
    }

    return map
  }, [process.steps, process.currentStep])

  const getNodeStatus = (agentId: string): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' => {
    const stepInfo = stepStatusMap[agentId]
    if (stepInfo) return stepInfo.status

    // Infer status from completedSteps
    const agentIndex = WORKFLOW_AGENTS.findIndex(a => a.id === agentId)
    if (agentIndex < process.completedSteps) return 'completed'
    if (agentIndex === process.completedSteps) return 'running'
    return 'pending'
  }

  // Returns fill and stroke colors for SVG nodes with better contrast
  const getNodeColors = (status: string, isSelected: boolean): { fill: string; stroke: string; textColor: string } => {
    switch (status) {
      case 'running':
        return { fill: '#dbeafe', stroke: '#3b82f6', textColor: '#1e3a8a' } // blue-100, blue-500, blue-900
      case 'completed':
        return { fill: '#166534', stroke: '#15803d', textColor: '#ffffff' } // green-800, green-700, white
      case 'failed':
        return { fill: '#fee2e2', stroke: '#ef4444', textColor: '#7f1d1d' } // red-100, red-500, red-900
      case 'skipped':
        return { fill: '#f3f4f6', stroke: '#9ca3af', textColor: '#6b7280' } // gray-100, gray-400, gray-500
      default:
        return { fill: '#f9fafb', stroke: '#d1d5db', textColor: '#4b5563' } // gray-50, gray-300, gray-600
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-3 w-3 animate-spin" />
      case 'completed':
        return <CheckCircle2 className="h-3 w-3" />
      case 'failed':
        return <XCircle className="h-3 w-3" />
      case 'skipped':
        return <Clock className="h-3 w-3" />
      default:
        return <Clock className="h-3 w-3 opacity-50" />
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${seconds % 60}s`
  }

  const formatTokens = (tokens?: number) => {
    if (!tokens) return '-'
    if (tokens < 1000) return `${tokens}`
    return `${(tokens / 1000).toFixed(1)}k`
  }

  // Calculate SVG dimensions based on grid
  const nodeWidth = 120
  const nodeHeight = 60
  const horizontalGap = 40
  const verticalGap = 20
  const gridWidth = nodeWidth * 2 + horizontalGap
  const gridHeight = (nodeHeight + verticalGap) * 10
  const padding = 40

  const getNodePosition = (agent: typeof WORKFLOW_AGENTS[0]) => {
    const x = padding + agent.col * (nodeWidth + horizontalGap)
    const y = padding + agent.row * (nodeHeight + verticalGap)
    return { x, y }
  }

  return (
    <TooltipProvider>
      <div className="flex gap-4 w-full">
        {/* Graph Container - contains scrollable SVG */}
        <div className="flex-1 relative bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border">
          <svg
            width={gridWidth + padding * 2}
            height={gridHeight + padding * 2}
            className="block"
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
              </marker>
              <marker
                id="arrowhead-active"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
              </marker>
            </defs>

            {/* Edges */}
            {WORKFLOW_EDGES.map((edge, idx) => {
              const fromAgent = WORKFLOW_AGENTS.find(a => a.id === edge.from)
              const toAgent = WORKFLOW_AGENTS.find(a => a.id === edge.to)
              if (!fromAgent || !toAgent) return null

              const fromPos = getNodePosition(fromAgent)
              const toPos = getNodePosition(toAgent)

              // Calculate edge start/end points
              const fromX = fromPos.x + nodeWidth / 2
              const fromY = fromPos.y + nodeHeight
              const toX = toPos.x + nodeWidth / 2
              const toY = toPos.y

              // Determine if this edge is active (current data flow)
              const fromStatus = getNodeStatus(edge.from)
              const toStatus = getNodeStatus(edge.to)
              const isActive = fromStatus === 'completed' && toStatus === 'running'
              const isCompleted = fromStatus === 'completed' && toStatus === 'completed'

              const strokeColor = isActive ? '#3b82f6' : isCompleted ? '#22c55e' : '#cbd5e1'
              const strokeWidth = isActive ? 2 : 1.5
              const markerEnd = isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'

              // Create curved path for better visualization
              const midY = (fromY + toY) / 2
              const path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY - 5}`

              return (
                <g key={idx}>
                  <path
                    d={path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    markerEnd={markerEnd}
                    className={isActive ? 'animate-pulse' : ''}
                  />
                </g>
              )
            })}

            {/* Nodes */}
            {WORKFLOW_AGENTS.map((agent) => {
              const pos = getNodePosition(agent)
              const status = getNodeStatus(agent.id)
              const isSelected = selectedNode === agent.id
              const stepInfo = stepStatusMap[agent.id]
              const Icon = agent.icon
              const colors = getNodeColors(status, isSelected)

              return (
                <Tooltip key={agent.id}>
                  <TooltipTrigger asChild>
                    <g
                      className={`cursor-pointer ${wigglingNode === agent.id ? 'animate-wiggle' : ''}`}
                      onClick={() => onNodeClick?.(agent.id)}
                      onMouseEnter={() => handleNodeMouseEnter(agent.id)}
                      onMouseLeave={handleNodeMouseLeave}
                    >
                      {/* Node background - using direct SVG colors for better control */}
                      <rect
                        x={pos.x}
                        y={pos.y}
                        width={nodeWidth}
                        height={nodeHeight}
                        rx={8}
                        fill={colors.fill}
                        stroke={colors.stroke}
                        strokeWidth={2}
                        className="transition-all duration-150 group-hover:stroke-[3px]"
                        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))' }}
                      />

                      {/* Selection ring */}
                      {isSelected && (
                        <rect
                          x={pos.x - 3}
                          y={pos.y - 3}
                          width={nodeWidth + 6}
                          height={nodeHeight + 6}
                          rx={10}
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          className="animate-pulse"
                        />
                      )}

                      {/* Running animation */}
                      {status === 'running' && (
                        <rect
                          x={pos.x}
                          y={pos.y}
                          width={nodeWidth}
                          height={nodeHeight}
                          rx={8}
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          className="animate-pulse"
                        />
                      )}

                      {/* Icon and text - using foreignObject for better text rendering */}
                      <foreignObject
                        x={pos.x}
                        y={pos.y}
                        width={nodeWidth}
                        height={nodeHeight}
                      >
                        <div
                          className="flex flex-col items-center justify-center h-full px-2"
                          style={{ color: colors.textColor }}
                        >
                          <div className="flex items-center gap-1 mb-1">
                            <Icon className="h-4 w-4" />
                            {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                          </div>
                          <span className="text-xs font-medium text-center leading-tight">
                            {agent.shortName}
                          </span>
                          {agent.usesLLM && (
                            <span className="text-[10px] opacity-80 flex items-center gap-0.5">
                              <Zap className="h-2 w-2" />
                              LLM
                            </span>
                          )}
                        </div>
                      </foreignObject>

                      {/* Status indicator */}
                      <circle
                        cx={pos.x + nodeWidth - 8}
                        cy={pos.y + 8}
                        r={6}
                        fill={
                          status === 'running' ? '#3b82f6' :
                          status === 'completed' ? '#22c55e' :
                          status === 'failed' ? '#ef4444' :
                          '#d1d5db'
                        }
                      />
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <div className="space-y-1">
                      <div className="font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.description}</div>
                      {stepInfo && (
                        <>
                          <Separator className="my-1" />
                          <div className="text-xs space-y-0.5">
                            <div className="flex justify-between">
                              <span>Status:</span>
                              <Badge variant="outline" className="text-[10px] h-4">
                                {stepInfo.status}
                              </Badge>
                            </div>
                            {stepInfo.duration && (
                              <div className="flex justify-between">
                                <span>Duration:</span>
                                <span>{formatDuration(stepInfo.duration)}</span>
                              </div>
                            )}
                            {stepInfo.tokensUsed && (
                              <div className="flex justify-between">
                                <span>Tokens:</span>
                                <span>{formatTokens(stepInfo.tokensUsed)}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>LLM:</span>
                              <span className="text-right max-w-[120px] truncate">{agent.llmModel || 'none'}</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </svg>

        </div>

        {/* Legend - positioned outside graph to avoid overlap */}
        <div className="flex-shrink-0 w-24 bg-white/90 backdrop-blur-sm rounded-lg p-2 border shadow-sm self-end">
          <div className="text-xs font-medium mb-2">Legend</div>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              <span>Pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Running</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span>Completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span>Failed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="h-2.5 w-2.5 text-yellow-500" />
              <span>Uses LLM</span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

// Sidebar component for detailed node information
export function UKBNodeDetailsSidebar({
  agentId,
  process,
  onClose
}: {
  agentId: string
  process: ProcessInfo
  onClose: () => void
}) {
  const agent = WORKFLOW_AGENTS.find(a => a.id === agentId)
  if (!agent) return null

  const Icon = agent.icon
  const stepInfo = process.steps?.find(s => STEP_TO_AGENT[s.name] === agentId || s.name === agentId)

  // Use same fallback logic as getNodeStatus in the graph
  const getInferredStatus = (): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' => {
    if (stepInfo?.status) return stepInfo.status as any
    // Infer status from completedSteps if step data not available
    const agentIndex = WORKFLOW_AGENTS.findIndex(a => a.id === agentId)
    if (agentIndex < process.completedSteps) return 'completed'
    if (agentIndex === process.completedSteps) return 'running'
    return 'pending'
  }

  const inferredStatus = getInferredStatus()

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'skipped':
        return <Badge variant="outline">Skipped</Badge>
      default:
        return <Badge variant="outline">Pending</Badge>
    }
  }

  return (
    <Card className="w-80 h-full overflow-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            <CardTitle className="text-lg">{agent.name}</CardTitle>
          </div>
          {getStatusBadge(inferredStatus)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-sm text-muted-foreground mb-2">{agent.description}</div>
        </div>

        <Separator />

        {/* Agent Properties */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Technology</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3" />
                LLM
              </span>
              <span className="text-right max-w-[160px] text-xs">
                {agent.llmModel || 'none'}
              </span>
            </div>

            {agent.techStack && (
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Stack</span>
                <span className="text-xs text-right max-w-[160px]">{agent.techStack}</span>
              </div>
            )}
          </div>
        </div>

        {/* Step Execution Details - Always show with available data */}
        <Separator />
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Execution Details</h4>
          <div className="space-y-2 text-sm">
            {/* Status */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={
                inferredStatus === 'completed' ? 'text-green-600 font-medium' :
                inferredStatus === 'failed' ? 'text-red-600 font-medium' :
                inferredStatus === 'running' ? 'text-blue-600 font-medium' :
                'text-muted-foreground'
              }>
                {inferredStatus.charAt(0).toUpperCase() + inferredStatus.slice(1)}
              </span>
            </div>

            {/* Duration - only show if we have it */}
            {stepInfo?.duration !== undefined && stepInfo.duration > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  Duration
                </span>
                <span>{(stepInfo.duration / 1000).toFixed(1)}s</span>
              </div>
            )}

            {/* Tokens - only show if we have it */}
            {stepInfo?.tokensUsed !== undefined && stepInfo.tokensUsed > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  Tokens Used
                </span>
                <span>{stepInfo.tokensUsed.toLocaleString()}</span>
              </div>
            )}

            {/* Show message if no timing data yet */}
            {!stepInfo?.duration && inferredStatus === 'completed' && (
              <div className="text-xs text-muted-foreground italic">
                Timing data will be available in next workflow run
              </div>
            )}
          </div>
        </div>

        {/* Error Information */}
        {stepInfo?.error && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Error
              </h4>
              <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-800 break-words">
                {stepInfo.error}
              </div>
            </div>
          </>
        )}

        {/* Output Summary */}
        {stepInfo?.outputs && Object.keys(stepInfo.outputs).length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Output Summary</h4>
              <div className="text-xs bg-slate-50 border rounded p-2 space-y-1">
                {Object.entries(stepInfo.outputs).slice(0, 5).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground">{key}:</span>
                    <span className="truncate ml-2">
                      {typeof value === 'number' ? value.toLocaleString() : String(value).slice(0, 30)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Data Flow */}
        <Separator />
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Data Flow</h4>
          <div className="text-xs space-y-1">
            <div className="text-muted-foreground">Receives from:</div>
            <div className="flex flex-wrap gap-1">
              {WORKFLOW_EDGES
                .filter(e => e.to === agentId)
                .map(e => {
                  const fromAgent = WORKFLOW_AGENTS.find(a => a.id === e.from)
                  return (
                    <Badge key={e.from} variant="outline" className="text-[10px]">
                      {fromAgent?.shortName || e.from}
                    </Badge>
                  )
                })}
              {WORKFLOW_EDGES.filter(e => e.to === agentId).length === 0 && (
                <span className="text-muted-foreground italic">None (entry point)</span>
              )}
            </div>
            <div className="text-muted-foreground mt-2">Sends to:</div>
            <div className="flex flex-wrap gap-1">
              {WORKFLOW_EDGES
                .filter(e => e.from === agentId)
                .map(e => {
                  const toAgent = WORKFLOW_AGENTS.find(a => a.id === e.to)
                  return (
                    <Badge key={e.to} variant="outline" className="text-[10px]">
                      {toAgent?.shortName || e.to}
                    </Badge>
                  )
                })}
              {WORKFLOW_EDGES.filter(e => e.from === agentId).length === 0 && (
                <span className="text-muted-foreground italic">None (final step)</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
