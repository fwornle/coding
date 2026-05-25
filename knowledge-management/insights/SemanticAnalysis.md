# SemanticAnalysis

**Type:** Component

SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.

# SemanticAnalysis — Technical Insight Document

## What It Is

SemanticAnalysis is a multi-agent pipeline located in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. It is a core child component of the **Coding** project hierarchy, sitting alongside siblings like **LLMAbstraction** (which provides its LLM backend), **KnowledgeManagement** (its persistence target), and **DockerizedServices** (its runtime environment).

## Architecture and Design

The pipeline is organized as a DAG defined in `batch-analysis.yaml` (the **Pipeline** child), with explicit `depends_on` edges enabling topological execution across coordinator, observation, KG, dedup, and persistence steps. All agents extend **BaseAgent**`<TInput, TOutput>` (`src/agents/base-agent.ts`), which enforces an `execute() → process() → calculateConfidence() → detectIssues() → generateRouting()` lifecycle, wrapping results in a typed `AgentResponse` envelope with confidence scoring, issue detection, and upstream context propagation. This uniform contract enables robust retry and <USER_ID_REDACTED>-gating across pipeline steps.

![SemanticAnalysis — Architecture](images/semantic-analysis-architecture.png)

Key specialized agents include:
- **SemanticAnalysisAgent** (`src/agents/semantic-analysis-agent.ts`) — three analysis depths ('surface', 'deep', 'comprehensive'), with surface mode capping at 5 files and skipping cross-analysis
- **OntologyClassificationAgent** (`src/agents/ontology-classification-agent.ts`) — Phase 42-03 architecture constructing km-core's `OntologyRegistry` directly, wrapped in **LegacyOntologyAdapter** to preserve `OntologyValidator`/`OntologyClassifier` interfaces while decoupling from legacy internals
- **CodeGraphAgent** (`src/agents/code-graph-agent.ts`) — graceful degradation via TCP socket checks (`checkMemgraphConnection()`) and `checkUvAvailable()`, setting `skipped=true` rather than failing the workflow
- **ContentValidationAgent** (`src/agents/content-validation-agent.ts`) — git-based staleness detection with 60-second in-memory cache (`GIT_CACHE_TTL_MS=60000`) and up to 20 parallel refresh workers

![SemanticAnalysis — Relationship](images/semantic-analysis-relationship.png)

## Implementation Details

SemanticAnalysisAgent merges LLM-identified `keyPatterns` into heuristic-derived `codeAnalysis.architecturalPatterns` using a lowercase-name deduplication Set, preventing duplicates from the two detection strategies. OntologyClassificationAgent aggregates `llmUsage` statistics (totalPromptTokens, modelsUsed, providersUsed) across classified observations in `ClassificationProcessResult.summary`, enabling token budget tracking consistent with the tiered model selection in `docs/TIERED-MODEL-PROPOSAL.md` — tying directly into the **LLMAbstraction** sibling's per-agent mode override capability.

The **OntologyConfigManager** operates as a singleton ensuring all pipeline agents share a single authoritative view of ontology paths and classification thresholds. The **LegacyOntologyAdapter** resolves the tight coupling issue documented in `CRITICAL-ARCHITECTURE-ISSUES.md`.

## Integration Points

- **LLMAbstraction**: Provides the inference backend; per-agent mode overrides flow through `workflow-progress.json`
- **KnowledgeManagement**: Persistence target via `GraphDatabaseAdapter`'s dual-mode routing (live HTTP vs. direct LevelDB)
- **DockerizedServices**: CodeGraphAgent depends on Memgraph availability; the MCP server itself runs as a containerized service
- **CodingPatterns**: Agents follow the lazy-initialization pattern — LLM clients are set up at execution time, not construction
- **LiveLoggingSystem**: LSL sessions serve as input data for the pipeline

## Usage Guidelines

Developers adding new agents must extend `BaseAgent<TInput, TOutput>` and implement the full lifecycle (`process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`). Follow the lazy-initialization convention from **CodingPatterns** — never establish LLM connections in constructors. When integrating with external services (like Memgraph), follow CodeGraphAgent's pattern of graceful degradation with `skipped=true` rather than hard failures. Token usage should be tracked via the `llmUsage` aggregation pattern to stay within budget constraints.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions int; LLMAbstraction: LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: publi; DockerizedServices: DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasse; KnowledgeManagement: [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time ; CodingPatterns: [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LL; ConstraintSystem: The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during; SemanticAnalysis: SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-pars.

### Children
- [Pipeline](./Pipeline.md) -- batch-analysis.yaml defines the pipeline as a DAG of steps with explicit depends_on edges, enabling topological execution order across coordinator, observation, KG, dedup, and persistence agents
- [Ontology](./Ontology.md) -- docs/architecture/agents.md describes OntologyClassifier and OntologyValidator as distinct interfaces, both now backed by LegacyOntologyAdapter wrapping km-core OntologyRegistry
- [Insights](./Insights.md) -- docs/architecture/agents.md identifies a dedicated insight-generation agent responsible for authoring structured knowledge reports from aggregated code and history signals
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton (per docs/configuration.md patterns) to ensure all pipeline agents share a single authoritative view of ontology paths and classification thresholds
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Resolves the architectural issue documented in CRITICAL-ARCHITECTURE-ISSUES.md where OntologyClassifier was tightly coupled to an internal registry; the adapter decouples pipeline agents from the km-core registry's concrete API
- [BaseAgent](./BaseAgent.md) -- BaseAgent<TInput, TOutput> is a generic abstract class (documented in docs/architecture/agents.md) parameterized on input and output types, enforcing type safety across the heterogeneous agent pipeline

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI, Groq), local inference via Docker Model Runner (DMR), and a mock mode for testing. The component manages runtime mode selection through a workflow-progress.json state file, supporting both global and per-agent mode overrides with a priority chain: per-agent override > global mode > legacy flag > default ('public'). This enables dynamic switching between inference backends without code changes, supporting development, testing, and production scenarios from the same codebase.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LLM client setup is deferred until actual execution rather than performed at construction time. This pattern is documented in docs/puml/agent-integration-flow.puml and docs/puml/agent-abstraction-architecture.puml. The motivation is to avoid paying the cost of LLM connection setup (which may involve network calls, credential validation, and model loading) when an agent object is instantiated—particularly important in systems where many agent types are registered but only a subset are invoked per workflow. A new developer working on an agent should expect a two-phase lifecycle: a lightweight constructor that stores configuration references, followed by an initialize() or setup() method (or equivalent lazy property) that establishes the actual LLM connection on first use. Violating this convention by eagerly connecting in the constructor would break the startup performance characteristics that the rest of the system assumes.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.


---

*Generated from 8 observations*
