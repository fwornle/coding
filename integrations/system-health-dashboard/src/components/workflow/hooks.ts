'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import type { AgentDefinition, EdgeDefinition } from './types'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  selectAgents,
  selectOrchestrator,
  selectEdges,
  selectStepMappings,
  selectStepToSubStep,
  selectAgentSubSteps,
  selectWorkflowConfigLoading,
  selectWorkflowConfigError,
  selectWorkflowConfigInitialized,
  setWorkflowEdges,
} from '@/store/slices/workflowConfigSlice'
import { WORKFLOW_AGENTS, ORCHESTRATOR_NODE, STEP_TO_AGENT, STEP_TO_SUBSTEP, MULTI_AGENT_EDGES, AGENT_SUBSTEPS } from './constants'

// Hook to get workflow definitions from Redux (populated by API with fallback to constants)
export function useWorkflowDefinitions(workflowName?: string) {
  const dispatch = useAppDispatch()

  // Read from Redux store
  const agents = useAppSelector(selectAgents)
  const orchestrator = useAppSelector(selectOrchestrator)
  const edges = useAppSelector(selectEdges)
  const stepToAgent = useAppSelector(selectStepMappings)
  const stepToSubStep = useAppSelector(selectStepToSubStep)
  const agentSubSteps = useAppSelector(selectAgentSubSteps)
  const isLoading = useAppSelector(selectWorkflowConfigLoading)
  const error = useAppSelector(selectWorkflowConfigError)
  const initialized = useAppSelector(selectWorkflowConfigInitialized)

  // Update edges when workflow name changes
  useEffect(() => {
    if (workflowName && initialized) {
      dispatch(setWorkflowEdges({ workflowName }))
    }
  }, [workflowName, initialized, dispatch])

  // Return fallback values if not initialized
  if (!initialized) {
    return {
      agents: WORKFLOW_AGENTS,
      orchestrator: ORCHESTRATOR_NODE,
      edges: MULTI_AGENT_EDGES,
      stepToAgent: STEP_TO_AGENT,
      stepToSubStep: STEP_TO_SUBSTEP,
      agentSubSteps: AGENT_SUBSTEPS,
      isLoading: true,
      error: null
    }
  }

  // IMPORTANT: Merge API data with constants to ensure all mappings exist
  // The API may return partial data, so we need constants as a safety net
  // Constants take precedence for critical mappings (like operator_* → kg_operators)
  return {
    agents: agents.length > 0 ? agents : WORKFLOW_AGENTS,
    orchestrator: orchestrator || ORCHESTRATOR_NODE,
    edges: edges.length > 0 ? edges : MULTI_AGENT_EDGES,
    stepToAgent: { ...STEP_TO_AGENT, ...stepToAgent },  // Merge: constants first, API overrides
    stepToSubStep: { ...STEP_TO_SUBSTEP, ...stepToSubStep },  // Merge: constants first, API overrides
    agentSubSteps: { ...AGENT_SUBSTEPS, ...agentSubSteps },  // Merge: constants first, API overrides
    isLoading,
    error
  }
}

// Hook to preserve scroll position across re-renders
export function useScrollPreservation() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollPositionRef = useRef({ x: 0, y: 0 })
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Save scroll position - called by scroll event handler
  const saveScrollPosition = useCallback(() => {
    if (scrollRef.current) {
      scrollPositionRef.current = {
        x: scrollRef.current.scrollLeft,
        y: scrollRef.current.scrollTop,
      }
      // Mark that user is actively scrolling
      isUserScrollingRef.current = true

      // Clear any existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      // After 100ms of no scroll events, consider scrolling complete
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 100)
    }
  }, [])

  // Restore scroll position after DOM updates (synchronously before paint)
  useLayoutEffect(() => {
    // Only restore if we have a saved position and scroll was reset by React
    if (scrollRef.current && !isUserScrollingRef.current) {
      const currentX = scrollRef.current.scrollLeft
      const currentY = scrollRef.current.scrollTop
      const savedX = scrollPositionRef.current.x
      const savedY = scrollPositionRef.current.y

      // Only restore if scroll position was reset to 0 but we had a different saved position
      if ((currentX === 0 && currentY === 0) && (savedX !== 0 || savedY !== 0)) {
        scrollRef.current.scrollLeft = savedX
        scrollRef.current.scrollTop = savedY
      }
    }
  })

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // No longer exporting restoreScrollPosition - it's handled internally by useLayoutEffect
  return { scrollRef, saveScrollPosition, restoreScrollPosition: () => {} }
}

// Hook for node wiggle animation
export function useNodeWiggle() {
  const [wigglingNode, setWigglingNode] = useState<string | null>(null)
  const wiggleTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleNodeMouseEnter = useCallback((agentId: string) => {
    if (wiggleTimeoutRef.current) {
      clearTimeout(wiggleTimeoutRef.current)
    }
    setWigglingNode(agentId)
    wiggleTimeoutRef.current = setTimeout(() => {
      setWigglingNode(null)
    }, 600)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    if (wiggleTimeoutRef.current) {
      clearTimeout(wiggleTimeoutRef.current)
    }
    setWigglingNode(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wiggleTimeoutRef.current) {
        clearTimeout(wiggleTimeoutRef.current)
      }
    }
  }, [])

  return { wigglingNode, handleNodeMouseEnter, handleNodeMouseLeave }
}

// Hook to compute visible agents and layout
export function useWorkflowLayout(
  agents: AgentDefinition[],
  edges: EdgeDefinition[],
  mode: 'multi-agent' | 'dataflow' = 'multi-agent'
) {
  // Collect all agent IDs that appear in edges
  const agentIdsInWorkflow = new Set<string>()
  for (const edge of edges) {
    if (edge.from !== 'orchestrator') {
      agentIdsInWorkflow.add(edge.from)
    }
    agentIdsInWorkflow.add(edge.to)
  }

  // Filter agents that are in the workflow
  const filtered = agents.filter(agent => agentIdsInWorkflow.has(agent.id))

  // Normalize row numbers to consecutive integers
  const uniqueRows = [...new Set(filtered.map(a => a.row))].sort((a, b) => a - b)
  const rowMap = new Map<number, number>()
  uniqueRows.forEach((row, index) => {
    rowMap.set(row, index)
  })

  // Apply normalized positions
  const normalizedAgents = filtered.map(agent => ({
    ...agent,
    row: rowMap.get(agent.row) ?? agent.row
  }))

  // Compute max dimensions
  let maxRow = 0
  let maxCol = 0
  for (const agent of normalizedAgents) {
    maxRow = Math.max(maxRow, agent.row)
    maxCol = Math.max(maxCol, agent.col)
  }

  return {
    visibleAgents: normalizedAgents,
    maxRow,
    maxCol: Math.max(maxCol, 2)
  }
}
