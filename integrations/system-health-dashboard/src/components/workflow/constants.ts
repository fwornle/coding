// Workflow visualization constants
// Multi-agent system with hub-and-spoke architecture
// NOT a linear DAG - orchestrators connect to all agents

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
  Zap,
  Play,
  Calendar,
  Network,
  Save,
  RotateCcw,
} from 'lucide-react'
import type { AgentDefinition, EdgeDefinition } from './types'

// Icon mapping for dynamic agent definitions from YAML
export const ICON_MAP: Record<string, typeof GitBranch> = {
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
  Calendar,
  Network,
  Save,
  RotateCcw,
}

// Orchestrator node - central hub that manages ALL agents
export const ORCHESTRATOR_NODE: AgentDefinition = {
  id: 'orchestrator',
  name: 'SmartOrchestrator',
  shortName: 'Coordinator',
  icon: Play,
  description: 'Central coordinator that manages ALL agents. Can start, stop, and retry any agent. Uses LLM-powered routing decisions with confidence scoring. Handles parallel execution, dependencies, and semantic retry guidance.',
  usesLLM: true,
  llmModel: 'Groq: llama-3.3-70b-versatile',
  techStack: 'Multi-Agent Orchestrator',
  row: 0,
  col: 0,  // Center position in hub layout
  isOrchestrator: true,
  canRetry: ['all'],  // Can retry any agent
}

// All agents in the multi-agent system
// Layout uses radial positioning around the central orchestrator
export const WORKFLOW_AGENTS: AgentDefinition[] = [
  // === QUALITY ASSURANCE ===
  {
    id: 'quality_assurance',
    name: 'Quality Assurance',
    shortName: 'QA',
    icon: Shield,
    description: 'Validates all outputs and provides quality feedback to the Orchestrator. Uses LLM-powered quality scoring. Focuses on overarching quality aspects not covered by individual agents.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer + Semantic Value Filter',
    row: 3,
    col: 0,
  },

  // === BATCH PROCESSING AGENTS ===
  {
    id: 'batch_scheduler',
    name: 'Batch Scheduler',
    shortName: 'Batch',
    icon: Calendar,
    description: 'Plans and tracks chronological batch windows. Divides git history into 50-commit batches for incremental processing with checkpoint-based resumption.',
    usesLLM: false,
    llmModel: null,
    techStack: 'Git CLI + Checkpoint Manager',
    row: 1,
    col: 0,
  },
  {
    id: 'batch_checkpoint_manager',
    name: 'Batch Checkpoint',
    shortName: 'Checkpoint',
    icon: Save,
    description: 'Per-batch checkpoint state management. Tracks completed batches, operator results, and supports resumption from any batch.',
    usesLLM: false,
    llmModel: null,
    techStack: 'JSON file persistence',
    row: 1,
    col: 1,
  },

  // === DATA EXTRACTION AGENTS ===
  {
    id: 'git_history',
    name: 'Git History',
    shortName: 'Git',
    icon: GitBranch,
    description: 'Analyzes commit history via git CLI with LLM-powered pattern extraction. Identifies code evolution patterns, development themes, and architectural decisions.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Git CLI + SemanticAnalyzer',
    row: 2,
    col: 0,
  },
  {
    id: 'vibe_history',
    name: 'Vibe History',
    shortName: 'Vibe',
    icon: MessageSquare,
    description: 'Parses LSL session files to identify problem-solution pairs, extract development contexts, and discover workflow patterns.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 2,
    col: 1,
  },

  // === ANALYSIS AGENTS ===
  {
    id: 'semantic_analysis',
    name: 'Semantic Analysis',
    shortName: 'Semantic',
    icon: Brain,
    description: 'Deep code analysis to detect patterns (MVC, Factory, Observer, etc.), assess quality metrics, and generate LLM-powered insights.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Direct LLM clients',
    row: 3,
    col: 0,
  },
  {
    id: 'ontology_classification',
    name: 'Ontology Classification',
    shortName: 'Ontology',
    icon: Tags,
    description: 'Maps entities to ontology classes using LLM-powered semantic inference. Assigns categories, properties, and confidence scores.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'OntologyClassifier + SemanticAnalyzer',
    row: 3,
    col: 1,
  },
  {
    id: 'kg_operators',
    name: 'KG Operators',
    shortName: 'KG-Ops',
    icon: Network,
    description: 'Tree-KG inspired operators for incremental knowledge graph expansion. Implements conv, aggr, embed, dedup, pred, merge operators.',
    usesLLM: true,
    llmModel: 'Multi-tier: fast/standard/premium per operator',
    techStack: 'SemanticAnalyzer + Embeddings',
    row: 4,
    col: 0,
  },
  // Individual KG Operators (for step-level display in trace)
  {
    id: 'context_convolution',
    name: 'Context Convolution',
    shortName: 'Conv',
    icon: Network,
    description: 'KG Operator: Aggregates context from neighboring nodes to enrich entity representations.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Graph traversal + SemanticAnalyzer',
    row: 4,
    col: 0,
  },
  {
    id: 'entity_aggregation',
    name: 'Entity Aggregation',
    shortName: 'Aggr',
    icon: Network,
    description: 'KG Operator: Merges similar entities based on semantic similarity and structural patterns.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Similarity matching + SemanticAnalyzer',
    row: 4,
    col: 0,
  },
  {
    id: 'node_embedding',
    name: 'Node Embedding',
    shortName: 'Embed',
    icon: Network,
    description: 'KG Operator: Generates vector embeddings for nodes to enable semantic search.',
    usesLLM: false,
    llmModel: 'text-embedding-3-small',
    techStack: 'OpenAI Embeddings API',
    row: 4,
    col: 0,
  },
  {
    id: 'deduplication_operator',
    name: 'KG Deduplication',
    shortName: 'KG-Dedup',
    icon: Network,
    description: 'KG Operator: Removes duplicate entities based on embedding similarity.',
    usesLLM: false,
    llmModel: 'Cosine similarity on embeddings',
    techStack: 'Vector comparison',
    row: 4,
    col: 0,
  },
  {
    id: 'edge_prediction',
    name: 'Edge Prediction',
    shortName: 'Pred',
    icon: Network,
    description: 'KG Operator: Predicts new relationships between entities using semantic inference.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer + Graph patterns',
    row: 4,
    col: 0,
  },
  {
    id: 'structure_merge',
    name: 'Structure Merge',
    shortName: 'Merge',
    icon: Network,
    description: 'KG Operator: Merges new knowledge into existing graph structure with conflict resolution.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Graphology merge operations',
    row: 4,
    col: 0,
  },

  // === CODE GRAPH AGENTS ===
  {
    id: 'code_graph',
    name: 'Code Graph',
    shortName: 'Code',
    icon: Code,
    description: 'Builds AST-based knowledge graph using Tree-sitter parsing. Indexes functions, classes, imports, and call relationships into Memgraph.',
    usesLLM: true,
    llmModel: 'External: code-graph-rag (OpenAI/Anthropic/Ollama)',
    techStack: 'Tree-sitter + Memgraph + pydantic_ai',
    row: 4,
    col: 1,
  },
  {
    id: 'code_intelligence',
    name: 'Code Intelligence',
    shortName: 'Intel',
    icon: Zap,
    description: 'Generates context-aware questions about the codebase. Queries the code graph via NL→Cypher to discover hotspots and dependencies.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'NL→Cypher + Memgraph + SemanticAnalyzer',
    row: 5,
    col: 0,
  },

  // === DOCUMENTATION AGENTS ===
  {
    id: 'documentation_linker',
    name: 'Documentation Linker',
    shortName: 'Docs',
    icon: FileText,
    description: 'Links markdown docs and PlantUML diagrams to code entities using LLM-powered semantic matching.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'Regex + glob patterns + SemanticAnalyzer',
    row: 5,
    col: 1,
  },
  {
    id: 'web_search',
    name: 'Web Search',
    shortName: 'Web',
    icon: Search,
    description: 'Searches for similar patterns, code examples, and documentation using DuckDuckGo/Google.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile (optional)',
    techStack: 'DuckDuckGo/Google APIs + SemanticAnalyzer',
    row: 6,
    col: 0,
  },

  // === INSIGHT GENERATION AGENTS ===
  {
    id: 'insight_generation',
    name: 'Insight Generation',
    shortName: 'Insights',
    icon: Lightbulb,
    description: 'Generates comprehensive insights, PlantUML architecture diagrams, and design pattern documentation.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 6,
    col: 1,
  },
  {
    id: 'observation_generation',
    name: 'Observation Generation',
    shortName: 'Observations',
    icon: Eye,
    description: 'Creates structured observations: pattern observations, problem-solution pairs, architectural decisions.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 7,
    col: 0,
  },

  // === PERSISTENCE AGENTS ===
  {
    id: 'persistence',
    name: 'Persistence',
    shortName: 'Persist',
    icon: Database,
    description: 'Manages entity CRUD operations, checkpoint tracking, and bi-temporal staleness detection.',
    usesLLM: false,
    llmModel: null,
    techStack: 'LevelDB + Graphology',
    row: 7,
    col: 1,
  },
  {
    id: 'deduplication',
    name: 'Deduplication',
    shortName: 'Dedup',
    icon: Copy,
    description: 'Detects duplicate entities using cosine/semantic similarity on embeddings. Merges similar entities.',
    usesLLM: false,
    llmModel: 'Embeddings: text-embedding-3-small',
    techStack: 'OpenAI Embeddings API',
    row: 8,
    col: 0,
  },
  {
    id: 'content_validation',
    name: 'Content Validation',
    shortName: 'Validate',
    icon: CheckCircle2,
    description: 'Validates entity accuracy against current codebase. Detects git-based staleness and regenerates stale content.',
    usesLLM: true,
    llmModel: 'Groq: llama-3.3-70b-versatile',
    techStack: 'SemanticAnalyzer',
    row: 8,
    col: 1,
  },
]

/**
 * Step name to agent ID mapping
 *
 * @deprecated This hardcoded mapping is a fallback for when YAML definitions
 * haven't loaded yet. Prefer using useWorkflowDefinitions() hook which loads
 * mappings from the server's agents.yaml configuration.
 *
 * The event-driven architecture (ukbSlice.execution) should be the primary
 * source of truth for step statuses during workflow execution.
 */
export const STEP_TO_AGENT: Record<string, string> = {
  // Batch workflow steps
  'plan_batches': 'batch_scheduler',
  'extract_batch_commits': 'git_history',
  'extract_batch_sessions': 'vibe_history',
  'batch_semantic_analysis': 'semantic_analysis',
  'generate_batch_observations': 'observation_generation',  // NEW: batch phase observation generation
  'classify_with_ontology': 'ontology_classification',
  // Runtime substeps (from batch workflow YAML) mapped to their parent agent
  'sem_data_prep': 'semantic_analysis',
  'sem_llm_analysis': 'semantic_analysis',
  'sem_observation_gen': 'semantic_analysis',
  'sem_entity_transform': 'semantic_analysis',
  'obs_llm_generate': 'observation_generation',
  'obs_accumulate': 'observation_generation',
  'onto_data_prep': 'ontology_classification',
  'onto_llm_classify': 'ontology_classification',
  'onto_apply_results': 'ontology_classification',
  'operator_conv': 'kg_operators',
  'operator_aggr': 'kg_operators',
  'operator_embed': 'kg_operators',
  'operator_dedup': 'kg_operators',
  'operator_pred': 'kg_operators',
  'operator_merge': 'kg_operators',
  'batch_qa': 'quality_assurance',
  'save_batch_checkpoint': 'batch_checkpoint_manager',
  'index_codebase': 'code_graph',
  'link_documentation': 'documentation_linker',  // NEW: finalization phase doc linking
  'synthesize_code_insights': 'code_graph',
  'correlate_with_codebase': 'code_graph',
  'transform_code_entities': 'code_graph',
  'final_persist': 'persistence',
  'generate_insights': 'insight_generation',
  'final_dedup': 'deduplication',
  'final_validation': 'content_validation',
  // Complete/incremental workflow steps
  'git_history': 'git_history',
  'vibe_history': 'vibe_history',
  'semantic_analysis': 'semantic_analysis',
  'web_search': 'web_search',
  'insight_generation': 'insight_generation',
  'observation_generation': 'observation_generation',
  'ontology_classification': 'ontology_classification',
  'code_graph': 'code_graph',
  'code_intelligence': 'code_intelligence',
  'documentation_linker': 'documentation_linker',
  'quality_assurance': 'quality_assurance',
  'persistence': 'persistence',
  'deduplication': 'deduplication',
  'content_validation': 'content_validation',
}

/**
 * Map step names to their sub-step within an agent
 * Used to highlight the currently active sub-step in the multi-agent graph
 *
 * @deprecated This hardcoded mapping is a fallback for when YAML definitions
 * haven't loaded yet. Prefer using useWorkflowDefinitions() hook which loads
 * substep_id_mappings from the server's agents.yaml configuration.
 *
 * The event-driven architecture (ukbSlice.execution.substepStatuses) should be
 * the primary source of truth for substep statuses during workflow execution.
 */
export const STEP_TO_SUBSTEP: Record<string, string> = {
  // code_graph agent sub-steps (runtime substeps)
  // NOTE: Parent step 'code_graph' intentionally NOT mapped
  'index_codebase': 'index',
  'correlate_with_codebase': 'query',
  'synthesize_code_insights': 'analyze',
  'transform_code_entities': 'analyze',
  // semantic_analysis agent sub-steps (runtime substeps from batch YAML)
  // NOTE: Parent steps (semantic_analysis, batch_semantic_analysis) intentionally NOT mapped
  // to avoid incorrectly highlighting a substep when the parent is running but no substep has started
  'sem_data_prep': 'parse',
  'sem_llm_analysis': 'extract',
  'sem_observation_gen': 'relate',
  'sem_entity_transform': 'enrich',
  // observation_generation agent sub-steps (runtime substeps)
  // NOTE: Parent steps intentionally NOT mapped (same reason as semantic_analysis)
  'obs_llm_generate': 'generate',
  'obs_accumulate': 'accumulate',
  // kg_operators agent sub-steps
  'operator_conv': 'conv',
  'operator_aggr': 'aggr',
  'operator_embed': 'embed',
  'operator_dedup': 'dedup',
  'operator_pred': 'pred',
  'operator_merge': 'merge',
  // ontology_classification agent sub-steps (runtime substeps)
  // NOTE: Parent steps intentionally NOT mapped (same reason as semantic_analysis)
  'onto_data_prep': 'match',
  'onto_llm_classify': 'validate',
  'onto_apply_results': 'extend',
  // persistence agent - no substeps to map (single-step agent)
}

// Multi-agent system edges
// This is NOT a DAG - orchestrators connect to all agents
export const MULTI_AGENT_EDGES: EdgeDefinition[] = [
  // === ORCHESTRATOR HUB CONNECTIONS ===
  // Coordinator can start ANY agent (hub-and-spoke)
  { from: 'orchestrator', to: 'batch_scheduler', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'git_history', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'vibe_history', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'semantic_analysis', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'ontology_classification', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'kg_operators', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'code_graph', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'code_intelligence', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'documentation_linker', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'web_search', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'insight_generation', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'observation_generation', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'quality_assurance', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'persistence', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'deduplication', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'content_validation', type: 'control', label: 'start' },
  { from: 'orchestrator', to: 'batch_checkpoint_manager', type: 'control', label: 'start' },

  // === ALL AGENTS PROVIDE FEEDBACK TO ORCHESTRATOR ===
  // Every agent reports status/results back to Orchestrator for coordination
  { from: 'batch_scheduler', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'batch_checkpoint_manager', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'git_history', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'vibe_history', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'semantic_analysis', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'ontology_classification', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'kg_operators', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'code_graph', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'code_intelligence', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'documentation_linker', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'web_search', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'insight_generation', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'observation_generation', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'quality_assurance', to: 'orchestrator', type: 'retry', label: 'quality feedback' },
  { from: 'persistence', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'deduplication', to: 'orchestrator', type: 'retry', label: 'feedback' },
  { from: 'content_validation', to: 'orchestrator', type: 'retry', label: 'feedback' },

  // === DATA FLOW EDGES (typical processing sequence) ===
  // These show the TYPICAL flow, but orchestrators can override
  // BATCH PHASE: Extraction → Analysis → Observations → Classification → Operators
  { from: 'batch_scheduler', to: 'git_history', type: 'dataflow' },
  { from: 'git_history', to: 'vibe_history', type: 'dataflow' },  // vibe needs git commit dates
  { from: 'git_history', to: 'semantic_analysis', type: 'dataflow' },
  { from: 'vibe_history', to: 'semantic_analysis', type: 'dataflow' },
  { from: 'semantic_analysis', to: 'observation_generation', type: 'dataflow' },  // semantic → observations
  { from: 'observation_generation', to: 'ontology_classification', type: 'dataflow' },  // observations → classification
  { from: 'ontology_classification', to: 'kg_operators', type: 'dataflow' },
  { from: 'kg_operators', to: 'quality_assurance', type: 'dataflow' },
  { from: 'quality_assurance', to: 'batch_checkpoint_manager', type: 'dataflow' },
  // FINALIZATION PHASE: Code Graph + Doc Linker → Persistence → Insights → Web → Dedup → Validate
  { from: 'batch_checkpoint_manager', to: 'code_graph', type: 'dataflow' },
  { from: 'batch_checkpoint_manager', to: 'documentation_linker', type: 'dataflow' },  // NEW: parallel to code_graph
  { from: 'documentation_linker', to: 'code_graph', type: 'dataflow', label: 'doc links' },  // docs feed into code_graph
  { from: 'code_graph', to: 'persistence', type: 'dataflow' },
  { from: 'persistence', to: 'insight_generation', type: 'dataflow' },
  { from: 'insight_generation', to: 'web_search', type: 'dataflow' },  // NEW: insights → web search
  { from: 'web_search', to: 'deduplication', type: 'dataflow' },  // web search → dedup
  { from: 'deduplication', to: 'content_validation', type: 'dataflow' },
]

// Linear workflow edges (for when API provides DAG-style workflow)
export const LINEAR_WORKFLOW_EDGES: EdgeDefinition[] = [
  // This is kept for backward compatibility with API-provided edges
  // The multi-agent view should use MULTI_AGENT_EDGES instead
]

// Visualization modes
export type VisualizationMode = 'multi-agent' | 'dataflow' | 'execution'

// Layout configuration for different visualization modes
export const LAYOUT_CONFIG = {
  'multi-agent': {
    // Hub-and-spoke layout with orchestrators in center
    nodeWidth: 100,
    nodeHeight: 60,
    horizontalSpacing: 140,
    verticalSpacing: 80,
    padding: 60,
  },
  'dataflow': {
    // Traditional DAG-style layout
    nodeWidth: 90,
    nodeHeight: 50,
    horizontalSpacing: 120,
    verticalSpacing: 70,
    padding: 40,
  },
  'execution': {
    // Timeline-based layout
    nodeWidth: 80,
    nodeHeight: 45,
    horizontalSpacing: 100,
    verticalSpacing: 60,
    padding: 30,
  },
}

// LLM tier color classes for consistent badge/bar styling
// Used by trace-modal and ukb-workflow-modal
export const TIER_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  fast:     { bg: 'bg-green-500',  text: 'text-white', bar: 'bg-green-500' },
  standard: { bg: 'bg-blue-500',   text: 'text-white', bar: 'bg-blue-500' },
  premium:  { bg: 'bg-purple-500', text: 'text-white', bar: 'bg-purple-500' },
  none:     { bg: 'bg-gray-200',   text: 'text-gray-600', bar: 'bg-gray-300' },
}

// Sub-step definitions for agents with multiple internal operations
// MOVED HERE from multi-agent-graph.tsx to avoid circular imports
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
