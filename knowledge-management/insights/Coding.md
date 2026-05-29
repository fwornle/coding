# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude C; LLMAbstraction: LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local ; DockerizedServices: DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint mo; KnowledgeManagement: The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lif; CodingPatterns: CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design pattern; ConstraintSystem: The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interac; SemanticAnalysis: The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized a.

# Coding Project — Technical Reference Manual

## What It Is

The **Coding** project is a top-level development infrastructure platform composed of seven first-class components that together form a cohesive AI-assisted coding environment. There are no root-level code symbols directly attached to this node — it functions as an organizational and conceptual root in the knowledge hierarchy rather than a code artifact itself. Its children are the authoritative implementations: **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**. Each child addresses a distinct infrastructure concern, and together they constitute the full system.

The platform is designed around AI agent workflows — primarily Claude Code — and provides the scaffolding for those agents to operate with observability, constraint enforcement, semantic understanding, and persistent knowledge. It is less a traditional application and more a *<COMPANY_NAME_REDACTED>-infrastructure*: tooling that supports the development process itself.

---

## Architecture and Design

### Layered Infrastructure Model

The seven L1 components map cleanly onto distinct infrastructure layers, each with well-scoped responsibilities:

| Layer | Component | Responsibility |
|---|---|---|
| Observability | LiveLoggingSystem | Capture and normalize agent session transcripts |
| AI Routing | LLMAbstraction | Provider-agnostic model dispatch |
| Containerization | DockerizedServices | Service packaging and lifecycle |
| Knowledge | KnowledgeManagement | Graph persistence and entity lifecycle |
| Safety | ConstraintSystem | Validate and enforce code/tool actions |
| Intelligence | SemanticAnalysis | Multi-agent semantic pipeline |
| Convention | CodingPatterns | Cross-cutting design governance |

This is not a microservices decomposition in the traditional sense — the components are infrastructure subsystems that operate cooperatively rather than independently deployable business services. The coupling between them is intentional and data-driven: **LiveLoggingSystem** feeds normalized transcripts downstream into **SemanticAnalysis** and **KnowledgeManagement**; **SemanticAnalysis** runs as an MCP server (`integrations/mcp-server-semantic-analysis`) containerized by **DockerizedServices**; **KnowledgeManagement** stores the outputs of semantic analysis into a persistent graph.

### Agent-Agnostic Design as a First-Class Principle

A fundamental architectural decision visible across the project is **agent-agnosticism**. **CodingPatterns** documents this explicitly: multiple AI backends (Claude, Copilot, Mastra, OpenCode) operate under a unified interface. This manifests concretely in **LLMAbstraction**, which supports Anthropic, OpenAI, Groq, and local inference backends through a single abstraction layer with three execution modes (`mock`, `local`, `public`). The routing decision is externalized into `workflow-progress.json`, meaning AI backend selection requires no code changes — a deliberate design to keep the execution environment separate from the logic.

### Externalized Configuration

Across all components, configuration is externalized into `config/` YAML/JSON files rather than hardcoded values. This is identified as a project-wide pattern in **CodingPatterns** and is structurally enforced by the existence of `workflow-progress.json` for LLM routing, `docker/docker-compose.yml` and `supervisord.conf` for service topology, and typed YAML-driven agent configurations. This makes the system reconfigurable without recompilation and supports the multi-backend agent model.

---

## Implementation Details

### Session Capture and Windowing (LiveLoggingSystem)

The **LiveLoggingSystem** handles the boundary between raw agent-native transcript formats and the normalized LSL format consumed by downstream systems. It introduces **time-window identifiers** (e.g., `'0800-0900'`) for session windowing, **SHA-256 user hashing** for multi-user privacy, and **file rotation thresholds** to manage log volume. This design choice — hashing users rather than omitting them — preserves auditability while protecting identity. The LSL format acts as a contract: anything emitted by the logging system is guaranteed to be parseable by **SemanticAnalysis** and **KnowledgeManagement** pipelines.

### LLM Dispatch Architecture (LLMAbstraction)

**LLMAbstraction** implements three distinct execution paths:
- **Mock service** — for deterministic testing without live API calls
- **DMR (Docker Model Runner)** — local inference backend, containerized via **DockerizedServices**
- **`llm-with-process.ts` direct-fetch wrapper** — bypasses the SDK entirely to inject telemetry process tags into the `rapid-llm-proxy` endpoint

The direct-fetch approach in `llm-with-process.ts` is a notable trade-off: it sacrifices SDK-provided safety and type guarantees to gain the ability to inject custom telemetry metadata that the SDK would otherwise strip. Per-agent mode overrides stored in `workflow-progress.json` allow fine-grained routing — different agents in the same workflow can use different backends simultaneously.

### Graph Infrastructure (KnowledgeManagement)

The knowledge graph is built on **Graphology** (in-memory) with **LevelDB** as the persistence backend. Entities carry typed attributes (`System`, `Project`, `Pattern`) and participate in typed relationships. The **CodeGraphAgent** extends this with repository indexing via **Tree-sitter AST parsing**, enabling the graph to represent code structure (not just knowledge concepts). An integration path to **Memgraph** (an external graph database, containerized by **DockerizedServices**) provides a heavier-weight query capability via Cypher for workloads that exceed Graphology's in-process model.

### Container Topology (DockerizedServices)

The `docker/docker-compose.yml` and `docker/Dockerfile.coding-services` define the deployment topology. **supervisord.conf** manages multiple co-located processes within a single container — a deliberate choice that trades process isolation for deployment simplicity. The health system is strict by contract: the health coordinator returns only `'running'`, `'stopped'`, or `'unknown'` — never `'healthy'`. This prevents false-positive health signals and forces consumers to treat health as a binary liveness check rather than a <USER_ID_REDACTED> guarantee. Two probe mechanisms (HTTP health endpoints and TCP port checks) provide redundancy for heterogeneous service types.

### Constraint Enforcement (ConstraintSystem)

The **ConstraintSystem** is a multi-layered validation framework that intercepts code actions, file operations, and tool interactions. Its position in the architecture — sitting between agent intent and execution — makes it a safety boundary for the entire platform. Specific implementation details are not surfaced at this hierarchy level; see the **ConstraintSystem** child node for full mechanics.

### Semantic Pipeline (SemanticAnalysis)

**SemanticAnalysis** runs as an MCP server at `integrations/mcp-server-semantic-analysis`, orchestrating a pipeline of specialized agents. Its MCP server interface means it integrates natively with Claude Code's tool-use protocol, allowing semantic analysis capabilities to be invoked as tools within agent sessions. This is architecturally significant: semantic analysis is not a batch offline process but a live, on-demand capability available during agent execution.

---

## Integration Points

The data flow between components follows a clear pipeline:

```
Agent Sessions
     │
     ▼
LiveLoggingSystem  ──(LSL format)──▶  SemanticAnalysis (MCP)
                                            │
                                            ▼
                                    KnowledgeManagement
                                    (Graphology + LevelDB + Memgraph)
```

**LLMAbstraction** is a horizontal dependency — consumed by any component that needs to invoke an LLM, including **SemanticAnalysis** and potentially **ConstraintSystem**. **DockerizedServices** is the deployment substrate for **SemanticAnalysis**, **KnowledgeManagement** (Memgraph), the constraint monitor, and Redis. **CodingPatterns** is not a runtime dependency but a design governance layer that shapes how all other components are built — its `constructor+initialize+execute` lifecycle convention, for instance, is expected to be followed by all agent abstractions across the project.

The `bin/` shell scripts follow a **proxy/delegation pattern** — they do not implement logic directly but route to underlying services, providing a stable external interface that decouples callers from service internals.

---

## Usage Guidelines

### Agent Lifecycle Convention
All agent abstractions in the project follow the `constructor → initialize → execute` lifecycle pattern documented in **CodingPatterns**. New agent implementations must respect this contract to remain compatible with the orchestration layer. Deviation creates inconsistency in how agents are bootstrapped, particularly when **LLMAbstraction** injects routing configuration at initialization time.

### LLM Backend Selection
Backend routing is controlled via `workflow-progress.json`. Developers should not hardcode backend selection in agent logic. When adding a new agent or workflow, register its mode preference in the workflow-progress file. The `mock` mode should be the default for unit tests — never use `public` mode in test environments.

### Health Checking
When consuming the **DockerizedServices** health coordinator, treat responses strictly: `'running'` means the process is alive, not that it is ready to serve traffic. Implement your own readiness probes on top of liveness if functional readiness is required.

### Knowledge Graph Writes
Writes to the **KnowledgeManagement** graph should use typed entity attributes (`System`, `Project`, `Pattern`) consistently. Ad-hoc untyped writes degrade the graph's queryability. When working with code-structural knowledge (as opposed to conceptual knowledge), prefer the **CodeGraphAgent** path that uses Tree-sitter to maintain AST-accurate representations.

### Constraint System as a Gate
The **ConstraintSystem** validates actions before execution. Do not attempt to bypass it for "convenience" operations — it is the platform's primary safety mechanism. Any new tool or file operation capability introduced into the system should be registered with and validated by the **ConstraintSystem**.

---

## Architectural Patterns Identified

1. **Pipeline Pattern** — LiveLoggingSystem → SemanticAnalysis → KnowledgeManagement forms an explicit data transformation pipeline with defined intermediate formats (LSL).
2. **Strategy Pattern** — LLMAbstraction's three execution modes (`mock`/`local`/`public`) are runtime-selectable strategies, externalized into configuration.
3. **Proxy/Delegation Pattern** — `bin/` scripts delegate to underlying services, and `llm-with-process.ts` wraps the LLM provider SDK.
4. **Lifecycle Pattern** — `constructor+initialize+execute` is a project-wide agent lifecycle contract.
5. **Strict Contract Health Model** — The health coordinator's refusal to return `'healthy'` is a deliberate conservative contract design.

## Design Trade-offs

- **supervisord in a single container** trades process isolation for operational simplicity — acceptable for development infrastructure, would need reconsideration for production scale.
- **Direct-fetch in `llm-with-process.ts`** trades SDK safety for telemetry injection capability — a pragmatic workaround for SDK limitations.
- **Graphology + LevelDB** trades query expressiveness (vs. a full graph database) for zero-infrastructure simplicity, with Memgraph as an escape valve for complex <USER_ID_REDACTED>.
- **SHA-256 user hashing** trades full anonymization for pseudonymized auditability — a deliberate privacy/observability balance.

## Maintainability Assessment

The project demonstrates strong maintainability signals: externalized configuration, agent-agnostic interfaces, a dedicated conventions component (**CodingPatterns**), and clear component boundaries. The primary maintainability risk is the breadth of the `CodingPatterns` catch-all — as cross-cutting concerns accumulate there, it may become harder to navigate. The strict LSL format contract between **LiveLoggingSystem** and its consumers is a double-edged sword: it ensures compatibility but makes format evolution potentially breaking across multiple consumers simultaneously.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude Code—into a unified format. It handles session windowing (time-window identifiers like '0800-0900'), multi-user support via SHA-256 user hashing, file routing with rotation thresholds, and transcript capture from agent-native formats. The system bridges raw agent transcripts to a normalized LSL format used downstream by semantic analysis and knowledge management pipelines.
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local inference backends. It provides three distinct execution modes (mock, local, public) with per-agent overrides stored in a workflow-progress.json file, allowing dynamic routing without code changes. The architecture consists of a mock service for testing, a DMR (Docker Model Runner) provider for local inference, and a direct-fetch wrapper (llm-with-process.ts) that bypasses the SDK to inject telemetry process tags into the rapid-llm-proxy endpoint.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design patterns, and best practices that permeate the entire codebase. The project follows consistent patterns visible across its configuration, tooling, and documentation: agent abstractions use a constructor+initialize+execute lifecycle, shell scripts in bin/ follow a proxy/delegation pattern to underlying services, and configuration is externalized into config/ YAML/JSON files rather than hardcoded values. The system emphasizes agent-agnostic design, enabling multiple AI backends (Claude, Copilot, Mastra, OpenCode) to operate under a unified interface.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.


---

*Generated from 2 observations*
