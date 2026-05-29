# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem is built around a strict abstract interface defined by the `TranscriptAdapter` class in `lib/agent-api/transcript-api.js`.; LLMAbstraction: LLMAbstraction is the provider-agnostic layer that routes LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI), a local Dock; DockerizedServices: DockerizedServices is the containerization layer that packages the coding project's services (semantic analysis MCP, constraint monitor, code-graph-ra; KnowledgeManagement: [LLM] GraphDatabaseService (src/knowledge-management/GraphDatabaseService.js) uses a single monolithic LevelDB key 'graph' to persist the entire in-me; CodingPatterns: CodingPatterns serves as the architectural catch-all component for the Coding project, capturing general programming conventions, design patterns, and; ConstraintSystem: The ConstraintSystem is a multi-layered enforcement infrastructure that validates code actions, file operations, and tool interactions against configu; SemanticAnalysis: The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline o.

# Coding Project: Comprehensive Technical Reference

## What It Is

The Coding project is a multi-component development infrastructure platform organized into seven first-level subsystems: **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**. Together these components form a self-contained environment for AI-assisted coding workflows, encompassing everything from agent transcript capture to graph-based knowledge persistence, provider-agnostic LLM routing, semantic code analysis, and constraint enforcement. The project's conventions and cross-cutting patterns are captured in CodingPatterns, which serves as the architectural catch-all, while each sibling component owns a distinct infrastructure concern.

---

## Architecture and Design

### Dominant Architectural Pattern: Abstract Interface + Adapter

The most consistent design pattern across the Coding project is the **abstract interface with concrete adapters**. LiveLoggingSystem exemplifies this through the `TranscriptAdapter` class in `lib/agent-api/transcript-api.js`, which mandates a strict five-method contract (`getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, `getCurrentSession()`). Every agent-specific implementation must satisfy this interface, making the live logging pipeline entirely agent-agnostic at the orchestration level. CodingPatterns documents the same philosophy applied to AI agents more broadly — Claude, Copilot, Mastra, and OpenCode are all unified behind a common interface defined in `config/agents/` and `config/agent-profiles.json`. This pattern repeats at every layer: the system always prefers a normalized contract over direct coupling to a specific provider or agent implementation.

### Provider-Agnostic Routing via Configuration State

LLMAbstraction extends the adapter philosophy into the LLM routing layer. Rather than hard-coding provider selection, the architecture externalizes control into a `workflow-progress.json` state file that carries both global and per-agent mode overrides (`mock`, `local`, `public`). This means the same codebase can route calls to Anthropic, OpenAI, a local Docker Model Runner (DMR), a `rapid-llm-proxy` middleware, or a mock service purely through runtime state — no code changes required. Environment variables (`RAPID_LLM_PROXY_URL`, `LLM_CLI_PROXY_URL`, `LLM_PROXY_URL`) form a defined priority chain for provider resolution, and all providers normalize responses to a shared shape: `{ content, model, provider, token_usage }`. This normalization is critical — consumers of LLMAbstraction never need to know which backend fulfilled a request.

### Containerization as Unified Process Boundary

DockerizedServices establishes the deployment boundary for the entire system. The `docker/docker-compose.yml` orchestrates the semantic analysis MCP server, constraint monitor, code-graph-rag service, Memgraph (graph database), and Redis (caching) as a unified environment. The `docker/Dockerfile.coding-services` and `docker/entrypoint.sh` define the image and startup sequence, with `docker/supervisord.conf` enabling multiple services to coexist in a single container under ordered startup and restart policies. This is a deliberate trade-off: co-locating services simplifies deployment and inter-service communication at the cost of coarser horizontal scaling granularity. The relationship between DockerizedServices and SemanticAnalysis is particularly tight — the MCP server for semantic analysis is one of the primary services managed by this containerization layer.

### Polling Over Filesystem Events

A notable design decision in LiveLoggingSystem is the rejection of `fs.watch` in favor of a polling loop (`setInterval`) inside `watchTranscripts()`. The rationale is explicitly portability: `fs.watch` exhibits known cross-platform inconsistencies, particularly inside Docker containers and on network-mounted filesystems. The polling approach trades sub-millisecond event immediacy for deterministic, environment-independent behavior. The latency cost is configurable, giving operators a knob to tune based on their deployment context. This decision is architecturally coherent with DockerizedServices — since the logging system is designed to run inside containers, filesystem event reliability cannot be assumed.

---

## Implementation Details

### LiveLoggingSystem: Transcript Normalization Pipeline

The `TranscriptAdapter` in `lib/agent-api/transcript-api.js` is the sole normalization boundary between raw agent output and the unified LSL (Live Session Log) typed format. The `convertToLSL()` method is architecturally the most significant: it is where heterogeneous agent transcript schemas collapse into a single typed format consumable by downstream systems. The polling loop in `watchTranscripts()` diffs the current read against previously seen entries, meaning the system maintains internal state representing the "known" transcript snapshot and emits only deltas. New adapter implementations must be careful that `readTranscripts()` is idempotent and stateless — all state management lives in the watcher, not the adapter.

### KnowledgeManagement: Monolithic LevelDB Persistence

`GraphDatabaseService` in `src/knowledge-management/GraphDatabaseService.js` takes a deliberately simple persistence approach: the entire Graphology in-memory graph is serialized as a single JSON blob under the LevelDB key `'graph'`, with shape `{ nodes, edges, metadata }`. The internal method `_persistGraphToLevel()` handles this serialization. Restoration is equally simple — load one key, deserialize, reconstruct the Graphology instance. The service supports both manual and auto-persist modes, allowing callers to batch mutations before triggering a write, which partially offsets the write amplification cost of rewriting the entire graph on every change. **Critical caveat for developers:** concurrent writes are unsafe. LevelDB does not provide atomicity for the read-modify-write cycle on this single key, so external serialization is required if multiple processes or async operations may write concurrently.

### ConstraintSystem: Multi-Layered Enforcement

ConstraintSystem operates as a multi-layered validation infrastructure that gates code actions, file operations, and tool interactions against configured rules. Enforcement is hooks-based, defined in `config/hooks-config.json`, with constraint documentation in `docs/constraints/`. This positions ConstraintSystem as a cross-cutting concern — it intercepts operations that other components (SemanticAnalysis, LLMAbstraction, tool invocations) would otherwise perform without validation. The constraint monitor is itself a Dockerized service managed by DockerizedServices, indicating it runs as a persistent sidecar process rather than an inline library call.

### SemanticAnalysis: Multi-Agent MCP Batch Pipeline

SemanticAnalysis is implemented as a multi-agent MCP server at `integrations/mcp-server-semantic-analysis`. Its architecture is a batch-analysis pipeline, suggesting it processes code artifacts in bulk rather than responding to individual real-time requests. As an MCP server, it exposes a defined tool interface consumable by LLM agents, bridging LLMAbstraction's provider routing with structured code intelligence.

---

## Integration Points

The seven components are not loosely coupled modules — they form a layered dependency graph. **DockerizedServices** is the deployment substrate on which SemanticAnalysis, ConstraintSystem, and the graph/cache infrastructure (Memgraph, Redis) run. **LLMAbstraction** is the upstream dependency for any component that needs to invoke an LLM — SemanticAnalysis and workflow orchestration both route through it. **ConstraintSystem** sits orthogonally as an enforcement layer that intercepts operations across other components. **LiveLoggingSystem** is a consumer of agent activity, feeding off transcripts produced by agents that themselves use LLMAbstraction. **KnowledgeManagement** provides the persistent graph store that likely serves SemanticAnalysis and code-graph-rag. **CodingPatterns** is not a runtime dependency but a normative reference — it defines the conventions (agent interface contracts, `config/agents/`, `config/agent-profiles.json`) that all other components are expected to follow.

---

## Usage Guidelines

**Adapter Implementation:** Any new agent integration must implement all five methods of `TranscriptAdapter` in `lib/agent-api/transcript-api.js`. `readTranscripts()` must be idempotent; state diffing is the watcher's responsibility, not the adapter's.

**LLM Provider Switching:** Use `workflow-progress.json` to toggle LLM modes per-agent or globally. Do not hard-code provider selection. Always consume the normalized response shape `{ content, model, provider, token_usage }` — never assume a specific provider's raw response format.

**KnowledgeManagement Concurrency:** Do not issue concurrent writes to `GraphDatabaseService` without external serialization. Batch mutations using the manual-persist mode to reduce write amplification, then call persist once. Treat the single `'graph'` LevelDB key as a critical section.

**ConstraintSystem Compliance:** All file operations and tool interactions subject to constraint rules must pass through the hooks defined in `config/hooks-config.json`. Bypassing these hooks for expediency risks constraint violations that may not surface until enforcement runs asynchronously via the constraint monitor container.

**Container Awareness:** Services running inside DockerizedServices cannot rely on `fs.watch` or similar filesystem event APIs — design for polling or explicit IPC instead. LiveLoggingSystem's polling design is the established precedent.

---

## Scalability Considerations

The monolithic LevelDB persistence in KnowledgeManagement is the most significant scalability constraint in the current architecture. Write amplification grows linearly with graph size, and the lack of atomic read-modify-write makes concurrent scaling unsafe without additional coordination. Memgraph (managed by DockerizedServices) exists as a proper graph database backend and may represent the intended migration path as graph data grows beyond what LevelDB blob persistence can handle.

The polling model in LiveLoggingSystem scales in latency, not throughput — higher agent count increases the volume of transcript data diffed per interval, but the mechanism itself remains single-threaded per watcher instance. Interval tuning is the primary knob available without architectural change.

LLMAbstraction's runtime switching via `workflow-progress.json` is well-suited for development and testing flexibility but would require attention in high-concurrency production scenarios where multiple processes might race to read and update the state file.

---

## Maintainability Assessment

The project demonstrates strong maintainability instincts: abstract interfaces prevent coupling to specific agents or LLM providers, configuration-driven behavior reduces the need for code changes during operational tuning, and the constraint system provides an explicit, documented enforcement layer. The primary maintainability risk is KnowledgeManagement's monolithic persistence design — it is simple now but will require careful refactoring as graph size grows. The CodingPatterns component's role as the normative reference for conventions is valuable, but its effectiveness depends on developers actively consulting `docs/constraints/`, `config/agents/`, and `config/agent-profiles.json` when building new integrations.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem is built around a strict abstract interface defined by the `TranscriptAdapter` class in `lib/agent-api/transcript-api.js`. Every agent-specific adapter must implement five methods: `getAgentType()` (returns a string identifier like `'claude-code'`), `getTranscriptDirectory()` (returns the filesystem path where raw agent transcripts reside), `readTranscripts()` (reads and parses raw transcript files), `convertToLSL()` (transforms raw entries into the unified LSL typed format), and `getCurrentSession()` (returns metadata for the active session). Live capture is achieved not through filesystem watchers (like `fs.watch`) but through a polling loop: `watchTranscripts()` uses `setInterval` to periodically invoke `readTranscripts()` and diff against previously seen entries. This design trades immediacy for portability—`fs.watch` has known cross-platform inconsistencies, especially in Docker containers and network-mounted filesystems, so polling avoids those failure modes at the cost of introducing a configurable latency between an agent writing a transcript entry and the LSL system capturing it.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is the provider-agnostic layer that routes LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI), a local Docker Model Runner (DMR), a rapid-llm-proxy middleware, and a mock service for testing. The architecture centers on a workflow-progress.json state file that stores global and per-agent LLM mode overrides (mock/local/public), enabling dynamic runtime switching without code changes. Provider selection flows through environment variables (RAPID_LLM_PROXY_URL, LLM_CLI_PROXY_URL, LLM_PROXY_URL) with a defined priority chain, and all providers normalize their responses to a shared shape containing content, model, provider, and token usage fields.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices is the containerization layer that packages the coding project's services (semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, Redis) into a unified Docker Compose environment. The docker/docker-compose.yml orchestrates these services with Memgraph as the graph database backend and Redis for caching, while docker/Dockerfile.coding-services and docker/entrypoint.sh define the container image and startup sequence. The entrypoint delegates process supervision to docker/supervisord.conf, enabling multiple services to coexist in a single container with ordered startup and restart policies.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseService (src/knowledge-management/GraphDatabaseService.js) uses a single monolithic LevelDB key 'graph' to persist the entire in-memory Graphology graph as one JSON blob with the shape { nodes, edges, metadata }. This design means every write operation—whether updating a single node attribute or adding an edge—requires serializing the entire graph and writing it back under that one key via _persistGraphToLevel(). The trade-off is simplicity of implementation and straightforward restore (load the single key, deserialize, reconstruct the Graphology instance) at the cost of write amplification as the graph grows. The service supports both manual and auto-persist modes, allowing callers to batch multiple mutations before triggering a persist, which partially mitigates this overhead. New developers should be aware that concurrent writes are not safe without external serialization since a read-modify-write cycle on the single key is not atomic in LevelDB.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns serves as the architectural catch-all component for the Coding project, capturing general programming conventions, design patterns, and best practices that permeate the entire codebase. Based on the project structure, the system follows a consistent agent-abstraction pattern where AI agents (Claude, Copilot, Mastra, OpenCode) are unified behind a common interface defined in config/agents/ and config/agent-profiles.json, enabling agent-agnostic workflows. The project also enforces code <USER_ID_REDACTED> through a constraint monitoring system documented in docs/constraints/ with hooks-based enforcement via config/hooks-config.json.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered enforcement infrastructure that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based architecture where constraint checks are injected at pre-tool and post-tool lifecycle events, capturing violations and persisting them for dashboard display. The system bridges live session activity with historical analytics, enabling both real-time enforcement and retrospective analysis of rule compliance patterns.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline over git history and LSL (vibe) sessions to extract, classify, and persist structured knowledge entities. It coordinates specialized agents—GitHistoryAgent, VibeHistoryAgent, CodeGraphAgent, SemanticAnalysisAgent, OntologyClassificationAgent, ContentValidationAgent, and InsightGenerationAgent—each handling a distinct stage of the pipeline from data ingestion through ontology classification to knowledge-base persistence. The system integrates with km-core's OntologyRegistry for entity classification and uses the LLMService from @rapid/llm-proxy for semantic reasoning throughout the pipeline.

Architecturally, all agents extend a common `BaseAgent<TInput, TOutput>` abstract class (base-agent.ts) that wraps agent logic in a standardized `AgentResponse` envelope providing confidence scoring, issue detection, routing suggestions, and upstream context propagation. The CodeGraphAgent integrates with a separate code-graph-rag MCP server using Tree-sitter AST parsing backed by Memgraph (graph database accessed over TCP at configurable host:port), with graceful degradation when the CLI or Memgraph is unavailable. The OntologyClassificationAgent underwent a Phase 42-03 migration from a legacy ontology-load class to km-core's OntologyRegistry wrapped in a LegacyOntologyAdapter, maintaining backward compatibility with OntologyValidator and OntologyClassifier while enabling atomic reload semantics.


---

*Generated from 2 observations*
