# DockerizedServices

**Type:** Component

DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.

## What It Is

DockerizedServices is the containerization and service lifecycle management layer for the Coding project, implemented across `scripts/api-service.js`, `scripts/dashboard-service.js`, `lib/service-starter.js`, `lib/utils/service-probe.js`, and `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`. It orchestrates the MCP semantic analysis server, the ConstraintSystem's API (port 3031) and dashboard (port 3030), code-graph-rag integration, Memgraph, and Redis.

## Architecture and Design

The architecture uses a **wrapper-process pattern**: `scripts/api-service.js` and `scripts/dashboard-service.js` each spawn a child process, register its PID with a ProcessStateManager (PSM) singleton under type `'global'`, forward `SIGTERM`/`SIGINT`, and unregister on exit. This decouples process identity from service identity, letting PSM track all managed processes uniformly regardless of what service they represent.

![DockerizedServices — Architecture](images/dockerized-services-architecture.png)

Services are classified as **required or optional**, with `lib/service-starter.js` handling retry-with-backoff startup (default 3 retries, 30s timeout, exponential backoff). Critically, it kills unhealthy child processes via `SIGTERM`/`SIGKILL` before each retry to prevent port conflicts—a deliberate design choice prioritizing clean restarts over process preservation.

Health checking follows a strict specification (SPEC R6): `lib/utils/service-probe.js` provides `probeHttpHealth()` and `probeTcpPort()` (the latter for Memgraph Bolt and Redis), but probes never return `'healthy'`—only `'running'`, `'stopped'`, or `'unknown'`. This conservative vocabulary avoids implying application-level health guarantees from infrastructure-level checks.

![DockerizedServices — Relationship](images/dockerized-services-relationship.png)

## Implementation Details

The wrapper scripts follow an identical pattern. `scripts/dashboard-service.js` hardcodes `NEXT_PUBLIC_API_BASE_URL=http://localhost:3031` when spawning the Next.js dashboard, creating a fixed coupling between the ConstraintSystem dashboard and its API backend. This is a known trade-off—simplicity over configurability—appropriate for the single-host Docker deployment model.

The child component LLMMockService (`integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`) uses the `CODING_ROOT` environment variable (Docker path `/coding`) to resolve `.data/workflow-progress.json`, enabling host-path-agnostic configuration inside containers. It supports three modes (`'mock'`, `'local'`, `'public'`) with per-agent overrides stored under `llmState.perAgentOverrides`, maintaining backward compatibility via a legacy `mockLLM` boolean. This mode system feeds into the sibling LLMAbstraction's priority chain (per-agent override > global mode > legacy flag > default).

## Integration Points

DockerizedServices connects to its parent Coding project's components extensively: it hosts the SemanticAnalysis MCP server, runs the ConstraintSystem's monitoring API and dashboard, and manages databases used by KnowledgeManagement (Memgraph for graph storage, Redis for caching). The `probeTcpPort()` probe type exists specifically because Memgraph (Bolt protocol) and Redis don't expose HTTP health endpoints.

The LLMMockService child is intentionally isolated in a `mock/` subdirectory, separated from production LLM routing in LLMAbstraction to allow safe substitution during containerized test runs.

## Usage Guidelines

- **Never return `'healthy'` from probes**—SPEC R6 mandates only `'running'`, `'stopped'`, or `'unknown'`.
- **New services** should follow the wrapper pattern: spawn child, register with PSM as `'global'`, forward signals, unregister on exit.
- **Port conflicts**: `service-starter.js` handles this via pre-retry `SIGTERM`/`SIGKILL`, but developers must ensure new services don't silently share ports with existing ones (3030, 3031 are taken).
- **Container path resolution**: use `CODING_ROOT` (`/coding` in Docker) rather than hardcoded host paths when accessing shared data files like `workflow-progress.json`.
- **Required vs. optional classification** matters: required service failures block startup; optional ones log warnings and continue. Choose appropriately when adding services.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions int; LLMAbstraction: LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: publi; DockerizedServices: DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasse; KnowledgeManagement: [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time ; CodingPatterns: [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LL; ConstraintSystem: The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during; SemanticAnalysis: SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-pars.

### Children
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts resides in the mock/ subdirectory of the semantic analysis server, indicating it is intentionally isolated from production LLM routing logic to allow safe substitution during containerized test runs.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI, Groq), local inference via Docker Model Runner (DMR), and a mock mode for testing. The component manages runtime mode selection through a workflow-progress.json state file, supporting both global and per-agent mode overrides with a priority chain: per-agent override > global mode > legacy flag > default ('public'). This enables dynamic switching between inference backends without code changes, supporting development, testing, and production scenarios from the same codebase.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LLM client setup is deferred until actual execution rather than performed at construction time. This pattern is documented in docs/puml/agent-integration-flow.puml and docs/puml/agent-abstraction-architecture.puml. The motivation is to avoid paying the cost of LLM connection setup (which may involve network calls, credential validation, and model loading) when an agent object is instantiated—particularly important in systems where many agent types are registered but only a subset are invoked per workflow. A new developer working on an agent should expect a two-phase lifecycle: a lightweight constructor that stores configuration references, followed by an initialize() or setup() method (or equivalent lazy property) that establishes the actual LLM connection on first use. Violating this convention by eagerly connecting in the constructor would break the startup performance characteristics that the rest of the system assumes.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.


---

*Generated from 7 observations*
