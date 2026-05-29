# ConstraintSystem

**Type:** Component

The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.

## What It Is

The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework implemented across several key paths: `lib/agent-api/hooks/hook-manager.js` (UnifiedHookManager), `lib/agent-api/hooks/hook-config.js` (HookConfigLoader), `scripts/violation-capture-service.js` (ViolationCaptureService), and `integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts` (ContentValidationAgent). It validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions, persisting violations to `.mcp-sync/` for downstream consumption by the ConstraintDashboard.

Within the Coding parent hierarchy, ConstraintSystem is a peer to LiveLoggingSystem, SemanticAnalysis, and KnowledgeManagement — all of which operate over shared session activity. Where LiveLoggingSystem captures agent conversations into normalized transcripts and SemanticAnalysis indexes knowledge-base integrity, ConstraintSystem focuses narrowly on rule enforcement and violation tracking during live tool invocations.

## Architecture and Design

![ConstraintSystem — Architecture](images/constraint-system-architecture.png)

The system is organized into three child components with distinct responsibilities: HookInterceptionLayer captures tool invocations in a two-phase pre/post model; ViolationCaptureService bridges live session state to persistent storage; and ConstraintDashboard consumes that storage for UI display. This decomposition creates a clean separation between detection, persistence, and presentation.

The central architectural pattern is **hook-based interception**: every tool invocation passes through UnifiedHookManager, which dispatches HookEvent entries at both pre-tool and post-tool phases. This two-phase model allows constraints to block actions before execution (pre-tool) and audit outcomes after (post-tool). Handlers are registered with explicit priority integers and sorted ascending at registration time in `UnifiedHookManager.registerHandler()`, so lower-priority integers execute first — a deterministic, ordered pipeline rather than an unordered broadcast.

Configuration is layered: HookConfigLoader reads from user-level (`~/.coding-tools/hooks.json`) and project-level (`.coding/hooks.json`), with project config overriding user config. This mirrors the CodingPatterns convention of externalizing configuration rather than hardcoding values, and the `agents` array field on each handler enables scoped enforcement per agent — meaning constraint rules can be selectively applied to Claude vs. Copilot vs. other backends without code changes.

The persistence boundary is deliberately file-based. ViolationCaptureService writes to `.mcp-sync/session-violations.jsonl` (append log for live streaming) and `.mcp-sync/violation-history.json` (capped at 1000 entries for dashboard display). This file-based decoupling means the ConstraintDashboard never couples directly to live session state — it reads files written by the capture service, a design that tolerates dashboard restarts without data loss and aligns with the DockerizedServices pattern of health-checking via filesystem/HTTP probes rather than shared memory.

![ConstraintSystem — Relationship](images/constraint-system-relationship.png)

## Implementation Details

**UnifiedHookManager** (`lib/agent-api/hooks/hook-manager.js`) is the central dispatcher. It loads handler configs from the two-layer config system at startup, registers handlers sorted by priority, and fires pre-tool and post-tool HookEvents around each tool call. Priority sorting at registration time (not at dispatch time) means the sort cost is paid once, keeping the hot dispatch path O(n) iteration over a pre-sorted list.

**HookConfigLoader** (`lib/agent-api/hooks/hook-config.js`) enforces structural validation requiring `type` and `path` on every handler, with optional `priority` (number) and `agents` (array). Failing validation at load time rather than dispatch time ensures misconfigured handlers are caught before any tool invocations occur — a fail-fast design that prevents silent constraint gaps.

**ViolationCaptureService** (`scripts/violation-capture-service.js`) maintains violations in memory and flushes to two formats on every write. The `calculateStatistics()` method computes severity breakdowns, most-common constraint ID, and per-session average violation rate directly from the in-memory array on each write — a recompute-on-write approach that trades CPU on write for simplicity (no separate stats cache to invalidate). The 1000-entry cap on `violation-history.json` bounds dashboard file size without truncating the raw JSONL stream.

**ContentValidationAgent** (`integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts`) extends constraint validation beyond runtime tool interception into knowledge-base integrity. It extracts file paths, commands, and API endpoints via regex patterns and cross-references them against the live codebase, producing `EntityValidationReport` scores from 0–100. This bridges ConstraintSystem with the SemanticAnalysis sibling component, applying constraint-style validation to documentation and knowledge graph entities rather than live tool calls.

## Integration Points

The ConstraintSystem connects outward in three directions. First, it integrates with the agent execution environment through UnifiedHookManager's HookEvent interface — any tool invocation by Claude Code (or other agents declared in `agents` arrays) passes through the hook pipeline. Second, it writes to `.mcp-sync/` which is the shared filesystem interface consumed by ConstraintDashboard; this directory is also referenced by DockerizedServices' containerized constraint monitor service, suggesting the `.mcp-sync/` path is a stable inter-process contract. Third, ContentValidationAgent integrates with SemanticAnalysis pipelines, cross-referencing extracted entities against the live codebase for integrity scoring.

KnowledgeManagement is a likely upstream dependency: the knowledge graph entities that ContentValidationAgent validates presumably originate from KnowledgeManagement's Graphology/LevelDB store. Similarly, LiveLoggingSystem's session transcripts may feed violation context, though no direct coupling is observed in the current observations.

## Usage Guidelines

**Hook configuration** must declare both `type` and `path` on every handler — HookConfigLoader will reject incomplete configurations at load time. Use `priority` integers deliberately: lower numbers execute first in the constraint pipeline, so blocking/pre-check handlers should carry lower priority values than logging/audit handlers. Use the `agents` array to scope rules to specific agent backends rather than applying all constraints globally.

**Violation history** is capped at 1000 entries in `violation-history.json`. For longer-term analysis, consume `session-violations.jsonl` directly as it is an unbounded append log. Avoid reading `violation-history.json` during high-frequency write cycles; the file is rewritten on every violation capture, so readers should tolerate partial writes or implement read-with-retry.

**ContentValidationAgent scores** range 0–100 on `EntityValidationReport` — treat scores below a defined threshold as constraint violations requiring knowledge-base remediation rather than runtime blocking. Since this agent operates within the SemanticAnalysis pipeline rather than the hook interception layer, its violations may not flow through ViolationCaptureService unless explicitly wired.

When extending the constraint pipeline, register new handlers at the project-level `.coding/hooks.json` rather than the user-level config to ensure team-wide enforcement. Per the CodingPatterns conventions shared across the Coding project, handler implementations should follow the constructor+initialize+execute lifecycle common to agent abstractions in this codebase.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude C; LLMAbstraction: LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local ; DockerizedServices: DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint mo; KnowledgeManagement: The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lif; CodingPatterns: CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design pattern; ConstraintSystem: The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interac; SemanticAnalysis: The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized a.

### Children
- [ConstraintDashboard](./ConstraintDashboard.md) -- docs/constraints/README.md documents the ConstraintDashboard as a consumer of violation history files written to .mcp-sync, establishing a file-based decoupling between the live session and the UI layer
- [ViolationCaptureService](./ViolationCaptureService.md) -- docs/constraints/constraint-monitoring-system.md identifies ViolationCaptureService as the bridge between live session activity and persistent storage, writing to both a JSONL log and a JSON history file
- [HookInterceptionLayer](./HookInterceptionLayer.md) -- docs/constraints/constraint-monitoring-system.md describes a hook-based interception architecture with distinct pre-tool and post-tool hook events, establishing a two-phase capture model around each tool invocation

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude Code—into a unified format. It handles session windowing (time-window identifiers like '0800-0900'), multi-user support via SHA-256 user hashing, file routing with rotation thresholds, and transcript capture from agent-native formats. The system bridges raw agent transcripts to a normalized LSL format used downstream by semantic analysis and knowledge management pipelines.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local inference backends. It provides three distinct execution modes (mock, local, public) with per-agent overrides stored in a workflow-progress.json file, allowing dynamic routing without code changes. The architecture consists of a mock service for testing, a DMR (Docker Model Runner) provider for local inference, and a direct-fetch wrapper (llm-with-process.ts) that bypasses the SDK to inject telemetry process tags into the rapid-llm-proxy endpoint.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design patterns, and best practices that permeate the entire codebase. The project follows consistent patterns visible across its configuration, tooling, and documentation: agent abstractions use a constructor+initialize+execute lifecycle, shell scripts in bin/ follow a proxy/delegation pattern to underlying services, and configuration is externalized into config/ YAML/JSON files rather than hardcoded values. The system emphasizes agent-agnostic design, enabling multiple AI backends (Claude, Copilot, Mastra, OpenCode) to operate under a unified interface.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.


---

*Generated from 7 observations*
