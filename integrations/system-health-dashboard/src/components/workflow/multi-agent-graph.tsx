'use client'

import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react'
import { useSelector } from 'react-redux'
import type { AgentDefinition, EdgeDefinition, ProcessInfo, StepInfo } from './types'
import type { AggregatedSteps } from '@/store/slices/ukbSlice'
import {
  selectIsEventDrivenMode,
  selectExecutionStepStatuses,
  selectExecutionSubstepStatuses,
  selectExecutionCurrentStep,
  selectExecutionCurrentSubstep,
  selectLLMState,
  type LLMMode,
} from '@/store/slices/ukbSlice'
import { useScrollPreservation, useNodeWiggle, useWorkflowDefinitions } from './hooks'
// WebSocket hook disabled - no server-side implementation exists yet
// import useWorkflowWebSocket from '@/hooks/useWorkflowWebSocket'
import { STEP_TO_SUBSTEP, ORCHESTRATOR_NODE, MULTI_AGENT_EDGES } from './constants'
import { Logger, LogCategories } from '@/utils/logging'

interface MultiAgentGraphProps {
  process: ProcessInfo
  aggregatedSteps?: AggregatedSteps | null
  onNodeSelect?: (agentId: string | null) => void
  onNodeClick?: (agentId: string) => void  // Original signature for backward compatibility
  onSubStepSelect?: (agentId: string, substep: SubStep | null) => void  // Called when substep is selected
  selectedNode?: string | null
  selectedSubStepId?: string | null  // Controlled substep selection from parent
  hideLegend?: boolean  // Hide internal legend (use external WorkflowLegend component instead)
  // Controlled expanded substeps agent from parent (modal tracks this in Redux)
  // When provided, disables internal auto-expand logic and uses this value directly
  expandedSubStepsAgent?: string | null
  onExpandedSubStepsAgentChange?: (agentId: string | null) => void
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

// Sub-step definitions for agents with multiple internal operations
export interface SubStep {
  id: string
  name: string
  shortName: string  // 3-4 chars for compact display
  description: string
  inputs: string[]
  outputs: string[]
  llmUsage?: 'none' | 'fast' | 'standard' | 'premium'
  techNote?: string
}

export const AGENT_SUBSTEPS: Record<string, SubStep[]> = {
  'kg_operators': [
    { id: 'conv', name: 'Conversational Extraction', shortName: 'Conv',
      description: 'Extract conversational patterns and dialogue structures from session content',
      inputs: ['Session transcripts', 'Message threads'],
      outputs: ['Conversational entities', 'Dialogue patterns'],
      llmUsage: 'fast', techNote: 'Uses fast LLM for pattern matching' },
    { id: 'aggr', name: 'Entity Aggregation', shortName: 'Aggr',
      description: 'Aggregate similar entities based on semantic similarity and naming patterns',
      inputs: ['Raw entities', 'Similarity thresholds'],
      outputs: ['Aggregated entity groups', 'Merge candidates'],
      llmUsage: 'standard', techNote: 'Semantic similarity via embeddings' },
    { id: 'embed', name: 'Embedding Generation', shortName: 'Emb',
      description: 'Generate vector embeddings for entities to enable semantic search and clustering',
      inputs: ['Entity descriptions', 'Observations'],
      outputs: ['Entity embeddings (768-dim)', 'Embedding index'],
      llmUsage: 'none', techNote: 'Uses embedding model directly' },
    { id: 'dedup', name: 'Deduplication', shortName: 'Dup',
      description: 'Remove duplicate entities using fuzzy matching and semantic comparison',
      inputs: ['Entity list', 'Embeddings'],
      outputs: ['Deduplicated entities', 'Merge log'],
      llmUsage: 'fast', techNote: 'Fast LLM for merge decisions' },
    { id: 'pred', name: 'Relation Prediction', shortName: 'Pred',
      description: 'Predict relationships between entities using graph patterns and LLM inference',
      inputs: ['Entity pairs', 'Context'],
      outputs: ['Predicted relations', 'Confidence scores'],
      llmUsage: 'standard', techNote: 'LLM-powered relation inference' },
    { id: 'merge', name: 'Graph Merge', shortName: 'Mrg',
      description: 'Merge new entities and relations into the persistent knowledge graph',
      inputs: ['New entities', 'New relations'],
      outputs: ['Updated graph', 'Merge statistics'],
      llmUsage: 'none', techNote: 'Direct graph operations' },
  ],
  'semantic_analysis': [
    { id: 'parse', name: 'Content Parsing', shortName: 'Prs',
      description: 'Parse raw content into structured segments for analysis',
      inputs: ['Raw text', 'Code blocks', 'Markdown'],
      outputs: ['Parsed segments', 'Content structure'],
      llmUsage: 'none', techNote: 'Rule-based parsing' },
    { id: 'extract', name: 'Entity Extraction', shortName: 'Ext',
      description: 'Extract named entities, concepts, and technical terms from content',
      inputs: ['Parsed content', 'Domain context'],
      outputs: ['Named entities', 'Technical concepts'],
      llmUsage: 'standard', techNote: 'LLM-powered NER' },
    { id: 'relate', name: 'Relation Discovery', shortName: 'Rel',
      description: 'Discover relationships between extracted entities',
      inputs: ['Entities', 'Context windows'],
      outputs: ['Entity relations', 'Relation types'],
      llmUsage: 'standard', techNote: 'Contextual relation extraction' },
    { id: 'enrich', name: 'Context Enrichment', shortName: 'Enr',
      description: 'Enrich entities with additional context and metadata',
      inputs: ['Base entities', 'Source metadata'],
      outputs: ['Enriched entities', 'Observations'],
      llmUsage: 'fast', techNote: 'Fast context summarization' },
  ],
  'ontology_classification': [
    { id: 'match', name: 'Class Matching', shortName: 'Mch',
      description: 'Match entities to ontology classes using semantic similarity',
      inputs: ['Entities', 'Ontology classes'],
      outputs: ['Class assignments', 'Match scores'],
      llmUsage: 'standard', techNote: 'LLM-guided classification' },
    { id: 'validate', name: 'Classification Validation', shortName: 'Val',
      description: 'Validate classifications against ontology constraints',
      inputs: ['Classifications', 'Ontology rules'],
      outputs: ['Validated assignments', 'Violations'],
      llmUsage: 'fast', techNote: 'Rule + LLM validation' },
    { id: 'extend', name: 'Ontology Auto-Extension', shortName: 'Ext',
      description: 'Suggest new ontology classes for unclassified entities',
      inputs: ['Unclassified entities', 'Existing ontology'],
      outputs: ['New class suggestions', 'Extension rationale'],
      llmUsage: 'premium', techNote: 'Premium LLM for ontology design' },
  ],
  'observation_generation': [
    { id: 'generate', name: 'LLM Generate', shortName: 'Gen',
      description: 'Generate structured observations from semantic analysis using LLM',
      inputs: ['Semantic analysis results', 'Batch context'],
      outputs: ['Raw observations', 'Confidence scores'],
      llmUsage: 'premium', techNote: 'Premium LLM for observation synthesis' },
    { id: 'accumulate', name: 'Accumulate', shortName: 'Acc',
      description: 'Accumulate and deduplicate observations across batch iterations',
      inputs: ['New observations', 'Existing observations'],
      outputs: ['Merged observation set', 'Dedup statistics'],
      llmUsage: 'none', techNote: 'In-memory accumulation' },
  ],
  'git_history': [
    { id: 'fetch', name: 'Commit Fetching', shortName: 'Ftc',
      description: 'Fetch commit history from git repository',
      inputs: ['Repository path', 'Date range'],
      outputs: ['Commit list', 'Commit metadata'],
      llmUsage: 'none', techNote: 'Git CLI operations' },
    { id: 'diff', name: 'Diff Analysis', shortName: 'Dif',
      description: 'Analyze code diffs to understand changes',
      inputs: ['Commit diffs', 'File context'],
      outputs: ['Change summaries', 'Impact analysis'],
      llmUsage: 'fast', techNote: 'Fast LLM for diff summarization' },
    { id: 'extract', name: 'Metadata Extraction', shortName: 'Ext',
      description: 'Extract structured metadata from commits',
      inputs: ['Commit messages', 'Author info'],
      outputs: ['Structured metadata', 'Development patterns'],
      llmUsage: 'none', techNote: 'Pattern-based extraction' },
  ],
  'quality_assurance': [
    { id: 'validate', name: 'Entity Validation', shortName: 'Val',
      description: 'Validate entity completeness and consistency',
      inputs: ['Entities', 'Validation rules'],
      outputs: ['Validation results', 'Issue list'],
      llmUsage: 'fast', techNote: 'Rule + LLM validation' },
    { id: 'score', name: 'Quality Scoring', shortName: 'Scr',
      description: 'Calculate quality scores for entities',
      inputs: ['Entities', 'Scoring criteria'],
      outputs: ['Quality scores', 'Score breakdown'],
      llmUsage: 'none', techNote: 'Algorithmic scoring' },
    { id: 'report', name: 'QA Reporting', shortName: 'Rpt',
      description: 'Generate quality assurance reports',
      inputs: ['Validation results', 'Scores'],
      outputs: ['QA report', 'Recommendations'],
      llmUsage: 'fast', techNote: 'LLM report generation' },
  ],
  'batch_scheduler': [
    { id: 'plan', name: 'Batch Planning', shortName: 'Plan',
      description: 'Plan chronological batch windows for processing',
      inputs: ['Date range', 'Batch size config'],
      outputs: ['Batch plan', 'Processing schedule'],
      llmUsage: 'none', techNote: 'Algorithmic planning' },
    { id: 'track', name: 'Progress Tracking', shortName: 'Trk',
      description: 'Track batch processing progress and status',
      inputs: ['Batch status', 'Step results'],
      outputs: ['Progress metrics', 'Status updates'],
      llmUsage: 'none', techNote: 'State management' },
    { id: 'resume', name: 'Checkpoint Resume', shortName: 'Rsm',
      description: 'Resume processing from last checkpoint',
      inputs: ['Checkpoint data', 'Batch config'],
      outputs: ['Resumed state', 'Skip list'],
      llmUsage: 'none', techNote: 'Checkpoint restoration' },
  ],
  'insight_generation': [
    { id: 'patterns', name: 'Pattern Discovery', shortName: 'Pat',
      description: 'Identify design patterns and architectural patterns',
      inputs: ['Code entities', 'Relations'],
      outputs: ['Pattern instances', 'Pattern descriptions'],
      llmUsage: 'premium', techNote: 'Premium LLM for pattern analysis' },
    { id: 'arch', name: 'Architecture Diagramming', shortName: 'Arc',
      description: 'Generate architecture diagrams from code analysis',
      inputs: ['Components', 'Dependencies'],
      outputs: ['PlantUML diagrams', 'Architecture docs'],
      llmUsage: 'standard', techNote: 'LLM diagram generation' },
    { id: 'docs', name: 'Documentation Generation', shortName: 'Doc',
      description: 'Create documentation from extracted knowledge',
      inputs: ['Entities', 'Relations', 'Patterns'],
      outputs: ['Documentation', 'README sections'],
      llmUsage: 'standard', techNote: 'LLM documentation' },
    { id: 'synth', name: 'Insight Synthesis', shortName: 'Syn',
      description: 'Synthesize high-level insights from analysis',
      inputs: ['All analysis results'],
      outputs: ['Key insights', 'Recommendations'],
      llmUsage: 'premium', techNote: 'Premium LLM synthesis' },
  ],
  'vibe_history': [
    { id: 'fetch', name: 'Session Fetching', shortName: 'Ftc',
      description: 'Fetch conversation sessions from transcript files',
      inputs: ['Session directory', 'Date filter'],
      outputs: ['Session list', 'Session metadata'],
      llmUsage: 'none', techNote: 'File system operations' },
    { id: 'parse', name: 'Session Parsing', shortName: 'Prs',
      description: 'Parse session content into structured format',
      inputs: ['Raw transcripts'],
      outputs: ['Parsed messages', 'Tool calls'],
      llmUsage: 'none', techNote: 'Markdown parsing' },
    { id: 'extract', name: 'Session Analysis', shortName: 'Ext',
      description: 'Extract key information from sessions',
      inputs: ['Parsed sessions'],
      outputs: ['Session summaries', 'Key decisions'],
      llmUsage: 'fast', techNote: 'Fast session summarization' },
  ],
  'code_graph': [
    { id: 'index', name: 'Code Indexing', shortName: 'Idx',
      description: 'Index repository code into AST-based graph',
      inputs: ['Repository path', 'Language config'],
      outputs: ['Code graph', 'Symbol index'],
      llmUsage: 'none', techNote: 'AST parsing via tree-sitter' },
    { id: 'query', name: 'Graph Querying', shortName: 'Qry',
      description: 'Query code relationships from indexed graph',
      inputs: ['Query', 'Filters'],
      outputs: ['Query results', 'Related symbols'],
      llmUsage: 'none', techNote: 'Cypher queries on Memgraph' },
    { id: 'analyze', name: 'Code Analysis', shortName: 'Anl',
      description: 'Analyze code patterns and dependencies',
      inputs: ['Code graph', 'Analysis type'],
      outputs: ['Analysis results', 'Insights'],
      llmUsage: 'standard', techNote: 'LLM-powered code analysis' },
  ],
}

export function MultiAgentGraph({
  process,
  aggregatedSteps,
  onNodeSelect,
  onNodeClick,
  onSubStepSelect,
  selectedNode,
  selectedSubStepId,
  hideLegend = false,
  expandedSubStepsAgent: expandedSubStepsAgentProp,
  onExpandedSubStepsAgentChange,
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
  const { agents, orchestrator, edges, stepToAgent, stepToSubStep, agentSubSteps, isLoading } = useWorkflowDefinitions(process.workflowName)

  // Event-driven mode: get step statuses from Redux when available
  const isEventDrivenMode = useSelector(selectIsEventDrivenMode)
  const executionStepStatuses = useSelector(selectExecutionStepStatuses)
  const executionSubstepStatuses = useSelector(selectExecutionSubstepStatuses)
  const executionCurrentStep = useSelector(selectExecutionCurrentStep)
  const executionCurrentSubstep = useSelector(selectExecutionCurrentSubstep)

  // LLM Mode state for per-agent badges
  const llmState = useSelector(selectLLMState)

  // WebSocket disabled - no server-side implementation exists yet
  // TODO: Implement WebSocket server in mcp-server-semantic-analysis to enable real-time SSE events
  // const { isConnected: wsConnected, error: wsError } = useWorkflowWebSocket()

  // Merge YAML-provided substep ID mappings with hardcoded fallback
  // NOTE: STEP_TO_SUBSTEP is a DEPRECATED fallback - prefer YAML-provided definitions
  const effectiveStepToSubStep = Object.keys(stepToSubStep).length > 0
    ? stepToSubStep
    : STEP_TO_SUBSTEP

  // Compute which agents have RUNTIME substeps (based on stepToSubStep mappings)
  // An agent has runtime substeps if any step maps to that agent AND is in stepToSubStep
  const agentsWithRuntimeSubsteps = useMemo(() => {
    const agents = new Set<string>()
    // DEBUG: Check if operator_* steps are in stepToAgent and effectiveStepToSubStep
    const operatorSteps = ['operator_conv', 'operator_aggr', 'operator_embed', 'operator_dedup', 'operator_pred', 'operator_merge']
    const kgOpsDebug = {
      stepToAgentHasOperators: operatorSteps.map(s => ({ step: s, agentId: stepToAgent[s] })),
      effectiveStepToSubStepHasOperators: operatorSteps.map(s => ({ step: s, substepId: effectiveStepToSubStep[s] })),
    }

    for (const [stepName, agentId] of Object.entries(stepToAgent)) {
      // If the step has a substep mapping, the agent has runtime substeps
      if (effectiveStepToSubStep[stepName]) {
        agents.add(agentId)
      }
    }

    // DEBUG: Log what we computed
    Logger.info(LogCategories.UI, 'DEBUG: agentsWithRuntimeSubsteps computed', {
      agentsList: Array.from(agents),
      hasKgOperators: agents.has('kg_operators'),
      kgOpsDebug,
      stepToAgentCount: Object.keys(stepToAgent).length,
      effectiveStepToSubStepCount: Object.keys(effectiveStepToSubStep).length,
    })

    return agents
  }, [stepToAgent, effectiveStepToSubStep])

  // Filter visual substeps to only include agents with RUNTIME substeps
  // This prevents showing substep badges/pips for agents that don't support step-into
  const allAgentSubSteps = Object.keys(agentSubSteps).length > 0
    ? agentSubSteps as Record<string, SubStep[]>
    : AGENT_SUBSTEPS
  const effectiveAgentSubSteps = useMemo(() => {
    const filtered: Record<string, SubStep[]> = {}
    for (const [agentId, substeps] of Object.entries(allAgentSubSteps)) {
      if (agentsWithRuntimeSubsteps.has(agentId)) {
        filtered[agentId] = substeps
      }
    }

    // DEBUG: Log filtering result
    Logger.info(LogCategories.UI, 'DEBUG: effectiveAgentSubSteps computed', {
      allAgentSubStepsKeys: Object.keys(allAgentSubSteps),
      filteredKeys: Object.keys(filtered),
      hasKgOperators: !!filtered['kg_operators'],
      kgOperatorsCount: filtered['kg_operators']?.length || 0,
    })

    return filtered
  }, [allAgentSubSteps, agentsWithRuntimeSubsteps])

  // Compute effective process steps: SSE-only when connected (Option B)
  // When SSE is active, ignore polling data entirely - build steps from SSE events only
  const effectiveSteps = useMemo((): StepInfo[] => {
    // DEBUG: Log SSE state
    Logger.info(LogCategories.UI, 'DEBUG effectiveSteps computation', {
      isEventDrivenMode,
      stepStatusesCount: Object.keys(executionStepStatuses).length,
      substepStatusesCount: Object.keys(executionSubstepStatuses).length,
      substepStatusesKeys: Object.keys(executionSubstepStatuses),
      pollingStepsCount: process.steps?.length || 0,
    })

    if (!isEventDrivenMode) {
      // SSE not active - use polling data
      Logger.info(LogCategories.UI, 'DEBUG: Using polling data (SSE not active)')
      return process.steps || []
    }

    // SSE active: build steps list ONLY from SSE events
    const steps: StepInfo[] = []
    const addedStepNames = new Set<string>()

    // 1. Add regular steps from executionStepStatuses
    for (const s of Object.values(executionStepStatuses)) {
      steps.push({
        name: s.name,
        status: s.status,
        duration: s.duration,
        tokensUsed: s.tokensUsed,
        llmProvider: s.llmProvider,
        llmCalls: s.llmCalls,
        error: s.error,
        outputs: s.outputs as Record<string, any>,
      })
      addedStepNames.add(s.name)
    }

    // 2. Add substeps: convert from executionSubstepStatuses
    // Find the step name for each (agentId, substepId) pair using reverse lookup
    for (const [agentId, substeps] of Object.entries(executionSubstepStatuses)) {
      for (const [substepId, substepInfo] of Object.entries(substeps)) {
        // Find the step name that maps to this (agentId, substepId)
        const stepName = Object.entries(effectiveStepToSubStep).find(([name, id]) =>
          id === substepId && stepToAgent[name] === agentId
        )?.[0]

        if (stepName && !addedStepNames.has(stepName)) {
          steps.push({
            name: stepName,
            status: substepInfo.status as StepInfo['status'],
            duration: substepInfo.duration,
            tokensUsed: substepInfo.tokensUsed,
            llmProvider: substepInfo.llmProvider,
          })
          addedStepNames.add(stepName)
        }
      }
    }

    return steps
  }, [isEventDrivenMode, executionStepStatuses, executionSubstepStatuses, process.steps, stepToAgent, effectiveStepToSubStep])
  const { scrollRef, saveScrollPosition } = useScrollPreservation()
  const { wigglingNode, handleNodeMouseEnter, handleNodeMouseLeave } = useNodeWiggle()

  // Track which agent has expanded sub-steps (click blue badge to toggle)
  // Support both controlled (prop) and uncontrolled (local state) modes
  const isControlled = expandedSubStepsAgentProp !== undefined
  const [localExpandedAgent, setLocalExpandedAgent] = useState<string | null>(null)

  // Use controlled value when prop is provided, otherwise use local state
  const expandedSubStepsAgent = isControlled ? expandedSubStepsAgentProp : localExpandedAgent

  // Unified setter that works for both controlled and uncontrolled modes
  const setExpandedSubStepsAgent = useCallback((value: string | null) => {
    if (isControlled) {
      // In controlled mode, notify parent via callback
      onExpandedSubStepsAgentChange?.(value)
    } else {
      // In uncontrolled mode, update local state
      setLocalExpandedAgent(value)
    }
  }, [isControlled, onExpandedSubStepsAgentChange])

  // Track if expansion was triggered automatically (by running status)
  const [autoExpandedAgent, setAutoExpandedAgent] = useState<string | null>(null)
  // Track the last seen step statuses to detect transitions
  const lastStepStatusesRef = useRef<Map<string, string>>(new Map())

  // Auto-expand substeps when a multi-step agent is active (running or recently started)
  // Enhanced logic for free-flight mode: also detect agents where steps just completed
  // IMPORTANT: Skip this logic entirely in controlled mode - let the parent (modal) handle expansion
  useEffect(() => {
    // In controlled mode, the parent manages expandedSubStepsAgent via Redux
    // Don't run our own auto-expand logic or we'll conflict with the parent
    if (isControlled) return

    if (effectiveSteps.length === 0) return

    // Build current status map and detect active agent
    const currentStatuses = new Map<string, string>()
    let activeAgentWithSubsteps: string | null = null
    let recentlyActiveAgent: string | null = null

    for (const step of effectiveSteps) {
      const agentId = stepToAgent[step.name] || step.name
      const hasSubsteps = effectiveAgentSubSteps[agentId]
      currentStatuses.set(step.name, step.status)

      // Priority 1: Running step with substeps
      if (step.status === 'running' && hasSubsteps) {
        activeAgentWithSubsteps = agentId
      }

      // Priority 2: Step that just transitioned to running or completed (for free-flight mode)
      // This catches fast-completing steps that the UI might miss
      if (hasSubsteps) {
        const lastStatus = lastStepStatusesRef.current.get(step.name)
        if (lastStatus !== step.status) {
          // Step status changed - this agent is active
          if (step.status === 'running' || step.status === 'completed') {
            recentlyActiveAgent = agentId
          }
        }
      }
    }

    // Update ref for next comparison
    lastStepStatusesRef.current = currentStatuses

    // Determine which agent to expand
    const agentToExpand = activeAgentWithSubsteps || recentlyActiveAgent

    if (agentToExpand) {
      // Auto-expand if not already expanded (don't override user's manual toggle)
      if (expandedSubStepsAgent !== agentToExpand) {
        setExpandedSubStepsAgent(agentToExpand)
        setAutoExpandedAgent(agentToExpand)
      }
    } else if (autoExpandedAgent) {
      // Collapse if we auto-expanded and agent is no longer active
      const wasAutoExpanded = expandedSubStepsAgent === autoExpandedAgent
      // Check if any step mapping to this agent is still running
      const agentStillRunning = effectiveSteps.some(s => {
        const stepAgentId = stepToAgent[s.name] || s.name
        return stepAgentId === autoExpandedAgent && s.status === 'running'
      })
      if (wasAutoExpanded && !agentStillRunning) {
        setExpandedSubStepsAgent(null)
        setAutoExpandedAgent(null)
      }
    }
  }, [isControlled, effectiveSteps, expandedSubStepsAgent, autoExpandedAgent, stepToAgent, effectiveAgentSubSteps, setExpandedSubStepsAgent])

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
    // Also build a map of agent ID to ring index for adjacency detection
    const agentRingIndex: Record<string, number> = {}
    const workerPositions = workerAgents.map((agent, i) => {
      agentRingIndex[agent.id] = i
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
      radius,
      agentRingIndex,
      workerCount: workerAgents.length,
    }
  }, [agents, orchestrator])

  // KG operator child agents that should aggregate to parent kg_operators
  const KG_OPERATOR_CHILDREN = [
    'context_convolution', 'entity_aggregation', 'node_embedding',
    'deduplication_operator', 'edge_prediction', 'structure_merge'
  ]

  // Build step status map and count steps per agent
  // CRITICAL: Use process.currentStep to determine running agent, not just step.status
  // This ensures graph stays in sync with sidebar when currentStep updates before step status
  const { stepStatusMap, stepCountMap, agentsInWorkflow } = useMemo(() => {
    const statusMap: Record<string, StepInfo> = {}
    const countMap: Record<string, number> = {}
    const agentSet = new Set<string>()

    // Determine the currently running agent from currentStep (source of truth for what's active)
    const currentStepAgentId = process.currentStep
      ? (stepToAgent[process.currentStep] || process.currentStep)
      : null

    // Use effectiveSteps (prefers event-driven state over polling-based)
    for (const step of effectiveSteps) {
      const agentId = stepToAgent[step.name] || step.name
      agentSet.add(agentId)
      countMap[agentId] = (countMap[agentId] || 0) + 1

      // Determine effective status: if this agent is for currentStep, force 'running'
      // This fixes lag where currentStep updates before step.status
      const stepEffectiveStatus = (currentStepAgentId === agentId && step.status === 'pending')
        ? 'running'
        : step.status

      // Keep most relevant status (running > completed > pending > failed)
      if (!statusMap[agentId] || stepEffectiveStatus === 'running' || (stepEffectiveStatus === 'completed' && statusMap[agentId].status !== 'running')) {
        statusMap[agentId] = { ...step, status: stepEffectiveStatus as StepInfo['status'] }
      }

      // Aggregate KG operator child status to parent kg_operators
      if (KG_OPERATOR_CHILDREN.includes(agentId)) {
        agentSet.add('kg_operators')
        countMap['kg_operators'] = (countMap['kg_operators'] || 0) + 1
        // Aggregate status: running > failed > completed > pending
        const existingStatus = statusMap['kg_operators']?.status
        if (!existingStatus ||
            stepEffectiveStatus === 'running' ||
            (stepEffectiveStatus === 'failed' && existingStatus !== 'running') ||
            (stepEffectiveStatus === 'completed' && existingStatus !== 'running' && existingStatus !== 'failed')) {
          statusMap['kg_operators'] = { ...step, name: 'kg_operators', status: stepEffectiveStatus as StepInfo['status'] }
        }
      }
    }

    // Also ensure currentStep's agent is marked as running even if no step found yet
    // This handles edge case where currentStep references a step not in steps[] array
    if (currentStepAgentId && !statusMap[currentStepAgentId]) {
      agentSet.add(currentStepAgentId)
      statusMap[currentStepAgentId] = {
        name: process.currentStep || currentStepAgentId,
        status: 'running',
      }
    }

    return { stepStatusMap: statusMap, stepCountMap: countMap, agentsInWorkflow: agentSet }
  }, [effectiveSteps, process.currentStep, stepToAgent])

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
    // Close expanded substeps if clicking a different agent
    if (expandedSubStepsAgent && expandedSubStepsAgent !== agentId) {
      setExpandedSubStepsAgent(null)
    }
    // Always clear substep selection when clicking any node (including same agent's main node)
    if (onSubStepSelect && selectedSubStepId) {
      onSubStepSelect(agentId, null)
    }
    handleNodeSelection?.(selectedNode === agentId ? null : agentId)
  }, [handleNodeSelection, selectedNode, expandedSubStepsAgent, onSubStepSelect, selectedSubStepId])

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

  // Check if two agents are adjacent in the circular ring layout
  const areAdjacentInRing = useCallback((fromId: string, toId: string): boolean => {
    const fromIdx = layout.agentRingIndex[fromId]
    const toIdx = layout.agentRingIndex[toId]
    // Both must be in outer ring (not orchestrator)
    if (fromIdx === undefined || toIdx === undefined) return false
    const diff = Math.abs(fromIdx - toIdx)
    // Adjacent if indices differ by 1, or wrap around (first and last)
    return diff === 1 || diff === layout.workerCount - 1
  }, [layout.agentRingIndex, layout.workerCount])

  // Render edge between two nodes
  // keyIdx: unique index for React key (array index)
  // displayOrdinal: number to display on dataflow edges (dataflow-specific count, or -1 to hide)
  const renderEdge = useCallback((edge: EdgeDefinition, keyIdx: number, isActiveControl: boolean = false, displayOrdinal: number = -1) => {
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
          key={keyIdx}
          d={path}
          fill="none"
          stroke={EDGE_COLORS[edge.type || 'dependency']}
          strokeWidth={1.5}
          strokeDasharray={edge.type === 'retry' ? '4,2' : undefined}
          opacity={0.6}
        />
      )
    }

    // Check if this is an adjacent dataflow edge that needs outer arc routing
    const isAdjacentDataflow = edge.type === 'dataflow' && areAdjacentInRing(edge.from, edge.to)

    // Active control line gets animated dash
    const isAnimated = isActiveControl && edge.type === 'control'
    const edgeColor = isAnimated ? '#6366f1' : EDGE_COLORS[edge.type || 'dependency']

    // For adjacent dataflow edges, draw a path that bulges outward
    // Path: from node outer edge → outward arc → to node outer edge
    if (isAdjacentDataflow) {
      // Calculate angles from center to each node
      const fromAngle = Math.atan2(fromPos.y - layout.centerY, fromPos.x - layout.centerX)
      const toAngle = Math.atan2(toPos.y - layout.centerY, toPos.x - layout.centerX)

      // Direction from layout center to each node (outward direction)
      const fromDirX = Math.cos(fromAngle)
      const fromDirY = Math.sin(fromAngle)

      // Find intersection with rectangle boundary (half-width/height from node center)
      const halfW = nodeWidth / 2
      const halfH = nodeHeight / 2

      // For a ray from node center in direction (dirX, dirY), find where it exits the rectangle
      const getRectEdge = (nodeX: number, nodeY: number, dirX: number, dirY: number) => {
        // Scale factor to reach rectangle edge
        const scaleX = dirX !== 0 ? halfW / Math.abs(dirX) : Infinity
        const scaleY = dirY !== 0 ? halfH / Math.abs(dirY) : Infinity
        const scale = Math.min(scaleX, scaleY)
        return {
          x: nodeX + dirX * scale,
          y: nodeY + dirY * scale
        }
      }

      // Start point: FROM node's outer edge (facing away from layout center)
      const startPoint = getRectEdge(fromPos.x, fromPos.y, fromDirX, fromDirY)

      // Outer radius for the arc bulge (beyond the nodes)
      const bulgeDistance = 40

      // Determine arc direction (clockwise or counter-clockwise based on angular distance)
      let angleDiff = toAngle - fromAngle
      // Normalize to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI

      // Midpoint angle for the arc apex
      const midAngle = fromAngle + angleDiff / 2

      // Calculate control point first (we need it to determine where curve arrives at TO node)
      // Control point is outward from the midpoint between the two nodes
      const nodeMidX = (fromPos.x + toPos.x) / 2
      const nodeMidY = (fromPos.y + toPos.y) / 2
      const ctrlX = nodeMidX + Math.cos(midAngle) * bulgeDistance
      const ctrlY = nodeMidY + Math.sin(midAngle) * bulgeDistance

      // End point: TO node's edge where the curve arrives FROM the control point
      // Direction from control point to TO node center
      const arriveDirX = toPos.x - ctrlX
      const arriveDirY = toPos.y - ctrlY
      const arriveLen = Math.sqrt(arriveDirX * arriveDirX + arriveDirY * arriveDirY)
      const normArriveX = arriveDirX / arriveLen
      const normArriveY = arriveDirY / arriveLen
      // Get the edge where the curve arrives (negative direction = edge facing the control point)
      const endPoint = getRectEdge(toPos.x, toPos.y, -normArriveX, -normArriveY)

      // Quadratic bezier: starts at node edge, bulges outward, ends at other node edge
      const pathD = `M ${startPoint.x} ${startPoint.y} Q ${ctrlX} ${ctrlY} ${endPoint.x} ${endPoint.y}`

      // Ordinal badge position on the curve (at t=0.5)
      const ordinalX = 0.25 * startPoint.x + 0.5 * ctrlX + 0.25 * endPoint.x
      const ordinalY = 0.25 * startPoint.y + 0.5 * ctrlY + 0.25 * endPoint.y

      return (
        <g key={keyIdx}>
          <path
            d={pathD}
            fill="none"
            stroke={edgeColor}
            strokeWidth={1.5}
            opacity={0.7}
            markerEnd="url(#arrowhead-dataflow)"
          />
          {/* Ordinal number badge on outer arc */}
          {displayOrdinal > 0 && (
            <g>
              <circle
                cx={ordinalX}
                cy={ordinalY}
                r={8}
                fill="white"
                stroke={edgeColor}
                strokeWidth={1.5}
              />
              <text
                x={ordinalX}
                y={ordinalY + 3}
                textAnchor="middle"
                fontSize="8"
                fontWeight="bold"
                fill={edgeColor}
              >
                {displayOrdinal}
              </text>
            </g>
          )}
        </g>
      )
    }

    // Standard edge rendering for non-adjacent edges
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

    // Calculate edge length and ensure minimum curve offset for short/adjacent edges
    const edgeLength = Math.sqrt(dx * dx + dy * dy)
    const minCurveOffset = 20 // Minimum perpendicular offset for visibility

    // Normalize perpendicular vector and apply minimum offset
    // Perpendicular to edge direction: rotate 90 degrees
    const perpLen = Math.sqrt((endY - startY) ** 2 + (endX - startX) ** 2)
    const normalizedPerpX = perpLen > 0 ? -(endY - startY) / perpLen : 0
    const normalizedPerpY = perpLen > 0 ? (endX - startX) / perpLen : 1

    // Use larger of: 10% of edge length OR minimum offset
    const curveOffset = Math.max(edgeLength * 0.1, minCurveOffset)
    const perpX = normalizedPerpX * curveOffset
    const perpY = normalizedPerpY * curveOffset

    // Control point for quadratic bezier
    const ctrlX = midX + perpX
    const ctrlY = midY + perpY
    const pathD = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`

    // Calculate ordinal badge position ON the bezier curve at t=0.5
    // Quadratic bezier: Q(t) = (1-t)²*P0 + 2*(1-t)*t*P1 + t²*P2
    // At t=0.5: Q = 0.25*start + 0.5*ctrl + 0.25*end
    const ordinalX = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX
    const ordinalY = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY

    return (
      <g key={keyIdx}>
        <path
          d={pathD}
          fill="none"
          stroke={edgeColor}
          strokeWidth={isAnimated ? 2.5 : edge.type === 'control' ? 1 : 1.5}
          strokeDasharray={edge.type === 'retry' ? '4,2' : edge.type === 'control' ? '4,4' : undefined}
          opacity={edge.type === 'control' && !isAnimated ? 0.3 : 0.7}
          markerEnd={isAnimated ? 'url(#arrowhead-active)' : edge.type === 'dataflow' ? 'url(#arrowhead-dataflow)' : 'url(#arrowhead)'}
          className={isAnimated ? 'animate-dash' : undefined}
          style={isAnimated ? { animation: 'dash 0.5s linear infinite' } : undefined}
        />
        {/* Ordinal number badge showing edge sequence - only for dataflow edges */}
        {edge.type === 'dataflow' && displayOrdinal > 0 && (
          <g>
            <circle
              cx={ordinalX}
              cy={ordinalY}
              r={8}
              fill="white"
              stroke={edgeColor}
              strokeWidth={1.5}
            />
            <text
              x={ordinalX}
              y={ordinalY + 3}
              textAnchor="middle"
              fontSize="8"
              fontWeight="bold"
              fill={edgeColor}
            >
              {displayOrdinal}
            </text>
          </g>
        )}
      </g>
    )
  }, [getPosition, nodeWidth, nodeHeight, areAdjacentInRing, layout.centerX, layout.centerY, layout.radius])

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

            {/* Step count badge - only shown for agents WITHOUT defined substeps */}
            {stepCount > 1 && !effectiveAgentSubSteps[agent.id] && (
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

            {/* LLM Mode badge - only for LLM-using agents */}
            {agent.usesLLM && (() => {
              const agentMode = llmState.perAgentOverrides[agent.id] || llmState.globalMode
              const hasOverride = agent.id in llmState.perAgentOverrides
              const badgeColors = {
                mock: { bg: 'fill-orange-500', letter: 'M' },
                local: { bg: 'fill-purple-500', letter: 'L' },
                public: { bg: 'fill-green-500', letter: 'P' },
              }
              const badge = badgeColors[agentMode] || badgeColors.public
              return (
                <g transform={`translate(${nodeWidth - 14}, ${nodeHeight - 14})`}>
                  <circle r={7} className={badge.bg} />
                  {hasOverride && (
                    <circle r={7} className="fill-none stroke-yellow-400" strokeWidth={2} />
                  )}
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[7px] fill-white font-bold"
                  >
                    {badge.letter}
                  </text>
                </g>
              )
            })()}

            {/* Sub-steps badge - blue circle showing count, click to expand AND select agent */}
            {effectiveAgentSubSteps[agent.id] && (
              <g
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation()
                  const isExpanded = expandedSubStepsAgent === agent.id
                  const isDifferentAgent = expandedSubStepsAgent && expandedSubStepsAgent !== agent.id
                  // Notify parent that substep is cleared (parent controls selectedSubStepId)
                  if (onSubStepSelect) {
                    onSubStepSelect(agent.id, null)
                  }
                  // If different agent's substeps are open, close them and open this one
                  // If same agent, toggle
                  if (isDifferentAgent) {
                    setExpandedSubStepsAgent(agent.id)
                  } else {
                    setExpandedSubStepsAgent(isExpanded ? null : agent.id)
                  }
                  // Also select the agent to show sidebar
                  handleNodeSelection?.(agent.id)
                }}
              >
                <circle
                  cx={8}
                  cy={8}
                  r={9}
                  fill={expandedSubStepsAgent === agent.id ? '#1d4ed8' : '#3b82f6'}
                  stroke="#fff"
                  strokeWidth={2}
                />
                <text
                  x={8}
                  y={11}
                  fontSize="9"
                  fill="#fff"
                  textAnchor="middle"
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {effectiveAgentSubSteps[agent.id].length}
                </text>
              </g>
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
  }, [getNodeStatus, getStepCount, selectedNode, wigglingNode, handleNodeClickInternal, handleNodeMouseEnter, handleNodeMouseLeave, nodeWidth, nodeHeight, expandedSubStepsAgent])

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
      className="relative bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border overflow-auto h-full"
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
          <marker
            id="arrowhead-dataflow"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#10b981" />
          </marker>
          {/* Gradient for rotating substep activity indicator */}
          <linearGradient id="substep-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.2" />
          </linearGradient>
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
          {(() => {
            // Filter visible edges and calculate dataflow-specific indices
            const visibleEdges = displayEdges.filter(edge => shouldShowEdge(edge))
            let dataflowIndex = 0
            return visibleEdges.map((edge, idx) => {
              // Check if this is the active control line to running agent
              const isActiveControl = edge.type === 'control' &&
                edge.from === 'orchestrator' &&
                edge.to === runningAgentId
              // Use dataflow-specific index for ordinal numbering (starts at 1 for first dataflow edge)
              const displayOrdinal = edge.type === 'dataflow' ? ++dataflowIndex : -1
              // Pass array index for unique key, and dataflow ordinal for display
              return renderEdge(edge, idx, isActiveControl, displayOrdinal)
            })
          })()}
        </g>

        {/* Render nodes */}
        <g className="nodes">
          {layout.positions.map(pos => renderNode(pos))}
        </g>

        {/* Render expanded sub-steps arc overlay (above all nodes for z-order) */}
        {/* DEBUG: Log arc rendering decision */}
        {(() => {
          Logger.info(LogCategories.UI, 'DEBUG: Arc rendering check', {
            expandedSubStepsAgent,
            hasSubstepsForAgent: !!effectiveAgentSubSteps[expandedSubStepsAgent || ''],
            substepsCount: effectiveAgentSubSteps[expandedSubStepsAgent || '']?.length || 0,
            effectiveAgentSubStepsKeys: Object.keys(effectiveAgentSubSteps),
            willRender: !!(expandedSubStepsAgent && effectiveAgentSubSteps[expandedSubStepsAgent]),
          })
          return null
        })()}
        {expandedSubStepsAgent && effectiveAgentSubSteps[expandedSubStepsAgent] && (
          <g className="substeps-arc-overlay">
            {(() => {
              const position = layout.positions.find(p => p.agent.id === expandedSubStepsAgent)
              if (!position) return null

              const { x, y } = position
              const substeps = effectiveAgentSubSteps[expandedSubStepsAgent]
              const centerX = x
              const centerY = y
              const innerRadius = Math.max(nodeWidth, nodeHeight) / 2 + 10
              const outerRadius = innerRadius + 22
              const arcSpacing = 5
              const totalArc = 300
              const startAngle = -150
              const arcPerStep = (totalArc - (substeps.length - 1) * arcSpacing) / substeps.length

              // Find ALL steps belonging to this agent and build per-substep status map
              // Uses effectiveSteps (prefers event-driven state over polling-based)
              const agentSteps = effectiveSteps.filter(s => {
                const stepAgentId = stepToAgent[s.name] || s.name
                return stepAgentId === expandedSubStepsAgent
              })
              const substepStatuses = new Map<string, string>()
              for (const step of agentSteps) {
                const substepId = effectiveStepToSubStep[step.name]
                if (substepId) {
                  substepStatuses.set(substepId, step.status)
                }
              }

              // FALLBACK: Infer substep statuses from currentStep when polling data lacks substep detail
              // This handles the case where effectiveSteps doesn't have individual substep statuses
              const currentStepSubstepId = process.currentStep ? effectiveStepToSubStep[process.currentStep] : null
              const currentStepAgentId = process.currentStep ? (stepToAgent[process.currentStep] || process.currentStep) : null
              const substepOrder = substeps.map(s => s.id)  // e.g., ['conv', 'aggr', 'embed', 'dedup', 'pred', 'merge']

              // Check if this agent's parent step is already completed
              // e.g., if 'generate_batch_observations' has status 'completed', all observation_generation substeps are done
              const agentParentStepCompleted = effectiveSteps.some(step => {
                const stepAgent = stepToAgent[step.name] || step.name
                // Check if this is a parent step (not a substep) for this agent AND it's completed
                const isParentStep = stepAgent === expandedSubStepsAgent && !effectiveStepToSubStep[step.name]
                return isParentStep && step.status === 'completed'
              })

              if (agentParentStepCompleted) {
                // Agent's parent step completed - mark ALL substeps as completed
                substepOrder.forEach(substepId => {
                  substepStatuses.set(substepId, 'completed')
                })
              } else if (currentStepAgentId === expandedSubStepsAgent && currentStepSubstepId) {
                // We're currently running a substep of this agent - infer completion from position
                const currentIdx = substepOrder.indexOf(currentStepSubstepId)

                if (currentIdx >= 0) {
                  // Mark substeps before current as completed, current as running, after as pending
                  substepOrder.forEach((substepId, idx) => {
                    if (idx < currentIdx) {
                      substepStatuses.set(substepId, 'completed')
                    } else if (idx === currentIdx) {
                      substepStatuses.set(substepId, 'running')
                    } else {
                      substepStatuses.set(substepId, 'pending')
                    }
                  })
                }
              }
              // DEBUG: Log substep status computation
              Logger.debug(LogCategories.UI, '[SUBSTEP-DEBUG] agentSteps:', agentSteps.map(s => ({ name: s.name, status: s.status })))
              Logger.debug(LogCategories.UI, '[SUBSTEP-DEBUG] substepStatuses:', Object.fromEntries(substepStatuses))
              const isAgentRunning = agentSteps.some(s => s.status === 'running')
              // Agent is fully completed only if ALL its substeps are done (no running ones left)
              const isAgentCompleted = !isAgentRunning && agentSteps.length > 0 &&
                agentSteps.every(s => s.status === 'completed' || s.status === 'skipped')

              return substeps.map((substep, idx) => {
                const angleStart = startAngle + idx * (arcPerStep + arcSpacing)
                const angleEnd = angleStart + arcPerStep
                const startRad = (angleStart * Math.PI) / 180
                const endRad = (angleEnd * Math.PI) / 180

                const x1 = centerX + innerRadius * Math.cos(startRad)
                const y1 = centerY + innerRadius * Math.sin(startRad)
                const x2 = centerX + outerRadius * Math.cos(startRad)
                const y2 = centerY + outerRadius * Math.sin(startRad)
                const x3 = centerX + outerRadius * Math.cos(endRad)
                const y3 = centerY + outerRadius * Math.sin(endRad)
                const x4 = centerX + innerRadius * Math.cos(endRad)
                const y4 = centerY + innerRadius * Math.sin(endRad)
                const largeArc = arcPerStep > 180 ? 1 : 0

                const arcPath = `M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x1} ${y1} Z`

                const midAngle = ((angleStart + angleEnd) / 2 * Math.PI) / 180
                const labelRadius = (innerRadius + outerRadius) / 2
                const labelX = centerX + labelRadius * Math.cos(midAngle)
                const labelY = centerY + labelRadius * Math.sin(midAngle)

                const isSelected = selectedSubStepId === substep.id
                // Per-substep status from runtime data
                const substepStatus = substepStatuses.get(substep.id)

                const isSubstepCompleted = substepStatus === 'completed' || substepStatus === 'skipped'
                const isActiveSubStep = substepStatus === 'running'
                const isPending = !substepStatus || substepStatus === 'pending'
                // Determine visual state: completed (green), active (dark blue), pending (light blue)
                const isHighlighted = isSelected || isActiveSubStep || isSubstepCompleted || isAgentCompleted

                // Colors based on per-substep state:
                // - Completed: green (#22c55e)
                // - Active/Running: dark blue (#1d4ed8) with glow
                // - Pending (not yet started): light blue (#93c5fd)
                let fillColor = '#93c5fd'  // light blue for pending (default)
                let strokeColor = '#60a5fa'  // blue-400 stroke for pending
                if (isSubstepCompleted || isAgentCompleted) {
                  fillColor = '#22c55e'  // green-500
                  strokeColor = '#16a34a'  // green-600
                } else if (isActiveSubStep) {
                  fillColor = '#1d4ed8'  // dark blue-700 for active
                  strokeColor = '#fff'
                } else if (isSelected && isPending) {
                  fillColor = '#60a5fa'  // blue-400 for selected pending
                  strokeColor = '#3b82f6'
                }

                const statusText = isSubstepCompleted || isAgentCompleted ? ' (Completed)' : isActiveSubStep ? ' (Currently Running)' : ' (Pending)'

                return (
                  <g
                    key={substep.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      // Notify parent of substep selection (parent controls selectedSubStepId)
                      if (onSubStepSelect && expandedSubStepsAgent) {
                        onSubStepSelect(expandedSubStepsAgent, substep)
                      }
                    }}
                  >
                    <title>{substep.name}: {substep.description}{statusText}</title>
                    <path
                      d={arcPath}
                      fill={fillColor}
                      fillOpacity={isPending && !isSelected ? 0.7 : 1}
                      stroke={strokeColor}
                      strokeWidth={isActiveSubStep ? 3 : isSubstepCompleted ? 2 : 1.5}
                      className={isActiveSubStep ? 'animate-pulse' : ''}
                      style={isActiveSubStep ? {
                        filter: 'drop-shadow(0 0 10px rgba(29, 78, 216, 0.9))',
                      } : isSubstepCompleted ? {
                        filter: 'drop-shadow(0 0 4px rgba(34, 197, 94, 0.5))',
                      } : undefined}
                    />
                    <text
                      x={labelX}
                      y={labelY}
                      fontSize={isHighlighted ? '9' : '8'}
                      fill="#fff"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontWeight="700"
                      style={{ pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
                    >
                      {substep.shortName}
                    </text>
                  </g>
                )
              })
            })()}
            {/* Rotating activity indicator when agent is running */}
            {(() => {
              const position = layout.positions.find(p => p.agent.id === expandedSubStepsAgent)
              if (!position) return null
              // Use effectiveSteps (prefers event-driven state over polling-based)
              const isAgentRunning = effectiveSteps.some(s => {
                const stepAgentId = stepToAgent[s.name] || s.name
                return stepAgentId === expandedSubStepsAgent && s.status === 'running'
              })
              if (!isAgentRunning) return null

              const { x, y } = position
              const indicatorRadius = Math.max(nodeWidth, nodeHeight) / 2 + 38
              return (
                <circle
                  cx={x}
                  cy={y}
                  r={indicatorRadius}
                  fill="none"
                  stroke="url(#substep-gradient)"
                  strokeWidth={3}
                  strokeDasharray="20 60"
                  strokeLinecap="round"
                  className="animate-spin"
                  style={{ animationDuration: '3s', transformOrigin: `${x}px ${y}px` }}
                />
              )
            })()}
          </g>
        )}

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
