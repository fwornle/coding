# CodingPatterns

**Type:** Component

[LLM] Graph Database as Shared Structural Backbone: config/graph-database-config.json configures the graph persistence layer that multiple subsystems depend on concurrently. The code-graph-rag integration (integrations/code-graph-rag/codebase_rag/) uses it to store and query code structure via relationships such as CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, CONTAINS_MODULE, DEFINES, DEFINES_METHOD, and DEPENDS_ON_EXTERNAL—relationship types that appear in the project's key documented components. The semantic analysis MCP server (integrations/mcp-server-semantic-analysis) reads from the same graph to answer architectural questions about the codebase at runtime. The batch ingestion behavior is controlled by the MEMGRAPH_BATCH_SIZE environment variable, and the graph is exposed on ports governed by CODE_GRAPH_RAG_PORT and CODE_GRAPH_RAG_SSE_PORT. This shared-graph idiom means that the code structure, agent relationships, and dependency metadata are all queryable through a single graph traversal API rather than being scattered across file-system scans or static analysis outputs. A new developer should understand that adding a new module or integration is not fully visible to the system until its structural relationships are ingested into the graph; the CONTRIBUTING.md in integrations/code-graph-rag/ presumably documents the ingestion trigger required after structural changes.

# CodingPatterns — Technical Insight Document

## What It Is

CodingPatterns is a component within the Coding project hierarchy that codifies the recurring architectural conventions and design idioms enforced across the codebase. It is not a runtime module but a set of documented and configured patterns—manifested in config files (`config/llm-providers.yaml`, `config/hooks-config.json`, `config/health-verification-rules.json`, `config/graph-database-config.json`), PlantUML diagrams (`docs/puml/agent-integration-flow.puml`, `docs/puml/llm-tier-routing.puml`, `docs/puml/agent-hook-flow.puml`, `docs/puml/health-verification-flow.puml`), and integration scaffolds—that govern how all sibling systems (ConstraintSystem, SemanticAnalysis, LiveLoggingSystem, DockerizedServices, LLMAbstraction, KnowledgeManagement) are built and extended.

Its children formalize the four core patterns: AgentAbstractionPatterns, MCPIntegrationConventions, HookExtensionPattern, and LLMTierRoutingPattern.

## Architecture and Design

![CodingPatterns — Architecture](images/coding-patterns-architecture.png)

The patterns divide into four concerns:

**Agent Lazy-Initialization.** As documented in AgentAbstractionPatterns via `docs/puml/agent-abstraction-architecture.puml`, every agent follows a two-phase lifecycle: a lightweight constructor storing configuration references, then a deferred `initialize()` that establishes LLM connections on first use. This keeps startup cheap when many agent types are registered but few invoked—directly relevant to how SemanticAnalysis orchestrates its multi-agent pipeline.

**Externalized Declarative Policy.** Health checks (`config/health-verification-rules.json`), hook routing (`config/hooks-config.json`), and constraint rules (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) all follow the same <COMPANY_NAME_REDACTED>-pattern: declarative JSON/YAML policy files interpreted at runtime, never hardcoded. This lets operational teams adjust thresholds without redeployment.

**Multi-Tier LLM Routing.** Defined in `config/llm-providers.yaml` and formalized by LLMTierRoutingPattern in `integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md`, a three-level fallback chain (primary cloud → cost-optimized → local) gates all LLM calls. This directly implements what the LLMAbstraction sibling exposes as its provider-agnostic interface.

**Hook-Based Cross-Cutting Concerns.** HookExtensionPattern, with its wire format in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`, provides the extension mechanism the ConstraintSystem uses for pre/post-tool interception without coupling to agent internals.

![CodingPatterns — Relationship](images/coding-patterns-relationship.png)

## Implementation Details

The **MCP integration scaffold** enforced by MCPIntegrationConventions requires every integration to contain `README.md`, `docs/architecture/`, `docs/api/`, and `config/` at predictable paths. Both `integrations/mcp-constraint-monitor` and `integrations/mcp-server-semantic-analysis` conform. This predictability enables the code-graph-rag ingestion pipeline (`integrations/code-graph-rag/codebase_rag/`) to populate graph relationships (`CONTAINS_FILE`, `CONTAINS_MODULE`, `DEFINES`) from known locations.

The **graph database** configured in `config/graph-database-config.json` acts as the shared structural backbone. Relationship types (`CONTAINS_PACKAGE`, `CONTAINS_FOLDER`, `DEPENDS_ON_EXTERNAL`, etc.) are populated by batch ingestion controlled via `MEMGRAPH_BATCH_SIZE`. Both code-graph-rag and SemanticAnalysis read from this same graph, meaning a new module is invisible to the system until ingested.

Hook payloads flow through the lifecycle in `docs/puml/agent-hook-flow.puml` and `docs/puml/constraint-hooks-flow.puml`, with semantic analysis triggers (`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`) fired from within hook callbacks.

## Integration Points

- **LLMAbstraction**: All agents route through the tier config rather than direct provider instantiation; LLMAbstraction implements the runtime mode selection that the tier routing pattern depends on.
- **ConstraintSystem**: Consumes hooks defined by HookExtensionPattern to intercept and validate tool calls.
- **KnowledgeManagement**: The graph database config underlies both code-graph-rag ingestion and the dual-mode routing in `storage/graph-database-adapter.ts`.
- **DockerizedServices**: Service lifecycle (ports, process management) hosts the infrastructure these patterns govern.

## Usage Guidelines

1. **Never eagerly connect to an LLM in a constructor.** Use the two-phase lifecycle; store config in the constructor, connect in `initialize()`.
2. **Never hardcode an LLM provider.** Wire through `config/llm-providers.yaml` to preserve cost governance and offline fallback.
3. **Never embed health-check thresholds or constraint logic in code.** Load from the corresponding JSON rules files at runtime.
4. **New cross-cutting concerns go through hooks.** Register in `hooks-config.json`, implement in an isolated module—never inline in agent methods.
5. **New MCP integrations must replicate the scaffold** (`README.md`, `docs/architecture/`, `docs/api/`, `config/`) or they will be invisible to automated discovery and graph ingestion.
6. **After structural changes, trigger graph ingestion** so new modules appear in the shared graph <USER_ID_REDACTED> by SemanticAnalysis and code-graph-rag.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions int; LLMAbstraction: LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: publi; DockerizedServices: DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasse; KnowledgeManagement: [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time ; CodingPatterns: [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LL; ConstraintSystem: The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during; SemanticAnalysis: SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-pars.

### Children
- [AgentAbstractionPatterns](./AgentAbstractionPatterns.md) -- docs/puml/agent-abstraction-architecture.puml documents the base agent interface enforcing the constructor/initialize() split, ensuring all concrete agent types adhere to the same lifecycle contract
- [MCPIntegrationConventions](./MCPIntegrationConventions.md) -- integrations/mcp-server-semantic-analysis/ follows the canonical MCP integration directory structure with subdirectories docs/architecture/, docs/api/, docs/installation/, and docs/configuration.md, establishing the expected layout new integrations must mirror
- [HookExtensionPattern](./HookExtensionPattern.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md documents the data format Claude Code emits at hook points, defining the contract between the hook producer and constraint-monitor consumer
- [LLMTierRoutingPattern](./LLMTierRoutingPattern.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md documents the formal proposal for tiered model selection, establishing the rationale and design that llm-providers.yaml implements

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI, Groq), local inference via Docker Model Runner (DMR), and a mock mode for testing. The component manages runtime mode selection through a workflow-progress.json state file, supporting both global and per-agent mode overrides with a priority chain: per-agent override > global mode > legacy flag > default ('public'). This enables dynamic switching between inference backends without code changes, supporting development, testing, and production scenarios from the same codebase.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.


---

*Generated from 6 observations*
