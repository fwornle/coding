# LiveLoggingSystem

**Type:** Component

The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.

# LiveLoggingSystem — Technical Insight Document

## What It Is

LiveLoggingSystem is the infrastructure for capturing, converting, and routing agent conversation sessions into a unified LSL (Live Session Logging) format. It lives primarily across `lib/agent-api/transcript-api.js` (TranscriptAdapter base class), `lib/agent-api/transcripts/lsl-converter.js` (LSLConverter), `scripts/validate-lsl-config.js` (LSLConfigValidator), and `integrations/mcp-server-semantic-analysis/src/logging.ts` (async buffered I/O). Configuration resides in `.specstory/config/lsl-config.json` and `.specstory/config/redaction-config.yaml`.

As a child of the Coding root, it sits alongside siblings like SemanticAnalysis (which consumes its LSL output) and ConstraintSystem. It contains two sub-components: SessionWindowingManager (time-based session windowing) and RedactionEngine (secret redaction).

## Architecture and Design

The system uses an **adapter pattern** with `TranscriptAdapter` as an abstract base class enforcing a five-method contract via constructor guard (`if (new.target === TranscriptAdapter) throw`). Agent-specific implementations extend this to provide `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. This mirrors the lazy-initialization conventions seen in CodingPatterns — adapters are lightweight until actively polling.

![LiveLoggingSystem — Architecture](images/live-logging-system-architecture.png)

`LSLConverter` handles format translation with three output modes (markdown, JSONL serialization, JSONL parsing). Configuration validation is schema-constrained with explicit numeric bounds enforced by `LSLConfigValidator`. The split between `lsl-config.json` and `redaction-config.yaml` separates operational concerns (file sizing, rotation) from security policy (redaction categories), validated independently.

![LiveLoggingSystem — Relationship](images/live-logging-system-relationship.png)

## Implementation Details

**Session Windowing:** The LSLMetadata schema includes a `timeWindow` field (e.g., `'0800-0900'`) alongside `sessionId`, `projectPath`, `userHash`, and agent type. This is managed by the SessionWindowingManager child component and drives file routing decisions.

**Multi-user support** uses SHA-256 hashing of the `USER` environment variable, truncated to 6 characters. `validateUserEnvironment()` errors if `USER` is unset.

**LSLConverter** applies configurable `maxContentLength` (default 10000 chars) and `redactSecrets` during conversion — the latter delegating to RedactionEngine. The converter supports round-tripping through `toJSONL()`/`fromJSONL()`.

**Async I/O** in `logging.ts` uses a string buffer flushed every 100ms or at 50 entries, with an `isWriting` mutex guarding `fsp.appendFile()` calls. **Config validation** enforces: `maxFileSize` 1–100MB, `rotationThreshold` 1–80MB, `maxLogSizeMB` 1–100, `batchSize` 10–1000.

**Transcript watching** uses `TranscriptAdapter.watchTranscripts()` with configurable poll intervals calling `getCurrentSession()` and emitting new entries to registered callbacks.

## Integration Points

LSL output feeds into SemanticAnalysis for processing git history and session data. The system references a 5-layer ontology classification pipeline (`lsl-5-layer-classification.puml`) for categorizing log entries, configured via the `classification` field in `lsl-config.json`. The async logging backend in the MCP semantic analysis integration shares infrastructure with LLMAbstraction's provider layer. RedactionEngine consumes `redaction-config.yaml` independently from the main config.

## Usage Guidelines

- Always extend `TranscriptAdapter` — never instantiate directly
- Ensure `USER` environment variable is set for multi-user deployments
- Keep `rotationThreshold` below `maxFileSize` (validated bounds enforce this implicitly)
- Use `validate-lsl-config.js` before deployment to catch config constraint violations
- Content truncation at 10000 chars is a default; adjust `maxContentLength` for verbose tool outputs
- The poll-based watch mechanism means latency equals the poll interval — tune accordingly for real-time needs vs. I/O cost


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions int; LLMAbstraction: LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: publi; DockerizedServices: DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasse; KnowledgeManagement: [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time ; CodingPatterns: [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LL; ConstraintSystem: The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during; SemanticAnalysis: SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-pars.

### Children
- [SessionWindowingManager](./SessionWindowingManager.md) -- SessionWindowingManager is a sub-component of LiveLoggingSystem
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine is a sub-component of LiveLoggingSystem

### Siblings
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI, Groq), local inference via Docker Model Runner (DMR), and a mock mode for testing. The component manages runtime mode selection through a workflow-progress.json state file, supporting both global and per-agent mode overrides with a priority chain: per-agent override > global mode > legacy flag > default ('public'). This enables dynamic switching between inference backends without code changes, supporting development, testing, and production scenarios from the same codebase.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LLM client setup is deferred until actual execution rather than performed at construction time. This pattern is documented in docs/puml/agent-integration-flow.puml and docs/puml/agent-abstraction-architecture.puml. The motivation is to avoid paying the cost of LLM connection setup (which may involve network calls, credential validation, and model loading) when an agent object is instantiated—particularly important in systems where many agent types are registered but only a subset are invoked per workflow. A new developer working on an agent should expect a two-phase lifecycle: a lightweight constructor that stores configuration references, followed by an initialize() or setup() method (or equivalent lazy property) that establishes the actual LLM connection on first use. Violating this convention by eagerly connecting in the constructor would break the startup performance characteristics that the rest of the system assumes.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.


---

*Generated from 8 observations*
