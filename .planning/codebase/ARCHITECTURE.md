# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Modular multi-agent framework with layered knowledge system

**Key Characteristics:**
- **Agent-agnostic abstraction** - Single unified API for Claude Code, GitHub Copilot, and extensible to other agents
- **Layered knowledge system** - Ontology-driven semantic analysis with hybrid LLM + heuristic classification
- **MCP-based workflow orchestration** - Semantic analysis runs as pluggable MCP (Model Context Protocol) servers
- **Storage-agnostic data layer** - Knowledge persisted in graph databases (Graphology + LevelDB) and file-based JSON with team scoping
- **Real-time session logging** - Live session logging (LSL) captures agent interactions with zero-latency constraint monitoring
- **Extensible provider pattern** - LLM provider registry supports multiple backends (Anthropic, OpenAI, Google, Groq) with circuit breaking and caching

## Layers

**Agent Layer (Adapter):**
- Purpose: Provide unified interface across different coding agents (Claude Code, GitHub Copilot, OpenCode)
- Location: `lib/agent-api/adapters/`, `lib/agent-api/base-adapter.js`
- Contains: Agent-specific adapter implementations (claude-adapter.js, copilot-adapter.js), hook system, transcript parsing
- Depends on: Hooks API, Transcript API, Statusline API
- Used by: CLI launcher scripts, workspace management

**Hooks & Events Layer:**
- Purpose: Pre/post-execution hooks for tool calls, code execution, and file modifications
- Location: `lib/agent-api/hooks/`, `lib/agent-api/hooks-api.js`
- Contains: Hook manager, event mappings, CoPilot bridge handler, migration tooling
- Depends on: Agent adapter (for context)
- Used by: Constraint monitor, session logging, knowledge capture

**Workflow Orchestration Layer:**
- Purpose: Coordinate semantic analysis via MCP servers with retry logic and error recovery
- Location: `lib/ukb-unified/core/WorkflowOrchestrator.js`, `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts`
- Contains: Workflow execution (incremental/full analysis), MCP tool invocation abstraction, progress tracking
- Depends on: MCP semantic-analysis server, config manager, team checkpoint manager
- Used by: UKB CLI, knowledge management operations

**Semantic Analysis Layer:**
- Purpose: Multi-stage LLM-based code analysis (parsing, classification, deduplication, insight generation)
- Location: `integrations/mcp-server-semantic-analysis/src/agents/`, `src/ontology/`
- Contains:
  - SemanticAnalysisAgent (code understanding)
  - OntologyClassifier (hybrid LLM + heuristic entity classification)
  - DeduplicationAgent (merge similar entities)
  - InsightGenerationAgent (reasoning about patterns)
  - ContentValidationAgent (entity refresh and consistency)
- Depends on: Unified inference engine, ontology manager, graph database adapter
- Used by: Workflow runner, knowledge system

**Ontology Layer:**
- Purpose: Manage upper and lower ontologies with team-specific extensions
- Location: `src/ontology/`, `integrations/mcp-server-semantic-analysis/src/ontology/`
- Contains:
  - OntologyManager (load/resolve entities with inheritance)
  - OntologyClassifier (classify text into entity types)
  - OntologyValidator (schema validation)
  - OntologyQueryEngine (entity/relationship querying)
  - HeuristicClassifier (pattern-based classification without LLM)
- Depends on: Entity type definitions (JSON), LLM service, validation schemas
- Used by: Semantic analysis agents, knowledge system

**Knowledge Management Layer:**
- Purpose: Persist and query semantic knowledge (entities, relations, insights)
- Location: `lib/knowledge-api/`, `src/knowledge-management/`
- Contains:
  - EntityManager (create, update, query entities)
  - RelationManager (create, query relationships between entities)
  - InsightProcessor (generate insights from entity patterns)
  - FileStorageAdapter (JSON file persistence with team scoping)
  - MultiFileStorageAdapter (per-team file storage)
- Depends on: Validation service, storage adapters, logging
- Used by: Semantic analysis agents, knowledge API consumers

**Graph Database Layer:**
- Purpose: Store and query knowledge graph (Graphology + LevelDB)
- Location: `src/knowledge-management/GraphDatabaseService.d.ts`, `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`
- Contains: Graph node/edge management, graph queries (traversal, similarity), persistence to LevelDB
- Depends on: Graphology library, LevelDB, file system
- Used by: Knowledge management, code graph analysis

**LLM Service Layer:**
- Purpose: Unified LLM access with provider routing, caching, circuit breaking, and budget tracking
- Location: `lib/llm/`
- Contains:
  - LLMService (main facade)
  - ProviderRegistry (manage multiple LLM backends)
  - CircuitBreaker (fail fast on provider errors)
  - LLMCache (result caching by prompt)
  - MetricsTracker (usage tracking)
  - SDK loaders (lazy-load provider SDKs)
- Depends on: Provider SDKs (Anthropic, OpenAI, Google, Groq), config
- Used by: Semantic analysis agents, inference engine

**Session Logging Layer:**
- Purpose: Capture all agent interactions and code changes in real-time with zero-latency constraints
- Location: `lib/agent-api/transcript-api.js`, `src/live-logging/`, `lib/logging/`
- Contains:
  - TranscriptAdapter (read/parse agent session logs)
  - LSL entry types (code, tool call, file change, constraint event)
  - Session coordinator (synchronize across agents)
  - Logger abstraction (centralized logging)
- Depends on: Agent adapters, constraint monitor, file system
- Used by: Knowledge capture, audit trails, workflow input

**Integration/Tools Layer:**
- Purpose: Connect to external systems (browser automation, code analysis, database access)
- Location: `integrations/`
- Contains:
  - browser-access (Playwright automation)
  - code-graph-rag (semantic code search via graph)
  - copi (CoPilot CLI integration)
  - llm-cli-proxy (command-line LLM access)
  - mcp-constraint-monitor (real-time guardrails)
  - serena (code search/navigation)
- Depends on: MCP SDK, external service SDKs
- Used by: Agent adapters, workflow orchestration

## Data Flow

**Knowledge Capture Flow:**

1. **Session Recording** - TranscriptAdapter reads agent session logs (Claude Code transcript or CoPilot pipe-pane capture)
2. **Session Parsing** - LSL converter transforms raw logs into structured LSLEntry objects (code blocks, tool calls, file changes)
3. **Knowledge Extraction** - Semantic analysis agents process parsed sessions to identify entities, patterns, and relationships
4. **Ontology Classification** - OntologyClassifier maps extracted concepts to defined entity types using hybrid LLM + heuristics
5. **Deduplication** - DeduplicationAgent merges similar entities and resolves duplicates
6. **Insight Generation** - InsightGenerationAgent reasons about patterns and generates higher-level insights
7. **Persistence** - Knowledge API stores entities/relations in graph database and JSON files
8. **Querying** - Knowledge consumers query via EntityManager/RelationManager or OntologyQueryEngine

**Workflow Execution Flow:**

1. **Trigger** - UKB CLI invokes `executeBatchAnalysis()` with scope (repository, commits, sessions)
2. **Gap Analysis** - TeamCheckpointManager calculates what has changed since last checkpoint
3. **Workflow Invocation** - WorkflowOrchestrator calls `mcp__semantic-analysis__execute_workflow` tool (MCP)
4. **Routing** - MCP server (stdio or SSE) routes to WorkflowRunner with workflow name (incremental-analysis, complete-analysis, batch-analysis)
5. **Agent Chain** - WorkflowRunner executes agent chain: SemanticAnalysisAgent → OntologyClassifier → DeduplicationAgent → InsightGenerationAgent → ContentValidationAgent
6. **Storage** - PersistenceAgent writes results to graph database and file system
7. **Progress** - Server sends logging messages back to Claude Code for real-time status
8. **Checkpoint** - Completion updates team checkpoint so next run only processes new changes

**LLM Provider Selection Flow:**

1. **Request** - Semantic agent calls `completionWithOptions()` on LLM service
2. **Mode Resolution** - Mode resolver determines current mode (mock/local/public) based on environment
3. **Cache Lookup** - LLMCache checks if same prompt was recently processed
4. **Circuit Breaker Check** - CircuitBreaker verifies provider hasn't failed threshold
5. **Budget Check** - BudgetTracker validates request is within cost limits
6. **Provider Selection** - ProviderRegistry returns best available provider (respects priority: claude-code subscription > copilot subscription > public fallback)
7. **Execution** - Selected provider SDK executes completion
8. **Caching** - Result cached and metrics recorded
9. **Return** - Completion result returned to caller

**State Management:**

- **Team Checkpoints** - Stored in `.data/knowledge-graph/checkpoints/<team>.json`, track last analyzed commit/session
- **Workflow Progress** - Real-time stored in `.data/workflow-progress.json`, consumed by dashboard
- **Ontology Cache** - OntologyManager caches loaded ontologies in memory, reloads from disk on changes
- **Graph Database** - Graphology in-memory graph with Level persistence, auto-flushes on dirty flag
- **LSL Session History** - Stored in `.specstory/history/YYYY-MM-DD_*.md`, indexed by timestamp

## Key Abstractions

**Adapter Pattern (BaseAdapter):**
- Purpose: Unify different agent implementations behind a single interface
- Examples: `lib/agent-api/adapters/claude-adapter.js`, `lib/agent-api/adapters/copilot-adapter.js`
- Pattern: Subclass BaseAdapter, implement `initialize()`, `getHooksManager()`, `getStatuslineProvider()`, `getTranscriptAdapter()`
- Allows: Easy addition of new agents without touching core logic

**Hooks System (HooksManager):**
- Purpose: Intercept and react to agent events (PRE_TOOL, POST_TOOL, PRE_COMMAND, etc.)
- Examples: Constraint checking (mcp-constraint-monitor), session logging (LSL), knowledge capture (semantic analysis)
- Pattern: Register hook handler for event type, receives context (tool/command details), returns allow/deny decision
- Allows: Decoupled business logic from agent implementation

**Unified Inference Engine:**
- Purpose: Abstract away LLM provider differences
- Examples: Used by OntologyClassifier, SemanticAnalysisAgent, InsightGenerationAgent
- Pattern: Call `await inference.generate(prompt, options)` without knowing which provider executes
- Allows: Seamless provider swapping, multi-provider fallback, mock mode for testing

**Team Scoping:**
- Purpose: Isolate knowledge by team (coding, ui-design, architecture-review, etc.)
- Examples: Lower ontologies per team, knowledge stored under `<team>:` namespace, checkpoints per team
- Pattern: Pass `team` parameter through all persistence calls, EntityManager prefixes entity IDs
- Allows: Multi-team knowledge systems without data leakage

**Provider Registry Pattern:**
- Purpose: Manage multiple LLM backends with priority ordering
- Examples: ProviderRegistry in `lib/llm/provider-registry.ts`, SDK loaders
- Pattern: Define provider priority (subscription > local > public), lazy-load SDKs, fallback on failure
- Allows: Zero-cost operation (use existing Claude Code/CoPilot subscriptions), graceful degradation

## Entry Points

**CLI Entry Point (coding command):**
- Location: `bin/coding`
- Triggers: User invokes `coding` or `coding --claude`
- Responsibilities: Agent detection, project directory resolution, agent config loading, service startup (LSL coordinator, constraint monitor), tmux session launch
- Flow: Detect agent → validate config → export environment → execute launch script

**Agent Launcher (launch-generic.sh / launch-claude.sh):**
- Location: `scripts/launch-generic.sh`, `scripts/launch-claude.sh`
- Triggers: Executed by bin/coding after agent selection
- Responsibilities: Start MCP servers (or SSE proxy in Docker), initialize services, launch agent in tmux
- Environment: Sets CODING_AGENT, CODING_TOOLS_PATH, MCP config path

**MCP Server Entry Point:**
- Location: `integrations/mcp-server-semantic-analysis/src/index.ts`
- Triggers: Spawned by Claude Code MCP configuration or Docker SSE proxy
- Responsibilities: Initialize server, register tools (execute_workflow, test_connection), handle graceful shutdown
- Flow: Setup logging → create server instance → register tools → start stdio transport

**UKB CLI Entry Point:**
- Location: `lib/ukb-unified/cli.js`
- Triggers: User invokes `ukb`, `ukb full`, `ukb full debug`
- Responsibilities: Parse arguments, load config, invoke WorkflowOrchestrator, display results
- Flow: Parse flags → load team config → execute workflow → display output → update checkpoint

**Workflow Execution Entry Point:**
- Location: `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts`
- Triggers: MCP tool call `mcp__semantic-analysis__execute_workflow(workflow_name, parameters)`
- Responsibilities: Load agents, build agent chain, execute in sequence, persist results
- Flow: Validate workflow name → instantiate agents → execute chain → cleanup → return results

## Error Handling

**Strategy:** Layered error recovery with fallbacks and graceful degradation

**Patterns:**

**Circuit Breaker (LLM Service):** Fail fast when provider consistently errors, exponential backoff reset
- Files: `lib/llm/circuit-breaker.ts`
- Behavior: Track failures per provider, open circuit on threshold (default 5), allow test request after reset timeout, half-open state

**Provider Fallback (ProviderRegistry):** Try next provider if current fails
- Files: `lib/llm/provider-registry.ts`
- Behavior: Maintain ordered list of providers, catch errors on completion call, move to next in priority
- Prevents: Single provider outage blocking all operations

**Workflow Retry (WorkflowOrchestrator):** Exponential backoff for MCP calls
- Files: `lib/ukb-unified/core/WorkflowOrchestrator.js`
- Behavior: Max 3 retries with jitter, log each attempt, surface final error

**Agent Adapter Validation:** Ensure adapter is initialized before use
- Files: `lib/agent-api/index.js`
- Behavior: Check `initialized` flag, throw meaningful error if not initialized

**Graceful Shutdown (MCP Server):** Signal handlers and resource cleanup
- Files: `integrations/mcp-server-semantic-analysis/src/index.ts`
- Behavior: Catch SIGTERM/SIGINT, close streams, wait for pending operations, exit cleanly

## Cross-Cutting Concerns

**Logging:** Centralized logger in `lib/logging/Logger.js` with file + console output, severity levels (info/warning/error)

**Validation:** AJV JSON Schema validation for ontologies (schemas in `knowledge-management/schemas/`), entity shape validation (KnowledgeAPI), config validation (dotenv + schema)

**Authentication:** LLM service uses environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.), agent adapters rely on native agent auth (Claude Code MCP, CoPilot CLI native)

**Team Isolation:** Ontology manager loads team-specific lower ontologies, knowledge API prefixes entities with team, checkpoints stored per team, LSL entries tagged with team

**Performance Metrics:** MetricsTracker in LLM service records provider latency, token usage, error rates; OntologyManager metrics track classification times

---

*Architecture analysis: 2026-02-26*
