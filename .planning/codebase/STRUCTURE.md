# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
coding/
  bin/                                  # CLI entry points
    coding                              # Main unified launcher script (bash)
  lib/                                  # Core libraries
    agent-api/                          # Agent abstraction layer
      adapters/                         # Agent-specific implementations
      hooks/                            # Hook system for events
      transcripts/                      # Session log parsing
      base-adapter.js                   # Abstract base for agents
      hooks-api.js                      # Hook manager interface
      transcript-api.js                 # Transcript parsing API
      statusline-api.js                 # Status bar updates
    agent-detector.js                   # Auto-detect best available agent
    llm/                                # LLM service layer
      llm-service.ts                    # Main LLM facade
      provider-registry.ts              # Provider management
      circuit-breaker.ts                # Failure handling
      cache.ts                          # Result caching
      metrics.ts                        # Usage tracking
      config.ts                         # Configuration loading
      sdk-loader.ts                     # Lazy SDK loading
      types.ts                          # TypeScript types
    knowledge-api/                      # Knowledge management
      core/                             # Core managers
        entities.js                     # Entity CRUD
        relations.js                    # Relationship management
        insights.js                     # Insight generation
        validation.js                   # Validation service
      adapters/                         # Storage adapters
        file-storage.js                 # JSON file persistence
        multi-file-storage.js           # Per-team file storage
      utils/                            # Helper utilities
      index.js                          # Main API export
    ukb-unified/                        # Unified knowledge base
      core/                             # Core orchestration
        WorkflowOrchestrator.js          # Workflow execution
        TeamCheckpointManager.js         # Progress tracking
        GapAnalyzer.js                  # Change detection
        VkbApiClient.js                 # Server API
        ConfigManager.js                # Config loading
      commands/                         # CLI commands
        entity.js                       # Entity commands
        relation.js                     # Relation commands
      cli.js                            # Main CLI entry
    logging/                            # Centralized logging
      Logger.js                         # Logger abstraction
    adapters/                           # Output format adapters
    fallbacks/                          # Fallback implementations
    integrations/                       # Integration helpers
    utils/                              # Utility functions
    vkb-server/                         # Knowledge server
    ukb-database/                       # Database abstractions
  src/                                  # TypeScript source
    ontology/                           # Ontology management
      heuristics/                       # Pattern-based classification
        HeuristicClassifier.ts          # Main classifier
        EnhancedKeywordMatcher.ts       # Keyword matching
        SemanticEmbeddingClassifier.ts  # Embedding-based
        EntityPatternAnalyzer.ts        # Pattern detection
        TeamContextFilter.ts            # Team filtering
        coding-heuristics.ts            # Coding-specific rules
        ui-heuristics.ts                # UI-specific rules
        agentic-heuristics.ts           # Agentic-specific rules
        resi-heuristics.ts              # RESI framework rules
      OntologyManager.ts                # Load/resolve ontologies
      OntologyClassifier.ts             # LLM-based classification
      OntologyValidator.ts              # Schema validation
      OntologyQueryEngine.ts            # Entity/relationship queries
      OntologyConfigManager.ts          # Config management
      types.ts                          # TypeScript interfaces
      metrics.ts                        # Performance tracking
      index.ts                          # Main export
    knowledge-management/               # Knowledge graph
      GraphDatabaseService.d.ts         # Type definitions
      knowledge-paths.d.ts              # Path definitions
    live-logging/                       # Session logging
    inference/                          # Inference abstraction
    caching/                            # Caching utilities
    databases/                          # Database utilities
    utils/                              # Helper utilities
  integrations/                         # MCP servers & external tools
    mcp-server-semantic-analysis/       # Main semantic analysis MCP
      src/
        index.ts                        # Entry point
        server.ts                       # MCP server creation
        tools.ts                        # Tool definitions (execute_workflow, test_connection)
        sse-server.ts                   # SSE fallback transport
        workflow-runner.ts              # Workflow execution
        logging.ts                      # Logging setup
        agents/                         # Agent implementations
          semantic-analysis-agent.ts    # Code understanding
          semantic-analyzer.ts          # Analyzer utility
          ontology-classifier.ts        # Classification
          deduplication.ts              # Entity dedup
          insight-generation-agent.ts   # Pattern reasoning
          content-validation-agent.ts   # Entity validation
          code-graph-agent.ts           # Code analysis
          persistence-agent.ts          # Storage ops
          web-search.ts                 # External search
          coordinator.ts                # Agent coordination
        ontology/                       # Ontology management
        storage/                        # Storage adapters
          graph-database-adapter.ts     # Graph DB ops
        workflows/                      # Workflow definitions
    mcp-constraint-monitor/             # Real-time guardrails
      src/
        hooks/                          # Hook implementations
        rules/                          # Constraint rules
        monitors/                       # Real-time monitors
        index.ts                        # Entry point
    browser-access/                     # Playwright automation
    code-graph-rag/                     # Code graph search
    serena/                             # Code navigation
    copi/                               # CoPilot integration
    llm-cli-proxy/                      # CLI LLM access
    system-health-dashboard/            # Status dashboard (React)
    memory-visualizer/                  # Knowledge visualization
    shadcn-mcp/                         # UI component library
  config/                               # Configuration files
    agents/                             # Agent configs
      claude.sh                         # Claude Code launcher
      copilot.sh                        # CoPilot launcher
    teams/                              # Team configurations
    hooks-config.json                   # Hook event mappings
    ontologies/                         # Ontology definitions
  knowledge-management/                 # Ontology & schema data
    config/                             # Team ontology configs
    schemas/                            # JSON schemas for validation
      ontology-schema.json              # Ontology JSON schema
    insights/                           # Generated insights
  scripts/                              # Utility scripts
    launch-generic.sh                   # Generic agent launcher
    launch-claude.sh                    # Claude-specific launcher
    launch-copilot.sh                   # CoPilot-specific launcher
    start-services-robust.js            # Service orchestrator
    docker-mode-transition.js           # Docker/native switching
    live-logging-coordinator.js         # LSL coordination
    init-databases.js                   # Database initialization
    purge-knowledge-entities.js         # Knowledge cleanup
    claude-mcp-launcher.sh              # MCP config selector
  docker/                               # Docker configuration
    docker-compose.yml                  # Container orchestration
    Dockerfile                          # Service image
    config/                             # Service configs
  .data/                                # Runtime data (gitignored)
    knowledge-graph/                    # Graph database
      checkpoints/                      # Team progress
      level-data/                       # Level DB store
    workflow-progress.json              # Current workflow status
    ontology-cache/                     # Cached ontologies
  .specstory/                           # Session history (gitignored)
    history/                            # LSL session logs
  .planning/                            # Planning documents
    codebase/                           # Analysis documents
  docs/                                 # Documentation
    architecture-report.md              # System architecture
    agent-integration-guide.md          # Adding new agents
    docker-mode-transition.md           # Docker switching guide
    getting-started.md                  # Setup guide
  tests/                                # Test files
    integration/                        # Integration tests
      full-system-validation.test.js
    unit/                               # Unit tests
  package.json                          # Node.js dependencies
  tsconfig.json                         # TypeScript configuration
  .eslintrc.json                        # ESLint configuration
  .env.example                          # Environment template
```

## Directory Purposes

**bin/**
- Purpose: Executable entry points
- Contains: Bash scripts for CLI commands
- Key files: `coding` (main launcher, agent detection, service startup)

**lib/**
- Purpose: Core JavaScript libraries
- Contains: All library code organized by concern (agent-api, llm, knowledge-api, ukb-unified)
- Pattern: Each subdirectory is a self-contained module with index.js export

**lib/agent-api/**
- Purpose: Unified agent abstraction
- Contains: Adapters for each agent type, hook system, transcript parsing, statusline API
- Key files: `base-adapter.js` (abstract base), `adapters/*.js` (implementations)

**lib/llm/**
- Purpose: LLM service abstraction
- Contains: Provider registry, circuit breaker, caching, metrics
- Key files: `llm-service.ts` (main facade), `provider-registry.ts` (multi-provider support)

**lib/knowledge-api/**
- Purpose: Knowledge CRUD and persistence
- Contains: EntityManager, RelationManager, InsightProcessor, storage adapters
- Key files: `index.js` (main API), `core/entities.js` (entity operations)

**lib/ukb-unified/**
- Purpose: UKB CLI and workflow orchestration
- Contains: CLI parsing, workflow execution, checkpoints, gap analysis
- Key files: `cli.js` (CLI entry), `core/WorkflowOrchestrator.js` (workflow execution)

**src/ontology/**
- Purpose: Ontology management and classification
- Contains: Entity loading/validation, hybrid LLM + heuristic classification, querying
- Key files: `OntologyManager.ts` (load ontologies), `OntologyClassifier.ts` (classification)

**src/ontology/heuristics/**
- Purpose: Pattern-based entity classification (no LLM needed)
- Contains: Keyword matching, semantic embedding, pattern analysis, team filtering
- Key files: `HeuristicClassifier.ts` (main), team-specific rule files

**integrations/mcp-server-semantic-analysis/**
- Purpose: Main MCP server for semantic analysis workflows
- Contains: Tool definitions, workflow runner, agent chain, storage adapters
- Key files: `src/index.ts` (entry), `src/tools.ts` (MCP tools), `src/workflow-runner.ts` (execution)

**integrations/mcp-server-semantic-analysis/src/agents/**
- Purpose: Agent implementations for semantic analysis pipeline
- Contains: SemanticAnalysisAgent, OntologyClassifier, DeduplicationAgent, InsightGenerationAgent
- Flow: Agents execute in sequence, passing results forward

**config/agents/**
- Purpose: Agent-specific launch configurations
- Contains: Shell scripts that define how each agent starts
- Pattern: One file per agent type (claude.sh, copilot.sh)

**knowledge-management/**
- Purpose: Ontology definitions and schemas
- Contains: Upper/lower ontologies (JSON), validation schemas, team configs
- Key files: Ontology JSON in `config/`, schemas in `schemas/`

**scripts/**
- Purpose: Utility and infrastructure scripts
- Contains: Service launchers, database initialization, LSL coordination, Docker transition
- Key files: `start-services-robust.js` (starts all services), `live-logging-coordinator.js` (LSL sync)

**docker/**
- Purpose: Docker container orchestration
- Contains: docker-compose.yml, Dockerfile, service configs
- Key files: `docker-compose.yml` (4 containers), `config/` (supervisord configs)

**.data/**
- Purpose: Runtime data storage (gitignored)
- Contains: Graph database, workflow progress, cached ontologies, checkpoints
- Key files: `workflow-progress.json` (current status), `checkpoints/<team>.json` (progress per team)

**.specstory/history/**
- Purpose: Live session logs (gitignored)
- Contains: LSL session records in Markdown format
- Pattern: YYYY-MM-DD_HHMM-HHMM-<hash>.md, indexed by timestamp

**.planning/codebase/**
- Purpose: GSD analysis documents
- Contains: architecture.md, structure.md, conventions.md, testing.md, concerns.md
- Generated by: GSD mapping phase, consumed by planning/execution phases

## Key File Locations

**Entry Points:**
- `bin/coding`: CLI launcher (bash) - detects agent, starts services, launches agent in tmux
- `lib/ukb-unified/cli.js`: UKB CLI entry - parses `ukb full` commands
- `integrations/mcp-server-semantic-analysis/src/index.ts`: MCP server entry - spawned by Claude Code
- `integrations/system-health-dashboard/src/index.tsx`: React dashboard - port 3032

**Configuration:**
- `package.json`: Dependencies, scripts, Node.js metadata
- `.env`: Environment variables (API keys, ports, teams)
- `.env.ports`: Port mappings for services
- `knowledge-management/config/`: Team-specific ontology configs
- `config/hooks-config.json`: Hook event definitions
- `tsconfig.json`: TypeScript compiler settings

**Core Logic:**
- `lib/agent-api/base-adapter.js`: Abstract agent adapter
- `lib/llm/llm-service.ts`: LLM request routing and caching
- `lib/knowledge-api/index.js`: Knowledge API (entities, relations, insights)
- `src/ontology/OntologyManager.ts`: Ontology loading and resolution
- `src/ontology/OntologyClassifier.ts`: Hybrid LLM + heuristic classification
- `lib/ukb-unified/core/WorkflowOrchestrator.js`: Workflow execution

**Testing:**
- `tests/integration/full-system-validation.test.js`: End-to-end tests
- `lib/knowledge-api/test/`: Knowledge API tests
- `integrations/mcp-server-semantic-analysis/test-*.ts`: MCP server tests

**Utilities:**
- `lib/logging/Logger.js`: Centralized logging
- `scripts/start-services-robust.js`: Service startup orchestration
- `scripts/live-logging-coordinator.js`: LSL coordination and aggregation
- `scripts/docker-mode-transition.js`: Native/Docker switching

## Naming Conventions

**Files:**
- Camel case: `camelCaseFileName.js`, `CamelCaseClass.ts`
- Hyphens for descriptive names: `config-manager.js`, `circuit-breaker.ts`
- Index files: `index.js` (module export), `index.ts` (TypeScript export)
- Type files: `.d.ts` (TypeScript definitions), `.ts` (source)

**Directories:**
- Kebab case: `agent-api/`, `knowledge-api/`, `mcp-server-semantic-analysis/`
- Plural for collections: `agents/`, `adapters/`, `hooks/`, `commands/`
- Compound names: `live-logging/`, `code-graph-rag/`, `system-health-dashboard/`

**Classes & Exports:**
- Pascal case: `OntologyManager`, `BaseAdapter`, `HeuristicClassifier`, `LLMService`
- Factory functions: `createAdapter()`, `createLogger()`, `createStatuslineProvider()`
- Constants: `UPPERCASE_WITH_UNDERSCORES` (MAX_RETRIES, LLM_TIMEOUT_MS)

**Functions:**
- Camel case: `executeWorkflow()`, `storeEntity()`, `getAdapter()`
- Prefixes: `get*` (accessor), `set*` (mutator), `is*` (predicate), `async*` (promise-based)

## Where to Add New Code

**New Feature in Agent Abstraction:**
- Primary code: `lib/agent-api/adapters/<agent-type>-adapter.js` or update `base-adapter.js`
- Hooks: `lib/agent-api/hooks/` if adding new event type
- Tests: `tests/integration/agent-<feature>.test.js`

**New Classification Heuristic:**
- Implementation: `src/ontology/heuristics/<team>-heuristics.ts` (team-specific rules)
- Classifier: Update `HeuristicClassifier.ts` to invoke new heuristic
- Tests: `src/ontology/heuristics/<team>-heuristics.test.ts`

**New MCP Tool/Workflow:**
- Tool definition: `integrations/mcp-server-semantic-analysis/src/tools.ts`
- Workflow: Add to `src/workflows/` and register in `workflow-runner.ts`
- Agent: `integrations/mcp-server-semantic-analysis/src/agents/` if new agent needed

**New Agent Type Integration:**
- Adapter: Create `lib/agent-api/adapters/<agent>-adapter.js` extending BaseAdapter
- Config: Create `config/agents/<agent>.sh` with launch logic
- Launcher: Create `scripts/launch-<agent>.sh` if different startup needed
- Tests: `tests/integration/agent-<agent>.test.js`

**New LLM Provider Support:**
- Provider: `lib/llm/providers/<provider>-provider.ts` implementing ProviderInterface
- SDK loader: Add to `lib/llm/sdk-loader.ts`
- Registry: Register in `ProviderRegistry` in `lib/llm/provider-registry.ts`
- Config: Add to LLM config YAML with priority

**New Knowledge Entity Type:**
- Ontology definition: Add to `knowledge-management/config/<team>-ontology.json`
- Heuristics: Add pattern matching to `src/ontology/heuristics/`
- Schema: Update `knowledge-management/schemas/ontology-schema.json`
- Validator: Add rules to `src/ontology/OntologyValidator.ts`

**New Service:**
- Core: `lib/<service-name>/` with index.js export
- Tests: `lib/<service-name>/test/` or `tests/unit/<service-name>.test.js`
- Config: Add environment variables to `.env.example`
- Integration: Update `scripts/start-services-robust.js` if needs startup management

## Special Directories

**node_modules/:**
- Purpose: npm dependencies
- Generated: Yes (by npm install)
- Committed: No (in .gitignore)

**.data/:**
- Purpose: Runtime data (knowledge graph, checkpoints, workflow state)
- Generated: Yes (by services at runtime)
- Committed: No (in .gitignore)
- Important: Do not delete `.data/knowledge-graph/` - contains all accumulated knowledge

**.specstory/history/:**
- Purpose: Live session logs
- Generated: Yes (by LSL coordinator during agent sessions)
- Committed: No (in .gitignore)
- Format: Markdown with LSL structured entries

**dist/, build/, coverage/:**
- Purpose: Build outputs
- Generated: Yes (by build scripts)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-02-26*
