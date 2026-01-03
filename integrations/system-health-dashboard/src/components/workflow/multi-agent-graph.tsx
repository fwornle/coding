'use client'

import React, { useMemo, useCallback, useEffect } from 'react'
import type { AgentDefinition, EdgeDefinition, ProcessInfo, StepInfo } from './types'
import type { AggregatedSteps } from '@/store/slices/ukbSlice'
import { useScrollPreservation, useNodeWiggle, useWorkflowDefinitions } from './hooks'
import { STEP_TO_AGENT, ORCHESTRATOR_NODE, MULTI_AGENT_EDGES } from './constants'

interface MultiAgentGraphProps {
  process: ProcessInfo
  aggregatedSteps?: AggregatedSteps | null
  onNodeSelect?: (agentId: string | null) => void
  onNodeClick?: (agentId: string) => void  // Original signature for backward compatibility
  selectedNode?: string | null
  hideLegend?: boolean  // Hide internal legend (use external WorkflowLegend component instead)
}

// Status colors for nodes
const STATUS_COLORS = {
  pending: { bg: 'fill-gray-100', border: 'stroke-gray-300', text: 'text-gray-500' },
  running: { bg: 'fill-blue-100', border: 'stroke-blue-500', text: 'text-blue-700' },
  completed: { bg: 'fill-green-100', border: 'stroke-green-500', text: 'text-green-700' },
  failed: { bg: 'fill-red-100', border: 'stroke-red-500', text: 'text-red-700' },
  skipped: { bg: 'fill-gray-50', border: 'stroke-gray-200', text: 'text-gray-400' },
  // Inactive = agent exists but has no steps in current workflow (distinct from skipped)
  inactive: { bg: 'fill-slate-50', border: 'stroke-slate-200', text: 'text-slate-300' },
}

// Edge colors by type
const EDGE_COLORS = {
  control: '#6366f1',  // Indigo - orchestrator control
  retry: '#f59e0b',    // Amber - retry connections
  dataflow: '#10b981', // Emerald - data flow
  dependency: '#64748b', // Slate - dependencies
  self: '#8b5cf6',     // Purple - self-loops
}

export function MultiAgentGraph({
  process,
  aggregatedSteps,
  onNodeSelect,
  onNodeClick,
  selectedNode,
  hideLegend = false,
}: MultiAgentGraphProps) {
  // Support both callback names for backward compatibility
  // onNodeClick takes string, onNodeSelect takes string | null
  const handleNodeSelection = useCallback((agentId: string | null) => {
    if (onNodeSelect) {
      onNodeSelect(agentId)
    } else if (onNodeClick && agentId !== null) {
      onNodeClick(agentId)
    }
  }, [onNodeSelect, onNodeClick])
  const { agents, orchestrator, edges, stepToAgent, isLoading } = useWorkflowDefinitions(process.workflowName)
  const { scrollRef, saveScrollPosition } = useScrollPreservation()
  const { wigglingNode, handleNodeMouseEnter, handleNodeMouseLeave } = useNodeWiggle()

  // Attach scroll listener to save position on user scroll
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (scrollEl) {
      scrollEl.addEventListener('scroll', saveScrollPosition, { passive: true })
      return () => scrollEl.removeEventListener('scroll', saveScrollPosition)
    }
  }, [saveScrollPosition, scrollRef])

  // Layout configuration for hub-and-spoke
  // Orchestrator is in the CENTER, all other agents arranged around it
  const layout = useMemo(() => {
    const centerX = 300
    const centerY = 280
    const radius = 200  // Distance from center for worker agents

    // All agents except orchestrator go in the outer ring
    // (orchestrator is handled separately at center)
    const workerAgents = agents.filter(a => a.id !== 'orchestrator')

    // Position orchestrator at center
    const orchestratorPosition = {
      agent: orchestrator,
      x: centerX,
      y: centerY,
    }

    // Position worker agents in outer ring
    const workerPositions = workerAgents.map((agent, i) => {
      const angle = (i / workerAgents.length) * Math.PI * 2 - Math.PI / 2
      return {
        agent,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      }
    })

    return {
      positions: [orchestratorPosition, ...workerPositions],
      width: centerX * 2 + 100,
      height: centerY * 2 + 120,
      centerX,
      centerY,
    }
  }, [agents, orchestrator])

  // Build step status map and count steps per agent
  const { stepStatusMap, stepCountMap, agentsInWorkflow } = useMemo(() => {
    const statusMap: Record<string, StepInfo> = {}
    const countMap: Record<string, number> = {}
    const agentSet = new Set<string>()

    if (process.steps) {
      for (const step of process.steps) {
        const agentId = stepToAgent[step.name] || step.name
        agentSet.add(agentId)
        countMap[agentId] = (countMap[agentId] || 0) + 1

        // Keep most relevant status (running > completed > pending > failed)
        if (!statusMap[agentId] || step.status === 'running' || (step.status === 'completed' && statusMap[agentId].status !== 'running')) {
          statusMap[agentId] = { ...step }
        }
      }
    }
    return { stepStatusMap: statusMap, stepCountMap: countMap, agentsInWorkflow: agentSet }
  }, [process.steps, stepToAgent])

  // Get step count for an agent (how many workflow steps this agent handles)
  const getStepCount = useCallback((agentId: string): number => {
    return stepCountMap[agentId] || 0
  }, [stepCountMap])

  const getNodeStatus = useCallback((agentId: string): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'inactive' => {
    // Check if agent has ANY steps in this workflow
    if (!agentsInWorkflow.has(agentId)) {
      return 'inactive' // Agent not used in this workflow
    }

    const stepInfo = stepStatusMap[agentId]
    if (stepInfo) return stepInfo.status as any

    const isWorkflowComplete = process.completedSteps >= process.totalSteps && process.totalSteps > 0
    return isWorkflowComplete ? 'skipped' : 'pending'
  }, [stepStatusMap, agentsInWorkflow, process.completedSteps, process.totalSteps])

  const handleNodeClickInternal = useCallback((agentId: string) => {
    handleNodeSelection?.(selectedNode === agentId ? null : agentId)
  }, [handleNodeSelection, selectedNode])

  // Node dimensions
  const nodeWidth = 80
  const nodeHeight = 50

  // Get position for an agent
  const getPosition = useCallback((agentId: string) => {
    const pos = layout.positions.find(p => p.agent.id === agentId)
    return pos || { x: layout.centerX, y: layout.centerY }
  }, [layout])

  // Find currently running agent (for animated control line)
  const runningAgentId = useMemo(() => {
    for (const [agentId, stepInfo] of Object.entries(stepStatusMap)) {
      if (stepInfo.status === 'running') return agentId
    }
    return null
  }, [stepStatusMap])

  // Determine which agents have been touched (running or completed) for progressive arrows
  const touchedAgents = useMemo(() => {
    const touched = new Set<string>(['orchestrator']) // Orchestrator always shown
    for (const [agentId, stepInfo] of Object.entries(stepStatusMap)) {
      if (stepInfo.status === 'running' || stepInfo.status === 'completed') {
        touched.add(agentId)
      }
    }
    return touched
  }, [stepStatusMap])

  // Filter edges to only show progressive dataflow (completed/running agents)
  const shouldShowEdge = useCallback((edge: EdgeDefinition): boolean => {
    // Control edges from orchestrator: only show to touched agents
    if (edge.type === 'control' && edge.from === 'orchestrator') {
      return touchedAgents.has(edge.to)
    }
    // Feedback edges: show if source agent has completed
    if (edge.type === 'retry') {
      const sourceStatus = stepStatusMap[edge.from]?.status
      return sourceStatus === 'completed' || sourceStatus === 'running'
    }
    // Dataflow edges: show if FROM agent is completed/running
    if (edge.type === 'dataflow') {
      return touchedAgents.has(edge.from) && touchedAgents.has(edge.to)
    }
    return true // Other edge types always shown
  }, [touchedAgents, stepStatusMap])

  // Render edge between two nodes
  const renderEdge = useCallback((edge: EdgeDefinition, idx: number, isActiveControl: boolean = false) => {
    const fromPos = getPosition(edge.from)
    const toPos = getPosition(edge.to)

    // Self-loop
    if (edge.from === edge.to) {
      const loopRadius = 20
      const path = `M ${fromPos.x + nodeWidth/2} ${fromPos.y}
                    C ${fromPos.x + nodeWidth/2 + loopRadius*2} ${fromPos.y - loopRadius},
                      ${fromPos.x + nodeWidth/2 + loopRadius*2} ${fromPos.y + loopRadius},
                      ${fromPos.x + nodeWidth/2} ${fromPos.y}`
      return (
        <path
          key={idx}
          d={path}
          fill="none"
          stroke={EDGE_COLORS[edge.type || 'dependency']}
          strokeWidth={1.5}
          strokeDasharray={edge.type === 'retry' ? '4,2' : undefined}
          opacity={0.6}
        />
      )
    }

    // Calculate edge start/end points at node boundaries
    const dx = toPos.x - fromPos.x
    const dy = toPos.y - fromPos.y
    const angle = Math.atan2(dy, dx)

    const startX = fromPos.x + (nodeWidth / 2) * Math.cos(angle)
    const startY = fromPos.y + (nodeHeight / 2) * Math.sin(angle)
    const endX = toPos.x - (nodeWidth / 2) * Math.cos(angle)
    const endY = toPos.y - (nodeHeight / 2) * Math.sin(angle)

    // Curved path for better visibility
    const midX = (startX + endX) / 2
    const midY = (startY + endY) / 2
    const perpX = -(endY - startY) * 0.1
    const perpY = (endX - startX) * 0.1

    const pathD = `M ${startX} ${startY} Q ${midX + perpX} ${midY + perpY} ${endX} ${endY}`

    // Active control line gets animated dash
    const isAnimated = isActiveControl && edge.type === 'control'

    return (
      <g key={idx}>
        <path
          d={pathD}
          fill="none"
          stroke={isAnimated ? '#6366f1' : EDGE_COLORS[edge.type || 'dependency']}
          strokeWidth={isAnimated ? 2.5 : edge.type === 'control' ? 1 : 1.5}
          strokeDasharray={edge.type === 'retry' ? '4,2' : edge.type === 'control' ? '4,4' : undefined}
          opacity={edge.type === 'control' && !isAnimated ? 0.3 : 0.7}
          markerEnd={isAnimated ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
          className={isAnimated ? 'animate-dash' : undefined}
          style={isAnimated ? { animation: 'dash 0.5s linear infinite' } : undefined}
        />
      </g>
    )
  }, [getPosition, nodeWidth, nodeHeight])

  // Render a node
  const renderNode = useCallback((position: { agent: AgentDefinition; x: number; y: number }) => {
    const { agent, x, y } = position
    const status = agent.id === 'orchestrator' ? 'running' : getNodeStatus(agent.id)
    const colors = STATUS_COLORS[status] || STATUS_COLORS.pending
    const Icon = agent.icon
    const isSelected = selectedNode === agent.id
    const isWiggling = wigglingNode === agent.id
    const isOrchestrator = agent.isOrchestrator || agent.id === 'orchestrator'
    const isInactive = status === 'inactive'
    const stepCount = getStepCount(agent.id)

    // Calculate wiggle transform - subtle rotation that doesn't cause layout shift
    const wiggleTransform = isWiggling ? 'rotate(2)' : 'rotate(0)'

    return (
      <g
        key={agent.id}
        transform={`translate(${x - nodeWidth/2}, ${y - nodeHeight/2})`}
        onClick={() => handleNodeClickInternal(agent.id)}
        onMouseEnter={() => handleNodeMouseEnter(agent.id)}
        onMouseLeave={handleNodeMouseLeave}
        style={{
          cursor: 'pointer',
          transformOrigin: `${nodeWidth/2}px ${nodeHeight/2}px`,
          transition: 'transform 0.15s ease-in-out',
          opacity: isInactive ? 0.5 : 1,
        }}
      >
            {/* Node background - flashes when running, dashed when inactive */}
            <rect
              width={nodeWidth}
              height={nodeHeight}
              rx={isOrchestrator ? nodeHeight/2 : 8}
              className={`${colors.bg} ${colors.border} ${status === 'running' ? 'animate-pulse' : ''}`}
              strokeWidth={isSelected ? 3 : status === 'running' ? 2.5 : isOrchestrator ? 2 : 1.5}
              strokeDasharray={isInactive ? '4,2' : undefined}
              style={{
                filter: isOrchestrator ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' :
                        status === 'running' ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))' : undefined,
              }}
            />

            {/* Icon */}
            <foreignObject x={8} y={8} width={24} height={24}>
              <Icon className={`w-5 h-5 ${colors.text}`} />
            </foreignObject>

            {/* Label */}
            <text
              x={nodeWidth / 2 + 6}
              y={nodeHeight / 2 + 4}
              textAnchor="middle"
              className={`text-[10px] font-medium ${colors.text}`}
              fill="currentColor"
            >
              {agent.shortName}
            </text>

            {/* Step count badge - shown when agent handles multiple steps */}
            {stepCount > 1 && (
              <g transform={`translate(${nodeWidth - 4}, -4)`}>
                <circle r={8} className="fill-indigo-500" />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="text-[8px] fill-white font-bold"
                >
                  {stepCount}
                </text>
              </g>
            )}

            {/* Status indicator */}
            {status === 'running' && (
              <circle
                cx={nodeWidth - 8}
                cy={8}
                r={4}
                className="fill-blue-500 animate-pulse"
              />
            )}
            {status === 'completed' && (
              <circle
                cx={nodeWidth - 8}
                cy={8}
                r={4}
                className="fill-green-500"
              />
            )}
            {status === 'failed' && (
              <circle
                cx={nodeWidth - 8}
                cy={8}
                r={4}
                className="fill-red-500"
              />
            )}
            {/* Inactive indicator - show "not yet run" */}
            {isInactive && (
              <text
                x={nodeWidth / 2}
                y={nodeHeight + 10}
                textAnchor="middle"
                className="text-[7px] fill-slate-400 italic"
              >
                not yet run
              </text>
            )}

            {/* Orchestrator badge */}
            {isOrchestrator && (
              <text
                x={nodeWidth / 2}
                y={nodeHeight + 12}
                textAnchor="middle"
                className="text-[8px] fill-indigo-600 font-semibold"
              >
                ORCHESTRATOR
              </text>
            )}

          </g>
    )
  }, [getNodeStatus, getStepCount, selectedNode, wigglingNode, handleNodeClickInternal, handleNodeMouseEnter, handleNodeMouseLeave, nodeWidth, nodeHeight])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // Use multi-agent edges for hub-and-spoke visualization
  const displayEdges = MULTI_AGENT_EDGES

  return (
    <div
      ref={scrollRef}
      className="relative bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border overflow-auto max-h-[500px]"
    >
      <svg width={layout.width} height={layout.height + 40}>
        {/* Arrow marker definitions */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#64748b" />
          </marker>
          <marker
            id="arrowhead-active"
            markerWidth="8"
            markerHeight="6"
            refX="6"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
          </marker>
        </defs>

        {/* CSS for dash animation */}
        <style>{`
          @keyframes dash {
            to { stroke-dashoffset: -8; }
          }
          .animate-dash { stroke-dashoffset: 0; }
        `}</style>

        {/* Render edges first (behind nodes) - progressive display */}
        <g className="edges">
          {displayEdges
            .filter(edge => shouldShowEdge(edge))
            .map((edge, idx) => {
              // Check if this is the active control line to running agent
              const isActiveControl = edge.type === 'control' &&
                edge.from === 'orchestrator' &&
                edge.to === runningAgentId
              return renderEdge(edge, idx, isActiveControl)
            })}
        </g>

        {/* Render nodes */}
        <g className="nodes">
          {layout.positions.map(pos => renderNode(pos))}
        </g>

        {/* Legend - can be hidden when using external WorkflowLegend component */}
        {!hideLegend && (
          <g transform={`translate(${layout.width - 130}, 10)`}>
            <rect width={130} height={145} rx={4} fill="white" fillOpacity={0.9} stroke="#e2e8f0" />
            <text x={8} y={16} className="text-[10px] font-semibold fill-slate-700">Legend</text>

            <line x1={8} y1={28} x2={30} y2={28} stroke={EDGE_COLORS.control} strokeWidth={1.5} strokeDasharray="2,2" />
            <text x={36} y={32} className="text-[9px] fill-slate-600">Control</text>

            <line x1={8} y1={44} x2={30} y2={44} stroke={EDGE_COLORS.retry} strokeWidth={1.5} strokeDasharray="4,2" />
            <text x={36} y={48} className="text-[9px] fill-slate-600">Feedback</text>

            <line x1={8} y1={60} x2={30} y2={60} stroke={EDGE_COLORS.dataflow} strokeWidth={1.5} />
            <text x={36} y={64} className="text-[9px] fill-slate-600">Dataflow</text>

            <circle cx={14} cy={78} r={6} fill="none" stroke="#6366f1" strokeWidth={2} />
            <text x={36} y={82} className="text-[9px] fill-slate-600">Orchestrator</text>

            {/* Step count badge */}
            <circle cx={14} cy={96} r={6} className="fill-indigo-500" />
            <text x={14} y={96} textAnchor="middle" dominantBaseline="central" className="text-[7px] fill-white font-bold">6</text>
            <text x={36} y={100} className="text-[9px] fill-slate-600">Steps per agent</text>

            {/* Inactive indicator */}
            <rect x={6} y={108} width={16} height={10} rx={2} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,1" opacity={0.5} />
            <text x={36} y={118} className="text-[9px] fill-slate-600">Not yet run</text>

            <text x={8} y={138} className="text-[8px] fill-slate-500">Click node for details</text>
          </g>
        )}
      </svg>
    </div>
  )
}

export default MultiAgentGraph

// Standalone Legend component for use outside the graph
export function WorkflowLegend() {
  return (
    <div className="p-3 bg-white border rounded-lg shadow-sm">
      <h4 className="text-xs font-semibold text-slate-700 mb-2">Legend</h4>
      <div className="space-y-2 text-xs">
        {/* Edge types */}
        <div className="flex items-center gap-2">
          <svg width="24" height="2">
            <line x1="0" y1="1" x2="24" y2="1" stroke={EDGE_COLORS.control} strokeWidth={1.5} strokeDasharray="2,2" />
          </svg>
          <span className="text-slate-600">Control</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="24" height="2">
            <line x1="0" y1="1" x2="24" y2="1" stroke={EDGE_COLORS.retry} strokeWidth={1.5} strokeDasharray="4,2" />
          </svg>
          <span className="text-slate-600">Feedback</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="24" height="2">
            <line x1="0" y1="1" x2="24" y2="1" stroke={EDGE_COLORS.dataflow} strokeWidth={1.5} />
          </svg>
          <span className="text-slate-600">Dataflow</span>
        </div>

        <hr className="my-2" />

        {/* Node types */}
        <div className="flex items-center gap-2">
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="6" fill="none" stroke="#6366f1" strokeWidth={2} />
          </svg>
          <span className="text-slate-600">Orchestrator</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="6" className="fill-indigo-500" />
            <text x="8" y="8" textAnchor="middle" dominantBaseline="central" className="text-[6px] fill-white font-bold">N</text>
          </svg>
          <span className="text-slate-600">Steps per agent</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="12">
            <rect x="0" y="1" width="16" height="10" rx="2" fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="2,1" opacity={0.5} />
          </svg>
          <span className="text-slate-600">Not yet run</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mt-2">Click node for details</p>
    </div>
  )
}
