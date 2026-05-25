# LLMAbstraction

**Type:** Component

LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI, Groq), local inference via Docker Model Runner (DMR), and a mock mode for testing. The component manages runtime mode selection through a workflow-progress.json state file, supporting both global and per-agent mode overrides with a priority chain: per-agent override > global mode > legacy flag > default ('public'). This enables dynamic switching between inference backends without code changes, supporting development, testing, and production scenarios from the same codebase.

# LLMAbstraction — Technical Insight Document

## What It Is

LLMAbstraction is the provider-agnostic inference layer within the `mcp-server-semantic-analysis` integration, implemented primarily in `llm-mock-service.ts` (mode resolution and mock responses) and `dmr-provider.ts` (local inference via Docker Model Runner). It abstracts LLM calls across three backends—public cloud (Anthropic, OpenAI, Groq), local inference (DMR), and mock mode for testing—allowing the SemanticAnalysis pipeline and its agents to switch inference backends at runtime without code changes.

## Architecture and Design

The component implements a **three-tier mode system** (`'mock' | 'local' | 'public'`) with a clear priority chain: per-agent override → global mode → legacy `mockLLM` flag → default `'public'`. Mode state is persisted in `.data/workflow-progress.json` and read by `getLLMMode()`. This design means any agent in the SemanticAnalysis pipeline can be individually pinned to a different backend—useful for running expensive agents locally while keeping cheaper ones on public APIs.

![LLMAbstraction — Architecture](images/llmabstraction-architecture.png)

The DMR provider in `dmr-provider.ts` reuses the OpenAI-compatible API protocol, pointing an OpenAI client at `http://${DMR_HOST}:${DMR_PORT}/engines/v1`. This makes DMR a drop-in replacement requiring zero protocol changes—a deliberate design choice that avoids a custom client implementation. Health checks are cached via `checkDMRAvailability()` with a configurable interval to avoid per-call network probes.

![LLMAbstraction — Relationship](images/llmabstraction-relationship.png)

## Implementation Details

**Mode resolution** in `getLLMMode()` reads from `.data/workflow-progress.json`, using `process.env.CODING_ROOT || repositoryPath` for Docker-compatible path resolution. The `llmState.perAgentOverrides` map provides per-agent granularity. `setGlobalLLMMode()` writes both the new `llmState.globalMode` and the legacy `mockLLM` boolean simultaneously, maintaining backward compatibility.

**DMR configuration** is handled by the child component DMRConfigLoader, which searches multiple filesystem paths for `dmr-config.yaml` and expands `${VAR:-default}` patterns via `expandEnvVars()`. This multi-path search supports both local dev and containerized deployments within DockerizedServices.

**Mock responses** conform to a `MockLLMResponse` interface with `content`, `provider`, `model`, and `tokenUsage` fields—structurally identical to real provider responses, ensuring workflow continuity. This aligns with the CodingPatterns lazy-initialization convention: agents don't need to know which backend they'll use at construction time.

## Integration Points

LLMAbstraction serves the SemanticAnalysis multi-agent pipeline as its primary consumer. Each agent resolves its mode via `getLLMMode(agentName)`, enabling the per-agent override mechanism. The component shares the `.data/workflow-progress.json` state file with the broader Coding project's workflow tracking. The DMR backend integrates with DockerizedServices for container-based local inference. The `CODING_ROOT` environment variable pattern is consistent with how other sibling components handle Docker path resolution.

## Usage Guidelines

- **Never hardcode a provider**—always go through `getLLMMode()` to resolve the active backend for a given agent.
- **Per-agent overrides** are set via `llmState.perAgentOverrides` in the workflow-progress file; use this for mixed-mode development (e.g., mock for fast iteration on one agent, public for another).
- **When adding a new provider**, ensure responses match the `MockLLMResponse` interface shape to maintain structural parity.
- **DMR health checks are cached**—if DMR becomes unavailable mid-session, the cache must expire before the system detects the failure. Adjust `connection.healthCheckInterval` accordingly.
- **Legacy code** may still check `mockLLM` boolean; `setGlobalLLMMode()` handles this automatically, but avoid introducing new reads of the legacy flag.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions int; LLMAbstraction: LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: publi; DockerizedServices: DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasse; KnowledgeManagement: [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time ; CodingPatterns: [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LL; ConstraintSystem: The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during; SemanticAnalysis: SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-pars.

### Children
- [DMRConfigLoader](./DMRConfigLoader.md) -- DMRConfigLoader performs multi-path search for the DMR YAML config file, checking several candidate locations to support both local dev and containerized deployments as documented in integrations/mcp-server-semantic-analysis/docs/configuration.md

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LLM client setup is deferred until actual execution rather than performed at construction time. This pattern is documented in docs/puml/agent-integration-flow.puml and docs/puml/agent-abstraction-architecture.puml. The motivation is to avoid paying the cost of LLM connection setup (which may involve network calls, credential validation, and model loading) when an agent object is instantiated—particularly important in systems where many agent types are registered but only a subset are invoked per workflow. A new developer working on an agent should expect a two-phase lifecycle: a lightweight constructor that stores configuration references, followed by an initialize() or setup() method (or equivalent lazy property) that establishes the actual LLM connection on first use. Violating this convention by eagerly connecting in the constructor would break the startup performance characteristics that the rest of the system assumes.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.


---

*Generated from 8 observations*
