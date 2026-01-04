'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import type { AggregatedSteps } from '@/store/slices/ukbSlice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  RefreshCw,
  Play,
  StopCircle,
  Calendar,
  Network,
  Save,
  RotateCcw,
} from 'lucide-react'

// Utility: Format duration in milliseconds to human readable format
const formatDurationMs = (ms?: number): string => {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
}

// Orchestrator node - represents the coordinator that manages all agents
const ORCHESTRATOR_NODE = {
  id: 'orchestrator',
  name: 'Orchestrator',
  shortName: 'Coordinator',
  icon: Play,
  description: 'Multi-agent workflow coordinator. Manages parallel execution with max 3 concurrent steps, handles dependencies, retries failed steps, and aggregates results.',
  usesLLM: false,
  llmModel: null,
  techStack: 'Multi-Agent Orchestrator',
  row: -1,  // Above all other nodes
  col: 0.6,  // Centered (aligned with single-agent column)
}

// Agent definitions for the workflow (15 original + 3 batch processing = 18 agents)
// LLM info verified via Serena analysis of mcp-server-semantic-analysis
// Priority: Groq > Gemini > Anthropic > OpenAI (auto-fallback based on API key availability)
// Grid layout: row/col positions reflect actual workflow structures
// - Complete/Incremental: 4 parallel entry points at row 0
// - Batch: Batch Scheduler at row 0 col 2.5 (far right), then sequential flow with loop-back
const WORKFLOW_AGENTS = [
  // --- Batch Processing Agents ---
  {
    id: 'batch_scheduler',
    name: 'Batch Scheduler',
    shortName: 'Batch',
    icon: Calendar,
    description: 'Plans and tracks chronological batch windows. Divides git history into 50-commit batches for incremental processing with checkpoint-based resumption.',
    usesLLM: false,
    llmModel: null,
    techStack: 'Git CLI + Checkpoint Manager',
    row: 0,    // Same row as extraction agents but different column
    col: 2.5,  // Far right to avoid overlap with Git/Vibe/Code
  },
  {
    id: 'kg_operators',
    name: 'KG Operators',
    shortName: 'KG-Ops',
    icon: Network,
    description: 'Tree-KG inspired operators for incremental knowledge graph expansion. Implements conv, aggr, embed, dedup, pred, merge operators per batch.',
    usesLLM: true,
    llmModel: 'Multi-tier: fast/standard/premium per operator',
    techStack: 'SemanticAnalyzer + Embeddings',
    row: 3,      // After ontology (row 2), before QA (row 4)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'batch_checkpoint_manager',
    name: 'Batch Checkpoint',
    shortName: 'Checkpoint',
    icon: Save,
    description: 'Per-batch checkpoint state management. Tracks completed batches, operator results, and supports resumption from any batch. Loops back to Git for next batch.',
    usesLLM: false,
    llmModel: null,
    techStack: 'JSON file persistence',
    row: 5,      // After QA (row 4), before Code Graph finalization (row 6)
    col: 0.6,    // Centered in main flow column
  },
  // --- Original Agents ---
  {
    id: 'git_history',
    name: 'Git History',
    shortName: 'Git',
    icon: GitBranch,
    description: 'Analyzes commit history via git CLI with LLM-powered pattern extraction. Identifies code evolution patterns, development themes, architectural decisions, and technical debt from commit messages and file changes.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Git CLI + SemanticAnalyzer',
    row: 0,
    col: 0,
  },
  {
    id: 'vibe_history',
    name: 'Vibe History',
    shortName: 'Vibe',
    icon: MessageSquare,
    description: 'Uses LLM semantic analysis to extract key development topics, task/solution pairs, and workflow patterns from human-AI conversation sessions.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 0,
    col: 0.75,
  },
  {
    id: 'code_graph',
    name: 'Code Graph',
    shortName: 'Code',
    icon: Code,
    description: 'Builds AST-based knowledge graph using Tree-sitter parsing. Uses external LLM (via code-graph-rag MCP) for Cypher query generation and RAG orchestration. Indexes functions, classes, imports, and call relationships into Memgraph. Runs in FINALIZATION phase after all batches complete to avoid temporal mismatch.',
    usesLLM: true,
    llmModel: 'External: code-graph-rag (OpenAI/Anthropic/Ollama)',
    techStack: 'Tree-sitter + Memgraph + pydantic_ai',
    row: 6,      // FINALIZATION: After checkpoint (row 5), before persistence (row 7)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'code_intelligence',
    name: 'Code Intelligence',
    shortName: 'Intel',
    icon: Zap,
    description: 'Generates context-aware questions about the codebase based on git changes, commit themes, and session patterns. Queries the code graph via NL→Cypher to discover hotspots, circular dependencies, inheritance structures, and change impact.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'NL→Cypher + Memgraph + SemanticAnalyzer',
    row: 1,
    col: 1.5,
  },
  {
    id: 'documentation_linker',
    name: 'Documentation Linker',
    shortName: 'Docs',
    icon: FileText,
    description: 'Links markdown docs and PlantUML diagrams to code entities. Uses LLM-powered semantic matching to resolve unresolved references and build intelligent doc-to-code mappings.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Regex + glob patterns + SemanticAnalyzer',
    row: 0,
    col: 2.25,
  },
  {
    id: 'semantic_analysis',
    name: 'Semantic Analysis',
    shortName: 'Semantic',
    icon: Brain,
    description: 'Deep code analysis to detect patterns (MVC, Factory, Observer, etc.), assess quality metrics, identify anti-patterns, and generate LLM-powered insights on architecture.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Direct LLM clients',
    row: 1,
    col: 0.375,
  },
  {
    id: 'web_search',
    name: 'Web Search',
    shortName: 'Web',
    icon: Search,
    description: 'Searches for similar patterns, code examples, and documentation using DuckDuckGo/Google. Optional LLM-powered result summarization and intelligent ranking of top results.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile (optional)',
    techStack: 'DuckDuckGo/Google APIs + SemanticAnalyzer',
    row: 2,
    col: 0.375,
  },
  {
    id: 'insight_generation',
    name: 'Insight Generation',
    shortName: 'Insights',
    icon: Lightbulb,
    description: 'Generates comprehensive insights, PlantUML architecture diagrams, design pattern documentation, and knowledge synthesis from analysis results.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 8,      // FINALIZATION: After persistence (row 7)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'observation_generation',
    name: 'Observation Generation',
    shortName: 'Observations',
    icon: Eye,
    description: 'Creates structured observations for entities: pattern observations, problem-solution pairs, architectural decisions, and contextual metadata.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 8.5,    // After insight (row 8) - used in incremental workflow
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'ontology_classification',
    name: 'Ontology Classification',
    shortName: 'Ontology',
    icon: Tags,
    description: 'Maps entities to ontology classes (upper/lower) using LLM-powered semantic inference. Assigns categories, properties, and confidence scores with intelligent taxonomy alignment.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'OntologyClassifier + SemanticAnalyzer',
    row: 2,      // After semantic (row 1), before KG-Ops (row 3)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'documentation_semantics',
    name: 'Documentation Semantics',
    shortName: 'DocSem',
    icon: FileText,
    description: 'LLM-powered semantic analysis of docstrings and documentation prose. Extracts purpose, parameters, usage patterns, warnings, and related entities from code documentation.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer + Batch Processing',
    row: 5.5,    // Parallel to QA (row 5), feeds into checkpoint
    col: 1.875,  // Offset right to show parallel processing
  },
  {
    id: 'quality_assurance',
    name: 'Quality Assurance',
    shortName: 'QA',
    icon: Shield,
    description: 'Validates insights, PlantUML syntax, entity coherence. NEW: LLM-powered semantic value filtering removes low-value entities. Quality-based feedback loops (up to 3 iterations) with progressive parameter tightening.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer + Semantic Value Filter',
    row: 4,      // After KG-Ops (row 3), before Checkpoint (row 5)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'persistence',
    name: 'Persistence',
    shortName: 'Persist',
    icon: Database,
    description: 'Manages entity CRUD operations, checkpoint tracking, and bi-temporal staleness detection. Writes entities with ontology metadata to LevelDB graph storage.',
    usesLLM: false,
    llmModel: null,
    techStack: 'LevelDB + Graphology',
    row: 7,      // After code_graph (row 6)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'deduplication',
    name: 'Deduplication',
    shortName: 'Dedup',
    icon: Copy,
    description: 'Detects duplicate entities using cosine/semantic similarity on embeddings. Merges similar entities, removes duplicate observations, and consolidates patterns. Uses OpenAI embeddings API (not generative LLM).',
    usesLLM: false,
    llmModel: 'Embeddings: text-embedding-3-small',
    techStack: 'OpenAI Embeddings API',
    row: 9,      // After insight (row 8)
    col: 0.6,    // Centered in main flow column
  },
  {
    id: 'content_validation',
    name: 'Content Validation',
    shortName: 'Validate',
    icon: CheckCircle2,
    description: 'Validates entity accuracy against current codebase. Detects git-based staleness, verifies file/command references, and regenerates stale entity content.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 10,     // Final step after deduplication (row 9)
    col: 0.6,    // Centered in main flow column
  },
]

// Step name to agent ID mapping
const STEP_TO_AGENT: Record<string, string> = {
  // Batch workflow steps
  'plan_batches': 'batch_scheduler',
  'extract_batch_commits': 'git_history',
  'extract_batch_sessions': 'vibe_history',
  'batch_semantic_analysis': 'semantic_analysis',
  'operator_conv': 'kg_operators',
  'operator_aggr': 'kg_operators',
  'operator_embed': 'kg_operators',
  'operator_dedup': 'kg_operators',
  'operator_pred': 'kg_operators',
  'operator_merge': 'kg_operators',
  'batch_qa': 'quality_assurance',
  'save_batch_checkpoint': 'batch_checkpoint_manager',
  'final_persist': 'persistence',
  'final_dedup': 'deduplication',
  'final_validation': 'content_validation',

  // Complete/Incremental workflow steps
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
  'query_code_intelligence': 'code_intelligence',
  'link_documentation': 'documentation_linker',
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
}

// Edge definitions showing data flow between agents
// IMPORTANT: Must match actual workflow dependencies in batch-analysis.yaml
//
// ARCHITECTURE (batch-analysis v1.2):
// - BATCH LOOP: git_history, vibe_history → semantic_analysis → KG operators → checkpoint
// - FINALIZATION: After all batches, code_graph indexes current HEAD, correlates with historical findings
// - This avoids temporal mismatch between old commits and current codebase state
//
// Edge types: 'dependency' (solid) = must complete before next, 'dataflow' (dashed) = passes data/parameters
// 'control' (amber dashed) = feedback/retry loops from agents back to orchestrator
const WORKFLOW_EDGES: Array<{ from: string; to: string; type?: 'dependency' | 'dataflow' | 'control'; label?: string }> = [
  // ========== INITIALIZATION ==========
  // Orchestrator dispatches to batch scheduler (batch workflow) or entry points (complete workflow)
  { from: 'orchestrator', to: 'git_history', type: 'dataflow' },
  { from: 'orchestrator', to: 'vibe_history', type: 'dataflow' },
  { from: 'orchestrator', to: 'documentation_linker', type: 'dataflow' },
  // NOTE: code_graph is NOT in initialization - it runs in FINALIZATION

  // ========== BATCH LOOP (no code_graph here) ==========
  // Phase 1 -> Code Intelligence: Git and Vibe feed intelligent queries
  { from: 'git_history', to: 'code_intelligence' },
  { from: 'vibe_history', to: 'code_intelligence' },

  // Phase 1 + Code Intel -> Phase 2: Sources + intelligence feed Semantic Analysis
  // NOTE: code_graph removed - semantic analysis is pure historical in batch loop
  { from: 'git_history', to: 'semantic_analysis' },
  { from: 'vibe_history', to: 'semantic_analysis' },
  { from: 'code_intelligence', to: 'semantic_analysis' },
  { from: 'documentation_linker', to: 'semantic_analysis' },

  // Phase 2 -> Phase 3: Semantic feeds Web Search
  { from: 'semantic_analysis', to: 'web_search' },

  // Phase 3 -> Phase 4: Semantic + Web + Code Intel feed Insights
  { from: 'semantic_analysis', to: 'insight_generation' },
  { from: 'web_search', to: 'insight_generation' },
  { from: 'code_intelligence', to: 'insight_generation' },

  // Phase 4 -> Phase 5: Insights -> Observations
  { from: 'insight_generation', to: 'observation_generation' },

  // Phase 5 -> Phase 6: Observations -> Ontology Classification
  { from: 'observation_generation', to: 'ontology_classification' },

  // Documentation Semantics - runs during batch but doesn't need code_graph
  { from: 'documentation_linker', to: 'documentation_semantics' },

  // Phase 6 + Doc Semantics -> Phase 7: All feed QA
  { from: 'ontology_classification', to: 'quality_assurance' },
  { from: 'documentation_semantics', to: 'quality_assurance' },

  // ========== QA RETRY LOOPS ==========
  // QA can send entities back for regeneration (up to 3 iterations)
  { from: 'quality_assurance', to: 'insight_generation', type: 'control', label: 'retry' },
  { from: 'quality_assurance', to: 'observation_generation', type: 'control', label: 'retry' },

  // ========== FINALIZATION (after ALL batches) ==========
  // QA -> Batch Checkpoint (end of batch loop)
  { from: 'quality_assurance', to: 'batch_checkpoint_manager' },

  // After all batches: Checkpoint triggers CGR indexing of CURRENT codebase
  { from: 'batch_checkpoint_manager', to: 'code_graph' },

  // CGR indexes current HEAD, synthesizes insights, correlates with historical entities
  // Then code_graph feeds persistence with enriched + historical entities
  { from: 'code_graph', to: 'persistence' },

  // Also feed accumulated batch entities to persistence
  { from: 'batch_checkpoint_manager', to: 'persistence', type: 'dataflow' },

  // Phase 8 -> Phase 9: Persistence -> Deduplication
  { from: 'persistence', to: 'deduplication' },

  // Phase 9 -> Phase 10: Deduplication -> Content Validation
  { from: 'deduplication', to: 'content_validation' },
]

// Icon mapping for dynamic agent definitions from YAML
const ICON_MAP: Record<string, typeof GitBranch> = {
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
  Zap,
  Play,
  Calendar,    // Batch Scheduler
  Network,     // KG Operators
  Save,        // Batch Checkpoint Manager
  RotateCcw,   // Loop indicator
}

// Types for API response
interface AgentDefinitionAPI {
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

interface EdgeDefinitionAPI {
  from: string
  to: string
  type?: 'dependency' | 'dataflow' | 'control'
  label?: string
}

interface WorkflowDefinitionsAPI {
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

// Hook to fetch workflow definitions from API
function useWorkflowDefinitions(workflowName?: string) {
  const [agents, setAgents] = useState(WORKFLOW_AGENTS)
  const [orchestrator, setOrchestrator] = useState(ORCHESTRATOR_NODE)
  const [edges, setEdges] = useState(WORKFLOW_EDGES)
  const [stepToAgent, setStepToAgent] = useState(STEP_TO_AGENT)
  const [allWorkflows, setAllWorkflows] = useState<Array<{ name: string; edges: EdgeDefinitionAPI[] }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDefinitions() {
      try {
        // Try to get API port from environment or use default
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
            icon: ICON_MAP[agent.icon] || Code,
          }))
          setAgents(transformedAgents as any)

          // Transform orchestrator
          setOrchestrator({
            ...data.data.orchestrator,
            icon: ICON_MAP[data.data.orchestrator.icon] || Play,
          } as any)

          // Update step mappings
          setStepToAgent(data.data.stepMappings)

          // Store all workflows for later selection
          setAllWorkflows(data.data.workflows.map(w => ({ name: w.name, edges: w.edges })))

          console.log('✅ Loaded workflow definitions from API (Single Source of Truth)')
        }
      } catch (err) {
        console.warn('⚠️ Failed to fetch workflow definitions, using fallback:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        // Keep using the hardcoded defaults
      } finally {
        setIsLoading(false)
      }
    }

    fetchDefinitions()
  }, [])

  // Select edges based on the workflow name
  // Workflow names may include batch IDs (e.g., "batch-analysis-batch-123456")
  // so we need to match by prefix or extract base name
  useEffect(() => {
    if (allWorkflows.length > 0 && workflowName) {
      // Extract base workflow name (remove batch ID suffix like "-batch-123456")
      const baseWorkflowName = workflowName.replace(/-batch-\d+$/, '')

      // Try exact match first, then prefix match
      let workflow = allWorkflows.find(w => w.name === workflowName)
      if (!workflow) {
        workflow = allWorkflows.find(w => w.name === baseWorkflowName)
      }
      if (!workflow) {
        workflow = allWorkflows.find(w => workflowName.startsWith(w.name))
      }

      if (workflow?.edges) {
        setEdges(workflow.edges)
        console.log(`✅ Loaded edges for workflow: ${workflowName} (matched: ${workflow.name})`)
      } else {
        // Fallback to incremental-analysis if workflow not found
        const fallback = allWorkflows.find(w => w.name === 'incremental-analysis')
        if (fallback?.edges) {
          setEdges(fallback.edges)
          console.warn(`⚠️ Workflow '${workflowName}' not found, using incremental-analysis edges`)
        }
      }
    }
  }, [allWorkflows, workflowName])

  return { agents, orchestrator, edges, stepToAgent, isLoading, error }
}

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
  _refreshKey?: string  // Server-generated key to force UI updates
  health: 'healthy' | 'stale' | 'frozen' | 'dead'
  progressPercent: number
  steps?: StepInfo[]
  batchProgress?: {
    currentBatch: number
    totalBatches: number
    batchId?: string
  }
  // Multi-agent orchestration data from SmartOrchestrator
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

interface UKBWorkflowGraphProps {
  process: ProcessInfo
  onNodeClick?: (agentId: string) => void
  selectedNode?: string | null
}

/**
 * Generates a semantic summary of step results based on the agent type.
 * Shows meaningful, human-readable descriptions of what the step produced.
 * Returns appropriate messages for steps that haven't run yet.
 */
function StepResultSummary({ agentId, outputs, aggregatedSteps, status }: {
  agentId: string;
  outputs: Record<string, any>;
  aggregatedSteps?: AggregatedSteps | null;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}) {
  const getSummary = (): string | null => {
    // Handle non-completed states with informative messages
    if (status === 'pending') {
      return '⏳ Waiting to run (depends on prior steps completing)'
    }
    if (status === 'running') {
      return '🔄 Currently processing...'
    }
    if (status === 'skipped') {
      return '⏭️ Skipped (not required for this workflow)'
    }
    if (status === 'failed') {
      return '❌ Step failed - check error details above'
    }

    // Check if outputs only contains metadata fields (no actual results)
    const metadataOnlyFields = ['fieldsPresent', 'totalFields', 'result', 'batchId']
    const meaningfulFields = Object.keys(outputs || {}).filter(
      k => !k.startsWith('_') && !metadataOnlyFields.includes(k)
    )

    // If no meaningful data and step hasn't completed, show waiting message
    if (meaningfulFields.length === 0 && status !== 'completed') {
      return '⏳ Results pending...'
    }

    // If completed but only metadata fields, show completion status
    if (meaningfulFields.length === 0 && status === 'completed') {
      return '✅ Step completed (detailed metrics not available)'
    }

    // For historical workflows, prefer aggregated totals across all batches
    // This provides accurate "final" numbers rather than just batch-001 data
    if (aggregatedSteps) {
      switch (agentId) {
        case 'git_history':
          if (aggregatedSteps.git_history) {
            const { totalCommits, batchesProcessed } = aggregatedSteps.git_history
            return `📊 Total: ${totalCommits.toLocaleString()} commits (across ${batchesProcessed} batches)`
          }
          break
        case 'vibe_history':
          if (aggregatedSteps.vibe_history) {
            const { totalSessions, batchesWithSessions, batchesProcessed } = aggregatedSteps.vibe_history
            const sessionInfo = batchesWithSessions < batchesProcessed
              ? ` (${batchesWithSessions}/${batchesProcessed} batches had sessions)`
              : ` (across ${batchesProcessed} batches)`
            return `📊 Total: ${totalSessions.toLocaleString()} sessions${sessionInfo}`
          }
          break
        case 'semantic_analysis':
          if (aggregatedSteps.semantic_analysis) {
            const { totalEntities, totalRelations, batchesProcessed } = aggregatedSteps.semantic_analysis
            return `📊 Total: ${totalEntities.toLocaleString()} entities, ${totalRelations.toLocaleString()} relations (across ${batchesProcessed} batches)`
          }
          break
        case 'kg_operators':
          if (aggregatedSteps.kg_operators) {
            const { totalProcessed, totalMerged, totalEdgesAdded, totalEmbedded, totalCoreEntities, batchesProcessed } = aggregatedSteps.kg_operators
            const parts = []
            if (totalProcessed > 0) parts.push(`${totalProcessed.toLocaleString()} converted`)
            if (totalEmbedded > 0) parts.push(`${totalEmbedded.toLocaleString()} embedded`)
            if (totalMerged > 0) parts.push(`${totalMerged.toLocaleString()} deduped`)
            if (totalEdgesAdded > 0) parts.push(`${totalEdgesAdded.toLocaleString()} edges predicted`)
            const summary = parts.length > 0 ? parts.join(', ') : 'pipeline completed'
            return `📊 Tree-KG: ${summary} (${batchesProcessed} batches)`
          }
          break
        case 'deduplication':
          if (aggregatedSteps.kg_operators) {
            const { totalMerged } = aggregatedSteps.kg_operators
            return `📊 Total: ${totalMerged.toLocaleString()} duplicate entities merged`
          }
          break
        case 'quality_assurance':
          if (aggregatedSteps.kg_operators) {
            const { totalProcessed, batchesProcessed } = aggregatedSteps.kg_operators
            return `📊 QA validated ${totalProcessed.toLocaleString()} entities across ${batchesProcessed} batches`
          }
          break
        case 'persistence':
          if (aggregatedSteps.kg_operators) {
            const { totalProcessed, totalEdgesAdded } = aggregatedSteps.kg_operators
            return `📊 Total: ${totalProcessed.toLocaleString()} entities, ${totalEdgesAdded.toLocaleString()} edges persisted`
          }
          break
        case 'content_validation':
          if (aggregatedSteps.content_validation) {
            const { entitiesValidated, relationsValidated } = aggregatedSteps.content_validation
            return `📊 Validated ${entitiesValidated} entities and ${relationsValidated} relations against codebase`
          }
          break
      }
    }

    // Fallback to per-step outputs (for active workflows or if no aggregated data)
    switch (agentId) {
      case 'git_history':
        // Check all possible property names: commitsCount (coordinator summary), commitsAnalyzed (agent), commits array
        const commits = outputs.commitsCount || outputs.commitsAnalyzed || outputs.commits?.length || 0
        const files = outputs.filesCount || outputs.filesAnalyzed || outputs.files?.length || 0
        return `Analyzed ${commits} commits affecting ${files} files`

      case 'vibe_history':
        // Check all possible property names: sessionsCount (coordinator summary), sessionsAnalyzed (agent), sessions array
        const sessions = outputs.sessionsCount || outputs.sessionsAnalyzed || outputs.sessions?.length || 0
        // LLM-extracted task/solution pairs (new semantic analysis)
        const taskSolutions = outputs.problemSolutionPairsCount || outputs.problemSolutionPairs?.length || 0
        // LLM-extracted key topics (semantic analysis)
        const keyTopics = outputs.keyTopicsCount || outputs.keyTopics?.length || 0
        // Build result string with both metrics
        const vibeParts = [`Processed ${sessions} sessions`]
        if (taskSolutions > 0) vibeParts.push(`${taskSolutions} task/solutions`)
        if (keyTopics > 0) vibeParts.push(`${keyTopics} key topics`)
        if (taskSolutions === 0 && keyTopics === 0 && sessions > 0) vibeParts.push('analyzing...')
        return vibeParts.join(', ')

      case 'semantic_analysis':
        // Check for batch workflow format (from summarizeStepResult): { batchEntities, batchRelations, batchId }
        const batchEntities = outputs.batchEntities || outputs.result?.entities || 0
        const batchRelations = outputs.batchRelations || outputs.result?.relations || 0
        if (batchEntities > 0 || batchRelations > 0) {
          return `Processed ${batchEntities} entities, ${batchRelations} relations`
        }

        // Legacy format checks
        const keyPatterns = outputs.keyPatternsCount || outputs.patternsFound || outputs.patterns?.length || 0
        const learnings = outputs.learningsCount || 0
        const archDecisions = outputs.architecturalDecisionsCount || 0
        const semConfidence = outputs.confidence ? `${Math.round(outputs.confidence * 100)}%` : ''
        const filesAnalyzed = outputs.filesAnalyzed || 0
        const totalSemantic = keyPatterns + learnings + archDecisions
        if (totalSemantic > 0) {
          const confStr = semConfidence ? ` (${semConfidence} confidence)` : ''
          return `Found ${keyPatterns} patterns, ${learnings} learnings, ${archDecisions} arch decisions${confStr}`
        }
        if (filesAnalyzed > 0) {
          return `Semantic analysis completed (${filesAnalyzed} files analyzed)`
        }
        // No meaningful data - will be handled by metadata check in getSummary
        return null

      case 'insight_generation':
        const patternCount = outputs.patterns?.length || outputs.patternsGenerated || 0
        const diagrams = outputs.diagramsGenerated || outputs.diagrams?.length || 0
        return `Generated ${patternCount} patterns and ${diagrams} architecture diagrams`

      case 'observation_generation':
        // Check all possible property names: entitiesCount (summary), entitiesCreated (agent)
        const entities = outputs.entitiesCount || outputs.entitiesCreated || outputs.entities?.length || 0
        // Check all possible property names: observationsCount (summary), observationsCreated (agent)
        const observations = outputs.observationsCount || outputs.observationsCreated || outputs.totalObservations || 0
        const filtered = outputs.filteredBySemanticValue || 0
        return filtered > 0
          ? `Created ${entities} entities (${filtered} low-value removed), ${observations} observations`
          : `Created ${entities} entities with ${observations} observations`

      case 'kg_operators':
        // Tree-KG operators: conv, aggr, embed, dedup, pred, merge
        const kgConv = outputs.conv?.processed || outputs.entitiesProcessed || 0
        const kgEmbed = outputs.embed?.embedded || outputs.entitiesEmbedded || 0
        const kgDedup = outputs.dedup?.merged || outputs.mergedCount || 0
        const kgPred = outputs.pred?.edgesAdded || outputs.edgesAdded || 0
        const kgMerge = outputs.merge?.entitiesAdded || outputs.entitiesAdded || 0
        const kgParts = []
        if (kgConv > 0) kgParts.push(`${kgConv} converted`)
        if (kgEmbed > 0) kgParts.push(`${kgEmbed} embedded`)
        if (kgDedup > 0) kgParts.push(`${kgDedup} deduped`)
        if (kgPred > 0) kgParts.push(`${kgPred} edges`)
        if (kgMerge > 0) kgParts.push(`${kgMerge} merged`)
        return kgParts.length > 0
          ? `Tree-KG ops: ${kgParts.join(', ')}`
          : `Tree-KG pipeline completed`

      case 'quality_assurance':
        // Check for batch workflow format (from summarizeStepResult): { validated, entitiesCreated, relationsAdded, ... }
        if (outputs.validated !== undefined) {
          const entities = outputs.entitiesCreated || 0
          const relations = outputs.relationsAdded || 0
          const commits = outputs.commitsProcessed || 0
          const sessions = outputs.sessionsProcessed || 0
          const parts = []
          if (commits > 0) parts.push(`${commits} commits`)
          if (sessions > 0) parts.push(`${sessions} sessions`)
          if (entities > 0) parts.push(`${entities} entities`)
          if (relations > 0) parts.push(`${relations} relations`)
          const status = outputs.validated ? '✅ Validated' : '⚠️ Validation issues'
          return parts.length > 0 ? `${status}: ${parts.join(', ')}` : status
        }

        // Legacy format
        const passed = outputs.passed || outputs.validationsPassed || 0
        const failed = outputs.failed || outputs.validationsFailed || 0
        const qaIterations = outputs.qaIterations || 1
        if (passed > 0 || failed > 0) {
          return qaIterations > 1
            ? `QA: ${passed} passed, ${failed} failed (after ${qaIterations} iterations)`
            : `QA: ${passed} passed, ${failed} failed`
        }
        // No meaningful data
        return null

      case 'persistence':
        const persisted = outputs.entitiesPersisted || outputs.entities?.length || 0
        const updated = outputs.entitiesUpdated || 0
        return `Persisted ${persisted} entities, updated ${updated}`

      case 'deduplication':
        const duplicates = outputs.duplicatesFound || outputs.duplicates?.length || 0
        const merged = outputs.entitiesMerged || 0
        return `Found ${duplicates} duplicates, merged ${merged} entities`

      case 'code_graph':
        // Check for codeGraphStats first - this has the actual Memgraph data
        const codeGraphStats = outputs.codeGraphStats || {}
        const graphTotalEntities = codeGraphStats.totalEntities || 0
        const graphTotalRelationships = codeGraphStats.totalRelationships || 0
        const graphFunctions = codeGraphStats.entityTypeDistribution?.function || 0
        const graphClasses = codeGraphStats.entityTypeDistribution?.class || 0
        const graphMethods = codeGraphStats.entityTypeDistribution?.method || 0

        // If we have valid codeGraphStats, show those (even if there's a "using existing" warning)
        if (graphTotalEntities > 0) {
          const usedExisting = outputs.warning?.includes('existing') || outputs.warning?.includes('no re-indexing')
          const prefix = usedExisting ? '📊 ' : ''
          const suffix = usedExisting ? ' (cached)' : ''
          return `${prefix}${graphTotalEntities.toLocaleString()} entities (${graphFunctions.toLocaleString()} functions, ${graphClasses.toLocaleString()} classes), ${graphTotalRelationships.toLocaleString()} relationships${suffix}`
        }

        // Check for actual failure/skip conditions
        if (outputs.skipped || outputs.skipReason) {
          const reason = outputs.skipReason || outputs.warning || 'Unknown reason'
          const shortReason = reason.includes('code 143') ? 'Timeout (SIGTERM)' :
                              reason.includes('failed') ? 'Indexing failed' :
                              reason.slice(0, 50) + (reason.length > 50 ? '...' : '')
          return `⚠️ Skipped: ${shortReason}`
        }
        // Check for incremental mode (used existing data)
        if (outputs.incrementalMode && !outputs.reindexed) {
          const existingNodes = outputs.statistics?.totalEntities || 0
          const changedFiles = outputs.changedFilesCount || 0
          if (changedFiles > 0) {
            return `📊 Used existing graph (${existingNodes} nodes), ${changedFiles} files changed`
          }
          return `📊 Used existing graph (${existingNodes} nodes), no changes detected`
        }
        // Code graph indexing results from code-graph-rag
        const functions = outputs.functionsIndexed || outputs.functions?.length || outputs.nodeStats?.functions || outputs.statistics?.entityTypeDistribution?.Function || 0
        const classes = outputs.classesIndexed || outputs.classes?.length || outputs.nodeStats?.classes || outputs.statistics?.entityTypeDistribution?.Class || 0
        const modules = outputs.modulesIndexed || outputs.modules?.length || outputs.nodeStats?.modules || outputs.statistics?.entityTypeDistribution?.Module || 0
        const relationships = outputs.relationshipsIndexed || outputs.relationships?.length || outputs.edgeStats?.total || outputs.statistics?.totalRelationships || 0
        const totalNodes = outputs.totalNodesIndexed || outputs.nodesCreated || outputs.totalNodes || outputs.statistics?.totalEntities || (functions + classes + modules)
        if (totalNodes > 0 || functions > 0 || classes > 0) {
          const reindexNote = outputs.reindexed ? ' (re-indexed)' : ''
          return `Indexed ${totalNodes} nodes (${functions} functions, ${classes} classes), ${relationships} relationships${reindexNote}`
        }
        // Fallback for incremental indexing
        const filesScanned = outputs.filesScanned || outputs.filesProcessed || 0
        if (filesScanned > 0) {
          return `Scanned ${filesScanned} files for code graph updates`
        }
        return `Code graph indexing completed`

      case 'code_intelligence':
        const queriesGenerated = outputs.queriesGenerated || outputs.queries?.length || 0
        const patternsDiscovered = outputs.patternsDiscovered || outputs.patterns?.length || 0
        const hotspots = outputs.hotspots?.length || 0
        if (queriesGenerated > 0 || patternsDiscovered > 0) {
          return `Generated ${queriesGenerated} queries, discovered ${patternsDiscovered} patterns${hotspots > 0 ? `, ${hotspots} hotspots` : ''}`
        }
        return `Code intelligence analysis completed`

      case 'documentation_linker':
        const totalDocs = outputs.totalDocuments || outputs.documentsCount || outputs.documents?.length || 0
        const totalLinks = outputs.totalLinks || outputs.linksCount || outputs.documentsLinked || 0
        const unresolvedRefs = outputs.unresolvedReferences || 0
        if (totalDocs > 0 || totalLinks > 0) {
          const unresolvedStr = unresolvedRefs > 0 ? ` (${unresolvedRefs} unresolved)` : ''
          return `Found ${totalDocs} documents with ${totalLinks} code references${unresolvedStr}`
        }
        return `Documentation analysis completed`

      case 'documentation_semantics':
        const docstringsAnalyzed = outputs.docstringsAnalyzed || outputs.docstrings?.length || 0
        const semanticEntities = outputs.entitiesEnriched || outputs.entities?.length || 0
        return `Analyzed ${docstringsAnalyzed} docstrings, enriched ${semanticEntities} entities`

      case 'ontology_classification':
        const entitiesClassified = outputs.entitiesClassified || outputs.classified?.length || 0
        const avgConfidence = outputs.averageConfidence ? `${(outputs.averageConfidence * 100).toFixed(0)}%` : ''
        const classesUsed = outputs.ontologyClassesUsed || 0
        return avgConfidence
          ? `Classified ${entitiesClassified} entities (${avgConfidence} avg confidence) into ${classesUsed} classes`
          : `Classified ${entitiesClassified} entities into ontology taxonomy`

      case 'web_search':
        const searchesPerformed = outputs.searchesPerformed || outputs.searches?.length || 0
        const resultsFound = outputs.resultsFound || outputs.results?.length || 0
        return `Performed ${searchesPerformed} searches, found ${resultsFound} relevant results`

      case 'content_validation':
        const entitiesValidated = outputs.entitiesValidated || outputs.validated?.length || 0
        const staleDetected = outputs.staleEntitiesDetected || outputs.stale?.length || 0
        const refreshed = outputs.entitiesRefreshed || 0
        return staleDetected > 0
          ? `Validated ${entitiesValidated} entities, detected ${staleDetected} stale (${refreshed} refreshed)`
          : `Validated ${entitiesValidated} entities against current codebase`

      default:
        return null
    }
  }

  const summary = getSummary()
  if (!summary) return null

  return (
    <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 text-blue-800">
      {summary}
    </div>
  )
}

/**
 * Expandable details view for step outputs.
 * Shows arrays with expandable item lists and handles nested objects.
 */
function StepResultDetails({ outputs }: { outputs: Record<string, any> }) {
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())

  const toggleExpand = (key: string) => {
    const newExpanded = new Set(expandedKeys)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedKeys(newExpanded)
  }

  const renderValue = (key: string, value: any, depth: number = 0): React.ReactNode => {
    // For nested keys like "parent.child.grandchild", display only the last part
    const displayKey = key.includes('.') ? key.split('.').pop()! : key
    // Format key: commitsAnalyzed -> Commits Analyzed
    const formattedKey = displayKey
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim()

    if (typeof value === 'number') {
      return (
        <div key={key} className="flex justify-between items-center">
          <span className="text-muted-foreground">{formattedKey}</span>
          <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
        </div>
      )
    }

    if (typeof value === 'boolean') {
      return (
        <div key={key} className="flex justify-between items-center">
          <span className="text-muted-foreground">{formattedKey}</span>
          <span className={value ? 'text-green-600' : 'text-red-600'}>{value ? 'Yes' : 'No'}</span>
        </div>
      )
    }

    if (typeof value === 'string') {
      if (value.length > 60) {
        const isExpanded = expandedKeys.has(key)
        return (
          <div key={key} className="space-y-1">
            <div
              className="flex justify-between items-center cursor-pointer hover:bg-slate-100 rounded px-1"
              onClick={() => toggleExpand(key)}
            >
              <span className="text-muted-foreground">{formattedKey}</span>
              <ChevronRight className={`h-3 w-3 text-blue-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>
            {isExpanded && (
              <div className="text-xs bg-slate-100 rounded p-2 break-words ml-2">
                {value}
              </div>
            )}
          </div>
        )
      }
      return (
        <div key={key} className="flex justify-between items-center">
          <span className="text-muted-foreground">{formattedKey}</span>
          <span className="font-medium">{value}</span>
        </div>
      )
    }

    if (Array.isArray(value)) {
      const isExpanded = expandedKeys.has(key)
      const displayItems = value.slice(0, 10)  // Show up to 10 items when expanded

      return (
        <div key={key} className="space-y-1">
          <div
            className="flex justify-between items-center cursor-pointer hover:bg-slate-100 rounded px-1"
            onClick={() => toggleExpand(key)}
          >
            <span className="text-muted-foreground">{formattedKey}</span>
            <span className="font-medium tabular-nums flex items-center gap-1">
              {value.length} items
              <ChevronRight className={`h-3 w-3 text-blue-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </span>
          </div>
          {isExpanded && (
            <div className="text-xs bg-slate-100 rounded p-2 ml-2 space-y-1 max-h-40 overflow-y-auto">
              {displayItems.map((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                  // For objects, show name or first property
                  const displayText = item.name || item.pattern || item.entityName ||
                    Object.values(item)[0] || JSON.stringify(item).slice(0, 50)
                  return (
                    <div key={idx} className="flex items-center gap-1 text-slate-700">
                      <span className="text-slate-400">{idx + 1}.</span>
                      <span className="truncate">{String(displayText)}</span>
                    </div>
                  )
                }
                return (
                  <div key={idx} className="flex items-center gap-1 text-slate-700">
                    <span className="text-slate-400">{idx + 1}.</span>
                    <span className="truncate">{String(item)}</span>
                  </div>
                )
              })}
              {value.length > 10 && (
                <div className="text-slate-400 italic">...and {value.length - 10} more</div>
              )}
            </div>
          )}
        </div>
      )
    }

    if (typeof value === 'object' && value !== null) {
      const isExpanded = expandedKeys.has(key)
      const entries = Object.entries(value).filter(([k]) => !k.startsWith('_'))

      return (
        <div key={key} className="space-y-1">
          <div
            className="flex justify-between items-center cursor-pointer hover:bg-slate-100 rounded px-1"
            onClick={() => toggleExpand(key)}
          >
            <span className="text-muted-foreground">{formattedKey}</span>
            <span className="font-medium tabular-nums flex items-center gap-1">
              {entries.length} props
              <ChevronRight className={`h-3 w-3 text-blue-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </span>
          </div>
          {isExpanded && (
            <div className="text-xs bg-slate-100 rounded p-2 ml-2 space-y-1">
              {entries.slice(0, 8).map(([k, v]) => {
                const nestedKey = `${key}.${k}`
                return renderValue(nestedKey, v, depth + 1)
              })}
            </div>
          )}
        </div>
      )
    }

    return (
      <div key={key} className="flex justify-between items-center">
        <span className="text-muted-foreground">{formattedKey}</span>
        <span className="font-medium">{String(value)}</span>
      </div>
    )
  }

  // Smart filtering: hide misleading top-level keys when better nested data exists
  const entries = Object.entries(outputs).filter(([key, value]) => {
    // Always hide underscore-prefixed internal keys
    if (key.startsWith('_')) return false

    // Hide 'entitiesCount' if codeGraphStats has actual entity data
    // (entitiesCount: 0 is misleading when codeGraphStats.totalEntities > 0)
    if (key === 'entitiesCount' && outputs.codeGraphStats?.totalEntities > 0) {
      return false
    }

    // Hide empty codeGraphStats objects (they add no value)
    if (key === 'codeGraphStats' && typeof value === 'object' && value !== null) {
      const stats = value as Record<string, any>
      if (Object.keys(stats).length === 0 || stats.totalEntities === 0) {
        return false
      }
    }

    return true
  })

  return (
    <div className="text-xs bg-slate-50 border rounded p-2 space-y-1.5">
      {entries.slice(0, 12).map(([key, value]) => renderValue(key, value))}
      {entries.length > 12 && (
        <div className="text-muted-foreground italic pt-1">
          ...and {entries.length - 12} more properties
        </div>
      )}
    </div>
  )
}

export default function UKBWorkflowGraph({ process, onNodeClick, selectedNode }: UKBWorkflowGraphProps) {
  // Fetch workflow definitions from API (Single Source of Truth)
  // Pass workflow name to load correct edges for the current workflow
  const { agents: WORKFLOW_AGENTS, orchestrator: ORCHESTRATOR_NODE, edges: WORKFLOW_EDGES, stepToAgent: STEP_TO_AGENT, isLoading: definitionsLoading } = useWorkflowDefinitions(process.workflowName)

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

  // Create a stable signature of step statuses for dependency tracking
  // This ensures useMemo recalculates when step statuses change, even if array reference doesn't
  const stepsSignature = useMemo(() => {
    if (!process.steps) return ''
    return process.steps.map(s => `${s.name}:${s.status}`).join(',')
  }, [process.steps])

  // KG operator child agents that should aggregate to parent kg_operators
  const KG_OPERATOR_CHILDREN = [
    'context_convolution', 'entity_aggregation', 'node_embedding',
    'deduplication_operator', 'edge_prediction', 'structure_merge'
  ]

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

        // Aggregate KG operator child status to parent kg_operators
        if (KG_OPERATOR_CHILDREN.includes(agentId)) {
          const existingStatus = map['kg_operators']?.status
          if (!existingStatus ||
              step.status === 'running' ||
              (step.status === 'failed' && existingStatus !== 'running') ||
              (step.status === 'completed' && existingStatus !== 'running' && existingStatus !== 'failed')) {
            map['kg_operators'] = { ...step, name: 'kg_operators' }
          }
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
    // Use stepsSignature instead of process.steps for reliable change detection
    // stepsSignature changes when any step's name or status changes
    // Also include _refreshKey and completedSteps for additional change detection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsSignature, process.currentStep, process.completedSteps, STEP_TO_AGENT, (process as any)._refreshKey])

  // Filter agents to only those appearing in the current workflow
  // PRESERVE original row/col positions from agents.yaml (Single Source of Truth)
  const { visibleAgents, maxRow, maxCol } = useMemo(() => {
    if (WORKFLOW_EDGES.length === 0) {
      return { visibleAgents: WORKFLOW_AGENTS, maxRow: 9, maxCol: 2.5 }
    }

    // Collect all agent IDs that appear in edges
    const agentIdsInWorkflow = new Set<string>()
    for (const edge of WORKFLOW_EDGES) {
      if (edge.from !== 'orchestrator') {
        agentIdsInWorkflow.add(edge.from)
      }
      agentIdsInWorkflow.add(edge.to)
    }

    // Filter agents and preserve their original positions from agents.yaml
    const filtered = WORKFLOW_AGENTS.filter(agent => agentIdsInWorkflow.has(agent.id))

    // Normalize ALL row numbers to consecutive integers (e.g., rows -1, -0.5, 0, 1, 4 → 0, 1, 2, 3, 4)
    // This ensures equal spacing between ALL rows regardless of original values
    const uniqueRows = [...new Set(filtered.map(a => a.row))].sort((a, b) => a - b)
    const rowMap = new Map<number, number>()

    // Map all rows to consecutive integers starting from 0
    uniqueRows.forEach((row, index) => {
      rowMap.set(row, index)
    })

    // Apply normalized positions
    const normalizedAgents = filtered.map(agent => ({
      ...agent,
      row: rowMap.get(agent.row) ?? agent.row
    }))

    // Compute max row and col from normalized agents
    let computedMaxRow = 0
    let computedMaxCol = 0
    for (const agent of normalizedAgents) {
      computedMaxRow = Math.max(computedMaxRow, agent.row)
      computedMaxCol = Math.max(computedMaxCol, agent.col)
    }

    return {
      visibleAgents: normalizedAgents,
      maxRow: computedMaxRow,
      maxCol: Math.max(computedMaxCol, 2)
    }
  }, [WORKFLOW_AGENTS, WORKFLOW_EDGES])

  const getNodeStatus = (agentId: string): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' => {
    const stepInfo = stepStatusMap[agentId]
    if (stepInfo) return stepInfo.status

    // If no step info exists for this agent:
    // - If workflow is complete (100%), the agent was not part of this workflow -> 'skipped'
    // - If workflow is still running, the agent hasn't started yet -> 'pending'
    const isWorkflowComplete = process.completedSteps >= process.totalSteps && process.totalSteps > 0
    return isWorkflowComplete ? 'skipped' : 'pending'
  }

  // Helper to get confidence with fallback to multiAgent data
  const getStepConfidence = (agentId: string, stepInfo: any): number | undefined => {
    // First try per-step outputs
    if (stepInfo?.outputs?.confidence !== undefined) {
      return stepInfo.outputs.confidence
    }
    // Fallback to global multiAgent stepConfidences
    if (process.multiAgent?.stepConfidences?.[agentId] !== undefined) {
      return process.multiAgent.stepConfidences[agentId]
    }
    return undefined
  }

  // Helper to get routing decision with fallback to multiAgent routingHistory
  const getStepRoutingDecision = (agentId: string, stepInfo: any): string | undefined => {
    // First try per-step outputs
    if (stepInfo?.outputs?.routingDecision) {
      return stepInfo.outputs.routingDecision
    }
    // Fallback to global multiAgent routingHistory (find last decision affecting this step)
    if (process.multiAgent?.routingHistory) {
      const decisions = process.multiAgent.routingHistory.filter(
        d => d.affectedSteps.includes(agentId)
      )
      if (decisions.length > 0) {
        return decisions[decisions.length - 1].action
      }
    }
    return undefined
  }

  // Helper to get retry count with fallback to multiAgent retryHistory
  const getStepRetryCount = (agentId: string, stepInfo: any): number => {
    // First try per-step outputs
    if (stepInfo?.outputs?.retryCount !== undefined) {
      return stepInfo.outputs.retryCount
    }
    // Fallback to global multiAgent retryHistory
    if (process.multiAgent?.retryHistory?.[agentId] !== undefined) {
      return process.multiAgent.retryHistory[agentId]
    }
    return 0
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
  // Layout: Orchestrator at row -1, then 4-5 parallel entry nodes in row 0, then converging down
  const nodeWidth = 100
  const nodeHeight = 55
  const horizontalGap = 30
  const verticalGap = 60  // Increased for fractional row spacing (prevents batch/-0.5 overlapping git/0)
  // Dynamic grid width based on computed maxCol from layout algorithm
  const numCols = Math.ceil(maxCol) + 1  // +1 because col is 0-indexed
  const gridWidth = nodeWidth * numCols + horizontalGap * (numCols - 0.5)
  // Dynamic grid height based on computed maxRow, +2 for orchestrator row (-1) and buffer
  const numRows = Math.ceil(maxRow) + 3  // +3 for: row -1 (orchestrator), 0-maxRow, and buffer
  const gridHeight = (nodeHeight + verticalGap) * numRows
  const padding = 30
  const orchestratorOffset = nodeHeight + verticalGap  // Offset to account for row -1

  const getNodePosition = (agent: { row: number; col: number }) => {
    const x = padding + agent.col * (nodeWidth + horizontalGap)
    // Shift all rows down by 1 to make room for orchestrator at row -1
    const y = padding + (agent.row + 1) * (nodeHeight + verticalGap)
    return { x, y }
  }

  return (
    <TooltipProvider>
      <div className="flex gap-4 w-full">
        {/* Graph Container - contains scrollable SVG */}
        <div className="flex-1 relative bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border overflow-auto max-h-[500px]">
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
              <marker
                id="arrowhead-dataflow"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#a855f7" />
              </marker>
              <marker
                id="arrowhead-control"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
              </marker>
              <marker
                id="arrowhead-self"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#8b5cf6" />
              </marker>
            </defs>

            {/* Edges - use visibleAgents for correct normalized positions */}
            {WORKFLOW_EDGES.map((edge, idx) => {
              // Handle self-referencing edges (e.g., kg_operators → kg_operators)
              if ((edge as any).type === 'self' && edge.from === edge.to) {
                const agent = visibleAgents.find(a => a.id === edge.from)
                if (!agent) return null
                const pos = getNodePosition(agent)

                // Draw a curved loop on the right side of the node
                const startX = pos.x + nodeWidth
                const startY = pos.y + nodeHeight / 2 - 10
                const endX = pos.x + nodeWidth
                const endY = pos.y + nodeHeight / 2 + 10
                const loopRadius = 25

                const path = `M ${startX} ${startY}
                              C ${startX + loopRadius * 2} ${startY},
                                ${startX + loopRadius * 2} ${endY},
                                ${endX} ${endY}`

                // Ordinal position for self-loop (at the top of the loop)
                const ordinalX = startX + loopRadius * 2
                const ordinalY = pos.y + nodeHeight / 2 - loopRadius

                return (
                  <g key={idx}>
                    <path
                      d={path}
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth={1.5}
                      strokeDasharray="3,2"
                      markerEnd="url(#arrowhead-self)"
                    />
                    {/* Ordinal number badge on self-loop */}
                    <g>
                      <circle
                        cx={ordinalX}
                        cy={ordinalY}
                        r={11}
                        fill="white"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
                      />
                      <text
                        x={ordinalX}
                        y={ordinalY + 4}
                        fontSize="11"
                        fontWeight="600"
                        fill="#8b5cf6"
                        textAnchor="middle"
                        className="select-none"
                      >
                        {idx + 1}
                      </text>
                    </g>
                    {/* Label for self-loop with background for readability */}
                    {(edge as any).label && (() => {
                      const labelX = startX + loopRadius * 2 + 5
                      const labelY = pos.y + nodeHeight / 2
                      const labelText = (edge as any).label.length > 20
                        ? ((edge as any).label.match(/→/g)?.length > 0
                          ? `${((edge as any).label.match(/→/g) || []).length + 1} ops`
                          : (edge as any).label.substring(0, 18) + '...')
                        : (edge as any).label

                      return (
                        <g>
                          <rect
                            x={labelX - 2}
                            y={labelY - 9}
                            width={labelText.length * 5 + 8}
                            height={14}
                            rx={2}
                            fill="rgba(255,255,255,0.9)"
                          />
                          <text
                            x={labelX}
                            y={labelY + 2}
                            fontSize="9"
                            fill="#8b5cf6"
                            className="select-none font-medium"
                          >
                            {labelText}
                          </text>
                        </g>
                      )
                    })()}
                  </g>
                )
              }

              // Handle orchestrator as source OR target - use visibleAgents for normalized positions
              const fromAgent = edge.from === 'orchestrator'
                ? ORCHESTRATOR_NODE
                : visibleAgents.find(a => a.id === edge.from)
              const toAgent = edge.to === 'orchestrator'
                ? ORCHESTRATOR_NODE
                : visibleAgents.find(a => a.id === edge.to)
              if (!fromAgent || !toAgent) return null

              const fromPos = getNodePosition(fromAgent)
              const toPos = getNodePosition(toAgent)

              // Determine edge type
              const isControl = (edge as any).type === 'control'
              const isDataflow = edge.type === 'dataflow'

              // Check if this is a loop-back edge (going UP instead of down)
              const isLoopBack = isControl && fromPos.y > toPos.y

              // Calculate edge start/end points based on direction
              let fromX, fromY, toX, toY

              if (isLoopBack) {
                // Loop-back: exit from left side, enter at left side
                fromX = fromPos.x - 5  // Left side of source
                fromY = fromPos.y + nodeHeight / 2
                toX = toPos.x - 5  // Left side of target
                toY = toPos.y + nodeHeight / 2
              } else {
                // Normal: exit from bottom, enter at top
                fromX = fromPos.x + nodeWidth / 2
                fromY = fromPos.y + nodeHeight
                toX = toPos.x + nodeWidth / 2
                toY = toPos.y
              }

              // Determine if this edge is active (current data flow)
              const fromStatus = edge.from === 'orchestrator'
                ? (process.status === 'running' ? 'running' : 'completed')
                : getNodeStatus(edge.from)
              const toStatus = edge.to === 'orchestrator'
                ? (process.status === 'running' ? 'running' : 'completed')
                : getNodeStatus(edge.to)
              const isActive = fromStatus === 'completed' && toStatus === 'running'
              const isCompleted = fromStatus === 'completed' && toStatus === 'completed'

              // Different colors for edge types
              // IMPORTANT: Check edge TYPE first (control, dataflow), then STATUS
              // Control/dataflow edges always use their type color regardless of completion
              let strokeColor: string
              let markerEnd: string
              let strokeDasharray: string | undefined

              if (isControl) {
                // Control edges: always amber dashed (type takes precedence)
                strokeColor = '#f59e0b'
                markerEnd = 'url(#arrowhead-control)'
                strokeDasharray = '5,3'
              } else if (isDataflow) {
                // Dataflow edges: always purple dashed (type takes precedence)
                strokeColor = '#a855f7'
                markerEnd = 'url(#arrowhead-dataflow)'
                strokeDasharray = '4,2'
              } else if (isActive) {
                // Dependency edges: blue when active
                strokeColor = '#3b82f6'
                markerEnd = 'url(#arrowhead-active)'
              } else if (isCompleted) {
                // Dependency edges: green when completed
                strokeColor = '#22c55e'
                markerEnd = 'url(#arrowhead)'
              } else {
                // Dependency edges: gray when pending
                strokeColor = '#cbd5e1'
                markerEnd = 'url(#arrowhead)'
              }

              const strokeWidth = isActive ? 2 : 1.5

              // Create path based on direction
              let path: string

              if (isLoopBack) {
                // Loop-back path: curve to the left and up with horizontal final approach
                const leftOffset = 50  // How far left to curve
                const approachX = toX - 12  // Point for horizontal approach to target
                path = `M ${fromX} ${fromY}
                        C ${fromX - leftOffset} ${fromY},
                          ${approachX - leftOffset} ${toY},
                          ${approachX} ${toY} L ${toX} ${toY}`
              } else {
                // Path with vertical final approach for proper arrowhead alignment
                // Curve to a point above target, then straight down to target
                const approachY = toY - 15  // Point above target for vertical approach
                const midY = (fromY + approachY) / 2
                path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${approachY} L ${toX} ${toY - 3}`
              }

              // Calculate ordinal number position at midpoint, offset to the side
              const ordinalX = (fromX + toX) / 2 + 12
              const ordinalY = (fromY + toY) / 2

              return (
                <g key={idx}>
                  <path
                    d={path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    markerEnd={markerEnd}
                    className={isActive ? 'animate-pulse' : ''}
                  />
                  {/* Ordinal number badge on edge - always show for non-loopback edges */}
                  {!isLoopBack && (
                    <g>
                      <circle
                        cx={ordinalX}
                        cy={ordinalY}
                        r={10}
                        fill="#ffffff"
                        stroke={strokeColor}
                        strokeWidth={1.5}
                      />
                      <text
                        x={ordinalX}
                        y={ordinalY + 4}
                        fontSize="10"
                        fontWeight="bold"
                        fill={strokeColor}
                        textAnchor="middle"
                      >
                        {idx + 1}
                      </text>
                    </g>
                  )}
                  {/* Label for control edges - positioned along the edge path */}
                  {isControl && (edge as any).label && (() => {
                    // Calculate label position along the edge
                    // For loop-back: position to the left of the curve
                    // For normal edges: position offset from midpoint based on direction
                    const midY = (fromY + toY) / 2
                    let labelX: number
                    let labelY: number
                    let textAnchor: 'start' | 'middle' | 'end' = 'start'

                    if (isLoopBack) {
                      // Loop-back: position to the left of the curved path
                      labelX = Math.min(fromX, toX) - 55
                      labelY = midY
                      textAnchor = 'end'
                    } else {
                      // Normal edges: offset based on direction
                      // Position label at 60% along the path (closer to target)
                      const t = 0.6
                      labelX = fromX + (toX - fromX) * t + 8
                      labelY = fromY + (toY - fromY) * t - 4
                    }

                    return (
                      <g>
                        {/* Background for readability */}
                        <rect
                          x={labelX - (textAnchor === 'end' ? 75 : 2)}
                          y={labelY - 8}
                          width={72}
                          height={12}
                          rx={2}
                          fill="rgba(255,255,255,0.85)"
                        />
                        <text
                          x={labelX}
                          y={labelY}
                          fontSize="9"
                          fill="#f59e0b"
                          textAnchor={textAnchor}
                          className="select-none font-medium"
                        >
                          {(edge as any).label}
                        </text>
                      </g>
                    )
                  })()}
                </g>
              )
            })}

            {/* Orchestrator Node */}
            {(() => {
              const pos = getNodePosition(ORCHESTRATOR_NODE)
              const orchestratorWidth = nodeWidth * 1.5
              const isRunning = process.status === 'running'
              const isFailed = process.status === 'failed'
              const isCompleted = process.status === 'completed'
              const Icon = ORCHESTRATOR_NODE.icon
              // Factor in batch progress for more accurate display
              const progressPercent = process.totalSteps > 0
                ? Math.round(
                    process.batchProgress && process.batchProgress.totalBatches > 0
                      ? ((Math.max(0, process.completedSteps - 1) + (process.batchProgress.currentBatch / process.batchProgress.totalBatches)) / process.totalSteps) * 100
                      : (process.completedSteps / process.totalSteps) * 100
                  )
                : 0

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <g
                      className="cursor-pointer"
                      onClick={() => onNodeClick?.('orchestrator')}
                    >
                      {/* Orchestrator background - wider than regular nodes */}
                      <rect
                        x={pos.x - (orchestratorWidth - nodeWidth) / 2}
                        y={pos.y}
                        width={orchestratorWidth}
                        height={nodeHeight}
                        rx={8}
                        fill={isFailed ? '#fee2e2' : isCompleted ? '#166534' : isRunning ? '#dbeafe' : '#f9fafb'}
                        stroke={isFailed ? '#ef4444' : isCompleted ? '#15803d' : isRunning ? '#3b82f6' : '#d1d5db'}
                        strokeWidth={2}
                        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}
                      />

                      {/* Progress bar inside orchestrator */}
                      <rect
                        x={pos.x - (orchestratorWidth - nodeWidth) / 2 + 4}
                        y={pos.y + nodeHeight - 8}
                        width={(orchestratorWidth - 8) * (progressPercent / 100)}
                        height={4}
                        rx={2}
                        fill={isFailed ? '#ef4444' : isCompleted ? '#22c55e' : '#3b82f6'}
                      />
                      <rect
                        x={pos.x - (orchestratorWidth - nodeWidth) / 2 + 4}
                        y={pos.y + nodeHeight - 8}
                        width={orchestratorWidth - 8}
                        height={4}
                        rx={2}
                        fill="none"
                        stroke={isFailed ? '#fca5a5' : isCompleted ? '#4ade80' : '#93c5fd'}
                        strokeWidth={0.5}
                      />

                      {/* Orchestrator content */}
                      <foreignObject
                        x={pos.x - (orchestratorWidth - nodeWidth) / 2}
                        y={pos.y}
                        width={orchestratorWidth}
                        height={nodeHeight - 10}
                      >
                        <div
                          className="flex flex-col items-center justify-center h-full px-2"
                          style={{ color: isFailed ? '#7f1d1d' : isCompleted ? '#ffffff' : isRunning ? '#1e3a8a' : '#4b5563' }}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            <Icon className="h-4 w-4" />
                            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                          </div>
                          <span className="text-xs font-semibold">{process.workflowName || 'Workflow'}</span>
                          <span className="text-[10px] opacity-80">
                            {process.batchProgress
                              ? `Batch ${process.batchProgress.currentBatch}/${process.batchProgress.totalBatches}`
                              : `${process.completedSteps}/${process.totalSteps} steps`
                            }
                          </span>
                        </div>
                      </foreignObject>

                      {/* Status indicator */}
                      <circle
                        cx={pos.x + (orchestratorWidth + nodeWidth) / 2 - 8}
                        cy={pos.y + 8}
                        r={6}
                        fill={
                          isRunning ? '#3b82f6' :
                          isCompleted ? '#22c55e' :
                          isFailed ? '#ef4444' :
                          '#d1d5db'
                        }
                      />
                    </g>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <div className="space-y-1">
                      <div className="font-medium">{ORCHESTRATOR_NODE.name}</div>
                      <div className="text-xs text-muted-foreground">{ORCHESTRATOR_NODE.description}</div>
                      <Separator className="my-1" />
                      <div className="text-xs space-y-0.5">
                        <div className="flex justify-between">
                          <span>Workflow:</span>
                          <span className="font-medium">{process.workflowName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Team:</span>
                          <span>{process.team}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Progress:</span>
                          <span>{progressPercent}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Status:</span>
                          <Badge variant="outline" className="text-[10px] h-4">
                            {process.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })()}

            {/* Nodes - only show agents that are part of this workflow */}
            {visibleAgents.map((agent) => {
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

                      {/* Confidence bar - shows confidence level for completed steps */}
                      {(() => {
                        const confidence = getStepConfidence(agent.id, stepInfo)
                        if (status !== 'completed' || confidence === undefined) return null
                        return (
                          <g>
                            {/* Background bar */}
                            <rect
                              x={pos.x + 4}
                              y={pos.y + nodeHeight - 8}
                              width={nodeWidth - 8}
                              height={4}
                              rx={2}
                              fill="#e2e8f0"
                            />
                            {/* Confidence fill */}
                            <rect
                              x={pos.x + 4}
                              y={pos.y + nodeHeight - 8}
                              width={Math.max(0, (nodeWidth - 8) * Math.min(1, confidence))}
                              height={4}
                              rx={2}
                              fill={
                                confidence >= 0.8 ? '#22c55e' :
                                confidence >= 0.5 ? '#f59e0b' :
                                '#ef4444'
                              }
                            />
                            {/* Confidence value label */}
                            <text
                              x={pos.x + nodeWidth / 2}
                              y={pos.y + nodeHeight + 10}
                              fontSize="8"
                              fill={
                                confidence >= 0.8 ? '#16a34a' :
                                confidence >= 0.5 ? '#d97706' :
                                '#dc2626'
                              }
                              textAnchor="middle"
                              className="font-medium"
                            >
                              {(confidence * 100).toFixed(0)}%
                            </text>
                          </g>
                        )
                      })()}

                      {/* Routing decision badge - shows last routing action */}
                      {(() => {
                        const routingDecision = getStepRoutingDecision(agent.id, stepInfo)
                        if (!routingDecision) return null
                        return (
                          <g>
                            <rect
                              x={pos.x + nodeWidth + 2}
                              y={pos.y + 4}
                              width={22}
                              height={14}
                              rx={3}
                              fill={
                                routingDecision === 'proceed' ? '#22c55e' :
                                routingDecision === 'retry' ? '#f59e0b' :
                                routingDecision === 'skip' ? '#94a3b8' :
                                routingDecision === 'escalate' ? '#ef4444' :
                                '#6b7280'
                              }
                            />
                            <text
                              x={pos.x + nodeWidth + 13}
                              y={pos.y + 14}
                              fontSize="7"
                              fill="white"
                              textAnchor="middle"
                              className="font-bold"
                            >
                              {routingDecision === 'proceed' ? '✓' :
                               routingDecision === 'retry' ? '↻' :
                               routingDecision === 'skip' ? '⊘' :
                               routingDecision === 'escalate' ? '!' :
                               '?'}
                            </text>
                          </g>
                        )
                      })()}

                      {/* Retry count badge - shows number of retries if > 0 */}
                      {(() => {
                        const retryCount = getStepRetryCount(agent.id, stepInfo)
                        if (retryCount <= 0) return null
                        return (
                          <g>
                            <rect
                              x={pos.x - 4}
                              y={pos.y + 4}
                              width={20}
                              height={14}
                              rx={7}
                              fill="#f59e0b"
                              stroke="#d97706"
                              strokeWidth={1}
                            />
                            <text
                              x={pos.x + 6}
                              y={pos.y + 14}
                              fontSize="8"
                              fill="white"
                              textAnchor="middle"
                              className="font-bold"
                            >
                              x{retryCount}
                            </text>
                          </g>
                        )
                      })()}

                      {/* QA Retry iteration badge - shows loop count for QA agent */}
                      {agent.id === 'quality_assurance' && stepInfo?.outputs?.qaIterations && stepInfo.outputs.qaIterations > 1 && (
                        <g>
                          <rect
                            x={pos.x - 4}
                            y={pos.y + nodeHeight - 14}
                            width={28}
                            height={14}
                            rx={7}
                            fill="#f59e0b"
                            stroke="#d97706"
                            strokeWidth={1}
                          />
                          <foreignObject
                            x={pos.x - 4}
                            y={pos.y + nodeHeight - 14}
                            width={28}
                            height={14}
                          >
                            <div className="flex items-center justify-center h-full">
                              <RefreshCw className="h-2 w-2 text-white mr-0.5" />
                              <span className="text-[9px] font-bold text-white">{stepInfo.outputs.qaIterations}</span>
                            </div>
                          </foreignObject>
                        </g>
                      )}
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
                                <span>{formatDurationMs(stepInfo.duration)}</span>
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
        <div className="flex-shrink-0 w-32 bg-white/90 backdrop-blur-sm rounded-lg p-2 border shadow-sm self-end max-h-[500px] overflow-y-auto">
          <div className="text-xs font-medium mb-2">Legend</div>
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Status</div>
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
            <Separator className="my-1" />
            <div className="flex items-center gap-1.5">
              <Zap className="h-2.5 w-2.5 text-yellow-500" />
              <span>Uses LLM</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-2.5 w-2.5 text-amber-500" />
              <span>QA Retries</span>
            </div>
            <Separator className="my-1" />
            <div className="text-[10px] font-medium text-muted-foreground mb-1">Confidence</div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-1 rounded-sm bg-green-500" />
              <span>High (&gt;0.8)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-1 rounded-sm bg-amber-500" />
              <span>Med (0.5-0.8)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-1 rounded-sm bg-red-500" />
              <span>Low (&lt;0.5)</span>
            </div>
            <Separator className="my-1" />
            <div className="text-[10px] font-medium text-muted-foreground mb-1">Routing</div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-green-600">✓</span>
              <span>Proceed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-amber-600">↻</span>
              <span>Retry</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-gray-500">⊘</span>
              <span>Skip</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-red-600">!</span>
              <span>Escalate</span>
            </div>
            <Separator className="my-1" />
            <div className="text-[10px] font-medium text-muted-foreground mb-1">Edges</div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 bg-slate-400" />
              <span>Dependency</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 border-t-2 border-dashed border-purple-500" />
              <span>Data Flow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 border-t-2 border-dashed border-amber-500" />
              <span>Control/Loop</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RotateCcw className="h-2.5 w-2.5 text-violet-500" />
              <span>Self-Ref</span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

// Orchestrator details sidebar component
function OrchestratorDetailsSidebar({
  process,
  onClose
}: {
  process: ProcessInfo
  onClose: () => void
}) {
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelResult, setCancelResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleCancelWorkflow = async (killProcesses: boolean = false) => {
    setIsCancelling(true)
    setCancelResult(null)
    try {
      const apiPort = 3033
      const response = await fetch(`http://localhost:${apiPort}/api/ukb/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ killProcesses })
      })

      const data = await response.json()

      if (data.status === 'success') {
        setCancelResult({
          success: true,
          message: `Cancelled ${data.data.previousWorkflow || 'workflow'} (was ${data.data.previousStatus})`
        })
        // Refresh the page after a short delay to show updated state
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setCancelResult({ success: false, message: data.message || 'Failed to cancel' })
      }
    } catch (error) {
      setCancelResult({ success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown'}` })
    } finally {
      setIsCancelling(false)
    }
  }

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'running':
        return <Badge className="bg-blue-500">Running</Badge>
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      default:
        return <Badge variant="outline">Pending</Badge>
    }
  }

  // Calculate progress: factor in batch progress when available for more granular display
  // If batch processing is active, treat it as partial progress within the current step
  const progressPercent = process.totalSteps > 0
    ? Math.round(
        process.batchProgress && process.batchProgress.totalBatches > 0
          // When batch processing: (completed steps - 1 + batch fraction) / total
          ? ((Math.max(0, process.completedSteps - 1) + (process.batchProgress.currentBatch / process.batchProgress.totalBatches)) / process.totalSteps) * 100
          : (process.completedSteps / process.totalSteps) * 100
      )
    : 0

  // Calculate total duration from steps
  const totalDuration = process.steps?.reduce((acc, step) => acc + (step.duration || 0), 0) || 0

  // Group steps by status
  const completedSteps = process.steps?.filter(s => s.status === 'completed') || []
  const failedSteps = process.steps?.filter(s => s.status === 'failed') || []
  const runningSteps = process.steps?.filter(s => s.status === 'running') || []
  const pendingSteps = process.steps?.filter(s => s.status === 'pending') || []
  const skippedSteps = process.steps?.filter(s => s.status === 'skipped') || []

  // Determine if workflow can be cancelled - any active workflow can be cancelled
  const canCancel = process.status === 'running' || process.status === 'pending' || process.health === 'stale' || process.health === 'frozen'
  const isFrozenOrStale = process.health === 'stale' || process.health === 'frozen'

  return (
    <Card className="w-80 h-full overflow-auto">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            <CardTitle className="text-lg">Workflow Coordinator</CardTitle>
          </div>
          {getStatusBadge(process.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-sm text-muted-foreground mb-2">
            Multi-agent workflow coordinator. Manages parallel execution with max 3 concurrent steps,
            handles dependencies, retries failed steps, and aggregates results.
          </div>
        </div>

        <Separator />

        {/* Workflow Info */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Workflow Details</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{process.workflowName || 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Team</span>
              <span>{process.team || 'Unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Repository</span>
              <span className="text-xs truncate max-w-[180px]" title={process.repositoryPath}>
                {process.repositoryPath?.split('/').slice(-2).join('/') || 'Unknown'}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Progress */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Progress</h4>
          <div className="space-y-2">
            <Progress value={progressPercent} className="h-2" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Steps</span>
              <span className="font-medium">{process.completedSteps} / {process.totalSteps}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            {process.batchProgress && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Batch</span>
                <span className="font-medium text-blue-600">
                  {process.batchProgress.currentBatch} / {process.batchProgress.totalBatches}
                </span>
              </div>
            )}
            {totalDuration > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  Total Duration
                </span>
                <span>{(totalDuration / 1000).toFixed(1)}s</span>
              </div>
            )}
            {process.currentStep && runningSteps.length <= 1 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Step</span>
                <span className="text-blue-600 font-medium text-xs">{process.currentStep}</span>
              </div>
            )}
          </div>
        </div>

        {/* Kill Workflow Button - shown when workflow is running, stale, or frozen */}
        {canCancel && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium text-sm text-red-600 flex items-center gap-1">
                <StopCircle className="h-4 w-4" />
                Workflow Control
              </h4>
              <div className="space-y-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => handleCancelWorkflow(false)}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <StopCircle className="h-4 w-4 mr-2" />
                      Kill Workflow
                    </>
                  )}
                </Button>
                {isFrozenOrStale && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => handleCancelWorkflow(true)}
                    disabled={isCancelling}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Kill + Cleanup Processes
                  </Button>
                )}
                {cancelResult && (
                  <div className={`text-xs p-2 rounded ${cancelResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {cancelResult.message}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isFrozenOrStale
                    ? 'Workflow appears frozen/stale. Kill to reset state and optionally cleanup processes.'
                    : 'Cancel the running workflow and reset state.'}
                </p>
              </div>
            </div>
          </>
        )}

        {/* Active Steps - Parallel Execution */}
        {runningSteps.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                  Active Steps {runningSteps.length > 1 && <Badge variant="secondary" className="text-[10px] ml-1">{runningSteps.length} parallel</Badge>}
                </h4>
              </div>
              <div className="space-y-2">
                {runningSteps.map((step: any) => {
                  const agentDef = WORKFLOW_AGENTS.find(a =>
                    a.id === step.name.replace('analyze_', '').replace('_history', '_history').replace('index_', '').replace('link_', '') ||
                    step.name.includes(a.id.replace('_', ''))
                  )
                  const AgentIcon = agentDef?.icon || Code
                  return (
                    <div key={step.name} className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                      <AgentIcon className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                      <span className="font-medium text-blue-800 truncate">{step.name}</span>
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500 ml-auto flex-shrink-0" />
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Step Status Summary */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Step Status Summary</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>Completed: {completedSteps.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span>Running: {runningSteps.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>Failed: {failedSteps.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-300" />
              <span>Pending: {pendingSteps.length}</span>
            </div>
            {skippedSteps.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <span>Skipped: {skippedSteps.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* Executed Steps List */}
        {process.steps && process.steps.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="font-medium text-sm">All Steps</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {process.steps.map((step, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between text-xs p-1.5 rounded ${
                      step.status === 'completed' ? 'bg-green-50' :
                      step.status === 'failed' ? 'bg-red-50' :
                      step.status === 'running' ? 'bg-blue-50' :
                      step.status === 'skipped' ? 'bg-yellow-50' :
                      'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {step.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-green-600" />}
                      {step.status === 'failed' && <XCircle className="h-3 w-3 text-red-600" />}
                      {step.status === 'running' && <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />}
                      {step.status === 'pending' && <Clock className="h-3 w-3 text-gray-400" />}
                      {step.status === 'skipped' && <RefreshCw className="h-3 w-3 text-yellow-600" />}
                      <span className="truncate max-w-[140px]">{step.name}</span>
                    </div>
                    {step.duration !== undefined && step.duration > 0 && (
                      <span className="text-muted-foreground tabular-nums">
                        {(step.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Failed Steps Details */}
        {failedSteps.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                Failed Steps
              </h4>
              {failedSteps.map((step, idx) => (
                <div key={idx} className="text-xs bg-red-50 border border-red-200 rounded p-2 space-y-1">
                  <div className="font-medium text-red-800">{step.name}</div>
                  {step.error && (
                    <div className="text-red-700 break-words">{step.error}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Technology */}
        <Separator />
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Technology</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Executor</span>
              <span className="text-xs">Multi-Agent</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Concurrent</span>
              <span>3 steps</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Retry Policy</span>
              <span className="text-xs">Progressive backoff</span>
            </div>
          </div>
        </div>

        {/* Data Flow - Entry Points */}
        <Separator />
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Dispatches To</h4>
          <div className="flex flex-wrap gap-1">
            {WORKFLOW_EDGES
              .filter(e => e.from === 'orchestrator')
              .map(e => {
                const toAgent = WORKFLOW_AGENTS.find(a => a.id === e.to)
                return (
                  <Badge key={e.to} variant="outline" className="text-[10px]">
                    {toAgent?.shortName || e.to}
                  </Badge>
                )
              })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Sidebar component for detailed node information
export function UKBNodeDetailsSidebar({
  agentId,
  process,
  onClose,
  aggregatedSteps
}: {
  agentId: string
  process: ProcessInfo
  onClose: () => void
  aggregatedSteps?: AggregatedSteps | null
}) {
  // Handle orchestrator node specially
  if (agentId === 'orchestrator') {
    return <OrchestratorDetailsSidebar process={process} onClose={onClose} />
  }

  const agent = WORKFLOW_AGENTS.find(a => a.id === agentId)
  if (!agent) return null

  const Icon = agent.icon
  const stepInfo = process.steps?.find(s => STEP_TO_AGENT[s.name] === agentId || s.name === agentId)

  // Use same fallback logic as getNodeStatus in the graph
  const getInferredStatus = (): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' => {
    if (stepInfo?.status) return stepInfo.status as any

    // For batch workflows, check if we have aggregated data for this agent - means it was processed
    if (aggregatedSteps) {
      const agentHasData =
        (agentId === 'git_history' && aggregatedSteps.git_history?.totalCommits) ||
        (agentId === 'vibe_history' && aggregatedSteps.vibe_history?.totalSessions !== undefined) ||
        (agentId === 'semantic_analysis' && aggregatedSteps.semantic_analysis?.totalEntities) ||
        (agentId === 'kg_operators' && aggregatedSteps.kg_operators?.totalProcessed) ||
        (agentId === 'quality_assurance' && aggregatedSteps.kg_operators?.totalProcessed) ||
        (agentId === 'content_validation' && aggregatedSteps.content_validation?.validationComplete)
      if (agentHasData) return 'completed'
    }

    // If workflow is complete but agent has no step info or aggregated data, it wasn't part of this workflow
    const isWorkflowComplete = process.completedSteps >= process.totalSteps && process.totalSteps > 0
    return isWorkflowComplete ? 'skipped' : 'pending'
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
                <span>{formatDurationMs(stepInfo.duration)}</span>
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

        {/* Results Summary - show stats and key outcomes */}
        {stepInfo?.outputs && Object.keys(stepInfo.outputs).filter(k => !k.startsWith('_')).length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-1">
                <Zap className="h-3 w-3" />
                Results
              </h4>
              {/* Semantic Summary based on agent type - uses aggregated totals for historical workflows */}
              <StepResultSummary agentId={agentId} outputs={stepInfo.outputs} aggregatedSteps={aggregatedSteps} status={inferredStatus} />
              {/* Only show detailed results if we DON'T have aggregated data (which would contradict it) */}
              {!aggregatedSteps && <StepResultDetails outputs={stepInfo.outputs} />}
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
