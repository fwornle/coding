'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
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
  RefreshCw,
  Play,
} from 'lucide-react'

// Orchestrator node - represents the coordinator that manages all agents
const ORCHESTRATOR_NODE = {
  id: 'orchestrator',
  name: 'Orchestrator',
  shortName: 'Coordinator',
  icon: Play,
  description: 'DAG-based workflow coordinator. Manages parallel execution with max 3 concurrent steps, handles dependencies, retries failed steps, and aggregates results.',
  usesLLM: false,
  llmModel: null,
  techStack: 'TypeScript DAG executor',
  row: -1,  // Above all other nodes
  col: 1.125,  // Centered
}

// Agent definitions for the 13-agent workflow
// LLM info verified via Serena analysis of mcp-server-semantic-analysis
// Priority: Groq > Gemini > Anthropic > OpenAI (auto-fallback based on API key availability)
// Grid layout: row/col positions reflect actual DAG structure from coordinator.ts
// Phase 1 (row 0): git_history, vibe_history, code_graph, documentation_linker (all parallel entry points)
const WORKFLOW_AGENTS = [
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
    description: 'Parses LSL session files to identify problem-solution pairs, extract development contexts, and discover workflow patterns from human-AI conversations.',
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
    description: 'Builds AST-based knowledge graph using Tree-sitter parsing. Uses external LLM (via code-graph-rag MCP) for Cypher query generation and RAG orchestration. Indexes functions, classes, imports, and call relationships into Memgraph.',
    usesLLM: true,
    llmModel: 'External: code-graph-rag (OpenAI/Anthropic/Ollama)',
    techStack: 'Tree-sitter + Memgraph + pydantic_ai',
    row: 0,
    col: 1.5,
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
    row: 3,
    col: 0.75,
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
    row: 4,
    col: 0.75,
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
    row: 5,
    col: 0.75,
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
    row: 5.5,
    col: 1.875,
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
    row: 6,
    col: 1.125,
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
    row: 7,
    col: 1.125,
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
    row: 8,
    col: 1.125,
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
    row: 9,
    col: 1.125,
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
// IMPORTANT: Must match actual workflow dependencies in coordinator.ts
// Phase 1 (Parallel entry points - no incoming edges): git_history, vibe_history, code_graph, documentation_linker
// Edge types: 'dependency' (solid) = must complete before next, 'dataflow' (dashed) = passes data/parameters
const WORKFLOW_EDGES: Array<{ from: string; to: string; type?: 'dependency' | 'dataflow' }> = [
  // Orchestrator dispatches to all entry points (dataflow - sends parameters)
  { from: 'orchestrator', to: 'git_history', type: 'dataflow' },
  { from: 'orchestrator', to: 'vibe_history', type: 'dataflow' },
  { from: 'orchestrator', to: 'code_graph', type: 'dataflow' },
  { from: 'orchestrator', to: 'documentation_linker', type: 'dataflow' },

  // Phase 1 -> Code Intelligence: Git, Vibe, and Code Graph feed intelligent queries
  { from: 'git_history', to: 'code_intelligence' },
  { from: 'vibe_history', to: 'code_intelligence' },
  { from: 'code_graph', to: 'code_intelligence' },  // After indexing, query for patterns

  // Phase 1 + Code Intel -> Phase 2: All sources + intelligence feed Semantic Analysis
  { from: 'git_history', to: 'semantic_analysis' },
  { from: 'vibe_history', to: 'semantic_analysis' },
  { from: 'code_graph', to: 'semantic_analysis' },  // index_codebase result feeds semantic
  { from: 'code_intelligence', to: 'semantic_analysis' },  // intelligent query results
  { from: 'documentation_linker', to: 'semantic_analysis' },  // link_documentation result feeds semantic

  // Phase 2 -> Phase 3: Semantic feeds Web Search
  { from: 'semantic_analysis', to: 'web_search' },

  // Phase 3 -> Phase 4: Semantic + Web + Code Intel feed Insights
  { from: 'semantic_analysis', to: 'insight_generation' },
  { from: 'web_search', to: 'insight_generation' },
  { from: 'code_intelligence', to: 'insight_generation' },  // Evidence-backed patterns

  // Phase 4 -> Phase 5: Insights -> Observations
  { from: 'insight_generation', to: 'observation_generation' },

  // Phase 5 -> Phase 6: Observations -> Ontology Classification
  { from: 'observation_generation', to: 'ontology_classification' },

  // Documentation Semantics - LLM analysis of docstrings and docs prose
  // Depends on: transform_code_entities (code_graph), link_documentation (documentation_linker)
  { from: 'code_graph', to: 'documentation_semantics' },  // transform_code_entities result
  { from: 'documentation_linker', to: 'documentation_semantics' },  // link_documentation result

  // Phase 6 + Doc Semantics -> Phase 7: All feed QA
  { from: 'ontology_classification', to: 'quality_assurance' },
  { from: 'documentation_semantics', to: 'quality_assurance' },  // doc semantics feeds QA

  // Phase 7 -> Phase 8: QA -> Persistence
  { from: 'quality_assurance', to: 'persistence' },

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
  type?: 'dependency' | 'dataflow'
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
function useWorkflowDefinitions() {
  const [agents, setAgents] = useState(WORKFLOW_AGENTS)
  const [orchestrator, setOrchestrator] = useState(ORCHESTRATOR_NODE)
  const [edges, setEdges] = useState(WORKFLOW_EDGES)
  const [stepToAgent, setStepToAgent] = useState(STEP_TO_AGENT)
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

          // Get edges from the first workflow (incremental-analysis by default)
          const incrementalWorkflow = data.data.workflows.find(w => w.name === 'incremental-analysis')
          if (incrementalWorkflow?.edges) {
            setEdges(incrementalWorkflow.edges)
          }

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

/**
 * Generates a semantic summary of step results based on the agent type.
 * Shows meaningful, human-readable descriptions of what the step produced.
 */
function StepResultSummary({ agentId, outputs }: { agentId: string; outputs: Record<string, any> }) {
  const getSummary = (): string | null => {
    switch (agentId) {
      case 'git_history':
        // Check all possible property names: commitsCount (coordinator summary), commitsAnalyzed (agent), commits array
        const commits = outputs.commitsCount || outputs.commitsAnalyzed || outputs.commits?.length || 0
        const files = outputs.filesCount || outputs.filesAnalyzed || outputs.files?.length || 0
        return `Analyzed ${commits} commits affecting ${files} files`

      case 'vibe_history':
        // Check all possible property names: sessionsCount (coordinator summary), sessionsAnalyzed (agent), sessions array
        const sessions = outputs.sessionsCount || outputs.sessionsAnalyzed || outputs.sessions?.length || 0
        const problemSolutions = outputs.problemSolutionPairs || outputs.pairs?.length || 0
        return `Processed ${sessions} sessions, found ${problemSolutions} problem-solution pairs`

      case 'semantic_analysis':
        const patterns = outputs.patternsFound || outputs.patterns?.length || 0
        const insights = outputs.insights?.length || outputs.insightsGenerated || 0
        return `Identified ${patterns} patterns with ${insights} semantic insights`

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

      case 'quality_assurance':
        const passed = outputs.passed || outputs.validationsPassed || 0
        const failed = outputs.failed || outputs.validationsFailed || 0
        const qaIterations = outputs.qaIterations || 1
        return qaIterations > 1
          ? `QA: ${passed} passed, ${failed} failed (after ${qaIterations} iterations)`
          : `QA: ${passed} passed, ${failed} failed`

      case 'persistence':
        const persisted = outputs.entitiesPersisted || outputs.entities?.length || 0
        const updated = outputs.entitiesUpdated || 0
        return `Persisted ${persisted} entities, updated ${updated}`

      case 'deduplication':
        const duplicates = outputs.duplicatesFound || outputs.duplicates?.length || 0
        const merged = outputs.entitiesMerged || 0
        return `Found ${duplicates} duplicates, merged ${merged} entities`

      case 'code_graph':
        // Check for failure/skip conditions first
        if (outputs.skipped || outputs.warning || outputs.skipReason) {
          const reason = outputs.skipReason || outputs.warning || 'Unknown reason'
          // Extract the key part of the error message
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
        const docsLinked = outputs.documentsLinked || outputs.linksCreated || outputs.documents?.length || 0
        const unresolvedRefs = outputs.unresolvedReferences || 0
        return unresolvedRefs > 0
          ? `Linked ${docsLinked} documents (${unresolvedRefs} unresolved references)`
          : `Linked ${docsLinked} documents to code entities`

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

  const entries = Object.entries(outputs).filter(([key]) => !key.startsWith('_'))

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
  const { agents: WORKFLOW_AGENTS, orchestrator: ORCHESTRATOR_NODE, edges: WORKFLOW_EDGES, stepToAgent: STEP_TO_AGENT, isLoading: definitionsLoading } = useWorkflowDefinitions()

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
    // Include _refreshKey to force recalculation when API returns new data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process.steps, process.currentStep, STEP_TO_AGENT, (process as any)._refreshKey])

  const getNodeStatus = (agentId: string): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' => {
    const stepInfo = stepStatusMap[agentId]
    if (stepInfo) return stepInfo.status

    // If no step info exists for this agent:
    // - If workflow is complete (100%), the agent was not part of this workflow -> 'skipped'
    // - If workflow is still running, the agent hasn't started yet -> 'pending'
    const isWorkflowComplete = process.completedSteps >= process.totalSteps && process.totalSteps > 0
    return isWorkflowComplete ? 'skipped' : 'pending'
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
  // Layout: Orchestrator at row -1, then 4 parallel entry nodes in row 0, then converging down
  const nodeWidth = 100
  const nodeHeight = 55
  const horizontalGap = 30
  const verticalGap = 15
  // Grid width: 3 columns (col 0, 1.125, 2.25) = max col 2.25 + 1 node width
  const gridWidth = nodeWidth * 3.5 + horizontalGap * 2.5
  // Add extra row at top for orchestrator (row -1 becomes row 0 in rendering)
  const gridHeight = (nodeHeight + verticalGap) * 11  // 11 rows: -1 to 9
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
            </defs>

            {/* Edges */}
            {WORKFLOW_EDGES.map((edge, idx) => {
              // Handle orchestrator as source
              const fromAgent = edge.from === 'orchestrator'
                ? ORCHESTRATOR_NODE
                : WORKFLOW_AGENTS.find(a => a.id === edge.from)
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
              const fromStatus = edge.from === 'orchestrator'
                ? (process.status === 'running' ? 'running' : 'completed')
                : getNodeStatus(edge.from)
              const toStatus = getNodeStatus(edge.to)
              const isActive = fromStatus === 'completed' && toStatus === 'running'
              const isCompleted = fromStatus === 'completed' && toStatus === 'completed'

              // Different colors for dependency vs dataflow edges
              const isDataflow = edge.type === 'dataflow'
              const strokeColor = isActive ? '#3b82f6' : isCompleted ? '#22c55e' : isDataflow ? '#a855f7' : '#cbd5e1'
              const strokeWidth = isActive ? 2 : 1.5
              const markerEnd = isActive ? 'url(#arrowhead-active)' : isDataflow ? 'url(#arrowhead-dataflow)' : 'url(#arrowhead)'
              const strokeDasharray = isDataflow ? '4,2' : undefined

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
                    strokeDasharray={strokeDasharray}
                    markerEnd={markerEnd}
                    className={isActive ? 'animate-pulse' : ''}
                  />
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
              const progressPercent = process.totalSteps > 0
                ? Math.round((process.completedSteps / process.totalSteps) * 100)
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
                            {process.completedSteps}/{process.totalSteps} steps
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
        <div className="flex-shrink-0 w-28 bg-white/90 backdrop-blur-sm rounded-lg p-2 border shadow-sm self-end">
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
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 bg-slate-400" />
              <span>Dependency</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 border-t-2 border-dashed border-purple-500" />
              <span>Data Flow</span>
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

  const progressPercent = process.totalSteps > 0
    ? Math.round((process.completedSteps / process.totalSteps) * 100)
    : 0

  // Calculate total duration from steps
  const totalDuration = process.steps?.reduce((acc, step) => acc + (step.duration || 0), 0) || 0

  // Group steps by status
  const completedSteps = process.steps?.filter(s => s.status === 'completed') || []
  const failedSteps = process.steps?.filter(s => s.status === 'failed') || []
  const runningSteps = process.steps?.filter(s => s.status === 'running') || []
  const pendingSteps = process.steps?.filter(s => s.status === 'pending') || []
  const skippedSteps = process.steps?.filter(s => s.status === 'skipped') || []

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
            DAG-based workflow coordinator. Manages parallel execution with max 3 concurrent steps,
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
              <span className="text-xs">TypeScript DAG</span>
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
  onClose
}: {
  agentId: string
  process: ProcessInfo
  onClose: () => void
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
    // If workflow is complete but agent has no step info, it wasn't part of this workflow
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

        {/* Results Summary - show stats and key outcomes */}
        {stepInfo?.outputs && Object.keys(stepInfo.outputs).filter(k => !k.startsWith('_')).length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-1">
                <Zap className="h-3 w-3" />
                Results
              </h4>
              {/* Semantic Summary based on agent type */}
              <StepResultSummary agentId={agentId} outputs={stepInfo.outputs} />
              {/* Detailed Results with expandable sections */}
              <StepResultDetails outputs={stepInfo.outputs} />
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
