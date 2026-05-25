# ConstraintSystem

**Type:** Component

The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It operates primarily through a hook-based architecture where hooks intercept agent tool calls (pre-tool, post-tool events) and evaluate them against constraint rules, capturing any violations for persistence and dashboard display. The system integrates with the MCP (Model Context Protocol) infrastructure via the mcp-constraint-monitor integration, and bridges live session activity with persistent violation history storage.

# ConstraintSystem — Technical Insight Document

## What It Is

The ConstraintSystem is a constraint monitoring and enforcement layer within the Coding project that validates agent tool calls and file operations against configured rules during Claude Code sessions. It is implemented across two primary locations: the hook infrastructure in `lib/agent-api/hooks/` (specifically `hook-manager.js` and `hook-config.js`) and the MCP integration package at `integrations/mcp-constraint-monitor/`. Violation persistence is handled by `scripts/violation-capture-service.js`, which writes to `.mcp-sync/` for both live streaming and historical dashboard consumption.

## Architecture and Design

The system follows a hook-based interception architecture: the UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`) intercepts pre-tool and post-tool events emitted during agent execution, evaluates them against constraint rules, and routes violations to the ViolationCaptureService for persistence.

![ConstraintSystem — Architecture](images/constraint-system-architecture.png)

Configuration uses a **two-level merge strategy** — user-level defaults from `~/.coding-tools/hooks.json` are loaded first, then project-level `.coding/hooks.json` overrides them. Handlers are sorted by numeric `priority` field for deterministic execution order. This mirrors patterns seen in sibling components like CodingPatterns where configuration layering enables per-project customization without modifying global state.

The UnifiedHookManager pre-initializes empty handler arrays for every `HookEvent` enum value at construction time, a defensive design that eliminates null-check overhead during hot-path dispatch. HookConfigLoader validates that each handler entry has `type` and `path` fields, and supports agent-scoping via an `agents` array — allowing constraints to target specific agents selectively.

![ConstraintSystem — Relationship](images/constraint-system-relationship.png)

## Implementation Details

**ViolationCaptureService** (`scripts/violation-capture-service.js`) writes violations to two destinations: an append-only JSONL log at `.mcp-sync/session-violations.jsonl` for live session data, and a capped JSON array at `.mcp-sync/violation-history.json` (max 1000 entries) for the MCPConstraintMonitorIntegration dashboard. The 1000-entry cap is a pragmatic trade-off — sufficient for dashboard analytics without unbounded growth.

The service includes `sanitizeParams()`, which redacts fields matching keywords (`password`, `token`, `key`, `secret`, `auth`) before persisting tool parameters. This ensures sensitive data never reaches violation logs — critical since these logs feed into the dashboard served by DockerizedServices on ports 3030/3031.

`calculateStatistics()` computes real-time metrics (last-24-hour counts, severity breakdowns, most-common constraint IDs, per-session averages) directly from the violation history without additional indexing infrastructure, keeping the system self-contained.

The child components map cleanly to architectural responsibilities: HookInterceptor defines the wire format for hook payloads (documented in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`), ConstraintRuleEngine owns the rule configuration schema (`docs/constraint-configuration.md`), and MCPConstraintMonitorIntegration wraps the whole system as an MCP-compatible server component.

## Integration Points

The system bridges into the MCP ecosystem via `integrations/mcp-constraint-monitor/`, making violation data accessible to MCP-aware tools. The dashboard component under `integrations/mcp-constraint-monitor/dashboard/` consumes the capped violation history file. Within DockerizedServices, the constraint monitor runs as a service pair (API on port 3031, dashboard on port 3030) managed by the same PSM/wrapper-script lifecycle as other services.

The hook infrastructure in `lib/agent-api/hooks/` is shared with the broader agent execution pipeline — the same hook manager that enforces constraints could serve other cross-cutting concerns. The `.mcp-sync/` directory acts as the file-based integration seam between the capture service and the dashboard.

## Usage Guidelines

When adding new constraint rules, follow the schema in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` and register handlers in project-level `.coding/hooks.json` with explicit numeric priorities. Use the `agents` array field to scope constraints to specific agents rather than applying them globally. Never store sensitive data in constraint rule definitions since violation records (including tool parameters) are persisted — rely on the built-in sanitization keywords, and extend `sanitizeParams()` if your domain introduces new sensitive field names. The 1000-entry history cap means long-running projects should treat `violation-history.json` as a recent-window view, not an audit log — use the JSONL append-log for complete history if needed.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions int; LLMAbstraction: LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: publi; DockerizedServices: DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasse; KnowledgeManagement: [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time ; CodingPatterns: [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LL; ConstraintSystem: The ConstraintSystem is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during; SemanticAnalysis: SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-pars.

### Children
- [HookInterceptor](./HookInterceptor.md) -- integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md defines the wire format for hook payloads exchanged between Claude Code and the constraint monitor, covering pre-tool and post-tool event structures
- [ConstraintRuleEngine](./ConstraintRuleEngine.md) -- integrations/mcp-constraint-monitor/docs/constraint-configuration.md provides the full configuration schema for defining constraint rules, including rule types, scopes, and enforcement modes
- [MCPConstraintMonitorIntegration](./MCPConstraintMonitorIntegration.md) -- integrations/mcp-constraint-monitor/README.md describes the integration package that wraps constraint monitoring as an MCP-compatible server component

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is the provider-agnostic layer in the mcp-server-semantic-analysis integration that abstracts LLM calls across multiple backends: public cloud providers (Anthropic, OpenAI, Groq), local inference via Docker Model Runner (DMR), and a mock mode for testing. The component manages runtime mode selection through a workflow-progress.json state file, supporting both global and per-agent mode overrides with a priority chain: per-agent override > global mode > legacy flag > default ('public'). This enables dynamic switching between inference backends without code changes, supporting development, testing, and production scenarios from the same codebase.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and service lifecycle management layer for the coding project's suite of microservices. It encompasses the MCP semantic analysis server, constraint monitor (API on port 3031, dashboard on port 3030), code-graph-rag integration, and supporting databases (Memgraph, Redis). The architecture uses wrapper scripts (api-service.js, dashboard-service.js) that spawn child processes, register them with a ProcessStateManager (PSM) singleton, and forward OS signals for graceful shutdown. Services are classified as required or optional with retry-with-backoff startup logic handled by lib/service-starter.js.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] GraphDatabaseAdapter (storage/graph-database-adapter.ts) implements a dual-mode routing strategy that is determined once at initialization time via VkbApiClient.isServerAvailable(), not re-evaluated on each operation. This means if the VKB HTTP server starts or stops after the adapter is initialized, the adapter continues using the mode it selected at startup. In 'live' mode it routes all reads and writes through the HTTP API, avoiding LevelDB's single-writer lock. In 'direct' mode it accesses GraphDatabaseService (which holds the LevelDB handle) directly. The consequence is that two processes attempting direct mode simultaneously will collide on the LevelDB lock — the dual-mode design exists specifically to serialize writers through the HTTP server when it is available. New developers integrating additional write paths must either go through the VKB HTTP API or ensure only one process operates in direct mode at a time.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] Agent Lazy-Initialization Pattern: Across the Coding project's agent implementations, a consistent lazy-initialization idiom is applied where LLM client setup is deferred until actual execution rather than performed at construction time. This pattern is documented in docs/puml/agent-integration-flow.puml and docs/puml/agent-abstraction-architecture.puml. The motivation is to avoid paying the cost of LLM connection setup (which may involve network calls, credential validation, and model loading) when an agent object is instantiated—particularly important in systems where many agent types are registered but only a subset are invoked per workflow. A new developer working on an agent should expect a two-phase lifecycle: a lightweight constructor that stores configuration references, followed by an initialize() or setup() method (or equivalent lazy property) that establishes the actual LLM connection on first use. Violating this convention by eagerly connecting in the constructor would break the startup performance characteristics that the rest of the system assumes.
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.


---

*Generated from 8 observations*
