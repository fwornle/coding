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

// Step name to agent ID mapping
export const STEP_TO_AGENT: Record<string, string> = {
  // Batch workflow steps
  'plan_batches': 'batch_scheduler',
  'extract_batch_commits': 'git_history',
  'extract_batch_sessions': 'vibe_history',
  'batch_semantic_analysis': 'semantic_analysis',
  'generate_batch_observations': 'observation_generation',  // NEW: batch phase observation generation
  'classify_with_ontology': 'ontology_classification',
  'operator_conv': 'context_convolution',
  'operator_aggr': 'entity_aggregation',
  'operator_embed': 'node_embedding',
  'operator_dedup': 'deduplication_operator',
  'operator_pred': 'edge_prediction',
  'operator_merge': 'structure_merge',
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
  { from: 'batch_scheduler', to: 'vibe_history', type: 'dataflow' },
  { from: 'git_history', to: 'semantic_analysis', type: 'dataflow' },
  { from: 'vibe_history', to: 'semantic_analysis', type: 'dataflow' },
  { from: 'semantic_analysis', to: 'observation_generation', type: 'dataflow' },  // NEW: semantic → observations
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
