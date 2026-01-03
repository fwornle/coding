'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import type { AgentDefinition, EdgeDefinition, WorkflowDefinitionsAPI } from './types'
import { WORKFLOW_AGENTS, ORCHESTRATOR_NODE, STEP_TO_AGENT, MULTI_AGENT_EDGES, ICON_MAP } from './constants'

// Hook to fetch workflow definitions from API with fallback to constants
export function useWorkflowDefinitions(workflowName?: string) {
  const [agents, setAgents] = useState<AgentDefinition[]>(WORKFLOW_AGENTS)
  const [orchestrator, setOrchestrator] = useState<AgentDefinition>(ORCHESTRATOR_NODE)
  const [edges, setEdges] = useState<EdgeDefinition[]>(MULTI_AGENT_EDGES)
  const [stepToAgent, setStepToAgent] = useState(STEP_TO_AGENT)
  const [allWorkflows, setAllWorkflows] = useState<Array<{ name: string; edges: EdgeDefinition[] }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDefinitions() {
      try {
        const apiPort = 3033
        const response = await fetch(`http://localhost:${apiPort}/api/workflows/definitions`)

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`)
        }

        const data: WorkflowDefinitionsAPI = await response.json()

        if (data.status === 'success' && data.data) {
          // Transform agents to include icon component
          const transformedAgents = data.data.agents.map(agent => ({
            ...agent,
            icon: ICON_MAP[agent.icon] || ICON_MAP.Code,
          })) as AgentDefinition[]
          setAgents(transformedAgents)

          // Transform orchestrator
          setOrchestrator({
            ...data.data.orchestrator,
            icon: ICON_MAP[data.data.orchestrator.icon] || ICON_MAP.Play,
          } as AgentDefinition)

          // Update step mappings
          setStepToAgent(data.data.stepMappings)

          // Store all workflows
          setAllWorkflows(data.data.workflows.map(w => ({
            name: w.name,
            edges: w.edges as EdgeDefinition[]
          })))

          console.log('Loaded workflow definitions from API')
        }
      } catch (err) {
        console.warn('Failed to fetch workflow definitions, using fallback:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        // Keep using the constants as fallback
      } finally {
        setIsLoading(false)
      }
    }

    fetchDefinitions()
  }, [])

  // Update edges when workflow name changes
  useEffect(() => {
    if (workflowName && allWorkflows.length > 0) {
      const workflow = allWorkflows.find(w => w.name === workflowName)
      if (workflow) {
        setEdges(workflow.edges)
      }
    }
  }, [workflowName, allWorkflows])

  return { agents, orchestrator, edges, stepToAgent, isLoading, error }
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
