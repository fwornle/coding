# LLMAbstraction

**Type:** Component

LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local inference backends. It provides three distinct execution modes (mock, local, public) with per-agent overrides stored in a workflow-progress.json file, allowing dynamic routing without code changes. The architecture consists of a mock service for testing, a DMR (Docker Model Runner) provider for local inference, and a direct-fetch wrapper (llm-with-process.ts) that bypasses the SDK to inject telemetry process tags into the rapid-llm-proxy endpoint.

# LLMAbstraction — Technical Reference

## What It Is

LLMAbstraction is a provider-agnostic LLM routing layer implemented across three primary files: `llm-mock-service.ts`, `dmr-provider.ts`, and `llm-with-process.ts`. It sits within the **Coding** project as one of its seven major components, providing the shared inference backbone used by agents throughout the system — including the wave-analysis pipeline consumed by `wave-controller.ts`. The abstraction surfaces three execution modes — **mock**, **local** (DMR), and **public** (cloud providers: Anthropic, OpenAI, Groq) — with routing state persisted to `.data/workflow-progress.json` so mode changes take effect without code redeployment.

![LLMAbstraction — Relationship](images/llmabstraction-relationship.png)

## Architecture and Design

The architecture is best understood as three parallel execution paths unified by a common mode-selection layer.

![LLMAbstraction — Architecture](images/llmabstraction-architecture.png)

**Mode persistence and routing** lives in `llm-mock-service.ts`, which exposes `getLLMMode()` and `setGlobalLLMMode()`. These functions read and write a `llmState` object in `workflow-progress.json` that supports per-agent overrides, meaning individual agents can be routed to different providers simultaneously. A legacy `mockLLM` boolean is also honored for backward compatibility with older workflow state files. Docker environments introduce a path resolution wrinkle: `isMockLLMEnabled()` and `getLLMMode()` prefer `process.env.CODING_ROOT` over the caller-supplied `repositoryPath`, which correctly resolves `.data/workflow-progress.json` when the container maps the repository to `/coding`.

**The proxy bypass path** (`llm-with-process.ts`) exists for a precise, documented reason: the `@rapid/llm-proxy` SDK's `LLMService.complete()` has no `process` field, so all wave-analysis calls appear as `process='unknown'` in telemetry. Rather than forking the SDK, `llm-with-process.ts` directly POSTs to `/api/complete`, injecting a per-step `process` tag. URL resolution is delegated to the child component **ProxyUrlResolver**, implemented as `resolveProxyCompleteUrl()`, which walks a four-step priority chain: `RAPID_LLM_PROXY_URL` → `LLM_CLI_PROXY_URL` → `LLM_PROXY_URL` → `localhost:LLM_CLI_PROXY_PORT` (default `12435`). This chain mirrors the convention in the SDK's own `cli-provider-base.ts`, keeping environment-specific configuration consistent.

**The local inference path** (`dmr-provider.ts`) uses a singleton OpenAI-compatible client pointed at `http://<CONNECTION_STRING_REDACTED> SDK (`cli-provider-base.ts`) is a direct external dependency — the bypass in `llm-with-process.ts` is explicitly designed around a gap in that SDK's interface. The DMR provider integrates with Docker Model Runner via an OpenAI-compatible REST API, placing it in the same operational environment as the **DockerizedServices** component's containerized infrastructure.

The child component **ProxyUrlResolver** (`resolveProxyCompleteUrl()` in `llm-with-process.ts`) is the single point of proxy URL authority, and its priority chain must remain aligned with `cli-provider-base.ts` conventions to avoid split-brain URL resolution between SDK and bypass paths.

## Usage Guidelines

**Mode switching** should always go through `setGlobalLLMMode()` rather than direct file edits, as the function handles both the modern `llmState` schema and legacy flag. Per-agent overrides in `llmState` take precedence over the global mode, so debugging a single agent's routing does not require changing the global setting.

**Telemetry attribution** requires using `llmWithProcessComplete()` for any LLM call that should appear with a meaningful `process` label in telemetry. Callers using `LLMService.complete()` from the SDK directly will produce `process='unknown'` entries and lose per-step attribution in the rapid-llm-proxy dashboard.

**DMR health checks** are cached — operators should set `connection.healthCheckInterval` in `config/dmr-config.yaml` conservatively for high-frequency workloads. Environment variable expansion (`${VAR:-default}`) in that config file means DMR host and port can be overridden at container launch without config file edits.

**Docker path resolution** is automatic when `CODING_ROOT` is set, but developers running hybrid (partial containerization) setups should verify that `CODING_ROOT` is either unset or correctly points to the repository root to avoid mode state being read from the wrong `.data/workflow-progress.json`.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude C; LLMAbstraction: LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local ; DockerizedServices: DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint mo; KnowledgeManagement: The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lif; CodingPatterns: CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design pattern; ConstraintSystem: The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interac; SemanticAnalysis: The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized a.

### Children
- [ProxyUrlResolver](./ProxyUrlResolver.md) -- llm-with-process.ts checks RAPID_LLM_PROXY_URL first, then falls back to LLM_CLI_PROXY_URL, then LLM_PROXY_URL, and finally a port-based default, creating a priority chain that allows environment-specific overrides without code changes

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude Code—into a unified format. It handles session windowing (time-window identifiers like '0800-0900'), multi-user support via SHA-256 user hashing, file routing with rotation thresholds, and transcript capture from agent-native formats. The system bridges raw agent transcripts to a normalized LSL format used downstream by semantic analysis and knowledge management pipelines.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design patterns, and best practices that permeate the entire codebase. The project follows consistent patterns visible across its configuration, tooling, and documentation: agent abstractions use a constructor+initialize+execute lifecycle, shell scripts in bin/ follow a proxy/delegation pattern to underlying services, and configuration is externalized into config/ YAML/JSON files rather than hardcoded values. The system emphasizes agent-agnostic design, enabling multiple AI backends (Claude, Copilot, Mastra, OpenCode) to operate under a unified interface.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.


---

*Generated from 8 observations*
