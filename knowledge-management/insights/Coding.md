# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: [LLM] The `TranscriptAdapter` abstract base class in `lib/agent-api/transcript-api.js` defines a pluggable adapter contract that decouples the LSL pip; LLMAbstraction: LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across public APIs (Anthropic, OpenAI, Gro; DockerizedServices: [LLM] The DockerizedServices component uses a dual-probe health checking architecture implemented in lib/utils/service-probe.js that strictly separate; KnowledgeManagement: [LLM] The primary persistence mechanism in KnowledgeManagement is a single-key LevelDB strategy implemented in `src/knowledge-management/GraphDatabase; CodingPatterns: [LLM] The MCP (Model Context Protocol) server pattern is applied uniformly across all three major integrations: mcp-constraint-monitor, mcp-server-sem; ConstraintSystem: The ConstraintSystem is a monitoring and enforcement layer that validates code actions and file operations against configured rules during Claude Code; SemanticAnalysis: [LLM] The SemanticAnalysis pipeline is structured around a coordinator pattern where specialized agents each extend BaseAgent<TInput,TOutput> defined .

# Coding — Technical Insight Document

## What It Is

The **Coding** project is the root node of a development infrastructure knowledge hierarchy, comprising seven first-level (L1) components: **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**. Together these components form an integrated development environment augmented with AI-agent tooling, runtime service orchestration, constraint enforcement, and semantic code intelligence. Rather than a single monolithic application, the Coding project is best understood as a collection of coordinated subsystems, each with distinct responsibilities but sharing common architectural idioms — most notably the MCP (Model Context Protocol) server pattern documented in CodingPatterns.

---

## Architecture and Design

### Uniform MCP Integration Pattern

The most visible cross-cutting architectural decision in the Coding project is the consistent application of the MCP server pattern across major integrations. As documented in **CodingPatterns**, every major AI-agent integration — `mcp-constraint-monitor`, `mcp-server-semantic-analysis`, and `code-graph-rag` — follows an identical directory convention: a `README.md` describing the tool interface, a `docs/` subdirectory separating API surface (`docs/api/README.md`) from internal architecture (`docs/architecture/README.md`), and a configuration file declaring tool schemas to AI agent hosts. This uniformity is treated as an **enforced project convention**, meaning it is not organic — new integrations are expected to conform to this scaffold without deviation. This decision dramatically reduces cognitive overhead when navigating between integrations and makes the surface area each integration exposes to AI agents explicit and auditable.

### Pluggable Adapter Contracts

The **LiveLoggingSystem** demonstrates a textbook application of the **Template Method** and **Abstract Interface** patterns. The `TranscriptAdapter` abstract base class in `lib/agent-api/transcript-api.js` defines five abstract methods — `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()` — that concrete adapters (e.g., Claude Code, Copilot CLI) must implement. The `watchTranscripts()` method deliberately breaks from the abstract contract: it is a **concrete, shared polling implementation** using `setInterval` at a 1000ms default interval with a `lastEntryCount` integer cursor. This design decision means the watch mechanism is owned centrally and never duplicated across adapters, trading flexibility for uniformity in how event deltas are delivered to consumers.

### Dual-Probe Health Architecture

**DockerizedServices** applies a strict **separation-of-concerns principle** to service health verification via `lib/utils/service-probe.js`. The architectural invariant encoded as **SPEC R6** — that probes may only return `'running'`, `'stopped'`, or `'unknown'`, never `'healthy'` — is a deliberate state-machine constraint. By banning a fourth status string, the `health-coordinator.js` in `scripts/health-coordinator.js` can uniformly handle heterogeneous services (Next.js, Node.js, Memgraph via Bolt, Redis) without protocol-specific branching. The dual-probe split (`probeHttpHealth()` for HTTP/HTTPS, `probeTcpPort()` for raw socket protocols) maps cleanly onto the service landscape of the project while keeping the coordinator's consumption layer protocol-agnostic.

### Multi-Mode LLM Routing

**LLMAbstraction** introduces a three-mode routing architecture (`mock`, `local`, `public`) resolved dynamically per-agent, with state stored in `workflow-progress.json`. All requests are funneled through a `rapid-llm-proxy` daemon on port 12435, which handles provider selection (Anthropic, OpenAI, Groq, Docker Model Runner), tier-based routing, and per-call telemetry attribution. This architecture isolates all provider-specific logic behind the proxy boundary, meaning individual agents never directly reference a provider SDK — a significant reduction in coupling that also enables seamless substitution between local and cloud inference without code changes.

---

## Implementation Details

### LiveLoggingSystem — Polling Cursor Model

The `watchTranscripts()` implementation in `lib/agent-api/transcript-api.js` uses an integer `lastEntryCount` as a cursor rather than a file-position offset or timestamp. On each `setInterval` tick, the full transcript is read and its length compared against `lastEntryCount`. If the count has grown, registered callbacks are fired with only the **delta slice** — entries from `lastEntryCount` to the new end. This is an O(n) operation per poll cycle relative to total session entry count, meaning long-running sessions accumulate growing per-tick overhead. Developers building on LiveLoggingSystem for high-volume or long-lived agent sessions should be aware this is a known performance boundary.

### KnowledgeManagement — Single-Key LevelDB Strategy

The persistence layer in `src/knowledge-management/GraphDatabaseService.js` makes a deliberate trade-off: the entire Graphology in-memory graph (all nodes, edges, metadata) is serialized as a single JSON blob stored under the LevelDB key `'graph'`. This design, combined with the `isDirty` flag and deferred `_persistGraphToLevel()` flush, optimizes for **read-heavy, batch-write** workloads. The trade-off is a **crash-loss window**: any mutations between the last flush and a process crash are silently lost, as they exist only in memory. The design explicitly excludes per-entity atomic updates that would be possible with per-key storage — a deliberate choice that simplifies read paths at the cost of write durability granularity.

### ConstraintSystem — Runtime Enforcement Layer

The **ConstraintSystem** functions as a monitoring and enforcement layer that validates code actions and file operations against configured rules during Claude Code sessions. While implementation details beyond this role are not fully elaborated in the available observations, it is directly surfaced to AI agents via `mcp-constraint-monitor`, one of the three canonical MCP integrations described in CodingPatterns.

### SemanticAnalysis — Coordinator + Specialized Agent Pipeline

The **SemanticAnalysis** pipeline uses a **coordinator pattern** in which specialized agents each extend `BaseAgent<TInput,TOutput>` (defined in a base path not fully specified in observations). The coordinator routes work to type-specialized agents, maintaining a typed generic contract between pipeline stages. This is exposed externally via `mcp-server-semantic-analysis`, which documents its API surface and internal architecture in separate subdirectories per the CodingPatterns convention.

---

## Integration Points

The seven L1 components are not isolated — they form a dependency graph with several notable integration surfaces:

- **LLMAbstraction ↔ SemanticAnalysis and ConstraintSystem**: Any component requiring LLM inference routes through `rapid-llm-proxy` on port 12435. SemanticAnalysis agents (extending `BaseAgent<TInput,TOutput>`) and constraint evaluation logic both depend on LLMAbstraction for provider-agnostic model calls.
- **LiveLoggingSystem ↔ agent adapters**: The `TranscriptAdapter` contract in `lib/agent-api/transcript-api.js` is the explicit integration boundary between the LSL pipeline and any agent implementation (Claude Code, Copilot CLI). New agents integrate solely through this interface.
- **DockerizedServices ↔ all runtime services**: The `health-coordinator.js` polling loop at 5-second intervals is the runtime integration point for Next.js dashboard, Node.js API, Memgraph, and Redis. Any new service added to the project must register with this coordinator using the appropriate probe type.
- **KnowledgeManagement ↔ SemanticAnalysis**: The graph persistence layer in `GraphDatabaseService.js` is the likely backing store for semantic analysis artifacts, though the flush cycle must be explicitly managed by any component writing to the graph.
- **CodingPatterns ↔ ConstraintSystem and SemanticAnalysis**: Both `mcp-constraint-monitor` and `mcp-server-semantic-analysis` are concrete instantiations of the MCP pattern governance defined in CodingPatterns.

---

## Usage Guidelines

### Adding a New Agent to LiveLoggingSystem
Subclass `TranscriptAdapter` in `lib/agent-api/transcript-api.js` and implement all five abstract methods. Do not override `watchTranscripts()` — the shared polling implementation is intentional and centralizes delta delivery logic. Be aware that session length directly impacts polling overhead due to the O(n) cursor model; for agents expected to generate very high transcript volumes, this warrants architectural review.

### Adding a New MCP Integration
Follow the CodingPatterns scaffold precisely: create a `README.md` with tool description, a `docs/api/README.md` for API surface, a `docs/architecture/README.md` for internal design, and a configuration file declaring tool schemas. Deviation from this structure breaks the navigational and AI-agent discoverability conventions the project enforces.

### Adding a New Dockerized Service
Use `probeHttpHealth()` for HTTP/HTTPS services and `probeTcpPort()` for all others (e.g., Bolt protocol for Memgraph). Never return a status string other than `'running'`, `'stopped'`, or `'unknown'` from any probe — introducing a fourth value will corrupt the `health-coordinator.js` state machine (SPEC R6).

### Writing to the Knowledge Graph
Any code path that mutates nodes or edges in `GraphDatabaseService.js` must explicitly trigger the flush cycle. The `isDirty` flag defers writes — mutations that are not flushed before process termination are permanently lost. There is no automatic flush on exit.

### LLM Mode Configuration
Per-agent LLM mode (`mock`, `local`, `public`) is stored in `workflow-progress.json` and resolved at call time by `rapid-llm-proxy`. Global and per-agent overrides are both supported. Developers testing new agents should default to `mock` mode to avoid cloud API consumption and use `local` (Docker Model Runner) for integration testing before enabling `public`.

---

## Scalability Considerations

Two known scalability boundaries are grounded in the observations. First, the `watchTranscripts()` O(n) polling model in LiveLoggingSystem will degrade with session length — this is a structural limitation of the `lastEntryCount` integer cursor design. Second, the single-key LevelDB blob in KnowledgeManagement means graph serialization and deserialization costs scale with total graph size, not with the size of individual mutations. Both represent deliberate trade-offs optimized for current workload profiles (short sessions, moderate graph sizes) that would require architectural revision under significantly larger loads.

## Maintainability Assessment

The Coding project exhibits strong maintainability signals at the pattern level: the MCP convention enforced across CodingPatterns integrations, the abstract adapter contract in LiveLoggingSystem, and the strict status-string invariant in DockerizedServices all reduce the surface area for accidental divergence. The primary maintainability risk lies in the KnowledgeManagement flush cycle — it is an implicit contract that any graph-mutating code path must honor, and there is no compiler or runtime enforcement preventing a developer from omitting the flush trigger. Similarly, the `isDirty` deferred-write pattern offers no visibility into unflushed state outside of in-memory inspection.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The `TranscriptAdapter` abstract base class in `lib/agent-api/transcript-api.js` defines a pluggable adapter contract that decouples the LSL pipeline from specific agent implementations. The five abstract methods — `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()` — establish a clear interface that concrete adapters (e.g., for Claude Code and Copilot CLI) must implement. This pattern means the core LSL infrastructure never directly references agent-specific transcript formats or filesystem layouts. A new developer adding support for a third agent (say, Cursor or Aider) would subclass `TranscriptAdapter` and implement only these five methods without touching the converter, file manager, or validation layers. The `watchTranscripts()` method is notably NOT abstract — it is a concrete polling implementation shared by all adapters, using `setInterval` with a default 1000ms interval and a `lastEntryCount` integer cursor that advances only when new entries are detected, then fires registered callbacks with only the delta entries. This means the watch mechanism is O(n) in total entry count per poll cycle, which could become a performance concern for very long sessions.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across public APIs (Anthropic, OpenAI, Groq), a local Docker Model Runner (DMR), and a mock mode for testing. The system routes requests through a rapid-llm-proxy daemon (port 12435) that handles provider selection, tier-based routing, and per-call telemetry attribution. Mode selection is dynamic and per-agent, stored in workflow-progress.json, supporting global and per-agent overrides across three modes: 'mock', 'local' (DMR), and 'public' (cloud APIs).
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component uses a dual-probe health checking architecture implemented in lib/utils/service-probe.js that strictly separates HTTP-based and TCP-based service verification. probeHttpHealth() issues HTTP/HTTPS requests and maps 2xx/3xx response codes to the 'running' state, while probeTcpPort() opens a raw net.Socket connection to verify port reachability for non-HTTP protocols like Memgraph's Bolt protocol. A critical architectural invariant (documented as SPEC R6) enforces that neither probe ever returns the string 'healthy'—only 'running', 'stopped', or 'unknown' are valid return values. This distinction matters because health-coordinator.js in scripts/health-coordinator.js consumes these probes on a 5-second polling interval and must be able to uniformly handle all service types (Next.js dashboard, Node.js API, Memgraph, Redis) without special-casing the protocol. New developers adding services must use probeTcpPort() for any non-HTTP service and must not introduce a fourth status string, or the health-coordinator's state machine will behave incorrectly.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The primary persistence mechanism in KnowledgeManagement is a single-key LevelDB strategy implemented in `src/knowledge-management/GraphDatabaseService.js`. Rather than storing each graph entity as a separate LevelDB key (which would enable partial reads and atomic per-entity updates), the entire Graphology in-memory graph is serialized as one JSON blob stored under the key `'graph'`. This blob contains all nodes, edges, and metadata. Writes are deferred using an `isDirty` flag — mutations to the graph set `isDirty = true`, and `_persistGraphToLevel()` is only called when a flush is explicitly triggered. This design optimizes for read-heavy, batch-write workloads but creates a risk of data loss if the process crashes between mutations and the next flush. New developers should be aware that any code path that modifies graph nodes or edges must ensure the flush cycle is triggered, or changes will silently remain only in memory.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The MCP (Model Context Protocol) server pattern is applied uniformly across all three major integrations: mcp-constraint-monitor, mcp-server-semantic-analysis, and code-graph-rag. Each integration follows a consistent directory layout with a README.md describing the tool interface, a docs/ subdirectory containing architectural detail, and configuration files that declare the tool's capabilities to AI agent hosts. This pattern means new integrations can be scaffolded by copying this structure and registering new tool definitions. The mcp-server-semantic-analysis integration further documents this in docs/api/README.md and docs/architecture/README.md, separating API surface from internal architecture. Developers adding a new MCP tool should expect to create at minimum: a README with tool description, an API reference doc, and a configuration file declaring tool schemas. The consistency of this pattern across integrations suggests it is an enforced project convention rather than an organic coincidence.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a monitoring and enforcement layer that validates code actions and file operations against configured rules during Claude Code sessions. It operates through a hook-based architecture where constraint checks are triggered at key lifecycle points (pre-tool, post-tool, etc.) and violations are captured, persisted, and surfaced to dashboards. The system integrates with Claude Code's native hook mechanism via configuration files at user-level (~/.coding-tools/hooks.json) and project-level (.coding/hooks.json), with project config overriding user config.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis pipeline is structured around a coordinator pattern where specialized agents each extend BaseAgent<TInput,TOutput> defined in src/agents/base-agent.ts. This base class implements a strict template-method execute() that sequences six steps in order: process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), and buildMetadata(). Every agent—CodeGraphAgent, SemanticAnalysisAgent, OntologyClassificationAgent, ContentValidationAgent—inherits this contract and returns a uniform AgentResponse envelope. This design means a new developer adding an agent only needs to implement the domain-specific process() logic; confidence scoring, issue detection, and metadata construction are guaranteed to run in a consistent order regardless of which agent is invoked. The tradeoff is that the template method imposes overhead steps even when an agent's output is trivially simple, and agents cannot short-circuit the sequence without throwing exceptions.


---

*Generated from 2 observations*
